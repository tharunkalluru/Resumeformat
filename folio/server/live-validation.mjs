import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readServerConfiguration } from './config.mjs';
import { createAiAdapter, SafeAiError } from './adapter.mjs';
import { MODEL, MAX_BODY_BYTES, consentHash } from './contract.mjs';
import { BudgetGuardError, LIVE_BUDGET_USD, MAX_LIVE_GENERATIONS, openLiveBudget } from './live-budget.mjs';

const OUTPUT = fileURLToPath(new URL('../output/m3-live-ai/', import.meta.url));
const MANIFEST = new URL('../public/fixtures/m3-qa-independent-manifest.json', import.meta.url);
const PROFILE = 'Product designer focused on accessible interfaces and clear design systems.';
const DESIGN_SYSTEM = 'Built a reusable design system in Figma with engineering partners.';
const KEYBOARD = 'Designed keyboard navigation for a fictional appointment portal.';

function safeCode(error) {
  if (error instanceof SafeAiError || error instanceof BudgetGuardError) return error.code;
  return 'internal_error';
}

async function fictionalRequest() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
  const primary = manifest.fixtures?.find(fixture => fixture.file === 'm3-qa-resume.pdf' && fixture.role === 'primary');
  if (manifest.fictionalOnly !== true || manifest.simulated !== true || manifest.productionCodeImported !== false ||
      ![PROFILE, DESIGN_SYSTEM, KEYBOARD].every(text => primary?.exactFacts?.includes(text))) {
    throw new BudgetGuardError('fictional_oracle_mismatch');
  }
  const request = {
    requestId: randomUUID(),
    context: { projectId: 'm3-live-fictional-avery', projectRevision: 1, draftRevision: 1, templateRevision: 1, memorySnapshotId: null, memoryRevision: null },
    job: {
      title: 'Product Designer', company: 'Fictional Harbor Lab',
      description: 'This is a fictional test job. A product designer will create accessible interfaces, collaborate with engineering partners on reusable Figma design systems, and design keyboard navigation. Focus the profile on these supported experience areas. Do not introduce qualifications or achievements beyond the supplied facts.',
    },
    facts: [
      { id: 'fact-profile', text: PROFILE, kind: 'resume', confirmed: true },
      { id: 'fact-design-system', text: DESIGN_SYSTEM, kind: 'resume', confirmed: true },
      { id: 'fact-keyboard', text: KEYBOARD, kind: 'resume', confirmed: true },
    ],
    blocks: [{ id: 'block-profile', text: PROFILE }],
  };
  request.consent = { confirmed: true, contextHash: consentHash(request) };
  if (Buffer.byteLength(JSON.stringify(request)) > MAX_BODY_BYTES) throw new BudgetGuardError('fixture_too_large');
  return request;
}

export async function runLiveValidation(mode) {
  if (!['verify', 'positive'].includes(mode)) throw new BudgetGuardError('invalid_validation_mode');
  const configuration = readServerConfiguration();
  if (!configuration.apiKey || configuration.model !== MODEL) throw new BudgetGuardError('configuration_unavailable');
  if (configuration.requestsEnabled) throw new BudgetGuardError('persistent_paid_flag_enabled');
  const request = mode === 'positive' ? await fictionalRequest() : null;
  const budget = await openLiveBudget(OUTPUT);
  let reserved = false, reservation = null;
  const nativeFetch = globalThis.fetch;
  const adapter = createAiAdapter({
    configuration: Object.freeze({ ...configuration, requestsEnabled: mode === 'positive' }),
    fetchImpl: async (url, options) => {
      if (url === `https://api.openai.com/v1/models/${MODEL}` && options.method === 'GET') return await nativeFetch(url, options);
      if (mode !== 'positive' || url !== 'https://api.openai.com/v1/responses' || options.method !== 'POST' || reserved) throw new BudgetGuardError('unexpected_provider_call');
      reservation = await budget.reserve(request.requestId, options.body);
      reserved = true;
      console.log(JSON.stringify({ stage: 'paid-request-reserved', model: MODEL, requestId: request.requestId, reservationUsd: reservation.reservationUsd, ...budget.summary() }));
      return await nativeFetch(url, options);
    },
  });
  try {
    // A successful essential test ends this runner's paid scope across restarts.
    if (mode === 'positive' && budget.hasSuccessfulGeneration()) throw new BudgetGuardError('essential_validation_already_succeeded');
    if (mode === 'positive' && budget.summary().generationCalls >= MAX_LIVE_GENERATIONS) throw new BudgetGuardError('generation_limit');
    const verificationStart = Date.now();
    try {
      const verified = await adapter.verify();
      await budget.account('verified', Date.now() - verificationStart);
      console.log(JSON.stringify({ stage: 'account-verified', model: MODEL, accountModelVerified: verified.accountModelVerified, persistentPaidRequestsEnabled: configuration.requestsEnabled, generationCalls: budget.summary().generationCalls }));
    } catch (error) {
      const code = safeCode(error);
      await budget.account(code, Date.now() - verificationStart);
      console.log(JSON.stringify({ stage: 'account-verification-failed', model: MODEL, accountModelVerified: false, errorCode: code, ...budget.summary() }));
      return { result: 'account-verification-failed', errorCode: code };
    }
    if (mode === 'verify') return { result: 'account-verified' };
    const start = Date.now();
    try {
      const result = await adapter.tailor(request);
      // Adapter already rejects credential echoes; exclude any artifact if this check fails.
      if (JSON.stringify(result).includes(configuration.apiKey)) throw new BudgetGuardError('credential_echo');
      const entry = await budget.settle(request.requestId, { result: 'success', durationMs: Date.now() - start, usage: result.usage, proposalCount: result.proposals.length });
      await budget.writeArtifact('positive-proposal.json', {
        provenance: { fictionalOnly: true, source: 'actual-provider-response', model: MODEL, fixture: 'm3-qa-resume.pdf', oracle: 'public/fixtures/m3-qa-independent-manifest.json', manualSourceGroundingReview: 'pending' },
        request, response: result,
      });
      const metadata = { stage: 'live-generation-verified', model: MODEL, requestId: request.requestId, result: 'success', durationMs: entry.durationMs, usage: entry.usage, estimatedStandardCostUsd: entry.estimatedStandardCostUsd, reservationUsd: entry.reservationUsd, proposalCount: result.proposals.length, persistentPaidRequestsEnabled: configuration.requestsEnabled, ...budget.summary() };
      await budget.writeArtifact('live-result.json', metadata);
      console.log(JSON.stringify(metadata));
      return metadata;
    } catch (error) {
      const code = safeCode(error);
      let entry = null;
      if (reserved) entry = await budget.settle(request.requestId, { result: code, durationMs: Date.now() - start });
      const metadata = { stage: 'live-generation-failed', model: MODEL, requestId: request.requestId, result: 'failed', errorCode: code, durationMs: Date.now() - start, usage: null, estimatedStandardCostUsd: null, reservationUsd: entry?.reservationUsd ?? reservation?.reservationUsd ?? 0, persistentPaidRequestsEnabled: configuration.requestsEnabled, ...budget.summary() };
      await budget.writeArtifact('live-result.json', metadata);
      console.log(JSON.stringify(metadata));
      return metadata;
    }
  } finally { await budget.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  if (process.argv[3] !== `--authorized-budget-usd=${LIVE_BUDGET_USD}` || process.argv.length !== 4) {
    console.log(JSON.stringify({ stage: 'validation-stopped', errorCode: 'explicit_budget_argument_required' }));
    process.exitCode = 1;
  } else {
    try {
      const result = await runLiveValidation(mode);
      if (result.result === 'failed' || result.result === 'account-verification-failed') process.exitCode = 1;
    } catch (error) {
      console.log(JSON.stringify({ stage: 'validation-stopped', errorCode: safeCode(error) }));
      process.exitCode = 1;
    }
  }
}

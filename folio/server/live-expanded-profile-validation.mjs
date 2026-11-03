// Purpose-scoped manual validation. Production server never imports this module.
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createAiAdapter, SafeAiError } from './adapter.mjs';
import { readServerConfiguration } from './config.mjs';
import { MODEL, MAX_BODY_BYTES, MAX_OUTPUT_TOKENS, consentHash, tailorRequestSchema } from './contract.mjs';
import { BudgetGuardError, generationReservation, safeUsage, estimatedStandardCost } from './live-budget.mjs';

const PURPOSE = 'expanded-profile-after-overflow';
const BUDGET_USD = 5;
const EXPECTED_PRIOR_RESERVATION = 0.038106;
const PROFILE = 'Product designer focused on accessible interfaces and clear design systems.';
const PRIOR_FILES = ['budget-ledger.json', 'live-result.json', 'positive-proposal.json', 'protocol-envelope-label.json', 'source-grounding-review.json'];
const PRIOR_DIRECTORY = fileURLToPath(new URL('../output/m3-live-ai/', import.meta.url));
const OUTPUT_DIRECTORY = fileURLToPath(new URL('../output/m3-live-ai-expanded-profile/', import.meta.url));
const RESULT_CODES = ['reserved', 'success', 'provider_auth', 'provider_access', 'provider_rate_limit', 'provider_error', 'provider_timeout', 'provider_invalid_response', 'provider_refusal', 'provider_incomplete', 'internal_error'];
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const number = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usd = z.number().nonnegative().max(BUDGET_USD);
const entrySchema = z.object({
  requestId: z.string().uuid(), reservedAt: z.string().datetime(), protocol: z.literal('expanded-envelope-v1'),
  providerBodyBytes: number, inputTokenBound: number, maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS), reservationUsd: usd,
  result: z.enum(RESULT_CODES), durationMs: number.nullable(),
  usage: z.object({ inputTokens: number, outputTokens: number, totalTokens: number }).strict().nullable(),
  estimatedStandardCostUsd: usd.nullable(), proposalCount: number.nullable(),
}).strict();
const anchorSchema = z.object({
  priorLedgerPath: z.literal('output/m3-live-ai/budget-ledger.json'), priorLedgerHash: digest,
  priorGenerationCalls: z.literal(1), priorCommittedReservationUsd: z.literal(EXPECTED_PRIOR_RESERVATION),
  priorEstimatedStandardCostUsd: z.literal(0.003156),
  priorArtifactHashes: z.object(Object.fromEntries(PRIOR_FILES.map(name => [name, digest]))).strict(),
}).strict();
const cumulativeSchema = z.object({
  schemaVersion: z.literal(1), purpose: z.literal(PURPOSE), model: z.literal(MODEL), budgetUsd: z.literal(BUDGET_USD),
  maxAdditionalGenerationCalls: z.literal(1), maxCumulativeGenerationCalls: z.literal(3),
  reservationPolicy: z.literal('retain-full-prior-and-new-reservations'), anchor: anchorSchema,
  account: z.object({ verified: z.boolean(), result: z.enum(['verified', ...RESULT_CODES]), durationMs: number, checkedAt: z.string().datetime() }).strict().nullable(),
  entries: z.array(entrySchema).max(1),
}).strict().refine(value => value.anchor.priorCommittedReservationUsd + value.entries.reduce((sum, entry) => sum + entry.reservationUsd, 0) <= BUDGET_USD);

class ExpandedProfileGuardError extends Error {
  constructor(code) { super('The purpose-scoped validation guard stopped the operation.'); this.code = code; }
}
const shaBytes = bytes => createHash('sha256').update(bytes).digest('hex');
const safeCode = error => error instanceof SafeAiError || error instanceof BudgetGuardError || error instanceof ExpandedProfileGuardError ? error.code : 'internal_error';

async function atomicJson(path, value) {
  const temporary = join(dirname(path), `.expanded-profile-write-${randomUUID()}.json`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

async function artifactHashes(directory) {
  return Object.fromEntries(await Promise.all(PRIOR_FILES.map(async name => [name, shaBytes(await readFile(join(directory, name)))])));
}

export async function openExpandedProfileBudget({ priorDirectory = PRIOR_DIRECTORY, outputDirectory = OUTPUT_DIRECTORY } = {}) {
  // Same mutex as the original runner: routes cannot generate concurrently.
  const lockPath = join(priorDirectory, '.live-validation.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new ExpandedProfileGuardError('live_validation_locked'); }
  let ledger, anchor;
  const path = join(outputDirectory, 'cumulative-budget-ledger.json');
  try {
    const hashes = await artifactHashes(priorDirectory);
    const prior = JSON.parse(await readFile(join(priorDirectory, 'budget-ledger.json'), 'utf8'));
    if (prior.schemaVersion !== 1 || prior.model !== MODEL || prior.budgetUsd !== BUDGET_USD || prior.maxGenerationCalls !== 3 ||
        prior.reservationPolicy !== 'retain-full-reservation-for-every-call' || prior.entries?.length !== 1 ||
        prior.entries[0].result !== 'success' || prior.entries[0].reservationUsd !== EXPECTED_PRIOR_RESERVATION ||
        prior.entries[0].estimatedStandardCostUsd !== 0.003156) throw new ExpandedProfileGuardError('prior_budget_mismatch');
    anchor = {
      priorLedgerPath: 'output/m3-live-ai/budget-ledger.json', priorLedgerHash: hashes['budget-ledger.json'],
      priorGenerationCalls: 1, priorCommittedReservationUsd: EXPECTED_PRIOR_RESERVATION, priorEstimatedStandardCostUsd: 0.003156,
      priorArtifactHashes: hashes,
    };
    await mkdir(outputDirectory, { recursive: true });
    try {
      const parsed = cumulativeSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
      if (!parsed.success || JSON.stringify(parsed.data.anchor) !== JSON.stringify(anchor)) throw new ExpandedProfileGuardError('cumulative_budget_mismatch');
      ledger = parsed.data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ledger = {
        schemaVersion: 1, purpose: PURPOSE, model: MODEL, budgetUsd: BUDGET_USD, maxAdditionalGenerationCalls: 1,
        maxCumulativeGenerationCalls: 3, reservationPolicy: 'retain-full-prior-and-new-reservations', anchor, account: null, entries: [],
      };
      await atomicJson(path, ledger);
    }
  } catch (error) {
    await lock.close(); await unlink(lockPath);
    throw error instanceof ExpandedProfileGuardError ? error : new ExpandedProfileGuardError('cumulative_budget_mismatch');
  }
  const committed = () => Math.round((EXPECTED_PRIOR_RESERVATION + ledger.entries.reduce((sum, entry) => sum + entry.reservationUsd, 0)) * 1_000_000) / 1_000_000;
  return {
    assertAvailable() { if (ledger.entries.length !== 0) throw new ExpandedProfileGuardError('purpose_call_already_consumed'); },
    summary() {
      return { budgetUsd: BUDGET_USD, priorGenerationCalls: 1, additionalGenerationCalls: ledger.entries.length, cumulativeGenerationCalls: 1 + ledger.entries.length, committedReservationUsd: committed(), remainingBudgetUsd: Math.round((BUDGET_USD - committed()) * 1_000_000) / 1_000_000 };
    },
    async account(result, durationMs) {
      ledger.account = { verified: result === 'verified', result: RESULT_CODES.includes(result) || result === 'verified' ? result : 'internal_error', durationMs, checkedAt: new Date().toISOString() };
      await atomicJson(path, ledger);
    },
    async reserve(requestId, body) {
      this.assertAvailable();
      if (!z.string().uuid().safeParse(requestId).success) throw new ExpandedProfileGuardError('invalid_request_id');
      const reservation = generationReservation(body);
      if (EXPECTED_PRIOR_RESERVATION + reservation.reservationUsd > BUDGET_USD) throw new ExpandedProfileGuardError('budget_exhausted');
      ledger.entries.push({ requestId, reservedAt: new Date().toISOString(), protocol: 'expanded-envelope-v1', ...reservation, result: 'reserved', durationMs: null, usage: null, estimatedStandardCostUsd: null, proposalCount: null });
      await atomicJson(path, ledger);
      return reservation;
    },
    async settle(requestId, { result, durationMs, usage = null, proposalCount = null }) {
      const entry = ledger.entries[0];
      if (!entry || entry.requestId !== requestId || entry.result !== 'reserved') throw new ExpandedProfileGuardError('invalid_settlement');
      const candidate = safeUsage(usage);
      const measured = candidate && candidate.inputTokens <= entry.inputTokenBound && candidate.outputTokens <= MAX_OUTPUT_TOKENS ? candidate : null;
      Object.assign(entry, { result: RESULT_CODES.includes(result) && result !== 'reserved' ? result : 'internal_error', durationMs, usage: measured, estimatedStandardCostUsd: measured ? estimatedStandardCost(measured) : null, proposalCount });
      if (!cumulativeSchema.safeParse(ledger).success) throw new ExpandedProfileGuardError('invalid_settlement');
      await atomicJson(path, ledger);
      return structuredClone(entry);
    },
    async artifact(name, value) {
      if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new ExpandedProfileGuardError('invalid_artifact_name');
      await atomicJson(join(outputDirectory, name), value);
    },
    async preservePrior() {
      const current = await artifactHashes(priorDirectory);
      if (JSON.stringify(current) !== JSON.stringify(anchor.priorArtifactHashes)) throw new ExpandedProfileGuardError('prior_artifacts_changed');
      const evidence = { allFivePriorArtifactsBytePreserved: true, originalLedgerBytePreserved: true, priorLedgerHash: anchor.priorLedgerHash, priorArtifactHashes: current };
      await atomicJson(join(outputDirectory, 'prior-artifact-preservation.json'), evidence);
      return evidence;
    },
    async close() { await lock.close(); await unlink(lockPath); },
  };
}

export async function buildExpandedProfileRequest() {
  const manifest = JSON.parse(await readFile(new URL('../public/fixtures/m3-qa-independent-manifest.json', import.meta.url), 'utf8'));
  const oracle = manifest.fixtures?.find(fixture => fixture.file === 'm3-qa-resume.pdf' && fixture.role === 'primary');
  const sourceBytes = await readFile(new URL('../public/fixtures/m3-qa-resume.pdf', import.meta.url));
  const qa = JSON.parse(await readFile(new URL('../output/m3-qa/q10-ai-client-replay-results.json', import.meta.url), 'utf8'));
  const selected = qa.requests?.find(entry => entry.path === '/api/ai/tailor' && entry.method === 'POST')?.selected;
  const fact = selected?.facts?.find(item => item.text === PROFILE);
  const block = selected?.blocks?.find(item => item.text === PROFILE);
  if (manifest.fictionalOnly !== true || manifest.productionCodeImported !== false || !oracle?.exactFacts?.includes(PROFILE) ||
      shaBytes(sourceBytes) !== oracle.sha256 || qa.simulated !== true || qa.replayOnly !== true || qa.actualProviderCalls !== 0 ||
      !fact || !block || fact.kind !== 'resume' || fact.source?.kind !== 'resume' || fact.source?.hash !== oracle.sha256 ||
      fact.source?.quote !== PROFILE || fact.source?.locator !== 'pdf/page[1]/items[5]') throw new ExpandedProfileGuardError('fictional_scope_mismatch');
  const body = {
    schemaVersion: 1, allowedOperations: ['replaceParagraphText'], requestId: randomUUID(), context: structuredClone(selected.context),
    job: { title: 'Product Designer', company: 'Fictional Harbor Lab', description: 'Fictional product designer role prioritizing clear design systems and accessible interfaces. Applications use a concise one-line profile.' },
    facts: [structuredClone(fact)], blocks: [structuredClone(block)],
  };
  const request = { ...body, consent: { confirmed: true, contextHash: consentHash(body) } };
  if (!tailorRequestSchema.safeParse(request).success || Buffer.byteLength(JSON.stringify(request)) > MAX_BODY_BYTES) throw new ExpandedProfileGuardError('invalid_expanded_fixture');
  return request;
}

export async function runExpandedProfileValidation() {
  const configuration = readServerConfiguration();
  if (!configuration.apiKey || configuration.model !== MODEL || configuration.requestsEnabled) throw new ExpandedProfileGuardError('configuration_mismatch');
  const request = await buildExpandedProfileRequest();
  const budget = await openExpandedProfileBudget();
  let reserved = false, postCalls = 0;
  const nativeFetch = globalThis.fetch;
  const adapter = createAiAdapter({
    configuration: Object.freeze({ ...configuration, requestsEnabled: true }),
    fetchImpl: async (url, options) => {
      if (url === `https://api.openai.com/v1/models/${MODEL}` && options.method === 'GET') return await nativeFetch(url, options);
      if (url !== 'https://api.openai.com/v1/responses' || options.method !== 'POST' || postCalls !== 0) throw new ExpandedProfileGuardError('unexpected_provider_call');
      const reservation = await budget.reserve(request.requestId, options.body);
      reserved = true; postCalls++;
      console.log(JSON.stringify({ stage: 'expanded-profile-reserved', model: MODEL, requestId: request.requestId, reservationUsd: reservation.reservationUsd, ...budget.summary() }));
      return await nativeFetch(url, options);
    },
  });
  try {
    budget.assertAvailable();
    const verificationStart = Date.now();
    try {
      await adapter.verify(); await budget.account('verified', Date.now() - verificationStart);
      console.log(JSON.stringify({ stage: 'expanded-profile-account-verified', model: MODEL, persistentPaidRequestsEnabled: false }));
    } catch (error) {
      const errorCode = safeCode(error);
      await budget.account(errorCode, Date.now() - verificationStart);
      console.log(JSON.stringify({ stage: 'expanded-profile-account-failed', errorCode, ...budget.summary() }));
      return { result: 'failed', errorCode };
    }
    const start = Date.now();
    let response = null, errorCode = null;
    try {
      response = await adapter.tailor(request);
      if (JSON.stringify(response).includes(configuration.apiKey)) throw new ExpandedProfileGuardError('credential_echo');
    } catch (error) { response = null; errorCode = safeCode(error); }
    const entry = reserved ? await budget.settle(request.requestId, { result: response ? 'success' : errorCode, durationMs: Date.now() - start, usage: response?.usage ?? null, proposalCount: response?.proposals.length ?? null }) : null;
    const metadata = {
      stage: response ? 'expanded-profile-generation-verified' : 'expanded-profile-generation-failed',
      result: response ? 'success' : 'failed', errorCode, purpose: PURPOSE, model: MODEL, requestId: request.requestId,
      durationMs: entry?.durationMs ?? Date.now() - start, usage: entry?.usage ?? null, estimatedStandardCostUsd: entry?.estimatedStandardCostUsd ?? null,
      reservationUsd: entry?.reservationUsd ?? 0, proposalCount: response?.proposals.length ?? null,
      afterTextCharacters: response?.proposals.map(proposal => proposal.afterText.length) ?? [],
      persistentPaidRequestsEnabled: false, ...budget.summary(),
    };
    if (response) await budget.artifact('expanded-profile-proposal.json', {
      provenance: {
        fictionalOnly: true, source: 'actual-provider-response', protocol: 'expanded-envelope-v1', currentExpandedEnvelopeLiveVerified: true,
        fixture: 'm3-qa-resume.pdf', oracle: 'public/fixtures/m3-qa-independent-manifest.json',
        contextSource: 'pinned fictional simulated browser request; separate from current browser state',
        selectedOriginalProfileOnly: true, manualSourceGroundingReview: 'pending', layoutFitVerified: false,
      }, request, response,
    });
    await budget.artifact('expanded-profile-result.json', metadata);
    console.log(JSON.stringify(metadata));
    return metadata;
  } finally {
    try { await budget.preservePrior(); } finally { await budget.close(); }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 4 || process.argv[2] !== '--authorized-budget-usd=5' || process.argv[3] !== `--purpose=${PURPOSE}`) {
    console.log(JSON.stringify({ stage: 'expanded-profile-stopped', errorCode: 'explicit_purpose_and_budget_required' })); process.exitCode = 1;
  } else {
    try { const result = await runExpandedProfileValidation(); if (result.result === 'failed') process.exitCode = 1; }
    catch (error) { console.log(JSON.stringify({ stage: 'expanded-profile-stopped', errorCode: safeCode(error) })); process.exitCode = 1; }
  }
}

// @vitest-environment jsdom
import { createHash, webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { approveTemplate, editBlock } from '../core/commands';
import { canonicalJson, hashTextSync } from '../core/model';
import type { Project } from '../core/model';
import { fixtureProject } from '../core/testFixture';
import { projectSchema } from '../core/schema';
import { AiTailoringPanel } from '../ui/AiTailoringPanel';
import { getFontMetrics, setFontLoader } from '../layout/fonts';
import { computeLayout } from '../layout/engine';
import {
  AI_MODEL, AiClientError, aiConsentHash, aiErrorMessage, aiFormattingIssue, aiLayoutBudget, aiProjectFingerprint, aiProposalFindings,
  assertAiRequestCurrent, canSendAiRequest, createAiClient, guardAiAcceptance,
  prepareAiRequest, probeAiCandidate, reviewedAiRuns, validateAiRequest, validateAiResult,
} from './ai';
import type { AiRequest, AiResult, AiStatus } from './ai';

// Native test-only load preserves Vite's denial of browser access to server files.
const { annotateProposals, consentHash: serverConsentHash, tailorRequestSchema: serverRequestSchema } = createRequire(import.meta.url)('../../server/contract.mjs');

const syntheticStatus: AiStatus = { keyConfigured: true, modelConfigured: true, supportedModel: true, paidRequestsEnabled: true, accountModelVerified: true, busy: false, verification: 'verified' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
function expectProjectUnchanged(project: Project, snapshot: Project) {
  // Node's structuredClone returns Node typed arrays while jsdom owns the fixture
  // arrays. Compare complete snapshots in the same realm without changing the
  // genuine fixture, production validation, or any field/byte being asserted.
  expect(structuredClone(project)).toEqual(snapshot);
}
async function syntheticApplication(): Promise<Project> {
  const project = await approveTemplate(await fixtureProject(), []);
  return { ...project, workspace: { ...project.workspace, kind: 'application' }, job: { title: 'Fictional engineer', company: 'Synthetic company', description: 'React and TypeScript dashboards' } };
}
function syntheticResult(request: AiRequest): AiResult {
  const afterText = 'Built TypeScript dashboards using React.';
  return { schemaVersion: 1, requestId: request.requestId, context: request.context, contextHash: request.consent.contextHash, model: AI_MODEL, requiresReview: true, usage: { inputTokens: 100, outputTokens: 30, totalTokens: 130 }, proposals: [{ operation: 'replaceParagraphText', blockId: request.blocks[0].id, beforeText: request.blocks[0].text, beforeHash: request.blocks[0].textHash, afterText, afterHash: hashTextSync(afterText), factIds: [request.facts[0].id], factRefs: syntheticFactRefs(request, [request.facts[0].id]), reason: 'Emphasize the supplied tools for this fictional role.' }] };
}
function syntheticFactRefs(request: AiRequest, factIds: string[]) {
  return factIds.map(factId => { const fact = request.facts.find(item => item.id === factId)!;
    return { factId, version: fact.version, assertionId: fact.assertionId, sourceId: fact.source.id, sourceVersion: fact.source.version, sourceHash: fact.source.hash, quoteHash: fact.source.quoteHash, textHash: fact.textHash };
  });
}
function setAfterText(result: AiResult, text: string) { result.proposals[0].afterText = text; result.proposals[0].afterHash = hashTextSync(text); }
async function syntheticProfileApplication(): Promise<Project> {
  const project = await syntheticApplication(), profile = 'Product designer focused on accessible interfaces and clear design systems.';
  const region = project.template.pages[0].regions[0];
  if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
  region.bounds.width = 385; region.bounds.height = 12.5; region.style.fontSize = 10; region.style.lineHeight = 12.5;
  project.facts[0].text = profile;
  project.facts.push({ id: 'figma-detail', text: 'Built a reusable design system in Figma with engineering partners.', kind: 'careerNote', confirmed: true, locator: 'Fictional applicant note' });
  project.baseline.blocks[0].runs[0].text = profile; project.draft.blocks[0].runs[0].text = profile;
  return approveTemplate(project, []);
}
const profileRequest = (project: Project) => prepareAiRequest(project, project.facts.map(fact => fact.id), [project.draft.blocks[0].id], 'synthetic-profile-request');
function syntheticProfileResult(request: AiRequest, text: string): AiResult {
  const result = syntheticResult(request); setAfterText(result, text);
  result.proposals[0].factIds = request.facts.map(fact => fact.id); result.proposals[0].factRefs = syntheticFactRefs(request, result.proposals[0].factIds);
  return result;
}
const requestFor = (project: Project) => prepareAiRequest(project, [project.facts[0].id], [project.draft.blocks[0].id], 'synthetic-request');
let restoreFonts: () => void;
beforeAll(() => { restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file)))); });
afterAll(() => restoreFonts());
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const testEndpoint = async () => ({ baseUrl: '/api/ai', headers: {} });
describe('synthetic project immutability snapshots', () => {
  it('keeps genuine fixture bytes valid while comparing the complete clone', async () => {
    const project = await fixtureProject(), snapshot = structuredClone(project);
    expect(project.source.bytes).toBeInstanceOf(Uint8Array);
    expect(projectSchema.safeParse(project).success).toBe(true);
    expectProjectUnchanged(project, snapshot);
  });
  it.each(['source byte', 'nested wording'] as const)('detects a changed %s', async change => {
    const project = await fixtureProject(), snapshot = structuredClone(project);
    if (change === 'source byte') project.source.bytes[0] ^= 1;
    else project.draft.blocks[0].runs[0].text += ' changed';
    expect(() => expectProjectUnchanged(project, snapshot)).toThrow();
  });
});

describe('AI selected request boundary (synthetic; no provider)', () => {
  it('copies only selected eligible fact text, block text, job and exact context', async () => {
    const project = await syntheticApplication();
    project.notes.push({ id: 'hidden-note', text: 'Hidden unconfirmed note', confirmed: false });
    project.facts.push({ id: 'unconfirmed', text: 'Unconfirmed credential', kind: 'careerNote', confirmed: false, locator: 'Hidden provenance' });
    project.assets.push({ id: 'image', name: 'Hidden asset', mime: 'image/png', bytes: new Uint8Array([1, 2]) });
    const request = requestFor(project), serialized = JSON.stringify(request);
    expect(Object.keys(request).sort()).toEqual(['allowedOperations', 'blocks', 'consent', 'context', 'facts', 'job', 'requestId', 'schemaVersion']);
    expect(request.facts).toHaveLength(1);
    expect(request.facts[0]).toMatchObject({ id: project.facts[0].id, text: project.facts[0].text, kind: 'resume', confirmed: true, version: 1, assertionId: null, confirmation: null, textHash: hashTextSync(project.facts[0].text) });
    expect(request.facts[0].source).toEqual({ id: project.source.id, kind: 'resume', version: 1, hash: project.source.sha256, quote: project.facts[0].text, quoteHash: hashTextSync(project.facts[0].text), locator: project.facts[0].locator });
    expect(serialized).not.toMatch(/Hidden|Unconfirmed|bytes|assets|notes|href|sha256/);
    expect(request.context.memorySnapshotId).toBeNull(); expect(request.context.memoryRevision).toBeNull();
    expect(() => prepareAiRequest(project, ['unconfirmed'], [project.draft.blocks[0].id])).toThrow(AiClientError);
  });
  it('binds the same canonical SHA-256 bytes as the server convention', async () => {
    const request = requestFor(await syntheticApplication());
    const { schemaVersion, allowedOperations, requestId, context, job, facts, blocks } = request;
    const independent = createHash('sha256').update(canonicalJson({ schemaVersion, allowedOperations, requestId, context, job, facts, blocks })).digest('hex');
    expect(aiConsentHash(request)).toBe(independent); expect(request.consent.contextHash).toBe(independent);
    expect(() => validateAiRequest({ ...request, job: { ...job, title: 'Changed after consent' } })).toThrowError(/consent/);
  });
  it('rejects unknown or duplicate selected IDs and reusable-resume requests', async () => {
    const project = await syntheticApplication();
    for (const ids of [['unknown'], [project.facts[0].id, project.facts[0].id]]) expect(() => prepareAiRequest(project, ids, [project.draft.blocks[0].id])).toThrow();
    expect(() => prepareAiRequest(project, [project.facts[0].id], ['unknown'])).toThrow();
    expect(() => requestFor({ ...project, workspace: { ...project.workspace, kind: 'resume' } })).toThrow();
  });
  it('rejects extra fields, invalid nullable pairs, ID shapes and oversized encoded payloads', async () => {
    const project = await syntheticApplication(), request = requestFor(project);
    expect(() => validateAiRequest({ ...request, key: 'forbidden' })).toThrow();
    expect(() => validateAiRequest({ ...request, facts: [{ ...request.facts[0], locator: 'not allowed' }] })).toThrow();
    expect(() => validateAiRequest({ ...request, context: { ...request.context, memorySnapshotId: 'snapshot', memoryRevision: null } })).toThrow();
    expect(() => prepareAiRequest(project, [project.facts[0].id], [project.draft.blocks[0].id], 'invalid id')).toThrow();
    expect(() => requestFor({ ...project, job: { ...project.job, description: '字'.repeat(50_000) } })).toThrowError(/128 KiB/);
    expect(() => requestFor({ ...project, job: { ...project.job, description: 'x'.repeat(50_001) } })).toThrow();
  });
  it('uses pinned snapshot eligibility and never sends excluded or historical facts', async () => {
    const project = await syntheticApplication();
    project.facts.push({ id: 'withheld-resume', text: 'Withheld qualification', kind: 'resume', confirmed: true, locator: 'fixture' });
    project.memorySnapshot = { id: 'pinned-snapshot', templateGroupId: project.workspace.templateGroupId, memoryRevision: 7, memoryHash: 'a'.repeat(64), createdAt: project.createdAt, sourceResumeId: 'source-resume', sourceResumeRevision: 3, eligibleFactIds: [project.facts[0].id], evidence: [], baselineReviewBlocks: [] };
    expect(requestFor(project).context).toMatchObject({ memorySnapshotId: 'pinned-snapshot', memoryRevision: 7 });
    expect(() => prepareAiRequest(project, ['withheld-resume'], [project.draft.blocks[0].id])).toThrow();
  });
  it('binds only selected pinned assertion provenance, actual version and confirmation time', async () => {
    const project = await syntheticApplication(), text = 'Built accessible React interfaces.', quote = 'Fictional source: Built accessible React interfaces.';
    project.facts.push({ id: 'pinned-fact-v3', text, kind: 'careerNote', confirmed: true, locator: 'Selected page 2' }, { id: 'unselected-fact', text: 'Hidden unselected source text', kind: 'careerNote', confirmed: true, locator: 'Hidden unselected locator' });
    const provenance = { sourceId: 'selected-source', sourceKind: 'supportingFile' as const, sourceName: 'Selected fictional context.txt', sourceHash: hashTextSync('Actual fictional original'), locator: 'Selected page 2', originalQuote: quote, quoteHash: hashTextSync(quote) };
    project.memorySnapshot = { id: 'pinned-snapshot', templateGroupId: project.workspace.templateGroupId, memoryRevision: 7, memoryHash: 'a'.repeat(64), createdAt: project.createdAt, sourceResumeId: 'source-resume', sourceResumeRevision: 3, eligibleFactIds: [project.facts[0].id, 'pinned-fact-v3'], evidence: [{ factId: 'pinned-fact-v3', assertionId: 'selected-assertion', assertionVersion: 3, provenance, confirmation: { actor: 'applicant', version: 3, textHash: hashTextSync(text), confirmedAt: '2026-10-04T12:00:00.000Z' } }], baselineReviewBlocks: [] };
    const request = prepareAiRequest(project, [project.facts[0].id, 'pinned-fact-v3'], [project.draft.blocks[0].id], 'synthetic-pinned');
    expect(request.facts[1]).toMatchObject({ version: 3, assertionId: 'selected-assertion', confirmation: { version: 3, textHash: hashTextSync(text), confirmedAt: '2026-10-04T12:00:00.000Z' }, source: { id: 'selected-source', kind: 'supportingFile', version: 1, hash: provenance.sourceHash, quote, quoteHash: hashTextSync(quote), locator: 'Selected page 2' } });
    expect(JSON.stringify(request)).not.toContain('Hidden'); expect(JSON.stringify(request)).not.toContain('sourceName');
    expect(serverRequestSchema.safeParse(request).success).toBe(true); expect(serverConsentHash(request)).toBe(request.consent.contextHash);
    project.memorySnapshot.evidence[0].confirmation = null;
    expect(() => prepareAiRequest(project, [project.facts[0].id, 'pinned-fact-v3'], [project.draft.blocks[0].id])).toThrow();
  });
  it('uses honest null timestamps and application-local source kinds for legacy confirmations', async () => {
    const project = await syntheticApplication();
    project.facts.push({ id: 'local-note', text: 'Built React interfaces.', kind: 'careerNote', confirmed: true, locator: 'Applicant note' }, { id: 'local-edit', text: 'Built TypeScript interfaces.', kind: 'applicantEdit', confirmed: true, locator: 'Applicant paragraph' });
    const request = prepareAiRequest(project, [project.facts[0].id, 'local-note', 'local-edit'], [project.draft.blocks[0].id]);
    for (const fact of request.facts.slice(1)) {
      expect(fact.assertionId).toBeNull(); expect(fact.version).toBe(1); expect(fact.source.id).toBe(fact.id);
      expect(fact.source.kind).toBe(fact.kind); expect(fact.source.hash).toBe(fact.textHash); expect(fact.source.quote).toBe(fact.text);
      expect(fact.confirmation).toEqual({ version: 1, textHash: fact.textHash, confirmedAt: null });
    }
    expect(serverRequestSchema.safeParse(request).success).toBe(true);
  });
  it('rejects assertion provenance when the request is unbound from a pinned snapshot', async () => {
    const request = requestFor(await syntheticApplication()), fact = request.facts[0];
    Object.assign(fact, { kind: 'careerNote', assertionId: 'unbound-assertion', confirmation: { version: 1, textHash: fact.textHash, confirmedAt: '2026-10-04T12:00:00.000Z' } });
    request.consent.contextHash = aiConsentHash(request);
    expect(() => validateAiRequest(request)).toThrow();
  });
  it.each(['envelope-version', 'operation', 'text-hash', 'quote-hash', 'block-hash', 'source-version', 'resume-version', 'null-triplet'] as const)('rejects modified selected metadata: %s', async failure => {
    const request = structuredClone(requestFor(await syntheticApplication()));
    if (failure === 'envelope-version') Object.assign(request, { schemaVersion: 2 });
    if (failure === 'operation') Object.assign(request, { allowedOperations: ['changeLayout'] });
    if (failure === 'text-hash') request.facts[0].textHash = '0'.repeat(64);
    if (failure === 'quote-hash') request.facts[0].source.quoteHash = '0'.repeat(64);
    if (failure === 'block-hash') request.blocks[0].textHash = '0'.repeat(64);
    if (failure === 'source-version') Object.assign(request.facts[0].source, { version: 2 });
    if (failure === 'resume-version') request.facts[0].version = 2;
    if (failure === 'null-triplet') request.context.memoryHash = 'a'.repeat(64);
    request.consent.contextHash = aiConsentHash(request);
    expect(() => validateAiRequest(request)).toThrow();
  });
  it('counts selected source quotations and locators inside the combined text limit', async () => {
    const project = await syntheticApplication(); project.job.description = 'x'.repeat(50_000);
    project.facts = Array.from({ length: 3 }, (_, index) => ({ ...project.facts[0], id: `selected-large-${index}`, text: 'x'.repeat(9000) }));
    project.draft.blocks[0].sourceFactIds = [project.facts[0].id]; project.draft.blocks[0].runs[0].sourceFactIds = [project.facts[0].id];
    expect(() => prepareAiRequest(project, project.facts.map(fact => fact.id), [project.draft.blocks[0].id])).toThrow();
  });
  it.each(['project', 'draft', 'template', 'layout-hash', 'baseline-hash', 'job', 'fact', 'snapshot'] as const)('rejects current-context changes: %s', async change => {
    const project = await syntheticApplication(), request = requestFor(project), changed = structuredClone(project);
    if (change === 'project') changed.revision++;
    if (change === 'draft') changed.draft.revision++;
    if (change === 'template') changed.template.revision++;
    if (change === 'layout-hash') changed.template.pages[0].regions[0].bounds.width++;
    if (change === 'baseline-hash') changed.baseline.blocks[0].runs[0].text += ' changed source wording';
    if (change === 'job') changed.job.description += ' new requirements';
    if (change === 'fact') changed.facts[0].text += ' new evidence';
    if (change === 'snapshot') changed.memorySnapshot = { id: 'new-snapshot', templateGroupId: project.workspace.templateGroupId, memoryRevision: 1, memoryHash: 'a'.repeat(64), createdAt: project.createdAt, sourceResumeId: 'source-resume', sourceResumeRevision: 1, eligibleFactIds: [], evidence: [], baselineReviewBlocks: [] };
    expect(() => assertAiRequestCurrent(changed, request)).toThrowError(/application changed/);
  });
  it('fingerprints group, layout and selected evidence changes without binary source bytes', async () => {
    const project = await syntheticApplication(), before = aiProjectFingerprint(project), changed = structuredClone(project);
    changed.template.pages[0].regions[0].bounds.width--;
    expect(aiProjectFingerprint(changed)).not.toBe(before);
    changed.template = project.template; changed.source.bytes = new Uint8Array([3, 4]);
    expect(aiProjectFingerprint(changed)).toBe(before);
    changed.workspace.templateGroupId = 'other-group'; expect(aiProjectFingerprint(changed)).not.toBe(before);
  });
});

describe('AI result review boundary (synthetic; no provider)', () => {
  it('returns review-only proposals without touching the draft and guards explicit acceptance', async () => {
    const project = await syntheticApplication(), before = structuredClone(project), request = requestFor(project), result = syntheticResult(request);
    expect(validateAiResult(result, request).requiresReview).toBe(true);
    guardAiAcceptance(project, request, result, result.proposals[0]);
    expectProjectUnchanged(project, before);
    expect(() => guardAiAcceptance(editBlock(project, project.draft.blocks[0].id, [{ text: 'Manual edit' }]), request, result, result.proposals[0])).toThrowError(/application changed/);
    expect(() => guardAiAcceptance(project, request, result, { ...result.proposals[0], afterText: 'Tampered after validation' })).toThrow();
  });
  it('accepts server-derived annotated proposals and rejects altered fact reference identity', async () => {
    const project = await syntheticApplication(), request = requestFor(project), result = syntheticResult(request);
    const { blockId, beforeText, afterText, factIds, reason } = result.proposals[0];
    result.proposals = annotateProposals([{ blockId, beforeText, afterText, factIds, reason }], request);
    expect(validateAiResult(result, request).proposals[0]).toMatchObject({ operation: 'replaceParagraphText', beforeHash: request.blocks[0].textHash });
    for (const key of ['version', 'assertionId', 'sourceId', 'sourceVersion', 'sourceHash', 'quoteHash', 'textHash'] as const) {
      const changed = structuredClone(result); Object.assign(changed.proposals[0].factRefs[0], { [key]: key === 'version' || key === 'sourceVersion' ? 2 : key === 'assertionId' || key === 'sourceId' ? 'unknown-source' : '0'.repeat(64) });
      expect(() => validateAiResult(changed, request)).toThrow();
    }
    const changed = structuredClone(result); changed.proposals[0].afterHash = '0'.repeat(64); expect(() => validateAiResult(changed, request)).toThrow();
  });
  it.each(['unknown-block', 'unknown-fact', 'before-text', 'duplicate-block', 'duplicate-fact', 'empty', 'unchanged', 'unknown-key', 'model', 'hash', 'context', 'request', 'usage', 'review', 'response-version', 'operation', 'before-hash', 'after-hash', 'missing-ref'])('rejects invalid response fields as a whole: %s', async failure => {
    const request = requestFor(await syntheticApplication()), result = structuredClone(syntheticResult(request));
    const proposal = result.proposals[0];
    if (failure === 'unknown-block') proposal.blockId = 'unknown';
    if (failure === 'unknown-fact') proposal.factIds = ['unknown'];
    if (failure === 'before-text') proposal.beforeText += ' changed';
    if (failure === 'duplicate-block') result.proposals.push({ ...proposal });
    if (failure === 'duplicate-fact') proposal.factIds.push(proposal.factIds[0]);
    if (failure === 'empty') proposal.afterText = '   ';
    if (failure === 'unchanged') proposal.afterText = proposal.beforeText;
    if (failure === 'unknown-key') Object.assign(proposal, { approved: true });
    if (failure === 'model') Object.assign(result, { model: 'another-model' });
    if (failure === 'hash') result.contextHash = '0'.repeat(64);
    if (failure === 'context') result.context.projectRevision++;
    if (failure === 'request') result.requestId = 'other-request';
    if (failure === 'usage') result.usage!.totalTokens++;
    if (failure === 'review') Object.assign(result, { requiresReview: false });
    if (failure === 'response-version') Object.assign(result, { schemaVersion: 2 });
    if (failure === 'operation') Object.assign(proposal, { operation: 'changeLayout' });
    if (failure === 'before-hash') proposal.beforeHash = '0'.repeat(64);
    if (failure === 'after-hash') proposal.afterHash = '0'.repeat(64);
    if (failure === 'missing-ref') proposal.factRefs = [];
    expect(() => validateAiResult(result, request)).toThrow(AiClientError);
  });
  it.each(['10%', '$10', '2026', 'Jan 2026', 'three years', '10 months', '3–5', '.5%', '10 percentage points'])('rejects introduced protected numeric/date/duration literals: %s', async literal => {
    const request = requestFor(await syntheticApplication()), result = syntheticResult(request);
    setAfterText(result, `Built React ${literal}.`);
    expect(() => validateAiResult(result, request)).toThrow();
  });
  it('requires numeric support from cited facts, including the exact unit', async () => {
    const project = await syntheticApplication(); project.facts[0].text += ' Built 10 projects.';
    project.facts.push({ id: 'uncited', text: 'Improved 10% efficiency.', kind: 'careerNote', confirmed: true, locator: 'Synthetic note' });
    const request = prepareAiRequest(project, project.facts.map(fact => fact.id), [project.draft.blocks[0].id], 'synthetic-numeric'), result = syntheticResult(request);
    setAfterText(result, 'Built 10 projects using React.');
    expect(validateAiResult(result, request).proposals).toHaveLength(1);
    setAfterText(result, 'Improved 10% efficiency using React.');
    expect(() => validateAiResult(result, request)).toThrow();
    result.proposals[0].factIds.push('uncited'); result.proposals[0].factRefs = syntheticFactRefs(request, result.proposals[0].factIds);
    expect(validateAiResult(result, request).proposals).toHaveLength(1);
  });
  it('flags unsupported capitalized words and strength/credential language against cited facts', async () => {
    const request = requestFor(await syntheticApplication()), proposal = syntheticResult(request).proposals[0];
    expect(aiProposalFindings(proposal, request)).toEqual([]);
    proposal.afterText = 'Led expert Kubernetes teams at Acme; certified MBA.';
    const findings = aiProposalFindings(proposal, request);
    expect(findings.find(item => item.code === 'introduced_terms')?.terms).toEqual(expect.arrayContaining(['Kubernetes', 'Acme']));
    expect(findings.find(item => item.code === 'strengthened_claim')?.terms).toEqual(expect.arrayContaining(['Led', 'expert', 'certified', 'MBA']));
  });
});

describe('fixed same-origin AI client (injected synthetic transport)', () => {
  it('status reads locally and verification posts only an empty object', async () => {
    const syntheticFetch = vi.fn<typeof fetch>(async () => json(syntheticStatus)), client = createAiClient(syntheticFetch, testEndpoint);
    await client.status(); await client.verify();
    expect(syntheticFetch.mock.calls.map(([route, options]) => [route, options?.method, options?.body])).toEqual([
      ['/api/ai/status', 'GET', undefined], ['/api/ai/verify', 'POST', '{}'],
    ]);
  });
  it.each(['disabled', 'unverified', 'consent', 'missing-key', 'unsupported-model'] as const)('does not make a generation request for gate failure: %s', async failure => {
    const request = requestFor(await syntheticApplication()), status = { ...syntheticStatus };
    if (failure === 'disabled') status.paidRequestsEnabled = false;
    if (failure === 'unverified') { status.accountModelVerified = false; status.verification = 'unverified'; }
    if (failure === 'missing-key') { status.keyConfigured = false; status.accountModelVerified = false; status.verification = 'unverified'; }
    if (failure === 'unsupported-model') { status.supportedModel = false; status.accountModelVerified = false; status.verification = 'unverified'; }
    const syntheticFetch = vi.fn<typeof fetch>(), client = createAiClient(syntheticFetch, testEndpoint);
    await expect(client.tailor(request, { status, consentHash: failure === 'consent' ? '' : request.consent.contextHash })).rejects.toBeInstanceOf(AiClientError);
    expect(syntheticFetch).not.toHaveBeenCalled(); expect(canSendAiRequest(status)).toBe(failure === 'consent');
  });
  it('transfers only the validated DTO once and never automatically retries', async () => {
    const request = requestFor(await syntheticApplication());
    const syntheticFetch = vi.fn<typeof fetch>(async () => json({ error: { code: 'provider_rate_limit', message: 'Unsafe provider body text' } }, 429));
    await expect(createAiClient(syntheticFetch, testEndpoint).tailor(request, { status: syntheticStatus, consentHash: request.consent.contextHash })).rejects.toThrowError(/rate limited/);
    expect(syntheticFetch).toHaveBeenCalledTimes(1);
    expect(syntheticFetch.mock.calls[0][0]).toBe('/api/ai/tailor');
    expect(JSON.parse(String(syntheticFetch.mock.calls[0][1]?.body))).toEqual(request);
  });
  it('suppresses arbitrary error bodies and malformed or oversized responses', async () => {
    const request = requestFor(await syntheticApplication());
    for (const [response, expected] of [
      // A gateway error means the service is offline; its body is never shown.
      [json({ error: { code: 'untrusted-code', message: 'Unsafe leaked document text' } }, 502), /AI tailoring is offline/],
      [new Response('<h1>bad gateway</h1>', { status: 502, headers: { 'Content-Type': 'text/html' } }), /AI tailoring is offline/],
      [json({ error: { code: 'untrusted-code', message: 'Unsafe leaked document text' } }, 400), /failed validation/],
      [new Response('<h1>server html</h1>', { headers: { 'Content-Type': 'text/html' } }), /failed validation/],
      [json({ ...syntheticResult(request), forbidden: true }), /failed validation/],
      [new Response('x'.repeat(512 * 1024 + 1), { headers: { 'Content-Type': 'application/json' } }), /failed validation/],
    ] as const) {
      const syntheticFetch = vi.fn<typeof fetch>(async () => response);
      const failure = createAiClient(syntheticFetch, testEndpoint).tailor(request, { status: syntheticStatus, consentHash: request.consent.contextHash });
      await expect(failure).rejects.toThrowError(expected);
      await expect(failure).rejects.not.toThrowError(/Unsafe/);
    }
    expect(aiErrorMessage(new Error('Unsafe leaked document text'))).not.toContain('Unsafe');
  });
});

describe('reviewed paragraph formatting (synthetic; no provider)', () => {
  it('preserves inherited bold and italic for a uniformly formatted paragraph', async () => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    region.style.fontWeight = 700; region.style.italic = true;
    project.draft.blocks[0].runs = [{ text: 'Built React dashboards ' }, { text: 'using TypeScript.' }];
    Object.assign(project, await approveTemplate(project, []));
    const before = structuredClone(project), request = requestFor(project), result = syntheticResult(request);
    const runs = reviewedAiRuns(project, request, result, result.proposals[0]);
    expect(runs).toEqual([{ text: result.proposals[0].afterText, bold: true, italic: true, underline: false, sourceFactIds: result.proposals[0].factIds }]);
    expectProjectUnchanged(project, before); expect(aiFormattingIssue(project, project.draft.blocks[0].id)).toBeNull();
  });
  it('preserves explicit false overrides, underline and the exact existing uniform hyperlink', async () => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    region.style.fontWeight = 700; region.style.italic = true;
    const href = 'https://portfolio.example/selected-page';
    project.draft.blocks[0].runs = [{ text: 'Built React dashboards ', bold: false, italic: false, underline: true, href }, { text: 'using TypeScript.', bold: false, italic: false, underline: true, href }];
    Object.assign(project, await approveTemplate(project, []));
    const before = structuredClone(project), request = requestFor(project), result = syntheticResult(request);
    const runs = reviewedAiRuns(project, request, result, result.proposals[0]);
    expect(runs).toEqual([{ text: result.proposals[0].afterText, bold: false, italic: false, underline: true, href, sourceFactIds: result.proposals[0].factIds }]);
    expect(JSON.stringify(request)).not.toContain(href);
    const edited = editBlock(project, result.proposals[0].blockId, runs);
    expect(edited.draft.blocks[0].runs[0]).toMatchObject({ bold: false, italic: false, underline: true, href });
    expect(edited.template).toEqual(before.template); expectProjectUnchanged(project, before);
    expect(runs[0].sourceFactIds).not.toBe(result.proposals[0].factIds);
  });
  it('accepts equivalent inherited and explicit marks, without inventing a link', async () => {
    const project = await syntheticApplication();
    project.draft.blocks[0].runs = [{ text: 'Built React dashboards ' }, { text: 'using TypeScript.', bold: false, italic: false, underline: false }];
    const request = requestFor(project), result = syntheticResult(request), runs = reviewedAiRuns(project, request, result, result.proposals[0]);
    expect(runs[0]).toMatchObject({ bold: false, italic: false, underline: false }); expect(runs[0].href).toBeUndefined();
  });
  it.each(['bold', 'italic', 'underline', 'different-links', 'linked-and-unlinked', 'unsafe-link'] as const)('refuses unmappable mixed formatting without changing the project: %s', async mismatch => {
    const project = await syntheticApplication();
    project.draft.blocks[0].runs = [{ text: 'Built React dashboards ' }, { text: 'using TypeScript.' }];
    const [first, second] = project.draft.blocks[0].runs;
    if (mismatch === 'bold') { first.bold = true; second.bold = false; }
    if (mismatch === 'italic') { first.italic = true; second.italic = false; }
    if (mismatch === 'underline') { first.underline = true; second.underline = false; }
    if (mismatch === 'different-links') { first.href = 'https://first.example/'; second.href = 'https://second.example/'; }
    if (mismatch === 'linked-and-unlinked') first.href = 'https://first.example/';
    if (mismatch === 'unsafe-link') { first.href = 'javascript:alert(1)'; second.href = first.href; }
    const before = structuredClone(project);
    expect(() => requestFor(project)).toThrowError(/Apply the reviewed wording on the canvas/);
    expect(aiFormattingIssue(project, project.draft.blocks[0].id)).toContain('plain-text proposal');
    expectProjectUnchanged(project, before);
  });
  it('refuses conflicting region inheritance for the same content block', async () => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    project.template.pages[0].regions.push({ ...structuredClone(region), id: 'second-region', style: { ...region.style, fontWeight: 700 } });
    Object.assign(project, await approveTemplate(project, []));
    expect(() => requestFor(project)).toThrow(AiClientError);
  });
  it('refuses an empty target before a paid request', async () => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    region.style.fontWeight = 700; region.style.italic = true;
    project.draft.blocks[0].runs = [{ text: '', bold: false, href: 'https://unused.example/' }];
    Object.assign(project, await approveTemplate(project, []));
    expect(() => requestFor(project)).toThrowError(/nonempty paragraph/);
  });
});

describe('grounded paragraph constraints and canonical font fit (synthetic; no provider)', () => {
  it('derives exact unchanged box/font constraints and all required current sources', async () => {
    const project = await syntheticApplication(), request = requestFor(project), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    expect(request.blocks[0].requiredFactIds).toEqual([project.facts[0].id]);
    expect(request.blocks[0].layoutBudget).toEqual({ version: 1, regionId: region.id, widthPt: 500, heightPt: 30, fontFamily: 'sans', fontSizePt: 10, fontWeight: 400, italic: false, lineHeightPt: 14, maxLines: 2, maxCharacters: project.facts[0].text.length });
    expect(serverRequestSchema.safeParse(request).success).toBe(true); expect(serverConsentHash(request)).toBe(request.consent.contextHash);
    const edited = editBlock(project, project.draft.blocks[0].id, [{ text: 'Built React dashboards.' }]);
    expect(aiLayoutBudget(edited, edited.draft.blocks[0].id).maxCharacters).toBe('Built React dashboards.'.length);
  });
  it('requires explicit selection of current target sources without automatically adding facts', async () => {
    const project = await syntheticProfileApplication(), before = structuredClone(project);
    expect(() => prepareAiRequest(project, ['figma-detail'], [project.draft.blocks[0].id])).toThrowError(/Select every listed fact/);
    expect(profileRequest(project).facts.map(fact => fact.id)).toEqual([project.facts[0].id, 'figma-detail']); expectProjectUnchanged(project, before);
    project.draft.blocks[0].sourceFactIds.push('missing-current-source');
    expect(() => profileRequest(project)).toThrowError(/missing, excluded, or unconfirmed/);
  });
  it('rejects unavailable, duplicate or excessive target references before a paid request', async () => {
    const project = await syntheticApplication(); project.draft.blocks[0].sourceFactIds.push(project.facts[0].id);
    expect(() => requestFor(project)).toThrow();
    project.draft.blocks[0].sourceFactIds = [project.facts[0].id];
    project.facts.push(...Array.from({ length: 20 }, (_, index) => ({ ...project.facts[0], id: `extra-required-${index}` })));
    project.draft.blocks[0].sourceFactIds = project.facts.map(fact => fact.id);
    expect(() => prepareAiRequest(project, project.facts.map(fact => fact.id), [project.draft.blocks[0].id])).toThrowError(/supporting facts/);
  });
  it.each(['missing-approval', 'changed-template', 'changed-baseline', 'empty-baseline', 'too-many-lines'] as const)('fails closed before sending when the approved target cannot be budgeted: %s', async invalid => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    if (invalid === 'missing-approval') project.approval = null;
    if (invalid === 'changed-template') region.bounds.width++;
    if (invalid === 'changed-baseline') project.baseline.blocks[0].runs[0].text += ' changed';
    if (invalid === 'empty-baseline') { project.baseline.blocks[0].runs[0].text = ''; Object.assign(project, await approveTemplate(project, [])); }
    if (invalid === 'too-many-lines') { region.bounds.height = 200; region.style.lineHeight = 1; Object.assign(project, await approveTemplate(project, [])); }
    expect(() => requestFor(project)).toThrowError(/approved original text/);
  });
  it.each(['wrong-line-count', 'growth-cap', 'missing-required-source', 'duplicate-required-source', 'invalid-point', 'unknown-budget-field'] as const)('rejects malformed bound constraints locally and at the backend: %s', async invalid => {
    const request = structuredClone(requestFor(await syntheticApplication())), block = request.blocks[0];
    if (invalid === 'wrong-line-count') block.layoutBudget.maxLines++;
    if (invalid === 'growth-cap') block.layoutBudget.maxCharacters = block.text.length + 1;
    if (invalid === 'missing-required-source') block.requiredFactIds = ['unknown'];
    if (invalid === 'duplicate-required-source') block.requiredFactIds.push(block.requiredFactIds[0]);
    if (invalid === 'invalid-point') block.layoutBudget.widthPt = 0;
    if (invalid === 'unknown-budget-field') Object.assign(block.layoutBudget, { shrink: true });
    request.consent.contextHash = aiConsentHash(request);
    expect(() => validateAiRequest(request)).toThrow(); expect(serverRequestSchema.safeParse(request).success).toBe(false);
  });
  it('rejects complete responses that omit required citations or exceed hard character/newline bounds', async () => {
    const project = await syntheticProfileApplication(), request = profileRequest(project);
    const result = syntheticProfileResult(request, project.facts[0].text.replace('clear', 'Figma'));
    result.proposals[0].factIds = ['figma-detail']; result.proposals[0].factRefs = syntheticFactRefs(request, ['figma-detail']);
    expect(() => validateAiResult(result, request)).toThrowError(/omitted a required source/);
    result.proposals[0].factIds = request.facts.map(fact => fact.id); result.proposals[0].factRefs = syntheticFactRefs(request, result.proposals[0].factIds);
    setAfterText(result, 'x'.repeat(76)); expect(() => validateAiResult(result, request)).toThrowError(/paragraph constraints/);
    setAfterText(result, 'Product designer\naccessible interfaces'); expect(() => validateAiResult(result, request)).toThrowError(/paragraph constraints/);
  });
  it('rejects equal-length wider glyphs despite passing the textual budget, without mutating the project', async () => {
    const project = await syntheticProfileApplication(), request = profileRequest(project), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    const replacement = project.facts[0].text.replace('clear', 'Figma'), before = structuredClone(project), result = syntheticProfileResult(request, replacement);
    expect(project.facts[0].text).toHaveLength(75); expect(replacement).toHaveLength(75);
    const font = await getFontMetrics(region.style);
    expect(font.measure(project.facts[0].text, 10).width).toBeCloseTo(384.8095703125, 7);
    expect(font.measure(replacement, 10).width).toBeCloseTo(390.888671875, 7);
    expect(validateAiResult(result, request)).toEqual(result);
    await expect(probeAiCandidate(project, request, result, result.proposals[0])).rejects.toThrowError(/does not fit/);
    expectProjectUnchanged(project, before);
  });
  it('fits the architect-authored 68-character diagnostic without treating it as an AI output oracle', async () => {
    const project = await syntheticProfileApplication(), request = profileRequest(project), before = structuredClone(project);
    const diagnostic = 'Product designer for accessible interfaces and Figma design systems.';
    expect(diagnostic).toHaveLength(68);
    const result = syntheticProfileResult(request, diagnostic), layout = await probeAiCandidate(project, request, result, syntheticProfileResult(request, diagnostic).proposals[0]);
    expect(layout.overflows).toEqual([]); expect(layout.regions[0].lines).toHaveLength(1); expect(layout.regions[0].lines[0].width).toBeCloseTo(349.8193359375, 7); expectProjectUnchanged(project, before);
  });
  it('checks the whole candidate, including an overflowing unselected paragraph', async () => {
    const project = await syntheticProfileApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    project.template.pages[0].regions.push({ ...structuredClone(region), id: 'unselected-region', contentId: 'unselected-block', bounds: { x: 50, y: 150, width: 20, height: 12.5 } });
    const otherBlock = { id: 'unselected-block', runs: [{ text: 'Unselected paragraph that cannot fit.' }], sourceFactIds: [project.facts[0].id] };
    project.baseline.blocks.push(structuredClone(otherBlock)); project.draft.blocks.push(structuredClone(otherBlock));
    Object.assign(project, await approveTemplate(project, []));
    const request = profileRequest(project), result = syntheticProfileResult(request, 'Product designer for accessible interfaces and Figma design systems.');
    await expect(probeAiCandidate(project, request, result, result.proposals[0])).rejects.toThrowError(/layout problem/);
  });
  it('enforces the reviewed line count even when physical glyph ink happens to fit', async () => {
    const project = await syntheticApplication(), region = project.template.pages[0].regions[0];
    if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    region.bounds.width = 40; region.bounds.height = 40; region.style.lineHeight = 24;
    project.facts[0].text = 'AAAA CCCC.'; project.baseline.blocks[0].runs[0].text = project.facts[0].text; project.draft.blocks[0].runs[0].text = project.facts[0].text;
    Object.assign(project, await approveTemplate(project, []));
    const request = requestFor(project), result = syntheticResult(request); setAfterText(result, 'AAAA BBBB.');
    const candidate = editBlock(structuredClone(project), result.proposals[0].blockId, reviewedAiRuns(project, request, result, result.proposals[0]));
    const layout = await computeLayout(candidate.template, candidate.draft);
    expect(layout.overflows).toEqual([]); expect(layout.regions[0].lines).toHaveLength(2); expect(request.blocks[0].layoutBudget.maxLines).toBe(1);
    await expect(probeAiCandidate(project, request, result, result.proposals[0])).rejects.toThrowError(/does not fit/);
  });
  it('fails safely if the canonical bundled font cannot be loaded', async () => {
    const project = await syntheticApplication(), request = requestFor(project), result = syntheticResult(request), before = structuredClone(project);
    const restore = setFontLoader(async () => { throw new Error('Synthetic local font load failure'); });
    try { await expect(probeAiCandidate(project, request, result, result.proposals[0])).rejects.toThrowError(/bundled fonts/); }
    finally { restore(); }
    expectProjectUnchanged(project, before);
  });
});

describe('applicant proposal controls (synthetic UI transport; no provider)', () => {
  let root: Root | undefined, host: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  });
  afterEach(async () => { await act(async () => root?.unmount()); host.remove(); });
  async function render(project: Project, onAccept = vi.fn()) {
    await act(async () => { root!.render(createElement(AiTailoringPanel, { project, selectedBlockId: project.draft.blocks[0].id, onAccept })); });
    return onAccept;
  }
  function button(text: string): HTMLButtonElement {
    const found = [...host.querySelectorAll('button')].find(item => item.textContent?.includes(text));
    if (!found) throw new Error(`Synthetic UI button missing: ${text}`);
    return found;
  }
  async function click(element: HTMLElement) { await act(async () => element.click()); }
  async function prepareAndSend() {
    await click(host.querySelector<HTMLInputElement>('.ai-selection input')!);
    await click(button('Review selected request'));
    expect(button('Send paid request').disabled).toBe(true);
    await click(host.querySelector<HTMLInputElement>('.ai-request-review input')!);
    await click(button('Send paid request'));
  }
  it('never applies returned proposals automatically; rejection leaves the draft untouched', async () => {
    const project = await syntheticApplication(), before = structuredClone(project), accepted = vi.fn();
    const syntheticFetch = vi.fn<typeof fetch>(async (route, options) => route === '/api/ai/status' ? json(syntheticStatus) : json(syntheticResult(JSON.parse(String(options?.body)))));
    vi.stubGlobal('fetch', syntheticFetch);
    await render(project, accepted); await prepareAndSend();
    expect(host.textContent).toContain('session-only'); expect(host.textContent).toContain(project.facts[0].text);
    expect(accepted).not.toHaveBeenCalled(); expectProjectUnchanged(project, before);
    expect(button('Accept wording').disabled).toBe(true);
    await click(button('Reject proposal'));
    expect(accepted).not.toHaveBeenCalled(); expectProjectUnchanged(project, before);
  });
  it('requires separate accuracy and flagged-source checks before an explicit accept', async () => {
    const project = await syntheticApplication(), accepted = vi.fn();
    const syntheticFetch = vi.fn<typeof fetch>(async (route, options) => {
      if (route === '/api/ai/status') return json(syntheticStatus);
      const result = syntheticResult(JSON.parse(String(options?.body))); setAfterText(result, 'Led React dashboards for Acme.');
      return json(result);
    });
    vi.stubGlobal('fetch', syntheticFetch);
    await render(project, accepted); await prepareAndSend();
    const checks = host.querySelectorAll<HTMLInputElement>('.ai-proposal input'); expect(checks).toHaveLength(2);
    await click(checks[0]); expect(button('Accept wording').disabled).toBe(true);
    await click(checks[1]); expect(button('Accept wording').disabled).toBe(false);
    expect(accepted).not.toHaveBeenCalled(); await act(async () => { button('Accept wording').click(); await vi.waitFor(() => expect(accepted).toHaveBeenCalledTimes(1)); });
    expect(accepted).toHaveBeenCalledTimes(1); expect(accepted.mock.calls[0][2].afterText).toBe('Led React dashboards for Acme.');
  });
  it('shows box/source constraints and keeps glyph-overflow wording readable while refusing acceptance', async () => {
    const project = await syntheticProfileApplication(), accepted = vi.fn(), before = structuredClone(project);
    const region = project.template.pages[0].regions[0]; if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    await getFontMetrics(region.style);
    const syntheticFetch = vi.fn<typeof fetch>(async (route, options) => route === '/api/ai/status' ? json(syntheticStatus) : json(syntheticProfileResult(JSON.parse(String(options?.body)), project.facts[0].text.replace('clear', 'Figma'))));
    vi.stubGlobal('fetch', syntheticFetch);
    await render(project, accepted);
    await click(host.querySelectorAll<HTMLInputElement>('.ai-selection input')[0]); await click(host.querySelectorAll<HTMLInputElement>('.ai-selection input')[1]);
    await click(button('Review selected request'));
    expect(host.querySelector('.ai-request-review')?.textContent).toContain('75 characters and 1 line');
    expect(host.querySelector('.ai-request-review')?.textContent).toContain('equal-length words can still be wider');
    expect(host.querySelector('.ai-request-review')?.textContent).toContain('required current facts');
    await click(host.querySelector<HTMLInputElement>('.ai-request-review input')!); await click(button('Send paid request'));
    await click(host.querySelector<HTMLInputElement>('.ai-proposal input')!);
    await click(button('Accept wording')); expect(host.querySelector('.ai-proposal')?.textContent).toContain('does not fit');
    expect(host.querySelector('.ai-proposal')?.textContent).toContain(project.facts[0].text.replace('clear', 'Figma'));
    expect(button('Accept wording').disabled).toBe(true); expect(accepted).not.toHaveBeenCalled(); expectProjectUnchanged(project, before);
    expect(syntheticFetch.mock.calls.filter(([route]) => route === '/api/ai/tailor')).toHaveLength(1);
  });
  it('rechecks the latest application after asynchronous canonical font loading before any callback', async () => {
    const project = await syntheticApplication(), accepted = vi.fn();
    const region = project.template.pages[0].regions[0]; if (region.kind !== 'text') throw new Error('Synthetic fixture text region missing');
    let releaseFont: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { releaseFont = resolve; });
    const restore = setFontLoader(async file => { await gate; return new Uint8Array(await readFile(resolve('public/fonts', file))); });
    try {
      vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (route, options) => route === '/api/ai/status' ? json(syntheticStatus) : json(syntheticResult(JSON.parse(String(options?.body))))));
      await render(project, accepted); await prepareAndSend(); await click(host.querySelector<HTMLInputElement>('.ai-proposal input')!);
      await click(button('Accept wording')); expect(host.textContent).toContain('Checking the exact proposal fit'); expect(accepted).not.toHaveBeenCalled();
      await render({ ...project, revision: project.revision + 1 }, accepted);
      await act(async () => { releaseFont!(); await getFontMetrics(region.style); await Promise.resolve(); await Promise.resolve(); });
      expect(host.querySelector('.ai-error')?.textContent).toContain('application changed');
      expect(accepted).not.toHaveBeenCalled(); expect(button('Accept wording').disabled).toBe(true);
    } finally { releaseFont?.(); restore(); }
  });
  it('refuses mixed styles before consent with a canvas remedy and no generation', async () => {
    const project = await syntheticApplication(), accepted = vi.fn();
    project.draft.blocks[0].runs = [{ text: 'Built React dashboards ', bold: true }, { text: 'using TypeScript.', bold: false }];
    const before = structuredClone(project);
    const syntheticFetch = vi.fn<typeof fetch>(async () => json(syntheticStatus)); vi.stubGlobal('fetch', syntheticFetch);
    await render(project, accepted);
    await click(host.querySelector<HTMLInputElement>('.ai-selection input')!); await click(button('Review selected request'));
    expect(host.querySelector('.ai-request-review')).toBeNull(); expect(host.textContent).toContain('Apply the reviewed wording on the canvas');
    expect(syntheticFetch).toHaveBeenCalledTimes(1);
    expect(accepted).not.toHaveBeenCalled(); expectProjectUnchanged(project, before);
  });
  it('aborts a pending generation on revision change and ignores a late synthetic response', async () => {
    const project = await syntheticApplication(), accepted = vi.fn();
    let resolveTailor: ((response: Response) => void) | undefined, sent: AiRequest | undefined, signal: AbortSignal | null | undefined;
    const syntheticFetch = vi.fn<typeof fetch>(async (route, options) => {
      if (route === '/api/ai/status') return json(syntheticStatus);
      sent = JSON.parse(String(options?.body)); signal = options?.signal;
      return new Promise<Response>(resolve => { resolveTailor = resolve; });
    });
    vi.stubGlobal('fetch', syntheticFetch);
    await render(project, accepted); await prepareAndSend();
    expect(host.textContent).toContain('Waiting for OpenAI');
    await render({ ...project, revision: project.revision + 1 }, accepted); expect(signal?.aborted).toBe(true);
    await act(async () => resolveTailor!(json(syntheticResult(sent!))));
    expect(host.querySelector('.ai-proposals')).toBeNull(); expect(accepted).not.toHaveBeenCalled();
  });
  it('keeps returned stale proposals readable while disabling acceptance', async () => {
    const project = await syntheticApplication(), accepted = vi.fn();
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (route, options) => route === '/api/ai/status' ? json(syntheticStatus) : json(syntheticResult(JSON.parse(String(options?.body))))));
    await render(project, accepted); await prepareAndSend();
    await render(editBlock(project, project.draft.blocks[0].id, [{ text: 'New manual wording' }]), accepted);
    expect(host.textContent).toContain('remain readable'); expect(host.textContent).toContain('Built TypeScript dashboards using React.');
    expect(button('Accept wording').disabled).toBe(true); expect(accepted).not.toHaveBeenCalled();
  });
  it('shows the application entry for reusable resumes without any provider verification', async () => {
    const syntheticFetch = vi.fn<typeof fetch>(); vi.stubGlobal('fetch', syntheticFetch);
    await render(await fixtureProject()); expect(host.textContent).toContain('Start an application'); expect(syntheticFetch).not.toHaveBeenCalled();
    expect(host.querySelector('input[type="password"]')).toBeNull();
  });
  it('only checks status on opening and sends nothing else until asked', async () => {
    const project = await syntheticApplication();
    const syntheticFetch = vi.fn<typeof fetch>(async () => json(syntheticStatus)); vi.stubGlobal('fetch', syntheticFetch);
    await render(project);
    expect(syntheticFetch.mock.calls.map(([route]) => route)).toEqual(['/api/ai/status']);
    await click(button('Check AI status'));
    expect(syntheticFetch.mock.calls.map(([route]) => route)).toEqual(['/api/ai/status', '/api/ai/status']);
    expect(host.textContent).toContain('No OpenAI call was made');
  });
  it('clears reviewed consent after a job change and never sends when paid requests are disabled', async () => {
    const project = await syntheticApplication();
    const syntheticFetch = vi.fn<typeof fetch>(async () => json({ ...syntheticStatus, paidRequestsEnabled: false })); vi.stubGlobal('fetch', syntheticFetch);
    await render(project);
    await click(host.querySelector<HTMLInputElement>('.ai-selection input')!); await click(button('Review selected request'));
    await click(host.querySelector<HTMLInputElement>('.ai-request-review input')!);
    expect(button('Send paid request').disabled).toBe(true); expect(host.textContent).toContain('Paid AI requests are disabled');
    await render({ ...project, job: { ...project.job, description: 'Changed fictional role' } });
    expect(host.querySelector('.ai-request-review')).toBeNull(); expect(syntheticFetch).toHaveBeenCalledTimes(1);
  });
  it('shows the selected retained source quotation before consent without exposing unselected quotes', async () => {
    const project = await syntheticApplication(), text = 'Built accessible React interfaces.', quote = 'Selected original supporting quotation about accessible interfaces.';
    project.facts.push({ id: 'selected-memory-fact', text, kind: 'careerNote', confirmed: true, locator: 'Supporting page 2' });
    project.memorySnapshot = { id: 'selected-snapshot', templateGroupId: project.workspace.templateGroupId, memoryRevision: 2, memoryHash: 'a'.repeat(64), createdAt: project.createdAt, sourceResumeId: 'source-resume', sourceResumeRevision: 1, eligibleFactIds: [project.facts[0].id, 'selected-memory-fact'], evidence: [{ factId: 'selected-memory-fact', assertionId: 'selected-assertion', assertionVersion: 2, provenance: { sourceId: 'selected-source', sourceKind: 'typed', sourceName: 'Applicant context', sourceHash: hashTextSync(quote), originalQuote: quote, quoteHash: hashTextSync(quote), locator: 'Supporting page 2' }, confirmation: { actor: 'applicant', version: 2, textHash: hashTextSync(text), confirmedAt: '2026-10-04T12:00:00.000Z' } }, { factId: 'hidden-memory-fact', assertionId: 'hidden-assertion', assertionVersion: 1, provenance: { sourceId: 'hidden-source', sourceKind: 'typed', sourceName: 'Hidden source', sourceHash: hashTextSync('Unselected original quotation'), originalQuote: 'Unselected original quotation', quoteHash: hashTextSync('Unselected original quotation'), locator: 'Hidden locator' }, confirmation: null }], baselineReviewBlocks: [] };
    const syntheticFetch = vi.fn<typeof fetch>(async () => json(syntheticStatus)); vi.stubGlobal('fetch', syntheticFetch);
    await render(project);
    await click(host.querySelectorAll<HTMLInputElement>('.ai-selection input')[0]); await click(host.querySelectorAll<HTMLInputElement>('.ai-selection input')[1]); await click(button('Review selected request'));
    const preview = host.querySelector('.ai-request-review')!;
    expect(preview.textContent).toContain(quote); expect(preview.textContent).toContain('Supporting page 2');
    expect(preview.textContent).toContain('2026-10-04T12:00:00.000Z'); expect(preview.textContent).not.toContain('Unselected original quotation');
    expect(syntheticFetch).toHaveBeenCalledTimes(1); expect(button('Send paid request').disabled).toBe(true);
  });
  it('explicitly aborts generation on page navigation and retains no late proposals', async () => {
    const project = await syntheticApplication();
    let signal: AbortSignal | null | undefined;
    const syntheticFetch = vi.fn<typeof fetch>(async (route, options) => {
      if (route === '/api/ai/status') return json(syntheticStatus);
      signal = options?.signal; return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', syntheticFetch);
    await render(project); await prepareAndSend();
    await act(async () => window.dispatchEvent(new Event('pagehide')));
    expect(signal?.aborted).toBe(true); expect(host.textContent).toContain('stopped when leaving this page');
    expect(host.textContent).not.toContain('Waiting for OpenAI');
  });
});

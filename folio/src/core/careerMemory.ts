import { FolioError } from './errors';
import { hashJson, hashTextSync, newId, sha256, unresolvedMemoryBaselineBlocks, workspaceOf } from './model';
import type { AssertionVersion, CareerMemory, Fact, MemoryProvenance, MemorySnapshot, MemorySource, MemorySourceKind, Project } from './model';
import { memorySourceSchema, validateProject } from './schema';

export const MEMORY_LIMITS = { files: 5, fileBytes: 10 * 1024 * 1024, txtBytes: 1024 * 1024, combinedBytes: 25 * 1024 * 1024, sourceText: 100000, combinedText: 200000, itemText: 10000, segments: 2000, assertions: 200, versions: 20, assertionText: 200000, metadataBytes: 2 * 1024 * 1024 } as const;
export interface CareerMemoryView {
  templateGroupId: string; revision: number; resumeFactRefs: string[];
  resumeFacts: { fact: Fact; excluded: boolean; superseded: boolean; eligible: boolean; eligibleForFuture: boolean; status: 'available' | 'excluded' | 'superseded' | 'pendingCorrection' }[];
  assertions: (AssertionVersion & { eligibleForFutureApplications: boolean; eligibleForFuture: boolean; excluded: boolean; superseded: boolean; versionsCount: number; draftText?: string; eligible: boolean })[];
  sources: MemorySource[]; draftText: string; linkedInReference: CareerMemory['linkedInReference']; onboarding: CareerMemory['onboarding'];
}
const now = () => new Date().toISOString();
const textHash = (text: string) => sha256(new TextEncoder().encode(text));
function fail(code: string, message: string): never { throw new FolioError(code, message); }
function requireResume(project: Project): void { if (workspaceOf(project).kind !== 'resume') fail('RESUME_REQUIRED', 'Open the reusable resume to edit Career Memory.'); }
export function initCareerMemory(project: Project): Project {
  requireResume(project);
  if (project.careerMemory) return project;
  const timestamp = now();
  return validateProject({ ...project, revision: project.revision + 1, updatedAt: timestamp, careerMemory: { schemaVersion: 1, templateGroupId: workspaceOf(project).templateGroupId, resumeProjectId: project.id, resumeSourceId: project.source.id, resumeSourceHash: project.source.sha256, revision: 1, createdAt: timestamp, updatedAt: timestamp, sources: [], assertions: [], assertionDrafts: [], excludedResumeFactIds: [], draftText: '', linkedInReference: null, onboarding: 'contextPending' } });
}
function memoryAt(project: Project, expected: number): CareerMemory {
  requireResume(project);
  const memory = project.careerMemory;
  if (!memory) fail('MEMORY_MISSING', 'This resume has no Career Memory yet.');
  if (memory.revision !== expected) fail('MEMORY_STALE', 'Career Memory changed. Review the current version before applying this action.');
  return memory;
}
function change(project: Project, memory: CareerMemory, patch: Partial<CareerMemory>): Project {
  const timestamp = now();
  return validateProject({ ...project, revision: project.revision + 1, updatedAt: timestamp, careerMemory: { ...memory, ...patch, revision: memory.revision + 1, updatedAt: timestamp } });
}
function current(memory: CareerMemory, id: string, version?: number) {
  const assertion = memory.assertions.find(item => item.id === id);
  if (!assertion) fail('ASSERTION_MISSING', 'This detail is no longer available.');
  if (version !== undefined && assertion.currentVersion !== version) fail('ASSERTION_STALE', 'This detail was edited. Review its current wording before continuing.');
  return { assertion, value: assertion.versions.find(item => item.version === assertion.currentVersion)! };
}
function superseded(memory: CareerMemory): { resume: Set<string>; assertions: Set<string> } {
  const resume = new Set<string>(), assertions = new Set<string>();
  for (const assertion of memory.assertions) {
    // Even an unconfirmed correction suspends its predecessor.
    const replacement = assertion.versions.find(item => item.version === assertion.currentVersion)!;
    if (replacement.supersedes?.resumeFactId) resume.add(replacement.supersedes.resumeFactId);
    if (replacement.supersedes?.assertionId) assertions.add(replacement.supersedes.assertionId);
  }
  return { resume, assertions };
}
export function memoryView(project: Project): CareerMemoryView {
  const memory = project.careerMemory ?? initCareerMemory(project).careerMemory!;
  const replaced = superseded(memory);
  const resumeFacts = project.facts.filter(fact => fact.kind === 'resume').map(fact => {
    const excluded = memory.excludedResumeFactIds.includes(fact.id), superseded = replaced.resume.has(fact.id);
    const correction = memory.assertions.find(assertion => assertion.versions.find(value => value.version === assertion.currentVersion)?.supersedes?.resumeFactId === fact.id);
    const correctionVersion = correction?.versions.find(value => value.version === correction.currentVersion);
    const pending = correction && (!correctionVersion?.confirmation || memory.assertionDrafts.some(draft => draft.assertionId === correction.id));
    return { fact, excluded, superseded, eligible: !excluded && !superseded, eligibleForFuture: !excluded, status: excluded ? 'excluded' as const : superseded ? pending ? 'pendingCorrection' as const : 'superseded' as const : 'available' as const };
  });
  return { templateGroupId: memory.templateGroupId, revision: memory.revision, resumeFactRefs: resumeFacts.map(row => row.fact.id), resumeFacts, assertions: memory.assertions.map(assertion => { const value = assertion.versions.find(item => item.version === assertion.currentVersion)!; return { ...value, eligibleForFutureApplications: assertion.eligibleForFuture, eligibleForFuture: assertion.eligibleForFuture, excluded: !assertion.eligibleForFuture, superseded: replaced.assertions.has(assertion.id), versionsCount: assertion.versions.length, draftText: memory.assertionDrafts.find(draft => draft.assertionId === assertion.id)?.text, eligible: assertion.eligibleForFuture && !!value.confirmation && !replaced.assertions.has(assertion.id) && !memory.assertionDrafts.some(draft => draft.assertionId === assertion.id) }; }), sources: memory.sources, draftText: memory.draftText, linkedInReference: memory.linkedInReference, onboarding: memory.onboarding };
}
export type EvidenceScope = 'draft' | 'futureApplication';
/** Current-document evidence includes its local confirmations; future jobs use only canonical memory. */
export function eligibleEvidence(project: Project, scope: EvidenceScope = 'draft'): Fact[] {
  if (project.memorySnapshot) {
    const pinned = new Set(project.memorySnapshot.eligibleFactIds), snapshotOwned = new Set(project.memorySnapshot.evidence.map(item => item.factId));
    return project.facts.filter(fact => pinned.has(fact.id) || scope === 'draft' && fact.kind !== 'resume' && fact.confirmed && !snapshotOwned.has(fact.id));
  }
  if (!project.careerMemory) return project.facts.filter(fact => fact.kind === 'resume' || scope === 'draft' && fact.confirmed);
  const view = memoryView(project);
  const extras = view.assertions.filter(item => item.eligible).map(item => ({ id: item.factId, text: item.text, kind: 'careerNote' as const, confirmed: true, locator: item.provenance.locator }));
  const memoryOwned = new Set(project.careerMemory.assertions.flatMap(assertion => assertion.versions.map(version => version.factId)));
  const local = scope === 'draft' ? project.facts.filter(fact => fact.kind !== 'resume' && fact.confirmed && !memoryOwned.has(fact.id)) : [];
  return [...view.resumeFacts.filter(item => item.eligible).map(item => item.fact), ...extras, ...local];
}
export function setMemoryDraft(project: Project, text: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision);
  if (text.length > MEMORY_LIMITS.itemText) fail('MEMORY_TEXT_TOO_LONG', 'Keep optional context below 10,000 characters.');
  return text === memory.draftText ? project : change(project, memory, { draftText: text });
}
export function saveLinkedInReference(project: Project, value: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision); let reference: CareerMemory['linkedInReference'] = null;
  if (value.trim()) {
    let url: URL; try { url = new URL(value.trim()); } catch { return fail('LINKEDIN_INVALID', 'Enter a valid HTTPS LinkedIn reference.'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || /[\u0000-\u001f\u007f]/.test(value) || !/^\/in\/[^/]+\/?$/.test(url.pathname) || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || value.length > 2048) fail('LINKEDIN_INVALID', 'Enter a valid HTTPS LinkedIn reference.');
    reference = { url: url.href, state: 'referenceOnly' };
  }
  return change(project, memory, { linkedInReference: reference });
}
export function finishOnboarding(project: Project, defer: boolean, expectedRevision: number): Project { const memory = memoryAt(project, expectedRevision); return change(project, memory, { onboarding: defer ? 'contextDeferred' : 'contextCompleted' }); }
export async function addMemorySource(project: Project, source: MemorySource, expectedRevision: number): Promise<Project> {
  const memory = memoryAt(project, expectedRevision);
  const actual = source.bytes ? await sha256(source.bytes) : await textHash(source.segments.map(item => item.text).join('\n'));
  if (actual !== source.sha256) fail('SOURCE_CHECKSUM', 'This source checksum does not match its accepted original.');
  if (source.bytes && source.kind === 'supportingFile' && ['needsReview', 'ready'].includes(source.state)) {
    if (source.format === 'pdf' && new TextDecoder().decode(source.bytes.slice(0, 5)) !== '%PDF-' || source.format === 'docx' && !(source.bytes[0] === 0x50 && source.bytes[1] === 0x4b && source.bytes[2] === 3 && source.bytes[3] === 4)) fail('SOURCE_FORMAT', 'This source does not match its accepted file format.');
    if (source.format === 'txt') { let decoded: string; try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(source.bytes); } catch { return fail('SOURCE_FORMAT', 'This text source is not valid UTF-8.'); } if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(decoded)) fail('SOURCE_FORMAT', 'This text source contains binary data.'); }
  }
  if (source.state !== 'error' && source.state !== 'reading' && memory.sources.some(item => item.sha256 === source.sha256 && item.format === source.format && item.kind === source.kind && item.state !== 'error' && item.state !== 'reading')) { const pending = memory.sources.find(item => item.id === source.id && ['error','reading'].includes(item.state)); return pending ? change(project, memory, { sources: memory.sources.filter(item => item.id !== pending.id) }) : project; }
  const previous = memory.sources.find(item => item.id === source.id);
  if (previous) {
    if (!['error','reading'].includes(previous.state) || previous.kind !== source.kind || previous.format !== source.format) fail('SOURCE_ID_CONFLICT', 'This source identity already belongs to different content.');
    return change(project, memory, { sources: memory.sources.map(item => item.id === source.id ? structuredClone(source) : item) });
  }
  return change(project, memory, { sources: [...memory.sources, structuredClone(source)] });
}
export async function addTextSource(project: Project, text: string, kind: Exclude<MemorySourceKind, 'supportingFile'>, expectedRevision: number): Promise<{ project: Project; source: MemorySource }> {
  if (!text.trim() || text.length > MEMORY_LIMITS.itemText) fail('MEMORY_TEXT_INVALID', 'Add a detail between 1 and 10,000 characters.');
  const source: MemorySource = { id: newId(), version: 1, kind, name: kind === 'localDictation' ? 'Applicant dictation' : kind === 'linkedinPaste' ? 'Applicant-pasted LinkedIn text' : 'Applicant-entered context', ingestedAt: now(), extractorVersion: 'folio-text-v1', format: 'text', sha256: await textHash(text), segments: [{ id: newId(), text, locator: kind === 'localDictation' ? 'Applicant-reviewed local transcript' : 'Applicant-entered text' }], state: 'needsReview' };
  const next = await addMemorySource(project, source, expectedRevision);
  return { project: next, source: next.careerMemory!.sources.find(item => item.sha256 === source.sha256 && item.kind === source.kind)! };
}
export async function sourceProvenance(project: Project, sourceId: string, segmentId: string): Promise<MemoryProvenance> {
  const source = project.careerMemory?.sources.find(item => item.id === sourceId), segment = source?.segments.find(item => item.id === segmentId);
  if (!source || !segment || !['needsReview', 'ready'].includes(source.state)) fail('SOURCE_MISSING', 'This source paragraph is no longer available.');
  return { sourceId, sourceKind: source.kind, sourceName: source.name, sourceHash: source.sha256, locator: segment.locator, originalQuote: segment.text, quoteHash: await textHash(segment.text), sourceSegmentId: segment.id };
}
export async function resumeProvenance(project: Project, factId: string): Promise<MemoryProvenance> {
  const fact = project.facts.find(item => item.id === factId && item.kind === 'resume');
  if (!fact) fail('SOURCE_MISSING', 'This resume fact is no longer available.');
  return { sourceId: project.source.id, sourceKind: 'resume', sourceName: project.source.name, sourceHash: project.source.sha256, locator: fact.locator, originalQuote: fact.text, quoteHash: await textHash(fact.text), resumeFactId: fact.id };
}
export async function addAssertion(project: Project, text: string, provenance: MemoryProvenance, expectedRevision: number, replaces?: AssertionVersion['supersedes']): Promise<Project> {
  const memory = memoryAt(project, expectedRevision);
  if (!text.trim() || text.length > MEMORY_LIMITS.itemText) fail('ASSERTION_TEXT_INVALID', 'Add a detail between 1 and 10,000 characters.');
  if (await textHash(provenance.originalQuote) !== provenance.quoteHash) fail('SOURCE_CHECKSUM', 'This source quote changed.');
  if (memory.assertions.some(item => item.versions.some(version => version.text === text && JSON.stringify(version.provenance) === JSON.stringify(provenance)))) return project;
  const id = newId();
  const version: AssertionVersion = { assertionId: id, version: 1, factId: newId(), text, provenance: structuredClone(provenance), confirmation: null, ...(replaces ? { supersedes: replaces } : {}) };
  return change(project, memory, { assertions: [...memory.assertions, { id, currentVersion: 1, eligibleForFuture: true, versions: [version] }] });
}
export function editAssertion(project: Project, id: string, expectedVersion: number, text: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision), { assertion, value } = current(memory, id, expectedVersion);
  if (!text.trim() || text.length > MEMORY_LIMITS.itemText) fail('ASSERTION_TEXT_INVALID', 'Add a detail between 1 and 10,000 characters.');
  if (text === value.text) return memory.assertionDrafts.some(draft => draft.assertionId === id) ? change(project, memory, { assertionDrafts: memory.assertionDrafts.filter(draft => draft.assertionId !== id) }) : project;
  const version = value.version + 1;
  const next = { ...assertion, currentVersion: version, versions: [...assertion.versions, { ...value, version, factId: newId(), text, confirmation: null }] };
  return change(project, memory, { assertions: memory.assertions.map(item => item.id === id ? next : item), assertionDrafts: memory.assertionDrafts.filter(draft => draft.assertionId !== id) });
}
export async function confirmAssertion(project: Project, id: string, expectedVersion: number, expectedTextHash: string, expectedRevision: number): Promise<Project> {
  const memory = memoryAt(project, expectedRevision), { assertion, value } = current(memory, id, expectedVersion);
  if (memory.assertionDrafts.some(draft => draft.assertionId === id)) fail('ASSERTION_DRAFT_PENDING', 'Save or cancel the edited wording before confirming.');
  const exactHash = await textHash(value.text);
  if (exactHash !== expectedTextHash) fail('ASSERTION_STALE', 'The displayed detail changed. Review the exact current wording before confirming.');
  if (value.confirmation) return project;
  const next = { ...assertion, versions: assertion.versions.map(item => item.version === expectedVersion ? { ...item, confirmation: { actor: 'applicant' as const, version: expectedVersion, textHash: exactHash, confirmedAt: now() } } : item) };
  return change(project, memory, { assertions: memory.assertions.map(item => item.id === id ? next : item) });
}
export function setAssertionFuture(project: Project, id: string, eligible: boolean, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision); current(memory, id);
  return change(project, memory, { assertions: memory.assertions.map(item => item.id === id ? { ...item, eligibleForFuture: eligible } : item) });
}
export function excludeResumeFact(project: Project, factId: string, excluded: boolean, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision);
  if (!project.facts.some(item => item.id === factId && item.kind === 'resume')) fail('SOURCE_MISSING', 'This resume fact is no longer available.');
  return change(project, memory, { excludedResumeFactIds: excluded ? [...new Set([...memory.excludedResumeFactIds, factId])] : memory.excludedResumeFactIds.filter(id => id !== factId) });
}
export function removeMemorySource(project: Project, sourceId: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision);
  if (memory.assertions.some(item => item.versions.some(version => version.provenance.sourceId === sourceId))) fail('SOURCE_IN_USE', 'This original supports retained details. Exclude those details from future applications, or remove the entire group to erase originals.');
  return change(project, memory, { sources: memory.sources.filter(item => item.id !== sourceId) });
}
export async function correctResumeFact(project: Project, factId: string, text: string, expectedRevision: number): Promise<Project> {
  const memory = memoryAt(project, expectedRevision);
  const existing = memory.assertions.find(assertion => assertion.versions.find(value => value.version === assertion.currentVersion)?.supersedes?.resumeFactId === factId);
  return existing ? editAssertion(project, existing.id, existing.currentVersion, text, expectedRevision) : addAssertion(project, text, await resumeProvenance(project, factId), expectedRevision, { resumeFactId: factId });
}
export async function promoteCareerNote(resume: Project, application: Project, factId: string, expectedRevision: number): Promise<Project> {
  memoryAt(resume, expectedRevision);
  if (workspaceOf(resume).templateGroupId !== workspaceOf(application).templateGroupId) fail('MEMORY_GROUP_MISMATCH', 'Choose a note from this resume group.');
  const fact = application.facts.find(item => item.id === factId && item.kind !== 'resume' && item.confirmed);
  if (!fact) fail('EVIDENCE_MISSING', 'Choose an applicant-confirmed application detail.');
  const result = await addTextSource(resume, fact.text, 'typed', expectedRevision);
  const provenance = await sourceProvenance(result.project, result.source.id, result.source.segments[0].id);
  return addAssertion(result.project, fact.text, provenance, result.project.careerMemory!.revision);
}
export function baselineReviewBlocks(project: Project): string[] {
  if (project.memorySnapshot) return project.memorySnapshot.baselineReviewBlocks;
  if (!project.careerMemory) return [];
  const excluded = new Set([...project.careerMemory.excludedResumeFactIds, ...superseded(project.careerMemory).resume]);
  return project.baseline.blocks.filter(block => [...block.sourceFactIds, ...block.runs.flatMap(run => run.sourceFactIds ?? [])].some(id => excluded.has(id))).map(block => block.id);
}
export const unresolvedBaselineBlocks = unresolvedMemoryBaselineBlocks;
export async function createMemorySnapshot(resume: Project, memory: CareerMemory = resume.careerMemory!): Promise<MemorySnapshot> {
  if (!memory || memory !== resume.careerMemory && JSON.stringify({ ...memory, sources: memory.sources.map(source => ({ ...source, bytes: undefined })) }) !== JSON.stringify({ ...resume.careerMemory, sources: resume.careerMemory?.sources.map(source => ({ ...source, bytes: undefined })) })) fail('MEMORY_STALE', 'Snapshot the current saved Career Memory.');
  const valid = validateProject(resume);
  const facts = eligibleEvidence(valid, 'futureApplication'), view = memoryView(valid);
  const evidence: MemorySnapshot['evidence'] = [];
  for (const fact of facts) {
    const assertion = view.assertions.find(item => item.factId === fact.id);
    evidence.push(assertion ? { factId: fact.id, assertionId: assertion.assertionId, assertionVersion: assertion.version, provenance: structuredClone(assertion.provenance), confirmation: structuredClone(assertion.confirmation) } : { factId: fact.id, provenance: await resumeProvenance(valid, fact.id), confirmation: null });
  }
  return { id: newId(), templateGroupId: memory.templateGroupId, memoryRevision: memory.revision, memoryHash: await hashJson({ ...memory, sources: memory.sources.map(source => ({ ...source, bytes: undefined })) }), createdAt: now(), sourceResumeId: resume.id, sourceResumeRevision: resume.revision, eligibleFactIds: facts.map(fact => fact.id), evidence, baselineReviewBlocks: baselineReviewBlocks(resume) };
}

export function setMemoryAssertionDraft(project: Project, id: string, baseVersion: number, text: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision); current(memory, id, baseVersion);
  if (text.length > MEMORY_LIMITS.itemText) fail('ASSERTION_TEXT_INVALID', 'Keep a detail below 10,000 characters.');
  return change(project, memory, { assertionDrafts: [...memory.assertionDrafts.filter(draft => draft.assertionId !== id), { assertionId: id, baseVersion, text }] });
}
export function cancelMemoryAssertionDraft(project: Project, id: string, expectedRevision: number): Project {
  const memory = memoryAt(project, expectedRevision);
  return change(project, memory, { assertionDrafts: memory.assertionDrafts.filter(draft => draft.assertionId !== id) });
}
export async function createMemoryAssertion(project: Project, input: { sourceId: string; segmentId: string; text: string }, expectedRevision: number): Promise<Project> {
  return addAssertion(project, input.text, await sourceProvenance(project, input.sourceId, input.segmentId), expectedRevision);
}
export const withMemoryAssertionDraft = setMemoryAssertionDraft;

/** A failed attachment retains no partial qualification text or binary bytes. */
export function failedMemorySource(input: { id: string; name: string; format: 'pdf' | 'docx' | 'txt'; errorCode: string }): MemorySource {
  const source: MemorySource = { id: input.id, version: 1, kind: 'supportingFile', name: input.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0,500) || 'Unavailable supporting file', ingestedAt: now(), extractorVersion: 'folio-context-v1', format: input.format, sha256: hashTextSync(''), segments: [], state: 'error', errorCode: input.errorCode };
  if (!memorySourceSchema.safeParse(source).success) source.errorCode = 'MEMORY_IMPORT_FAILED';
  return memorySourceSchema.parse(source);
}

import { z } from 'zod';
import { eligibleEvidence } from '../core/careerMemory';
import { editBlock } from '../core/commands';
import { blockText, canonicalJson, hasValidApproval, hashTextSync, newId, safeHref, workspaceOf } from '../core/model';
import type { LayoutResult, Project, TextRun } from '../core/model';
import { computeLayout } from '../layout/engine';

export const AI_MODEL = 'gpt-6.1-sol' as const;
export const AI_BODY_LIMIT = 128 * 1024;
const RESPONSE_LIMIT = 512 * 1024;
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const layoutBudgetSchema = z.object({
  version: z.literal(1), regionId: id, widthPt: z.number().positive().max(5000), heightPt: z.number().positive().max(5000),
  fontFamily: z.enum(['sans', 'serif', 'mono', 'times']), fontSizePt: z.number().positive().max(200),
  fontWeight: z.union([z.literal(400), z.literal(700)]), italic: z.boolean(), lineHeightPt: z.number().positive().max(500),
  maxLines: z.number().int().min(1).max(100), maxCharacters: z.number().int().min(1).max(10_000),
}).strict();
const contextSchema = z.object({
  projectId: id, projectRevision: revision, draftRevision: revision, templateRevision: revision,
  templateId: id, templateHash: digest, baselineRevision: revision, baselineHash: digest,
  memorySnapshotId: id.nullable(), memoryRevision: revision.nullable(), memoryHash: digest.nullable(),
}).strict().refine(value => (value.memorySnapshotId === null) === (value.memoryRevision === null) &&
  (value.memorySnapshotId === null) === (value.memoryHash === null));
const factSchema = z.object({
  id, text: z.string().min(1).max(10_000), kind: z.enum(['resume', 'careerNote', 'applicantEdit']), confirmed: z.boolean(),
  version: revision.positive(), assertionId: id.nullable(), textHash: digest,
  source: z.object({
    id, kind: z.enum(['resume', 'supportingFile', 'typed', 'linkedinPaste', 'localDictation', 'careerNote', 'applicantEdit']),
    version: z.literal(1), hash: digest, quote: z.string().max(10_000), quoteHash: digest, locator: z.string().max(1000),
  }).strict(),
  confirmation: z.object({ version: revision.positive(), textHash: digest, confirmedAt: z.string().datetime().nullable() }).strict().nullable(),
}).strict().superRefine((fact, ctx) => {
  const invalid = () => ctx.addIssue({ code: 'custom', message: 'Invalid bound fact metadata.' });
  if (fact.textHash !== hashTextSync(fact.text) || fact.source.quoteHash !== hashTextSync(fact.source.quote)) invalid();
  if (fact.kind === 'resume') {
    if (fact.version !== 1 || fact.assertionId !== null || fact.confirmation !== null || fact.source.kind !== 'resume' || fact.source.quote !== fact.text) invalid();
  } else {
    if (!fact.confirmed || !fact.confirmation || fact.confirmation.version !== fact.version || fact.confirmation.textHash !== fact.textHash) invalid();
    if (fact.assertionId !== null) {
      if (fact.kind !== 'careerNote' || !fact.confirmation?.confirmedAt || ['careerNote', 'applicantEdit'].includes(fact.source.kind)) invalid();
    } else if (fact.version !== 1 || fact.source.id !== fact.id || fact.source.kind !== fact.kind ||
        fact.source.quote !== fact.text || fact.source.hash !== fact.textHash || fact.source.quoteHash !== fact.textHash) invalid();
  }
});
const requestSchema = z.object({
  schemaVersion: z.literal(1), allowedOperations: z.tuple([z.literal('replaceParagraphText')]),
  requestId: id, context: contextSchema,
  consent: z.object({ confirmed: z.literal(true), contextHash: digest }).strict(),
  job: z.object({ title: z.string().max(500), company: z.string().max(500), description: z.string().min(1).max(50_000) }).strict(),
  facts: z.array(factSchema).min(1).max(100),
  blocks: z.array(z.object({
    id, text: z.string().min(1).max(10_000), textHash: digest, requiredFactIds: z.array(id).min(1).max(20), layoutBudget: layoutBudgetSchema,
  }).strict().refine(block => block.textHash === hashTextSync(block.text) && !!block.text.trim() &&
    new Set(block.requiredFactIds).size === block.requiredFactIds.length && block.layoutBudget.maxCharacters <= block.text.length &&
    block.layoutBudget.maxLines === Math.max(1, Math.floor(block.layoutBudget.heightPt / block.layoutBudget.lineHeightPt)))).min(1).max(100),
}).strict().superRefine((request, ctx) => {
  const textLength = request.job.title.length + request.job.company.length + request.job.description.length +
    request.facts.reduce((sum, fact) => sum + fact.text.length + fact.source.quote.length + fact.source.locator.length, 0) + request.blocks.reduce((sum, block) => sum + block.text.length, 0);
  if (new Set(request.facts.map(fact => fact.id)).size !== request.facts.length ||
      new Set(request.blocks.map(block => block.id)).size !== request.blocks.length || textLength > 100_000 ||
      !request.job.description.trim() || request.facts.some(fact => fact.kind !== 'resume' && !fact.confirmed) ||
      request.context.memorySnapshotId === null && request.facts.some(fact => fact.assertionId !== null) ||
      request.blocks.some(block => block.requiredFactIds.some(factId => !request.facts.some(fact => fact.id === factId)))) {
    ctx.addIssue({ code: 'custom', message: 'Invalid bounded request.' });
  }
});
const proposalSchema = z.object({
  operation: z.literal('replaceParagraphText'),
  blockId: id, beforeText: z.string().max(10_000), afterText: z.string().min(1).max(10_000),
  factIds: z.array(id).min(1).max(20), reason: z.string().min(1).max(1000),
  beforeHash: digest, afterHash: digest,
  factRefs: z.array(z.object({
    factId: id, version: revision.positive(), assertionId: id.nullable(), sourceId: id,
    sourceVersion: z.literal(1), sourceHash: digest, quoteHash: digest, textHash: digest,
  }).strict()).min(1).max(20),
}).strict();
const usageSchema = z.object({ inputTokens: revision, outputTokens: revision.max(2000), totalTokens: revision }).strict()
  .refine(usage => usage.inputTokens + usage.outputTokens === usage.totalTokens);
const resultSchema = z.object({
  schemaVersion: z.literal(1), requestId: id, context: contextSchema, contextHash: digest, model: z.literal(AI_MODEL),
  proposals: z.array(proposalSchema).max(20), requiresReview: z.literal(true), usage: usageSchema.nullable(),
}).strict();
const statusSchema = z.object({
  keyConfigured: z.boolean(), modelConfigured: z.boolean(), supportedModel: z.boolean(),
  paidRequestsEnabled: z.boolean(), accountModelVerified: z.boolean(), busy: z.boolean(),
  verification: z.enum(['verified', 'failed', 'unverified']),
}).strict().refine(status => status.accountModelVerified === (status.verification === 'verified') &&
  (!status.accountModelVerified || status.keyConfigured && status.modelConfigured && status.supportedModel));

export type AiContext = z.infer<typeof contextSchema>;
export type AiRequest = z.infer<typeof requestSchema>;
export type AiProposal = z.infer<typeof proposalSchema>;
export type AiResult = z.infer<typeof resultSchema>;
export type AiStatus = z.infer<typeof statusSchema>;
export type AiLayoutBudget = z.infer<typeof layoutBudgetSchema>;

const ERROR_MESSAGES: Record<string, string> = {
  sign_in_required: 'Sign in to use AI tailoring. Editing and downloading work without an account.',
  daily_limit: 'You’ve used today’s AI tailorings. Try again tomorrow, or edit by hand.',
  service_limit: 'AI tailoring is at capacity for today. You can still edit and download.',
  not_found: 'AI tailoring is offline right now. You can still edit and download your resume.',
  server_unavailable: 'AI tailoring is offline right now. You can still edit and download your resume.',
  not_configured: 'AI tailoring isn’t set up on the server yet.',
  unsupported_model: 'The server must use gpt-6.1-sol.',
  requests_disabled: 'Paid AI requests are disabled. Server configuration and a confirmed test budget are required before sending.',
  account_unverified: 'Verify account access to the model before sending. Verification does not generate content.',
  invalid_request: 'Choose eligible facts, current paragraphs, and a job description within the request limits.',
  consent_mismatch: 'Review and consent to this exact request again before sending.',
  stale_context: 'The application changed. These proposals are retained for reading; prepare a new request before accepting wording.',
  unsupported_formatting: 'This paragraph has mixed styles, links, or ambiguous text boxes that a plain-text proposal cannot safely preserve. Apply the reviewed wording on the canvas while keeping its formatting, then review the PDF.',
  target_sources_unselected: 'Select every listed fact currently supporting the selected paragraph before reviewing the request. Its sources will not be added automatically.',
  target_evidence_unavailable: 'A selected paragraph has missing, excluded, or unconfirmed supporting facts. Revise and review that paragraph on the canvas before requesting AI wording.',
  unsupported_target: 'AI wording needs a nonempty paragraph and its approved original text in one supported text box. Use the canvas to revise this paragraph and review its template first.',
  proposal_budget_exceeded: 'The returned wording exceeds the reviewed paragraph constraints. No wording was applied. Revise it on the canvas without shrinking the font or changing the box, then review the PDF.',
  required_evidence_missing: 'The proposal omitted a required source for the current paragraph. No wording was applied. Review its supported scope on the canvas.',
  candidate_does_not_fit: 'The proposed wording does not fit the unchanged document with its current fonts, or creates a layout problem. Your draft is unchanged. Shorten it on the canvas while preserving its supported meaning, then review the PDF.',
  candidate_fit_unavailable: 'The exact proposal fit could not be checked with the bundled fonts. Your draft is unchanged. Check the local font resources or apply reviewed wording on the canvas and inspect the PDF.',
  request_already_sent: 'This request was already sent. Review a new request before sending again.',
  busy: 'An AI operation is already running. Wait for it to finish.',
  provider_auth: 'OpenAI could not authenticate the configured server key.',
  provider_access: 'OpenAI did not grant this account access to gpt-6.1-sol.',
  provider_rate_limit: 'OpenAI rate limited the request. No automatic retry was made.',
  provider_error: 'OpenAI could not complete the request. No automatic retry was made.',
  provider_timeout: 'OpenAI did not finish within the time limit. No automatic retry was made.',
  provider_invalid_response: 'The response failed validation. No wording was applied.',
  provider_refusal: 'OpenAI declined to provide tailoring proposals. No wording was applied.',
  provider_incomplete: 'OpenAI returned an incomplete response. No wording was applied.',
  cancelled: 'The request was stopped. OpenAI may already have processed it; no automatic retry was made.',
  forbidden_host: 'Open Folio at the approved local address to use AI.',
  forbidden_origin: 'Open Folio at the approved local address to use AI.',
  body_too_large: 'The request exceeds the 128 KiB limit. Select less text.',
  unsupported_content_type: 'The AI service rejected the request format.',
  internal_error: 'The AI service could not complete the request.',
};
export class AiClientError extends Error {
  constructor(public readonly code: string) { super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.provider_invalid_response); this.name = 'AiClientError'; }
}
export function aiErrorMessage(error: unknown): string {
  return error instanceof AiClientError ? error.message : 'This operation could not be completed. Your draft is unchanged.';
}

export function aiContext(project: Project): AiContext {
  return contextSchema.parse({
    projectId: project.id, projectRevision: project.revision, draftRevision: project.draft.revision,
    templateRevision: project.template.revision, templateId: project.template.id,
    templateHash: hashTextSync(canonicalJson(project.template)), baselineRevision: project.baseline.revision,
    baselineHash: hashTextSync(canonicalJson(project.baseline.blocks)), memorySnapshotId: project.memorySnapshot?.id ?? null,
    memoryRevision: project.memorySnapshot?.memoryRevision ?? null, memoryHash: project.memorySnapshot?.memoryHash ?? null,
  });
}
export function aiConsentHash(request: Omit<AiRequest, 'consent'>): string {
  const { schemaVersion, allowedOperations, requestId, context, job, facts, blocks } = request;
  return hashTextSync(canonicalJson({ schemaVersion, allowedOperations, requestId, context, job, facts, blocks }));
}
/** Detect changes without serializing source bytes, history, or source originals. */
export function aiProjectFingerprint(project: Project): string {
  return hashTextSync(canonicalJson({
    context: aiContext(project), workspace: workspaceOf(project), sourceId: project.source.id,
    sourceHash: project.source.sha256, job: project.job, template: project.template,
    draft: project.draft, facts: eligibleEvidence(project).map(({ id: factId, text, kind, confirmed }) => ({ id: factId, text, kind, confirmed })),
    snapshotHash: project.memorySnapshot?.memoryHash ?? null, memoryRevision: project.careerMemory?.revision ?? null,
  }));
}
export function validateAiRequest(value: unknown): AiRequest {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) throw new AiClientError('invalid_request');
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).byteLength > AI_BODY_LIMIT) throw new AiClientError('body_too_large');
  if (aiConsentHash(parsed.data) !== parsed.data.consent.contextHash) throw new AiClientError('consent_mismatch');
  return parsed.data;
}
/** Only the explicit selection is copied into the transport DTO. */
export function prepareAiRequest(project: Project, factIds: readonly string[], blockIds: readonly string[], requestId: string = newId()): AiRequest {
  if (workspaceOf(project).kind !== 'application' || project.careerMemory) throw new AiClientError('invalid_request');
  if (new Set(factIds).size !== factIds.length || new Set(blockIds).size !== blockIds.length) throw new AiClientError('invalid_request');
  const evidence = new Map(eligibleEvidence(project).map(fact => [fact.id, fact]));
  const currentBlocks = new Map(project.draft.blocks.map(block => [block.id, block]));
  const facts = factIds.map(factId => {
    const fact = evidence.get(factId);
    if (!fact) throw new AiClientError('invalid_request');
    const pinned = project.memorySnapshot?.evidence.find(item => item.factId === fact.id);
    const textHash = hashTextSync(fact.text);
    const source = pinned ? {
      id: pinned.provenance.sourceId, kind: pinned.provenance.sourceKind, version: 1 as const, hash: pinned.provenance.sourceHash,
      quote: pinned.provenance.originalQuote, quoteHash: pinned.provenance.quoteHash, locator: pinned.provenance.locator,
    } : fact.kind === 'resume' ? {
      id: project.source.id, kind: 'resume' as const, version: 1 as const, hash: project.source.sha256,
      quote: fact.text, quoteHash: textHash, locator: fact.locator,
    } : {
      id: fact.id, kind: fact.kind, version: 1 as const, hash: textHash,
      quote: fact.text, quoteHash: textHash, locator: fact.locator,
    };
    const confirmation = fact.kind === 'resume' ? null : pinned?.assertionId ? pinned.confirmation && {
      version: pinned.confirmation.version, textHash: pinned.confirmation.textHash, confirmedAt: pinned.confirmation.confirmedAt,
    } : { version: 1, textHash, confirmedAt: null };
    return { id: fact.id, text: fact.text, kind: fact.kind, confirmed: fact.confirmed,
      version: pinned?.assertionVersion ?? 1, assertionId: pinned?.assertionId ?? null, textHash, source, confirmation };
  });
  const blocks = blockIds.map(blockId => {
    const block = currentBlocks.get(blockId);
    if (!block) throw new AiClientError('invalid_request');
    const text = blockText(block);
    const requiredFactIds = aiRequiredFactIds(project, blockId);
    if (requiredFactIds.length < 1 || requiredFactIds.length > 20 || requiredFactIds.some(factId => !evidence.has(factId))) throw new AiClientError('target_evidence_unavailable');
    if (requiredFactIds.some(factId => !factIds.includes(factId))) throw new AiClientError('target_sources_unselected');
    return { id: block.id, text, textHash: hashTextSync(text), requiredFactIds, layoutBudget: aiLayoutBudget(project, blockId) };
  });
  const payload = { schemaVersion: 1 as const, allowedOperations: ['replaceParagraphText'] as ['replaceParagraphText'], requestId, context: aiContext(project), job: { ...project.job }, facts, blocks };
  return validateAiRequest({ ...payload, consent: { confirmed: true, contextHash: aiConsentHash(payload) } });
}
export function assertAiRequestCurrent(project: Project, request: AiRequest): void {
  validateAiRequest(request);
  let current: AiRequest;
  try { current = prepareAiRequest(project, request.facts.map(fact => fact.id), request.blocks.map(block => block.id), request.requestId); }
  catch { throw new AiClientError('stale_context'); }
  if (canonicalJson(current) !== canonicalJson(request)) throw new AiClientError('stale_context');
}

// Mirrors server/protected-claims.mjs. Literal checks cannot prove entailment.
const MONTH = String.raw`(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?`;
const NUMBER = String.raw`(?:\d+(?:[.,]\d+)*|\.\d+)`;
const DURATION = String.raw`(?:centur(?:y|ies)|decades?|years?|yrs?|months?|mos?|weeks?|wks?|days?|hours?|hrs?|minutes?|mins?|seconds?|secs?)`;
const CARDINAL = String.raw`(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|half|a|an)`;
const UNIT = String.raw`(?:percentage\s+points?|per\s+cent|percent|${DURATION}|thousand|million|billion|dollars?|euros?|pounds?|USD|EUR|GBP|INR|JPY|CAD|AUD|k|m|b)\b`;
const DATE = String.raw`${MONTH}\s+\d{1,4}(?:st|nd|rd|th)?(?:(?:\s*,\s*|\s+)\d{4})?|\d{1,2}(?:st|nd|rd|th)?\s+${MONTH}(?:\s+\d{4})?`;
const QUANTITY = String.raw`(?:\p{Sc}\s*|(?:USD|EUR|GBP|INR|JPY|CAD|AUD)\s*)?[+\-−]?${NUMBER}(?:\s*[-–—/]\s*${NUMBER}(?:[-/]\d+)?)?(?:st|nd|rd|th)?\+?(?:\s*(?:-\s*)?${UNIT}|\s*[%×]|\s*x\b)?`;
const SPELLED_DURATION = String.raw`${CARDINAL}(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?(?:\s+(?:hundred|thousand))?(?:\s+|\s*-\s*)${DURATION}\b`;
const NUMERIC = new RegExp(String.raw`(?<![\p{L}\p{N}_])(?:${DATE}|${QUANTITY}|${SPELLED_DURATION})(?![\p{L}\p{N}_])`, 'giu');
export function numericExpressions(text: string): string[] {
  return [...text.matchAll(NUMERIC)].map(match => match[0].toLowerCase().replace(/\s+/gu, ' ').trim());
}
export function validateAiResult(value: unknown, request: AiRequest): AiResult {
  validateAiRequest(request);
  const parsed = resultSchema.safeParse(value);
  if (!parsed.success) throw new AiClientError('provider_invalid_response');
  const result = parsed.data;
  if (result.requestId !== request.requestId || result.contextHash !== request.consent.contextHash ||
      canonicalJson(result.context) !== canonicalJson(request.context)) throw new AiClientError('provider_invalid_response');
  const facts = new Map(request.facts.map(fact => [fact.id, fact]));
  const blocks = new Map(request.blocks.map(block => [block.id, block]));
  const proposed = new Set<string>();
  for (const proposal of result.proposals) {
    if (proposed.has(proposal.blockId) || !blocks.has(proposal.blockId) || blocks.get(proposal.blockId)!.text !== proposal.beforeText ||
        !proposal.afterText.trim() || proposal.afterText === proposal.beforeText || !proposal.reason.trim() ||
        new Set(proposal.factIds).size !== proposal.factIds.length || proposal.factIds.some(factId => !facts.has(factId))) {
      throw new AiClientError('provider_invalid_response');
    }
    const target = blocks.get(proposal.blockId)!;
    if (target.requiredFactIds.some(factId => !proposal.factIds.includes(factId))) throw new AiClientError('required_evidence_missing');
    if (proposal.afterText.length > target.layoutBudget.maxCharacters || proposal.afterText.split(/\r\n?|\n/).length > target.layoutBudget.maxLines) throw new AiClientError('proposal_budget_exceeded');
    const supported = new Set(proposal.factIds.flatMap(factId => numericExpressions(facts.get(factId)!.text)));
    if (numericExpressions(proposal.afterText).some(value => !supported.has(value))) throw new AiClientError('provider_invalid_response');
    if (proposal.beforeHash !== hashTextSync(proposal.beforeText) || proposal.afterHash !== hashTextSync(proposal.afterText) ||
        canonicalJson(proposal.factRefs) !== canonicalJson(proposal.factIds.map(factId => {
          const fact = facts.get(factId)!;
          return { factId, version: fact.version, assertionId: fact.assertionId, sourceId: fact.source.id,
            sourceVersion: fact.source.version, sourceHash: fact.source.hash, quoteHash: fact.source.quoteHash, textHash: fact.textHash };
        }))) throw new AiClientError('provider_invalid_response');
    proposed.add(proposal.blockId);
  }
  return result;
}
/** Root calls this again against its latest Project immediately before editBlock. */
export function guardAiAcceptance(project: Project, request: AiRequest, result: AiResult, proposal: AiProposal): void {
  assertAiRequestCurrent(project, request);
  const valid = validateAiResult(result, request);
  if (!valid.proposals.some(item => canonicalJson(item) === canonicalJson(proposal))) throw new AiClientError('provider_invalid_response');
}
function uniformAiFormatting(project: Project, blockId: string): Pick<TextRun, 'bold' | 'italic' | 'underline' | 'href'> {
  const block = project.draft.blocks.find(item => item.id === blockId);
  const regions = project.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'text' && region.contentId === blockId);
  if (!block || !regions.length) throw new AiClientError('unsupported_formatting');
  if (block.runs.some(run => run.href && !safeHref(run.href))) throw new AiClientError('unsupported_formatting');
  const visibleRuns = block.runs.filter(run => run.text.length > 0);
  const runs = visibleRuns.length ? visibleRuns : [{ text: '' }];
  let signature: string | undefined;
  let preserved: Pick<TextRun, 'bold' | 'italic' | 'underline' | 'href'> | undefined;
  for (const region of regions) {
    if (region.kind !== 'text') continue;
    for (const run of runs) {
      const safeLink = run.href ? safeHref(run.href) : undefined;
      const formatting = {
        bold: run.bold ?? region.style.fontWeight === 700,
        italic: run.italic ?? region.style.italic,
        underline: run.underline ?? false,
        ...(safeLink ? { href: safeLink } : {}),
      };
      const current = canonicalJson(formatting);
      if (signature !== undefined && signature !== current) throw new AiClientError('unsupported_formatting');
      signature = current;
      // Keep the existing URL string; a model response never supplies a link.
      preserved ??= { ...formatting, ...(run.href ? { href: run.href } : {}) };
    }
  }
  if (!preserved) throw new AiClientError('unsupported_formatting');
  return preserved;
}
export function aiRequiredFactIds(project: Project, blockId: string): string[] {
  const block = project.draft.blocks.find(item => item.id === blockId);
  if (!block) throw new AiClientError('unsupported_target');
  const lists = [block.sourceFactIds, ...block.runs.map(run => run.sourceFactIds ?? [])];
  if (lists.some(ids => new Set(ids).size !== ids.length)) throw new AiClientError('target_evidence_unavailable');
  return [...new Set(lists.flat())];
}
export function aiLayoutBudget(project: Project, blockId: string): AiLayoutBudget {
  if (!hasValidApproval(project) || project.approval!.layoutHash !== hashTextSync(canonicalJson(project.template)) ||
      project.approval!.baselineHash !== hashTextSync(canonicalJson(project.baseline.blocks))) throw new AiClientError('unsupported_target');
  const block = project.draft.blocks.find(item => item.id === blockId), baseline = project.baseline.blocks.find(item => item.id === blockId);
  const currentText = block && blockText(block), originalText = baseline && blockText(baseline);
  const regions = project.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'text' && region.contentId === blockId);
  if (!currentText?.trim() || !originalText?.trim() || regions.length !== 1 || regions[0].kind !== 'text') throw new AiClientError('unsupported_target');
  const region = regions[0], formatting = uniformAiFormatting(project, blockId);
  const parsed = layoutBudgetSchema.safeParse({
    version: 1, regionId: region.id, widthPt: region.bounds.width, heightPt: region.bounds.height,
    fontFamily: region.style.fontFamily, fontSizePt: region.style.fontSize, fontWeight: formatting.bold ? 700 : 400,
    italic: !!formatting.italic, lineHeightPt: region.style.lineHeight,
    maxLines: Math.max(1, Math.floor(region.bounds.height / region.style.lineHeight)),
    maxCharacters: Math.min(currentText.length, originalText.length, 10_000),
  });
  if (!parsed.success) throw new AiClientError('unsupported_target');
  return parsed.data;
}
/** The request permits wording changes, so mixed inline formatting fails closed. */
export function aiFormattingIssue(project: Project, blockId: string): string | null {
  try { uniformAiFormatting(project, blockId); return null; }
  catch { return ERROR_MESSAGES.unsupported_formatting; }
}
/** Root uses the current guarded style without inferring new links or run mapping. */
export function reviewedAiRuns(project: Project, request: AiRequest, result: AiResult, proposal: AiProposal): TextRun[] {
  guardAiAcceptance(project, request, result, proposal);
  return [{ text: proposal.afterText, ...uniformAiFormatting(project, proposal.blockId), sourceFactIds: [...proposal.factIds] }];
}
/** Pure candidate probe: no storage, history, document mutation or provider request. */
export async function probeAiCandidate(project: Project, request: AiRequest, result: AiResult, proposal: AiProposal): Promise<LayoutResult> {
  const runs = reviewedAiRuns(project, request, result, proposal);
  const candidate = editBlock(structuredClone(project), proposal.blockId, runs);
  let layout: LayoutResult;
  try { layout = await computeLayout(candidate.template, candidate.draft); }
  catch { throw new AiClientError('candidate_fit_unavailable'); }
  const budget = request.blocks.find(block => block.id === proposal.blockId)!.layoutBudget;
  const target = layout.regions.find(region => region.regionId === budget.regionId);
  if (layout.overflows.length || !target || target.lines.length > budget.maxLines) {
    const descriptions: Record<string, string> = { width: 'line width', height: 'text height', page: 'page boundary', glyph: 'unsupported glyph', asset: 'missing content', collision: 'overlap' };
    const problems = [...new Set(layout.overflows.map(issue => descriptions[issue.code] ?? 'layout'))];
    if (!target) problems.push('target text box unavailable');
    else if (target.lines.length > budget.maxLines) problems.push(`${target.lines.length} lines; reviewed limit ${budget.maxLines}`);
    const error = new AiClientError('candidate_does_not_fit');
    error.message += ` Local check: ${problems.join(', ')}.`;
    throw error;
  }
  return layout;
}
export interface AiFinding { code: 'introduced_terms' | 'strengthened_claim'; terms: string[]; message: string }
export function aiProposalFindings(proposal: AiProposal, request: AiRequest): AiFinding[] {
  const cited = request.facts.filter(fact => proposal.factIds.includes(fact.id)).map(fact => fact.text).join('\n');
  const words = (value: string) => new Set((value.match(/[\p{L}\p{N}][\p{L}\p{N}+#.-]*/gu) ?? []).map(word => word.replace(/[.,-]+$/, '').toLowerCase()));
  const supported = words(cited);
  const strength = /\b(?:led|lead|leads|leading|managed|manage|manages|owned|own|owns|expert|expertise|mastered|architected|spearheaded|directed|oversaw|proficient|advanced|fluent|certified|certification|doctorate|phd|mba|bachelor|bachelors|master|masters)\b/giu;
  const strengths = [...new Set((proposal.afterText.match(strength) ?? []).filter(word => !supported.has(word.toLowerCase())))];
  const generic = new Set(['i', 'a', 'an', 'the', 'and', 'with', 'for', 'in', 'on', 'to', 'at', 'by']);
  const introduced = [...new Set((proposal.afterText.match(/\b[A-Z][\p{L}\p{N}+#.-]*/gu) ?? []).map(word => word.replace(/[.,-]+$/, '')).filter(word => !supported.has(word.toLowerCase()) && !generic.has(word.toLowerCase()) && !strengths.includes(word)))];
  return [
    ...(introduced.length ? [{ code: 'introduced_terms' as const, terms: introduced, message: 'These capitalized entity, tool, or credential words are absent from the cited facts. Review their support.' }] : []),
    ...(strengths.length ? [{ code: 'strengthened_claim' as const, terms: strengths, message: 'These words may strengthen a qualification or responsibility beyond the cited facts. Review its scope.' }] : []),
  ];
}

export function aiStatusMessage(status: AiStatus): string {
  if (!status.keyConfigured || !status.modelConfigured) return ERROR_MESSAGES.not_configured;
  if (!status.supportedModel) return ERROR_MESSAGES.unsupported_model;
  if (status.busy) return ERROR_MESSAGES.busy;
  if (!status.accountModelVerified) {
    const verification = status.verification === 'failed' ? 'Account model verification failed. Check the server configuration, then verify again explicitly.' : ERROR_MESSAGES.account_unverified;
    return status.paidRequestsEnabled ? verification : `${verification} ${ERROR_MESSAGES.requests_disabled}`;
  }
  if (!status.paidRequestsEnabled) return ERROR_MESSAGES.requests_disabled;
  return 'Account model access is verified. Sending a request is a paid external transfer to OpenAI.';
}
export function canSendAiRequest(status: AiStatus | null): boolean {
  return !!status && status.keyConfigured && status.modelConfigured && status.supportedModel && status.accountModelVerified && status.paidRequestsEnabled && !status.busy;
}
async function responseJson(response: Response): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) throw new AiClientError('provider_invalid_response');
  const length = response.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > RESPONSE_LIMIT)) { await response.body.cancel().catch(() => {}); throw new AiClientError('provider_invalid_response'); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT) throw new AiClientError('provider_invalid_response');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { throw new AiClientError('provider_invalid_response'); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export interface AiEndpoint { baseUrl: string; headers: Record<string, string> }
/** Signed-in users call their home region's edge function; null means not signed in. */
export async function cloudAiEndpoint(): Promise<AiEndpoint | null> {
  const { REGIONS, REGION_IDS, regionClient, rememberedRegion } = await import('../auth/regions');
  const remembered = rememberedRegion();
  const order = remembered ? [remembered, ...REGION_IDS.filter(id => id !== remembered)] : REGION_IDS;
  for (const region of order) {
    const { data } = await regionClient(region).auth.getSession();
    const token = data.session?.access_token;
    if (token) return { baseUrl: `${REGIONS[region].url}/functions/v1/ai`, headers: { Authorization: `Bearer ${token}`, apikey: REGIONS[region].publishableKey } };
  }
  return null;
}
// Unit tests use a synthetic same-path transport instead of the cloud function.
const defaultEndpoint: () => Promise<AiEndpoint | null> = import.meta.env.MODE === 'test' ? async () => ({ baseUrl: '/api/ai', headers: {} }) : cloudAiEndpoint;
/** Injected transport and endpoint are for synthetic tests. */
export function createAiClient(fetchImpl?: typeof fetch, endpoint?: () => Promise<AiEndpoint | null>) {
  const transport = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));
  const resolve = endpoint ?? (() => defaultEndpoint());
  async function call(route: 'status' | 'verify' | 'tailor', body?: unknown, signal?: AbortSignal): Promise<unknown> {
    try {
      const target = await resolve();
      if (!target) throw new AiClientError('sign_in_required');
      const response = await transport(`${target.baseUrl}/${route}`, {
        method: body === undefined ? 'GET' : 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
        headers: { Accept: 'application/json', ...target.headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      // A proxy or gateway error (for example 502 when the AI server is not running) is an
      // unavailable service, not an invalid model response.
      const isJson = /^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '');
      if (!response.ok && !isJson) {
        await response.body?.cancel().catch(() => {});
        throw new AiClientError('server_unavailable');
      }
      const value = await responseJson(response);
      if (!response.ok) {
        const error = z.object({ error: z.object({ code: z.string().max(100), message: z.string().max(1000) }).strict() }).strict().safeParse(value);
        throw new AiClientError(error.success && Object.hasOwn(ERROR_MESSAGES, error.data.error.code) ? error.data.error.code : response.status >= 502 ? 'server_unavailable' : 'provider_invalid_response');
      }
      return value;
    } catch (error) {
      if (signal?.aborted) throw new AiClientError('cancelled');
      if (error instanceof AiClientError) throw error;
      throw new AiClientError('server_unavailable');
    }
  }
  async function statusCall(route: 'status' | 'verify', signal?: AbortSignal): Promise<AiStatus> {
    const parsed = statusSchema.safeParse(await call(route, route === 'verify' ? {} : undefined, signal));
    if (!parsed.success) throw new AiClientError('provider_invalid_response');
    return parsed.data;
  }
  return {
    status: (signal?: AbortSignal) => statusCall('status', signal),
    verify: (signal?: AbortSignal) => statusCall('verify', signal),
    async tailor(request: AiRequest, options: { status: AiStatus; consentHash: string; signal?: AbortSignal }): Promise<AiResult> {
      const valid = validateAiRequest(request);
      if (options.consentHash !== valid.consent.contextHash) throw new AiClientError('consent_mismatch');
      const parsedStatus = statusSchema.safeParse(options.status);
      if (!parsedStatus.success) throw new AiClientError('provider_invalid_response');
      if (!canSendAiRequest(parsedStatus.data)) {
        const status = parsedStatus.data;
        throw new AiClientError(!status.keyConfigured || !status.modelConfigured ? 'not_configured' : !status.supportedModel ? 'unsupported_model' : status.busy ? 'busy' : !status.accountModelVerified ? 'account_unverified' : 'requests_disabled');
      }
      return validateAiResult(await call('tailor', valid, options.signal), valid);
    },
  };
}

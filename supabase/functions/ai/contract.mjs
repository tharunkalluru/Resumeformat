import { createHash } from 'node:crypto';
import { z } from 'zod';
import { hasUnsupportedNumericClaims } from './protected-claims.mjs';

export const MODEL = 'gpt-6.1-sol';
export const MAX_BODY_BYTES = 128 * 1024;
export const MAX_PROVIDER_BYTES = 512 * 1024;
export const MAX_VERIFICATION_BYTES = 32 * 1024;
export const MAX_OUTPUT_TOKENS = 2000;
export const PROVIDER_TIMEOUT_MS = 45_000;
export const VERIFICATION_TIMEOUT_MS = 10_000;
export const VERIFICATION_TTL_MS = 5 * 60_000;

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const version = revision.refine(value => value > 0);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const boundedText = z.string().min(1).max(10_000);
const assertionSourceKinds = new Set(['resume', 'supportingFile', 'typed', 'linkedinPaste', 'localDictation']);

export function hashText(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export const contextSchema = z.object({
  projectId: id,
  projectRevision: revision,
  draftRevision: revision,
  templateId: id,
  templateRevision: revision,
  templateHash: digest,
  baselineRevision: revision,
  baselineHash: digest,
  memorySnapshotId: id.nullable(),
  memoryRevision: revision.nullable(),
  memoryHash: digest.nullable(),
}).strict().refine(value => [value.memorySnapshotId, value.memoryRevision, value.memoryHash].every(item => item === null) ||
  [value.memorySnapshotId, value.memoryRevision, value.memoryHash].every(item => item !== null));

export const layoutBudgetSchema = z.object({
  version: z.literal(1), regionId: id,
  widthPt: z.number().finite().positive().max(5000), heightPt: z.number().finite().positive().max(5000),
  fontFamily: z.enum(['sans', 'serif', 'mono', 'times']), fontSizePt: z.number().finite().positive().max(200),
  fontWeight: z.union([z.literal(400), z.literal(700)]), italic: z.boolean(),
  lineHeightPt: z.number().finite().positive().max(500),
  maxLines: z.number().int().min(1).max(100), maxCharacters: z.number().int().min(1).max(10_000),
}).strict();

const selectedFactSchema = z.object({
  id, text: boundedText, kind: z.enum(['resume', 'careerNote', 'applicantEdit']), confirmed: z.boolean(),
  version, assertionId: id.nullable(), textHash: digest,
  source: z.object({
    id, kind: z.enum(['resume', 'supportingFile', 'typed', 'linkedinPaste', 'localDictation', 'careerNote', 'applicantEdit']),
    version: z.literal(1), hash: digest, quote: z.string().max(10_000), quoteHash: digest, locator: z.string().max(1000),
  }).strict(),
  confirmation: z.object({ version, textHash: digest, confirmedAt: z.string().datetime().nullable() }).strict().nullable(),
}).strict();

export const tailorRequestSchema = z.object({
  schemaVersion: z.literal(1),
  allowedOperations: z.tuple([z.literal('replaceParagraphText')]),
  requestId: id,
  context: contextSchema,
  consent: z.object({ confirmed: z.literal(true), contextHash: digest }).strict(),
  job: z.object({ title: z.string().max(500), company: z.string().max(500), description: z.string().min(1).max(50_000) }).strict(),
  facts: z.array(selectedFactSchema).min(1).max(100),
  blocks: z.array(z.object({
    id, text: boundedText, textHash: digest,
    requiredFactIds: z.array(id).min(1).max(20), layoutBudget: layoutBudgetSchema,
  }).strict()).min(1).max(100),
}).strict().superRefine((value, ctx) => {
  const addIssue = () => ctx.addIssue({ code: 'custom', message: 'Invalid bounded request.' });
  if (new Set(value.facts.map(fact => fact.id)).size !== value.facts.length ||
      new Set(value.blocks.map(block => block.id)).size !== value.blocks.length) addIssue();
  if (!value.job.description.trim()) addIssue();
  if (value.facts.some(fact => fact.assertionId !== null) && value.context.memorySnapshotId === null) addIssue();
  for (const fact of value.facts) {
    if (fact.textHash !== hashText(fact.text) || fact.source.quoteHash !== hashText(fact.source.quote)) addIssue();
    if (fact.confirmation && (fact.confirmation.version !== fact.version || fact.confirmation.textHash !== fact.textHash)) addIssue();
    if (fact.kind === 'resume') {
      if (fact.version !== 1 || fact.assertionId !== null || fact.confirmation !== null || fact.source.kind !== 'resume' || fact.source.quote !== fact.text) addIssue();
    } else {
      if (!fact.confirmed || fact.confirmation === null) addIssue();
      if (fact.assertionId === null) {
        if (fact.version !== 1 || fact.source.kind !== fact.kind || fact.source.id !== fact.id ||
            fact.source.hash !== fact.textHash || fact.source.quoteHash !== fact.textHash || fact.source.quote !== fact.text) addIssue();
      } else if (fact.kind !== 'careerNote' || !assertionSourceKinds.has(fact.source.kind) || fact.confirmation?.confirmedAt == null) addIssue();
    }
  }
  if (value.blocks.some(block => block.textHash !== hashText(block.text))) addIssue();
  const selectedFacts = new Set(value.facts.map(fact => fact.id));
  if (value.blocks.some(block => new Set(block.requiredFactIds).size !== block.requiredFactIds.length ||
      block.requiredFactIds.some(factId => !selectedFacts.has(factId)) || !block.text.trim() ||
      block.layoutBudget.maxCharacters > block.text.length ||
      block.layoutBudget.maxLines !== Math.max(1, Math.floor(block.layoutBudget.heightPt / block.layoutBudget.lineHeightPt)))) addIssue();
  const textLength = value.job.title.length + value.job.company.length + value.job.description.length +
    value.facts.reduce((total, fact) => total + fact.text.length + fact.source.quote.length + fact.source.locator.length, 0) +
    value.blocks.reduce((total, block) => total + block.text.length, 0);
  if (textLength > 100_000) addIssue();
});

export const proposalsSchema = z.object({
  proposals: z.array(z.object({
    blockId: id,
    beforeText: z.string().max(10_000),
    afterText: boundedText,
    factIds: z.array(id).min(1).max(20),
    reason: z.string().min(1).max(1000),
  }).strict()).max(20),
}).strict();

/** Matches core/model.ts canonicalJson; arrays preserve the reviewed order. */
export function canonicalJson(value) {
  function sort(input) {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input)
      .filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sort(item)]));
    return input;
  }
  return JSON.stringify(sort(value));
}

export function consentHash(request) {
  const { schemaVersion, allowedOperations, requestId, context, job, facts, blocks } = request;
  return hashText(canonicalJson({ schemaVersion, allowedOperations, requestId, context, job, facts, blocks }));
}

/** All provenance and edit metadata is server-derived after provider validation. */
export function annotateProposals(proposals, request) {
  const facts = new Map(request.facts.map(fact => [fact.id, fact]));
  return proposals.map(proposal => ({
    ...proposal, operation: 'replaceParagraphText', beforeHash: hashText(proposal.beforeText), afterHash: hashText(proposal.afterText),
    factRefs: proposal.factIds.map(factId => {
      const fact = facts.get(factId);
      return {
        factId, version: fact.version, assertionId: fact.assertionId,
        sourceId: fact.source.id, sourceVersion: fact.source.version, sourceHash: fact.source.hash,
        quoteHash: fact.source.quoteHash, textHash: fact.textHash,
      };
    }),
  }));
}

/** This validates references, not semantic entailment; all output needs review.
 * A proposal that breaks a rule is dropped on its own; the rest are kept. */
export function validateProposals(value, request) {
  const parsed = proposalsSchema.safeParse(value);
  if (!parsed.success) { console.error('validateProposals', 'schema'); return null; }
  const blockMap = new Map(request.blocks.map(block => [block.id, block.text]));
  const facts = new Set(request.facts.map(fact => fact.id));
  const factMap = new Map(request.facts.map(fact => [fact.id, fact]));
  const suppliedBlocks = new Map(request.blocks.map(block => [block.id, block]));
  const proposedBlocks = new Set(), kept = [], dropped = {};
  const drop = tag => { dropped[tag] = (dropped[tag] ?? 0) + 1; };
  for (const proposal of parsed.data.proposals) {
    if (proposedBlocks.has(proposal.blockId) || !blockMap.has(proposal.blockId) ||
        proposal.beforeText !== blockMap.get(proposal.blockId) || proposal.afterText === proposal.beforeText ||
        !proposal.afterText.trim() || new Set(proposal.factIds).size !== proposal.factIds.length ||
        proposal.factIds.some(factId => !facts.has(factId))) { drop('reference'); continue; }
    const target = suppliedBlocks.get(proposal.blockId);
    if (target.requiredFactIds.some(factId => !proposal.factIds.includes(factId))) { drop('required_fact'); continue; }
    if (proposal.afterText.length > target.layoutBudget.maxCharacters ||
        proposal.afterText.split(/\r\n?|\n/).length > target.layoutBudget.maxLines) { drop('budget'); continue; }
    if (hasUnsupportedNumericClaims(proposal.afterText, proposal.factIds.map(factId => factMap.get(factId)))) { drop('numeric'); continue; }
    proposedBlocks.add(proposal.blockId); kept.push(proposal);
  }
  if (Object.keys(dropped).length) console.error('validateProposals dropped', JSON.stringify(dropped), 'kept', kept.length);
  return kept;
}

/** Provider schema is fixed server-side; local validation enforces tighter bounds. */
export const PROPOSALS_JSON_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['proposals'],
  properties: {
    proposals: { type: 'array', maxItems: 20, items: {
      type: 'object', additionalProperties: false,
      required: ['blockId', 'beforeText', 'afterText', 'factIds', 'reason'],
      properties: {
        blockId: { type: 'string' }, beforeText: { type: 'string' }, afterText: { type: 'string' },
        factIds: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'string' } },
        reason: { type: 'string' },
      },
    } },
  },
};

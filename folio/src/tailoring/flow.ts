import { eligibleEvidence } from '../core/careerMemory';
import { editBlock } from '../core/commands';
import { completedTailoring, saveVersion, setPresentation } from '../core/folio';
import { blockText, newId } from '../core/model';
import type { Project } from '../core/model';
import { renderProjectDocument } from '../render/pdf';
import { aiFormattingIssue, aiProposalFindings, aiRequiredFactIds, aiStatusMessage, canSendAiRequest, createAiClient, prepareAiRequest, reviewedAiRuns, validateAiResult } from './ai';
import type { AiRequest, AiResult } from './ai';

/** Atomic application: every proposal is checked against the same frozen request. */
export async function applyTailoring(project: Project, request: AiRequest, raw: AiResult): Promise<{ project: Project; applied: number; held: number }> {
  const result = validateAiResult(raw, request);
  const permitted = result.proposals.filter(proposal => aiProposalFindings(proposal, request).length === 0 && request.facts.some(fact => proposal.factIds.includes(fact.id) && fact.text === proposal.afterText));
  const held = result.proposals.filter(proposal => !permitted.includes(proposal)).map(proposal => ({ blockId: proposal.blockId, text: proposal.afterText, factIds: proposal.factIds, reason: 'Not applied: this paraphrase cannot be automatically proved equivalent to a complete saved fact. Review the source or edit using your confirmed experience.' }));
  const edits = permitted.map(proposal => ({ id: proposal.blockId, runs: reviewedAiRuns(project, request, result, proposal) }));
  let next = project;
  for (const edit of edits) next = editBlock(next, edit.id, edit.runs);
  const rendered = await renderProjectDocument(next, 'current');
  if (rendered.layout.overflows.length) throw new Error('The proposed wording does not fit your original layout. Your saved draft is unchanged.');
  next = setPresentation(next, {held});
  // Source support establishes attribution, not the applicant's review of this
  // arrangement of facts. Every changed draft still needs explicit confirmation.
  next = completedTailoring(next, request.requestId);
  next = saveVersion(next, 'firstResult');
  return { project: next, applied: edits.length, held: result.proposals.length - edits.length };
}
export async function runTailoring(project: Project, consent: boolean, signal: AbortSignal, onPhase: (phase: string) => void, client = createAiClient()) {
  if(signal.aborted)throw new Error('Tailoring cancelled. Your saved draft is unchanged.');
  if (!consent) throw new Error('Review the AI & privacy disclosure and allow this job’s transfer before tailoring.');
  if (/^https?:\/\/\S+$/i.test(project.job.description.trim())) throw new Error('A job-link reader is not configured. Paste the responsibilities and requirements from the posting; your link is kept.');
  if (!project.job.description.trim()) throw new Error('Add the role’s responsibilities and requirements.');
  onPhase('Reading the job');
  const status = await client.status(signal);
  if(signal.aborted)throw new Error('Tailoring cancelled. Your saved draft is unchanged.');
  if (!canSendAiRequest(status)) throw new Error(aiStatusMessage(status));
  const facts = eligibleEvidence(project).slice(0, 100), ids = new Set(facts.map(fact => fact.id));
  const blocks = project.draft.blocks.filter(block => blockText(block).trim() && !aiFormattingIssue(project, block.id) && aiRequiredFactIds(project, block.id).every(id => ids.has(id))).slice(0, 100);
  if (!blocks.length) throw new Error('This template has no safely editable AI targets. Your original stays intact; use the supported editor or rebuild from original.');
  const request = prepareAiRequest(project, facts.map(fact => fact.id), blocks.map(block => block.id), newId());
  onPhase('Tailoring supported content');
  const result = await client.tailor(request, { status, consentHash: request.consent.contextHash, signal });
  if (signal.aborted) throw new Error('Tailoring cancelled. Your saved draft is unchanged.');
  onPhase('Checking layout');
  return applyTailoring(project, request, result);
}

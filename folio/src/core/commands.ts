import {licensedInputRunsAllowed} from './licensed-edit';
import {type1EditableRegions,type1LineProgram} from './type1-baseline';
import { FolioError } from './errors';
import { blockText, canonicalJson, exportProblems, hashJson, newId, rendererVersionFor, safeHref, documentScopedProgramHashes, hasValidApproval, SOURCE_FONT_REUSE_POLICY } from './model';
import type { EvidenceDecision, JobContext, Project, RenderedDocument, TextRun } from './model';
import { eligibleEvidence } from './careerMemory';

function advance(project: Project, patch: Partial<Project>): Project {
  return { ...project, ...patch, revision: project.revision + 1, updatedAt: new Date().toISOString() };
}
export async function approveTemplate(project: Project, acknowledgedWarningIds: string[], fontReuse?:{sourceSha256:string;originalProgramSha256s:string[];accepted:true}): Promise<Project> {
  if (project.template.warnings.some(w => w.severity === 'blocking')) throw new FolioError('UNSUPPORTED_TEMPLATE', 'This import has an unsupported feature. Export a simpler PDF or repair the original and upload again.');
  if (project.template.warnings.some(w => w.severity === 'review' && !acknowledgedWarningIds.includes(w.id))) throw new FolioError('REVIEW_WARNINGS', 'Review each reconstruction warning before approving the template.');
  const programHashes=documentScopedProgramHashes(project.template);
  if(programHashes.length&&(!fontReuse||fontReuse.accepted!==true||fontReuse.sourceSha256!==project.source.sha256||canonicalJson(fontReuse.originalProgramSha256s)!==canonicalJson(programHashes)))throw new FolioError('SOURCE_FONT_REUSE_REQUIRED','Confirm permission to reuse this resume’s embedded fonts before editing or downloading.');
  const [layoutHash, baselineHash] = await Promise.all([hashJson(project.template), hashJson(project.baseline.blocks)]);
  return advance(project, { approval: {
    templateId: project.template.id, templateRevision: project.template.revision,
    layoutHash, baselineHash, rendererVersion: rendererVersionFor(project.template),
    ...(programHashes.length?{sourceFontReuse:{policyVersion:SOURCE_FONT_REUSE_POLICY,sourceSha256:project.source.sha256,originalProgramSha256s:programHashes,attestedAt:new Date().toISOString()}}:{}),
    acknowledgedWarnings: acknowledgedWarningIds, approvedAt: new Date().toISOString(),
  }, reviewedDraftRevision: null });
}
export function editBlock(project: Project, blockId: string, runs: TextRun[]): Project {
  if(project.template.sourceType1Baseline){const owner=type1EditableRegions(project.template).find(r=>r.contentId===blockId);if(!owner)throw new FolioError('PDF_TYPE1_BASELINE','This Type 1 text has no proved editable owner. Choose one of the proved original lines to edit.');type1LineProgram(project.template,runs,owner.sourceLocator);}
  if(documentScopedProgramHashes(project.template).length&&!hasValidApproval(project))throw new FolioError('SOURCE_FONT_REUSE_REQUIRED','Approve the current embedded font reuse before editing.');
  const region=project.template.pages.flatMap(p=>p.regions).find(r=>r.kind==='text'&&r.contentId===blockId);
  if(region?.kind==='text'&&project.template.sourceFonts?.some(f=>f.id===region.style.sourceFontId&&f.sourceVersion===7)&&runs.some(r=>r.bold===true||r.italic===true))throw new FolioError('SOURCE_DOCUMENT_FONT_STYLE','This document font cannot switch bold or italic faces.');
  if(region?.kind==='text'&&project.template.sourceFonts?.some(f=>f.id===region.style.sourceFontId&&f.sourceVersion===8)){
    if(!hasValidApproval(project))throw new FolioError('SOURCE_TEMPLATE_APPROVAL','Approve the reconstructed template before editing a licensed subset paragraph.');
    if(!licensedInputRunsAllowed(project,region,runs))throw new FolioError('PDF_LICENSED_CONTENT','Use covered characters in one unlinked source paragraph with its original formatting and evidence.');
  }
  if(region?.kind==='text'&&region.style.sourceStandardFontId){if(!hasValidApproval(project))throw new FolioError('SOURCE_TEMPLATE_APPROVAL','Approve the original standard template before editing.');const font=project.template.sourceStandardFonts?.find(f=>f.id===region.style.sourceStandardFontId);if(!font||runs.some(r=>(r.bold??region.style.fontWeight===700)!==(region.style.fontWeight===700)||(r.italic??region.style.italic)!==region.style.italic))throw new FolioError('PDF_STANDARD_FONT','Retain the original standard font face and its bold and italic style.');}
  const target = project.draft.blocks.find(block => block.id === blockId);
  if (!target) throw new FolioError('UNKNOWN_BLOCK', 'This paragraph is no longer available.');
  const textLength = runs.reduce((length, run) => length + run.text.length, 0);
  if (textLength > 10000) throw new FolioError('TEXT_TOO_LONG', 'Keep a paragraph below 10,000 characters.');
  const factIds = new Set(project.facts.map(fact => fact.id));
  const cleaned = runs.map(run => ({
    text: run.text.replace(/\r\n?/g, '\n'),
    ...(run.bold !== undefined ? { bold: run.bold } : {}), ...(run.italic !== undefined ? { italic: run.italic } : {}),
    ...(run.underline ? { underline: true } : {}),
    ...(run.href && safeHref(run.href) ? { href: safeHref(run.href) } : {}),
    ...(run.sourceFactIds ? { sourceFactIds: run.sourceFactIds.filter(id => factIds.has(id)) } : {}),
  }));
  if (JSON.stringify(target.runs) === JSON.stringify(cleaned)) return project;
  const explicit = [...new Set(cleaned.flatMap(run => run.sourceFactIds ?? []))];
  const blocks = project.draft.blocks.map(block => block.id === blockId ? {
    ...block, runs: cleaned, sourceFactIds: explicit.length ? explicit : block.sourceFactIds,
  } : block);
  return advance(project, { draft: { revision: project.draft.revision + 1, blocks }, reviewedDraftRevision: null });
}
export function setJob(project: Project, job: JobContext): Project {
  if (job.description.length > 50000) throw new FolioError('JD_TOO_LONG', 'Keep the job description below 50,000 characters.');
  return advance(project, { job: { title: job.title.slice(0, 300), company: job.company.slice(0, 300), description: job.description }, reviewedDraftRevision: null });
}
export function addCareerNote(project: Project, text: string): Project {
  const value = text.trim();
  if (!value || value.length > 10000) throw new FolioError('NOTE_INVALID', 'Add a career fact between 1 and 10,000 characters.');
  const id = newId();
  return advance(project, {
    notes: [...project.notes, { id, text: value, confirmed: true }],
    facts: [...project.facts, { id, text: value, kind: 'careerNote', locator: 'Applicant-confirmed career note', confirmed: true }],
    reviewedDraftRevision: null,
  });
}
export function removeCareerNote(project: Project, noteId: string): Project {
  const cited = project.draft.blocks.some(block => block.sourceFactIds.includes(noteId));
  if (cited) throw new FolioError('NOTE_IN_USE', 'This fact supports the current draft. Revert or edit the supported paragraph before deleting it.');
  const evidenceDecisions = { ...project.evidenceDecisions }; delete evidenceDecisions[noteId];
  return advance(project, { notes: project.notes.filter(note => note.id !== noteId), facts: project.facts.filter(fact => fact.id !== noteId), evidenceDecisions, reviewedDraftRevision: null });
}
export function evidenceInsertionCurrent(project: Project, decision: EvidenceDecision): boolean {
  return decision.status === 'accepted' && !!decision.insertions?.length && decision.insertions.every(insertion => {
    const current = project.draft.blocks.find(block => block.id === insertion.blockId);
    return current && canonicalJson(current) === canonicalJson(insertion.after);
  });
}
export function insertEvidence(project: Project, factId: string, blockId: string): Project {
  const fact = eligibleEvidence(project).find(item => item.id === factId);
  const before = project.draft.blocks.find(block => block.id === blockId);
  if (!fact || !before) throw new FolioError('EVIDENCE_MISSING', 'This source or paragraph is no longer available. Review the current evidence again.');
  if (!project.facts.some(item => item.id === fact.id)) project = { ...project, facts: [...project.facts, fact] };
  const prior = project.evidenceDecisions[factId];
  const existing = prior?.status === 'accepted' ? prior.insertions?.find(item => item.blockId === blockId) : undefined;
  if (existing && canonicalJson(before) === canonicalJson(existing.after)) return project;
  if (existing) throw new FolioError('EVIDENCE_CHANGED', 'This fact has an earlier insertion in this paragraph. Undo or dismiss the newer paragraph changes before inserting it again. Your draft is unchanged.');
  const edited = editBlock(project, blockId, [{ text: fact.text, sourceFactIds: [fact.id] }]);
  const after = edited.draft.blocks.find(block => block.id === blockId)!;
  const insertions = [...(prior?.status === 'accepted' ? prior.insertions ?? [] : []).filter(item => item.blockId !== blockId), { blockId, before: structuredClone(before), after: structuredClone(after) }];
  const evidenceDecisions = { ...project.evidenceDecisions, [factId]: { status: 'accepted' as const, blockId, insertions } };
  return edited === project ? advance(project, { evidenceDecisions, reviewedDraftRevision: null }) : { ...edited, evidenceDecisions };
}
export function dismissEvidence(project: Project, factId: string): Project {
  if (!project.facts.some(fact => fact.id === factId)) throw new FolioError('EVIDENCE_MISSING', 'This source is no longer available.');
  const decision = project.evidenceDecisions[factId];
  let draft = project.draft;
  if (decision?.status === 'accepted') {
    if (!evidenceInsertionCurrent(project, decision)) throw new FolioError('EVIDENCE_CHANGED', 'The paragraph changed after this insertion. Your later edits are preserved. Undo the newer paragraph changes before dismissing this evidence.');
    const facts = new Set(project.facts.map(fact => fact.id));
    if (decision.insertions!.some(item => [...item.before.sourceFactIds, ...item.before.runs.flatMap(run => run.sourceFactIds ?? [])].some(id => !facts.has(id)))) throw new FolioError('EVIDENCE_CHANGED', 'The earlier paragraph has evidence that was removed. Review its wording manually; the current draft is unchanged.');
    const previous = new Map(decision.insertions!.map(item => [item.blockId, item.before]));
    draft = { revision: draft.revision + 1, blocks: draft.blocks.map(block => previous.has(block.id) ? structuredClone(previous.get(block.id)!) : block) };
  }
  return advance(project, { draft, evidenceDecisions: { ...project.evidenceDecisions, [factId]: { status: 'rejected', blockId: decision?.blockId ?? '' } }, reviewedDraftRevision: null });
}
export function confirmDraft(project: Project): Project {
  const facts = [...project.facts];
  const baseline = new Map(project.baseline.blocks.map(block => [block.id, blockText(block)]));
  const blocks = project.draft.blocks.map(block => {
    const text = blockText(block);
    if (!text.trim() || baseline.get(block.id) === text) return block;
    let fact = facts.find(candidate => candidate.text === text && candidate.confirmed);
    if (!fact) {
      fact = { id: newId(), text, kind: 'applicantEdit', locator: `Applicant-confirmed canvas paragraph ${block.id}`, confirmed: true };
      facts.push(fact);
    }
    return { ...block, sourceFactIds: [fact.id], runs: block.runs.map(run => ({ ...run, sourceFactIds: [fact.id] })) };
  });
  // Keep the same draft object when nothing needed new evidence, so a confirmation
  // does not invalidate the layout check and PDF review the applicant just completed.
  const unchanged = blocks.every((block, index) => block === project.draft.blocks[index]);
  return advance(project, { facts, draft: unchanged ? project.draft : { ...project.draft, blocks }, reviewedDraftRevision: project.draft.revision });
}
export function revertDraft(project: Project): Project {
  return advance(project, { draft: { revision: project.draft.revision + 1, blocks: structuredClone(project.baseline.blocks) }, evidenceDecisions: {}, reviewedDraftRevision: null });
}
export function withdrawApproval(project: Project): Project {
  return advance(project, { approval: null, reviewedDraftRevision: null });
}
export async function validateExport(project: Project, render: RenderedDocument | null): Promise<void> {
  const problems = exportProblems(project, render);
  if (problems.length) throw new FolioError('EXPORT_NOT_READY', problems[0]);
  const approval = project.approval!;
  const [layoutHash, baselineHash] = await Promise.all([hashJson(project.template), hashJson(project.baseline.blocks)]);
  if (layoutHash !== approval.layoutHash || baselineHash !== approval.baselineHash) throw new FolioError('APPROVAL_STALE', 'The template changed. Compare and approve it again.');
  const ids = new Set([...eligibleEvidence(project), ...project.facts.filter(fact => fact.kind === 'applicantEdit' && fact.confirmed)].map(fact => fact.id));
  for (const block of project.draft.blocks) {
    if (blockText(block).trim() && (!block.sourceFactIds.length || block.sourceFactIds.some(id => !ids.has(id)))) throw new FolioError('EVIDENCE_MISSING', 'A paragraph has no valid applicant evidence. Review and confirm the draft again.');
  }
}

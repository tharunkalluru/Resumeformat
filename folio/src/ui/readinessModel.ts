import { blockText, type Overflow, type Project } from '../core/model';

export type ReadinessAction =
  | { kind: 'template' | 'save' | 'canvas' | 'pdf' | 'claims' | 'download' }
  | { kind: 'region'; pageId: string; regionId: string; blockId?: string }
  | { kind: 'sources'; blockId: string };

/** All values describe the live app revision. This is a presentation model,
 * never a replacement for validateExport or the current PDF receipt checks. */
export interface ExportReadinessState {
  approved: boolean;
  currentSaved: boolean;
  saveStatus: string;
  composition: boolean;
  renderStatus: string;
  renderCurrent: boolean;
  canvasCheckCurrent: boolean;
  overflows: readonly Overflow[];
  layoutIssueRegionIds: readonly string[];
  unprovedBlockIds: readonly string[];
  pdfInspected: boolean;
  claimsConfirmed: boolean;
  exportReady: boolean;
  exportProblems: readonly string[];
}

export interface ReadinessItem {
  id: string;
  title: string;
  detail: string;
  actionLabel: string;
  action: ReadinessAction;
  kind: 'required' | 'review';
}

export function locateBlock(project: Project, blockId: string): Extract<ReadinessAction, { kind: 'region' }> | undefined {
  for (const page of project.template.pages) {
    const region = page.regions.find(region => region.kind === 'text' && region.contentId === blockId);
    if (region?.kind === 'text') return { kind: 'region', pageId: page.id, regionId: region.id, blockId };
  }
}

export function exportReadinessItems(project: Project, state: ExportReadinessState): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const add = (id: string, title: string, detail: string, actionLabel: string, action: ReadinessAction, kind: ReadinessItem['kind'] = 'required') => items.push({ id, title, detail, actionLabel, action, kind });
  if (!state.approved) add('approval', 'Compare and approve your template', 'Inspect the reconstructed pages against your original resume.', 'Compare template', { kind: 'template' });
  if (!state.currentSaved) add('saved', state.saveStatus === 'error' ? 'This draft has not saved' : 'Save the current draft', 'Keep the current revision on this device before exporting.', state.saveStatus === 'error' ? 'Retry saving' : 'Save now', { kind: 'save' });
  if (state.composition) add('composition', 'Finish entering text', 'Complete the active text entry before checking the document.', 'Return to editing', { kind: 'canvas' });
  if (!state.renderCurrent || state.renderStatus !== 'ready') add('render', state.renderStatus === 'error' ? 'The document could not be rendered' : 'Check the latest document layout', 'The PDF must be rendered from the current draft revision.', 'Open document', { kind: 'canvas' });
  if (!state.canvasCheckCurrent) add('canvas', 'Check the current editable canvas', 'The current text and line positions have not completed their canvas check.', 'Check canvas', { kind: 'canvas' });
  // A stale render's issues cannot be presented as observations of this draft.
  if (state.renderCurrent) {
    state.overflows.forEach((issue, index) => {
      const pageNumber = project.template.pages.findIndex(page => page.id === issue.pageId) + 1;
      const region = project.template.pages.flatMap(page => page.regions).find(region => region.id === issue.regionId);
      add(`fit:${issue.regionId}:${index}`, `${pageNumber > 0 ? `Page ${pageNumber}: ` : ''}${issue.code === 'height' || issue.code === 'width' ? 'text needs more room' : 'layout needs attention'}`, issue.message, 'Go to paragraph', { kind: 'region', pageId: issue.pageId, regionId: issue.regionId, ...(region?.kind === 'text' ? { blockId: region.contentId } : {}) });
    });
    if (state.canvasCheckCurrent) [...new Set(state.layoutIssueRegionIds)].forEach(regionId => {
      const page = project.template.pages.find(page => page.regions.some(region => region.id === regionId));
      const region = page?.regions.find(region => region.id === regionId);
      add(`line:${regionId}`, 'Canvas and PDF lines need review', 'This region did not pass the current line-layout check. Inspect its wording and supported formatting.', 'Inspect line layout', page ? { kind: 'region', pageId: page.id, regionId, ...(region?.kind === 'text' ? { blockId: region.contentId } : {}) } : { kind: 'canvas' });
    });
  }
  // Linked sources are a review signal. Applicant confirmation remains governed
  // by the existing domain commands, not a new inferred qualification score.
  [...new Set(state.unprovedBlockIds)].forEach(blockId => {
    const text = project.draft.blocks.find(block => block.id === blockId);
    add(`source:${blockId}`, 'Review the evidence for this wording', text ? blockText(text).slice(0, 180) : 'This paragraph needs source review.', 'Review source', { kind: 'sources', blockId }, 'review');
  });
  if (!state.pdfInspected) add('pdf', 'Inspect every page of the current PDF', 'Edits and claim confirmation can change the PDF. Review the latest pages before downloading.', 'Review current PDF', { kind: 'pdf' });
  if (!state.claimsConfirmed) add('claims', 'Confirm the current draft’s claims', 'Review the wording and confirm that every claim is accurate.', 'Review claims', { kind: 'claims' });
  // Keep every canonical refusal visible. Known messages have a richer action
  // above; unknown or future guard failures remain fail-closed and actionable.
  const represented = new Set([
    ...(!state.approved ? ['Approve the reconstructed template first.'] : []),
    ...(!state.claimsConfirmed ? ['Review and confirm the current draft.'] : []),
    ...(!state.renderCurrent ? ['Wait for the current document layout.'] : []),
    ...(state.renderCurrent && state.overflows.length ? ['Resolve the visible layout issues before export.'] : []),
  ]);
  state.exportProblems.filter(problem => !represented.has(problem)).forEach((problem, index) => {
    const templateProblem = /template|unsupported features/i.test(problem);
    add(`guard:${index}`, 'Resolve this export check', problem, templateProblem ? 'Inspect template' : 'Review document', { kind: templateProblem ? 'template' : 'canvas' });
  });
  if (!state.exportReady && items.every(item => item.kind !== 'required')) add('guard:pending', 'The current export is not ready', 'A current save, layout or PDF review check is still pending. Open the document to review its status.', 'Review document', { kind: 'canvas' });
  return items;
}

export interface ReadablePassage {
  regionId: string; blockId: string; pageId: string; text: string;
  order: number; role: string; baselineOnly: boolean;
}
export function inspectDocumentReadability(project: Project) {
  const blocks = new Map(project.draft.blocks.map(block => [block.id, block]));
  const pages = project.template.pages.map((page, index) => {
    const passages: ReadablePassage[] = page.regions
      .filter(region => region.kind === 'text')
      .sort((a, b) => a.order - b.order)
      .map(region => ({ regionId: region.id, blockId: region.contentId, pageId: page.id,
        text: blocks.has(region.contentId) ? blockText(blocks.get(region.contentId)!) : '',
        order: region.order, role: region.role,
        baselineOnly: !!region.sourceLayout && 'editPolicy' in region.sourceLayout && region.sourceLayout.editPolicy === 'baselineOnly' }));
    return { pageId: page.id, number: index + 1, passages,
      images: page.regions.filter(region => region.kind === 'image').length,
      shapes: page.regions.filter(region => region.kind === 'sourceShape').length,
      missingText: passages.filter(passage => !passage.text.trim()).length,
      uncertainCharacters: passages.filter(passage => /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(passage.text)).length,
      warnings: project.template.warnings.filter(warning => warning.pageId === page.id) };
  });
  return { pages, characters: pages.reduce((sum, page) => sum + page.passages.reduce((count, passage) => count + passage.text.length, 0), 0),
    globalWarnings: project.template.warnings.filter(warning => !warning.pageId),
    originalPaint: !!project.template.sourceType1Baseline };
}

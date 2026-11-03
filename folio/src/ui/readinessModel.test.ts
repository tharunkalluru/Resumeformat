import { describe, expect, it } from 'vitest';
import type { Project, TextRegion } from '../core/model';
import { exportReadinessItems, inspectDocumentReadability, locateBlock, type ExportReadinessState } from './readinessModel';

const region = (id: string, contentId: string, order: number, pageId = 'page-1'): TextRegion => ({
  kind: 'text', id, contentId, pageId, order, role: 'body', sourceLocator: `Authored ${id}`,
  bounds: { x: 20, y: 20, width: 200, height: 30 },
  style: { fontFamily: 'sans', fontSize: 11, lineHeight: 13, color: '#000000', fontWeight: 400, italic: false, alignment: 'left' },
});
function authoredProject(): Project {
  return {
    id: 'authored-resume', draft: { revision: 2, blocks: [
      { id: 'body', runs: [{ text: 'Led a fictional community project.' }], sourceFactIds: [] },
      { id: 'heading', runs: [{ text: 'Alex Example' }], sourceFactIds: [] },
    ] }, template: { revision: 1, pages: [
      { id: 'page-1', width: 612, height: 792, regions: [region('body-region', 'body', 2), region('heading-region', 'heading', 1)] },
      { id: 'page-2', width: 612, height: 792, regions: [] },
    ], warnings: [] },
  } as unknown as Project;
}
const complete: ExportReadinessState = { approved: true, currentSaved: true, saveStatus: 'saved', composition: false, renderStatus: 'ready', renderCurrent: true, canvasCheckCurrent: true, overflows: [], layoutIssueRegionIds: [], unprovedBlockIds: [], pdfInspected: true, claimsConfirmed: true, exportReady: true, exportProblems: [] };

describe('export readiness navigation', () => {
  it('never treats a diagnostic checklist as authority to export', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, exportReady: false });
    expect(items).toEqual([expect.objectContaining({ id: 'guard:pending', kind: 'required', action: { kind: 'canvas' } })]);
    expect(items.some(item => item.action.kind === 'download')).toBe(false);
  });
  it('preserves unknown canonical guard failures with a review action', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, exportReady: false, exportProblems: ['Current source fingerprint differs from the rendered PDF.'] });
    expect(items).toHaveLength(1);
    expect(items[0].detail).toContain('fingerprint');
    expect(items[0].action.kind).toBe('canvas');
  });
  it('takes overflow and line discrepancies to their exact current region', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, exportReady: false,
      overflows: [{ pageId: 'page-1', regionId: 'body-region', code: 'height', message: 'Two lines exceed the retained paragraph.' }],
      layoutIssueRegionIds: ['heading-region', 'heading-region'] });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Page 1: text needs more room', action: { kind: 'region', pageId: 'page-1', regionId: 'body-region', blockId: 'body' } });
    expect(items[1].action).toMatchObject({ regionId: 'heading-region', blockId: 'heading' });
  });
  it('does not display stale render or canvas observations as current defects', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, renderCurrent: false, canvasCheckCurrent: false, exportReady: false,
      overflows: [{ pageId: 'old-page', regionId: 'old-region', code: 'width', message: 'Old issue' }], layoutIssueRegionIds: ['old-region'] });
    expect(items.map(item => item.id)).toEqual(['render', 'canvas']);
    expect(items.some(item => item.detail === 'Old issue')).toBe(false);
  });
  it('keeps source support and explicit applicant confirmation separate', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, unprovedBlockIds: ['body'], claimsConfirmed: false, exportReady: false });
    expect(items.find(item => item.id === 'source:body')).toMatchObject({ kind: 'review', action: { kind: 'sources', blockId: 'body' } });
    expect(items.find(item => item.id === 'claims')).toMatchObject({ kind: 'required', action: { kind: 'claims' } });
    expect(exportReadinessItems(authoredProject(), { ...complete, unprovedBlockIds: ['body'] })[0].kind).toBe('review');
  });
  it('shows saving, composition, PDF inspection and approval actions independently', () => {
    const items = exportReadinessItems(authoredProject(), { ...complete, approved: false, currentSaved: false, saveStatus: 'error', composition: true, pdfInspected: false, exportReady: false });
    expect(items.map(item => item.action.kind)).toEqual(['template', 'save', 'canvas', 'pdf']);
    expect(items[1].actionLabel).toBe('Retry saving');
  });
});

describe('local extracted-text inspection', () => {
  it('uses the stored region order and actual current text without mutating the template', () => {
    const project = authoredProject(), before = JSON.stringify(project);
    const report = inspectDocumentReadability(project);
    expect(report.pages[0].passages.map(passage => passage.text)).toEqual(['Alex Example', 'Led a fictional community project.']);
    expect(JSON.stringify(project)).toBe(before);
    expect(locateBlock(project, 'body')).toEqual({ kind: 'region', pageId: 'page-1', regionId: 'body-region', blockId: 'body' });
    expect(locateBlock(project, 'missing')).toBeUndefined();
  });
  it('keeps empty pages, images, read-only spans and extraction warnings visible', () => {
    const project = authoredProject();
    (project.template.pages[0].regions[0] as TextRegion).sourceLayout = { version: 4, editPolicy: 'baselineOnly' } as TextRegion['sourceLayout'];
    project.template.pages[0].regions.push({ kind: 'image', id: 'portrait', pageId: 'page-1', order: 3 } as never);
    project.template.warnings.push({ id: 'warning', code: 'source-order', severity: 'review', message: 'Inspect imported reading order.', pageId: 'page-1' });
    project.draft.blocks[0].runs[0].text = 'Unrecognized \uFFFD text';
    const report = inspectDocumentReadability(project);
    expect(report.pages[0]).toMatchObject({ images: 1, uncertainCharacters: 1 });
    expect(report.pages[0].passages[1].baselineOnly).toBe(true);
    expect(report.pages[0].warnings[0].message).toBe('Inspect imported reading order.');
    expect(report.pages[1].passages).toEqual([]);
  });
});

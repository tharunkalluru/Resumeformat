import { describe, expect, it } from 'vitest';
import { makeProject, rendererVersionFor, type Project, type RenderedDocument, type TextRegion } from '../core/model';
import { comparisonGeometry, currentInspectionRender, inspectionOwner, templateDiagnostics, templateSupport, type ObservedPreview } from './templateDiagnostics';
import { previewOwnerKey, type PreviewStamp } from './previewReview';

/** Authored geometry only. No source parsing, pixel fidelity or font qualification is asserted. */
function fixture(): Project {
  return makeProject({ source: { id: 'source', name: 'Authored.pdf', format: 'pdf', bytes: new Uint8Array([1, 2]), sha256: 'authored-source', sourcePageCount: 1 },
    assets: [], facts: [], baseline: { revision: 1, blocks: [{ id: 'body', sourceFactIds: [], runs: [{ text: 'Authored career detail.' }] }] },
    template: { id: 'template', revision: 1, importerVersion: 'authored', warnings: [], pages: [{ id: 'p1', width: 612, height: 792, regions: [{
      kind: 'text', id: 'r1', pageId: 'p1', order: 0, bounds: { x: 40, y: 60, width: 500, height: 30 }, contentId: 'body', role: 'body', sourceLocator: 'Authored',
      style: { fontFamily: 'sans', fontSize: 12, fontWeight: 400, italic: false, color: '#000000', lineHeight: 15, alignment: 'left' },
    }] }] } });
}
function renderOf(project: Project): RenderedDocument {
  return { bytes: new Uint8Array([3, 4]), layout: { regions: [], overflows: [] }, contentRevision: project.baseline.revision, rendererVersion: rendererVersionFor(project.template) };
}
function stampOf(project: Project, render: RenderedDocument): PreviewStamp {
  return { ...inspectionOwner(project, 'baseline'), bytes: render.bytes, scale: 1.5 };
}
function observations(project: Project, render: RenderedDocument): [ObservedPreview, ObservedPreview] {
  return (['source', 'baseline'] as const).map(purpose => ({ receipt: { ownerKey: previewOwnerKey(inspectionOwner(project, purpose)), bytes: purpose === 'source' ? project.source.bytes : render.bytes,
    page: 1, scale: 1.5, state: 'ready' as const }, width: 918, height: 1188 })) as [ObservedPreview, ObservedPreview];
}

describe('template inspection guidance', () => {
  it('distinguishes structured editing, source-limited editing and explicit baseline-only geometry', () => {
    const project = fixture(); expect(templateSupport(project).kind).toBe('editable');
    const region = project.template.pages[0].regions[0] as TextRegion;
    region.style.sourceStandardFontId = 'standard'; expect(templateSupport(project).kind).toBe('limited');
    region.sourceLayout = { version: 4, sourceSha256: 'source', baselineRunsHash: 'runs', anchor: 'start', startX: 40, endX: 200, baseline: 70, fontSize: 12, glyphs: [], shearX: .1, characterSpacing: 0, editPolicy: 'baselineOnly' };
    expect(templateSupport(project)).toMatchObject({ kind: 'read-only', lockedRegionCount: 1 });
  });
  it('does not infer an editable Type 1 line from an empty or unmatched slot declaration', () => {
    const project = fixture();
    project.template.sourceType1Baseline = { version: 'original-type1-baseline-v1', sourceSha256: 'source', pagePaintSha256s: [], programSha256s: [], baselineSignature: 'baseline' };
    expect(templateSupport(project).kind).toBe('read-only');
    project.template.sourceType1Baseline.editableSlots = [{ pageNumber: 1, sourceLocator: 'missing', operatorIndex: 1, fontResource: 'f', fontProgramSha256: 'f', baselineText: 'x', originalAdvance: 10, spaceAdjustment: 0, maximumWidth: 100, codes: [] }];
    expect(templateSupport(project).kind).toBe('read-only');
    project.template.sourceType1Baseline.editableSlots[0].sourceLocator = 'Authored';
    expect(templateSupport(project).kind).toBe('limited');
    expect(templateSupport(project).description).toContain('Full tailoring isn’t available');
  });
  it('preserves every import message and gives actual region locations to overflow issues', () => {
    const project = fixture(), render = renderOf(project);
    project.template.warnings = [{ id: 'global', code: 'source-note', severity: 'info', message: 'Original source note.' }, { id: 'font', code: 'font', severity: 'review', message: 'Font changed.', regionId: 'r1' }];
    render.layout.overflows.push({ pageId: 'p1', regionId: 'r1', code: 'height', message: 'Needs 40 pt; 30 pt available.', required: 40, available: 30 });
    const issues = templateDiagnostics(project, render);
    expect(issues[0]).toMatchObject({ severity: 'blocking', page: 1, regionId: 'r1', bounds: { x: 40, y: 60, width: 500, height: 30 } });
    expect(issues.map(issue => issue.message)).toEqual(['Needs 40 pt; 30 pt available.', 'Font changed.', 'Original source note.']);
    expect(issues[2].page).toBeNull();
  });
  it('does not invent region geometry for an unknown or inconsistent location', () => {
    const project = fixture(); project.template.warnings = [
      { id: 'unknown', code: 'unknown', severity: 'review', message: 'Unknown region.', regionId: 'missing' },
      { id: 'wrong-page', code: 'unknown', severity: 'review', message: 'Conflicting location.', regionId: 'r1', pageId: 'missing' },
    ];
    for (const issue of templateDiagnostics(project, null)) { expect(issue.page).toBeNull(); expect(issue.bounds).toBeUndefined(); }
  });
  it('reports explicit PDF page count differences without claiming Word pagination', () => {
    const project = fixture(); project.source.sourcePageCount = 2;
    expect(templateDiagnostics(project, null).at(-1)).toMatchObject({ origin: 'pages', severity: 'review' });
    project.source.format = 'docx'; expect(templateDiagnostics(project, null)).toHaveLength(0);
  });
  it('does not mutate originals or turn zero warnings into a fidelity score', () => {
    const project = fixture(), before = structuredClone(project);
    expect(templateDiagnostics(project, null)).toEqual([]); templateSupport(project);
    expect(project).toEqual(before);
  });
});

describe('current reconstruction and rendered comparison identity', () => {
  it('admits only baseline bytes with the matching owner, revision, renderer and receipt scale', () => {
    const project = fixture(), render = renderOf(project), stamp = stampOf(project, render);
    expect(currentInspectionRender(project, render, stamp)).toBe(render);
    for (const changed of [{ ...stamp, projectId: 'other' }, { ...stamp, templateRevision: 2 }, { ...stamp, bytes: new Uint8Array(render.bytes) }, { ...stamp, scale: 2 }]) {
      expect(currentInspectionRender(project, render, changed)).toBeNull();
    }
    for (const changed of [{ ...render, contentRevision: 2 }, { ...render, rendererVersion: 'old' }, { ...render, documentScopedPurpose: 'current' as const }]) {
      expect(currentInspectionRender(project, changed, stamp)).toBeNull();
    }
  });
  it('waits for both current ready canvases; zero placeholder dimensions cannot enable overlays', () => {
    const project = fixture(), render = renderOf(project), [source, baseline] = observations(project, render);
    expect(comparisonGeometry(project, render, 1, null, baseline)).toBe('pending');
    expect(comparisonGeometry(project, render, 1, source, { ...baseline, width: 0 })).toBe('pending');
    expect(comparisonGeometry(project, render, 1, source, { ...baseline, receipt: { ...baseline.receipt, state: 'loading' } })).toBe('pending');
    expect(comparisonGeometry(project, render, 1, source, baseline)).toBe('ready');
  });
  it('rejects stale byte, page, owner and scale receipts even when their raster sizes match', () => {
    const project = fixture(), render = renderOf(project), [source, baseline] = observations(project, render);
    for (const receipt of [{ ...baseline.receipt, bytes: new Uint8Array(render.bytes) }, { ...baseline.receipt, page: 2 }, { ...baseline.receipt, ownerKey: 'old' }, { ...baseline.receipt, scale: 1 }]) {
      expect(comparisonGeometry(project, render, 1, source, { ...baseline, receipt })).toBe('pending');
    }
    expect(comparisonGeometry(project, { ...render, bytes: new Uint8Array([5]) }, 1, source, baseline)).toBe('pending');
  });
  it('exposes a real page-size mismatch without stretching or silently aligning it', () => {
    const project = fixture(), render = renderOf(project), [source, baseline] = observations(project, render);
    expect(comparisonGeometry(project, render, 1, source, { ...baseline, height: 1189 })).toBe('mismatch');
    expect(comparisonGeometry(project, render, 2, source, baseline)).toBe('missing-page');
    project.source.format = 'docx'; expect(comparisonGeometry(project, render, 1, source, baseline)).toBe('docx');
  });
});

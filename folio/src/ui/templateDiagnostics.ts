import { rendererVersionFor, type Project, type Rect, type RenderedDocument, type TextRegion } from '../core/model';
import { type1EditableRegions } from '../core/type1-baseline';
import { previewOwnerCurrent, previewOwnerKey, type PreviewOwner, type PreviewReceipt, type PreviewStamp } from './previewReview';

/** Display guidance only. The renderer, commands and approval gates retain editing authority. */
export interface TemplateSupport {
  kind: 'editable' | 'limited' | 'read-only';
  label: string;
  description: string;
  textRegionCount: number;
  lockedRegionCount: number;
}
export interface TemplateDiagnostic {
  id: string;
  severity: 'info' | 'review' | 'blocking';
  title: string;
  message: string;
  page: number | null;
  regionId?: string;
  bounds?: Rect;
  origin: 'import' | 'layout' | 'fidelity' | 'pages';
}

export function inspectionOwner(project: Project, purpose: 'source' | 'baseline'): PreviewOwner {
  return { purpose, projectId: project.id, sourceSha256: project.source.sha256,
    templateRevision: purpose === 'source' ? 0 : project.template.revision,
    contentRevision: purpose === 'source' ? 0 : project.baseline.revision };
}

/** Neither old draft geometry nor an old source's ready bytes may describe this template. */
export function currentInspectionRender(project: Project, render: RenderedDocument | null, stamp: PreviewStamp | null): RenderedDocument | null {
  if (!render || !stamp || !render.bytes.byteLength || stamp.bytes !== render.bytes || stamp.scale !== 1.5 ||
      !previewOwnerCurrent(stamp, inspectionOwner(project, 'baseline')) ||
      render.contentRevision !== project.baseline.revision || render.rendererVersion !== rendererVersionFor(project.template) ||
      render.documentScopedPurpose && render.documentScopedPurpose !== 'baselinePreview') return null;
  return render;
}

export function templateSupport(project: Project): TemplateSupport {
  const regions = project.template.pages.flatMap(page => page.regions).filter((region): region is TextRegion => region.kind === 'text');
  const total = regions.length;
  if (project.template.sourceType1Baseline) {
    const editable = type1EditableRegions(project.template).length;
    return { kind: editable ? 'limited' : 'read-only', label: editable ? 'Limited editing' : 'Read-only layout',
      description: editable
        ? `${editable} ${editable === 1 ? 'original line has' : 'original lines have'} a bounded wording editor. Use covered characters within the existing frame; full job tailoring is unavailable.`
        : 'The original layout can be inspected. Wording edits and job tailoring are unavailable for this source.',
      textRegionCount: total, lockedRegionCount: Math.max(0, total - editable) };
  }
  const fonts = new Map(project.template.sourceFonts?.map(font => [font.id, font]));
  const locked = regions.filter(region => region.sourceLayout && region.sourceLayout.version !== 1 && region.sourceLayout.editPolicy === 'baselineOnly' ||
    region.style.sourceFontId && (!fonts.has(region.style.sourceFontId) || fonts.get(region.style.sourceFontId)?.sourceVersion === 10)).length;
  if (!total || locked === total) return { kind: 'read-only', label: 'Read-only layout',
    description: total ? 'These text regions preserve their source geometry without a supported wording editor.' : 'No editable text regions were recovered. Review import warnings before continuing.',
    textRegionCount: total, lockedRegionCount: locked };
  const sourceBound = regions.some(region => region.sourceLayout || region.sourceStandardLayout || region.style.sourceFontId || region.style.sourceStandardFontId);
  if (sourceBound || locked || project.template.sourceCompositePages) return { kind: 'limited', label: 'Limited editing',
    description: `Source fonts and fixed text frames restrict changes.${locked ? ` ${locked} ${locked === 1 ? 'text region is' : 'text regions are'} read-only.` : ''} Available editors check supported characters and layout before applying changes. A matching preview does not establish full tailoring support.`,
    textRegionCount: total, lockedRegionCount: locked };
  return { kind: 'editable', label: 'Editable template',
    description: 'Text regions support editing after template approval. New wording must still fit the existing layout and pass the final PDF review.',
    textRegionCount: total, lockedRegionCount: 0 };
}

const validBounds = (bounds: Rect) => [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) && bounds.width > 0 && bounds.height > 0;

export function templateDiagnostics(project: Project, render: RenderedDocument | null): TemplateDiagnostic[] {
  const pages = new Map(project.template.pages.map((page, index) => [page.id, index + 1]));
  const regions = new Map(project.template.pages.flatMap(page => page.regions.map(region => [region.id, region] as const)));
  const location = (pageId?: string, regionId?: string) => {
    const region = regionId ? regions.get(regionId) : undefined;
    const resolvedPage = pageId ?? region?.pageId;
    const bounds = region && (!pageId || region.pageId === pageId) && validBounds(region.bounds) ? region.bounds : undefined;
    return { page: resolvedPage ? pages.get(resolvedPage) ?? null : null, ...(region ? { regionId: region.id } : {}), ...(bounds ? { bounds } : {}) };
  };
  const issues: TemplateDiagnostic[] = project.template.warnings.map(warning => ({ id: `import:${warning.id}`, severity: warning.severity,
    title: warning.fontMapping ? 'Font mapping needs review' : warning.severity === 'blocking' ? 'Unsupported feature' : warning.severity === 'review' ? 'Import detail to review' : 'Import note',
    message: warning.message, ...location(warning.pageId, warning.regionId), origin: 'import' }));
  for (const [index, overflow] of (render?.layout.overflows ?? []).entries()) {
    issues.push({ id: `layout:${overflow.regionId}:${overflow.code}:${index}`, severity: 'blocking',
      title: ({ width: 'Text exceeds its width', height: 'Text exceeds its height', page: 'Content exceeds the page', glyph: 'Unsupported font character', asset: 'Image or asset issue', collision: 'Overlapping content' })[overflow.code],
      message: overflow.message, ...location(overflow.pageId, overflow.regionId), origin: 'layout' });
  }
  for (const [index, reason] of (project.template.fidelity?.reasons ?? []).entries()) {
    if (!issues.some(issue => issue.message === reason)) issues.push({ id: `fidelity:${index}`, severity: 'review', title: 'Approximate reconstruction', message: reason, page: null, origin: 'fidelity' });
  }
  if (project.source.format === 'pdf' && project.source.sourcePageCount != null && project.source.sourcePageCount !== project.template.pages.length) {
    issues.push({ id: 'page-count', severity: 'review', title: 'Page counts differ', message: `The source has ${project.source.sourcePageCount} pages; the template has ${project.template.pages.length}. Inspect every page in both documents.`, page: null, origin: 'pages' });
  }
  return issues.sort((a, b) => ({ blocking: 0, review: 1, info: 2 })[a.severity] - ({ blocking: 0, review: 1, info: 2 })[b.severity]);
}

export interface ObservedPreview {
  receipt: PreviewReceipt;
  width: number;
  height: number;
}
export function observedPreviewCurrent(observed: ObservedPreview | null, owner: PreviewOwner, bytes: Uint8Array, page: number): boolean {
  return !!observed && observed.receipt.state === 'ready' && observed.receipt.ownerKey === previewOwnerKey(owner) &&
    observed.receipt.bytes === bytes && observed.receipt.page === page && observed.receipt.scale === 1.5 &&
    Number.isInteger(observed.width) && Number.isInteger(observed.height) && observed.width > 0 && observed.height > 0;
}

/** Call only with dimensions copied from ready visible PDF canvases, never placeholder sizes. */
export function comparisonGeometry(project: Project, render: RenderedDocument | null, page: number,
  source: ObservedPreview | null, baseline: ObservedPreview | null): 'pending' | 'mismatch' | 'ready' | 'docx' | 'missing-page' {
  if (project.source.format !== 'pdf') return 'docx';
  if (page > project.template.pages.length || page > (project.source.sourcePageCount ?? project.template.pages.length)) return 'missing-page';
  if (!render || !observedPreviewCurrent(source, inspectionOwner(project, 'source'), project.source.bytes, page) ||
      !observedPreviewCurrent(baseline, inspectionOwner(project, 'baseline'), render.bytes, page)) return 'pending';
  return source!.width === baseline!.width && source!.height === baseline!.height ? 'ready' : 'mismatch';
}

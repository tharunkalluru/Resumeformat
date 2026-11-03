import { FolioError } from '../core/errors';
import { blockText, canonicalJson, MAX_SOURCE_BYTES, newId, sha256, workspaceOf } from '../core/model';
import type { ContentBlock, ImportResult, ImportWarning, Project, Rect, Region, Template, TemplatePage, TextRegion, TextStyle } from '../core/model';
import { layoutDocument, prepareFonts } from '../layout/engine';
import type { FontRegistry } from '../layout/engine';
import { fontKey } from '../layout/fonts';
import { renderDocument } from '../render/pdf';
import { MAX_TEXT, warning } from './common';

const LAYOUT_REASONS: Record<string, string> = {
  DOCX_COLUMNS: 'Word columns are replaced by sequential editable text flow; inspect the section and paragraph order.',
  DOCX_SECTIONS: 'Word section-specific margins and layout are replaced by one reading flow using the imported page dimensions.',
  DOCX_MIXED_RUN_STYLE: 'Mixed run sizes, colors and font families use the imported paragraph font; exact text, bold/italic marks and links remain unchanged.',
  DOCX_TIGHT_LINE_HEIGHT: 'Overlapping source line spacing is replaced by spacing measured with the bundled fonts.',
  PDF_ROTATED_OR_RTL_TEXT: 'Source left-to-right rotated text is reflowed horizontally. Source rotation and text positions are not preserved; inspect the reading order.',
};
const LAYOUT_CODES = new Set(Object.keys(LAYOUT_REASONS));
const CONTENT_UNCERTAINTY = new Set(['DOCX_HIDDEN_TEXT', 'PDF_LINK_AMBIGUITY', 'PDF_UNBOUND_LINK']);
const FONT_FAMILIES = new Set(['sans', 'serif', 'mono', 'times']);

function eligibilityProblem(input: Project | ImportResult): string | undefined {
  if ('draft' in input) {
    if (workspaceOf(input).kind !== 'resume') return 'Recover the reusable resume first. Application templates are pinned snapshots.';
    if (input.approval) return 'Withdraw template approval before recovering its layout.';
    if (canonicalJson(input.draft.blocks) !== canonicalJson(input.baseline.blocks)) return 'Recovery requires an unchanged baseline draft. Preserve your edited draft and repair the original source instead.';
  }
  if (input.template.fidelity?.mode === 'approximate') return 'This template already uses an approximate recovery. Inspect or repair its current regions.';
  if (!input.source.bytes.length || input.source.bytes.length > MAX_SOURCE_BYTES || !input.template.pages.length || input.template.pages.length > 2) return 'Recovery requires the bounded original source and one or two imported pages.';
  if (input.template.pages.some(page => ![page.width, page.height].every(value => Number.isFinite(value) && value > 0 && value <= 2000))) return 'The source page dimensions cannot be represented safely.';
  const unsafe = input.template.warnings.find(item => CONTENT_UNCERTAINTY.has(item.code) || item.severity === 'blocking' && !LAYOUT_CODES.has(item.code));
  if (unsafe) return `${unsafe.message} Approximate layout cannot recover missing or unsupported source content.`;
  const blocks = input.baseline.blocks;
  if (!blocks.length || blocks.length > 1000 || new Set(blocks.map(block => block.id)).size !== blocks.length) return 'Recovery requires unique baseline blocks within the 1,000-region limit.';
  if (blocks.length + input.template.warnings.length + 1 > 1000) return 'The recovery review checklist would exceed the 1,000-warning limit.';
  const text = blocks.map(blockText).join('');
  if (!text.trim() || text.length > MAX_TEXT) return 'Recovery requires readable selectable text within the resume text limit.';
  for (const character of text) {
    if (character === '\n' || character === '\r') continue;
    if (character === '\ufffd' || /[\p{Mark}\p{Control}\p{Format}\p{Surrogate}]/u.test(character) || !/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]/u.test(character)) {
      return 'Unreadable Unicode, right-to-left/vertical scripts or unsupported glyph shaping cannot be recovered by changing layout. Import a supported text PDF.';
    }
  }
  const regions = input.template.pages.flatMap(page => page.regions);
  if (regions.length + blocks.filter(block => !regions.some(region => region.kind === 'text' && region.contentId === block.id)).length > 1000) return 'Recovery would exceed the 1,000-region limit.';
  if (regions.some(region => region.kind === 'image' && !input.assets.some(asset => asset.id === region.assetId && asset.bytes.length))) return 'A source image is missing. Recover its original image or import a complete source.';
  if (regions.some(region => region.kind === 'text' && (!FONT_FAMILIES.has(region.style.fontFamily) || !Number.isFinite(region.style.fontSize) || region.style.fontSize <= 0 || region.style.fontSize > 144 || !Number.isFinite(region.style.lineHeight) || region.style.lineHeight <= 0))) return 'A source font or line style cannot be represented safely.';
  return undefined;
}

/** Candidate gate only: source inspection, glyph coverage and two-page fit are checked by recovery. */
export function canRecoverApproximately(input: Project | ImportResult): boolean {
  return eligibilityProblem(input) === undefined;
}

const comparableText = (value: string) => value.replace(/\s/gu, '');

async function verifySource(project: Project): Promise<void> {
  if (await sha256(project.source.bytes) !== project.source.sha256) throw new FolioError('RECOVERY_SOURCE_HASH', 'The original file bytes do not match their saved checksum. Recover the unchanged original file or import it again; this project is unchanged.');
  if (project.source.format === 'docx') {
    const { readDocxArchive } = await import('./zip');
    const { descendants, attr, child, parseXml } = await import('./xml');
    const parts = await readDocxArchive(project.source.bytes);
    const document = parseXml(parts.get('word/document.xml')!, 'recovery source');
    // The importer reads the final section's headers, not every earlier variant.
    if (project.template.warnings.some(item => item.code === 'DOCX_SECTIONS')) {
      if (descendants(document, 'headerReference').length || descendants(document, 'footerReference').length) throw new FolioError('RECOVERY_SECTION_CONTENT', 'Earlier Word section headers or footers may be missing. Export a complete text PDF from Word before recovery.');
      for (const section of descendants(document, 'sectPr')) {
        const size = child(section, 'pgSz');
        if (size && (Number(attr(size, 'w')) / 20 !== project.template.pages[0].width || Number(attr(size, 'h')) / 20 !== project.template.pages[0].height)) throw new FolioError('RECOVERY_PAGE_DIMENSIONS', 'Word sections use different page dimensions that the imported template cannot account for. Export a matching text PDF.');
      }
    }
    if (['del', 'ins', 'moveFrom', 'moveTo', 'txbxContent', 'altChunk', 'vanish', 'webHidden', 'footnoteReference', 'endnoteReference', 'commentReference', 'commentRangeStart'].some(tag => descendants(document, tag).length)) throw new FolioError('RECOVERY_SOURCE_CONTENT', 'The Word source contains hidden text, revisions, annotations or unrepresented content. Resolve it in Word and import a complete text source.');
    let remaining = comparableText(project.baseline.blocks.map(blockText).join(''));
    for (const item of descendants(document, 't')) {
      const text = comparableText(item.textContent ?? '');
      if (!text) continue;
      const location = remaining.indexOf(text);
      if (location < 0) throw new FolioError('RECOVERY_SOURCE_TEXT', 'Visible Word text is not fully accounted for in the baseline. Export a complete supported text PDF instead.');
      remaining = remaining.slice(0, location) + remaining.slice(location + text.length);
    }
    // A fresh bounded parse accounts for generated list markers and repeated
    // headers/footers exactly; no arbitrary unmatched baseline text is allowed.
    const { importDocx } = await import('./docx');
    const reconstructed = await importDocx(new File([new Uint8Array(project.source.bytes).buffer], project.source.name), project.source.bytes);
    const unsafe = reconstructed.template.warnings.find(item => CONTENT_UNCERTAINTY.has(item.code) || item.severity === 'blocking' && !LAYOUT_CODES.has(item.code));
    if (unsafe) throw new FolioError('RECOVERY_SOURCE_CONTENT', `Independent Word inspection still found unsupported source content: ${unsafe.message}`);
    const comparableBlocks = (blocks: ContentBlock[]) => blocks.map(block => block.runs.map(({ sourceFactIds: _references, ...run }) => run));
    if (canonicalJson(comparableBlocks(project.baseline.blocks)) !== canonicalJson(comparableBlocks(reconstructed.baseline.blocks))) throw new FolioError('RECOVERY_SOURCE_TEXT', 'The baseline text, paragraph order, run marks or links differ from the original Word source. Import the complete unchanged source again; unsupplied baseline text cannot be recovered.');
    return;
  }
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.mjs?url');
  if (!pdfjs.GlobalWorkerOptions.workerSrc || pdfjs.GlobalWorkerOptions.workerSrc === './pdf.worker.mjs') pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(project.source.bytes), useSystemFonts: false, stopAtErrors: true, maxImageSize: 20_000_000,
    cMapUrl: `${import.meta.env.BASE_URL}pdfjs/cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${import.meta.env.BASE_URL}pdfjs/standard_fonts/`, wasmUrl: `${import.meta.env.BASE_URL}pdfjs/wasm/`, verbosity: 0 });
  const inspect = async () => { try {
    const pdf = await task.promise;
    if (pdf.numPages !== project.template.pages.length || pdf.numPages !== project.source.sourcePageCount) throw new FolioError('RECOVERY_SOURCE_PAGES', 'Imported pages do not account for every original PDF page. Import the complete source again.');
    if (await pdf.getPermissions() !== null || Array.from(await pdf.getOptionalContentConfig()).length) throw new FolioError('RECOVERY_SOURCE_CONTENT', 'Encrypted or optional-layer PDF content cannot be recovered by changing layout. Export a flattened, unencrypted text PDF.');
    let remaining = comparableText(project.baseline.blocks.map(blockText).join('')), characters = 0;
    for (let index = 0; index < pdf.numPages; index++) {
      const page = await pdf.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
      if (viewport.width !== project.template.pages[index].width || viewport.height !== project.template.pages[index].height) throw new FolioError('RECOVERY_PAGE_DIMENSIONS', 'Imported dimensions differ from the original PDF. Import the source again before recovery.');
      if ((await page.getAnnotations({ intent: 'display' })).some(annotation => annotation.subtype !== 'Link')) throw new FolioError('RECOVERY_SOURCE_CONTENT', 'Visible PDF annotation content cannot be recovered by changing layout. Import a flattened text PDF.');
      const content = await page.getTextContent({ disableNormalization: true });
      if (content.items.length > 10_000) throw new FolioError('RECOVERY_SOURCE_LIMIT', 'The original PDF exceeds the bounded text-fragment limit. Export a simpler supported source.');
      for (const item of content.items) {
        if (!('str' in item) || !item.str) continue;
        characters += item.str.length;
        if (characters > MAX_TEXT) throw new FolioError('RECOVERY_SOURCE_LIMIT', 'The original PDF exceeds the resume text limit. Export a simpler supported source.');
        if (item.dir !== 'ltr' || content.styles[item.fontName]?.vertical) throw new FolioError('RECOVERY_TEXT_DIRECTION', 'Only selectable left-to-right, nonvertical PDF text can be reflowed. Import horizontal supported text; RTL and vertical content remain blocked.');
        const text = comparableText(item.str);
        if (!text) continue;
        const location = remaining.indexOf(text);
        if (location < 0) throw new FolioError('RECOVERY_SOURCE_TEXT', 'Selectable source text is not fully accounted for in the baseline. Export a complete supported text PDF instead.');
        remaining = remaining.slice(0, location) + remaining.slice(location + text.length);
      }
      page.cleanup();
    }
    if (remaining) throw new FolioError('RECOVERY_SOURCE_TEXT', 'The imported baseline does not match the selectable source text. Import a fresh supported text PDF instead.');
  } catch (error) {
    if (error instanceof FolioError) throw error;
    throw new FolioError('RECOVERY_SOURCE_READ', 'The original PDF could not be independently inspected. Export a fresh supported text PDF before recovery.');
  } finally { await task.destroy(); } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void task.destroy().catch(() => {});
      reject(new FolioError('RECOVERY_SOURCE_TIMEOUT', 'Independent PDF inspection exceeded 15 seconds. Export a simpler supported text PDF; the original project is unchanged.'));
    }, 15_000);
  });
  try { await Promise.race([inspect(), deadline]); } finally { clearTimeout(timer); }
  // Whitespace-stripped fragment accounting above establishes completeness,
  // not exact source wording. A bounded fresh import validates the immutable
  // baseline's words, spacing, run marks and links without replacing old data.
  const { importPdf } = await import('./pdf');
  const reconstructed = await importPdf(new File([new Uint8Array(project.source.bytes).buffer], project.source.name), project.source.bytes);
  const unsafe = reconstructed.template.warnings.find(item => CONTENT_UNCERTAINTY.has(item.code) || item.severity === 'blocking' && !LAYOUT_CODES.has(item.code));
  if (unsafe) throw new FolioError('RECOVERY_SOURCE_CONTENT', `Fresh PDF inspection found unsupported source content: ${unsafe.message}`);
  const comparableBlocks = (blocks: ContentBlock[]) => blocks.map(block => block.runs.map(({ sourceFactIds: _references, ...run }) => run));
  if (canonicalJson(comparableBlocks(project.baseline.blocks)) !== canonicalJson(comparableBlocks(reconstructed.baseline.blocks))) throw new FolioError('RECOVERY_SOURCE_TEXT', 'The baseline wording, spaces, paragraph order, run marks or links differ from the original PDF. Import the complete unchanged source again; approximate layout cannot repair lost source text.');
}

function reservedInk(region: Region): Rect[] {
  const bounds = region.bounds;
  if (region.kind === 'image') return [bounds];
  if (region.kind === 'rule') {
    const radius = region.thickness / 2;
    return [{ x: bounds.x - radius, y: bounds.y - radius, width: bounds.width + radius * 2, height: bounds.height + radius * 2 }];
  }
  if (region.kind === 'rectangle' && region.stroke && region.thickness > 0) {
    const thickness = region.thickness;
    return [
      { x: bounds.x - thickness / 2, y: bounds.y - thickness / 2, width: bounds.width + thickness, height: thickness },
      { x: bounds.x - thickness / 2, y: bounds.y + bounds.height - thickness / 2, width: bounds.width + thickness, height: thickness },
      { x: bounds.x - thickness / 2, y: bounds.y, width: thickness, height: bounds.height },
      { x: bounds.x + bounds.width - thickness / 2, y: bounds.y, width: thickness, height: bounds.height },
    ];
  }
  return [];
}

const intersects = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) && Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
function margins(page: TemplatePage, original?: TemplatePage): { x: number; top: number; bottom: number } {
  const text = original?.regions.filter((region): region is TextRegion => region.kind === 'text') ?? [];
  const bounded = (values: number[], fallback: number, extent: number) => Math.min(extent * .12, 72, Math.max(Math.min(18, extent * .06), values.length ? Math.min(...values.filter(value => Number.isFinite(value) && value >= 0), fallback) : fallback));
  return { x: bounded(text.map(region => region.bounds.x), 36, page.width), top: bounded(text.map(region => region.bounds.y), 36, page.height), bottom: Math.min(36, page.height * .06) };
}

function flowStyle(region: TextRegion, block: ContentBlock, fonts: FontRegistry): TextStyle {
  const faces = [fonts.get(fontKey(region.style))!, ...block.runs.map(run => fonts.get(fontKey(region.style, run.bold ?? region.style.fontWeight === 700, run.italic ?? region.style.italic))!)];
  const ascent = Math.max(...faces.map(face => face.ascent(region.style.fontSize)));
  const descent = Math.max(...faces.map(face => face.descent(region.style.fontSize)));
  const { baselineOffset: _sourceBaseline, ...style } = region.style;
  return { ...style, lineHeight: Math.max(style.lineHeight, style.fontSize * 1.25, ascent + descent + 4), baselineOffset: ascent + 2 };
}

function measure(region: TextRegion, block: ContentBlock, width: number, fonts: FontRegistry): number {
  const measurement: TextRegion = { ...region, pageId: 'measure-page', bounds: { x: 0, y: 0, width, height: 14400 } };
  const template: Template = { id: 'measure-template', revision: 1, importerVersion: 'approximate-measure', warnings: [], pages: [{ id: measurement.pageId, width: 14400, height: 14400, regions: [measurement] }] };
  const result = layoutDocument(template, { revision: 1, blocks: [block] }, fonts);
  // Measurement retains every line even when it exceeds this disposable page.
  // Capacity is decided against the actual two-page flow below.
  const issue = result.overflows.find(item => item.code !== 'height' && item.code !== 'page');
  if (issue) throw new FolioError(issue.code === 'glyph' ? 'RECOVERY_UNSUPPORTED_GLYPH' : 'RECOVERY_REGION_FIT', `The paragraph at ${region.sourceLocator} cannot be safely reflowed: ${issue.message}`);
  return Math.max(region.style.lineHeight, result.regions[0].lines.length * region.style.lineHeight);
}

/** Explicit, measured recovery; never writes storage or mutates the original project. */
export async function recoverApproximate(project: Project): Promise<Project> {
  const problem = eligibilityProblem(project);
  if (problem) throw new FolioError('RECOVERY_BLOCKED', problem);
  await verifySource(project);
  const originalPages = project.template.pages;
  const regions = new Map<string, { region: TextRegion; pageIndex: number }>();
  for (const [pageIndex, page] of originalPages.entries()) for (const region of page.regions) if (region.kind === 'text' && !regions.has(region.contentId)) regions.set(region.contentId, { region, pageIndex });
  const defaultStyle: TextStyle = { fontFamily: 'sans', fontSize: 11, fontWeight: 400, italic: false, color: '#000000', lineHeight: 15, alignment: 'left' };
  const flows = project.baseline.blocks.map(block => {
    const source = regions.get(block.id);
    return { block, pageIndex: source?.pageIndex ?? 0, region: source?.region ?? { kind: 'text' as const, id: newId(), pageId: originalPages[0].id, bounds: { x: 36, y: 36, width: 1, height: 1 }, order: 0, contentId: block.id, role: 'body' as const, style: defaultStyle, sourceLocator: project.facts.find(fact => block.sourceFactIds.includes(fact.id))?.locator ?? `Baseline block ${block.id}` } };
  });
  const fonts = await prepareFonts({ ...project.template, pages: [{ id: originalPages[0].id, width: 14400, height: 14400, regions: flows.map(flow => ({ ...flow.region, pageId: originalPages[0].id })) }] }, project.baseline);
  const pages: TemplatePage[] = originalPages.map(page => ({ ...page, regions: page.regions.filter(region => region.kind !== 'text').map(region => structuredClone(region)) }));
  const regionWarnings: ImportWarning[] = [];
  let pageIndex = 0, cursor = margins(pages[0], originalPages[0]).top;
  for (const flow of flows) {
    if (flow.pageIndex > pageIndex) { pageIndex = flow.pageIndex; cursor = margins(pages[pageIndex], originalPages[pageIndex]).top; }
    const style = flowStyle(flow.region, flow.block, fonts);
    let placed = false;
    for (let attempt = 0; attempt < 2 && !placed; attempt++) {
      const page = pages[pageIndex], margin = margins(page, originalPages[pageIndex]);
      const width = page.width - margin.x * 2;
      const region: TextRegion = { ...flow.region, pageId: page.id, order: 100_000 + pages[pageIndex].regions.filter(item => item.kind === 'text').length, style,
        bounds: { x: margin.x, y: cursor, width, height: 1 } };
      const height = measure(region, flow.block, width, fonts);
      const reservations = page.regions.filter(item => item.kind !== 'text').flatMap(reservedInk);
      let y = cursor;
      for (let pass = 0; pass <= reservations.length; pass++) {
        const overlaps = reservations.filter(box => intersects({ x: margin.x, y, width, height }, box));
        if (!overlaps.length) break;
        y = Math.max(...overlaps.map(box => box.y + box.height)) + 4;
      }
      if (y + height <= page.height - margin.bottom) {
        region.bounds = { x: margin.x, y, width, height };
        page.regions.push(region); cursor = y + height + Math.max(4, style.fontSize * .4); placed = true;
        regionWarnings.push({ ...warning('APPROXIMATE_REGION', `Inspect ${region.sourceLocator}: all original text/runs are retained, with measured horizontal flow, changed position/width/wrapping and baseline spacing.`, 'review', page.id), regionId: region.id });
      } else {
        if (pageIndex === 1) break;
        if (pages.length === 1) pages.push({ id: newId(), width: page.width, height: page.height, regions: [] });
        pageIndex++; cursor = margins(pages[pageIndex], originalPages[pageIndex]).top;
      }
    }
    if (!placed) throw new FolioError('RECOVERY_PAGE_LIMIT', `The complete paragraph at ${flow.region.sourceLocator} cannot fit within two pages at its original font size. No text was truncated or shrunk; shorten the source externally or use a supported layout.`);
  }
  const reasons = [...new Set(project.template.warnings.filter(item => item.severity === 'blocking').map(item => LAYOUT_REASONS[item.code]))];
  reasons.unshift('Text regions use approximate horizontal reading flow. Positions, widths, wrapping, baseline spacing and pagination may differ; mapped font families and sizes are retained. Inspect every region and the original before approval.');
  if (pages.some(page => page.regions.some(region => region.kind !== 'text'))) reasons.push('Every imported image, rule and rectangle is retained on its original page at its original geometry; text is reflowed around reserved artwork. Inspect changed text/artwork relationships.');
  if (pages.length !== originalPages.length) reasons.push(`Pagination changed from ${originalPages.length} to ${pages.length} pages; the added page uses the original page dimensions. Original source bytes and recorded source page count are unchanged.`);
  const warnings = project.template.warnings.map(item => item.severity === 'blocking' ? { ...item, severity: 'review' as const, message: `${LAYOUT_REASONS[item.code]} Original import finding: ${item.message}` } : { ...item });
  if (warnings.some(item => item.message.length > 2000)) throw new FolioError('RECOVERY_REVIEW_LIMIT', 'The complete source findings exceed the bounded recovery review limit. Import a simpler supported source; no warning was truncated.');
  const template: Template = { ...project.template, revision: project.template.revision + 1, pages, warnings: [...warnings, warning('APPROXIMATE_RECOVERY', reasons.join(' ')), ...regionWarnings], fidelity: { mode: 'approximate', reasons }, adjustments: [] };
  const rendered = await renderDocument(template, project.baseline, project.assets);
  const issue = rendered.layout.overflows[0];
  if (issue) throw new FolioError(issue.code === 'glyph' ? 'RECOVERY_UNSUPPORTED_GLYPH' : issue.code === 'asset' ? 'RECOVERY_ASSET' : 'RECOVERY_LAYOUT', `The recovered template cannot render safely: ${issue.message} The original project is unchanged.`);
  return { ...project, template, revision: project.revision + 1, updatedAt: new Date().toISOString(), approval: null, reviewedDraftRevision: null };
}

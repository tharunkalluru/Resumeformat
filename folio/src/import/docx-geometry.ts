import type { ContentSnapshot, LayoutResult, Template } from '../core/model';
import { FolioError } from '../core/errors';
import { layoutDocument, type FontRegistry } from '../layout/engine';
import { fontKey } from '../layout/fonts';

export interface DocxInkEnvelopeResult {
  template: Template;
  layout: LayoutResult;
  expandedRegions: number;
}

/** Fresh-import normalization only. Flow and fixed bounds during editing belong to the caller. */
export function normalizeDocxInkEnvelope(template: Template, content: ContentSnapshot, fonts: FontRegistry): DocxInkEnvelopeResult {
  const original = layoutDocument(template, content, fonts);
  const measured = new Map(original.regions.map(region => [region.regionId, region]));
  let expandedRegions = 0;
  const pages = template.pages.map(page => ({ ...page, regions: page.regions.map(region => {
    if (region.kind !== 'text') return region;
    const base = fonts.get(fontKey(region.style));
    if (!base) throw new FolioError('font-unavailable', 'The bundled font for DOCX ink measurement is unavailable.');
    const lines = measured.get(region.id)!.lines;
    const box = region.bounds, size = region.style.fontSize;
    const firstBaseline = lines[0]?.baseline ?? box.y + (region.style.baselineOffset ??
      (region.style.lineHeight + base.ascent(size) - base.descent(size)) / 2);
    let top = box.y, bottom = box.y + box.height;
    for (const line of lines) {
      // This is the canonical engine's descent rule for empty and space-only lines.
      if (line.runs.every(run => /^ *$/.test(run.text))) bottom = Math.max(bottom, line.baseline + base.descent(size));
      for (const run of line.runs) {
        if (!/[^ ]/.test(run.text)) continue;
        const face = fonts.get(fontKey(region.style, run.bold, run.italic));
        if (!face) throw new FolioError('font-unavailable', 'A bundled DOCX run font is unavailable.');
        const ink = face.measure(run.text, size), inkTop = line.baseline + ink.top;
        let inkHeight = ink.bottom - ink.top;
        if (run.underline) inkHeight = Math.max(inkHeight,
          line.baseline + face.underlineOffset(size) + face.underlineThickness(size) / 2 - inkTop);
        if (![inkTop, inkHeight, line.baseline].every(Number.isFinite)) throw new FolioError('DOCX_INK_MEASUREMENT', 'The DOCX ink bounds could not be measured safely with the bundled fonts.');
        top = Math.min(top, inkTop); bottom = Math.max(bottom, inkTop + inkHeight);
      }
    }
    const expanded = top < box.y || bottom > box.y + box.height;
    const height = expanded ? bottom - top : box.height, baselineOffset = firstBaseline - top;
    if (![top, height, baselineOffset].every(Number.isFinite)) throw new FolioError('DOCX_INK_MEASUREMENT', 'The DOCX ink bounds could not be measured safely with the bundled fonts.');
    if (expanded) expandedRegions++;
    return { ...region, bounds: { ...box, y: top, height }, style: { ...region.style, baselineOffset } };
  }) }));
  const normalized = { ...template, pages };
  // Keep the full canonical checks, including collisions, glyphs, width and page edges.
  return { template: normalized, layout: layoutDocument(normalized, content, fonts), expandedRegions };
}

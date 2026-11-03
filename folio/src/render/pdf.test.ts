// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import type { ContentSnapshot, Template, TextRegion, TextStyle } from '../core/model';
import { getFontMetrics, renderDocument, setFontLoader } from './pdf';
import { FONT_FILES } from '../layout/fonts';

let restoreLoader: () => void;
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
beforeAll(async () => {
  restoreLoader = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
});
afterAll(() => restoreLoader());

const style: TextStyle = { fontFamily: 'sans', fontSize: 12, fontWeight: 400,
  italic: false, color: '#172033', lineHeight: 16, alignment: 'left' };
function region(id = 'text-1', overrides: Partial<TextRegion> = {}): TextRegion {
  return { kind: 'text', id, pageId: 'page-1', bounds: { x: 36, y: 40, width: 400, height: 100 },
    order: 1, contentId: id, role: 'body', sourceLocator: 'fictional:test', style: { ...style }, ...overrides };
}
function template(regions: Template['pages'][number]['regions'] = [region()]): Template {
  return { id: 'template', revision: 1, warnings: [], importerVersion: 'test',
    pages: [{ id: 'page-1', width: 500, height: 700, regions }] };
}
function content(text: string, id = 'text-1'): ContentSnapshot {
  return { revision: 7, blocks: [{ id, runs: [{ text }], sourceFactIds: [] }] };
}
async function inspect(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false,
    standardFontDataUrl: resolve('public/pdfjs/standard_fonts') + '/', verbosity: 0 });
  return task.promise;
}
async function extractedText(bytes: Uint8Array): Promise<string> {
  const doc = await inspect(bytes);
  try {
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const text = await (await doc.getPage(pageNo)).getTextContent();
      pages.push(text.items.map(item => 'str' in item ? item.str : '').join(' '));
    }
    return pages.join('\n');
  } finally { await doc.loadingTask.destroy(); }
}

describe('fresh canonical PDF renderer', () => {
  it('creates exactly the template page sizes and carries the current revision', async () => {
    const source = template();
    source.pages.push({ id: 'page-2', width: 612, height: 792, regions: [] });
    const result = await renderDocument(source, content('Current edited resume'), []);
    expect(new TextDecoder().decode(result.bytes.subarray(0, 5))).toBe('%PDF-');
    expect(result.contentRevision).toBe(7);
    expect(result.rendererVersion).toBe('folio-pdf-v1');
    expect(result.layout.overflows).toEqual([]);
    const reopened = await PDFDocument.load(result.bytes);
    expect(reopened.getPages().map(page => page.getSize())).toEqual([
      { width: 500, height: 700 }, { width: 612, height: 792 },
    ]);
    const independent = await inspect(result.bytes);
    expect(independent.numPages).toBe(2);
    expect((await independent.getPage(1)).getViewport({ scale: 1 }).width).toBe(500);
    await independent.loadingTask.destroy();
  });

  it('never emits old wording or unbound note content into text, metadata, or attachments', async () => {
    const snapshot = content('Edited applicant wording');
    snapshot.blocks.push({ id: 'not-selected', runs: [{ text: 'OLD_SOURCE_SENTINEL SECRET_NOTE_SENTINEL' }], sourceFactIds: [] });
    const result = await renderDocument(template(), snapshot, []);
    const text = await extractedText(result.bytes);
    expect(text).toContain('Edited applicant wording');
    expect(text).not.toContain('OLD_SOURCE_SENTINEL');
    expect(text).not.toContain('SECRET_NOTE_SENTINEL');
    const doc = await PDFDocument.load(result.bytes, { updateMetadata: false });
    expect(doc.getAuthor()).toBeUndefined();
    expect(doc.getSubject()).toBeUndefined();
    expect(doc.catalog.get(PDFName.of('Names'))).toBeUndefined();
    for (const [, object] of doc.context.enumerateIndirectObjects()) {
      const decoded = object instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(object).decode()) : object.toString();
      expect(decoded).not.toContain('OLD_SOURCE_SENTINEL');
      expect(decoded).not.toContain('SECRET_NOTE_SENTINEL');
    }
  });

  it('embeds actual licensed font streams and all used family/style variants', async () => {
    const regions: TextRegion[] = [];
    const snapshot: ContentSnapshot = { revision: 2, blocks: [] };
    let index = 0;
    for (const fontFamily of ['sans', 'serif', 'mono', 'times'] as const) {
      for (const fontWeight of [400, 700] as const) for (const italic of [false, true]) {
        const id = `font-${index}`;
        regions.push(region(id, { bounds: { x: 40, y: 20 + index++ * 40, width: 400, height: 32 },
          style: { ...style, fontFamily, fontWeight, italic } }));
        snapshot.blocks.push({ id, runs: [{ text: ' Embedded font Aa 42' }], sourceFactIds: [] });
      }
    }
    const result = await renderDocument(template(regions), snapshot, []);
    expect(result.layout.overflows).toEqual([]);
    const doc = await PDFDocument.load(result.bytes);
    const fonts = doc.getPage(0).node.Resources()!.lookup(PDFName.of('Font'), PDFDict);
    expect(fonts.keys()).toHaveLength(Object.keys(FONT_FILES).length);
    for (const key of fonts.keys()) {
      const font = fonts.lookup(key, PDFDict);
      expect(font.get(PDFName.of('Subtype'))?.toString()).toBe('/Type0');
      const cid = font.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
      const descriptor = cid.lookup(PDFName.of('FontDescriptor'), PDFDict);
      const isOpenType = cid.get(PDFName.of('Subtype'))?.toString() === '/CIDFontType0';
      const stream = doc.context.lookup(descriptor.get(PDFName.of(isOpenType ? 'FontFile3' : 'FontFile2')));
      expect(stream).toBeInstanceOf(PDFRawStream);
      if (isOpenType) expect((stream as PDFRawStream).dict.get(PDFName.of('Subtype'))?.toString()).toBe('/OpenType');
      expect(decodePDFRawStream(stream as PDFRawStream).decode().length).toBeGreaterThan(500);
    }
    expect(await extractedText(result.bytes)).toContain('Embedded font Aa 42');
  });

  it('wraps using exact glyph advances, preserves marks/newlines, and honors a source baseline', async () => {
    const box = region('text-1', { bounds: { x: 36, y: 40, width: 150, height: 100 },
      style: { ...style, baselineOffset: 11 } });
    const snapshot: ContentSnapshot = { revision: 8, blocks: [{ id: box.contentId,
      runs: [{ text: 'First line\n', bold: true }, { text: 'Second line ', italic: true }, { text: 'link', underline: true }], sourceFactIds: [] }] };
    const result = await renderDocument(template([box]), snapshot, []);
    expect(result.layout.overflows).toEqual([]);
    const lines = result.layout.regions[0].lines;
    expect(lines).toHaveLength(2);
    expect(lines.map(line => line.baseline)).toEqual([51, 67]);
    expect(lines[0].runs[0].bold).toBe(true);
    expect(lines[1].runs[0].italic).toBe(true);
    expect(lines[1].runs[1].underline).toBe(true);
    const face = await getFontMetrics(box.style, true, false);
    expect(lines[0].width).toBeCloseTo(face.measure('First line', 12).width, 6);
    const doc = await inspect(result.bytes);
    const text = await (await doc.getPage(1)).getTextContent();
    const first = text.items.find(item => 'str' in item && item.str === 'First line');
    expect(first && 'transform' in first ? first.transform[5] : null).toBeCloseTo(700 - 51, 5);
    expect(first && 'width' in first ? first.width : null).toBeCloseTo(lines[0].width, 3);
    await doc.loadingTask.destroy();
  });

  it('emits only safe current URI links with glyph-sized click rectangles', async () => {
    const snapshot: ContentSnapshot = { revision: 3, blocks: [{ id: 'text-1', sourceFactIds: [],
      runs: [{ text: 'Portfolio', href: 'https://example.com/work?q=resume', underline: true },
        { text: ' unsafe', href: 'javascript:alert(1)' }, { text: ' email', href: 'mailto:alex@example.com' }] }] };
    const result = await renderDocument(template(), snapshot, []);
    const doc = await inspect(result.bytes);
    const annotations = await (await doc.getPage(1)).getAnnotations();
    expect(annotations).toHaveLength(2);
    expect(annotations.map(a => a.url)).toEqual(['https://example.com/work?q=resume', 'mailto:alex@example.com']);
    const run = result.layout.regions[0].lines[0].runs[0];
    expect(annotations[0].rect[0]).toBeCloseTo(run.x, 4);
    expect(annotations[0].rect[2] - annotations[0].rect[0]).toBeCloseTo(run.width, 4);
    expect(annotations[0].rect[3]).toBeGreaterThan(annotations[0].rect[1]);
    await doc.loadingTask.destroy();
  });

  it('allows ordinary negative left bearings while retaining actual page and neighbor ink checks', async () => {
    const box = region('text-1', { style: { ...style, italic: true } });
    const text = content('Juniper interfaces');
    const fit = await renderDocument(template([box]), text, []);
    expect(fit.layout.overflows).toEqual([]);
    const atEdge = { ...box, bounds: { ...box.bounds, x: 0 } };
    expect((await renderDocument(template([atEdge]), text, [])).layout.overflows.some(issue => issue.code === 'page')).toBe(true);
    const reserved: Template['pages'][number]['regions'][number] = { kind: 'image', id: 'left-neighbor', pageId: 'page-1', order: 0, assetId: 'missing', alt: 'Fictional neighbor', bounds: { x: 35, y: 40, width: 1, height: 30 } };
    expect((await renderDocument(template([reserved, box]), text, [])).layout.overflows.some(issue => issue.code === 'collision')).toBe(true);
    expect(fit.layout.regions[0].lines[0].runs[0].x).toBe(box.bounds.x);
  });
  it('reports measured width/height/page/glyph/collision/asset issues without shrinking or adding pages', async () => {
    const narrow = region('narrow', { bounds: { x: 10, y: 20, width: 20, height: 10 } });
    const source = template([narrow]);
    source.pages[0].regions.push({ kind: 'image', id: 'image', pageId: 'page-1',
      order: 2, assetId: 'missing', alt: 'Missing fictional image', bounds: { x: 10, y: 20, width: 30, height: 30 } });
    source.pages[0].regions.push(region('outside', { bounds: { x: 490, y: 650, width: 50, height: 20 }, order: 3 }));
    const snapshot = content('Extraordinarilylongword\nAnother line 🚀', 'narrow');
    snapshot.blocks.push({ id: 'outside', runs: [{ text: 'Page edge' }], sourceFactIds: [] });
    const result = await renderDocument(source, snapshot, []);
    const codes = result.layout.overflows.map(issue => issue.code);
    for (const code of ['width', 'height', 'page', 'glyph', 'collision', 'asset']) expect(codes).toContain(code);
    const width = result.layout.overflows.find(issue => issue.regionId === narrow.id && issue.code === 'width')!;
    const face = await getFontMetrics(narrow.style);
    expect(width.available).toBe(20);
    expect(width.required).toBeCloseTo(face.measure('Extraordinarilylongword', 12).width, 4);
    expect(result.layout.regions.find(r => r.regionId === narrow.id)!.lines[0].runs[0].text).toContain('Extraordinarilylongword');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(1);
    expect(await extractedText(result.bytes)).toContain('Extraordinarilylongword');
  });

  it('uses hanging bullet continuation positions and keeps explicit trailing newlines', async () => {
    const bullet = region('text-1', { role: 'bullet', bounds: { x: 40, y: 40, width: 110, height: 160 } });
    const result = await renderDocument(template([bullet]), content('• Delivered reviewed applicant evidence across teams\n'), []);
    const lines = result.layout.regions[0].lines;
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0].runs[0].text).toContain('• ');
    expect(lines[1].runs[0].x).toBeGreaterThan(lines[0].runs[0].x);
    const face = await getFontMetrics(bullet.style);
    expect(lines[1].runs[0].x - lines[0].runs[0].x).toBeCloseTo(face.measure('• ', 12).width, 4);
    expect(lines.at(-1)!.runs).toEqual([]);
  });

  it('reports overlapping lines and accounts for a space-only final line', async () => {
    const dense = region('text-1', { style: { ...style, lineHeight: 3, baselineOffset: 12 } });
    const result = await renderDocument(template([dense]), content('Readable first line\nOverlapping second line'), []);
    expect(result.layout.overflows.some(issue => issue.code === 'collision' && issue.message.includes('Text lines overlap'))).toBe(true);
    const short = region('text-1', { bounds: { x: 40, y: 40, width: 200, height: 18 } });
    const blank = await renderDocument(template([short]), content('First line\n    '), []);
    expect(blank.layout.regions[0].lines).toHaveLength(2);
    expect(blank.layout.overflows.some(issue => issue.code === 'height')).toBe(true);
  });

  it('renders rules, rectangles, underlines, and a real PNG onto a clean page', async () => {
    const canvas = createCanvas(2, 2);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 2, 2);
    const source = template([region()]);
    source.pages[0].regions.push(
      { kind: 'rule', id: 'rule', pageId: 'page-1', bounds: { x: 36, y: 200, width: 400, height: 0 }, order: 2, color: '#334455', thickness: 1 },
      { kind: 'rectangle', id: 'box', pageId: 'page-1', bounds: { x: 36, y: 220, width: 400, height: 50 }, order: 3, fill: '#eef1f5', stroke: '#334455', thickness: 1 },
      { kind: 'image', id: 'photo', pageId: 'page-1', bounds: { x: 36, y: 300, width: 40, height: 40 }, order: 4, assetId: 'png', alt: 'Fictional solid color' },
    );
    const result = await renderDocument(source, content('Visible document text'), [
      { id: 'png', name: 'red.png', mime: 'image/png', bytes: new Uint8Array(canvas.toBuffer('image/png')) },
    ]);
    expect(result.layout.overflows).toEqual([]);
    const doc = await inspect(result.bytes);
    const page = await doc.getPage(1);
    const raster = createCanvas(500, 700);
    await page.render({ canvas: null, canvasContext: raster.getContext('2d') as unknown as CanvasRenderingContext2D,
      viewport: page.getViewport({ scale: 1 }), background: '#ffffff' }).promise;
    const pixel = raster.getContext('2d').getImageData(50, 310, 1, 1).data;
    expect(Array.from(pixel)).toEqual([255, 0, 0, 255]);
    const rulePixel = raster.getContext('2d').getImageData(50, 200, 1, 1).data;
    expect(rulePixel[0]).toBeLessThan(255);
    await doc.loadingTask.destroy();
  });

  it('rejects invalid geometry and produces no fake PDF when font loading fails', async () => {
    const invalid = template(); invalid.pages[0].width = Number.NaN;
    await expect(renderDocument(invalid, content('A'), [])).rejects.toMatchObject({ code: 'render-geometry' });
    const restore = setFontLoader(async () => { throw new Error('Font read failed'); });
    try { await expect(renderDocument(template(), content('A'), [])).rejects.toThrow('Font read failed'); }
    finally { restore(); }
  });
});

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { fictionalSourceTemplate } from '../core/sourceFontTestFixture';
import { sha256Sync, type ImportResult } from '../core/model';
import { sourceGlyphs } from '../core/source-graph';
import { setFontLoader } from '../layout/fonts';
import { renderDocument } from '../render/pdf';
import { importResume } from './index';

let restoreFonts: () => void, carlito: Uint8Array;
beforeAll(async () => {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D, pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  carlito = new Uint8Array(await readFile(resolve('tests/fixtures/fonts/Carlito-Regular.ttf')));
  await import('./pdf');
  (await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(() => restoreFonts());
const importBytes = (bytes: Uint8Array) => importResume(new File([new Uint8Array(bytes).buffer], 'fictional-roundtrip.pdf', { type: 'application/pdf' }));
const glyphs = (result: ImportResult) => result.template.pages.flatMap(page => page.regions.flatMap(region => region.kind === 'text' && region.sourceLayout ? Array.from(sourceGlyphs(region)) : []));

describe('actual source-font PDF export and re-import', () => {
  it('retains embedded Carlito, packed matrices, remapped blank CIDs and pdf-lib rules together', async () => {
    const { template, content, asset, region } = fictionalSourceTemplate(carlito, 'a bcd');
    // A blank PDF character code has no painted cmap selector. Renumber it.
    asset.glyphMap.find(map => map.unicode === ' ')!.cid = 7;
    region.sourceLayout!.glyphs.find(glyph => glyph.unicode === ' ')!.cid = 7;
    template.pages[0].regions.push({ kind: 'rule', id: 'fictional-rule', pageId: 'page', order: 1, bounds: { x: 40, y: 80, width: 200, height: 0 }, color: '#123456', thickness: .5 });
    const pdf = await renderDocument(template, content, []);
    expect(pdf.layout.overflows).toEqual([]);
    const imported = await importBytes(pdf.bytes);
    expect(imported.template.sourceFonts).toHaveLength(1);
    expect(imported.template.warnings.some(w => w.severity === 'blocking' || w.code === 'FONT_SUBSTITUTION')).toBe(false);
    expect(glyphs(imported).map(g => g.unicode).join('')).toBe('a bcd');
    glyphs(imported).forEach((glyph, index) => {
      expect(glyph.x).toBeCloseTo(region.sourceLayout!.glyphs[index].x, 4);
      expect(glyph.advance).toBeCloseTo(region.sourceLayout!.glyphs[index].advance, 4);
    });
    expect(imported.template.pages[0].regions.filter(r => r.kind === 'rule')).toMatchObject([{ bounds: { x: 40, y: 80, width: 200, height: 0 }, color: '#123456', thickness: .5 }]);
    const again = await importBytes((await renderDocument(imported.template, imported.baseline, [])).bytes);
    expect(glyphs(again).map(g => g.unicode).join('')).toBe('a bcd');
    expect(again.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
  });

  it('does not trust a Folio resource alias for an unadmitted TrueType family', async () => {
    const { template, content } = fictionalSourceTemplate(new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf'))), 'abc');
    const result = await importBytes((await renderDocument(template, content, [])).bytes);
    expect(result.template.sourceFonts).toBeUndefined();
    expect(result.template.warnings.some(w => w.code === 'FONT_SUBSTITUTION')).toBe(true);
  });

  it.runIf(!!process.env.FOLIO_PRIVATE_PDF_REGRESSION)('reconstructs the exact locally authorized failing source without modifying it', async () => {
    const path = process.env.FOLIO_PRIVATE_PDF_REGRESSION!, bytes = new Uint8Array(await readFile(path));
    expect(sha256Sync(bytes)).toBe('b56ae0d7952e9134dd2133d4f027813b2b0c69bc9ba190f53e88e5602705e274');
    const result = await importBytes(bytes);
    expect(result.template.sourceFonts).toHaveLength(3);
    expect(glyphs(result)).toHaveLength(3077);
    expect(result.template.pages[0].regions.filter(r => r.kind === 'rule')).toHaveLength(4);
    expect(result.template.warnings.some(w => w.severity === 'blocking' || w.code === 'FONT_SUBSTITUTION')).toBe(false);
    expect((await renderDocument(result.template, result.baseline, [])).layout.overflows).toEqual([]);
    expect(sha256Sync(new Uint8Array(await readFile(path)))).toBe(sha256Sync(bytes));
  });
});

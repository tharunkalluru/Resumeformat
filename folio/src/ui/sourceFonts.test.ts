import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import fontkit from '@pdf-lib/fontkit';
import type { SourceFontAssetV1, SourceGlyphMapping } from '../core/model';
import { sha256Sync } from '../core/model';
import { clearSourceFontCache } from '../layout/source-fonts';
import { browserSourceFontBytes, browserSourceFontFamily, rewriteTrueTypeUnicodeCmap } from './sourceFonts';

async function fixtureWithoutSpace(): Promise<SourceFontAssetV1> {
  const original = new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));
  const font = fontkit.create(original);
  const cmap = new Map(font.characterSet.filter(code => code !== 32).map(code => [code, font.glyphForCodePoint(code).id]));
  const bytes = rewriteTrueTypeUnicodeCmap(original, cmap);
  const repaired = fontkit.create(bytes);
  expect(repaired.hasGlyphForCodePoint(32)).toBe(false);
  const glyphMap: SourceGlyphMapping[] = [
    { cid: 1, glyphId: font.glyphForCodePoint(65).id, fontChar: 65, unicode: 'A', pdfWidth: 684, nonPainting: false },
    { cid: 2, glyphId: font.glyphForCodePoint(32).id, fontChar: 2, unicode: ' ', pdfWidth: 318, nonPainting: true },
  ];
  return { id: 'source-browser-space-regression', sourceSha256: 'a'.repeat(64), sourceResource: 'fixture-f0', sha256: sha256Sync(bytes), bytes, format: 'truetype', unitsPerEm: font.unitsPerEm, fontWeight: 400, italic: false, glyphMap };
}

describe('source browser TrueType adapter', () => {
  it('restores a proved empty space instead of .notdef without modifying source glyph outlines or metrics', async () => {
    clearSourceFontCache();
    const asset = await fixtureWithoutSpace(), source = new Uint8Array(asset.bytes), original = fontkit.create(source);
    const bytes = browserSourceFontBytes(asset), derivative = fontkit.create(bytes);
    const blank = derivative.glyphForCodePoint(32);
    expect(blank.id).toBe(asset.glyphMap[1].glyphId);
    expect(blank.path.toSVG()).toBe('');
    expect(blank.id).not.toBe(0);
    expect(derivative.unitsPerEm).toBe(original.unitsPerEm);
    for (const code of [65, 66, 97, 233, 0x3a9]) {
      const a = original.glyphForCodePoint(code), b = derivative.glyphForCodePoint(code);
      expect(b.id).toBe(a.id); expect(b.advanceWidth).toBe(a.advanceWidth); expect(b.path.toSVG()).toBe(a.path.toSVG());
    }
    expect(asset.bytes).toEqual(source);
    expect(sha256Sync(asset.bytes)).toBe(asset.sha256);
    expect(bytes).not.toEqual(asset.bytes);
  });

  it('binds CSS identity to the complete source map and removes ambiguity rather than guessing a glyph', async () => {
    clearSourceFontCache();
    const asset = await fixtureWithoutSpace(), family = browserSourceFontFamily(asset), font = fontkit.create(asset.bytes);
    const conflicting: SourceFontAssetV1 = { ...asset, glyphMap: [...asset.glyphMap, { cid: 3, glyphId: font.glyphForCodePoint(66).id, fontChar: 66, unicode: 'A', pdfWidth: 686, nonPainting: false }] };
    expect(browserSourceFontFamily(conflicting)).not.toBe(family);
    expect(() => browserSourceFontBytes(conflicting)).toThrow(/ambiguous editing glyphs/);
    expect(family).toMatch(/^FolioSource-[a-f0-9]{32}$/);
  });

  it('rejects corrupted table bounds and non-TrueType programs before producing a derivative', async () => {
    const bytes = new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf')), corrupt = new Uint8Array(bytes);
    new DataView(corrupt.buffer).setUint32(20, corrupt.length + 1);
    expect(() => rewriteTrueTypeUnicodeCmap(corrupt, new Map([[65, 1]]))).toThrow(/table/);
    const cff = new Uint8Array(await readFile('public/fonts/Times-Regular.otf'));
    expect(() => rewriteTrueTypeUnicodeCmap(cff, new Map([[65, 1]]))).toThrow(/not a TrueType/);
    expect(() => rewriteTrueTypeUnicodeCmap(bytes, new Map([[0xd800, 1]]))).toThrow(/character map/);
    expect(() => rewriteTrueTypeUnicodeCmap(bytes, new Map([[65, 0]]))).toThrow(/character map/);
    const overlap = new Uint8Array(bytes), view = new DataView(overlap.buffer);
    view.setUint32(12 + 16 + 8, view.getUint32(12 + 8));
    view.setUint32(12 + 16 + 12, view.getUint32(12 + 12));
    expect(() => rewriteTrueTypeUnicodeCmap(overlap, new Map([[65, 1]]))).toThrow(/overlapping tables/);
  });
});

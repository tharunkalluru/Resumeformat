import fontkit from '@pdf-lib/fontkit';
import type { Font } from '@pdf-lib/fontkit';
import type { FontFamily, TextStyle } from '../core/model';
import { FolioError } from '../core/errors';

export const FONT_FAMILIES: Record<FontFamily, string> = {
  sans: 'Folio Sans', serif: 'Folio Serif', mono: 'Folio Mono', times: 'Folio Times',
};

/** Match the nominal advances emitted by pdf-lib's Tj operator in the DOM. */
export const FONT_FEATURES = { kern: false, liga: false, clig: false };
export type CatalogFontKey = `${FontFamily}-${400 | 700}-${'normal' | 'italic'}`;
export type FontKey = CatalogFontKey | `source:${string}` | `standard:${string}`;
export const FONT_FILES: Record<CatalogFontKey, string> = {
  'sans-400-normal': 'DejaVuSans.ttf',
  'sans-700-normal': 'DejaVuSans-Bold.ttf',
  'sans-400-italic': 'DejaVuSans-Oblique.ttf',
  'sans-700-italic': 'DejaVuSans-BoldOblique.ttf',
  'serif-400-normal': 'DejaVuSerif.ttf',
  'serif-700-normal': 'DejaVuSerif-Bold.ttf',
  'serif-400-italic': 'DejaVuSerif-Italic.ttf',
  'serif-700-italic': 'DejaVuSerif-BoldItalic.ttf',
  'mono-400-normal': 'DejaVuSansMono.ttf',
  'mono-700-normal': 'DejaVuSansMono-Bold.ttf',
  'mono-400-italic': 'DejaVuSansMono-Oblique.ttf',
  'mono-700-italic': 'DejaVuSansMono-BoldOblique.ttf',
  'times-400-normal': 'Times-Regular.otf',
  'times-700-normal': 'Times-Bold.otf',
  'times-400-italic': 'Times-Italic.otf',
  'times-700-italic': 'Times-BoldItalic.otf',
};

export type FontLoader = (fileName: string) => Promise<Uint8Array>;
let fontLoader: FontLoader = async fileName => {
  const response = await fetch(`${import.meta.env.BASE_URL}fonts/${fileName}`);
  if (!response.ok) throw new FolioError('font-unavailable', `The local font ${fileName} could not be loaded.`);
  return new Uint8Array(await response.arrayBuffer());
};
const cache = new Map<FontKey, Promise<FontFaceMetrics>>();

/** Node/fixture seam. Supply bytes of the same bundled fonts; no fallback fonts. */
export function setFontLoader(loader: FontLoader): () => void {
  const previous = fontLoader;
  fontLoader = loader;
  cache.clear();
  return () => { fontLoader = previous; cache.clear(); };
}

export function fontKey(style: Pick<TextStyle, 'fontFamily' | 'fontWeight' | 'italic'>,
  bold = style.fontWeight === 700, italic = style.italic): CatalogFontKey {
  return `${style.fontFamily}-${bold ? 700 : 400}-${italic ? 'italic' : 'normal'}`;
}

export interface TextMeasurement {
  width: number;
  /** Actual glyph ink bounds relative to the text origin and baseline; y grows down. */
  left: number; right: number; top: number; bottom: number;
}

export class FontFaceMetrics {
  constructor(public readonly key: FontKey, public readonly bytes: Uint8Array,
    public readonly font: Font, public readonly pdfBytes: Uint8Array = bytes) {}

  ascent(size: number): number { return this.font.ascent * size / this.font.unitsPerEm; }
  descent(size: number): number { return -this.font.descent * size / this.font.unitsPerEm; }
  underlineOffset(size: number): number { return -this.font.underlinePosition * size / this.font.unitsPerEm; }
  underlineThickness(size: number): number { return Math.max(0.3, this.font.underlineThickness * size / this.font.unitsPerEm); }

  measure(text: string, size: number): TextMeasurement {
    const shaped = this.font.layout(text, this.features());
    const scale = size / this.font.unitsPerEm;
    let advance = 0;
    let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
    // pdf-lib emits glyphs with their nominal advances, without GPOS offsets.
    for (const [index, glyph] of shaped.glyphs.entries()) {
      const box = glyph.bbox;
      if (box.width > 0 && box.height > 0) {
        left = Math.min(left, advance + box.minX * scale);
        right = Math.max(right, advance + box.maxX * scale);
        top = Math.min(top, -box.maxY * scale);
        bottom = Math.max(bottom, -box.minY * scale);
      }
      advance += (this.key.startsWith('times-') ? shaped.positions[index].xAdvance : glyph.advanceWidth) * scale;
    }
    return { width: advance, left: Number.isFinite(left) ? left : 0,
      right: Number.isFinite(right) ? right : advance,
      top: Number.isFinite(top) ? top : 0, bottom: Number.isFinite(bottom) ? bottom : 0 };
  }

  features() { return this.key.startsWith('times-') ? { ...FONT_FEATURES, kern: true } : FONT_FEATURES; }

  /** Split at pair adjustments; PDF drawText emits nominal advances. */
  positionedSegments(text: string, size: number): { text: string; x: number }[] {
    if (!this.key.startsWith('times-')) return [{ text, x: 0 }];
    const shaped = this.font.layout(text, this.features()), characters = Array.from(text), segments: { text: string; x: number }[] = [];
    let x = 0, current = { text: '', x: 0 };
    shaped.glyphs.forEach((glyph, index) => {
      current.text += characters[index];
      x += shaped.positions[index].xAdvance * size / this.font.unitsPerEm;
      if (shaped.positions[index].xAdvance !== glyph.advanceWidth) { segments.push(current); current = { text: '', x }; }
    });
    if (current.text) segments.push(current);
    return segments;
  }

  unsupportedCharacters(text: string): string[] {
    return [...new Set(Array.from(text).filter(character => {
      if (character === '\n' || character === '\r') return false;
      const code = character.codePointAt(0)!;
      return !this.font.hasGlyphForCodePoint(code) ||
        /[\p{Mark}\p{Control}\p{Format}]/u.test(character) ||
        !/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Common}]/u.test(character);
    }))];
  }
}

export function loadFont(key: FontKey): Promise<FontFaceMetrics> {
  if (key.startsWith('source:')) throw new FolioError('SOURCE_FONT_MISSING', 'A source font requires its template-owned asset.');
  const catalogKey = key as CatalogFontKey;
  let pending = cache.get(key);
  if (!pending) {
    pending = Promise.all([fontLoader(FONT_FILES[catalogKey]), key.startsWith('times-') ? fontLoader(FONT_FILES[catalogKey].replace('.otf', '-PDF.otf')) : undefined]).then(([bytes, pdfBytes]) => {
      if (!bytes.length || bytes.length > 4 * 1024 * 1024) {
        throw new FolioError('font-invalid', `The local font ${FONT_FILES[catalogKey]} is invalid.`);
      }
      return new FontFaceMetrics(key, new Uint8Array(bytes), fontkit.create(bytes), pdfBytes ? new Uint8Array(pdfBytes) : new Uint8Array(bytes));
    }).catch(error => { cache.delete(key); throw error; });
    cache.set(key, pending);
  }
  return pending;
}

export const getFontMetrics = (style: TextStyle, bold = style.fontWeight === 700, italic = style.italic) =>
  loadFont(fontKey(style, bold, italic));

import { describe, expect, it } from 'vitest';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { reconcilePdfText } from './pdf-text';
import { knownPdfFont, reportedPdfFontName } from './pdf-fonts';

describe('PDF extracted word-boundary ownership', () => {
  it.each([
    ['First Last earned a Bachelor of Science.', 'FirstLastearnedaBachelorofScience.', 'First Last earned a Bachelor of Science.'],
    ['FirstLast', 'First Last', 'First Last'],
    ['First Last', 'First  Last', 'First  Last'],
    ['First  Last', 'First Last', 'First  Last'],
    ['First Last', 'First\u00a0Last', 'First\u00a0Last'],
    ['First\u00a0Last', 'First  Last', 'First\u00a0Last'],
    ['FirstLast', 'First\tLast', 'FirstLast'],
    ['FirstLast', 'First \n Last', 'FirstLast'],
    ['First\nLast', 'First Last', 'First\nLast'],
    ['First Last', 'Other Last', 'First Last'],
    ['test test tested', 'testtesttested', 'test test tested'],
    ['A\u{1f9ea}B', 'A \u{1f9ea} B', 'A \u{1f9ea} B'],
    ['word ', 'word', 'word '],
    [' ', '\u00a0', '\u00a0'],
    [' ', ' \n ', ' '],
  ])('preserves extraction and only exact horizontal proof: %j / %j', (observed, operator, expected) => {
    const result = reconcilePdfText(observed, operator);
    expect(result).toBe(expected);
    expect(result.replace(/\s/gu, '')).toBe(observed.replace(/\s/gu, ''));
  });
  it('does not restore leading spacing without cursor ownership, or any suffix', () => {
    expect(reconcilePdfText('next', ' next')).toBe('next');
    expect(reconcilePdfText('next', ' next', true)).toBe(' next');
    expect(reconcilePdfText('next', '\u00a0next', true)).toBe('\u00a0next');
    expect(reconcilePdfText(' next', '  next', true)).toBe(' next');
    expect(reconcilePdfText('word', 'word ', true)).toBe('word');
  });
  it('keeps the split trailing-space/next-prefix counterexample at one boundary', () => {
    const first = reconcilePdfText('word ', 'word');
    expect(first + reconcilePdfText('next', ' next', !/\s$/.test(first))).toBe('word next');
  });
});

const pageWith = (resource: unknown) => ({ commonObjs: { get: () => resource } }) as unknown as PDFPageProxy;
describe('reported PDF font provenance', () => {
  it('retains an unfamiliar subset name without inferring its claimed style', () => {
    const page = pageWith({ name: 'ABCDEF+SourceSans3-BoldItalic' });
    expect(reportedPdfFontName(page, 'font1')).toBe('ABCDEF+SourceSans3-BoldItalic');
    expect(knownPdfFont(page, 'font1')).toBeUndefined();
  });
  it.each([undefined, null, {}, { name: '' }, { name: 5 }, { name: 'x'.repeat(257) }, { name: 'font\nsecret' }, { name: 'font\u0085secret' }])('treats malformed names as unavailable: %j', resource => {
    expect(reportedPdfFontName(pageWith(resource), 'font1')).toBeNull();
  });
  it('contains missing resources and throwing metadata getters', () => {
    const page = { commonObjs: { get: () => { throw new Error('unavailable'); } } } as unknown as PDFPageProxy;
    expect(reportedPdfFontName(page, 'font1')).toBeNull();
    expect(reportedPdfFontName(pageWith({ get name() { throw new Error('getter'); } }), 'font1')).toBeNull();
  });
  it('preserves exact known faces and excludes Type3 identity', () => {
    expect(knownPdfFont(pageWith({ name: 'ABCDEF+DejaVuSans-BoldOblique' }), 'font1')).toEqual({ family: 'sans', fontWeight: 700, italic: true });
    expect(knownPdfFont(pageWith({ name: 'Times-Italic' }), 'font1')).toEqual({ family: 'times', fontWeight: 400, italic: true });
    expect(knownPdfFont(pageWith({ name: 'DejaVuSans', isType3Font: true }), 'font1')).toBeUndefined();
  });
});

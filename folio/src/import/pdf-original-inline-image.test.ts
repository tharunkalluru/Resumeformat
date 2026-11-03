import {describe, expect, it} from 'vitest';
import {FolioError} from '../core/errors';
import {sha256Sync} from '../core/model';
import {originalPdfByteString, parseOriginalInlineImage} from './pdf-original-inline-image';

const bytes = (...values: number[]) => String.fromCharCode(...values);
const content = (header: string, data: string, suffix = ' EI Q') => `q BI ${header} ID ${data}${suffix}`;
const parse = (header: string, data: string, suffix?: string) => parseOriginalInlineImage(content(header, data, suffix), 4);
const mask = '/W 8 /H 1 /IM true';
const gray = '/W 1 /H 1 /BPC 8 /CS /G';
const refuses = (run: () => unknown) => {
  try { run(); throw Error('unexpected acceptance'); }
  catch (error) { expect(error).toBeInstanceOf(FolioError); expect((error as FolioError).code).toBe('PDF_INLINE_IMAGE_PROOF'); }
};

describe('original inline image boundaries and byte preservation', () => {
  it('preserves every byte value, hashes and raw dictionary syntax without a bitmap replacement', () => {
    const source = Uint8Array.from({length: 256}, (_, i) => i), data = originalPdfByteString(source);
    const header = '/Width 256 /H 1 /BPC 8 /CS /DeviceGray /D [1 0] /I true';
    const text = content(header, data), result = parseOriginalInlineImage(text, 4);
    expect(result.encodedBytes).toEqual(source); expect(result.encodedSha256).toBe(sha256Sync(source));
    expect(text.slice(result.dataStartIndex, result.dataEndIndex)).toBe(data);
    expect(result.dictionaryText).toBe(` ${header} `);
    expect(result.dictionarySha256).toBe(sha256Sync(new TextEncoder().encode(result.dictionaryText)));
    expect(result.decode).toEqual([1, 0]); expect(result.interpolate).toBe(true);
    expect(text.slice(result.endIndex)).toBe(' Q'); expect(result.expectedDecodedBytes).toBe(256);
    expect(result.dictionary[0]).toMatchObject({rawKey: '/Width', rawValue: '256', canonicalKey: 'Width', value: 256});
  });
  it('honours row padding rather than rounding the whole image pixel count', () => {
    const result = parse('/W 9 /H 3 /BPC 1 /CS /G', bytes(1, 2, 3, 4, 5, 6));
    expect(result.rowBytes).toBe(2); expect(result.expectedDecodedBytes).toBe(6);
  });
  it.each([1, 2, 4, 8, 16])('preserves unfiltered %i-bit RGB samples', bits => {
    const length = Math.ceil(3 * bits / 8), result = parse(`/W 1 /H 1 /BPC ${bits} /CS /RGB`, bytes(...Array(length).fill(7)));
    expect(result.encodedLength).toBe(length); expect(result.components).toBe(3);
  });
  it('owns only device CMYK samples and mask metadata', () => {
    expect(parse('/W 1 /H 1 /BPC 8 /CS /CMYK', bytes(1, 2, 3, 4))).toMatchObject({components: 4, colorSpace: 'DeviceCMYK'});
    expect(parse(`${mask} /D [1 0]`, bytes(0x80))).toMatchObject({imageMask: true, bitsPerComponent: 1, components: 1, colorSpace: null});
  });
  it('does not stop at EI-looking bytes inside the declared data', () => {
    const data = '\0 EI \xff'; expect(parse('/W 6 /H 1 /BPC 8 /CS /G', data).encodedBytes).toEqual(Uint8Array.from([0, 32, 69, 73, 32, 255]));
  });
  it('accepts delimiter-adjacent BI, escaped names, comments and a one-byte ID separator', () => {
    const text = `BI/W 8 % bounded comment\n/H 1 /I#4d true ID\n\xff\r\nEI/Q`;
    const result = parseOriginalInlineImage(text, 2);
    expect(result.imageMask).toBe(true); expect(result.encodedBytes).toEqual(Uint8Array.of(255)); expect(text.slice(result.endIndex)).toBe('/Q');
    expect(result.dictionary.find(pair => pair.key === 'IM')?.rawKey).toBe('/I#4d');
  });
  it('treats a second newline after ID as a payload byte', () => {
    const text = `BI ${mask} ID\r\n EI`; expect(parseOriginalInlineImage(text, 2).encodedBytes).toEqual(Uint8Array.of(10));
  });
  it('keeps final NUL payload bytes and accepts EI at EOF', () => {
    expect(parse(mask, '\0', '\nEI').encodedBytes).toEqual(Uint8Array.of(0));
  });
  it('does not admit TextDecoder latin1 corruption of the original payload', () => {
    const corrupted = new TextDecoder('latin1').decode(Uint8Array.of(0x80));
    expect(corrupted.charCodeAt(0)).toBe(0x20ac); refuses(() => parse(gray, corrupted));
  });
});

describe('inline filters preserve encoded data and prove EOD/sample counts', () => {
  it.each(['7f>', ' 7 F >', '7f\n>'])('preserves ASCIIHex syntax %j exactly', data => {
    const result = parse(`${gray} /F /AHx`, data); expect(result.filter).toBe('ASCIIHexDecode'); expect(originalPdfByteString(result.encodedBytes)).toBe(data);
  });
  it('accounts for an odd final hexadecimal nibble', () => { expect(parse(`${gray} /Filter [/ASCIIHexDecode] /DP null`, 'F>').encodedLength).toBe(2); });
  it('proves full ASCII85 groups, zero shorthand and partial final groups', () => {
    expect(parse('/W 4 /H 1 /BPC 8 /CS /G /F /A85', 'z~>').expectedDecodedBytes).toBe(4);
    expect(parse('/W 4 /H 1 /BPC 8 /CS /G /F /A85', '!!!!!~>').encodedLength).toBe(7);
    expect(parse(`${gray} /F /A85`, '!!~>').encodedLength).toBe(4);
    expect(parse('/W 3 /H 1 /BPC 8 /CS /G /F /A85', '! ! ! !~>').expectedDecodedBytes).toBe(3);
  });
  it('proves RunLength literal and repeat blocks without inspecting binary EI as an operator', () => {
    const data = bytes(2, 69, 73, 255, 255, 0, 128), result = parse('/W 5 /H 1 /BPC 8 /CS /G /F /RL', data);
    expect(result.filter).toBe('RunLengthDecode'); expect(originalPdfByteString(result.encodedBytes)).toBe(data);
  });
  it.each([
    ['/F /AHx', 'g>'], ['/F /AHx', 'ff'], ['/F /AHx', '>'], ['/F /AHx', 'ffff>'],
    ['/F /A85', '!~>'], ['/F /A85', 'z~>'], ['/F /A85', '!z~>'], ['/F /A85', 'vv~>'], ['/F /A85', 'uuuuu~>'],
    ['/F /A85', '!!~ >'], ['/F /A85', '!!'], ['/F /RL', bytes(0, 7)], ['/F /RL', bytes(1, 7, 128)],
    ['/F /RL', bytes(255, 7, 128)], ['/F /RL', bytes(128)],
  ])('refuses malformed, missing-EOD or mismatched filter data %j', (filter, data) => { refuses(() => parse(`${gray} ${filter}`, data)); });
});

describe('strict bounded inline dictionary and framing', () => {
  it.each([
    '/W 0 /H 1 /IM true', '/W -1 /H 1 /IM true', '/W 1.0 /H 1 /IM true', '/W 1e1 /H 1 /IM true',
    '/W 1 /H 1', '/W 1 /H 1 /BPC 3 /CS /G', '/W 1 /H 1 /BPC 2 /IM true',
    '/W 8 /H 1 /IM true /CS /G', `${mask} /IM false`, `${mask} /Width 8`, `${mask} /I 1`,
    `${gray} /CS /NamedSpace`, '/W 1 /H 1 /BPC 8 /CS [/Indexed /G 1 <00ff>]',
    `${gray} /F /Fl`, `${gray} /F /DCT`, `${gray} /F [/AHx /Fl]`, `${gray} /F []`,
    `${gray} /DP << /Predictor 12 >>`, `${gray} /D [0]`, `${gray} /D [true false]`,
    `${gray} /D [[0 1]]`, `${gray} /Intent /Unknown`, `${gray} /Unknown 1`, `${gray} /W#xx 1`,
    `${mask} /__proto__ 1`, '/W 1 /H 1 /BPC 8 /CS /constructor', `${gray} /F /toString`,
    '/W 8 /H 1 /IM 1 0 R', '/W 1000000000 /H 1000000000 /IM true',
  ])('refuses unsupported or corrupt dictionary %j', header => { refuses(() => parse(header, '\0')); });
  it.each(['EI', ' EIextra', ' X EI', ' %comment\nEI', ' EI('])('checks exact payload framing %j', suffix => {
    if (suffix === ' EI(') expect(parse(mask, '\0', suffix).endIndex).toBe(content(mask, '\0', suffix).length - 1);
    else refuses(() => parse(mask, '\0', suffix));
  });
  it('refuses a missing ID separator, partial image data or extra sample bytes', () => {
    refuses(() => parseOriginalInlineImage(`BI ${mask} ID/\0 EI`, 2));
    refuses(() => parse('/W 16 /H 1 /IM true', '\0', 'EI'));
    refuses(() => parse(mask, '\0\xff'));
  });
  it('precharges remaining pixel and byte limits before payload allocation', () => {
    const text = content(mask, '\0');
    for (const budget of [{remainingPixels: 7}, {remainingDecodedBytes: 0}, {remainingEncodedBytes: 0}, {remainingPixels: -1}, {remainingPixels: Infinity}]) {
      refuses(() => parseOriginalInlineImage(text, 4, budget));
    }
    expect(parseOriginalInlineImage(text, 4, {remainingPixels: 8, remainingEncodedBytes: 1, remainingDecodedBytes: 1}).encodedLength).toBe(1);
    refuses(() => parse('/W 20000001 /H 1 /IM true', ''));
  });
  it('bounds dictionary comments, operator indexes, framing and content work', () => {
    refuses(() => parse(`${mask} %${'x'.repeat(4096)}\n`, '\0'));
    refuses(() => parse(mask, '\0', `${' '.repeat(4097)}EI`));
    refuses(() => parseOriginalInlineImage('xBI /W 8 /H 1 /IM true ID \0 EI', 3));
    refuses(() => parseOriginalInlineImage(content(mask, '\0'), NaN));
    refuses(() => parseOriginalInlineImage('x'.repeat(16 * 1024 * 1024 + 1), 2));
  });
});

import {FolioError} from '../core/errors';
import {sha256Sync} from '../core/model';

/** A byte-string, not TextDecoder('latin1'): that decoder changes bytes 0x80–0x9f. */
export function originalPdfByteString(bytes: Uint8Array): string {
  if (bytes.length > MAX_CONTENT_BYTES) fail('The content stream exceeds the bounded inline image parser.');
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 32768) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 32768)));
  return chunks.join('');
}

const MAX_CONTENT_BYTES = 16 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const MAX_ENCODED_BYTES = 10 * 1024 * 1024;
const MAX_DECODED_BYTES = 80 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
function fail(reason: string): never { throw new FolioError('PDF_INLINE_IMAGE_PROOF', reason); }
const whitespace = (c: string | undefined) => c !== undefined && ['\0', '\t', '\n', '\f', '\r', ' '].includes(c);
const delimiter = (c: string | undefined) => c === undefined || whitespace(c) || '()<>[]{}/%'.includes(c);

export type InlineDictionaryValue = number | boolean | null | {name: string} | readonly (number | {name: string})[];
export type InlineDictionaryPair = {key: string; canonicalKey: string; rawKey: string; rawValue: string; value: InlineDictionaryValue};
export type InlineImageBudget = {remainingEncodedBytes?: number; remainingDecodedBytes?: number; remainingPixels?: number};
export type OriginalInlineImage = {
  endIndex: number; dictionaryText: string; dictionarySha256: string; dictionary: readonly InlineDictionaryPair[];
  dataStartIndex: number; dataEndIndex: number; encodedBytes: Uint8Array; encodedSha256: string;
  width: number; height: number; bitsPerComponent: number; components: number; pixelCount: number;
  rowBytes: number; expectedDecodedBytes: number; encodedLength: number; imageMask: boolean;
  colorSpace: 'DeviceGray' | 'DeviceRGB' | 'DeviceCMYK' | null;
  filter: 'ASCIIHexDecode' | 'ASCII85Decode' | 'RunLengthDecode' | null;
  interpolate: boolean; decode: readonly number[] | null;
};

const keys: Record<string, string> = {
  W: 'Width', Width: 'Width', H: 'Height', Height: 'Height', BPC: 'BitsPerComponent', BitsPerComponent: 'BitsPerComponent',
  CS: 'ColorSpace', ColorSpace: 'ColorSpace', IM: 'ImageMask', ImageMask: 'ImageMask', I: 'Interpolate', Interpolate: 'Interpolate',
  D: 'Decode', Decode: 'Decode', F: 'Filter', Filter: 'Filter', DP: 'DecodeParms', DecodeParms: 'DecodeParms', Intent: 'Intent',
};
const spaces: Record<string, OriginalInlineImage['colorSpace']> = {G: 'DeviceGray', DeviceGray: 'DeviceGray', RGB: 'DeviceRGB', DeviceRGB: 'DeviceRGB', CMYK: 'DeviceCMYK', DeviceCMYK: 'DeviceCMYK'};
const filters: Record<string, OriginalInlineImage['filter']> = {AHx: 'ASCIIHexDecode', ASCIIHexDecode: 'ASCIIHexDecode', A85: 'ASCII85Decode', ASCII85Decode: 'ASCII85Decode', RL: 'RunLengthDecode', RunLengthDecode: 'RunLengthDecode'};

/**
 * Parse a BI already identified by the caller's content lexer outside strings/comments.
 * Only device colour spaces, masks, and unfiltered/single AHx/A85/RL encodings are owned here.
 * Resource Default* colour spaces and cumulative resource budgets remain the caller's responsibility.
 * Payload boundaries use sample lengths or filter EOD, never a search for binary "EI".
 */
export function parseOriginalInlineImage(text: string, startAfterBI: number, budget: InlineImageBudget = {}): OriginalInlineImage {
  if (text.length > MAX_CONTENT_BYTES || !Number.isSafeInteger(startAfterBI) || startAfterBI < 2 || startAfterBI > text.length ||
      text.slice(startAfterBI - 2, startAfterBI) !== 'BI' || !delimiter(text[startAfterBI - 3]) || !delimiter(text[startAfterBI])) {
    fail('The inline image operator or content bounds are invalid.');
  }
  const bounded = (remaining: number | undefined, maximum: number) => {
    if (remaining === undefined) return maximum;
    if (!Number.isSafeInteger(remaining) || remaining < 0) fail('The inline image resource budget is invalid.');
    return Math.min(remaining, maximum);
  };
  const encodedBudget = bounded(budget.remainingEncodedBytes, MAX_ENCODED_BYTES);
  const decodedBudget = bounded(budget.remainingDecodedBytes, MAX_DECODED_BYTES);
  const pixelBudget = bounded(budget.remainingPixels, MAX_PIXELS);
  let cursor = startAfterBI;
  const checkHeader = () => { if (cursor - startAfterBI > MAX_HEADER_BYTES || cursor > text.length) fail('The inline image dictionary exceeds its bounds.'); };
  const byte = (index: number) => { const n = text.charCodeAt(index); if (!Number.isInteger(n) || n > 255) fail('The inline image must be parsed from exact original bytes.'); return n; };
  const skip = () => {
    while (cursor < text.length) {
      checkHeader(); byte(cursor);
      if (whitespace(text[cursor])) { cursor++; continue; }
      if (text[cursor] === '%') {
        while (cursor < text.length && text[cursor] !== '\r' && text[cursor] !== '\n') { checkHeader(); byte(cursor++); }
        continue;
      }
      break;
    }
    checkHeader();
  };
  const name = () => {
    if (text[cursor++] !== '/') fail('The inline image dictionary requires direct name keys.');
    const start = cursor; let value = '';
    while (cursor < text.length && !delimiter(text[cursor])) {
      checkHeader(); const n = byte(cursor++);
      if (n === 35) {
        const hex = text.slice(cursor, cursor + 2);
        if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('The inline image name escape is malformed.');
        value += String.fromCharCode(parseInt(hex, 16)); cursor += 2;
      } else value += String.fromCharCode(n);
    }
    checkHeader(); if (cursor === start || value.includes('\0')) fail('The inline image name is invalid.');
    return {name: value};
  };
  const primitive = (): number | boolean | null | {name: string} => {
    skip(); if (text[cursor] === '/') return name();
    const start = cursor;
    while (cursor < text.length && !delimiter(text[cursor])) { checkHeader(); byte(cursor++); }
    const token = text.slice(start, cursor); checkHeader();
    if (token === 'true') return true; if (token === 'false') return false; if (token === 'null') return null;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token)) fail('The inline image dictionary contains an unsupported value.');
    const value = Number(token); if (!Number.isFinite(value) || Math.abs(value) > 1e9) fail('The inline image number exceeds its bounds.');
    return value;
  };
  const value = (): InlineDictionaryValue => {
    skip(); if (text[cursor] !== '[') return primitive();
    cursor++; const array: (number | {name: string})[] = [];
    while (true) {
      skip(); if (text[cursor] === ']') { cursor++; break; }
      if (array.length >= 8) fail('The inline image array exceeds its bounds.');
      const item = primitive();
      if (typeof item !== 'number' && !(item && typeof item === 'object' && 'name' in item)) fail('The inline image array contains an unsupported value.');
      array.push(item);
    }
    checkHeader(); return array;
  };
  const dictionary: InlineDictionaryPair[] = [], canonical = new Map<string, InlineDictionaryPair>();
  let dictionaryEnd = 0;
  while (true) {
    skip();
    if (text.slice(cursor, cursor + 2) === 'ID' && delimiter(text[cursor + 2])) { dictionaryEnd = cursor; cursor += 2; break; }
    if (dictionary.length >= 12) fail('The inline image dictionary has too many entries.');
    const keyStart = cursor, key = name().name, rawKey = text.slice(keyStart, cursor), canonicalKey = keys[key];
    if (!Object.hasOwn(keys, key) || canonical.has(canonicalKey)) fail('The inline image dictionary has unsupported or duplicate keys.');
    skip(); const valueStart = cursor, parsed = value();
    const pair = {key, canonicalKey, rawKey, rawValue: text.slice(valueStart, cursor), value: parsed};
    dictionary.push(pair); canonical.set(canonicalKey, pair);
  }
  checkHeader();
  if (!whitespace(text[cursor])) fail('The inline image ID delimiter is missing.');
  // Consume exactly one byte. A second newline belongs to the payload unless the exact framing proves otherwise.
  byte(cursor++); const dataStartIndex = cursor;
  const get = (key: string) => canonical.get(key)?.value;
  const integer = (key: string): number => {
    const pair = canonical.get(key), n = pair?.value;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n <= 0 || !/^[+-]?\d+$/.test(pair!.rawValue)) fail('The inline image dimensions or bit depth are invalid.');
    return n;
  };
  const width = integer('Width'), height = integer('Height'), pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > pixelBudget) fail('The inline image exceeds the remaining pixel budget.');
  const mask = get('ImageMask'), interpolation = get('Interpolate');
  if (mask !== undefined && typeof mask !== 'boolean' || interpolation !== undefined && typeof interpolation !== 'boolean') fail('The inline image boolean metadata is invalid.');
  const imageMask = mask === true, interpolate = interpolation === true;
  const bitsPerComponent = get('BitsPerComponent') === undefined && imageMask ? 1 : integer('BitsPerComponent');
  if (![1, 2, 4, 8, 16].includes(bitsPerComponent) || imageMask && bitsPerComponent !== 1) fail('The inline image bit depth is unsupported.');
  const space = get('ColorSpace'); let colorSpace: OriginalInlineImage['colorSpace'] = null;
  if (imageMask) { if (space !== undefined) fail('Inline image masks cannot declare a colour space.'); }
  else {
    if (!space || typeof space !== 'object' || !('name' in space) || !Object.hasOwn(spaces, space.name)) fail('The inline image colour space requires an owned resource graph.');
    colorSpace = spaces[space.name];
  }
  const components = imageMask || colorSpace === 'DeviceGray' ? 1 : colorSpace === 'DeviceRGB' ? 3 : 4;
  const rowBytes = Math.ceil(width * components * bitsPerComponent / 8), expectedDecodedBytes = rowBytes * height;
  if (!Number.isSafeInteger(expectedDecodedBytes) || expectedDecodedBytes > decodedBudget) fail('The inline image exceeds the remaining decoded byte budget.');
  const decoded = get('Decode'); let decode: number[] | null = null;
  if (decoded !== undefined) {
    if (!Array.isArray(decoded) || decoded.length !== components * 2 || decoded.some(v => typeof v !== 'number')) fail('The inline image Decode array is invalid.');
    decode = decoded as number[];
  }
  const intent = get('Intent');
  if (intent !== undefined && (!intent || typeof intent !== 'object' || !('name' in intent) || !['AbsoluteColorimetric', 'RelativeColorimetric', 'Saturation', 'Perceptual'].includes(intent.name))) fail('The inline image rendering intent is unsupported.');
  if (get('DecodeParms') !== undefined && get('DecodeParms') !== null) fail('Inline image decode parameters require a separately owned decoder.');
  let filterValue = get('Filter');
  if (Array.isArray(filterValue)) { if (filterValue.length !== 1) fail('Inline image filter chains require a separately owned decoder.'); filterValue = filterValue[0]; }
  let filter: OriginalInlineImage['filter'] = null;
  if (filterValue !== undefined) {
    if (!filterValue || typeof filterValue !== 'object' || !('name' in filterValue) || !Object.hasOwn(filters, filterValue.name)) fail('The inline image filter has no proven encoded boundary.');
    filter = filters[filterValue.name];
  }
  let produced = 0;
  const charge = (count: number) => { produced += count; if (produced > expectedDecodedBytes) fail('The inline image filter expands beyond the declared sample bytes.'); };
  const payloadByte = () => {
    if (cursor - dataStartIndex >= encodedBudget || cursor >= text.length) fail('The inline image payload exceeds its bounds or is truncated.');
    return byte(cursor++);
  };
  if (filter === null) {
    if (expectedDecodedBytes > encodedBudget || dataStartIndex + expectedDecodedBytes > text.length) fail('The unfiltered inline image payload exceeds its bounds or is truncated.');
    cursor += expectedDecodedBytes; produced = expectedDecodedBytes;
  } else if (filter === 'ASCIIHexDecode') {
    let digits = 0;
    while (true) {
      const n = payloadByte(); if (n === 62) break;
      if (whitespace(String.fromCharCode(n))) continue;
      if (!/[0-9a-fA-F]/.test(String.fromCharCode(n))) fail('The inline ASCIIHex payload is malformed.');
      if (++digits % 2 === 0) charge(1);
    }
    if (digits % 2) charge(1);
  } else if (filter === 'ASCII85Decode') {
    let group = 0, accumulator = 0;
    while (true) {
      const n = payloadByte(); if (whitespace(String.fromCharCode(n))) continue;
      if (n === 126) {
        if (payloadByte() !== 62 || group === 1) fail('The inline ASCII85 EOD or final group is malformed.');
        if (group) {
          const partial = group;
          while (group++ < 5) accumulator = accumulator * 85 + 84;
          if (accumulator > 0xffffffff) fail('The inline ASCII85 final group overflows.');
          charge(partial - 1);
        }
        break;
      }
      if (n === 122) { if (group) fail('The inline ASCII85 zero shorthand is misplaced.'); charge(4); continue; }
      if (n < 33 || n > 117) fail('The inline ASCII85 payload is malformed.');
      accumulator = accumulator * 85 + n - 33;
      if (++group === 5) { if (accumulator > 0xffffffff) fail('The inline ASCII85 group overflows.'); charge(4); group = 0; accumulator = 0; }
    }
  } else {
    while (true) {
      const n = payloadByte(); if (n === 128) break;
      if (n < 128) { const length = n + 1; charge(length); for (let i = 0; i < length; i++) payloadByte(); }
      else { charge(257 - n); payloadByte(); }
    }
  }
  if (produced !== expectedDecodedBytes) fail('The inline image decoded sample byte count does not match its dimensions.');
  const dataEndIndex = cursor;
  if (!whitespace(text[cursor])) fail('The inline image EI delimiter is missing.');
  let framing = 0;
  while (whitespace(text[cursor])) { if (++framing > MAX_HEADER_BYTES) fail('The inline image EI framing exceeds its bounds.'); byte(cursor++); }
  if (text.slice(cursor, cursor + 2) !== 'EI' || !delimiter(text[cursor + 2])) fail('The inline image has no unambiguous EI boundary.');
  const endIndex = cursor + 2;
  // Validate every original byte before allocating or hashing; never coerce Unicode back to bytes.
  for (let i = dataStartIndex; i < dataEndIndex; i++) byte(i);
  const encodedBytes = new Uint8Array(dataEndIndex - dataStartIndex);
  for (let i = 0; i < encodedBytes.length; i++) encodedBytes[i] = text.charCodeAt(dataStartIndex + i);
  const dictionaryText = text.slice(startAfterBI, dictionaryEnd), dictionaryBytes = new Uint8Array(dictionaryText.length);
  for (let i = 0; i < dictionaryBytes.length; i++) dictionaryBytes[i] = byte(startAfterBI + i);
  return {endIndex, dictionaryText, dictionarySha256: sha256Sync(dictionaryBytes), dictionary, dataStartIndex, dataEndIndex,
    encodedBytes, encodedSha256: sha256Sync(encodedBytes), width, height, bitsPerComponent, components, pixelCount,
    rowBytes, expectedDecodedBytes, encodedLength: encodedBytes.length, imageMask, colorSpace, filter, interpolate, decode};
}

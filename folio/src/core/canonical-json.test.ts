import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { canonicalJson, hashJson, sha256Sync } from './model';

// Frozen historical serializer: exact output authority, not a fast-path mirror.
function historical(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]));
    return input;
  }
  return JSON.stringify(sort(value));
}
const pattern = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) % 251);
const native = (s: string) => createHash('sha256').update(s).digest('hex');
function equivalent(make: () => unknown): void {
  const expected = historical(make()), actual = canonicalJson(make());
  expect(actual === expected).toBe(true);
  expect(native(actual)).toBe(native(expected));
}
describe('canonical byte snapshot compatibility', () => {
  for (const n of [0, 55, 56, 63, 64, 65, 1048576, 4194304]) {
    it(`retains every byte and numeric-key spelling at length ${n}`, () => equivalent(() => pattern(n)));
    it(`retains nonzero-offset view at length ${n}`, () => equivalent(() => pattern(n + 11).subarray(7, 7 + n)));
  }
  const factories: [string, () => unknown][] = [
    ['Buffer', () => Buffer.from([1, 2, 3])],
    ['DataView spoofed Uint8Array prototype', () => Object.setPrototypeOf(new DataView(new ArrayBuffer(2)), Uint8Array.prototype)],
    ['Uint16Array spoofed Uint8Array prototype', () => Object.setPrototypeOf(new Uint16Array([257, 65535]), Uint8Array.prototype)],
    ['Uint8ClampedArray spoofed Uint8Array prototype', () => Object.setPrototypeOf(new Uint8ClampedArray([1, 255]), Uint8Array.prototype)],
    ['subclass', () => new (class extends Uint8Array {})([2, 3])],
    ['cross realm', () => vm.runInNewContext('new Uint8Array([1,2,3])')],
    ['Proxy', () => new Proxy(new Uint8Array([1, 2, 3]), {})],
    ['extra recursive object', () => Object.assign(new Uint8Array([1, 2]), { z: { b: 2, a: 1 } })],
    ['extra undefined', () => Object.assign(new Uint8Array([1, 2]), { extra: undefined })],
    ['own toJSON', () => Object.assign(new Uint8Array([1, 2]), { toJSON() { return 'authored'; } })],
    ['nested record', () => ({ source: { bytes: pattern(65536) }, template: { fonts: [{ bytes: pattern(65536), proof: { bytes: pattern(32) } }] }, draft: [{ text: 'fictional', flags: [true, false] }] })],
    ['later getter preserves earlier snapshot', () => { const bytes = new Uint8Array([1, 2, 3]); return { a: bytes, z: { get mutate() { bytes[0] = 99; return 'changed'; } } }; }],
    ['own hidden length and extra object', () => { const b = Object.assign(new Uint8Array([1, 2]), { extra: { z: 2, a: 1 } }); Object.defineProperty(b, 'length', { value: 3 }); return b; }],
    ['own length getter never invoked', () => { const b = new Uint8Array([1, 2]); Object.defineProperty(b, 'length', { get() { throw Error('own length invoked'); } }); return b; }],
    ['symbol getter ignored', () => { const later = { value: 'unchanged' }, b = new Uint8Array([1, 2]); Object.defineProperty(b, Symbol('authored'), { enumerable: true, get() { later.value = 'mutated'; throw Error('symbol invoked'); } }); return { a: b, z: later }; }],
  ];
  it.each(factories)('retains fallback/snapshot: %s', (_name, make) => equivalent(make));
  it('suppresses prototype toJSON just as the historical copied object does', () => {
    const prior = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toJSON');
    try { Object.defineProperty(Uint8Array.prototype, 'toJSON', { configurable: true, value() { return 'wrong-live-input'; } }); equivalent(() => pattern(5)); }
    finally { if (prior) Object.defineProperty(Uint8Array.prototype, 'toJSON', prior); else Reflect.deleteProperty(Uint8Array.prototype, 'toJSON'); }
  });
  it('uses CreateDataProperty without invoking an inherited numeric setter', () => {
    const prior = Object.getOwnPropertyDescriptor(Object.prototype, '0'); let calls = 0, expected = '', actual = '';
    try { Object.defineProperty(Object.prototype, '0', { configurable: true, set() { calls++; throw Error('inherited setter invoked'); } }); expected = historical(new Uint8Array([7, 8])); actual = canonicalJson(new Uint8Array([7, 8])); }
    finally { if (prior) Object.defineProperty(Object.prototype, '0', prior); else Reflect.deleteProperty(Object.prototype, '0'); }
    expect(calls).toBe(0); expect(actual).toBe(expected); expect(native(actual)).toBe(native(expected));
  });
  it('does not invoke a later Uint8Array prototype length shadow', () => {
    const prior = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'length'); let calls = 0, expected = '', actual = '';
    try { Object.defineProperty(Uint8Array.prototype, 'length', { configurable: true, get() { calls++; throw Error('prototype length invoked'); } }); expected = historical(new Uint8Array([4, 5, 6])); actual = canonicalJson(new Uint8Array([4, 5, 6])); }
    finally { if (prior) Object.defineProperty(Uint8Array.prototype, 'length', prior); else Reflect.deleteProperty(Uint8Array.prototype, 'length'); }
    expect(calls).toBe(0); expect(actual).toBe(expected); expect(native(actual)).toBe(native(expected));
  });
  it('ignores an own Symbol.toStringTag getter', () => {
    let calls = 0;
    equivalent(() => { const bytes = new Uint8Array([3, 4, 5]); Object.defineProperty(bytes, Symbol.toStringTag, { enumerable: true, get() { calls++; throw Error('own tag invoked'); } }); return bytes; });
    expect(calls).toBe(0);
  });
  it('ignores a post-capture prototype Symbol.toStringTag getter', () => {
    const prior = Object.getOwnPropertyDescriptor(Uint8Array.prototype, Symbol.toStringTag); let calls = 0;
    try {
      Object.defineProperty(Uint8Array.prototype, Symbol.toStringTag, { configurable: true, get() { calls++; throw Error('prototype tag invoked'); } });
      equivalent(() => new Uint8Array([6, 7, 8]));
    } finally { if (prior) Object.defineProperty(Uint8Array.prototype, Symbol.toStringTag, prior); else Reflect.deleteProperty(Uint8Array.prototype, Symbol.toStringTag); }
    expect(calls).toBe(0);
  });
  it('observes every in-place byte mutation and leaves inputs unchanged through real hash entrypoints', async () => {
    const bytes = pattern(65), before = bytes.slice(), value = { source: { bytes } };
    const expected = native(historical(value)); expect(await hashJson(value)).toBe(expected); expect(sha256Sync(new TextEncoder().encode(canonicalJson(value)))).toBe(expected);
    expect(Array.from(bytes)).toEqual(Array.from(before)); bytes[17] ^= 1; const changed = await hashJson(value); expect(changed).not.toBe(expected); expect(changed).toBe(native(historical(value)));
  });
});

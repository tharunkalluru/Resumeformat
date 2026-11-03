import { describe, expect, it } from 'vitest';
import { simpleSourcePath } from './pdf-path';

describe('source straight-path admission', () => {
  it('retains the exact line endpoints when pdf-lib repeats its initial move', () => {
    expect(simpleSourcePath(new Float32Array([0, 39.6, 675.5, 0, 39.6, 675.5, 1, 572.4, 675.5]))).toEqual({ points: [[Math.fround(39.6), 675.5], [Math.fround(572.4), 675.5]], closed: false });
  });
  it('retains a closed rectangle without converting other geometry into a rule', () => {
    expect(simpleSourcePath([0, 20, 20, 1, 100, 20, 1, 100, 40, 1, 20, 40, 4])).toEqual({ points: [[20, 20], [100, 20], [100, 40], [20, 40]], closed: true });
  });
  it.each([
    [0, 20, 20, 0, 21, 20, 1, 100, 20],
    [0, 20, 20, 1, 100, 20, 0, 20, 20, 1, 100, 40],
    [0, 20, 20, 2, 30, 20, 60, 40, 100, 20],
    [0, 20, 20, 1, NaN, 20], [0, 20], [1, 20, 20],
    [0, 20, 20, 4, 1, 30, 20],
  ].map(data => ({ data })))('refuses compound, curved or malformed path $data', ({ data }) => {
    expect(simpleSourcePath(data)).toBeUndefined();
  });
});

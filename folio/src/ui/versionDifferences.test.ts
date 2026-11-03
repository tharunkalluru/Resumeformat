import { describe, expect, it } from 'vitest';
import { diffWords, versionDifferences } from './versionDifferences';
import { fixtureProject } from '../core/testFixture';
import { saveVersion } from '../core/folio';
import { createApplication } from '../core/applications';
import { approveTemplate, editBlock } from '../core/commands';

describe('read-only saved wording differences', () => {
  it.each([
    ['Ran experiments, lifting conversion.', 'Ran experiments, raising conversion.'],
    ['A A B\nC', 'A B A\nC'], ['résumé 😀\tC++ 20%', 'résumé 😀\tC# 30%'], ['', 'Added text'], ['Removed text', ''],
    ['same sentence', 'same sentence'], ['A '.repeat(900) + 'old', 'A '.repeat(900) + 'new'],
  ])('preserves both exact strings, including whitespace: %s', (before, after) => {
    const result = diffWords(before, after);
    expect(result.filter(part => part.kind !== 'added').map(part => part.text).join('')).toBe(before);
    expect(result.filter(part => part.kind !== 'removed').map(part => part.text).join('')).toBe(after);
    if (before !== after) expect(result.some(part => part.kind !== 'same')).toBe(true);
  });
  it('marks the changed word without striking unchanged neighboring words', () => {
    expect(diffWords('experiments, lifting conversion', 'experiments, raising conversion')).toEqual([
      { kind: 'same', text: 'experiments, ' }, { kind: 'removed', text: 'lifting' }, { kind: 'added', text: 'raising' }, { kind: 'same', text: ' conversion' },
    ]);
  });
  it('shows actual page ownership and distinguishes formatting-only changes without mutating either version', async () => {
    const original = saveVersion(await createApplication(await approveTemplate(await fixtureProject(), [])), 'download');
    const version = original.folio!.versions[0], before = JSON.stringify(version);
    const block = original.draft.blocks[0];
    const edited = editBlock(original, block.id, block.runs.map(run => ({ ...run, bold: !run.bold })));
    const source = JSON.stringify(edited), result = versionDifferences(edited, version);
    expect(result).toHaveLength(1); expect(result[0].page).toBe(1); expect(result[0].formattingOnly).toBe(true);
    expect(JSON.stringify(edited)).toBe(source); expect(JSON.stringify(version)).toBe(before);
  });
});

import { describe, expect, it } from 'vitest';
import { fixtureProject } from '../core/testFixture';
import type { TextRegion, TextRun } from '../core/model';
import { sourceRunsUnchanged } from './DocumentCanvas';

async function fixture() {
  const project = await fixtureProject();
  const region = project.template.pages[0].regions[0] as TextRegion;
  const text = project.baseline.blocks[0].runs.map(run => run.text).join('');
  region.sourceLayout = {
    version: 1, sourceSha256: project.source.sha256, baselineRunsHash: 'fixture',
    anchor: 'start', startX: 50, endX: 250, baseline: 60, fontSize: 10,
    glyphs: Array.from(text).map((unicode, index) => ({ fontId: 'fixture', cid: index + 1, unicode, x: 50 + index * 5, advance: 5, operatorIndex: 1 })),
  };
  return { project, region };
}

describe('read-only source canvas masks', () => {
  it('accepts unchanged effective runs and harmless identical run partitions', async () => {
    const { project, region } = await fixture();
    expect(sourceRunsUnchanged(project, region)).toBe(true);
    const run = project.draft.blocks[0].runs[0];
    project.draft.blocks[0].runs = [{ ...run, text: run.text.slice(0, 5) }, { ...run, text: run.text.slice(5), bold: false, italic: false }];
    expect(sourceRunsUnchanged(project, region)).toBe(true);
  });

  it.each<Partial<TextRun>>([{ underline: true }, { bold: true }, { italic: true }, { href: 'https://example.com/' }, { sourceFactIds: ['different-evidence'] }])(
    'refuses external changes with identical wording: %j', async change => {
      const { project, region } = await fixture();
      project.draft.blocks[0].runs[0] = { ...project.draft.blocks[0].runs[0], ...change };
      expect(sourceRunsUnchanged(project, region)).toBe(false);
    },
  );

  it('refuses missing baseline or a current string that is no longer the original glyph graph', async () => {
    const { project, region } = await fixture();
    project.draft.blocks[0].runs[0].text += ' Changed.';
    expect(sourceRunsUnchanged(project, region)).toBe(false);
    project.baseline.blocks = [];
    expect(sourceRunsUnchanged(project, region)).toBe(false);
  });
});

import { sourceAdvanceBox, sourceRegistrationReady } from './DocumentCanvas';

describe('native source geometry and readiness', () => {
  it('aligns advances independently of negative bearings and right ink overhang', () => {
    expect(sourceAdvanceBox(49.5, 50, 150)).toEqual({ left: 0.5, width: 100 });
    expect(sourceAdvanceBox(50, 50, 149.39).width).toBeCloseTo(99.39, 10);
    expect(sourceAdvanceBox(51, 50, 150)).toEqual({ left: -1, width: 100 });
    expect(() => sourceAdvanceBox(0, 20, 10)).toThrow();
    expect(() => sourceAdvanceBox(0, NaN, 10)).toThrow();
  });
  it('refuses typing while a source face is pending, failed, missing or stale', () => {
    const face = { status: 'editable' as const };
    expect(sourceRegistrationReady('current', 'current', 'current', face)).toBe(true);
    expect(sourceRegistrationReady('current', '', 'current', face)).toBe(false);
    expect(sourceRegistrationReady('current', 'current', 'old', face)).toBe(false);
    expect(sourceRegistrationReady('current', 'current', 'current')).toBe(false);
    expect(sourceRegistrationReady('current', 'current', 'current', { status: 'readOnly' })).toBe(false);
    expect(sourceRegistrationReady('', '', '', face)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { approveTemplate } from './commands';
import { fixtureProject } from './testFixture';
import { adjustTextRegion, resetTextRegion } from './templateRepair';
import { validateProject } from './schema';

describe('preapproval text box repair', () => {
  it('preserves source, text, page dimensions, styles and unrelated regions; records and resets original bounds', async () => {
    const project = await fixtureProject(), region = project.template.pages[0].regions[0];
    const source = structuredClone(project);
    const first = adjustTextRegion(project, region.id, { ...region.bounds, width: 490 });
    const second = adjustTextRegion(first, region.id, { ...region.bounds, x: 55, width: 480 });
    expect(project).toEqual(source);
    expect(second.source).toBe(project.source);
    expect(second.baseline).toBe(project.baseline);
    expect(second.draft).toBe(project.draft);
    expect(second.template.adjustments).toEqual([{ regionId: region.id, before: region.bounds, after: { ...region.bounds, x: 55, width: 480 } }]);
    expect(validateProject(second).template.pages[0].width).toBe(612);
    const reset = resetTextRegion(second, region.id);
    expect(reset.template.pages[0].regions[0].bounds).toEqual(region.bounds);
    expect(reset.template.adjustments).toEqual([]);
    expect(reset.template.revision).toBe(project.template.revision + 3);
    expect(reset.approval).toBeNull();
    expect(reset.reviewedDraftRevision).toBeNull();
  });
  it('rejects out-of-page, nonfinite, zero and non-text geometry without modifying the project', async () => {
    const project = await fixtureProject(), region = project.template.pages[0].regions[0];
    for (const bounds of [{ ...region.bounds, x: -1 }, { ...region.bounds, width: 0 }, { ...region.bounds, y: Number.NaN }, { ...region.bounds, width: 900 }]) expect(() => adjustTextRegion(project, region.id, bounds)).toThrow();
    expect(() => adjustTextRegion(project, 'missing', region.bounds)).toThrow();
    expect(project.template.adjustments).toBeUndefined();
  });
  it('rejects repairs on approved or application records and no-ops unchanged bounds', async () => {
    const project = await fixtureProject(), region = project.template.pages[0].regions[0];
    expect(adjustTextRegion(project, region.id, region.bounds)).toBe(project);
    expect(() => adjustTextRegion({ ...project, workspace: { templateGroupId: project.id, kind: 'application' } }, region.id, { ...region.bounds, x: 55 })).toThrow();
    const approved = await approveTemplate(project, []);
    expect(() => adjustTextRegion(approved, region.id, { ...region.bounds, x: 55 })).toThrow();
  });
});

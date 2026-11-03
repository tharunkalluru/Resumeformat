import { describe, expect, it } from 'vitest';
import { approveTemplate, withdrawApproval } from './commands';
import { createApplication } from './applications';
import { fixtureProject } from './testFixture';
import { composerSource, sourceForNewJob } from './composerSources';

describe('composer source identity', () => {
  it('keeps a reopened job pinned when its reusable source is withdrawn or removed', async () => {
    const a = await approveTemplate(await fixtureProject(), []), b = await approveTemplate(await fixtureProject(), []);
    const application = await createApplication(a, { title: '', company: '', description: 'An independently saved job.' });
    const before = structuredClone(application);
    expect(composerSource([withdrawApproval(a), b], application, application.id, { selectedId: b.id, defaultId: b.id })).toBe(application);
    expect(composerSource([b], application, application.id, { selectedId: b.id, defaultId: b.id })).toBe(application);
    expect(application).toEqual(before);
  });
  it('restores the explicit last choice ahead of update order and falls back to the saved default', async () => {
    const a = await approveTemplate(await fixtureProject(), []), b = await approveTemplate(await fixtureProject(), []);
    expect(composerSource([b, a], null, null, { selectedId: a.id, defaultId: b.id })).toBe(a);
    expect(composerSource([b, a], null, null, { selectedId: 'removed', defaultId: a.id })).toBe(a);
    expect(composerSource([withdrawApproval(a)], null, null, { selectedId: a.id, defaultId: a.id })).toBeUndefined();
  });
  it('new jobs can use the original reusable source while an old job retains its snapshot', async () => {
    const a = await approveTemplate(await fixtureProject(), []), b = await approveTemplate(await fixtureProject(), []);
    const application = await createApplication(a);
    expect(sourceForNewJob([b, a], application, { selectedId: b.id, defaultId: b.id })).toBe(a);
    expect(sourceForNewJob([b], application, { selectedId: b.id, defaultId: b.id })).toBe(b);
    expect(sourceForNewJob([b, a], a, { selectedId: b.id, defaultId: b.id })).toBe(a);
  });
});

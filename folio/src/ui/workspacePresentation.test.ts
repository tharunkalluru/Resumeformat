import { describe, expect, it } from 'vitest';
import { createApplication } from '../core/applications';
import { approvedControlProject } from './integrationControlFixture';
import { applicationEntries, applicationProgress, applicationSearchText } from './workspacePresentation';

async function application() {
  return createApplication(await approvedControlProject(), { title: 'Product Designer', company: 'Cedar', description: 'Design accessible interfaces with React.' });
}
describe('Application presentation uses durable evidence', () => {
  it('does not confuse a generated result with applicant review', async () => {
    const project = await application();
    project.folio = { state: 'ready', jobIdentity: 'job-1', privateNotes: '', historyKnown: true, completions: [{ id: 'request-1', jobIdentity: 'job-1', completedAt: project.updatedAt }], versions: [], changes: {} };
    expect(applicationProgress(project)).toMatchObject({ stage: 'review', label: 'Review changes', lastDownload: undefined });
  });
  it('describes a confirmation record without claiming export readiness or human PDF review', async () => {
    const project = await application(); project.reviewedDraftRevision = project.draft.revision;
    expect(applicationProgress(project)).toMatchObject({ label: 'Claims confirmed', description: 'Claim confirmation is recorded. Inspect the current PDF before download.' });
  });
  it('invalidates confirmation presentation when wording changes', async () => {
    const project = await application(); project.reviewedDraftRevision = project.draft.revision; project.draft.revision++;
    expect(applicationProgress(project)).toMatchObject({ stage: 'review', label: 'Review changes' });
  });
  it('prioritizes stale layout approval over a claim confirmation', async () => {
    const project = await application(); project.reviewedDraftRevision = project.draft.revision; project.template.revision++;
    expect(applicationProgress(project).label).toBe('Layout review needed');
  });
  it('keeps historical downloads separate from current draft status', async () => {
    const project = await application(), oldContent = structuredClone(project.draft);
    project.folio = { state: 'draft', jobIdentity: 'job-1', privateNotes: '', historyKnown: true, completions: [], changes: {}, versions: [
      { id: 'download-1', kind: 'download', createdAt: '2026-10-01T12:00:00.000Z', content: oldContent },
      { id: 'result-1', kind: 'firstResult', createdAt: '2026-10-15T12:00:00.000Z', content: oldContent },
    ] };
    project.draft.revision++;
    expect(applicationProgress(project)).toMatchObject({ stage: 'review', lastDownload: { id: 'download-1', content: { revision: oldContent.revision } } });
  });
  it('filters resume sources without mutating library order and searches source names', async () => {
    const resume = await approvedControlProject(), first = await application(), second = await application();
    first.updatedAt = '2026-10-01T00:00:00.000Z'; second.updatedAt = '2026-10-15T00:00:00.000Z';
    const library = [resume, first, second];
    expect(applicationEntries(library).map(item => item.id)).toEqual([second.id, first.id]);
    expect(library).toEqual([resume, first, second]);
    expect(applicationSearchText(first)).toContain(first.source.name.toLocaleLowerCase());
  });
});

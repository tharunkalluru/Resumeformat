import { describe, expect, it } from 'vitest';
import { applicationName, createApplication, renameApplication } from './applications';
import { addCareerNote, approveTemplate, confirmDraft, dismissEvidence, editBlock, insertEvidence, setJob, withdrawApproval } from './commands';
import { blockText, hasValidApproval, hashJson, workspaceOf } from './model';
import { validateProject } from './schema';
import { fixtureProject } from './testFixture';

describe('reusable resume and isolated application snapshots', () => {
  it('starts a new job from the approved baseline without copying the current draft evidence', async () => {
    let resume = await approveTemplate(await fixtureProject(), []);
    resume = addCareerNote(resume, 'Current-job-only career note.');
    resume = setJob(resume, { title: 'Older role', company: 'Older company', description: 'Older job description.' });
    resume = confirmDraft(editBlock(resume, resume.draft.blocks[0].id, [{ text: 'Current draft wording approved for the older role.' }]));
    resume = dismissEvidence(resume, resume.facts[0].id);
    const preserved = structuredClone(resume);
    const job = { title: 'New role', company: 'New company', description: 'New job description.' };
    const application = await createApplication(resume, job);

    expect(resume).toEqual(preserved);
    expect(application.id).not.toBe(resume.id);
    expect(application.workspace).toEqual({ templateGroupId: resume.id, kind: 'application' });
    expect(application.name).toBe('New role at New company');
    expect(application.job).toEqual(job);
    expect(application.draft).toEqual(resume.baseline);
    expect(application.notes).toEqual([]);
    expect(application.facts).toEqual(resume.facts.filter(fact => fact.kind === 'resume'));
    expect(application.evidenceDecisions).toEqual({});
    expect(application.reviewedDraftRevision).toBeNull();
    expect(application.approval).toEqual(resume.approval);
    expect(application.revision).toBe(1);
  });

  it('deep copies every source and template snapshot so mutable objects cannot leak between jobs', async () => {
    const resume = await approveTemplate(await fixtureProject(), []);
    resume.assets.push({ id: 'sample-image', name: 'test.png', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) });
    const a = await createApplication(resume), b = await createApplication(resume);
    const preserved = structuredClone(resume), preservedB = structuredClone(b);
    a.source.bytes[0] = 0;
    a.assets[0].bytes[0] = 9;
    a.template.pages[0].regions[0].bounds.x += 10;
    a.baseline.blocks[0].runs[0].text = 'Changed only this copy.';
    a.draft.blocks[0].runs[0].text = 'Another change only in this copy.';
    a.facts[0].text = 'Changed only this fact copy.';
    a.approval!.acknowledgedWarnings.push('isolated-warning');
    a.workspace.templateGroupId = 'isolated-group';
    expect(resume).toEqual(preserved);
    expect(b).toEqual(preservedB);
  });

  it('keeps edits, facts, career notes, evidence decisions and review independent across two applications', async () => {
    const resume = await approveTemplate(await fixtureProject(), []), original = structuredClone(resume);
    let a = await createApplication(resume, { title: 'Application A', company: '', description: 'React' });
    let b = await createApplication(resume, { title: 'Application B', company: '', description: 'TypeScript' });
    a = addCareerNote(a, 'Application A supplied note.');
    a = insertEvidence(a, a.notes[0].id, a.draft.blocks[0].id);
    a = confirmDraft(a);
    const savedA = structuredClone(a);
    b = confirmDraft(editBlock(b, b.draft.blocks[0].id, [{ text: 'Application B independently reviewed wording.' }]));
    b = dismissEvidence(b, b.facts[0].id);
    expect(a).toEqual(savedA);
    expect(resume).toEqual(original);
    expect(a.job.description).toBe('React');
    expect(b.job.description).toBe('TypeScript');
    expect(blockText(a.draft.blocks[0])).toBe('Application A supplied note.');
    expect(blockText(b.draft.blocks[0])).toBe('Application B independently reviewed wording.');
    expect(b.notes).toEqual([]);
    expect(b.facts.some(fact => fact.text === a.notes[0].text)).toBe(false);
    expect(a.facts.some(fact => fact.text === blockText(b.draft.blocks[0]))).toBe(false);
    expect(a.evidenceDecisions[a.notes[0].id].status).toBe('accepted');
    expect(b.evidenceDecisions[a.notes[0].id]).toBeUndefined();
    expect(a.reviewedDraftRevision).toBe(a.draft.revision);
    expect(b.reviewedDraftRevision).toBeNull();
  });

  it('preserves an old pinned approval when the reusable resume changes for future applications', async () => {
    const resume = await approveTemplate(await fixtureProject(), []);
    const application = await createApplication(resume), preserved = structuredClone(application);
    const revised = withdrawApproval(resume);
    revised.template = structuredClone(revised.template);
    revised.template.revision++;
    revised.template.pages[0].regions[0].bounds.width -= 5;
    expect(application).toEqual(preserved);
    expect(hasValidApproval(application)).toBe(true);
    await expect(createApplication(revised)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });
    const next = await createApplication(await approveTemplate(revised, []));
    expect(next.template.revision).toBe(resume.template.revision + 1);
    expect(application.template.revision).toBe(resume.template.revision);
    expect(next.workspace.templateGroupId).toBe(application.workspace.templateGroupId);
  });

  it('refuses absent, outdated-renderer or hash-stale approval and per-job templates', async () => {
    await expect(createApplication(await fixtureProject())).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });
    const resume = await approveTemplate(await fixtureProject(), []);
    const rendererChanged = structuredClone(resume); rendererChanged.approval!.rendererVersion = 'older-renderer';
    await expect(createApplication(rendererChanged)).rejects.toMatchObject({ code: 'TEMPLATE_NOT_APPROVED' });
    const geometryChanged = structuredClone(resume); geometryChanged.template.pages[0].regions[0].bounds.width--;
    await expect(createApplication(geometryChanged)).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const baselineChanged = structuredClone(resume); baselineChanged.baseline.blocks[0].runs[0].text += ' changed';
    await expect(createApplication(baselineChanged)).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    const sourceChanged = structuredClone(resume); sourceChanged.source.bytes[0] = 0;
    await expect(createApplication(sourceChanged)).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await expect(createApplication(await createApplication(resume))).rejects.toMatchObject({ code: 'RESUME_REQUIRED' });
  });

  it('rejects baseline references that would require carrying career-note or applicant-edit facts', async () => {
    const resume = addCareerNote(await fixtureProject(), 'A manually substituted baseline fact.');
    const note = resume.notes[0];
    resume.baseline.blocks[0] = { ...resume.baseline.blocks[0], sourceFactIds: [note.id], runs: [{ text: note.text, sourceFactIds: [note.id] }] };
    const approved = await approveTemplate(resume, []);
    await expect(createApplication(approved)).rejects.toMatchObject({ code: 'BASELINE_EVIDENCE_INVALID' });
  });

  it('supports understandable empty-job names and renames without invalidating document review', async () => {
    let application = await createApplication(await approveTemplate(await fixtureProject(), []));
    expect(application.name).toBe('Untitled application');
    application = confirmDraft(application);
    const renamed = renameApplication(application, '  My second application  ');
    expect(renamed.name).toBe('My second application');
    expect(renamed.revision).toBe(application.revision + 1);
    expect(renamed.draft).toBe(application.draft);
    expect(renamed.reviewedDraftRevision).toBe(application.reviewedDraftRevision);
    expect(renameApplication(renamed, renamed.name)).toBe(renamed);
    expect(() => renameApplication(application, ' ')).toThrow();
    expect(applicationName({ title: '', company: 'North Studio', description: '' })).toBe('Application for North Studio');
    expect(applicationName({ title: 'A'.repeat(300), company: 'B'.repeat(300), description: '' })).toHaveLength(500);
  });

  it('normalizes legacy metadata without discarding the current draft or altering approval hashes', async () => {
    const resume = confirmDraft(await approveTemplate(await fixtureProject(), []));
    const legacy: Record<string, unknown> = { ...structuredClone(resume) }; delete legacy.workspace;
    const migrated = validateProject(legacy);
    expect(migrated.workspace).toEqual({ templateGroupId: resume.id, kind: 'resume' });
    expect(migrated.draft).toEqual(resume.draft);
    expect(migrated.reviewedDraftRevision).toBe(resume.reviewedDraftRevision);
    expect(migrated.approval).toEqual(resume.approval);
    expect(await hashJson(migrated.template)).toBe(resume.approval!.layoutHash);
    expect(workspaceOf({ id: resume.id })).toEqual(migrated.workspace);
    expect(legacy.workspace).toBeUndefined();
  });
});

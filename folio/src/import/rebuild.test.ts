import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureProject } from '../core/testFixture';
import { addCareerNote, approveTemplate, editBlock, setJob } from '../core/commands';
import { initCareerMemory, setMemoryDraft } from '../core/careerMemory';
import { sha256, type ImportResult } from '../core/model';
import { IMPORTER_VERSION } from './common';
import { importResume } from './index';
import { currentReconstruction, hasEarlierReconstruction, rebuildFromOriginal } from './rebuild';

vi.mock('./index', () => ({ importResume: vi.fn() }));
const parser = vi.mocked(importResume);

describe('rebuilding a retained original', () => {
  beforeEach(() => { parser.mockReset(); });

  it('creates a distinct unapproved group while preserving the old draft, job, memory and original', async () => {
    let old = initCareerMemory(await approveTemplate(await fixtureProject(), []));
    old = setJob(old, { title: 'Saved job', company: 'Fictional employer', description: 'Original saved description' });
    old = addCareerNote(old, 'Applicant-confirmed older note');
    old = editBlock(old, old.draft.blocks[0].id, [{ text: 'Saved custom wording' }]);
    old = setMemoryDraft(old, 'Unfinished reusable context', old.careerMemory!.revision);
    const previous = structuredClone(old);
    const freshImport = await fixtureProject();
    freshImport.template.importerVersion = IMPORTER_VERSION;
    freshImport.source.bytes = new Uint8Array(old.source.bytes);
    freshImport.source.sha256 = old.source.sha256;
    freshImport.template.sourceImageContract={version:'direct-image-inventory-v1',sourceSha256:old.source.sha256,pages:freshImport.template.pages.map((_,i)=>({pageNumber:i+1,status:'none'}))};
    parser.mockImplementation(async file => {
      expect(await sha256(new Uint8Array(await file.arrayBuffer()))).toBe(old.source.sha256);
      expect(file.name).toBe(old.source.name);
      return freshImport as ImportResult;
    });
    const rebuilt = await rebuildFromOriginal(old);
    expect(old).toEqual(previous);
    expect(rebuilt.id).not.toBe(old.id);
    expect(rebuilt.workspace!.templateGroupId).not.toBe(old.workspace!.templateGroupId);
    expect(rebuilt.source.sha256).toBe(old.source.sha256);
    expect(rebuilt.source.bytes).not.toBe(old.source.bytes);
    expect(rebuilt.approval).toBeNull();
    expect(rebuilt.job.description).toBe('');
    expect(rebuilt.notes).toEqual([]);
    expect(rebuilt.draft).toEqual(rebuilt.baseline);
    expect(rebuilt.careerMemory!.sources).toEqual([]);
    expect(rebuilt.careerMemory!.draftText).toBe('');
    expect(rebuilt.careerMemory!.onboarding).toBe('contextPending');
    expect(rebuilt.name).toBe(`${old.name} · Rebuilt`);
    expect(rebuilt.fictional).toBe(old.fictional);
  });

  it('refuses a corrupt retained original before parsing or mutating it', async () => {
    const old = await fixtureProject();
    old.source.bytes[0] ^= 1;
    const previous = structuredClone(old);
    await expect(rebuildFromOriginal(old)).rejects.toMatchObject({ code: 'SOURCE_CHECKSUM' });
    expect(parser).not.toHaveBeenCalled();
    expect(old).toEqual(previous);
  });

  it('keeps the old resume when parsing fails or returns another original', async () => {
    const old = await fixtureProject(), previous = structuredClone(old);
    parser.mockRejectedValueOnce(new Error('Unsupported source font'));
    await expect(rebuildFromOriginal(old)).rejects.toThrow('Unsupported source font');
    const wrong = await fixtureProject();
    wrong.source.sha256 = 'f'.repeat(64);
    parser.mockResolvedValueOnce(wrong);
    await expect(rebuildFromOriginal(old)).rejects.toMatchObject({ code: 'SOURCE_CHECKSUM' });
    expect(old).toEqual(previous);
  });

  it('identifies earlier saved import versions without labelling the current or unknown versions', async () => {
    const project = await fixtureProject();
    for (const version of ['folio-import-v1', 'folio-import-v2', 'folio-import-v7', 'folio-import-v8', 'folio-import-v9', 'folio-import-v10', 'folio-import-v11', 'folio-import-v12']) {
      project.template.importerVersion = version;
      expect(hasEarlierReconstruction(project)).toBe(true);
    }
    for (const version of [IMPORTER_VERSION, 'folio-import-v14', 'approximate-recovery', 'fixture-v1']) {
      project.template.importerVersion = version;
      expect(hasEarlierReconstruction(project)).toBe(false);
    }
  });

  it('reuses only a current supported reusable reconstruction of the same original', async () => {
    const old = await fixtureProject(); old.template.importerVersion = 'folio-import-v2';
    const make = (id: string, updatedAt: string) => ({ ...structuredClone(old), id, workspace: { templateGroupId: id, kind: 'resume' as const }, updatedAt, template: { ...structuredClone(old.template), importerVersion: IMPORTER_VERSION } });
    const first = make('first', '2026-10-01T00:00:00.000Z'), newest = make('newest', '2026-10-02T00:00:00.000Z');
    const application = { ...make('tailored', '2026-10-07T00:00:00.000Z'), workspace: { templateGroupId: old.id, kind: 'application' as const } };
    const other = make('other-file', '2026-10-07T00:00:00.000Z'); other.source.sha256 = 'f'.repeat(64);
    const blocked = make('blocked', '2026-10-07T00:00:00.000Z'); blocked.template.warnings = [{ id: 'font', code: 'UNKNOWN_FONT', severity: 'blocking', message: 'Unsupported source font' }];
    const older = make('older', '2026-10-07T00:00:00.000Z'); older.template.importerVersion = 'folio-import-v7';
    const wrongFormat = make('word', '2026-10-07T00:00:00.000Z'); wrongFormat.source.format = 'docx';
    const library = [first, application, other, blocked, older, wrongFormat, newest];
    const before = structuredClone(library);
    expect(currentReconstruction(old, library)).toBe(newest);
    expect(currentReconstruction(old, [application, other, blocked, older, wrongFormat])).toBeUndefined();
    expect(currentReconstruction(newest, [newest])).toBeUndefined();
    expect(library).toEqual(before);
  });
});

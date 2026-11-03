import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { openDB } from 'idb';
import JSZip from 'jszip';
import { fixtureProject } from '../core/testFixture';
import { adoptProjectCheckpoint, backupProject, backupUnavailableProject, loadLibrary, loadProjects, removeProject, restoreProject, saveProject } from './projects';
import { addCareerNote, approveTemplate, confirmDraft, dismissEvidence, editBlock, insertEvidence, setJob } from '../core/commands';
import { createApplication } from '../core/applications';
import { projectSchema } from '../core/schema';

beforeEach(async () => {
  const database = await openDB('folio-local-v1', 2, { upgrade(db) { if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' }); if (!db.objectStoreNames.contains('groupState')) db.createObjectStore('groupState', { keyPath: 'templateGroupId' }); } });
  await database.clear('projects');
  await database.clear('groupState');
  database.close();
});
describe('device persistence and portable recovery', () => {
  it('does not roll a writer checkpoint back when reopening an older library object after its own successful save', async () => {
    const original = await fixtureProject(); await saveProject(original);
    const staleLibraryObject = (await loadLibrary()).projects.find(project => project.id === original.id)!;
    const edited = setJob(original, { title: '', company: '', description: 'Latest fictional job retained after save recovery.' });
    await saveProject(edited);
    adoptProjectCheckpoint(staleLibraryObject);
    await expect(saveProject(edited)).resolves.toBeUndefined();
    expect((await loadProjects()).find(project => project.id === original.id)?.job.description).toBe(edited.job.description);
  });
  it('retains bounded font provenance across schema, reload, application copy and backup without rewriting legacy templates', async () => {
    const legacy = await fixtureProject(), legacySnapshot = structuredClone(legacy);
    expect(projectSchema.parse(legacy).template.warnings).toEqual([]);
    const warning = { id: 'font-observation', code: 'FONT_SUBSTITUTION', severity: 'review' as const, message: 'Source ABCDEF+SourceSans3-Bold uses DejaVuSans.ttf regular 400; style unknown.', pageId: legacy.template.pages[0].id, fontMapping: { sourceResource: 'g_font_1', sourceName: 'ABCDEF+SourceSans3-Bold', targetFace: 'DejaVuSans.ttf', sourceStyle: 'unknown' as const } };
    const project = structuredClone(legacy); project.template.warnings.push(warning);
    const approved = await approveTemplate(project, [warning.id]);
    await saveProject(approved);
    expect((await loadProjects())[0].template.warnings).toEqual([warning]);
    const application = await createApplication(approved);
    expect(application.template.warnings).toEqual([warning]);
    application.template.warnings[0].fontMapping!.sourceName = 'Changed only in application';
    expect(approved.template.warnings[0]).toEqual(warning);
    const restored = await restoreProject(new File([await backupProject(approved)], 'font-provenance.folio.zip'));
    expect(restored.template.warnings).toEqual([warning]);
    expect(legacy).toEqual(legacySnapshot);
    expect(projectSchema.safeParse({ ...approved, template: { ...approved.template, warnings: [{ ...warning, code: 'PDF_FIXED_LINES' }] } }).success).toBe(false);
    for (const fontMapping of [{ ...warning.fontMapping, sourceResource: 'x'.repeat(129) }, { ...warning.fontMapping, sourceName: 'unsafe\nname' }, { ...warning.fontMapping, sourceStyle: 'bold' }, { ...warning.fontMapping, extra: true }]) {
      expect(projectSchema.safeParse({ ...approved, template: { ...approved.template, warnings: [{ ...warning, fontMapping }] } }).success).toBe(false);
    }
  });
  it('does not recreate a record removed by another tab; preserves the open snapshot for backup', async () => {
    const project = await fixtureProject(); await saveProject(project);
    const database = await openDB('folio-local-v1', 2); await database.delete('projects', project.id);
    const edited = { ...project, name: 'Unsaved edits in the original tab', revision: project.revision + 1 };
    await expect(saveProject(edited)).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect(await database.get('projects', project.id)).toBeUndefined();
    const restored = await restoreProject(new File([await backupProject(edited)], 'open-edits.folio.zip'));
    expect(restored.name).toContain(edited.name); database.close();
  });
  it('normalizes legacy workspace in memory while preserving every prior application field and the raw record', async () => {
    let project = await approveTemplate(await fixtureProject(), []);
    project = addCareerNote(project, 'Legacy note retained.');
    project = setJob(project, { title: 'Legacy role', company: 'Legacy company', description: 'Legacy job description.' });
    project = confirmDraft(editBlock(project, project.draft.blocks[0].id, [{ text: 'Legacy applicant-confirmed draft.' }]));
    const legacy: Record<string, unknown> = { ...structuredClone(project) }; delete legacy.workspace;
    const database = await openDB('folio-local-v1', 2); await database.put('projects', legacy);
    const library = await loadLibrary();
    expect(library.projects[0]).toEqual(project);
    expect(library.unavailable).toEqual([]);
    expect(await database.get('projects', project.id)).toEqual(legacy);
    database.close();
  });
  it('saves two independent applications and deletes one without removing the reusable resume', async () => {
    const resume = await approveTemplate(await fixtureProject(), []);
    let a = await createApplication(resume, { title: 'Role A', company: '', description: 'React' });
    let b = await createApplication(resume, { title: 'Role B', company: '', description: 'TypeScript' });
    a = confirmDraft(editBlock(a, a.draft.blocks[0].id, [{ text: 'Reviewed wording for application A.' }]));
    b = addCareerNote(b, 'Application B confirmed note.');
    b = insertEvidence(b, b.notes[0].id, b.draft.blocks[0].id);
    await saveProject(resume); await saveProject(a); await saveProject(b);
    const saved = await loadProjects();
    expect(saved.find(project => project.id === resume.id)).toEqual(resume);
    expect(saved.find(project => project.id === a.id)).toEqual(a);
    expect(saved.find(project => project.id === b.id)).toEqual(b);
    await removeProject(a.id);
    const remaining = await loadProjects();
    expect(remaining).toHaveLength(2);
    expect(remaining.find(project => project.id === resume.id)).toEqual(resume);
    expect(remaining.find(project => project.id === b.id)).toEqual(b);
  });
  it('restores a selected application into an independent reusable group while retaining its job and evidence', async () => {
    const resume = await approveTemplate(await fixtureProject(), []);
    let application = await createApplication(resume, { title: 'Backup role', company: 'North Studio', description: 'Accessible interfaces.' });
    application = addCareerNote(application, 'Accessible interfaces supplied for this application.');
    application = confirmDraft(insertEvidence(application, application.notes[0].id, application.draft.blocks[0].id));
    const restored = await restoreProject(new File([await backupProject(application)], 'application.folio.zip'));
    expect(restored.id).not.toBe(application.id);
    expect(restored.workspace).toEqual({ templateGroupId: restored.id, kind: 'resume' });
    expect(restored.workspace.templateGroupId).not.toBe(application.workspace.templateGroupId);
    expect(restored.job).toEqual(application.job);
    expect(restored.notes).toEqual(application.notes);
    expect(restored.facts).toEqual(application.facts);
    expect(restored.draft).toEqual(application.draft);
    expect(restored.evidenceDecisions).toEqual(application.evidenceDecisions);
    expect(restored.reviewedDraftRevision).toBeNull();
    expect(restored.approval).toEqual(application.approval);
    const next = await createApplication(restored);
    expect(next.workspace.templateGroupId).toBe(restored.id);
    expect(next.draft).toEqual(restored.baseline);
    expect(next.notes).toEqual([]);
  });
  it('adds empty decisions to older snapshots without rewriting the stored source record', async () => {
    const project = await fixtureProject();
    const legacy: Record<string, unknown> = { ...project }; delete legacy.evidenceDecisions;
    const database = await openDB('folio-local-v1', 2); await database.put('projects', legacy);
    const library = await loadLibrary();
    expect(library.projects[0].evidenceDecisions).toEqual({}); expect(library.unavailable).toEqual([]);
    expect(await database.get('projects', project.id)).toEqual(legacy); database.close();
  });
  it('restores reversible insertion snapshots from a validated backup', async () => {
    const project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    const inserted = insertEvidence(project, project.notes[0].id, project.draft.blocks[0].id);
    const restored = await restoreProject(new File([await backupProject(inserted)], 'inserted.folio.zip'));
    expect(restored.evidenceDecisions).toEqual(inserted.evidenceDecisions);
    expect(dismissEvidence(restored, project.notes[0].id).draft.blocks).toEqual(project.draft.blocks);
  });
  it('reports each invalid record and exports unchanged binary recovery data without an overwrite', async () => {
    const project = await fixtureProject(); await saveProject(project);
    const database = await openDB('folio-local-v1', 2);
    const raw = { id: 'future-record', schemaVersion: 99, name: 'Future resume', source: { bytes: new Uint8Array([82,69,67]) }, arbitrary: 'preserved metadata' };
    await database.put('projects', raw); await database.put('projects', { id: 'malformed-record', schemaVersion: 1 });
    const library = await loadLibrary();
    expect(library.projects).toEqual([project]); expect(library.unavailable).toHaveLength(2);
    const recovery = await backupUnavailableProject(raw.id);
    const zip = await JSZip.loadAsync(await recovery.arrayBuffer());
    const metadata = JSON.parse(await zip.file('record.json')!.async('string'));
    expect(metadata.arbitrary).toBe(raw.arbitrary); expect(metadata.schemaVersion).toBe(99);
    expect(await zip.file(metadata.source.bytes.recoveryBinary)!.async('uint8array')).toEqual(raw.source.bytes);
    await expect(restoreProject(new File([recovery], 'raw.recovery.zip'))).rejects.toMatchObject({ code: 'BACKUP_INVALID' });
    await expect(saveProject({ ...project, id: raw.id })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect(await database.get('projects', raw.id)).toEqual(raw); database.close();
  });
  it('leaves unusual unavailable records intact when safe recovery serialization fails', async () => {
    const database = await openDB('folio-local-v1', 2);
    const raw: { id: string; cycle?: unknown } = { id: 'cyclic-record' }; raw.cycle = raw;
    await database.put('projects', raw);
    await expect(backupUnavailableProject(raw.id)).rejects.toMatchObject({ code: 'RECOVERY_FAILED' });
    const retained = await database.get('projects', raw.id); expect(retained.cycle).toBe(retained);
    database.close();
  });
  it('persists evidence decisions through reload and portable backup restore', async () => {
    const project = await fixtureProject();
    const decisions = { [project.facts[0].id]: { status: 'rejected' as const, blockId: project.draft.blocks[0].id } };
    Object.assign(project, { evidenceDecisions: decisions });
    await saveProject(project);
    expect((await loadProjects())[0]).toMatchObject({ evidenceDecisions: decisions });
    const restored = await restoreProject(new File([await backupProject(project)], 'decisions.folio.zip'));
    expect(restored).toMatchObject({ evidenceDecisions: decisions });
  });
  it('opens valid projects while preserving an unsupported saved record unchanged', async () => {
    const project = await fixtureProject(); await saveProject(project);
    const database = await openDB('folio-local-v1', 2);
    const unavailable = { id: 'unsupported-record', schemaVersion: 99, source: { bytes: new Uint8Array([4, 2]) } };
    await database.put('projects', unavailable);
    await expect(loadProjects()).resolves.toEqual([project]);
    expect(await database.get('projects', unavailable.id)).toEqual(unavailable);
    database.close();
  });
  it('round-trips binary originals, drafts and notes and deletes all project data', async () => {
    const project = await fixtureProject();
    await saveProject(project);
    const [loaded] = await loadProjects();
    expect(loaded.source.bytes).toEqual(project.source.bytes);
    const blob = await backupProject(project);
    const restored = await restoreProject(new File([blob], 'test.folio.zip'));
    expect(restored.id).not.toBe(project.id);
    expect(restored.source.sha256).toBe(project.source.sha256);
    expect(restored.draft).toEqual(project.draft);
    expect(restored.reviewedDraftRevision).toBeNull();
    await removeProject(project.id);
    expect(await loadProjects()).toEqual([]);
  });
  it('rejects tampered backups before replacing any current work', async () => {
    const project = await fixtureProject();
    await saveProject(project);
    const zip = await JSZip.loadAsync(await (await backupProject(project)).arrayBuffer());
    zip.file('source.pdf', 'TAMPERED');
    const tampered = await zip.generateAsync({ type: 'uint8array' });
    await expect(restoreProject(new File([new Uint8Array(tampered).buffer], 'tampered.zip'))).rejects.toMatchObject({ code: 'BACKUP_CHECKSUM' });
    expect((await loadProjects())[0].source.sha256).toBe(project.source.sha256);
  });
  it('retains the previous committed snapshot after quota failure', async () => {
    const project = await fixtureProject();
    await saveProject(project);
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); });
    await expect(saveProject({ ...project, revision: 2, name: 'Unsaved edit' })).rejects.toMatchObject({ code: 'SAVE_FAILED' });
    spy.mockRestore();
    expect((await loadProjects())[0].name).toBe(project.name);
  });
  it('rejects suspicious archive expansion before trusting its manifest', async () => {
    const project = await fixtureProject();
    await saveProject(project);
    const zip = new JSZip();
    zip.file('project.json', 'A'.repeat(2 * 1024 * 1024));
    zip.file('manifest.json', '{"format":"folio"}');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    await expect(restoreProject(new File([new Uint8Array(bytes).buffer], 'unsafe.folio.zip'))).rejects.toMatchObject({ code: 'ARCHIVE_INVALID', message: 'The archive exceeds safe decompression limits.' });
    expect((await loadProjects())[0].source.sha256).toBe(project.source.sha256);
  });
  it('refuses an overwrite when another tab committed a different revision', async () => {
    const project = await fixtureProject();
    await saveProject(project);
    const database = await openDB('folio-local-v1', 2);
    await database.put('projects', { ...project, revision: 99, name: 'Other tab' });
    database.close();
    await expect(saveProject({ ...project, revision: 2, name: 'This tab' })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect((await loadProjects())[0].name).toBe('Other tab');
  });
  it('refuses to produce a backup that exceeds its own restore limits', async () => {
    const project = await fixtureProject();
    project.notes = Array.from({ length: 110 }, (_, index) => ({ id: `note-${index}`, text: 'F'.repeat(10000), confirmed: true }));
    project.facts.push(...project.notes.map(note => ({ ...note, kind: 'careerNote' as const, locator: 'applicant note' })));
    await expect(backupProject(project)).rejects.toMatchObject({ code: 'BACKUP_TOO_LARGE' });
    expect(project.notes).toHaveLength(110);
  });
});

describe('Career Memory coordinated persistence', () => {
  it('atomically saves initial memory and keeps a corrupt memory record unavailable without overwriting recovery data', async () => {
    const { initCareerMemory, setMemoryDraft } = await import('../core/careerMemory');
    const resume = initCareerMemory(await fixtureProject()); await saveProject(resume);
    const database = await openDB('folio-local-v1', 2);
    const raw = await database.get('projects',resume.id); raw.careerMemory.schemaVersion = 99; await database.put('projects',raw);
    const library = await loadLibrary(); expect(library.projects).toEqual([]); expect(library.unavailable).toHaveLength(1);
    const edited = setMemoryDraft(resume,'Recover this draft.',resume.careerMemory!.revision);
    await expect(saveProject(edited)).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect((await database.get('projects',resume.id)).careerMemory.schemaVersion).toBe(99);
    const recovery = await JSZip.loadAsync(await (await backupUnavailableProject(resume.id)).arrayBuffer()); expect(await recovery.file('record.json')!.async('string')).not.toContain('Recover this draft.');
    database.close();
  });
  it('creates a saved application from the exact saved memory checkpoint, and rejects a concurrent durable edit', async () => {
    const { initCareerMemory } = await import('../core/careerMemory'); const { createSavedApplication } = await import('./projects');
    const resume = initCareerMemory(await approveTemplate(await fixtureProject(), []));
    const application = await createSavedApplication(resume,{ title: 'A', company: '', description: '' });
    expect(application.memorySnapshot!.memoryRevision).toBe(resume.careerMemory!.revision);
    const database = await openDB('folio-local-v1', 2), original = crypto.subtle.digest.bind(crypto.subtle); let injected = false;
    const spy = vi.spyOn(crypto.subtle,'digest').mockImplementation(async (algorithm,data) => {
      if (!injected) { injected = true; const raw = await database.get('projects',resume.id); await database.put('projects',{ ...raw, revision: raw.revision + 1, name: 'Concurrent name' }); }
      return original(algorithm,data);
    });
    await expect(createSavedApplication(resume,{ title: 'Rejected', company: '', description: '' })).rejects.toMatchObject({ code: 'APPLICATION_CONFLICT' });
    spy.mockRestore(); expect((await database.getAll('projects')).filter(project => project.workspace.kind === 'application')).toHaveLength(1); database.close();
  });
  it('refuses stale-tab memory writes and missing durable expected records without recreating them', async () => {
    const { initCareerMemory, setMemoryDraft } = await import('../core/careerMemory');
    const resume = initCareerMemory(await fixtureProject()); await saveProject(resume);
    const database = await openDB('folio-local-v1',2), raw = await database.get('projects',resume.id);
    raw.revision++; raw.careerMemory.revision++; raw.careerMemory.draftText = 'Another tab'; await database.put('projects',raw);
    const stale = setMemoryDraft(resume,'Stale tab',resume.careerMemory!.revision);
    await expect(saveProject(stale)).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    expect((await database.get('projects',resume.id)).careerMemory.draftText).toBe('Another tab');
    await database.delete('projects',resume.id);
    await expect(saveProject(stale)).rejects.toMatchObject({ code: 'SAVE_CONFLICT' }); database.close();
  });
  it('whole-group deletion removes all originals, versions and apps, leaves only opaque state, and rejects stale callbacks', async () => {
    const { initCareerMemory, addTextSource, setMemoryDraft } = await import('../core/careerMemory'); const { createSavedApplication, previewGroupRemoval, removeGroup, getGroupState } = await import('./projects');
    let resume = initCareerMemory(await approveTemplate(await fixtureProject(),[])); resume = (await addTextSource(resume,'Sensitive supporting detail','typed',resume.careerMemory!.revision)).project;
    const a = await createSavedApplication(resume,{ title: 'A', company: '', description: '' }); const b = await createSavedApplication(resume,{ title: 'B', company: '', description: '' });
    const plan = await previewGroupRemoval(resume.workspace.templateGroupId); expect(plan.projects).toHaveLength(3);
    await removeGroup(resume.workspace.templateGroupId,plan);
    const database = await openDB('folio-local-v1',2); expect(await database.getAll('projects')).toEqual([]);
    const state = await getGroupState(resume.workspace.templateGroupId); expect(Object.keys(state).sort()).toEqual(['changedAt','epoch','state','templateGroupId']); expect(state.state).toBe('deleted');
    await expect(saveProject(setMemoryDraft(resume,'A delayed callback',resume.careerMemory!.revision))).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    await expect(saveProject({ ...a, revision: a.revision+1 })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' });
    await expect(saveProject({ ...b, id: crypto.randomUUID() })).rejects.toMatchObject({ code: 'SAVE_CONFLICT' }); database.close();
  });
  it('rejects stale confirmed deletion scope rather than silently expanding it', async () => {
    const { initCareerMemory } = await import('../core/careerMemory'); const { createSavedApplication, previewGroupRemoval, removeGroup } = await import('./projects');
    const resume = initCareerMemory(await approveTemplate(await fixtureProject(),[])); await saveProject(resume); const plan = await previewGroupRemoval(resume.workspace.templateGroupId);
    await createSavedApplication(resume,{ title: 'Added after preview', company: '', description: '' });
    await expect(removeGroup(resume.workspace.templateGroupId,plan)).rejects.toMatchObject({ code: 'DELETE_CONFLICT' }); expect(await loadProjects()).toHaveLength(2);
  });
  it('normal application deletion preserves canonical memory and siblings; resume deletion preserves pinned self-contained applications', async () => {
    const { initCareerMemory } = await import('../core/careerMemory'); const { createSavedApplication, getGroupState } = await import('./projects');
    const resume = initCareerMemory(await approveTemplate(await fixtureProject(),[])); const a = await createSavedApplication(resume,{ title:'A',company:'',description:'' }); const b = await createSavedApplication(resume,{ title:'B',company:'',description:'' });
    await removeProject(a.id); expect((await loadProjects()).find(project => project.id === resume.id)!.careerMemory).toEqual(resume.careerMemory);
    await expect(saveProject({ ...a, revision: 2 })).rejects.toMatchObject({ code:'SAVE_CONFLICT' });
    await removeProject(resume.id); expect((await getGroupState(resume.workspace.templateGroupId)).state).toBe('resumeRemoved'); const remaining = await loadProjects(); expect(remaining).toHaveLength(1); expect(remaining[0].memorySnapshot).toEqual(b.memorySnapshot);
    await saveProject({ ...remaining[0], revision: remaining[0].revision+1, name:'Still editable' }); await expect(saveProject({ ...resume, revision:resume.revision+1 })).rejects.toMatchObject({ code:'SAVE_CONFLICT' });
  });
  it('round-trips application snapshots with exact provenance as isolated applications', async () => {
    const { initCareerMemory, addTextSource, createMemoryAssertion, confirmAssertion } = await import('../core/careerMemory'); const { hashTextSync } = await import('../core/model');
    let resume = initCareerMemory(await approveTemplate(await fixtureProject(),[])); const result = await addTextSource(resume,'Confirmed extra','typed',resume.careerMemory!.revision); resume=result.project;
    resume = await createMemoryAssertion(resume,{sourceId:result.source.id,segmentId:result.source.segments[0].id,text:'Confirmed extra'},resume.careerMemory!.revision); resume=await confirmAssertion(resume,resume.careerMemory!.assertions[0].id,1,hashTextSync('Confirmed extra'),resume.careerMemory!.revision);
    const application = await createApplication(resume); const restored = await restoreProject(new File([await backupProject(application)],'application.folio.zip'));
    expect(restored.workspace.kind).toBe('application'); expect(restored.careerMemory).toBeUndefined(); expect(restored.memorySnapshot!.evidence).toEqual(application.memorySnapshot!.evidence); expect(restored.memorySnapshot!.id).not.toBe(application.memorySnapshot!.id); expect(restored.workspace.templateGroupId).not.toBe(application.workspace.templateGroupId);
    await saveProject(restored); const { getGroupState } = await import('./projects'); expect((await getGroupState(restored.workspace.templateGroupId)).state).toBe('resumeRemoved');
  });
  it('round-trips complete group originals, retained versions and drafts into a fresh isolated group atomically', async () => {
    const { initCareerMemory, addTextSource, createMemoryAssertion, confirmAssertion, setMemoryAssertionDraft } = await import('../core/careerMemory'); const { hashTextSync, sha256 } = await import('../core/model'); const { createSavedApplication, backupResumeGroup, restoreGroup } = await import('./projects');
    let resume = initCareerMemory(await approveTemplate(await fixtureProject(),[])); const result=await addTextSource(resume,'Confirmed original','typed',resume.careerMemory!.revision);resume=result.project;
    resume=await createMemoryAssertion(resume,{sourceId:result.source.id,segmentId:result.source.segments[0].id,text:'Confirmed original'},resume.careerMemory!.revision);resume=await confirmAssertion(resume,resume.careerMemory!.assertions[0].id,1,hashTextSync('Confirmed original'),resume.careerMemory!.revision);
    const bytes = new TextEncoder().encode('Supporting original'); const { addMemorySource } = await import('../core/careerMemory'); resume = await addMemorySource(resume,{id:crypto.randomUUID(),version:1,kind:'supportingFile',format:'txt',name:'notes.txt',bytes,sha256:await sha256(bytes),segments:[{id:crypto.randomUUID(),text:'Supporting original',locator:'Line 1'}],state:'needsReview',ingestedAt:new Date().toISOString(),extractorVersion:'test'},resume.careerMemory!.revision);
    const application=await createSavedApplication(resume,{title:'Pinned',company:'',description:''});resume=setMemoryAssertionDraft(resume,resume.careerMemory!.assertions[0].id,1,'Pending revised wording',resume.careerMemory!.revision);await saveProject(resume);
    await expect(backupProject(resume)).rejects.toMatchObject({code:'GROUP_BACKUP_REQUIRED'}); await expect(backupResumeGroup([resume])).rejects.toMatchObject({code:'BACKUP_INCOMPLETE'});
    const restored=await restoreGroup(new File([await backupResumeGroup([resume,application])],'group.folio.zip'));
    const primary=restored.find(project=>project.workspace.kind==='resume')!, app=restored.find(project=>project.workspace.kind==='application')!;
    expect(restored).toHaveLength(2); expect(primary.workspace.templateGroupId).not.toBe(resume.workspace.templateGroupId);expect(primary.careerMemory!.resumeProjectId).toBe(primary.id);expect(app.memorySnapshot!.sourceResumeId).toBe(primary.id);expect(app.memorySnapshot!.id).not.toBe(application.memorySnapshot!.id);expect(primary.careerMemory!.assertionDrafts).toEqual(resume.careerMemory!.assertionDrafts);expect(primary.careerMemory!.sources[1].bytes).toEqual(bytes);expect(primary.approval).toEqual(resume.approval);expect(restored.every(project=>project.reviewedDraftRevision===null)).toBe(true);expect(await loadProjects()).toHaveLength(4);
  });
  it('rejects tampered or unlisted group content before writing any record', async () => {
    const { initCareerMemory } = await import('../core/careerMemory'); const { backupResumeGroup, restoreGroup } = await import('./projects');
    const resume=initCareerMemory(await fixtureProject());await saveProject(resume);const blob=await backupResumeGroup([resume]);const zip=await JSZip.loadAsync(await blob.arrayBuffer());zip.file('projects/0/project.json','tampered');
    const file=new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'bad.zip');await expect(restoreGroup(file)).rejects.toMatchObject({code:'BACKUP_CHECKSUM'});expect(await loadProjects()).toHaveLength(1);
    const extra=await JSZip.loadAsync(await blob.arrayBuffer());extra.file('unexpected.txt','Unlisted');await expect(restoreGroup(new File([new Uint8Array(await extra.generateAsync({type:'uint8array'})).buffer],'extra.zip'))).rejects.toMatchObject({code:'BACKUP_INVALID'});expect(await loadProjects()).toHaveLength(1);
  });
  it('aborts the full restore or deletion if a later record operation fails', async () => {
    const { initCareerMemory }=await import('../core/careerMemory');const { createSavedApplication,backupResumeGroup,restoreGroup,previewGroupRemoval,removeGroup }=await import('./projects');
    const resume=initCareerMemory(await approveTemplate(await fixtureProject(),[]));const application=await createSavedApplication(resume,{title:'Atomic',company:'',description:''});const blob=await backupResumeGroup([resume,application]);
    const originalAdd=IDBObjectStore.prototype.add;let count=0;const addSpy=vi.spyOn(IDBObjectStore.prototype,'add').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['add']>){if(this.name==='projects'&&++count===2)throw new DOMException('Synthetic failure','QuotaExceededError');return originalAdd.apply(this,args);});
    await expect(restoreGroup(new File([blob],'group.zip'))).rejects.toMatchObject({code:'BACKUP_INVALID'});addSpy.mockRestore();expect(await loadProjects()).toHaveLength(2);
    const plan=await previewGroupRemoval(resume.workspace.templateGroupId), originalDelete=IDBObjectStore.prototype.delete;count=0;const deleteSpy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,...args:Parameters<IDBObjectStore['delete']>){if(this.name==='projects'&&++count===2)throw new DOMException('Synthetic failure','UnknownError');return originalDelete.apply(this,args);});
    await expect(removeGroup(resume.workspace.templateGroupId,plan)).rejects.toMatchObject({code:'DELETE_FAILED'});deleteSpy.mockRestore();expect(await loadProjects()).toHaveLength(2);
  });
});

it('refuses complete group exports above the entry or project metadata limits without omitting data', async () => {
  const { initCareerMemory }=await import('../core/careerMemory');const { backupResumeGroup }=await import('./projects');
  const resume=initCareerMemory(await fixtureProject()), assets=Array.from({length:30},(_,index)=>({id:`asset-${index}`,name:'tiny.png',mime:'image/png' as const,bytes:new Uint8Array([1])}));
  const primary={...resume,assets}, application={...resume,id:crypto.randomUUID(),careerMemory:undefined,assets,workspace:{templateGroupId:resume.workspace.templateGroupId,kind:'application' as const}};
  await expect(backupResumeGroup([primary,application])).rejects.toMatchObject({code:'BACKUP_TOO_LARGE'});
  const oversized={...resume,facts:[...resume.facts,...Array.from({length:30},(_,index)=>({id:`long-${index}`,text:'z'.repeat(100000),kind:'applicantEdit' as const,locator:'Manual local text',confirmed:true}))]};
  await expect(backupResumeGroup([oversized])).rejects.toMatchObject({code:'BACKUP_TOO_LARGE'});
});

it('routes one bounded archive read by supported manifest version and writes only full-group restores', async () => {
  const { initCareerMemory }=await import('../core/careerMemory');const { backupResumeGroup,restoreBackup }=await import('./projects');const legacy=await fixtureProject();
  const legacyFile=new File([await backupProject(legacy)],'legacy.zip'), read=vi.spyOn(legacyFile,'arrayBuffer');const record=await restoreBackup(legacyFile);expect(record.kind).toBe('project');expect(read).toHaveBeenCalledTimes(1);expect(await loadProjects()).toEqual([]);
  const primary=initCareerMemory(legacy), groupFile=new File([await backupResumeGroup([primary])],'group.zip'), groupRead=vi.spyOn(groupFile,'arrayBuffer');const group=await restoreBackup(groupFile);expect(group.kind).toBe('group');expect(groupRead).toHaveBeenCalledTimes(1);expect(await loadProjects()).toHaveLength(1);
  const zip=new JSZip();zip.file('manifest.json',JSON.stringify({schemaVersion:99,format:'folio-group',files:[],projects:[]}));await expect(restoreBackup(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'unknown.zip'))).rejects.toMatchObject({code:'BACKUP_VERSION'});expect(await loadProjects()).toHaveLength(1);
});

it('background library refresh never rebases a dirty writer; explicit open/reload adopts the validated checkpoint', async () => {
  const { initCareerMemory,setMemoryDraft }=await import('../core/careerMemory');const { adoptProjectCheckpoint }=await import('./projects');const original=initCareerMemory(await fixtureProject());await saveProject(original);
  const database=await openDB('folio-local-v1',2), concurrent=setMemoryDraft(original,'Other tab canonical detail',original.careerMemory!.revision);await database.put('projects',concurrent);
  const refreshed=(await loadLibrary()).projects.find(project=>project.id===original.id)!;
  let stale=setMemoryDraft(original,'Stale first keystroke',original.careerMemory!.revision);stale=setMemoryDraft(stale,'Stale later keystroke',stale.careerMemory!.revision);
  await expect(saveProject(stale)).rejects.toMatchObject({code:'SAVE_CONFLICT'});expect((await database.get('projects',original.id)).careerMemory.draftText).toBe('Other tab canonical detail');
  adoptProjectCheckpoint(refreshed);const resumed=setMemoryDraft(refreshed,'Explicitly reloaded current detail',refreshed.careerMemory!.revision);await saveProject(resumed);expect((await database.get('projects',original.id)).careerMemory.draftText).toBe('Explicitly reloaded current detail');database.close();
});

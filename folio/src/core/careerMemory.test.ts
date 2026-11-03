import { describe, expect, it } from 'vitest';
import { addCareerNote, approveTemplate, confirmDraft, editBlock, insertEvidence, validateExport } from './commands';
import { createApplication } from './applications';
import { addAssertion, addMemorySource, addTextSource, cancelMemoryAssertionDraft, confirmAssertion, correctResumeFact, createMemoryAssertion, editAssertion, eligibleEvidence, excludeResumeFact, initCareerMemory, memoryView, promoteCareerNote, saveLinkedInReference, setAssertionFuture, setMemoryAssertionDraft, setMemoryDraft, sourceProvenance } from './careerMemory';
import { blockText, hashTextSync, sha256, sha256Sync } from './model';
import type { Project } from './model';
import { validateProject } from './schema';
import { fixtureProject } from './testFixture';
import { matchProject } from '../tailoring/local';
const rev = (project: Project) => project.careerMemory!.revision;
async function confirmedExtra(text = 'Built React dashboards with TypeScript.') {
  let resume = initCareerMemory(await approveTemplate(await fixtureProject(), []));
  const source = await addTextSource(resume, text, 'typed', rev(resume)); resume = source.project;
  resume = await createMemoryAssertion(resume, { sourceId: source.source.id, segmentId: source.source.segments[0].id, text }, rev(resume));
  const assertion = resume.careerMemory!.assertions[0];
  resume = await confirmAssertion(resume, assertion.id, 1, hashTextSync(text), rev(resume));
  return resume;
}
describe('versioned group Career Memory', () => {
  it('matches standard SHA-256 for Unicode text and large byte buffers', async () => {
    for (const text of ['', 'abc', 'Résumé 👋', 'x'.repeat(100000)]) expect(sha256Sync(new TextEncoder().encode(text))).toBe(await sha256(new TextEncoder().encode(text)));
  });
  it('lazily projects original facts without promoting historical application notes or mutating input', async () => {
    const legacy = addCareerNote(await fixtureProject(), 'A local historical qualification.');
    const original = structuredClone(legacy);
    const view = memoryView(legacy);
    expect(legacy).toEqual(original); expect(legacy.careerMemory).toBeUndefined();
    expect(view.resumeFactRefs).toEqual(legacy.facts.filter(fact => fact.kind === 'resume').map(fact => fact.id));
    const initialized = initCareerMemory(legacy);
    expect(initialized.revision).toBe(legacy.revision + 1);
    expect(eligibleEvidence(initialized).some(fact => fact.text.includes('historical'))).toBe(true);
    expect(eligibleEvidence(initialized, 'futureApplication').some(fact => fact.text.includes('historical'))).toBe(false);
  });
  it('excludes source extraction, typed drafts and URL-only metadata until exact confirmation', async () => {
    let resume = initCareerMemory(await fixtureProject());
    resume = setMemoryDraft(resume, 'React expert draft.', rev(resume));
    resume = saveLinkedInReference(resume, 'https://www.linkedin.com/in/example-person/', rev(resume));
    const source = await addTextSource(resume, 'React applicant input.', 'typed', rev(resume)); resume = source.project;
    resume = await createMemoryAssertion(resume, { sourceId: source.source.id, segmentId: source.source.segments[0].id, text: 'React applicant input.' }, rev(resume));
    expect(eligibleEvidence(resume)).toEqual(resume.facts.filter(fact => fact.kind === 'resume'));
    expect(matchProject({ ...resume, job: { title: '', company: '', description: 'React expert' } }).evidence.some(item => item.text.includes('applicant input'))).toBe(false);
    const assertion = resume.careerMemory!.assertions[0];
    await expect(confirmAssertion(resume, assertion.id, 1, hashTextSync('Changed wording'), rev(resume))).rejects.toMatchObject({ code: 'ASSERTION_STALE' });
    expect(() => saveLinkedInReference(resume, 'https://linkedin.com.evil.test/in/example', rev(resume))).toThrow();
    expect(() => saveLinkedInReference(resume, 'https://linkedin.com/in/example?tracking=1', rev(resume))).toThrow();
  });
  it('rejects stale revisions and binds confirmation to the current exact version', async () => {
    let resume = await confirmedExtra();
    const assertion = resume.careerMemory!.assertions[0], oldRev = rev(resume);
    resume = editAssertion(resume, assertion.id, 1, 'Built a React prototype.', oldRev);
    expect(resume.careerMemory!.assertions[0].versions[0].confirmation).not.toBeNull();
    expect(resume.careerMemory!.assertions[0].versions[1].confirmation).toBeNull();
    expect(eligibleEvidence(resume).some(fact => fact.kind === 'careerNote')).toBe(false);
    expect(() => setMemoryDraft(resume, 'Stale draft', oldRev)).toThrow('Career Memory changed');
    await expect(confirmAssertion(resume, assertion.id, 1, hashTextSync(assertion.versions[0].text), rev(resume))).rejects.toMatchObject({ code: 'ASSERTION_STALE' });
    resume = await confirmAssertion(resume, assertion.id, 2, hashTextSync('Built a React prototype.'), rev(resume));
    expect(eligibleEvidence(resume).some(fact => fact.text === 'Built a React prototype.')).toBe(true);
    expect(eligibleEvidence(resume).some(fact => fact.id === assertion.versions[0].factId)).toBe(false);
  });
  it('persists a resumable edit draft without consuming versions and suspends evidence until save or cancel', async () => {
    let resume = await confirmedExtra(); const id = resume.careerMemory!.assertions[0].id;
    resume = setMemoryAssertionDraft(resume, id, 1, 'A', rev(resume));
    resume = setMemoryAssertionDraft(resume, id, 1, 'A corrected accomplishment.', rev(resume));
    expect(validateProject(structuredClone(resume)).careerMemory!.assertionDrafts[0].text).toBe('A corrected accomplishment.');
    expect(resume.careerMemory!.assertions[0].versions).toHaveLength(1);
    expect(eligibleEvidence(resume).some(fact => fact.kind === 'careerNote')).toBe(false);
    await expect(confirmAssertion(resume, id, 1, hashTextSync(resume.careerMemory!.assertions[0].versions[0].text), rev(resume))).rejects.toMatchObject({ code: 'ASSERTION_DRAFT_PENDING' });
    resume = cancelMemoryAssertionDraft(resume, id, rev(resume));
    expect(eligibleEvidence(resume).some(fact => fact.kind === 'careerNote')).toBe(true);
    resume = setMemoryAssertionDraft(resume, id, 1, 'Saved new wording.', rev(resume));
    resume = editAssertion(resume, id, 1, 'Saved new wording.', rev(resume));
    expect(resume.careerMemory!.assertionDrafts).toEqual([]); expect(resume.careerMemory!.assertions[0].versions).toHaveLength(2);
  });
  it('keeps quotations immutable and snapshots isolated while newer jobs use current confirmed versions', async () => {
    let resume = await confirmedExtra();
    const before = structuredClone(resume), a = await createApplication(resume, { title: 'First', company: '', description: 'React' });
    expect(a.careerMemory).toBeUndefined(); expect(a.memorySnapshot!.memoryRevision).toBe(rev(resume));
    expect(a.draft).toEqual(resume.baseline); expect(a.notes).toEqual([]);
    const id = resume.careerMemory!.assertions[0].id;
    resume = editAssertion(resume, id, 1, 'Maintained a React prototype.', rev(resume));
    resume = await confirmAssertion(resume, id, 2, hashTextSync('Maintained a React prototype.'), rev(resume));
    const b = await createApplication(resume, { title: 'Second', company: '', description: 'React' });
    expect(a.facts.some(fact => fact.text === before.careerMemory!.assertions[0].versions[0].text)).toBe(true);
    expect(b.facts.some(fact => fact.text === 'Maintained a React prototype.')).toBe(true);
    expect(b.memorySnapshot!.evidence.find(item => item.assertionId)?.provenance.originalQuote).toBe(before.careerMemory!.sources[0].segments[0].text);
    resume = setAssertionFuture(resume, id, false, rev(resume));
    expect(eligibleEvidence(resume).some(fact => fact.kind === 'careerNote')).toBe(false);
    expect(eligibleEvidence(a).some(fact => fact.kind === 'careerNote')).toBe(true);
    const local = addCareerNote(a, 'A note only for the first application.');
    expect(eligibleEvidence(local).some(fact => fact.text.includes('only for'))).toBe(true);
    expect(eligibleEvidence(resume).some(fact => fact.text.includes('only for'))).toBe(false);
    const promoted = await promoteCareerNote(resume, local, local.notes[0].id, rev(resume));
    expect(promoted.careerMemory!.assertions.at(-1)!.versions[0].confirmation).toBeNull();
  });
  it('suspends superseded source facts immediately and blocks unchanged or retained source wording through final confirmation', async () => {
    let resume = initCareerMemory(await approveTemplate(await fixtureProject(), []));
    const fact = resume.facts.find(fact => fact.kind === 'resume')!, original = structuredClone(resume.source.bytes);
    resume = await correctResumeFact(resume, fact.id, 'Applicant-corrected React accomplishment.', rev(resume));
    expect(eligibleEvidence(resume).some(item => item.id === fact.id)).toBe(false);
    const id = resume.careerMemory!.assertions[0].id;
    resume = await confirmAssertion(resume, id, 1, hashTextSync('Applicant-corrected React accomplishment.'), rev(resume));
    let application = await createApplication(resume, { title: '', company: '', description: 'React' });
    const blockId = application.memorySnapshot!.baselineReviewBlocks[0];
    application = confirmDraft(application);
    const render = { contentRevision: application.draft.revision, bytes: new Uint8Array(), rendererVersion: 'folio-pdf-v1', layout: { regions: [], overflows: [] } };
    await expect(validateExport(application, render)).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
    const originalText = blockText(application.baseline.blocks.find(block => block.id === blockId)!);
    application = confirmDraft(editBlock(application, blockId, [{ text: originalText + ' Added unrelated sentence.' }]));
    await expect(validateExport(application, { ...render, contentRevision: application.draft.revision })).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
    application = confirmDraft(editBlock(application, blockId, [{ text: 'Applicant-corrected React accomplishment.' }]));
    await expect(validateExport(application, { ...render, contentRevision: application.draft.revision })).resolves.toBeUndefined();
    expect(resume.source.bytes).toEqual(original);
  });
  it('excludes resume facts for future snapshots but copies all baseline facts to keep references valid', async () => {
    let resume = initCareerMemory(await approveTemplate(await fixtureProject(), [])); const fact = resume.facts[0];
    resume = excludeResumeFact(resume, fact.id, true, rev(resume));
    const application = await createApplication(resume);
    expect(application.facts.some(item => item.id === fact.id)).toBe(true);
    expect(application.memorySnapshot!.eligibleFactIds).not.toContain(fact.id);
    expect(() => insertEvidence(application, fact.id, application.draft.blocks[0].id)).toThrow('no longer available');
  });
  it('reuses exact sources and assertions, rejects tampered provenance and retains schema fields', async () => {
    let resume = await confirmedExtra(); const source = resume.careerMemory!.sources[0];
    expect(await addMemorySource(resume, structuredClone(source), rev(resume))).toBe(resume);
    const origin = await sourceProvenance(resume, source.id, source.segments[0].id);
    expect(await addAssertion(resume, source.segments[0].text, origin, rev(resume))).toBe(resume);
    const invalid = structuredClone(resume); invalid.careerMemory!.assertions[0].versions[0].provenance.locator = 'Invented page 99';
    expect(() => validateProject(invalid)).toThrow('Invalid supporting provenance');
    const wrong = structuredClone(resume); wrong.careerMemory!.assertions[0].versions[0].confirmation!.textHash = hashTextSync('Wrong');
    expect(() => validateProject(wrong)).toThrow('Confirmation');
    const unexpected = { ...resume.careerMemory, unknownSnapshotField: 'silently stripped?' };
    expect(() => validateProject({ ...resume, careerMemory: unexpected })).toThrow();
    expect(validateProject(structuredClone(resume))).toEqual(resume);
  });
  it('enforces source count/bytes/text, assertion versions and retained text limits', async () => {
    const resume = await confirmedExtra();
    const over = structuredClone(resume); over.careerMemory!.draftText = 'x'.repeat(10001); expect(() => validateProject(over)).toThrow();
    const sources = Array.from({ length: 6 }, (_,index) => ({ id: `file-${index}`, version: 1 as const, kind: 'supportingFile' as const, name: 'source.txt', format: 'txt' as const, bytes: new Uint8Array([1]), sha256: hashTextSync('\u0001'), segments: [], state: 'needsReview' as const, ingestedAt: new Date().toISOString(), extractorVersion: 'test' }));
    expect(() => validateProject({ ...resume, careerMemory: { ...resume.careerMemory, sources } })).toThrow('five supporting');
    const assertion = resume.careerMemory!.assertions[0]; let next = resume;
    for (let version = 2; version <= 20; version++) next = editAssertion(next, assertion.id, version - 1, `Wording ${version}`, rev(next));
    expect(() => editAssertion(next, assertion.id, 20, 'Version 21', rev(next))).toThrow();
  });
});

it('blocks a retained corrected source sentence even if another sentence in the same paragraph changes', async () => {
  let resume = await fixtureProject(); const original = resume.facts[0], second = { ...original, id: crypto.randomUUID(), text: 'Mentored colleagues.' };
  const block = resume.baseline.blocks[0]; resume = { ...resume, facts: [...resume.facts,second], baseline: { ...resume.baseline, blocks: [{ ...block, runs: [{ text: original.text + ' ' + second.text, sourceFactIds: [original.id,second.id] }], sourceFactIds:[original.id,second.id] }] } }; resume.draft=structuredClone(resume.baseline);
  resume=initCareerMemory(await approveTemplate(resume,[]));resume=await correctResumeFact(resume,original.id,'Corrected first sentence.',rev(resume));
  const application=confirmDraft(editBlock(await createApplication(resume),block.id,[{text:original.text+' Changed the unrelated second sentence.'}]));
  await expect(validateExport(application,{bytes:new Uint8Array(),contentRevision:application.draft.revision,rendererVersion:'folio-pdf-v1',layout:{regions:[],overflows:[]}})).rejects.toMatchObject({code:'EXPORT_NOT_READY'});
});

it('enforces aggregate supporting bytes and extracted text, safe error codes, and resumable failed-source count', async () => {
  let resume=initCareerMemory(await fixtureProject());
  for(let index=0;index<5;index++) resume=await addMemorySource(resume,{id:`failed-${index}`,version:1,kind:'supportingFile',name:`failed-${index}.pdf`,format:'pdf',sha256:hashTextSync(''),segments:[],state:'error',errorCode:'CORRUPT_PDF',ingestedAt:new Date().toISOString(),extractorVersion:'test'},rev(resume));
  expect(validateProject(structuredClone(resume)).careerMemory!.sources).toHaveLength(5);
  await expect(addMemorySource(resume,{...resume.careerMemory!.sources[0],id:'sixth'},rev(resume))).rejects.toThrow('five supporting');
  const badCode=structuredClone(resume);badCode.careerMemory!.sources[0].errorCode='APPLICANT_SECRET';expect(()=>validateProject(badCode)).toThrow();
  const huge=structuredClone(resume);huge.careerMemory!.sources=huge.careerMemory!.sources.slice(0,3).map(source=>({...source,bytes:new Uint8Array(9*1024*1024)}));expect(()=>validateProject(huge)).toThrow('aggregate source');
  const text=structuredClone(resume);text.careerMemory!.sources=text.careerMemory!.sources.slice(0,3).map(source=>({...source,state:'needsReview',bytes:new Uint8Array([1]),segments:Array.from({length:8},(_,index)=>({id:`${source.id}-${index}`,text:'x'.repeat(10000),locator:`Paragraph ${index}`}))}));expect(()=>validateProject(text)).toThrow('aggregate source');
});

it('persists safe failed-source metadata and replaces an unaccepted same-ID retry without duplicating the file count', async () => {
  const { failedMemorySource }=await import('./careerMemory');let resume=initCareerMemory(await fixtureProject());
  const failed=failedMemorySource({id:'retry-source',name:'notes.txt',format:'txt',errorCode:'PRIVATE_UNKNOWN_ERROR'});expect(failed.errorCode).toBe('MEMORY_IMPORT_FAILED');expect(failed.bytes).toBeUndefined();expect(failed.segments).toEqual([]);
  resume=await addMemorySource(resume,failed,rev(resume));const bytes=new TextEncoder().encode('Accepted retry text');
  resume=await addMemorySource(resume,{...failed,state:'needsReview',errorCode:undefined,bytes,sha256:await sha256(bytes),segments:[{id:'retry-source-segment',text:'Accepted retry text',locator:'Line 1'}]},rev(resume));
  expect(resume.careerMemory!.sources).toHaveLength(1);expect(resume.careerMemory!.sources[0].state).toBe('needsReview');
  await expect(addMemorySource(resume,{...resume.careerMemory!.sources[0],bytes:new TextEncoder().encode('Different bytes')},rev(resume))).rejects.toMatchObject({code:'SOURCE_CHECKSUM'});
});

it('repeated correction of the same primary fact creates one version history rather than two concurrent replacement claims', async () => {
  let resume=initCareerMemory(await fixtureProject()), fact=resume.facts[0];resume=await correctResumeFact(resume,fact.id,'First explicit correction.',rev(resume));
  const id=resume.careerMemory!.assertions[0].id;resume=await confirmAssertion(resume,id,1,hashTextSync('First explicit correction.'),rev(resume));resume=await correctResumeFact(resume,fact.id,'Updated explicit correction.',rev(resume));
  expect(resume.careerMemory!.assertions).toHaveLength(1);expect(resume.careerMemory!.assertions[0].versions).toHaveLength(2);expect(eligibleEvidence(resume).some(item=>item.id===fact.id||item.text==='First explicit correction.')).toBe(false);
});

it('preserves canonical current-draft local notes and confirmed edits for matching/insertion without promoting them to future snapshots', async () => {
  const { setJob }=await import('./commands');const { createMemorySnapshot }=await import('./careerMemory');
  let resume=initCareerMemory(await approveTemplate(await fixtureProject(),[]));
  resume=addCareerNote(resume,'Designed Android interfaces and offline navigation.');const note=resume.notes[0];
  resume=setJob(resume,{title:'Mobile designer',company:'',description:'Android offline Kotlin'});
  expect(matchProject(resume).evidence.some(item=>item.factId===note.id)).toBe(true);
  resume=insertEvidence(resume,note.id,resume.draft.blocks[0].id);expect(blockText(resume.draft.blocks[0])).toBe(note.text);
  resume=confirmDraft(editBlock(resume,resume.draft.blocks[0].id,[{text:'Developed Kotlin Android prototypes.'}]));const edit=resume.facts.find(fact=>fact.kind==='applicantEdit')!;
  expect(matchProject(resume).evidence.some(item=>item.factId===edit.id)).toBe(true);
  expect(()=>insertEvidence(resume,edit.id,resume.draft.blocks[0].id)).not.toThrow();
  expect(eligibleEvidence(resume,'futureApplication').some(fact=>fact.id===note.id||fact.id===edit.id)).toBe(false);
  const snapshot=await createMemorySnapshot(resume);expect(snapshot.eligibleFactIds).not.toContain(note.id);expect(snapshot.eligibleFactIds).not.toContain(edit.id);
  const application=await createApplication(resume);expect(application.draft).toEqual(resume.baseline);expect(application.facts.some(fact=>fact.id===note.id||fact.id===edit.id)).toBe(false);expect(application.notes).toEqual([]);expect(resume.careerMemory!.assertions).toEqual([]);
});

it('does not reinterpret cached memory projection facts as local notes after a version edit or future exclusion', async () => {
  let resume=await confirmedExtra('Reviewed Android navigation.');const assertion=resume.careerMemory!.assertions[0], oldFactId=assertion.versions[0].factId;
  resume=insertEvidence(resume,oldFactId,resume.draft.blocks[0].id);expect(resume.facts.some(fact=>fact.id===oldFactId&&fact.confirmed)).toBe(true);
  resume=editAssertion(resume,assertion.id,1,'Revised Android navigation.',rev(resume));expect(eligibleEvidence(resume).some(fact=>fact.id===oldFactId)).toBe(false);
  resume=await confirmAssertion(resume,assertion.id,2,hashTextSync('Revised Android navigation.'),rev(resume));const currentId=resume.careerMemory!.assertions[0].versions[1].factId;
  resume=insertEvidence(resume,currentId,resume.draft.blocks[0].id);resume=setAssertionFuture(resume,assertion.id,false,rev(resume));expect(eligibleEvidence(resume).some(fact=>fact.id===oldFactId||fact.id===currentId)).toBe(false);
  expect(()=>insertEvidence(resume,currentId,resume.draft.blocks[0].id)).toThrow('no longer available');
});

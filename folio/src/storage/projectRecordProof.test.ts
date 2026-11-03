import { deepStrictEqual } from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {openDB} from 'idb';
import JSZip from 'jszip';
import {fictionalScopedPdf} from '../import/pdf-scoped.fixture';
import {importResume} from '../import';
import {makeProject,canonicalJson,hashTextSync,sha256Sync,type Project} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {initCareerMemory,addTextSource,createMemoryAssertion,confirmAssertion} from '../core/careerMemory';
import {createApplication} from '../core/applications';
import {saveVersion} from '../core/folio';
import {setFontLoader} from '../layout/fonts';
import {parseSourceProgram} from '../layout/source-fonts';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {backupProject,backupResumeGroup,restoreProject,restoreGroup,saveProject,loadProjects} from './projects';

let program:Uint8Array,restore:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('../import/pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
beforeEach(async()=>{const db=await openDB('folio-local-v1',2,{upgrade(db){if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});if(!db.objectStoreNames.contains('groupState'))db.createObjectStore('groupState',{keyPath:'templateGroupId'});}});await db.clear('projects');await db.clear('groupState');db.close();});
async function source(bulk=false){const face=parseSourceProgram(program),hex=Array.from('abc ').map(c=>face.glyphForCodePoint(c.codePointAt(0)!).id.toString(16).padStart(4,'0')).join(''),after=bulk?Array.from({length:59},(_,i)=>`BT /F1 12 Tf 1 0 0 1 40 ${638-i*10} Tm <${hex}> Tj ET`).join('\n'):undefined;const original=await fictionalScopedPdf(program,{identity:true,text:'abc ',gray:.123456,gap:300,after}),result=await importResume(new File([new Uint8Array(original.bytes).buffer],'fictional-complete-record.pdf',{type:'application/pdf'}));expect(result.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);return approveTemplate(makeProject(result,true),result.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));}
const unpack=(v:unknown)=>unpackScopedMetadata(unpackRecordMetadata(v)) as Project;
const pack=(v:unknown)=>packRecordMetadata(packScopedMetadata(v));

describe('complete source application record transport persistence',()=>{
 it('preserves complete immutable resume and confirmed-note evidence, source isolation and two history versions across reload/single/group restore',async()=>{
  let resume=initCareerMemory(await source());const quote='Fictional applicant-confirmed formatting practice.',added=await addTextSource(resume,quote,'typed',resume.careerMemory!.revision);resume=added.project;resume=await createMemoryAssertion(resume,{sourceId:added.source.id,segmentId:added.source.segments[0].id,text:quote},resume.careerMemory!.revision);const assertion=resume.careerMemory!.assertions[0];resume=await confirmAssertion(resume,assertion.id,1,hashTextSync(quote),resume.careerMemory!.revision);await saveProject(resume);const original=structuredClone(resume);
  let app=await createApplication(resume,{title:'Fictional local test',company:'Fictional organization',description:'Local transport control, without generation.'});app=saveVersion(saveVersion(app,'firstResult'),'download');await saveProject(app);await saveProject(structuredClone(app));
  const changed=structuredClone(app);changed.folio!.privateNotes='A changed same-revision note.';await expect(saveProject(changed)).rejects.toMatchObject({code:'STALE_SAVE'});
  const records=await loadProjects(),loaded=records.find(p=>p.id===app.id)!;expect(loaded.memorySnapshot).toEqual(app.memorySnapshot);expect(loaded.folio).toEqual(app.folio);deepStrictEqual(records.find(p=>p.id===resume.id), original);deepStrictEqual(resume, original);
  expect(app.memorySnapshot!.evidence).toHaveLength(resume.facts.filter(f=>f.kind==='resume').length+1);const extra=app.memorySnapshot!.evidence.find(e=>e.assertionId===assertion.id)!;expect(extra.provenance.originalQuote).toBe(quote);expect(extra.confirmation).toEqual(resume.careerMemory!.assertions[0].versions[0].confirmation);
  const backup=await backupProject(app),zip=await JSZip.loadAsync(await backup.arrayBuffer()),wire=JSON.parse(await zip.file('project.json')!.async('string'));expect(wire.encoding).toBe('folio-record-tuples-v1');expect(wire.project.memorySnapshot).toEqual(app.memorySnapshot);expect(unpack(wire).memorySnapshot).toEqual(app.memorySnapshot);
  const single=await restoreProject(new File([backup],'fictional-complete-application.folio.zip'));deepStrictEqual(single.template, app.template);deepStrictEqual(single.source.bytes, app.source.bytes);expect(single.memorySnapshot!.evidence).toEqual(app.memorySnapshot!.evidence);expect(single.memorySnapshot!.eligibleFactIds).toEqual(app.memorySnapshot!.eligibleFactIds);expect(single.folio).toEqual(app.folio);
  const group=await restoreGroup(new File([await backupResumeGroup([resume,app])],'fictional-complete-group.folio.zip')),restoredSource=group.find(p=>p.workspace.kind==='resume')!,restoredApp=group.find(p=>p.workspace.kind==='application')!;expect(restoredApp.memorySnapshot!.sourceResumeId).toBe(restoredSource.id);expect(restoredApp.memorySnapshot!.evidence).toEqual(app.memorySnapshot!.evidence);expect(restoredApp.folio).toEqual(app.folio);expect(restoredSource.careerMemory!.assertions).toEqual(resume.careerMemory!.assertions);
  // Coherent manifest digests must reach the retained-source validator after both inverses.
  const forged=await JSZip.loadAsync(await backup.arrayBuffer()),metadata=unpack(JSON.parse(await forged.file('project.json')!.async('string'))),region=metadata.template.pages[0].regions.find(r=>r.kind==='text')!;if(region.kind!=='text'||region.sourceLayout?.glyphEncoding!=='shared-font-tuple-v1')throw Error();region.sourceScopedPaint!.clipStack=[];metadata.template.sourceScopedPages!.pages[0].inventoryHash='f'.repeat(64);forged.file('project.json',JSON.stringify(pack(metadata)));const manifest=JSON.parse(await forged.file('manifest.json')!.async('string'));for(const entry of manifest.files){const bytes=await forged.file(entry.path)!.async('uint8array');entry.size=bytes.length;entry.sha256=sha256Sync(bytes);}forged.file('manifest.json',JSON.stringify(manifest));await expect(restoreProject(new File([new Uint8Array(await forged.generateAsync({type:'uint8array'})).buffer],'fictional-rehashed-record.folio.zip'))).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});
 });
 it('refuses an oversized third complete content history atomically without trimming the saved first two',async()=>{
  const resume=await source(true);await saveProject(resume);let app=await createApplication(resume);expect(app.draft.blocks.length).toBeGreaterThanOrEqual(60);
  // Ordinary bounded edit commands create a deliberately overflowing fictional
  // draft. This exercises transport/history admission, not PDF fit or tailoring.
  for(const block of app.draft.blocks)app=editBlock(app,block.id,[{text:'x'.repeat(9000),bold:false,sourceFactIds:[]}]);app=saveVersion(saveVersion(app,'firstResult'),'download');await saveProject(app);const before=(await loadProjects()).find(p=>p.id===app.id)!;expect(before.folio!.versions).toHaveLength(2);
  const third=saveVersion(app,'download');expect(new TextEncoder().encode(JSON.stringify(third.folio)).length).toBeLessThan(2*1024*1024);await expect(saveProject(third)).rejects.toMatchObject({code:'SOURCE_FONT_METADATA_LIMIT'});const after=(await loadProjects()).find(p=>p.id===app.id)!;expect(canonicalJson(after)).toBe(canonicalJson(before));expect(after.folio!.versions).toHaveLength(2);expect(after.draft).toEqual(app.draft);deepStrictEqual(after.template, app.template);deepStrictEqual(after.source.bytes, resume.source.bytes);
 });
});

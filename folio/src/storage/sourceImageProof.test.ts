import { deepStrictEqual } from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {afterAll,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {openDB} from 'idb';
import JSZip from 'jszip';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {fictionalImageBlankSource} from '../core/sourceImageTestFixture';
import {makeProject,type ImageRegion,type Template} from '../core/model';
import {validateProject} from '../core/schema';
import {approveTemplate} from '../core/commands';
import {setFontLoader} from '../layout/fonts';
import {importResume} from '../import';
import {sourceImagePaintHash} from '../import/pdf-source-images';
import {backupProject,backupResumeGroup,restoreGroup,restoreProject,saveProject,loadProjects} from './projects';
import {createApplication} from '../core/applications';

let program:Uint8Array,restore:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('../import/pdf');(await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
beforeEach(async()=>{const db=await openDB('folio-local-v1',2,{upgrade(db){if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});if(!db.objectStoreNames.contains('groupState'))db.createObjectStore('groupState',{keyPath:'templateGroupId'});}});await db.clear('projects');await db.clear('groupState');db.close();});
async function project(){const bytes=await fictionalImageBlankSource(program,{images:2,overhang:.000005,blankWidth:512}),r=await importResume(new File([new Uint8Array(bytes).buffer],'fictional-owned-alpha-image.pdf',{type:'application/pdf'}));return approveTemplate(validateProject(makeProject(r)),r.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));}
// JSON and the previous toEqual assertion omit the optional no-profile key.
// Keep every other field, including defined profile hashes, in the full clone.
function portableExpectedTemplate(template:Template):Template {
 const expected=structuredClone(template);
 for(const page of expected.pages)for(const region of page.regions){
  if(region.kind==='image'&&region.sourcePaint&&Object.hasOwn(region.sourcePaint,'colorProfileSha256')&&region.sourcePaint.colorProfileSha256===undefined)delete region.sourcePaint.colorProfileSha256;
 }
 return expected;
}
describe('portable original image alpha/clip and positive blank proof',()=>{
 it('preserves defined image profile hashes in the complete portable expectation',async()=>{
  const p=await project(),withProfile=structuredClone(p.template);
  const image=withProfile.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;
  image.sourcePaint!.colorProfileSha256='a'.repeat(64);
  const expected=portableExpectedTemplate(withProfile),expectedImage=expected.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;
  expect(Object.hasOwn(expectedImage.sourcePaint!,'colorProfileSha256')).toBe(true);
  expect(expectedImage.sourcePaint!.colorProfileSha256).toBe('a'.repeat(64));
  deepStrictEqual(portableExpectedTemplate(withProfile),expected);
  const changed=structuredClone(expected),changedImage=changed.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;
  changedImage.sourcePaint!.colorProfileSha256='b'.repeat(64);
  expect(()=>deepStrictEqual(changed,expected)).toThrow();
 });

 it('preserves actual source image/blank proof through save/reload, single and group backups',async()=>{
  const p=await project();await saveProject(p);deepStrictEqual((await loadProjects())[0].template, p.template);deepStrictEqual((await loadProjects())[0].assets, p.assets);
  const expectedPortable=portableExpectedTemplate(p.template);
  const restored=await restoreProject(new File([await backupProject(p)],'fictional-image.folio.zip'));deepStrictEqual(restored.template, expectedPortable);deepStrictEqual(restored.assets, p.assets);
  const app=await createApplication(p);await saveProject(app);const group=await restoreGroup(new File([await backupResumeGroup([p,app])],'fictional-images-group.folio.zip'));expect(group).toHaveLength(2);for(const item of group){deepStrictEqual(item.template, expectedPortable);deepStrictEqual(item.assets, p.assets);}
 });
 it('rejects self-consistent shifted clip/ref and unsupported blank map before durable restore writes',async()=>{
  const p=await project(),backup=await backupProject(p),forged=structuredClone(p),image=forged.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;image.sourcePaint!.pageClip!.x+=.1;const admission=forged.template.sourceImageContract!.pages[0];if(admission.status!=='proved')throw Error();admission.occurrences.find(v=>v.operatorIndex===image.order)!.paintSha256=sourceImagePaintHash(image.sourcePaint!);expect(()=>validateProject(forged)).not.toThrow();await expect(saveProject(forged)).rejects.toThrow(/retained PDF paint/);expect(await loadProjects()).toEqual([]);
  for(const mode of ['clip','ref','blank']){const zip=await JSZip.loadAsync(await backup.arrayBuffer()),meta=JSON.parse(await zip.file('project.json')!.async('string'));if(mode==='blank'){meta.template.sourceFonts[0].glyphMap.find((m:{selectorProvenance?:string})=>m.selectorProvenance).glyphId=0;}else{const r=meta.template.pages[0].regions.find((r:ImageRegion)=>r.kind==='image');if(mode==='clip')r.sourcePaint.pageClip.width-=.01;else r.sourcePaint.imageRef='999 0 R';}zip.file('project.json',JSON.stringify(meta));await expect(restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'tampered-image.folio.zip'))).rejects.toThrow();expect(await loadProjects()).toEqual([]);}
 });
});

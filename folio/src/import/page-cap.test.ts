// @vitest-environment node
import 'fake-indexeddb/auto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deepStrictEqual} from 'node:assert/strict';
import {createCanvas,DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {openDB} from 'idb';
import {MAX_SOURCE_PAGES,makeProject,sha256} from '../core/model';
import {projectSchema,validateProject} from '../core/schema';
import {importResume} from './index';
import {preflightPdfImages} from './pdf-image-preflight';
import {sourceIccProfile} from './pdf-icc';
import {usesOnlyNonembeddedStandardFonts} from './pdf-standard-fonts';
import {originalScopedPaint} from './pdf-scoped-paint';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {renderPdfPage} from '../render/preview';
import {backupProject,loadProjects,restoreProject,saveProject} from '../storage/projects';

let restoreFonts:()=>void;
beforeAll(async()=>{
 restoreFonts=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
 const db=await openDB('folio-local-v1',2,{upgrade(db){if(!db.objectStoreNames.contains('projects'))db.createObjectStore('projects',{keyPath:'id'});if(!db.objectStoreNames.contains('groupState'))db.createObjectStore('groupState',{keyPath:'templateGroupId'});}});
 await db.clear('projects');await db.clear('groupState');db.close();
});
afterAll(()=>restoreFonts());

async function authored(pages:number):Promise<Uint8Array>{
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 for(let i=1;i<=pages;i++)pdf.addPage([500+i,700+i]).drawText(`Fictional original page ${i}`,{x:40,y:650,font,size:12});
 return new Uint8Array(await pdf.save());
}
const file=(bytes:Uint8Array)=>new File([new Uint8Array(bytes).buffer],'authored-long.pdf',{type:'application/pdf'});
function canvas(){const c=createCanvas(1,1);Object.assign(c,{ownerDocument:{createElement:()=>createCanvas(1,1)}});return c;}

describe('complete bounded long-PDF baselines',()=>{
 it('retains every original23-page source, baseline, fact and page geometry through device and portable roundtrip',async()=>{
  const bytes=await authored(23),sourceHash=await sha256(bytes),project=validateProject(makeProject(await importResume(file(bytes)),true));
  expect(project.source.sourcePageCount).toBe(23);expect(project.template.pages).toHaveLength(23);
  expect(project.template.pages.map(p=>[p.width,p.height])).toEqual(Array.from({length:23},(_,i)=>[501+i,701+i]));
  expect(project.baseline.blocks.map(b=>b.runs.map(r=>r.text).join(''))).toEqual(Array.from({length:23},(_,i)=>`Fictional original page ${i+1}`));
  expect(await sha256(project.source.bytes)).toBe(sourceHash);expect(project.approval).toBeNull();
  const before=structuredClone(project);
  await saveProject(project);const loaded=(await loadProjects()).find(p=>p.id===project.id)!;
  deepStrictEqual(loaded.source,before.source);deepStrictEqual(loaded.template,before.template);deepStrictEqual(loaded.baseline,before.baseline);deepStrictEqual(loaded.draft,before.draft);deepStrictEqual(loaded.facts,before.facts);
  const restored=await restoreProject(new File([await backupProject(project)],'authored-long.folio.zip'));
  expect(restored.id).not.toBe(project.id);expect(restored.template.pages).toHaveLength(23);
  deepStrictEqual(restored.source,before.source);deepStrictEqual(restored.template,before.template);deepStrictEqual(restored.baseline,before.baseline);deepStrictEqual(restored.draft,before.draft);deepStrictEqual(restored.facts,before.facts);
  const baseline=await renderProjectDocument(project,'baselinePreview');
  expect((await PDFDocument.load(baseline.bytes)).getPageCount()).toBe(23);
  expect(await sha256(baseline.bytes)).not.toBe(sourceHash);
  // Real local PDF.js preview can reach the actual last original/reconstructed page.
  // This is page/paint preservation, not a catalogue-font raster-fidelity assertion.
  for(const input of [project.source.bytes,baseline.bytes]){
   const c=canvas();await renderPdfPage(input,23,c as unknown as HTMLCanvasElement,1);
   expect([c.width,c.height]).toEqual([523,723]);
   expect(c.getContext('2d').getImageData(0,0,c.width,c.height).data.some((v,i)=>i%4!==3&&v<100)).toBe(true);
  }
  deepStrictEqual(project,before);expect(await sha256(bytes)).toBe(sourceHash);
 });
 it('admits32 original pages and still rejects33 before source/classification/image decoding',async()=>{
  const accepted=await authored(MAX_SOURCE_PAGES),refused=await authored(MAX_SOURCE_PAGES+1);
  const project=validateProject(makeProject(await importResume(file(accepted)),true));
  expect(project.source.sourcePageCount).toBe(MAX_SOURCE_PAGES);expect(project.template.pages).toHaveLength(MAX_SOURCE_PAGES);
  await expect(preflightPdfImages(accepted)).resolves.toBeUndefined();await expect(sourceIccProfile(accepted)).resolves.toBeUndefined();
  await expect(importResume(file(refused))).rejects.toMatchObject({code:'PAGE_LIMIT'});
  await expect(preflightPdfImages(refused)).rejects.toMatchObject({code:'PAGE_LIMIT'});await expect(sourceIccProfile(refused)).rejects.toMatchObject({code:'PAGE_LIMIT'});
  const original=await PDFDocument.load(accepted),awaitedRefused=await PDFDocument.load(refused);
  expect(originalScopedPaint(original,MAX_SOURCE_PAGES).occurrences.map(o=>o.kind)).toEqual(['text']);
  expect(()=>originalScopedPaint(awaitedRefused,1)).toThrow();
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(accepted),fontExtraProperties:true,verbosity:0});
  try{
   const last=await(await task.promise).getPage(MAX_SOURCE_PAGES),ops=await last.getOperatorList();
   expect(await usesOnlyNonembeddedStandardFonts(accepted,MAX_SOURCE_PAGES,ops)).toBe(true);
   expect(await usesOnlyNonembeddedStandardFonts(refused,1,ops)).toBe(false);
  }finally{await task.destroy();}
  const c=canvas();await renderPdfPage(accepted,MAX_SOURCE_PAGES,c as unknown as HTMLCanvasElement);
  expect([c.width,c.height]).toEqual([532,732]);
  await expect(renderPdfPage(refused,1,c as unknown as HTMLCanvasElement)).rejects.toMatchObject({code:'preview-pages'});
  expect([c.width,c.height]).toEqual([532,732]);
 });
 it('keeps actual licensed subset programme and scoped text ownership beyond the former two-page limit',async()=>{
  const source=await PDFDocument.load(new Uint8Array(await readFile('public/fixtures/r13-catalogue/composite.pdf'))),pdf=await PDFDocument.create();
  const pages=await pdf.copyPages(source,[0,0,0]);for(const page of pages)pdf.addPage(page);
  const bytes=new Uint8Array(await pdf.save()),project=validateProject(makeProject(await importResume(file(bytes)),true)),before=structuredClone(project);
  expect(project.source.sourcePageCount).toBe(3);expect(project.template.pages).toHaveLength(3);
  expect(project.template.sourceFonts?.length).toBeGreaterThan(0);expect(project.template.sourceFonts?.every(f=>f.sourceVersion===8)).toBe(true);
  expect(project.template.sourceScopedPages?.pages.map(p=>p.pageNumber)).toEqual([1,2,3]);
  expect(project.template.pages.every(p=>p.regions.some(r=>r.kind==='text'&&!!r.sourceLayout&&r.sourceScopedPaint?.pageNumber===project.template.pages.indexOf(p)+1))).toBe(true);
  const baseline=await renderProjectDocument(project,'baselinePreview');
  expect((await PDFDocument.load(baseline.bytes)).getPageCount()).toBe(3);
  deepStrictEqual(project,before);expect(await sha256(project.source.bytes)).toBe(await sha256(bytes));
 });
 it('keeps long-page schema and project pre-await budgets bounded and preserves nullable source counts',async()=>{
  const project=makeProject(await importResume(file(await authored(3))),true);
  const wrongCount=structuredClone(project);wrongCount.source.sourcePageCount=MAX_SOURCE_PAGES+1;
  expect(projectSchema.safeParse(wrongCount).success).toBe(false);
  const overPages=structuredClone(project);overPages.template.pages=Array.from({length:MAX_SOURCE_PAGES+1},()=>structuredClone(project.template.pages[0]));
  expect(projectSchema.safeParse(overPages).success).toBe(false);
  await expect(renderProjectDocument(overPages,'baselinePreview')).rejects.toMatchObject({code:'SOURCE_RENDER_BUDGET'});
  // DOCX retains its existing unknown original page-count representation.
  // This storage shape check does not claim Word appearance or importer capacity.
  expect(projectSchema.shape.source.shape.sourcePageCount.safeParse(null).success).toBe(true);
  expect(projectSchema.shape.template.shape.pages.safeParse(project.template.pages).success).toBe(true);
 });
});

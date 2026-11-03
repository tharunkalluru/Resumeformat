import {beforeAll,afterAll,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFName} from 'pdf-lib';
import {setFontLoader} from '../layout/fonts';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
import {importResume} from './index';
import {makeProject,rendererVersionFor,documentScopedProgramHashes,hasValidApproval,canonicalJson,sourceDocumentFingerprint,documentScopedHistoryBinding,sourceFontReuseChoiceOwner,sha256Sync} from '../core/model';
import type {Project} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {createApplication} from '../core/applications';
import {saveVersion} from '../core/folio';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {renderProjectDocument,renderProjectHistory,licensedCurrentPreviewAllows} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject,backupResumeGroup,restoreGroup} from '../storage/projects';
import {originalOperators,originalPageContent} from './pdf-image-trace';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
async function fixture(v2:boolean,clipped=true){
 const original=await authoredMacRomanSource({codes:[65,66]}),doc=await PDFDocument.load(original.bytes),c=doc.context;
 // A real source TJ displacement creates one extracted semantic item and two physical owners.
 const raw=`q ${clipped?'16.6 18.59998 460 654.8 re W n ':''}BT /F1 12 Tf 1 0 0 1 40 648 Tm [<41> -250 <42>] TJ ET ${v2?'40 620 m 160 620 l 160 621 l 40 621 l h f ':''}Q`;
 doc.getPages()[0].node.set(PDFName.of('Contents'),c.register(c.flateStream(raw)));
 const bytes=new Uint8Array(await doc.save()),p=makeProject(await importResume(new File([bytes],'authored-clipped-contract.pdf',{type:'application/pdf'})));
 expect(p.template.sourceFonts!.every(f=>f.sourceVersion===7)).toBe(true);expect(p.template.sourceColorProfile).toBeUndefined();
 expect(p.template.sourceScopedPages?.version).toBe(v2?'source-scoped-pages-v2':'source-scoped-pages-v1');expect(p.template.pages[0].regions.filter(r=>r.kind==='text')).toHaveLength(2);
 return p;
}
const approve=(p:Project)=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});
const expected=(v2:boolean)=>v2?'folio-pdf-scoped-color-v3':'folio-document-scoped-tt-v3';
const previous=(v2:boolean)=>v2?'folio-pdf-scoped-color-v2':'folio-document-scoped-tt-v2';
it.each([false,true])('invalidates the previously unchanged clipped no-ICC V7 identity v2=%s',async v2=>{
 const p=await fixture(v2),before=canonicalJson(p),proof=await validateSourceScopedPaint(p.source.bytes,p.template,p.assets,true,false);
 expect(proof?.sourceSemanticSplit).toBe(true);expect(proof?.atomicPages?.get(p.template.pages[0].id)?.length).toBeGreaterThan(0);
 expect(rendererVersionFor(p.template)).toBe(expected(v2));
 const rendered=await renderProjectDocument(p,'baselinePreview');expect(rendered.rendererVersion).toBe(expected(v2));
 const pdf=await PDFDocument.load(rendered.bytes),ops=originalOperators(originalPageContent(pdf,1),undefined,true);
 expect(ops.filter(o=>o.word==='re').map(o=>o.args)).toContainEqual([16.6,18.59998,460,654.8]);expect(ops.filter(o=>o.word==='TJ')).toHaveLength(1);
 expect(licensedCurrentPreviewAllows(rendered,p,p.template.pages[0].regions[0].id)).toBe(false);expect(canonicalJson(p)).toBe(before);
});
it.each([false,true])('keeps source data durable while old current/history contracts refuse v2=%s',async v2=>{
 const p=await fixture(v2),approved=await approve(p),app=saveVersion(await createApplication(approved,{title:'Authored',company:'Fixture',description:'Use existing evidence.'}),'download');
 expect(hasValidApproval(app)).toBe(true);const current=await renderProjectDocument(app,'current');expect(current.rendererVersion).toBe(expected(v2));
 const old=structuredClone(app);old.approval!.rendererVersion=previous(v2);expect(hasValidApproval(old)).toBe(false);await expect(renderProjectDocument(old,'current')).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
 // The historical fingerprint construction is explicit, including the old contract.
 const template=app.template,content=app.draft;
 const historicalFingerprint=(await import('../core/model')).hashTextSync(canonicalJson({template:{...template,sourceFonts:template.sourceFonts?.map(({bytes:_bytes,...font})=>({...font,...(font.format==='truetype'&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:undefined}}:{})}))},content,adapterVersion:1,rendererContract:previous(v2)}));
 expect(sourceDocumentFingerprint(template,content)).not.toBe(historicalFingerprint);
 expect(sourceFontReuseChoiceOwner(app)).not.toBe(canonicalJson([app.id,app.source.sha256,template.id,template.revision,(await import('../core/model')).SOURCE_FONT_REUSE_POLICY,previous(v2),documentScopedProgramHashes(template)]));
 const stale=structuredClone(app);stale.folio!.versions[0].documentScopedBinding=(await import('../core/model')).hashTextSync(canonicalJson([stale.source.sha256,stale.template,previous(v2)]));expect(stale.folio!.versions[0].documentScopedBinding).not.toBe(documentScopedHistoryBinding(app));await expect(renderProjectHistory(stale,stale.folio!.versions[0].id)).rejects.toMatchObject({code:'SOURCE_HISTORY_PROOF'});
 expect((await renderProjectHistory(app,app.folio!.versions[0].id)).rendererVersion).toBe(expected(v2));
 const changed=editBlock(app,app.draft.blocks[0].id,[{text:'B'}]);await expect(renderProjectDocument(changed,'current')).rejects.toMatchObject({code:'PDF_SOURCE_SEMANTIC_SPLIT'});
 await saveProject(app);const loaded=(await loadProjects()).find(x=>x.id===app.id)!;expect(canonicalJson(loaded.baseline)).toBe(canonicalJson(app.baseline));expect(sha256Sync(loaded.source.bytes)).toBe(app.source.sha256);expect(hasValidApproval(loaded)).toBe(true);
 const single=await restoreProject(new File([await backupProject(app)],'authored.folio.zip'));expect(single.approval).toBeNull();expect(canonicalJson(single.template)).toBe(canonicalJson(app.template));expect(canonicalJson(single.baseline)).toBe(canonicalJson(app.baseline));
 const group=await restoreGroup(new File([await backupResumeGroup([app])],'authored-group.folio.zip'));expect(group.length).toBeGreaterThan(0);for(const restored of group){expect(restored.approval).toBeNull();expect(sha256Sync(restored.source.bytes)).toBe(app.source.sha256);}
 const forged=structuredClone(app);const region=forged.template.pages[0].regions.find(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint)!;if('sourceScopedPaint'in region)region.sourceScopedPaint!.clipStack[0].bounds.y+=.01;await expect(renderProjectDocument(forged,'baselinePreview')).rejects.toThrow();
});
it.each([false,true])('retains unclipped no-ICC V7 identities v2=%s',async v2=>{const p=await fixture(v2,false);expect(rendererVersionFor(p.template)).toBe(previous(v2));expect((await renderProjectDocument(p,'baselinePreview')).rendererVersion).toBe(previous(v2));});

it.each([false,true])('does not resurrect an old approval through durable or portable storage v2=%s',async v2=>{const p=await approve(await fixture(v2));p.approval!.rendererVersion=previous(v2);await saveProject(p);const loaded=(await loadProjects()).find(x=>x.id===p.id)!;expect(hasValidApproval(loaded)).toBe(false);expect(canonicalJson(loaded.facts)).toBe(canonicalJson(p.facts));expect(canonicalJson(loaded.baseline)).toBe(canonicalJson(p.baseline));expect(sha256Sync(loaded.source.bytes)).toBe(p.source.sha256);const restored=await restoreProject(new File([await backupProject(p)],'authored-old-contract.folio.zip'));expect(hasValidApproval(restored)).toBe(false);expect(restored.approval).toBeNull();expect(canonicalJson(restored.template)).toBe(canonicalJson(p.template));});
it('keeps unrelated legacy selector branches unchanged even when saved clip labels exist',async()=>{const p=await fixture(true);const t=structuredClone(p.template);delete t.sourceFonts;expect(rendererVersionFor(t)).toBe('folio-pdf-scoped-color-v1');t.sourceColorProfile={ } as NonNullable<typeof t.sourceColorProfile>;expect(rendererVersionFor(t)).toBe('folio-pdf-scoped-color-v2');delete t.sourceColorProfile;delete t.sourceScopedPages;expect(rendererVersionFor(t)).toBe('folio-pdf-v1');});

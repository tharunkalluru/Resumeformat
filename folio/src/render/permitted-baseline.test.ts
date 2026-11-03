import 'fake-indexeddb/auto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFDict,PDFArray,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {fictionalScopedPdf} from '../import/pdf-scoped.fixture';
import {originalOperators,originalPageContent} from '../import/pdf-image-trace';
import {importResume} from '../import';
import {setFontLoader} from '../layout/fonts';
import {makeProject,canonicalJson,rendererVersionFor,hasValidApproval,hashTextSync,sha256Sync} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {createApplication} from '../core/applications';
import {saveVersion} from '../core/folio';
import {renderProjectDocument,renderProjectHistory,renderDocument,licensedCurrentPreviewAllows} from './pdf';
import {backupProject,restoreProject} from '../storage/projects';
let program:Uint8Array,restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));});afterAll(()=>restore?.());
async function project(tj=false,winAnsi=false){const f=await fictionalScopedPdf(program,{identity:!winAnsi,text:'abc'}),pdf=await PDFDocument.load(f.bytes),font=fontkit.create(program),codes=Array.from('abc',c=>(winAnsi?c.charCodeAt(0):font.glyphForCodePoint(c.charCodeAt(0)).id).toString(16).padStart(winAnsi?2:4,'0'));
 const show=tj?`[<${codes[0]}> -12.5 <${codes[1]}> 3 <${codes[2]}>] TJ`:`<${codes.join('')}> Tj`,text=`q 20 550 250 130 re W n q .24 0 0 .24 0 0 cm BT /F1 1 Tf .01 Tc 50 0 0 50 166.66666666666666 2700 Tm ${show} ET Q .3 g 40 590 m 180 590 l 180 592 l 40 592 l h f Q`;
 pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(text)));const bytes=new Uint8Array(await pdf.save());return {p:makeProject(await importResume(new File([bytes],'authored-permitted-baseline.pdf',{type:'application/pdf'}))),codes,sourceText:text};}
async function output(bytes:Uint8Array,pageNumber=1){const pdf=await PDFDocument.load(bytes),ops=originalOperators(originalPageContent(pdf,pageNumber),undefined,true),fonts=pdf.getPages()[pageNumber-1].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=fonts.lookup(fonts.keys()[0],PDFDict),child=font.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=child.lookup(PDFName.of('FontDescriptor'),PDFDict),stream=pdf.context.lookup(descriptor.get(PDFName.of('FontFile2'))) as PDFRawStream,gids=decodePDFRawStream(pdf.context.lookup(child.get(PDFName.of('CIDToGIDMap'))) as PDFRawStream).decode();return {ops,program:decodePDFRawStream(stream).decode(),gids,fontNames:fonts.keys().map(key=>key.decodeText())};}
it.each([false,true])('replays permitted original whole show TJ=%s with original programme and nominal transform',async tj=>{const {p,codes}=await project(tj);expect(p.template.sourceFonts?.every(f=>f.sourceVersion===4)).toBe(true);expect(p.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);const rendered=await renderProjectDocument(p,'baselinePreview'),o=await output(rendered.bytes);expect(rendered.sourceReplay).toBe('original-baseline');expect(rendererVersionFor(p.template)).toBe('folio-permitted-tt-baseline-v8');expect(sha256Sync(o.program)).toBe(sha256Sync(program));expect(o.ops.filter(op=>op.word==='Tm').map(op=>op.args)).toEqual([[50,0,0,50,166.66666666666666,2700]]);expect(o.ops.filter(op=>op.word==='Tc').map(op=>op.args)).toEqual([[.01]]);expect(o.ops.filter(op=>op.word==='Tf').map(op=>op.args[1])).toEqual([1]);expect(o.ops.some(op=>op.word==='cm'&&canonicalJson(op.args)==='[0.24,0,0,0.24,0,0]')).toBe(true);expect(o.ops.filter(op=>op.word==='W')).toHaveLength(1);const shows=o.ops.filter(op=>op.word==='Tj'||op.word==='TJ');expect(shows).toHaveLength(1);expect(shows[0].word).toBe(tj?'TJ':'Tj');const raw=(shows[0].args[0] as {rawArray?:string;rawString?:string}).rawArray??(shows[0].args[0] as {rawString:string}).rawString;const emitted=[...raw.matchAll(/<([\da-f]+)>/gi)].flatMap(m=>m[1].match(/.{4}/g)!.map(hex=>parseInt(hex,16)));expect(emitted.map(cid=>new DataView(o.gids.buffer,o.gids.byteOffset,o.gids.byteLength).getUint16(cid*2))).toEqual(codes.map(x=>parseInt(x,16)));if(tj)expect(raw.replace(/<[^>]+>/g,'')).toMatch(/-12\.5\s+3/);expect(o.ops.filter(op=>op.word==='m').map(op=>op.args)).toContainEqual([40,590]);});
it('uses the same source-authoritative V6 path without substituting PDF width for native width',async()=>{const {p}=await project(true,true);expect(p.template.sourceFonts![0].sourceVersion).toBe(6);const map=p.template.sourceFonts![0].glyphMap;expect(map.some(m=>m.nativeWidth!==m.pdfWidth)).toBe(true);const r=await renderProjectDocument(p,'baselinePreview');expect(r.sourceReplay).toBe('original-baseline');expect((await output(r.bytes)).ops.filter(o=>o.word==='TJ')).toHaveLength(1);});
it('supports an unapproved exact-baseline current preview without an applicant permission or native-v2 grant',async()=>{const {p}=await project();expect(p.approval).toBeNull();const r=await renderProjectDocument(p,'current');expect(r.sourceReplay).toBe('original-baseline');expect(r.documentScopedPurpose).toBe('current');expect(licensedCurrentPreviewAllows(r,p,p.template.pages[0].regions[0].id)).toBe(false);});
it('retains edited legacy rendering separately, never replaying the original show for changed current wording',async()=>{let {p}=await project();p=await approveTemplate(p,p.template.warnings.map(w=>w.id));p=editBlock(p,p.draft.blocks[0].id,[{text:'cab'}]);const r=await renderProjectDocument(p,'current');expect(r.sourceReplay).toBe('legacy-current');expect((await output(r.bytes)).ops.filter(o=>o.word==='Tj')).toHaveLength(3);expect(licensedCurrentPreviewAllows(r,p,p.template.pages[0].regions[0].id)).toBe(false);});
it('preserves the untouched complete show when one approved identity owner loses a covered character',async()=>{
 const fixture=await fictionalScopedPdf(program,{identity:true,text:'abc',second:true});
 let p=makeProject(await importResume(new File([fixture.bytes],'authored-two-identity-shows.pdf',{type:'application/pdf'})));
 const baseline=await output((await renderProjectDocument(p,'baselinePreview')).bytes);
 p=await approveTemplate(p,p.template.warnings.map(w=>w.id));
 const block=p.draft.blocks.find(b=>b.runs.map(r=>r.text).join('')==='abc')!;
 const untouched=p.draft.blocks.find(b=>b.runs.map(r=>r.text).join('')==='cab')!;
 const before=canonicalJson(untouched);p=editBlock(p,block.id,[{...block.runs[0],text:'ab'}]);
 const rendered=await renderProjectDocument(p,'current'),current=await output(rendered.bytes);
 expect(rendered.sourceReplay).toBe('original-tt-current');
 expect(current.ops.filter(o=>o.word==='Tj')).toHaveLength(3);
 expect(current.ops.filter(o=>o.word==='Tj').at(-1)?.args).toEqual(baseline.ops.filter(o=>o.word==='Tj').at(-1)?.args);
 expect(sha256Sync(current.program)).toBe(sha256Sync(program));
 expect(canonicalJson(p.draft.blocks.find(b=>b.id===untouched.id))).toBe(before);
 expect(licensedCurrentPreviewAllows(rendered,p,p.template.pages[0].regions[0].id)).toBe(false);
});
it('retains source paint across an evidence-only draft update at the same text revision',async()=>{
 const fixture=await fictionalScopedPdf(program,{identity:true,text:'abc',second:true});
 let p=makeProject(await importResume(new File([fixture.bytes],'authored-evidence-only.pdf',{type:'application/pdf'})));
 p=await approveTemplate(p,p.template.warnings.map(w=>w.id));const revision=p.draft.revision;
 const expected=await output((await renderProjectDocument(p,'current')).bytes);
 p=structuredClone(p);p.draft.blocks[0].runs[0].sourceFactIds=[];
 const rendered=await renderProjectDocument(p,'current'),actual=await output(rendered.bytes);
 expect(p.draft.revision).toBe(revision);expect(rendered.sourceReplay).toBe('original-tt-current');
 expect(actual.ops.filter(o=>o.word==='Tj').map(o=>o.args)).toEqual(expected.ops.filter(o=>o.word==='Tj').map(o=>o.args));
});
it('binds historical source/template/version and rejects stale approval without deleting the saved source',async()=>{let {p}=await project();p=await approveTemplate(p,p.template.warnings.map(w=>w.id));const app=saveVersion(await createApplication(p),'download');expect((await renderProjectHistory(app,app.folio!.versions[0].id)).sourceReplay).toBe('original-baseline');const old=structuredClone(app);old.approval!.rendererVersion='folio-pdf-v1';expect(hasValidApproval(old)).toBe(false);await expect(renderProjectDocument(old,'current')).rejects.toMatchObject({code:'SOURCE_TEMPLATE_REVIEW'});old.approval=app.approval;delete old.folio!.versions[0].documentScopedBinding;await expect(renderProjectHistory(old,old.folio!.versions[0].id)).rejects.toMatchObject({code:'SOURCE_HISTORY_PROOF'});expect(old.source.sha256).toBe(app.source.sha256);});
it('rederives after portable restoration and cannot mint baseline authority through low-level render',async()=>{const {p}=await project(),restored=await restoreProject(new File([await backupProject(p)],'authored.folio.zip'));expect(canonicalJson(restored.template)).toBe(canonicalJson(p.template));expect((await renderProjectDocument(restored,'baselinePreview')).sourceReplay).toBe('original-baseline');const unbound=await renderDocument(p.template,p.baseline,p.assets);expect(unbound.rendererVersion).not.toBe(rendererVersionFor(p.template));expect(unbound.documentScopedPurpose).toBeUndefined();expect(unbound.sourceReplay).toBeUndefined();});
it.each(['underline','href'])('rejects coherently rehashed original baseline %s',async kind=>{const {p}=await project(),r=p.template.pages[0].regions.find(r=>r.kind==='text')!;if(r.kind!=='text')throw Error();if(kind==='underline')p.baseline.blocks[0].runs[0].underline=true;else p.baseline.blocks[0].runs[0].href='https://example.com/invented';r.sourceLayout!.baselineRunsHash=hashTextSync(canonicalJson(p.baseline.blocks[0].runs));p.draft=structuredClone(p.baseline);const {sourceScopedStateHash}=await import('../core/source-scoped-paint');r.sourceScopedPaint!.stateHash=sourceScopedStateHash(r,p.template.sourceFonts!);await expect(renderProjectDocument(p,'baselinePreview')).rejects.toThrow();});
it('captures immutable source/template/content before awaiting independent proof',async()=>{const {p}=await project(),pending=renderProjectDocument(p,'baselinePreview');p.source.bytes[0]^=1;p.baseline.blocks[0].runs[0].text='forged';expect((await pending).sourceReplay).toBe('original-baseline');});
it('retains the independently positive original blank in a V5 whole show',async()=>{const f=await fictionalScopedPdf(program,{identity:true,text:'a b'}),p=makeProject(await importResume(new File([f.bytes],'authored-positive-blank.pdf',{type:'application/pdf'})));expect(p.template.sourceFonts![0].sourceVersion).toBe(5);const asset=p.template.sourceFonts![0],blank=asset.glyphMap.find(g=>g.unicode===' ')!;expect(blank.originalGlyphId).toBeGreaterThan(0);expect(blank.selectorProvenance).toBe('original-identity-positive-blank-v1');const o=await output((await renderProjectDocument(p,'baselinePreview')).bytes);expect(o.ops.filter(op=>op.word==='Tj')).toHaveLength(1);expect(new DataView(o.gids.buffer,o.gids.byteOffset,o.gids.byteLength).getUint16(blank.cid*2)).toBe(blank.originalGlyphId);expect(sha256Sync(o.program)).toBe(sha256Sync(program));});
it('cannot remove the whole-show proof to take an unqualified baseline fallback',async()=>{const {p}=await project();delete p.template.sourceScopedPages;for(const page of p.template.pages)for(const r of page.regions)if('sourceScopedPaint'in r)delete r.sourceScopedPaint;await expect(renderProjectDocument(p,'baselinePreview')).rejects.toThrow();});

it('retains every permitted original whole show and programme across three complete source pages',async()=>{
 const {p:single}=await project(true),source=await PDFDocument.load(single.source.bytes),pdf=await PDFDocument.create();
 for(const page of await pdf.copyPages(source,[0,0,0]))pdf.addPage(page);
 const bytes=new Uint8Array(await pdf.save()),p=makeProject(await importResume(new File([bytes],'authored-long-permitted-baseline.pdf',{type:'application/pdf'}))),before=canonicalJson(p);
 expect(p.source.sourcePageCount).toBe(3);expect(p.template.pages).toHaveLength(3);
 expect(p.template.sourceFonts?.every(font=>font.sourceVersion===4)).toBe(true);
 expect(p.template.sourceScopedPages?.pages.map(page=>page.pageNumber)).toEqual([1,2,3]);
 expect(p.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);
 const rendered=await renderProjectDocument(p,'baselinePreview');expect(rendered.sourceReplay).toBe('original-baseline');expect((await PDFDocument.load(rendered.bytes)).getPageCount()).toBe(3);
 const original=await output((await renderProjectDocument(single,'baselinePreview')).bytes);
 // PDF-lib assigns fresh random output resource aliases. Bind each sole resource
 // to its exact original programme/CID map before comparing every other operand.
 const ownedOps=(data:Awaited<ReturnType<typeof output>>)=>{
  expect(data.fontNames).toHaveLength(1);
  return data.ops.map(op=>{
   if(op.word!=='Tf')return op;
   expect(op.args[0]).toEqual({name:data.fontNames[0]});
   return {...op,args:[{name:'verified-original-resource'},...op.args.slice(1)]};
  });
 };
 for(let page=1;page<=3;page++){
  const actual=await output(rendered.bytes,page);
  expect(sha256Sync(actual.program)).toBe(sha256Sync(program));
  expect(canonicalJson(ownedOps(actual))).toBe(canonicalJson(ownedOps(original)));
  expect(sha256Sync(actual.gids)).toBe(sha256Sync(original.gids));
 }
 expect(canonicalJson(p)).toBe(before);expect(p.source.sha256).toBe(sha256Sync(bytes));
});

it('rejects old clipped permitted approval and requires the new unclipped decimal proof contract',async()=>{let {p}=await project();p=await approveTemplate(p,p.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));const prior=structuredClone(p);prior.approval!.rendererVersion='folio-permitted-tt-baseline-v1';expect(hasValidApproval(prior)).toBe(false);const d=await PDFDocument.load(p.source.bytes);d.getPages()[0].node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream((await project()).sourceText.replace('20 550 250 130 re W n',''))));const noClip=makeProject(await importResume(new File([new Uint8Array(await d.save())],'authored-no-clip.pdf',{type:'application/pdf'})));expect(rendererVersionFor(noClip.template)).toBe('folio-permitted-tt-baseline-v7');expect((await renderProjectDocument(noClip,'baselinePreview')).rendererVersion).toBe('folio-permitted-tt-baseline-v7');});

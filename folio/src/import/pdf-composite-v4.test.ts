import 'fake-indexeddb/auto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFDict,PDFArray,PDFName} from 'pdf-lib';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {captureCompositeSource,renderCompositeBaseline} from './pdf-composite-program';
import {importResume} from './index';
import {makeProject} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceWordingTargets,sourceWordingPreviewReady,sourceWordingBlock} from '../core/source-wording';
import {renderProjectDocument,renderDocument,setFontLoader} from '../render/pdf';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
import {registerBrowserSourceFontSet} from '../ui/sourceFonts';

let program:Uint8Array,release:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>release?.());
async function fixture(){
 const d=await PDFDocument.create();d.registerFontkit(fontkit);const f=await d.embedFont(program,{subset:false}),p=d.addPage([240,320]);
 const a=f.encodeText('a').toString(),b=f.encodeText('b').toString(),ab=f.encodeText('ab').toString(),blank=f.encodeText(' ').toString(),lig=f.encodeText('\uFB03').toString();await d.flush();
 const code=(v:string)=>v.slice(1,-1),dict=d.context.lookup(f.ref,PDFDict);dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict).set(PDFName.of('CIDToGIDMap'),PDFName.of('Identity'));
 const cmap=`/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 4 beginbfchar ${a} <0061> ${b} <0062> ${blank} <0020> ${lig} <0000> endbfchar 1 beginbfchar ${lig} <006600660069> endbfchar endcmap end end`;
 dict.set(PDFName.of('ToUnicode'),d.context.register(d.context.flateStream(cmap)));p.node.set(PDFName.of('Resources'),d.context.obj({Font:{F1:f.ref}}));
 const raw=`q 0 0 240 320 re W n 0 0 0 rg BT /F1 12 Tf /Span << /ActualText <FEFF202D> >> BDC 1 0 0 1 40 280 Tm ${blank} Tj EMC 1 0 0 1 44 280 Tm ${lig} Tj /Span << /ActualText <FEFF202C> >> BDC 1 0 0 1 70 280 Tm ${blank} Tj EMC 1 0 0 1 40 240 Tm ${ab} Tj ET Q`;
 p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(raw)));return{bytes:new Uint8Array(await d.save()),raw,cmap,a,b,blank,lig,code:code(lig)};
}
async function change(f:Awaited<ReturnType<typeof fixture>>,raw=f.raw,cmap=f.cmap){const d=await PDFDocument.load(f.bytes),p=d.getPages()[0];p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(raw)));p.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).lookup(PDFName.of('F1'),PDFDict).set(PDFName.of('ToUnicode'),d.context.register(d.context.flateStream(cmap)));return new Uint8Array(await d.save());}
it('retains a null-placeholder ligature, balances original direction blanks, and exports a separately covered edit',async()=>{
 const f=await fixture(),p=makeProject(await importResume(new File([new Uint8Array(f.bytes).buffer],'authored-ligature.pdf',{type:'application/pdf'})),true),capture=await captureCompositeSource(f.bytes);
 expect(capture.version).toBe('original-native-composite-v4');expect(p.template.importerVersion).toBe('folio-import-v22');expect(capture.sourceFonts[0].sourceVersion).toBe(11);expect(capture.pages[0].graph.map(g=>g.unicode).join('')).toBe(' ffi ab');
 await renderCompositeBaseline(capture);const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id)),preview=await renderProjectDocument(approved,'current'),targets=sourceWordingTargets(approved).filter(r=>sourceWordingPreviewReady(approved,preview,r.id));
 expect(targets).toHaveLength(1);expect(approved.baseline.blocks.find(b=>b.id===targets[0].contentId)!.runs[0].text).toBe('ab');const r=targets[0],block=approved.draft.blocks.find(b=>b.id===r.contentId)!,edited=editBlock(approved,block.id,sourceWordingBlock(approved,r.id,'a').runs),out=await renderProjectDocument(edited,'current');expect(out.layout.overflows).toEqual([]);
 await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'fixture.zip'));expect(restored.approval).toBe(null);expect(restored.reviewedDraftRevision).toBe(null);expect((await renderProjectDocument(await approveTemplate(restored,restored.template.warnings.map(w=>w.id)),'current')).bytes).toEqual(out.bytes);
 await expect(renderDocument(edited.template,edited.draft,[])).rejects.toThrow();const registrations=await registerBrowserSourceFontSet(capture.sourceFonts);expect([...registrations.registrations.values()]).toEqual([expect.objectContaining({status:'readOnly'})]);registrations.dispose();
 const locked=p.template.pages[0].regions.find(r=>r.kind==='text'&&p.baseline.blocks.find(b=>b.id===r.contentId)?.runs[0].text==='ffi')!;expect(()=>sourceWordingBlock(approved,locked.id,'f')).toThrow();
});
it.each(['visible-marker','multiple-marker','nested-open','missing-pop','wrong-pop','arbitrary-payload','conflict','reversed-null','wrong-selector'] as const)('refuses %s instead of guessing ownership',async mode=>{
 const f=await fixture();let raw=f.raw,cmap=f.cmap;
 if(mode==='visible-marker')raw=raw.replace(f.blank+' Tj EMC',f.a+' Tj EMC');else if(mode==='multiple-marker')raw=raw.replace(f.blank+' Tj EMC',f.a.slice(0,-1)+f.b.slice(1)+' Tj EMC');else if(mode==='nested-open')raw=raw.replace('<FEFF202C>','<FEFF202D>');else if(mode==='missing-pop')raw=raw.replace('/Span << /ActualText <FEFF202C> >> BDC','').replace('70 280 Tm '+f.blank+' Tj EMC','70 280 Tm '+f.blank+' Tj');else if(mode==='wrong-pop')raw=raw.replace('<FEFF202D>','<FEFF202C>');else if(mode==='arbitrary-payload')raw=raw.replace('<FEFF202D>','<FEFF0041>');else if(mode==='conflict')cmap=cmap.replace(f.lig+' <0000>',f.lig+' <0041>');else if(mode==='reversed-null')cmap=cmap.replace(f.lig+' <0000>',f.lig+' <006600660069>').replace('1 beginbfchar '+f.lig+' <006600660069>','1 beginbfchar '+f.lig+' <0000>');else cmap=cmap.replaceAll(f.lig,'<FFFF>');
 await expect(captureCompositeSource(await change(f,raw,cmap))).rejects.toBeDefined();
});
it.each(['downgrade','mapping','native-width','frame','missing-proof'] as const)('refuses stored %s mutation at save and render',async mode=>{
 const f=await fixture(),p=makeProject(await importResume(new File([new Uint8Array(f.bytes).buffer],'authored-ligature.pdf',{type:'application/pdf'})),true);
 if(mode==='downgrade'){p.template.importerVersion='folio-import-v21';p.template.sourceCompositePages!.version='original-native-composite-v3';}else if(mode==='mapping')p.template.sourceFonts![0].glyphMap.find(m=>m.unicode==='ffi')!.unicode='ff';else if(mode==='native-width')p.template.sourceFonts![0].glyphMap[0].nativeWidth!++;else if(mode==='frame')p.template.pages[0].regions[0].bounds.x++;else delete p.template.sourceCompositePages;
 await expect(saveProject(p)).rejects.toBeDefined();await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();
});

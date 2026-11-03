import {assertNativeFormInvocation} from './pdf-native-form';
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
 const form=d.context.register(d.context.stream('q 0 0 0 rg /Local gs 0 0 80 80 re f Q',{Type:'XObject',Subtype:'Form',BBox:[0,0,30,30],Matrix:[1,0,0,1,5,7],Group:{Type:'Group',S:'Transparency',I:true},Resources:{ExtGState:{Local:d.context.register(d.context.obj({ca:1,BM:'Normal'}))}}}));p.node.Resources()!.set(PDFName.of('XObject'),d.context.obj({Native:form}));p.node.Resources()!.set(PDFName.of('ExtGState'),d.context.obj({Local:d.context.register(d.context.obj({ca:.3,BM:'Normal'}))}));
 const raw=`q 0 0 240 320 re W n q 10 10 30 15 re W n /Local gs /Native Do Q 0 0 0 rg BT /F1 12 Tf /Span << /ActualText <FEFF202D> >> BDC 1 0 0 1 40 280 Tm ${blank} Tj EMC 1 0 0 1 44 280 Tm ${lig} Tj /Span << /ActualText <FEFF202C> >> BDC 1 0 0 1 70 280 Tm ${blank} Tj EMC 1 0 0 1 40 240 Tm ${ab} Tj ET Q`;
 p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(raw)));return{bytes:new Uint8Array(await d.save()),raw,cmap,a,b,blank,lig,code:code(lig)};
}
async function change(f:Awaited<ReturnType<typeof fixture>>,raw=f.raw,cmap=f.cmap){const d=await PDFDocument.load(f.bytes),p=d.getPages()[0];p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(raw)));p.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).lookup(PDFName.of('F1'),PDFDict).set(PDFName.of('ToUnicode'),d.context.register(d.context.flateStream(cmap)));return new Uint8Array(await d.save());}
it('retains native Form group under parent clip/alpha, original ligature, and a separately covered edit',async()=>{
 const f=await fixture(),p=makeProject(await importResume(new File([new Uint8Array(f.bytes).buffer],'authored-ligature.pdf',{type:'application/pdf'})),true),capture=await captureCompositeSource(f.bytes);
 expect(capture.version).toBe('original-native-composite-v5');expect(p.template.importerVersion).toBe('folio-import-v23');expect(capture.sourceFonts[0].sourceVersion).toBe(11);expect(capture.pages[0].graph.map(g=>g.unicode).join('')).toBe(' ffi ab');
 await renderCompositeBaseline(capture);const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id)),preview=await renderProjectDocument(approved,'current'),targets=sourceWordingTargets(approved).filter(r=>sourceWordingPreviewReady(approved,preview,r.id));
 expect(targets).toHaveLength(1);expect(approved.baseline.blocks.find(b=>b.id===targets[0].contentId)!.runs[0].text).toBe('ab');const r=targets[0],block=approved.draft.blocks.find(b=>b.id===r.contentId)!,edited=editBlock(approved,block.id,sourceWordingBlock(approved,r.id,'a').runs),out=await renderProjectDocument(edited,'current');expect(out.layout.overflows).toEqual([]);
 await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'fixture.zip'));expect(restored.approval).toBe(null);expect(restored.reviewedDraftRevision).toBe(null);expect((await renderProjectDocument(await approveTemplate(restored,restored.template.warnings.map(w=>w.id)),'current')).bytes).toEqual(out.bytes);
 await expect(renderDocument(edited.template,edited.draft,[])).rejects.toThrow();const registrations=await registerBrowserSourceFontSet(capture.sourceFonts);expect([...registrations.registrations.values()]).toEqual([expect.objectContaining({status:'readOnly'})]);registrations.dispose();
 const locked=p.template.pages[0].regions.find(r=>r.kind==='text'&&p.baseline.blocks.find(b=>b.id===r.contentId)?.runs[0].text==='ffi')!;expect(()=>sourceWordingBlock(approved,locked.id,'f')).toThrow();
});
it.each(['resource-owner','bbox','matrix','group','cyclic-leaf','form-font'])('refuses or recaptures original %s mutation; saved proof never authorizes changed source',async mode=>{
 const f=await fixture(),d=await PDFDocument.load(f.bytes),p=d.getPages()[0],r=p.node.Resources()!,ref=r.lookup(PDFName.of('XObject'),PDFDict).get(PDFName.of('Native'))!,stream=d.context.lookup(ref) as import('pdf-lib').PDFRawStream;
 if(mode==='resource-owner')stream.dict.set(PDFName.of('Resources'),d.context.obj({}));else if(mode==='bbox')stream.dict.set(PDFName.of('BBox'),d.context.obj([0,0,31,30]));else if(mode==='matrix')stream.dict.set(PDFName.of('Matrix'),d.context.obj([1,0,0,1,6,7]));else if(mode==='group')stream.dict.lookup(PDFName.of('Group'),PDFDict).set(PDFName.of('I'),d.context.obj(false));else if(mode==='form-font')stream.dict.lookup(PDFName.of('Resources'),PDFDict).set(PDFName.of('Font'),d.context.obj({}));else r.lookup(PDFName.of('XObject'),PDFDict).set(PDFName.of('Native'),d.context.register(d.context.stream('/Native Do',{Type:'XObject',Subtype:'Form',BBox:[0,0,30,30],Resources:{XObject:{Native:ref}}})));
 const changed=new Uint8Array(await d.save());if(mode==='bbox'||mode==='matrix'){const a=await captureCompositeSource(f.bytes),b=await captureCompositeSource(changed);expect(a.pages[0].inventoryHash).not.toBe(b.pages[0].inventoryHash);}else await expect(captureCompositeSource(changed)).rejects.toBeDefined();
});
it('keeps sheared original spans read-only under the versioned Form proof',async()=>{
 const f=await fixture(),bytes=await change(f,f.raw.replace('1 0 0 1 40 240 Tm','1 0 .25 1 40 240 Tm'),f.cmap.replace(f.lig+' <0000>',f.lig+' <FB03>').replace('1 beginbfchar '+f.lig+' <006600660069> endbfchar','')),p=makeProject(await importResume(new File([new Uint8Array(bytes).buffer],'authored-form-shear.pdf',{type:'application/pdf'})),true);
 expect(p.template.pages[0].regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===4)).toBe(true);const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id)),render=await renderProjectDocument(approved,'current');expect(render.layout.overflows).toEqual([]);const sheared=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===4)!;expect(sourceWordingTargets(approved).some(r=>r.id===sheared.id)).toBe(false);
 const altered=structuredClone(approved),r=altered.template.pages[0].regions.find(r=>r.id===sheared.id)!;if(r.kind==='text'&&r.sourceLayout?.version===4)r.sourceLayout.shearX=.3;await expect(renderProjectDocument(altered,'current')).rejects.toBeDefined();
});

it.each(['drop','duplicate','group-end','matrix','bbox','child-alpha','restore'])('rejects decoded invocation %s mismatch',mode=>{
 const expected={fnArray:[76,74,10,12,9,91,11,75,77],argsArray:[[{bbox:[0,0,30,30],isolated:true}],[[1,0,0,1,5,7],null],null,[2,0,0,2,0,0],[[['ca',1]]],[22,[[0,0,0,1,80,0,1,80,80,1,0,80,4]]],null,[],[{bbox:[0,0,30,30],isolated:true}]]};const actual=structuredClone(expected);
 if(mode==='drop'){actual.fnArray.splice(5,1);actual.argsArray.splice(5,1);}else if(mode==='duplicate'){actual.fnArray.splice(5,0,91);actual.argsArray.splice(5,0,actual.argsArray[5]);}else if(mode==='group-end')actual.fnArray[8]=75;else if(mode==='matrix')actual.argsArray[1]=[[1,0,0,1,6,7],null];else if(mode==='bbox')actual.argsArray[0]=[{bbox:[0,0,31,30],isolated:true}];else if(mode==='child-alpha')actual.argsArray[4]=[[['ca',.3]]];else actual.fnArray[6]=10;
 expect(()=>assertNativeFormInvocation(actual,expected,0)).toThrow();expect(assertNativeFormInvocation(expected,expected,0)).toBe(8);
});
it('does not grant fractional alpha to unrelated page paint',async()=>{const f=await fixture();await expect(captureCompositeSource(await change(f,f.raw.replace('/Native Do Q','/Native Do 0 0 5 5 re f Q')))).rejects.toThrow('fractional alpha');});

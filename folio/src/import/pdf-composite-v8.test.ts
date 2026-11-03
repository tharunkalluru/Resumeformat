import 'fake-indexeddb/auto';
import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,PDFName,PDFDict,PDFRawStream,PDFString} from 'pdf-lib';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {fictionalScopedPdf} from './pdf-scoped.fixture';
import {captureCompositeSource,renderCompositeBaseline} from './pdf-composite-program';
import {importCompositePdf} from './pdf-composite';
import {makeProject} from '../core/model';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceWordingTargets,sourceWordingPreviewReady,sourceWordingBlock} from '../core/source-wording';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
let program:Uint8Array,release:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(){
 const f=await fictionalScopedPdf(program,{gap:20,second:true,after:'BT /F1 12 Tf 0.2 Tc 1 0 0 1 40 560 Tm <616263> Tj 0 Tc 0 1 -1 0 200 300 Tm <616263> Tj ET'}),d=await PDFDocument.load(f.bytes),p=d.getPages()[0],c=d.context;
 p.node.set(PDFName.of('Group'),c.obj({Type:'Group',S:'Transparency',CS:'DeviceRGB'}));
 const mask=c.register(c.flateStream(new Uint8Array([0,85,170,255]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:'DeviceGray',Matte:[0,0,0],Interpolate:false}));
 const rgb=new Uint8Array([255,0,0,0,255,0,0,0,255,255,255,255]),masked=c.register(c.flateStream(rgb,{Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:'DeviceRGB',SMask:mask,Interpolate:false})),plain=c.register(c.flateStream(rgb,{Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:'DeviceRGB'}));
 p.node.Resources()!.set(PDFName.of('XObject'),c.obj({Masked:masked,Plain:plain}));p.node.Resources()!.set(PDFName.of('ExtGState'),c.obj({Alpha:{Type:'ExtGState',BM:'Normal',ca:.4}}));
 p.node.set(PDFName.of('Contents'),c.register(c.flateStream(f.content+' q /Alpha gs 1 0 0 rg 30 30 15 15 re f Q q 20 0 0 20 100 100 cm /Masked Do Q q 20 0 0 20 130 100 cm /Plain Do Q')));
 p.node.addAnnot(c.register(c.obj({Subtype:'Link',Rect:[300,300,350,315],BS:{W:0},F:4,A:{S:'URI',URI:PDFString.of('https://example.com/fictional')}})));
 return new Uint8Array(await d.save());
}
const project=async(bytes:Uint8Array)=>makeProject(await importCompositePdf(new File([new Uint8Array(bytes).buffer],'fictional.pdf',{type:'application/pdf'}),bytes),true);
it('retains mixed image, matte, alpha, page group and TJ owners; supports horizontal wording and portable restore',async()=>{
 const bytes=await fixture(),c=await captureCompositeSource(bytes),p=await project(bytes);expect(c.version).toBe('original-native-composite-v8');expect(p.template.importerVersion).toBe('folio-import-v29');expect(c.pages[0].pageGroup).toEqual({Type:'Group',S:'Transparency',CS:'DeviceRGB'});expect(c.pages[0].images.map(i=>!!i.nativeFlate?.mask)).toEqual([true,false]);expect(c.pages[0].images[0].nativeFlate?.mask?.matte).toEqual([0,0,0]);expect([...c.pages[0].shows.values()].some(s=>s.parts?.includes('-20'))).toBe(true);
 const baseline=await renderProjectDocument(p,'baselinePreview');expect(baseline.bytes).toEqual(await renderCompositeBaseline(c));
 const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id)),preview=await renderProjectDocument(approved,'current'),targets=sourceWordingTargets(approved).filter(r=>sourceWordingPreviewReady(approved,preview,r.id));expect(targets.length).toBeGreaterThan(0);expect(targets.every(r=>r.sourceLayout?.version===1)).toBe(true);expect(p.template.pages[0].regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===3&&r.sourceLayout.editPolicy==='baselineOnly')).toBe(true);
 const r=targets[0],edited=editBlock(approved,r.contentId,sourceWordingBlock(approved,r.id,'a').runs),current=await renderProjectDocument(edited,'current');await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'fictional.zip'));expect(restored.approval).toBe(null);expect((await renderProjectDocument(await approveTemplate(restored,restored.template.warnings.map(w=>w.id)),'current')).bytes).toEqual(current.bytes);
 const rotation=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===6)!;expect(targets.some(r=>r.id===rotation.id)).toBe(false);
});
it.each(['matte','maskSize','interpolate','group','border'] as const)('rejects unsupported %s resource mutations',async mode=>{
 const d=await PDFDocument.load(await fixture()),p=d.getPages()[0],c=d.context;
 if(mode==='group')p.node.lookup(PDFName.of('Group'),PDFDict).set(PDFName.of('K'),c.obj(true));
 else if(mode==='border')p.node.Annots()!.lookup(0,PDFDict).lookup(PDFName.of('BS'),PDFDict).set(PDFName.of('W'),c.obj(1));
 else {const image=c.lookup(p.node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).get(PDFName.of('Masked'))!) as PDFRawStream,mask=c.lookup(image.dict.get(PDFName.of('SMask'))!) as PDFRawStream;mask.dict.set(PDFName.of(mode==='matte'?'Matte':mode==='maskSize'?'Width':'Interpolate'),mode==='matte'?c.obj([0,0]):mode==='maskSize'?c.obj(3):c.obj(true));}
 await expect(captureCompositeSource(new Uint8Array(await d.save()))).rejects.toBeDefined();
});
it('binds caller-owned capture mutations privately',async()=>{const c=await captureCompositeSource(await fixture()),before=await renderCompositeBaseline(c);(c.pages[0].images[0].nativeFlate!.mask!.matte as unknown as number[])[0]=1;(c.pages[0].pageGroup as any).K=true;expect(await renderCompositeBaseline(c)).toEqual(before);});

it.each(['rotation','spacing','downgrade','inventory','marks'] as const)('refuses saved %s tampering',async mode=>{const p=await project(await fixture()),r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===6)!;if(r.kind!=='text'||r.sourceLayout?.version!==6)throw Error('fixture');if(mode==='rotation')r.sourceLayout.rotation[1]*=-1;else if(mode==='spacing')r.sourceLayout.characterSpacing=1;else if(mode==='downgrade'){p.template.importerVersion='folio-import-v25';p.template.sourceCompositePages!.version='original-native-composite-v7';}else if(mode==='inventory')p.template.sourceCompositePages!.pages[0].inventoryHash='a'.repeat(64);else p.baseline.blocks.find(b=>b.id===r.contentId)!.runs[0].underline=true;await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();await expect(saveProject(p)).rejects.toBeDefined();});

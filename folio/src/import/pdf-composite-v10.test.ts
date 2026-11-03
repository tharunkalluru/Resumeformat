import 'fake-indexeddb/auto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,PDFName,PDFDict,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D,createCanvas} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {authoredSymbolicSource} from './document-scoped-test-fixture';
import {importPdf} from './pdf';
import {captureCompositeSource,renderCompositeBaseline,originalCompositeLine} from './pdf-composite-program';
import {makeProject,documentScopedProgramHashes} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {validateProject} from '../core/schema';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
let release:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(change=(s:string)=>s){
 const f=await authoredSymbolicSource({missingPost:true}),d=await PDFDocument.load(f.bytes),p=d.getPages()[0],c=d.context;
 p.setSize(595.25,841.875);
 const canvas=createCanvas(2,2),ctx=canvas.getContext('2d');ctx.fillStyle='#ad6719';ctx.fillRect(0,0,2,2);
 const jpeg=canvas.toBuffer('image/jpeg'),image=c.register(c.stream(jpeg,{Type:'XObject',Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:'DeviceRGB',Filter:'DCTDecode',Interpolate:true,Intent:'Perceptual'}));
 p.node.Resources()!.set(PDFName.of('XObject'),c.obj({Photo:image}));
 const raw=new TextDecoder().decode(decodePDFRawStream(p.node.Contents() as PDFRawStream).decode());
 p.node.set(PDFName.of('Contents'),c.register(c.flateStream(change('q -2000000 -2000000 4000000 4000000 re W n '+raw+' BT /F1 12 Tf 1 0 0 1 40 500 Tm 0 Tc <41> Tj .001 Tc <2142ca> Tj ET q 400 700 m 450 700 l 450 650 l 400 650 l h W n /Perceptual ri 50 0 0 50 400 650 cm /Photo Do Q Q'))));
 return new Uint8Array(await d.save());
}
const approve=(p:ReturnType<typeof makeProject>)=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});
it('retains document fonts, fractional page cover and clipped JPEG through edit and portable restore',async()=>{
 const bytes=await fixture(),p=makeProject(await importPdf(new File([bytes],'authored.pdf'),bytes),false);expect(p.template.importerVersion).toBe('folio-import-v31');validateProject(p);
 const c=await captureCompositeSource(bytes),baseline=await renderProjectDocument(p,'baselinePreview');expect(c.pages[0].pageCovers?.size).toBe(1);expect(c.pages[0].images[0].intent).toBe('Perceptual');expect(c.pages[0].images[0].interpolate).toBe(true);
 const out=await PDFDocument.load(baseline.bytes),objects=out.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'),PDFDict),image=objects.lookup(objects.keys()[0]);if(!(image instanceof PDFRawStream))throw Error('image fixture');expect(image.contents).toEqual(c.pages[0].images[0].bytes);expect(image.dict.lookup(PDFName.of('Intent'),PDFName).decodeText()).toBe('Perceptual');
 expect(p.template.pages[0].regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===3)).toBe(true);
 const a=await approve(p),b=a.draft.blocks.find(b=>b.runs[0].text==='A BC')!;expect(b).toBeDefined();const edited=editBlock(a,b.id,[{...b.runs[0],text:'A'}]);const current=await renderProjectDocument(edited,'current');await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'authored.zip'));expect(restored.approval).toBeNull();expect((await renderProjectDocument(await approve(restored),'current')).bytes).toEqual(current.bytes);
});
it.each(['paint','intent','partial','translated'] as const)('refuses unproved %s oversized clip or rendering state',async mode=>{const bytes=await fixture(s=>mode==='paint'?s.replace('re W n','re f'):mode==='intent'?s.replace('/Perceptual ri','/Unknown ri'):mode==='partial'?s.replace('-2000000 -2000000','10 -2000000'):'1 0 0 1 10 0 cm '+s);await expect(captureCompositeSource(bytes)).rejects.toBeDefined();});
it('binds private page-cover capture and refuses saved spacing tampering',async()=>{const bytes=await fixture(),c=await captureCompositeSource(bytes),before=await renderCompositeBaseline(c);(c.pages[0].pageCovers as Map<number,number[]>).set(1,[1,2,3,4]);expect(await renderCompositeBaseline(c)).toEqual(before);const p=makeProject(await importPdf(new File([bytes],'authored.pdf'),bytes),false),r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===3)!;if(r.kind!=='text'||r.sourceLayout?.version!==3)throw Error('fixture');r.sourceLayout.characterSpacing=.5;await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();await expect(saveProject(p)).rejects.toBeDefined();});

it('keeps per-show spacing in a homogeneous read-only definition and rejects collapsing it to fixed spacing',async()=>{const c=await captureCompositeSource(await fixture()),page=c.pages[0],parts=page.associated.filter(p=>p.glyphs[0].baseline===841.875-500),glyphs=parts.flatMap(p=>p.glyphs),part={...parts[0],glyphs},font=c.sourceFonts.find(f=>f.id===glyphs[0].fontId)!;expect(new Set(glyphs.map(g=>g.characterSpacing??0)).size).toBe(2);expect(()=>originalCompositeLine(part,font,false,false,true)).toThrow();const line=originalCompositeLine(part,font,false,false,true,true);expect(line.showSpacing?.map(p=>p[1])).toEqual([0,.001]);expect(line.text).toBe('A BC');});

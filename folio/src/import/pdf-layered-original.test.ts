import 'fake-indexeddb/auto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,PDFName,PDFDict,PDFString,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {GlobalWorkerOptions,getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {fictionalScopedPdf} from './pdf-scoped.fixture';
import {tiny,num} from './fixtures/authored-cff-builder.js';
import {captureLayeredOriginal,installLayeredOriginalResources} from './pdf-layered-original';
import {importOriginalType1Pdf} from './pdf-type1-baseline';
import {makeProject,documentScopedProgramHashes} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
let program:Uint8Array,release:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(fsType=8){
 const f=await fictionalScopedPdf(program),d=await PDFDocument.load(f.bytes),p=d.getPages()[0],c=d.context,r=p.node.Resources()!;
 const layer=c.register(c.obj({Type:'OCG',Name:PDFString.of('Fictional artwork')}));d.catalog.set(PDFName.of('OCProperties'),c.obj({OCGs:[layer],D:{ON:[layer],Order:[layer],RBGroups:[]}}));r.set(PDFName.of('Properties'),c.obj({Layer:layer}));
 const bytes=tiny({charset:[0,0,34,0,35],extraStrings:[Array.from(new TextEncoder().encode('/FSType '+fsType+' def'))],extraTop:[...num(393),12,21]});
 const descriptor=c.register(c.obj({Type:'FontDescriptor',FontName:'Fiction',Flags:32,FontBBox:[0,0,500,700],ItalicAngle:0,Ascent:700,Descent:0,CapHeight:700,StemV:80,FontFile3:c.register(c.flateStream(bytes,{Subtype:'Type1C'}))}));r.lookup(PDFName.of('Font'),PDFDict).set(PDFName.of('Cff'),c.register(c.obj({Type:'Font',Subtype:'Type1',BaseFont:'Fiction',Encoding:'WinAnsiEncoding',FontDescriptor:descriptor,FirstChar:65,LastChar:66,Widths:[500,500]})));
 const palette=c.register(c.flateStream(new Uint8Array([255,0,0,0,255,0]))),img=c.register(c.flateStream(new Uint8Array([0,1,1,0]),{Type:'XObject',Subtype:'Image',Width:2,Height:2,BitsPerComponent:8,ColorSpace:['Indexed','DeviceRGB',1,palette],Intent:'RelativeColorimetric'}));
 const gs=c.register(c.obj({Type:'ExtGState',CA:.5,ca:.5,BM:'Normal',SMask:'None',AIS:false,OP:false,op:false,OPM:1,SA:true})),form=c.register(c.flateStream('0 0 1 rg 0 0 20 10 re f',{Type:'XObject',Subtype:'Form',BBox:[0,10,20,0],Matrix:[1,0,0,1,0,0],Resources:{},Group:{Type:'Group',S:'Transparency',I:false,K:false}}));
 r.set(PDFName.of('XObject'),c.obj({Image:img,Form:form}));r.set(PDFName.of('ExtGState'),c.obj({Half:gs}));p.node.set(PDFName.of('Group'),c.obj({S:'Transparency',CS:'DeviceRGB',I:false,K:false}));p.node.set(PDFName.of('Contents'),c.register(c.flateStream('/OC /Layer BDC '+f.content+' BT /Cff 12 Tf 1 0 0 1 40 590 Tm [(AB) -300 (AB)] TJ ET q 20 0 0 20 200 200 cm /Image Do Q q /Half gs /Form Do Q EMC')));return new Uint8Array(await d.save());
}
const approve=(p:ReturnType<typeof makeProject>)=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});
it('keeps mixed original resources and grants only permitted isolated CFF line edits through save/restore',async()=>{
 const bytes=await fixture(),imported=await importOriginalType1Pdf(new File([bytes],'fictional.pdf'),bytes);expect(imported).toBeDefined();const p=makeProject(imported!,false);expect(p.template.sourceType1Baseline?.version).toBe('original-type1-baseline-v8');expect(p.template.sourceType1Baseline?.editableSlots).toHaveLength(1);expect(p.template.sourceType1Baseline?.editableSlots?.[0].baselineText).toBe('AB AB');
 const baseline=await renderProjectDocument(p,'baselinePreview'),approved=await approve(p),slot=p.template.sourceType1Baseline!.editableSlots![0],region=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLocator===slot.sourceLocator)!;if(region.kind!=='text')throw Error('fixture');const block=approved.draft.blocks.find(b=>b.id===region.contentId)!,edited=editBlock(approved,block.id,[{...block.runs[0],text:'AB'}]);const current=await renderProjectDocument(edited,'current');expect(current.layout.overflows).toHaveLength(0);
 const tooLong=editBlock(approved,block.id,[{...block.runs[0],text:'AB AB AB AB AB AB'}]);expect((await renderProjectDocument(tooLong,'current')).layout.overflows.length).toBeGreaterThan(0);
 await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'fictional.zip'));expect(restored.approval).not.toBeNull();expect((await renderProjectDocument(restored,'current')).layout.overflows).toHaveLength(0);
 for(const b of [baseline.bytes,current.bytes]){const d=await PDFDocument.load(b),r=d.getPages()[0].node.Resources()!,layers=d.catalog.lookup(PDFName.of('OCProperties'),PDFDict).lookup(PDFName.of('OCGs'));expect(r.lookup(PDFName.of('Properties'),PDFDict).get(PDFName.of('Layer'))?.toString()).toBe((layers as any).get(0).toString());expect(r.lookup(PDFName.of('XObject'),PDFDict).keys()).toHaveLength(2);}
});
it('keeps preview-only CFF programs read-only',async()=>{const bytes=await fixture(4),p=await importOriginalType1Pdf(new File([bytes],'fictional.pdf'),bytes);expect(p?.template.sourceType1Baseline?.editableSlots).toBeUndefined();});
it.each(['action','palette','samples','formText','knockout','textMode','unownedLayer','descriptorGraph','fontProgram','layerDowngrade','translucentText','programLengthGraph','programSubtypeGraph','previewOnlyTrueType'])('refuses unsupported %s without widening earlier capabilities',async mode=>{
 const d=await PDFDocument.load(await fixture()),p=d.getPages()[0],r=p.node.Resources()!,c=d.context,x=r.lookup(PDFName.of('XObject'),PDFDict),font=r.lookup(PDFName.of('Font'),PDFDict).lookup(PDFName.of('F1'),PDFDict);
 if(mode==='translucentText')p.node.set(PDFName.of('Contents'),c.register(c.flateStream('/OC /Layer BDC /Half gs BT /F1 12 Tf (abc) Tj ET EMC')));
 if(mode==='programLengthGraph'||mode==='programSubtypeGraph')(font.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2')) as PDFRawStream).dict.set(PDFName.of(mode==='programLengthGraph'?'Length1':'Subtype'),c.obj({S:'JavaScript',JS:PDFString.of('bad')}));
 if(mode==='previewOnlyTrueType'){const restricted=new Uint8Array(program),view=new DataView(restricted.buffer);let found=false;for(let i=0;i<view.getUint16(4);i++){const p=12+i*16;if(String.fromCharCode(...restricted.subarray(p,p+4))==='OS/2'){view.setUint16(view.getUint32(p+8)+8,4);found=true;}}if(!found)throw Error('fixture OS/2');font.lookup(PDFName.of('FontDescriptor'),PDFDict).set(PDFName.of('FontFile2'),c.register(c.flateStream(restricted)));}
 if(mode==='action')d.catalog.set(PDFName.of('OpenAction'),c.obj({S:'JavaScript',JS:PDFString.of('x')}));
 if(mode==='palette')(x.lookup(PDFName.of('Image')) as PDFRawStream).dict.set(PDFName.of('ColorSpace'),c.obj(['Indexed','DeviceRGB',2,c.register(c.flateStream(new Uint8Array([0,1,2])))]));
 if(mode==='samples'){const ref=x.get(PDFName.of('Image'))!;const old=c.lookup(ref) as PDFRawStream;c.assign(ref as any,PDFRawStream.of(old.dict,new Uint8Array([1,2,3])));}
 if(mode==='formText'){const old=x.lookup(PDFName.of('Form')) as PDFRawStream;c.assign(x.get(PDFName.of('Form')) as any,c.flateStream('BT /F1 12 Tf (bad) Tj ET',Object.fromEntries(old.dict.entries().filter(([k])=>!['Filter','Length'].includes(k.decodeText())).map(([k,v])=>[k.decodeText(),v]))));}
 if(mode==='knockout')p.node.lookup(PDFName.of('Group'),PDFDict).set(PDFName.of('K'),c.obj(true));
 if(mode==='textMode')p.node.set(PDFName.of('Contents'),c.register(c.flateStream('/OC /Layer BDC BT /F1 12 Tf 3 Tr (hidden) Tj ET EMC')));
 if(mode==='unownedLayer')r.lookup(PDFName.of('Properties'),PDFDict).set(PDFName.of('Layer'),c.register(c.obj({Type:'OCG',Name:PDFString.of('foreign')})));
 if(mode==='descriptorGraph')font.lookup(PDFName.of('FontDescriptor'),PDFDict).set(PDFName.of('FontFamily'),c.obj({S:'JavaScript',JS:PDFString.of('bad')}));
 if(mode==='fontProgram')font.lookup(PDFName.of('FontDescriptor'),PDFDict).set(PDFName.of('FontFile2'),c.register(c.flateStream(new Uint8Array([1,2,3,4]))));
 if(mode==='layerDowngrade')d.catalog.lookup(PDFName.of('OCProperties'),PDFDict).lookup(PDFName.of('D'),PDFDict).set(PDFName.of('BaseState'),PDFName.of('OFF'));
 await expect(captureLayeredOriginal(new Uint8Array(await d.save()))).rejects.toBeDefined();
});
it('uses a private source snapshot for resource installation and refuses cloned handles',async()=>{const captured=(await captureLayeredOriginal(await fixture()))!,out=await PDFDocument.create();captured.pages[0].resources.set(PDFName.of('Bad'),out.context.obj({S:'JavaScript'}));const resources=await installLayeredOriginalResources(captured,out);expect(resources[0].has(PDFName.of('Bad'))).toBe(false);await expect(installLayeredOriginalResources({...captured},await PDFDocument.create())).rejects.toBeDefined();});

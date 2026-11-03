import JSZip from 'jszip';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deepStrictEqual} from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream} from 'pdf-lib';
import {authoredRgbProfile,authoredScopedColorSource} from './scoped-color-test-fixture';
import {sourceIccProfile,validateRgbIccBytes} from './pdf-icc';
import {preflightPdfImages} from './pdf-image-preflight';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {traceScopedPaint} from './pdf-scoped-paint';
import {importResume} from './index';
import {makeProject,canonicalJson,sha256Sync} from '../core/model';
import {setFontLoader} from '../layout/fonts';
import {renderProjectDocument} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject,backupResumeGroup,restoreGroup,restoreBackup} from '../storage/projects';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {inspectZip,inflateBoundedArchive} from './zipCodec';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));const {GlobalWorkerOptions}=await import('pdfjs-dist/legacy/build/pdf.mjs');await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>restore?.());
const importAuthored=async(content?:string,icc=true,profile?:Uint8Array)=>{const source=await authoredScopedColorSource({content,icc,profile});return{source,project:makeProject(await importResume(new File([source.bytes],'authored-review.pdf',{type:'application/pdf'})))};};
const wire=(project:unknown)=>JSON.parse(JSON.stringify(project,(_key,value)=>value instanceof Uint8Array?undefined:value));
const trace=(text:string)=>traceScopedPaint(originalOperators(text),{viewport:[1,0,0,-1,0,100],pageBounds:{x:0,y:0,width:100,height:100}});

describe('R10 independent review closures',()=>{
 it.each(['DeviceRGB','DeviceGray','DeviceCMYK','Plain','Cal'])('does not classify ordinary %s selection as ICC with an image resource',async name=>{
  const source=await authoredScopedColorSource({icc:false}),pdf=await PDFDocument.load(source.bytes),page=pdf.getPages()[0],resources=page.node.Resources()!,spaces=resources.lookup(PDFName.of('ColorSpace'),PDFDict);
  spaces.set(PDFName.of('Plain'),PDFName.of('DeviceRGB'));spaces.set(PDFName.of('Cal'),pdf.context.obj([PDFName.of('CalRGB'),{WhitePoint:[1,1,1]}]));
  resources.set(PDFName.of('XObject'),pdf.context.obj({Pic:pdf.context.register(pdf.context.stream(new Uint8Array([0,0,0]),{Type:'XObject',Subtype:'Image',Width:1,Height:1,BitsPerComponent:8,ColorSpace:'DeviceRGB'}))}));
  page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(`/${name} cs /${name} CS q 1 0 0 1 40 40 cm /Pic Do Q`)));
  const bytes=new Uint8Array(await pdf.save());expect(await sourceIccProfile(bytes)).toBeUndefined();await expect(preflightPdfImages(bytes)).resolves.toBeUndefined();
 });
 it('preserves an empty page with an unselected unsupported ICC declaration',async()=>{
  const pdf=await PDFDocument.create(),page=pdf.addPage([500,700]);page.node.set(PDFName.of('Resources'),pdf.context.obj({ColorSpace:{Unused:[PDFName.of('ICCBased'),pdf.context.register(pdf.context.stream(new Uint8Array(65537),{N:4}))]}}));const bytes=new Uint8Array(await pdf.save());expect(await sourceIccProfile(bytes)).toBeUndefined();await expect(preflightPdfImages(bytes)).resolves.toBeUndefined();
 });
 it('keeps an ordinary image resource and built-in selection ownerless without a ColorSpace dictionary',async()=>{
  const source=await authoredScopedColorSource({icc:false}),pdf=await PDFDocument.load(source.bytes),page=pdf.getPages()[0],resources=page.node.Resources()!;resources.delete(PDFName.of('ColorSpace'));resources.set(PDFName.of('XObject'),pdf.context.obj({Pic:pdf.context.register(pdf.context.stream(new Uint8Array([0,0,0]),{Type:'XObject',Subtype:'Image',Width:1,Height:1,BitsPerComponent:8,ColorSpace:'DeviceRGB'}))}));page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream('/DeviceRGB cs /DeviceGray CS q /Pic Do Q')));const bytes=new Uint8Array(await pdf.save());expect(await sourceIccProfile(bytes)).toBeUndefined();await expect(preflightPdfImages(bytes)).resolves.toBeUndefined();
 });
 it.each(['N','unsupportedProgram','encodedOversize','expandedOversize','badFilter'])('does not decode an unselected ICC declaration: %s',async change=>{
  const source=await authoredScopedColorSource({icc:false}),pdf=await PDFDocument.load(source.bytes),page=pdf.getPages()[0],spaces=page.node.Resources()!.lookup(PDFName.of('ColorSpace'),PDFDict),array=spaces.lookup(PDFName.of('OwnedRGB'),PDFArray),stream=pdf.context.lookup(array.get(1)) as PDFRawStream;
  if(change==='N')stream.dict.set(PDFName.of('N'),pdf.context.obj(4));else if(change==='badFilter')stream.dict.set(PDFName.of('Filter'),PDFName.of('Unsupported'));else{const bytes=new Uint8Array(change==='unsupportedProgram'?132:change==='encodedOversize'?65537:8*1024*1024),replacement=change==='encodedOversize'?pdf.context.stream(bytes,{N:3}):pdf.context.flateStream(bytes,{N:3});spaces.set(PDFName.of('OwnedRGB'),pdf.context.obj([PDFName.of('ICCBased'),pdf.context.register(replacement)]));}
  const bytes=new Uint8Array(await pdf.save());expect(await sourceIccProfile(bytes)).toBeUndefined();await expect(preflightPdfImages(bytes)).resolves.toBeUndefined();
  if(change==='N'){const project=makeProject(await importResume(new File([bytes],'unused-unsupported-profile.pdf',{type:'application/pdf'})));expect(project.template.sourceColorProfile).toBeUndefined();expect((await renderProjectDocument(project,'baselinePreview')).bytes.length).toBeGreaterThan(0);}
  // Selection still triggers the exact bounded profile guard before any paint.
  page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream('/OwnedRGB cs')));const selected=new Uint8Array(await pdf.save());await expect(sourceIccProfile(selected)).rejects.toHaveProperty('code');await expect(preflightPdfImages(selected)).rejects.toHaveProperty('code');
 });
 it('does not read a color-space name embedded in a literal string as selection',async()=>{const source=await authoredScopedColorSource({content:'BT /F1 12 Tf (/OwnedRGB cs) Tj ET'});expect(await sourceIccProfile(source.bytes)).toBeUndefined();await expect(preflightPdfImages(source.bytes)).resolves.toBeUndefined();});
 it('retains default-space and resource-count refusal without selecting an ICC owner',async()=>{
  for(const change of ['default','count']){const source=await authoredScopedColorSource({icc:false}),pdf=await PDFDocument.load(source.bytes),spaces=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'),PDFDict);if(change==='default')spaces.set(PDFName.of('DefaultRGB'),PDFName.of('DeviceRGB'));else for(let i=0;i<32;i++)spaces.set(PDFName.of(`Unused${i}`),PDFName.of('DeviceRGB'));const bytes=new Uint8Array(await pdf.save());await expect(sourceIccProfile(bytes)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(preflightPdfImages(bytes)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});}
 });
 it.each(['mixedICC','deviceRectangle'])('roundtrips and renders genuine mixed scoped versions: %s',async mode=>{
  const content=mode==='mixedICC'?'q /OwnedRGB cs .3 .5 .7 sc BT /F1 12 Tf 1 0 0 1 40 648 Tm <41> Tj ET .1 .2 .3 rg BT /F1 12 Tf 1 0 0 1 40 620 Tm <42> Tj ET Q':undefined;
  const {project}=await importAuthored(content,mode==='mixedICC');const paints=project.template.pages[0].regions.map(r=>'sourceScopedPaint'in r?r.sourceScopedPaint:undefined);expect(paints.some(p=>p?.version==='source-scoped-occurrence-v1')).toBe(true);expect(paints.some(p=>p?.version==='source-scoped-occurrence-v2')).toBe(true);
  const metadata=wire(project),packed=packRecordMetadata(packScopedMetadata(metadata));expect(canonicalJson(unpackScopedMetadata(unpackRecordMetadata(packed)))).toBe(canonicalJson(metadata));
  const rendered=await renderProjectDocument(project,'baselinePreview');expect(rendered.bytes.length).toBeGreaterThan(0);expect(rendered.layout.overflows).toHaveLength(0);await saveProject(project);deepStrictEqual((await loadProjects()).find(p=>p.id===project.id)!.template,project.template);
  const single=await restoreProject(new File([await backupProject(project)],'authored.folio')),group=await restoreGroup(new File([await backupResumeGroup([project])],'authored-group.folio'));deepStrictEqual(single.template,project.template);deepStrictEqual(group[0].template,project.template);
  expect((await renderProjectDocument(single,'baselinePreview')).bytes.length).toBeGreaterThan(0);expect((await renderProjectDocument(group[0],'baselinePreview')).bytes.length).toBeGreaterThan(0);
 });
 it('still refuses mixed full/tuple v1 beside valid full v2',async()=>{
  const {project}=await importAuthored('q /OwnedRGB cs .3 .5 .7 sc BT /F1 12 Tf 1 0 0 1 40 648 Tm <41> Tj ET .1 .2 .3 rg BT /F1 12 Tf 1 0 0 1 40 620 Tm <42> Tj ET Q'),metadata=wire(project),packed=packScopedMetadata(metadata) as typeof metadata;
  const original=metadata.template.pages[0].regions.find((r:any)=>r.sourceScopedPaint?.version==='source-scoped-occurrence-v1');packed.template.pages[0].regions.push(structuredClone(original));expect(()=>packRecordMetadata(packed)).toThrowError(expect.objectContaining({code:'PROJECT_RECORD_TRANSPORT'}));expect(()=>unpackScopedMetadata(packed)).toThrowError(expect.objectContaining({code:'SOURCE_SCOPED_TRANSPORT'}));
 });
 it.each(['0 0 m 10 0 l 10 10 l 10 0 l h f','0 0 m 10 0 l 10 .5 l 10 0 l h f','0 0 m 0 0 m 10 0 l 10 10 l 0 10 l h f','0 0 m 10 0 l 10 10 l 0 10 l h h f','0 0 m 10 0 l 10 10 l 0 10 l 0 0 l h f'])('refuses incomplete or repeated closed-path construction: %s',text=>expect(()=>trace(text)).toThrowError(expect.objectContaining({code:'PDF_SCOPED_PAINT'})));
 it.each(['0 0 m 10 0 l 10 10 l 0 10 l h f','0 10 m 10 10 l 10 0 l 0 0 l h f*'])('binds exactly four distinct corners and all five construction operators: %s',text=>{const p=trace(text).occurrences[0];expect(p.kind).toBe('fillRect');expect(p.rectanglePath?.operatorIndices).toEqual([0,1,2,3,4]);expect(new Set(p.rectanglePath?.points.map(p=>JSON.stringify(p))).size).toBe(4);expect('bounds'in p&&p.bounds).toEqual({x:0,y:90,width:10,height:10});});
 it('keeps the legacy identical empty move for a two-point rule',()=>expect(trace('0 0 m 0 0 m 10 0 l S').occurrences[0]).toMatchObject({kind:'strokeRule',pathOperatorIndex:0}));
 it('reports a truncated final para tag as ICC proof refusal before reading its kind',()=>{const profile=authoredRgbProfile(),view=new DataView(profile.buffer),count=view.getUint32(128);let entry=-1;for(let i=0;i<count;i++)if(String.fromCharCode(...profile.slice(132+i*12,136+i*12))==='bTRC')entry=132+i*12;expect(entry).toBeGreaterThan(0);const start=profile.length;const changed=new Uint8Array(profile.length+8);changed.set(profile);changed.set(new TextEncoder().encode('para'),start);const v=new DataView(changed.buffer);v.setUint32(0,changed.length);v.setUint32(entry+4,start);v.setUint32(entry+8,8);expect(()=>validateRgbIccBytes(changed)).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));});
 it.each(['single','group'])('rejects coherent oversized %s ICC attachment before ZIP loading or expansion',async mode=>{
  const {project}=await importAuthored(),backup=mode==='single'?await backupProject(project):await backupResumeGroup([project]),zip=await JSZip.loadAsync(await backup.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),path=mode==='single'?'colors/0.icc':'projects/0/colors/0.icc',payload=new Uint8Array(65537);payload.set(authoredRgbProfile());new DataView(payload.buffer).setUint32(0,payload.length);zip.file(path,payload);const entry=manifest.files.find((e:{path:string})=>e.path===path);entry.size=payload.length;entry.sha256=sha256Sync(payload);zip.file('manifest.json',JSON.stringify(manifest));const bytes=new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));
  const spy=vi.spyOn(JSZip,'loadAsync');try{expect(()=>inspectZip(bytes)).toThrowError(expect.objectContaining({code:'ARCHIVE_INVALID',message:'The portable color profile exceeds its 64 KiB decompression limit.'}));await expect(mode==='single'?restoreProject(new File([bytes],'oversized.folio')):restoreGroup(new File([bytes],'oversized-group.folio'))).rejects.toMatchObject({code:'ARCHIVE_INVALID'});await expect(restoreBackup(new File([bytes],'oversized.folio'))).rejects.toMatchObject({code:'ARCHIVE_INVALID'});expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
 it('accepts exact 64KiB profile paths without changing other archive path limits',async()=>{const zip=new JSZip(),bytes=new Uint8Array(65536);zip.file('colors/0.icc',bytes,{createFolders:false});zip.file('projects/0/colors/0.icc',bytes,{createFolders:false});zip.file('unrelated.icc',new Uint8Array(65537),{createFolders:false});const packed=new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));expect(inspectZip(packed)).toHaveLength(3);const unpacked=await inflateBoundedArchive(packed);expect(unpacked.get('colors/0.icc')?.length).toBe(65536);expect(unpacked.get('projects/0/colors/0.icc')?.length).toBe(65536);expect(unpacked.get('unrelated.icc')?.length).toBe(65537);});
 it('preserves a valid boundary-sized owned ICC in a full portable roundtrip',async()=>{const profile=new Uint8Array(65536);profile.set(authoredRgbProfile());new DataView(profile.buffer).setUint32(0,65536);const {project}=await importAuthored(undefined,true,profile);const restored=await restoreProject(new File([await backupProject(project)],'boundary.folio'));deepStrictEqual(restored.template.sourceColorProfile?.bytes,profile);});
});

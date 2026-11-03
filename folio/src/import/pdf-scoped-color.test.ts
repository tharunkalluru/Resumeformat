import JSZip from 'jszip';
import {createCanvas} from '@napi-rs/canvas';
import {renderPdfPage} from '../render/preview';
import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import fontkit from '@pdf-lib/fontkit';
import {captureSourceGlyphs,associateSourceItems} from './pdf-source';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {validateProject} from '../core/schema';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {deepStrictEqual} from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {authoredRgbProfile,authoredScopedColorSource} from './scoped-color-test-fixture';
import {sourceIccProfile,validateRgbIccBytes,validateSourceColorProfiles,decodeBoundedIccStream} from './pdf-icc';
import {originalScopedPaint,traceScopedPaint} from './pdf-scoped-paint';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {importResume} from './index';
import {makeProject,sha256Sync,canonicalJson,type TextRegion} from '../core/model';
import {setFontLoader} from '../layout/fonts';
import {renderProjectDocument,renderProjectHistory} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject,backupResumeGroup,restoreGroup} from '../storage/projects';
import {sourceSpacingAvailability} from '../ui/sourceSpacing';
import {sourceGlyphs} from '../core/source-graph';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));const {GlobalWorkerOptions}=await import('pdfjs-dist/legacy/build/pdf.mjs');await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>restore?.());
const imported=async()=>{const fixture=await authoredScopedColorSource();return{fixture,project:makeProject(await importResume(new File([fixture.bytes],'authored-color.pdf',{type:'application/pdf'})))};};
describe('owned ICC color and exact closed rectangle',()=>{
 it('captures actual profile/components/path and canonically embeds the complete original program',async()=>{
  const {fixture,project}=await imported();expect(project.template.sourceColorProfile?.sha256).toBe(sha256Sync(fixture.profile));expect(project.template.sourceScopedPages?.version).toBe('source-scoped-pages-v2');expect(project.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);
  const text=project.template.pages[0].regions.find(r=>r.kind==='text') as TextRegion,rectangle=project.template.pages[0].regions.find(r=>r.kind==='rectangle')!;expect(text.sourceScopedPaint?.color).toMatchObject({space:'ICCBased',components:[.3,.5,.7],componentOperator:'sc',profileRef:fixture.profileRef});expect(rectangle.sourceScopedPaint?.rectanglePath?.points).toEqual([[40,590],[180,590],[180,588],[40,588]]);
  expect(sourceSpacingAvailability(text,project.template.sourceFonts![0],Array.from(sourceGlyphs(text)))).toMatchObject({editable:false});
  await validateSourceColorProfiles(project.source.bytes,project.template);await validateSourceScopedPaint(project.source.bytes,project.template);
  const rendered=await renderProjectDocument(project,'baselinePreview'),pdf=await PDFDocument.load(rendered.bytes),spaces=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('ColorSpace'),PDFDict),array=spaces.lookup(PDFName.of('FolioICC'),PDFArray),stream=pdf.context.lookup(array.get(1)) as PDFRawStream;
  deepStrictEqual(new Uint8Array(decodePDFRawStream(stream).decode()),fixture.profile);expect(stream.dict.lookup(PDFName.of('Alternate'),PDFName).decodeText()).toBe('DeviceRGB');const ops=originalOperators(originalPageContent(pdf,1));expect(ops.filter(o=>o.word==='scn').map(o=>o.args)).toEqual([[.3,.5,.7],[.3,.5,.7]]);expect(ops.some(o=>o.word==='rg')).toBe(false);
  await expect(renderProjectDocument(project,'current')).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
 });
 it('preserves genuine same-face mixed-size paints and all unchanged extraction anchors',async()=>{
  const seed=await authoredScopedColorSource(),font=fontkit.create(seed.program),advance=font.getGlyph(seed.selectors.get(65)!.glyphId).advanceWidth*12/font.unitsPerEm,x=40+advance;
  const fixture=await authoredScopedColorSource({icc:false,content:`q 0 g BT /F1 1 Tf 12 0 0 12 40 648 Tm <41> Tj 10 0 0 10 ${x} 648 Tm <42> Tj ET Q`}),js=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=js.getDocument({...localPdfDecoderOptions(),data:new Uint8Array(fixture.bytes),fontExtraProperties:true,verbosity:0});
  try{const page=await(await task.promise).getPage(1),viewport=page.getViewport({scale:1}).transform,assets:import('../core/model').SourceFontAsset[]=[],graph=(await captureSourceGlyphs(page,viewport,sha256Sync(fixture.bytes),assets,fixture.bytes,1))!,items=(await page.getTextContent({disableNormalization:true})).items;expect(graph.map(g=>g.size)).toEqual([12,10]);expect(items.filter(i=>'str'in i&&i.str==='AB')).toHaveLength(1);const parts=associateSourceItems(items,graph,viewport,assets);deepStrictEqual(parts.flatMap(p=>p.glyphs),graph);expect(parts.map(p=>p.glyphs[0].size)).toEqual([12,10]);
   const visible=items.findIndex(i=>'str'in i&&i.str==='AB');for(const change of ['firstOrigin','firstSize','baseline','resource','font','unicode','order','drop','duplicate','endpoint','gid0','unowned']as const){const g=structuredClone(graph),a=structuredClone(assets),copy=structuredClone(items) as any[];
    if(change==='firstOrigin')g[0].x+=.0251;else if(change==='firstSize')g[0].size+=.0251;else if(change==='baseline')g[1].baseline+=.000001;else if(change==='resource')g[1].resource+='wrong';else if(change==='font')g[1].fontId+='wrong';else if(change==='unicode')g[1].unicode='C';else if(change==='order')g.reverse();else if(change==='drop')g.pop();else if(change==='duplicate')g.push({...g[1]});else if(change==='endpoint')copy[visible].width+=.0251;else if(change==='gid0')a[0].glyphMap.find(m=>m.cid===g[1].cid)!.originalGlyphId=0;else if(change==='unowned')delete(a[0] as any).originalProgram;
    expect(()=>associateSourceItems(copy,g,viewport,a),change).toThrow();
   }
  }finally{await task.destroy();}
  const project=makeProject(await importResume(new File([fixture.bytes],'authored-mixed.pdf',{type:'application/pdf'}))),render=await renderProjectDocument(project,'baselinePreview'),decodedTask=js.getDocument({...localPdfDecoderOptions(),data:new Uint8Array(render.bytes),verbosity:0});try{const text=(await(await(await decodedTask.promise).getPage(1)).getTextContent()).items.filter(i=>'str'in i);expect(text.map(i=>'str'in i?i.str:'').join('')).toBe('AB');}finally{await decodedTask.destroy();}
 });
 it('preserves full profile ownership in save/reload, single and group portable copies',async()=>{
  const {project}=await imported();await saveProject(project);const saved=(await loadProjects()).find(p=>p.id===project.id)!;deepStrictEqual(saved.template.sourceColorProfile,project.template.sourceColorProfile);
  const single=await restoreProject(new File([await backupProject(project)],'authored.folio')),group=await restoreGroup(new File([await backupResumeGroup([project])],'authored-group.folio'));deepStrictEqual(single.template.sourceColorProfile,project.template.sourceColorProfile);deepStrictEqual(group[0].template.sourceColorProfile,project.template.sourceColorProfile);
 });
 it('rejects coherent color/op/profile mutations through actual source recapture',async()=>{
  const {project}=await imported();for(const mutation of ['component','selection','profile','path','delete']as const){const changed=structuredClone(project),r=changed.template.pages[0].regions.find(r=>r.kind==='text') as TextRegion;
   if(mutation==='component')r.sourceScopedPaint!.color.components[0]=.4;
   if(mutation==='selection'&&r.sourceScopedPaint!.color.space==='ICCBased')r.sourceScopedPaint!.color.selectionOperatorIndex++;
   if(mutation==='profile'){changed.template.sourceColorProfile!.bytes[80]^=1;changed.template.sourceColorProfile!.sha256=sha256Sync(changed.template.sourceColorProfile!.bytes);for(const p of changed.template.pages)for(const region of p.regions)if('sourceScopedPaint'in region&&region.sourceScopedPaint?.color.space==='ICCBased')region.sourceScopedPaint.color.profileSha256=changed.template.sourceColorProfile!.sha256;}
   if(mutation==='path'){const rectangle=changed.template.pages[0].regions.find(r=>r.kind==='rectangle')!;rectangle.sourceScopedPaint!.rectanglePath!.points[0][0]++;}
   if(mutation==='delete'){delete changed.template.sourceColorProfile;delete changed.template.sourceScopedPages;delete changed.template.sourceImageContract;delete changed.template.sourceFonts;changed.template.importerVersion='folio-import-v11';for(const page of changed.template.pages)for(const r of page.regions){if('sourceScopedPaint'in r)delete r.sourceScopedPaint;if(r.kind==='text'){delete r.sourceLayout;delete r.style.sourceFontId;}}}
   else for(const p of changed.template.pages)for(const r of p.regions)if('sourceScopedPaint'in r&&r.sourceScopedPaint)r.sourceScopedPaint.stateHash=sourceScopedStateHash(r,changed.template.sourceFonts!);
   if(mutation==='delete'){validateProject(changed);await expect(renderProjectDocument(changed,'current')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(renderProjectHistory(changed,'unowned-history')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});changed.source.format='docx';await expect(renderProjectDocument(changed,'baselinePreview')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});}
   await expect(mutation==='delete'?renderProjectDocument(changed,'baselinePreview'):validateSourceScopedPaint(changed.source.bytes,changed.template)).rejects.toHaveProperty('code');
  }
 });
 it('rejects coherent portable profile mutations/deletion at source binding, including legacy Word labels',async()=>{
  const {project}=await imported(),backup=await backupProject(project);
  for(const change of ['profile','delete','word','missing','extra']as const){const zip=await JSZip.loadAsync(await backup.arrayBuffer()),manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),wire=JSON.parse(await zip.file('project.json')!.async('string')),decoded=unpackScopedMetadata(unpackRecordMetadata(wire)) as any;
   if(change==='profile'){const bytes=new Uint8Array(await zip.file('colors/0.icc')!.async('uint8array'));bytes[80]^=1;zip.file('colors/0.icc',bytes);decoded.template.sourceColorProfile.sha256=sha256Sync(bytes);for(const p of decoded.template.pages)for(const r of p.regions)if(r.sourceScopedPaint?.color.space==='ICCBased')r.sourceScopedPaint.color.profileSha256=sha256Sync(bytes);}
   else if(change==='missing')zip.remove('colors/0.icc');
   else if(change==='extra')zip.file('colors/1.icc',await zip.file('colors/0.icc')!.async('uint8array'));
   else{delete decoded.template.sourceColorProfile;delete decoded.template.sourceScopedPages;delete decoded.template.sourceImageContract;delete decoded.template.sourceFonts;decoded.template.importerVersion='folio-import-v11';for(const p of decoded.template.pages)for(const r of p.regions){delete r.sourceScopedPaint;if(r.kind==='text'){delete r.sourceLayout;delete r.style.sourceFontId;}}zip.remove('colors/0.icc');for(const name of Object.keys(zip.files))if(name.startsWith('fonts/'))zip.remove(name);if(change==='word'){decoded.source.format='docx';zip.file('source.docx',await zip.file('source.pdf')!.async('uint8array'));zip.remove('source.pdf');}}
   zip.file('project.json',JSON.stringify(packRecordMetadata(packScopedMetadata(decoded))));manifest.files=[];for(const [name,file]of Object.entries(zip.files)){if(file.dir||name==='manifest.json')continue;const bytes=await file.async('uint8array');manifest.files.push({path:name,size:bytes.length,sha256:sha256Sync(bytes)});}zip.file('manifest.json',JSON.stringify(manifest));const file=new File([new Uint8Array(await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}))],'authored-forged.folio');
   if(['profile','delete','word'].includes(change))await expect(restoreProject(file)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});else await expect(restoreProject(file)).rejects.toThrow();
  }
 });
 it('preserves source/output preview pixels while exposing Node ICC fallback as unqualified',async()=>{
  const {fixture,project}=await imported(),rendered=await renderProjectDocument(project,'baselinePreview'),plain=await authoredScopedColorSource({icc:false}),pixel=async(bytes:Uint8Array)=>{const canvas=createCanvas(1,1);Object.assign(canvas,{ownerDocument:{createElement:()=>createCanvas(1,1)}});await renderPdfPage(bytes,1,canvas as unknown as HTMLCanvasElement,2);return Array.from(canvas.getContext('2d').getImageData(120,221,1,1).data);};
  const original=await pixel(fixture.bytes),output=await pixel(rendered.bytes),alternate=await pixel(plain.bytes);expect(original).toEqual(output);// Pinned PDF.js disables qcms when Node useWorkerFetch is false. Equality
  // here documents the fallback, not ICC color fidelity. An independent authored
  // MuPDF oracle checks that this profile really differs from its Alternate.
  expect(original).toEqual(alternate);expect(original[3]).toBe(255);
  if(process.env.FOLIO_AUTHORED_ICC_OUTPUT){const dir=process.env.FOLIO_AUTHORED_ICC_OUTPUT;await mkdir(dir,{recursive:true,mode:0o700});for(const [name,bytes]of [['source.pdf',fixture.bytes],['output.pdf',rendered.bytes],['alternate.pdf',plain.bytes]]as const)await writeFile(resolve(dir,name),bytes,{mode:0o600,flag:'wx'});}

 });
 it.each(['N','Range','DecodeParms','intent','unknown','second','oversizedEncoded'])('refuses original resource contract mutation %s before decoder use',async change=>{
  const source=await authoredScopedColorSource(),pdf=await PDFDocument.load(source.bytes),resources=pdf.getPages()[0].node.Resources()!,spaces=resources.lookup(PDFName.of('ColorSpace'),PDFDict),array=spaces.lookup(PDFName.of('OwnedRGB'),PDFArray),stream=pdf.context.lookup(array.get(1)) as PDFRawStream;
  if(change==='N')stream.dict.set(PDFName.of('N'),pdf.context.obj(4));else if(change==='Range')stream.dict.set(PDFName.of('Range'),pdf.context.obj([0,1,0,1,0,1]));else if(change==='DecodeParms')stream.dict.set(PDFName.of('DecodeParms'),pdf.context.obj({}));else if(change==='unknown')stream.dict.set(PDFName.of('Metadata'),pdf.context.obj(1));else if(change==='second'){spaces.set(PDFName.of('Decoy'),pdf.context.obj([PDFName.of('ICCBased'),pdf.context.register(pdf.context.flateStream(source.profile,{N:3}))]));pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(originalPageContent(pdf,1)+' /Decoy cs')));}else if(change==='oversizedEncoded')spaces.set(PDFName.of('OwnedRGB'),pdf.context.obj([PDFName.of('ICCBased'),pdf.context.register(pdf.context.stream(new Uint8Array(65537),{N:3}))]));else pdf.getPages()[0].node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream('/AbsoluteColorimetric ri '+originalPageContent(pdf,1))));
  const bytes=new Uint8Array(await pdf.save());if(change==='intent')await expect(importResume(new File([bytes],'authored-intent.pdf',{type:'application/pdf'}))).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});else await expect(sourceIccProfile(bytes)).rejects.toThrow();
 });
 it.each(['sparse','extraArrayKey','undefinedOptional','unknownKey','oversizedClips','oversizedComponents'])('rejects malformed v2 transport before expansion: %s',async mutation=>{
  const {project}=await imported(),metadata=JSON.parse(JSON.stringify(project,(_key,value)=>value instanceof Uint8Array?undefined:value)),paint=metadata.template.pages[0].regions.find((r:{sourceScopedPaint?:unknown})=>r.sourceScopedPaint).sourceScopedPaint;
  if(mutation==='sparse')delete paint.color.components[1];else if(mutation==='extraArrayKey')paint.color.components.extra=1;else if(mutation==='undefinedOptional')paint.derivedGaps=undefined;else if(mutation==='unknownKey')paint.unowned=true;else if(mutation==='oversizedClips')paint.clipStack=Array(65).fill(paint.clipStack[0]);else paint.color.components=Array(65537).fill(0);
  expect(()=>packScopedMetadata(metadata)).toThrow();expect(()=>packRecordMetadata(metadata)).toThrow();expect(()=>unpackScopedMetadata(metadata)).toThrow();
 });
 it('keeps full v2 evidence inverse across both transport codecs',async()=>{const {project}=await imported(),metadata=JSON.parse(JSON.stringify(project,(_key,value)=>value instanceof Uint8Array?undefined:value)),wire=packRecordMetadata(packScopedMetadata(metadata)),decoded=unpackScopedMetadata(unpackRecordMetadata(wire));expect(canonicalJson(decoded)).toBe(canonicalJson(metadata));});
 it.each([0,8,16,20,36,128])('rejects malformed authored profile header/tag offset %i',offset=>{const p=authoredRgbProfile();p[offset]^=127;expect(()=>validateRgbIccBytes(p)).toThrow();});
 it('stops compressed expansion at the pinned allocation boundary',async()=>{
  const pdf=await PDFDocument.create(),stream=pdf.context.flateStream(new Uint8Array(8*1024*1024),{N:3});expect(stream.contents.length).toBeLessThan(65536);
  const decoder=decodePDFRawStream(stream) as unknown as {ensureBuffer:(n:number)=>Uint8Array};let prototype=Object.getPrototypeOf(decoder);while(!Object.hasOwn(prototype,'ensureBuffer'))prototype=Object.getPrototypeOf(prototype);
  const original=prototype.ensureBuffer,requests:number[]=[],allocations:number[]=[];const spy=vi.spyOn(prototype,'ensureBuffer').mockImplementation(function(this:unknown,n:unknown){requests.push(n as number);const result=original.call(this,n);allocations.push(result.length);return result;});
  try{expect(()=>decodeBoundedIccStream(stream,true)).toThrowError(expect.objectContaining({code:'PDF_ICC_PROOF'}));expect(requests.length).toBeGreaterThan(0);expect(Math.max(...requests)).toBeLessThanOrEqual(65536);expect(Math.max(...allocations)).toBeLessThanOrEqual(65536);}finally{spy.mockRestore();}
  const profile=authoredRgbProfile();expect(decodeBoundedIccStream(pdf.context.stream(profile,{N:3}),false)).toEqual(profile);expect(decodeBoundedIccStream(pdf.context.flateStream(profile,{N:3}),true)).toEqual(profile);
 });
 it('bounds both compressed and expanded bytes before any ICC consumer',async()=>{const source=await authoredScopedColorSource({profile:new Uint8Array(65537)});await expect(sourceIccProfile(source.bytes)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});});
 it('classifies actual ICC selection independently of later unsupported paints',async()=>{
  for(const content of ['/OwnedRGB cs','/OwnedRGB CS','/OwnedRGB cs BT /F1 12 Tf (A) \' ET','/OwnedRGB cs 40 40 20 20 re B']){const source=await authoredScopedColorSource({content});expect((await sourceIccProfile(source.bytes))?.sha256).toBe(sha256Sync(source.profile));}
  const declaredOnly=await authoredScopedColorSource({icc:false});expect(await sourceIccProfile(declaredOnly.bytes)).toBeUndefined();
 });
 it('refuses ICC hidden in an invoked unsupported Form before legacy fallback',async()=>{
  const source=await authoredScopedColorSource(),pdf=await PDFDocument.load(source.bytes),page=pdf.getPages()[0],originalResources=page.node.Resources()!,form=pdf.context.register(pdf.context.flateStream('/OwnedRGB cs .3 .5 .7 sc 0 0 20 20 re f',{Type:'XObject',Subtype:'Form',BBox:[0,0,20,20],Resources:originalResources}));
  page.node.set(PDFName.of('Resources'),pdf.context.obj({XObject:{Nested:form}}));page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream('/Nested Do')));const bytes=new Uint8Array(await pdf.save());await expect(sourceIccProfile(bytes)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
  const {project}=await imported();project.source.bytes=bytes;project.source.sha256=sha256Sync(bytes);project.source.format='docx';delete project.template.sourceColorProfile;delete project.template.sourceScopedPages;delete project.template.sourceImageContract;delete project.template.sourceFonts;project.template.importerVersion='folio-import-v11';for(const page of project.template.pages)for(const r of page.regions){if('sourceScopedPaint'in r)delete r.sourceScopedPaint;if(r.kind==='text'){delete r.sourceLayout;delete r.style.sourceFontId;}}validateProject(project);
  await expect(renderProjectDocument(project,'baselinePreview')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(renderProjectDocument(project,'current')).rejects.toMatchObject({code:'PDF_ICC_PROOF'});await expect(saveProject(project)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 });
 it('restores profile and component state through q/Q and resets components on cs',async()=>{const source=await authoredScopedColorSource({content:'q /OwnedRGB cs .2 .3 .4 sc BT /F1 12 Tf 1 0 0 1 40 648 Tm <41> Tj ET q /OwnedRGB cs BT /F1 12 Tf 1 0 0 1 60 648 Tm <42> Tj ET Q BT /F1 12 Tf 1 0 0 1 80 648 Tm <41> Tj ET Q'}),pdf=await PDFDocument.load(source.bytes),inventory=originalScopedPaint(pdf,1,undefined,sha256Sync(source.bytes));expect(inventory.occurrences.map(o=>'color'in o?o.color.components:null)).toEqual([[.2,.3,.4],[0,0,0],[.2,.3,.4]]);});
 it.each(['40 20 m 70 20 l 70 30 l 40 30 l h f','40 30 m 70 30 l 70 20 l 40 20 l h f'])('accepts either exact rectangle winding',content=>{expect(traceScopedPaint(originalOperators(content),{viewport:[1,0,0,-1,0,100],pageBounds:{x:0,y:0,width:100,height:100}}).occurrences).toHaveLength(1);});
 it.each(['40 20 m 70 21 l 70 30 l 40 30 l h f','40 20 m 70 30 l 70 20 l 40 30 l h f','40 20 m 70 20 l 70 30 l 40 30 l 40 20 l h f','40 20 m 70 20 l 70 30 l 40 30 l f','40 20 m 70 20 l 2 0 0 2 0 0 cm 70 30 l 40 30 l h f'])('refuses nonexact rectangle %s',content=>expect(()=>traceScopedPaint(originalOperators(content),{viewport:[1,0,0,-1,0,100],pageBounds:{x:0,y:0,width:100,height:100}})).toThrow());
});

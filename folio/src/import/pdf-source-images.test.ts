import 'fake-indexeddb/auto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFBool,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {fictionalImageBlankSource} from '../core/sourceImageTestFixture';
import {sourceGlyphs} from '../core/source-graph';
import {makeProject,sha256Sync,type ImageRegion} from '../core/model';
import {validateProject} from '../core/schema';
import {loadSourceFont,parseSourceProgram,validateSourceFontAsset} from '../layout/source-fonts';
import {browserSourceFontBytes} from '../ui/sourceFonts';
import {sourceImageCssClip,sourceImageVisibleBounds} from '../core/source-images';
import {captureSourceImages,validateSourceImagePaint,sourceImagePaintHash,legacyCatalogueImagePage} from './pdf-source-images';
import {originalImageOccurrences,originalOperators,originalPageContent} from './pdf-image-trace';
import {importResume} from './index';
import {renderDocument} from '../render/pdf';
import {setFontLoader} from '../layout/fonts';
import {captureSourceGlyphs} from './pdf-source';
import type {SourceFontAsset} from '../core/model';

let program:Uint8Array,restore:()=>void,pdfjs:typeof import('pdfjs-dist/legacy/build/pdf.mjs');
beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
const imported=async(options:Parameters<typeof fictionalImageBlankSource>[1]={})=>{const bytes=await fictionalImageBlankSource(program,options);return importResume(new File([new Uint8Array(bytes).buffer],'fictional-alpha-clip.pdf',{type:'application/pdf'}));};
async function mutatedSource(change:(doc:PDFDocument,image:PDFRawStream,mask:PDFRawStream)=>void){const doc=await PDFDocument.load(await fictionalImageBlankSource(program)),ref=doc.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).get(PDFName.of('OwnedImage'))!,image=doc.context.lookup(ref),mask=image instanceof PDFRawStream?image.dict.lookup(PDFName.of('SMask')):undefined;if(!(image instanceof PDFRawStream)||!(mask instanceof PDFRawStream))throw Error();change(doc,image,mask);return new Uint8Array(await doc.save());}
const setContent=(doc:PDFDocument,text:string)=>doc.getPages()[0].node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(new TextEncoder().encode(text))));
describe('source-owned retained positive unencoded blank',()=>{
 it.each([512,569])('owns actual positive blank selector and native advance %s without promoting inked GID0',async blankWidth=>{
  const r=await imported({images:0,blankWidth}),asset=r.template.sourceFonts![0];expect(asset.format).toBe('truetype');if(asset.format!=='truetype')throw Error();expect(asset.sourceVersion).toBe(5);
  const blank=asset.glyphMap.find(m=>m.selectorProvenance)!;expect(blank).toMatchObject({unicode:' ',nonPainting:true,originalCharCode:3,originalGlyphId:3,glyphId:3,selectorProvenance:'original-identity-positive-blank-v1'});
  const font=validateSourceFontAsset(asset);expect(font.glyphForCodePoint(blank.fontChar).id).toBe(0);expect(font.getGlyph(0).path.toSVG()).not.toBe('');expect(font.getGlyph(3).path.toSVG()).toBe('');expect(blank.pdfWidth).toBe(blankWidth*1000/font.unitsPerEm);
  const derived=parseSourceProgram(browserSourceFontBytes(asset));expect(derived.glyphForCodePoint(32).id).toBe(3);expect(derived.getGlyph(3).advanceWidth).toBe(blankWidth);
  expect(r.template.pages.flatMap(p=>p.regions.flatMap(r=>r.kind==='text'&&r.sourceLayout?Array.from(sourceGlyphs(r)):[])).map(g=>g.unicode).join('')).toBe('a bab');validateProject(makeProject(r));
 });
 it.each(['zero','otherEmpty','unicode','width','missingProvenance','legacyProvenance','rawSelector'] as const)('rejects %s selector forgery',async kind=>{
  const r=await imported({images:0,blankWidth:512}),asset=r.template.sourceFonts![0];if(asset.format!=='truetype')throw Error();const blank=asset.glyphMap.find(m=>m.selectorProvenance)!;
  if(kind==='zero')blank.glyphId=0;else if(kind==='otherEmpty')blank.glyphId=2;else if(kind==='unicode')blank.unicode='b';else if(kind==='width')blank.pdfWidth+=1;else if(kind==='missingProvenance')delete blank.selectorProvenance;else if(kind==='legacyProvenance')asset.sourceVersion=4;else blank.fontChar=97;
  expect(()=>validateSourceFontAsset(asset)).toThrow();
 });
});
describe('owned alpha images and exact image-only rectangular clips',()=>{
 it('binds repeated actual direct resource/own mask and captures the clip before later image cm',async()=>{
  const bytes=await fictionalImageBlankSource(program,{images:5}),doc=await PDFDocument.load(bytes),original=originalImageOccurrences(doc,1);expect(original).toHaveLength(5);expect(new Set(original.map(p=>p.imageRef)).size).toBe(1);expect(new Set(original.map(p=>p.smaskRef)).size).toBe(1);
  original.forEach((p,i)=>{expect(p.bounds).toEqual({x:40,y:132+i*20,width:30,height:8});expect(p.pageClip).toEqual(p.bounds);expect(p.clipStack[0].ctm).toEqual([1,0,0,-1,5,697]);expect(p.imageCtm).toEqual([30,0,0,-8,40,140+i*20]);});
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,fontExtraProperties:true,verbosity:0});try{const captured=await captureSourceImages(await(await task.promise).getPage(1),bytes,1);expect(captured.size).toBe(5);for(const value of captured.values())expect(value.paint).toMatchObject({smaskRef:original[0].smaskRef,pixelWidth:2,pixelHeight:2,opacity:1,interpolate:false});}finally{await task.destroy();}
  const result=await imported({images:5}),images=result.template.pages[0].regions.filter(r=>r.kind==='image');expect(result.assets).toHaveLength(1);expect(new Set(images.map(r=>r.assetId)).size).toBe(1);expect(images).toHaveLength(5);
 });
 it('proves the measured page-root/image reflection pair and balanced MCID-only Figure metadata',async()=>{
  const r=await imported({rootReflection:true,marked:true,overhang:.000005}),image=r.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;expect(image.bounds).toEqual({x:40.000005,y:132,width:30,height:8});expect(image.sourcePaint!.clipStack[0].ctm[3]).toBe(1);expect(image.sourcePaint!.imageCtm[3]).toBe(-8);expect(image.sourcePaint!.pageClip).toEqual({x:40,y:132,width:30,height:8});expect(r.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);await validateSourceImagePaint(r.source.bytes,r.template,r.assets);
 });
 it('retains omitted positive blank paint and exact raw blank counts across unscaled synthetic extractor separators',async()=>{
  const r=await imported({images:0,rawBlanks:4,sourceScale:.75,standaloneBlank:true});expect(r.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);expect(r.baseline.blocks.map(b=>b.runs.map(t=>t.text).join('')).join('')).toBe(' a    bab');
 });
 it('replays a genuine 0.000005pt cut without containment epsilon and preserves owned alpha pixels',async()=>{
  const r=await imported({images:1,overhang:.000005}),image=r.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;expect(image.sourcePaint).toBeDefined();expect(image.bounds.x).toBe(40.000005);expect(image.sourcePaint!.pageClip!.x).toBe(40);expect(sourceImageVisibleBounds(image)!.width).toBeCloseTo(29.999995,12);expect(sourceImageCssClip(image)).toContain('0.000005');
  expect(r.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);validateProject(makeProject(r));await validateSourceImagePaint(r.source.bytes,r.template,r.assets);
  const render=await renderDocument(r.template,r.baseline,r.assets);expect(render.layout.overflows).toEqual([]);const output=await PDFDocument.load(render.bytes),contents=output.getPages()[0].node.Contents()!,streams=contents instanceof PDFArray?contents.asArray().map(ref=>output.context.lookup(ref) as PDFRawStream):[output.context.lookup(contents) as PDFRawStream],text=streams.map(s=>new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n');
  expect(text).toMatch(/40 560 30 8 re\s+W\s+n/);expect(text).toContain('40.000005');
 });
 it.each(['pixels','position','clip','ref','mask','order','source'] as const)('rejects rehashed claimed %s paint against actual original',async kind=>{
  const r=await imported(),image=r.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!,p=image.sourcePaint!;
  if(kind==='pixels'){r.assets[0].bytes[30]^=1;p.assetSha256=sha256Sync(r.assets[0].bytes);}else if(kind==='position'){image.bounds.x+=1;p.bounds.x+=1;}else if(kind==='clip')p.pageClip!.x+=1;else if(kind==='ref')p.imageRef='999 0 R';else if(kind==='mask')p.smaskRef='998 0 R';else if(kind==='order'){image.order+=1;p.operatorIndex+=1;}else p.sourceSha256='0'.repeat(64);
  await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('refuses text paint under the original image clip and inline/form traces',async()=>{
  const bytes=await fictionalImageBlankSource(program,{clipText:true}),doc=await PDFDocument.load(bytes);expect(()=>originalImageOccurrences(doc,1)).toThrow();expect(()=>originalOperators('q BI /W 2 /H 2 ID aa EI Q')).toThrow();
 });
 it('preserves legacy early-return without parsing unrelated source bytes',async()=>{await expect(validateSourceImagePaint(new Uint8Array([1]),{pages:[]} as never,[])).resolves.toBeUndefined();});
 it.each(['allProofs','oneOccurrence','pageInventory','contract','downgrade','duplicate'] as const)('rejects %s inventory deletion or claimed downgrade',async kind=>{
  const r=await imported({images:2}),images=r.template.pages[0].regions.filter((r):r is ImageRegion=>r.kind==='image'),state=r.template.sourceImageContract!.pages[0];
  if(kind==='allProofs'){images.forEach(r=>delete r.sourcePaint);r.template.sourceImageContract!.pages[0]={pageNumber:1,status:'none'};}
  else if(kind==='oneOccurrence'){delete images[0].sourcePaint;if(state.status==='proved')state.occurrences.shift();}
  else if(kind==='pageInventory')r.template.sourceImageContract!.pages=[];
  else if(kind==='contract')delete r.template.sourceImageContract;
  else if(kind==='downgrade')r.template.importerVersion='folio-import-v11';
  else if(state.status==='proved')state.occurrences.push({...state.occurrences[0]});
  await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('rejects a changed text/image order even when the claimed glyph operator is rewritten with it',async()=>{
  const r=await imported(),region=r.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout)!;if(region.kind!=='text'||!region.sourceLayout)throw Error();region.order=999;
  region.sourceLayout={...region.sourceLayout,glyphEncoding:undefined,glyphs:Array.from(sourceGlyphs(region),g=>({...g,operatorIndex:999}))};
  await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('rejects an actual unused identical image and mask ref despite self-consistent program/pixel hashes',async()=>{
  const r=await imported({unusedLookalike:true}),doc=await PDFDocument.load(r.source.bytes),unused=doc.getPages()[0].node.Resources()!.lookup(PDFName.of('XObject'),PDFDict).get(PDFName.of('UnusedImage'))!,stream=doc.context.lookup(unused);if(!(stream instanceof PDFRawStream))throw Error();const image=r.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!,p=image.sourcePaint!;expect(sha256Sync(stream.getContents())).toBe(p.imageProgramSha256);p.imageRef=unused.toString();p.smaskRef=stream.dict.get(PDFName.of('SMask'))!.toString();const s=r.template.sourceImageContract!.pages[0];if(s.status==='proved')s.occurrences[0].paintSha256=sourceImagePaintHash(p);validateProject(makeProject(r));await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('binds original rectangle paint/order against alpha images and rejects a shifted/reordered rectangle',async()=>{
  const r=await imported({background:true});await validateSourceImagePaint(r.source.bytes,r.template,r.assets);const rect=r.template.pages[0].regions.find(r=>r.kind==='rectangle')!;rect.order=999;await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('refuses an unproved CFF decoration/image order instead of borrowing text occurrence proof',async()=>{
  const r=await imported(),image=r.template.pages[0].regions.find((r):r is ImageRegion=>r.kind==='image')!;r.template.pages[0].regions.push({...image,kind:'sourceShape'} as never);await expect(validateSourceImagePaint(r.source.bytes,r.template,r.assets)).rejects.toThrow();
 });
 it('does not admit a legacy image after a later glyph failure leaves a partially qualified V5 face',async()=>{
  const bytes=await fictionalImageBlankSource(program,{rootReflection:true}),doc=await PDFDocument.load(bytes);setContent(doc,originalPageContent(doc,1).replace(/35 129 30 8 re W\* n /,''));const font=doc.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][1],dict=doc.context.lookup(font,PDFDict),cmap=dict.lookup(PDFName.of('ToUnicode'));if(!(cmap instanceof PDFRawStream))throw Error();const cmapText=new TextDecoder().decode(decodePDFRawStream(cmap).decode()).replace('<0062>','<0001>');dict.set(PDFName.of('ToUnicode'),doc.context.register(doc.context.flateStream(new TextEncoder().encode(cmapText))));const changed=new Uint8Array(await doc.save()),task=pdfjs.getDocument({data:new Uint8Array(changed),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,verbosity:0});try{const page=await(await task.promise).getPage(1),fonts:SourceFontAsset[]=[];await expect(captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sha256Sync(changed),fonts,changed,1)).rejects.toThrow();expect(fonts.some(f=>f.format==='truetype'&&f.sourceVersion===5&&f.glyphMap.length>0)).toBe(true);await expect(legacyCatalogueImagePage(page,changed,1)).resolves.toBe(false);}finally{await task.destroy();}
 });
 it.each(['imageInterpolation','maskInterpolation','defaultRgb','renderingIntent','gsRenderingIntent','textClip','imageDecodeParms','maskDecodeParms','smaskInData','maskMatte','maskDecode','iccRange','iccAlternate','unknownClipOp','clipTextState'] as const)('rejects unsupported effective %s without changing clip tolerances',async kind=>{
  const bytes=await mutatedSource((doc,image,mask)=>{const resources=doc.getPages()[0].node.Resources()!;let text=originalPageContent(doc,1);
   if(kind==='imageInterpolation')image.dict.set(PDFName.of('Interpolate'),PDFBool.True);
   else if(kind==='maskInterpolation')mask.dict.set(PDFName.of('Interpolate'),PDFBool.True);
   else if(kind==='defaultRgb')resources.set(PDFName.of('ColorSpace'),doc.context.obj({DefaultRGB:'DeviceCMYK'}));
   else if(kind==='renderingIntent')text='/RelativeColorimetric ri '+text;
   else if(kind==='gsRenderingIntent'){resources.set(PDFName.of('ExtGState'),doc.context.obj({Bad:{RI:'RelativeColorimetric'}}));text='/Bad gs '+text;}
   else if(kind==='textClip')text='7 Tr '+text;
   else if(kind==='imageDecodeParms')image.dict.set(PDFName.of('DecodeParms'),doc.context.obj({Predictor:1}));
   else if(kind==='maskDecodeParms')mask.dict.set(PDFName.of('DecodeParms'),doc.context.obj({Predictor:1}));
   else if(kind==='smaskInData')image.dict.set(PDFName.of('SMaskInData'),PDFNumber.of(1));
   else if(kind==='maskMatte')mask.dict.set(PDFName.of('Matte'),doc.context.obj([0,0,0]));
   else if(kind==='maskDecode')mask.dict.set(PDFName.of('Decode'),doc.context.obj([1,0]));
   else if(kind==='iccRange'||kind==='iccAlternate'){const profile=doc.context.register(doc.context.flateStream(new Uint8Array([0]),{N:3,...(kind==='iccRange'?{Range:[0,1,0,1,0,1]}:{Alternate:'DeviceCMYK'})}));image.dict.set(PDFName.of('ColorSpace'),doc.context.obj(['ICCBased',profile]));}
   else text=text.replace('W* n',kind==='unknownClipOp'?'W* n unknownPaint':'W* n BT');
   setContent(doc,text);
  });const doc=await PDFDocument.load(bytes);expect(()=>originalImageOccurrences(doc,1)).toThrow();
 });
 it.each(['negativeCm','jpeg'] as const)('does not let a source-owned V5 font borrow legacy %s image admission',async kind=>{
  const bytes=await mutatedSource((doc,image)=>{if(kind==='jpeg')image.dict.set(PDFName.of('Filter'),PDFName.of('DCTDecode'));else setContent(doc,originalPageContent(doc,1).replace('30 0 0 8','30 0 0 -8'));});
  const result=await importResume(new File([new Uint8Array(bytes).buffer],'fictional-source-owned.pdf'));expect(result.template.sourceFonts?.some(f=>f.format==='truetype'&&f.sourceVersion===5)).toBe(true);expect(result.template.sourceImageContract!.pages[0].status).toBe('unsupported');expect(result.template.warnings.some(w=>w.code==='PDF_IMAGE_PROOF'&&w.severity==='blocking')).toBe(true);
  const task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,verbosity:0});try{await expect(legacyCatalogueImagePage(await(await task.promise).getPage(1),bytes,1)).resolves.toBe(false);}finally{await task.destroy();}
 });
 it.each(['ActualText','Alt','OC','unbalanced','unknownProperty','badRgb'] as const)('refuses non-inert %s markup or clipped state',async kind=>{
  const bytes=await mutatedSource((doc)=>{let text=originalPageContent(doc,1);const marker=kind==='ActualText'?'/Span <</ActualText <FEFF200B>>> BDC':kind==='Alt'?'/Figure <</Alt (opaque)>> BDC':kind==='OC'?'/OC <</MCID 1>> BDC':kind==='unknownProperty'?'/Figure <</MCID 1 /Lang (en)>> BDC':'/Figure <</MCID 1>> BDC';text=kind==='badRgb'?text.replace('W* n','W* n 0 2 0 rg'):marker+'\n'+text+(kind==='unbalanced'?'':'\nEMC');setContent(doc,text);});const doc=await PDFDocument.load(bytes);expect(()=>originalImageOccurrences(doc,1)).toThrow();
 });
});

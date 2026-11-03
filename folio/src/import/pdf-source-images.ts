import {MAX_SOURCE_PAGES} from '../core/model';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {PDFDocument,PDFDict,PDFName,PDFRef} from 'pdf-lib';
import {getDocument,GlobalWorkerOptions,OPS,Util,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import UPNG from '@pdf-lib/upng';
import {canonicalJson,sha256Sync,type ImageAsset,type SourceImagePaint,type SourceImagePageAdmission,type Template} from '../core/model';
import {sourceImageBinding} from '../core/source-images';
import {FolioError} from '../core/errors';
import {originalImageOccurrences,originalPageContent} from './pdf-image-trace';
import {extractOwnedPdfImage} from './pdf-images';
import {knownPdfFont} from './pdf-fonts';
import {originalTfEvents} from './pdf-original-tt';
import {captureSourceGlyphs} from './pdf-source';
import {preflightPdfImages} from './pdf-image-preflight';
import type {SourceFontAsset} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {simpleSourcePath} from './pdf-path';

GlobalWorkerOptions.workerSrc=workerUrl;
const fail=():never=>{throw new FolioError('SOURCE_IMAGE_PAINT','An original image, owned alpha or rectangular clip no longer matches the retained PDF paint.');};
const imageOps=[OPS.paintImageXObject,OPS.paintInlineImageXObject,OPS.paintImageXObjectRepeat,OPS.paintInlineImageXObjectGroup,OPS.paintImageMaskXObject,OPS.paintImageMaskXObjectGroup,OPS.paintImageMaskXObjectRepeat,OPS.paintSolidColorImageMask];
/** Static artwork is locked to its actual operator so it cannot cross owned image alpha. */
function sourceArtworkOrder(ops:{fnArray:number[];argsArray:any[]},viewport:number[]):Map<number,unknown>{
 const result=new Map<number,unknown>(),stack:{matrix:number[];fill:string;stroke:string;width:number}[]=[];let state={matrix:[1,0,0,1,0,0],fill:'#000000',stroke:'#000000',width:1};
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],args=ops.argsArray[i];if(op===OPS.save)stack.push({...state,matrix:[...state.matrix]});else if(op===OPS.restore){if(!stack.length)return fail();state=stack.pop()!;}else if(op===OPS.transform)state.matrix=Util.transform(state.matrix,args);else if(op===OPS.setFillRGBColor)state.fill=args[0];else if(op===OPS.setStrokeRGBColor)state.stroke=args[0];else if(op===OPS.setLineWidth)state.width=Number(args[0]);else if(op===OPS.setGState){for(const [key,value] of args[0])if(key==='LW')state.width=Number(value);}else if(op===OPS.constructPath){const path=simpleSourcePath(args[1]?.[0]);if(!path)continue;const points=path.points.map(p=>{const v=[...p];Util.applyTransform(v,Util.transform(viewport,state.matrix));return v;}),xs=points.map(p=>p[0]),ys=points.map(p=>p[1]),bounds={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)},paint=args[0],thickness=Math.max(.1,state.width*Math.hypot(state.matrix[0],state.matrix[1]));
   if(points.length===2&&[OPS.stroke,OPS.closeStroke].includes(paint)&&(bounds.width<.05||bounds.height<.05))result.set(i,{kind:'rule',bounds,color:state.stroke,thickness});
   else{const unique=points.filter((p,j)=>!points.slice(0,j).some(q=>Math.hypot(p[0]-q[0],p[1]-q[1])<.01)),rect=(path.closed||points.length===5)&&unique.length===4&&unique.every(p=>(Math.abs(p[0]-bounds.x)<.01||Math.abs(p[0]-bounds.x-bounds.width)<.01)&&(Math.abs(p[1]-bounds.y)<.01||Math.abs(p[1]-bounds.y-bounds.height)<.01));if(rect&&[OPS.fill,OPS.eoFill,OPS.stroke,OPS.closeStroke,OPS.fillStroke,OPS.eoFillStroke,OPS.closeFillStroke,OPS.closeEOFillStroke].includes(paint)){const fill=![OPS.stroke,OPS.closeStroke].includes(paint),stroke=![OPS.fill,OPS.eoFill].includes(paint);result.set(i,{kind:'rectangle',bounds,...(fill?{fill:state.fill}:{}),...(stroke?{stroke:state.stroke}:{}),thickness:stroke?thickness:0});}}
  }}if(stack.length)return fail();return result;
}
export interface CapturedSourceImage {paint:SourceImagePaint;bytes:Uint8Array}
/** Existing catalogue representation only, never a new original-owned image qualification. */
export async function legacyCatalogueImagePage(page:PDFPageProxy,bytes:Uint8Array,pageNumber:number):Promise<boolean>{
 try{
  await preflightPdfImages(bytes);
  const ops=await page.getOperatorList(),used=ops.fnArray.flatMap((op,i)=>op===OPS.setFont?[ops.argsArray[i]]:[]),images=ops.fnArray.filter(op=>imageOps.includes(op));
  if(!images.length||images.some(op=>op!==OPS.paintImageXObject)||!used.length||used.some(a=>!knownPdfFont(page,String(a[0])))||ops.fnArray.some(op=>[OPS.clip,OPS.eoClip,OPS.paintFormXObjectBegin,OPS.paintFormXObjectEnd,OPS.beginGroup,OPS.endGroup].includes(op)))return false;
  const document=await PDFDocument.load(new Uint8Array(bytes)),text=originalPageContent(document,pageNumber),actual=originalImageOccurrences(document,pageNumber,text,true);if(actual.length!==images.length||actual.some(v=>v.pageClip||v.clipStack.length))return false;
  const trace=originalTfEvents(text,true),resources=document.getPages()[pageNumber-1].node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources||resources.entries().length>32||trace.events.length!==used.length)return false;const binding=new Map<string,string>();
  for(let i=0;i<used.length;i++){const event=trace.events[i],selected=used[i],ref=resources.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef)||selected[1]!==event.size||binding.has(selected[0])&&binding.get(selected[0])!==ref.toString())return false;binding.set(selected[0],ref.toString());}
  // Native original-owned glyphs cannot borrow the catalogue route after image refusal.
  const fonts:SourceFontAsset[]=[];try{await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sha256Sync(bytes),fonts,bytes,pageNumber);}catch{/* Zero qualified selectors retains the historical catalogue representation. */}
  if(fonts.some(f=>f.format==='truetype'&&(f.sourceVersion===8||f.sourceVersion===7||f.sourceVersion===6||f.sourceVersion===5||f.sourceVersion===4&&f.glyphMap.length>0)))return false;
  return true;
 }catch{return false;}
}
export const sourceImagePaintHash=(paint:SourceImagePaint)=>sha256Sync(new TextEncoder().encode(canonicalJson(paint)));
export function sourceImagePageAdmission(pageNumber:number,images:ReadonlyMap<number,CapturedSourceImage>,unsupported=false):SourceImagePageAdmission {
 return unsupported?{pageNumber,status:'unsupported'}:images.size?{pageNumber,status:'proved',occurrences:[...images].map(([operatorIndex,v])=>({operatorIndex,paintSha256:sourceImagePaintHash(v.paint)}))}:{pageNumber,status:'none'};
}
export function provedImageClipOperators(ops:{fnArray:number[];argsArray:any[]},images:ReadonlyMap<number,CapturedSourceImage>):Set<number>{
 const expected=new Set([...images.values()].flatMap(v=>v.paint.clipStack.map(c=>c.rawOperatorIndex))),result=new Set<number>();let clips=0,pending=false;
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i];if(op===OPS.clip||op===OPS.eoClip){if(pending)return fail();pending=true;clips++;result.add(i);}else if(pending){if(op!==OPS.constructPath||ops.argsArray[i][0]!==OPS.endPath)return fail();pending=false;result.add(i);}}
 if(pending||clips!==expected.size)return fail();return result;
}
/** Exact ordered top-level Do to pinned decoded image join; optimizer substitutions fail closed. */
export async function captureSourceImages(page:PDFPageProxy,bytes:Uint8Array,pageNumber:number):Promise<Map<number,CapturedSourceImage>> {
 await preflightPdfImages(bytes);
 const operators=await page.getOperatorList(),selected=operators.fnArray.flatMap((op,index)=>imageOps.includes(op)?[{op,index,args:operators.argsArray[index]}]:[]),result=new Map<number,CapturedSourceImage>();
 if(!selected.length)return result;
 if(selected.length>30||operators.fnArray.length>100000||selected.some(v=>v.op!==OPS.paintImageXObject||typeof v.args[0]!=='string')||operators.fnArray.some(op=>[OPS.paintFormXObjectBegin,OPS.paintFormXObjectEnd,OPS.beginGroup,OPS.endGroup].includes(op)))return fail();
 const doc=await PDFDocument.load(new Uint8Array(bytes)),originals=originalImageOccurrences(doc,pageNumber);if(originals.length!==selected.length)return fail();
 const sourceSha256=sha256Sync(bytes);
 const decodedByRef=new Map<string,NonNullable<Awaited<ReturnType<typeof extractOwnedPdfImage>>>&{rgbaSha256:string;assetSha256:string}>(),aliases=new Map<string,string>(),refs=new Map<string,string>();let pngBytes=0;
 for(let i=0;i<selected.length;i++){
  const use=selected[i],source=originals[i],alias=use.args[0] as string;if(aliases.has(alias)&&aliases.get(alias)!==source.imageRef||refs.has(source.imageRef)&&refs.get(source.imageRef)!==alias)return fail();aliases.set(alias,source.imageRef);refs.set(source.imageRef,alias);
  let decoded=decodedByRef.get(source.imageRef);if(!decoded){const pixels=await extractOwnedPdfImage(page,alias);if(!pixels)return fail();pngBytes+=pixels.bytes.length;if(pngBytes>10*1024*1024)return fail();
   const png=UPNG.decode(new Uint8Array(pixels.bytes).buffer),rgba=new Uint8Array(UPNG.toRGBA8(png)[0]);if(rgba.length!==pixels.rgba.length||rgba.some((v,i)=>v!==pixels.rgba[i]))return fail();decoded={...pixels,rgbaSha256:sha256Sync(pixels.rgba),assetSha256:sha256Sync(pixels.bytes)};decodedByRef.set(source.imageRef,decoded);
  }if(decoded.width!==source.pixelWidth||decoded.height!==source.pixelHeight)return fail();
  const paint:SourceImagePaint={kind:'direct-image-rect-clip-v1',sourceSha256,pageNumber,...source,operatorIndex:use.index,rgbaSha256:decoded.rgbaSha256,assetSha256:decoded.assetSha256,opacity:1,blendMode:'Normal'};
  result.set(use.index,{paint,bytes:decoded.bytes});
 }
 return result;
}
/** Schema-first storage boundary independently recaptures referenced occurrences and decoded RGBA. */
export async function validateSourceImagePaint(bytes:Uint8Array,template:Template,assets:readonly ImageAsset[]):Promise<void> {
 const wanted=template.pages.flatMap((p,i)=>p.regions.flatMap(r=>r.kind==='image'&&r.sourcePaint?[{region:r,pageNumber:i+1}]:[])),contract=template.sourceImageContract;
 if(!contract){if(['folio-import-v12','folio-import-v13','folio-import-v14','folio-import-v26','folio-import-v27','folio-import-v28','folio-import-v15','folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||wanted.length||template.sourceFonts?.some(f=>f.format==='truetype'&&(f.sourceVersion===5||f.sourceVersion===6||f.sourceVersion===7||f.sourceVersion===8)))return fail();return;}
 if(!['folio-import-v12','folio-import-v13','folio-import-v14','folio-import-v26','folio-import-v27','folio-import-v28','folio-import-v15','folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||contract.sourceSha256!==sha256Sync(bytes)||contract.pages.length!==template.pages.length)return fail();
 if(wanted.length>30)return fail();const sourceSha256=sha256Sync(bytes),assetMap=new Map(assets.map(a=>[a.id,a]));
 for(const {region,pageNumber} of wanted){const p=region.sourcePaint!,asset=assetMap.get(region.assetId);if(!asset||!sourceImageBinding(region,asset)||p.sourceSha256!==sourceSha256||p.pageNumber!==pageNumber)return fail();}
 await preflightPdfImages(bytes);
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
 try{
  const pdf=await task.promise;if(pdf.numPages!==template.pages.length||pdf.numPages>MAX_SOURCE_PAGES||(await pdf.getPermissions())!==null)return fail();
  for(let pageNumber=1;pageNumber<=template.pages.length;pageNumber++){const admission=contract.pages[pageNumber-1];if(admission.pageNumber!==pageNumber)return fail();const page=await pdf.getPage(pageNumber),ops=await page.getOperatorList();let actual:Map<number,CapturedSourceImage>;
   if(admission.status==='legacy-catalogue-unclipped-v1'){if(wanted.some(v=>v.pageNumber===pageNumber)||template.sourceFonts?.some(f=>f.format==='truetype'&&(f.sourceVersion===4||f.sourceVersion===5||f.sourceVersion===6||f.sourceVersion===7||f.sourceVersion===8))||!await legacyCatalogueImagePage(page,bytes,pageNumber))return fail();continue;}
   try{actual=await captureSourceImages(page,bytes,pageNumber);if(actual.size||!template.sourceScopedPages)provedImageClipOperators(ops,actual);}catch{if(admission.status!=='unsupported'||wanted.some(v=>v.pageNumber===pageNumber)||!template.warnings.some(w=>w.severity==='blocking'&&w.pageId===template.pages[pageNumber-1].id))return fail();continue;}
   if(canonicalJson(sourceImagePageAdmission(pageNumber,actual))!==canonicalJson(admission))return fail();const seen=new Set<number>();
   for(const {region} of wanted.filter(v=>v.pageNumber===pageNumber)){const p=region.sourcePaint!;if(seen.has(p.operatorIndex))return fail();seen.add(p.operatorIndex);const captured=actual.get(p.operatorIndex);if(!captured||canonicalJson(captured.paint)!==canonicalJson(p)||sha256Sync(assetMap.get(region.assetId)!.bytes)!==captured.paint.assetSha256)return fail();}
   if(seen.size!==actual.size)return fail();
   if(actual.size){const art=sourceArtworkOrder(ops,page.getViewport({scale:1}).transform);for(const r of template.pages[pageNumber-1].regions){if(r.kind==='sourceShape'&&!template.warnings.some(w=>w.code==='PDF_IMAGE_SHAPE_ORDER'&&w.severity==='blocking'&&w.pageId===template.pages[pageNumber-1].id))return fail();if(r.kind==='rule'||r.kind==='rectangle'){const current=r.kind==='rule'?{kind:r.kind,bounds:r.bounds,color:r.color,thickness:r.thickness}:{kind:r.kind,bounds:r.bounds,...(r.fill?{fill:r.fill}:{}),...(r.stroke?{stroke:r.stroke}:{}),thickness:r.thickness};if(canonicalJson(art.get(r.order))!==canonicalJson(current))return fail();}}}
   if(actual.size&&template.pages[pageNumber-1].regions.some(r=>r.kind==='text'&&r.sourceLayout)){
    // Image alpha makes relative text order observable. Rebind the immutable
    // source graph to actual retained-source occurrences, including multiplicity.
    const actualFonts:SourceFontAsset[]=[],graph=await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sourceSha256,actualFonts,bytes,pageNumber),fontMap=new Map((template.sourceFonts??[]).map(f=>[f.id,f])),actualMap=new Map(actualFonts.map(f=>[f.id,f]));
    const signature=(font:SourceFontAsset|undefined,cid:number,unicode:string,op:number,x:number,advance:number,baseline:number,size:number,color:string,spacing:number)=>{
     const map=font?.glyphMap.find(m=>m.cid===cid);if(!font||!map||map.unicode!==unicode)return fail();
     return canonicalJson([font.format,font.sha256,font.format==='truetype'?font.originalProgram?.pdfFontRef:null,font.format==='truetype'?font.originalProgram?.sha256:null,map.originalCharCode,map.originalGlyphId,map.glyphId,map.fontChar,map.pdfWidth,map.selectorProvenance,unicode,op,x,advance,baseline,size,color,spacing]);
    };
    const counts=new Map<string,number>();for(const glyph of graph??[]){if(glyph.inferredGap||glyph.shapeOnly)continue;const key=signature(actualMap.get(glyph.fontId),glyph.cid,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,glyph.baseline,glyph.size,glyph.color,glyph.characterSpacing??0);counts.set(key,(counts.get(key)??0)+1);}
    for(const region of template.pages[pageNumber-1].regions){if(region.kind!=='text'||!region.sourceLayout)continue;const s=region.sourceLayout;
     const glyphs=Array.from(sourceGlyphs(region));if(region.order!==glyphs[0].operatorIndex)return fail();
     for(const glyph of glyphs){if([...actual.keys()].some(op=>(glyph.operatorIndex<op)!==(region.order<op)))return fail();if(glyph.inferredGap)continue;const key=signature(fontMap.get(glyph.fontId),glyph.cid,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,s.baseline,s.fontSize,region.style.color,s.version===3?s.characterSpacing:0),count=counts.get(key)??0;if(count<1)return fail();counts.set(key,count-1);}
    }
   }
  }
 }finally{await task.destroy();}
}

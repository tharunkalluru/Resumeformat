import {originalPageFrame} from './pdf-page-frame';
import {sourceShear,sourceCharacterSpacing,sourceShowCharacterSpacing,decompositionShear} from '../layout/source-shear';
import {originalPositionedShows,type PositionedSourceShow} from './pdf-positioned-shows';
import {MAX_SOURCE_PAGES,hasPermittedOriginalTrueType} from '../core/model';
import {originalWholeShows,sourceClipLifetimePlan,type WholeTextShow,type ClipPlanPaint} from './pdf-atomic-paint';
import {originalTextDecompositions,type TextDecomposition} from './pdf-text-decomposition';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {validateSourceColorProfiles} from './pdf-icc';
import {PDFDict,PDFDocument,PDFName,PDFRef} from 'pdf-lib';
import {getDocument,OPS,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {canonicalJson,sha256Sync,type ImageAsset,type Region,type SourceFontAsset,type SourcePositionedGlyph,type SourceScopedPaint,type SourceScopedPages,type Template} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {FolioError} from '../core/errors';
import {originalScopedPaint,type ScopedPaintInventory,type ScopedPaintOccurrence,type RawClipConstruction,type RawRectangleConstruction} from './pdf-scoped-paint';
import {originalPageContent} from './pdf-image-trace';
import {originalTfEvents} from './pdf-original-tt';
import {captureSourceGlyphs,associateSourceItems,type SourcePaintGlyph} from './pdf-source';
import {preflightPdfImages} from './pdf-image-preflight';
import {validateSourceImagePaint} from './pdf-source-images';
import {validateSourceRulePaint} from './pdf-source-rules';

const fail=(detail:string):never=>{throw new FolioError('PDF_SCOPED_PAINT',`Original scoped paint cannot be replayed: ${detail}`);};
export interface CapturedScopedPage {width:number;height:number;inventory:ScopedPaintInventory;inventoryHash:string;byOperator:Map<number,ScopedPaintOccurrence>;aliases:Map<string,string>;fontRefs:Map<string,string>;decodedColors:Map<number,string>;decompositions?:ReadonlyMap<number,TextDecomposition>;wholeShows?:ReadonlyMap<number,WholeTextShow>;positionedShows?:ReadonlyMap<number,PositionedSourceShow>;rawClips?:ReadonlyMap<number,RawClipConstruction>;rawRectangles?:ReadonlyMap<number,RawRectangleConstruction>}
/** Ordered complete paint inventory; an optimizer/count/type mismatch refuses. */
export async function captureScopedPage(page:PDFPageProxy,bytes:Uint8Array,pageNumber:number,collectDecomposition=false,collectAtomic=false,collectInitialTd=false,allowHorizontalShear=false):Promise<CapturedScopedPage>{
 const rawClips=collectAtomic?new Map<number,RawClipConstruction>():undefined,rawRectangles=collectAtomic?new Map<number,RawRectangleConstruction>():undefined;
 const document=await PDFDocument.load(new Uint8Array(bytes)),original=document.getPages()[pageNumber-1],inventory=originalScopedPaint(document,pageNumber,undefined,sha256Sync(bytes),rawClips?{sourceSha256:sha256Sync(bytes),pageNumber,clips:rawClips,rectangles:rawRectangles}:undefined,allowHorizontalShear),ops=await page.getOperatorList();
 if(inventory.occurrences.some(p=>p.kind==='image'))return fail('images retain their separate image contract; combined scoped replay is not admitted');
 const actual=ops.fnArray.flatMap((op,index)=>op===OPS.showText||op===OPS.showSpacedText?[{index,kind:'text'}]:op===OPS.constructPath&&[OPS.fill,OPS.eoFill,OPS.stroke].includes(ops.argsArray[index][0])?[{index,kind:ops.argsArray[index][0]===OPS.stroke?'strokeRule':'fillRect'}]:[]);
 if(actual.length!==inventory.occurrences.length)return fail('raw and decoded paint counts differ');const byOperator=new Map<number,ScopedPaintOccurrence>();
 for(let i=0;i<actual.length;i++){const raw=inventory.occurrences[i];if(raw.kind!==actual[i].kind)return fail('raw and decoded paint order/type differ');byOperator.set(actual[i].index,raw);}
 const text=originalPageContent(document,pageNumber),events=originalTfEvents(text).events,selected=ops.fnArray.flatMap((op,index)=>op===OPS.setFont?[ops.argsArray[index]]:[]),resources=original.node.Resources()?.lookupMaybe(PDFName.of('Font'),PDFDict),aliases=new Map<string,string>();
 if(!resources||selected.length!==events.length)return fail('font selection count differs');for(let i=0;i<events.length;i++){const [alias,size]=selected[i],ref=resources.get(PDFName.of(events[i].resourceName));if(!(ref instanceof PDFRef)||typeof alias!=='string'||size!==events[i].size||aliases.has(alias)&&aliases.get(alias)!==ref.toString())return fail('font resource ownership differs');aliases.set(alias,ref.toString());}
 const fontRefs=new Map<string,string>();for(const [name,ref] of resources.entries())if(ref instanceof PDFRef)fontRefs.set(name.decodeText(),ref.toString());
 let active:{alias?:string;size?:number;fill:string;stroke:string}={fill:'#000000',stroke:'#000000'};const stack:typeof active[]=[],decodedColors=new Map<number,string>();
 for(let i=0;i<ops.fnArray.length;i++){const op=ops.fnArray[i],args=ops.argsArray[i];if(op===OPS.save)stack.push({...active});else if(op===OPS.restore){if(!stack.length)return fail('decoded graphics stack differs');active=stack.pop()!;}else if(op===OPS.setFont)active={...active,alias:args[0],size:args[1]};else if(op===OPS.setFillRGBColor)active.fill=args[0];else if(op===OPS.setStrokeRGBColor)active.stroke=args[0];
  const raw=byOperator.get(i);if(raw?.kind==='text'&&(!active.alias||fontRefs.get(raw.fontResource)!==aliases.get(active.alias)||raw.fontSize!==active.size))return fail('active raw text resource/size differs from decoded paint');
  if(raw){const color=raw.kind==='strokeRule'?active.stroke:active.fill;if(!/^#[a-f\d]{6}$/i.test(color))return fail('decoded paint color is unproved');decodedColors.set(i,color);}
 }
 // Keep every bounded raw occurrence/clip/group; none is classified as inert.
 const viewport=page.getViewport({scale:1}),frame=originalPageFrame(document,pageNumber);if(page.rotate!==0||page.userUnit!==1||canonicalJson(page.view)!==canonicalJson(frame.boxes.MediaBox)||canonicalJson(viewport.transform)!==canonicalJson(frame.viewport)||viewport.width!==frame.width||viewport.height!==frame.height)return fail('original frame and decoded viewport differ');return {width:viewport.width,height:viewport.height,inventory,inventoryHash:sha256Sync(new TextEncoder().encode(canonicalJson({...inventory,...(inventory.colorProfile?{colorProfile:{...inventory.colorProfile,bytes:undefined}}:{})}))),byOperator,aliases,fontRefs,decodedColors,...(collectDecomposition?{decompositions:originalTextDecompositions(text,ops,allowHorizontalShear)}:{}),...(collectAtomic?{rawClips,rawRectangles,positionedShows:originalPositionedShows(originalPageContent(document,pageNumber,true),ops),wholeShows:originalWholeShows(originalPageContent(document,pageNumber,true),ops,collectInitialTd)}:{})};
}
const occurrencePositions=new WeakMap<CapturedScopedPage,Map<number,number>>();
const rawColor=(paint:ScopedPaintOccurrence)=>paint.kind==='image'?fail('image color is independently owned'):paint.color;
/** Group editing frames, never raw paint. Every member retains its own show and factors. */
export function homogeneousSourceShows(page:CapturedScopedPage,operators:readonly number[],documentScoped=false,variableSpacing=false):boolean{
 if(operators.length<2||operators.length>100000)return false;
 let positions=occurrencePositions.get(page);if(!positions){positions=new Map([...page.byOperator.keys()].map((op,i)=>[op,i]));occurrencePositions.set(page,positions);}const first=page.byOperator.get(operators[0]),d=page.decompositions?.get(operators[0]);
 if(first?.kind!=='text'||first.color.space==='ICCBased'&&!documentScoped||!d||!page.positionedShows?.get(operators[0]))return false;
 return operators.every((operator,i)=>{
  const raw=page.byOperator.get(operator),decomposition=page.decompositions?.get(operator),show=page.positionedShows?.get(operator);
  return raw?.kind==='text'&&raw.fontResource===first.fontResource&&raw.fontSize===first.fontSize&&raw.appleAA===first.appleAA&&canonicalJson(raw.color)===canonicalJson(first.color)&&canonicalJson(raw.clipStack)===canonicalJson(first.clipStack)&&canonicalJson(raw.effectiveClip)===canonicalJson(first.effectiveClip)&&decomposition&&show&&decomposition.nominalFontSize===d.nominalFontSize&&decomposition.effectiveFontSize===d.effectiveFontSize&&canonicalJson(decomposition.ctm)===canonicalJson(d.ctm)&&canonicalJson(decomposition.linearTextMatrix)===canonicalJson(d.linearTextMatrix)&&(variableSpacing||show.characterSpacing===page.positionedShows!.get(operators[0])!.characterSpacing)&&(i===0||operator>operators[i-1]&&positions.get(operator)===positions.get(operators[i-1])!+1);
 });
}
export function scopedRegionOperators(region:Region):number[]{
 return region.kind==='text'?Array.from(new Set(Array.from(sourceGlyphs(region),g=>g.operatorIndex))):[region.order];
}
export function bindScopedRegion(region:Region,page:CapturedScopedPage,sourceSha256:string,pageNumber:number,fonts:readonly SourceFontAsset[]):SourceScopedPaint{
 const actual=page.byOperator.get(region.order);if(!actual||region.kind==='text'&&actual.kind!=='text'||region.kind==='rectangle'&&actual.kind!=='fillRect'||region.kind==='rule'&&actual.kind!=='strokeRule'||region.kind==='image'||region.kind==='sourceShape')return fail('missing region occurrence');
 if(actual.kind==='fillRect'&&region.kind==='rectangle'){region.bounds={...actual.bounds};region.thickness=0;if(region.stroke||!region.fill||region.fill!==page.decodedColors.get(region.order))return fail('compound or changed rectangle replay is unsupported');}
 if(actual.kind==='strokeRule'&&region.kind==='rule'){region.bounds={...actual.bounds};region.thickness=actual.thickness;if(region.color!==page.decodedColors.get(region.order))return fail('changed original rule color');}
 const operators=scopedRegionOperators(region),grouped=operators.length>1;
 if(grouped&&region.kind==='text'){let previous=-1;for(const glyph of sourceGlyphs(region)){if(glyph.operatorIndex<previous)return fail('grouped glyph shows were reordered');previous=glyph.operatorIndex;}}
 if(actual.kind==='text'&&region.kind==='text'&&region.sourceLayout?.version===4){const d=page.decompositions?.get(region.order);if(!d||decompositionShear(d)!==sourceShear(region.sourceLayout)||operators.some(o=>!page.positionedShows?.has(o)))return fail('sheared text needs its original matrix and explicit reset ownership');}
 if(actual.kind==='text'&&region.kind==='text'){const font=fonts.find(f=>f.id===region.style.sourceFontId);if(!font||!('originalProgram'in font)||!font.originalProgram||font.originalProgram.pdfFontRef!==page.fontRefs.get(actual.fontResource)||region.style.color!==page.decodedColors.get(region.order)||operators[0]!==region.order||grouped&&(!(font.sourceVersion===4||font.sourceVersion===5||font.sourceVersion===10||font.sourceVersion===7)||!homogeneousSourceShows(page,operators,font.sourceVersion===7,region.sourceLayout?.version===5)))return fail('text region raw resource, color or operator ownership differs');}
 const gaps=region.kind==='text'?Array.from(sourceGlyphs(region)).filter(glyph=>glyph.inferredGap).length:0;
 const adjusted=actual.kind==='strokeRule'&&actual.strokeAdjustment;
 return {version:region.kind==='text'&&region.sourceLayout?.version===5?'source-scoped-occurrence-v5':grouped?(region.kind==='text'&&fonts.some(f=>f.id===region.style.sourceFontId&&f.sourceVersion===7)?'source-scoped-occurrence-v4':'source-scoped-occurrence-v3'):rawColor(actual).space==='ICCBased'||actual.zeroFill||actual.rectanglePath||adjusted||actual.appleAA!==undefined||actual.clipStack.some(c=>c.pageCover)?'source-scoped-occurrence-v2':'source-scoped-occurrence-v1',...(grouped?{showGroup:{version:'homogeneous-source-shows-v1' as const,operators:operators.map(op=>[op,page.byOperator.get(op)!.rawOperatorIndex] as [number,number])}}:{}),...(actual.zeroFill?{zeroFill:true as const}:{}),...(actual.rectanglePath?{rectanglePath:actual.rectanglePath}:{}),...(adjusted?{strokeAdjustment:true as const}:{}),...(actual.appleAA!==undefined?{appleAA:actual.appleAA}:{}),kind:actual.kind as SourceScopedPaint['kind'],sourceSha256,pageNumber,rawOperatorIndex:actual.rawOperatorIndex,operatorIndex:region.order,color:rawColor(actual),clipStack:actual.clipStack,effectiveClip:actual.effectiveClip,stateHash:sourceScopedStateHash(region,fonts),...(gaps?{derivedGaps:{version:'pinned-extractor-gap-v1',count:gaps}}:{})};
}
type MappingIndexes=Map<SourceFontAsset,Map<number,SourceFontAsset['glyphMap'][number]>>;
const signature=(asset:SourceFontAsset|undefined,glyph:SourcePaintGlyph,mappingIndexes:MappingIndexes)=>{
 if(!asset||!('originalProgram'in asset)||!asset.originalProgram)return fail('scoped text requires original positive source font ownership');let mappings=mappingIndexes.get(asset);if(!mappings){mappings=new Map(asset.glyphMap.map(map=>[map.cid,map]));mappingIndexes.set(asset,mappings);}const map=mappings.get(glyph.cid);if(!map||glyph.shapeOnly||glyph.inferredGap&&(!map.nonPainting||map.unicode!==' '||glyph.advance<=0||!map.originalCharCode||!map.originalGlyphId))return fail('scoped glyph lacks original paint or independently derived blank semantics');
 return canonicalJson([glyph.inferredGap?'derived-gap':'raw',asset.originalProgram.pdfFontRef,asset.originalProgram.sha256,asset.sha256,map.originalCharCode,map.originalGlyphId,map.glyphId,map.pdfWidth,map.nonPainting,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,glyph.baseline,glyph.size,glyph.color,glyph.characterSpacing??0,glyph.shearX??0]);
};
/** Saved paired glyph paint is independently recaptured from retained bytes. */
export interface VerifiedSourceShow {readonly operatorIndex:number;readonly decomposition:TextDecomposition;readonly resetShow:PositionedSourceShow;readonly glyphs:readonly SourcePositionedGlyph[]}
export interface VerifiedRegionDecomposition {readonly pageId:string;readonly regionId:string;readonly fontId:string;readonly programSha256:string;readonly sourceSha256:string;readonly decomposition:TextDecomposition;readonly wholeShow?:WholeTextShow;readonly atomicGlyphs?:string;readonly integerFallback?:true;readonly atomicOwnerGlyphs?:string;readonly atomicLeader?:string;readonly atomicGroupGlyphs?:readonly SourcePositionedGlyph[];readonly showGroup?:readonly VerifiedSourceShow[]}
export interface VerifiedScopedReplay extends ReadonlyMap<string,VerifiedRegionDecomposition>{readonly atomicPages?:ReadonlyMap<string,readonly ClipPlanPaint[]>;readonly sourceSemanticSplit?:true;readonly groupedCaptures?:ReadonlyMap<string,CapturedScopedPage>}
/** Historical omission cannot erase a source-rederived no-show separator. */
async function rejectUnprovedSemanticSplit(bytes:Uint8Array,template:Template):Promise<void>{
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
 try{const pdf=await task.promise;if(pdf.numPages!==template.pages.length||pdf.numPages>MAX_SOURCE_PAGES)return fail('historical source pages differ');const actualFonts:SourceFontAsset[]=[],sourceSha256=sha256Sync(bytes);let glyphCount=0;
  for(let index=0;index<pdf.numPages;index++){
   const page=await pdf.getPage(index+1),viewport=page.getViewport({scale:1}),graph=await captureSourceGlyphs(page,viewport.transform,sourceSha256,actualFonts,bytes,index+1);
   if(!graph)return fail('historical original glyph capture is unavailable');glyphCount+=graph.length;if(glyphCount>100000)return fail('original paint exceeds the glyph budget');
   const parts=associateSourceItems((await page.getTextContent({disableNormalization:true})).items,graph,viewport.transform,actualFonts);
   if(parts.some(part=>part.semanticSplit))return fail('extractor-only separators require complete retained scoped source ownership');
  }
 }finally{await task.destroy();}
}
export async function validateSourceScopedPaint(bytes:Uint8Array,template:Template,assets:readonly ImageAsset[]=[],collectDecomposition=false,collectAtomic=false):Promise<VerifiedScopedReplay|undefined>{
 const groupedCaptures=new Map<string,CapturedScopedPage>(),atomicPages=new Map<string,readonly ClipPlanPaint[]>(),verified=Object.assign(new Map<string,VerifiedRegionDecomposition>(),{groupedCaptures},collectAtomic?{atomicPages}:{});
 await validateSourceColorProfiles(bytes,template);
 const proof=template.sourceScopedPages;
 if(!proof){
  // Labels and self-consistent metadata cannot prove that clipping was absent.
  // Reclassify old TrueType graphs too; unchanged historical image-only clips
  // retain their independently validated R3 image representation.
  if(!template.sourceFonts?.some(font=>font.format==='truetype'||font.sourceVersion===9)||!template.pages.some(page=>page.regions.some(region=>region.kind==='text'&&region.sourceLayout)))return;
  await preflightPdfImages(bytes);const document=await PDFDocument.load(new Uint8Array(bytes));if(document.getPageCount()!==template.pages.length)return fail('historical source pages differ');let imageValidation=false;
  if(template.sourceFonts.some(font=>'originalProgram'in font&&font.originalProgram))await rejectUnprovedSemanticSplit(bytes,template);
  for(const [index,page] of template.pages.entries()){
   const blocked=template.warnings.some(warning=>warning.pageId===page.id&&warning.severity==='blocking');
   let inventory:ScopedPaintInventory;try{inventory=originalScopedPaint(document,index+1,undefined,sha256Sync(bytes));}catch{if(blocked)continue;return fail('unproved historical graphics require a blocking refusal');}
   if(inventory.pageGroup||inventory.occurrences.some(paint=>paint.kind!=='image'&&paint.clipStack.length)){if(blocked)continue;return fail('original text/primitive clips or page group require retained replay proof');}
   const primitives=inventory.occurrences.filter(paint=>paint.kind==='fillRect'||paint.kind==='strokeRule');
   if(primitives.length){const rules=page.regions.filter(region=>region.kind==='rule'),paired=new Set((template.sourceRuleOverlaps??[]).map(pair=>pair.ruleId));
    if(primitives.some(paint=>paint.kind!=='strokeRule')||rules.length!==primitives.length||rules.some(rule=>!rule.sourcePaint||!paired.has(rule.id))){if(blocked)continue;return fail('historical mixed primitive paint requires independently rebound order or scoped replay');}
    await validateSourceRulePaint(bytes,template);
   }
   if(inventory.occurrences.some(paint=>paint.kind==='image'&&paint.clipStack.length)){
    if(template.sourceImageContract?.pages[index]?.status!=='proved'){if(blocked)continue;return fail('historical image clipping lacks its owned image contract');}
    if(!imageValidation){await validateSourceImagePaint(bytes,template,assets);imageValidation=true;}
   }
  }
  return;
 }
 if(!['folio-import-v13','folio-import-v14','folio-import-v26','folio-import-v27','folio-import-v28','folio-import-v15','folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||proof.sourceSha256!==sha256Sync(bytes)||proof.pages.length!==template.pages.length||template.pages.length>MAX_SOURCE_PAGES)return fail('source/version/page ownership differs');
 await preflightPdfImages(bytes);const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
 try{const pdf=await task.promise;if(pdf.numPages!==template.pages.length||(await pdf.getPermissions())!==null||Array.from(await pdf.getOptionalContentConfig()).length)return fail('unsupported source document state');
  const fonts=new Map((template.sourceFonts??[]).map(f=>[f.id,f])),mappingIndexes:MappingIndexes=new Map();
  for(const [pageIndex,savedPage] of template.pages.entries()){
   const groupedRegions=savedPage.regions.filter((r):r is Extract<Region,{kind:'text'}>=>r.kind==='text'&&(r.sourceScopedPaint?.version==='source-scoped-occurrence-v3'||r.sourceScopedPaint?.version==='source-scoped-occurrence-v4'||r.sourceScopedPaint?.version==='source-scoped-occurrence-v5')),hasGroups=!!proof.pages[pageIndex]?.pageFrame||groupedRegions.length>0||savedPage.regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===4);
   const page=await pdf.getPage(pageIndex+1),saved=proof.pages[pageIndex];let captured=await captureScopedPage(page,bytes,pageIndex+1,collectDecomposition||hasGroups,collectAtomic||hasGroups,(hasPermittedOriginalTrueType(template)||['folio-import-v27','folio-import-v28'].includes(template.importerVersion)),template.importerVersion==='folio-import-v17');if(saved.pageNumber!==pageIndex+1||saved.width!==captured.width||saved.height!==captured.height||savedPage.width!==captured.width||savedPage.height!==captured.height||saved.inventoryHash!==captured.inventoryHash||canonicalJson(saved.pageGroup)!==canonicalJson(captured.inventory.pageGroup)||canonicalJson(saved.pageFrame)!==canonicalJson(captured.inventory.pageFrame))return fail('original paint inventory or page geometry differs');
   if(collectDecomposition){const v=page.getViewport({scale:1});if(v.transform.some((value,index)=>value!==(captured.inventory.pageFrame?.viewport??[1,0,0,-1,0,v.height])[index]))return fail('source text requires the supported default page viewport');}
   let decomposition=captured.decompositions;
   const actualFonts:SourceFontAsset[]=[],graph=await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,proof.sourceSha256,actualFonts,bytes,pageIndex+1);if(!graph)return fail('original scoped glyph capture failed');const actualById=new Map(actualFonts.map(f=>[f.id,f])),rawCounts=new Map<string,number>(),gapCounts=new Map<string,number>(),actualOrder=new Map<number,string[]>(),savedOrder=new Map<number,string[]>();
   const associatedParts=associateSourceItems((await page.getTextContent({disableNormalization:true})).items,graph,page.getViewport({scale:1}).transform,actualFonts);
   const semanticOperators=new Set(associatedParts.filter(part=>part.semanticSplit).flatMap(part=>part.glyphs.map(g=>g.operatorIndex)));
   if(semanticOperators.size){
    // Even ordinary save/restore must rederive complete whole-show ownership;
    // the no-show separator is never a portable font or glyph assertion.
    if(!collectAtomic){captured=await captureScopedPage(page,bytes,pageIndex+1,true,true,(hasPermittedOriginalTrueType(template)||['folio-import-v27','folio-import-v28'].includes(template.importerVersion)),template.importerVersion==='folio-import-v17');decomposition=captured.decompositions;}
    const v=page.getViewport({scale:1});if(v.transform.some((value,index)=>value!==(captured.inventory.pageFrame?.viewport??[1,0,0,-1,0,v.height])[index]))return fail('source text requires the supported default page viewport');
    Object.assign(verified,{sourceSemanticSplit:true as const,atomicPages});
   }
   if(associatedParts.reduce((sum,part)=>sum+part.glyphs.length,0)>100000)return fail('original paint and derived spacing exceed the glyph budget');
   const associated=associatedParts.flatMap(part=>part.glyphs),rawKeys=graph.map(glyph=>signature(actualById.get(glyph.fontId),glyph,mappingIndexes));
   if(canonicalJson(rawKeys)!==canonicalJson(associated.filter(glyph=>!glyph.inferredGap).map(glyph=>signature(actualById.get(glyph.fontId),glyph,mappingIndexes))))return fail('extractor semantics changed the raw painted occurrence sequence');
   for(const glyph of associated){const raw=captured.byOperator.get(glyph.operatorIndex),font=actualById.get(glyph.fontId),ref=font&&'originalProgram'in font?font.originalProgram?.pdfFontRef:undefined;if(raw?.kind!=='text'||captured.aliases.get(glyph.resource)!==ref||captured.fontRefs.get(raw.fontResource)!==ref)return fail('raw text and physical resource differ');const key=signature(font,glyph,mappingIndexes),counts=glyph.inferredGap?gapCounts:rawCounts;counts.set(key,(counts.get(key)??0)+1);const sequence=actualOrder.get(glyph.operatorIndex)??[];sequence.push(key);actualOrder.set(glyph.operatorIndex,sequence);}
   const regions=savedPage.regions;if(regions.some(r=>r.kind==='sourceShape'||r.kind==='image'))return fail('mixed image/decoration scoped replay is unsupported');
   const covered=new Map<number,number>();
   for(const region of [...regions].sort((a,b)=>a.order-b.order)){if(!('sourceScopedPaint'in region)||!region.sourceScopedPaint)return fail('missing scoped region paint');const expected=bindScopedRegion(structuredClone(region),captured,proof.sourceSha256,pageIndex+1,template.sourceFonts??[]);if(canonicalJson(expected)!==canonicalJson(region.sourceScopedPaint))return fail('saved scoped region paint differs');for(const operator of scopedRegionOperators(region)){const count=(covered.get(operator)??0)+1;if((region.kind!=='text'||hasGroups)&&count>1)return fail('duplicate original grouped show or primitive occurrence');covered.set(operator,count);}
    if(region.kind==='text'){if(!region.sourceLayout)return fail('scoped text has no graph');const layout=region.sourceLayout;if(decomposition){const d=decomposition.get(region.order),font=fonts.get(region.style.sourceFontId??'');if(!d||d.rawOperatorIndex!==region.sourceScopedPaint.rawOperatorIndex||d.effectiveFontSize!==layout.fontSize||decompositionShear(d)!==sourceShear(layout)||!font||!('originalProgram'in font)||!font.originalProgram||verified.has(region.id))return fail('text decomposition region ownership differs');verified.set(region.id,Object.freeze({pageId:savedPage.id,regionId:region.id,fontId:font.id,programSha256:font.originalProgram.sha256,sourceSha256:proof.sourceSha256,decomposition:d}));}for(const glyph of sourceGlyphs(region)){const key=signature(fonts.get(glyph.fontId),{...glyph,resource:'',baseline:layout.baseline,size:layout.fontSize,color:region.style.color,characterSpacing:sourceShowCharacterSpacing(layout,glyph.operatorIndex),shearX:sourceShear(layout)},mappingIndexes),counts=glyph.inferredGap?gapCounts:rawCounts,count=counts.get(key)??0;if(count<1)return fail('saved original paint or derived gap occurrence differs');counts.set(key,count-1);const sequence=savedOrder.get(glyph.operatorIndex)??[];sequence.push(key);savedOrder.set(glyph.operatorIndex,sequence);}}
   }
   if([...rawCounts.values(),...gapCounts.values()].some(count=>count!==0)||[...captured.byOperator.keys()].some(operator=>!covered.has(operator))||[...actualOrder].some(([operator,sequence])=>canonicalJson(sequence)!==canonicalJson(savedOrder.get(operator))))return fail('missing or reordered original paint or derived gap occurrence');
   if(hasGroups)groupedCaptures.set(savedPage.id,captured);
   if(collectAtomic||semanticOperators.size||hasGroups){
    const plan=sourceClipLifetimePlan(captured.inventory,captured.byOperator,captured.rawClips,{sourceSha256:proof.sourceSha256,pageNumber:pageIndex+1},captured.rawRectangles);atomicPages.set(savedPage.id,plan);
    const owners=new Map<number,Extract<Region,{kind:'text'}>[]>();for(const region of [...regions].sort((a,b)=>a.order-b.order))if(region.kind==='text'&&!region.sourceScopedPaint?.showGroup){const list=owners.get(region.order)??[];list.push(region);owners.set(region.order,list);}
    const glyphKey=(glyphs:readonly SourcePositionedGlyph[])=>canonicalJson(glyphs.map(g=>[g.fontId,g.cid,g.unicode,g.x,g.advance,g.operatorIndex,g.inferredGap??false]));
    for(const region of groupedRegions){
     const witness=verified.get(region.id),font=fonts.get(region.style.sourceFontId??''),glyphs=Array.from(sourceGlyphs(region));
     if(!witness||!font||!('originalProgram'in font)||!font.originalProgram)return fail('grouped font owner');
     const maps=new Map(font.glyphMap.map(m=>[m.cid,m])),byShow=new Map<number,SourcePositionedGlyph[]>();
     for(const glyph of glyphs){const list=byShow.get(glyph.operatorIndex)??[];list.push(glyph);byShow.set(glyph.operatorIndex,list);}
     const shows:VerifiedSourceShow[]=[];
     for(const [operator,owned]of byShow){
      const physical=owned.filter(g=>!g.inferredGap),show=captured.positionedShows?.get(operator),d=captured.decompositions?.get(operator),raw=captured.byOperator.get(operator);
      if(!show||!d||!raw||actualOrder.get(operator)?.length!==owned.length||show.codes.length!==physical.length||show.rawOperatorIndex!==raw.rawOperatorIndex||captured.fontRefs.get(show.resource)!==font.originalProgram.pdfFontRef||show.codes.some((code,i)=>maps.get(physical[i].cid)?.originalCharCode!==code)||decompositionShear(d)!==sourceShear(region.sourceLayout)||show.characterSpacing*(d.ctm[0]*d.linearTextMatrix[0])!==(sourceShowCharacterSpacing(region.sourceLayout,operator)))return fail('grouped show must retain its complete original selectors and factors');
      shows.push(Object.freeze({operatorIndex:operator,decomposition:d,resetShow:show,glyphs:Object.freeze(physical.map(g=>Object.freeze({...g})))}));
     }
     verified.set(region.id,Object.freeze({...witness,atomicLeader:region.id,atomicOwnerGlyphs:glyphKey(glyphs),showGroup:Object.freeze(shows)}));
    }

    for(const [operator,group]of owners){
     if(hasGroups)continue;
     const first=group[0],witness=verified.get(first.id),font=fonts.get(first.style.sourceFontId??'');if(!witness||!font||!('originalProgram'in font)||!font.originalProgram)return fail('atomic font owner');
     const glyphs=group.flatMap(r=>Array.from(sourceGlyphs(r))),physical=glyphs.filter(g=>!g.inferredGap),maps=new Map(font.glyphMap.map(m=>[m.cid,m])),show=captured.wholeShows?.get(operator),actual=actualOrder.get(operator);
     const sameState=group.every(r=>r.style.sourceFontId===font.id&&r.sourceLayout?.baseline===first.sourceLayout?.baseline&&r.style.fontSize===first.style.fontSize&&r.style.color===first.style.color&&canonicalJson(r.sourceScopedPaint!.clipStack)===canonicalJson(first.sourceScopedPaint!.clipStack));
     const complete=sameState&&actual?.length===glyphs.length&&show&&show.codes.length===physical.length&&show.rawOperatorIndex===first.sourceScopedPaint!.rawOperatorIndex&&captured.fontRefs.get(show.resource)===font.originalProgram.pdfFontRef&&show.codes.every((code,i)=>maps.get(physical[i].cid)?.originalCharCode===code)&&group.every(r=>show.characterSpacing*(witness.decomposition.ctm[0]*show.decodedTextScaleX)===(r.sourceLayout!.version===3?r.sourceLayout!.characterSpacing:0));
     if(semanticOperators.has(operator)&&!complete)return fail('an extractor-only separator needs complete original show ownership');
     if(complete){const savedPhysical=Object.freeze(physical.map(g=>Object.freeze({...g})));for(const region of group){const own=verified.get(region.id);if(!own||own.fontId!==font.id||own.programSha256!==witness.programSha256)return fail('atomic group font owner');verified.set(region.id,Object.freeze({...own,atomicOwnerGlyphs:glyphKey(Array.from(sourceGlyphs(region))),atomicLeader:first.id,...(region===first?{wholeShow:show,atomicGlyphs:glyphKey(physical),atomicGroupGlyphs:savedPhysical}:{})}));}}
     else for(const region of group){const own=verified.get(region.id),asset=fonts.get(region.style.sourceFontId??'');if(!own||!asset||!('originalProgram'in asset)||!asset.originalProgram)return fail('atomic font owner');const gs=Array.from(sourceGlyphs(region)),index=new Map(asset.glyphMap.map(m=>[m.cid,m]));const integer=gs.length>0&&!gs.some(g=>g.inferredGap||!Number.isSafeInteger(index.get(g.cid)?.pdfWidth))&&(region.sourceLayout!.version!==3||region.sourceLayout!.characterSpacing===0);if(!integer)return fail('fractional show needs one complete explicit-reset owner');verified.set(region.id,Object.freeze({...own,integerFallback:true as const}));}
    }
   }

  }
 }finally{await task.destroy();}
 return collectDecomposition||'sourceSemanticSplit'in verified?verified:undefined;
}
export const scopedPages=(sourceSha256:string,pages:CapturedScopedPage[]):SourceScopedPages=>({version:pages.some(p=>p.inventory.colorProfile||p.inventory.clips.some(c=>c.pageCover)||p.inventory.occurrences.some(o=>o.zeroFill||o.rectanglePath||o.appleAA!==undefined||o.kind==='strokeRule'&&o.strokeAdjustment))?'source-scoped-pages-v2':'source-scoped-pages-v1',sourceSha256,pages:pages.map((p,i)=>({pageNumber:i+1,width:p.width,height:p.height,inventoryHash:p.inventoryHash,...(p.inventory.pageFrame?{pageFrame:p.inventory.pageFrame}:{}),...(p.inventory.pageGroup?{pageGroup:p.inventory.pageGroup}:{})}))});

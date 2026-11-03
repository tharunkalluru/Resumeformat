import {MAX_SOURCE_PAGES} from '../core/model';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {canonicalJson,sha256Sync,type SourceFontAsset,type Template} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {FolioError} from '../core/errors';
import {isTrustedLegacyTrueTypeProgram} from '../layout/legacy-tt-program';
import {captureSourceGlyphs,associateSourceItems} from './pdf-source';
import {preflightPdfImages} from './pdf-image-preflight';
import type {OriginalTfEvent} from './pdf-original-tt';

const fail=():never=>{throw new FolioError('PDF_ORIGINAL_TT_PROOF','A source font does not own the saved original painted glyph occurrences.');};
/** Pinned program identity is only a prerequisite, never retained-PDF ownership. */
export async function validateLegacyTrueTypeOccurrences(bytes:Uint8Array,template:Template,allowed:ReadonlyMap<string,ReadonlySet<string>>,bindings:readonly {events:OriginalTfEvent[];refs:string[]}[]):Promise<void>{
 if(template.pages.length!==bindings.length||template.pages.length>MAX_SOURCE_PAGES)return fail();
 const fonts=new Map((template.sourceFonts??[]).map(asset=>[asset.id,asset])),maps=new Map((template.sourceFonts??[]).map(asset=>[asset.id,new Map(asset.glyphMap.map(map=>[map.cid,map]))])),sourceSha256=sha256Sync(bytes);
 let total=0;const usedAssets=new Set<string>();
 const signature=(asset:SourceFontAsset,map:SourceFontAsset['glyphMap'][number],unicode:string,operator:number,x:number,advance:number,baseline:number,size:number,color:string,spacing:number,inferredGap=false)=>canonicalJson([asset.format==='truetype'&&asset.originalProgram?['original',asset.sha256,asset.originalProgram.sha256,map.originalCharCode,map.originalGlyphId]:['legacy'],map.glyphId,unicode,map.pdfWidth,operator,x,advance,baseline,size,color,spacing,inferredGap]);
 await preflightPdfImages(bytes);
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),useSystemFonts:false,isOffscreenCanvasSupported:false,fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
 try{
  const pdf=await task.promise;if(pdf.numPages!==template.pages.length||(await pdf.getPermissions())!==null)return fail();if(Array.from(await pdf.getOptionalContentConfig()).length)return fail();
  for(const [pageIndex,savedPage] of template.pages.entries()){
   const page=await pdf.getPage(pageIndex+1),ops=await page.getOperatorList(),selected=ops.fnArray.flatMap((op,i)=>op===OPS.setFont?[ops.argsArray[i]]:[]),binding=bindings[pageIndex];
   if(selected.length!==binding.events.length)return fail();const aliases=new Map<string,string>();
   for(let i=0;i<selected.length;i++){const [alias,size]=selected[i];if(typeof alias!=='string'||size!==binding.events[i].size||(aliases.has(alias)&&aliases.get(alias)!==binding.refs[i]))return fail();aliases.set(alias,binding.refs[i]);}
   const actualAssets:SourceFontAsset[]=[],raw=await captureSourceGlyphs(page,page.getViewport({scale:1}).transform,sourceSha256,actualAssets,bytes,pageIndex+1);if(!raw)return fail();
   // Import may prove a semantic separator from adjacent original text origins.
   // Reproduce that same association; a logical gap is not a painted selector.
   const actual=associateSourceItems((await page.getTextContent({disableNormalization:true})).items,raw,page.getViewport({scale:1}).transform,actualAssets).flatMap(item=>item.glyphs);
   const actualFonts=new Map(actualAssets.map(asset=>[asset.id,asset])),actualMaps=new Map(actualAssets.map(asset=>[asset.id,new Map(asset.glyphMap.map(map=>[map.cid,map]))]));
   const counts=new Map<string,Map<string,number>>();
   for(const glyph of actual){const asset=actualFonts.get(glyph.fontId),map=actualMaps.get(glyph.fontId)?.get(glyph.cid),ref=aliases.get(glyph.resource);if(!ref||asset?.format!=='truetype'||!map||map.glyphId<=0||!asset.originalProgram&&(!isTrustedLegacyTrueTypeProgram(asset.bytes)||map.glyphId>=2783))continue;
    const key=signature(asset,map,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,glyph.baseline,glyph.size,glyph.color,glyph.characterSpacing??0,!!glyph.inferredGap),group=counts.get(ref)??new Map<string,number>();group.set(key,(group.get(key)??0)+1);counts.set(ref,group);
   }
   const savedSequence:string[]=[],coveredRefs=new Set([...allowed.values()].flatMap(refs=>[...refs]));
   for(const region of [...savedPage.regions].sort((a,b)=>a.order-b.order))if(region.kind==='text'&&region.sourceLayout){const graph=region.sourceLayout;
    for(const glyph of sourceGlyphs(region)){if(!allowed.has(glyph.fontId))continue;if(++total>100000)return fail();usedAssets.add(glyph.fontId);
     const asset=fonts.get(glyph.fontId),map=maps.get(glyph.fontId)?.get(glyph.cid);if(asset?.format!=='truetype'||asset.sourceSha256!==sourceSha256||graph.sourceSha256!==sourceSha256||!map||map.unicode!==glyph.unicode||glyph.inferredGap&&(glyph.unicode!==' '||!map.nonPainting))return fail();
     const key=signature(asset,map,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,graph.baseline,graph.fontSize,region.style.color,graph.version===3?graph.characterSpacing:0,!!glyph.inferredGap);
     const matches=[...allowed.get(glyph.fontId)!].filter(ref=>(counts.get(ref)?.get(key)??0)>0);if(matches.length!==1)return fail();const group=counts.get(matches[0])!;group.set(key,group.get(key)!-1);savedSequence.push(canonicalJson([matches[0],key]));
    }
   }
   const actualSequence=actual.flatMap(glyph=>{const ref=aliases.get(glyph.resource),asset=actualFonts.get(glyph.fontId),map=actualMaps.get(glyph.fontId)?.get(glyph.cid);if(!ref||!coveredRefs.has(ref)||!asset||!map)return[];return[canonicalJson([ref,signature(asset,map,glyph.unicode,glyph.operatorIndex,glyph.x,glyph.advance,glyph.baseline,glyph.size,glyph.color,glyph.characterSpacing??0,!!glyph.inferredGap)])];});
   if(canonicalJson(actualSequence)!==canonicalJson(savedSequence)||[...counts].some(([ref,group])=>coveredRefs.has(ref)&&[...group.values()].some(count=>count!==0)))return fail();
  }
  if(usedAssets.size!==allowed.size)return fail();
 }finally{await task.destroy();}
}

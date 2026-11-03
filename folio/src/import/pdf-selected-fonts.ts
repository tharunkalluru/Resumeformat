import {sourceShear,sourceShowCharacterSpacing} from '../layout/source-shear';
import {MAX_SOURCE_PAGES} from '../core/model';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream,PDFRef} from 'pdf-lib';
import {getDocument,OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {isTrustedLegacyTrueTypeProgram} from '../layout/legacy-tt-program';
import {FolioError} from '../core/errors';
import {canonicalJson,sha256Sync,type SourceFontAsset,type Template} from '../core/model';
import {checkSourceGraphBudget,sourceGlyphs} from '../core/source-graph';
import {originalTfEvents} from './pdf-original-tt';
import {originalPageContent,originalOperators,originalDirectImageResources} from './pdf-image-trace';
import {usesOnlyNonembeddedStandardFonts,isNonembeddedStandardFontName} from './pdf-standard-fonts';
import type {SourcePaintGlyph} from './pdf-source';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';

const fail=():never=>{throw new FolioError('PDF_SOURCE_PROOF','The selected original font resource and complete painted ownership cannot be established.');};
const fileKeys=['FontFile','FontFile2','FontFile3'];
export interface SelectedFontPage {pageNumber:number;embedded:boolean;events:readonly {resourceName:string;size:number}[];refs?:readonly string[]}
/** Presence is source authority, never permission or a supported physical adapter. No font stream is decoded here. */
export async function selectedOriginalFonts(bytes:Uint8Array):Promise<SelectedFontPage[]> {
 if(!(bytes instanceof Uint8Array)||bytes.length>10*1024*1024)return fail();
 if(!new TextDecoder('ascii').decode(bytes.subarray(0,1024)).includes('%PDF-'))return [];
 try {
  const document=await PDFDocument.load(new Uint8Array(bytes));if(document.getPageCount()>MAX_SOURCE_PAGES)return fail();const result:SelectedFontPage[]=[];
  for(const [pageIndex,page] of document.getPages().entries()){
   const text=originalPageContent(document,pageIndex+1),operators=originalOperators(text),images=operators.some(o=>o.word==='Do');if(images)originalDirectImageResources(document,pageIndex+1,text);
   const resources=page.node.Resources();
   for(const op of operators.filter(o=>o.word==='gs')){const name=op.args[0];if(op.args.length!==1||!name||typeof name!=='object'||!('name' in name))return fail();const states=resources?.lookupMaybe(PDFName.of('ExtGState'),PDFDict),state=states?.lookup(PDFName.of(String(name.name)));if(!(state instanceof PDFDict)||state.has(PDFName.of('Font')))return fail();}
   if(!operators.some(o=>o.word==='Tf')){if(operators.some(o=>['Tj','TJ',"'",'"'].includes(o.word)))return fail();result.push({pageNumber:pageIndex+1,embedded:false,events:[]});continue;}
   const trace=originalTfEvents(text,images),fonts=resources?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!fonts||fonts.entries().length>100000)return fail();let embedded=false,nonembedded=false;const seen=new Set<string>(),refs:string[]=[];
   for(const event of trace.events){const ref=fonts.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef))return fail();refs.push(ref.toString());if(seen.has(ref.toString()))continue;seen.add(ref.toString());const dict=document.context.lookup(ref);if(!(dict instanceof PDFDict))return fail();let owner=dict;
    const subtype=dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText();if(subtype==='Type0'){const descendants=dict.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(!descendants||descendants.size()!==1)return fail();const child=descendants.lookup(0);if(!(child instanceof PDFDict)||!['CIDFontType0','CIDFontType2'].includes(child.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()??''))return fail();owner=child;}
    else if(!['Type1','TrueType','MMType1'].includes(subtype??''))return fail();
    // A file entry in the wrong dictionary is malformed, not absent.
    if(fileKeys.some(key=>dict.has(PDFName.of(key))||owner!==dict&&owner.has(PDFName.of(key))))return fail();
    let ownsProgram=false;if(owner.has(PDFName.of('FontDescriptor'))){const descriptor=owner.lookup(PDFName.of('FontDescriptor'));if(!(descriptor instanceof PDFDict))return fail();const present=fileKeys.filter(key=>descriptor.has(PDFName.of(key)));if(present.length>1)return fail();for(const key of present){const stream=descriptor.lookup(PDFName.of(key));if(!(stream instanceof PDFRawStream)||stream.getContents().length>4*1024*1024)return fail();embedded=true;ownsProgram=true;}}
    if(!ownsProgram){if(subtype!=='Type1')return fail();if(!isNonembeddedStandardFontName(dict.lookupMaybe(PDFName.of('BaseFont'),PDFName)?.decodeText()??''))throw new FolioError('PDF_SOURCE_PROOF','A decoder-provided font program has no embedded original source owner.');nonembedded=true;}
   }
   if(embedded&&(seen.size>32||nonembedded))return fail();result.push({pageNumber:pageIndex+1,embedded,events:trace.events,refs});
  }
  return result;
 }catch(error){if(error instanceof FolioError&&error.code==='PDF_SOURCE_PROOF')throw error;return fail();}
}

/** Exactly bind every source selection; decoded names are aliases, not original owners. */
export function bindSelectedOriginalFonts(selected:SelectedFontPage,ops:{fnArray:number[];argsArray:any[][]}):void {
 if(ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return fail();
 const decoded=ops.fnArray.flatMap((op,index)=>op===OPS.setFont?[ops.argsArray[index]]:[]);if(decoded.length!==selected.events.length)return fail();
 const byRef=new Map<string,string>(),byAlias=new Map<string,string>();
 for(let i=0;i<decoded.length;i++){const args=decoded[i],event=selected.events[i],ref=selected.refs?.[i];if(!ref||args.length!==2||typeof args[0]!=='string'||!args[0]||args[0].length>128||args[1]!==event.size)return fail();if(byRef.has(ref)&&byRef.get(ref)!==args[0]||byAlias.has(args[0])&&byAlias.get(args[0])!==ref)return fail();byRef.set(ref,args[0]);byAlias.set(args[0],ref);if(byAlias.size>32)return fail();}
}

/** Mandatory actual-source gate before any project label/version/legacy fallback. */
export async function validateSelectedOriginalFonts(bytes:Uint8Array,template:Template):Promise<void>{
 if(template.sourceType1Baseline){await(await import('./pdf-type1-baseline')).validateType1BaselineSource(bytes,template);return;}
 checkSourceGraphBudget(template);const fonts=template.sourceFonts??[];if(fonts.length>32||fonts.some(f=>f.bytes.length>4*1024*1024)||fonts.reduce((n,f)=>n+f.bytes.length+('originalProgram'in f?f.originalProgram?.bytes.length??0:0),0)>16*1024*1024)return fail();
 const pages=await selectedOriginalFonts(bytes);if(!pages.length)return;if(pages.length!==template.pages.length)return fail();if(!pages.some(p=>p.embedded))return;
 const task=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(bytes),fontExtraProperties:true,stopAtErrors:true,maxImageSize:20000000,verbosity:0});
 try{
  const pdf=await task.promise;if(pdf.numPages!==template.pages.length)return fail();const {captureSourceGlyphs,associateSourceItems}=await import('./pdf-source');
  const legacy=new Map<SourceFontAsset,boolean>();const isLegacy=(font:SourceFontAsset)=>{let valid=legacy.get(font);if(valid===undefined){valid=font.format==='truetype'&&!font.originalProgram&&isTrustedLegacyTrueTypeProgram(font.bytes);legacy.set(font,valid);}return valid;};
  const keys=new Map<SourceFontAsset,string>();const assetKey=(font:SourceFontAsset)=>{let key=keys.get(font);if(key)return key;key=isLegacy(font)?canonicalJson(['legacy']):canonicalJson({...font,id:undefined,sourceResource:undefined,bytes:undefined,glyphMap:undefined,...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:undefined}}:{}),shapeMap:undefined});keys.set(font,key);return key;};
  const actual:SourceFontAsset[]=[],captured:{selected:SelectedFontPage;associated:SourcePaintGlyph[]}[]=[];let glyphCount=0;
  for(const selected of pages){if(!selected.events.length)continue;const page=await pdf.getPage(selected.pageNumber),ops=await page.getOperatorList();
   if(!selected.embedded){if(!await usesOnlyNonembeddedStandardFonts(bytes,selected.pageNumber,ops,true))return fail();continue;}
   bindSelectedOriginalFonts(selected,ops);
   const viewport=page.getViewport({scale:1}),graph=await captureSourceGlyphs(page,viewport.transform,sha256Sync(bytes),actual,bytes,selected.pageNumber);if(!graph)return fail();
   const associated=associateSourceItems((await page.getTextContent({disableNormalization:true})).items,graph,viewport.transform,actual).flatMap(part=>part.glyphs);glyphCount+=associated.length;if(glyphCount>100000)return fail();captured.push({selected,associated});
  }
  // Assets may acquire a stricter original selector contract on a later page.
  // Match only after the complete capture, exactly as fresh import does.
  for(const {selected,associated} of captured){
   const byActual=new Map(actual.map(f=>[f.id,f])),bySaved=new Map(fonts.map(f=>[f.id,f]));
   const mappingIndexes=new Map<SourceFontAsset,Map<number,SourceFontAsset['glyphMap'][number]>>();
   const signature=(font:SourceFontAsset|undefined,glyph:{cid:number;unicode:string;x:number;advance:number;operatorIndex:number;inferredGap?:true},baseline:number,size:number,color:string,spacing:number,shear:number)=>{if(!font)return fail();let maps=mappingIndexes.get(font);if(!maps){maps=new Map(font.glyphMap.map(m=>[m.cid,m]));mappingIndexes.set(font,maps);}const mapping=maps.get(glyph.cid);if(!mapping)return fail();return canonicalJson([assetKey(font),isLegacy(font)?[mapping.glyphId,mapping.unicode,mapping.pdfWidth]:{...mapping,cid:undefined},glyph.unicode,glyph.x,glyph.advance,glyph.operatorIndex,!!glyph.inferredGap,baseline,size,color,spacing,shear]);};
   const expected=associated.map(g=>g.shapeOnly?canonicalJson(['shape',assetKey(byActual.get(g.fontId)!),g.glyphId,g.fontChar,g.originalCharCode,g.x,g.baseline,g.size,g.color,g.operatorIndex]):signature(byActual.get(g.fontId),g,g.baseline,g.size,g.color,g.characterSpacing??0,g.shearX??0));
   const saved:string[]=[];for(const region of [...template.pages[selected.pageNumber-1].regions].sort((a,b)=>a.order-b.order)){
    if(region.kind==='sourceShape'){const font=bySaved.get(region.sourceFontId);if(!font)return fail();saved.push(canonicalJson(['shape',assetKey(font),region.glyphId,region.fontChar,region.originalCharCode,region.sourceX,region.sourceBaseline,region.fontSize,region.color,region.operatorIndex]));}
    else if(region.kind==='text'){if(!region.sourceLayout)return fail();for(const glyph of sourceGlyphs(region))saved.push(signature(bySaved.get(glyph.fontId),glyph,region.sourceLayout.baseline,region.sourceLayout.fontSize,region.style.color,sourceShowCharacterSpacing(region.sourceLayout,glyph.operatorIndex),sourceShear(region.sourceLayout)));}
   }
   if(canonicalJson(expected)!==canonicalJson(saved))return fail();
  }
 }finally{await task.destroy();}
}

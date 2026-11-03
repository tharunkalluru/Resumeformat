import {sourceGlyphs} from '../core/source-graph';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument} from 'pdf-lib';
import type {SourceFontAssetV2,SourceFontAssetV9,SourceGlyphMappingV2,TextRegion,SourcePositionedGlyph} from '../core/model';
import {canonicalJson,sha256Sync} from '../core/model';
import {FolioError} from '../core/errors';
import {loadSourceFont,parseSourceProgram} from '../layout/source-fonts';
import {installSourceCidMap,paintSourceGlyphs} from '../render/source-pdf';

export const CFF_BROWSER_ADAPTER_VERSION='folio-browser-source-cff-v2';
const MAX_PROGRAM=4*1024*1024;
function fail(message:string):never{throw new FolioError('SOURCE_BROWSER_CFF',message);}
export interface BrowserCffFontDerivation {
 bytes:Uint8Array;sha256:string;sourceProgramSha256:string;sourceSha256:string;assetId:string;assetIdentity:string;
 adapterVersion:typeof CFF_BROWSER_ADAPTER_VERSION;family:string;coveredScalars:string[];
 /** Registration/shape fidelity is separate from actual native selection/caret proof. */
 nativeCaretVerified:false;
}
export function browserCffAssetIdentity(asset:SourceFontAssetV2|SourceFontAssetV9):string {
 return sha256Sync(new TextEncoder().encode(canonicalJson({version:CFF_BROWSER_ADAPTER_VERSION,id:asset.id,sourceSha256:asset.sourceSha256,sha256:asset.sha256,sourceVersion:asset.sourceVersion,declaredStyle:asset.declaredStyle,glyphMap:asset.glyphMap,shapeMap:asset.shapeMap,...(asset.sourceVersion===9?{originalProgram:asset.originalProgram.sha256,originalCff:asset.originalCff}: {})})));
}
export function browserCffFontFamily(asset:SourceFontAssetV2|SourceFontAssetV9):string {return `FolioSource-${browserCffAssetIdentity(asset).slice(0,32)}`;}
export interface NativeCffCaretProof {assetId:string;assetIdentity:string;derivativeSha256:string;family:string;adapterVersion:typeof CFF_BROWSER_ADAPTER_VERSION;coveredScalarsHash:string;status:'verified'}
export const cffCoveredScalarsHash=(derivation:BrowserCffFontDerivation)=>sha256Sync(new TextEncoder().encode(canonicalJson(derivation.coveredScalars)));

/** Browser Range edges can round outward on a 1/64 CSS-pixel layout grid. */
export const NATIVE_CFF_RANGE_EDGE_BOUND_PX=1/64;
type NativeRangeEdges={x:number;width:number};
export function nativeCffScalarRangeMatches(advance:number,first:NativeRangeEdges,second:NativeRangeEdges):boolean {
 if(![advance,first.x,first.width,second.x,second.width].every(Number.isFinite)||advance<0||first.width<0||second.width<0)return false;
 const bound=NATIVE_CFF_RANGE_EDGE_BOUND_PX+1e-7;
 // Test edges separately: the second selected width combines two rounded edges.
 return Math.abs(first.width-advance)<=bound&&Math.abs(second.x-first.x-advance)<=bound&&Math.abs(second.x+second.width-first.x-2*advance)<=bound;
}

function checksum(bytes:Uint8Array):number {let sum=0;for(let i=0;i<bytes.length;i+=4)sum=(sum+(((bytes[i]??0)*0x1000000+(bytes[i+1]??0)*0x10000+(bytes[i+2]??0)*0x100+(bytes[i+3]??0))>>>0))>>>0;return sum;}
/** Only the PDF.js-derived CFF cmap and horizontal metrics change; all outlines stay intact. */
export function rewriteCffEditingMetrics(bytes:Uint8Array,mappings:ReadonlyMap<number,{glyphId:number;pdfWidth:number}>):Uint8Array {
 const font=parseSourceProgram(bytes,'opentype-cff'),input=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),count=input.getUint16(4);
 if(mappings.size>65535)fail('The CFF browser map exceeds its bounded logical-code limit.');
 const tables=new Map<number,Uint8Array>();for(let i=0;i<count;i++){const at=12+i*16;tables.set(input.getUint32(at),bytes.slice(input.getUint32(at+8),input.getUint32(at+8)+input.getUint32(at+12)));}
 const head=tables.get(0x68656164),hhea=tables.get(0x68686561),hmtx=tables.get(0x686d7478);
 if(!head||head.length<54||!hhea||hhea.length<36||!hmtx||!tables.has(0x636d6170))fail('The derived CFF horizontal metrics are incomplete.');
 const hv=new DataView(hhea.buffer),metricsCount=hv.getUint16(34),old=new DataView(hmtx.buffer);
 if(metricsCount<1||metricsCount>font.numGlyphs||hmtx.length<metricsCount*4+(font.numGlyphs-metricsCount)*2)fail('The derived CFF horizontal metrics are malformed.');
 const full=new Uint8Array(font.numGlyphs*4),metrics=new DataView(full.buffer),widths=new Map<number,number>();
 for(let gid=0;gid<font.numGlyphs;gid++){metrics.setUint16(gid*4,old.getUint16(Math.min(gid,metricsCount-1)*4));metrics.setInt16(gid*4+2,old.getInt16(gid<metricsCount?gid*4+2:metricsCount*4+(gid-metricsCount)*2));}
 const ordered=[...mappings].sort(([a],[b])=>a-b),cmap=new Uint8Array(36+ordered.length*12),cv=new DataView(cmap.buffer);
 cv.setUint16(2,2);cv.setUint16(4,0);cv.setUint16(6,4);cv.setUint32(8,20);cv.setUint16(12,3);cv.setUint16(14,10);cv.setUint32(16,20);cv.setUint16(20,12);cv.setUint32(24,cmap.length-20);cv.setUint32(32,ordered.length);
 ordered.forEach(([code,map],i)=>{
  if(!Number.isInteger(code)||code<0||code>0x10ffff||code>=0xd800&&code<=0xdfff||!Number.isInteger(map.glyphId)||map.glyphId<=0||map.glyphId>=font.numGlyphs||!Number.isFinite(map.pdfWidth)||map.pdfWidth<0||map.pdfWidth>10000)fail('The derived CFF scalar/positive-glyph map is invalid.');
  const width=Math.round(map.pdfWidth*font.unitsPerEm/1000),previous=widths.get(map.glyphId);if(previous!==undefined&&previous!==width)fail('A derived CFF glyph has incompatible native advances.');widths.set(map.glyphId,width);metrics.setUint16(map.glyphId*4,width);
  const at=36+i*12;cv.setUint32(at,code);cv.setUint32(at+4,code);cv.setUint32(at+8,map.glyphId);
 });
 hv.setUint16(34,font.numGlyphs);tables.set(0x686d7478,full);tables.set(0x636d6170,cmap);new DataView(head.buffer).setUint32(8,0);
 const sorted=[...tables].sort(([a],[b])=>a-b),size=12+count*16+sorted.reduce((sum,[,data])=>sum+Math.ceil(data.length/4)*4,0);
 if(size>MAX_PROGRAM)fail('The derived CFF program exceeds its local byte limit.');
 const output=new Uint8Array(size),view=new DataView(output.buffer);output.set(bytes.slice(0,12));let offset=12+count*16,headOffset=0;
 sorted.forEach(([tag,data],i)=>{const at=12+i*16;view.setUint32(at,tag);view.setUint32(at+4,checksum(data));view.setUint32(at+8,offset);view.setUint32(at+12,data.length);output.set(data,offset);if(tag===0x68656164)headOffset=offset;offset+=Math.ceil(data.length/4)*4;});
 view.setUint32(headOffset+8,(0xb1b0afba-checksum(output))>>>0);parseSourceProgram(output,'opentype-cff');return output;
}
/** Neutral in-memory bridge: no source page, applicant prose, network font, or stored mutation. */
export async function deriveBrowserCffFont(asset:SourceFontAssetV2|SourceFontAssetV9):Promise<BrowserCffFontDerivation> {
 const face=loadSourceFont(asset),selected:SourceGlyphMappingV2[]=[],codes=new Set<string>();
 for(const entry of asset.glyphMap){if(entry.editPolicy!=='coveredScalar'||codes.has(entry.unicode))continue;const mapping=face.mapping(entry.unicode);if(!mapping)continue;selected.push(mapping as SourceGlyphMappingV2);codes.add(entry.unicode);}
 if(!selected.length)fail('This CFF face has no proved scalar editing map. Its canonical SVG/PDF remains available.');
 const document=await PDFDocument.create({updateMetadata:false});document.registerFontkit(fontkit);const embedded=await document.embedFont(asset.bytes,{subset:false}),page=document.addPage([240,240]);
 paintSourceGlyphs(page,embedded,asset,selected.map(entry=>({fontId:asset.id,cid:entry.cid,unicode:entry.unicode,x:30,advance:entry.pdfWidth*12/1000,operatorIndex:0})),120,12,'#000000');
 await document.flush();installSourceCidMap(document,embedded,asset);const bytes=new Uint8Array(await document.save());
 const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs'),loading=getDocument({data:bytes,useSystemFonts:false,fontExtraProperties:true,stopAtErrors:true,verbosity:0});
 try {
  const pdf=await loading.promise,convertedPage=await pdf.getPage(1),ops=await convertedPage.getOperatorList(),glyphs:{unicode:string;fontChar:string;width:number}[]=[];let resourceName='';
  for(let i=0;i<ops.fnArray.length;i++){if(ops.fnArray[i]===OPS.setFont){const next=String(ops.argsArray[i][0]);if(resourceName&&resourceName!==next)fail('The neutral CFF bridge returned multiple font resources.');resourceName=next;}if(ops.fnArray[i]===OPS.showText)for(const glyph of ops.argsArray[i][0]){if(typeof glyph!=='object'||glyph.accent)fail('The neutral CFF bridge returned an unresolved glyph.');glyphs.push(glyph);}}
  if(glyphs.length!==selected.length)fail('The neutral CFF bridge did not preserve complete scalar ownership.');
  const converted=convertedPage.commonObjs.get(resourceName) as {data?:Uint8Array};if(!converted.data)fail('The neutral CFF bridge returned no bounded program.');
  const convertedFont=parseSourceProgram(converted.data,'opentype-cff'),mappings=new Map<number,{glyphId:number;pdfWidth:number}>();
  glyphs.forEach((glyph,i)=>{const source=selected[i];if(glyph.unicode!==source.unicode||Array.from(glyph.fontChar).length!==1||Math.abs(glyph.width-source.pdfWidth)>.000001)fail('The neutral CFF bridge changed Unicode or source widths.');const gid=convertedFont.glyphForCodePoint(glyph.fontChar.codePointAt(0)!).id,path=convertedFont.getGlyph(gid).path.toSVG();if(gid<=0||path!==face.font.getGlyph(source.glyphId).path.toSVG()||source.nonPainting&&path!=='')fail('The neutral CFF bridge changed a scalar outline or lacks a positive empty glyph.');mappings.set(source.unicode.codePointAt(0)!,{glyphId:gid,pdfWidth:source.pdfWidth});});
  const derivative=rewriteCffEditingMetrics(converted.data,mappings),verified=fontkit.create(derivative);
  for(const [code,map] of mappings){const glyph=verified.glyphForCodePoint(code);if(glyph.id!==map.glyphId||glyph.advanceWidth!==Math.round(map.pdfWidth*verified.unitsPerEm/1000)||glyph.path.toSVG()!==convertedFont.getGlyph(map.glyphId).path.toSVG())fail('The rebuilt CFF browser program failed its outline/advance proof.');}
  return {bytes:derivative,sha256:sha256Sync(derivative),sourceProgramSha256:asset.sha256,sourceSha256:asset.sourceSha256,assetId:asset.id,assetIdentity:browserCffAssetIdentity(asset),adapterVersion:CFF_BROWSER_ADAPTER_VERSION,family:browserCffFontFamily(asset),coveredScalars:selected.map(entry=>entry.unicode),nativeCaretVerified:false};
 } finally {await loading.destroy();}
}
/** A native proof is scoped to the current owned face and exact derivative. */
export function cffRegionEditAvailability(region:TextRegion,asset:SourceFontAssetV2|SourceFontAssetV9,derivation:BrowserCffFontDerivation|undefined,proof:NativeCffCaretProof|undefined,currentGlyphs?:readonly SourcePositionedGlyph[]):{editable:boolean;reason?:string} {
 if(asset.sourceVersion===9&&(asset.originalCff.permission.fsType===4||region.sourceScopedPaint?.color.space==='ICCBased'||region.sourceLayout?.version!==1||!currentGlyphs))return {editable:false,reason:'This original CFF owner has no supported current native geometry.'};
 if(asset.sourceVersion!==9&&region.sourceLayout?.version!==2)return {editable:false,reason:'This region has no version2 CFF source graph.'};
 if(region.sourceLayout?.version===2&&region.sourceLayout.editPolicy==='baselineOnly')return {editable:false,reason:'This source region contains a ligature or unproved mapping; its exact source text remains readable.'};
 const identity=browserCffAssetIdentity(asset),family=browserCffFontFamily(asset);
 try{loadSourceFont(asset);}catch{return {editable:false,reason:'The current source face failed its program/map proof.'};}
 if(!derivation||!proof||region.style.sourceFontId!==asset.id||region.sourceLayout?.sourceSha256!==asset.sourceSha256||derivation.assetId!==asset.id||derivation.assetIdentity!==identity||derivation.sourceProgramSha256!==asset.sha256||derivation.sourceSha256!==asset.sourceSha256||derivation.family!==family||derivation.adapterVersion!==CFF_BROWSER_ADAPTER_VERSION||sha256Sync(derivation.bytes)!==derivation.sha256||proof.assetId!==asset.id||proof.assetIdentity!==identity||proof.derivativeSha256!==derivation.sha256||proof.family!==family||proof.adapterVersion!==CFF_BROWSER_ADAPTER_VERSION||proof.coveredScalarsHash!==cffCoveredScalarsHash(derivation)||proof.status!=='verified')return {editable:false,reason:'Native selection and caret mapping for this exact current derivative have not been verified.'};
 if(!Array.from(sourceGlyphs(region)).every(g=>Array.from(g.unicode).every(c=>derivation.coveredScalars.includes(c))))return {editable:false,reason:'This source region has no complete proved native scalar mapping.'};
 if(asset.sourceVersion===9){
  const glyphs=currentGlyphs!,span=document.createElement('span');
  Object.assign(span.style,{position:'fixed',left:'0',top:'0',visibility:'hidden',whiteSpace:'pre',fontFamily:family,fontWeight:'500',fontStyle:'normal',fontSize:`${region.sourceLayout!.fontSize}pt`,fontKerning:'none',fontSynthesis:'none',fontVariantLigatures:'none',letterSpacing:'0'});document.body.append(span);
  try{if(!glyphs.length||glyphs.length>5000)throw Error();span.textContent=glyphs.map(g=>g.unicode).join('');const text=span.firstChild!,base=span.getBoundingClientRect().x;let offset=0;for(const glyph of glyphs){const range=document.createRange();range.setStart(text,offset);const start=document.createRange();start.setStart(text,offset);start.collapse(true);offset+=glyph.unicode.length;range.setEnd(text,offset);const actual=range.getBoundingClientRect(),expected=(glyph.x-glyphs[0].x)*4/3;if(!Number.isFinite(actual.x)||!Number.isFinite(actual.width)||actual.height<=0||Math.abs(actual.x-base-expected)>.06||Math.abs(actual.width-glyph.advance*4/3)>.06||Math.abs(start.getBoundingClientRect().x-base-expected)>.06)throw Error();}
   const last=glyphs.at(-1)!,endpoint=(last.x+last.advance-glyphs[0].x)*4/3,terminal=document.createRange();terminal.setStart(text,offset);terminal.collapse(true);const edge=terminal.getBoundingClientRect();if(!Number.isFinite(edge.x)||edge.height<=0||Math.abs(edge.x-base-endpoint)>.06)throw Error();
   const full=document.createRange();full.setStart(text,0);full.setEnd(text,offset);const rect=full.getBoundingClientRect();if(!Number.isFinite(rect.width)||Math.abs(rect.x-base)>.06||Math.abs(rect.width-endpoint)>.06)throw Error();
  }
  catch{return {editable:false,reason:'The current original CFF native range and caret geometry has not passed the unchanged tolerance.'};}finally{span.remove();}
 }
 return {editable:true};
}
/** Runs after this exact FontFace was loaded/added. No text, font or request leaves the page. */
export function verifyNativeCffCaret(asset:SourceFontAssetV2|SourceFontAssetV9,derivation:BrowserCffFontDerivation):NativeCffCaretProof {
 if(typeof document==='undefined'||typeof document.createRange!=='function'||!document.fonts||derivation.coveredScalars.length>1000||derivation.assetId!==asset.id||derivation.sourceProgramSha256!==asset.sha256||derivation.sourceSha256!==asset.sourceSha256||derivation.adapterVersion!==CFF_BROWSER_ADAPTER_VERSION||derivation.assetIdentity!==browserCffAssetIdentity(asset)||derivation.family!==browserCffFontFamily(asset)||sha256Sync(derivation.bytes)!==derivation.sha256)fail('The current CFF face has no bounded native caret environment.');
 const face=loadSourceFont(asset),nativeFont=parseSourceProgram(derivation.bytes,'opentype-cff'),span=document.createElement('span');
 if(nativeFont.unitsPerEm!==asset.unitsPerEm)fail('The current CFF derivative has different native font units.');
 Object.assign(span.style,{position:'fixed',left:'0',top:'0',visibility:'hidden',whiteSpace:'pre',fontFamily:`"${derivation.family}"`,fontWeight:String(asset.declaredStyle.weightClass??500),fontStyle:asset.declaredStyle.italic?'italic':'normal',fontSize:'100px',fontSynthesis:'none',fontKerning:'none',fontVariantLigatures:'none',fontFeatureSettings:'"kern" 0, "liga" 0, "clig" 0',letterSpacing:'0',padding:'0',margin:'0'});
 document.body.append(span);
 try{for(const scalar of derivation.coveredScalars){const map=face.mapping(scalar);if(!map||Array.from(scalar).length!==1||!document.fonts.check(`${asset.declaredStyle.italic?'italic ':''}${asset.declaredStyle.weightClass??500} 100px "${derivation.family}"`,scalar))fail('The exact CFF FontFace has not loaded for this scalar.');
  const nativeGlyph=nativeFont.glyphForCodePoint(scalar.codePointAt(0)!),roundedUnits=Math.round(map.pdfWidth*nativeFont.unitsPerEm/1000);
  // hmtx stores integer font units; PDF/layout still use the exact fractional PDF width.
  if(nativeGlyph.id<=0||nativeGlyph.advanceWidth!==roundedUnits||nativeGlyph.path.toSVG()!==face.font.getGlyph(map.glyphId).path.toSVG())fail('The current CFF derivative failed its scalar outline/integer-advance proof.');
  const expected=nativeGlyph.advanceWidth*100/nativeFont.unitsPerEm;
  if(Math.abs(expected-map.pdfWidth*.1)>50/nativeFont.unitsPerEm+1e-7)fail('The current CFF derivative exceeds integer-unit advance rounding.');
  span.textContent=scalar+scalar;const node=span.firstChild!;const first=document.createRange(),second=document.createRange();first.setStart(node,0);first.setEnd(node,scalar.length);second.setStart(node,scalar.length);second.setEnd(node,scalar.length*2);
  if(!nativeCffScalarRangeMatches(expected,first.getBoundingClientRect(),second.getBoundingClientRect()))fail('The exact CFF native scalar selection/caret advances are unproved.');}}
 finally{span.remove();}
 return {assetId:asset.id,assetIdentity:derivation.assetIdentity,derivativeSha256:derivation.sha256,family:derivation.family,adapterVersion:CFF_BROWSER_ADAPTER_VERSION,coveredScalarsHash:cffCoveredScalarsHash(derivation),status:'verified'};
}

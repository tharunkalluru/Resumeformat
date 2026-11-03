import {MAX_SOURCE_PAGES} from '../core/model';
import {boundDecodeBufferGrowth,type DecodeBufferAllocator} from './bounded-decode-buffer';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef,decodePDFRawStream} from 'pdf-lib';
import {OPS,type PDFPageProxy} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {sha256Sync} from '../core/model';
import {loadFont,fontKey} from '../layout/fonts';
import {originalTrueTypePermissions} from '../layout/source-fonts';
import {knownPdfFont,type PdfFontIdentity} from './pdf-fonts';
import {originalTfEvents} from './pdf-original-tt';
import {originalPageContent,originalOperators,originalDirectImageResources} from './pdf-image-trace';
import {parseOriginalToUnicode} from './pdf-to-unicode';

import {LICENSED_FONT_PINS,LICENSED_FONT_LICENSE_SHA,parseLicensedSubset} from '../layout/licensed-subset';
import type {OriginalTrueTypeProof} from './pdf-original-tt';
import type {LicensedSubsetDerivation} from '../core/model';
const named=(d:PDFDict,k:string,n:string)=>d.lookupMaybe(PDFName.of(k),PDFName)?.decodeText()===n;
export const licensedSubsetStreamBytes=(v:unknown,limit:number):Uint8Array=>{
 if(!(v instanceof PDFRawStream)||limit<1||v.contents.length>limit||v.dict.has(PDFName.of('DecodeParms')))throw Error('stream');
 const filter=v.dict.lookupMaybe(PDFName.of('Filter'),PDFName)?.decodeText();if(filter&&filter!=='FlateDecode')throw Error('filter');
 if(!filter)return new Uint8Array(v.contents);
 const decoder=decodePDFRawStream(v) as unknown as DecodeBufferAllocator & {getBytes:()=>Uint8Array};
 boundDecodeBufferGrowth(decoder,limit);
 const out=decoder.getBytes();if(out.length>limit)throw Error('stream size');return new Uint8Array(out);
};
const num=(v:unknown):number=>{if(!(v instanceof PDFNumber)||!Number.isFinite(v.asNumber())||v.asNumber()<0||v.asNumber()>10000)throw Error('width');return v.asNumber();};
export interface LicensedCatalogueProof {identity:PdfFontIdentity;original:OriginalTrueTypeProof}
/** Exact deterministic subset reconstruction licenses catalogue replacement only.
 * The returned physical programme is freshly reconstructed from the pinned licensed face; equality retains original subset selectors without claiming absent original permission metadata. */
export async function proveLicensedCatalogueSubsets(page:PDFPageProxy,bytes:Uint8Array,pageNumber:number,ops:{fnArray:number[];argsArray:any[][]}):Promise<Map<string,LicensedCatalogueProof>|undefined>{
 try{
  if(bytes.length>10*1024*1024||ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return;
  const document=await PDFDocument.load(new Uint8Array(bytes));if(document.getPageCount()>MAX_SOURCE_PAGES)return;const original=document.getPages()[pageNumber-1];if(!original)return;
  const text=originalPageContent(document,pageNumber),hasImages=originalOperators(text).some(o=>o.word==='Do');if(hasImages)originalDirectImageResources(document,pageNumber,text);
  const {events,graphicsStates}=originalTfEvents(text,hasImages),resources=original.node.Resources(),fonts=resources?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources||!fonts||fonts.entries().length>32)return;
  for(const name of graphicsStates){const state=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.lookupMaybe(PDFName.of(name),PDFDict);if(!state||state.has(PDFName.of('Font')))return;}
  const selections=ops.fnArray.flatMap((v,i)=>v===OPS.setFont?[ops.argsArray[i]]:[]);if(selections.length!==events.length)return;
  type Proof={owned:OriginalTrueTypeProof;identity:PdfFontIdentity;unicode:ReadonlyMap<number,string>;widths:Map<number,number>;advances:Map<number,number>};
  const proofs=new Map<string,Proof>(),aliases=new Map<string,string>(),refs=new Map<string,string>();let totalBytes=0,totalMappings=0;
  // Lazy browser-compatible encoder; exact version is a direct production dependency.
  const {create}=await import('fontkit');
  for(let i=0;i<events.length;i++){
   const event=events[i],selected=selections[i];if(selected.length!==2||typeof selected[0]!=='string'||selected[0].length>128||selected[1]!==event.size)return;
   const alias=selected[0],ref=fonts.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef))return;const key=ref.toString();if(aliases.has(alias)&&aliases.get(alias)!==key||refs.has(key)&&refs.get(key)!==alias)return;aliases.set(alias,key);refs.set(key,alias);if(aliases.size>32)return;
   if(proofs.has(key))continue;
   const identity=knownPdfFont(page,alias);if(!identity||identity.family==='times')return;
   const candidate=await loadFont(fontKey({fontFamily:identity.family,fontWeight:identity.fontWeight,italic:identity.italic})),fullBytes=new Uint8Array(candidate.bytes);if(fullBytes.length>4*1024*1024||sha256Sync(fullBytes)!==LICENSED_FONT_PINS[candidate.key])return;
   originalTrueTypePermissions(fullBytes);const full=create(fullBytes),font=document.context.lookup(ref,PDFDict);
   if(!named(font,'Subtype','Type0')||!named(font,'Encoding','Identity-H'))return;const base=font.lookupMaybe(PDFName.of('BaseFont'),PDFName)?.decodeText();if(base?.replace(/^[A-Z]{6}\+/,'')!==full.postscriptName)return;
   const children=font.lookupMaybe(PDFName.of('DescendantFonts'),PDFArray);if(!children||children.size()!==1)return;const child=children.lookup(0,PDFDict);if(!named(child,'Subtype','CIDFontType2')||!named(child,'CIDToGIDMap','Identity'))return;
   if(child.lookupMaybe(PDFName.of('BaseFont'),PDFName)?.decodeText().replace(/^[A-Z]{6}\+/,'')!==full.postscriptName)return;
   if(child.has(PDFName.of('DW')))num(child.lookup(PDFName.of('DW')));
   const descriptor=child.lookup(PDFName.of('FontDescriptor'),PDFDict);if(descriptor.has(PDFName.of('FontFile'))||descriptor.has(PDFName.of('FontFile3')))return;
   if(descriptor.lookupMaybe(PDFName.of('FontName'),PDFName)?.decodeText().replace(/^[A-Z]{6}\+/,'')!==full.postscriptName)return;
   const angle=descriptor.lookupMaybe(PDFName.of('ItalicAngle'),PDFNumber)?.asNumber(),flags=descriptor.lookupMaybe(PDFName.of('Flags'),PDFNumber)?.asNumber();if(angle!==full.italicAngle||!Number.isSafeInteger(flags)||Boolean(flags!&64)!==identity.italic)return;
   if(descriptor.has(PDFName.of('FontWeight'))&&descriptor.lookup(PDFName.of('FontWeight'),PDFNumber).asNumber()!==identity.fontWeight)return;
   const program=licensedSubsetStreamBytes(descriptor.lookup(PDFName.of('FontFile2')),Math.min(4*1024*1024,16*1024*1024-totalBytes));totalBytes+=program.length;if(totalBytes>16*1024*1024||program.length<12)return;
   const view=new DataView(program.buffer,program.byteOffset,program.byteLength),count=view.getUint16(4);if(![0x00010000,0x74727565].includes(view.getUint32(0))||count>128||12+count*16>program.length)return;
   for(let t=0;t<count;t++){const p=12+t*16;if(String.fromCharCode(...program.subarray(p,p+4))==='OS/2')originalTrueTypePermissions(program);}
   const cmapBytes=licensedSubsetStreamBytes(font.lookup(PDFName.of('ToUnicode')),Math.min(4*1024*1024,16*1024*1024-totalBytes));totalBytes+=cmapBytes.length;const unicode=parseOriginalToUnicode(new TextDecoder('latin1').decode(cmapBytes),2,true);totalMappings+=unicode.size;if(totalMappings>100000||unicode.size>65536||unicode.get(0)!=='\0')return;
   const widths=new Map<number,number>(),w=child.lookup(PDFName.of('W'),PDFArray);if(w.size()>100000)return;
   for(let n=0;n<w.size();){const first=num(w.lookup(n++));if(!Number.isInteger(first)||first>65535)return;const next=w.lookup(n++);if(!(next instanceof PDFArray)||next.size()>65536)return;for(let j=0;j<next.size();j++){const cid=first+j;if(cid>65535||widths.has(cid))return;widths.set(cid,num(next.lookup(j)));}}
   const subset=full.createSubset(),advances=new Map<number,number>();let nextCid=0;
   for(const [cid,value]of [...unicode].sort((a,b)=>a[0]-b[0])){if(cid!==nextCid++)return;if(cid===0)continue;if(Array.from(value).length!==1||/[\p{Control}\p{Format}\p{Surrogate}]/u.test(value))return;const glyph=full.glyphForCodePoint(value.codePointAt(0)!);if(glyph.id<=0||subset.includeGlyph(glyph.id)!==cid)return;const advance=glyph.advanceWidth*1000/full.unitsPerEm;if(!widths.has(cid)||Math.abs(widths.get(cid)!-advance)>.00001)return;advances.set(cid,advance);}
   const rebuilt=subset.encode();if(rebuilt.length!==program.length)return;for(let j=0;j<program.length;j++)if(program[j]!==rebuilt[j])return;
   const parsed=parseLicensedSubset(new Uint8Array(rebuilt));
   const licensedDerivation:LicensedSubsetDerivation={version:'licensed-catalogue-subset-v1',catalogueFace:candidate.key as LicensedSubsetDerivation['catalogueFace'],fullProgramSha256:sha256Sync(fullBytes),licenseSha256:LICENSED_FONT_LICENSE_SHA,encoderVersion:'fontkit-2.0.4',subsetProgramSha256:sha256Sync(rebuilt),originalPermission:parsed.originalPermission};
   const owned:OriginalTrueTypeProof={bytes:new Uint8Array(rebuilt),sha256:licensedDerivation.subsetProgramSha256,pdfFontRef:key,font:parsed.font,unicode,widths,defaultWidth:NaN,selectorContract:'identity-h-v1',requiresV6:true,licensedDerivation,catalogueIdentity:{...identity}};
   proofs.set(key,{owned,identity:{...identity},unicode,widths,advances});
  }
  let current='',painted=0;const stack:string[]=[],seen=new Set<string>();
  for(let i=0;i<ops.fnArray.length;i++){
   const op=ops.fnArray[i],args=ops.argsArray[i];if(op===OPS.save)stack.push(current);else if(op===OPS.restore){if(!stack.length)return;current=stack.pop()!;}else if(op===OPS.setFont)current=args[0];else if(op===OPS.showText||op===OPS.showSpacedText){const proof=proofs.get(aliases.get(current)??'');if(!proof||!Array.isArray(args[0]))return;for(const glyph of args[0]){if(typeof glyph==='number')continue;if(++painted>100000||!glyph||!Number.isInteger(glyph.originalCharCode)||glyph.originalCharCode<=0||glyph.unicode!==proof.unicode.get(glyph.originalCharCode)||!proof.advances.has(glyph.originalCharCode)||glyph.width!==proof.widths.get(glyph.originalCharCode))return;seen.add(current);}}
  }
  if(stack.length||!painted||seen.size!==aliases.size)return;
  return new Map([...aliases].map(([alias,key])=>[alias,{identity:{...proofs.get(key)!.identity},original:proofs.get(key)!.owned}]));
 }catch{return;}
}

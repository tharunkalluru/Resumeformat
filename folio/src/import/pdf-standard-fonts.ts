import {MAX_SOURCE_PAGES} from '../core/model';
import {PDFArray,PDFBool,PDFDict,PDFDocument,PDFHexString,PDFName,PDFNull,PDFNumber,PDFRef,PDFString} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {OPS} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {originalTfEvents} from './pdf-original-tt';
import {originalPageContent,originalOperators,originalDirectImageResources} from './pdf-image-trace';

const standard14=new Set(['Times-Roman','Times-Bold','Times-Italic','Times-BoldItalic','Helvetica','Helvetica-Bold','Helvetica-Oblique','Helvetica-BoldOblique','Courier','Courier-Bold','Courier-Oblique','Courier-BoldOblique','Symbol','ZapfDingbats']);
export const isNonembeddedStandardFontName=(name:string):boolean=>standard14.has(name);
const files=['FontFile','FontFile2','FontFile3'];
/** PDF.js can supply bundled program bytes for a nonembedded Standard14 source.
 * This proves only the existing catalogue route, never original font ownership.
 * Every actual top-level selection must bind; uncertainty keeps normal proofs. */
export async function usesOnlyNonembeddedStandardFonts(bytes:Uint8Array,pageNumber:number,ops:{fnArray:number[];argsArray:any[][]},rejectUnembeddedUnknown=false):Promise<boolean>{
 try{
  if(!(bytes instanceof Uint8Array)||bytes.length>10*1024*1024||ops.fnArray.length>100000||ops.fnArray.length!==ops.argsArray.length)return false;
  const document=await PDFDocument.load(new Uint8Array(bytes));if(document.getPageCount()>MAX_SOURCE_PAGES)return false;
  const page=document.getPages()[pageNumber-1];if(!page)return false;
  const text=originalPageContent(document,pageNumber),operators=originalOperators(text),images=operators.some(o=>o.word==='Do');if(images)originalDirectImageResources(document,pageNumber,text);
  const {events,graphicsStates}=originalTfEvents(text,images),resources=page.node.Resources(),fonts=resources?.lookupMaybe(PDFName.of('Font'),PDFDict);if(!resources||!fonts||fonts.entries().length>100000)return false;
  for(const name of graphicsStates){const states=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict),state=states?.lookupMaybe(PDFName.of(name),PDFDict);if(!state||state.has(PDFName.of('Font')))return false;}
  const selected=ops.fnArray.flatMap((op,i)=>op===OPS.setFont?[ops.argsArray[i]]:[]);if(selected.length!==events.length)return false;
  let signatureWork=0;
  const bounded=(value:unknown,depth=0,seen=new Set<string>()):boolean=>{
   if(depth>8||++signatureWork>100000)return false;
   if(value instanceof PDFRef){const key=value.toString();if(seen.has(key))return false;const next=new Set(seen);next.add(key);const resolved=document.context.lookup(value);return !(resolved instanceof PDFRef)&&bounded(resolved,depth+1,next);}
   if(value instanceof PDFDict){const entries=value.entries();return entries.length<=32&&entries.every(([key,v])=>key.decodeText().length<=128&&bounded(v,depth+1,seen));}
   if(value instanceof PDFArray)return value.size()<=256&&Array.from({length:value.size()},(_,i)=>value.get(i)).every(v=>bounded(v,depth+1,seen));
   if(value instanceof PDFName)return value.decodeText().length<=256;
   if(value instanceof PDFNumber)return Number.isFinite(value.asNumber());
   if(value instanceof PDFString||value instanceof PDFHexString)return value.asBytes().length<=4096;
   return value===PDFNull||value instanceof PDFBool;
  };
  const byAlias=new Map<string,string>(),byRef=new Map<string,string>(),signatures=new Map<string,string>();
  for(let i=0;i<events.length;i++){
   const event=events[i],decoded=selected[i];if(decoded.length!==2||typeof decoded[0]!=='string'||!decoded[0]||decoded[0].length>128||decoded[1]!==event.size)return false;
   const ref=fonts.get(PDFName.of(event.resourceName));if(!(ref instanceof PDFRef))return false;const key=ref.toString();let signature=signatures.get(key);
   if(!signature){
    const font=document.context.lookup(ref);if(!(font instanceof PDFDict)||font.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Type1')return false;
    const base=font.lookupMaybe(PDFName.of('BaseFont'),PDFName)?.decodeText();if(files.some(k=>font.has(PDFName.of(k))))return false;
    if(font.has(PDFName.of('FontDescriptor'))){const descriptor=font.lookup(PDFName.of('FontDescriptor'));if(!(descriptor instanceof PDFDict)||files.some(k=>descriptor.has(PDFName.of(k))))return false;}
    if(!base||!standard14.has(base)){if(rejectUnembeddedUnknown)throw new FolioError('PDF_SOURCE_PROOF','A decoder-provided font program has no embedded original source owner.');return false;}
    if(!bounded(font))return false;signature=font.toString();if(signature.length>65536)return false;signatures.set(key,signature);
   }
   if(byAlias.has(decoded[0])&&byAlias.get(decoded[0])!==signature||byRef.has(key)&&byRef.get(key)!==decoded[0])return false;
   byAlias.set(decoded[0],signature);byRef.set(key,decoded[0]);if(byAlias.size>32)return false;
  }
  return events.length>0;
 }catch(error){if(error instanceof FolioError&&error.code==='PDF_SOURCE_PROOF')throw error;return false;}
}

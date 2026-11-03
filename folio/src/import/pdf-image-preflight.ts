import {captureType3BitmapFont} from './pdf-type3-bitmap';
import {MAX_SOURCE_PAGES} from '../core/model';
import {originalIccSpaces} from './pdf-icc';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFRawStream,PDFRef,EncryptedPDFError} from 'pdf-lib';
import {sha256Sync} from '../core/model';
import {FolioError} from '../core/errors';
import {originalOperators} from './pdf-image-trace';
import {decodeBoundedContentStream} from './bounded-content-stream';

const MAX_PIXELS=20000000,MAX_PDF_BYTES=32*1024*1024,MAX_STREAM_BYTES=10*1024*1024,MAX_MASK_BYTES=20*1024*1024,MAX_CONTENT=16*1024*1024,MAX_CONTENT_STREAM=4*1024*1024,MAX_IMAGE_REFS=30*MAX_SOURCE_PAGES,MAX_OPERATOR_WORK=100000;
const cache=new Set<string>();
const fail=():never=>{throw new FolioError('PDF_IMAGE_PREFLIGHT','The original raster resources exceed the bounded image, mask, stream or operator inventory.');};
/** Metadata and bounded raw stream inventory before PDF.js may allocate raster pixels. */
export async function preflightPdfImages(bytes:Uint8Array):Promise<void>{
 if(bytes.length>MAX_PDF_BYTES)return fail();const key=sha256Sync(bytes);if(cache.has(key))return;let pdf:PDFDocument;
 try{pdf=await PDFDocument.load(new Uint8Array(bytes));}catch(error){if(error instanceof EncryptedPDFError)throw new FolioError('ENCRYPTED_DOCUMENT','Encrypted PDFs are not supported. Export an unencrypted PDF first.');throw new FolioError('CORRUPT_PDF','This PDF is corrupt or unreadable. Export a fresh PDF and try again.');}
 if(pdf.getPageCount()<1||pdf.getPageCount()>MAX_SOURCE_PAGES)throw new FolioError('PAGE_LIMIT',`This PDF has more than ${MAX_SOURCE_PAGES} pages. Choose a shorter PDF.`);
 const bitmapFonts=new Set<PDFDict>(),images=new Set<string>(),masks=new Set<string>(),streamRefs=new Set<string>();let pixels=0,maskPixels=0,maskBytes=0,compressed=0,contentBytes=0,operators=0,paints=0;
 const number=(d:PDFDict,k:string)=>{const v=d.lookup(PDFName.of(k));if(!(v instanceof PDFNumber)||!Number.isSafeInteger(v.asNumber())||v.asNumber()<=0)return fail();return v.asNumber();};
 const streamBudget=(s:PDFRawStream,id:string)=>{if(streamRefs.has(id))return;streamRefs.add(id);compressed+=s.getContents().length;if(compressed>MAX_STREAM_BYTES)return fail();};
 const image=(ref:PDFRef,isMask=false,path=new Set<string>()):void=>{const id=ref.toString(),set=isMask?masks:images;if(path.has(id))return fail();if(set.has(id))return;set.add(id);if(images.size>MAX_IMAGE_REFS||masks.size>MAX_IMAGE_REFS)return fail();const s=pdf.context.lookup(ref);if(!(s instanceof PDFRawStream)||s.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Image')return fail();const n=number(s.dict,'Width')*number(s.dict,'Height');if(!Number.isSafeInteger(n)||n>MAX_PIXELS)return fail();if(isMask){const bits=number(s.dict,'BitsPerComponent'),color=s.dict.lookupMaybe(PDFName.of('ColorSpace'),PDFName)?.decodeText();if(![1,2,4,8,16].includes(bits)||color!=='DeviceGray')return fail();maskPixels+=n;maskBytes+=Math.ceil(n*bits/8);if(maskPixels>MAX_PIXELS||maskBytes>MAX_MASK_BYTES)return fail();}else{pixels+=n;if(pixels>MAX_PIXELS)return fail();}streamBudget(s,id);
  const next=new Set(path);next.add(id);for(const k of ['SMask','Mask'])if(s.dict.has(PDFName.of(k))){const m=s.dict.get(PDFName.of(k));if(m instanceof PDFRef)image(m,true,next);else if(!(k==='Mask'&&m instanceof PDFArray&&m.size()<=8))return fail();}
 };
 const content=(s:PDFRawStream)=>{
  try{
   const decoded=decodeBoundedContentStream(s,MAX_CONTENT_STREAM);contentBytes+=decoded.length;if(contentBytes>MAX_CONTENT)return fail();return new TextDecoder('latin1').decode(decoded);
  }catch{return fail();}
 };
 const scan=(text:string,resources:PDFDict,path:Set<string>,depth=0):void=>{if(depth>32)return fail();const ops=originalOperators(text);originalIccSpaces(pdf,resources,key,ops);operators+=ops.length;if(operators>MAX_OPERATOR_WORK)return fail();
  for(const op of ops){if(op.word==='Do'){if(op.args.length!==1||typeof op.args[0]!=='object'||!('name'in op.args[0]))return fail();const objects=resources.lookupMaybe(PDFName.of('XObject'),PDFDict),ref=objects?.get(PDFName.of(op.args[0].name));if(!(ref instanceof PDFRef))return fail();const s=pdf.context.lookup(ref);if(!(s instanceof PDFRawStream))return fail();const subtype=s.dict.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText();
    if(subtype==='Image'){if(++paints>MAX_OPERATOR_WORK)return fail();image(ref);}else if(subtype==='Form'){const id=ref.toString();if(path.has(id))return fail();const next=new Set(path);next.add(id);scan(content(s),s.dict.lookupMaybe(PDFName.of('Resources'),PDFDict)??resources,next,depth+1);}else return fail();
   }else if(op.word==='Tf'){const name=op.args[0];if(!name||typeof name!=='object'||!('name'in name))return fail();const font=resources.lookupMaybe(PDFName.of('Font'),PDFDict)?.lookupMaybe(PDFName.of(name.name),PDFDict);if(!font)return fail();if(font.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()==='Type3'&&!bitmapFonts.has(font)){try{if(bitmapFonts.size>=32)return fail();const bitmap=captureType3BitmapFont(font);bitmapFonts.add(font);maskPixels+=bitmap.pixels;maskBytes+=bitmap.decodedBytes;contentBytes+=bitmap.decodedBytes;compressed+=bitmap.compressedBytes;if(maskPixels>MAX_PIXELS||maskBytes>MAX_MASK_BYTES||contentBytes>MAX_CONTENT||compressed>MAX_STREAM_BYTES)return fail();}catch{return fail();}}
   }else if(op.word==='gs'){const name=op.args[0];if(!name||typeof name!=='object'||!('name'in name))return fail();const gs=resources.lookupMaybe(PDFName.of('ExtGState'),PDFDict)?.lookupMaybe(PDFName.of(name.name),PDFDict);if(!gs)return fail();const mask=gs.lookup(PDFName.of('SMask'));if(mask instanceof PDFDict){const ref=mask.get(PDFName.of('G'));if(!(ref instanceof PDFRef))return fail();const s=pdf.context.lookup(ref);if(!(s instanceof PDFRawStream))return fail();const id=ref.toString();if(path.has(id))return fail();const next=new Set(path);next.add(id);scan(content(s),s.dict.lookupMaybe(PDFName.of('Resources'),PDFDict)??resources,next,depth+1);}else if(mask&&(!(mask instanceof PDFName)||mask.decodeText()!=='None'))return fail();}
  }
 };
 for(const page of pdf.getPages()){const raw=page.node.Contents();if(!raw)continue;const resources=page.node.Resources()??pdf.context.obj({}),streams=raw instanceof PDFArray?Array.from({length:raw.size()},(_,i)=>raw.lookup(i)):[raw];let text='';for(const stream of streams){if(!(stream instanceof PDFRawStream))return fail();text+=content(stream)+'\n';}scan(text,resources,new Set());}
 if(cache.size>=16)cache.delete(cache.values().next().value!);cache.add(key);
}

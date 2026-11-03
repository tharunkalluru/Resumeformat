import {PDFArray,PDFName,PDFNull,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {FolioError} from '../core/errors';
import {boundDecodeBufferGrowth,type DecodeBufferAllocator} from './bounded-decode-buffer';

const supported=new Set(['FlateDecode','ASCII85Decode','ASCIIHexDecode','RunLengthDecode']);
const fail=():never=>{throw new FolioError('PDF_CONTENT_STREAM','This PDF content stream uses unsupported filters or exceeds the bounded decoding budget.');};

/** Materialize each bounded layer before constructing the next decoder. Passing
 * a filter array to pdf-lib would let the next constructor read an unguarded
 * upstream stream. This helper never constructs a nested decoder graph. */
export function decodeBoundedContentStream(stream:PDFRawStream,limit=4*1024*1024):Uint8Array {
 if(!Number.isSafeInteger(limit)||limit<512||limit>4*1024*1024||(limit&(limit-1))!==0||stream.contents.length>limit)return fail();
 const raw=stream.dict.lookup(PDFName.of('Filter')),parameters=stream.dict.lookup(PDFName.of('DecodeParms'));
 const filters=raw===undefined||raw===PDFNull?[]:raw instanceof PDFName?[raw]:raw instanceof PDFArray?raw.asArray().map((_,i)=>raw.lookup(i)):fail();
 if(filters.length>2||filters.some(f=>!(f instanceof PDFName)||!supported.has(f.decodeText())))return fail();
 // Predictors and filter-specific parameters need their own proof. Explicit
 // null placeholders carry no decoding parameters and are safe to preserve.
 if(parameters!==undefined&&parameters!==PDFNull&&(!(parameters instanceof PDFArray)||parameters.size()!==filters.length||parameters.asArray().some((_,i)=>parameters.lookup(i)!==PDFNull)))return fail();
 let bytes=new Uint8Array(stream.contents);
 try{
  for(const filter of filters){
   const single=PDFRawStream.of(stream.dict.context.obj({Filter:filter}),bytes);
   const decoder=decodePDFRawStream(single) as unknown as DecodeBufferAllocator&{getBytes():Uint8Array};
   boundDecodeBufferGrowth(decoder,limit);
   bytes=new Uint8Array(decoder.getBytes());
   if(bytes.length>limit)return fail();
  }
  return bytes;
 }catch{return fail();}
}

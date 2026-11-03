import {it,expect} from 'vitest';
import {PDFDocument,PDFName,PDFRawStream,PDFNull,type PDFObject} from 'pdf-lib';
import {deflateSync} from 'node:zlib';
import {decodeBoundedContentStream} from './bounded-content-stream';

const encode85=(bytes:Uint8Array)=>{
 let text='';for(let offset=0;offset<bytes.length;offset+=4){const group=bytes.subarray(offset,offset+4);let value=0;for(let i=0;i<4;i++)value=value*256+(group[i]??0);const chars=[];for(let i=0;i<5;i++){chars.unshift(String.fromCharCode(value%85+33));value=Math.floor(value/85);}text+=chars.slice(0,group.length+1).join('');}return new TextEncoder().encode(text+'~>');
};
const stream=async(bytes:Uint8Array,filters?:string[],params?:PDFObject|PDFObject[]|{Predictor:number})=>{const doc=await PDFDocument.create();return doc.context.stream(bytes,{...(filters?{Filter:filters}:{}),...(params!==undefined?{DecodeParms:params}:{})}) as PDFRawStream;};

it('decodes original ASCII85 then Flate content without changing the source dictionary or bytes',async()=>{
 const content=new TextEncoder().encode('q BT /F1 12 Tf 1 0 0 1 40 600 Tm (fiction) Tj ET Q');
 const source=await stream(encode85(deflateSync(content)),['ASCII85Decode','FlateDecode'],[PDFNull,PDFNull]);const before=source.dict.toString(),bytes=new Uint8Array(source.contents);
 expect(decodeBoundedContentStream(source)).toEqual(content);expect(source.dict.toString()).toBe(before);expect(source.contents).toEqual(bytes);
});
it('bounds both an oversized upstream layer and an oversized final layer',async()=>{
 const oversized=new Uint8Array(4*1024*1024+1);
 const upstream=await stream(deflateSync(oversized),['FlateDecode','ASCIIHexDecode']);
 const final=await stream(deflateSync(deflateSync(oversized)),['FlateDecode','FlateDecode']);
 for(const source of [upstream,final])expect(()=>decodeBoundedContentStream(source)).toThrowError(/bounded decoding budget/);
});
it('refuses an oversized raw input, unknown filters, predictors and chains deeper than two before decoding',async()=>{
 for(const source of [await stream(new Uint8Array(4*1024*1024+1)),await stream(new Uint8Array([0]),['DCTDecode']),await stream(new Uint8Array([0]),['FlateDecode'],{Predictor:12}),await stream(new Uint8Array([0]),['FlateDecode','FlateDecode','FlateDecode'])])expect(()=>decodeBoundedContentStream(source)).toThrow();
 const source=await stream(new Uint8Array([0]));source.dict.set(PDFName.of('Filter'),source.dict.context.obj([12]));expect(()=>decodeBoundedContentStream(source)).toThrow();
});

import {MAX_SOURCE_PAGES} from '../core/model';
import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {deflateSync} from 'node:zlib';
import {preflightPdfImages} from './pdf-image-preflight';

// Deliberately tiny encoded resources with large declared raster metadata. No decoder is invoked.
async function metadataPdf(options:{images?:number;repeat?:number;width?:number;height?:number;maskBits?:number;form?:boolean;inline?:boolean;streamBytes?:number;unusedBytes?:number;pages?:number}={}):Promise<Uint8Array>{
 const d=await PDFDocument.create(),p=d.addPage([500,700]),objects=d.context.obj({});let content='';
 for(let i=0;i<(options.images??1);i++){
  const width=options.width??12000,height=options.height??1000,mask=options.maskBits?d.context.register(d.context.stream(new Uint8Array([0]),{Type:'XObject',Subtype:'Image',Width:width,Height:height,BitsPerComponent:options.maskBits,ColorSpace:'DeviceGray'})):undefined;
  const ref=d.context.register(d.context.stream(new Uint8Array(options.streamBytes??1),{Type:'XObject',Subtype:'Image',Width:width,Height:height,BitsPerComponent:8,ColorSpace:'DeviceGray',...(mask?{SMask:mask}:{})}));objects.set(PDFName.of(`I${i}`),ref);
  for(let n=0;n<(options.repeat??1);n++)content+=`q 10 0 0 10 20 20 cm /I${i} Do Q\n`;
 }
 if(options.form){const f=d.context.register(d.context.flateStream(new TextEncoder().encode(content),{Type:'XObject',Subtype:'Form',BBox:[0,0,500,700],Resources:{XObject:objects}}));objects.set(PDFName.of('F'),f);content='/F Do';}
 if(options.inline)content='BI /W 2 /H 2 /BPC 8 /CS /RGB ID xx EI';
 p.node.set(PDFName.of('Resources'),d.context.obj({XObject:objects}));p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(new TextEncoder().encode(content))));
 if(options.unusedBytes)d.context.register(d.context.stream(new Uint8Array(options.unusedBytes)));
 for(let n=1;n<(options.pages??1);n++)d.addPage([500,700]);
 return new Uint8Array(await d.save({useObjectStreams:false}));
}
describe('retained PDF image metadata budgets before raster decoding',()=>{
 it('allows empty content without resources while refusing unresolved actual resource use',async()=>{
  const bytes=async(content?:string)=>{const d=await PDFDocument.create(),p=d.addPage([500,700]);p.node.delete(PDFName.of('Resources'));if(content!==undefined)p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(new TextEncoder().encode(content))));return new Uint8Array(await d.save({useObjectStreams:false}));};
  for(const content of [undefined,'','q 1 0 0 1 0 0 cm Q'])await expect(preflightPdfImages(await bytes(content))).resolves.toBeUndefined();
  for(const content of ['/Missing Do','/Missing 12 Tf','/Missing gs'])await expect(preflightPdfImages(await bytes(content))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
 });
 it('sums distinct actual image pixels across the document, including bounded form resources',async()=>{
  for(const form of [false,true])await expect(preflightPdfImages(await metadataPdf({images:2,form}))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
 });
 it('counts repeated paints without multiplying the unique resource pixel budget',async()=>{
  await expect(preflightPdfImages(await metadataPdf({repeat:30}))).resolves.toBeUndefined();
  await expect(preflightPdfImages(await metadataPdf({repeat:202,width:8,height:8}))).resolves.toBeUndefined();
  await expect(preflightPdfImages(await metadataPdf({images:31,width:8,height:8}))).resolves.toBeUndefined();
 });
 it('bounds decoded owned-mask bytes separately from image and mask pixel counts',async()=>{
  await expect(preflightPdfImages(await metadataPdf({maskBits:8}))).resolves.toBeUndefined();
  await expect(preflightPdfImages(await metadataPdf({maskBits:16}))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
 });
 it('rejects oversized actual encoded image streams and inline images before decoder entry',async()=>{
  await expect(preflightPdfImages(await metadataPdf({width:2,height:2,streamBytes:10*1024*1024+1}))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
  await expect(preflightPdfImages(await metadataPdf({inline:true}))).rejects.toThrow();
 });
 it('keeps the whole-PDF preview allowance distinct from the actual image-stream allowance',async()=>{
  const bytes=await metadataPdf({images:0,unusedBytes:11*1024*1024});expect(bytes.length).toBeGreaterThan(10*1024*1024);
  await expect(preflightPdfImages(bytes)).resolves.toBeUndefined();
 });
 it('preserves the explicit page-limit refusal before page decoding',async()=>{
  await expect(preflightPdfImages(await metadataPdf({pages:MAX_SOURCE_PAGES + 1}))).rejects.toMatchObject({code:'PAGE_LIMIT'});
 });
 it('bounds every filter layer and rejects malformed or oversized nested content',async()=>{
  for(const payload of [new Uint8Array([0]),new Uint8Array(deflateSync(deflateSync(new Uint8Array(4*1024*1024+1))))]){
   const d=await PDFDocument.create(),p=d.addPage([500,700]);
   p.node.set(PDFName.of('Contents'),d.context.register(d.context.stream(payload,{Filter:['FlateDecode','FlateDecode']})));
   await expect(preflightPdfImages(new Uint8Array(await d.save({useObjectStreams:false})))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
  }
  const d=await PDFDocument.create(),p=d.addPage([500,700]);p.node.set(PDFName.of('Contents'),d.context.register(d.context.stream(new Uint8Array(deflateSync(deflateSync(new TextEncoder().encode('q Q')))),{Filter:['FlateDecode','FlateDecode']})));
  await expect(preflightPdfImages(new Uint8Array(await d.save({useObjectStreams:false})))).resolves.toBeUndefined();
 });
 it('retains tiny unfiltered and single-array-filter page streams while bounding decompression growth',async()=>{
  for(const filtered of [false,true]){
   const d=await PDFDocument.create(),p=d.addPage([500,700]),content=new TextEncoder().encode('q Q');
   p.node.set(PDFName.of('Contents'),d.context.register(d.context.stream(filtered?new Uint8Array(deflateSync(content)):content,filtered?{Filter:['FlateDecode']}:{})));
   await expect(preflightPdfImages(new Uint8Array(await d.save({useObjectStreams:false})))).resolves.toBeUndefined();
  }
  const d=await PDFDocument.create(),p=d.addPage([500,700]);p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(new Uint8Array(4*1024*1024+1))));
  await expect(preflightPdfImages(new Uint8Array(await d.save({useObjectStreams:false})))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});
 });

});

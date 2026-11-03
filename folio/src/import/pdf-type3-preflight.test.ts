import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,type PDFRef} from 'pdf-lib';
import {MAX_SOURCE_PAGES} from '../core/model';
import {preflightPdfImages} from './pdf-image-preflight';

const key=PDFName.of,ascii=(text:string)=>new TextEncoder().encode(text);
type Options={fonts?:number;pages?:number;repeat?:number;aliases?:number;width?:number;height?:number;flate?:boolean;padding?:number;payload?:Uint8Array;programTail?:string;badResources?:boolean;wrongWidth?:boolean;images?:number;imageWidth?:number;imageHeight?:number;imageBytes?:number;maskPixels?:number;imageFirst?:boolean};

// Fictional owned CharProcs; large ordinary raster dictionaries exercise only
// metadata budgets. These tests never invoke a PDF renderer or raster decoder.
async function authoredPdf(options:Options={}){
 const document=await PDFDocument.create(),context=document.context,fontResources=context.obj({}),objects=context.obj({});
 const width=options.width??8,height=options.height??2,refs:PDFRef[]=[];
 for(let i=0;i<(options.fonts??1);i++){
  const header=ascii(`500 0 0 0 ${width} ${height} d1 q ${width} 0 0 ${height} 0 0 cm BI /W ${width} /H ${height} /IM true /BPC 1 ID `);
  const payload=options.payload??new Uint8Array(Math.ceil(width/8)*height).fill(0xff),tail=ascii(` EI${options.programTail??' Q'}${options.padding?'\n%'+'x'.repeat(options.padding):''}`);
  const program=new Uint8Array(header.length+payload.length+tail.length);program.set(header);program.set(payload,header.length);program.set(tail,header.length+payload.length);
  const glyph=context.register(options.flate?context.flateStream(program):context.stream(program));
  const font=context.obj({Type:'Font',Subtype:'Type3',Name:`FictionalBitmap${i}`,FontMatrix:[.001,0,0,.001,0,0],FontBBox:[0,0,1024,1024],Resources:options.badResources?{XObject:{Unexpected:'Unknown'}}:{ProcSet:[key('PDF'),key('ImageB')]},FirstChar:0,LastChar:0,Widths:[options.wrongWidth?501:500],Encoding:{Differences:[0,key('glyph')]},CharProcs:{glyph}});
  const ref=context.register(font);fontResources.set(key(`T${i}`),ref);refs.push(ref);
 }
 for(let i=0;i<(options.aliases??0);i++)fontResources.set(key(`Alias${i}`),refs[0]);
 let imagePaint='';
 for(let i=0;i<(options.images??0);i++){
  const mask=options.maskPixels?context.register(context.stream(Uint8Array.of(0),{Type:'XObject',Subtype:'Image',Width:options.maskPixels,Height:1,BitsPerComponent:8,ColorSpace:'DeviceGray'})):undefined;
  const image=context.register(context.stream(new Uint8Array(options.imageBytes??3),{Type:'XObject',Subtype:'Image',Width:options.imageWidth??1,Height:options.imageHeight??1,BitsPerComponent:8,ColorSpace:'DeviceRGB',...(mask?{SMask:mask}:{})}));objects.set(key(`I${i}`),image);imagePaint+=`q 1 0 0 1 0 0 cm /I${i} Do Q\n`;
 }
 for(let i=0;i<(options.pages??1);i++){
  const page=document.addPage([612,792]),fonts=fontResources.keys().map(name=>name.decodeText());let text='';
  for(let repeat=0;repeat<(options.repeat??1);repeat++)for(const name of fonts)text+=`BT /${name} 12 Tf 1 0 0 1 40 700 Tm <00> Tj ET\n`;
  page.node.set(key('Resources'),context.obj({Font:fontResources,XObject:objects}));page.node.set(key('Contents'),context.register(context.flateStream(ascii(options.imageFirst?imagePaint+text:text+imagePaint))));
 }
 return new Uint8Array(await document.save({useObjectStreams:false}));
}
const accepted=async(options:Options)=>expect(preflightPdfImages(await authoredPdf(options))).resolves.toBeUndefined();
const refused=async(options:Options)=>expect(preflightPdfImages(await authoredPdf(options))).rejects.toMatchObject({code:'PDF_IMAGE_PREFLIGHT'});

describe('owned Type3 bitmap fonts in raster preflight',()=>{
 it('admits selected closed Type3 masks with unfiltered and Flate-compressed glyph streams',async()=>{
  for(const flate of [false,true])await accepted({flate,pages:2,repeat:3});
 });

 it('charges the same font once across aliases, repeated Tf and every allowed page',async()=>{
  // Charging its million pixels per selection or page would exceed the global cap.
  await accepted({width:1000,height:1000,flate:true,pages:MAX_SOURCE_PAGES,repeat:2,aliases:2});
 });

 it('bounds distinct font graphs while allowing more aliases of one owned font',async()=>{
  await accepted({fonts:32});await refused({fonts:33});await accepted({aliases:40,pages:2});
 });

 it('sums bitmap-mask pixels across individually admissible font graphs',async()=>{
  await accepted({fonts:20,width:1000,height:1000,flate:true});await refused({fonts:21,width:1000,height:1000,flate:true});
 });

 it('charges decoded CharProc content globally even when every compressed stream is tiny',async()=>{
  // Each font is below 1 MiB; 18 fit the unchanged 16 MiB document content cap.
  await accepted({fonts:18,padding:900_000,flate:true});await refused({fonts:19,padding:900_000,flate:true});
 });

 it('charges encoded CharProc streams against the existing 10 MiB aggregate bound',async()=>{
  await accepted({fonts:11,padding:900_000});await refused({fonts:12,padding:900_000});
 });

 it('maps malformed Type3 program, resource and metric proofs to the preflight refusal',async()=>{
  for(const options of [{programTail:' Q BT ET'},{programTail:''},{badResources:true},{wrongWidth:true}])await refused(options);
 });

 it('keeps binary EI-looking samples intact and refuses non-whitespace surplus samples',async()=>{
  await accepted({width:48,height:1,payload:Uint8Array.of(0,32,69,73,32,255)});
  await refused({payload:Uint8Array.of(255)});await refused({payload:Uint8Array.of(255,255,255)});
 });

 it('retains ordinary raster resource deduplication and aggregate pixel refusal',async()=>{
  await accepted({fonts:0,images:1,imageWidth:12000,imageHeight:1000,pages:2,repeat:3});
  await refused({fonts:0,images:2,imageWidth:12000,imageHeight:1000});
 });

 it('combines ordinary soft masks and Type3 pixels in either paint order',async()=>{
  for(const imageFirst of [false,true]){
   await accepted({width:1000,height:1000,images:1,maskPixels:19_000_000,imageFirst,flate:true});
   await refused({width:1000,height:1000,images:1,maskPixels:20_000_000,imageFirst,flate:true});
  }
 });

 it('combines ordinary image and Type3 encoded bytes without separate allowances',async()=>{
  const imageBytes=10*1024*1024-500_000;
  await accepted({fonts:0,images:1,imageBytes});await refused({padding:900_000,images:1,imageBytes});
 });
});

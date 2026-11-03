import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName} from 'pdf-lib';
import {captureType3BitmapFont} from './pdf-type3-bitmap';

const key=PDFName.of;
type Glyph={width?:number;height?:number;advance?:number;bbox?:number[];matrix?:number[];payload?:Uint8Array;header?:string;metric?:string;before?:string;after?:string;flate?:boolean};
const byteString=(bytes:Uint8Array)=>Array.from(bytes,b=>String.fromCharCode(b)).join('');
const binary=(text:string)=>Uint8Array.from(text,c=>c.charCodeAt(0));

function glyphProgram(glyph:Glyph,index:number){
 const width=glyph.width??9,height=glyph.height??3,advance=glyph.advance??500+index*100;
 const bbox=glyph.bbox??[0,0,width,height],matrix=glyph.matrix??[width,0,0,height,0,0];
 const payload=glyph.payload??new Uint8Array(Math.ceil(width/8)*height).fill(0xa5);
 const header=glyph.header??`/W ${width} /H ${height} /IM true /BPC 1`;
 return binary(`${glyph.before??''}${glyph.metric??[advance,0,...bbox].join(' ')+' d1'} q ${matrix.join(' ')} cm BI ${header} ID ${byteString(payload)} EI${glyph.after??' Q'}`);
}

async function fixture(glyphs:Glyph[]=[{},{}]){
 const document=await PDFDocument.create(),context=document.context;
 const charProcs=context.obj({}),programs=glyphs.map((glyph,index)=>{
  const bytes=glyphProgram(glyph,index),stream=glyph.flate?context.flateStream(bytes):context.stream(bytes);
  charProcs.set(key(`g${index}`),context.register(stream));return {bytes,stream};
 });
 const font=context.obj({Type:'Font',Subtype:'Type3',Name:'FictionalBitmap',FontMatrix:[.001,0,0,.001,0,0],FontBBox:[0,0,1024,1024],Resources:{},FirstChar:0,LastChar:glyphs.length-1,Widths:glyphs.map((glyph,index)=>glyph.advance??500+index*100),Encoding:{Type:'Encoding',Differences:[0,...glyphs.map((_,index)=>key(`g${index}`))]},CharProcs:charProcs});
 return {document,context,font,charProcs,programs};
}

describe('closed original Type3 bitmap glyph ownership',()=>{
 it('captures complete glyph ownership and row-padded samples without mutating the font graph',async()=>{
  const {font,programs}=await fixture(),before=font.toString(),streams=programs.map(p=>new Uint8Array(p.stream.contents));
  const result=captureType3BitmapFont(font);
  expect(result).toMatchObject({glyphs:2,decodedBytes:programs.reduce((sum,p)=>sum+p.bytes.length,0),pixels:54,codes:[0,1]});expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);expect(captureType3BitmapFont(font)).toEqual(result);
  expect(font.toString()).toBe(before);programs.forEach((p,i)=>expect(p.stream.contents).toEqual(streams[i]));
 });

 it('accepts only the declared PDF/ImageB ProcSet and Flate-compressed glyph streams',async()=>{
  const plain=await fixture(),compressed=await fixture([{flate:true},{flate:true}]);
  const {compressedBytes:plainBytes,...plainProof}=captureType3BitmapFont(plain.font),{compressedBytes,...compressedProof}=captureType3BitmapFont(compressed.font);
  expect(compressedProof).toEqual(plainProof);expect(plainBytes).toBe(plain.programs.reduce((sum,p)=>sum+p.stream.contents.length,0));expect(compressedBytes).toBe(compressed.programs.reduce((sum,p)=>sum+p.stream.contents.length,0));expect(compressedBytes).toBeGreaterThan(0);
  compressed.font.set(key('Resources'),compressed.context.obj({ProcSet:[key('PDF'),key('ImageB')]}));
  const proof=captureType3BitmapFont(compressed.font);expect(proof.glyphs).toBe(2);expect(proof.sha256).not.toBe(captureType3BitmapFont(plain.font).sha256);
 });

 it('allows an unused zero-width notdef Encoding entry without a CharProc or painted selector',async()=>{
  const {font,context}=await fixture();font.set(key('LastChar'),context.obj(2));font.set(key('Widths'),context.obj([500,600,0]));font.set(key('Encoding'),context.obj({Differences:[0,key('g0'),key('g1'),key('.notdef')]}));
  const result=captureType3BitmapFont(font);expect(result.glyphs).toBe(2);expect(result.codes).toEqual([0,1]);
 });

 it('consumes EI-looking binary payload bytes and binds every byte in the glyph proof',async()=>{
  const payload=Uint8Array.of(0,32,69,73,32,255),a=await fixture([{width:48,height:1,payload}]),changed=payload.slice();changed[5]=254;
  const b=await fixture([{width:48,height:1,payload:changed}]);const proof=captureType3BitmapFont(a.font);
  expect(proof.pixels).toBe(48);expect(proof.decodedBytes).toBe(a.programs[0].bytes.length);expect(proof.sha256).not.toBe(captureType3BitmapFont(b.font).sha256);
 });

 it('refuses truncated or extra samples rather than finding a convenient EI delimiter',async()=>{
  // Extra non-whitespace bytes cannot double as legal delimiter framing.
  for(const length of [5,7]){const {font}=await fixture([{width:9,height:3,payload:new Uint8Array(length).fill(0xff)}]);expect(()=>captureType3BitmapFont(font)).toThrow();}
  const {font}=await fixture([{payload:new Uint8Array(6),after:'Q'}]);expect(()=>captureType3BitmapFont(font)).toThrow();
 });

 it('binds exact font metrics and encoding metadata even when sample bytes stay identical',async()=>{
  const {font,context}=await fixture(),before=captureType3BitmapFont(font).sha256;
  font.set(key('FontMatrix'),context.obj([.002,0,0,.001,0,0]));expect(captureType3BitmapFont(font).sha256).not.toBe(before);
  font.set(key('FontMatrix'),context.obj([.001,0,0,.001,0,0]));font.set(key('FontBBox'),context.obj([0,0,1023,1024]));expect(captureType3BitmapFont(font).sha256).not.toBe(before);
 });

 it('rejects extra font fields and wrong font classes',async()=>{
  for(const field of ['AA','FontDescriptor','ToUnicode']){const {font,context}=await fixture();font.set(key(field),context.obj({S:'JavaScript'}));expect(()=>captureType3BitmapFont(font)).toThrow();}
  for(const field of ['Type','Subtype']){const {font}=await fixture();font.set(key(field),key('Unknown'));expect(()=>captureType3BitmapFont(font)).toThrow();}
 });

 it('closes resources against nested fonts, XObjects, active fields and unknown ProcSets',async()=>{
  for(const resources of [{Font:{F:'Unknown'}},{XObject:{X:'Unknown'}},{AA:{S:'JavaScript'}},{ProcSet:[key('ImageC')]},{ProcSet:[key('PDF'),key('PDF')]}]){
   const {font,context}=await fixture();font.set(key('Resources'),context.obj(resources));expect(()=>captureType3BitmapFont(font)).toThrow();
  }
  const {font,context}=await fixture();font.set(key('Resources'),context.obj({Font:{Loop:context.register(font)}}));expect(()=>captureType3BitmapFont(font)).toThrow();
 });

 it('requires complete, unique code-to-glyph ownership and refuses orphan or missing programs',async()=>{
  for(const differences of [[0,key('missing'),key('g1')],[0,key('g0'),0,key('g1')],[0,key('g0')],[0,key('g0'),key('g1'),key('extra')]]){
   const {font,context}=await fixture();font.set(key('Encoding'),context.obj({Differences:differences}));expect(()=>captureType3BitmapFont(font)).toThrow();
  }
  const {font,charProcs,context}=await fixture();charProcs.set(key('orphan'),context.register(context.stream(glyphProgram({},2))));expect(()=>captureType3BitmapFont(font)).toThrow();
  const notdef=await fixture();notdef.charProcs.set(key('.notdef'),notdef.context.register(notdef.context.stream(binary('0 0 d0'))));expect(()=>captureType3BitmapFont(notdef.font)).toThrow();
  const named=await fixture();named.font.set(key('Encoding'),key('WinAnsiEncoding'));expect(()=>captureType3BitmapFont(named.font)).toThrow();
 });

 it('requires exact declared widths, positive advances and zero d1 vertical advance',async()=>{
  for(const widths of [[500,601],[500],[500,-1],[500,0]]){const {font,context}=await fixture();font.set(key('Widths'),context.obj(widths));expect(()=>captureType3BitmapFont(font)).toThrow();}
  for(const metric of ['500 1 0 0 9 3 d1','0 0 0 0 9 3 d1','500 0 0 0 9 3 d0']){const {font}=await fixture([{metric}]);expect(()=>captureType3BitmapFont(font)).toThrow();}
 });

 it('rejects shear, reflection, translation and oversized or nonfinite font metrics',async()=>{
  for(const matrix of [[0,0,0,.001,0,0],[-.001,0,0,.001,0,0],[.001,.01,0,.001,0,0],[.001,0,.01,.001,0,0],[.001,0,0,.001,1,0],[1.001,0,0,.001,0,0],[NaN,0,0,.001,0,0]]){
   const {font,context}=await fixture();font.set(key('FontMatrix'),context.obj(matrix));expect(()=>captureType3BitmapFont(font)).toThrow();
  }
  for(const bbox of [[0,0,4097,1024],[0,0,Infinity,1024],[9,0,0,3],[0,0,0,3]]){const {font,context}=await fixture();font.set(key('FontBBox'),context.obj(bbox));expect(()=>captureType3BitmapFont(font)).toThrow();}
 });

 it('contains each d1 glyph box in the declared font box',async()=>{
  for(const bbox of [[-1,0,9,3],[0,0,1025,3],[9,0,0,3],[0,3,9,0],[0,0,0,3]]){const {font}=await fixture([{bbox}]);expect(()=>captureType3BitmapFont(font)).toThrow();}
 });

 it('contains positive-axis ink transforms in d1 bounds and rejects transform overflow',async()=>{
  for(const matrix of [[-9,0,0,3,9,0],[9,1,0,3,0,0],[0,9,-3,0,0,0],[9,0,0,3,-1,0],[10,0,0,3,0,0],[9,0,0,3,0,1],[4097,0,0,3,0,0]]){
   const {font}=await fixture([{matrix}]);expect(()=>captureType3BitmapFont(font)).toThrow();
  }
 });

 it('requires precisely one metric, save, transform, mask and restore sequence',async()=>{
  for(const patch of [{before:'0 g '},{before:'q '},{after:' Q Q'},{after:' Q BT ET'},{after:' Q 0 0 m'},{after:''},{metric:'500 0 0 0 9 3 d1 q'}]){
   const {font}=await fixture([patch]);expect(()=>captureType3BitmapFont(font)).toThrow();
  }
 });

 it('closes CharProc stream dictionaries and filters before decoding',async()=>{
  for(const field of ['DecodeParms','Subtype','AA']){const {font,programs,context}=await fixture();programs[0].stream.dict.set(key(field),context.obj({}));expect(()=>captureType3BitmapFont(font)).toThrow();}
  for(const filter of [key('ASCII85Decode'),key('DCTDecode')]){const {font,programs}=await fixture();programs[0].stream.dict.set(key('Filter'),filter);expect(()=>captureType3BitmapFont(font)).toThrow();}
  const {font,charProcs,context}=await fixture();charProcs.set(key('g0'),context.obj({S:'JavaScript'}));expect(()=>captureType3BitmapFont(font)).toThrow();
 });

 it('refuses colored, filtered, interpolated, duplicate-key and malformed mask images',async()=>{
  for(const header of ['/W 9 /H 3 /BPC 1 /CS /G','/W 9 /H 3 /IM true /BPC 2','/W 9 /H 3 /IM true /CS /G','/W 9 /H 3 /IM true /F /FlateDecode','/W 9 /H 3 /IM true /I true','/W 9 /H 3 /IM true /Width 9','/W 9 /H 3 /IM true /D [0 2]']){
   const {font}=await fixture([{header}]);expect(()=>captureType3BitmapFont(font)).toThrow();
  }
 });

 it('preserves either binary Decode polarity and explicit false Interpolate metadata',async()=>{
  const a=await fixture([{header:'/W 9 /H 3 /IM true /BPC 1 /D [0 1] /I false'}]),b=await fixture([{header:'/W 9 /H 3 /IM true /BPC 1 /D [1 0] /I false'}]);
  expect(captureType3BitmapFont(a.font).pixels).toBe(27);expect(captureType3BitmapFont(b.font).pixels).toBe(27);expect(captureType3BitmapFont(a.font).sha256).not.toBe(captureType3BitmapFont(b.font).sha256);
 });

 it('admits all 256 byte selectors and refuses a larger declared glyph graph',async()=>{
  const complete=await fixture(Array.from({length:256},()=>({advance:500})));const proof=captureType3BitmapFont(complete.font);expect(proof.glyphs).toBe(256);expect(proof.codes).toEqual(Array.from({length:256},(_,i)=>i));
  const over=await fixture(Array.from({length:257},()=>({advance:500})));expect(()=>captureType3BitmapFont(over.font)).toThrow();
 });

 it('charges aggregate mask pixels even when both individual glyphs fit',async()=>{
  const atLimit=await fixture([{width:1000,height:500},{width:1000,height:500}]);expect(captureType3BitmapFont(atLimit.font).pixels).toBe(1_000_000);
  const over=await fixture([{width:1000,height:501},{width:1000,height:501}]);expect(()=>captureType3BitmapFont(over.font)).toThrow();
 });

 it('charges all decoded glyph bytes across individually bounded streams',async()=>{
  // Comments carry no extra paint, but their original bytes still consume the budget.
  const after=' Q\n%'+ 'x'.repeat(530_000),one=await fixture([{after}]);expect(captureType3BitmapFont(one.font).decodedBytes).toBe(one.programs[0].bytes.length);
  const aggregate=await fixture([{after},{after}]);expect(aggregate.programs.every(p=>p.bytes.length<1024*1024)).toBe(true);expect(()=>captureType3BitmapFont(aggregate.font)).toThrow();
  const individual=await fixture([{after:' Q\n%'+'x'.repeat(1024*1024)}]);expect(()=>captureType3BitmapFont(individual.font)).toThrow();
 });
});

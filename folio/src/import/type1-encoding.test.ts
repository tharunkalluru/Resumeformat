import {describe,expect,it} from 'vitest';
import {PDFDocument,PDFName,PDFNumber,type PDFObject} from 'pdf-lib';
import {sourceType1Encoding} from './type1-encoding';

const key=PDFName.of;
const standard='%!PS-AdobeFont-1.0: Fictional 1.0\n/Encoding StandardEncoding def\n';
const explicit='%!PS-AdobeFont-1.0: Fictional 1.0\n/Encoding 256 array\n0 1 255 {1 index exch /.notdef put} for\ndup 65 /A put\ndup 66 /B put\ndup 97 /a put\nreadonly def\n';
const supported=(name:string)=>new Set(['A','B','a','space','fi']).has(name);
function refuses(read:()=>Map<number,string>|undefined){let names:Map<number,string>|undefined;try{names=read();}catch{return;}expect(names).toBeUndefined();}

async function fixture(differences?:PDFObject[]){
 const document=await PDFDocument.create(),context=document.context,font=context.obj({Type:'Font',Subtype:'Type1'});
 if(differences)font.set(key('Encoding'),context.obj({Type:'Encoding',Differences:differences}));
 return {font,context};
}

describe('explicit Type1 original Encoding selectors',()=>{
 it('refuses StandardEncoding without an explicit PDF Differences dictionary',async()=>{
  const {font}=await fixture();expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
  font.set(key('Encoding'),key('StandardEncoding'));expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
 });

 it('admits only exact explicit supported names without populating StandardEncoding defaults',async()=>{
  const {font}=await fixture([PDFNumber.of(7),key('A'),key('B'),PDFNumber.of(20),key('space'),key('fi')]),before=font.toString();
  const names=sourceType1Encoding(font,standard,supported)!;expect([...names]).toEqual([[7,'A'],[8,'B'],[20,'space'],[21,'fi']]);expect(names.has(65)).toBe(false);expect(names.has(32)).toBe(false);expect(font.toString()).toBe(before);
  names.set(65,'A');expect(sourceType1Encoding(font,standard,supported)!.has(65)).toBe(false);
 });

 it('leaves unknown and notdef names unmapped while preserving their actual code positions',async()=>{
  const {font}=await fixture([PDFNumber.of(10),key('unknown'),key('A'),key('.notdef'),key('fi')]);
  expect([...sourceType1Encoding(font,standard,supported)!]).toEqual([[11,'A'],[13,'fi']]);
 });

 it('requires a numeric selector before a Differences name and rejects non-name entries',async()=>{
  for(const differences of [[key('A')],[PDFNumber.of(1),PDFNumber.of(2),key('A'),key('B')]]){
   const {font}=await fixture(differences);if(differences[0] instanceof PDFName)expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();else expect([...sourceType1Encoding(font,standard,supported)!]).toEqual([[2,'A'],[3,'B']]);
  }
  const {font,context}=await fixture();font.set(key('Encoding'),context.obj({Differences:[1,context.register(context.obj({Name:'A'}))]}));expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
 });

 it('rejects duplicate assigned codes even when the first name is unsupported',async()=>{
  for(const first of ['A','unknown']){const {font}=await fixture([PDFNumber.of(1),key(first),PDFNumber.of(1),key('B')]);expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();}
 });

 it('rejects fractional, nonfinite, out-of-range and overflowing selectors',async()=>{
  for(const code of [-1,.5,256,NaN,Infinity]){const {font}=await fixture([PDFNumber.of(code),key('A')]);expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();}
  const {font}=await fixture([PDFNumber.of(255),key('A'),key('B')]);expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
 });

 it('rejects BaseEncoding, action fields and an incorrect Encoding dictionary type',async()=>{
  for(const extra of ['BaseEncoding','AA','Unknown']){const {font,context}=await fixture();font.set(key('Encoding'),context.obj({Differences:[1,key('A')],[extra]:extra==='BaseEncoding'?key('StandardEncoding'):context.obj({S:'JavaScript'})}));expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();}
  const {font,context}=await fixture();font.set(key('Encoding'),context.obj({Type:'Unknown',Differences:[1,key('A')]}));expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
 });

 it('dereferences a closed dictionary but refuses malformed indirect dictionary graphs',async()=>{
  const {font,context}=await fixture();font.set(key('Encoding'),context.register(context.obj({Type:'Encoding',Differences:[1,key('A')]})));expect([...sourceType1Encoding(font,standard,supported)!]).toEqual([[1,'A']]);
  for(const value of [{Type:'Encoding',BaseEncoding:'StandardEncoding',Differences:[1,key('A')]},{Type:'Encoding',Differences:{Name:'A'}},{S:'JavaScript',Differences:[1,key('A')]}]){
   font.set(key('Encoding'),context.register(context.obj(value)));refuses(()=>sourceType1Encoding(font,standard,supported));
  }
 });

 it('bounds the whole Differences array and covers all 256 byte selectors',async()=>{
  const {font,context}=await fixture(),pairs=Array.from({length:256},(_,i)=>[PDFNumber.of(i),key('A')]).flat();font.set(key('Encoding'),context.obj({Differences:pairs}));
  const names=sourceType1Encoding(font,standard,supported)!;expect(names.size).toBe(256);expect([...names.keys()]).toEqual(Array.from({length:256},(_,i)=>i));
  font.set(key('Encoding'),context.obj({Differences:[...pairs,PDFNumber.of(0)]}));expect(sourceType1Encoding(font,standard,supported)).toBeUndefined();
 });

 it('preserves the existing explicit 256-array program encoding without a PDF override',async()=>{
  const {font}=await fixture();expect([...sourceType1Encoding(font,explicit,()=>false)!]).toEqual([[65,'A'],[66,'B'],[97,'a']]);
 });

 it('allows only original program names in explicit-encoding PDF overrides',async()=>{
  const {font}=await fixture([PDFNumber.of(65),key('unknown'),PDFNumber.of(70),key('A'),key('fi')]);
  expect([...sourceType1Encoding(font,explicit,supported)!]).toEqual([[66,'B'],[97,'a'],[70,'A']]);
 });

 it('refuses absent, conflicting or malformed program Encoding declarations',async()=>{
  const {font}=await fixture([PDFNumber.of(1),key('A')]);
  for(const header of ['%!PS-AdobeFont-1.0: Fictional\n',standard+explicit,explicit.replace('dup 66 /B put','dup 65 /B put'),explicit.replace('dup 66 /B put','dup 256 /B put'),explicit.replace('dup 66 /B put','unknown operator')])expect(sourceType1Encoding(font,header,supported)).toBeUndefined();
 });
});

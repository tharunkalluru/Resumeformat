import {describe,it,expect} from 'vitest';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFObjectCopier,PDFRawStream} from 'pdf-lib';
import {createType1CursorFont,type1AdvanceRecipe} from './type1-cursor-font';
import {decodeBoundedContentStream} from './bounded-content-stream';
import {originalOperators} from './pdf-image-trace';

const k=PDFName.of;
const decrypt=(data:Uint8Array,seed:number)=>{let r=seed;return Uint8Array.from(data,c=>{const p=c^(r>>>8);r=((c+r)*52845+22719)&65535;return p;});};
describe('original Type1 cursor advance proof',()=>{
 it('preserves source selectors and every numeric kerning without exposing old Unicode',()=>{
  const op=originalOperators('[(A\\(B\\))-384<4344>32] TJ',undefined,true)[0],r=type1AdvanceRecipe(op.word,op.args[0]);
  expect(r).toEqual({program:'[<41284229> -384 <4344> 32] TJ',codes:[40,41,65,66,67,68]});
  expect(type1AdvanceRecipe('Tj',{opaque:true,rawString:'<4142>'}).program).toBe('[<4142>] TJ');
 });
 it('refuses missing, excessive or malformed advance owners',()=>{
  for(const [word,arg]of [['Tf',{opaque:true,rawString:'(A)'}],['TJ',{opaque:true,rawArray:'[999999 (A)]'}],['Tj',{opaque:true,rawString:'('+ 'A'.repeat(2049)+')'}],['Tj',{rawString:'(A)'}],['TJ',{opaque:true,rawArray:'[]'}]] as const)expect(()=>type1AdvanceRecipe(word,arg)).toThrow();
 });
 it('copies fractional PDF widths exactly and generates only blank hsbw/endchar glyphs',async()=>{
  const input=await PDFDocument.create(),output=await PDFDocument.create(),font=input.context.obj({FirstChar:65,LastChar:66,Widths:[881.9,319.4]}),before=font.toString(),ref=createType1CursorFont(output.context,PDFObjectCopier.for(input.context,output.context),font,[65,66]),helper=output.context.lookup(ref,PDFDict);
  expect(font.toString()).toBe(before);expect(helper.lookup(k('Subtype'))!.toString()).toBe('/Type1');expect(helper.lookup(k('Widths'),PDFArray).asArray().map(v=>(v as PDFNumber).asNumber())).toEqual([881.9,319.4]);
  const cmap=new TextDecoder().decode(decodeBoundedContentStream(helper.lookup(k('ToUnicode')) as PDFRawStream));expect(cmap).toContain('<41> <0020>');expect(cmap).toContain('<42> <0020>');expect(cmap).not.toMatch(/<0041>|<0042>/);
  const stream=helper.lookup(k('FontDescriptor'),PDFDict).lookup(k('FontFile')) as PDFRawStream,data=decodeBoundedContentStream(stream),lengths=['Length1','Length2','Length3'].map(n=>stream.dict.lookup(k(n),PDFNumber).asNumber());expect(lengths.reduce((a,b)=>a+b,0)).toBe(data.length);
  const plain=decrypt(data.subarray(lengths[0],lengths[0]+lengths[1]),55665).subarray(4),binary=String.fromCharCode(...plain),start=binary.indexOf('/CharStrings ');let pos=start,seen=0;
  while(true){const match=/\/([.A-Za-z0-9]+) (\d+) RD /.exec(binary.slice(pos));if(!match)break;const offset=pos+match.index+match[0].length,size=Number(match[2]),cs=decrypt(plain.subarray(offset,offset+size),4330).subarray(4);expect(cs[0]).toBe(139);expect([...cs.slice(-2)]).toEqual([13,14]);expect(cs.length).toBeLessThanOrEqual(8);seen++;pos=offset+size;}
  expect(seen).toBe(3);expect(binary).toContain('/Subrs 0 array');expect(binary).not.toContain('Digital');expect(helper.lookup(k('FontDescriptor'),PDFDict).lookup(k('FontBBox'))!.toString()).toBe('[ 0 0 0 0 ]');
 });
 it('refuses an unproved selector or invalid source widths',async()=>{
  const input=await PDFDocument.create(),output=await PDFDocument.create(),copier=PDFObjectCopier.for(input.context,output.context);
  for(const widths of [[0],[NaN],[10001]])expect(()=>createType1CursorFont(output.context,copier,input.context.obj({FirstChar:65,LastChar:65,Widths:widths}),[65])).toThrow();
  expect(()=>createType1CursorFont(output.context,copier,input.context.obj({FirstChar:65,LastChar:65,Widths:[500]}),[64])).toThrow();
 });
});

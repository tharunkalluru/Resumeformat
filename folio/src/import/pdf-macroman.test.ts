import {beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFName,PDFHexString,beginText,endText,setFontAndSize,setTextMatrix,showText} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {macRomanEncodingEntry,originalMacRomanSelectors} from './pdf-macroman';

// Authored in memory from bundled licensed DejaVu; no user fonts or saved fixtures.
// Every non-cmap table remains byte-identical except head.checkSumAdjustment.
let source:Uint8Array,program:Uint8Array,original:ReturnType<typeof fontkit.create>,numGlyphs:number;
interface Table {tag:string;offset:number;length:number}
function tables(bytes:Uint8Array):Table[]{const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+i*16;return{tag:String.fromCharCode(...bytes.subarray(p,p+4)),offset:v.getUint32(p+8),length:v.getUint32(p+12)};});}
function sum(bytes:Uint8Array){let total=0;for(let p=0;p<bytes.length;p+=4){let n=0;for(let i=0;i<4;i++)n=(n<<8)|(bytes[p+i]??0);total=(total+(n>>>0))>>>0;}return total;}
function replaceCmap(bytes:Uint8Array,cmap:Uint8Array):Uint8Array {
 const entries=tables(bytes).map(t=>({tag:t.tag,data:t.tag==='cmap'?cmap:new Uint8Array(bytes.subarray(t.offset,t.offset+t.length))}));
 const head=entries.find(e=>e.tag==='head')!;new DataView(head.data.buffer).setUint32(8,0);
 const size=12+entries.length*16+entries.reduce((n,e)=>n+Math.ceil(e.data.length/4)*4,0),out=new Uint8Array(size),v=new DataView(out.buffer);out.set(bytes.subarray(0,12));let offset=12+entries.length*16;
 for(let i=0;i<entries.length;i++){const e=entries[i],p=12+i*16;out.set(new TextEncoder().encode(e.tag),p);v.setUint32(p+4,sum(e.data));v.setUint32(p+8,offset);v.setUint32(p+12,e.data.length);out.set(e.data,offset);offset+=Math.ceil(e.data.length/4)*4;}
 const h=tables(out).find(t=>t.tag==='head')!;v.setUint32(h.offset+8,(0xb1b0afba-sum(out))>>>0);return out;
}
function cmap6(first=0,count=256):Uint8Array {
 const out=new Uint8Array(22+count*2),v=new DataView(out.buffer);v.setUint16(2,1);v.setUint16(4,1);v.setUint32(8,12);v.setUint16(12,6);v.setUint16(14,10+count*2);v.setUint16(18,first);v.setUint16(20,count);
 for(let i=0;i<count;i++){const code=first+i,e=macRomanEncodingEntry(code);v.setUint16(22+i*2,e?original.glyphForCodePoint(e.encodingUnicode).id:0);}
 return out;
}
function cmapStart(bytes:Uint8Array){return tables(bytes).find(t=>t.tag==='cmap')!.offset;}
function altered(mutator:(v:DataView,base:number,bytes:Uint8Array)=>void){const b=new Uint8Array(program);mutator(new DataView(b.buffer),cmapStart(b),b);return b;}
beforeAll(async()=>{
 source=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));original=fontkit.create(source);numGlyphs=original.numGlyphs;const cmap=cmap6(),v=new DataView(cmap.buffer);
 // Different physical outline from semantic A; duplicate space name selects32,
 // not the deliberately conflicting original cmap entry202.
 v.setUint16(22+65*2,original.glyphForCodePoint(66).id);v.setUint16(22+202*2,original.glyphForCodePoint(65).id);program=replaceCmap(source,cmap);
});

describe('physical-only PDF MacRoman selector',()=>{
 it('retains original licensed outlines, advances and property tables without minting a font asset',async()=>{
  const parsed=fontkit.create(program);expect(parsed.numGlyphs).toBe(numGlyphs);expect(parsed.unitsPerEm).toBe(original.unitsPerEm);expect(sum(program)).toBe(0xb1b0afba);
  for(const tag of ['glyf','loca','hmtx','hhea','maxp','OS/2','post']){const a=tables(source).find(t=>t.tag===tag)!,b=tables(program).find(t=>t.tag===tag)!;expect(program.slice(b.offset,b.offset+b.length)).toEqual(source.slice(a.offset,a.offset+a.length));}
  expect(await readFile(resolve('public/fonts/LICENSE'),'utf8')).toContain('Permission');
  const map=originalMacRomanSelectors(program,32,numGlyphs),a=map.get(65)!;expect(a).toEqual({originalCharCode:65,glyphName:'A',macRomanCode:65,encodingUnicode:65,glyphId:original.glyphForCodePoint(66).id});
  expect(parsed.getGlyph(a.glyphId).path.toSVG()).toEqual(original.getGlyph(a.glyphId).path.toSVG());expect(parsed.getGlyph(a.glyphId).advanceWidth).toBe(original.getGlyph(a.glyphId).advanceWidth);
  expect(Object.keys(a).sort()).toEqual(['encodingUnicode','glyphId','glyphName','macRomanCode','originalCharCode']);
 });
 it('uses PDF glyph-name aliases and currency semantics instead of an OS Macintosh decoder',()=>{
  const m=originalMacRomanSelectors(program,32,numGlyphs);expect(m.get(202)).toMatchObject({originalCharCode:202,macRomanCode:32,glyphName:'space',encodingUnicode:32,glyphId:m.get(32)!.glyphId});
  expect(m.get(219)).toMatchObject({glyphName:'currency',encodingUnicode:0xa4,glyphId:original.glyphForCodePoint(0xa4).id});expect(m.get(219)!.glyphId).not.toBe(original.glyphForCodePoint(0x20ac).id);
  expect(m.get(222)?.encodingUnicode).toBe(0xfb01);expect(m.get(223)?.encodingUnicode).toBe(0xfb02);
  for(const code of [-1,0,31,127,256,1.5,NaN,Infinity])expect(macRomanEncodingEntry(code)).toBeUndefined();
 });
 it('does not pretend to validate absent or restricted permission/style metadata',()=>{
  const b=new Uint8Array(program),t=tables(b).find(t=>t.tag==='OS/2')!,index=tables(b).findIndex(t=>t.tag==='OS/2');new DataView(b.buffer).setUint16(t.offset+8,2);
  expect(originalMacRomanSelectors(b,32,numGlyphs).get(65)).toEqual(originalMacRomanSelectors(program,32,numGlyphs).get(65));
  b.set(new TextEncoder().encode('ZZZZ'),12+index*16);expect(originalMacRomanSelectors(b,32,numGlyphs).get(65)).toEqual(originalMacRomanSelectors(program,32,numGlyphs).get(65));
 });
 it('returns fresh metadata and supports byteOffset without retaining mutable caller data',()=>{
  const wrap=new Uint8Array(program.length+19);wrap.set(program,7);expect([...originalMacRomanSelectors(wrap.subarray(7,7+program.length),32,numGlyphs)]).toEqual([...originalMacRomanSelectors(program,32,numGlyphs)]);
  const first=macRomanEncodingEntry(65)!;first.glyphName='modified';expect(macRomanEncodingEntry(65)!.glyphName).toBe('A');
 });
 it('retains a positive space selector as a candidate, never infers empty outlines or accepts GID0',()=>{
  const p=altered((v,b)=>v.setUint16(b+22+32*2,original.glyphForCodePoint(65).id)),map=originalMacRomanSelectors(p,32,numGlyphs);expect(map.get(32)!.glyphId).toBe(original.glyphForCodePoint(65).id);expect(fontkit.create(p).getGlyph(map.get(32)!.glyphId).path.toSVG().length).toBeGreaterThan(0);expect(map.get(32)).not.toHaveProperty('nonPainting');
  const zero=altered((v,b)=>v.setUint16(b+22+32*2,0));expect(originalMacRomanSelectors(zero,32,numGlyphs).has(32)).toBe(false);expect(originalMacRomanSelectors(zero,32,numGlyphs).has(202)).toBe(false);
  const narrow=replaceCmap(source,cmap6(65,2));expect([...originalMacRomanSelectors(narrow,32,numGlyphs).keys()]).toEqual([65,66]);
 });
 it.each([0,4,36,-1,NaN,Infinity,32.5,0x80000000])('refuses invalid or symbolic flags %s',flags=>expect(()=>originalMacRomanSelectors(program,flags,numGlyphs)).toThrowError(/MacRoman/));
 it.each([0,65536,NaN,1.5])('refuses invalid glyph count %s',count=>expect(()=>originalMacRomanSelectors(program,32,count)).toThrowError(/MacRoman/));
 it.each(['version','subtables','platform','encoding','offset','format','language','length-short','length-odd','length-long','empty','entry-overflow','range-overflow','gid-range','maxp-disagreement'] as const)('refuses malformed %s',mode=>{
  const b=altered((v,p)=>{if(mode==='version')v.setUint16(p,1);if(mode==='subtables')v.setUint16(p+2,2);if(mode==='platform')v.setUint16(p+4,3);if(mode==='encoding')v.setUint16(p+6,1);if(mode==='offset')v.setUint32(p+8,10);if(mode==='format')v.setUint16(p+12,4);if(mode==='language')v.setUint16(p+16,1);if(mode==='length-short')v.setUint16(p+14,10);if(mode==='length-odd')v.setUint16(p+14,521);if(mode==='length-long')v.setUint16(p+14,524);if(mode==='empty')v.setUint16(p+20,0);if(mode==='entry-overflow')v.setUint16(p+20,257);if(mode==='range-overflow')v.setUint16(p+18,1);if(mode==='gid-range')v.setUint16(p+22,numGlyphs);if(mode==='maxp-disagreement'){const t=tables(program).find(t=>t.tag==='maxp')!;v.setUint16(t.offset+4,numGlyphs-1);}});expect(()=>originalMacRomanSelectors(b,32,numGlyphs)).toThrowError(/MacRoman/);
 });
 it('refuses competing/duplicate subtables, nonzero cmap trailing bytes and wrong sfnt inventories',()=>{
  for(const ids of [[1,0],[3,1]]){const one=cmap6(),two=new Uint8Array(one.length+8);two.set(one.subarray(0,12));const v=new DataView(two.buffer);v.setUint16(2,2);v.setUint32(8,20);v.setUint16(12,ids[0]);v.setUint16(14,ids[1]);v.setUint32(16,20);two.set(one.subarray(12),20);expect(()=>originalMacRomanSelectors(replaceCmap(source,two),32,numGlyphs)).toThrowError(/MacRoman/);}
  const trailing=new Uint8Array(cmap6().length+2);trailing.set(cmap6());trailing[trailing.length-1]=1;expect(()=>originalMacRomanSelectors(replaceCmap(source,trailing),32,numGlyphs)).toThrowError(/MacRoman/);
  for(const kind of ['magic','count','duplicate','overlap','unaligned','outside','directory']){const b=new Uint8Array(program),v=new DataView(b.buffer);if(kind==='magic')v.setUint32(0,0x4f54544f);if(kind==='count')v.setUint16(4,129);if(kind==='duplicate')b.set(b.subarray(12,16),28);if(kind==='overlap')v.setUint32(36,v.getUint32(20));if(kind==='unaligned')v.setUint32(20,v.getUint32(20)+1);if(kind==='outside')v.setUint32(20,b.length+4);if(kind==='directory')v.setUint32(20,12);expect(()=>originalMacRomanSelectors(b,32,numGlyphs)).toThrowError(/MacRoman/);}
  expect(()=>originalMacRomanSelectors(new Uint8Array(4*1024*1024+1),32,numGlyphs)).toThrowError(/MacRoman/);expect(()=>originalMacRomanSelectors(program.subarray(0,11),32,numGlyphs)).toThrowError(/MacRoman/);
 });
 it.each([false,true])('matches pinned decoder physical selection independently of explicit ToUnicode=%s',async explicitToUnicode=>{
  Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});const js=await import('pdfjs-dist/legacy/build/pdf.mjs');js.GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  const d=await PDFDocument.create(),page=d.addPage([612,792]),fontBytes=d.context.register(d.context.flateStream(program,{Length1:program.length}));
  const descriptor=d.context.register(d.context.obj({Type:'FontDescriptor',FontName:'FolioAuthoredMacRoman',Flags:32,FontBBox:[-1000,-1000,3000,3000],ItalicAngle:0,Ascent:900,Descent:-300,CapHeight:700,StemV:80,FontFile2:fontBytes}));
  const selectors=originalMacRomanSelectors(program,32,numGlyphs),widths=Array.from({length:256},(_,code)=>{const m=selectors.get(code);return m?original.getGlyph(m.glyphId).advanceWidth*1000/original.unitsPerEm:0;});
  const toUnicode=explicitToUnicode?d.context.register(d.context.flateStream('/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapName /Authored def /CMapType 2 def 1 begincodespacerange <00> <FF> endcodespacerange 1 beginbfchar <41> <005A> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end')):undefined;
  const font=d.context.register(d.context.obj({...(toUnicode?{ToUnicode:toUnicode}:{}),Type:'Font',Subtype:'TrueType',BaseFont:'FolioAuthoredMacRoman',Encoding:'MacRomanEncoding',FirstChar:0,LastChar:255,Widths:widths,FontDescriptor:descriptor})),key=page.node.newFontDictionary('Authored',font),codes=[65,66,219,222,223,128];
  page.pushOperators(beginText(),setFontAndSize(key,12));for(const [i,code] of codes.entries())page.pushOperators(setTextMatrix(1,0,0,1,40+i*30,700),showText(PDFHexString.of(code.toString(16))));page.pushOperators(endText());
  const task=js.getDocument({data:new Uint8Array(await d.save()),fontExtraProperties:true,useSystemFonts:false,isOffscreenCanvasSupported:false,verbosity:0});
  try{const p=await(await task.promise).getPage(1),ops=await p.getOperatorList();let converted:ReturnType<typeof fontkit.create>|undefined,count=0;for(let i=0;i<ops.fnArray.length;i++){if(ops.fnArray[i]===js.OPS.setFont)converted=fontkit.create(p.commonObjs.get(ops.argsArray[i][0]).data);if(ops.fnArray[i]===js.OPS.showText)for(const g of ops.argsArray[i][0]){const expected=selectors.get(codes[count++])!;expect(g.originalCharCode).toBe(expected.originalCharCode);expect(g.unicode).toBe(explicitToUnicode&&expected.originalCharCode===65?'Z':String.fromCodePoint(expected.encodingUnicode));const actual=converted!.glyphForCodePoint(g.fontChar.codePointAt(0)),owned=original.getGlyph(expected.glyphId);expect(actual.path.toSVG()).toEqual(owned.path.toSVG());expect(actual.advanceWidth).toBe(owned.advanceWidth);expect(g.width).toBeCloseTo(widths[expected.originalCharCode],8);}}expect(count).toBe(codes.length);}finally{await task.destroy();}
 });
});

import {beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFArray,PDFDict,PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {canonicalJson,hashTextSync,sha256Sync} from '../core/model';
import {fictionalSourceTemplate} from '../core/sourceFontTestFixture';
import {loadSourceFont,parseSourceProgram,validateSourceFontAsset} from '../layout/source-fonts';
import {browserSourceFontBytes,rewriteTrueTypeUnicodeCmap} from '../ui/sourceFonts';
import {renderDocument,setFontLoader} from './pdf';

let program:Uint8Array;
beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));});

// These are deliberately different positive selectors with identical outlines
// and hmtx. The low-level export fixture makes no retained-PDF admission claim.
function owned(version:4|5|6){
 const f=fictionalSourceTemplate(program,'a'),font=parseSourceProgram(program),original=font.glyphForCodePoint(65),converted=font.glyphForCodePoint(913),blank=font.glyphForCodePoint(32);
 expect(original.id).not.toBe(converted.id);expect(original.path.toSVG()).toBe(converted.path.toSVG());expect(original.advanceWidth).toBe(converted.advanceWidth);
 const native=original.advanceWidth*1000/font.unitsPerEm,pdfWidth=native+(version===6?.25:0);
 f.asset.bytes=rewriteTrueTypeUnicodeCmap(program,new Map([[913,converted.id]]));f.asset.sha256=sha256Sync(f.asset.bytes);f.asset.sourceVersion=version;
 f.asset.originalProgram={bytes:new Uint8Array(program),sha256:sha256Sync(program),pdfFontRef:'1 0 R',...(version===6?{selectorContract:'identity-h-v1' as const}:{})};
 f.asset.glyphMap=[{cid:1,glyphId:converted.id,fontChar:913,unicode:'A',pdfWidth,nonPainting:false,originalGlyphId:original.id,originalCharCode:original.id,...(version===6?{nativeWidth:native}:{})}];
 if(version===5)f.asset.glyphMap.push({cid:2,glyphId:blank.id,fontChar:blank.id,unicode:' ',pdfWidth:blank.advanceWidth*1000/font.unitsPerEm,nonPainting:true,originalGlyphId:blank.id,originalCharCode:blank.id,selectorProvenance:'original-identity-positive-blank-v1'});
 const text=version===5?'A A':'A';f.content.blocks[0].runs=[{text,bold:false,italic:false}];let x=40;
 f.region.sourceLayout!.glyphs=Array.from(text).map(unicode=>{const map=f.asset.glyphMap.find(m=>m.unicode===unicode)!;const glyph={fontId:f.asset.id,cid:map.cid,unicode,x,advance:map.pdfWidth*12/1000,operatorIndex:1};x+=glyph.advance;return glyph;});
 f.region.sourceLayout!.baselineRunsHash=hashTextSync(canonicalJson(f.content.blocks[0].runs));f.region.sourceLayout!.endX=x;f.region.bounds.width=x-40+.5;
 validateSourceFontAsset(f.asset);return {f,original,converted,native,pdfWidth};
}
async function embedded(bytes:Uint8Array){
 const pdf=await PDFDocument.load(bytes),fonts=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),dict=pdf.context.lookup(fonts.values()[0],PDFDict),desc=dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),descriptor=desc.lookup(PDFName.of('FontDescriptor'),PDFDict);
 const decode=(value:unknown)=>decodePDFRawStream(pdf.context.lookup(value as never) as PDFRawStream).decode();
 return {program:decode(descriptor.get(PDFName.of('FontFile2'))),gids:decode(desc.get(PDFName.of('CIDToGIDMap'))),widths:desc.lookup(PDFName.of('W'),PDFArray),unicode:new TextDecoder().decode(decode(dict.get(PDFName.of('ToUnicode'))))};
}
describe('exact owned original TrueType export',()=>{
 it('embeds the exact original program and original positive selector when converter GID differs',async()=>{
  const {f,original,converted}=owned(4),face=loadSourceFont(f.asset),derivative=browserSourceFontBytes(f.asset),before=structuredClone(f.asset),render=await renderDocument(f.template,f.content,[]),out=await embedded(render.bytes);
  expect(render.layout.overflows).toEqual([]);expect(out.program).toEqual(program);expect(sha256Sync(out.program)).toBe(f.asset.originalProgram!.sha256);
  const gid=new DataView(out.gids.buffer,out.gids.byteOffset,out.gids.byteLength).getUint16(2);expect(gid).toBe(original.id);expect(gid).not.toBe(converted.id);expect(out.unicode).toContain('<0001> <0041>');
  expect(f.asset).toEqual(before);expect(loadSourceFont(f.asset)).toBe(face);expect(browserSourceFontBytes(f.asset)).toEqual(derivative);expect(face.font.glyphForCodePoint(913).id).toBe(converted.id);
 });
 it('retains distinct V6 PDF W and positioned advance without replacing immutable native hmtx',async()=>{
  const {f,native,pdfWidth}=owned(6),render=await renderDocument(f.template,f.content,[]),out=await embedded(render.bytes);
  expect(render.layout.overflows).toEqual([]);expect(out.widths.lookup(1,PDFArray).asArray()[0].toString()).toBe(String(pdfWidth));expect(pdfWidth).not.toBe(native);
  expect(parseSourceProgram(out.program).getGlyph(f.asset.glyphMap[0].originalGlyphId!).advanceWidth*1000/f.asset.unitsPerEm).toBe(native);expect(render.layout.regions[0].lines[0].runs[0].sourceGlyphs![0].advance).toBe(pdfWidth*12/1000);
 });
 it('retains the V5 positive unencoded original blank and exact width',async()=>{
  const {f}=owned(5),blank=f.asset.glyphMap[1],render=await renderDocument(f.template,f.content,[]),out=await embedded(render.bytes);
  expect(render.layout.overflows).toEqual([]);expect(new DataView(out.gids.buffer,out.gids.byteOffset,out.gids.byteLength).getUint16(4)).toBe(blank.originalGlyphId);expect(blank.originalGlyphId).toBeGreaterThan(0);
  expect(parseSourceProgram(out.program).getGlyph(blank.originalGlyphId!).path.toSVG()).toBe('');expect(out.widths.lookup(3,PDFArray).asArray()[0].toString()).toBe(String(blank.pdfWidth));expect(out.unicode).toContain('<0002> <0020>');expect(out.program).toEqual(program);
 });
 it('refuses missing, altered, restricted or invalid original selector proof without converted fallback',async()=>{
  for(const mutate of [(f:ReturnType<typeof owned>['f'])=>{f.asset.originalProgram=undefined;},(f:ReturnType<typeof owned>['f'])=>{f.asset.originalProgram!.bytes[0]^=1;},(f:ReturnType<typeof owned>['f'])=>{f.asset.glyphMap[0].originalGlyphId=0;},(f:ReturnType<typeof owned>['f'])=>{const bytes=f.asset.originalProgram!.bytes,view=new DataView(bytes.buffer);for(let i=0;i<view.getUint16(4);i++){const at=12+i*16;if(String.fromCharCode(...bytes.slice(at,at+4))==='OS/2')view.setUint16(view.getUint32(at+8)+8,4);}f.asset.originalProgram!.sha256=sha256Sync(bytes);}]){
   const {f}=owned(4);mutate(f);await expect(renderDocument(f.template,f.content,[])).rejects.toThrow();
  }
 });
});

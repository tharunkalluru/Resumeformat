import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {deepStrictEqual} from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
import {originalMacRomanSelectors} from './pdf-macroman';
import {parseDocumentScopedProgram} from '../layout/document-scoped-program';
import {setFontLoader} from '../layout/fonts';
import {importResume} from './index';
import {makeProject,documentScopedProgramHashes,sha256Sync} from '../core/model';
import {approveTemplate} from '../core/commands';
import {validateOriginalPrograms} from './pdf-original-tt';
import {validateSourceFontAsset} from '../layout/source-fonts';
import {renderProjectDocument} from '../render/pdf';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
function tables(b:Uint8Array){const v=new DataView(b.buffer,b.byteOffset,b.byteLength);return Array.from({length:v.getUint16(4)},(_,i)=>{const at=12+i*16;return{tag:String.fromCharCode(...b.subarray(at,at+4)),entry:at,offset:v.getUint32(at+8),length:v.getUint32(at+12)};});}
function sum(b:Uint8Array){let total=0;for(let i=0;i<b.length;i+=4){let w=0;for(let j=0;j<4;j++)w=(w<<8)|(b[i+j]??0);total=(total+(w>>>0))>>>0;}return total;}
/** Rebuild only wholly authored licensed data; suffix bytes are included in cmap directory length. */
function rebuild(original:Uint8Array,signature:number,count:number,suffix:number[]){
 const ts=tables(original),oldCmap=ts.find(t=>t.tag==='cmap')!,cmap=new Uint8Array(22+count*2+suffix.length);cmap.set(original.subarray(oldCmap.offset,oldCmap.offset+22+count*2));const cv=new DataView(cmap.buffer);cv.setUint16(14,10+count*2);cv.setUint16(20,count);cmap.set(suffix,22+count*2);
 const entries=ts.map(t=>({tag:t.tag,data:t.tag==='cmap'?cmap:new Uint8Array(original.subarray(t.offset,t.offset+t.length))}));const head=entries.find(t=>t.tag==='head')!;new DataView(head.data.buffer).setUint32(8,0);
 const out=new Uint8Array(12+16*entries.length+entries.reduce((n,t)=>n+Math.ceil(t.data.length/4)*4,0)),v=new DataView(out.buffer);out.set(original.subarray(0,12));v.setUint32(0,signature);let offset=12+16*entries.length;
 entries.forEach((t,i)=>{const at=12+i*16;out.set(new TextEncoder().encode(t.tag),at);v.setUint32(at+4,sum(t.data));v.setUint32(at+8,offset);v.setUint32(at+12,t.data.length);out.set(t.data,offset);offset+=Math.ceil(t.data.length/4)*4;});
 const ht=tables(out).find(t=>t.tag==='head')!;v.setUint32(ht.offset+8,(0xb1b0afba-sum(out))>>>0);expect(sum(out)).toBe(0xb1b0afba);return out;
}
async function sourceWith(signature:number,count:number,suffix:number[]){const source=await authoredMacRomanSource(),program=rebuild(source.program,signature,count,suffix),pdf=await PDFDocument.load(source.bytes),fonts=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=fonts.lookup(fonts.keys()[0],PDFDict),desc=font.lookup(PDFName.of('FontDescriptor'),PDFDict);desc.set(PDFName.of('FontFile2'),pdf.context.register(pdf.context.flateStream(program,{Length1:program.length})));return{program,bytes:new Uint8Array(await pdf.save())};}

describe('bounded original MacRoman two-zero cmap suffix',()=>{
 it.each([[0x00010000,255],[0x00010000,256],[0x74727565,255],[0x74727565,256]])('imports/rebinds/reembeds signature%i count%i with declared-payload-only selectors',async(signature,count)=>{
  const source=await sourceWith(signature,count,[0,0]),font=fontkit.create(source.program),cmap=tables(source.program).find(t=>t.tag==='cmap')!,v=new DataView(source.program.buffer),sub=cmap.offset+12;
  expect((12+v.getUint16(sub+2))%4).toBe(count===255?0:2);expect(cmap.length-(12+v.getUint16(sub+2))).toBe(2);
  // Independent parser of the actual sole physical cmap; never Unicode-preferred glyph lookup.
  const physical=(font as any).cmap.tables[0].table,raw=Array.from({length:count},(_,i)=>v.getUint16(sub+10+i*2));deepStrictEqual(Array.from({length:physical.entryCount},(_,i)=>physical.glyphIndices.get(i)),raw);expect(physical.firstCode).toBe(0);
  const maps=originalMacRomanSelectors(source.program,32,font.numGlyphs);for(const m of maps.values())expect(m.glyphId).toBe(raw[m.macRomanCode]);expect(maps.get(32)!.glyphId).toBe(maps.get(202)!.glyphId);
  const p=makeProject(await importResume(new File([source.bytes],'authored-suffix.pdf',{type:'application/pdf'}))),asset=p.template.sourceFonts![0];expect(asset.sourceVersion).toBe(7);if(asset.sourceVersion!==7)throw Error('V7');validateSourceFontAsset(asset);await validateOriginalPrograms(source.bytes,[asset],p.template);deepStrictEqual(asset.originalProgram.bytes,source.program);expect(asset.originalProgram.sha256).toBe(sha256Sync(source.program));expect(asset.declaredStyle.weightClass).toBeNull();expect(asset.originalPermission).toBe('absent');
  await expect(renderProjectDocument(p,'current')).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)}),render=await renderProjectDocument(approved,'current');expect(render.layout.overflows).toEqual([]);
  const pdf=await PDFDocument.load(render.bytes),fonts=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),dict=fonts.lookup(fonts.keys()[0],PDFDict),desc=dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),stream=desc.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2')) as PDFRawStream,embedded=new Uint8Array(decodePDFRawStream(stream).getBytes(4*1024*1024));deepStrictEqual(embedded,source.program);expect(sha256Sync(embedded)).toBe(asset.originalProgram.sha256);
  const cid=new Uint8Array(decodePDFRawStream(desc.lookup(PDFName.of('CIDToGIDMap')) as PDFRawStream).getBytes(4*1024*1024)),cv=new DataView(cid.buffer);for(const m of asset.glyphMap)expect(cv.getUint16(m.cid*2)).toBe(m.originalGlyphId);
 });
 it.each([[],[0,0]].map(suffix=>[suffix]))('accepts only the existing empty or exact two-zero suffix %j',async suffix=>{const source=await authoredMacRomanSource();for(const signature of [0x00010000,0x74727565]){const bytes=rebuild(source.program,signature,255,suffix);expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).not.toThrow();}});
 it.each([[0],[0,0,0],[0,0,0,0],[0,0,0,0,0,0,0,0],[1,0],[0,1],[255,255]].map(suffix=>[suffix]))('rejects unsupported suffix %j without borrowing glyphs',async suffix=>{const source=await authoredMacRomanSource();for(const signature of [0x00010000,0x74727565])for(const count of [255,256]){const bytes=rebuild(source.program,signature,count,suffix);expect(()=>originalMacRomanSelectors(bytes,32,fontkit.create(source.program).numGlyphs)).toThrow();expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();}});
 it('rejects truncated payload, competing cmap, bad lengths/GIDs and overlap despite zero suffix',async()=>{
  const source=await authoredMacRomanSource();for(const mode of ['negative-suffix','competing','short-length','long-length','gid','overlap'] as const){const bytes=rebuild(source.program,0x74727565,255,[0,0]),v=new DataView(bytes.buffer),ts=tables(bytes),cmap=ts.find(t=>t.tag==='cmap')!,base=cmap.offset;
   if(mode==='negative-suffix')v.setUint32(cmap.entry+12,cmap.length-4);if(mode==='competing')v.setUint16(base+2,2);if(mode==='short-length')v.setUint16(base+14,v.getUint16(base+14)-2);if(mode==='long-length')v.setUint16(base+14,v.getUint16(base+14)+2);if(mode==='gid')v.setUint16(base+22+65*2,65535);if(mode==='overlap')v.setUint32(ts[1].entry+8,ts[0].offset);expect(()=>originalMacRomanSelectors(bytes,32,fontkit.create(source.program).numGlyphs)).toThrow();expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();}
 });
});

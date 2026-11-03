import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {deepStrictEqual} from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D,GlobalFonts,createCanvas} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import fontkit from '@pdf-lib/fontkit';
import {authoredMacRomanSource} from './document-scoped-test-fixture';
import {originalMacRomanSelectors} from './pdf-macroman';
import {parseDocumentScopedProgram} from '../layout/document-scoped-program';
import {setFontLoader} from '../layout/fonts';
import {importResume} from './index';
import {makeProject,documentScopedProgramHashes,sha256Sync} from '../core/model';
import {approveTemplate} from '../core/commands';
import {validateProject} from '../core/schema';
import {validateSourceFontAsset} from '../layout/source-fonts';
import {validateOriginalPrograms} from './pdf-original-tt';
import {renderProjectDocument} from '../render/pdf';
import {browserSourceFontBytes} from '../ui/sourceFonts';

let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
function tables(bytes:Uint8Array){const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);return Array.from({length:v.getUint16(4)},(_,i)=>{const p=12+i*16;return{tag:String.fromCharCode(...bytes.subarray(p,p+4)),entry:p,offset:v.getUint32(p+8),length:v.getUint32(p+12)};});}
function checksum(bytes:Uint8Array){let sum=0;for(let i=0;i<bytes.length;i+=4){let word=0;for(let j=0;j<4;j++)word=(word<<8)|(bytes[i+j]??0);sum=(sum+(word>>>0))>>>0;}return sum;}
/** Authored licensed bytes only. Changing sfnt signature requires a new whole-font adjustment. */
function signature(original:Uint8Array,value:number){const bytes=new Uint8Array(original),v=new DataView(bytes.buffer),head=tables(bytes).find(t=>t.tag==='head')!;v.setUint32(0,value);v.setUint32(head.offset+8,0);v.setUint32(head.offset+8,(0xb1b0afba-checksum(bytes))>>>0);expect(checksum(bytes)).toBe(0xb1b0afba);return bytes;}
async function authored(value:number,options:{spaceInk?:boolean}={}){const source=await authoredMacRomanSource(options),program=signature(source.program,value),pdf=await PDFDocument.load(source.bytes),resources=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=resources.lookup(resources.keys()[0],PDFDict),descriptor=font.lookup(PDFName.of('FontDescriptor'),PDFDict);descriptor.set(PDFName.of('FontFile2'),pdf.context.register(pdf.context.flateStream(program,{Length1:program.length})));return{...source,program,bytes:new Uint8Array(await pdf.save())};}

describe('Apple true original TrueType container',()=>{
 it.each([0x00010000,0x74727565])('imports and independently rebinds authored signature %i without inventing permission/style',async value=>{
  const source=await authored(value),project=makeProject(await importResume(new File([source.bytes],'authored-true.pdf',{type:'application/pdf'}))),asset=project.template.sourceFonts![0];
  expect(asset.sourceVersion).toBe(7);if(asset.sourceVersion!==7)throw Error('V7');expect(project.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);
  expect(asset.originalPermission).toBe('absent');expect(asset.declaredStyle.weightClass).toBeNull();expect(asset.declaredStyle.semanticBold).toBe('unknown');deepStrictEqual(asset.originalProgram.bytes,source.program);expect(asset.originalProgram.sha256).toBe(sha256Sync(source.program));expect(new DataView(asset.bytes.buffer,asset.bytes.byteOffset).getUint32(0)).toBe(0x00010000);
  validateSourceFontAsset(asset);validateProject(project);await validateOriginalPrograms(source.bytes,[asset],project.template);
  const aliases=asset.glyphMap.filter(m=>m.originalCharCode===32||m.originalCharCode===202);expect(aliases).toHaveLength(2);expect(aliases.every(m=>m.nonPainting&&m.originalGlyphId===source.selectors.get(32)!.glyphId&&m.originalGlyphId!>0)).toBe(true);
 });
 it('requires consent, preserves original hint bytes/CIDs on authored export, and loads actual native aliases',async()=>{
  const source=await authored(0x74727565),project=makeProject(await importResume(new File([source.bytes],'authored-true.pdf',{type:'application/pdf'}))),asset=project.template.sourceFonts![0];if(asset.sourceVersion!==7)throw Error('V7');
  await expect(approveTemplate(project,project.template.warnings.map(w=>w.id))).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});await expect(renderProjectDocument(project,'current')).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});expect((await renderProjectDocument(project,'baselinePreview')).bytes.length).toBeGreaterThan(0);
  const approved=await approveTemplate(project,project.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:project.source.sha256,originalProgramSha256s:documentScopedProgramHashes(project.template)}),render=await renderProjectDocument(approved,'current');expect(render.layout.overflows).toEqual([]);
  const pdf=await PDFDocument.load(render.bytes),fonts=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),dict=fonts.lookup(fonts.keys()[0],PDFDict),desc=dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),stream=desc.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2')) as PDFRawStream,embedded=new Uint8Array(decodePDFRawStream(stream).getBytes(4*1024*1024));deepStrictEqual(embedded,source.program);expect(new DataView(embedded.buffer).getUint32(0)).toBe(0x74727565);
  const cidBytes=new Uint8Array(decodePDFRawStream(desc.lookup(PDFName.of('CIDToGIDMap')) as PDFRawStream).getBytes(4*1024*1024)),cidView=new DataView(cidBytes.buffer);for(const m of asset.glyphMap)expect(cidView.getUint16(m.cid*2)).toBe(m.originalGlyphId);
  const nativeBytes=browserSourceFontBytes(asset),native=fontkit.create(nativeBytes),original=fontkit.create(source.program);expect(native.glyphForCodePoint(32).path.toSVG()).toBe('');expect(native.glyphForCodePoint(0xa4).path.toSVG()).toBe(original.getGlyph(source.selectors.get(219)!.glyphId).path.toSVG());
  const key=GlobalFonts.register(Buffer.from(nativeBytes),'AuthoredAppleTrue');expect(key).toBeTruthy();try{const ctx=createCanvas(300,50).getContext('2d');ctx.font='16px "AuthoredAppleTrue"';for(const scalar of [' ','¤','A','B']){const map=asset.glyphMap.find(m=>m.unicode===scalar)!;expect(Math.abs(ctx.measureText(scalar).width-map.nativeWidth!*16/1000)).toBeLessThan(.06);}}finally{if(key)GlobalFonts.remove(key);}
  for(const mutation of ['gid','ref','program','property'] as const){const changed=structuredClone(project),f=changed.template.sourceFonts![0];if(f.sourceVersion!==7)throw Error('V7');if(mutation==='gid')f.glyphMap[0].originalGlyphId=0;if(mutation==='ref')f.originalProgram.pdfFontRef='999 0 R';if(mutation==='program'){f.originalProgram.bytes[0]^=1;f.originalProgram.sha256=sha256Sync(f.originalProgram.bytes);}if(mutation==='property')f.declaredStyle.post!.italicAngle+=1;await expect(renderProjectDocument(changed,'baselinePreview')).rejects.toThrow();}
  const removed=structuredClone(project.template);delete removed.sourceFonts;delete removed.sourceScopedPages;removed.importerVersion='folio-import-v11';await expect(validateOriginalPrograms(project.source.bytes,[],removed)).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});
 });
 it.each([0x74797031,0x4f54544f,0x74746366,0x774f4646,0x774f4632,0,0x74727564])('rejects unsupported original signature %i at both guards',async value=>{
  const source=await authoredMacRomanSource(),bytes=signature(source.program,value),count=fontkit.create(source.program).numGlyphs;expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();expect(()=>originalMacRomanSelectors(bytes,32,count)).toThrow();
 });
 it('retains true-container directory, cmap, flags and positive-blank restrictions',async()=>{
  const source=await authored(0x74727565),count=fontkit.create(source.program).numGlyphs;
  for(const mode of ['unaligned','overlap','outside','maxp','language','format','cmap-count','gid-outside'] as const){const bytes=new Uint8Array(source.program),v=new DataView(bytes.buffer),ts=tables(bytes),cmap=ts.find(t=>t.tag==='cmap')!,maxp=ts.find(t=>t.tag==='maxp')!;
   if(mode==='unaligned')v.setUint32(ts[0].entry+8,ts[0].offset+1);if(mode==='overlap')v.setUint32(ts[1].entry+8,ts[0].offset);if(mode==='outside')v.setUint32(ts[0].entry+8,bytes.length+4);if(mode==='maxp')v.setUint32(maxp.offset,0x5000);if(mode==='language')v.setUint16(cmap.offset+16,1);if(mode==='format')v.setUint16(cmap.offset+12,4);if(mode==='cmap-count')v.setUint16(cmap.offset+2,2);if(mode==='gid-outside')v.setUint16(cmap.offset+22+65*2,count);expect(()=>originalMacRomanSelectors(bytes,32,count)).toThrow();expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();}
  for(const flags of [0,4,36,-1,NaN,32.5])expect(()=>parseDocumentScopedProgram(source.program,{flags,italicAngle:0})).toThrow();
  const zero=new Uint8Array(source.program),cmap=tables(zero).find(t=>t.tag==='cmap')!;new DataView(zero.buffer).setUint16(cmap.offset+22+32*2,0);const mappings=originalMacRomanSelectors(zero,32,count);expect(mappings.has(32)).toBe(false);expect(mappings.has(202)).toBe(false);
  const ink=await authored(0x74727565,{spaceInk:true});await expect(importResume(new File([ink.bytes],'authored-true-nonempty-space.pdf',{type:'application/pdf'}))).rejects.toMatchObject({code:'PDF_SOURCE_PROOF',message:'A document-scoped space selector contains original ink.'});
 });
 it('keeps known/restricted/truncated OS2 and missing post separate, and preserves independent style evidence',async()=>{
  const known=await authoredMacRomanSource({absent:false});for(const mode of ['known','restricted','truncated'] as const){const bytes=signature(known.program,0x74727565),v=new DataView(bytes.buffer),os2=tables(bytes).find(t=>t.tag==='OS/2')!;if(mode==='restricted')v.setUint16(os2.offset+8,2);if(mode==='truncated')v.setUint32(os2.entry+12,8);expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();}
  const source=await authored(0x74727565),changed=new Uint8Array(source.program),v=new DataView(changed.buffer),post=tables(changed).find(t=>t.tag==='post')!;v.setInt32(post.offset+4,-15*65536);const parsed=parseDocumentScopedProgram(changed,{flags:32,italicAngle:-7});expect(parsed.properties.post!.italicAngle).toBe(-15);expect(parsed.properties.descriptor.italicAngle).toBe(-7);expect(parsed.properties.headMacStyle).toBe(new DataView(source.program.buffer).getUint16(tables(source.program).find(t=>t.tag==='head')!.offset+44));expect(parsed.properties.weightClass).toBeNull();changed.set(new TextEncoder().encode('xxxx'),post.entry);expect(parseDocumentScopedProgram(changed,{flags:32,italicAngle:0}).properties.post).toBeNull();
 });
});

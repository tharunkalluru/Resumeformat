import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFNumber} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {authoredSymbolicSource} from './document-scoped-test-fixture';
import {originalSymbolicByteSelectors} from './pdf-symbolic';
import {originalMacRomanSelectors} from './pdf-macroman';
import {parseDocumentScopedProgram} from '../layout/document-scoped-program';
import {validateSourceFontAsset} from '../layout/source-fonts';
import {importResume} from './index';
import {makeProject,documentScopedProgramHashes,sha256Sync} from '../core/model';
import {validateProject} from '../core/schema';
import {validateOriginalPrograms} from './pdf-original-tt';
import {validateSelectedOriginalFonts} from './pdf-selected-fonts';
import {approveTemplate,editBlock,confirmDraft,validateExport} from '../core/commands';
import {renderProjectDocument} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject} from '../storage/projects';
import {browserSourceFontBytes} from '../ui/sourceFonts';
import {setFontLoader} from '../layout/fonts';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
async function admissionRefused(bytes:Uint8Array){try{const r=await importResume(new File([new Uint8Array(bytes).buffer],'invalid.pdf',{type:'application/pdf'}));return r.template.warnings.some(w=>w.severity==='blocking')&&!r.template.sourceFonts?.some(f=>f.sourceVersion===7);}catch{return true;}}
const imported=async()=>{const source=await authoredSymbolicSource();return {source,project:makeProject(await importResume(new File([source.bytes],'authored-symbolic.pdf',{type:'application/pdf'})))};};
async function mutated(mutate:(font:PDFDict,descriptor:PDFDict)=>void){const source=await authoredSymbolicSource(),pdf=await PDFDocument.load(source.bytes),font=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict).lookup(PDFName.of('F1'),PDFDict);mutate(font,font.lookup(PDFName.of('FontDescriptor'),PDFDict));return new Uint8Array(await pdf.save());}
describe('document-scoped symbolic raw-byte format6',()=>{
 it('keeps raw-byte GID separate from MacRoman name alias and ToUnicode semantics',async()=>{
  const {source,project}=await imported(),asset=project.template.sourceFonts![0];if(asset.sourceVersion!==7)throw Error('V7 absent');
  expect(asset.originalProgram.selectorContract).toBe('symbolic-raw-byte-1-0-format6-v1');expect(asset.originalProgram.bytes).toEqual(source.program);expect(asset.originalProgram.pdfFontRef).toBe(source.ref);expect(asset.sourceSha256).toBe(sha256Sync(source.bytes));expect(asset.originalPermission).toBe('absent');expect(asset.declaredStyle.weightClass).toBeNull();expect(asset.registrationFaceToken).toBe('neutral-400-normal-v1');expect(asset).not.toHaveProperty('fontWeight');
  const map=originalSymbolicByteSelectors(source.program,4,source.original.numGlyphs);expect(map.get(202)!.glyphId).toBe(source.original.glyphForCodePoint(65).id);expect(originalMacRomanSelectors(source.program,32,source.original.numGlyphs).get(202)!.glyphId).toBe(source.original.glyphForCodePoint(32).id);expect(map.get(202)).not.toHaveProperty('encodingUnicode');const blank=asset.glyphMap.find(m=>m.originalCharCode===33)!;expect(blank.nonPainting).toBe(true);expect(blank.originalGlyphId).toBe(source.original.glyphForCodePoint(32).id);expect(blank.selectorProvenance).toBe('original-positive-blank-v2');
  const a=asset.glyphMap.find(m=>m.originalCharCode===65)!;expect(a.unicode).toBe('A');expect(a.originalGlyphId).toBe(source.original.glyphForCodePoint(66).id);validateSourceFontAsset(asset);validateProject(project);await validateOriginalPrograms(source.bytes,[asset],project.template);
  const native=fontkit.create(browserSourceFontBytes(asset));expect(native.glyphForCodePoint(65).path.toSVG()).toBe(source.original.getGlyph(a.originalGlyphId!).path.toSVG());
 });
 it('persists and restores exact physical contracts and renders an owned changed export',async()=>{
  const {project}=await imported();expect((await renderProjectDocument(project,'baselinePreview')).bytes.length).toBeGreaterThan(0);let p=await approveTemplate(project,project.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:project.source.sha256,originalProgramSha256s:documentScopedProgramHashes(project.template)});
  await saveProject(p);expect((await loadProjects()).find(q=>q.id===p.id)!.template.sourceFonts![0]).toEqual(p.template.sourceFonts![0]);const restored=await restoreProject(new File([await backupProject(p)],'symbolic.folio'));expect(restored.approval).toBeNull();expect(restored.template.sourceFonts![0]).toEqual(p.template.sourceFonts![0]);
  const block=p.draft.blocks[0];p=editBlock(p,block.id,[{...block.runs[0],text:'AB'}]);p=confirmDraft(p);const rendered=await renderProjectDocument(p,'current');expect(rendered.bytes.length).toBeGreaterThan(0);expect(rendered.documentScopedPurpose).toBe('current');expect(rendered.sourceReplay).toBeUndefined();await validateExport(p,rendered);
 });
 it.each([0,32,36,-1,4.5,NaN,Infinity,0x80000000])('rejects incompatible flags %s',async flags=>{const s=await authoredSymbolicSource();expect(()=>originalSymbolicByteSelectors(s.program,flags,s.original.numGlyphs)).toThrow();});
 it.each(['encoding-name','encoding-dict','missing-unicode','flags','width'] as const)('rejects source %s',async kind=>{
  const bytes=await mutated((font,d)=>{if(kind==='encoding-name')font.set(PDFName.of('Encoding'),PDFName.of('MacRomanEncoding'));if(kind==='encoding-dict')font.set(PDFName.of('Encoding'),font.context.obj({BaseEncoding:'WinAnsiEncoding'}));if(kind==='missing-unicode')font.delete(PDFName.of('ToUnicode'));if(kind==='flags')d.set(PDFName.of('Flags'),PDFNumber.of(36));if(kind==='width')font.lookup(PDFName.of('Widths'),PDFArray).set(65,PDFNumber.of(-1));});
  expect(await admissionRefused(bytes)).toBe(true);
 });
 it.each(['count','platform','encoding','format','language','range','gid'] as const)('rejects cmap %s',async kind=>{
  const s=await authoredSymbolicSource(),b=new Uint8Array(s.program),v=new DataView(b.buffer);let base=0;for(let i=0;i<v.getUint16(4);i++){const p=12+i*16;if(String.fromCharCode(...b.subarray(p,p+4))==='cmap')base=v.getUint32(p+8);}
  if(kind==='count')v.setUint16(base+2,2);if(kind==='platform')v.setUint16(base+4,3);if(kind==='encoding')v.setUint16(base+6,1);if(kind==='format')v.setUint16(base+12,4);if(kind==='language')v.setUint16(base+16,1);if(kind==='range')v.setUint16(base+18,1);if(kind==='gid')v.setUint16(base+22,s.original.numGlyphs);expect(()=>originalSymbolicByteSelectors(b,4,s.original.numGlyphs)).toThrow();
 });
 it.each([{missing:true},{spaceInk:true},{absent:false}])('rejects missing physical selector, space ink or present OS/2 %j',async options=>{const s=await authoredSymbolicSource(options);expect(await admissionRefused(s.bytes)).toBe(true);});
 it.each(['selector','owner','unicode','width','nativeWidth','contract','flags'] as const)('rejects saved %s tampering',async kind=>{
  const {source,project}=await imported(),asset=project.template.sourceFonts![0];if(asset.sourceVersion!==7)throw Error();const map=asset.glyphMap[0];if(kind==='selector')map.originalGlyphId!++;if(kind==='owner')asset.originalProgram.pdfFontRef='9999 0 R';if(kind==='unicode')map.unicode='Z';if(kind==='width')map.pdfWidth+=1;if(kind==='nativeWidth')map.nativeWidth!+=1;if(kind==='contract')asset.originalProgram.selectorContract='macroman-1-0-format6-v1';if(kind==='flags')asset.declaredStyle.descriptor.flags=32;
  if(['selector','nativeWidth','contract','flags'].includes(kind))expect(()=>validateSourceFontAsset(asset)).toThrow();if(kind==='nativeWidth')expect(()=>validateProject(project)).toThrow();else await expect(validateOriginalPrograms(source.bytes,[asset],project.template)).rejects.toThrow();
 });
 it('rejects coherent source-SHA owner tampering through fresh selected-resource admission',async()=>{const {source,project}=await imported();project.template.sourceFonts![0].sourceSha256='0'.repeat(64);await expect(validateSelectedOriginalFonts(source.bytes,project.template)).rejects.toThrow();});
 it('never derives a symbolic grant from absent permissions alone',async()=>{const s=await authoredSymbolicSource();expect(()=>parseDocumentScopedProgram(s.program,{flags:4,italicAngle:0})).toThrow();expect(()=>parseDocumentScopedProgram(s.program,{flags:4,italicAngle:0},'symbolic-raw-byte-1-0-format6-v1')).not.toThrow();});
});

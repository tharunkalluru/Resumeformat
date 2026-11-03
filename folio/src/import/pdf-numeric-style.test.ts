import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFArray,PDFName,PDFRawStream,decodePDFRawStream,rgb} from 'pdf-lib';
import {makeProject,sha256Sync,type SourceFontAssetV10} from '../core/model';
import {validateProject} from '../core/schema';
import {packRecordMetadata} from '../core/project-record-codec';
import {approveTemplate} from '../core/commands';
import {originalTrueTypePermissions,sourceProgramStyle,sourceProgramNumericalStyle,parseOriginalSourceProgram,validateSourceFontAsset} from '../layout/source-fonts';
import {validateSelectedOriginalFonts} from './pdf-selected-fonts';
import {importResume} from './index';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject} from '../storage/projects';

let regular:Uint8Array,italic:Uint8Array,release:()=>void;
beforeAll(async()=>{
 const mini=JSON.parse(await readFile('src/import/fixtures/numeric-source-fonts.json','utf8'));regular=new Uint8Array(mini.programs.normal);italic=new Uint8Array(mini.programs.italic);
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});afterAll(()=>release?.());
const checksum=(b:Uint8Array)=>{let n=0;for(let i=0;i<b.length;i+=4)n=(n+((b[i]??0)*0x1000000+(b[i+1]??0)*0x10000+(b[i+2]??0)*0x100+(b[i+3]??0)))>>>0;return n;};
/** Fictional declaration variant of the locally licensed test font; glyphs and hints unchanged. */
function declaration(input:Uint8Array,weight:number,permissions=0){const b=new Uint8Array(input),v=new DataView(b.buffer);let head=0;for(let i=0;i<v.getUint16(4);i++){const at=12+i*16,tag=String.fromCharCode(...b.slice(at,at+4)),off=v.getUint32(at+8),len=v.getUint32(at+12);if(tag==='OS/2'){v.setUint16(off+4,weight);v.setUint16(off+8,permissions);v.setUint32(at+4,checksum(b.subarray(off,off+len)));}if(tag==='head'){head=off;v.setUint32(off+8,0);v.setUint32(at+4,checksum(b.subarray(off,off+len)));}}v.setUint32(head+8,(0xb1b0afba-checksum(b))>>>0);return b;}
async function fixture(nbsp=false){const d=await PDFDocument.create();d.registerFontkit(fontkit);const page=d.addPage([500,700]),specs=[[400,false],[500,false],[600,false],[700,false],[500,true]] as const,programs:Uint8Array[]=[];
 for(const[w,i]of specs){const bytes=declaration(i?italic:regular,w),font=await d.embedFont(bytes,{subset:false});programs.push(bytes);page.drawText(nbsp?'a\u00a0b a\u00a0b':'ab ab ab ab ab',{font,size:12,x:40,y:640-programs.length*35,color:rgb(0,0,0)});}const materialized=await PDFDocument.load(await d.save()),target=materialized.getPage(0),c=target.node.Contents()!,refs=c instanceof PDFArray?c.asArray():[c],raw=refs.map(ref=>new TextDecoder().decode(decodePDFRawStream(materialized.context.lookup(ref) as PDFRawStream).decode())).join('\n');target.node.set(PDFName.of('Contents'),materialized.context.register(materialized.context.flateStream('q 1 1 1 rg 0 0 500 700 re f 0 0 0 rg\n'+raw+'\n1 0 0 rg 400 100 20 10 re f Q')));
 const bytes=new Uint8Array(await materialized.save()),project=validateProject(makeProject(await importResume(new File([bytes],'fictional-numeric-style.pdf',{type:'application/pdf'})),true));return{bytes,project,programs};}
const approve=async(p:Awaited<ReturnType<typeof fixture>>['project'])=>approveTemplate(p,p.template.warnings.map(w=>w.id));
describe('owned original numerical TrueType styles',()=>{
 it('preserves mixed numerical/italic declarations and original programs through render/save/portable recovery',async()=>{
  const{bytes,project,programs}=await fixture();expect(project.template.importerVersion).toBe('folio-import-v18');const fonts=project.template.sourceFonts!;
  expect(fonts.filter(f=>f.sourceVersion===10).map(f=>[f.fontWeight,f.italic])).toEqual([[500,false],[600,false],[500,true]]);
  expect(fonts.map(f=>'originalProgram'in f&&f.originalProgram?.sha256)).toEqual(programs.map(sha256Sync));
  expect(project.template.pages[0].regions.filter(r=>r.kind==='text').map(r=>[r.style.fontWeight,r.style.italic])).toEqual([[400,false],[500,false],[600,false],[700,false],[500,true]]);
  if(process.env.FOLIO_NUMERIC_ORACLE_DIR){await mkdir(process.env.FOLIO_NUMERIC_ORACLE_DIR,{recursive:true});await writeFile(process.env.FOLIO_NUMERIC_ORACLE_DIR+'/import-diagnostic.json',JSON.stringify({warnings:project.template.warnings,scoped:project.template.sourceScopedPages,regions:project.template.pages[0].regions.map(r=>({kind:r.kind,order:r.order,paint:'sourceScopedPaint'in r?r.sourceScopedPaint:undefined}))},null,2));await writeFile(process.env.FOLIO_NUMERIC_ORACLE_DIR+'/source.pdf',bytes);}
  const baseline=await renderProjectDocument(project,'baselinePreview'),approved=await approve(project),current=await renderProjectDocument(approved,'current');expect(baseline.layout.overflows).toEqual([]);expect(current.layout.overflows).toEqual([]);
  await saveProject(approved);expect((await loadProjects()).find(p=>p.id===project.id)!.template).toEqual(project.template);
  const archive=await backupProject(approved);if(process.env.FOLIO_NUMERIC_ORACLE_DIR)await writeFile(process.env.FOLIO_NUMERIC_ORACLE_DIR+'/archive.zip',new Uint8Array(await archive.arrayBuffer()));
  const restored=await restoreProject(new File([archive],'fictional-numeric.zip'));expect(restored.approval).toBeNull();expect(restored.template).toEqual(project.template);expect((await renderProjectDocument(await approve(restored),'current')).bytes).toEqual(current.bytes);
  if(process.env.FOLIO_NUMERIC_ORACLE_DIR){const out=process.env.FOLIO_NUMERIC_ORACLE_DIR;await mkdir(out,{recursive:true});await writeFile(out+'/source.pdf',bytes);await writeFile(out+'/baseline.pdf',baseline.bytes);await writeFile(out+'/current.pdf',current.bytes);}
 });
 it.each(['weight','italic','native-width','ref','capability','downgrade','program','permissions','selector','blank-policy'] as const)('refuses independently rehashed %s changes',async mode=>{
  const{bytes,project}=await fixture(),bad=structuredClone(project),f=bad.template.sourceFonts!.find(f=>f.sourceVersion===10) as SourceFontAssetV10;
  if(mode==='weight')f.fontWeight=600;else if(mode==='italic')f.italic=true;else if(mode==='native-width')f.glyphMap[0].nativeWidth!+=1;else if(mode==='ref')f.originalProgram.pdfFontRef='999 0 R';else if(mode==='capability')f.capability='unproved' as never;else if(mode==='program'){f.originalProgram.bytes=new Uint8Array(f.originalProgram.bytes);f.originalProgram.bytes[f.originalProgram.bytes.length-1]^=1;f.originalProgram.sha256=sha256Sync(f.originalProgram.bytes);}else if(mode==='permissions'){f.originalProgram.bytes=declaration(f.originalProgram.bytes,f.fontWeight,4);f.originalProgram.sha256=sha256Sync(f.originalProgram.bytes);f.bytes=declaration(f.bytes,f.fontWeight,4);f.sha256=sha256Sync(f.bytes);}else if(mode==='selector')f.glyphMap[0].originalCharCode!+=1;else if(mode==='blank-policy')f.semanticBlankPolicy='original-space-and-nbsp-v1';else(f as unknown as {sourceVersion:number}).sourceVersion=4;
  if(mode!=='ref'&&mode!=='program')expect(()=>validateProject(bad)).toThrow();await expect(validateSelectedOriginalFonts(bytes,bad.template)).rejects.toBeDefined();await expect(saveProject(bad)).rejects.toBeDefined();
 });


 it('preserves literal positive NBSP blanks and refuses a manufactured policy',async()=>{
  const{bytes,project}=await fixture(true);expect(project.baseline.blocks.some(b=>b.runs.some(r=>r.text.includes('\u00a0')))).toBe(true);
  const f=project.template.sourceFonts!.find(f=>f.sourceVersion===10&&f.semanticBlankPolicy) as SourceFontAssetV10;expect(f.semanticBlankPolicy).toBe('original-space-and-nbsp-v1');expect(f.glyphMap.some(m=>m.unicode==='\u00a0'&&m.nonPainting&&m.pdfWidth>0&&m.nativeWidth!>0)).toBe(true);
  const baseline=await renderProjectDocument(project,'baselinePreview');expect(baseline.layout.overflows).toEqual([]);
  const bad=structuredClone(project),changed=bad.template.sourceFonts!.find(x=>x.id===f.id) as SourceFontAssetV10;delete changed.semanticBlankPolicy;expect(()=>validateSourceFontAsset(changed)).toThrow();await expect(validateSelectedOriginalFonts(bytes,bad.template)).rejects.toBeDefined();
  if(process.env.FOLIO_NUMERIC_ORACLE_DIR){const out=process.env.FOLIO_NUMERIC_ORACLE_DIR+'/nbsp';await mkdir(out,{recursive:true});await writeFile(out+'/source.pdf',bytes);await writeFile(out+'/baseline.pdf',baseline.bytes);}
 });
 it('refuses numerical record styles without their exact V10 owner',async()=>{
  const{project}=await fixture(),bad=structuredClone(project),region=bad.template.pages[0].regions.find(r=>r.kind==='text'&&r.style.fontWeight===400)!;if(region.kind!=='text')throw Error('CONTROL_OWNER');region.style.fontWeight=500;
  expect(()=>validateProject(bad)).toThrow();expect(()=>packRecordMetadata(bad)).toThrow();
 });
 it('keeps legacy binary declarations and actual rights restrictions distinct from numeric admission',()=>{
  const numerical=declaration(regular,500);expect(sourceProgramNumericalStyle(parseOriginalSourceProgram(numerical)).fontWeight).toBe(500);expect(()=>sourceProgramStyle(parseOriginalSourceProgram(numerical))).toThrow();
  for(const weight of [0,1001])expect(()=>sourceProgramNumericalStyle(parseOriginalSourceProgram(declaration(regular,weight)))).toThrow();
  expect(()=>originalTrueTypePermissions(declaration(regular,500,4))).toThrow();
 });
});

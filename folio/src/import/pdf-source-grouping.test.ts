import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFArray,PDFDocument,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {fictionalImageBlankSource} from '../core/sourceImageTestFixture';
import {makeProject,canonicalJson,hashTextSync,type TextRegion,type Project} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {validateProject} from '../core/schema';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceScopedStateHash,isSourcePageBackground} from '../core/source-scoped-paint';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {importResume} from './index';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {renderProjectDocument,renderDocument,setFontLoader} from '../render/pdf';
import {paintGroupedSourcePage} from '../render/source-grouped-page';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {classifyScopedMarkedDictionary} from './pdf-scoped-paint';
import {saveProject,loadProjects,backupProject,restoreProject,backupResumeGroup,restoreGroup} from '../storage/projects';

let program:Uint8Array,release:()=>void;
beforeAll(async()=>{
 program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));
 Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});
 release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));
 await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(()=>release?.());
const stream=async(bytes:Uint8Array)=>{const d=await PDFDocument.load(bytes),p=d.getPages()[0],c=p.node.Contents()!,refs=c instanceof PDFArray?c.asArray():[c];return{d,p,text:refs.map(r=>new TextDecoder().decode(decodePDFRawStream(d.context.lookup(r) as PDFRawStream).decode())).join('\n')};};
async function fixture(blank:boolean,boundary=false,rows=34,relative=false,unreset=false){
 const original=await fictionalImageBlankSource(program,{images:0}),{d,p,text}=await stream(original),face=fontkit.create(program),resource=text.match(/(\/[^\s]+) 12 Tf/)![1],hex=(c:string)=>face.glyphForCodePoint(c.codePointAt(0)!).id.toString(16).padStart(4,'0');
 p.node.Resources()!.delete(PDFName.of('XObject'));
 const line=blank?'ab ab ab ab ab ab ab ab ab ab ab ab':'ab'.repeat(18);let content='q 1 1 1 rg 0 0 500 700 re f 0 0 0 rg\n';
 if(relative)content+='.75 0 0 -.75 0 700 cm\n';
 for(let row=0;row<rows;row++){
  content+=relative?'BT '+resource+' 16 Tf 1 0 0 -1 40 '+(70+row*23)+' Tm\n0 -2 Td\n':'BT '+resource+' 12 Tf 1 0 0 1 40 '+(648-row*17)+' Tm\n';let prior='';
  for(let col=0;col<line.length;col++){
   if(col&&!(unreset&&col===1)){const width=face.glyphForCodePoint(prior.codePointAt(0)!).advanceWidth*(relative?16:12)/face.unitsPerEm+(blank&&row===33&&col===16?6:0);content+=width.toFixed(8)+' 0 Td\n';}
   if(boundary&&row===0&&col===16)content+='ET 1 0 0 rg 400 630 10 10 re f 0 0 0 rg BT '+resource+' 12 Tf 1 0 0 1 170 648 Tm\n';
   content+='<'+hex(line[col])+'> Tj\n';prior=line[col];
  }
  content+='ET\n';
 }
 content+='1 0 0 rg 400 100 20 10 re f Q';
 p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(new TextEncoder().encode(content))));
 const bytes=new Uint8Array(await d.save()),project=validateProject(makeProject(await importResume(new File([bytes],'authored-positioned.pdf',{type:'application/pdf'})),true));
 return{bytes,project,hex};
}
const groups=(p:Project)=>p.template.pages[0].regions.filter((r):r is TextRegion=>r.kind==='text'&&!!r.sourceScopedPaint?.showGroup);
const approve=(p:Project)=>approveTemplate(p,p.template.warnings.map(w=>w.id));
const rehash=(p:Project)=>{for(const r of p.template.pages[0].regions)if('sourceScopedPaint'in r&&r.sourceScopedPaint)r.sourceScopedPaint.stateHash=sourceScopedStateHash(r,p.template.sourceFonts!);return p;};
describe('complete reset-positioned source groups',()=>{
 it('uses complete fractional relative-Td replay below the region budget with reflected source factors',async()=>{
  const {bytes,project}=await fixture(true,false,3,true),regions=groups(project);
  expect(project.template.importerVersion).toBe('folio-import-v16');expect(regions).toHaveLength(3);expect(Array.from(sourceGlyphs(regions[0])).length).toBeLessThan(1000);
  expect(project.template.pages[0].regions.length).toBeLessThan(1000);
  await validateSourceScopedPaint(bytes,project.template,[],true,true);
  const baseline=await renderProjectDocument(project,'baselinePreview'),approved=await approve(project),region=regions[0],block=approved.draft.blocks.find(b=>b.id===region.contentId)!,wording='ba ab ab';
  const edited=editBlock(approved,region.contentId,[{...block.runs[0],text:wording}]),current=await renderProjectDocument(edited,'current');expect(current.layout.overflows).toEqual([]);
  await saveProject(edited);const loaded=(await loadProjects()).find(p=>p.id===edited.id)!;expect(loaded.draft).toEqual(edited.draft);expect((await renderProjectDocument(loaded,'current')).bytes).toEqual(current.bytes);
  const restored=await restoreProject(new File([await backupProject(edited)],'small-relative.zip'));expect(restored.approval).toBeNull();expect(restored.template).toEqual(project.template);expect((await renderProjectDocument(await approve(restored),'current')).bytes).toEqual(current.bytes);
  if(process.env.FOLIO_GROUP_ORACLE_DIR){
   const out=process.env.FOLIO_GROUP_ORACLE_DIR+'/small-relative';await mkdir(out,{recursive:true});await writeFile(out+'/source.pdf',bytes);await writeFile(out+'/baseline.pdf',baseline.bytes);await writeFile(out+'/current.pdf',current.bytes);
   const ref=await PDFDocument.load(bytes),raw=originalPageContent(ref,1,true),ops=originalOperators(raw,classifyScopedMarkedDictionary,true,true,true),owned=new Set(region.sourceScopedPaint!.showGroup!.operators.map(p=>p[1])),first=region.sourceScopedPaint!.showGroup!.operators[0][1],face=fontkit.create(program),hex=(c:string)=>face.glyphForCodePoint(c.codePointAt(0)!).id.toString(16).padStart(4,'0');
   let independent=raw;for(const op of [...ops].reverse())if(owned.has(op.index)){const replacement=op.index===first?'<'+Array.from(wording,hex).join('')+'> Tj':'';independent=independent.slice(0,op.sourceSpan!.start)+replacement+independent.slice(op.sourceSpan!.end);}
   ref.getPages()[0].node.set(PDFName.of('Contents'),ref.context.register(ref.context.flateStream(new TextEncoder().encode(independent))));await writeFile(out+'/independent-current.pdf',await ref.save());
  }
 });
 it('keeps fractional relative shows without complete explicit resets refused',async()=>{
  const {project}=await fixture(true,false,3,true,true);expect(groups(project)).toHaveLength(0);
  await expect(renderProjectDocument(project,'baselinePreview')).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});
 });

 it.each([false,true])('preserves every V4/V5 show, baseline, current and durable restore (physical blank %s)',async blank=>{
  const {bytes,project,hex}=await fixture(blank),regions=groups(project);
  expect(project.template.importerVersion).toBe('folio-import-v16');expect(project.template.sourceFonts![0].sourceVersion).toBe(blank?5:4);
  expect(project.template.pages[0].regions.length).toBeLessThan(1000);expect(regions.length).toBe(34);if(blank)expect(Array.from(sourceGlyphs(regions.at(-1)!)).some(g=>g.inferredGap)).toBe(true);
  expect(regions.reduce((n,r)=>n+r.sourceScopedPaint!.showGroup!.operators.length,0)).toBeGreaterThan(1000);
  const proof=await validateSourceScopedPaint(bytes,project.template,[],true,true);expect(proof!.groupedCaptures!.size).toBe(1);
  const baseline=await renderProjectDocument(project,'baselinePreview'),approved=await approve(project),region=regions[0],block=approved.draft.blocks.find(b=>b.id===region.contentId)!,wording=blank?'ba ab ab':'ba'.repeat(17);
  expect(baseline.layout.overflows).toEqual([]);
  const edited=editBlock(approved,region.contentId,[{...block.runs[0],text:wording}]),current=await renderProjectDocument(edited,'current');expect(current.layout.overflows).toEqual([]);
  const actual=await stream(current.bytes);expect(actual.text).toContain(' Td');expect(actual.text).toContain('0 0 500 700 re');expect(actual.text).toContain('400 100 20 10 re');
  await saveProject(edited);expect((await loadProjects()).find(p=>p.id===edited.id)!.template).toEqual(project.template);
  const restored=await restoreProject(new File([await backupProject(edited)],'authored-group.zip'));expect(restored.template).toEqual(project.template);expect(restored.draft).toEqual(edited.draft);expect(restored.approval).toBeNull();
  expect((await renderProjectDocument(await approve(restored),'current')).layout.overflows).toEqual([]);
  const group=await restoreGroup(new File([await backupResumeGroup([edited])],'authored-group-project.zip'));expect(group[0].template).toEqual(project.template);expect(group[0].approval).toBeNull();
  const long=editBlock(approved,region.contentId,[{...block.runs[0],text:wording.repeat(20)}]);expect((await renderProjectDocument(long,'current')).layout.overflows.some(e=>e.code==='width')).toBe(true);
  await expect(renderDocument(project.template,project.baseline,[])).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
  if(process.env.FOLIO_GROUP_ORACLE_DIR){
   const out=process.env.FOLIO_GROUP_ORACLE_DIR+'/'+(blank?'v5':'v4');await mkdir(out,{recursive:true});await writeFile(out+'/source.pdf',bytes);await writeFile(out+'/baseline.pdf',baseline.bytes);await writeFile(out+'/current.pdf',current.bytes);
   const ref=await PDFDocument.load(bytes),raw=originalPageContent(ref,1,true),ops=originalOperators(raw,classifyScopedMarkedDictionary,true,true,true),owned=new Set(region.sourceScopedPaint!.showGroup!.operators.map(p=>p[1])),first=region.sourceScopedPaint!.showGroup!.operators[0][1];
   let independent=raw;for(const op of [...ops].reverse())if(owned.has(op.index)){const replacement=op.index===first?'<'+Array.from(wording,hex).join('')+'> Tj':'';independent=independent.slice(0,op.sourceSpan!.start)+replacement+independent.slice(op.sourceSpan!.end);}
   ref.getPages()[0].node.set(PDFName.of('Contents'),ref.context.register(ref.context.flateStream(new TextEncoder().encode(independent))));await writeFile(out+'/independent-current.pdf',await ref.save());
  }
 });
 it('splits at an interleaved primitive and preserves ordinary foreground collision authority',async()=>{
  const {bytes,project}=await fixture(false,true);expect(groups(project).length).toBeGreaterThan(34);await validateSourceScopedPaint(bytes,project.template,[],true,true);
  expect(project.template.pages[0].regions.filter(r=>isSourcePageBackground(r,project.template))).toHaveLength(1);
  const background=project.template.pages[0].regions.find(r=>isSourcePageBackground(r,project.template))!;
  const changed=structuredClone(project);const r=changed.template.pages[0].regions.find(r=>r.id===background.id)!;r.bounds.width-=1;rehash(changed);expect(isSourcePageBackground(r,changed.template)).toBe(false);
  const later=structuredClone(project);const l=later.template.pages[0].regions.find(r=>r.id===background.id)!;l.order=99999;if('sourceScopedPaint'in l)l.sourceScopedPaint!.operatorIndex=l.order;rehash(later);expect(isSourcePageBackground(l,later.template)).toBe(false);
 });
 it.each(['drop','duplicate','reorder','raw-index','glyph-owner','font','downgrade'] as const)('refuses independently rehashed %s ownership during proof and durable write',async mode=>{
  const {bytes,project}=await fixture(false),bad=structuredClone(project),r=groups(bad)[0],owned=r.sourceScopedPaint!.showGroup!.operators;
  if(mode==='drop')owned.splice(3,1);else if(mode==='duplicate')owned[3]=[...owned[2]];else if(mode==='reorder')[owned[2],owned[3]]=[owned[3],owned[2]];else if(mode==='raw-index')owned[2][1]+=1;
  else if(mode==='glyph-owner'){const glyphs=Array.from(sourceGlyphs(r));glyphs[3].operatorIndex+=1;delete r.sourceLayout!.glyphEncoding;r.sourceLayout!.glyphs=glyphs;}
  else if(mode==='font')(bad.template.sourceFonts![0] as import('../core/model').SourceFontAssetV1).originalProgram!.pdfFontRef='999 0 R';
  else{r.sourceScopedPaint!.version='source-scoped-occurrence-v1';delete r.sourceScopedPaint!.showGroup;bad.template.importerVersion='folio-import-v13';}
  rehash(bad);await expect(validateSourceScopedPaint(bytes,bad.template,[],true,true)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});
  await expect(saveProject(bad)).rejects.toBeDefined();expect((await loadProjects()).some(p=>p.id===bad.id)).toBe(false);
 });
 it('keeps versioned transport lossless and refuses sparse, unknown or oversized members before expansion',async()=>{
  const {project}=await fixture(false),pack=(p:unknown)=>packRecordMetadata(packScopedMetadata(p)),unpack=(p:unknown)=>unpackScopedMetadata(unpackRecordMetadata(p));
  const metadata={...project,source:{...project.source,bytes:undefined},assets:[],template:{...project.template,sourceFonts:project.template.sourceFonts!.map(f=>({...f,bytes:undefined,...('originalProgram'in f&&f.originalProgram?{originalProgram:{...f.originalProgram,bytes:undefined}}:{})}))}};expect(unpack(pack(metadata))).toEqual(metadata);
  for(const mutate of [(p:Project)=>{groups(p)[0].sourceScopedPaint!.showGroup!.version='unknown' as never;},(p:Project)=>{delete groups(p)[0].sourceScopedPaint!.showGroup!.operators[2];},(p:Project)=>{groups(p)[0].sourceScopedPaint!.showGroup!.operators=Array.from({length:100001},()=>[1,2]);}]){
   const bad=structuredClone(project);mutate(bad);expect(()=>pack(bad)).toThrow();
  }
  expect(()=>paintGroupedSourcePage({} as never,{} as never,{} as never,new Map(),project.baseline,false)).toThrow();
 });
});

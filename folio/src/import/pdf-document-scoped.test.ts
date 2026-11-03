import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D,GlobalFonts,createCanvas} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {setFontLoader} from '../layout/fonts';
import {authoredMacRomanSource,authoredSymbolicSource} from './document-scoped-test-fixture';
import {importResume} from './index';
import {makeProject,documentScopedProgramHashes,hasValidApproval,canonicalJson,sourceFontReuseChoiceOwner} from '../core/model';
import {validateProject} from '../core/schema';
import {approveTemplate,withdrawApproval,editBlock,confirmDraft,validateExport} from '../core/commands';
import {validateSourceFontAsset,loadSourceFont,sourceOriginalPostAvailable} from '../layout/source-fonts';
import {validateOriginalPrograms} from './pdf-original-tt';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {renderDocument,renderProjectDocument,renderProjectHistory} from '../render/pdf';
import {saveProject,loadProjects,backupProject,restoreProject,backupResumeGroup,restoreGroup} from '../storage/projects';
import {sourceSpacingAvailability,clearSourceSpacingProofs} from '../ui/sourceSpacing';
import {sourceGlyphs} from '../core/source-graph';
import {parseDocumentScopedProgram} from '../layout/document-scoped-program';
import {browserSourceFontBytes} from '../ui/sourceFonts';
import {createApplication} from '../core/applications';
import {DocumentHistory} from '../ui/history';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFRawStream,PDFObjectCopier,decodePDFRawStream} from 'pdf-lib';
import JSZip from 'jszip';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
import {sha256Sync} from '../core/model';
import fontkit from '@pdf-lib/fontkit';
let restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
afterAll(()=>restore?.());
const imported=async()=>{const source=await authoredMacRomanSource();return {source,project:makeProject(await importResume(new File([source.bytes],'authored-macroman.pdf',{type:'application/pdf'})))};};
const approve=async(p:Awaited<ReturnType<typeof imported>>['project'])=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});
describe('absent-post document utility font',()=>{
 const blank=async()=>{const utility=await authoredSymbolicSource({missingPost:true,codes:[33]}),body=await authoredMacRomanSource({codes:[65,66]}),pdf=await PDFDocument.load(body.bytes),other=await PDFDocument.load(utility.bytes),page=pdf.getPages()[0],font=other.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict).lookup(PDFName.of('F1'),PDFDict);
  page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).set(PDFName.of('Utility'),pdf.context.register(PDFObjectCopier.for(other.context,pdf.context).copy(font)));
  const current=decodePDFRawStream(page.node.Contents() as PDFRawStream).decode();page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(new TextDecoder().decode(current)+' q BT /Utility 12 Tf 1 0 0 1 100 648 Tm <21> Tj ET Q')));
  const source={...utility,bytes:new Uint8Array(await pdf.save())};return{source,project:makeProject(await importResume(new File([source.bytes],'authored-utility.pdf',{type:'application/pdf'})))};};
 it('preserves a positive owned blank without creating underline or native editing metrics',async()=>{
  const {source,project}=await blank(),asset=project.template.sourceFonts!.find(f=>f.sourceVersion===7&&f.declaredStyle.post===null)!;expect(asset.sourceVersion).toBe(7);if(asset.sourceVersion!==7)throw Error('V7');
  expect(asset.declaredStyle.post).toBeNull();expect(asset.originalPermission).toBe('absent');expect(asset.originalProgram.bytes).toEqual(source.program);expect(asset.glyphMap).toHaveLength(1);expect(asset.glyphMap[0]).toMatchObject({unicode:' ',nonPainting:true});expect(asset.glyphMap[0].originalGlyphId).toBeGreaterThan(0);
  validateProject(project);validateSourceFontAsset(asset);await validateOriginalPrograms(source.bytes,project.template.sourceFonts!,project.template);expect(sourceOriginalPostAvailable(asset)).toBe(false);
  const face=loadSourceFont(asset);expect(()=>face.underlineOffset(12)).toThrow('no proved underline metrics');expect(()=>face.underlineThickness(12)).toThrow('no proved underline metrics');
  const region=project.template.pages[0].regions.find(r=>r.kind==='text'&&r.style.sourceFontId===asset.id)!;if(region.kind!=='text')throw Error('text');expect(sourceSpacingAvailability(region,asset,Array.from(sourceGlyphs(region)))).toMatchObject({editable:false,reason:expect.stringContaining('lacks post metrics')});
  await expect(approveTemplate(project,project.template.warnings.map(w=>w.id))).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
  const approved=await approve(project),render=await renderProjectDocument(approved,'current');expect(render.layout.overflows).toEqual([]);
  await saveProject(approved);const saved=(await loadProjects()).find(p=>p.id===approved.id)!;expect(saved.template.sourceFonts!.find(f=>f.id===asset.id)).toEqual(asset);const restored=await restoreProject(new File([await backupProject(approved)],'utility.folio'));expect(restored.approval).toBeNull();expect(restored.template.sourceFonts!.find(f=>f.id===asset.id)).toEqual(asset);await renderProjectDocument(restored,'baselinePreview');
 });
 it('requires the versioned nameless owner when an absent-post font paints text',async()=>{
  const source=await authoredSymbolicSource({missingPost:true,codes:[65]}),result=await importResume(new File([source.bytes],'authored-painted.pdf',{type:'application/pdf'}));expect(result.template.importerVersion).toBe('folio-import-v26');expect(result.template.sourceFonts?.[0].sourceVersion).toBe(7);
 });
 it.each(['unicode','blank','gid','post','width'] as const)('rejects a coherently rehashed %s utility mapping',async kind=>{
  const {project}=await blank(),asset=project.template.sourceFonts!.find(f=>f.sourceVersion===7&&f.declaredStyle.post===null)!;if(asset.sourceVersion!==7)throw Error('V7');if(kind==='unicode')asset.glyphMap[0].unicode='A';if(kind==='blank')asset.glyphMap[0].nonPainting=false;if(kind==='gid')asset.glyphMap[0].originalGlyphId=0;if(kind==='post')asset.declaredStyle.post={italicAngle:0,underlinePosition:-100,underlineThickness:50};if(kind==='width')asset.glyphMap[0].nativeWidth!+=1;
  expect(()=>validateSourceFontAsset(asset)).toThrow();await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow();
 });
 it('still rejects a present malformed post rather than treating it as absent',async()=>{
  const {program}=await authoredSymbolicSource({codes:[33]}),bytes=new Uint8Array(program),v=new DataView(bytes.buffer);for(let i=0;i<v.getUint16(4);i++){const at=12+i*16;if(String.fromCharCode(...bytes.subarray(at,at+4))==='post')v.setUint32(at+12,8);}expect(()=>parseDocumentScopedProgram(bytes,{flags:4,italicAngle:0},'symbolic-raw-byte-1-0-format6-v1')).toThrow();
 });
});
describe('document-scoped original TrueType',()=>{
 it('retains absent permission, exact original properties and both positive PDF space aliases',async()=>{
  const {project,source}=await imported();expect(project.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);expect(project.template.sourceFonts).toHaveLength(1);
  const asset=project.template.sourceFonts![0];expect(asset.sourceVersion).toBe(7);if(asset.sourceVersion!==7)throw Error('V7 missing');
  expect(asset.originalPermission).toBe('absent');expect(asset.declaredStyle.weightClass).toBeNull();expect(asset).not.toHaveProperty('fontWeight');expect(asset.originalProgram.bytes).toEqual(source.program);
  validateSourceFontAsset(asset);validateProject(project);await validateOriginalPrograms(source.bytes,[asset],project.template);await validateSourceScopedPaint(source.bytes,project.template);
  const aliases=asset.glyphMap.filter(m=>m.originalCharCode===32||m.originalCharCode===202);expect(aliases).toHaveLength(2);expect(aliases.every(m=>m.nonPainting&&m.originalGlyphId===source.selectors.get(32)!.glyphId)).toBe(true);
  const native=fontkit.create(browserSourceFontBytes(asset));expect(native.glyphForCodePoint(32).path.toSVG()).toBe('');expect(native.glyphForCodePoint(0xa4).path.toSVG()).toBe(fontkit.create(source.program).getGlyph(source.selectors.get(219)!.glyphId).path.toSVG());
 });
 it('requires explicit reuse, confines baseline preview, and clears portable approval',async()=>{
  const {project}=await imported();await expect(approveTemplate(project,project.template.warnings.map(w=>w.id))).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
  await expect(renderDocument(project.template,project.baseline,project.assets)).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
  expect((await renderProjectDocument(project,'baselinePreview')).bytes.length).toBeGreaterThan(0);
  await expect(renderProjectDocument(project,'current')).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
  const approved=await approve(project);expect(hasValidApproval(approved)).toBe(true);await saveProject(approved);expect((await loadProjects()).find(p=>p.id===approved.id)?.approval).toEqual(approved.approval);
  const restored=await restoreProject(new File([await backupProject(approved)],'authored.folio'));expect(restored.approval).toBeNull();expect(canonicalJson(restored.draft)).toBe(canonicalJson(approved.draft));
  const withdrawn=withdrawApproval(approved);expect(hasValidApproval(withdrawn)).toBe(false);expect(()=>editBlock(withdrawn,withdrawn.draft.blocks[0].id,[{text:'AB'}])).toThrow();
  expect(()=>editBlock(approved,approved.draft.blocks[0].id,[{text:'AB',bold:true}])).toThrow();
 });
 it('independently detects removed or downgraded source-class metadata',async()=>{
  const {project}=await imported();const removed=structuredClone(project.template);delete removed.sourceFonts;delete removed.sourceScopedPages;removed.importerVersion='folio-import-v11';await expect(validateOriginalPrograms(project.source.bytes,[],removed)).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});
  const changed=structuredClone(project);changed.baseline.blocks[0].runs[0].text='unowned';await expect(renderProjectDocument(changed,'baselinePreview')).rejects.toThrow();
 });
 it('preserves current withdrawal through undo and exact group source while portable restore clears',async()=>{
  const {project}=await imported(),approved=await approve(project),history=new DocumentHistory();history.push({project:approved,decisions:{}});const withdrawn=withdrawApproval(approved);const undone=history.undo({project:withdrawn,decisions:{}})!;expect(undone.project.approval).toBeNull();expect(history.redo(undone)?.project.approval).toBeNull();
  await saveProject(approved);const group=await backupResumeGroup([approved]);const restored=await restoreGroup(new File([group],'authored-group.folio'));expect(restored.every(p=>!p.approval&&p.reviewedDraftRevision===null)).toBe(true);
 });
 it.each(['source','program','policy','duplicate'] as const)('refuses stale %s permission choices',async kind=>{
  const {project}=await imported(),approved=await approve(project),choice=approved.approval!.sourceFontReuse!;
  if(kind==='source')choice.sourceSha256='a'.repeat(64);if(kind==='program')choice.originalProgramSha256s=['b'.repeat(64)];if(kind==='policy')(choice as any).policyVersion='other';if(kind==='duplicate')choice.originalProgramSha256s.push(choice.originalProgramSha256s[0]);
  expect(hasValidApproval(approved)).toBe(false);expect(()=>validateProject(approved)).toThrow();await expect(renderProjectDocument(approved,'current')).rejects.toThrow();
 });
 it.each(['nativeWidth','originalGlyphId','originalCharCode','property','permission','program','ref','unicode','convertedGlyph'] as const)('rejects changed %s source evidence',async kind=>{
  const {project}=await imported(),asset=project.template.sourceFonts![0];if(asset.sourceVersion!==7)throw Error('V7');
  if(kind==='unicode')asset.glyphMap[0].unicode='Z';if(kind==='convertedGlyph')asset.glyphMap[0].glyphId=0;
  if(kind==='nativeWidth')asset.glyphMap[0].nativeWidth!+=1;if(kind==='originalGlyphId')asset.glyphMap[0].originalGlyphId=0;if(kind==='originalCharCode')asset.glyphMap[0].originalCharCode=202;if(kind==='property')asset.declaredStyle.post!.italicAngle=1;if(kind==='permission')(asset as any).originalPermission=0;if(kind==='program')asset.originalProgram.bytes[0]^=1;if(kind==='ref')asset.originalProgram.pdfFontRef='999 0 R';
  if(kind==='ref'||kind==='unicode')await expect(validateOriginalPrograms(project.source.bytes,[asset],project.template)).rejects.toThrow();else expect(()=>validateSourceFontAsset(asset)).toThrow();
 });
 it.each([false,true])('rechecks a rehashed proofless archive with prefixed PDF header=%s at the actual source classifier',async prefix=>{
  const {project}=await imported(),zip=await JSZip.loadAsync(await backupProject(project)),data=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string')))) as any;
  // Schema-valid catalogue-only representation preserves the actual source bytes.
  delete data.template.sourceFonts;delete data.template.sourceScopedPages;delete data.template.sourceImageContract;data.template.importerVersion='folio-import-v11';delete data.template.sourceOverlaps;delete data.template.sourceRuleOverlaps;
  for(const page of data.template.pages)for(const r of page.regions)if(r.kind==='text'){delete r.style.sourceFontId;delete r.sourceLayout;delete r.sourceScopedPaint;}
  if(prefix){const source=new Uint8Array(project.source.bytes.length+1);source[0]=32;source.set(project.source.bytes,1);data.source.sha256=sha256Sync(source);zip.file('source.pdf',source);}
  const packed=new TextEncoder().encode(JSON.stringify(packRecordMetadata(packScopedMetadata(data))));zip.file('project.json',packed);const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));if(prefix){const bytes=await zip.file('source.pdf')!.async('uint8array'),row=manifest.files.find((f:any)=>f.path==='source.pdf');row.size=bytes.length;row.sha256=sha256Sync(bytes);}
  manifest.files=manifest.files.filter((f:any)=>!f.path.startsWith('fonts/'));for(const name of Object.keys(zip.files))if(name.startsWith('fonts/'))zip.remove(name);const row=manifest.files.find((f:any)=>f.path==='project.json');row.size=packed.length;row.sha256=sha256Sync(packed);zip.file('manifest.json',JSON.stringify(manifest));
  await expect(restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'coherent.folio'))).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});
 });
 it('embeds exact original hints and exports the original physical selector for both blank aliases',async()=>{
  const {project,source}=await imported(),approved=await approve(project),rendered=await renderProjectDocument(approved,'current'),pdf=await PDFDocument.load(rendered.bytes);const page=pdf.getPages()[0],fonts=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict);
  const dict=fonts.lookup(fonts.keys()[0],PDFDict),desc=dict.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),program=desc.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile2')) as PDFRawStream;expect(new Uint8Array(decodePDFRawStream(program).getBytes(4*1024*1024))).toEqual(source.program);
  const map=new Uint8Array(decodePDFRawStream(desc.lookup(PDFName.of('CIDToGIDMap')) as PDFRawStream).getBytes(4*1024*1024)),view=new DataView(map.buffer);for(const m of project.template.sourceFonts![0].glyphMap)expect(view.getUint16(m.cid*2)).toBe(m.originalGlyphId);
  if(process.env.FOLIO_R6_AUTHORED_ORACLE_DIR){const path=process.env.FOLIO_R6_AUTHORED_ORACLE_DIR;await mkdir(path,{recursive:true,mode:0o700});await writeFile(path+'/authored-source.pdf',source.bytes,{flag:'wx',mode:0o600});await writeFile(path+'/authored-output.pdf',rendered.bytes,{flag:'wx',mode:0o600});}
 });

 it('keeps known/restricted/malformed OS2 separate from absent permission and records missing post',async()=>{
  const source=await authoredMacRomanSource({absent:false});expect(()=>parseDocumentScopedProgram(source.program,{flags:32,italicAngle:0})).toThrow();
  for(const mode of ['restricted','truncated','missing-post']){const bytes=new Uint8Array(source.program),v=new DataView(bytes.buffer);for(let i=0;i<v.getUint16(4);i++){const at=12+i*16,tag=String.fromCharCode(...bytes.subarray(at,at+4));if(tag==='OS/2'){if(mode==='restricted')v.setUint16(v.getUint32(at+8)+8,2);if(mode==='truncated')v.setUint32(at+12,8);if(mode==='missing-post')bytes.set(new TextEncoder().encode('ZZZZ'),at);}if(tag==='post'&&mode==='missing-post')bytes.set(new TextEncoder().encode('YYYY'),at);}if(mode==='missing-post')expect(parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0}).properties.post).toBeNull();else expect(()=>parseDocumentScopedProgram(bytes,{flags:32,italicAngle:0})).toThrow();}
  const r=await importResume(new File([source.bytes],'known-rights-physical-only.pdf',{type:'application/pdf'}));expect(r.template.sourceFonts?.some(f=>f.sourceVersion===7)??false).toBe(false);
 });
 it('retains independent original post and descriptor angle evidence',async()=>{
  const {program}=await authoredMacRomanSource(),bytes=new Uint8Array(program),v=new DataView(bytes.buffer);for(let i=0;i<v.getUint16(4);i++){const at=12+i*16;if(String.fromCharCode(...bytes.subarray(at,at+4))==='post')v.setInt32(v.getUint32(at+8)+4,-15*65536);}
  const parsed=parseDocumentScopedProgram(bytes,{flags:32,italicAngle:-7});expect(parsed.properties.post!.italicAngle).toBe(-15);expect(parsed.properties.descriptor.italicAngle).toBe(-7);expect(parsed.properties.weightClass).toBeNull();
 });
 it('loads the actual native derivative with shared blank alias and currency widths without claiming DOM caret proof',async()=>{
  const {project}=await imported(),asset=project.template.sourceFonts![0],key=GlobalFonts.register(Buffer.from(browserSourceFontBytes(asset)),'AuthoredR6Native');expect(key).toBeTruthy();
  try{const ctx=createCanvas(300,50).getContext('2d');ctx.font='16px "AuthoredR6Native"';for(const c of [' ','¤','A','B']){const mapping=asset.glyphMap.find(m=>m.unicode===c)!;expect(Math.abs(ctx.measureText(c).width-mapping.nativeWidth!*16/1000)).toBeLessThan(.06);}}finally{if(key)GlobalFonts.remove(key);}
 });
 it('retains the .06 native boundary gate for V7 cumulative drift and incorrect blank caret width',async()=>{
  const {project}=await imported(),asset=project.template.sourceFonts![0],region=project.template.pages[0].regions.find(r=>r.kind==='text')!;if(region.kind!=='text')throw Error();delete region.sourceScopedPaint;const graph=Array.from(sourceGlyphs(region)),mapping=asset.glyphMap.find(m=>m.unicode==='A')!;
  let drift=0;const span={style:{},firstChild:{},textContent:'',getBoundingClientRect:()=>({x:0}),remove(){}};
  vi.stubGlobal('document',{fonts:{check:()=>true},body:{append(){}},createElement:()=>span,createRange:()=>{let start=0,end=0;return{setStart(_n:unknown,i:number){start=i},setEnd(_n:unknown,i:number){end=i},getBoundingClientRect(){const steps=Array.from(span.textContent).map(c=>asset.glyphMap.find(m=>m.unicode===c)!.nativeWidth!*16/1000+(c===' '?drift:0));return{x:steps.slice(0,start).reduce((a,b)=>a+b,0),width:steps.slice(start,end).reduce((a,b)=>a+b,0)};}};}});
  try{clearSourceSpacingProofs();expect(sourceSpacingAvailability(region,asset,graph).editable).toBe(true);drift=.061;clearSourceSpacingProofs();expect(sourceSpacingAvailability(region,asset,graph).editable).toBe(false);drift=0;clearSourceSpacingProofs();mapping.pdfWidth=mapping.nativeWidth!+.2;const step=mapping.pdfWidth*12/1000,glyphs=Array.from({length:100},(_,i)=>({...graph[0],cid:mapping.cid,unicode:'A',advance:step,x:40+i*step}));expect(sourceSpacingAvailability(region,asset,glyphs.slice(0,2)).editable).toBe(true);expect(sourceSpacingAvailability(region,asset,glyphs).editable).toBe(false);}finally{clearSourceSpacingProofs();vi.unstubAllGlobals();}
 });

 it.each(['renderer','template','baseline'] as const)('invalidates changed %s approval without inheriting the V7 render contract',async kind=>{
  const {project}=await imported(),approved=await approve(project);
  if(kind==='renderer')approved.approval!.rendererVersion='folio-pdf-v1';if(kind==='template')approved.template.revision++;if(kind==='baseline')approved.baseline.blocks[0].runs[0].text='different';
  await expect(renderProjectDocument(approved,'current')).rejects.toThrow();
 });
 it('does not authorize coherently rehashed invented baseline wording',async()=>{
  const {project}=await imported(),region=project.template.pages[0].regions.find(r=>r.kind==='text')!;if(region.kind!=='text'||!region.sourceLayout)throw Error();
  const block=project.baseline.blocks.find(b=>b.id===region.contentId)!;block.runs[0].text='B'+block.runs[0].text.slice(1);const glyphs=Array.from(sourceGlyphs(region)),mapping=project.template.sourceFonts![0].glyphMap.find(m=>m.unicode==='B')!;glyphs[0]={...glyphs[0],unicode:'B',cid:mapping.cid,advance:mapping.pdfWidth*region.sourceLayout.fontSize/1000};
  region.sourceLayout={...region.sourceLayout,glyphEncoding:undefined,glyphs,baselineRunsHash:(await import('../core/model')).hashTextSync(canonicalJson(block.runs))};delete region.sourceLayout.glyphEncoding;region.sourceScopedPaint!.stateHash=(await import('../core/source-scoped-paint')).sourceScopedStateHash(region,project.template.sourceFonts!);
  validateProject(project);await expect(renderProjectDocument(project,'baselinePreview')).rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});
 });
 it('clears a forged portable approval while preserving and independently revalidating its source',async()=>{
  const {project}=await imported(),approved=await approve(project),zip=await JSZip.loadAsync(await backupProject(approved));const metadata=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string')))) as any;
  metadata.approval.sourceFontReuse.sourceSha256='0'.repeat(64);metadata.approval.rendererVersion='forged';const bytes=new TextEncoder().encode(JSON.stringify(packRecordMetadata(packScopedMetadata(metadata))));zip.file('project.json',bytes);const manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),entry=manifest.files.find((x:any)=>x.path==='project.json');entry.size=bytes.length;entry.sha256=sha256Sync(bytes);zip.file('manifest.json',JSON.stringify(manifest));
  const restored=await restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'forged-choice.folio'));expect(restored.approval).toBeNull();expect(restored.source.bytes).toEqual(project.source.bytes);expect(restored.draft).toEqual(project.draft);
 });

 it.each(['renderer','fingerprint','missing','purpose'] as const)('refuses a current revision with wrong render %s receipt',async kind=>{
  const {project}=await imported(),approved=confirmDraft(await approve(project)),render=await renderProjectDocument(approved,'current');await validateExport(approved,render);
  if(kind==='renderer')render.rendererVersion='folio-pdf-v1';if(kind==='fingerprint')render.sourceFingerprint='a'.repeat(64);if(kind==='missing')delete render.sourceFingerprint;if(kind==='purpose')render.documentScopedPurpose='baselinePreview';
  await expect(validateExport(approved,render)).rejects.toMatchObject({code:'EXPORT_NOT_READY'});
 });

 it('separates bounded explicit ToUnicode semantics from the MacRoman physical selector',async()=>{
  const source=await authoredMacRomanSource({codes:[65],semantic:'Z'}),project=makeProject(await importResume(new File([source.bytes],'authored-semantic.pdf',{type:'application/pdf'}))),asset=project.template.sourceFonts![0];expect(asset.sourceVersion).toBe(7);expect(asset.glyphMap[0].unicode).toBe('Z');expect(asset.glyphMap[0].originalGlyphId).toBe(source.selectors.get(65)!.glyphId);await validateOriginalPrograms(source.bytes,[asset],project.template);await validateSourceScopedPaint(source.bytes,project.template);
 });
 it('never treats a positive nonempty space selector as owned nonpainting ink',async()=>{
  const source=await authoredMacRomanSource({spaceInk:true});
  await expect(importResume(new File([source.bytes],'authored-bad-space.pdf',{type:'application/pdf'}))).rejects.toMatchObject({code:'PDF_SOURCE_PROOF',message:'A document-scoped space selector contains original ink.'});
 });

 it('retains exact source/program choice in an application fork but changes the pending checkbox owner',async()=>{
  const {project}=await imported(),approved=await approve(project),fork=await createApplication(approved,{title:'Authored role',company:'Authored company',description:'A fictional job'});expect(fork.approval).toEqual(approved.approval);expect(hasValidApproval(fork)).toBe(true);expect(sourceFontReuseChoiceOwner(fork)).not.toBe(sourceFontReuseChoiceOwner(approved));
  for(const kind of ['source','program','template','project']){const changed=structuredClone(approved);if(kind==='source')changed.source.sha256='a'.repeat(64);if(kind==='program')changed.template.sourceFonts![0].sha256='b'.repeat(64);if(kind==='program'&&changed.template.sourceFonts![0].sourceVersion===7)changed.template.sourceFonts![0].originalProgram.sha256='c'.repeat(64);if(kind==='template')changed.template.revision++;if(kind==='project')changed.id='other';expect(sourceFontReuseChoiceOwner(changed)).not.toBe(sourceFontReuseChoiceOwner(approved));}
 });
 it('checks new property evidence and every current original/converted byte on a warm private cache',async()=>{
  const {project}=await imported(),asset=project.template.sourceFonts![0];if(asset.sourceVersion!==7)throw Error();const face=loadSourceFont(asset);expect(loadSourceFont(asset)).toBe(face);
  const old=asset.declaredStyle.post!.italicAngle;asset.declaredStyle.post!.italicAngle=old+1;expect(()=>loadSourceFont(asset)).toThrow();asset.declaredStyle.post!.italicAngle=old;
  for(const bytes of [asset.bytes,asset.originalProgram.bytes]){const prior=bytes[0];bytes[0]^=1;expect(()=>loadSourceFont(asset)).toThrow();bytes[0]=prior;}expect(loadSourceFont(asset)).toBe(face);
 });

});


async function rebindBaseline(p: ReturnType<typeof makeProject>) {
 const {hashTextSync}=await import('../core/model');const {sourceScopedStateHash}=await import('../core/source-scoped-paint');const {sourceLinkProofHash}=await import('../core/source-links');
 for(const page of p.template.pages)for(const region of page.regions)if(region.kind==='text'&&region.sourceLayout){region.sourceLayout.baselineRunsHash=hashTextSync(canonicalJson(p.baseline.blocks.find(b=>b.id===region.contentId)!.runs));if(region.sourceScopedPaint)region.sourceScopedPaint.stateHash=sourceScopedStateHash(region,p.template.sourceFonts!);}
 for(const link of p.template.sourceLinks??[]){for(const binding of link.bindings){const region=p.template.pages.flatMap(p=>p.regions).find(r=>r.id===binding.regionId)!;if(region.kind==='text')binding.baselineRunsHash=region.sourceLayout!.baselineRunsHash;}link.proofHash=sourceLinkProofHash(link);}
}
describe('independent V7 baseline and bounded history authority',()=>{
 it('retains an actual authored original URI before reuse and on durable reload',async()=>{
  const source=await authoredMacRomanSource({link:'https://example.com/original'}),p=makeProject(await importResume(new File([source.bytes],'linked.pdf',{type:'application/pdf'})));
  expect(p.template.sourceLinks).toHaveLength(1);expect(p.baseline.blocks[0].runs[0].href).toBe('https://example.com/original');
  expect((await renderProjectDocument(p,'baselinePreview')).bytes.length).toBeGreaterThan(0);await saveProject(p);expect((await loadProjects()).find(q=>q.id===p.id)?.baseline).toEqual(p.baseline);
 });
 it.each(['underline','addHref','forgedAnnotation','deleteHref','destination','moveAnnotation'] as const)('rejects coherent %s baseline forgery at shared source authority',async kind=>{
  const source=await authoredMacRomanSource({...(kind==='underline'||kind==='addHref'||kind==='forgedAnnotation'?{}:{link:'https://example.com/original'})}),p=makeProject(await importResume(new File([source.bytes],'attack.pdf',{type:'application/pdf'}))),archive=await backupProject(p);
  const mutate=(q:typeof p)=>{if(kind==='underline')q.baseline.blocks[0].runs[0].underline=true;
   if(kind==='addHref')q.baseline.blocks[0].runs[0].href='https://example.com/novel';
   if(kind==='forgedAnnotation'){const page=q.template.pages[0],region=page.regions.find(r=>r.kind==='text')!;if(region.kind!=='text')throw Error();q.baseline.blocks[0].runs[0].href='https://example.com/forged';q.template.sourceLinks=[{id:crypto.randomUUID(),pageId:page.id,sourceSha256:q.source.sha256,annotationIndex:0,annotationId:'invented-annotation',bounds:{...region.bounds},href:'https://example.com/forged',bindings:[{regionId:region.id,contentId:region.contentId,baselineRunsHash:region.sourceLayout!.baselineRunsHash}],proofHash:'0'.repeat(64)}];}
   if(kind==='deleteHref'){delete q.baseline.blocks[0].runs[0].href;delete q.template.sourceLinks;}
   if(kind==='destination'){q.baseline.blocks[0].runs[0].href='https://example.com/changed';q.template.sourceLinks![0].href='https://example.com/changed';}
   if(kind==='moveAnnotation')q.template.sourceLinks![0].bounds.x+=1;};
  mutate(p);await rebindBaseline(p);validateProject(p);
  await expect(renderProjectDocument(p,'baselinePreview')).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
  await expect(saveProject(p)).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
  const zip=await JSZip.loadAsync(archive),metadata=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string')))) as typeof p;
  mutate(metadata);await rebindBaseline(metadata);const bytes=new TextEncoder().encode(JSON.stringify(packRecordMetadata(packScopedMetadata(metadata))));zip.file('project.json',bytes);
  const manifest=JSON.parse(await zip.file('manifest.json')!.async('string')),entry=manifest.files.find((f:{path:string})=>f.path==='project.json');entry.size=bytes.length;entry.sha256=sha256Sync(bytes);zip.file('manifest.json',JSON.stringify(manifest));
  await expect(restoreProject(new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'coherent-baseline.folio'))).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
 });
 it('rejects a coherent original annotation reassigned to another actually painted region',async()=>{
  const source=await authoredMacRomanSource({link:'https://example.com/original',secondLine:true}),p=makeProject(await importResume(new File([source.bytes],'association.pdf',{type:'application/pdf'})));
  const regions=p.template.pages[0].regions.filter(r=>r.kind==='text');expect(regions).toHaveLength(2);const first=p.baseline.blocks.find(b=>b.id===regions[0].contentId)!,second=p.baseline.blocks.find(b=>b.id===regions[1].contentId)!;
  const link=p.template.sourceLinks![0];delete first.runs[0].href;second.runs[0].href=link.href;link.bounds={...regions[1].bounds};link.bindings=[{regionId:regions[1].id,contentId:regions[1].contentId,baselineRunsHash:regions[1].sourceLayout!.baselineRunsHash}];await rebindBaseline(p);validateProject(p);
  await expect(renderProjectDocument(p,'baselinePreview')).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});await expect(saveProject(p)).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
 });
 it.each(['bold','italic'] as const)('refuses injected baseline %s without inventing original style',async mark=>{const {project}=await imported();project.baseline.blocks[0].runs[0][mark]=true;await rebindBaseline(project);await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow();});
 it('renders only an owned bound saved version and never admits it as current export',async()=>{
  const {saveVersion}=await import('../core/folio');const {project}=await imported();let app=await createApplication(await approve(project),{title:'Authored',company:'Fixture',description:'Use supplied evidence.'});app=saveVersion(app,'download');
  const version=app.folio!.versions[0],render=await renderProjectHistory(app,version.id);expect(render.documentScopedPurpose).toBe('historyPreview');expect((await renderProjectDocument(app,'current')).bytes.length).toBeGreaterThan(0);
  const {exportProblems}=await import('../core/model');expect(exportProblems(app,render).some(x=>x.includes('current document-scoped'))).toBe(true);
  await expect(renderProjectHistory(app,'unowned')).rejects.toMatchObject({code:'SOURCE_HISTORY_PROOF'});
  const unbound=structuredClone(app);delete unbound.folio!.versions[0].documentScopedBinding;await expect(renderProjectHistory(unbound,version.id)).rejects.toMatchObject({code:'SOURCE_HISTORY_PROOF'});
  const changed=structuredClone(app);changed.template.revision++;await expect(renderProjectHistory(changed,version.id)).rejects.toMatchObject({code:'SOURCE_HISTORY_PROOF'});
  await expect(renderProjectHistory(withdrawApproval(app),version.id)).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
 });
});

describe('provider-free V7 tailoring integration',()=>{
 it('runs an exact attributed supplied fact through project-bound rendering and rejects overflow atomically',async()=>{
  const {addCareerNote}=await import('../core/commands');const {runTailoring}=await import('../tailoring/flow');const {AI_MODEL}=await import('../tailoring/ai');const {hashTextSync}=await import('../core/model');
  const {project}=await imported();const resume=await approve(project);
  const app=addCareerNote(addCareerNote(await createApplication(resume,{title:'Authored',company:'Fixture',description:'Use only the exact saved authored fact.'}),'AB'),'BBBBB'),before=structuredClone(app);
  let wording='AB';const status={keyConfigured:true,modelConfigured:true,supportedModel:true,paidRequestsEnabled:true,accountModelVerified:true,busy:false,verification:'verified' as const};
  const client={status:vi.fn().mockResolvedValue(status),verify:vi.fn(),tailor:vi.fn().mockImplementation(async(request:import('../tailoring/ai').AiRequest)=>{const facts=request.facts;return {schemaVersion:1,requestId:request.requestId,context:request.context,contextHash:request.consent.contextHash,model:AI_MODEL,requiresReview:true,usage:null,proposals:[{operation:'replaceParagraphText',blockId:request.blocks[0].id,beforeText:request.blocks[0].text,beforeHash:request.blocks[0].textHash,afterText:wording,afterHash:hashTextSync(wording),reason:'Use the exact authored saved fact.',factIds:facts.map(f=>f.id),factRefs:facts.map(f=>({factId:f.id,version:f.version,assertionId:f.assertionId,sourceId:f.source.id,sourceVersion:f.source.version,sourceHash:f.source.hash,quoteHash:f.source.quoteHash,textHash:f.textHash}))}]};})};
  const result=await runTailoring(app,true,new AbortController().signal,()=>{},client);expect(result.applied).toBe(1);expect(result.project.draft.blocks[0].runs[0].text).toBe('AB');expect(result.project.folio?.versions).toHaveLength(1);expect(result.project.folio!.versions[0].documentScopedBinding).toBeTruthy();expect(app).toEqual(before);
  wording='BBBBB';await expect(runTailoring(app,true,new AbortController().signal,()=>{},client)).rejects.toThrow('does not fit');expect(app).toEqual(before);expect(client.tailor).toHaveBeenCalledTimes(2);
 });
});

 it('refuses V7 box adjustment before mutation and keeps current approved marks separate from baseline authority',async()=>{
  const {adjustTextRegion}=await import('../core/templateRepair');const {project}=await imported(),before=structuredClone(project),region=project.template.pages[0].regions.find(r=>r.kind==='text')!;
  expect(()=>adjustTextRegion(project,region.id,{...region.bounds,width:region.bounds.width+1})).toThrow('original text boxes');expect(project).toEqual(before);
  const approved=await approve(project),draft=editBlock(approved,approved.draft.blocks[0].id,[{...approved.draft.blocks[0].runs[0],underline:true,href:'https://example.com/current'}]);
  expect((await renderProjectDocument(draft,'current')).bytes.length).toBeGreaterThan(0);expect(draft.baseline).toEqual(before.baseline);
 });

function strippedSourceProof(project: ReturnType<typeof makeProject>) {
 const p=structuredClone(project);p.approval=null;p.reviewedDraftRevision=null;
 delete p.template.sourceFonts;delete p.template.sourceScopedPages;delete p.template.sourceImageContract;delete p.template.sourceOverlaps;delete p.template.sourceRuleOverlaps;delete p.template.sourceLinks;p.template.importerVersion='folio-import-v11';
 for(const page of p.template.pages)for(const region of page.regions)if(region.kind==='text'){delete region.style.sourceFontId;delete region.sourceLayout;delete region.sourceScopedPaint;}
 return p;
}
describe('outer project renderer actual source class',()=>{
 it.each(['baselinePreview','current','historyPreview'] as const)('refuses fully removed source proof before the %s legacy branch',async purpose=>{
  const {project}=await imported(),{saveVersion}=await import('../core/folio');const app=saveVersion(await createApplication(await approve(project),{title:'Authored',company:'Fixture',description:'Exact supplied evidence.'}),'download'),p=strippedSourceProof(app);validateProject(p);
  await expect(purpose==='historyPreview'?renderProjectHistory(p,p.folio!.versions[0].id):renderProjectDocument(p,purpose)).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});
 });
 it('classifies a schema-valid proofless source even when its format is coerced to Word',async()=>{
  const {project}=await imported(),p=strippedSourceProof(project);p.source.format='docx';p.source.sourcePageCount=null;p.template.importerVersion='legacy-word';validateProject(p);
  await expect(renderProjectDocument(p,'baselinePreview')).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});
 });
 it('rejects intact V7 source format coercion at schema, saving and rendering',async()=>{
  const {project}=await imported();project.source.format='docx';expect(()=>validateProject(project)).toThrow();await expect(saveProject(project)).rejects.toThrow();await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow();
 });
 it('uses one immutable current snapshot while actual classification is awaiting',async()=>{
  const {project}=await imported(),p=await approve(project),before=structuredClone(p),owner=await import('./pdf-original-tt'),actual=owner.validateDocumentScopedSourceClass;
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);
  const spy=vi.spyOn(owner,'validateDocumentScopedSourceClass').mockImplementationOnce(async(...args)=>{enter();await gate;return actual(...args);});
  try{const pending=renderProjectDocument(p,'current');await entered;p.source.bytes.fill(0);p.draft.blocks[0].runs[0].text='BBBBB';p.template.sourceFonts=undefined;p.approval=null;release();const rendered=await pending;const {sourceDocumentFingerprint}=await import('../core/model');expect(rendered.sourceFingerprint).toBe(sourceDocumentFingerprint(before.template,before.draft));expect(rendered.documentScopedPurpose).toBe('current');}finally{release();spy.mockRestore();}
 });
 it('does not replace a pending rejected original with newly supplied legacy source bytes',async()=>{
  const {project}=await imported(),p=strippedSourceProof(project),{fixtureProject}=await import('../core/testFixture'),legacy=await fixtureProject(),owner=await import('./pdf-original-tt'),actual=owner.validateDocumentScopedSourceClass;
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);const spy=vi.spyOn(owner,'validateDocumentScopedSourceClass').mockImplementationOnce(async(...args)=>{enter();await gate;return actual(...args);});
  try{const pending=renderProjectDocument(p,'baselinePreview');await entered;p.source=legacy.source;p.template=legacy.template;p.baseline=legacy.baseline;release();await expect(pending).rejects.toMatchObject({code:'PDF_ORIGINAL_TT_PROOF'});}finally{release();spy.mockRestore();}
 });
 it('keeps saved history content and ownership fixed while classification awaits',async()=>{
  const {project}=await imported(),{saveVersion}=await import('../core/folio');const p=saveVersion(await createApplication(await approve(project),{title:'Authored',company:'Fixture',description:'Exact evidence.'}),'download'),before=structuredClone(p),id=p.folio!.versions[0].id,owner=await import('./pdf-original-tt'),actual=owner.validateDocumentScopedSourceClass;
  let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);const spy=vi.spyOn(owner,'validateDocumentScopedSourceClass').mockImplementationOnce(async(...args)=>{enter();await gate;return actual(...args);});
  try{const pending=renderProjectHistory(p,id);await entered;p.folio!.versions[0].content.blocks[0].runs[0].text='BBBBB';p.folio!.versions=[];p.template.revision++;release();const render=await pending,{sourceDocumentFingerprint}=await import('../core/model');expect(render.sourceFingerprint).toBe(sourceDocumentFingerprint(before.template,before.folio!.versions[0].content));expect(render.documentScopedPurpose).toBe('historyPreview');}finally{release();spy.mockRestore();}
 });
 it.each(['source','font','fontCount','aggregate','maps','graph','metadata'] as const)('checks %s budget before source classification',async kind=>{
  const {project}=await imported(),font=project.template.sourceFonts![0],region=project.template.pages[0].regions.find(r=>r.kind==='text')!;
  if(kind==='source')project.source.bytes=new Uint8Array(10*1024*1024+1);
  if(kind==='font')font.bytes=new Uint8Array(4*1024*1024+1);
  if(kind==='fontCount')project.template.sourceFonts=Array(33).fill(font);
  if(kind==='aggregate'){if(font.sourceVersion!==7)throw Error();font.bytes=new Uint8Array(3*1024*1024);font.originalProgram.bytes=new Uint8Array(3*1024*1024);project.template.sourceFonts=Array(3).fill(font);}
  if(kind==='maps')font.glyphMap=Array(100001).fill(font.glyphMap[0]);
  if(kind==='graph'&&region.kind==='text')region.sourceLayout!.glyphs=Array(100001).fill(region.sourceLayout!.glyphs[0]);
  if(kind==='metadata')project.facts.push(...Array.from({length:2200},()=>({id:crypto.randomUUID(),text:'A'.repeat(1000),kind:'careerNote' as const,locator:'Authored budget fact',confirmed:true})));
  const owner=await import('./pdf-original-tt'),spy=vi.spyOn(owner,'validateDocumentScopedSourceClass');try{await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow();expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}
 });
 it('preserves font-free legacy rendering above the positioned-font metadata cap and legacy history',async()=>{
  const {fixtureProject}=await import('../core/testFixture'),{saveVersion}=await import('../core/folio');let p=await fixtureProject();const retained=await PDFDocument.create();const retainedPage=retained.addPage([612,792]);retainedPage.node.set(PDFName.of('Contents'),retained.context.register(retained.context.flateStream('')));const retainedBytes=new Uint8Array(await retained.save());p.source={...p.source,bytes:retainedBytes,sha256:sha256Sync(retainedBytes)};p.facts.push(...Array.from({length:2200},()=>({id:crypto.randomUUID(),text:'A'.repeat(1000),kind:'careerNote' as const,locator:'Authored legacy fact',confirmed:true})));expect(JSON.stringify(p).length).toBeGreaterThan(2*1024*1024);validateProject(p);
  expect((await renderProjectDocument(p,'baselinePreview')).bytes.length).toBeGreaterThan(0);p=saveVersion(await createApplication(await approveTemplate(p,[]),{title:'Legacy',company:'Fixture',description:'Exact evidence.'}),'download');expect((await renderProjectDocument(p,'current')).bytes.length).toBeGreaterThan(0);expect((await renderProjectHistory(p,p.folio!.versions[0].id)).bytes.length).toBeGreaterThan(0);
 });
});

describe('V7 original page-count coherence',()=>{
 it.each([null,2])('refuses sourcePageCount=%s for an independently captured one-page original',async count=>{
  const {project}=await imported();expect(project.source.sourcePageCount).toBe(1);expect(project.template.pages).toHaveLength(1);expect(()=>validateProject(project)).not.toThrow();project.source.sourcePageCount=count;
  expect(()=>validateProject(project)).toThrow('Document-scoped original page count');await expect(saveProject(project)).rejects.toThrow('Document-scoped original page count');await expect(renderProjectDocument(project,'baselinePreview')).rejects.toThrow('Document-scoped original page count');
 });
});

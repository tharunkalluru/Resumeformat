import {beforeAll,afterAll,it,expect} from 'vitest';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {readFile,mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {tiny,tnum} from './fixtures/authored-cff-builder.js';
import {setFontLoader} from '../layout/fonts';import {makeProject,sha256Sync,canonicalJson,hashTextSync} from '../core/model';
import 'fake-indexeddb/auto';
import {importResume} from './index';import {renderProjectDocument,licensedCurrentPreviewAllows} from '../render/pdf';
import {captureCffResourceSpec,installCffResourceSpec,validateCffResourceSpec} from './cff-resource-spec';
import {proveOriginalCffResource} from './pdf-original-cff';
let restore:()=>void;beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));});afterAll(()=>restore());
async function authored(neighbors=false,changed=false,spacing=false){const doc=await PDFDocument.create();const outline=(width:number)=>[...tnum(width-100),139,139,21,...tnum(100),139,139,...tnum(200),...tnum(-100),139,5,14];const program=tiny({charset:[0,0,34,0,35],charstrings:[[14],outline(150),outline(300)]});const stream=doc.context.register(doc.context.flateStream(program,{Subtype:'Type1C'}));const descriptor=doc.context.register(doc.context.obj({Type:'FontDescriptor',FontName:'Fiction',Flags:32,FontBBox:[0,0,100,200],ItalicAngle:0,Ascent:700,Descent:-200,CapHeight:700,StemV:80,FontFile3:stream}));const ref=doc.context.register(doc.context.obj({Type:'Font',Subtype:'Type1',BaseFont:'Fiction',Encoding:'WinAnsiEncoding',FirstChar:65,LastChar:66,Widths:[150,300],FontDescriptor:descriptor}));for(let index=0;index<(neighbors?2:1);index++){const page=doc.addPage([500,700]);page.node.set(PDFName.of('Resources'),doc.context.obj({Font:{F1:ref}}));page.node.set(PDFName.of('Contents'),doc.context.register(doc.context.flateStream(`q ${neighbors?'30.125 30.125 440.25 640.25 re W n ':''}BT /F1 12 Tf ${spacing?'-1 Tc ':''}1 0 0 1 40 600 Tm (${changed&&index===0?'BA':'AB'}) Tj ET ${neighbors?'q 0.5 0 0 0.5 0 0 cm BT /F1 20.25 Tf 1 0 0 1 80 1000 Tm [<41> -10 <42>] TJ ET Q q 0.5 0 0 0.5 0 0 cm 80 900 840 2 re f Q':''} ${spacing?'0.2 w 39 601 m 45 601 l S BT /F1 12 Tf 0 Tc 1 0 0 1 40 550 Tm (AB) Tj ET':''} Q`)));}return{doc,program,ref,bytes:new Uint8Array(await doc.save())};}
it('resource specification re-creates the original simple consumer, not a converted CID font',async()=>{const f=await authored(),proof=proveOriginalCffResource(f.doc,f.ref,sha256Sync(f.bytes))!,spec=captureCffResourceSpec(f.doc,f.ref,proof),out=await PDFDocument.create(),font=installCffResourceSpec(out.context,spec,f.program);expect(font.lookup(PDFName.of('Subtype'),PDFName).decodeText()).toBe('Type1');const descriptor=font.lookup(PDFName.of('FontDescriptor'),PDFDict),stream=descriptor.lookup(PDFName.of('FontFile3')) as PDFRawStream;expect(sha256Sync(decodePDFRawStream(stream).decode())).toBe(sha256Sync(f.program));expect(validateCffResourceSpec(spec,f.program,sha256Sync(f.bytes)).programSha256).toBe(proof.programSha256);const changed=structuredClone(spec);changed.selectorBytes=2;expect(()=>validateCffResourceSpec(changed,f.program,sha256Sync(f.bytes))).toThrow();});
it('genuine import owns original CFF programme and ordinary reconstructed PDF emits its original selectors',async()=>{const f=await authored(),imported=await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'})),project=makeProject(imported);expect(project.template.sourceFonts?.[0]?.sourceVersion).toBe(9);const font=project.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');expect(font.originalProgram.sha256).toBe(sha256Sync(f.program));expect(font.glyphMap.map(m=>[m.originalCharCode,m.originalGlyphId,m.unicode,m.nativeWidth,m.pdfWidth])).toEqual([[65,1,'A',150,150],[66,2,'B',300,300]]);const rendered=await renderProjectDocument(project,'baselinePreview');expect(rendered.layout.overflows).toHaveLength(0);const output=await PDFDocument.load(rendered.bytes),fonts=output.getPage(0).node.Resources()!.lookup(PDFName.of('Font'),PDFDict);const used=fonts.entries().map(([,r])=>output.context.lookup(r,PDFDict));expect(used.some(f=>f.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()==='Type1')).toBe(true);});

it('covered current wording keeps original CFF bytes and refuses uncovered characters and changed formatting',async()=>{
 const f=await authored();let project=makeProject(await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'})));
 const {approveTemplate,editBlock,confirmDraft,validateExport}=await import('../core/commands');
 project=await approveTemplate(project,project.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));
 const block=project.draft.blocks[0];project=editBlock(project,block.id,[{...block.runs[0],text:'BA'}]);
 project=confirmDraft(project);const current=await renderProjectDocument(project,'current');if(process.env.R50_AUTHORED_OUTPUT){const directory=process.env.R50_AUTHORED_OUTPUT;await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'authored-source.pdf'),f.bytes);await writeFile(resolve(directory,'authored-current.pdf'),current.bytes);await writeFile(resolve(directory,'authored-baseline.pdf'),(await renderProjectDocument(project,'baselinePreview')).bytes);}await expect(validateExport(project,current)).resolves.toBeUndefined();const region=project.template.pages[0].regions.find(r=>r.kind==='text')!;expect(licensedCurrentPreviewAllows(current,project,region.id)).toBe(true);expect(licensedCurrentPreviewAllows(structuredClone(current),project,region.id)).toBe(false);const altered=structuredClone(project);altered.draft.blocks[0].runs[0].text='AA';expect(licensedCurrentPreviewAllows(current,altered,region.id)).toBe(false);expect(current.layout.overflows).toHaveLength(0);
 const output=await PDFDocument.load(current.bytes),fonts=output.getPage(0).node.Resources()!.lookup(PDFName.of('Font'),PDFDict);
 const actual=fonts.entries().map(([,r])=>output.context.lookup(r,PDFDict)).find(v=>v.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()==='Type1')!;
 const stream=actual.lookup(PDFName.of('FontDescriptor'),PDFDict).lookup(PDFName.of('FontFile3')) as PDFRawStream;
 expect(sha256Sync(decodePDFRawStream(stream).decode())).toBe(sha256Sync(f.program));
 await expect(renderProjectDocument(editBlock(project,block.id,[{...block.runs[0],text:'C'}]),'current')).rejects.toMatchObject({code:'SOURCE_CFF_CURRENT'});
 await expect(renderProjectDocument(editBlock(project,block.id,[{...block.runs[0],text:'BA',bold:true}]),'current')).rejects.toMatchObject({code:'SOURCE_CFF_CURRENT'});
 const overflow=await renderProjectDocument(editBlock(project,block.id,[{...block.runs[0],text:'B'.repeat(100)}]),'current');expect(overflow.layout.overflows.length).toBeGreaterThan(0);
});

it('portable original CFF attachments preserve raw programmes and coherent font deletion cannot select legacy rendering',async()=>{
 const f=await authored(),project=makeProject(await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'})));
 const {backupProject,restoreProject}=await import('../storage/projects');const backup=await backupProject(project),restored=await restoreProject(new File([backup],'authored.folio'));
 const font=restored.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');expect(sha256Sync(font.originalProgram.bytes)).toBe(sha256Sync(f.program));
 const forged=structuredClone(project);forged.template.sourceFonts=[];forged.template.sourceScopedPages=undefined;for(const p of forged.template.pages)for(const r of p.regions){if(r.kind==='text'){delete r.style.sourceFontId;delete r.sourceLayout;}if('sourceScopedPaint'in r)delete r.sourceScopedPaint;}forged.source.format='docx';
 await expect(renderProjectDocument(forged,'baselinePreview')).rejects.toBeDefined();await expect(backupProject(forged)).rejects.toBeDefined();
});
it('CFF resource filter chains and original-program tampering refuse before current rendering',async()=>{
 const f=await authored(),project=makeProject(await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'})));
 const changed=structuredClone(project),font=changed.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');font.originalProgram.bytes[0]^=1;
 await expect(renderProjectDocument(changed,'baselinePreview')).rejects.toBeDefined();
 const fontDict=f.doc.context.lookup(f.ref,PDFDict),descriptor=fontDict.lookup(PDFName.of('FontDescriptor'),PDFDict),stream=descriptor.lookup(PDFName.of('FontFile3')) as PDFRawStream;stream.dict.set(PDFName.of('Filter'),f.doc.context.obj(['FlateDecode','FlateDecode']));
 expect(()=>proveOriginalCffResource(f.doc,f.ref,sha256Sync(f.bytes))).toThrow();
});

it('single and group portable CFF backups bind complete baseline run marks to a fresh original import',async()=>{
 const f=await authored(),project=makeProject(await importResume(new File([f.bytes],'Authored marks.pdf',{type:'application/pdf'})));
 const {backupProject,restoreProject,backupResumeGroup,restoreGroup,saveProject}=await import('../storage/projects');
 const single=await restoreProject(new File([await backupProject(project)],'marks.folio'));
 const group=await restoreGroup(new File([await backupResumeGroup([project])],'marks-group.folio'));
 for(const restored of [single,group[0]]){const font=restored.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');expect(sha256Sync(font.originalProgram.bytes)).toBe(sha256Sync(f.program));expect(restored.baseline).toEqual(project.baseline);}
 for(const mark of [{bold:true},{italic:true},{underline:true},{href:'https://example.com/'}]){
  const forged=structuredClone(project),block=forged.baseline.blocks[0];block.runs[0]={...block.runs[0],...mark};forged.draft=structuredClone(forged.baseline);
  const region=forged.template.pages[0].regions.find(r=>r.kind==='text'&&r.contentId===block.id);if(region?.kind!=='text'||!region.sourceLayout||!region.sourceScopedPaint)throw Error('owner');region.sourceLayout.baselineRunsHash=hashTextSync(canonicalJson(block.runs));
  const {sourceScopedStateHash}=await import('../core/source-scoped-paint');region.sourceScopedPaint.stateHash=sourceScopedStateHash(region,forged.template.sourceFonts??[]);
  const {validateProject}=await import('../core/schema');expect(()=>validateProject(forged)).not.toThrow();
  await expect(backupProject(forged)).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
  await expect(backupResumeGroup([forged])).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
  await expect(saveProject(forged)).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});
 }
});

it('browser derivative maps covered scalars without replacing original CFF ownership or claiming native caret proof',async()=>{
 const f=await authored(),project=makeProject(await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'}))),font=project.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');
 const {deriveBrowserCffFont}=await import('../ui/sourceCffFonts'),before=sha256Sync(font.originalProgram.bytes),derived=await deriveBrowserCffFont(font);
 expect(derived.coveredScalars).toEqual(['A','B']);expect(derived.nativeCaretVerified).toBe(false);expect(sha256Sync(font.originalProgram.bytes)).toBe(before);
});

it('coherently rehashed CFF resource metadata still requires the retained original resource',async()=>{
 const f=await authored(),project=makeProject(await importResume(new File([f.bytes],'Authored.pdf',{type:'application/pdf'}))),font=project.template.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');
 const visit=(value:unknown):boolean=>{if(!value||typeof value!=='object')return false;const object=value as Record<string,unknown>;if(object.dict&&typeof object.dict==='object'&&'ItalicAngle'in object.dict){(object.dict as Record<string,unknown>).ItalicAngle=1;return true;}return Object.values(object).some(visit);};
 expect(visit(font.originalCff.dictionary)).toBe(true);const {sha256:_,...spec}=font.originalCff;font.originalCff.sha256=sha256Sync(new TextEncoder().encode(canonicalJson(spec)));
 expect(()=>validateCffResourceSpec(font.originalCff,font.originalProgram.bytes,font.sourceSha256)).not.toThrow();
 await expect(renderProjectDocument(project,'baselinePreview')).rejects.toBeDefined();
 const {backupProject}=await import('../storage/projects');await expect(backupProject(project)).rejects.toBeDefined();
});

it('changed owner preserves two-page original TJ neighbors, raw matrices, clips and rectangle paint',async()=>{
 const f=await authored(true),expected=await authored(true,true),{approveTemplate,editBlock,confirmDraft,validateExport}=await import('../core/commands');
 let project=makeProject(await importResume(new File([f.bytes],'Neighbors.pdf',{type:'application/pdf'})));
 project=await approveTemplate(project,project.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));
 const baseline=await renderProjectDocument(project,'baselinePreview'),block=project.draft.blocks[0],before=structuredClone(project.baseline.blocks);
 project=confirmDraft(editBlock(project,block.id,[{...block.runs[0],text:'BA'}]));
 const current=await renderProjectDocument(project,'current');await expect(validateExport(project,current)).resolves.toBeUndefined();expect(project.baseline.blocks).toEqual(before);expect(current.layout.overflows).toHaveLength(0);expect(current.sourceReplay).toBe('original-cff-current');const owners=project.template.pages[0].regions.filter(r=>r.kind==='text');expect(licensedCurrentPreviewAllows(current,project,owners[0].id)).toBe(true);expect(licensedCurrentPreviewAllows(current,project,owners[1].id)).toBe(false);
 const streams=async(bytes:Uint8Array)=>{const d=await PDFDocument.load(bytes);return d.getPages().map(p=>{const c=p.node.Contents();const refs=c instanceof PDFArray?c.asArray():[c!];return refs.map(r=>new TextDecoder().decode(decodePDFRawStream(d.context.lookup(r) as PDFRawStream).decode())).join('\n');});};
 const originalOutput=await streams(baseline.bytes),editedOutput=await streams(current.bytes);
 expect(editedOutput[1]).toBe(originalOutput[1]);
 for(const content of editedOutput){expect(content).toContain('0.5 0 0 0.5 0 0 cm');expect(content).toContain('20.25 Tf');expect(content).toContain('1 0 0 1 80 1000 Tm');expect(content).toContain('[<41> -10 <42>] TJ');expect(content).toContain('80 900 840 2 re');expect(content).toContain('30.125 30.125 440.25 640.25 re');}
 expect(editedOutput[0]).not.toBe(originalOutput[0]);
 if(process.env.R50_NEIGHBOR_OUTPUT){const directory=process.env.R50_NEIGHBOR_OUTPUT;await mkdir(directory,{recursive:true});for(const [name,bytes]of [['source',f.bytes],['expected-current',expected.bytes],['baseline',baseline.bytes],['current',current.bytes]] as const)await writeFile(resolve(directory,`authored-neighbors-${name}.pdf`),bytes);}
});

it('original CFF Tc glyph intersections and rule intersections retain bounded source ownership',async()=>{
 const f=await authored(false,false,true),project=makeProject(await importResume(new File([f.bytes],'Spacing.pdf',{type:'application/pdf'})));
 const {sourceOverlapProofs}=await import('../core/source-graph'),{validatedSourceOverlapKeys,currentSourceScopedOverlapKeys,buildSourceRuleOverlapManifest}=await import('../layout/source-overlaps');
 expect(project.template.pages[0].regions.filter(r=>r.kind==='text').map(r=>r.sourceLayout?.version)).toEqual([3,1]);
 expect(Array.from(sourceOverlapProofs(project.template)).length).toBeGreaterThan(0);expect(validatedSourceOverlapKeys(project.template).size).toBeGreaterThan(0);
 const rules=buildSourceRuleOverlapManifest(project.template);expect(rules).toEqual([]);expect(project.template.sourceRuleOverlaps).toBeUndefined();expect(currentSourceScopedOverlapKeys(project.template).size).toBeGreaterThan(0);
 const baseline=await renderProjectDocument(project,'baselinePreview');expect(baseline.layout.overflows).toHaveLength(0);
 if(process.env.R50_SPACING_OUTPUT){await mkdir(process.env.R50_SPACING_OUTPUT,{recursive:true});await writeFile(resolve(process.env.R50_SPACING_OUTPUT,'authored-spacing-source.pdf'),f.bytes);await writeFile(resolve(process.env.R50_SPACING_OUTPUT,'authored-spacing-baseline.pdf'),baseline.bytes);}
 const changedRule=structuredClone(project.template),rule=changedRule.pages[0].regions.find(r=>r.kind==='rule')!;if(rule.kind!=='rule'||!rule.sourceScopedPaint)throw Error('scoped rule');expect(rule.sourcePaint).toBeUndefined();rule.bounds.x+=.1;const {sourceScopedStateHash}=await import('../core/source-scoped-paint');rule.sourceScopedPaint.stateHash=sourceScopedStateHash(rule,changedRule.sourceFonts??[]);const {validateSourceScopedPaint}=await import('./pdf-scoped-source');await expect(validateSourceScopedPaint(f.bytes,changedRule,[],true,true)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});
 const bad=structuredClone(project.template),font=bad.sourceFonts![0];if(font.sourceVersion!==9)throw Error('class');font.glyphMap[0].originalGlyphId=2;
 expect(()=>validatedSourceOverlapKeys(bad)).toThrow();
 const moved=structuredClone(project.template),region=moved.pages[0].regions.find(r=>r.kind==='text')!;if(region.kind!=='text'||!region.sourceLayout)throw Error('region');region.sourceLayout.baseline+=1;expect(()=>validatedSourceOverlapKeys(moved)).toThrow();
 const {approveTemplate,editBlock}=await import('../core/commands'),approved=await approveTemplate(project,project.template.warnings.filter(w=>w.severity==='review').map(w=>w.id)),block=approved.draft.blocks[0];
 await expect(renderProjectDocument(editBlock(approved,block.id,[{...block.runs[0],text:'BA'}]),'current')).rejects.toMatchObject({code:'SOURCE_CFF_CURRENT'});
});

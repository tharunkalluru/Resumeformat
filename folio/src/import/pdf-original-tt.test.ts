import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import 'fake-indexeddb/auto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {PDFDocument,PDFDict,PDFName,PDFArray,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {originalTfEvents,originalUnicodeMap,validateOriginalPrograms,originalTrueTypeBindings} from './pdf-original-tt';
import {setFontLoader} from '../layout/fonts';
import {sourceGlyphs} from '../core/source-graph';
import {blockText,makeProject,sha256Sync} from '../core/model';
import {approveTemplate,confirmDraft,editBlock,validateExport} from '../core/commands';
import {createApplication} from '../core/applications';
import {validateProject} from '../core/schema';
import {backupProject,backupResumeGroup,loadProjects,restoreGroup,restoreProject,saveProject} from '../storage/projects';
import {importResume} from './index';
import {renderDocument} from '../render/pdf';

describe('bounded original font-resource lexer and Unicode proof',()=>{
 it('reads only actual top-level Tf events, retaining exact resource name and size',()=>{
  expect(originalTfEvents('% /wrong 1 Tf\nq (/fake 5 Tf) Tj <2f46616b65> Tj [(/hidden 7 Tf)] TJignored << /ignored (/fake 8 Tf) >> BDC /F#35 9.96 Tf /F6 11 Tf Q').events).toEqual([{resourceName:'F5',size:9.96},{resourceName:'F6',size:11}]);
 });
 it('keeps ordered Tf ownership across bounded signed TJ arrays and skips strings/comments as operands',()=>expect(originalTfEvents('/F5 10 Tf [<0003> +15.5 (escaped\\) /Fake 99 Tf) -.25 <0004>] TJ % /Fake 1 Tf\n /F6 11 Tf [<0005> 0] TJ').events).toEqual([{resourceName:'F5',size:10},{resourceName:'F6',size:11}]));
 it.each(['BI /F5 10 Tf','/X1 Do /F5 10 Tf','/F5 10 Tf (<0003>) TJ','/F5 10 Tf [[<0003>]] TJ','/F5 10 Tf [<< /CID 3 >>] TJ','/F5 10 Tf [/F5 <0003>] TJ','/F5 10 Tf [<0003> NaN] TJ','/F5 10 Tf [<0003> 1e9] TJ','/F5 10 Tf [] [] TJ','/F5 NaN Tf','/F5 10 Tf (unterminated','/F5 10 Tf <xy> Tj','/F5 10 Tf << /a 1 >'])('refuses unsupported or malformed resource trace %s',text=>expect(()=>originalTfEvents(text)).toThrow());
 it('retains exact bfchar and finite scalar bfrange Unicode without guessed selectors',()=>{
  const prefix='1 begincodespacerange <0000> <ffff> endcodespacerange';
  expect([...originalUnicodeMap(`${prefix} 1 beginbfchar <0003> <0020> endbfchar 1 beginbfrange <0004> <0005> <0061> endbfrange`)]).toEqual([[3,' '],[4,'a'],[5,'b']]);
  expect(originalUnicodeMap(`${prefix} 1 beginbfchar <0003> <00ad> endbfchar`).get(3)).toBe('\u00ad');
  for(const body of ['2 beginbfchar <0003> <0020> endbfchar','1 beginbfrange <0005> <0004> <0061> endbfrange','1 beginbfchar <0003> <0020> endbfchar 1 beginbfchar <0003> <0020> endbfchar','1 beginbfchar <0003> <d800> endbfchar'])expect(()=>originalUnicodeMap(`${prefix} ${body}`)).toThrow();
 });
});

describe('fictional original-owned Identity-H TrueType import',()=>{
 let restore:()=>void,program:Uint8Array;
 beforeAll(async()=>{program=new Uint8Array(await readFile(resolve('public/fonts/DejaVuSans.ttf')));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');(await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
 afterAll(()=>restore?.());
 async function original(bytes:Uint8Array,includeUnused=false,unknownLabel=false){const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);const used=await pdf.embedFont(bytes,{subset:false}),page=pdf.addPage([500,700]);page.drawText('abc',{font:used,size:12,x:40,y:648});let unusedRef:string|undefined;if(includeUnused){const unused=await pdf.embedFont(program,{subset:false});page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).set(PDFName.of('UnusedIdentical'),unused.ref);unusedRef=unused.ref.toString();}if(unknownLabel){await pdf.flush();pdf.context.lookup(used.ref,PDFDict).set(PDFName.of('BaseFont'),PDFName.of('FictionalUncataloguedTestFace'));}return{bytes:new Uint8Array(await pdf.save()),usedRef:used.ref.toString(),unusedRef};}
 it.each([undefined, 725, 0])('retains absent CIDFont W and source default width %s',async width=>{
  const source=await original(program),d=await PDFDocument.load(source.bytes),p=d.getPages()[0],dict=p.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][1],font=d.context.lookup(dict,PDFDict),cid=font.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict);
  cid.delete(PDFName.of('W'));if(width===undefined)cid.delete(PDFName.of('DW'));else cid.set(PDFName.of('DW'),d.context.obj(width));
  const bytes=new Uint8Array(await d.save()),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,fontExtraProperties:true,verbosity:0});
  try{const page=await(await task.promise).getPage(1),bindings=await originalTrueTypeBindings(page,bytes,1,await page.getOperatorList()),proof=[...bindings.values()][0];expect(bindings.size).toBe(1);expect(proof.widths.size).toBe(0);expect(proof.defaultWidth).toBe(width??1000);expect(proof.bytes).toEqual(program);}finally{await task.destroy();}
 });
 it.each(['malformed-W','negative-DW','oversized-DW'])('refuses %s instead of treating it as an omitted width declaration',async mode=>{
  const source=await original(program),d=await PDFDocument.load(source.bytes),p=d.getPages()[0],dict=p.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][1],cid=d.context.lookup(dict,PDFDict).lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict);
  cid.delete(PDFName.of('W'));if(mode==='malformed-W')cid.set(PDFName.of('W'),d.context.obj(1000));else cid.set(PDFName.of('DW'),d.context.obj(mode==='negative-DW'?-1:10001));
  const bytes=new Uint8Array(await d.save()),pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(bytes),useSystemFonts:false,fontExtraProperties:true,verbosity:0});
  try{const page=await(await task.promise).getPage(1);await expect(originalTrueTypeBindings(page,bytes,1,await page.getOperatorList())).rejects.toThrow();}finally{await task.destroy();}
 });
 it('retains the actually selected resource despite an unused identical font and refuses unused restore ownership',async()=>{
  const source=await original(program,true),result=await importResume(new File([new Uint8Array(source.bytes).buffer],'fictional-identity-font.pdf',{type:'application/pdf'}));
  expect(result.template.importerVersion).toBe('folio-import-v13');expect(result.template.warnings.filter(w=>w.code==='FONT_SUBSTITUTION'||w.severity==='blocking')).toEqual([]);
  const asset=result.template.sourceFonts![0];expect(asset.format).toBe('truetype');if(asset.format!=='truetype')throw Error();expect(asset.sourceVersion).toBe(4);expect(asset.originalProgram!.pdfFontRef).toBe(source.usedRef);
  expect(result.baseline.blocks.map(blockText).join('')).toBe('abc');expect((await renderDocument(result.template,result.baseline,result.assets)).layout.overflows).toEqual([]);await validateOriginalPrograms(source.bytes,result.template.sourceFonts!);
  const falseOwner=structuredClone(asset);falseOwner.originalProgram!.pdfFontRef=source.unusedRef!;await expect(validateOriginalPrograms(source.bytes,[falseOwner])).rejects.toThrow();
 });
 it('refuses used preview/print-only original rights even when PDF.js repairs the converted program',async()=>{
  const restricted=new Uint8Array(program),view=new DataView(restricted.buffer);for(let i=0;i<view.getUint16(4);i++){const entry=12+i*16;if(String.fromCharCode(...restricted.slice(entry,entry+4))==='OS/2')view.setUint16(view.getUint32(entry+8)+8,4);}
  const source=await original(restricted,true,true),result=await importResume(new File([new Uint8Array(source.bytes).buffer],'fictional-readonly-font.pdf',{type:'application/pdf'}));
  expect(result.template.sourceFonts??[]).toEqual([]);expect(result.template.warnings.some(w=>w.code==='PDF_SOURCE_PROOF'&&w.severity==='blocking')).toBe(true);expect(result.baseline.blocks.map(blockText).join('')).toBe('abc');
 });
 it('preserves positive and negative source TJ adjustments in the actual selectable exported PDF',async()=>{
  const source=await original(program),pdf=await PDFDocument.load(source.bytes),page=pdf.getPages()[0],resource=page.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).entries()[0][0].toString(),font=fontkit.create(program),gids=Array.from('abc').map(c=>font.glyphForCodePoint(c.codePointAt(0)!).id),hex=(gid:number)=>gid.toString(16).padStart(4,'0');
  page.node.set(PDFName.of('Contents'),pdf.context.register(pdf.context.flateStream(new TextEncoder().encode(`q BT ${resource} 12 Tf 1 0 0 1 40 648 Tm [<${hex(gids[0])}> 15 <${hex(gids[1])}> -25 <${hex(gids[2])}>] TJ ET Q`))));
  const bytes=new Uint8Array(await pdf.save()),result=await importResume(new File([new Uint8Array(bytes).buffer],'fictional-signed-tj.pdf',{type:'application/pdf'}));
  expect(result.template.warnings.filter(w=>w.severity==='blocking'||w.code==='FONT_SUBSTITUTION')).toEqual([]);const asset=result.template.sourceFonts![0];expect(asset.format==='truetype'&&asset.sourceVersion===4).toBe(true);
  const glyphs=result.template.pages.flatMap(p=>p.regions.flatMap(r=>r.kind==='text'&&r.sourceLayout?Array.from(sourceGlyphs(r)):[]));expect(glyphs.map(g=>g.unicode).join('')).toBe('abc');
  const expected=[40,40+font.getGlyph(gids[0]).advanceWidth*12/font.unitsPerEm-.18];expected.push(expected[1]+font.getGlyph(gids[1]).advanceWidth*12/font.unitsPerEm+.3);glyphs.forEach((g,i)=>expect(g.x).toBeCloseTo(expected[i],12));
  const rendered=await renderDocument(result.template,result.baseline,result.assets);expect(rendered.layout.overflows).toEqual([]);
  if(process.env.FOLIO_FICTIONAL_TJ_OUTPUT){await writeFile(`${process.env.FOLIO_FICTIONAL_TJ_OUTPUT}/fictional-signed-tj.pdf`,bytes,{mode:0o600});await writeFile(`${process.env.FOLIO_FICTIONAL_TJ_OUTPUT}/fictional-signed-tj-canonical.pdf`,rendered.bytes,{mode:0o600});}
  const actual=await PDFDocument.load(rendered.bytes),contents=actual.getPages()[0].node.Contents()!,streams=contents instanceof PDFArray?contents.asArray().map(ref=>actual.context.lookup(ref) as PDFRawStream):[actual.context.lookup(contents) as PDFRawStream],commands=streams.map(s=>new TextDecoder().decode(decodePDFRawStream(s).decode())).join('\n'),matrices=[...commands.matchAll(/1 0 0 1 ([+\-.\d]+) ([+\-.\d]+) Tm/g)];
  expect(matrices).toHaveLength(3);matrices.forEach((m,i)=>{expect(Number(m[1])).toBeCloseTo(expected[i],12);expect(Number(m[2])).toBe(648);});
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs'),task=pdfjs.getDocument({data:new Uint8Array(rendered.bytes),useSystemFonts:false,verbosity:0});try{const page=await(await task.promise).getPage(1),text=await page.getTextContent({disableNormalization:true});expect(text.items.filter(i=>'str'in i).map(i=>'str'in i?i.str:'').join('')).toBe('abc');}finally{await task.destroy();}
 });
});

describe.runIf(!!process.env.FOLIO_RELEASED_TT_PDF)('locally released development source',()=>{
 let restore:()=>void;
 beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');(await import('pdfjs-dist/legacy/build/pdf.mjs')).GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
 afterAll(()=>restore?.());
 it('binds every source glyph to the actual original font and produces a current selectable PDF',async()=>{
  const path=process.env.FOLIO_RELEASED_TT_PDF!,bytes=new Uint8Array(await readFile(path)),hash=sha256Sync(bytes);
  const result=await importResume(new File([new Uint8Array(bytes).buffer],'released-development.pdf',{type:'application/pdf'}));
  const glyphs=result.template.pages.flatMap(p=>p.regions.flatMap(r=>r.kind==='text'&&r.sourceLayout?Array.from(sourceGlyphs(r)):[]));
  if(process.env.FOLIO_RELEASED_TT_OUTPUT){await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-import-diagnostic.json`,JSON.stringify({sourceSha256:hash,glyphs:glyphs.length,fonts:result.template.sourceFonts?.map(f=>({format:f.format,...(f.format==='truetype'?{sourceVersion:f.sourceVersion,originalRef:f.originalProgram?.pdfFontRef}:{}),maps:f.glyphMap.length})),warnings:result.template.warnings},null,2),{mode:0o600});}
  expect(result.template.sourceFonts?.every(f=>f.format==='truetype'&&f.sourceVersion===4&&!!f.originalProgram)).toBe(true);
  expect(glyphs.length).toBeGreaterThan(0);
  expect(result.template.warnings.filter(w=>w.code==='FONT_SUBSTITUTION'||w.severity==='blocking')).toEqual([]);
  const rendered=await renderDocument(result.template,result.baseline,result.assets);expect(rendered.layout.overflows).toEqual([]);
  // Current export uses an explicit CIDToGID stream. That source container is
  // outside this Identity-only admission slice; refuse it honestly on import.
  const reimported=await importResume(new File([new Uint8Array(rendered.bytes).buffer],'released-development-output.pdf',{type:'application/pdf'}));
  expect(reimported.template.warnings.some(w=>w.code==='PDF_SOURCE_PROOF'&&w.severity==='blocking')).toBe(true);
  expect(reimported.template.sourceFonts??[]).toEqual([]);
  if(process.env.FOLIO_RELEASED_TT_OUTPUT){await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-canonical.pdf`,rendered.bytes,{mode:0o600});await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-import.json`,JSON.stringify(result,(_,v)=>v instanceof Uint8Array?{sha256:sha256Sync(v),bytes:v.length}:v),{mode:0o600});}
  expect(sha256Sync(new Uint8Array(await readFile(path)))).toBe(hash);
  // This optional case remains private. Public fixtures never embed its bytes,
  // name, wording or font programs; the receipt contains hashes/counts only.
  const project=await approveTemplate(validateProject(makeProject(result)),result.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));
  await saveProject(project);const reloaded=(await loadProjects()).find(p=>p.id===project.id)!;
  expect(reloaded.template).toEqual(project.template);expect(reloaded.source.bytes).toEqual(bytes);
  const backup=await backupProject(reloaded),restored=await restoreProject(new File([backup],'released-development.folio.zip'));
  expect(restored.template).toEqual(project.template);expect(restored.baseline).toEqual(project.baseline);
  const application=await createApplication(reloaded);
  const editable=application.draft.blocks.find(b=>b.runs.length===1&&Array.from(blockText(b)).length>=6)!;
  const fitting=confirmDraft(editBlock(application,editable.id,[{...editable.runs[0],text:Array.from(blockText(editable)).slice(0,-1).join('')}]));
  const fittingRender=await renderDocument(fitting.template,fitting.draft,fitting.assets);expect(fittingRender.layout.overflows).toEqual([]);await validateExport(fitting,fittingRender);await saveProject(fitting);
  const groupBackup=await backupResumeGroup([reloaded,fitting]),group=await restoreGroup(new File([groupBackup],'released-development-group.folio.zip'));
  expect(group).toHaveLength(2);for(const item of group)expect(item.template).toEqual(project.template);
  const overflowing=editBlock(application,editable.id,[{...editable.runs[0],text:blockText(editable).repeat(10)}]);
  const overflowRender=await renderDocument(overflowing.template,overflowing.draft,overflowing.assets);expect(overflowRender.layout.overflows.length).toBeGreaterThan(0);await expect(validateExport(confirmDraft(overflowing),overflowRender)).rejects.toThrow();
  if(process.env.FOLIO_RELEASED_TT_OUTPUT){
   await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-fitting-edit.pdf`,fittingRender.bytes,{mode:0o600});
   await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-private-backup.folio.zip`,new Uint8Array(await backup.arrayBuffer()),{mode:0o600});
   await writeFile(`${process.env.FOLIO_RELEASED_TT_OUTPUT}/first-persistence-receipt.json`,JSON.stringify({sourceSha256:hash,sourceUnchanged:sha256Sync(new Uint8Array(await readFile(path)))===hash,fonts:project.template.sourceFonts?.map(f=>({format:f.format,convertedSha256:f.sha256,...(f.format==='truetype'?{sourceVersion:f.sourceVersion,originalRef:f.originalProgram?.pdfFontRef,originalSha256:f.originalProgram?.sha256}:{}),maps:f.glyphMap.length})),saveReloadEqual:true,singleBackupRestoreEqual:true,groupBackupRestoreEqual:true,canonicalReimport:{sourceFonts:reimported.template.sourceFonts?.length??0,unsupportedExplicitCIDToGIDRefused:true},fittingEdit:{changedBlockId:editable.id,removedScalars:1,overflows:fittingRender.layout.overflows.length,exportValidated:true,pdfSha256:sha256Sync(fittingRender.bytes)},overflowEdit:{overflows:overflowRender.layout.overflows.map(o=>({code:o.code,regionId:o.regionId})),exportRefused:true},backupSha256:sha256Sync(new Uint8Array(await backup.arrayBuffer()))},null,2),{mode:0o600});
  }
 },30_000);
});

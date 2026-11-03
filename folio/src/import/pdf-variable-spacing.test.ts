import 'fake-indexeddb/auto';
import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,PDFName,PDFDict} from 'pdf-lib';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {authoredRgbProfile} from './scoped-color-test-fixture';
import {authoredMacRomanSource,authoredSymbolicSource} from './document-scoped-test-fixture';
import {importResume} from './index';
import {makeProject,documentScopedProgramHashes,canonicalJson} from '../core/model';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceWordingPreviewTargets,sourceWordingBlock} from '../core/source-wording';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
import {sourceTextUnderlay} from '../layout/source-overlaps';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {sourceWordingTargets} from '../core/source-wording';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
let release:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(mixedSpacing=true){
 const a=await authoredSymbolicSource({missingPost:true}),b=await authoredMacRomanSource({codes:[65,66]}),d=await PDFDocument.load(a.bytes),named=await PDFDocument.load(b.bytes),[copy]=await d.copyPages(named,[0]),page=d.getPages()[0],resources=page.node.Resources()!,fonts=resources.lookup(PDFName.of('Font'),PDFDict);fonts.set(PDFName.of('F2'),copy.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).get(PDFName.of('F1'))!);
 const profile=d.context.register(d.context.flateStream(authoredRgbProfile(),{N:3,Alternate:'DeviceRGB'}));resources.set(PDFName.of('ColorSpace'),d.context.obj({OwnedRGB:[PDFName.of('ICCBased'),profile]}));
 page.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream('q 1 g 35 590 120 30 re f /OwnedRGB cs 0.3 0.5 0.7 sc BT /F1 12 Tf 1 0 0 1 40 648 Tm -0.04 Tc <4121> Tj 12 0 Td 0 Tc <42ca> Tj 12 0 Td -0.04 Tc <4121> Tj 0 Tc 1 0 0 1 40 600 Tm <4121> Tj 12 0 Td <42ca> Tj /F2 12 Tf 1 0 0 1 40 620 Tm <4142> Tj ET Q')));
 const bytes=new Uint8Array(await d.save());const {importPdf}=await import('./pdf');return makeProject(await importPdf(new File([bytes],'authored-mixed-document.pdf',{type:'application/pdf'}),bytes,mixedSpacing));
}
const approve=(p:Awaited<ReturnType<typeof fixture>>)=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});

it('retains per-show spacing while editing only a separate homogeneous owner through portable restore',async()=>{
 const p=await fixture();expect(p.template.importerVersion).toBe('folio-import-v28');const variable=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===5)!;if(variable.kind!=='text'||variable.sourceLayout?.version!==5)throw Error('fixture');expect(variable.sourceLayout.showSpacing.map(p=>p[1])).toEqual([-0.04,0,-0.04]);expect(variable.sourceScopedPaint?.version).toBe('source-scoped-occurrence-v5');expect(sourceWordingTargets(p).some(r=>r.id===variable.id)).toBe(false);expect(()=>sourceWordingBlock(p,variable.id,'A B')).toThrow();
 expect(canonicalJson(unpackScopedMetadata(packScopedMetadata(p)))).toBe(canonicalJson(p));
 const approved=await approve(p),baseline=await renderProjectDocument(approved,'current'),target=sourceWordingPreviewTargets(approved,baseline)[0];expect(target).toBeDefined();expect(target.id).not.toBe(variable.id);const edited=editBlock(approved,target.contentId,sourceWordingBlock(approved,target.id,'A B').runs),current=await renderProjectDocument(edited,'current');expect(current.layout.overflows).toHaveLength(0);await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'spacing.zip'));expect(restored.approval).toBeNull();expect((await renderProjectDocument(await approve(restored),'current')).bytes).toEqual(current.bytes);
});
it.each(['missing','extra','duplicate','order','value','rehash','downgrade','layout-downgrade','edit-policy','spacing-on-old','glyph','font','paint-version'] as const)('refuses altered spacing %s proof',async kind=>{
 const p=await fixture(),r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===5)!;if(r.kind!=='text'||r.sourceLayout?.version!==5)throw Error('fixture');const g=r.sourceLayout;
 if(kind==='missing')g.showSpacing.pop();else if(kind==='extra')g.showSpacing.push([99999,0]);else if(kind==='duplicate')g.showSpacing[1]=[...g.showSpacing[0]];else if(kind==='order')g.showSpacing.reverse();else if(kind==='value'||kind==='rehash')g.showSpacing[1][1]+=0.2;else if(kind==='downgrade')p.template.importerVersion='folio-import-v27';else if(kind==='layout-downgrade'){const {showSpacing:_,editPolicy:__,...rest}=g;r.sourceLayout={...rest,version:1};p.template.importerVersion='folio-import-v27';r.sourceScopedPaint!.version='source-scoped-occurrence-v4';}else if(kind==='edit-policy')(g as {editPolicy:string}).editPolicy='scalarCovered';else if(kind==='spacing-on-old')(g as {version:number}).version=1;else if(kind==='glyph'){if(g.glyphEncoding==='shared-font-tuple-v1')g.glyphs[0][2]++;else g.glyphs[0].x++;}else if(kind==='font')r.style.sourceFontId=p.template.sourceFonts!.at(-1)!.id;else if(kind==='paint-version')r.sourceScopedPaint!.version='source-scoped-occurrence-v4';
 if(kind==='rehash'||kind==='layout-downgrade')r.sourceScopedPaint!.stateHash=sourceScopedStateHash(r,p.template.sourceFonts!);
 await expect(saveProject(p)).rejects.toBeDefined();await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();
});
it('rejects direct changed content in immutable variable-spacing owners',async()=>{
 const p=await approve(await fixture()),r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===5)!;if(r.kind!=='text')throw Error('fixture');const block=p.draft.blocks.find(b=>b.id===r.contentId)!;block.runs[0].text='A B';await expect(renderProjectDocument(p,'current')).rejects.toBeDefined();
});

it.each(['later','partial','colored','changed-hash'] as const)('does not authorize %s source backgrounds for current ink',async kind=>{
 const p=await fixture(),r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceLayout?.version===1&&r.sourceScopedPaint?.showGroup)!,b=p.template.pages[0].regions.find(r=>r.kind==='rectangle')!;expect(sourceTextUnderlay(p.template,r.id,b.id)).toBeDefined();if(b.kind!=='rectangle'||r.kind!=='text')throw Error('fixture');
 if(kind==='later'){b.order=r.order+1000;b.sourceScopedPaint!.operatorIndex=b.order;b.sourceScopedPaint!.rawOperatorIndex=r.sourceScopedPaint!.rawOperatorIndex+1000;}else if(kind==='partial')b.bounds.width=1;else if(kind==='colored')b.fill='#000000';else b.bounds.y++;
 if(kind!=='changed-hash')b.sourceScopedPaint!.stateHash=sourceScopedStateHash(b,p.template.sourceFonts!);
 if(kind==='changed-hash')expect(()=>sourceTextUnderlay(p.template,r.id,b.id)).toThrow();else expect(sourceTextUnderlay(p.template,r.id,b.id)).toBeUndefined();
});

it('restores the prior mixed-font projection without regrouping its spacing fragments',async()=>{
 const p=await fixture(false);expect(p.template.importerVersion).toBe('folio-import-v27');expect(p.template.pages[0].regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===5)).toBe(false);await saveProject(p);const before=await renderProjectDocument(p,'baselinePreview'),restored=await restoreProject(new File([await backupProject(p)],'prior-mixed.zip'));expect(restored.template.importerVersion).toBe('folio-import-v27');expect((await renderProjectDocument(restored,'baselinePreview')).bytes).toEqual(before.bytes);
});

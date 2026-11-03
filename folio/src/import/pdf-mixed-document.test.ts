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
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';
let release:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(){
 const a=await authoredSymbolicSource({missingPost:true}),b=await authoredMacRomanSource({codes:[65,66]}),d=await PDFDocument.load(a.bytes),named=await PDFDocument.load(b.bytes),[copy]=await d.copyPages(named,[0]),page=d.getPages()[0],resources=page.node.Resources()!,fonts=resources.lookup(PDFName.of('Font'),PDFDict);fonts.set(PDFName.of('F2'),copy.node.Resources()!.lookup(PDFName.of('Font'),PDFDict).get(PDFName.of('F1'))!);
 const profile=d.context.register(d.context.flateStream(authoredRgbProfile(),{N:3,Alternate:'DeviceRGB'}));resources.set(PDFName.of('ColorSpace'),d.context.obj({OwnedRGB:[PDFName.of('ICCBased'),profile]}));
 page.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream('q /OwnedRGB cs 0.3 0.5 0.7 sc BT /F1 12 Tf 1 0 0 1 40 648 Tm <4121> Tj 12 0 Td <42ca> Tj /F2 12 Tf 1 0 0 1 40 620 Tm <4142> Tj ET Q')));
 const bytes=new Uint8Array(await d.save());return makeProject(await importResume(new File([bytes],'authored-mixed-document.pdf',{type:'application/pdf'})));
}
const approve=(p:Awaited<ReturnType<typeof fixture>>)=>approveTemplate(p,p.template.warnings.map(w=>w.id),{accepted:true,sourceSha256:p.source.sha256,originalProgramSha256s:documentScopedProgramHashes(p.template)});
it('retains mixed original selectors, complete shows, ICC and descriptors through edited portable restoration',async()=>{
 const p=await fixture();expect(p.template.importerVersion).toBe('folio-import-v27');expect(p.template.sourceFonts!.every(f=>f.sourceVersion===7&&f.groupedDescriptor)).toBe(true);expect(p.template.sourceFonts!.map(f=>f.sourceVersion===7?f.declaredStyle.post===null:false)).toEqual([true,false]);
 const groups=p.template.pages[0].regions.filter(r=>r.kind==='text').filter(r=>r.sourceScopedPaint?.version==='source-scoped-occurrence-v4');expect(groups).toHaveLength(1);expect(groups[0].sourceScopedPaint?.showGroup?.operators).toHaveLength(2);expect(groups[0].sourceScopedPaint?.color.space).toBe('ICCBased');
 expect(canonicalJson(unpackScopedMetadata(packScopedMetadata(p)))).toBe(canonicalJson(p));
 await expect(approveTemplate(p,p.template.warnings.map(w=>w.id))).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});const approved=await approve(p),baseline=await renderProjectDocument(approved,'current'),target=sourceWordingPreviewTargets(approved,baseline)[0];expect(target).toBeDefined();const edited=editBlock(approved,target.contentId,sourceWordingBlock(approved,target.id,'A B').runs),current=await renderProjectDocument(edited,'current');expect(current.layout.overflows).toHaveLength(0);expect(current.bytes).not.toEqual(baseline.bytes);await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'mixed.zip'));expect(restored.approval).toBeNull();expect((await renderProjectDocument(await approve(restored),'current')).bytes).toEqual(current.bytes);
});
it.each(['selector','program','descriptor','post','wrong-class','delete-group','downgrade','group-order','glyph-position','icc','group-version'] as const)('refuses altered mixed %s proof',async kind=>{
 const p=await fixture(),named=p.template.sourceFonts!.find(f=>f.sourceVersion===7&&f.declaredStyle.post!==null)!,r=p.template.pages[0].regions.find(r=>r.kind==='text'&&r.sourceScopedPaint?.showGroup)!;if(named.sourceVersion!==7||r.kind!=='text')throw Error('fixture');
 if(kind==='selector')named.glyphMap[0].originalCharCode!++;else if(kind==='program')named.originalProgram.bytes[100]^=1;else if(kind==='descriptor')named.groupedDescriptor={...named.groupedDescriptor,Ascent:901};else if(kind==='post')named.declaredStyle.post!.underlineThickness++;else if(kind==='wrong-class')(named as {sourceVersion:number}).sourceVersion=6;else if(kind==='delete-group')delete r.sourceScopedPaint!.showGroup;else if(kind==='downgrade')p.template.importerVersion='folio-import-v26';else if(kind==='group-order')r.sourceScopedPaint!.showGroup!.operators.reverse();else if(kind==='glyph-position'){const layout=r.sourceLayout!;if(layout.glyphEncoding==='shared-font-tuple-v1')layout.glyphs[0][2]++;else layout.glyphs[0].x++;}else if(kind==='icc'&&r.sourceScopedPaint!.color.space==='ICCBased')r.sourceScopedPaint!.color.profileSha256='0'.repeat(64);else if(kind==='group-version')r.sourceScopedPaint!.version='source-scoped-occurrence-v3';
 await expect(saveProject(p)).rejects.toBeDefined();await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();
});

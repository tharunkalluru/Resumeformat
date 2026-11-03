import 'fake-indexeddb/auto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {PDFDocument,PDFDict,PDFArray,PDFName,PDFRawStream,decodePDFRawStream} from 'pdf-lib';
import {fictionalScopedPdf} from './pdf-scoped.fixture';
import {fictionalSourceTemplate} from '../core/sourceFontTestFixture';
import {associateSourceItems} from './pdf-source';
import {importResume} from './index';
import {validateSourceScopedPaint} from './pdf-scoped-source';
import {validateDocumentScopedBaseline} from './document-scoped-baseline';
import {validateSelectedOriginalFonts} from './pdf-selected-fonts';
import {originalOperators,originalPageContent} from './pdf-image-trace';
import {sourceGlyphs} from '../core/source-graph';
import {sourceScopedStateHash} from '../core/source-scoped-paint';
import {makeProject,canonicalJson,sha256Sync,type Project,type TextRegion} from '../core/model';
import {validateProject} from '../core/schema';
import {renderProjectDocument,licensedCurrentPreviewAllows} from '../render/pdf';
import {backupProject,restoreProject,saveProject,loadProjects} from '../storage/projects';
import {setFontLoader} from '../layout/fonts';
import JSZip from 'jszip';
import {approveTemplate,editBlock} from '../core/commands';
import {createApplication} from '../core/applications';
import {saveVersion} from '../core/folio';
import {renderProjectHistory} from '../render/pdf';
import {packRecordMetadata,unpackRecordMetadata} from '../core/project-record-codec';
import {packScopedMetadata,unpackScopedMetadata} from '../core/source-scoped-codec';

let program:Uint8Array,restore:()=>void;
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));restore=setFontLoader(async file=>new Uint8Array(await readFile(resolve('public/fonts',file))));});
afterAll(()=>restore?.());
const viewport=[1,0,0,-1,0,700];
function association(){
 const {asset,region}=fictionalSourceTemplate(program,'ab');asset.sourceVersion=4;asset.sourceResource='f1';asset.originalProgram={bytes:new Uint8Array(program),sha256:sha256Sync(program),pdfFontRef:'1 0 R'};
 asset.glyphMap=asset.glyphMap.filter(m=>m.unicode!==' ');for(const m of asset.glyphMap){m.originalCharCode=m.glyphId;m.originalGlyphId=m.glyphId;}
 const glyphs=region.sourceLayout!.glyphs.map(g=>({...g,resource:'f1',baseline:52,size:12,color:'#000000'}));glyphs[1].x+=3;
 const item={str:'a b',dir:'ltr',fontName:'f1',transform:[12,0,0,12,40,648],height:12,width:glyphs[1].x+glyphs[1].advance-40,hasEOL:false};return {asset,glyphs,item};
}
it('splits a semantic-only space without adding or moving a physical glyph or font mapping',()=>{const f=association(),before=canonicalJson(f),parts=associateSourceItems([f.item],f.glyphs,viewport,[f.asset]);expect(parts.map(p=>p.item.str)).toEqual(['a','b']);expect(parts.map(p=>p.semanticText)).toEqual(['a b','a b']);expect(parts.every(p=>p.semanticSplit)).toBe(true);expect(canonicalJson(parts.flatMap(p=>p.glyphs))).toBe(canonicalJson(f.glyphs));expect(canonicalJson(f)).toBe(before);});
it.each(['font','resource','operator','baseline','size','color','spacing','original','selector','paint','inferred','missingPrevious','duplicate','origin','width','smallGap','negativeGap','doubleSpace','tab','trailing'] as const)('refuses an unproved semantic split: %s',mode=>{
 const f=association();
 if(mode==='font')f.glyphs[1].fontId='other';if(mode==='resource')f.glyphs[1].resource='other';if(mode==='operator')f.glyphs[1].operatorIndex++;
 if(mode==='baseline')f.glyphs[1].baseline+=.001;if(mode==='size')f.glyphs[1].size+=.001;if(mode==='color')f.glyphs[1].color='#111111';if(mode==='spacing')Object.assign(f.glyphs[1],{characterSpacing:.001});
 if(mode==='original')delete f.asset.originalProgram;if(mode==='selector')delete f.asset.glyphMap.find(m=>m.unicode==='b')!.originalGlyphId;if(mode==='paint')f.asset.glyphMap.find(m=>m.unicode==='b')!.nonPainting=true;if(mode==='inferred')Object.assign(f.glyphs[0],{inferredGap:true});
 if(mode==='missingPrevious')f.glyphs.shift();if(mode==='duplicate')f.glyphs.splice(1,0,{...f.glyphs[0]});if(mode==='origin')f.item.transform[4]+=.0251;if(mode==='width')f.item.width+=.0251;
 if(mode==='smallGap')f.glyphs[1].x=f.glyphs[0].x+f.glyphs[0].advance+.0249;if(mode==='negativeGap')f.glyphs[1].x=f.glyphs[0].x+f.glyphs[0].advance-.01;
 if(mode==='doubleSpace')f.item.str='a  b';if(mode==='tab')f.item.str='a\tb';if(mode==='trailing')f.item.str='ab ';
 expect(()=>associateSourceItems([f.item],f.glyphs,viewport,[f.asset])).toThrow();
});
async function authored(){const source=await fictionalScopedPdf(program,{identity:true,text:'ab',gap:250,clip:'30 620 150 60 re W n'}),p=makeProject(await importResume(new File([new Uint8Array(source.bytes).buffer],'authored-semantic-separator.pdf',{type:'application/pdf'})));return {source,p};}
const texts=(p:Project)=>p.template.pages[0].regions.filter((r):r is TextRegion=>r.kind==='text');
it('replays one original adjusted show with exact programme, raw selectors and numeric displacement',async()=>{
 const {source,p}=await authored(),regions=texts(p);expect(regions).toHaveLength(2);expect(p.template.warnings.filter(w=>w.severity==='blocking')).toEqual([]);expect(p.facts.map(f=>f.text)).toEqual(['a b']);expect(p.facts[0].locator).toBe('pdf/page[1]/item[0]');expect(p.baseline.blocks.map(b=>b.runs.map(r=>r.text).join(''))).toEqual(['a','b']);expect(p.baseline.blocks.every(b=>canonicalJson(b.sourceFactIds)===canonicalJson([p.facts[0].id])&&b.runs.every(r=>canonicalJson(r.sourceFactIds)===canonicalJson([p.facts[0].id])))).toBe(true);
 expect(p.template.sourceFonts![0].glyphMap.some(m=>m.unicode===' ')).toBe(false);expect(regions.flatMap(r=>Array.from(sourceGlyphs(r))).some(g=>g.inferredGap)).toBe(false);
 const task=getDocument({data:new Uint8Array(source.bytes),fontExtraProperties:true,useSystemFonts:false,verbosity:0});try{expect((await (await (await task.promise).getPage(1)).getTextContent({disableNormalization:true})).items.flatMap(i=>'str'in i?[i.str]:[])).toEqual(['a b']);}finally{await task.destroy();}
 const proof=await validateSourceScopedPaint(source.bytes,p.template,p.assets,true,true);expect(proof!.sourceSemanticSplit).toBe(true);expect([...proof!.values()].filter(w=>w.wholeShow)).toHaveLength(1);expect([...proof!.values()].every(w=>w.atomicLeader===regions[0].id)).toBe(true);
 const before=canonicalJson(p),render=await renderProjectDocument(p,'baselinePreview'),pdf=await PDFDocument.load(render.bytes),ops=originalOperators(originalPageContent(pdf,1),undefined,true),shows=ops.filter(o=>o.word==='Tj'||o.word==='TJ');expect(shows).toHaveLength(1);expect(shows[0].word).toBe('TJ');const raw=(shows[0].args[0] as {rawArray:string}).rawArray;expect(raw.replace(/<[^>]+>/g,'')).toMatch(/-250/);expect(ops.filter(o=>o.word==='Tm').map(o=>o.args)).toEqual([[1,0,0,1,40,648]]);expect(ops.filter(o=>o.word==='W')).toHaveLength(1);
 const fonts=pdf.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=fonts.lookup(fonts.keys()[0],PDFDict),child=font.lookup(PDFName.of('DescendantFonts'),PDFArray).lookup(0,PDFDict),desc=child.lookup(PDFName.of('FontDescriptor'),PDFDict),bytes=decodePDFRawStream(pdf.context.lookup(desc.get(PDFName.of('FontFile2'))) as PDFRawStream).decode(),gids=decodePDFRawStream(pdf.context.lookup(child.get(PDFName.of('CIDToGIDMap'))) as PDFRawStream).decode();expect(sha256Sync(bytes)).toBe(sha256Sync(program));const emitted=[...raw.matchAll(/<([\da-f]+)>/gi)].flatMap(m=>m[1].match(/.{4}/g)!.map(h=>parseInt(h,16)));expect(emitted.map(cid=>new DataView(gids.buffer,gids.byteOffset,gids.byteLength).getUint16(cid*2))).toEqual(p.template.sourceFonts![0].glyphMap.map(m=>m.originalGlyphId));expect(canonicalJson(p)).toBe(before);expect(licensedCurrentPreviewAllows(render,p,regions[0].id)).toBe(false);
});
it('preserves exact shared semantic provenance through save/reload and portable restore',async()=>{const {p}=await authored();await saveProject(p);const saved=(await loadProjects()).find(s=>s.id===p.id)!;expect(canonicalJson(saved.baseline)).toBe(canonicalJson(p.baseline));expect(canonicalJson(saved.facts)).toBe(canonicalJson(p.facts));const restored=await restoreProject(new File([await backupProject(p)],'authored-semantic.folio.zip'));expect(canonicalJson(restored.template)).toBe(canonicalJson(p.template));expect(canonicalJson(restored.baseline)).toBe(canonicalJson(p.baseline));expect(canonicalJson(restored.facts)).toBe(canonicalJson(p.facts));expect((await renderProjectDocument(restored,'baselinePreview')).sourceReplay).toBe('original-baseline');});
it.each(['text','locator','unsharedFact','extraResumeFact'] as const)('refuses a coherently changed semantic fact %s',async mode=>{const {p}=await authored(),bad=structuredClone(p);if(mode==='text')bad.facts[0].text='a fabricated b';if(mode==='locator')bad.facts[0].locator='pdf/page[1]/item[9]';if(mode==='extraResumeFact')bad.facts.push({...bad.facts[0],id:'extra-source-claim',text:'invented source claim'});if(mode==='unsharedFact'){const f={...bad.facts[0],id:'separate-semantic-fact'};bad.facts.push(f);bad.baseline.blocks[1].sourceFactIds=[f.id];bad.baseline.blocks[1].runs[0].sourceFactIds=[f.id];}await expect(validateDocumentScopedBaseline(bad)).rejects.toMatchObject({code:'PDF_DOCUMENT_BASELINE'});});
it.each(['position','width','color','source','duplicate','drop','missingScope'] as const)('refuses altered split paint ownership: %s',async mode=>{const {p}=await authored(),bad=structuredClone(p),region=texts(bad)[1],layout=region.sourceLayout!;
 if(mode==='position'||mode==='width'){const gs=Array.from(sourceGlyphs(region));if(mode==='position')gs[0].x+=.01;else gs[0].advance+=.01;delete layout.glyphEncoding;layout.glyphs=gs;layout.startX=gs[0].x;layout.endX=gs.at(-1)!.x+gs.at(-1)!.advance;}
 if(mode==='source'){const swapped=await fictionalScopedPdf(program,{identity:true,text:'ab',gap:300,clip:'30 620 150 60 re W n'}),fresh=await importResume(new File([new Uint8Array(swapped.bytes).buffer],'authored-swapped-gap.pdf',{type:'application/pdf'}));bad.source.bytes=new Uint8Array(swapped.bytes);bad.source.sha256=sha256Sync(swapped.bytes);bad.template.sourceScopedPages=structuredClone(fresh.template.sourceScopedPages);bad.template.sourceImageContract=structuredClone(fresh.template.sourceImageContract);for(const r of texts(bad)){r.sourceLayout!.sourceSha256=bad.source.sha256;r.sourceScopedPaint!.sourceSha256=bad.source.sha256;}}
 if(mode==='color')region.style.color='#333333';if(mode==='duplicate')bad.template.pages[0].regions.push({...structuredClone(region),id:'duplicate-region'});if(mode==='drop')bad.template.pages[0].regions.pop();if(mode==='missingScope'){delete bad.template.sourceScopedPages;for(const r of texts(bad))delete r.sourceScopedPaint;}
 for(const r of texts(bad))if(r.sourceScopedPaint)r.sourceScopedPaint.stateHash=sourceScopedStateHash(r,bad.template.sourceFonts!);
 await expect(validateSourceScopedPaint(bad.source.bytes,bad.template,bad.assets,true,true)).rejects.toThrow();
});
it('keeps exact baseline current readable but refuses changed current instead of legacy or native expansion',async()=>{const {p}=await authored();expect((await renderProjectDocument(p,'current')).sourceReplay).toBe('original-baseline');const changed=structuredClone(p);changed.draft.blocks[0].runs[0].text='b';await expect(renderProjectDocument(changed,'current')).rejects.toMatchObject({code:'PDF_SOURCE_SEMANTIC_SPLIT'});});
it('rederives selected-source ownership before metadata deletion can bypass the new representation',async()=>{const {p}=await authored(),bad=structuredClone(p);delete bad.template.sourceFonts;delete bad.template.sourceScopedPages;for(const r of texts(bad)){delete r.sourceLayout;delete r.style.sourceFontId;delete r.sourceScopedPaint;}validateProject(bad);await expect(validateSelectedOriginalFonts(bad.source.bytes,bad.template)).rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});});

async function unclipped(split=true){const f=await fictionalScopedPdf(program,{identity:true,text:split?'ab':'abc',...(split?{gap:250}:{})});return makeProject(await importResume(new File([new Uint8Array(f.bytes).buffer],'authored-unclipped.pdf',{type:'application/pdf'})));}
function removeScopedOwnership(p:Project,legacyLabel=false){delete p.template.sourceScopedPages;for(const page of p.template.pages)for(const region of page.regions)if('sourceScopedPaint'in region)delete region.sourceScopedPaint;if(legacyLabel){p.template.importerVersion='folio-import-v11';delete p.template.sourceImageContract;}}
async function missingScope(legacyLabel:boolean){const p=await unclipped();expect(p.template.sourceFonts!.every(f=>f.sourceVersion===4)).toBe(true);expect(texts(p)).toHaveLength(2);removeScopedOwnership(p,legacyLabel);validateProject(p);const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id));return editBlock(approved,approved.draft.blocks[0].id,[{text:'b'}]);}
it.each([false,true])('refuses changed current after coherent missing scope deletion, legacy label=%s',async legacyLabel=>{const p=await missingScope(legacyLabel);await expect(renderProjectDocument(p,'current')).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});});
it.each([false,true])('refuses changed history after coherent missing scope deletion, legacy label=%s',async legacyLabel=>{const app=await createApplication(await missingScope(legacyLabel)),p=saveVersion(editBlock(app,app.draft.blocks[0].id,[{text:'b'}]),'download');await expect(renderProjectHistory(p,p.folio!.versions[0].id)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});});
it.each([false,true])('refuses save after coherent missing scope deletion, legacy label=%s',async legacyLabel=>{const p=await missingScope(legacyLabel);await expect(saveProject(p)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});});
it.each([false,true])('refuses portable restore after coherent missing scope deletion, legacy label=%s',async legacyLabel=>{const p=await unclipped(),zip=await JSZip.loadAsync(await(await backupProject(p)).arrayBuffer()),meta=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(await zip.file('project.json')!.async('string')))) as Project;removeScopedOwnership(meta,legacyLabel);meta.draft.blocks[0].runs[0].text='b';meta.draft.revision++;zip.file('project.json',JSON.stringify(packRecordMetadata(packScopedMetadata(meta))));const manifest=JSON.parse(await zip.file('manifest.json')!.async('string'));for(const entry of manifest.files){const bytes=await zip.file(entry.path)!.async('uint8array');entry.size=bytes.length;entry.sha256=sha256Sync(bytes);}zip.file('manifest.json',JSON.stringify(manifest));const file=new File([new Uint8Array(await zip.generateAsync({type:'uint8array'})).buffer],'authored-missing-scope.folio.zip');await expect(restoreProject(file)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});});
it('preserves the valid nonsplit unscoped legacy route',async()=>{let p=await unclipped(false);removeScopedOwnership(p,true);validateProject(p);expect(await validateSourceScopedPaint(p.source.bytes,p.template,p.assets)).toBeUndefined();p=await approveTemplate(p,p.template.warnings.map(w=>w.id));p=editBlock(p,p.draft.blocks[0].id,[{text:'cab'}]);expect((await renderProjectDocument(p,'current')).sourceReplay).toBe('legacy-current');await saveProject(p);const restored=await restoreProject(new File([await backupProject(p)],'authored-nonsplit-unscoped.folio.zip'));expect(canonicalJson(restored.draft.blocks)).toBe(canonicalJson(p.draft.blocks));});

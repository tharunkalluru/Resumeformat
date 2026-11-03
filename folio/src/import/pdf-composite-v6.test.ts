import 'fake-indexeddb/auto';
import {it,expect,beforeAll,afterAll} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import {PDFDocument,PDFName,PDFDict,PDFArray,PDFString} from 'pdf-lib';
import {GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {captureCompositeSource,renderCompositeBaseline,compositeWordingEligible} from './pdf-composite-program';
import {hasOriginalBlankActualText} from './pdf-image-trace';
import {importResume} from './index';
import {makeProject,sha256Sync,type Project} from '../core/model';
import {renderProjectDocument,setFontLoader} from '../render/pdf';
import {approveTemplate,editBlock} from '../core/commands';
import {sourceWordingTargets,sourceWordingPreviewReady,sourceWordingBlock,sourceWordingPreviewTargets} from '../core/source-wording';
import {saveProject,backupProject,restoreProject} from '../storage/projects';
import {hasUnspacedIdentityShows} from './pdf-semantic-source';
let program:Uint8Array,release:()=>void;
beforeAll(async()=>{program=new Uint8Array(await readFile('public/fonts/DejaVuSans.ttf'));Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});release=setFontLoader(async f=>new Uint8Array(await readFile(resolve('public/fonts',f))));await import('./pdf');GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});afterAll(()=>release?.());
async function fixture(options:{space?:boolean;intervening?:boolean;paint?:boolean}={}){
 const d=await PDFDocument.create();d.registerFontkit(fontkit);const f=await d.embedFont(program,{subset:false}),page=d.addPage([240,320]),a=f.encodeText('a').toString(),b=f.encodeText('b').toString(),ab=f.encodeText('ab').toString();await d.flush();
 const font=d.context.lookup(f.ref,PDFDict);font.set(PDFName.of('ToUnicode'),d.context.register(d.context.flateStream(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CMapType 2 def 1 begincodespacerange <0000><FFFF> endcodespacerange ${options.space?3:2} beginbfchar ${a}<0061> ${b}<0062> ${options.space?f.encodeText(' ').toString()+'<0020>':''} endbfchar endcmap CMapName currentdict /CMap defineresource pop end end`)));
 page.node.set(PDFName.of('Resources'),d.context.obj({Font:{F1:f.ref}}));
 const raw=`BT /F1 12 Tf 1 0 0 1 40 260 Tm ${a} Tj ET ${options.intervening?'0 0 2 2 re f ':''}${options.paint?'1 0 0 rg ':''}BT /F1 12 Tf 1 0 0 1 52 260 Tm ${b} Tj ET 0 0 0 rg BT /F1 12 Tf 1 0 0 1 40 220 Tm ${ab} Tj ET`;
 page.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream(raw)));return new Uint8Array(await d.save());
}
async function project(bytes:Uint8Array){return makeProject(await importResume(new File([new Uint8Array(bytes).buffer],'authored-v24.pdf',{type:'application/pdf'})),true);}
it('retains privately proved gaps without adding glyphs, through edit and restore',async()=>{
 const bytes=await fixture(),c=await captureCompositeSource(bytes),p=await project(bytes);expect(c.version).toBe('original-native-composite-v6');expect(p.template.importerVersion).toBe('folio-import-v24');expect(c.pages[0].graph.map(g=>g.unicode).join('')).toBe('abab');expect(c.pages[0].semanticRelations?.length).toBeGreaterThan(0);
 const approved=await approveTemplate(p,p.template.warnings.map(w=>w.id)),baseline=await renderProjectDocument(approved,'current'),r=sourceWordingTargets(approved).find(r=>approved.baseline.blocks.find(b=>b.id===r.contentId)?.runs[0].text==='ab')!;expect(sourceWordingPreviewReady(approved,baseline,r.id)).toBe(true);const b=approved.draft.blocks.find(b=>b.id===r.contentId)!,edited=editBlock(approved,b.id,sourceWordingBlock(approved,r.id,'a').runs),current=await renderProjectDocument(edited,'current');await saveProject(edited);const restored=await restoreProject(new File([await backupProject(edited)],'v24.zip'));expect(restored.approval).toBe(null);expect((await renderProjectDocument(await approveTemplate(restored,restored.template.warnings.map(w=>w.id)),'current')).bytes).toEqual(current.bytes);
});
it.each(['delete','downgrade','gap','item','parts'] as const)('refuses changed v24 %s ownership',async mode=>{const p=await project(await fixture());if(mode==='delete')delete p.template.sourceCompositePages;else if(mode==='downgrade'){p.template.sourceCompositePages!.version='original-native-composite-v3';p.template.importerVersion='folio-import-v21';}else if(mode==='gap')p.template.sourceCompositePages!.pages[0].semanticRelations![0].gap+=.001;else if(mode==='item')p.template.sourceCompositePages!.pages[0].semanticRelations![0].semanticText='unprovided';else p.template.sourceCompositePages!.pages[0].semanticRelations![0].physicalPartsHash='a'.repeat(64);await expect(saveProject(p)).rejects.toBeDefined();await expect(renderProjectDocument(p,'baselinePreview')).rejects.toBeDefined();});
it('keeps physical-space source routing',async()=>{expect(hasUnspacedIdentityShows(await PDFDocument.load(await fixture({space:true})))).toBe(false);});
it.each(['intervening','paint'] as const)('refuses semantic ownership across %s changes',async mode=>{await expect(captureCompositeSource(await fixture({[mode]:true}))).rejects.toBeDefined();});

it('batch UI checks preserve private ownership and invalidate changed bytes, evidence and drafts',async()=>{const p=await project(await fixture()),a=await approveTemplate(p,p.template.warnings.map(w=>w.id)),r=await renderProjectDocument(a,'current'),expected=sourceWordingTargets(a).filter(t=>sourceWordingPreviewReady(a,r,t.id)).map(t=>t.id);expect(expected.length).toBeGreaterThan(0);expect(sourceWordingPreviewTargets(a,r).map(t=>t.id)).toEqual(expected);expect(sourceWordingPreviewTargets(a,structuredClone(r))).toEqual([]);r.bytes[0]^=1;expect(sourceWordingPreviewTargets(a,r)).toEqual([]);r.bytes[0]^=1;r.layout.regions[0].bounds.x+=1;expect(sourceWordingPreviewTargets(a,r)).toEqual([]);r.layout.regions[0].bounds.x-=1;a.draft.blocks[0].runs[0].text+='a';expect(sourceWordingPreviewTargets(a,r)).toEqual([]);});

// @vitest-environment node
import {beforeAll,it,expect} from 'vitest';
import {PDFDocument,StandardFonts,PDFName,PDFDict,PDFArray,PDFNumber,PDFString} from 'pdf-lib';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {DOMMatrix,ImageData,Path2D} from '@napi-rs/canvas';
import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {importPdf} from './pdf';
import {makeProject,exportProblems,sha256Sync,canonicalJson} from '../core/model';
import {validateProject} from '../core/schema';
import {approveTemplate,editBlock,confirmDraft,validateExport} from '../core/commands';
import {renderProjectDocument,renderDocument,standardCurrentPreviewAllows} from '../render/pdf';
import {validateStandard14Source} from './pdf-standard-native';
import {loadStandardFont} from '../layout/standard-fonts';
import {backupProject,restoreProject} from '../storage/projects';
import 'fake-indexeddb/auto';
beforeAll(async()=>{Object.assign(globalThis,{DOMMatrix,ImageData,Path2D,pdfjsWorker:await import('pdfjs-dist/legacy/build/pdf.worker.mjs')});GlobalWorkerOptions.workerSrc=resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');});
const file=(bytes:Uint8Array)=>new File([new Uint8Array(bytes).buffer],'fictional-standard.pdf',{type:'application/pdf'});
export async function authoredStandard(name=StandardFonts.Helvetica,text='Designed interfaces for a fictional library.',pages=1){const d=await PDFDocument.create(),font=await d.embedFont(name);for(let n=0;n<pages;n++)d.addPage([500,700]).drawText(text,{font,size:12,x:50.125,y:600.375});return d.save();}
async function project(name=StandardFonts.Helvetica){const bytes=await authoredStandard(name);return makeProject(await importPdf(file(bytes),bytes),true);}
async function approved(name=StandardFonts.Helvetica){const p=await project(name);return approveTemplate(p,p.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));}
it('retains explicit DeviceRGB numeric scn colors and refuses inconsistent component counts',async()=>{
 const d=await PDFDocument.create(),font=await d.embedFont(StandardFonts.TimesRoman),p=d.addPage([500,700]);
 p.node.set(PDFName.of('Resources'),d.context.obj({Font:{Original:font.ref}}));
 const content=(components:string)=>d.context.register(d.context.flateStream('/DeviceRGB CS 0.25 0.25 0.25 SCN /DeviceRGB cs '+components+' scn BT /Original 12 Tf 1 0 0 1 50.125 600.375 Tm (Fictional library) Tj ET'));
 p.node.set(PDFName.of('Contents'),content('0.123456789 0.234567891 0.345678912'));
 const bytes=await d.save(),project=makeProject(await importPdf(file(bytes),bytes),true),r=project.template.pages[0].regions.find(r=>r.kind==='text')!;
 if(r.kind!=='text')throw Error('missing source text');
 expect(r.sourceStandardLayout!.colorComponents).toEqual([.123456789,.234567891,.345678912]);
 expect((await renderProjectDocument(project,'baselinePreview')).layout.overflows).toEqual([]);
 p.node.Resources()!.set(PDFName.of('ColorSpace'),d.context.obj({DefaultRGB:'DeviceRGB'}));
 const substituted=await d.save();await expect(importPdf(file(substituted),substituted)).rejects.toMatchObject({code:'PDF_ICC_PROOF'});
 p.node.Resources()!.delete(PDFName.of('ColorSpace'));
 p.node.set(PDFName.of('Contents'),content('0.123456789'));
 const bad=await d.save();await expect(importPdf(file(bad),bad)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});
});
it('retains a bounded legacy font Name declaration and refuses non-name or oversized entries',async()=>{
 const d=await PDFDocument.load(await authoredStandard()),fonts=d.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),f=d.context.lookup(fonts.entries()[0][1],PDFDict);
 f.set(PDFName.of('Name'),PDFName.of('OriginalResource'));
 const bytes=await d.save(),p=makeProject(await importPdf(file(bytes),bytes),true);
 await validateStandard14Source(p);
 expect((await renderProjectDocument(p,'baselinePreview')).layout.overflows).toEqual([]);
 for(const invalid of [PDFString.of('OriginalResource'),PDFName.of('F'.repeat(129))]){
  f.set(PDFName.of('Name'),invalid);const bad=await d.save();
  await expect(importPdf(file(bad),bad)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});
 }
});
it('retains Standard14 text across an empty nonpainting endPath without admitting a clip',async()=>{
 const d=await PDFDocument.create(),font=await d.embedFont(StandardFonts.Helvetica),p=d.addPage([500,700]);
 p.node.set(PDFName.of('Resources'),d.context.obj({Font:{Original:font.ref}}));
 const content=(prefix:string)=>d.context.register(d.context.flateStream(prefix+' BT /Original 12 Tf 1 0 0 1 50.125 600.375 Tm (Fictional library) Tj ET'));
 p.node.set(PDFName.of('Contents'),content('n'));
 const bytes=await d.save(),project=makeProject(await importPdf(file(bytes),bytes),true);
 expect(project.template.pages[0].regions.filter(r=>r.kind==='text')).toHaveLength(1);
 expect(project.template.warnings.some(w=>w.severity==='blocking')).toBe(false);
 expect((await renderProjectDocument(project,'baselinePreview')).layout.overflows).toEqual([]);
 p.node.set(PDFName.of('Contents'),content('0 0 100 100 re W n'));
 const clipped=await d.save();await expect(importPdf(file(clipped),clipped)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});
});
it.each([StandardFonts.TimesRoman,StandardFonts.TimesRomanBold,StandardFonts.TimesRomanItalic,StandardFonts.TimesRomanBoldItalic,StandardFonts.Helvetica,StandardFonts.HelveticaBold,StandardFonts.HelveticaOblique,StandardFonts.HelveticaBoldOblique,StandardFonts.Courier,StandardFonts.CourierBold,StandardFonts.CourierOblique,StandardFonts.CourierBoldOblique])('retains original %s declaration, exact one-byte selectors and double source origin',async name=>{const p=await project(name);expect(p.template.sourceFonts).toBeUndefined();expect(p.template.sourceStandardFonts).toHaveLength(1);expect(p.template.sourceStandardFonts![0].baseFont).toBe(name);const r=p.template.pages[0].regions.find(r=>r.kind==='text')!;expect(r.kind).toBe('text');if(r.kind==='text'){expect(r.sourceStandardLayout!.startX).toBe(50.125);expect(r.sourceStandardLayout!.baseline).toBe(99.625);expect(r.sourceStandardLayout!.glyphs[0].code).toBe(68);}validateProject(p);await validateStandard14Source(p);const out=await renderProjectDocument(p,'baselinePreview');expect(out.layout.overflows).toEqual([]);const d=await PDFDocument.load(out.bytes),fonts=d.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict);for(const [,ref]of fonts.entries()){const f=d.context.lookup(ref,PDFDict);expect(f.lookup(PDFName.of('Subtype'),PDFName).decodeText()).toBe('Type1');expect(f.lookup(PDFName.of('BaseFont'),PDFName).decodeText()).toBe(name);expect(f.has(PDFName.of('FontDescriptor'))).toBe(false);}expect(out.rendererVersion).toBe('folio-standard14-structured-v1');if(process.env.R50_AUTHORED_OUTPUT){await mkdir(process.env.R50_AUTHORED_OUTPUT,{recursive:true});await writeFile(resolve(process.env.R50_AUTHORED_OUTPUT,name+'-source.pdf'),p.source.bytes);await writeFile(resolve(process.env.R50_AUTHORED_OUTPUT,name+'-reconstructed.pdf'),out.bytes);}});
it('requires actual template approval before editing and current source proof before direct rendering',async()=>{const p=await project();expect(()=>editBlock(p,p.draft.blocks[0].id,[{text:'Changed'}])).toThrowError(/Approve/);await expect(renderDocument(p.template,p.baseline,[])).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});});
it('renders and exports genuinely changed covered wording while retaining programme-free original resources',async()=>{let p=await approved();const before=canonicalJson({source:p.source,template:p.template,baseline:p.baseline});p=editBlock(p,p.draft.blocks[0].id,[{...p.draft.blocks[0].runs[0],text:'Designed a fictional library.'}]);p=confirmDraft(p);const out=await renderProjectDocument(p,'current');expect(out.layout.overflows).toEqual([]);expect(standardCurrentPreviewAllows(out,p)).toBe(true);expect(exportProblems(p,out)).toEqual([]);await validateExport(p,out);expect(canonicalJson({source:p.source,template:p.template,baseline:p.baseline})).toBe(before);const load=getDocument({...localPdfDecoderOptions(),data:new Uint8Array(out.bytes),verbosity:0});const pdf=await load.promise;expect((await (await pdf.getPage(1)).getTextContent()).items.map(i=>'str'in i?i.str:'').join('')).toContain('Designed a fictional library.');await load.destroy();});
it('reports visible overflow and unsupported glyphs, never qualifies a partial painted current result',async()=>{let p=await approved();p=editBlock(p,p.draft.blocks[0].id,[{...p.draft.blocks[0].runs[0],text:'W'.repeat(500)}]);const out=await renderProjectDocument(p,'current');expect(out.layout.overflows.some(o=>o.code==='width')).toBe(true);expect(exportProblems(p,out)).toContain('Resolve the visible layout issues before export.');p=editBlock(p,p.draft.blocks[0].id,[{...p.draft.blocks[0].runs[0],text:'Fictional 🙂'}]);expect((await renderProjectDocument(p,'current')).layout.overflows.some(o=>o.code==='glyph')).toBe(true);});
it('uses original explicit Widths, not AFM kerning or adapter programme widths',async()=>{const bytes=await authoredStandard(StandardFonts.Helvetica,'AV'),d=await PDFDocument.load(bytes),fonts=d.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=d.context.lookup(fonts.entries()[0][1],PDFDict);font.set(PDFName.of('FirstChar'),PDFNumber.of(65));font.set(PDFName.of('LastChar'),PDFNumber.of(86));font.set(PDFName.of('Widths'),d.context.obj(Array.from({length:22},(_,i)=>i===0?700:667)));const changed=await d.save(),p=makeProject(await importPdf(file(changed),changed),true),r=p.template.pages[0].regions[0];expect(p.template.sourceStandardFonts![0].widths!.values[0]).toBe(700);if(r.kind==='text')expect(r.sourceStandardLayout!.glyphs[0].advance).toBe(8.4);});
it.each(['declaration','position','style','baseline','marker'])('rejects coherent %s tampering against freshly rederived source',async kind=>{const p=await project(),r=p.template.pages[0].regions.find(r=>r.kind==='text')!;if(kind==='declaration')p.template.sourceStandardFonts![0].declarationSha256='0'.repeat(64);if(r.kind==='text'){if(kind==='position'){r.bounds.x+=1;r.sourceStandardLayout!.startX+=1;r.sourceStandardLayout!.endX+=1;r.sourceStandardLayout!.glyphs.forEach(g=>g.x+=1);}if(kind==='style'){r.style.color='#ff0000';}if(kind==='baseline'){p.baseline.blocks[0].runs[0].text='Invented';}if(kind==='marker'){delete p.template.sourceStandardFonts;delete r.sourceStandardLayout;delete r.style.sourceStandardFontId;}}await expect(validateStandard14Source(p)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});});
it('refuses encoding differences, Symbol and mixed source declarations instead of claiming native ownership',async()=>{const bytes=await authoredStandard(),d=await PDFDocument.load(bytes),fonts=d.getPages()[0].node.Resources()!.lookup(PDFName.of('Font'),PDFDict),font=d.context.lookup(fonts.entries()[0][1],PDFDict);font.set(PDFName.of('Encoding'),d.context.obj({BaseEncoding:'WinAnsiEncoding',Differences:[65,'B']}));const malformed=await d.save();await expect(importPdf(file(malformed),malformed)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});const symbol=await authoredStandard(StandardFonts.Symbol,'Α');await expect(importPdf(file(symbol),symbol)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});});
it('keeps native adapter identity private to the current result and rejects modified returned layout or bytes',async()=>{const p=await approved(),out=await renderProjectDocument(p,'current');expect(standardCurrentPreviewAllows(structuredClone(out),p)).toBe(false);out.bytes[0]^=1;expect(standardCurrentPreviewAllows(out,p)).toBe(false);});
it('round trips declarative font assets and separate native adapter attachments with fresh source validation',async()=>{const p=await approved(),blob=await backupProject(p),restored=await restoreProject(new File([await blob.arrayBuffer()],'fictional.folio',{type:'application/zip'}));expect(restored.template.sourceStandardFonts![0].nativeAdapter.sha256).toBe(p.template.sourceStandardFonts![0].nativeAdapter.sha256);expect(sha256Sync(restored.template.sourceStandardFonts![0].nativeAdapter.bytes)).toBe(p.template.sourceStandardFonts![0].nativeAdapter.sha256);await renderProjectDocument(restored,'baselinePreview');});

it('preserves original double CTM/Tm, flat TJ spacing and non-8bit color without catalogue rounding',async()=>{const d=await PDFDocument.create(),font=await d.embedFont(StandardFonts.HelveticaBold),p=d.addPage([500,700]);p.node.set(PDFName.of('Resources'),d.context.obj({Font:{Original:font.ref}}));p.node.set(PDFName.of('Contents'),d.context.register(d.context.flateStream('q 1.25 0 0 1.25 2.123456789 3.234567891 cm BT /Original 12 Tf 0.123456789 0.234567891 0.345678912 rg 0.125 Tc 1 0 0 1 50.234567891 450.345678912 Tm [(AV) -23.456789 ( fiction)] TJ ET Q')));const bytes=await d.save(),project=makeProject(await importPdf(file(bytes),bytes),true),r=project.template.pages[0].regions.find(r=>r.kind==='text')!;if(r.kind!=='text')throw Error('missing original group');expect(r.sourceStandardLayout!.colorComponents).toEqual([.123456789,.234567891,.345678912]);expect(r.sourceStandardLayout!.linearMatrix).toEqual([1.25,0,0,1.25]);expect(r.sourceStandardLayout!.nominalFontSize).toBe(12);expect(r.sourceStandardLayout!.characterSpacing).toBe(.15625);const out=await renderProjectDocument(project,'baselinePreview');expect(out.layout.overflows).toEqual([]);if(process.env.R50_AUTHORED_OUTPUT){await writeFile(resolve(process.env.R50_AUTHORED_OUTPUT,'fractional-source.pdf'),bytes);await writeFile(resolve(process.env.R50_AUTHORED_OUTPUT,'fractional-reconstructed.pdf'),out.bytes);}});
it('refuses coherent removal of the Standard14 class on current render and new-contract storage',async()=>{const p=await approved();delete p.template.sourceStandardFonts;for(const page of p.template.pages)for(const r of page.regions)if(r.kind==='text'){delete r.sourceStandardLayout;delete r.style.sourceStandardFontId;}await expect(renderProjectDocument(p,'current')).rejects.toBeTruthy();await expect(backupProject(p)).rejects.toBeTruthy();p.template.importerVersion='folio-import-v1';await expect(renderProjectDocument(p,'current')).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});});

it.each(['ctm','textMatrix','cursor','spacing','localGlyph'])('freshly rederives Standard14 %s geometry instead of trusting retained factors',async kind=>{
 const p=await project(),r=p.template.pages[0].regions.find(r=>r.kind==='text')!;
 if(r.kind!=='text')throw Error('missing original standard text');
 const source=r.sourceStandardLayout!,frame=source.coordinateFrame!;
 if(kind==='ctm')frame.ctm[4]+=.125;
 if(kind==='textMatrix')frame.textMatrix[4]+=.125;
 if(kind==='cursor')frame.cursorY+=.125;
 if(kind==='spacing')frame.characterSpacing+=.125;
 if(kind==='localGlyph')source.glyphs[0].textX!+=.125;
 expect(()=>validateProject(p)).toThrow();
 await expect(validateStandard14Source(p)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});
});
it('rejects a coherent frame and page-coordinate shift against the fresh source',async()=>{
 const p=await project(),r=p.template.pages[0].regions.find(r=>r.kind==='text')!;
 if(r.kind!=='text')throw Error('missing original standard text');
 const source=r.sourceStandardLayout!;source.coordinateFrame!.ctm[4]+=1;
 r.bounds.x+=1;source.startX+=1;source.endX+=1;source.glyphs.forEach(g=>g.x+=1);
 validateProject(p);
 await expect(validateStandard14Source(p)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});
});
it('generates one whole glyph show under its numeric coordinate frame',async()=>{
 const p=await project(),r=p.template.pages[0].regions.find(r=>r.kind==='text')!;
 if(r.kind!=='text')throw Error('missing original standard text');
 expect(r.sourceStandardLayout!.coordinateFrame).toEqual({ctm:[1,0,0,1,0,0],textMatrix:[1,0,0,1,50.125,600.375],cursorX:0,cursorY:0,characterSpacing:0});
 const rendered=await renderProjectDocument(p,'baselinePreview'),d=await PDFDocument.load(rendered.bytes);
 const {originalPageContent,originalOperators}=await import('./pdf-image-trace');
 const generated=originalOperators(originalPageContent(d,1,true),undefined,true);
 expect(generated.filter(o=>o.word==='Tm')).toHaveLength(1);
 expect(generated.filter(o=>o.word==='TJ')).toHaveLength(1);
 expect(generated.filter(o=>o.word==='Tj')).toHaveLength(0);
 const argument=generated.find(o=>o.word==='TJ')!.args[0] as {rawArray:string};
 expect(argument.rawArray).toBe(`[<${r.sourceStandardLayout!.glyphs.map(g=>g.code.toString(16).padStart(2,'0')).join('')}>]`);
});

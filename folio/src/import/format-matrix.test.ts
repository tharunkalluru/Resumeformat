// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMMatrix, ImageData, Path2D, createCanvas } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import { importResume } from './index';
import { renderDocument, renderProjectDocument,renderProjectHistory,setFontLoader } from '../render/pdf';
import { makeProject,type ImportResult } from '../core/model';
import { approveTemplate,editBlock } from '../core/commands';

const matrix: { cases: { id: string; filename: string; expectation: string; expectedPages?: number; expectedLinks?: string[]; expectedCodes?: string[] }[] } = JSON.parse(readFileSync(resolve('public/fixtures/matrix/manifest.json'), 'utf8'));
import {saveVersion} from '../core/folio';
import {createApplication} from '../core/applications';
const baselineRender=(result:ImportResult)=>(result.template.sourceStandardFonts?.length||result.template.sourceFonts?.some(f=>f.sourceVersion===8))?renderProjectDocument(makeProject(result,true),'baselinePreview'):renderDocument(result.template,result.baseline,result.assets);
const normalize = (text: string) => text.normalize('NFC').replace(/\s/g, '');

let restoreFonts: () => void;
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
beforeAll(async () => {
  const window = new JSDOM('').window;
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, DOMMatrix, ImageData, Path2D });
  restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  await import('./pdf');
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(() => restoreFonts());
const fixture = async (name: string) => {
  const bytes = new Uint8Array(await readFile(resolve('public/fixtures/matrix', name)));
  return { bytes, result: await importResume(new File([new Uint8Array(bytes).buffer], name)) };
};
async function independentTextAnchor(bytes:Uint8Array,pageNumber:number,text:string){
 const task=pdfjs.getDocument({data:new Uint8Array(bytes),standardFontDataUrl:resolve('public/pdfjs/standard_fonts')+'/',verbosity:0});try{const page=await(await task.promise).getPage(pageNumber),items=(await page.getTextContent()).items.filter((v):v is import('pdfjs-dist/types/src/display/api').TextItem=>'str' in v&&v.str===text);expect(items).toHaveLength(1);return {x:items[0].transform[4],baseline:page.getViewport({scale:1}).height-items[0].transform[5]};}finally{await task.destroy();}
}
async function raster(bytes: Uint8Array) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: resolve('public/pdfjs/standard_fonts') + '/', verbosity: 0 });
  try {
    const page = await (await task.promise).getPage(1), viewport = page.getViewport({ scale: 1.5 });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    await page.render({ canvasContext: canvas.getContext('2d') as never, viewport, canvas: canvas as never }).promise;
    return canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  } finally { await task.destroy(); }
}

describe('independent format regressions', () => {
  it.each(matrix.cases.filter(f=>f.expectation==='page-capacity'))('retains all three source pages for $id within the current bounded capacity',async f=>{
    const {bytes,result}=await fixture(f.filename);
    expect(result.source.bytes).toEqual(bytes);
    expect(result.template.pages).toHaveLength(3);
    expect((await baselineRender(result)).layout.overflows).toEqual([]);
  });
  it('recognizes exact monospaced metrics even when PDF.js calls the font sans-serif', async () => {
    const { bytes, result } = await fixture('06-pdf-monospaced.pdf');
    expect(result.template.pages[0].regions.filter(r => r.kind === 'text').every(r => r.style.fontFamily === 'mono')).toBe(true);
    // The exact licensed subset now retains its original occurrence graph.
    expect(result.template.sourceFonts?.every(f=>f.sourceVersion===8&&f.licensedDerivation.catalogueFace==='mono-400-normal')).toBe(true);
    expect(result.template.pages[0].regions.filter(r => r.kind === 'text').every(r => !!r.sourceLayout && !!r.style.sourceFontId)).toBe(true);
    const rendered = await baselineRender(result);
    expect(rendered.layout.overflows).toEqual([]);
    expect(await raster(rendered.bytes)).toEqual(await raster(bytes));
  });
  it('preserves standard Times glyphs, source baselines and page size', async () => {
    const { bytes, result } = await fixture('05-pdf-times-font.pdf');
    const rendered = await baselineRender(result);
    expect(rendered.layout.overflows).toEqual([]);
    expect(result.template.pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(result.template.pages[0].regions.filter(r => r.kind === 'text').every(r => r.style.fontFamily === 'times')).toBe(true);
    expect(result.template.warnings.some(w => w.code === 'FONT_SUBSTITUTION')).toBe(false);
    const a = await raster(rendered.bytes), b = await raster(bytes);
    // Separate draw operators round offsets differently. At 108 DPI the only
    // permitted residual is subpixel antialiasing: <=1 shade on <=20 channels.
    const differences = Array.from(a, (value, i) => Math.abs(value - b[i])).filter(Boolean);
    expect(Math.max(0, ...differences)).toBeLessThanOrEqual(1);
    expect(differences.length).toBeLessThanOrEqual(20);
    const task = pdfjs.getDocument({ data: new Uint8Array(result.source.bytes), standardFontDataUrl: resolve('public/pdfjs/standard_fonts') + '/', verbosity: 0 });
    try {
      const p = await (await task.promise).getPage(1), v = p.getViewport({ scale: 1 });
      const source = (await p.getTextContent()).items.filter(i => 'str' in i && i.str.trim());
      const text = rendered.layout.regions.flatMap(r => r.lines);
      expect(text).toHaveLength(source.length);
      source.forEach((item, i) => { if ('str' in item) expect(text[i].baseline).toBeCloseTo(pdfjs.Util.transform(v.transform, item.transform)[5], 5); });
    } finally { await task.destroy(); }
  });
  it('preserves embedded known-font bold and italic against the independent mixed-style source', async () => {
    const { bytes, result } = await fixture('07-pdf-mixed-styles.pdf');
    const regions = result.template.pages[0].regions.filter(r => r.kind === 'text');
    expect(regions.some(r => r.style.fontWeight === 700)).toBe(true);
    expect(regions.some(r => r.style.italic)).toBe(true);
    const rendered = await baselineRender(result);
    expect(rendered.layout.overflows).toEqual([]);
    expect(await raster(rendered.bytes)).toEqual(await raster(bytes));
  });
  it('preserves every standard Times style and pair advances against independent PDFKit', async () => {
    const { bytes, result } = await fixture('pdf-known-font-styles.pdf');
    const regions = result.template.pages[0].regions.filter(r => r.kind === 'text');
    expect(regions.map(r => [r.style.fontFamily, r.style.fontWeight, r.style.italic])).toEqual([
      ['times', 400, false], ['times', 700, false], ['times', 400, true], ['times', 700, true],
    ]);
    const rendered = await baselineRender(result);
    expect(rendered.layout.overflows).toEqual([]);
    const a = await raster(rendered.bytes), b = await raster(bytes);
    const differences = Array.from(a, (value, i) => Math.abs(value - b[i])).filter(Boolean);
    // The independent four-face source permits only tiny antialias rounding.
    expect(Math.max(0, ...differences)).toBeLessThanOrEqual(8);
    expect(differences.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000);
  });
  it('refuses a licensed occurrence source with unproved combined image replay',async()=>{await expect(fixture('09-pdf-photo.pdf')).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});});
  it('retains simple header/footer text, merged-cell width and nested decimal text', async () => {
    const header = (await fixture('21-docx-header-footer.docx')).result;
    const texts = header.baseline.blocks.flatMap(b => b.runs.map(r => r.text));
    expect(texts).toContain('Riley North — header must not silently disappear');
    expect(texts).toContain('Fictional confidential footer');
    expect(header.template.pages[0].regions.some(r => r.kind === 'text' && r.sourceLocator.startsWith('word/header1.xml'))).toBe(true);
    const merged = (await fixture('22-docx-merged-table.docx')).result;
    const block = merged.baseline.blocks.find(b => b.runs.map(r => r.text).join('') === 'Merged sidebar content')!;
    expect(merged.template.pages[0].regions.find(r => r.kind === 'text' && r.contentId === block.id)?.bounds.width).toBe(508);
    const listed = (await fixture('23-docx-lists-links.docx')).result;
    expect(listed.baseline.blocks.some(b => b.runs.map(r => r.text).join('') === '1. Nested example: documented keyboard patterns.')).toBe(true);
  });
  it('accepts shared table borders and still blocks edited text crossing those borders', async () => {
    const { result } = await fixture('18-docx-simple-table.docx');
    expect((await baselineRender(result)).layout.overflows).toEqual([]);
    const region = result.template.pages[0].regions.find(r => r.kind === 'text' && r.sourceLocator.includes('cell[1]'))!;
    if (region.kind !== 'text') throw new Error('Missing fixture cell');
    const draft = structuredClone(result.baseline);
    draft.blocks.find(b => b.id === region.contentId)!.runs = [{ text: 'W'.repeat(60) }];
    const overflowing = await renderDocument(result.template, draft, result.assets);
    expect(overflowing.layout.overflows.some(o => o.code === 'collision' && o.regionId === region.id)).toBe(true);
    expect(overflowing.layout.overflows.some(o => o.code === 'width' && o.regionId === region.id)).toBe(true);
  });
  it.each(matrix.cases.filter(f => ['complete', 'review-limited'].includes(f.expectation)))('retains source, fixed pages, permitted current content and links for $id', async f => {
    if(f.id==='09-pdf-photo'){await expect(fixture(f.filename)).rejects.toMatchObject({code:'PDF_SCOPED_PAINT'});return;}
    const { bytes, result } = await fixture(f.filename);
    expect(result.source.bytes).toEqual(bytes);
    expect(result.template.pages).toHaveLength(f.expectedPages!);
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
    const original = structuredClone(result.template), draft = structuredClone(result.baseline);
    const block = draft.blocks.find(b => b.runs.map(r => r.text).join('') === 'Product designer building accessible interfaces.') ?? (f.id==='06-pdf-monospaced'?draft.blocks.find(b=>b.runs.map(r=>r.text).join('').length>=8&&!b.runs.some(r=>r.href)):undefined);
    if (!block) throw new Error('Missing fixture profile');
    block.runs = [{ text: 'UX designer building accessible interfaces.', sourceFactIds: [...block.sourceFactIds] }];
    draft.revision++;
    let rendered;
    if(result.template.sourceFonts?.some(font=>font.sourceVersion===8)){
      let project=makeProject(result,true);await baselineRender(result);project=await approveTemplate(project,project.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));project=await createApplication(project,{title:'Authored role',company:'Fictional',description:'Accessible interface work.'});
      await expect(renderDocument(result.template,draft,result.assets)).rejects.toMatchObject({code:'SOURCE_FONT_REUSE_REQUIRED'});
      const supported=['01-pdf-classic','02-pdf-two-pages','03-pdf-sidebar-columns','04-pdf-tight-dense-a4','07-pdf-mixed-styles','08-pdf-unicode','10-pdf-multiple-links'];
      const before=structuredClone({source:project.source,template:project.template,baseline:project.baseline,facts:project.facts}),region=project.template.pages.flatMap(p=>p.regions).find(r=>r.kind==='text'&&r.contentId===block.id)!;
      if(supported.includes(f.id)){project=editBlock(project,block.id,block.runs);draft.blocks=structuredClone(project.draft.blocks);draft.revision=project.draft.revision;rendered=await renderProjectDocument(project,'current');expect(rendered.rendererVersion).toBe(f.id==='03-pdf-sidebar-columns'?'folio-licensed-subset-current-v6':'folio-licensed-subset-current-v2');const line=rendered.layout.regions.find(r=>r.regionId===region.id)!.lines[0];expect(line.runs.map(r=>r.text).join('')).toBe('UX designer building accessible interfaces.');if(region.kind!=='text'||!region.sourceLayout)throw Error('owned source region');const anchor=await independentTextAnchor(bytes,project.template.pages.findIndex(p=>p.id===region.pageId)+1,'Product designer building accessible interfaces.');expect(line.baseline).toBe(anchor.baseline);expect(line.runs[0].x).toBe(anchor.x);expect(line.runs.flatMap(r=>r.sourceGlyphs??[]).map(g=>g.unicode).join('')).toBe('UX designer building accessible interfaces.');}
      else{expect(f.id).toBe('06-pdf-monospaced');await expect(renderProjectDocument({...project,draft},'current')).rejects.toMatchObject({code:'PDF_LICENSED_CONTENT'});expect(()=>editBlock(project,block.id,[])).toThrow();draft.blocks=structuredClone(project.baseline.blocks);rendered=await renderProjectDocument(project,'current');}
      expect({source:project.source,template:project.template,baseline:project.baseline,facts:project.facts}).toEqual(before);project=saveVersion(project,'download');await expect(renderProjectHistory(project,project.folio!.versions.at(-1)!.id)).resolves.toHaveProperty('documentScopedPurpose','historyPreview');
    }else if(result.template.sourceStandardFonts?.length){
      let project=makeProject(result,true);await baselineRender(result);project=await approveTemplate(project,project.template.warnings.filter(w=>w.severity==='review').map(w=>w.id));project=await createApplication(project,{title:'Authored role',company:'Fictional',description:'Accessible interface work.'});
      await expect(renderDocument(result.template,draft,result.assets)).rejects.toMatchObject({code:'PDF_STANDARD_FONT'});project=editBlock(project,block.id,block.runs);draft.blocks=structuredClone(project.draft.blocks);draft.revision=project.draft.revision;rendered=await renderProjectDocument(project,'current');
    }else rendered=await renderDocument(result.template,draft,result.assets);
    expect(rendered.layout.overflows).toEqual([]);
    expect(result.template).toEqual(original);
    const task = pdfjs.getDocument({ data: new Uint8Array(rendered.bytes), standardFontDataUrl: resolve('public/pdfjs/standard_fonts') + '/', verbosity: 0 });
    try {
      const pdf = await task.promise, text: string[] = [], links: string[] = [];
      expect(pdf.numPages).toBe(f.expectedPages);
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p), viewport = page.getViewport({ scale: 1 });
        expect([viewport.width, viewport.height]).toEqual([original.pages[p - 1].width, original.pages[p - 1].height]);
        text.push((await page.getTextContent()).items.map(i => 'str' in i ? i.str : '').join(''));
        links.push(...(await page.getAnnotations()).filter(a => a.subtype === 'Link').map(a => a.url ?? a.unsafeUrl));
      }
      expect(normalize(text.join(''))).toBe(normalize(draft.blocks.map(b => b.runs.map(r => r.text).join('')).join('')));
      if(f.id!=='06-pdf-monospaced')expect(text.join('')).not.toContain('Product designer building accessible interfaces.');
      for (const href of f.expectedLinks ?? []) expect(links).toContain(href);
    } finally { await task.destroy(); }
  });
  it.each(matrix.cases.filter(f => f.expectation === 'rejected'))('rejects $id with its actionable code', async f => {
    const bytes = new Uint8Array(await readFile(resolve('public/fixtures/matrix', f.filename))), original = new Uint8Array(bytes);
    await expect(importResume(new File([new Uint8Array(bytes).buffer], f.filename))).rejects.toMatchObject({ code: f.expectedCodes![0] });
    expect(bytes).toEqual(original);
  });
  it.each(matrix.cases.filter(f => f.expectation === 'blocked' && f.expectedCodes?.length))('blocks approval when $id loses unsupported visible source content', async f => {
    if(f.id==='15-pdf-rotated'){const bytes=new Uint8Array(await readFile(resolve('public/fixtures/matrix',f.filename)));await expect(importResume(new File([bytes],f.filename))).rejects.toMatchObject({code:'PDF_SOURCE_PROOF'});return;}
    const { result } = await fixture(f.filename);
    for (const code of f.expectedCodes!) expect(result.template.warnings.some(w => w.code === code && w.severity === 'blocking')).toBe(true);
    const project = makeProject(result, true);
    await expect(approveTemplate(project, project.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('reports unsupported CJK glyphs explicitly instead of allowing an incomplete export', async () => {
    const { result } = await fixture('27-docx-unsupported-glyphs.docx');
    expect((await baselineRender(result)).layout.overflows.some(o => o.code === 'glyph' && o.message.includes('中'))).toBe(true);
  });
});

// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import fontkit from '@pdf-lib/fontkit';
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from 'pdf-lib';
import { approveTemplate } from '../core/commands';
import { blockText, canonicalJson, makeProject } from '../core/model';
import type { Project, TextRegion } from '../core/model';
import { validateProject } from '../core/schema';
import { computeLayout } from '../layout/engine';
import { setFontLoader } from '../layout/fonts';
import { renderDocument } from '../render/pdf';
import { importResume } from './index';
import { canRecoverApproximately, recoverApproximate } from './recovery';

let restoreFonts: () => void;
let pdfjs: typeof import('pdfjs-dist/legacy/build/pdf.mjs');
beforeAll(async () => {
  restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  const window = new JSDOM('').window;
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, DOMMatrix, ImageData, Path2D });
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  await import('./pdf');
  pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(() => restoreFonts());

const file = (name: string, bytes: Uint8Array) => new File([new Uint8Array(bytes).buffer], name);
const fixture = async (name: string) => makeProject(await importResume(file(name, new Uint8Array(await readFile(resolve('public/fixtures', name))))), true);
const firstText = (project: Project) => project.template.pages.flatMap(page => page.regions).find((region): region is TextRegion => region.kind === 'text')!;
async function word(body: string, section = '', relationships = ''): Promise<Project> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="720" w:bottom="720" w:left="720" w:right="720"/>${section}</w:sectPr></w:body></w:document>`);
  if (relationships) zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
  return makeProject(await importResume(file('fictional-recovery.docx', await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }))), true);
}
async function rotatedCatalogue(): Promise<Project> {
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica),page=pdf.addPage([612,792]);page.drawText('Fictional independently authored rotated legacy text.',{font,x:72,y:640,size:11,rotate:degrees(15)});return makeProject(await importResume(file('authored-standard14-rotated.pdf',await pdf.save())),true);
}
async function densePdf(count: number, wide = false): Promise<Project> {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([612, 792]);
  for (let index = 0; index < count; index++) page.drawText(wide ? 'W'.repeat(200) : `Record ${String(index).padStart(2, '0')}`, { x: 36, y: 726 - index * 10, size: wide ? 11 : 36, font });
  return makeProject(await importResume(file('fictional-dense.pdf', await pdf.save())), true);
}

describe('explicit approximate recovery', () => {
  it('refuses unsupported artwork rediscovered in the immutable source even if an old warning is missing', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
    page.drawText('Fictional unchanged source', { x: 72, y: 700, size: 11 });
    page.drawEllipse({ x: 400, y: 500, xScale: 20, yScale: 15 });
    const project = makeProject(await importResume(file('legacy-art.pdf', await pdf.save())), true);
    expect(project.template.warnings.some(w => w.code === 'PDF_COMPLEX_ART' && w.severity === 'blocking')).toBe(true);
    project.template.warnings = project.template.warnings.filter(w => w.severity !== 'blocking');
    const original = structuredClone(project);
    expect(canRecoverApproximately(project)).toBe(true);
    await expect(recoverApproximate(project)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_CONTENT' });
    expect(project).toEqual(original);
  });
  it.each(['FirstLast', 'First  Last', 'First\u00a0Last'])('refuses a legacy PDF word-boundary mismatch %j without rewriting saved data', async damaged => {
    const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
    page.drawText('First Last', { x: 72, y: 700, size: 11 });
    const project = makeProject(await importResume(file('legacy-spaces.pdf', await pdf.save())), true);
    project.template.importerVersion = 'folio-import-v2';
    project.baseline.blocks[0].runs[0].text = damaged;
    project.draft = structuredClone(project.baseline);
    const original = structuredClone(project);
    expect(canRecoverApproximately(project)).toBe(true);
    await expect(recoverApproximate(project)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_TEXT' });
    expect(project).toEqual(original);
  });
  it('preserves exact baseline, source, marks, safe links, facts and decisions while converting only layout blockers', async () => {
    const project = await word('<w:p><w:r><w:rPr><w:sz w:val="24"/><w:b/></w:rPr><w:t>Fictional engineering</w:t></w:r><w:r><w:rPr><w:sz w:val="28"/><w:i/></w:rPr><w:t> with exact facts</w:t></w:r></w:p><w:p><w:hyperlink r:id="portfolio"><w:r><w:t>https://example.com/fictional</w:t></w:r></w:hyperlink></w:p>', '<w:cols w:num="2"/>', '<Relationship Id="portfolio" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/fictional" TargetMode="External"/>');
    project.job = { title: 'Fictional role', company: 'Fictional company', description: 'Engineering with exact facts' };
    project.notes = [{ id: 'note-preserved', text: 'Applicant note', confirmed: true }];
    project.facts.push({ id: 'note-preserved', text: 'Applicant note', confirmed: true, kind: 'careerNote', locator: 'Applicant' });
    project.evidenceDecisions[project.facts[0].id] = { status: 'rejected', blockId: project.baseline.blocks[0].id };
    project.reviewedDraftRevision = project.draft.revision;
    const region = firstText(project);
    project.template.adjustments = [{ regionId: region.id, before: { ...region.bounds }, after: { ...region.bounds } }];
    const before = structuredClone(project);
    expect(project.template.warnings.some(item => item.code === 'DOCX_COLUMNS' && item.severity === 'blocking')).toBe(true);
    expect(project.template.warnings.some(item => item.code === 'DOCX_MIXED_RUN_STYLE' && item.severity === 'blocking')).toBe(true);
    expect(canRecoverApproximately(project)).toBe(true);
    const recovered = await recoverApproximate(project);
    expect(project).toEqual(before);
    expect(recovered.id).toBe(project.id);
    expect(recovered.template.id).toBe(project.template.id);
    expect(recovered.revision).toBe(project.revision + 1);
    expect(recovered.template.revision).toBe(project.template.revision + 1);
    for (const key of ['source', 'assets', 'baseline', 'draft', 'facts', 'notes', 'job', 'evidenceDecisions'] as const) expect(recovered[key]).toBe(project[key]);
    expect(canonicalJson(recovered.baseline)).toBe(canonicalJson(before.baseline));
    expect(recovered.template.fidelity).toMatchObject({ mode: 'approximate' });
    expect(recovered.template.fidelity!.reasons.join(' ')).toContain('Mixed run sizes');
    expect(recovered.template.adjustments).toEqual([]);
    expect(recovered.template.warnings.every(item => item.severity !== 'blocking')).toBe(true);
    expect(recovered.template.warnings.filter(item => item.code === 'APPROXIMATE_REGION')).toHaveLength(project.baseline.blocks.length);
    expect(recovered.approval).toBeNull();
    expect(recovered.reviewedDraftRevision).toBeNull();
    expect(validateProject(recovered)).toEqual(recovered);
    expect((await computeLayout(recovered.template, recovered.baseline)).overflows).toEqual([]);
    await expect(approveTemplate(recovered, [])).rejects.toMatchObject({ code: 'REVIEW_WARNINGS' });
    const approved = await approveTemplate(recovered, recovered.template.warnings.filter(item => item.severity === 'review').map(item => item.id));
    expect(approved.approval?.templateRevision).toBe(recovered.template.revision);
    expect(approved.template.fidelity?.mode).toBe('approximate');
  });

  it('reflows independently verified LTR rotated PDF text and retains its searchable exact content', async () => {
    const project = await rotatedCatalogue(), before = structuredClone(project);
    expect(project.template.warnings.some(item => item.code === 'PDF_ROTATED_OR_RTL_TEXT' && item.severity === 'blocking')).toBe(true);
    expect(canRecoverApproximately(project)).toBe(true);
    const recovered = await recoverApproximate(project);
    expect(project).toEqual(before);
    expect(recovered.baseline).toEqual(before.baseline);
    expect(recovered.source.bytes).toEqual(before.source.bytes);
    expect(recovered.template.fidelity?.reasons.join(' ')).toContain('rotation and text positions are not preserved');
    const rendered = await renderDocument(recovered.template, recovered.baseline, recovered.assets);
    expect(rendered.layout.overflows).toEqual([]);
    const task = pdfjs.getDocument({ data: new Uint8Array(rendered.bytes), standardFontDataUrl: resolve('public/pdfjs/standard_fonts') + '/', verbosity: 0 });
    try {
      const pdf = await task.promise;
      const strings: string[] = [];
      for (let index = 1; index <= pdf.numPages; index++) strings.push(...(await (await pdf.getPage(index)).getTextContent()).items.flatMap(item => 'str' in item ? [item.str] : []));
      const expected = recovered.baseline.blocks.map(blockText).join('').replace(/\s/gu, '');
      expect(strings.join('').replace(/\s/gu, '')).toBe(expected);
    } finally { await task.destroy(); }
  });

  it('keeps known artwork and images at original dimensions without losing a baseline block', async () => {
    const project = await fixture('matrix/19-docx-photo.docx');
    firstText(project).bounds.height = 1;
    const before = structuredClone(project);
    const staticRegions = project.template.pages.flatMap(page => page.regions).filter(region => region.kind !== 'text');
    expect(staticRegions.some(region => region.kind === 'image')).toBe(true);
    const recovered = await recoverApproximate(project);
    expect(project).toEqual(before);
    expect(recovered.assets).toEqual(before.assets);
    expect(recovered.template.pages.flatMap(page => page.regions).filter(region => region.kind !== 'text')).toEqual(staticRegions);
    expect(recovered.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'text').map(region => region.contentId)).toEqual(project.baseline.blocks.map(block => block.id));
    expect((await renderDocument(recovered.template, recovered.baseline, recovered.assets)).layout.overflows).toEqual([]);
    expect(recovered.template.fidelity?.reasons.join(' ')).toContain('Every imported image, rule and rectangle is retained');
  });

  it('can explicitly add a disclosed second page, preserving dimensions and original font sizes', async () => {
    const project = await densePdf(18), before = structuredClone(project);
    const recovered = await recoverApproximate(project);
    expect(recovered.template.pages).toHaveLength(2);
    expect(recovered.template.pages.every(page => page.width === 612 && page.height === 792)).toBe(true);
    expect(recovered.source.sourcePageCount).toBe(1);
    expect(recovered.template.fidelity?.reasons.join(' ')).toContain('Pagination changed from 1 to 2 pages');
    expect(recovered.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'text').every(region => region.style.fontSize === 36)).toBe(true);
    expect(project).toEqual(before);
    expect((await computeLayout(recovered.template, recovered.baseline)).overflows).toEqual([]);
  });

  it('refuses a third page or an unbreakable wide word without shrinking, truncating or mutating content', async () => {
    const tall = await densePdf(40), before = structuredClone(tall);
    await expect(recoverApproximate(tall)).rejects.toMatchObject({ code: 'RECOVERY_PAGE_LIMIT' });
    expect(tall).toEqual(before);
    const wide = await densePdf(1, true), original = structuredClone(wide);
    await expect(recoverApproximate(wide)).rejects.toMatchObject({ code: 'RECOVERY_REGION_FIT' });
    expect(wide).toEqual(original);
  });

  it('refuses approval, edited drafts, applications and repeated recovery', async () => {
    const project = await word('<w:p><w:r><w:t>Fictional exact facts</w:t></w:r></w:p>');
    const approved = await approveTemplate(project, project.template.warnings.map(item => item.id));
    expect(canRecoverApproximately(approved)).toBe(false);
    await expect(recoverApproximate(approved)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
    const edited = structuredClone(project); edited.draft.blocks[0].runs[0].text += ' edited';
    expect(canRecoverApproximately(edited)).toBe(false);
    await expect(recoverApproximate(edited)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
    const application = { ...project, workspace: { templateGroupId: project.id, kind: 'application' as const } };
    expect(canRecoverApproximately(application)).toBe(false);
    await expect(recoverApproximate(application)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
    const recovered = await recoverApproximate(project);
    expect(canRecoverApproximately(recovered)).toBe(false);
    await expect(recoverApproximate(recovered)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
  });

  it.each(['PDF_UNREADABLE_TEXT', 'PDF_IMAGE_OMITTED', 'PDF_ANNOTATION_OMITTED', 'PDF_OPTIONAL_CONTENT', 'DOCX_REVISIONS', 'DOCX_UNSUPPORTED_OBJECT', 'DOCX_RUN_DECORATION', 'FUTURE_UNACCOUNTED_CONTENT', 'constructor'])('does not acknowledge away the %s safety blocker', async code => {
    const project = await word('<w:p><w:r><w:t>Fictional exact facts</w:t></w:r></w:p>');
    project.template.warnings.push({ id: code, code, severity: 'blocking', message: 'Specific unrepresentable source content' });
    const before = structuredClone(project);
    expect(canRecoverApproximately(project)).toBe(false);
    await expect(recoverApproximate(project)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
    expect(project).toEqual(before);
  });

  it('refuses hidden text, RTL/CJK/unreadable Unicode and missing image assets even without a generic blocker', async () => {
    for (const text of ['שלום', '履歴書', 'lost\ufffdglyph', 'control\u202eglyph']) {
      const project = await word(`<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`);
      expect(canRecoverApproximately(project)).toBe(false);
      await expect(recoverApproximate(project)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
    }
    const hidden = await word('<w:p><w:r><w:t>Visible facts</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>Hidden facts</w:t></w:r></w:p>');
    expect(hidden.template.warnings.find(item => item.code === 'DOCX_HIDDEN_TEXT')?.severity).toBe('review');
    expect(canRecoverApproximately(hidden)).toBe(false);
    const photo = await fixture('matrix/19-docx-photo.docx'); photo.assets = [];
    expect(canRecoverApproximately(photo)).toBe(false);
    await expect(recoverApproximate(photo)).rejects.toMatchObject({ code: 'RECOVERY_BLOCKED' });
  });

  it('independently blocks vertical Latin source direction and unmappable glyphs', async () => {
    const document = await PDFDocument.create(); document.registerFontkit(fontkit);
    const font = await document.embedFont(await readFile(resolve('public/fonts/DejaVuSans.ttf')), { subset: true });
    document.addPage([612, 792]).drawText('Vertical Latin', { font, size: 11, x: 72, y: 700 });
    await document.flush();
    document.context.lookup(font.ref, PDFDict).set(PDFName.of('Encoding'), PDFName.of('Identity-V'));
    const vertical = makeProject(await importResume(file('fictional-vertical.pdf', await document.save())), true), before = structuredClone(vertical);
    expect(vertical.template.warnings.some(item => item.code === 'PDF_ROTATED_OR_RTL_TEXT')).toBe(true);
    // The shared import code combines rotation and direction; final source inspection distinguishes them.
    await expect(recoverApproximate(vertical)).rejects.toMatchObject({ code: 'RECOVERY_TEXT_DIRECTION' });
    expect(vertical).toEqual(before);
    const missingGlyph = await word('<w:p><w:r><w:t>Fictional engineer 🧬</w:t></w:r></w:p>');
    await expect(recoverApproximate(missingGlyph)).rejects.toMatchObject({ code: 'RECOVERY_UNSUPPORTED_GLYPH' });
  });

  it('independently refuses missing source text and section-specific omitted headers or page dimensions', async () => {
    const pdf = await rotatedCatalogue();
    pdf.baseline.blocks[0].runs[0].text = 'Different complete text'; pdf.draft = structuredClone(pdf.baseline);
    expect(canRecoverApproximately(pdf)).toBe(true);
    await expect(recoverApproximate(pdf)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_TEXT' });
    const body = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:headerReference w:type="default" r:id="header"/></w:sectPr></w:pPr><w:r><w:t>Fictional first section</w:t></w:r></w:p><w:p><w:r><w:t>Fictional second section</w:t></w:r></w:p>';
    const headers = await word(body);
    expect(canRecoverApproximately(headers)).toBe(true);
    await expect(recoverApproximate(headers)).rejects.toMatchObject({ code: 'RECOVERY_SECTION_CONTENT' });
    const dimensions = await word(body.replace('<w:headerReference w:type="default" r:id="header"/>', '').replace('w:w="12240"', 'w:w="11906"'));
    await expect(recoverApproximate(dimensions)).rejects.toMatchObject({ code: 'RECOVERY_PAGE_DIMENSIONS' });
    const docx = await word('<w:p><w:r><w:t>Exact source facts</w:t></w:r></w:p>');
    docx.baseline.blocks[0].runs[0].text = 'Changed baseline'; docx.draft = structuredClone(docx.baseline);
    await expect(recoverApproximate(docx)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_TEXT' });
  });

  it('requires the exact saved source checksum before parsing either original format', async () => {
    const pdf = await rotatedCatalogue();
    const changedBytes = new Uint8Array(pdf.source.bytes.length + 1);
    changedBytes.set(pdf.source.bytes); changedBytes[changedBytes.length - 1] = 10;
    pdf.source.bytes = changedBytes;
    const original = structuredClone(pdf);
    await expect(recoverApproximate(pdf)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_HASH' });
    expect(pdf).toEqual(original);
    const docx = await word('<w:p><w:r><w:t>Exact source facts</w:t></w:r></w:p>');
    docx.source.sha256 = '0'.repeat(64);
    await expect(recoverApproximate(docx)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_HASH' });
  });

  it('refuses unsupplied baseline qualifications, fabricated prefixes and changed paragraph order', async () => {
    const source = await word('<w:p><w:r><w:t>Exact engineering source</w:t></w:r></w:p><w:p><w:r><w:t>Other supplied experience</w:t></w:r></w:p>');
    for (const change of [
      (project: Project) => { project.baseline.blocks[0].runs.push({ text: ' UNSUPPLIED INVENTED QUALIFICATION.' }); },
      (project: Project) => { project.baseline.blocks[0].runs.unshift({ text: '99. ' }); },
      (project: Project) => { project.baseline.blocks.reverse(); },
      (project: Project) => { project.baseline.blocks[0].runs[0].bold = true; },
      (project: Project) => { project.baseline.blocks[0].runs[0].href = 'https://unsupplied.example/'; },
    ]) {
      const project = structuredClone(source); change(project); project.draft = structuredClone(project.baseline);
      const original = structuredClone(project);
      expect(canRecoverApproximately(project)).toBe(true);
      await expect(recoverApproximate(project)).rejects.toMatchObject({ code: 'RECOVERY_SOURCE_TEXT' });
      expect(project).toEqual(original);
    }
  });

  it.each(['matrix/23-docx-lists-links.docx', 'matrix/21-docx-header-footer.docx'])('exactly accounts for legitimate derived markers and headers in %s', async name => {
    const project = await fixture(name), original = structuredClone(project);
    const recovered = await recoverApproximate(project);
    expect(project).toEqual(original);
    expect(recovered.baseline).toEqual(original.baseline);
    expect((await renderDocument(recovered.template, recovered.baseline, recovered.assets)).layout.overflows).toEqual([]);
  });
});

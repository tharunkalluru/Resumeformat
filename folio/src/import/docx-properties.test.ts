// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { importDocx } from './docx';
import { blockText, makeProject, type ImportResult } from '../core/model';
import { approveTemplate, confirmDraft, validateExport } from '../core/commands';
import { setFontLoader } from '../layout/fonts';
import { renderDocument } from '../render/pdf';
import { classifyDocxProperty, createDocxPropertyResolver, type DocxProperty, type DocxPropertyState } from './docx-properties';
import { parseXml, child } from './xml';

let restoreFonts: () => void;
let dom: JSDOM;
beforeAll(async () => {
  dom = new JSDOM('');
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer, DOMMatrix, ImageData, Path2D });
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
  restoreFonts = setFontLoader(async name => new Uint8Array(await readFile(resolve('public/fonts', name))));
});
afterAll(() => { restoreFonts(); dom.window.close(); });

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const noopRun = '<w:rtl w:val="0"/><w:vertAlign w:val="baseline"/><w:shd w:val="clear" w:fill="auto"/>';
const noopParagraph = '<w:shd w:val="clear" w:fill="auto"/>';
async function word(body: string, styles = '', relationships = '', numbering = ''): Promise<ImportResult> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:z="urn:fictional-extension"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440"/></w:sectPr></w:body></w:document>`);
  if (styles) zip.file('word/styles.xml', `<w:styles xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:z="urn:fictional-extension">${styles}</w:styles>`);
  if (numbering) zip.file('word/numbering.xml', `<w:numbering xmlns:w="${W}">${numbering}</w:numbering>`);
  if (relationships) zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const result = await importDocx(new File([new Uint8Array(bytes).buffer], 'fictional-noop.docx'), bytes);
  expect(result.source.bytes).toEqual(bytes);
  expect(result.source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  return result;
}

/** Only generated identifiers are canonicalized; graph ownership and source locators remain testable. */
function projection(result: ImportResult) {
  const facts = new Map(result.facts.map((f, i) => [f.id, `fact:${i}`]));
  const content = new Map(result.baseline.blocks.map((b, i) => [b.id, `content:${i}`]));
  const pages = new Map(result.template.pages.map((p, i) => [p.id, `page:${i}`]));
  return {
    facts: result.facts.map(f => ({ text: f.text, kind: f.kind, confirmed: f.confirmed, locator: f.locator })),
    blocks: result.baseline.blocks.map(b => ({
      sourceFactIds: b.sourceFactIds.map(id => facts.get(id)),
      runs: b.runs.map(r => ({ ...r, sourceFactIds: r.sourceFactIds?.map(id => facts.get(id)) })),
    })),
    pages: result.template.pages.map(p => ({ width: p.width, height: p.height, regions: p.regions.map(r => ({
      ...r, id: undefined, pageId: pages.get(r.pageId),
      ...('contentId' in r ? { contentId: content.get(r.contentId) } : {}),
    })) })),
    warnings: result.template.warnings.map(({ code, severity, message }) => ({ code, severity, message })),
  };
}

describe('native DOCX no-op behavioral regressions', () => {
  it('preserves exact source text, marks, locators, fact ownership and measured regions for absent versus no-op properties', async () => {
    const body = (noops: boolean) => '<w:p><w:r><w:rPr><w:b/><w:u/></w:rPr><w:t>AVERY QUINN</w:t></w:r></w:p>'
      + `<w:p><w:pPr>${noops ? noopParagraph : ''}</w:pPr><w:r><w:rPr><w:i/>${noops ? noopRun : ''}</w:rPr><w:t xml:space="preserve">Fictional Résumé — café β Б </w:t><w:noBreakHyphen/><w:tab/><w:br/><w:t>Next line </w:t></w:r><w:hyperlink r:id="safe"><w:r><w:t>portfolio</w:t></w:r></w:hyperlink></w:p>`;
    const rel = '<Relationship Id="safe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.test/folio-fixture" TargetMode="External"/>';
    const plain = await word(body(false), '', rel), noop = await word(body(true), '', rel);
    expect(noop.baseline.blocks.map(b => b.runs.map(r => r.text).join(''))).toEqual(['AVERY QUINN', 'Fictional Résumé — café β Б \u2011\t\nNext line portfolio']);
    expect(noop.baseline.blocks[0].runs[0]).toMatchObject({ bold: true, underline: true });
    expect(noop.baseline.blocks[1].runs[0].italic).toBe(true);
    expect(noop.baseline.blocks[1].runs[1].href).toBe('https://example.test/folio-fixture');
    expect(projection(noop)).toEqual(projection(plain));
    expect(noop.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
    await expect(approveTemplate(makeProject(noop), noop.template.warnings.filter(w => w.severity === 'review').map(w => w.id))).resolves.toBeDefined();
    const plainPDF = await renderDocument(plain.template, plain.baseline, plain.assets), noopPDF = await renderDocument(noop.template, noop.baseline, noop.assets);
    // Tabs are preserved verbatim and retain their existing unsupported-glyph export blocker.
    expect(noopPDF.layout.overflows.map(({ code, message }) => ({ code, message }))).toEqual(plainPDF.layout.overflows.map(({ code, message }) => ({ code, message })));
    expect(noopPDF.layout.overflows).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'glyph', message: expect.stringContaining('U+0009') })]));
    expect(await pdfText(noopPDF.bytes)).toEqual(await pdfText(plainPDF.bytes));
    const selected = (await pdfText(noopPDF.bytes)).flat();
    expect(selected.join('')).toContain('Fictional Résumé — café β Б ‑');
    expect(selected.join('')).toContain('Next line portfolio');
    const approved = await approveTemplate(makeProject(noop), noop.template.warnings.map(w => w.id));
    await expect(validateExport(confirmDraft(approved), noopPDF)).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
  });

  it('keeps an active ancestor blocking despite a direct no-op reset', async () => {
    const styles = '<w:style w:type="paragraph" w:styleId="Active"><w:rPr><w:rtl w:val="1"/></w:rPr></w:style>';
    const result = await word(`<w:p><w:pPr><w:pStyle w:val="Active"/></w:pPr><w:r><w:rPr>${noopRun}</w:rPr><w:t>Exact fictional source</w:t></w:r></w:p>`, styles);
    expect(result.baseline.blocks[0].runs[0].text).toBe('Exact fictional source');
    expect(result.template.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DOCX_RUN_DECORATION', severity: 'blocking' })]));
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });

  it('keeps visible cell paint separate from transparent paragraph/run no-ops', async () => {
    const table = (noops: boolean) => `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="F1F5F9"/></w:tcPr><w:p><w:pPr>${noops ? noopParagraph : ''}</w:pPr><w:r><w:rPr>${noops ? noopRun : ''}</w:rPr><w:t>Owned sidebar</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Owned main text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const plain = await word(table(false)), noop = await word(table(true));
    expect(projection(noop)).toEqual(projection(plain));
    const rectangles = noop.template.pages.flatMap(p => p.regions).filter(r => r.kind === 'rectangle');
    expect(rectangles).toHaveLength(1);
    expect(rectangles[0]).toMatchObject({ fill: '#F1F5F9' });
    expect(noop.baseline.blocks.map(b => b.runs.map(r => r.text).join(''))).toEqual(['Owned sidebar', 'Owned main text']);
    const plainPDF = await renderDocument(plain.template, plain.baseline, plain.assets), noopPDF = await renderDocument(noop.template, noop.baseline, noop.assets);
    expect(await pdfText(noopPDF.bytes)).toEqual(await pdfText(plainPDF.bytes));
    expect(await pdfFillColors(noopPDF.bytes)).toEqual(await pdfFillColors(plainPDF.bytes));
    expect(await pdfFillColors(noopPDF.bytes)).toContain('#f1f5f9');
  });

  it('does not waive a legacy VML object just because nearby text has exact no-op metadata', async () => {
    const result = await word(`<w:p><w:r><w:rPr>${noopRun}</w:rPr><w:t>Exact fictional source</w:t><w:pict/></w:r></w:p>`);
    expect(result.template.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DOCX_UNSUPPORTED_OBJECT', severity: 'blocking' })]));
    expect(result.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION')).toBe(false);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
});

const classifierCases: [string, DocxProperty, DocxPropertyState, string, string?][] = [
  [
    "rtl-absent",
    "rtl",
    "absent",
    "<w:rPr/>",
    ""
  ],
  [
    "vertAlign-absent",
    "vertAlign",
    "absent",
    "<w:rPr/>",
    ""
  ],
  [
    "shd-absent",
    "shd",
    "absent",
    "<w:rPr/>",
    ""
  ],
  [
    "rtl-noop-0",
    "rtl",
    "noOp",
    "<w:rPr><w:rtl w:val=\"0\"/></w:rPr>",
    ""
  ],
  [
    "rtl-noop-false",
    "rtl",
    "noOp",
    "<w:rPr><w:rtl w:val=\"false\"/></w:rPr>",
    ""
  ],
  [
    "rtl-noop-off",
    "rtl",
    "noOp",
    "<w:rPr><w:rtl w:val=\"off\"/></w:rPr>",
    ""
  ],
  [
    "rtl-active-1",
    "rtl",
    "active",
    "<w:rPr><w:rtl w:val=\"1\"/></w:rPr>",
    ""
  ],
  [
    "rtl-active-true",
    "rtl",
    "active",
    "<w:rPr><w:rtl w:val=\"true\"/></w:rPr>",
    ""
  ],
  [
    "rtl-active-on",
    "rtl",
    "active",
    "<w:rPr><w:rtl w:val=\"on\"/></w:rPr>",
    ""
  ],
  [
    "rtl-omitted-default-enabled",
    "rtl",
    "active",
    "<w:rPr><w:rtl/></w:rPr>",
    ""
  ],
  [
    "rtl-invalid-upper-case",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"FALSE\"/></w:rPr>",
    ""
  ],
  [
    "rtl-invalid-leading-space",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\" false\"/></w:rPr>",
    ""
  ],
  [
    "rtl-invalid-trailing-space",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"false \"/></w:rPr>",
    ""
  ],
  [
    "rtl-invalid-unknown",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"no\"/></w:rPr>",
    ""
  ],
  [
    "rtl-invalid-empty",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"\"/></w:rPr>",
    ""
  ],
  [
    "rtl-foreign-val",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl x:val=\"0\"/></w:rPr>",
    "xmlns:x=\"urn:fictional-foreign\""
  ],
  [
    "rtl-unqualified-val",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl val=\"0\"/></w:rPr>",
    ""
  ],
  [
    "rtl-unknown-word-attribute",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"0\" w:unexpected=\"fictional\"/></w:rPr>",
    ""
  ],
  [
    "rtl-namespace-binding-permitted",
    "rtl",
    "noOp",
    "<w:rPr><q:rtl xmlns:q=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" q:val=\"0\"/></w:rPr>",
    ""
  ],
  [
    "rtl-arbitrary-prefix",
    "rtl",
    "noOp",
    "<q:rPr><q:rtl q:val=\"off\"/></q:rPr>",
    "xmlns:q=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\""
  ],
  [
    "rtl-duplicate-same",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"0\"/><w:rtl w:val=\"0\"/></w:rPr>",
    ""
  ],
  [
    "rtl-duplicate-conflicting",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"0\"/><w:rtl w:val=\"1\"/></w:rPr>",
    ""
  ],
  [
    "rtl-unexpected-child",
    "rtl",
    "uncertain",
    "<w:rPr><w:rtl w:val=\"0\"><w:unexpected/></w:rtl></w:rPr>",
    ""
  ],
  [
    "rtl-foreign-relevant-element",
    "rtl",
    "uncertain",
    "<w:rPr><x:rtl x:val=\"0\"/></w:rPr>",
    "xmlns:x=\"urn:fictional-foreign\""
  ],
  [
    "baseline-noop",
    "vertAlign",
    "noOp",
    "<w:rPr><w:vertAlign w:val=\"baseline\"/></w:rPr>",
    ""
  ],
  [
    "baseline-active-superscript",
    "vertAlign",
    "active",
    "<w:rPr><w:vertAlign w:val=\"superscript\"/></w:rPr>",
    ""
  ],
  [
    "baseline-active-subscript",
    "vertAlign",
    "active",
    "<w:rPr><w:vertAlign w:val=\"subscript\"/></w:rPr>",
    ""
  ],
  [
    "baseline-invalid-27",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"BASELINE\"/></w:rPr>",
    ""
  ],
  [
    "baseline-invalid-28",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\" baseline\"/></w:rPr>",
    ""
  ],
  [
    "baseline-invalid-29",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"baseline \"/></w:rPr>",
    ""
  ],
  [
    "baseline-invalid-30",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"unknown\"/></w:rPr>",
    ""
  ],
  [
    "baseline-invalid-31",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"\"/></w:rPr>",
    ""
  ],
  [
    "baseline-missing",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign/></w:rPr>",
    ""
  ],
  [
    "baseline-duplicate",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"baseline\"/><w:vertAlign w:val=\"baseline\"/></w:rPr>",
    ""
  ],
  [
    "baseline-extra-attribute",
    "vertAlign",
    "uncertain",
    "<w:rPr><w:vertAlign w:val=\"baseline\" w:unexpected=\"fictional\"/></w:rPr>",
    ""
  ],
  [
    "shd-paragraph-transparent-absent-color",
    "shd",
    "noOp",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"auto\"/></w:pPr>",
    ""
  ],
  [
    "shd-paragraph-transparent-auto",
    "shd",
    "noOp",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:color=\"auto\"/></w:pPr>",
    ""
  ],
  [
    "shd-paragraph-concrete-fill-FFFFFF",
    "shd",
    "active",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"FFFFFF\"/></w:pPr>",
    ""
  ],
  [
    "shd-paragraph-concrete-fill-ffffff",
    "shd",
    "active",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"ffffff\"/></w:pPr>",
    ""
  ],
  [
    "shd-paragraph-concrete-fill-F1F5F9",
    "shd",
    "active",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"F1F5F9\"/></w:pPr>",
    ""
  ],
  [
    "shd-paragraph-concrete-fill-000000",
    "shd",
    "active",
    "<w:pPr><w:shd w:val=\"clear\" w:fill=\"000000\"/></w:pPr>",
    ""
  ],
  [
    "shd-run-transparent-absent-color",
    "shd",
    "noOp",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-run-transparent-auto",
    "shd",
    "noOp",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:color=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-run-concrete-fill-FFFFFF",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"FFFFFF\"/></w:rPr>",
    ""
  ],
  [
    "shd-run-concrete-fill-ffffff",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"ffffff\"/></w:rPr>",
    ""
  ],
  [
    "shd-run-concrete-fill-F1F5F9",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"F1F5F9\"/></w:rPr>",
    ""
  ],
  [
    "shd-run-concrete-fill-000000",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"000000\"/></w:rPr>",
    ""
  ],
  [
    "shd-concrete-foreground",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:color=\"FFFFFF\"/></w:rPr>",
    ""
  ],
  [
    "shd-pattern-diagCross",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"diagCross\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-pattern-pct5",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"pct5\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-pattern-horzStripe",
    "shd",
    "active",
    "<w:rPr><w:shd w:val=\"horzStripe\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeFill",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeFill=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeColor",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeColor=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeFillTint",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeFillTint=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeFillShade",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeFillShade=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeTint",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeTint=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-theme-themeShade",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:themeShade=\"01\"/></w:rPr>",
    ""
  ],
  [
    "shd-missing-value",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-missing-fill",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\"/></w:rPr>",
    ""
  ],
  [
    "shd-nil",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"nil\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-unknown-pattern",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"fictional\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-upper-clear",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"CLEAR\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "shd-upper-auto",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"AUTO\"/></w:rPr>",
    ""
  ],
  [
    "shd-unknown-fill",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"fictional\"/></w:rPr>",
    ""
  ],
  [
    "shd-extra-attribute",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\" w:unexpected=\"fictional\"/></w:rPr>",
    ""
  ],
  [
    "shd-duplicate",
    "shd",
    "uncertain",
    "<w:rPr><w:shd w:val=\"clear\" w:fill=\"auto\"/><w:shd w:val=\"clear\" w:fill=\"auto\"/></w:rPr>",
    ""
  ],
  [
    "relevant-alternate-content",
    "rtl",
    "uncertain",
    "<w:rPr><mc:AlternateContent><mc:Choice Requires=\"x\"><w:rtl w:val=\"1\"/></mc:Choice><mc:Fallback><w:rtl w:val=\"0\"/></mc:Fallback></mc:AlternateContent></w:rPr>",
    "xmlns:mc=\"http://schemas.openxmlformats.org/markup-compatibility/2006\" xmlns:x=\"urn:fictional-extension\""
  ]
];

async function pdfText(bytes: Uint8Array): Promise<string[][]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  try {
    const pages: string[][] = [];
    for (let i = 1; i <= document.numPages; i++) pages.push((await (await document.getPage(i)).getTextContent()).items.filter(item => 'str' in item).map(item => 'str' in item ? item.str : ''));
    return pages;
  } finally { await task.destroy(); }
}
async function pdfFillColors(bytes: Uint8Array): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const document = await task.promise;
  try {
    const colors: string[] = [];
    for (let i = 1; i <= document.numPages; i++) {
      const operators = await (await document.getPage(i)).getOperatorList();
      for (const [index, operation] of operators.fnArray.entries()) if (operation === pdfjs.OPS.setFillRGBColor) colors.push(operators.argsArray[index][0]);
    }
    return colors;
  } finally { await task.destroy(); }
}
function xml(root: string, body: string, extra = ''): Document {
  return parseXml(new TextEncoder().encode(`<w:${root} xmlns:w="${W}" xmlns:z="urn:fictional-extension" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" ${extra}>${body}</w:${root}>`), 'fictional property fixture');
}
const pstyle = (id: string, content = '', extra = '') => `<w:style w:type="paragraph" w:styleId="${id}" ${extra}>${content}</w:style>`;
const cstyle = (id: string, content = '', extra = '') => `<w:style w:type="character" w:styleId="${id}" ${extra}>${content}</w:style>`;
const tstyle = (id: string, content = '', extra = '') => `<w:style w:type="table" w:styleId="${id}" ${extra}>${content}</w:style>`;
const pr = (content: string) => `<w:pPr>${content}</w:pPr>`;
const rr = (content: string) => `<w:rPr>${content}</w:rPr>`;
const ps = (id: string) => `<w:pStyle w:val="${id}"/>`;
const rs = (id: string) => `<w:rStyle w:val="${id}"/>`;
const base = (id: string) => `<w:basedOn w:val="${id}"/>`;
const activeRun = '<w:rtl w:val="true"/><w:vertAlign w:val="superscript"/><w:shd w:val="clear" w:fill="FFFFFF"/>';
interface ResolveFixture { styles?: string; paragraph?: string; run?: string; table?: string; numbering?: string; list?: { numId: string; levelId: string } }
function resolved(fixture: ResolveFixture, property: DocxProperty = 'rtl', paragraphScope = false) {
  const document = xml('document', `<w:p>${fixture.paragraph ?? ''}<w:r>${fixture.run ?? ''}<w:t>Owned fictional text</w:t></w:r></w:p>`);
  const paragraph = child(document.documentElement, 'p')!, run = child(paragraph, 'r')!;
  const resolver = createDocxPropertyResolver({ styles: fixture.styles === undefined ? undefined : xml('styles', fixture.styles), numbering: fixture.numbering === undefined ? undefined : xml('numbering', fixture.numbering) });
  const context = { paragraph, locator: 'word/document.xml/p[1]', table: fixture.table === undefined ? undefined : xml('tbl', fixture.table).documentElement, numbering: fixture.list };
  const before = new XMLSerializer().serializeToString(document);
  const decision = paragraphScope ? resolver.paragraph(context) : resolver.run(context, run, 1).find(d => d.property === property)!;
  expect(new XMLSerializer().serializeToString(document)).toBe(before);
  return decision;
}

describe('exact namespace-aware DOCX property classification', () => {
  it.each(classifierCases)('%s', (_name, property, state, carrierXML, extra) => {
    const document = parseXml(new TextEncoder().encode(`<root xmlns:w="${W}" ${extra || 'xmlns:z="urn:fictional-extension"'}>${carrierXML}</root>`), 'property classifier');
    const carrier = document.documentElement.firstElementChild!;
    const before = new XMLSerializer().serializeToString(document);
    expect(classifyDocxProperty(carrier, property, { locator: 'fixture/rPr', carrier: 'runDirect' }).state).toBe(state);
    expect(new XMLSerializer().serializeToString(document)).toBe(before);
  });
  it.each(['rtl', 'vertAlign', 'shd'] as const)('accepts local namespace bindings and arbitrary prefixes for %s', property => {
    const content = property === 'rtl' ? 'a:val="off"' : property === 'vertAlign' ? 'a:val="baseline"' : 'a:val="clear" a:fill="auto" a:color="auto"';
    const document = xml('rPr', `<a:${property} xmlns:a="${W}" ${content}/>`);
    expect(classifyDocxProperty(document.documentElement, property, { locator: 'fixture/rPr', carrier: 'runDirect' }).state).toBe('noOp');
  });
  it('distinguishes paragraph shading from nested paragraph-mark run shading', () => {
    const carrier = xml('pPr', `<w:rPr><w:shd w:val="clear" w:fill="FFFFFF"/></w:rPr>`).documentElement;
    expect(classifyDocxProperty(carrier, 'shd', { locator: 'fixture/pPr', carrier: 'paragraphDirect' }).state).toBe('absent');
    expect(resolved({ paragraph: pr(rr('<w:shd w:val="clear" w:fill="FFFFFF"/>')) }, 'shd').state).toBe('active');
  });
});

const inheritanceCases: [string, DocxPropertyState, ResolveFixture, DocxProperty?, boolean?][] = [
  ['document run defaults', 'noOp', { styles: `<w:docDefaults><w:rPrDefault>${rr(noopRun)}</w:rPrDefault></w:docDefaults>` }],
  ['paragraph default shading', 'noOp', { styles: `<w:docDefaults><w:pPrDefault>${pr(noopParagraph)}</w:pPrDefault></w:docDefaults>` }, 'shd', true],
  ['paragraph mark default baseline', 'noOp', { styles: `<w:docDefaults><w:pPrDefault>${pr(rr(noopRun))}</w:pPrDefault></w:docDefaults>` }, 'vertAlign'],
  ['typed paragraph default', 'noOp', { styles: pstyle('Default', rr(noopRun), 'w:default="1"') }],
  ['typed character default is applicable', 'active', { styles: cstyle('Default', rr(activeRun), 'w:default="true"') }],
  ['three paragraph ancestors', 'noOp', { styles: pstyle('Base', rr(noopRun)) + pstyle('Middle', base('Base') + pr(rr(noopRun))) + pstyle('Heading', base('Middle') + rr(noopRun)), paragraph: pr(ps('Heading')) }],
  ['active paragraph ancestor despite direct no-op', 'active', { styles: pstyle('Base', rr(activeRun)) + pstyle('Heading', base('Base')), paragraph: pr(ps('Heading')), run: rr(noopRun) }],
  ['active paragraph shading ancestor despite reset', 'active', { styles: pstyle('Base', pr('<w:shd w:val="clear" w:fill="FFFFFF"/>')) + pstyle('Heading', base('Base')), paragraph: pr(ps('Heading') + noopParagraph) }, 'shd', true],
  ['paragraph mark run properties', 'active', { paragraph: pr(rr(activeRun)) }],
  ['selected character ancestry', 'noOp', { styles: cstyle('Base', rr(noopRun)) + cstyle('Child', base('Base')), run: rr(rs('Child')) }, 'vertAlign'],
  ['active character ancestor despite reset', 'active', { styles: cstyle('Base', rr(activeRun)) + cstyle('Child', base('Base')), run: rr(rs('Child') + noopRun) }, 'vertAlign'],
  ['missing selected paragraph style', 'uncertain', { paragraph: pr(ps('Missing')) }],
  ['missing selected character style', 'uncertain', { run: rr(rs('Missing')) }],
  ['missing selected parent', 'uncertain', { styles: pstyle('Child', base('Missing')), paragraph: pr(ps('Child')) }],
  ['selected cycle', 'uncertain', { styles: pstyle('A', base('B')) + pstyle('B', base('A')), paragraph: pr(ps('A')) }],
  ['duplicate selected ID', 'uncertain', { styles: pstyle('A') + pstyle('A'), paragraph: pr(ps('A')) }],
  ['selected omitted type', 'uncertain', { styles: '<w:style w:styleId="A"/>', paragraph: pr(ps('A')) }],
  ['selected incompatible type', 'uncertain', { styles: cstyle('A'), paragraph: pr(ps('A')) }],
  ['parent incompatible type', 'uncertain', { styles: cstyle('Base') + pstyle('A', base('Base')), paragraph: pr(ps('A')) }],
  ['duplicate paragraph selector', 'uncertain', { styles: pstyle('A'), paragraph: pr(ps('A') + ps('A')) }],
  ['duplicate character selector', 'uncertain', { styles: cstyle('A'), run: rr(rs('A') + rs('A')) }],
  ['duplicate parent selector', 'uncertain', { styles: pstyle('Base') + pstyle('A', base('Base') + base('Base')), paragraph: pr(ps('A')) }],
  ['ambiguous paragraph defaults', 'uncertain', { styles: pstyle('A', '', 'w:default="1"') + pstyle('B', '', 'w:default="1"') }],
  ['malformed typed default', 'uncertain', { styles: '<w:style w:styleId="A" w:default="1"/>' }],
  ['unknown default flag', 'uncertain', { styles: pstyle('A', '', 'w:default="TRUE"') }],
  ['explicit paragraph bypasses unrelated ambiguous defaults', 'noOp', { styles: pstyle('A', activeRun, 'w:default="1"') + pstyle('B', '', 'w:default="1"') + pstyle('Selected', rr(noopRun)), paragraph: pr(ps('Selected')) }],
  ['explicit character bypasses unrelated ambiguous defaults', 'noOp', { styles: cstyle('A', '', 'w:default="1"') + cstyle('B', '', 'w:default="1"') + cstyle('Selected', rr(noopRun)), run: rr(rs('Selected')) }],
  ['unrelated active and malformed styles never selected', 'absent', { styles: pstyle('Active', rr(activeRun)) + pstyle('Cycle', base('Cycle')) + cstyle('Duplicate') + cstyle('Duplicate') }],
  ['unrelated extension-wrapped active style never selected', 'absent', { styles: `<mc:AlternateContent><mc:Choice Requires="z">${pstyle('Unused', rr(activeRun))}</mc:Choice></mc:AlternateContent>` }],
  ['extension-wrapped default selection is uncertain', 'uncertain', { styles: `<mc:AlternateContent><mc:Choice Requires="z">${pstyle('Default', rr(activeRun), 'w:default="1"')}</mc:Choice></mc:AlternateContent>` }],
  ['explicit valid style bypasses wrapped unrelated default', 'noOp', { styles: pstyle('Used', rr(noopRun)) + `<mc:AlternateContent><mc:Choice Requires="z">${pstyle('Default', rr(activeRun), 'w:default="1"')}</mc:Choice></mc:AlternateContent>`, paragraph: pr(ps('Used')) }],
  ['duplicate document-default carrier', 'uncertain', { styles: `<w:docDefaults><w:rPrDefault>${rr(noopRun)}${rr(noopRun)}</w:rPrDefault></w:docDefaults>` }],
  ['duplicate paragraph property carrier', 'uncertain', { paragraph: pr('') + pr('') }],
  ['duplicate run property carrier', 'uncertain', { run: rr('') + rr('') }],
  ['missing linked target', 'uncertain', { styles: pstyle('A', '<w:link w:val="Missing"/>'), paragraph: pr(ps('A')) }],
  ['incompatible linked target', 'uncertain', { styles: pstyle('A', '<w:link w:val="B"/>') + pstyle('B'), paragraph: pr(ps('A')) }],
  ['duplicate linked target', 'uncertain', { styles: pstyle('A', '<w:link w:val="B"/>') + cstyle('B') + cstyle('B'), paragraph: pr(ps('A')) }],
  ['valid reciprocal link does not select character paint', 'absent', { styles: pstyle('A', '<w:link w:val="B"/>') + cstyle('B', '<w:link w:val="A"/>' + rr(activeRun)), paragraph: pr(ps('A')) }],
  ['explicit reciprocal character link selects active ancestry', 'active', { styles: pstyle('A', '<w:link w:val="B"/>') + cstyle('B', '<w:link w:val="A"/>' + rr(activeRun)), paragraph: pr(ps('A')), run: rr(rs('B')) }, 'vertAlign'],
  ['applicable paragraph alternate style selector', 'uncertain', { paragraph: pr('<mc:AlternateContent><mc:Choice Requires="z"><w:pStyle w:val="Hidden"/></mc:Choice></mc:AlternateContent>') }],
  ['applicable run alternate style selector', 'uncertain', { run: rr('<mc:AlternateContent><mc:Choice Requires="z"><w:rStyle w:val="Hidden"/></mc:Choice></mc:AlternateContent>') }],
  ['style internal character selector unresolved', 'uncertain', { styles: pstyle('A', rr(rs('B'))) + cstyle('B', rr(activeRun)), paragraph: pr(ps('A')) }],
  ['paragraph mark character selector unresolved', 'uncertain', { styles: cstyle('B', rr(activeRun)), paragraph: pr(rr(rs('B'))) }],
  ['style internal paragraph selector unresolved', 'uncertain', { styles: pstyle('A', pr(ps('B'))) + pstyle('B', rr(activeRun)), paragraph: pr(ps('A')) }],
];

describe('bounded applicable DOCX property inheritance', () => {
  it.each(inheritanceCases)('%s', (_name, state, fixture, property, paragraphScope) => {
    expect(resolved(fixture, property, paragraphScope).state).toBe(state);
  });
  it('completes long indexed ancestry without recursion and caches proof before repeated runs', () => {
    const count = 1800;
    const styles = xml('styles', Array.from({ length: count }, (_, i) => pstyle(`Style${i}`, rr(noopRun) + (i ? base(`Style${i - 1}`) : ''))).join(''));
    const document = xml('document', `<w:p>${pr(ps(`Style${count - 1}`))}<w:r><w:t>Owned text</w:t></w:r></w:p>`), paragraph = child(document.documentElement, 'p')!, run = child(paragraph, 'r')!;
    const resolver = createDocxPropertyResolver({ styles }), context = { paragraph, locator: 'word/document.xml/p[1]' };
    expect(resolver.run(context, run, 1).filter(d => ['rtl', 'vertAlign', 'shd'].includes(d.property)).every(d => d.state === 'noOp')).toBe(true);
    // A fresh context still reuses style/default selection proofs; no additional ancestry reads.
    const used = child(styles.documentElement, 'style')!, getAttribute = used.getAttributeNS.bind(used);
    let reads = 0;
    used.getAttributeNS = (ns, name) => { reads++; return getAttribute(ns, name); };
    expect(resolver.run({ ...context }, run, 2).filter(d => ['rtl', 'vertAlign', 'shd'].includes(d.property)).every(d => d.state === 'noOp')).toBe(true);
    expect(reads).toBe(0);
    const cycle = xml('styles', Array.from({ length: count }, (_, i) => pstyle(`Style${i}`, base(`Style${i ? i - 1 : count - 1}`))).join(''));
    expect(createDocxPropertyResolver({ styles: cycle }).run(context, run, 1).filter(d => !['bidi', 'textDirection'].includes(d.property)).every(d => d.state === 'uncertain')).toBe(true);
  });
});

const listDefinition = (p = '', r = '') => `<w:abstractNum w:abstractNumId="7"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>${pr(p)}${rr(r)}</w:lvl></w:abstractNum><w:num w:numId="4"><w:abstractNumId w:val="7"/></w:num>`;
const list = { numId: '4', levelId: '0' };
const tableRef = '<w:tblPr><w:tblStyle w:val="Used"/></w:tblPr>';
const contextCases: [string, DocxPropertyState, ResolveFixture, DocxProperty?, boolean?][] = [
  ['explicit table base paragraph shading', 'noOp', { styles: tstyle('Base', pr(noopParagraph)) + tstyle('Used', base('Base')), table: tableRef }, 'shd', true],
  ['default table run metadata', 'noOp', { styles: tstyle('Used', rr(noopRun), 'w:default="1"'), table: '' }],
  ['table without default has no style contribution', 'absent', { table: '' }],
  ['ambiguous table defaults', 'uncertain', { styles: tstyle('A', '', 'w:default="1"') + tstyle('B', '', 'w:default="1"'), table: '' }],
  ['table default missing type', 'uncertain', { styles: '<w:style w:styleId="A" w:default="1"/>', table: '' }],
  ['missing table style', 'uncertain', { table: tableRef }],
  ['all used table conditional no-ops', 'noOp', { styles: tstyle('Used', `<w:tblStylePr w:type="firstRow">${pr(noopParagraph)}${rr(noopRun)}</w:tblStylePr><w:tblStylePr w:type="lastCol">${rr(noopRun)}</w:tblStylePr>`), table: tableRef }, 'shd', true],
  ['active used conditional shading is applicability uncertainty', 'uncertain', { styles: tstyle('Used', `<w:tblStylePr w:type="firstRow">${pr('<w:shd w:val="clear" w:fill="FFFFFF"/>')}</w:tblStylePr>`), table: tableRef }, 'shd', true],
  ['unknown used conditional run metadata', 'uncertain', { styles: tstyle('Used', '<w:tblStylePr w:type="firstRow"><w:rPr><w:rtl w:val="unknown"/></w:rPr></w:tblStylePr>'), table: tableRef }],
  ['unused active conditional table style', 'absent', { styles: tstyle('Unused', `<w:tblStylePr w:type="firstRow">${rr(activeRun)}</w:tblStylePr>`) }],
  ['active numbering run level', 'active', { numbering: listDefinition('', activeRun), list }],
  ['transparent numbering paragraph shading', 'noOp', { numbering: listDefinition(noopParagraph), list }, 'shd', true],
  ['numId zero ignores active numbering', 'absent', { numbering: listDefinition('', activeRun), list: { ...list, numId: '0' } }],
  ['unused active and picture numbering ignored', 'absent', { numbering: listDefinition('', activeRun) + '<w:numPicBullet w:numPicBulletId="1"><w:pict/></w:numPicBullet>' }],
  ['missing active numbering', 'uncertain', { list }],
  ['duplicate active numbering ID', 'uncertain', { numbering: listDefinition() + '<w:num w:numId="4"><w:abstractNumId w:val="7"/></w:num>', list }],
  ['missing active numbering level', 'uncertain', { numbering: listDefinition(), list: { ...list, levelId: '1' } }],
  ['duplicate active numbering level', 'uncertain', { numbering: listDefinition().replace('</w:abstractNum>', '<w:lvl w:ilvl="0"/></w:abstractNum>'), list }],
  ['active numbering level selected paragraph style', 'active', { styles: pstyle('Numbered', rr(activeRun)), numbering: listDefinition().replace('<w:lvl w:ilvl="0">', `<w:lvl w:ilvl="0">${ps('Numbered')}`), list }],
  ['unresolved numbering style link', 'uncertain', { numbering: listDefinition().replace('<w:abstractNum w:abstractNumId="7">', '<w:abstractNum w:abstractNumId="7"><w:numStyleLink w:val="Missing"/>'), list }],
  ['level override preserves existing unsupported context', 'uncertain', { numbering: listDefinition().replace('</w:num>', '<w:lvlOverride w:ilvl="0"><w:lvl w:ilvl="0"><w:rPr><w:rtl w:val="0"/></w:rPr></w:lvl></w:lvlOverride></w:num>'), list }],
];
describe('applicable table and numbering property contexts', () => {
  it.each(contextCases)('%s', (_name, state, fixture, property, paragraphScope) => {
    const decision = resolved(fixture, property, paragraphScope);
    expect(decision.state).toBe(state);
    if (_name.includes('applicability uncertainty')) expect(decision.issues[0]).toMatchObject({ state: 'uncertain', conditional: true });
  });
});

describe('actual imported approval and remaining blocker inventory', () => {
  it('preserves no-op defaults, heading ancestry, selected character styles and actual approval', async () => {
    const styles = `<w:docDefaults><w:rPrDefault>${rr(noopRun)}</w:rPrDefault><w:pPrDefault>${pr(noopParagraph)}</w:pPrDefault></w:docDefaults>`
      + pstyle('Base', rr(noopRun) + pr(noopParagraph)) + pstyle('Heading', base('Base') + pr(rr(noopRun)))
      + cstyle('BaseChar', rr(noopRun)) + cstyle('SelectedChar', base('BaseChar'));
    const body = `<w:p>${pr(ps('Heading'))}<w:r>${rr(rs('SelectedChar') + '<w:b/>')}<w:t>AVERY QUINN</w:t></w:r></w:p>`;
    const plain = await word(body, pstyle('Heading') + cstyle('SelectedChar')), noop = await word(body, styles);
    expect(projection(noop)).toEqual(projection(plain));
    await expect(approveTemplate(makeProject(noop), noop.template.warnings.map(w => w.id))).resolves.toBeDefined();
    const plainPDF = await renderDocument(plain.template, plain.baseline, plain.assets), noopPDF = await renderDocument(noop.template, noop.baseline, noop.assets);
    expect(await pdfText(noopPDF.bytes)).toEqual(await pdfText(plainPDF.bytes));
    expect(noopPDF.layout.overflows).toEqual([]);
    const approved = await approveTemplate(makeProject(noop), noop.template.warnings.map(w => w.id));
    await expect(validateExport(confirmDraft(approved), noopPDF)).resolves.toBeUndefined();
  });
  it.each([
    ['omitted RTL', '<w:rtl/>'], ['true RTL', '<w:rtl w:val="on"/>'], ['superscript', '<w:vertAlign w:val="superscript"/>'],
    ['subscript', '<w:vertAlign w:val="subscript"/>'], ['white fill', '<w:shd w:val="clear" w:fill="FFFFFF"/>'],
    ['theme-dependent fill', '<w:shd w:val="clear" w:fill="auto" w:themeFill="accent1"/>'],
    ['duplicate no-op', '<w:rtl w:val="0"/><w:rtl w:val="0"/>'], ['unknown baseline', '<w:vertAlign w:val="unknown"/>'],
  ])('keeps actual approval blocked for %s', async (_name, decoration) => {
    const result = await word(`<w:p><w:r>${rr(decoration)}<w:t>Exact fictional source</w:t></w:r></w:p>`);
    expect(result.facts[0]).toMatchObject({ text: 'Exact fictional source', locator: 'word/document.xml/p[1]' });
    expect(result.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION' && w.severity === 'blocking')).toBe(true);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it.each(inheritanceCases.filter(([, state]) => state === 'uncertain' || state === 'active').slice(0, 20))('blocks ordinary approval for inherited fixture: %s', async (_name, _state, fixture) => {
    const result = await word(`<w:p>${fixture.paragraph ?? ''}<w:r>${fixture.run ?? ''}<w:t>Exact fictional source</w:t></w:r></w:p>`, fixture.styles);
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(true);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it.each([
    ['highlight', '<w:highlight w:val="yellow"/>'], ['position', '<w:position w:val="2"/>'], ['fitText', '<w:fitText w:val="100"/>'],
  ])('retains the separate %s blocker with exact no-op metadata', async (name, decoration) => {
    const result = await word(`<w:p><w:r>${rr(noopRun + decoration)}<w:t>Owned text</w:t></w:r></w:p>`);
    const warnings = result.template.warnings.filter(w => w.code === 'DOCX_RUN_DECORATION');
    expect(warnings).toHaveLength(1); expect(warnings[0].message).toContain(name);
    expect(warnings[0].message).not.toContain('RTL');
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('retains actual bidi, mixed run size, floating drawing and tracked revision blockers', async () => {
    const result = await word(`<w:p>${pr('<w:bidi/>')}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r><w:r>${rr(noopRun + '<w:sz w:val="32"/>')}<w:t>Different size</w:t><w:drawing/></w:r><w:ins><w:r><w:t>Unaccepted insertion</w:t></w:r></w:ins></w:p>`);
    expect(result.template.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['DOCX_TEXT_DIRECTION', 'DOCX_MIXED_RUN_STYLE', 'DOCX_FLOATING_IMAGE', 'DOCX_REVISIONS']));
    expect(result.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION')).toBe(false);
  });
  it('retains oversized source table geometry while inspecting used table style ancestors', async () => {
    const body = `<w:tbl><w:tblPr><w:tblStyle w:val="Used"/><w:tblInd w:w="-575"/></w:tblPr><w:tblGrid><w:gridCol w:w="11927"/></w:tblGrid><w:tr><w:tc><w:p><w:r>${rr(noopRun)}<w:t>Owned source text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
    const result = await word(body, tstyle('Used', rr(activeRun)));
    expect(result.template.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['DOCX_COMPLEX_TABLE', 'DOCX_RUN_DECORATION']));
    expect(result.facts[0]).toMatchObject({ text: 'Owned source text', locator: 'word/document.xml/tbl[1]/row[1]/cell[1]/p[1]' });
  });
  it('preserves bullet markers/indentation and recognizes effective inherited numId; zero disables it', async () => {
    const body = `<w:p>${pr(ps('List'))}<w:r><w:t>Owned list text</w:t></w:r></w:p>`;
    const styles = pstyle('List', pr('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>'));
    const plain = await word(body, styles, '', listDefinition()), noop = await word(body, styles, '', listDefinition(noopParagraph, noopRun));
    expect(projection(noop)).toEqual(projection(plain));
    expect(noop.facts[0].text).toBe('• Owned list text');
    const active = await word(body, styles, '', listDefinition('', activeRun));
    expect(active.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION')).toBe(true);
    const disabled = await word(body.replace(ps('List'), ps('List') + '<w:numPr><w:numId w:val="0"/></w:numPr>'), styles, '', listDefinition('', activeRun));
    expect(disabled.facts[0].text).toBe('Owned list text');
    expect(disabled.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION')).toBe(false);
  });
  it('keeps distinct active/uncertain property reasons and accurate affected counts without per-run warning growth', async () => {
    const repeated = Array.from({ length: 12 }, () => `<w:r>${rr('<w:rtl w:val="on"/><w:vertAlign w:val="superscript"/><w:shd w:val="clear" w:fill="auto" w:themeFill="accent1"/>')}<w:t>x</w:t></w:r>`).join('');
    const result = await word(`<w:p>${repeated}</w:p>`);
    const warnings = result.template.warnings.filter(w => w.code === 'DOCX_RUN_DECORATION');
    expect(warnings).toHaveLength(3);
    for (const warning of warnings) { expect(warning.severity).toBe('blocking'); expect(warning.message).toContain('Affected run contexts: 12'); expect(warning.message).toContain('word/document.xml/p[1]/r[1]'); }
    expect(warnings.map(w => w.message).join('\n')).toContain('theme-dependent paint');
  });
  it('refuses complete-warning inventory overflow instead of truncating warnings', async () => {
    const runs = Array.from({ length: 1000 }, (_, i) => `<w:r>${rr(`<w:rFonts w:ascii="OwnedFont${i}"/>`)}<w:t>x</w:t></w:r>`).join('');
    await expect(word(`<w:p>${runs}</w:p>`)).rejects.toMatchObject({ code: 'DOCX_WARNING_LIMIT' });
  });
});

describe('applicable paragraph direction and numbering uncertainty', () => {
  const cases: [string, string, string, string][] = [
    ['default paragraph bidi', '<w:p><w:r><w:t>Owned text</w:t></w:r></w:p>', `<w:docDefaults><w:pPrDefault>${pr('<w:bidi w:val="1"/>')}</w:pPrDefault></w:docDefaults>`, ''],
    ['Normal ancestor bidi with direct rtl zero', `<w:p>${pr(ps('Heading'))}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, pstyle('Normal', pr('<w:bidi w:val="1"/>')) + pstyle('Heading', base('Normal')), ''],
    ['inherited paragraph textDirection', `<w:p>${pr(ps('Heading'))}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, pstyle('Normal', pr('<w:textDirection w:val="tbRl"/>')) + pstyle('Heading', base('Normal')), ''],
    ['selected character pPr direction', `<w:p><w:r>${rr(rs('Character') + noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, cstyle('Character', pr('<w:bidi w:val="1"/>')), ''],
    ['used table ancestry direction', `<w:tbl><w:tblPr><w:tblStyle w:val="Used"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`, tstyle('Base', pr('<w:textDirection w:val="tbRl"/>')) + tstyle('Used', base('Base')), ''],
    ['active numbering direction', `<w:p>${pr('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="4"/></w:numPr>')}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, '', listDefinition('<w:bidi w:val="1"/>')],
    ['conservative inherited bidi zero remains unsupported', `<w:p>${pr(ps('Normal'))}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, pstyle('Normal', pr('<w:bidi w:val="0"/>')), ''],
  ];
  it.each(cases)('retains a named direction blocker for %s', async (_name, body, styles, numbering) => {
    const result = await word(body, styles, '', numbering);
    const directionWarnings = result.template.warnings.filter(w => w.code === 'DOCX_TEXT_DIRECTION');
    expect(directionWarnings.length).toBeGreaterThan(0);
    expect(directionWarnings.every(w => w.severity === 'blocking')).toBe(true);
    expect(directionWarnings.map(w => w.message).join(' ')).not.toContain('shading');
    expect(result.template.warnings.some(w => w.code === 'DOCX_RUN_DECORATION')).toBe(false);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('does not apply direction metadata from unused paragraph/table/character styles', async () => {
    const styles = pstyle('Unused', pr('<w:bidi w:val="1"/>')) + tstyle('UnusedTable', pr('<w:textDirection w:val="tbRl"/>')) + cstyle('UnusedChar', pr('<w:bidi w:val="1"/>'));
    const result = await word(`<w:p><w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, styles);
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).resolves.toBeDefined();
  });
  it('retains existing direct paragraph direction handling', async () => {
    const result = await word(`<w:p>${pr('<w:bidi w:val="0"/>')}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`);
    expect(result.template.warnings.filter(w => w.code === 'DOCX_TEXT_DIRECTION')).toEqual([expect.objectContaining({ message: 'A paragraph uses right-to-left or vertical text. Import horizontal left-to-right text before export.', severity: 'blocking' })]);
  });
  it('blocks partial direct numPr which can hide an inherited active numbering level', async () => {
    const styles = pstyle('List', pr('<w:numPr><w:numId w:val="4"/><w:ilvl w:val="0"/></w:numPr>'));
    const result = await word(`<w:p>${pr(ps('List') + '<w:numPr><w:ilvl w:val="0"/></w:numPr>')}<w:r>${rr(noopRun)}<w:t>Owned list text</w:t></w:r></w:p>`, styles, '', listDefinition('', activeRun));
    expect(result.template.warnings.filter(w => w.severity === 'blocking').map(w => w.message).join(' ')).toContain('partial paragraph numbering reference');
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('blocks alternate paragraph selectors and revision-wrapped run selectors in applicable defaults', () => {
    expect(resolved({ paragraph: pr('<mc:AlternateContent><mc:Choice Requires="z"><w:pStyle w:val="Hidden"/></mc:Choice></mc:AlternateContent>') }).state).toBe('uncertain');
    expect(resolved({ run: rr('<w:rPrChange><w:rPr><w:rStyle w:val="Hidden"/></w:rPr></w:rPrChange>') }).state).toBe('uncertain');
    expect(resolved({ styles: '<w:docDefaults><mc:AlternateContent><mc:Choice Requires="z"><w:rPrDefault><w:rPr><w:rtl w:val="1"/></w:rPr></w:rPrDefault></mc:Choice></mc:AlternateContent></w:docDefaults>' }).state).toBe('uncertain');
  });
});

describe('other applicable unsupported decoration carriers', () => {
  it.each(['position', 'fitText', 'highlight'])('retains inherited %s without adding a reset waiver', async property => {
    const active = `<w:${property} w:val="${property === 'highlight' ? 'yellow' : '1'}"/>`;
    const styles = pstyle('Base', rr(active)) + pstyle('Heading', base('Base'));
    const result = await word(`<w:p>${pr(ps('Heading'))}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, styles);
    const warnings = result.template.warnings.filter(w => w.code === 'DOCX_RUN_DECORATION');
    expect(warnings.some(w => w.message.includes(`run ${property}: active`))).toBe(true);
    expect(warnings.map(w => w.message).join(' ')).not.toContain('run RTL');
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it.each([
    ['default', { styles: `<w:docDefaults><w:rPrDefault>${rr('<w:highlight w:val="yellow"/>')}</w:rPrDefault></w:docDefaults>` }],
    ['character ancestor', { styles: cstyle('Base', rr('<w:position w:val="2"/>')) + cstyle('Character', base('Base')), run: rr(rs('Character')) }],
    ['paragraph mark', { paragraph: pr(rr('<w:fitText w:val="100"/>')) }],
    ['used table', { styles: tstyle('Used', rr('<w:highlight w:val="yellow"/>')), table: tableRef }],
    ['used numbering', { numbering: listDefinition('', '<w:position w:val="2"/>'), list }],
  ] satisfies [string, ResolveFixture][])('retains active decoration in %s carrier', (_name, fixture) => {
    const property = _name === 'paragraph mark' ? 'fitText' : ['character ancestor', 'used numbering'].includes(_name) ? 'position' : 'highlight';
    expect(resolved(fixture, property).state).toBe('active');
  });
  it('does not select unused inherited decoration', async () => {
    const result = await word(`<w:p><w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`, pstyle('Unused', rr('<w:highlight w:val="yellow"/><w:position w:val="2"/><w:fitText w:val="100"/>')));
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
  });
  it.each(['bidi', 'textDirection'])('blocks direct paragraph alternate-content %s with actual approval', async property => {
    const declaration = `<w:${property} w:val="${property === 'bidi' ? '1' : 'tbRl'}"/>`;
    const result = await word(`<w:p>${pr(`<mc:AlternateContent><mc:Choice Requires="z">${declaration}</mc:Choice><mc:Fallback/></mc:AlternateContent>`)}<w:r>${rr(noopRun)}<w:t>Owned text</w:t></w:r></w:p>`);
    const warning = result.template.warnings.find(w => w.code === 'DOCX_TEXT_DIRECTION');
    expect(warning).toMatchObject({ severity: 'blocking', message: expect.stringContaining('uncertain') });
    expect(warning?.message).toContain('unresolved extension or alternate content');
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('does not waive relevant properties hidden in unknown Word wrappers', () => {
    const carrier = xml('rPr', '<w:unknownWrapper><w:rtl w:val="0"/></w:unknownWrapper>').documentElement;
    expect(classifyDocxProperty(carrier, 'rtl', { locator: 'fixture/rPr', carrier: 'runDirect' }).state).toBe('uncertain');
  });
});

describe('Word built-in bullets (phase 1)', () => {
  const list = (marker: string) => `<w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${marker}"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="4"/></w:num>`;
  const body = '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Led a fictional rollout</w:t></w:r></w:p>';
  it('reads Word’s default Symbol-font bullet as a normal bullet without blocking the import', async () => {
    const result = await word(body, '', '', list(''));
    expect(result.template.warnings.filter(warning => warning.severity === 'blocking')).toEqual([]);
    expect(blockText(result.baseline.blocks[0])).toMatch(/^• Led a fictional rollout/);
  });
  it('shows decorative Wingdings markers as a plain bullet with an informational note', async () => {
    const result = await word(body, '', '', list(''));
    expect(result.template.warnings.some(warning => warning.severity === 'blocking')).toBe(false);
    expect(result.template.warnings.some(warning => warning.code === 'DOCX_NUMBERING' && warning.severity === 'info')).toBe(true);
    expect(blockText(result.baseline.blocks[0])).toMatch(/^• /);
  });
  it('still blocks markers it cannot represent', async () => {
    const result = await word(body, '', '', list(''));
    expect(result.template.warnings.some(warning => warning.code === 'DOCX_NUMBERING' && warning.severity === 'blocking')).toBe(true);
  });
});

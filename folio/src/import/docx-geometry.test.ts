// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { importDocx } from './docx';
import { normalizeDocxInkEnvelope } from './docx-geometry';
import { layoutDocument, prepareFonts, type FontRegistry } from '../layout/engine';
import { FONT_FILES, loadFont, setFontLoader, type FontKey } from '../layout/fonts';
import { makeProject, type ContentSnapshot, type ImportResult, type LayoutResult, type Template, type TextRegion, type TextRun, type TextStyle } from '../core/model';
import { approveTemplate, confirmDraft, editBlock, validateExport } from '../core/commands';
import { renderDocument } from '../render/pdf';

let restoreFonts: () => void;
let dom: JSDOM;
let fonts: FontRegistry;
beforeAll(async () => {
  dom = new JSDOM('');
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser, XMLSerializer: dom.window.XMLSerializer });
  restoreFonts = setFontLoader(async name => new Uint8Array(await readFile(resolve('public/fonts', name))));
  fonts = new Map(await Promise.all((Object.keys(FONT_FILES) as FontKey[]).map(async key => [key, await loadFont(key)] as const)));
});
afterAll(() => { restoreFonts(); dom.window.close(); });

const style: TextStyle = { fontFamily: 'sans', fontSize: 10, fontWeight: 400, italic: false, color: '#000000', alignment: 'left', lineHeight: 11 };
function fixture(runs: TextRun[], overrides: Partial<TextStyle> = {}, bounds = { x: 20, y: 20, width: 350, height: 11 }) {
  const region: TextRegion = { kind: 'text', id: 'text', pageId: 'page', order: 0, bounds, contentId: 'content', role: 'body', style: { ...style, ...overrides }, sourceLocator: 'word/document.xml/p[1]' };
  const template: Template = { id: 'template', revision: 1, pages: [{ id: 'page', width: 612, height: 792, regions: [region] }], warnings: [], importerVersion: 'fixture-before-envelope' };
  const content: ContentSnapshot = { revision: 1, blocks: [{ id: 'content', runs, sourceFactIds: [] }] };
  return { template, content };
}
const lineProjection = (layout: LayoutResult) => layout.regions.map(region => ({ regionId: region.regionId, pageId: region.pageId, lines: region.lines }));
const nonHeightCodes = (layout: LayoutResult) => layout.overflows.filter(issue => issue.code !== 'height').map(({ regionId, code }) => ({ regionId, code }));
function checkUnion(template: Template, normalized: Template) {
  template.pages.forEach((page, i) => page.regions.forEach((region, j) => {
    const next = normalized.pages[i].regions[j];
    if (region.kind !== 'text') { expect(next).toEqual(region); return; }
    expect(next.kind).toBe('text');
    if (next.kind !== 'text') return;
    expect(next.bounds.x).toBe(region.bounds.x); expect(next.bounds.width).toBe(region.bounds.width);
    expect(next.bounds.y).toBeLessThanOrEqual(region.bounds.y);
    expect(next.bounds.y + next.bounds.height).toBeGreaterThanOrEqual(region.bounds.y + region.bounds.height);
    expect({ ...next.style, baselineOffset: undefined }).toEqual({ ...region.style, baselineOffset: undefined });
  }));
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const pr = (text: string) => `<w:pPr>${text}</w:pPr>`;
const rr = (text: string) => `<w:rPr>${text}</w:rPr>`;
const paragraph = (text: string, properties = '', runProperties = '') => `<w:p>${pr(properties)}<w:r>${rr(runProperties)}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jOZkAAAAASUVORK5CYII=';
async function word(body: string, options: { styles?: string; parts?: Record<string, string | Uint8Array>; relationships?: string; section?: string } = {}): Promise<ImportResult> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440" w:left="1440" w:right="1440" w:header="720" w:footer="720"/>${options.section ?? ''}</w:sectPr></w:body></w:document>`);
  if (options.styles) zip.file('word/styles.xml', `<w:styles xmlns:w="${W}">${options.styles}</w:styles>`);
  if (options.relationships) zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${options.relationships}</Relationships>`);
  for (const [path, bytes] of Object.entries(options.parts ?? {})) zip.file(path, bytes);
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const result = await importDocx(new File([new Uint8Array(bytes).buffer], 'owned-envelope-fixture.docx'), bytes);
  expect(result.source.bytes).toEqual(bytes);
  expect(result.source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  return result;
}
function logicalTemplate(result: ImportResult): Template {
  const layout = layoutDocument(result.template, result.baseline, fonts);
  const lines = new Map(layout.regions.map(region => [region.regionId, region.lines]));
  return { ...result.template, pages: result.template.pages.map(page => ({ ...page, regions: page.regions.map(region => {
    if (region.kind !== 'text') return region;
    const { baselineOffset: _offset, ...logicalStyle } = region.style;
    const weight=region.style.fontWeight;if(weight!==400&&weight!==700)throw new Error('DOCX catalogue geometry requires its binary declared face.');
    const base = fonts.get(`${region.style.fontFamily}-${weight}-${region.style.italic ? 'italic' : 'normal'}`)!;
    const firstOffset = (region.style.lineHeight + base.ascent(region.style.fontSize) - base.descent(region.style.fontSize)) / 2;
    return { ...region, style: logicalStyle, bounds: { ...region.bounds, y: lines.get(region.id)![0].baseline - firstOffset, height: Math.max(1, lines.get(region.id)!.length) * region.style.lineHeight } };
  }) })) };
}

describe('fresh DOCX canonical vertical ink envelope', () => {
  it.each([
    ['descenders', [{ text: 'gypq' }]],
    ['accented Greek Cyrillic', [{ text: 'Été café β Б gyp' }]],
    ['mixed marks and link', [{ text: 'gyp', bold: true }, { text: ' É β Б', italic: true, underline: true, href: 'https://example.test/owned' }]],
    ['leading empty line', [{ text: '\ngyp' }]],
    ['trailing empty line', [{ text: 'gyp\n' }]],
    ['space-only empty line', [{ text: 'gyp\n   ' }]],
  ] satisfies [string, TextRun[]][])('contains %s while preserving every canonical line/run position', (_name, runs) => {
    const { template, content } = fixture(runs);
    const original = structuredClone(template), before = layoutDocument(template, content, fonts);
    const result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(template).toEqual(original);
    expect(lineProjection(result.layout)).toEqual(lineProjection(before));
    expect(nonHeightCodes(result.layout)).toEqual(nonHeightCodes(before));
    expect(result.layout.overflows.some(issue => issue.code === 'height')).toBe(false);
    checkUnion(template, result.template);
    expect(result.template.pages[0].regions[0]).toMatchObject({ style: { baselineOffset: expect.any(Number) } });
  });
  it('includes base-font descent for empty logical lines, without arbitrary padding', () => {
    const { template, content } = fixture([{ text: 'g\n' }]);
    const before = layoutDocument(template, content, fonts), last = before.regions[0].lines.at(-1)!;
    const result = normalizeDocxInkEnvelope(template, content, fonts), bounds = result.template.pages[0].regions[0].bounds;
    expect(bounds.y + bounds.height).toBe(last.baseline + fonts.get('sans-400-normal')!.descent(10));
  });
  it('uses the effective underline face and the full underline thickness', () => {
    const { template, content } = fixture([{ text: 'x', bold: true, italic: true, underline: true }], {}, { x: 20, y: 20, width: 350, height: 9 });
    const before = layoutDocument(template, content, fonts), baseline = before.regions[0].lines[0].baseline;
    const face = fonts.get('sans-700-italic')!, result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(result.template.pages[0].regions[0].bounds.y + result.template.pages[0].regions[0].bounds.height).toBeGreaterThanOrEqual(baseline + face.underlineOffset(10) + face.underlineThickness(10) / 2);
    expect(lineProjection(result.layout)).toEqual(lineProjection(before));
  });
  it('preserves an already sufficient logical box without a spurious expansion', () => {
    const { template, content } = fixture([{ text: 'Plain text' }], { lineHeight: 14 }, { x: 20, y: 20.1, width: 350, height: 14 });
    const result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(result.expandedRegions).toBe(0);
    expect(result.template.pages[0].regions[0].bounds).toEqual(template.pages[0].regions[0].bounds);
    expect(lineProjection(result.layout)).toEqual(lineProjection(layoutDocument(template, content, fonts)));
  });
  it('unions top overshoot without moving the first absolute baseline or any following line', () => {
    const { template, content } = fixture([{ text: 'Ég\nÉg' }], { lineHeight: 9 }, { x: 20, y: 20.1, width: 350, height: 18 });
    const before = layoutDocument(template, content, fonts), result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(result.template.pages[0].regions[0].bounds.y).toBeLessThan(template.pages[0].regions[0].bounds.y);
    expect(lineProjection(result.layout)).toEqual(lineProjection(before));
    expect(nonHeightCodes(result.layout)).toEqual(nonHeightCodes(before));
  });
  it('refuses nonfinite ink measurement rather than applying padding or silently fitting it', () => {
    const { template, content } = fixture([{ text: 'Owned text' }]);
    const face = fonts.get('sans-400-normal')!, original = face.measure.bind(face);
    face.measure = (text, size) => ({ ...original(text, size), top: NaN });
    try { expect(() => normalizeDocxInkEnvelope(template, content, fonts)).toThrow(expect.objectContaining({ code: 'DOCX_INK_MEASUREMENT' })); }
    finally { face.measure = original; }
  });
});

describe('unchanged actual import flow, artwork and fixed edit bounds', () => {
  it('keeps before/after spacing and logical paragraph advance despite larger initial boxes', async () => {
    const body = paragraph('gypq', '<w:spacing w:before="120" w:after="80" w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>')
      + paragraph('gypq', '<w:spacing w:before="40" w:after="160" w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>');
    const result = await word(body), boxes = result.template.pages[0].regions.filter(r => r.kind === 'text');
    expect(boxes[0].bounds.y).toBe(78); expect(boxes[1].bounds.y).toBe(95);
    expect(boxes[0].bounds.height).toBeGreaterThan(11);
    expect(lineProjection(layoutDocument(result.template, result.baseline, fonts))).toEqual(lineProjection(layoutDocument(logicalTemplate(result), result.baseline, fonts)));
    const observation = result.template.warnings.find(w => w.code === 'DOCX_INK_ENVELOPE')!;
    expect(observation).toMatchObject({ severity: 'review', message: expect.stringContaining('Approved bounds stay fixed for future edits') });
    await expect(approveTemplate(makeProject(result), result.template.warnings.filter(w => w.id !== observation.id).map(w => w.id))).rejects.toMatchObject({ code: 'REVIEW_WARNINGS' });
    const approved = confirmDraft(await approveTemplate(makeProject(result), result.template.warnings.map(w => w.id)));
    const original = structuredClone(approved.template), render = await renderDocument(approved.template, approved.draft, approved.assets);
    await expect(validateExport(approved, render)).resolves.toBeUndefined();
    const edited = confirmDraft(editBlock(approved, approved.draft.blocks[0].id, [{ text: 'gypq\ngypq\ngypq' }]));
    const overflow = await renderDocument(edited.template, edited.draft, edited.assets);
    expect(edited.template).toEqual(original);
    expect(overflow.layout.overflows.some(issue => issue.code === 'height')).toBe(true);
    await expect(validateExport(edited, overflow)).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
  });
  it('preserves table cell, image, rule, header/footer placement and existing flow origin', async () => {
    const picture = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="127000" cy="127000"/><wp:docPr id="1" name="Owned image"/><a:graphic><a:graphicData><a:blip r:embed="image"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
    const table = `<w:tbl><w:tblGrid><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="F1F5F9"/></w:tcPr>${paragraph('gypq', '<w:spacing w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>')}</w:tc></w:tr></w:tbl>`;
    const rule = paragraph('gypq', '<w:spacing w:line="220" w:lineRule="exact"/><w:pBdr><w:bottom w:val="single" w:sz="8"/></w:pBdr>', '<w:sz w:val="20"/>');
    const result = await word(table + picture + rule, {
      relationships: '<Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/owned.png"/><Relationship Id="header" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="footer" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      section: '<w:headerReference w:type="default" r:id="header"/><w:footerReference w:type="default" r:id="footer"/>',
      parts: { 'word/media/owned.png': new Uint8Array(Buffer.from(png, 'base64')), 'word/header1.xml': `<w:hdr xmlns:w="${W}">${paragraph('gypq')}</w:hdr>`, 'word/footer1.xml': `<w:ftr xmlns:w="${W}">${paragraph('gypq')}</w:ftr>` },
    });
    const regions = result.template.pages[0].regions;
    expect(regions.find(r => r.kind === 'rectangle')?.bounds).toEqual({ x: 72, y: 72, width: 200, height: 19 });
    expect(regions.find(r => r.kind === 'image')?.bounds).toEqual({ x: 72, y: 104.2, width: 10, height: 10 });
    expect(regions.find(r => r.kind === 'rule')?.bounds).toEqual({ x: 72, y: 125.2, width: 468, height: 0 });
    const text = regions.filter(r => r.kind === 'text');
    expect(text.find(r => r.sourceLocator?.startsWith('word/header1.xml'))?.bounds.y).toBe(36);
    expect(text.find(r => r.sourceLocator?.startsWith('word/footer1.xml'))?.bounds.y).toBe(742.8);
    const logical = logicalTemplate(result);
    expect(lineProjection(layoutDocument(result.template, result.baseline, fonts))).toEqual(lineProjection(layoutDocument(logical, result.baseline, fonts)));
    for (const r of regions.filter(r => r.kind !== 'text')) expect(logical.pages[0].regions.find(l => l.id === r.id)).toEqual(r);
  });
  it('retains explicit page-break choices and line positions on both pages', async () => {
    const result = await word(paragraph('gypq', '<w:spacing w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + paragraph('gypq', '<w:spacing w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>'));
    expect(result.template.pages).toHaveLength(2);
    expect(result.template.pages.map(p => p.regions[0].bounds.y)).toEqual([72, 72]);
    expect(lineProjection(layoutDocument(result.template, result.baseline, fonts))).toEqual(lineProjection(layoutDocument(logicalTemplate(result), result.baseline, fonts)));
  });
});

describe('actual overflow and import blocker controls', () => {
  it.each([
    ['long-word width', [{ text: 'W'.repeat(300) }], {}, { x: 20, y: 20, width: 100, height: 11 }, 'width'],
    ['unsupported glyph', [{ text: '\u{10ffff}' }], {}, { x: 20, y: 20, width: 100, height: 11 }, 'glyph'],
    ['internal line collision', [{ text: 'Ég\nÉg' }], { lineHeight: 9 }, { x: 20, y: 20, width: 100, height: 18 }, 'collision'],
    ['ink past page', [{ text: 'gypq' }], {}, { x: 20, y: 782, width: 100, height: 10 }, 'page'],
  ] satisfies [string, TextRun[], Partial<TextStyle>, { x: number; y: number; width: number; height: number }, string][])('retains %s', (_name, runs, overrides, bounds, code) => {
    const { template, content } = fixture(runs, overrides, bounds), before = layoutDocument(template, content, fonts);
    expect(before.overflows.some(issue => issue.code === code)).toBe(true);
    const normalized = normalizeDocxInkEnvelope(template, content, fonts);
    expect(normalized.layout.overflows.some(issue => issue.code === code)).toBe(true);
    expect(lineProjection(normalized.layout)).toEqual(lineProjection(before));
  });
  it('retains real text/artwork collisions regardless of enlarged selection bounds', () => {
    const { template, content } = fixture([{ text: 'gypq' }]);
    template.pages[0].regions.push({ kind: 'rule', id: 'reserved-rule', pageId: 'page', order: 1, bounds: { x: 20, y: 28, width: 200, height: 0 }, color: '#000000', thickness: 2 });
    const before = layoutDocument(template, content, fonts), result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(before.overflows.some(issue => issue.code === 'collision')).toBe(true);
    expect(nonHeightCodes(result.layout)).toEqual(nonHeightCodes(before));
    expect(result.template.pages[0].regions[1]).toEqual(template.pages[0].regions[1]);
  });
  it('retains tight line-height warnings and actual approval blocks', async () => {
    const result = await word('<w:p>' + pr('<w:spacing w:line="180" w:lineRule="exact"/>') + '<w:r>' + rr('<w:sz w:val="20"/>') + '<w:t>Ég</w:t><w:br/><w:t>Ég</w:t></w:r></w:p>');
    expect(result.template.warnings.some(w => w.code === 'DOCX_TIGHT_LINE_HEIGHT' && w.severity === 'blocking')).toBe(true);
    expect(layoutDocument(result.template, result.baseline, fonts).overflows.some(issue => issue.code === 'collision')).toBe(true);
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('retains visible inherited decoration, VML and oversized-table blockers', async () => {
    const body = '<w:tbl><w:tblGrid><w:gridCol w:w="11927"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:rPr><w:rtl w:val="true"/></w:rPr><w:t>Owned text</w:t><w:pict/></w:r></w:p></w:tc></w:tr></w:tbl>';
    const result = await word(body);
    expect(result.template.warnings.map(w => w.code)).toEqual(expect.arrayContaining(['DOCX_RUN_DECORATION', 'DOCX_UNSUPPORTED_OBJECT', 'DOCX_COMPLEX_TABLE']));
    await expect(approveTemplate(makeProject(result), result.template.warnings.map(w => w.id))).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
});

/*
Portable admitted native DOCX fixture, upstream layout / wholly fictional body derivative.
Original layout: github.com/jobhire-ai/jobhireai-resume-templates, revision b0179977dc469a81552a7431db056dde17063390.
Every body paragraph was replaced with owned fictional content; unused raster icons are owned derivative assets.
Exact admitted bytes: 22567; SHA-256 0ad970c0b28f7cf66ed8e12ccde437691f4e637096ed869c8c4e50b582dd0d01.
The private raw original is excluded. This fixture does not claim native Word fidelity.

MIT License

Copyright (c) 2025 JobHire AI

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
const harvardBytesBase64 =
  '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';
const frozenHarvard = {"template":{"id":"b560a5c8-d9de-441c-93e2-8edb4ebd36bf","revision":1,"pages":[{"id":"page:0","width":612,"height":792,"regions":[{"id":"region:0:0","pageId":"page:0","bounds":{"x":36,"y":36,"width":540,"height":17.6},"order":0,"kind":"text","contentId":"content:0","role":"heading","style":{"fontFamily":"sans","fontSize":16,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":17.6,"alignment":"left"},"sourceLocator":"word/document.xml/p[1]"},{"id":"region:0:1","pageId":"page:0","bounds":{"x":36,"y":53.6,"width":540,"height":11},"order":1,"kind":"text","contentId":"content:1","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[2]"},{"id":"region:0:2","pageId":"page:0","bounds":{"x":36,"y":75.6,"width":540,"height":15.400000000000002},"order":2,"kind":"text","contentId":"content:2","role":"body","style":{"fontFamily":"sans","fontSize":14,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":15.400000000000002,"alignment":"left"},"sourceLocator":"word/document.xml/p[4]"},{"id":"region:0:3","pageId":"page:0","bounds":{"x":36,"y":91,"width":540,"height":11},"order":3,"kind":"text","contentId":"content:3","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[5]"},{"id":"region:0:4","pageId":"page:0","bounds":{"x":36,"y":102,"width":540,"height":22},"order":4,"kind":"text","contentId":"content:4","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[6]"},{"id":"region:0:5","pageId":"page:0","bounds":{"x":36,"y":124,"width":540,"height":11},"order":5,"kind":"text","contentId":"content:5","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[7]"},{"id":"region:0:6","pageId":"page:0","bounds":{"x":36,"y":146,"width":540,"height":22},"order":6,"kind":"text","contentId":"content:6","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[9]"},{"id":"region:0:7","pageId":"page:0","bounds":{"x":36,"y":168,"width":540,"height":22},"order":7,"kind":"text","contentId":"content:7","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[10]"},{"id":"region:0:8","pageId":"page:0","bounds":{"x":36,"y":201,"width":540,"height":22},"order":8,"kind":"text","contentId":"content:8","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[12]"},{"id":"region:0:9","pageId":"page:0","bounds":{"x":36,"y":223,"width":540,"height":22},"order":9,"kind":"text","contentId":"content:9","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[13]"},{"id":"region:0:10","pageId":"page:0","bounds":{"x":36,"y":256,"width":540,"height":15.400000000000002},"order":10,"kind":"text","contentId":"content:10","role":"body","style":{"fontFamily":"sans","fontSize":14,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":15.400000000000002,"alignment":"left"},"sourceLocator":"word/document.xml/p[15]"},{"id":"region:0:11","pageId":"page:0","bounds":{"x":36,"y":271.4,"width":540,"height":22},"order":11,"kind":"text","contentId":"content:11","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[16]"},{"id":"region:0:12","pageId":"page:0","bounds":{"x":36,"y":293.4,"width":540,"height":22},"order":12,"kind":"text","contentId":"content:12","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[17]"},{"id":"region:0:13","pageId":"page:0","bounds":{"x":36,"y":326.4,"width":540,"height":11},"order":13,"kind":"text","contentId":"content:13","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[19]"},{"id":"region:0:14","pageId":"page:0","bounds":{"x":36,"y":337.4,"width":540,"height":11},"order":14,"kind":"text","contentId":"content:14","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[20]"},{"id":"region:0:15","pageId":"page:0","bounds":{"x":36,"y":348.4,"width":540,"height":11},"order":15,"kind":"text","contentId":"content:15","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[21]"},{"id":"region:0:16","pageId":"page:0","bounds":{"x":36,"y":359.4,"width":540,"height":11},"order":16,"kind":"text","contentId":"content:16","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[22]"},{"id":"region:0:17","pageId":"page:0","bounds":{"x":36,"y":381.4,"width":540,"height":11},"order":17,"kind":"text","contentId":"content:17","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[24]"},{"id":"region:0:18","pageId":"page:0","bounds":{"x":36,"y":392.4,"width":540,"height":22},"order":18,"kind":"text","contentId":"content:18","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[25]"},{"id":"region:0:19","pageId":"page:0","bounds":{"x":36,"y":414.4,"width":540,"height":11},"order":19,"kind":"text","contentId":"content:19","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[26]"},{"id":"region:0:20","pageId":"page:0","bounds":{"x":36,"y":425.4,"width":540,"height":11},"order":20,"kind":"text","contentId":"content:20","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[27]"},{"id":"region:0:21","pageId":"page:0","bounds":{"x":36,"y":436.4,"width":540,"height":11},"order":21,"kind":"text","contentId":"content:21","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[28]"},{"id":"region:0:22","pageId":"page:0","bounds":{"x":36,"y":469.4,"width":540,"height":15.400000000000002},"order":22,"kind":"text","contentId":"content:22","role":"body","style":{"fontFamily":"sans","fontSize":14,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":15.400000000000002,"alignment":"left"},"sourceLocator":"word/document.xml/p[31]"},{"id":"region:0:23","pageId":"page:0","bounds":{"x":36,"y":484.79999999999995,"width":540,"height":11},"order":23,"kind":"text","contentId":"content:23","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[32]"},{"id":"region:0:24","pageId":"page:0","bounds":{"x":36,"y":495.79999999999995,"width":540,"height":22},"order":24,"kind":"text","contentId":"content:24","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[33]"},{"id":"region:0:25","pageId":"page:0","bounds":{"x":36,"y":517.8,"width":540,"height":11},"order":25,"kind":"text","contentId":"content:25","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[34]"},{"id":"region:0:26","pageId":"page:0","bounds":{"x":36,"y":528.8,"width":540,"height":11},"order":26,"kind":"text","contentId":"content:26","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[35]"},{"id":"region:0:27","pageId":"page:0","bounds":{"x":36,"y":550.8,"width":540,"height":15.400000000000002},"order":27,"kind":"text","contentId":"content:27","role":"body","style":{"fontFamily":"sans","fontSize":14,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":15.400000000000002,"alignment":"left"},"sourceLocator":"word/document.xml/p[37]"},{"id":"region:0:28","pageId":"page:0","bounds":{"x":36,"y":577.1999999999999,"width":540,"height":11},"order":28,"kind":"text","contentId":"content:28","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[39]"},{"id":"region:0:29","pageId":"page:0","bounds":{"x":36,"y":588.1999999999999,"width":540,"height":11},"order":29,"kind":"text","contentId":"content:29","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[40]"},{"id":"region:0:30","pageId":"page:0","bounds":{"x":36,"y":599.1999999999999,"width":540,"height":11},"order":30,"kind":"text","contentId":"content:30","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[41]"},{"id":"region:0:31","pageId":"page:0","bounds":{"x":36,"y":610.1999999999999,"width":540,"height":11},"order":31,"kind":"text","contentId":"content:31","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[42]"},{"id":"region:0:32","pageId":"page:0","bounds":{"x":36,"y":632.1999999999999,"width":540,"height":11},"order":32,"kind":"text","contentId":"content:32","role":"body","style":{"fontFamily":"sans","fontSize":10,"fontWeight":400,"italic":false,"color":"#043D68","lineHeight":11,"alignment":"left"},"sourceLocator":"word/document.xml/p[44]"}]}],"importerVersion":"folio-import-v2","warnings":[]},"baseline":{"revision":1,"blocks":[{"id":"content:0","runs":[{"text":"AVERY","sourceFactIds":["fact:0"]},{"text":" ","sourceFactIds":["fact:0"]},{"text":"MORGAN QU","sourceFactIds":["fact:0"]},{"text":"I","sourceFactIds":["fact:0"]},{"text":"NN  ","sourceFactIds":["fact:0"]}],"sourceFactIds":["fact:0"]},{"id":"content:1","runs":[{"text":"quinn@example.test | Fictional City |           ","sourceFactIds":["fact:1"]}],"sourceFactIds":["fact:1"]},{"id":"content:2","runs":[{"text":"EDUCATION","sourceFactIds":["fact:2"]}],"sourceFactIds":["fact:2"]},{"id":"content:3","runs":[{"text":"Fictional State University | ","sourceFactIds":["fact:3"]}],"sourceFactIds":["fact:3"]},{"id":"content:4","runs":[{"text":"Bachelor of Design, 2","sourceFactIds":["fact:4"]},{"text":"020\u20132024. St","sourceFactIds":["fact:4"]},{"text":"udied interaction design and accessible digital services at ","sourceFactIds":["fact:4"]},{"text":"a whol","sourceFactIds":["fact:4"]},{"text":"ly fictional university for this       ","sourceFactIds":["fact:4"]}],"sourceFactIds":["fact:4"]},{"id":"content:5","runs":[{"text":"Relevant study: accessible interfaces, usability methods, typography,   ","sourceFactIds":["fact:5"]}],"sourceFactIds":["fact:5"]},{"id":"content:6","runs":[{"text":"Fictional Example","sourceFactIds":["fact:6"]},{"text":" College | Exa","sourceFactIds":["fact:6"]},{"text":"mple District. Completed a design foundation focused on clear communication, collaborative practice and responsible research.      ","sourceFactIds":["fact:6"]}],"sourceFactIds":["fact:6"]},{"id":"content:7","runs":[{"text":"Built a classroom prototype ","sourceFactIds":["fact:7"]},{"text":"for an im","sourceFactIds":["fact:7"]},{"text":"aginary library service. Documented task flows and tested keyboard access with wholly fiction","sourceFactIds":["fact:7"]},{"text":"al","sourceFactIds":["fact:7"]},{"text":" scenarios and users.  ","sourceFactIds":["fact:7"]}],"sourceFactIds":["fact:7"]},{"id":"content:8","runs":[{"text":"Created sample research notes for a fictional scheduling tool. Compared interaction choices, recorded constraints and shared a plain-language design rationale.           ","sourceFactIds":["fact:8"]}],"sourceFactIds":["fact:8"]},{"id":"content:9","runs":[{"text":"Prepared a fictional capstone demonstr","sourceFactIds":["fact:9"]},{"text":"ation using ","sourceFactIds":["fact:9"]},{"text":"owned sample data. Practised critique, revised the interface and explaine","sourceFactIds":["fact:9"]},{"text":"d t","sourceFactIds":["fact:9"]},{"text":"he limits of   ","sourceFactIds":["fact:9"]}],"sourceFactIds":["fact:9"]},{"id":"content:10","runs":[{"text":"EXPERIENCE","sourceFactIds":["fact:10"]}],"sourceFactIds":["fact:10"]},{"id":"content:11","runs":[{"text":"Cedar Example Studio | Fictional Product Designer | 2024\u20132025. Planned interface improvements for an imaginary service with wholly fictional collaborators.","sourceFactIds":["fact:11"]}],"sourceFactIds":["fact:11"]},{"id":"content:12","runs":[{"text":"Designed an owned component demonstration for a fictional appointment portal. Reviewed navigation and reusable patterns without claiming a real employment history.       ","sourceFactIds":["fact:12"]}],"sourceFactIds":["fact:12"]},{"id":"content:13","runs":[{"text":"Product Designer | Cedar Example Studio","sourceFactIds":["fact:13"]}],"sourceFactIds":["fact:13"]},{"id":"content:14","runs":[{"text":"Fictional role dates: January 2024\u2013December 2025.          ","sourceFactIds":["fact:14"]}],"sourceFactIds":["fact:14"]},{"id":"content:15","runs":[{"text":"Prepared an imaginary interface review with clear source notes.  ","sourceFactIds":["fact:15"]}],"sourceFactIds":["fact:15"]},{"id":"content:16","runs":[{"text":"Created fictional prototypes for keyboard navigation      ","sourceFactIds":["fact:16"]}],"sourceFactIds":["fact:16"]},{"id":"content:17","runs":[{"text":"Shared example design decisions with a wholly fictional team.                                                                                                         ","sourceFactIds":["fact:17"]}],"sourceFactIds":["fact:17"]},{"id":"content:18","runs":[{"text":"Compared sample interface patterns for a fictional municipal service. Recorded constraints and tradeoffs, then explained why the next prototype needed applicant    ","sourceFactIds":["fact:18"]}],"sourceFactIds":["fact:18"]},{"id":"content:19","runs":[{"text":"                                                                                                                                                  ","sourceFactIds":["fact:19"]}],"sourceFactIds":["fact:19"]},{"id":"content:20","runs":[{"text":"Designed an imaginary onboarding flow using     ","sourceFactIds":["fact:20"]}],"sourceFactIds":["fact:20"]},{"id":"content:21","runs":[{"text":"Fictional volunteer work | Example Community Lab        ","sourceFactIds":["fact:21"]}],"sourceFactIds":["fact:21"]},{"id":"content:22","runs":[{"text":"Supported an imaginary ","sourceFactIds":["fact:22"]}],"sourceFactIds":["fact:22"]},{"id":"content:23","runs":[{"text":"ADDITIONAL INFORMATION                                                                                                                                                      ","sourceFactIds":["fact:23"]}],"sourceFactIds":["fact:23"]},{"id":"content:24","runs":[{"text":"Tools practised for this fictional record include prototyping, documentation and accessible interface review. This paragraph is benchmark content, not a verified   ","sourceFactIds":["fact:24"]}],"sourceFactIds":["fact:24"]},{"id":"content:25","runs":[{"text":"                                                                                                                                                 ","sourceFactIds":["fact:25"]}],"sourceFactIds":["fact:25"]},{"id":"content:26","runs":[{"text":"Language practice, learning goals and example interests are wholly         ","sourceFactIds":["fact:26"]}],"sourceFactIds":["fact:26"]},{"id":"content:27","runs":[{"text":"Owned sample      ","sourceFactIds":["fact:27"]}],"sourceFactIds":["fact:27"]},{"id":"content:28","runs":[{"text":"PROJECTS AND SKILLS                                                ","sourceFactIds":["fact:28"]}],"sourceFactIds":["fact:28"]},{"id":"content:29","runs":[{"text":"Prepared fictional task notes for an owned demonstration project.          ","sourceFactIds":["fact:29"]}],"sourceFactIds":["fact:29"]},{"id":"content:30","runs":[{"text":"Reviewed example layouts with keyboard       ","sourceFactIds":["fact:30"]}],"sourceFactIds":["fact:30"]},{"id":"content:31","runs":[{"text":"Documented imaginary design revisions and remaining       ","sourceFactIds":["fact:31"]}],"sourceFactIds":["fact:31"]},{"id":"content:32","runs":[{"text":"                                                                                                                                                                                                        ","sourceFactIds":["fact:32"]}],"sourceFactIds":["fact:32"]}]},"facts":[{"id":"fact:0","text":"AVERY MORGAN QUINN  ","kind":"resume","locator":"word/document.xml/p[1]","confirmed":false},{"id":"fact:1","text":"quinn@example.test | Fictional City |           ","kind":"resume","locator":"word/document.xml/p[2]","confirmed":false},{"id":"fact:2","text":"EDUCATION","kind":"resume","locator":"word/document.xml/p[4]","confirmed":false},{"id":"fact:3","text":"Fictional State University | ","kind":"resume","locator":"word/document.xml/p[5]","confirmed":false},{"id":"fact:4","text":"Bachelor of Design, 2020\u20132024. Studied interaction design and accessible digital services at a wholly fictional university for this       ","kind":"resume","locator":"word/document.xml/p[6]","confirmed":false},{"id":"fact:5","text":"Relevant study: accessible interfaces, usability methods, typography,   ","kind":"resume","locator":"word/document.xml/p[7]","confirmed":false},{"id":"fact:6","text":"Fictional Example College | Example District. Completed a design foundation focused on clear communication, collaborative practice and responsible research.      ","kind":"resume","locator":"word/document.xml/p[9]","confirmed":false},{"id":"fact:7","text":"Built a classroom prototype for an imaginary library service. Documented task flows and tested keyboard access with wholly fictional scenarios and users.  ","kind":"resume","locator":"word/document.xml/p[10]","confirmed":false},{"id":"fact:8","text":"Created sample research notes for a fictional scheduling tool. Compared interaction choices, recorded constraints and shared a plain-language design rationale.           ","kind":"resume","locator":"word/document.xml/p[12]","confirmed":false},{"id":"fact:9","text":"Prepared a fictional capstone demonstration using owned sample data. Practised critique, revised the interface and explained the limits of   ","kind":"resume","locator":"word/document.xml/p[13]","confirmed":false},{"id":"fact:10","text":"EXPERIENCE","kind":"resume","locator":"word/document.xml/p[15]","confirmed":false},{"id":"fact:11","text":"Cedar Example Studio | Fictional Product Designer | 2024\u20132025. Planned interface improvements for an imaginary service with wholly fictional collaborators.","kind":"resume","locator":"word/document.xml/p[16]","confirmed":false},{"id":"fact:12","text":"Designed an owned component demonstration for a fictional appointment portal. Reviewed navigation and reusable patterns without claiming a real employment history.       ","kind":"resume","locator":"word/document.xml/p[17]","confirmed":false},{"id":"fact:13","text":"Product Designer | Cedar Example Studio","kind":"resume","locator":"word/document.xml/p[19]","confirmed":false},{"id":"fact:14","text":"Fictional role dates: January 2024\u2013December 2025.          ","kind":"resume","locator":"word/document.xml/p[20]","confirmed":false},{"id":"fact:15","text":"Prepared an imaginary interface review with clear source notes.  ","kind":"resume","locator":"word/document.xml/p[21]","confirmed":false},{"id":"fact:16","text":"Created fictional prototypes for keyboard navigation      ","kind":"resume","locator":"word/document.xml/p[22]","confirmed":false},{"id":"fact:17","text":"Shared example design decisions with a wholly fictional team.                                                                                                         ","kind":"resume","locator":"word/document.xml/p[24]","confirmed":false},{"id":"fact:18","text":"Compared sample interface patterns for a fictional municipal service. Recorded constraints and tradeoffs, then explained why the next prototype needed applicant    ","kind":"resume","locator":"word/document.xml/p[25]","confirmed":false},{"id":"fact:19","text":"                                                                                                                                                  ","kind":"resume","locator":"word/document.xml/p[26]","confirmed":false},{"id":"fact:20","text":"Designed an imaginary onboarding flow using     ","kind":"resume","locator":"word/document.xml/p[27]","confirmed":false},{"id":"fact:21","text":"Fictional volunteer work | Example Community Lab        ","kind":"resume","locator":"word/document.xml/p[28]","confirmed":false},{"id":"fact:22","text":"Supported an imaginary ","kind":"resume","locator":"word/document.xml/p[31]","confirmed":false},{"id":"fact:23","text":"ADDITIONAL INFORMATION                                                                                                                                                      ","kind":"resume","locator":"word/document.xml/p[32]","confirmed":false},{"id":"fact:24","text":"Tools practised for this fictional record include prototyping, documentation and accessible interface review. This paragraph is benchmark content, not a verified   ","kind":"resume","locator":"word/document.xml/p[33]","confirmed":false},{"id":"fact:25","text":"                                                                                                                                                 ","kind":"resume","locator":"word/document.xml/p[34]","confirmed":false},{"id":"fact:26","text":"Language practice, learning goals and example interests are wholly         ","kind":"resume","locator":"word/document.xml/p[35]","confirmed":false},{"id":"fact:27","text":"Owned sample      ","kind":"resume","locator":"word/document.xml/p[37]","confirmed":false},{"id":"fact:28","text":"PROJECTS AND SKILLS                                                ","kind":"resume","locator":"word/document.xml/p[39]","confirmed":false},{"id":"fact:29","text":"Prepared fictional task notes for an owned demonstration project.          ","kind":"resume","locator":"word/document.xml/p[40]","confirmed":false},{"id":"fact:30","text":"Reviewed example layouts with keyboard       ","kind":"resume","locator":"word/document.xml/p[41]","confirmed":false},{"id":"fact:31","text":"Documented imaginary design revisions and remaining       ","kind":"resume","locator":"word/document.xml/p[42]","confirmed":false},{"id":"fact:32","text":"                                                                                                                                                                                                        ","kind":"resume","locator":"word/document.xml/p[44]","confirmed":false}]} as {template: Template; baseline: ContentSnapshot; facts: ImportResult["facts"]};

describe('exact admitted Harvard native DOCX regression', () => {
  it('removes precisely 28 false height issues while preserving exact canonical text, lines, glyph origins and source ownership', async () => {
    const bytes = new Uint8Array(Buffer.from(harvardBytesBase64, 'base64'));
    expect(bytes.byteLength).toBe(22567);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('0ad970c0b28f7cf66ed8e12ccde437691f4e637096ed869c8c4e50b582dd0d01');
    const oldFonts = await prepareFonts(frozenHarvard.template, frozenHarvard.baseline);
    const before = layoutDocument(frozenHarvard.template, frozenHarvard.baseline, oldFonts);
    expect(frozenHarvard.template.pages).toHaveLength(1);
    expect(frozenHarvard.template.pages[0].regions.filter(r => r.kind === 'text')).toHaveLength(33);
    expect(before.overflows).toHaveLength(28);
    expect(before.overflows.every(issue => issue.code === 'height')).toBe(true);
    const result = await importDocx(new File([new Uint8Array(bytes).buffer], 'owned-harvard.docx'), bytes);
    const after = layoutDocument(result.template, result.baseline, fonts);
    expect(after.overflows).toEqual([]);
    expect(result.source.bytes).toEqual(bytes);
    expect(result.source.sha256).toBe('0ad970c0b28f7cf66ed8e12ccde437691f4e637096ed869c8c4e50b582dd0d01');
    expect(result.template.pages.map(p => ({ width: p.width, height: p.height }))).toEqual(frozenHarvard.template.pages.map(p => ({ width: p.width, height: p.height })));
    expect(after.regions.map(r => r.lines)).toEqual(before.regions.map(r => r.lines));
    expect(result.facts.map(({ id: _id, ...fact }) => fact)).toEqual(frozenHarvard.facts.map(({ id: _id, ...fact }) => fact));
    const actualFacts = new Map(result.facts.map((f, i) => [f.id, `fact:${i}`]));
    expect(result.baseline.blocks.map(b => ({ sourceFactIds: b.sourceFactIds.map(id => actualFacts.get(id)), runs: b.runs.map(r => ({ ...r, sourceFactIds: r.sourceFactIds?.map(id => actualFacts.get(id)) })) }))).toEqual(frozenHarvard.baseline.blocks.map(({ id: _id, ...b }) => b));
    const oldRegions = frozenHarvard.template.pages[0].regions;
    for (const [i, region] of result.template.pages[0].regions.entries()) {
      const old = oldRegions[i];
      expect(region.bounds.x).toBe(old.bounds.x); expect(region.bounds.width).toBe(old.bounds.width);
      if (region.kind === 'text' && old.kind === 'text') {
        expect(region.sourceLocator).toBe(old.sourceLocator); expect(region.role).toBe(old.role);
        expect({ ...region.style, baselineOffset: undefined }).toEqual({ ...old.style, baselineOffset: undefined });
        expect(region.bounds.y).toBe(old.bounds.y);
        expect(region.bounds.height).toBeGreaterThanOrEqual(old.bounds.height);
        expect(region.bounds.height - old.bounds.height).toBeLessThanOrEqual(0.3203125);
      }
    }
    expect(result.template.warnings.some(w => w.code === 'DOCX_INK_ENVELOPE' && w.severity === 'review')).toBe(true);
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
    const approved = confirmDraft(await approveTemplate(makeProject(result), result.template.warnings.map(w => w.id)));
    const rendered = await renderDocument(approved.template, approved.draft, approved.assets);
    await expect(validateExport(approved, rendered)).resolves.toBeUndefined();
    expect(rendered.layout.regions.map(r => r.lines)).toEqual(before.regions.map(r => r.lines));
    const snapshot = structuredClone(approved.template);
    const edited = confirmDraft(editBlock(approved, approved.draft.blocks[0].id, [{ text: 'AVERY QUINN', bold: true }]));
    expect(edited.template).toEqual(snapshot);
    const fitting = await renderDocument(edited.template, edited.draft, edited.assets);
    expect(fitting.layout.overflows).toEqual([]);
    await expect(validateExport(edited, fitting)).resolves.toBeUndefined();
  });
});

describe('numeric no-op and ordinary import guard stability', () => {
  it.each([0.1, 1.1, 20.1, 72.1, 1000.1])('avoids arithmetic-only expansion at fractional y=%s', y => {
    const { template, content } = fixture([{ text: 'gypq' }], {}, { x: 20, y, width: 350, height: 20 });
    const before = layoutDocument(template, content, fonts), line = before.regions[0].lines[0];
    const face = fonts.get('sans-400-normal')!, metrics = face.measure('gypq', 10);
    const inkBottom = line.baseline + metrics.top + (metrics.bottom - metrics.top);
    template.pages[0].regions[0].bounds.height = inkBottom - y;
    const result = normalizeDocxInkEnvelope(template, content, fonts);
    expect(result.expandedRegions).toBe(0);
    expect(result.template.pages[0].regions[0].bounds).toEqual(template.pages[0].regions[0].bounds);
    expect(lineProjection(result.layout)).toEqual(lineProjection(layoutDocument(template, content, fonts)));
  });
  it('does not disclose normalization when the original logical box already contains mapped-font ink', async () => {
    const result = await word(paragraph('Owned ordinary text', '<w:spacing w:line="280" w:lineRule="exact"/>', '<w:sz w:val="20"/>'));
    expect(result.template.warnings.some(w => w.code === 'DOCX_INK_ENVELOPE')).toBe(false);
  });
  it('preserves automatic pagination using logical paragraph advance', async () => {
    const result = await word(Array.from({ length: 60 }, () => paragraph('gypq', '<w:spacing w:line="220" w:lineRule="exact"/>', '<w:sz w:val="20"/>')).join(''));
    expect(result.template.pages.map(page => page.regions.filter(r => r.kind === 'text').length)).toEqual([58, 2]);
    expect(result.template.pages.map(page => page.regions[0].bounds.y)).toEqual([72, 72]);
    expect(lineProjection(layoutDocument(result.template, result.baseline, fonts))).toEqual(lineProjection(layoutDocument(logicalTemplate(result), result.baseline, fonts)));
  });
  it.each([['width', 'W'.repeat(300)], ['glyph', '\u{10ffff}']])('retains actual current-PDF export blocking for %s', async (code, text) => {
    const result = await word(paragraph(text));
    const approved = confirmDraft(await approveTemplate(makeProject(result), result.template.warnings.map(w => w.id)));
    const rendered = await renderDocument(approved.template, approved.draft, approved.assets);
    expect(rendered.layout.overflows.some(issue => issue.code === code)).toBe(true);
    await expect(validateExport(approved, rendered)).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
  });
});

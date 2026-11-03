// @vitest-environment node
import {MAX_SOURCE_PAGES} from '../core/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import PDFKit from 'pdfkit';
import { PDFDocument, StandardFonts, PDFName, PDFString, rgb } from 'pdf-lib';
import { importResume } from './index';
import { IMPORTER_VERSION } from './common';
import { contentText, MAX_SOURCE_BYTES } from '../core/model';
import { readBoundedArchive } from './zip';
import { sanitizedDocxBytes } from './docxReference';
import { setFontLoader } from '../layout/fonts';
import { sourceGlyphs, sourceGlyphText } from '../core/source-graph';

let restoreFonts: () => void;
beforeAll(async () => {
  restoreFonts = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  const window = new JSDOM('').window;
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, DOMMatrix, ImageData, Path2D });
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  await import('./pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(() => restoreFonts());
const asFile = (name: string, bytes: Uint8Array | string, type = '') => new File([typeof bytes === 'string' ? bytes : new Uint8Array(bytes).buffer], name, { type });
const fixture = async (name: string) => asFile(name, new Uint8Array(await readFile(resolve('public/fixtures', name))));
async function minimalDocx(body: string, relationships = '', prefix = 'w'): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<${prefix}:document xmlns:${prefix}="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><${prefix}:body>${body}<${prefix}:sectPr><${prefix}:pgSz ${prefix}:w="12240" ${prefix}:h="15840"/><${prefix}:pgMar ${prefix}:top="1440" ${prefix}:bottom="1440" ${prefix}:left="1440" ${prefix}:right="1440"/></${prefix}:sectPr></${prefix}:body></${prefix}:document>`);
  if (relationships) zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
async function simplePdf(pages = 1, text = 'Fictional selectable resume'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) { const page = pdf.addPage([612, 792]); if (text) page.drawText(text, { x: 72, y: 700, font, size: 11 }); }
  return pdf.save();
}

describe('resume import containment', () => {
  it('rejects empty, oversized, unsupported, MIME and signature mismatch files with useful codes', async () => {
    await expect(importResume(asFile('empty.pdf', ''))).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(importResume(asFile('large.pdf', new Uint8Array(MAX_SOURCE_BYTES + 1)))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(importResume(asFile('legacy.doc', 'not supported'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    await expect(importResume(asFile('pretend.pdf', 'PK\x03\x04garbage'))).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(importResume(asFile('pretend.docx', '%PDF-1.7 garbage'))).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(importResume(asFile('wrong.pdf', '%PDF-1.7 garbage', 'text/html'))).rejects.toMatchObject({ code: 'MIME_MISMATCH' });
  });
  it('rejects corrupt PDF and ZIP data without altering another import result', async () => {
    const existing = await importResume(asFile('existing.docx', await minimalDocx('<w:p><w:r><w:t>Existing fictional facts</w:t></w:r></w:p>')));
    const snapshot = structuredClone(existing);
    await expect(importResume(asFile('corrupt.pdf', '%PDF-1.7\ninvalid'))).rejects.toMatchObject({ code: 'CORRUPT_PDF' });
    await expect(importResume(asFile('corrupt.docx', 'PK\x03\x04broken'))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
    expect(existing).toEqual(snapshot);
  });
  it('rejects textless and over-cap PDFs, and textless DOCX', async () => {
    await expect(importResume(asFile('scan.pdf', await simplePdf(1, '')))).rejects.toMatchObject({ code: 'TEXTLESS' });
    await expect(importResume(asFile('over-cap.pdf', await simplePdf(MAX_SOURCE_PAGES + 1)))).rejects.toMatchObject({ code: 'PAGE_LIMIT' });
    await expect(importResume(asFile('empty.docx', await minimalDocx('<w:p/>')))).rejects.toMatchObject({ code: 'TEXTLESS' });
  });
  it('reads generic bounded project archives without requiring DOCX parts', async () => {
    const zip = new JSZip(); zip.file('project.json', '{"fictional":true}'); zip.file('assets/example.bin', new Uint8Array([1, 2, 3]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const parts = await readBoundedArchive(bytes, 20 * 1024 * 1024);
    expect(new TextDecoder().decode(parts.get('project.json'))).toBe('{"fictional":true}');
    expect(parts.get('assets/example.bin')).toEqual(new Uint8Array([1, 2, 3]));
    await expect(readBoundedArchive(bytes, bytes.length - 1)).rejects.toMatchObject({ code: 'ARCHIVE_LIMIT' });
    await expect(importResume(asFile('not-word.docx', bytes))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
  });
  it('rejects XML external entities and archive traversal before interpreting text', async () => {
    const bytes = await minimalDocx('<w:p><w:r><w:t>Fictional</w:t></w:r></w:p>');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('word/document.xml', '<!DOCTYPE a [<!ENTITY e SYSTEM "https://invalid.example/secret">]><a/>');
    await expect(importResume(asFile('entity.docx', await zip.generateAsync({ type: 'uint8array' })))).rejects.toMatchObject({ code: 'UNSAFE_XML' });
    zip.file('../escape.xml', '<x/>');
    await expect(importResume(asFile('traversal.docx', await zip.generateAsync({ type: 'uint8array' })))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
  });
  it('bounds central-directory declared and actual inflated sizes and verifies CRC', async () => {
    const bytes = await minimalDocx('<w:p><w:r><w:t>Fictional bounded archive</w:t></w:r></w:p>');
    const bad = new Uint8Array(bytes), view = new DataView(bad.buffer);
    const central = bad.findIndex((_, i) => bad[i] === 0x50 && bad[i + 1] === 0x4b && bad[i + 2] === 1 && bad[i + 3] === 2);
    view.setUint32(central + 24, 60 * 1024 * 1024, true);
    await expect(importResume(asFile('bomb.docx', bad))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
    const badCrc = new Uint8Array(bytes); new DataView(badCrc.buffer).setUint32(central + 16, 0, true);
    await expect(importResume(asFile('bad-crc.docx', badCrc))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
    const badSize = new Uint8Array(bytes); new DataView(badSize.buffer).setUint32(central + 24, 1, true);
    await expect(importResume(asFile('bad-size.docx', badSize))).rejects.toMatchObject({ code: 'DOCX_ARCHIVE' });
  });
  it('rejects encrypted PDFs including documents with an empty user password', async () => {
    for (const userPassword of ['fictional-password', '']) {
      const bytes = await new Promise<Uint8Array>((resolve, reject) => {
        const pdf = new PDFKit({ userPassword, ownerPassword: 'fictional-owner', size: 'LETTER' });
        const chunks: Buffer[] = []; pdf.on('data', chunk => chunks.push(chunk)); pdf.on('error', reject);
        pdf.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks)))); pdf.text('Fictional encrypted resume'); pdf.end();
      });
      await expect(importResume(asFile('encrypted.pdf', bytes))).rejects.toMatchObject({ code: 'ENCRYPTED_DOCUMENT' });
    }
  });
  it('rejects ZIP encryption and active Word objects', async () => {
    const bytes = await minimalDocx('<w:p><w:r><w:t>Fictional</w:t></w:r></w:p>'), encrypted = new Uint8Array(bytes), view = new DataView(encrypted.buffer);
    view.setUint16(6, view.getUint16(6, true) | 1, true);
    const central = encrypted.findIndex((_, i) => encrypted[i] === 80 && encrypted[i + 1] === 75 && encrypted[i + 2] === 1 && encrypted[i + 3] === 2);
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    await expect(importResume(asFile('encrypted.docx', encrypted))).rejects.toMatchObject({ code: 'ENCRYPTED_DOCUMENT' });
    const zip = await JSZip.loadAsync(bytes); zip.file('word/vbaProject.bin', new Uint8Array([1, 2, 3]));
    await expect(importResume(asFile('macro.docx', await zip.generateAsync({ type: 'uint8array' })))).rejects.toMatchObject({ code: 'ACTIVE_CONTENT' });
  });
});

describe('PDF reconstruction', () => {
  it('preserves position-owned TJ word spaces without changing paint color or source anchors', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([612, 792]);
    page.node.set(PDFName.of('Resources'), pdf.context.obj({ Font: { F0: font.ref } }));
    page.node.set(PDFName.of('Contents'), pdf.context.register(pdf.context.flateStream('BT /F0 11 Tf 0.2 0.3 0.4 rg 72 700 Td [(First) -300 (Last) -300 (earned) -300 (a) -300 (Bachelor)] TJ ET')));
    const result = await importResume(asFile('position-spaces.pdf', await pdf.save()));
    expect(contentText(result.baseline)).toBe('First Last earned a Bachelor');
    const region = result.template.pages[0].regions.find(region => region.kind === 'text')!;
    expect(region.kind === 'text' && region.style.color).toBe('#334c66');
    expect(region.bounds.x).toBeCloseTo(72, 6);
    expect(region.kind === 'text' && region.bounds.y + region.style.baselineOffset!).toBeCloseTo(92, 6);
    expect(result.facts[0].text).toBe(contentText(result.baseline));
  });
  it('keeps actual anonymous Jake word boundaries, source bytes, locators, and explicit font fallbacks', async () => {
    const bytes = new Uint8Array(await readFile(resolve('tests/fixtures/jakes-anonymous.pdf')));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('92d3a2464f1f01247f97e8b391a282e7e059d6f7086071cb823748d2a7c1a276');
    const result = await importResume(asFile('jakes-anonymous.pdf', bytes));
    expect(result.source.bytes).toEqual(bytes);
    const text = contentText(result.baseline);
    for (const phrase of ['First Last', '123 Street Name, Town, State 12345', 'Bachelor of Science in Computer Science', 'Technical Skills', 'Relevant Coursework']) expect(text).toContain(phrase);
    expect(text).not.toContain('BachelorofScienceinComputerScience');
    const name = result.template.pages[0].regions.find(region => region.kind === 'text' && result.baseline.blocks.find(block => block.id === region.contentId)?.runs.map(run => run.text).join('') === 'First Last')!;
    expect(name.bounds.x).toBeCloseTo(238.849, 3);
    expect(name.kind === 'text' && name.sourceLocator).toMatch(/^pdf\/page\[1\]\/items\[/);
    const mappings = result.template.warnings.filter(w => w.code === 'FONT_SUBSTITUTION');
    expect(mappings.length).toBeGreaterThan(5);
    expect(new Set(mappings.map(w => `${w.pageId}/${w.fontMapping!.sourceResource}/${w.fontMapping!.targetFace}`)).size).toBe(mappings.length);
    expect(mappings.every(w => w.fontMapping?.sourceStyle === 'unknown' && w.message.includes(w.fontMapping.targetFace) && w.message.includes('regular 400'))).toBe(true);
    expect(mappings.some(w => w.fontMapping?.sourceName?.endsWith('CMTI10'))).toBe(true);
    expect(result.template.importerVersion).toBe(IMPORTER_VERSION);
  });
  it('imports independent PDFKit fixtures with source geometry, baselines, facts, rules, colors and links', async () => {
    const file = await fixture('fictional-resume.pdf'), expected = new Uint8Array(await file.arrayBuffer());
    const imported = await importResume(file);
    expect(imported.source.bytes).toEqual(expected);
    expect(imported.source.bytes.byteLength).toBe(file.size);
    expect(imported.source.sha256).toBe(createHash('sha256').update(expected).digest('hex'));
    expect(imported.source.sourcePageCount).toBe(1);
    expect(imported.template.pages[0]).toMatchObject({ width: 612, height: 792 });
    expect(imported.template.pages[0].regions.filter(region => region.kind === 'rule')).toHaveLength(2);
    const textRegions = imported.template.pages[0].regions.filter(region => region.kind === 'text');
    expect(textRegions.every(region => region.style.baselineOffset! > 0 && region.bounds.x >= 0)).toBe(true);
    expect(textRegions.some(region => region.style.color !== '#000000')).toBe(true);
    expect(imported.baseline.blocks.some(block => block.runs.some(run => run.href?.startsWith('https://')))).toBe(true);
    // V8 retains each owned operator fragment's original extractor item index.
    // Several fragments may share one item; their ordered text must reconstruct it.
    expect(imported.template.sourceFonts!.length).toBeGreaterThan(0);
    expect(imported.template.sourceFonts!.every(font => font.sourceVersion === 8)).toBe(true);
    expect(imported.facts).toHaveLength(textRegions.length);
    expect(imported.baseline.blocks).toHaveLength(textRegions.length);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loading = pdfjs.getDocument({ data: expected.slice(), disableFontFace: true });
    const original = await loading.promise;
    try {
      const sourcePage = await original.getPage(1);
      const items = (await sourcePage.getTextContent()).items;
      const operators = await sourcePage.getOperatorList();
      const perOperator = new Map<number, Array<{ unicode: string; originalCharCode: number | undefined; width: number; resource: string }>>();
      const perItem = new Map<number, string[]>();
      for (const region of textRegions) {
        const block = imported.baseline.blocks.find(value => value.id === region.contentId)!;
        expect(block).toBeDefined();
        expect(block.sourceFactIds).toHaveLength(1);
        const fact = imported.facts.find(value => value.id === block.sourceFactIds[0])!;
        expect(fact).toBeDefined();
        expect(fact).toMatchObject({ kind: 'resume', confirmed: false });
        expect(fact.locator).toMatch(/^pdf\/page\[1\]\/item\[(0|[1-9]\d*)\]$/);
        expect(region.sourceLocator).toBe(fact.locator);
        expect(imported.baseline.blocks.filter(value => value.sourceFactIds.includes(fact.id))).toHaveLength(1);
        expect(block.runs.every(run => run.sourceFactIds?.length === 1 && run.sourceFactIds[0] === fact.id)).toBe(true);
        expect(block.runs.map(run => run.text).join('')).toBe(fact.text);
        expect(region.sourceLayout!.sourceSha256).toBe(imported.source.sha256);
        expect(sourceGlyphText(region)).toBe(fact.text);
        expect(Array.from(sourceGlyphs(region)).every(glyph => imported.template.sourceFonts!.some(font => font.id === glyph.fontId && font.sourceVersion === 8))).toBe(true);
        for (const glyph of sourceGlyphs(region)) {
          expect(glyph.inferredGap).toBeUndefined();
          const font = imported.template.sourceFonts!.find(value => value.id === glyph.fontId)!;
          expect(font.sourceSha256).toBe(imported.source.sha256);
          const mapping = font.glyphMap.find(value => value.cid === glyph.cid)!;
          expect(mapping.unicode).toBe(glyph.unicode);
          perOperator.set(glyph.operatorIndex, [...(perOperator.get(glyph.operatorIndex) ?? []), { unicode: glyph.unicode, originalCharCode: mapping.originalCharCode, width: mapping.pdfWidth, resource: font.sourceResource }]);
        }
        const index = Number(fact.locator.match(/item\[(\d+)\]$/)![1]);
        expect(items[index] && 'str' in items[index]).toBe(true);
        perItem.set(index, [...(perItem.get(index) ?? []), fact.text]);
      }
      expect([...perItem.keys()].sort((a, b) => a - b)).toEqual(items.flatMap((item, index) => 'str' in item && item.str.length > 0 ? [index] : []));
      // Extractor whitespace is normalized; actual blanks are checked without
      // normalization against every independently decoded source show below.
      for (const [index, fragments] of perItem) expect(fragments.join('').replace(/\s+/gu, ' ').trim()).toBe((items[index] as { str: string }).str.replace(/\s+/gu, ' ').trim());
      const showIndexes = operators.fnArray.flatMap((op: number, index: number) => op === pdfjs.OPS.showText ? [index] : []);
      expect([...perOperator.keys()]).toEqual(showIndexes);
      // PDF.js assigns a fresh document prefix on each independent load.
      const resourceSlot = (value: string) => { expect(value).toMatch(/^g_d\d+_f\d+$/); return value.replace(/^g_d\d+_/, ''); };
      let resource = '';
      for (let index = 0; index < operators.fnArray.length; index++) {
        if (operators.fnArray[index] === pdfjs.OPS.setFont) resource = operators.argsArray[index][0];
        if (operators.fnArray[index] !== pdfjs.OPS.showText) continue;
        const glyphs = operators.argsArray[index][0] as Array<number | { unicode: string; originalCharCode: number; width: number }>;
        expect(perOperator.get(index)!.map(glyph => ({ ...glyph, resource: resourceSlot(glyph.resource) }))).toEqual(glyphs.filter((glyph): glyph is Exclude<typeof glyph, number> => typeof glyph !== 'number').map(glyph => ({ unicode: glyph.unicode, originalCharCode: glyph.originalCharCode, width: glyph.width, resource: resourceSlot(resource) })));
      }
    } finally { await loading.destroy(); }
    expect(imported.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
    expect(contentText(imported.baseline)).toContain('CASEY ROWAN');
    // Source operator fragments are separate editable blocks, not new source line breaks.
    const sourceOrderedText = textRegions.map(region => sourceGlyphText(region)).join('');
    expect(sourceOrderedText).toContain('Austin, TX  ·  casey.rowan@example.com  ·  portfolio.example');
    expect(sourceOrderedText).toContain('2021 – Present  |  Fictional employer');
    expect(imported.template.warnings.some(w => w.code === 'PDF_COLOR_UNCERTAINTY')).toBe(false);
    const contact = textRegions.find(region => imported.baseline.blocks.find(block => block.id === region.contentId)?.runs.some(run => run.text.includes('Austin')));
    expect(contact?.style.color).toBe('#52647d');
    const two = await importResume(await fixture('fictional-resume-two-pages.pdf'));
    expect(two.template.pages).toHaveLength(2); expect(two.source.sourcePageCount).toBe(2);
  });
  it('keeps genuine nonembedded Standard14 grouped-item facts bound to source text and content', async () => {
    const wording = 'Wholly fictional catalogue provenance control';
    const bytes = await simplePdf(1, wording);
    const raw = await PDFDocument.load(bytes);
    const resources = raw.getPage(0).node.Resources()!;
    const fonts = resources.lookup(PDFName.of('Font')) as import('pdf-lib').PDFDict;
    expect(fonts.entries()).toHaveLength(1);
    const dictionary = raw.context.lookup(fonts.entries()[0][1]) as import('pdf-lib').PDFDict;
    expect(dictionary.get(PDFName.of('Subtype'))).toEqual(PDFName.of('Type1'));
    expect(dictionary.get(PDFName.of('BaseFont'))).toEqual(PDFName.of('Helvetica'));
    expect(dictionary.has(PDFName.of('FontDescriptor'))).toBe(false);
    const result = await importResume(asFile('authored-standard14-provenance.pdf', bytes));
    expect(result.template.sourceFonts ?? []).toHaveLength(0);
    expect(result.facts).toHaveLength(1);
    expect(result.baseline.blocks).toHaveLength(1);
    const fact = result.facts[0], block = result.baseline.blocks[0];
    expect(fact).toMatchObject({ text: wording, locator: 'pdf/page[1]/items[0]', kind: 'resume', confirmed: false });
    expect(block.sourceFactIds).toEqual([fact.id]);
    expect(block.runs.map(run => run.text).join('')).toBe(wording);
    expect(block.runs.every(run => run.sourceFactIds?.length === 1 && run.sourceFactIds[0] === fact.id)).toBe(true);
    const regions = result.template.pages[0].regions.filter(region => region.kind === 'text');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ contentId: block.id, sourceLocator: fact.locator });
    expect(regions[0].sourceLayout).toBeUndefined();
    expect(result.source.bytes).toEqual(bytes);
  });
  it('retains inert source text and removes unsafe link actions', async () => {
    const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), page = pdf.addPage([612, 792]);
    page.drawText('<script>fictional injection</script>', { x: 72, y: 700, font, size: 11, color: rgb(.2, .3, .4) });
    const annotation = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [70, 698, 350, 714], A: { S: 'URI', URI: PDFString.of('javascript:alert(1)') } });
    page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annotation)]));
    const result = await importResume(asFile('inert.pdf', await pdf.save()));
    expect(contentText(result.baseline)).toBe('<script>fictional injection</script>');
    expect(result.baseline.blocks.flatMap(block => block.runs).every(run => !run.href)).toBe(true);
    expect(result.template.warnings.some(w => w.code === 'UNSAFE_LINK')).toBe(true);
  });
  it('extracts bounded PDF photos and preserves selectable content', async () => {
    const pdf = await PDFDocument.create(), page = pdf.addPage([612, 792]);
    page.drawText('Fictional photo resume', { x: 72, y: 700, size: 11 });
    const png = await readFile(resolve('public/fixtures/fictional-resume-photo.docx'));
    const zip = await JSZip.loadAsync(png), image = zip.file(/word\/media\//).find(file => !file.dir)!;
    page.drawImage(await pdf.embedPng(await image.async('uint8array')), { x: 450, y: 650, width: 50, height: 50 });
    const result = await importResume(asFile('photo.pdf', await pdf.save()));
    expect(contentText(result.baseline)).toContain('Fictional photo resume');
    expect(result.template.warnings.some(w => w.code === 'PDF_IMAGE_OMITTED')).toBe(false);
    expect(result.assets).toHaveLength(1);
    expect(result.template.pages[0].regions.some(r => r.kind === 'image')).toBe(true);
  });
});

describe('constrained DOCX reconstruction and reference', () => {
  it('reads one-/two-page independent OOXML fixtures and keeps source bytes', async () => {
    for (const [name, pages] of [['fictional-resume.docx', 1], ['fictional-resume-two-pages.docx', 2]] as const) {
      const file = await fixture(name), expected = new Uint8Array(await file.arrayBuffer()), result = await importResume(file);
      expect(result.source.bytes).toEqual(expected); expect(result.source.sourcePageCount).toBeNull();
      expect(result.template.pages).toHaveLength(pages);
      expect(result.template.pages.every(page => page.width === 612 && page.height === 792)).toBe(true);
      expect(contentText(result.baseline)).toContain('CASEY ROWAN');
      expect(result.template.warnings.some(w => w.code === 'DOCX_PAGINATION')).toBe(true);
    }
  });
  it('handles arbitrary namespace prefixes, direct run styles, safe links and inert text', async () => {
    const bytes = await minimalDocx('<q:p><q:pPr><q:rPr><q:sz q:val="24"/><q:color q:val="224466"/></q:rPr></q:pPr><q:r><q:rPr><q:b/><q:i/></q:rPr><q:t>&lt;script&gt;fictional&lt;/script&gt;</q:t></q:r><q:hyperlink r:id="safe"><q:r><q:t> portfolio</q:t></q:r></q:hyperlink><q:hyperlink r:id="unsafe"><q:r><q:t> inert link</q:t></q:r></q:hyperlink></q:p>', '<Relationship Id="safe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/fictional" TargetMode="External"/><Relationship Id="unsafe" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(1)" TargetMode="External"/>', 'q');
    const result = await importResume(asFile('prefix.docx', bytes)), region = result.template.pages[0].regions.find(region => region.kind === 'text')!;
    expect(region.kind === 'text' && region.style).toMatchObject({ fontSize: 12, color: '#224466' });
    expect(result.baseline.blocks[0].runs[0]).toMatchObject({ text: '<script>fictional</script>', bold: true, italic: true });
    expect(result.baseline.blocks[0].runs[1].href).toBe('https://example.com/fictional');
    expect(result.baseline.blocks[0].runs[2].href).toBeUndefined();
    const sanitized = await JSZip.loadAsync(await sanitizedDocxBytes(bytes));
    expect(await sanitized.file('word/_rels/document.xml.rels')!.async('string')).not.toContain('TargetMode="External"');
    expect(await sanitized.file('word/document.xml')!.async('string')).not.toContain('hyperlink');
    expect(await sanitized.file('word/document.xml')!.async('string')).toContain('&lt;script&gt;fictional&lt;/script&gt;');
  });
  it('resolves inherited paragraph styles, direct full-run formatting, explicit false marks and simple bullets', async () => {
    const bytes = await minimalDocx('<w:p><w:pPr><w:pStyle w:val="Heading"/></w:pPr><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>Fictional heading</w:t></w:r></w:p><w:p><w:r><w:rPr><w:sz w:val="36"/><w:color w:val="123456"/></w:rPr><w:t>Fictional direct formatting</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val="List"/></w:pPr><w:r><w:t>Fictional bullet</w:t></w:r></w:p>');
    const zip = await JSZip.loadAsync(bytes);
    zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Normal" w:type="paragraph" w:default="1"><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:styleId="Heading" w:type="paragraph"><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:styleId="List" w:type="paragraph"><w:basedOn w:val="Normal"/><w:pPr><w:numPr><w:numId w:val="1"/><w:ilvl w:val="0"/></w:numPr></w:pPr></w:style></w:styles>');
    zip.file('word/numbering.xml', '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>');
    const result = await importResume(asFile('styles.docx', await zip.generateAsync({ type: 'uint8array' })));
    const regions = result.template.pages[0].regions.filter(region => region.kind === 'text');
    expect(regions[0].style).toMatchObject({ fontSize: 16, fontWeight: 700 });
    expect(result.baseline.blocks[0].runs[0].bold).toBe(false);
    expect(regions[1].style).toMatchObject({ fontSize: 18, color: '#123456' });
    expect(result.baseline.blocks[2].runs.map(run => run.text).join('')).toBe('• Fictional bullet');
    expect(regions[2].role).toBe('bullet');
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
  });
  it('splits an explicit page break within one paragraph and preserves run styles on both pages', async () => {
    const bytes = await minimalDocx('<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Fictional first page</w:t><w:br w:type="page"/><w:t>Fictional second page</w:t></w:r></w:p>');
    const result = await importResume(asFile('inline-break.docx', bytes));
    expect(result.template.pages).toHaveLength(2);
    expect(result.baseline.blocks.map(block => block.runs.map(run => run.text).join(''))).toEqual(['Fictional first page', 'Fictional second page']);
    expect(result.baseline.blocks.every(block => block.runs[0].bold)).toBe(true);
    expect(result.template.warnings.some(w => w.severity === 'blocking')).toBe(false);
  });
  it('preserves an inline raster asset and blocks external image omissions', async () => {
    const result = await importResume(await fixture('fictional-resume-photo.docx'));
    expect(result.assets).toHaveLength(1);
    expect(result.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'image')).toHaveLength(1);
    expect(result.assets[0].mime).toBe('image/png');
    const external = await minimalDocx('<w:p><w:r><w:t>Fictional</w:t></w:r></w:p>', '<Relationship Id="image" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.invalid/photo.png" TargetMode="External"/>');
    expect((await importResume(asFile('external.docx', external))).template.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DOCX_EXTERNAL_RESOURCE', severity: 'blocking' })]));
  });
  it('retains simple table cell text in fixed regions and flags merges/actionable omissions', async () => {
    const table = '<w:tbl><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>Fictional left cell</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Fictional right cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const result = await importResume(asFile('table.docx', await minimalDocx(table)));
    const regions = result.template.pages[0].regions.filter(region => region.kind === 'text');
    expect(regions[1].bounds.x).toBeGreaterThan(regions[0].bounds.x);
    expect(result.facts.map(fact => fact.locator)).toEqual(expect.arrayContaining([expect.stringContaining('/cell[1]/'), expect.stringContaining('/cell[2]/')]));
    const merged = table.replace('<w:tc>', '<w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>');
    expect((await importResume(asFile('merged.docx', await minimalDocx(merged)))).template.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'DOCX_COMPLEX_TABLE', severity: 'blocking' })]));
  });
});

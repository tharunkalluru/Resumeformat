// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { CONTEXT_EXTRACTOR_VERSION, CONTEXT_LIMITS, importSupportingContext } from './context';

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('pdfjs-dist/legacy/build/pdf.mjs')>();
  return { ...actual, getDocument: vi.fn(actual.getDocument) };
});

const expectedFacts = [
  'Fictional Casey Rowan career context',
  'Mentored four designers during the 2024 accessibility programme.',
  'Documented keyboard navigation patterns for a fictional scheduling product.',
];
const asFile = (name: string, value: string | Uint8Array, type = '') => new File([typeof value === 'string' ? value : new Uint8Array(value).buffer], name, { type });
const fixture = async (name: string) => asFile(name, new Uint8Array(await readFile(resolve('public/fixtures/m3-context', name))));
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
let dom: JSDOM;
beforeAll(async () => {
  dom = new JSDOM('');
  Object.assign(globalThis, { DOMParser: dom.window.DOMParser, DOMMatrix, ImageData, Path2D, pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
  pdfjs.GlobalWorkerOptions.workerSrc = resolve('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
});
afterAll(() => dom.window.close());
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function changeDocx(change: (zip: JSZip) => void): Promise<File> {
  const zip = await JSZip.loadAsync(await (await fixture('fictional-context.docx')).arrayBuffer());
  change(zip); return asFile('changed.docx', await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
}

describe('real fictional supporting extraction', () => {
  it.each(['pdf', 'docx', 'txt'])('extracts independent facts from actual %s bytes without creating a resume', async format => {
    const file = await fixture(`fictional-context.${format}`), bytes = new Uint8Array(await file.arrayBuffer());
    const source = await importSupportingContext(file, { sourceId: 'same-logical-source' });
    expect(source).toMatchObject({ id: 'same-logical-source', version: 1, kind: 'supportingFile', format, extractorVersion: CONTEXT_EXTRACTOR_VERSION, state: 'needsReview', sha256: hash(bytes) });
    expect(source.bytes).toEqual(bytes);
    expect(source.segments.map(segment => segment.text)).toEqual(expectedFacts);
    expect(source).not.toHaveProperty('template'); expect(source).not.toHaveProperty('baseline'); expect(source).not.toHaveProperty('facts');
    expect(new Date(source.ingestedAt).toISOString()).toBe(source.ingestedAt);
    const expected = format === 'pdf' ? ['pdf/page[1]/items[1]', 'pdf/page[2]/items[1]', 'pdf/page[3]/items[1]'] : format === 'docx' ? ['word/document.xml/paragraph[1]', 'word/document.xml/paragraph[3]', 'word/document.xml/paragraph[4]'] : ['txt/line[1]', 'txt/line[3]', 'txt/line[4]'];
    expect(source.segments.map(segment => segment.locator)).toEqual(expected);
    expect(source.segments.map(segment => segment.id)).toEqual(['same-logical-source:segment:1', 'same-logical-source:segment:2', 'same-logical-source:segment:3']);
  });
  it('reports the same source content hash on retry and preserves the logical identity and segment identities', async () => {
    const file = await fixture('fictional-context.txt');
    const first = await importSupportingContext(file, { sourceId: 'retry-source' });
    const retry = await importSupportingContext(file, { sourceId: first.id });
    expect(retry.sha256).toBe(first.sha256); expect(retry.segments).toEqual(first.segments);
  });
  it('supports ten PDF pages independently of the primary resume page cap and rejects eleven', async () => {
    const accepted = await importSupportingContext(await fixture('fictional-context-ten-pages.pdf'));
    expect(accepted.segments).toHaveLength(10);
    expect(accepted.segments[9]).toMatchObject({ text: 'Fictional supporting page 10.', locator: 'pdf/page[10]/items[1]' });
    await expect(importSupportingContext(await fixture('fictional-context-eleven-pages.pdf'))).rejects.toMatchObject({ code: 'CONTEXT_PAGE_LIMIT' });
  });
  it.each(['pdf', 'docx', 'txt'])('does not fetch external links or acquire rendering resources for %s', async format => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden in parser test'));
    const source = await importSupportingContext(await fixture(`fictional-context.${format}`));
    expect(source.segments.map(segment => segment.text)).toEqual(expectedFacts);
    expect(network).not.toHaveBeenCalled();
    expect(JSON.stringify(source.segments)).not.toContain('FICTIONAL HIDDEN CONTENT');
  });
});

describe('supporting containment and honest failures', () => {
  it('rejects invalid types, mismatched bytes/MIME and byte limits before parsing', async () => {
    await expect(importSupportingContext(asFile('empty.txt', ''))).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(importSupportingContext(asFile('legacy.doc', 'Fictional'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    await expect(importSupportingContext(asFile('macro.docm', 'Fictional'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' });
    await expect(importSupportingContext(asFile('wrong.pdf', 'Fictional'))).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(importSupportingContext(asFile('wrong.docx', '%PDF-1.7 corrupt'))).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(importSupportingContext(asFile('wrong.txt', '%PDF-1.7 corrupt'))).rejects.toMatchObject({ code: 'SIGNATURE_MISMATCH' });
    await expect(importSupportingContext(asFile('wrong.txt', 'Fictional', 'text/html'))).rejects.toMatchObject({ code: 'MIME_MISMATCH' });
    await expect(importSupportingContext(asFile('large.txt', new Uint8Array(CONTEXT_LIMITS.txtBytes + 1)))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(importSupportingContext(asFile('large.pdf', new Uint8Array(CONTEXT_LIMITS.binaryBytes + 1)))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    const incomplete = { name: 'incomplete.txt', size: 8, type: '', arrayBuffer: async () => new TextEncoder().encode('small').buffer } as File;
    await expect(importSupportingContext(incomplete)).rejects.toMatchObject({ code: 'FILE_SIZE_MISMATCH' });
  });
  it('rejects invalid UTF-8, NUL/binary TXT, empty text and exact character/segment overlimits', async () => {
    await expect(importSupportingContext(asFile('bad.txt', new Uint8Array([0xc3, 0x28])))).rejects.toMatchObject({ code: 'CONTEXT_UTF8' });
    for (const text of ['Fictional\0binary', 'Fictional\u0001binary']) await expect(importSupportingContext(asFile('binary.txt', text))).rejects.toMatchObject({ code: 'CONTEXT_BINARY_TEXT' });
    await expect(importSupportingContext(asFile('blank.txt', ' \n\t '))).rejects.toMatchObject({ code: 'TEXTLESS' });
    await expect(importSupportingContext(asFile('long-line.txt', 'x'.repeat(10_001)))).rejects.toMatchObject({ code: 'CONTEXT_SEGMENT_LIMIT' });
    await expect(importSupportingContext(asFile('many.txt', Array(2_001).fill('x').join('\n')))).rejects.toMatchObject({ code: 'CONTEXT_SEGMENT_LIMIT' });
    await expect(importSupportingContext(asFile('text-cap.txt', Array(101).fill('x'.repeat(1_000)).join('\n')))).rejects.toMatchObject({ code: 'CONTEXT_TEXT_LIMIT' });
  });
  it.each(['fictional-context-encrypted.pdf', 'fictional-context-empty-password.pdf'])('refuses actual encrypted PDF %s', async name => {
    await expect(importSupportingContext(await fixture(name))).rejects.toMatchObject({ code: 'ENCRYPTED_DOCUMENT' });
  });
  it('rejects textless scans and corrupt containers without changing another accepted source', async () => {
    const existing = await importSupportingContext(await fixture('fictional-context.txt')), before = structuredClone(existing);
    await expect(importSupportingContext(await fixture('fictional-context-textless.pdf'))).rejects.toMatchObject({ code: 'TEXTLESS' });
    await expect(importSupportingContext(asFile('corrupt.pdf', '%PDF-1.7\ninvalid'))).rejects.toMatchObject({ code: 'CORRUPT_PDF' });
    await expect(importSupportingContext(asFile('corrupt.docx', 'PK\x03\x04invalid'))).rejects.toBeInstanceOf(Error);
    expect(existing).toEqual(before);
  });
  it('rejects dangerous XML, alternate containers, hidden inherited styles and macro objects', async () => {
    const entity = await changeDocx(zip => zip.file('word/document.xml', '<!DOCTYPE x [<!ENTITY e "fictional">]><x/>'));
    await expect(importSupportingContext(entity)).rejects.toMatchObject({ code: 'UNSAFE_XML' });
    const unusedEntity = await changeDocx(zip => zip.file('word/comments.xml', '<!DOCTYPE x [<!ENTITY e "fictional">]><x/>'));
    await expect(importSupportingContext(unusedEntity)).rejects.toMatchObject({ code: 'UNSAFE_XML' });
    const corrupt = await changeDocx(zip => zip.file('word/document.xml', '<w:document>'));
    await expect(importSupportingContext(corrupt)).rejects.toMatchObject({ code: 'DOCX_XML' });
    const unsupported = await changeDocx(zip => zip.file('word/document.xml', '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtContent><w:p><w:r><w:t>Fictional alternate</w:t></w:r></w:p></w:sdtContent></w:sdt></w:body></w:document>'));
    await expect(importSupportingContext(unsupported)).rejects.toMatchObject({ code: 'CONTEXT_DOCX_UNSUPPORTED' });
    const hiddenStyle = await changeDocx(zip => zip.file('word/styles.xml', '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:styleId="Hidden"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>'));
    await expect(importSupportingContext(hiddenStyle)).rejects.toMatchObject({ code: 'CONTEXT_DOCX_UNSUPPORTED' });
    const macro = await changeDocx(zip => zip.file('word/vbaProject.bin', new Uint8Array([1, 2, 3])));
    await expect(importSupportingContext(macro)).rejects.toMatchObject({ code: 'ACTIVE_CONTENT' });
    const macroType = await changeDocx(zip => zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/></Types>'));
    await expect(importSupportingContext(macroType)).rejects.toMatchObject({ code: 'DOCX_CONTENT_TYPE' });
  });
  it('preflights archive paths, declared expansion, encryption and actual CRC', async () => {
    const unsafe = await changeDocx(zip => zip.file('../outside.xml', '<fictional/>'));
    await expect(importSupportingContext(unsafe)).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
    const bytes = new Uint8Array(await (await fixture('fictional-context.docx')).arrayBuffer());
    const central = bytes.findIndex((_, index) => bytes[index] === 0x50 && bytes[index + 1] === 0x4b && bytes[index + 2] === 1 && bytes[index + 3] === 2);
    const bomb = new Uint8Array(bytes); new DataView(bomb.buffer).setUint32(central + 24, 60 * 1024 * 1024, true);
    await expect(importSupportingContext(asFile('bomb.docx', bomb))).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
    const crc = new Uint8Array(bytes); new DataView(crc.buffer).setUint32(central + 16, 0, true);
    await expect(importSupportingContext(asFile('crc.docx', crc))).rejects.toMatchObject({ code: 'ARCHIVE_INVALID' });
    const encrypted = new Uint8Array(bytes), view = new DataView(encrypted.buffer);
    view.setUint16(6, view.getUint16(6, true) | 1, true); view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    await expect(importSupportingContext(asFile('encrypted.docx', encrypted))).rejects.toMatchObject({ code: 'ENCRYPTED_DOCUMENT' });
  });
});

describe('parser cancellation and deadlines (resource test doubles)', () => {
  it('cancels a read and never returns a partially accepted source', async () => {
    const signal = new AbortController(); signal.abort();
    await expect(importSupportingContext(await fixture('fictional-context.txt'), { signal: signal.signal })).rejects.toMatchObject({ code: 'CONTEXT_CANCELLED' });
    vi.useFakeTimers();
    const unread = { name: 'slow.txt', size: 8, type: '', arrayBuffer: () => new Promise<ArrayBuffer>(() => {}) } as File;
    const pending = importSupportingContext(unread), assertion = expect(pending).rejects.toMatchObject({ code: 'CONTEXT_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('terminates its ZIP worker on abort and removes late result callbacks', async () => {
    let worker: { terminate: ReturnType<typeof vi.fn>; onmessage: unknown; onerror: unknown } | undefined;
    let started!: () => void; const ready = new Promise<void>(resolveReady => { started = resolveReady; });
    class WorkerDouble {
      terminate = vi.fn(); onmessage = null; onerror = null;
      constructor() { worker = this; started(); }
      postMessage() {}
    }
    vi.stubGlobal('Worker', WorkerDouble);
    const controller = new AbortController();
    const pending = importSupportingContext(await fixture('fictional-context.docx'), { signal: controller.signal });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'CONTEXT_CANCELLED' });
    await ready; controller.abort(); await assertion;
    expect(worker?.terminate).toHaveBeenCalledOnce(); expect(worker?.onmessage).toBeNull(); expect(worker?.onerror).toBeNull();
  });
  it('destroys its PDF loading task at the overall deadline', async () => {
    const destroy = vi.fn(async () => {});
    vi.mocked(pdfjs.getDocument).mockReturnValueOnce({ promise: new Promise(() => {}), destroy } as unknown as ReturnType<typeof pdfjs.getDocument>);
    const file = await fixture('fictional-context.pdf'); vi.useFakeTimers();
    const pending = importSupportingContext(file), assertion = expect(pending).rejects.toMatchObject({ code: 'CONTEXT_TIMEOUT' });
    // Wait for the real SHA operation before advancing the synthetic timer.
    await vi.waitFor(() => expect(pdfjs.getDocument).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(20_000); await assertion;
    expect(destroy).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
});

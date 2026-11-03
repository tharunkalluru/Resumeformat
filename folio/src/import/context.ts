import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { FolioError } from '../core/errors';
import { newId, sha256, type MemorySource } from '../core/model';
import { inflateBoundedArchive, inspectZip } from './zipCodec';
import { attr, child, CT, descendants, parseXml, readRelationships, W } from './xml';

GlobalWorkerOptions.workerSrc = workerUrl;

export const CONTEXT_EXTRACTOR_VERSION = 'folio-context-v1';
export const CONTEXT_LIMITS = Object.freeze({ binaryBytes: 10 * 1024 * 1024, txtBytes: 1024 * 1024, pdfPages: 10, characters: 100_000, segments: 2_000, segmentCharacters: 10_000, deadlineMs: 20_000 });
export interface ContextImportOptions { sourceId?: string; signal?: AbortSignal; groupId?: string }
type Segment = MemorySource['segments'][number];
const fail = (code: string, message: string) => new FolioError(code, message);
const cancelled = () => fail('CONTEXT_CANCELLED', 'Reading this supporting file was cancelled. Your other context is unchanged.');
const timeout = () => fail('CONTEXT_TIMEOUT', 'Reading this supporting file exceeded 20 seconds. Export a smaller document or paste selected text.');

/** Owns cancellation and resources for exactly one complete extraction. */
class ParseScope {
  private controller = new AbortController();
  private cleanups = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout>;
  private expires = performance.now() + CONTEXT_LIMITS.deadlineMs;
  private reason: FolioError | undefined;
  private parent?: AbortSignal;
  constructor(signal?: AbortSignal) {
    this.parent = signal;
    this.timer = setTimeout(() => this.abort(timeout()), CONTEXT_LIMITS.deadlineMs);
    signal?.addEventListener('abort', this.onAbort, { once: true });
    if (signal?.aborted) this.abort(cancelled());
  }
  private onAbort = () => this.abort(cancelled());
  private abort(reason: FolioError) {
    if (this.reason) return;
    this.reason = reason; this.controller.abort();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups.clear();
  }
  check() {
    if (!this.reason && performance.now() >= this.expires) this.abort(timeout());
    if (this.reason) throw this.reason;
  }
  resource(cleanup: () => void) { try { this.check(); } catch (error) { cleanup(); throw error; } this.cleanups.add(cleanup); return () => { if (this.cleanups.delete(cleanup)) cleanup(); }; }
  async wait<T>(promise: Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const abort = () => { done(); reject(this.reason ?? cancelled()); };
      const done = () => this.controller.signal.removeEventListener('abort', abort);
      this.controller.signal.addEventListener('abort', abort, { once: true });
      promise.then(value => { done(); try { this.check(); resolve(value); } catch (error) { reject(error); } }, error => { done(); reject(this.reason ?? error); });
    });
  }
  dispose() { clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.onAbort); for (const cleanup of this.cleanups) cleanup(); this.cleanups.clear(); }
}

function segmentCollector(sourceId: string, scope: ParseScope) {
  const segments: Segment[] = []; let characters = 0;
  return { segments, add(text: string, locator: string) {
    scope.check();
    if (!text.trim()) return;
    if (locator.length > 1_000) throw fail('CONTEXT_LOCATOR_LIMIT', 'This supporting document uses an oversized text-part path. Export a fresh document or paste selected text.');
    if (text.length > CONTEXT_LIMITS.segmentCharacters) throw fail('CONTEXT_SEGMENT_LIMIT', 'A source passage exceeds 10,000 characters. Export shorter paragraphs or paste selected text.');
    characters += text.length;
    if (characters > CONTEXT_LIMITS.characters) throw fail('CONTEXT_TEXT_LIMIT', 'This supporting file exceeds 100,000 extracted characters. Export a shorter document or paste selected text.');
    if (segments.length >= CONTEXT_LIMITS.segments) throw fail('CONTEXT_SEGMENT_LIMIT', 'This supporting file exceeds 2,000 text passages. Export a shorter document or paste selected text.');
    segments.push({ id: `${sourceId}:segment:${segments.length + 1}`, text, locator });
  } };
}

async function validatedContextFile(file: File, scope: ParseScope): Promise<{ bytes: Uint8Array; format: 'pdf' | 'docx' | 'txt' }> {
  if (!file || !Number.isSafeInteger(file.size) || file.size <= 0) throw fail('EMPTY_FILE', 'This supporting file is empty. Choose a PDF, DOCX, or UTF-8 TXT file.');
  if (!file.name || file.name.length > 500 || /[\u0000-\u001f\u007f]/.test(file.name)) throw fail('CONTEXT_FILENAME', 'This supporting filename is unsupported. Rename the file and choose it again.');
  const format = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (format !== 'pdf' && format !== 'docx' && format !== 'txt') throw fail('UNSUPPORTED_FORMAT', 'Supporting files must be PDF, standard DOCX, or UTF-8 TXT. Export that format or paste selected text.');
  const limit = format === 'txt' ? CONTEXT_LIMITS.txtBytes : CONTEXT_LIMITS.binaryBytes;
  if (file.size > limit) throw fail('FILE_TOO_LARGE', `This supporting ${format.toUpperCase()} exceeds ${format === 'txt' ? '1' : '10'} MiB. Choose a smaller file or paste selected text.`);
  const accepted = format === 'pdf' ? ['', 'application/pdf', 'application/octet-stream'] : format === 'docx' ? ['', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'] : ['', 'text/plain', 'application/octet-stream'];
  if (!accepted.includes(file.type.toLowerCase())) throw fail('MIME_MISMATCH', 'This supporting file is reported as a different format. Export a fresh PDF, DOCX, or UTF-8 TXT.');
  const bytes = new Uint8Array(await scope.wait(file.arrayBuffer()));
  if (bytes.byteLength !== file.size || !bytes.length || bytes.length > limit) throw fail('FILE_SIZE_MISMATCH', 'This supporting file could not be read completely. Choose it again.');
  const pdf = /^%PDF-\d\.\d/.test(new TextDecoder('ascii').decode(bytes.subarray(0, 8)));
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  if (format === 'pdf' && !pdf || format === 'docx' && !zip || format === 'txt' && (pdf || zip)) throw fail('SIGNATURE_MISMATCH', 'The supporting file contents do not match its extension. Export a fresh file or paste selected text.');
  return { bytes, format };
}

async function pdfSegments(bytes: Uint8Array, sourceId: string, scope: ParseScope): Promise<Segment[]> {
  // A disposable byte copy prevents PDF.js transferring accepted originals.
  // No rendering, annotations, actions, embedded files, fonts or images are loaded.
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true, stopAtErrors: true, useWorkerFetch: false, disableAutoFetch: true, verbosity: 0 });
  const release = scope.resource(() => { void loading.destroy().catch(() => {}); });
  try {
    const pdf = await scope.wait(loading.promise);
    if (pdf.numPages < 1 || pdf.numPages > CONTEXT_LIMITS.pdfPages) throw fail('CONTEXT_PAGE_LIMIT', 'Supporting PDFs may contain at most 10 pages. Export selected pages or paste selected text.');
    const metadata = await scope.wait(pdf.getMetadata());
    if (await scope.wait(pdf.getPermissions()) !== null || (metadata.info as { EncryptFilterName?: unknown }).EncryptFilterName) throw fail('ENCRYPTED_DOCUMENT', 'Encrypted supporting PDFs are unsupported. Export an unencrypted PDF or paste selected text.');
    if (Array.from(await scope.wait(pdf.getOptionalContentConfig())).length) throw fail('CONTEXT_PDF_LAYERS', 'This PDF has optional text layers whose visibility cannot be verified. Export a flattened selectable-text PDF or paste selected text.');
    const result = segmentCollector(sourceId, scope);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await scope.wait(pdf.getPage(pageNumber));
      try {
        const content = await scope.wait(page.getTextContent({ disableNormalization: true }));
        content.items.forEach((item, index) => { if ('str' in item) result.add(item.str, `pdf/page[${pageNumber}]/items[${index + 1}]`); });
      } finally { page.cleanup(); }
    }
    return result.segments;
  } catch (error) {
    if (error instanceof FolioError) throw error;
    if (error instanceof Error && error.name === 'PasswordException') throw fail('ENCRYPTED_DOCUMENT', 'Encrypted supporting PDFs are unsupported. Export an unencrypted PDF or paste selected text.');
    throw fail('CORRUPT_PDF', 'This supporting PDF is corrupt or unreadable. Export a fresh PDF or paste selected text.');
  } finally { release(); }
}

async function contextArchive(bytes: Uint8Array, scope: ParseScope): Promise<Map<string, Uint8Array>> {
  try { inspectZip(bytes); } catch (error) { if (error instanceof FolioError) throw error; throw fail('DOCX_ARCHIVE', 'This supporting DOCX has corrupt archive metadata. Export a fresh DOCX.'); }
  // Production uses the existing terminable ZIP worker. The bounded Node-only
  // fallback supports real fixture tests; browser Worker absence fails closed.
  if (typeof Worker === 'undefined') {
    if (typeof window !== 'undefined') throw fail('ARCHIVE_WORKER', 'The local supporting DOCX parser cannot start. Paste selected text instead.');
    return scope.wait(inflateBoundedArchive(bytes));
  }
  let worker: Worker;
  try { worker = new Worker(new URL('./zip.worker.ts', import.meta.url), { type: 'module' }); }
  catch { throw fail('ARCHIVE_WORKER', 'The local supporting DOCX parser cannot start. Paste selected text instead.'); }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const release = scope.resource(() => { if (timer) clearTimeout(timer); worker.onmessage = null; worker.onerror = null; worker.terminate(); });
  try {
    return await scope.wait(new Promise<Map<string, Uint8Array>>((resolve, reject) => {
      timer = setTimeout(() => { release(); reject(fail('ARCHIVE_TIMEOUT', 'Supporting DOCX decompression exceeded 15 seconds. Export a smaller document or paste selected text.')); }, 15_000);
      worker.onmessage = (event: MessageEvent) => {
        const response = event.data as { parts?: [string, Uint8Array][]; error?: { code: string; message: string } };
        release();
        if (response.error) reject(new FolioError(response.error.code, response.error.message));
        else if (response.parts) resolve(new Map(response.parts));
        else reject(fail('ARCHIVE_WORKER', 'The supporting DOCX parser returned an invalid result. Paste selected text instead.'));
      };
      worker.onerror = () => { release(); reject(fail('ARCHIVE_WORKER', 'The local supporting DOCX parser failed. Paste selected text instead.')); };
      const disposable = new Uint8Array(bytes); worker.postMessage(disposable, [disposable.buffer]);
    }));
  } finally { release(); }
}

function on(element: Element | undefined) { return !!element && !['0', 'false', 'off'].includes(attr(element, 'val') ?? '1'); }
async function docxSegments(bytes: Uint8Array, sourceId: string, scope: ParseScope): Promise<Segment[]> {
  const parts = await contextArchive(bytes, scope); scope.check();
  if (!parts.has('[Content_Types].xml') || !parts.has('word/document.xml') || !parts.has('_rels/.rels')) throw fail('DOCX_ARCHIVE', 'This ZIP is not a standard DOCX. Export a Word DOCX or paste selected text.');
  if ([...parts.keys()].some(name => /vbaProject|activeX|embeddings\/|afchunk|altchunk|\.html?$|\.mhtml$/i.test(name))) throw fail('ACTIVE_CONTENT', 'This supporting DOCX contains macros, embedded objects, or alternate content. Remove them or export a selectable-text PDF.');
  const types = parseXml(parts.get('[Content_Types].xml')!, 'content types');
  if (descendants(types, 'Override', CT).find(node => node.getAttribute('PartName') === '/word/document.xml')?.getAttribute('ContentType') !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml') throw fail('DOCX_CONTENT_TYPE', 'This is not a standard DOCX. Macro-enabled and other Word containers are unsupported.');
  if (![...readRelationships(parts, '').values()].some(relation => !relation.external && relation.type.endsWith('/officeDocument') && relation.part === 'word/document.xml')) throw fail('DOCX_ROOT_RELATIONSHIP', 'This DOCX has no valid local Word document relationship. Export a fresh DOCX.');
  // Validate retained XML too, including unused metadata. External targets remain
  // inert; parsing XML does not acquire relationships or embedded resources.
  for (const [name, data] of parts) if (/\.(xml|rels)$/i.test(name)) {
    scope.check();
    if (data.length > 8 * 1024 * 1024) throw fail('DOCX_ARCHIVE', 'A supporting DOCX XML part exceeds 8 MiB. Export a smaller document or paste selected text.');
    parseXml(data, name);
  }
  const relations = readRelationships(parts, 'word/document.xml');
  const documents: [string, Document][] = [];
  const readPart = (name: string) => {
    scope.check(); const data = parts.get(name);
    if (!data) throw fail('DOCX_STRUCTURE', 'A referenced DOCX text part is missing. Export a fresh DOCX.');
    const document = parseXml(data, name);
    const root = name === 'word/document.xml' ? 'document' : name.startsWith('word/header') ? 'hdr' : 'ftr';
    if (document.documentElement.namespaceURI !== W || document.documentElement.localName !== root) throw fail('DOCX_STRUCTURE', 'This DOCX uses an unsupported Word XML structure. Export a standard DOCX.');
    documents.push([name, document]);
  };
  readPart('word/document.xml');
  if (!child(documents[0][1].documentElement, 'body')) throw fail('DOCX_STRUCTURE', 'This DOCX has no supported Word document body.');
  for (const relation of relations.values()) if (/\/(header|footer)$/.test(relation.type)) {
    if (relation.external || !relation.part || !/^word\/(header|footer)[^/]*\.xml$/.test(relation.part)) throw fail('DOCX_STRUCTURE', 'This DOCX references an unsupported header or footer. Export a selectable-text PDF.');
    if (!documents.some(([name]) => name === relation.part)) readPart(relation.part);
  }
  // Hidden inherited styles require a faithful visibility model, so reject them
  // rather than presenting possibly hidden material as visible source evidence.
  if (parts.has('word/styles.xml')) {
    const styles = parseXml(parts.get('word/styles.xml')!, 'styles');
    if (['vanish', 'webHidden'].some(local => descendants(styles, local).some(on))) throw fail('CONTEXT_DOCX_UNSUPPORTED', 'This DOCX uses hidden text styles. Export a visible selectable-text PDF or paste selected text.');
  }
  const result = segmentCollector(sourceId, scope);
  const unsupported = ['altChunk', 'subDoc', 'object', 'pict', 'txbxContent', 'control', 'sdt', 'customXml', 'fldSimple', 'fldChar', 'instrText', 'footnoteReference', 'endnoteReference', 'del', 'ins', 'moveFrom', 'moveTo'];
  for (const [name, doc] of documents) {
    if (unsupported.some(local => descendants(doc, local).length) || descendants(doc, 'AlternateContent', 'http://schemas.openxmlformats.org/markup-compatibility/2006').length || descendants(doc, 'oMath', 'http://schemas.openxmlformats.org/officeDocument/2006/math').length) throw fail('CONTEXT_DOCX_UNSUPPORTED', 'This DOCX has unsupported fields, tracked changes, text containers, or embedded content. Export a flattened selectable-text PDF or paste selected text.');
    descendants(doc, 'p').forEach((paragraph, index) => {
      scope.check(); let text = '';
      for (const run of descendants(paragraph, 'r')) {
        const properties = child(run, 'rPr');
        if (on(child(properties, 'vanish')) || on(child(properties, 'webHidden'))) continue;
        for (const node of Array.from(run.children)) {
          if (node.namespaceURI !== W) continue;
          if (node.localName === 't') text += node.textContent ?? '';
          else if (node.localName === 'tab') text += '\t';
          else if (node.localName === 'br' || node.localName === 'cr') text += '\n';
          else if (node.localName === 'noBreakHyphen') text += '\u2011';
          else if (node.localName === 'softHyphen') text += '\u00ad';
          else if (node.localName === 'sym') throw fail('CONTEXT_DOCX_UNSUPPORTED', 'This DOCX has font-dependent symbols. Export a selectable-text PDF or paste selected text.');
        }
      }
      result.add(text, `${name}/paragraph[${index + 1}]`);
    });
  }
  return result.segments;
}

function txtSegments(bytes: Uint8Array, sourceId: string, scope: ParseScope): Segment[] {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw fail('CONTEXT_UTF8', 'This TXT is not valid UTF-8. Save it as UTF-8 or paste selected text.'); }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw fail('CONTEXT_BINARY_TEXT', 'This TXT contains binary or unsupported control characters. Save plain UTF-8 text or paste selected text.');
  if (text.length > CONTEXT_LIMITS.characters) throw fail('CONTEXT_TEXT_LIMIT', 'This supporting TXT exceeds 100,000 characters. Save selected passages instead.');
  const result = segmentCollector(sourceId, scope);
  text.split(/\r\n|\n|\r/).forEach((line, index) => result.add(line, `txt/line[${index + 1}]`));
  return result.segments;
}

/** Pure local supporting-source extraction. Root owns group generation, commits,
 * aggregate limits, duplicate review and persistence. No assertions are confirmed. */
export async function importSupportingContext(file: File, options: ContextImportOptions = {}): Promise<MemorySource> {
  const sourceId = options.sourceId ?? newId();
  if (!sourceId || sourceId.length > 128 || /[\u0000-\u001f\u007f]/.test(sourceId)) throw fail('CONTEXT_SOURCE_ID', 'This supporting source has an invalid identity. Choose the file again.');
  const scope = new ParseScope(options.signal);
  try {
    scope.check();
    const { bytes, format } = await validatedContextFile(file, scope);
    const hash = await scope.wait(sha256(bytes));
    const segments = format === 'pdf' ? await pdfSegments(bytes, sourceId, scope) : format === 'docx' ? await docxSegments(bytes, sourceId, scope) : txtSegments(bytes, sourceId, scope);
    scope.check();
    if (!segments.length) throw fail('TEXTLESS', 'This supporting file has no supported selectable text. Scans need OCR, which is unavailable; paste selected text or export a text-based document.');
    return { id: sourceId, version: 1, kind: 'supportingFile', name: file.name, ingestedAt: new Date().toISOString(), extractorVersion: CONTEXT_EXTRACTOR_VERSION, format, bytes: new Uint8Array(bytes), sha256: hash, segments, state: 'needsReview' };
  } catch (error) {
    if (error instanceof FolioError) throw error;
    throw fail('CONTEXT_PARSE', 'This supporting file could not be read safely. Export a fresh file or paste selected text.');
  } finally { scope.dispose(); }
}

export const extractContextSource = importSupportingContext;

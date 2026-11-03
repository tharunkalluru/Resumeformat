import {MAX_SOURCE_PAGES} from '../core/model';
import { MAX_SOURCE_BYTES, newId, sha256, type ImportResult, type ImportWarning, type SourceAsset } from '../core/model';
import { FolioError } from '../core/errors';

export const IMPORTER_VERSION = 'folio-import-v13';
export const MAX_TEXT = 100_000;
export function warning(code: string, message: string, severity: ImportWarning['severity'] = 'review', pageId?: string): ImportWarning {
  return { id: newId(), code, severity, message, ...(pageId ? { pageId } : {}) };
}
export async function sourceAsset(file: File, bytes: Uint8Array, format: 'pdf' | 'docx'): Promise<SourceAsset> {
  return { id: newId(), name: file.name, format, bytes: new Uint8Array(bytes), sha256: await sha256(bytes), sourcePageCount: null };
}
export function assertImport(result: ImportResult): ImportResult {
  if (!result.baseline.blocks.some(block => block.runs.some(run => run.text.trim())))
    throw new FolioError('TEXTLESS', 'This document has no supported selectable text. Export a text-based PDF or DOCX; scanned PDFs need OCR, which is not available here.');
  if (result.baseline.blocks.reduce((sum, block) => sum + block.runs.reduce((n, run) => n + run.text.length, 0), 0) > MAX_TEXT)
    throw new FolioError('TEXT_LIMIT', 'This document contains too much text. Import a shorter source.');
  if (!result.template.pages.length || result.template.pages.length > MAX_SOURCE_PAGES)
    throw new FolioError('PAGE_LIMIT', `This document reconstructs to more than ${MAX_SOURCE_PAGES} pages. Import a shorter source.`);
  for (const page of result.template.pages) {
    if (![page.width, page.height].every(value => Number.isFinite(value) && value > 0 && value <= 2000))
      throw new FolioError('PAGE_GEOMETRY', 'This document has an unsupported page size. Use pages no larger than 2000 points.');
  }
  return result;
}
export async function validatedFile(file: File): Promise<{ bytes: Uint8Array; format: 'pdf' | 'docx' }> {
  if (!file || !file.size) throw new FolioError('EMPTY_FILE', 'This file is empty. Choose a PDF or DOCX resume.');
  if (file.size > MAX_SOURCE_BYTES) throw new FolioError('FILE_TOO_LARGE', 'This file is larger than 10 MiB. Choose a smaller PDF or DOCX resume.');
  const extension = file.name.toLowerCase().match(/\.([^.]+)$/)?.[1];
  if (extension !== 'pdf' && extension !== 'docx') throw new FolioError('UNSUPPORTED_FORMAT', 'Choose a PDF or DOCX file. Legacy DOC and macro-enabled DOCM files are not supported.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!bytes.byteLength || bytes.byteLength > MAX_SOURCE_BYTES || bytes.byteLength !== file.size)
    throw new FolioError('FILE_SIZE_MISMATCH', 'The file could not be read completely. Choose the file again.');
  const pdf = bytes.length >= 8 && new TextDecoder('ascii').decode(bytes.subarray(0, 8)).match(/^%PDF-\d\.\d/);
  const zip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4;
  if ((extension === 'pdf' && !pdf) || (extension === 'docx' && !zip))
    throw new FolioError('SIGNATURE_MISMATCH', 'The file contents do not match its extension. Export a valid PDF or DOCX and try again.');
  const mime = file.type.toLowerCase();
  const accepted = extension === 'pdf'
    ? ['application/pdf', 'application/octet-stream', '']
    : ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream', ''];
  if (!accepted.includes(mime)) throw new FolioError('MIME_MISMATCH', 'This file is reported as a different format. Export a fresh PDF or DOCX and try again.');
  return { bytes, format: extension };
}

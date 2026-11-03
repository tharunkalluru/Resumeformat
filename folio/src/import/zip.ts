import { FolioError } from '../core/errors';
import { MAX_SOURCE_BYTES } from '../core/model';
import { inflateBoundedArchive, inspectZip } from './zipCodec';
export { safePartName } from './zipCodec';

/** Preflight on the caller; bounded decompression in a terminable browser worker. */
export async function readBoundedArchive(bytes: Uint8Array, maxCompressedBytes = MAX_SOURCE_BYTES): Promise<Map<string, Uint8Array>> {
  if (!Number.isSafeInteger(maxCompressedBytes) || maxCompressedBytes <= 0 || maxCompressedBytes > 20 * 1024 * 1024) throw new FolioError('ARCHIVE_LIMIT', 'Unsupported compressed archive limit.');
  if (!bytes.length || bytes.length > maxCompressedBytes) throw new FolioError('ARCHIVE_LIMIT', 'The archive exceeds its compressed byte limit or is empty.');
  try { inspectZip(bytes); } catch (error) { if (error instanceof FolioError) throw error; throw new FolioError('ARCHIVE_INVALID', 'The archive has corrupt ZIP metadata. Choose a valid document or project backup.'); }
  // Node tests and environments without Worker retain bounded chunk accounting.
  if (typeof Worker === 'undefined') return inflateBoundedArchive(bytes);
  const disposable = new Uint8Array(bytes);
  let worker: Worker;
  try { worker = new Worker(new URL('./zip.worker.ts', import.meta.url), { type: 'module' }); }
  catch { throw new FolioError('ARCHIVE_WORKER', 'The local archive parser could not start. Reload the application and choose the document again.'); }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate(); reject(new FolioError('ARCHIVE_TIMEOUT', 'Archive decompression exceeded 15 seconds. Use a smaller document or backup.'));
    }, 15000);
    const finish = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = (event: MessageEvent) => {
      finish();
      const response = event.data as { parts?: [string, Uint8Array][]; error?: { code: string; message: string } };
      if (response.error) reject(new FolioError(response.error.code, response.error.message));
      else if (response.parts) resolve(new Map(response.parts));
      else reject(new FolioError('ARCHIVE_WORKER', 'The Archive parser returned an invalid result. Choose a valid document or backup.'));
    };
    worker.onerror = () => { finish(); reject(new FolioError('ARCHIVE_WORKER', 'The local archive parser failed. Reload the application and choose the document again.')); };
    worker.postMessage(disposable, [disposable.buffer]);
  });
}

/** DOCX-specific container requirements are applied after the generic bounded reader. */
export async function readDocxArchive(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  try {
    const parts = await readBoundedArchive(bytes);
    if (!parts.has('[Content_Types].xml') || !parts.has('word/document.xml') || !parts.has('_rels/.rels')) throw new FolioError('DOCX_ARCHIVE', 'This ZIP is not a DOCX document. Export a valid Word DOCX.');
    return parts;
  } catch (error) {
    if (error instanceof FolioError && ['ARCHIVE_INVALID', 'ARCHIVE_LIMIT'].includes(error.code)) throw new FolioError('DOCX_ARCHIVE', error.message);
    if (error instanceof FolioError && error.code === 'ARCHIVE_TIMEOUT') throw new FolioError('DOCX_TIMEOUT', error.message);
    throw error;
  }
}

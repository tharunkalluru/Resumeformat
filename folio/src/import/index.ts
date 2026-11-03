import type { ImportResult } from '../core/model';
import { FolioError } from '../core/errors';
import { assertImport, validatedFile } from './common';

/** Pure import: no storage, project replacement, network submission, or navigation. */
export async function importResume(file: File): Promise<ImportResult> {
  const { bytes, format } = await validatedFile(file);
  try {
    const result = format === 'pdf'
      ? await (await import('./pdf')).importPdf(file, bytes)
      : await (await import('./docx')).importDocx(file, bytes);
    return assertImport(result);
  } catch (error) {
    if (error instanceof FolioError) throw error;
    throw new FolioError('CORRUPT_DOCUMENT', 'This document could not be parsed safely. Export a fresh PDF or DOCX and try again.');
  }
}

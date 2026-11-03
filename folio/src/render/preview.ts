import {MAX_SOURCE_PAGES} from '../core/model';
import {localPdfDecoderOptions} from './pdf-decoder-options';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import type { PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';
import { FolioError } from '../core/errors';
import { preflightPdfImages } from '../import/pdf-image-preflight';

interface PreviewJob {
  token: symbol;
  cancelled: boolean;
  loading?: PDFDocumentLoadingTask;
  render?: RenderTask;
  rejectDeadline?:(reason:unknown)=>void;
}
const jobs = new WeakMap<HTMLCanvasElement, PreviewJob>();
const MAX_PIXELS = 16_000_000;
const MAX_BYTES = 32 * 1024 * 1024;

/** Cancel on component unmount or when the caller's document revision changes. */
export function cancelPdfPageRender(canvas: HTMLCanvasElement): void {
  const job = jobs.get(canvas);
  if (!job) return;
  job.cancelled = true;
  job.render?.cancel();
  void job.loading?.destroy().catch(() => {});
  job.rejectDeadline?.(new FolioError('preview-cancelled', 'PDF preview was superseded.'));
  jobs.delete(canvas);
}

/**
 * Page numbers are one-based. A newer call for the same canvas supersedes the
 * previous call. Rendering occurs in a separate canvas, so stale jobs cannot
 * paint over the current revision. Superseded/cancelled jobs reject with
 * FolioError.code='preview-cancelled'; callers should ignore that error.
 * The caller also checks its contentRevision before presenting readiness.
 */
export async function renderPdfPage(bytes: Uint8Array, pageNumber: number,
  canvas: HTMLCanvasElement, scale = 1): Promise<void> {
  cancelPdfPageRender(canvas);
  if (!bytes.length || bytes.length > MAX_BYTES) throw new FolioError('preview-limit', 'PDF preview exceeds the 32 MiB limit or is empty.');
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(scale) || scale <= 0 || scale > 4) {
    throw new FolioError('preview-options', 'PDF preview requires a positive page number and a scale up to 4.');
  }
  const job: PreviewJob = { token: Symbol('pdf-preview'), cancelled: false };
  jobs.set(canvas, job);
  const current = () => {
    if (job.cancelled || jobs.get(canvas)?.token !== job.token) throw new FolioError('preview-cancelled', 'PDF preview was superseded.');
  };
  let timedOut = false;
  let rejectDeadline!:(reason:unknown)=>void;
  const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
  job.rejectDeadline=rejectDeadline;
  const timer = setTimeout(() => {
    timedOut = true;
    job.cancelled = true;
    job.render?.cancel();
    void job.loading?.destroy().catch(() => {});
    rejectDeadline(new FolioError('preview-timeout', 'PDF preview exceeded 15 seconds. Try a lower zoom.'));
  }, 15_000);
  try {
    await Promise.race([(async()=>{
    await preflightPdfImages(bytes);
    current();
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    current();
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    job.loading = pdfjs.getDocument({ ...localPdfDecoderOptions(),data: new Uint8Array(bytes),
      enableXfa: false,
      disableAutoFetch: true, disableStream: true, disableRange: true,
      useSystemFonts: false, isOffscreenCanvasSupported: false, maxImageSize: 20_000_000 });
    const document = await job.loading.promise;
    current();
    if (document.numPages > MAX_SOURCE_PAGES || pageNumber > document.numPages) {
      throw new FolioError('preview-pages', `Preview supports up to ${MAX_SOURCE_PAGES} pages and an existing page number.`);
    }
    const page = await document.getPage(pageNumber);
    current();
    const viewport = page.getViewport({ scale });
    const width = Math.ceil(viewport.width), height = Math.ceil(viewport.height);
    if (width * height > MAX_PIXELS) throw new FolioError('preview-limit', 'Preview exceeds the 16 megapixel canvas limit. Reduce zoom.');
    const staged = canvas.ownerDocument.createElement('canvas');
    staged.width = width; staged.height = height;
    job.render = page.render({ canvas: staged, viewport,
      annotationMode: pdfjs.AnnotationMode.DISABLE, background: '#ffffff' });
    await job.render.promise;
    current();
    const context = canvas.getContext('2d');
    if (!context) throw new FolioError('preview-canvas', 'A 2D canvas is required for PDF preview.');
    canvas.width = width; canvas.height = height;
    context.drawImage(staged, 0, 0);
    })(),deadline]);
  } catch (error) {
    if (timedOut) throw new FolioError('preview-timeout', 'PDF preview exceeded 15 seconds. Try a lower zoom.');
    if (job.cancelled || jobs.get(canvas)?.token !== job.token) {
      throw new FolioError('preview-cancelled', 'PDF preview was superseded.');
    }
    if (error instanceof FolioError && error.code === 'PAGE_LIMIT') {
      throw new FolioError('preview-pages', `Preview supports up to ${MAX_SOURCE_PAGES} pages and an existing page number.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    void job.loading?.destroy().catch(() => {});
    if (jobs.get(canvas)?.token === job.token) jobs.delete(canvas);
  }
}

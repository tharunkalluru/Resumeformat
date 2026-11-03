import UPNG from '@pdf-lib/upng';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Pinned PDF.js resource adapter. Decode only bounded owned raster pixels;
 * no document URL, raw image program, mask operation or external fetch. */
export async function extractPdfImage(page: PDFPageProxy, id: string): Promise<Uint8Array | undefined> {
 return (await extractOwnedPdfImage(page,id,true))?.bytes;
}
export async function extractOwnedPdfImage(page: PDFPageProxy, id:string,legacyBitmap=false):Promise<{bytes:Uint8Array;rgba:Uint8Array;width:number;height:number}|undefined> {
  // The pinned decoder shares repeated images across pages using g_ IDs.
  // Its canvas renderer uses the same pool routing; waiting in the page-local
  // pool for a shared image can never resolve.
  const pool = id.startsWith('g_') ? page.commonObjs : page.objs;
  const value: unknown = await new Promise(resolve => pool.get(id, resolve));
  if (!value || typeof value !== 'object') return;
  const image = value as { width?: number; height?: number; kind?: number; data?: unknown; bitmap?: unknown };
  const { width, height } = image;
  if (!width || !height || width<0||height<0||!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width * height > 20_000_000) return;
  let rgba: Uint8Array;
  if (image.data instanceof Uint8Array || image.data instanceof Uint8ClampedArray) {
    const data = image.data;
    if (image.kind === 3 && data.length === width * height * 4) rgba = new Uint8Array(data);
    else if (image.kind === 2 && data.length === width * height * 3) {
      rgba = new Uint8Array(width * height * 4);
      for (let source = 0, target = 0; source < data.length; source += 3, target += 4) { rgba.set(data.subarray(source, source + 3), target); rgba[target + 3] = 255; }
    } else return;
  } else if (legacyBitmap&&typeof ImageBitmap !== 'undefined' && image.bitmap instanceof ImageBitmap && typeof document !== 'undefined') {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) return;
    context.drawImage(image.bitmap, 0, 0);
    rgba = new Uint8Array(context.getImageData(0, 0, width, height).data);
  } else return;
  const bytes = new Uint8Array(UPNG.encode([rgba.buffer as ArrayBuffer], width, height, 0));
  return bytes.length <= 10 * 1024 * 1024 ? {bytes,rgba,width,height} : undefined;
}

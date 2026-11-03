// @vitest-environment node
import {MAX_SOURCE_PAGES} from '../core/model';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument, PDFName } from 'pdf-lib';
import type { Template } from '../core/model';
import { renderDocument, setFontLoader } from './pdf';
import { cancelPdfPageRender, renderPdfPage } from './preview';

let restore: () => void;
beforeAll(async () => {
  restore = setFontLoader(async file => new Uint8Array(await readFile(resolve('public/fonts', file))));
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  // PDF.js's supported Node fake-worker path runs the real local parser.
  Object.assign(globalThis, { pdfjsWorker: await import('pdfjs-dist/legacy/build/pdf.worker.mjs') });
});
afterAll(() => restore());

function targetCanvas() {
  const canvas = createCanvas(1, 1);
  Object.assign(canvas, { ownerDocument: { createElement: () => createCanvas(1, 1) } });
  return canvas;
}
async function bytes(width = 500, height = 700) {
  const template: Template = { id: 'test', revision: 1, warnings: [], importerVersion: 'fixture',
    pages: [{ id: 'page', width, height, regions: [{ kind: 'text', id: 'text', pageId: 'page', order: 1,
      contentId: 'text', sourceLocator: 'fictional:test', role: 'body',
      bounds: { x: 30, y: 40, width: 350, height: 40 }, style: { fontFamily: 'sans', fontSize: 12,
        fontWeight: 400, italic: false, color: '#172033', lineHeight: 16, alignment: 'left' } }] }] };
  return (await renderDocument(template, { revision: 1,
    blocks: [{ id: 'text', sourceFactIds: [], runs: [{ text: 'Actual locally generated PDF preview' }] }] }, [])).bytes;
}

describe('real PDF preview contract', () => {
  it('renders real generated PDF bytes to the requested scale without detaching input', async () => {
    const original = await bytes();
    const byteCount = original.length;
    const canvas = targetCanvas();
    await renderPdfPage(original, 1, canvas as unknown as HTMLCanvasElement, 1.5);
    expect(canvas.width).toBe(750);
    expect(canvas.height).toBe(1050);
    expect(original.length).toBe(byteCount);
    const data = canvas.getContext('2d').getImageData(40, 55, 650, 40).data;
    expect(Array.from(data).some((channel, index) => index % 4 !== 3 && channel < 100)).toBe(true);
  });

  it('supersedes an older request without painting stale canvas dimensions', async () => {
    const [oldBytes, latestBytes] = await Promise.all([bytes(), bytes(612, 792)]);
    const canvas = targetCanvas();
    const first = renderPdfPage(oldBytes, 1, canvas as unknown as HTMLCanvasElement).catch(error => error);
    const second = renderPdfPage(latestBytes, 1, canvas as unknown as HTMLCanvasElement);
    expect(await first).toMatchObject({ code: 'preview-cancelled' });
    await second;
    expect(canvas.width).toBe(612); expect(canvas.height).toBe(792);
  });

  it('allows an unmount cancellation and leaves the visible canvas untouched', async () => {
    const source = await bytes();
    const canvas = targetCanvas();
    const pending = renderPdfPage(source, 1, canvas as unknown as HTMLCanvasElement).catch(error => error);
    cancelPdfPageRender(canvas as unknown as HTMLCanvasElement);
    expect(await pending).toMatchObject({ code: 'preview-cancelled' });
    expect(canvas.width).toBe(1); expect(canvas.height).toBe(1);
  });

  it('bounds page numbers, zoom, input bytes, and canvas area', async () => {
    const source = await bytes();
    const canvas = targetCanvas() as unknown as HTMLCanvasElement;
    await expect(renderPdfPage(source, 1, canvas, 5)).rejects.toMatchObject({ code: 'preview-options' });
    await expect(renderPdfPage(source, 0, canvas)).rejects.toMatchObject({ code: 'preview-options' });
    await expect(renderPdfPage(new Uint8Array(32 * 1024 * 1024 + 1), 1, canvas)).rejects.toMatchObject({ code: 'preview-limit' });
    await expect(renderPdfPage(source, 2, canvas)).rejects.toMatchObject({ code: 'preview-pages' });
    const overCap = await PDFDocument.create();
    for (let index = 0; index < MAX_SOURCE_PAGES + 1; index++) overCap.addPage([500, 700]);
    await expect(renderPdfPage(new Uint8Array(await overCap.save()), 1, canvas))
      .rejects.toMatchObject({ code: 'preview-pages' });
    const large = await bytes(3000, 3000);
    await expect(renderPdfPage(large, 1, canvas, 2)).rejects.toMatchObject({ code: 'preview-limit' });
  });

  it('refuses aggregate raster allocation before decoding or changing the visible canvas', async () => {
    const document = await PDFDocument.create(), page = document.addPage([500, 700]);
    const objects = document.context.obj({});
    for (let index = 0; index < 2; index++) {
      const pixels = new Uint8Array(12_000_000); pixels[pixels.length - 1] = index;
      const image = document.context.flateStream(pixels, { Type: 'XObject', Subtype: 'Image',
        Width: 6000, Height: 2000, ColorSpace: 'DeviceGray', BitsPerComponent: 8 });
      objects.set(PDFName.of(`Image${index}`), document.context.register(image));
    }
    page.node.Resources()!.set(PDFName.of('XObject'), objects);
    page.node.set(PDFName.of('Contents'), document.context.register(document.context.flateStream(
      new TextEncoder().encode('q 1 0 0 1 10 10 cm /Image0 Do Q q 1 0 0 1 20 20 cm /Image1 Do Q'))));
    const canvas = targetCanvas();
    await expect(renderPdfPage(new Uint8Array(await document.save()), 1,
      canvas as unknown as HTMLCanvasElement)).rejects.toMatchObject({ code: 'PDF_IMAGE_PREFLIGHT' });
    expect(canvas.width).toBe(1); expect(canvas.height).toBe(1);
  });
});

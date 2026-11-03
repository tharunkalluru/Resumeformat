// @vitest-environment jsdom
// Controlled rendering promises exercise UI lifecycle only, not PDF fidelity.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfPreview } from './PdfPreview';
import type { PreviewReceipt } from './previewReview';

const preview = vi.hoisted(() => ({ render: vi.fn(), cancel: vi.fn() }));
vi.mock('../render/preview', () => ({ renderPdfPage: preview.render, cancelPdfPageRender: preview.cancel }));
interface Request { bytes: Uint8Array; page: number; canvas: HTMLCanvasElement; scale: number;
  resolve: () => void; reject: (error: Error) => void }
let root: Root, host: HTMLDivElement, requests: Request[], draw: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  requests = []; draw = vi.fn(); preview.render.mockReset(); preview.cancel.mockReset();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: draw }) as unknown as CanvasRenderingContext2D);
  preview.render.mockImplementation((bytes: Uint8Array, page: number, canvas: HTMLCanvasElement, scale: number) =>
    new Promise<void>((resolve, reject) => {
      canvas.width = 600; canvas.height = 800;
      requests.push({ bytes, page, canvas, scale, resolve, reject });
    }));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
async function mount(bytes: Uint8Array, page: number, onReady = vi.fn(), onStateChange = vi.fn(), scale = 1.5, ownerKey = 'fictional-owner') {
  await act(async () => root.render(createElement(PdfPreview, { bytes, page, label: 'Fictional preview', onReady, onStateChange, scale, ownerKey })));
  return { onReady, onStateChange };
}

describe('PDF preview observed canvas receipts', () => {
  it('publishes ready only after drawing and binds the originating bytes, page and scale', async () => {
    const bytes = new Uint8Array([1]), callbacks = await mount(bytes, 2);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onStateChange.mock.calls[0][0]).toMatchObject({ bytes, page: 2, scale: 1.5, state: 'loading' });
    await act(async () => requests[0].resolve());
    expect(draw).toHaveBeenCalledOnce(); expect(draw.mock.calls[0][0]).toBe(requests[0].canvas);
    const receipt = callbacks.onReady.mock.calls[0][0] as PreviewReceipt;
    expect(receipt.bytes).toBe(bytes); expect(receipt).toMatchObject({ page: 2, scale: 1.5, state: 'ready' });
    expect(host.querySelector('canvas')?.width).toBe(600);
    expect(host.querySelector('canvas')?.style.visibility).toBe('visible');
  });
  it('never paints or grants readiness from an older byte/page request after replacement', async () => {
    const oldBytes = new Uint8Array([1]), latestBytes = new Uint8Array([2]), ready = vi.fn();
    await mount(oldBytes, 1, ready); await mount(latestBytes, 2, ready);
    await act(async () => requests[0].resolve());
    expect(draw).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
    await act(async () => requests[1].resolve());
    expect(ready).toHaveBeenCalledOnce(); expect(ready.mock.calls[0][0].bytes).toBe(latestBytes);
    expect(ready.mock.calls[0][0].page).toBe(2); expect(preview.cancel).toHaveBeenCalledWith(requests[0].canvas);
  });
  it('captures the request callback instead of handing old work to a newly supplied callback', async () => {
    const bytes = new Uint8Array([1]), first = vi.fn(), replacement = vi.fn();
    await mount(bytes, 1, first); await mount(bytes, 1, replacement);
    expect(requests).toHaveLength(1); await act(async () => requests[0].resolve());
    expect(first).toHaveBeenCalledOnce(); expect(replacement).not.toHaveBeenCalled();
  });
  it('refuses readiness when the visible canvas has no context', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const callbacks = await mount(new Uint8Array([1]), 1); await act(async () => requests[0].resolve());
    expect(callbacks.onReady).not.toHaveBeenCalled(); expect(draw).not.toHaveBeenCalled();
    expect(callbacks.onStateChange.mock.calls.at(-1)?.[0].state).toBe('error');
    expect(host.querySelector('canvas')?.style.visibility).toBe('hidden');
  });
  it('refuses readiness after a failed actual canvas draw', async () => {
    draw.mockImplementation(() => { throw new Error('Controlled canvas draw failure'); });
    const callbacks = await mount(new Uint8Array([1]), 1); await act(async () => requests[0].resolve());
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onStateChange.mock.calls.at(-1)?.[0].state).toBe('error');
    expect(host.textContent).toContain('Controlled canvas draw failure');
  });
  it('reports parser/render refusal without a ready callback', async () => {
    const callbacks = await mount(new Uint8Array([1]), 1);
    await act(async () => requests[0].reject(new Error('Controlled PDF parser refusal')));
    expect(draw).not.toHaveBeenCalled(); expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onStateChange.mock.calls.map(([r]) => r.state)).toEqual(['loading', 'error']);
  });
  it('cancels unmounted work and does not send its later success or error', async () => {
    const callbacks = await mount(new Uint8Array([1]), 1);
    await act(async () => root.render(null)); await act(async () => requests[0].resolve());
    expect(draw).not.toHaveBeenCalled(); expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onStateChange.mock.calls).toHaveLength(1);
  });
  it('binds a changed render scale and rejects the superseded scale request', async () => {
    const bytes = new Uint8Array([1]), ready = vi.fn();
    await mount(bytes, 1, ready, vi.fn(), 1); await mount(bytes, 1, ready, vi.fn(), 2);
    await act(async () => requests[0].resolve()); expect(ready).not.toHaveBeenCalled();
    await act(async () => requests[1].resolve()); expect(ready.mock.calls[0][0].scale).toBe(2);
  });
  it('starts a new request for a different owner sharing the exact same PDF byte object', async () => {
    const bytes = new Uint8Array([1]), ready = vi.fn();
    await mount(bytes, 1, ready, vi.fn(), 1.5, 'fictional-old-project');
    await mount(bytes, 1, ready, vi.fn(), 1.5, 'fictional-new-project');
    expect(requests).toHaveLength(2);
    await act(async () => requests[0].resolve());
    expect(draw).not.toHaveBeenCalled(); expect(ready).not.toHaveBeenCalled();
    await act(async () => requests[1].resolve());
    expect(ready).toHaveBeenCalledOnce(); expect(ready.mock.calls[0][0].bytes).toBe(bytes);
    expect(ready.mock.calls[0][0].ownerKey).toBe('fictional-new-project');
  });
  it('hides already-painted old-owner pixels while the same-byte new owner is still loading', async () => {
    const bytes = new Uint8Array([1]);
    await mount(bytes, 1, vi.fn(), vi.fn(), 1.5, 'fictional-old-project');
    await act(async () => requests[0].resolve());
    expect(host.querySelector('canvas')?.style.visibility).toBe('visible');
    const callbacks = await mount(bytes, 1, vi.fn(), vi.fn(), 1.5, 'fictional-new-project');
    expect(host.querySelector('canvas')?.style.visibility).toBe('hidden');
    expect(callbacks.onReady).not.toHaveBeenCalled(); expect(host.textContent).toContain('Preparing page');
    await act(async () => requests[1].resolve());
    expect(host.querySelector('canvas')?.style.visibility).toBe('visible');
  });
});

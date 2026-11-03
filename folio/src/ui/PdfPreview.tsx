import { useEffect, useMemo, useRef, useState } from 'react';
import { FileText, LoaderCircle } from 'lucide-react';
import { cancelPdfPageRender, renderPdfPage } from '../render/preview';
import type { PreviewReceipt } from './previewReview';

export function PdfPreview({ bytes, page, label, scale = 1.5, ownerKey = '', onReady, onStateChange }: { bytes: Uint8Array; page: number; label: string; scale?: number; ownerKey?: string; onReady?: (receipt: PreviewReceipt) => void; onStateChange?: (receipt: PreviewReceipt) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onReady, onStateChange }); callbacks.current = { onReady, onStateChange };
  const identity = useMemo(() => Symbol('pdf-preview-view'), [bytes, page, scale, ownerKey]);
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [settledIdentity, setSettledIdentity] = useState<symbol | null>(null);
  const [error, setError] = useState('');
  const [aspectRatio, setAspectRatio] = useState('612 / 792');
  useEffect(() => {
    let active = true;
    const requestCallbacks = callbacks.current;
    const current = () => active && currentIdentity.current === identity;
    const receipt = (state: PreviewReceipt['state']): PreviewReceipt => ({ ownerKey, bytes, page, scale, state });
    setState('loading');
    setSettledIdentity(identity);
    requestCallbacks.onStateChange?.(receipt('loading'));
    // Render off-screen: stale work must never paint over a newer preview.
    const buffer = document.createElement('canvas');
    void renderPdfPage(new Uint8Array(bytes), page, buffer, scale).then(() => {
      if (!current() || !canvas.current) return;
      const context = canvas.current.getContext('2d');
      if (!context) throw new Error('The PDF preview needs an available canvas to display this page.');
      canvas.current.width = buffer.width;
      canvas.current.height = buffer.height;
      context.drawImage(buffer, 0, 0);
      setAspectRatio(`${buffer.width} / ${buffer.height}`);
      setState('ready');
      requestCallbacks.onStateChange?.(receipt('ready'));
      requestCallbacks.onReady?.(receipt('ready'));
    }).catch((reason: unknown) => {
      if (!current()) return;
      setError(reason instanceof Error ? reason.message : 'The document preview could not be rendered.');
      setState('error');
      requestCallbacks.onStateChange?.(receipt('error'));
    });
    return () => { active = false; cancelPdfPageRender(buffer); };
  }, [bytes, page, scale, ownerKey, identity]);
  const displayedState = settledIdentity === identity ? state : 'loading';
  return <div className="pdf-preview" style={{ aspectRatio }}>
    <canvas ref={canvas} aria-label={label} role="img" style={{ visibility: displayedState === 'ready' ? 'visible' : 'hidden' }} />
    {displayedState !== 'ready' && <div className="preview-placeholder" role={displayedState === 'error' ? 'alert' : 'status'}>{displayedState === 'loading' ? <><LoaderCircle className="spin" size={20} /> Preparing page</> : <><FileText size={20} />{error}</>}</div>}
  </div>;
}

export function DocxReference({ bytes, page = 1 }: { bytes: Uint8Array; page?: number }) {
  const target = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [referencePages, setReferencePages] = useState(0);
  const [referenceRevision, setReferenceRevision] = useState(0);
  const [fit, setFit] = useState({ width: 816, height: 1056, scale: 1 });
  useEffect(() => {
    let active = true;
    setError('');
    target.current?.replaceChildren(); setReferencePages(0);
    const buffer = document.createElement('div');
    void import('../import/docxReference').then(async ({ renderDocxReference }) => {
      if (active) await renderDocxReference(new Uint8Array(bytes), buffer);
    }).then(() => {
      if (active && target.current) { target.current.replaceChildren(...Array.from(buffer.childNodes)); setReferencePages(target.current.querySelectorAll('section.folio-docx').length); setReferenceRevision(value => value + 1); }
    }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : 'The DOCX reference is unavailable.'); });
    return () => { active = false; };
  }, [bytes]);
  useEffect(() => {
    if (!target.current || !viewport.current) return;
    const documentElement = target.current, frame = viewport.current;
    documentElement.querySelectorAll<HTMLElement>('section.folio-docx').forEach((section, index) => { section.style.display = index === page - 1 ? '' : 'none'; section.dataset.referencePage = String(index + 1); });
    const measure = () => {
      const firstPage = Array.from(documentElement.querySelectorAll<HTMLElement>('section.folio-docx')).find(section => section.style.display !== 'none');
      if (!firstPage || !frame.clientWidth) return;
      const width = firstPage.offsetWidth || 816;
      const next = { width, height: Math.max(firstPage.offsetHeight, documentElement.scrollHeight), scale: Math.min(1, frame.clientWidth / width) };
      setFit(previous => previous.width === next.width && previous.height === next.height && Math.abs(previous.scale - next.scale) < .0001 ? previous : next);
    };
    const resized = new ResizeObserver(measure), mutated = new MutationObserver(measure);
    resized.observe(frame); resized.observe(documentElement);
    mutated.observe(documentElement, { childList: true, subtree: true });
    void document.fonts.ready.then(measure);
    return () => { resized.disconnect(); mutated.disconnect(); };
  }, [bytes, error, page, referenceRevision]);
  return <div className="docx-reference"><p className="reference-caution">DOCX reference — browser rendering; Word pagination may differ.{referencePages > 0 && page <= referencePages ? ` Browser page ${page} of ${referencePages}.` : ''}</p>{referencePages > 0 && page > referencePages && <p role="status">The browser reference has {referencePages} {referencePages === 1 ? 'page' : 'pages'} and cannot align reconstructed page {page}. Compare a PDF exported from Word to verify pagination.</p>}{error ? <p role="alert">{error}</p> : <div ref={viewport} className="docx-reference-viewport" style={{ height: fit.height * fit.scale, display: referencePages > 0 && page > referencePages ? 'none' : undefined }}><div ref={target} className="docx-reference-document" style={{ width: fit.width, transform: `scale(${fit.scale})` }} /></div>}</div>;
}

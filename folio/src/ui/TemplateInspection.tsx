import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AlertCircle, ArrowRight, Check, ChevronLeft, ChevronRight, Columns2, FileText, Layers, LockKeyhole, Minus, Plus, ScanLine } from 'lucide-react';
import { hasValidApproval, type Project, type RenderedDocument } from '../core/model';
import { DocxReference, PdfPreview } from './PdfPreview';
import { previewOwnerKey, type PreviewReceipt, type PreviewStamp } from './previewReview';
import { comparisonGeometry, currentInspectionRender, inspectionOwner, observedPreviewCurrent, templateDiagnostics, templateSupport, type ObservedPreview, type TemplateDiagnostic } from './templateDiagnostics';
import './template-inspection.css';

export interface TemplateInspectionProps {
  project: Project;
  baselineRender: RenderedDocument | null;
  baselineStamp: PreviewStamp | null;
  page: number;
  onPageChange: (page: number) => void;
  onSourcePreviewState: (receipt: PreviewReceipt) => void;
  onBaselinePreviewState: (receipt: PreviewReceipt) => void;
  /** Existing repair selection; inspection itself never mutates the document. */
  selectedRegionId?: string | null;
  onSelectRegion?: (regionId: string, page: number) => void;
}

type Mode = 'side' | 'overlay' | 'difference';
interface PageObservation { source: ObservedPreview | null; baseline: ObservedPreview | null }
const emptyObservation: PageObservation = { source: null, baseline: null };

/** Preview receipts come exclusively from PdfPreview's actual visible canvas draw. */
export function TemplateInspection(props: TemplateInspectionProps) {
  const { project, page, onPageChange, selectedRegionId, onSelectRegion } = props;
  const render = currentInspectionRender(project, props.baselineRender, props.baselineStamp);
  const support = useMemo(() => templateSupport(project), [project.template]);
  const diagnostics = useMemo(() => templateDiagnostics(project, render), [project.template, project.source, render]);
  const sourceOwner = inspectionOwner(project, 'source'), baselineOwner = inspectionOwner(project, 'baseline');
  const sourceOwnerKey = previewOwnerKey(sourceOwner), baselineOwnerKey = previewOwnerKey(baselineOwner);
  const [mode, setMode] = useState<Mode>('side');
  const [zoom, setZoom] = useState(1);
  const [opacity, setOpacity] = useState(50);
  const [activeIssueId, setActiveIssueId] = useState<string | null>(null);
  const [observed, setObserved] = useState<Map<number, PageObservation>>(() => new Map());
  const [viewportWidth, setViewportWidth] = useState(0);
  const viewport = useRef<HTMLDivElement>(null);
  const sourceFrame = useRef<HTMLDivElement>(null);
  const baselineFrame = useRef<HTMLDivElement>(null);
  const highlight = useRef<HTMLDivElement>(null);
  const issueList = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = useRef({ props, render, page, sourceOwnerKey, baselineOwnerKey });
  current.current = { props, render, page, sourceOwnerKey, baselineOwnerKey };
  const sourceCount = project.source.sourcePageCount ?? project.template.pages.length;
  const pageCount = Math.max(sourceCount, project.template.pages.length);
  const templatePage = project.template.pages[page - 1];
  const pageObservation = observed.get(page) ?? emptyObservation;
  const geometry = comparisonGeometry(project, render, page, pageObservation.source, pageObservation.baseline);
  const displayedMode = geometry === 'ready' ? mode : 'side';
  const geometryMessage = geometry === 'docx' ? 'DOCX is a browser reference. Word fonts and pagination can differ; pixel overlays are unavailable.'
    : geometry === 'mismatch' ? 'These rendered pages have different dimensions. Compare them side by side at the same scale; an overlay would distort one page.'
      : geometry === 'missing-page' ? 'One document has no corresponding page. Review the page count difference before approval.'
        : geometry === 'pending' ? 'Overlay and difference views become available when both current PDF pages finish rendering.' : null;
  const activeIssue = diagnostics.find(issue => issue.id === activeIssueId);
  const selectedRegion = templatePage?.regions.find(region => region.id === selectedRegionId);
  const selectedBounds = activeIssue?.page === page && activeIssue.bounds ? activeIssue.bounds : selectedRegion?.bounds;
  const blockingCount = diagnostics.filter(issue => issue.severity === 'blocking').length;
  const reviewCount = diagnostics.filter(issue => issue.severity === 'review').length;
  const readySource = observedPreviewCurrent(pageObservation.source, sourceOwner, project.source.bytes, page);
  const readyBaseline = !!render && observedPreviewCurrent(pageObservation.baseline, baselineOwner, render.bytes, page);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const measure = () => setViewportWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    // Old ready-page receipts carry byte identity and cannot satisfy the new owner.
    // Keep an unchanged source's observation when only reconstruction bytes change.
    // Every read checks the full owner and byte identity, so old entries grant no credit.
    setActiveIssueId(null); setMode('side'); setZoom(1);
  }, [project.id, project.source.bytes, baselineOwnerKey, render?.bytes]);
  useEffect(() => {
    if (activeIssue?.page === page && highlight.current && viewport.current && readyBaseline) {
      const box = highlight.current.getBoundingClientRect(), frame = viewport.current.getBoundingClientRect();
      viewport.current.scrollTo({ top: Math.max(0, viewport.current.scrollTop + box.top - frame.top - 72),
        left: Math.max(0, viewport.current.scrollLeft + box.left - frame.left - 32), behavior: 'auto' });
    }
  }, [activeIssueId, page, readyBaseline]);

  function observe(kind: 'source' | 'baseline', receipt: PreviewReceipt) {
    const latest = current.current;
    const expectedBytes = kind === 'source' ? latest.props.project.source.bytes : latest.render?.bytes;
    const expectedOwner = kind === 'source' ? latest.sourceOwnerKey : latest.baselineOwnerKey;
    if (receipt.bytes !== expectedBytes || receipt.ownerKey !== expectedOwner || receipt.page !== latest.page || receipt.scale !== 1.5) return;
    const canvas = (kind === 'source' ? sourceFrame : baselineFrame).current?.querySelector('canvas');
    const observation = { receipt, width: receipt.state === 'ready' ? canvas?.width ?? 0 : 0,
      height: receipt.state === 'ready' ? canvas?.height ?? 0 : 0 };
    setObserved(previous => new Map(previous).set(receipt.page, { ...(previous.get(receipt.page) ?? emptyObservation), [kind]: observation }));
    if (kind === 'source') latest.props.onSourcePreviewState(receipt);
    else latest.props.onBaselinePreviewState(receipt);
  }

  function navigate(nextPage: number) {
    setActiveIssueId(null); onPageChange(nextPage);
    viewport.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }
  function inspectIssue(issue: TemplateDiagnostic) {
    setActiveIssueId(issue.id);
    if (issue.page) {
      onPageChange(issue.page);
      if (issue.regionId) onSelectRegion?.(issue.regionId, issue.page);
    }
  }
  function nextIssue() {
    if (!diagnostics.length) return;
    const index = diagnostics.findIndex(issue => issue.id === activeIssueId);
    const next = diagnostics[(index + 1) % diagnostics.length];
    inspectIssue(next);
    const element = issueList.current?.querySelector<HTMLElement>(`[data-issue-index="${(index + 1) % diagnostics.length}"]`);
    element?.focus({ preventScroll: true });
  }

  // Both widths derive from one point scale. Mismatched originals are never stretched to fit.
  const sourceWidth = readySource ? pageObservation.source!.width / 1.5 : templatePage?.width ?? 612;
  const baselineWidth = readyBaseline ? pageObservation.baseline!.width / 1.5 : templatePage?.width ?? 612;
  const largestWidth = Math.max(sourceWidth, baselineWidth);
  const fitWidth = Math.max(100, ((viewportWidth || 700) - 32 - (displayedMode === 'side' ? 24 : 0)) / (displayedMode === 'side' ? 2 : 1));
  const displayScale = fitWidth / largestWidth * zoom;
  const stageStyle = { '--inspection-source-width': `${sourceWidth * displayScale}px`,
    '--inspection-baseline-width': `${baselineWidth * displayScale}px`, '--inspection-opacity': opacity / 100 } as CSSProperties;
  const originalReplay = render?.sourceReplay === 'original-baseline' || render?.sourceReplay === 'original-type1-baseline';

  return <section className="template-inspection" aria-label="Template inspection">
    <div className="inspection-summary">
      <span className={`inspection-support inspection-support-${support.kind}`}>{support.kind === 'read-only' ? <LockKeyhole size={15} /> : <FileText size={15} />}{support.label}</span>
      <span className="inspection-summary-state">{blockingCount ? `${blockingCount} blocking ${blockingCount === 1 ? 'issue' : 'issues'}` : reviewCount ? `${reviewCount} ${reviewCount === 1 ? 'detail' : 'details'} to review` : 'Visual review required'}</span>
      <p>{support.description}</p>
    </div>

    <div className="inspection-toolbar">
      <div className="inspection-modes" role="group" aria-label="Comparison view">
        <button type="button" aria-pressed={displayedMode === 'side'} onClick={() => setMode('side')}><Columns2 size={15} />Side by side</button>
        <button type="button" aria-pressed={displayedMode === 'overlay'} disabled={geometry !== 'ready'} aria-describedby={geometryMessage ? `${id}-geometry` : undefined} onClick={() => setMode('overlay')}><Layers size={15} />Overlay</button>
        <button type="button" aria-pressed={displayedMode === 'difference'} disabled={geometry !== 'ready'} aria-describedby={geometryMessage ? `${id}-geometry` : undefined} onClick={() => setMode('difference')}><ScanLine size={15} />Difference</button>
      </div>
      <div className="inspection-zoom" role="group" aria-label="Synchronized preview zoom">
        <button type="button" aria-label="Zoom out both previews" disabled={zoom <= .75} onClick={() => setZoom(value => Math.max(.75, value - .25))}><Minus size={15} /></button>
        <button type="button" className="inspection-fit" onClick={() => { setZoom(1); viewport.current?.scrollTo({ top: 0, left: 0 }); }} aria-label="Fit both previews to width">{zoom === 1 ? 'Fit' : `${Math.round(zoom * 100)}%`}</button>
        <button type="button" aria-label="Zoom in both previews" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + .25))}><Plus size={15} /></button>
      </div>
    </div>
    {geometryMessage && <p className="inspection-mode-note" id={`${id}-geometry`} role="status">{geometryMessage}</p>}
    {displayedMode === 'overlay' && <label className="inspection-opacity" htmlFor={`${id}-opacity`}><span>Original</span><input id={`${id}-opacity`} aria-label="Reconstruction opacity" type="range" min="0" max="100" step="5" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /><span>Reconstruction · {opacity}%</span></label>}
    {displayedMode === 'difference' && <p className="inspection-mode-note">Black areas match rendered pixels; visible marks indicate differences. Anti-aliasing may also produce marks. This view is not an accuracy score.</p>}

    <div className="inspection-page-navigation">
      <button type="button" aria-label="Previous comparison page" disabled={page <= 1} onClick={() => navigate(page - 1)}><ChevronLeft size={16} /></button>
      <nav className="inspection-pages" aria-label="Comparison pages">{Array.from({ length: pageCount }, (_, index) => {
        const number = index + 1, observation = observed.get(number);
        const sourceReady = project.source.format !== 'pdf' || observedPreviewCurrent(observation?.source ?? null, sourceOwner, project.source.bytes, number);
        const baselineReady = !!render && observedPreviewCurrent(observation?.baseline ?? null, baselineOwner, render.bytes, number);
        const ready = sourceReady && baselineReady;
        const count = diagnostics.filter(issue => issue.page === number && issue.severity !== 'info').length;
        return <button type="button" key={number} aria-current={page === number ? 'page' : undefined} aria-label={`Page ${number}${ready ? ', previews loaded' : ''}${count ? `, ${count} issues` : ''}`} onClick={() => navigate(number)}><span>{number}</span>{count ? <span className="inspection-page-issue" aria-hidden="true" /> : ready ? <Check size={12} aria-hidden="true" /> : null}</button>;
      })}</nav>
      <button type="button" aria-label="Next comparison page" disabled={page >= pageCount} onClick={() => navigate(page + 1)}><ChevronRight size={16} /></button>
      <span className="inspection-page-count">Page {page} of {pageCount}</span>
    </div>

    <div className="inspection-viewport" ref={viewport} tabIndex={0} role="region" aria-label="Synchronized document previews" aria-describedby={`${id}-caption`}>
      <div className={`inspection-stage inspection-mode-${displayedMode}`} style={stageStyle}>
        <div className="inspection-column inspection-source">
          <div className="inspection-paper-label"><strong>Original source</strong><span>{project.source.format === 'pdf' ? `PDF · Page ${page}${page <= sourceCount ? ` of ${sourceCount}` : ' unavailable'}` : 'DOCX · Browser reference'}</span></div>
          <div ref={sourceFrame} className="inspection-paper inspection-original-paper">{page > sourceCount && project.source.format === 'pdf'
            ? <div className="inspection-placeholder">The original has no page {page}.</div>
            : project.source.format === 'pdf'
              ? <PdfPreview bytes={project.source.bytes} page={page} label={`Original resume page ${page}`} ownerKey={sourceOwnerKey} scale={1.5} onStateChange={receipt => observe('source', receipt)} />
              : <DocxReference bytes={project.source.bytes} page={page} />}</div>
        </div>
        <div className="inspection-column inspection-baseline">
          <div className="inspection-paper-label"><strong>{originalReplay ? 'Original layout preview' : 'Reconstructed template'}</strong><span>{hasValidApproval(project) ? 'Approved template' : 'Review required'}</span></div>
          <div ref={baselineFrame} className="inspection-paper inspection-reconstruction-paper">{!templatePage
            ? <div className="inspection-placeholder">The template has no page {page}.</div>
            : render
              ? <PdfPreview bytes={render.bytes} page={page} label={`Reconstructed template page ${page}`} ownerKey={baselineOwnerKey} scale={1.5} onStateChange={receipt => observe('baseline', receipt)} />
              : <div className="inspection-placeholder" role="status">Preparing the current reconstruction…</div>}
          </div>
        </div>
        {selectedBounds && templatePage && readyBaseline && <div className="inspection-mark-column" aria-hidden="true"><div className="inspection-mark-paper" style={{ width: `${baselineWidth * displayScale}px`, height: `${pageObservation.baseline!.height / 1.5 * displayScale}px` }}><div ref={highlight} className="inspection-region-highlight" style={{ left: `${selectedBounds.x / templatePage.width * 100}%`, top: `${selectedBounds.y / templatePage.height * 100}%`, width: `${selectedBounds.width / templatePage.width * 100}%`, height: `${selectedBounds.height / templatePage.height * 100}%` }} /></div></div>}
      </div>
    </div>
    <p className="inspection-caption" id={`${id}-caption`}>{project.source.format === 'pdf' ? 'Zoom and scrolling stay synchronized. Compare fonts, spacing, borders, photos, links and every page before approval.' : 'The DOCX reference is approximate. A PDF exported from Word provides a stronger visual reference.'} Loaded-page indicators confirm rendering, not approval.</p>

    <div className="inspection-diagnostics">
      <div className="inspection-diagnostics-heading"><h2>Inspection details <span>{diagnostics.length}</span></h2>{diagnostics.length > 0 && <button type="button" onClick={nextIssue}>Next detail<ArrowRight size={14} /></button>}</div>
      {!diagnostics.length ? <p className="inspection-no-issues">No import or baseline layout issues were reported. Compare the actual pages to confirm appearance; this does not guarantee an exact match.</p> : <div ref={issueList} className="inspection-issue-list">{diagnostics.map((issue, index) => <button type="button" key={issue.id} data-issue-index={index} className={`inspection-issue inspection-issue-${issue.severity}`} aria-pressed={activeIssueId === issue.id} onClick={() => inspectIssue(issue)}>
        <AlertCircle size={16} aria-hidden="true" /><span><strong>{issue.title}</strong><span>{issue.message}</span><small>{issue.severity === 'blocking' ? 'Blocks approval' : issue.severity === 'review' ? 'Review required' : 'Information'} · {issue.page ? `Page ${issue.page}${issue.bounds ? ' · Region highlighted when selected' : ''}` : 'Document-wide detail'}</small></span>{issue.page && <ArrowRight size={14} aria-hidden="true" />}
      </button>)}</div>}
    </div>
  </section>;
}

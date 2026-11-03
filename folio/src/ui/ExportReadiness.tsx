import { useId, useMemo } from 'react';
import { ArrowDownToLine, ArrowRight, Check, CircleAlert, FileSearch } from 'lucide-react';
import type { Project } from '../core/model';
import { exportReadinessItems, inspectDocumentReadability, type ExportReadinessState, type ReadinessAction } from './readinessModel';
import './review-upgrade.css';

export interface ExportReadinessProps {
  project: Project;
  state: ExportReadinessState;
  busy?: boolean;
  onAction: (action: ReadinessAction) => void;
}

/** Navigation only. The caller's canonical download handler revalidates the
 * exact current revision, source proof, saved state and inspected PDF bytes. */
export function ExportReadiness({ project, state, busy = false, onAction }: ExportReadinessProps) {
  const headingId = useId();
  const items = exportReadinessItems(project, state);
  const required = items.filter(item => item.kind === 'required');
  const review = items.filter(item => item.kind === 'review');
  const next = required[0];
  const checks = [
    ['Template approved', state.approved], ['Current draft saved', state.currentSaved],
    ['Current canvas checked', state.canvasCheckCurrent], ['Current layout rendered', state.renderCurrent && state.renderStatus === 'ready'],
    ['Current PDF inspected', state.pdfInspected], ['Current claims confirmed', state.claimsConfirmed],
  ] as const;
  return <section className="upgrade-readiness" aria-labelledby={headingId}>
    <header><div><p className="upgrade-eyebrow">Before you download</p><h3 id={headingId}>{state.exportReady ? 'Your PDF is ready' : 'Finish your review'}</h3></div><span className={`upgrade-readiness-count ${state.exportReady ? 'ready' : ''}`} aria-label={state.exportReady ? 'Export checks complete' : `${required.length} checks need attention`}>{state.exportReady ? <Check size={18} /> : required.length}</span></header>
    <p className="upgrade-readiness-summary">{state.exportReady ? 'Download the exact current PDF you inspected.' : 'Each check takes you to the place that needs attention.'}</p>
    {!!required.length && <ol className="upgrade-readiness-list">{required.map(item => <li key={item.id}><CircleAlert size={16} aria-hidden="true"/><div><strong>{item.title}</strong><p>{item.detail}</p><button className="text-button" disabled={busy} onClick={() => onAction(item.action)}>{item.actionLabel}<ArrowRight size={13}/></button></div></li>)}</ol>}
    {!!review.length && <details className="upgrade-source-checks"><summary>{review.length} {review.length === 1 ? 'paragraph has' : 'paragraphs have'} wording to check against sources</summary><p>Linked evidence is shown for your review. It is not an automatic assessment of whether a claim is true.</p><ul>{review.map(item => <li key={item.id}><p>{item.detail}</p><button className="text-button" disabled={busy} onClick={() => onAction(item.action)}>{item.actionLabel}<ArrowRight size={13}/></button></li>)}</ul></details>}
    <details className="upgrade-complete-checks"><summary>{checks.filter(([, done]) => done).length} of {checks.length} review milestones complete</summary><ul>{checks.map(([label, done]) => <li key={label}><span aria-hidden="true">{done ? '✓' : '○'}</span>{label}<span className="visually-hidden">: {done ? 'complete' : 'pending'}</span></li>)}</ul><p>All current export checks still apply, including document fit and supported source rendering.</p></details>
    <div className="upgrade-readiness-actions">{!state.exportReady && next && <button className="button button-primary" disabled={busy} onClick={() => onAction(next.action)}>{next.actionLabel}<ArrowRight size={15}/></button>}<button className={`button ${state.exportReady ? 'button-primary' : 'button-secondary'}`} disabled={!state.exportReady || busy} onClick={() => { if (state.exportReady && !busy) onAction({ kind: 'download' }); }}><ArrowDownToLine size={15}/>Download PDF</button></div>
    <DocumentReadability project={project} onLocate={onAction}/>
  </section>;
}

export function DocumentReadability({ project, onLocate }: { project: Project; onLocate: (action: Extract<ReadinessAction, { kind: 'region' }>) => void }) {
  const report = useMemo(() => inspectDocumentReadability(project), [project.template, project.draft]);
  return <details className="upgrade-readability"><summary><FileSearch size={16}/>Inspect extracted text</summary>
    <p>This is the current document’s text in its saved extraction order. Check that names, dates and sections read sensibly. Different application systems may interpret a PDF differently.</p>
    <p className="upgrade-readability-count">{report.pages.length} {report.pages.length === 1 ? 'page' : 'pages'} · {report.characters.toLocaleString()} extracted characters · checked on this device</p>
    {report.originalPaint && <p className="upgrade-readability-note">Some original PDF artwork is preserved directly. This text view may not represent all visible content. Editing is available only where the document canvas verifies support.</p>}
    {!!report.globalWarnings.length && <details><summary>{report.globalWarnings.length} document import observations</summary><ul>{report.globalWarnings.map(warning => <li key={warning.id}>{warning.message}</li>)}</ul></details>}
    {report.pages.map(page => <details className="upgrade-readability-page" key={page.pageId}><summary>Page {page.number}<span>{page.passages.length} text regions</span></summary>
      {page.images > 0 && <p>{page.images} {page.images === 1 ? 'image is' : 'images are'} outside this extracted text view.</p>}
      {page.shapes > 0 && <p>{page.shapes} source {page.shapes === 1 ? 'symbol is' : 'symbols are'} preserved as artwork.</p>}
      {page.missingText > 0 && <p>{page.missingText} text {page.missingText === 1 ? 'region is' : 'regions are'} empty. Compare with the visible page.</p>}
      {page.uncertainCharacters > 0 && <p>{page.uncertainCharacters} {page.uncertainCharacters === 1 ? 'region contains' : 'regions contain'} an unrecognized or control character. Inspect the original text.</p>}
      {!!page.warnings.length && <details><summary>Import observations for this page</summary><ul>{page.warnings.map(warning => <li key={warning.id}>{warning.message}</li>)}</ul></details>}
      {!page.passages.length ? <p>No text regions were extracted for this page. Inspect the visible PDF before using it.</p> : <ol>{page.passages.map((passage, index) => <li key={passage.regionId}><button className="upgrade-passage" onClick={() => onLocate({ kind: 'region', pageId: passage.pageId, regionId: passage.regionId, blockId: passage.blockId })}><span className="upgrade-passage-heading"><span>{index + 1} · {passage.role}</span><span>Locate<ArrowRight size={12}/></span></span><span className="upgrade-passage-text">{passage.text || 'Empty text region'}</span>{passage.baselineOnly && <small>Original text preserved · this source span is read-only</small>}</button></li>)}</ol>}
    </details>)}
  </details>;
}

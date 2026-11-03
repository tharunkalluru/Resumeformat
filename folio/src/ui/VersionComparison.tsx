import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, FileText } from 'lucide-react';
import type { FolioVersion, Project, RenderedDocument } from '../core/model';
import { renderProjectDocument, renderProjectHistory } from '../render/pdf';
import { PdfPreview } from './PdfPreview';
import { versionDifferences } from './versionDifferences';

/** Both sides use the application's immutable template and its original fonts. */
export function VersionComparison({ project, version, onRestore, restoreInHeader = false }: { project: Project; version: FolioVersion; onRestore: () => void; restoreInHeader?: boolean }) {
  const [renders, setRenders] = useState<RenderedDocument[] | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1), [selectedId, setSelectedId] = useState<string | null>(null);
  const paperArea = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let active = true; setRenders(null); setError('');
    void Promise.all([renderProjectHistory(project, version.id), renderProjectDocument(project, 'current')])
      .then(value => { if (active) setRenders(value); }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Comparison could not be rendered.'); });
    return () => { active = false; };
  }, [project.id, project.template, project.draft, project.assets, project.approval, project.folio?.versions, version]);
  const differences = versionDifferences(project, version);
  const selected = selectedId === null ? differences[0] : differences.find(change => change.id === selectedId);
  const viewPage = Math.min(selected?.page ?? page, project.template.pages.length);
  const currentPage = project.template.pages[viewPage - 1];
  const selectedRegion = currentPage.regions.find(region => region.kind === 'text' && region.contentId === selected?.id);
  const jumpToPassage = useCallback(() => {
    for (const viewport of paperArea.current?.querySelectorAll<HTMLElement>('.folio-compare-paper-scroll') ?? []) {
      const marker = viewport.querySelector<HTMLElement>('.folio-compare-location');
      if (marker) viewport.scrollTop = Math.max(0, marker.offsetTop - viewport.clientHeight / 3);
    }
  }, []);
  useEffect(() => { const frame = requestAnimationFrame(jumpToPassage); return () => cancelAnimationFrame(frame); }, [selected?.id, viewPage, renders, jumpToPassage]);
  return <div className="folio-version-compare">
    <div className="folio-compare-heading"><p>Saved {new Date(version.createdAt).toLocaleString()} · Same original page size and layout.</p>
      <label className="folio-compare-page">Page<select value={viewPage} onChange={event => { setSelectedId(''); setPage(Number(event.target.value)); }}>{project.template.pages.map((item, index) => <option key={item.id} value={index + 1}>{index + 1} of {project.template.pages.length}</option>)}</select></label>
    </div>
    <div className="folio-compare-layout">
      <div ref={paperArea} className="folio-compare-papers">
        {error ? <p role="alert">{error}</p> : !renders ? <p role="status">Preparing the saved and current PDFs…</p> : renders.map((render, index) => <section key={index}><h3><FileText size={14} aria-hidden="true" />{index ? 'Current draft' : 'Saved version'}</h3>
          <div className="folio-compare-paper-scroll"><div className="folio-compare-paper-inner"><PdfPreview bytes={render.bytes} page={viewPage} label={`${index ? 'Current draft' : 'Saved version'} page ${viewPage}`} onReady={() => requestAnimationFrame(jumpToPassage)} />
            {selectedRegion && <div className="folio-compare-location" aria-hidden="true" style={{ left: `${selectedRegion.bounds.x / currentPage.width * 100}%`, top: `${selectedRegion.bounds.y / currentPage.height * 100}%`, width: `${selectedRegion.bounds.width / currentPage.width * 100}%`, height: `${selectedRegion.bounds.height / currentPage.height * 100}%` }} />}
          </div></div>{render.layout.overflows.map(issue => <p className="folio-source-alert" key={`${issue.regionId}-${issue.code}`}>{issue.message}</p>)}</section>)}
      </div>
      <aside className="folio-compare-differences" aria-label="Version differences"><h3>{differences.length} {differences.length === 1 ? 'difference' : 'differences'}</h3>
        <p className="folio-diff-legend"><del>Removed</del><ins>Added</ins> · Select to locate on both pages.</p>
        {differences.length ? differences.map(change => <article className={`folio-compare-wording ${selected?.id === change.id ? 'is-selected' : ''}`} key={change.id}>
          <button className="folio-difference-jump" disabled={change.page === null} aria-pressed={selected?.id === change.id} onClick={() => { setSelectedId(change.id); if (change.page) setPage(change.page); }}><span>{change.label}</span><ArrowRight size={14} aria-hidden="true" /></button>
          {change.formattingOnly ? <><p>{change.after}</p><small>Formatting changed; wording is unchanged.</small></> : <p className="folio-word-diff">{change.wording.map((part, index) => part.kind === 'removed' ? <del key={index} aria-label={`Removed: ${part.text}`}>{part.text}</del> : part.kind === 'added' ? <ins key={index} aria-label={`Added: ${part.text}`}>{part.text}</ins> : <span key={index}>{part.text}</span>)}</p>}
          {!change.page && <small>This saved passage has no current page location.</small>}
          <details><summary>Read both complete passages</summary><small>Saved wording</small><p>{change.before || 'No saved wording'}</p><small>Current wording</small><p>{change.after || 'Text removed'}</p></details>
        </article>) : <p className="subtle">Saved and current wording and formatting are the same.</p>}
      </aside>
    </div>
    {!restoreInHeader && <div className="modal-actions"><button className="button button-primary" onClick={onRestore}>Restore as a new editable version</button></div>}
  </div>;
}

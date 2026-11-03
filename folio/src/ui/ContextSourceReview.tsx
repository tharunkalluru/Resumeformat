import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, FileText, Plus, Search, X } from 'lucide-react';
import type { CareerMemory, MemorySource } from '../core/model';
import type { CareerMemoryView } from '../core/careerMemory';
import { MemoryAssertionCard, type AssertionActions } from './CareerMemoryEditor';
import { MemorySaveIndicator, messageOf, supportingSourceErrorMessage, type MemorySaveState } from './OnboardingContext';
import './career-memory.css';

export interface ContextSourceReviewProps extends AssertionActions {
  source: MemorySource;
  memory: CareerMemory;
  view: CareerMemoryView;
  saveState: MemorySaveState;
  saveError?: string;
  onRetrySave?: () => Promise<void> | void;
  onAddAssertion: (sourceId: string, segmentId: string, text: string) => Promise<void>;
  onReviewSource: (sourceId: string) => void;
  onClose: () => void;
}

function SourceSegment({ sourceId, segment, existingAssertionId, onAdd }: { sourceId: string; segment: MemorySource['segments'][number]; existingAssertionId?: string; onAdd: ContextSourceReviewProps['onAddAssertion'] }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  return <article className="memory-source-segment"><span className="memory-locator">{segment.locator}</span><blockquote>{segment.text}</blockquote>{existingAssertionId ? <a className="memory-inline-link" href={`#memory-assertion-${existingAssertionId}`}>Review the saved candidate below</a> : <button type="button" className="memory-secondary" disabled={pending} onClick={async () => { if (pending) return; setPending(true); setError(''); try { await onAdd(sourceId, segment.id, segment.text); } catch (reason) { setError(messageOf(reason)); } finally { setPending(false); } }}><Plus size={15} aria-hidden="true" />{pending ? 'Adding draft…' : 'Review this detail'}</button>}{error ? <p className="memory-error" role="alert">{error}</p> : null}</article>;
}

export function ContextSourceReview({ source, memory, view, saveState, saveError, onRetrySave, onAddAssertion, onReviewSource, onClose, ...actions }: ContextSourceReviewProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(30);
  const candidates = view.assertions.filter(assertion => assertion.provenance.sourceId === source.id);
  const previousCount = useRef(candidates.length);
  const segments = source.segments.filter(segment => !query.trim() || `${segment.text} ${segment.locator}`.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));
  const displayed = segments.slice(0, limit);
  const existing = new Map(candidates.map(assertion => [assertion.provenance.sourceSegmentId, assertion.assertionId]));
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    if (candidates.length > previousCount.current) document.getElementById(`memory-assertion-${candidates.at(-1)?.assertionId}`)?.focus();
    previousCount.current = candidates.length;
  }, [candidates.length]);
  return <section className="memory-source-review memory-surface" aria-labelledby={`${id}-title`}>
    <header className="memory-editor-header"><div><span className="memory-eyebrow"><FileText size={15} aria-hidden="true" />Source review</span><h2 ref={heading} tabIndex={-1} id={`${id}-title`}>{source.name}</h2><p>{source.format.toUpperCase()} · {source.kind === 'localDictation' ? 'Applicant-reviewed local dictation' : source.kind === 'linkedinPaste' ? 'Applicant-pasted LinkedIn details' : source.kind === 'typed' ? 'Applicant-entered context' : 'Supporting document'}</p></div><button type="button" className="memory-icon-button" aria-label="Close source review" onClick={onClose}><X size={20} /></button></header>
    <p className="memory-editor-intro">Choose the exact text you want to reuse. A chosen detail starts as an editable, unconfirmed candidate below. The original source text remains unchanged.</p>
    <MemorySaveIndicator state={saveState} error={saveError} onRetry={onRetrySave} />
    {source.state === 'reading' ? <p className="memory-callout" role="status">Reading this source. You can close review and continue while it is processed.</p> : source.state === 'error' ? <p className="memory-error" role="alert">{supportingSourceErrorMessage(source)}</p> : null}
    <details className="memory-source-quotes" open={candidates.length === 0}><summary><span>Original quoted text <span className="memory-count">{source.segments.length}</span></span><ChevronDown size={17} aria-hidden="true" /></summary>
      {source.segments.length > 10 ? <label className="memory-search" htmlFor={`${id}-search`}><Search size={16} aria-hidden="true" /><span className="visually-hidden">Search source text</span><input id={`${id}-search`} type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(30); }} placeholder="Find a detail in this source" /></label> : null}
      <div className="memory-segment-list">{displayed.map(segment => <SourceSegment key={segment.id} sourceId={source.id} segment={segment} existingAssertionId={existing.get(segment.id)} onAdd={onAddAssertion} />)}</div>
      {!segments.length ? <p className="memory-empty">{source.segments.length ? 'No source text matches your search.' : 'No readable source text is available.'}</p> : null}
      {segments.length > limit ? <button type="button" className="memory-secondary" onClick={() => setLimit(current => current + 30)}>Show more source text ({segments.length - limit} remaining)</button> : null}
    </details>
    {candidates.length ? <section className="memory-extra-details" aria-labelledby={`${id}-candidates`}><header><h3 id={`${id}-candidates`}>Your career details from this source</h3></header><p className="memory-help">Confirm only the exact text shown. Confirmation means you attest it is accurate; file extraction does not verify qualifications.</p><div className="memory-assertion-list">{candidates.map(assertion => <MemoryAssertionCard key={assertion.assertionId} assertion={assertion} memory={memory} onReviewSource={onReviewSource} {...actions} />)}</div></section> : null}
    <footer className="memory-review-footer"><button type="button" className="memory-secondary" onClick={onClose}>Done reviewing</button><p className="memory-help">You can leave candidates unconfirmed and return later. They are not used as future application evidence.</p></footer>
  </section>;
}

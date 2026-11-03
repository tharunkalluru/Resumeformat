import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, BriefcaseBusiness, Check, ChevronDown, ChevronRight, EyeOff, FileText, Files, FolderKanban, GitCompareArrows, GraduationCap, LayoutTemplate, Link2, Mic, Pencil, Plus, Search, ShieldCheck, Sparkles, Trophy, X } from 'lucide-react';
import type { CareerMemory, MemorySnapshot } from '../core/model';
import type { CareerMemoryView } from '../core/careerMemory';
import { ContextCapture, MemorySaveIndicator, messageOf, type ContextCaptureProps, type MemorySaveState } from './OnboardingContext';
import { CareerContextHub } from './CareerContextHub';
import './career-memory.css';
import type { MemoryCategory, MemoryGroup } from './careerMemoryPresentation';
import { careerMemorySkills } from './careerMemoryPresentation';
import './career-memory-design.css';
import './folio-secondary.css';
import { memoryContextQuestions, memoryDuplicateGroups, memoryEvidenceIndex, searchMemoryEvidence, type MemoryEvidenceFilter, type MemoryEvidenceItem } from './memoryInsights';
import './memory-upgrade.css';

export type MemoryAssertionView = CareerMemoryView['assertions'][number];
export interface AssertionActions {
  onAssertionDraftChange: (id: string, baseVersion: number, text: string) => void;
  onDiscardAssertionDraft: (id: string, baseVersion: number) => Promise<void> | void;
  onEditAssertion: (id: string, version: number, text: string) => Promise<void>;
  onConfirmAssertion: (id: string, version: number, exactText: string) => Promise<void>;
  onSetAssertionFuture: (id: string, eligible: boolean) => Promise<void>;
}

export interface CareerMemoryEditorProps extends ContextCaptureProps, AssertionActions {
  view: CareerMemoryView;
  resumeName: string;
  resumeSourceName?: string;
  saveState: MemorySaveState;
  saveError?: string;
  onRetrySave?: () => Promise<void> | void;
  onCorrectResumeFact: (id: string, text: string) => Promise<void>;
  onSetResumeFactFuture: (id: string, eligible: boolean) => Promise<void>;
  onRequestDeleteGroup: () => void;
  onClose: () => Promise<void> | void;
  /** Root may show the active application's immutable snapshot while canonical memory is open. */
  applicationSnapshot?: Pick<MemorySnapshot, 'memoryRevision' | 'createdAt'>;
  groups?: MemoryGroup[];
  onManageTemplates?: () => void;
  templateCount?: number;
  requestedView?: { view: 'roles' | 'context'; request: number };
  onContextChange?: (open: boolean) => void;
  onUndo?: () => void; onRedo?: () => void; canUndo?: boolean; canRedo?: boolean;
}

export function MemoryAssertionCard({ assertion, memory, onReviewSource, ...actions }: { assertion: MemoryAssertionView; memory: CareerMemory; onReviewSource: (sourceId: string) => void } & AssertionActions) {
  const id = useId();
  const [editing, setEditing] = useState(assertion.draftText !== undefined);
  const [attested, setAttested] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const text = assertion.draftText ?? assertion.text;
  const hasDraft = assertion.draftText !== undefined;
  const history = memory.assertions.find(item => item.id === assertion.assertionId)?.versions.filter(version => version.version !== assertion.version) ?? [];
  useEffect(() => { setAttested(false); }, [assertion.version, assertion.text, hasDraft]);
  async function run(action: () => Promise<void> | void) {
    if (pending) return;
    setPending(true); setError('');
    try { await action(); } catch (reason) { setError(messageOf(reason)); } finally { setPending(false); }
  }
  const state = hasDraft ? 'Edit draft · Future use paused' : assertion.superseded ? 'Replaced for future applications' : assertion.excluded ? 'Excluded from future applications' : assertion.confirmation ? 'Confirmed by you' : 'Needs your confirmation';
  return <article className={`memory-assertion ${assertion.eligible ? 'is-confirmed' : ''}`} id={`memory-assertion-${assertion.assertionId}`} tabIndex={-1} aria-label={`Career detail, version ${assertion.version}`}>
    <header className="memory-assertion-heading"><span className={`memory-badge ${assertion.eligible ? 'memory-badge-confirmed' : ''}`}>{assertion.eligible ? <Check size={13} aria-hidden="true" /> : null}{state}</span><span className="memory-version">Version {assertion.version}</span></header>
    {editing || hasDraft ? <>
      <label className="memory-field-label" htmlFor={`${id}-edit`}>Edit this career detail</label>
      <textarea id={`${id}-edit`} value={text} maxLength={10000} rows={4} disabled={pending} onChange={event => { setAttested(false); actions.onAssertionDraftChange(assertion.assertionId, assertion.version, event.target.value); }} aria-describedby={`${id}-edit-help`} />
      <p className="memory-help" id={`${id}-edit-help`}>Your edit draft is saved separately. Save a new version, then confirm its exact wording. The original source remains unchanged.</p>
      <div className="memory-actions"><button type="button" className="memory-secondary" disabled={pending || !text.trim() || !hasDraft} onClick={() => void run(async () => { await actions.onEditAssertion(assertion.assertionId, assertion.version, text); setEditing(false); setAttested(false); })}>Save new version</button><button type="button" className="memory-text-button" disabled={pending} onClick={() => void run(async () => { if (hasDraft) await actions.onDiscardAssertionDraft(assertion.assertionId, assertion.version); setEditing(false); })}>Discard edit draft</button></div>
    </> : <p className="memory-assertion-text">{assertion.text}</p>}
    <div className="memory-provenance"><FileText size={14} aria-hidden="true" /><span>{assertion.provenance.sourceName} · {assertion.provenance.locator}</span></div>
    <details className="memory-quote"><summary>View original source quote<ChevronDown size={15} aria-hidden="true" /></summary><blockquote>{assertion.provenance.originalQuote}</blockquote><p className="memory-help">Original supplied text. Editing the career detail does not edit this quote.</p>{assertion.provenance.sourceKind !== 'resume' ? <button type="button" className="memory-text-button" onClick={() => onReviewSource(assertion.provenance.sourceId)}>Open full source review</button> : null}</details>
    {assertion.supersedes?.resumeFactId ? <p className="memory-callout">This correction replaces an original resume detail for future applications. Its original wording remains in the template and must be revised before export where it appears.</p> : null}
    {!assertion.confirmation && !hasDraft && !editing ? <div className="memory-confirmation">
      <label htmlFor={`${id}-attestation`}><input id={`${id}-attestation`} type="checkbox" checked={attested} disabled={pending} onChange={event => setAttested(event.target.checked)} /><span>I confirm this detail is accurate.</span></label>
      <p className="memory-help">Confirmation is your attestation of this exact text, not external verification.</p>
      <button type="button" className="memory-primary" disabled={!attested || pending} onClick={() => void run(() => actions.onConfirmAssertion(assertion.assertionId, assertion.version, assertion.text))}><ShieldCheck size={16} aria-hidden="true" />Confirm this version</button>
    </div> : null}
    {assertion.confirmation && !hasDraft ? <p className="memory-help">Confirmed by you for version {assertion.confirmation.version}. {assertion.eligible ? 'Available to future applications after saving.' : 'This detail is currently outside future application evidence.'}</p> : null}
    <div className="memory-assertion-actions">{!editing && !hasDraft ? <button type="button" className="memory-text-button" disabled={pending} onClick={() => { setEditing(true); setAttested(false); }}>Edit detail</button> : null}<button type="button" className="memory-text-button" disabled={pending} onClick={() => void run(() => actions.onSetAssertionFuture(assertion.assertionId, assertion.excluded))}>{assertion.excluded ? 'Restore for future applications' : 'Exclude from future applications'}</button></div>
    <p className="memory-help">Exclusion keeps source records and older application snapshots. It does not erase historical copies.</p>
    {history.length ? <details className="memory-history"><summary>{history.length} earlier {history.length === 1 ? 'version' : 'versions'}<ChevronDown size={15} aria-hidden="true" /></summary>{history.map(version => <div className="memory-history-version" key={version.version}><span>Version {version.version} · {version.confirmation ? 'Previously confirmed by you' : 'Unconfirmed'} · Historical only</span><p>{version.text}</p></div>)}</details> : null}
    {error ? <p className="memory-error" role="alert">{error}</p> : null}
  </article>;
}

function ResumeMemoryRow({ row, name, onCorrect, onSetFuture }: { row: CareerMemoryView['resumeFacts'][number]; name: string; onCorrect: () => Promise<void>; onSetFuture: (eligible: boolean) => Promise<void> }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [correctionCreated, setCorrectionCreated] = useState(false);
  async function run(action: () => Promise<void>) {
    if (pending) return;
    setPending(true); setError('');
    try { await action(); } catch (reason) { setError(messageOf(reason)); } finally { setPending(false); }
  }
  return <article className="memory-resume-fact">
    <header><span className="memory-badge">{row.status === 'available' ? 'From your resume' : row.status === 'excluded' ? 'Excluded for future applications' : row.status === 'pendingCorrection' ? 'Correction needs confirmation' : 'Replaced for future applications'}</span></header>
    <p className="memory-assertion-text">{row.fact.text}</p>
    <details className="memory-quote"><summary>View resume source<ChevronDown size={15} aria-hidden="true" /></summary><div className="memory-provenance"><FileText size={14} aria-hidden="true" /><span>{name} · {row.fact.locator}</span></div><blockquote>{row.fact.text}</blockquote><p className="memory-help">Original resume wording. Corrections affect reusable evidence and leave source bytes unchanged.</p></details>
    <div className="memory-actions"><button type="button" className="memory-text-button" disabled={pending || row.superseded} onClick={() => void run(async () => { await onCorrect(); setCorrectionCreated(true); })}>Correct for future applications</button><button type="button" className="memory-text-button" disabled={pending} onClick={() => void run(() => onSetFuture(row.excluded))}>{row.excluded ? 'Restore for future applications' : 'Exclude from future applications'}</button></div>
    {correctionCreated ? <p className="memory-callout">A correction draft is saved. Close this detail and open Review or Other saved details to edit it and confirm its exact wording before future use.</p> : null}
    {row.excluded ? <p className="memory-help">Older applications retain their saved snapshot. This wording still appears in the source template and needs review before export.</p> : null}
    {error ? <p className="memory-error" role="alert">{error}</p> : null}
  </article>;
}

type MemoryDestination = MemoryCategory | 'sources' | 'conflicts' | 'templates' | 'context';
const destinations = [
  { key: 'roles', label: 'Roles', icon: BriefcaseBusiness },
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'skills', label: 'Skills', icon: Sparkles },
  { key: 'achievements', label: 'Achievements', icon: Trophy },
  { key: 'education', label: 'Education', icon: GraduationCap },
  { key: 'other', label: 'Other saved details', icon: BookOpen },
  { key: 'conflicts', label: 'Review', icon: GitCompareArrows },
  { key: 'sources', label: 'Sources', icon: Files },
  { key: 'templates', label: 'Templates', icon: LayoutTemplate },
] as const;

export function CareerMemoryEditor({ memory, view, resumeName, resumeSourceName = resumeName, saveState, saveError, onRetrySave, onCorrectResumeFact, onSetResumeFactFuture, onRequestDeleteGroup, onClose, applicationSnapshot, groups = [], onManageTemplates, templateCount = 1, requestedView, onContextChange, onUndo, onRedo, canUndo = false, canRedo = false, onAssertionDraftChange, onDiscardAssertionDraft, onEditAssertion, onConfirmAssertion, onSetAssertionFuture, ...capture }: CareerMemoryEditorProps) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const captureDialog = useRef<HTMLDialogElement>(null);
  const captureTrigger = useRef<HTMLElement | null>(null);
  const captureReviewOpening = useRef(false);
  const [destination, setDestination] = useState<MemoryDestination>('roles');
  const [selectedFact, setSelectedFact] = useState<{ kind: 'resume' | 'extra'; id: string } | null>(null);
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [evidenceFilter, setEvidenceFilter] = useState<MemoryEvidenceFilter>('all');
  const [contextQuestion, setContextQuestion] = useState('');
  const [captureMethod, setCaptureMethod] = useState<'linkedin' | 'voice' | null>(null);
  const [closeError, setCloseError] = useState('');
  const query = search.toLocaleLowerCase().trim();
  const evidence = useMemo(() => memoryEvidenceIndex(view, groups, resumeSourceName), [view, groups, resumeSourceName]);
  const duplicates = useMemo(() => memoryDuplicateGroups(evidence), [evidence]);
  const searchResults = useMemo(() => searchMemoryEvidence(evidence, search, evidenceFilter), [evidence, search, evidenceFilter]);
  const searching = searchOpen && (!!query || evidenceFilter !== 'all');
  const rows = new Map(view.resumeFacts.map(row => [row.fact.id, row]));
  const unconfirmed = view.assertions.filter(row => !row.confirmation || row.draftText !== undefined);
  const corrections = view.resumeFacts.filter(row => row.status === 'pendingCorrection');
  const excluded = view.resumeFacts.filter(row => row.excluded).length + view.assertions.filter(row => row.excluded).length;
  const skills = careerMemorySkills(groups, view.resumeFacts.map(row => row.fact));
  const actions = { onAssertionDraftChange, onDiscardAssertionDraft, onEditAssertion, onConfirmAssertion, onSetAssertionFuture };
  const visibleGroups = groups.filter(group => group.category === destination && (!query || [group.title, group.dates, ...[...group.factIds, ...group.metadataFactIds].map(factId => rows.get(factId)?.fact.text)].join(' ').toLocaleLowerCase().includes(query)));
  const visibleSkills = skills.filter(skill => !query || skill.label.toLocaleLowerCase().includes(query));
  const extraRows = view.assertions.filter(row => !query || [row.text, row.draftText, row.provenance.sourceName].join(' ').toLocaleLowerCase().includes(query));
  const resumeDetail = selectedFact?.kind === 'resume' ? rows.get(selectedFact.id) : undefined;
  const assertionDetail = selectedFact?.kind === 'extra' ? view.assertions.find(row => row.assertionId === selectedFact.id) : undefined;
  useEffect(() => { heading.current?.focus(); }, [destination]);
  useEffect(() => { if (searchOpen) searchInput.current?.focus(); }, [searchOpen]);
  useEffect(() => { if (requestedView?.request) { setCaptureMethod(null); setDestination(requestedView.view); setSearch(''); setEvidenceFilter('all'); } }, [requestedView]);
  useEffect(() => { onContextChange?.(destination === 'context'); }, [destination, onContextChange]);
  useEffect(() => {
    if (!selectedFact) {
      // Restore after React removes the native dialog from the top layer.
      // Focusing while it is still modal is rejected by the browser.
      if (detailTrigger.current?.isConnected) detailTrigger.current.focus();
      detailTrigger.current = null;
      return;
    }
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [selectedFact]);
  useEffect(() => {
    if (!captureMethod) {
      if (!captureReviewOpening.current && captureTrigger.current?.isConnected) captureTrigger.current.focus();
      captureTrigger.current = null;
      captureReviewOpening.current = false;
      return;
    }
    const element = captureDialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, [captureMethod]);
  function closeCapture() { setCaptureMethod(null); }
  function reviewCaptureSource(sourceId: string) {
    captureReviewOpening.current = true;
    captureDialog.current?.close();
    setCaptureMethod(null);
    capture.onReviewSource(sourceId);
  }
  async function addCaptureText(...args: Parameters<ContextCaptureProps['onAddTextSource']>) {
    captureReviewOpening.current = true;
    try {
      await capture.onAddTextSource(...args);
      captureDialog.current?.close();
      setCaptureMethod(null);
    } catch (reason) {
      captureReviewOpening.current = false;
      throw reason;
    }
  }
  function inspect(kind: 'resume' | 'extra', factId: string) {
    detailTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedFact({ kind, id: factId });
  }
  function closeDetail() {
    setSelectedFact(null);
  }
  function reviewDetailSource(sourceId: string) {
    detailTrigger.current = null;
    dialog.current?.close();
    setSelectedFact(null);
    capture.onReviewSource(sourceId);
  }
  function closeMemory() {
    setCloseError('');
    Promise.resolve().then(onClose).catch(reason => setCloseError(messageOf(reason)));
  }
  function count(key: MemoryDestination) {
    if (key === 'sources') return 1 + memory.sources.length;
    if (key === 'templates') return templateCount;
    if (key === 'skills') return skills.length;
    if (key === 'conflicts') return corrections.length + unconfirmed.length + duplicates.length;
    if (key === 'other') return groups.filter(group => group.category === key).reduce((sum, group) => sum + group.factIds.length + group.metadataFactIds.length, 0) + view.assertions.length;
    const found = groups.filter(group => group.category === key);
    return key === 'roles' ? found.filter(group => group.factIds.length).length : found.reduce((sum, group) => sum + group.factIds.length, 0);
  }
  function factRow(factId: string) {
    const row = rows.get(factId);
    if (!row) return null;
    return <div className={`memory-design-fact ${row.excluded ? 'is-excluded' : ''}`} key={factId}>
      <button type="button" className="memory-fact-open" onClick={() => inspect('resume', factId)} aria-label={`Inspect resume fact: ${row.fact.text}`}>
        <span className="memory-fact-wording">{row.fact.text.replace(/^[•▪◦]\s*/, '')}</span>
        <span className="memory-fact-source"><FileText size={12} aria-hidden="true" />Resume source{row.status !== 'available' ? ` · ${row.status === 'excluded' ? 'Excluded' : row.status === 'pendingCorrection' ? 'Correction needs review' : 'Replaced for future use'}` : ''}</span>
        <ChevronRight size={16} className="memory-mobile-fact-chevron" aria-hidden="true" />
      </button>
      <div className="memory-fact-actions"><button type="button" className="icon-button" aria-label={`Edit resume fact: ${row.fact.text}`} onClick={() => inspect('resume', factId)}><Pencil size={16} /></button><button type="button" className="icon-button" aria-label={`Review exclusion: ${row.fact.text}`} onClick={() => inspect('resume', factId)}><EyeOff size={16} /></button></div>
    </div>;
  }
  function evidenceRow(item: MemoryEvidenceItem) {
    return <button type="button" className="memory-review-detail memory-discovery-result" key={item.key} onClick={() => inspect(item.kind, item.id)}><span className="memory-evidence-state" data-available={item.available}>{item.status}</span><span className="memory-fact-wording">{item.text}</span>{item.context && <span className="memory-result-context">{item.context}</span>}<span className="memory-fact-source">{item.sourceName} · {item.locator}</span></button>;
  }
  function askForContext(question: string) {
    setContextQuestion(question); openCapture(null);
  }
  function groupCard(group: MemoryGroup, collapsed: boolean) {
    const headingId = group.metadataFactIds.find(factId => rows.get(factId)?.fact.text.trim() === group.title) ?? group.metadataFactIds[0];
    const dateId = group.metadataFactIds.find(factId => rows.get(factId)?.fact.text.trim() === group.dates);
    const title = <><span className="memory-card-title">{group.title}</span>{group.dates && <span className="memory-card-dates">{group.dates}</span>}</>;
    const questions = memoryContextQuestions(group);
    const body = <>{group.factIds.map(factRow)}{questions.length > 0 && <details className="memory-context-questions"><summary>Add detail for this {group.category === 'roles' ? 'role' : 'project'}</summary><p>Use these questions if useful. Answers become reviewable drafts; Folio does not fill them in.</p>{questions.map(question => <button type="button" className="memory-context-question" key={question} onClick={() => askForContext(question)}>{question}<ChevronRight size={15} aria-hidden="true" /></button>)}</details>}</>;
    return collapsed ? <details className="memory-design-card memory-collapsed-role" key={group.id}><summary>{title}<span className="memory-fact-count">{group.factIds.length} facts</span><ChevronDown size={16} /></summary>{body}</details> : <section className="memory-design-card" key={group.id}><header>{headingId ? <button className="memory-card-title memory-metadata-button" onClick={() => inspect('resume', headingId)} aria-label={`Inspect original heading: ${group.title}`}>{group.title}</button> : <span className="memory-card-title">{group.title}</span>}{group.dates && (dateId ? <button className="memory-card-dates memory-metadata-button" onClick={() => inspect('resume', dateId)} aria-label={`Inspect original dates: ${group.dates}`}>{group.dates}</button> : <span className="memory-card-dates">{group.dates}</span>)}</header>{body}</section>;
  }
  function navigate(key: MemoryDestination) { if (key === 'templates' && onManageTemplates) { onManageTemplates(); return; } setCaptureMethod(null); setDestination(key); setSearch(''); setEvidenceFilter('all'); setContextQuestion(''); }
  function openCapture(method: 'linkedin' | 'voice' | null) {
    if (method) { captureTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; captureReviewOpening.current = false; setCaptureMethod(method); }
    else { setCaptureMethod(null); setDestination('context'); setSearch(''); setEvidenceFilter('all'); }
  }
  const navButton = (item: typeof destinations[number]) => { const Icon = item.icon; return <button type="button" key={item.key} className={`memory-design-nav-button ${destination === item.key ? 'is-active' : ''}`} aria-current={destination === item.key ? 'page' : undefined} onClick={() => navigate(item.key)}><Icon size={16} aria-hidden="true" /><span>{item.label}</span><span className="memory-nav-count">{count(item.key)}</span></button>; };
  return <section className={`career-memory-editor memory-surface memory-design ${destination === 'context' ? 'memory-context-destination' : ''}`} data-memory-view={destination} aria-labelledby={`${id}-title`}>
    <div className="memory-design-body">
      <header className="memory-design-heading"><div>{destination === 'context' && <button className="memory-text-button memory-context-back" onClick={() => navigate('roles')}><ArrowLeft size={14} aria-hidden="true" />Career Memory</button>}<h1 id={`${id}-title`} ref={heading} tabIndex={-1}>{destination === 'context' ? 'Add context' : destination === 'roles' ? 'Career Memory' : destinations.find(item => item.key === destination)?.label ?? 'Career Memory'}</h1><p>{destination === 'context' ? 'Review what you add and confirm its exact wording before future use.' : destination === 'skills' ? `${skills.length} skills source ${skills.length === 1 ? 'entry' : 'entries'} · original wording preserved` : 'Your original resume and saved career details, with their source and future-use status.'}</p></div>{destination !== 'context' && <div className="memory-heading-actions"><button type="button" className="button button-secondary" onClick={() => openCapture('linkedin')}><Link2 size={16} aria-hidden="true" />Import LinkedIn</button><button type="button" className="button button-primary" onClick={() => openCapture('voice')}><Mic size={16} aria-hidden="true" />Record a note</button></div>}</header>
      {destination !== 'context' && <div className="memory-kit-stats" aria-label="Career Memory summary"><span><strong>{evidence.filter(item => item.available).length}</strong> available facts</span><span><strong>{unconfirmed.length}</strong> awaiting review</span><span><strong>{count('roles')}</strong> roles</span><span><strong>{memory.sources.length + 1}</strong> {memory.sources.length ? 'sources' : 'source'}</span>{excluded > 0 && <span><strong>{excluded}</strong> excluded</span>}</div>}
    <nav className="memory-design-nav" aria-label="Career Memory views">
      <button type="button" className="memory-design-back" onClick={closeMemory}><ArrowLeft size={16} aria-hidden="true" />Tailor a job</button>
      <span className="memory-nav-label">View by</span>{destinations.slice(0, 5).map(navButton)}
      <span className="memory-nav-label">Manage</span>{destinations.slice(6).map(navButton)}{navButton(destinations[5])}
      <div className="memory-mobile-tabs" role="group" aria-label="Career Memory views">{destinations.filter(item => ['roles', 'skills', 'education'].includes(item.key)).map(navButton)}<label className="memory-more"><span>More</span><select aria-label="More Career Memory views" value={['roles', 'skills', 'education'].includes(destination) ? '' : destination} onChange={event => { if (event.target.value === '__search') { setSearchOpen(true); } else if (event.target.value) navigate(event.target.value as MemoryDestination); }}><option value="">More</option>{destinations.filter(item => !['roles', 'skills', 'education'].includes(item.key)).map(item => <option key={item.key} value={item.key}>{item.label}</option>)}<option value="__search">Search all Memory</option></select></label></div>
    </nav>
      {destination !== 'context' && <div className="memory-kit-tools"><button type="button" className="memory-text-button" aria-expanded={searchOpen} onClick={() => { setSearchOpen(value => !value); setSearch(''); setEvidenceFilter('all'); }}><Search size={16} aria-hidden="true" />Search all Memory</button><button type="button" className="memory-text-button" onClick={() => { setContextQuestion(''); openCapture(null); }}><Plus size={16} aria-hidden="true" />Add context</button></div>}
      <MemorySaveIndicator state={saveState} error={saveError} onRetry={onRetrySave} />
      {destination !== 'context' && searchOpen && <div className="memory-discovery-tools"><label className="memory-search" htmlFor={`${id}-search`}><Search size={16} aria-hidden="true" /><span className="visually-hidden">Search all Career Memory</span><input ref={searchInput} id={`${id}-search`} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search facts, roles, dates or sources" aria-describedby={`${id}-search-help`} /></label><label className="memory-discovery-filter"><span>Show</span><select value={evidenceFilter} onChange={event => setEvidenceFilter(event.target.value as MemoryEvidenceFilter)}><option value="all">All facts</option><option value="available">Available for future applications</option><option value="review">Needs review</option><option value="inactive">Excluded or replaced</option></select></label><p id={`${id}-search-help`}>Searches all categories, source quotes and explicit role or project context. All search terms must match.</p></div>}
      {closeError && <p className="memory-error" role="alert">{closeError}</p>}
      {(corrections.length > 0 || unconfirmed.length > 0 || duplicates.length > 0) && destination !== 'context' && <aside className="memory-design-message"><GitCompareArrows size={16} aria-hidden="true" /><p>{corrections.length ? `${corrections.length} ${corrections.length === 1 ? 'correction needs' : 'corrections need'} review. ` : ''}{unconfirmed.length ? `${unconfirmed.length} extra ${unconfirmed.length === 1 ? 'detail is' : 'details are'} waiting for confirmation. ` : ''}{duplicates.length ? `${duplicates.length} repeated-wording ${duplicates.length === 1 ? 'group is' : 'groups are'} available to compare. ` : ''}Saved application snapshots stay unchanged.</p><button type="button" className="button button-secondary button-small" onClick={() => navigate('conflicts')}>Review</button></aside>}
      {destination === 'context' ? <>{contextQuestion && <aside className="memory-question-prompt"><strong>A question to help you add context</strong><p>{contextQuestion}</p><p>Your existing draft is preserved. Include the role or project in your answer so its context stays clear.</p><button type="button" className="memory-text-button" onClick={() => setContextQuestion('')}>Dismiss question</button></aside>}<CareerContextHub memory={memory} resumeName={resumeSourceName} factCount={view.resumeFacts.length} referenceSaved={saveState === 'saved'} {...capture} /></>
      : searching ? <section className="memory-search-results" aria-label="Career Memory search results"><p role="status" aria-live="polite">{searchResults.length} {searchResults.length === 1 ? 'fact matches' : 'facts match'} across Career Memory.</p>{searchResults.map(evidenceRow)}{!searchResults.length && <p className="memory-design-empty">Try fewer search terms or a different future-use status.</p>}<button type="button" className="memory-text-button" onClick={() => { setSearch(''); setEvidenceFilter('all'); searchInput.current?.focus(); }}>Clear search and filters</button></section>
      : destination === 'sources' ? <section className="memory-sources-screen"><h3>Your sources</h3><section className="memory-design-card"><header><FileText size={16} /><span className="memory-card-title">{resumeSourceName}</span><span className="memory-card-dates">Original resume</span></header><details className="memory-source-all"><summary>Inspect all {view.resumeFacts.length} original facts</summary>{view.resumeFacts.map(row => factRow(row.fact.id))}</details></section>{memory.sources.map(source => <button className="memory-source-tile" type="button" key={source.id} onClick={() => capture.onReviewSource(source.id)}><FileText size={18} /><span><strong>{source.name}</strong><small>{source.kind === 'supportingFile' ? 'Uploaded file' : 'Saved text'} · {source.segments.length} source passages</small></span><ArrowLeft size={16} className="memory-source-arrow" /></button>)}</section>
      : destination === 'templates' ? <section className="memory-templates-screen"><h3>Resume and layout</h3><section className="memory-design-card"><header><LayoutTemplate size={16} /><span className="memory-card-title">{resumeName}</span><span className="memory-card-dates">Current source layout</span></header><div className="memory-template-summary"><p>The original layout belongs to this reusable resume. Saved tailorings keep the layout and evidence version they were created with.</p><button className="button button-secondary" onClick={closeMemory}>Inspect the resume layout</button></div></section></section>
      : destination === 'conflicts' ? <section className="memory-review-screen"><h3>Corrections and details to review</h3><p className="memory-design-subtitle">Resume facts retain their original wording. Added details need your confirmation of each version before they can support future applications.</p>{corrections.map(row => factRow(row.fact.id))}{evidence.filter(item => item.kind === 'extra' && item.needsReview).map(evidenceRow)}{!corrections.length && !unconfirmed.length && <p className="memory-design-empty">No corrections or extra details are waiting for review.</p>}<section className="memory-duplicate-review" aria-labelledby={`${id}-duplicates`}><h3 id={`${id}-duplicates`}>Repeated wording</h3><p>Matches compare saved text after case, spacing, bullet and quote-format normalization. Different dates, numbers and wording stay distinct. Identical wording can describe separate experiences; compare its context before excluding anything. Nothing is merged or removed automatically.</p>{duplicates.map((group, index) => <details className="memory-duplicate-group" key={group.key}><summary><span>Group {index + 1} · {group.items.length} details</span><span>{group.exact ? 'Same wording' : 'Formatting differs'}</span></summary>{group.items.map(item => evidenceRow({ ...item, text: item.committedText, status: item.text !== item.committedText ? `${item.status} · This match compares saved wording` : item.status }))}</details>)}{!duplicates.length && <p className="memory-help">No repeated passages found. This does not check for semantic contradictions.</p>}</section></section>
      : <>

        {destination === 'skills' ? <section className="memory-design-card memory-skills-card">{visibleSkills.map(skill => <div className="memory-design-fact memory-skill-row" key={skill.label}><button className="memory-fact-open" onClick={() => inspect('resume', skill.factIds[0])} aria-label={`Inspect skill source: ${skill.label}`}><span className="memory-skill-label">{skill.label}</span><span className="memory-fact-source">Original skills wording</span><ChevronRight size={16} className="memory-mobile-fact-chevron" aria-hidden="true" /></button><span className="memory-skill-provenance"><FileText size={12} aria-hidden="true" />Resume{skill.factIds.length > 1 && <span className="memory-skill-source-links">{skill.factIds.map((factId, index) => <button className="memory-text-button" key={factId} onClick={() => inspect('resume', factId)}>Source {index + 1}</button>)}</span>}</span></div>)}</section> : <div className="memory-role-grid"><div className="memory-role-column">{visibleGroups.slice(0, 1).map(group => groupCard(group, false))}</div><div className="memory-role-column">{visibleGroups.slice(1).map(group => groupCard(group, false))}</div></div>}
        {destination === 'other' && extraRows.length > 0 && <section className="memory-design-card memory-extra-card"><header><span className="memory-card-title">Additional saved details</span></header>{extraRows.map(row => <div className="memory-design-fact" key={row.assertionId}><button className="memory-fact-open" type="button" onClick={() => inspect('extra', row.assertionId)}><span className="memory-fact-wording">{row.draftText ?? row.text}</span><span className="memory-fact-source" data-source-kind={row.provenance.sourceKind}><FileText size={12} aria-hidden="true" />{row.provenance.sourceName} · {row.draftText !== undefined ? 'Edit draft · Future use paused' : row.superseded ? 'Replaced for future use' : row.excluded ? 'Excluded' : row.confirmation ? 'Confirmed' : 'Needs confirmation'}</span></button></div>)}</section>}
        {!(destination === 'skills' ? visibleSkills.length : visibleGroups.length) && !(destination === 'other' && extraRows.length) && <div className="memory-design-empty"><BookOpen size={20} /><p>{query ? 'No facts match this search.' : `No explicit ${destination === 'roles' ? 'experience' : destination} section was found in this resume.`} Unclassified facts remain in <button className="text-button" onClick={() => setDestination('other')}>Other saved details</button>.</p></div>}
      </>}
      <details className="memory-design-privacy"><summary>Local storage, sources and snapshots</summary><p>Career Memory is saved in this browser profile for this Folio address. It is not synced to an account. Download a backup from Settings before clearing site data or moving browsers; recovery requires a backup you saved.</p>{(onUndo || onRedo) && <div className="memory-mobile-history">{onUndo && <button type="button" className="memory-text-button" disabled={!canUndo} onClick={onUndo}>Undo memory change</button>}{onRedo && <button type="button" className="memory-text-button" disabled={!canRedo} onClick={onRedo}>Redo memory change</button>}</div>}<p>{applicationSnapshot ? `This application uses memory revision ${applicationSnapshot.memoryRevision}. ` : ''}Changes to reusable context apply to future tailorings. Original files and older saved application snapshots stay unchanged.</p><p>Categories follow explicit original section headings; unclassified text and extra context remain in Other saved details.</p><button type="button" className="memory-text-button memory-danger-text" onClick={onRequestDeleteGroup}>Delete this entire resume group…</button></details>
    </div>
    {captureMethod && <dialog className="memory-fact-dialog memory-capture-dialog" ref={captureDialog} onCancel={event => { event.preventDefault(); closeCapture(); }} onClose={closeCapture} aria-labelledby={`${id}-capture-title`}><header className="memory-fact-dialog-heading"><h2 id={`${id}-capture-title`}>{captureMethod === 'linkedin' ? 'Import from LinkedIn' : 'Record a voice note'}</h2><button type="button" className="icon-button" aria-label={captureMethod === 'linkedin' ? 'Close LinkedIn import' : 'Close voice note'} onClick={closeCapture}><X size={20} aria-hidden="true" /></button></header><div className="memory-fact-dialog-body memory-context-screen"><ContextCapture key={captureMethod} memory={memory} method={captureMethod} referenceSaved={saveState === 'saved'} {...capture} onAddTextSource={addCaptureText} onReviewSource={reviewCaptureSource} /></div></dialog>}
    {selectedFact && <dialog className="memory-fact-dialog" ref={dialog} onCancel={event => { event.preventDefault(); closeDetail(); }} onClose={closeDetail} aria-labelledby={`${id}-detail-title`}><header className="memory-fact-dialog-heading"><h2 id={`${id}-detail-title`}>Fact detail</h2><button type="button" className="icon-button" aria-label="Close fact detail" onClick={closeDetail}><X size={20} /></button></header><div className="memory-fact-dialog-body">{resumeDetail && <ResumeMemoryRow key={resumeDetail.fact.id} row={resumeDetail} name={resumeSourceName} onCorrect={() => onCorrectResumeFact(resumeDetail.fact.id, resumeDetail.fact.text)} onSetFuture={eligible => onSetResumeFactFuture(resumeDetail.fact.id, eligible)} />}{assertionDetail && <MemoryAssertionCard key={assertionDetail.assertionId} assertion={assertionDetail} memory={memory} onReviewSource={reviewDetailSource} {...actions} />}</div></dialog>}
  </section>;
}

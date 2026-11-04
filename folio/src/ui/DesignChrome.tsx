import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, HelpCircle, LockKeyhole, Plus, Settings2, Sparkles, UserRound, BookOpen, Mic, Link, Brain, Search, MoreHorizontal, X } from 'lucide-react';
import type { Project } from '../core/model';
import { blockText, hasValidApproval, workspaceOf } from '../core/model';
import { activitySummary, dayRange } from '../core/activity';
import type { PrivateProfile } from '../core/activity';
import { presentation } from '../core/folio';
import { sourceReviewIssues } from '../tailoring/sourceSupport';
import { matchProject, changedParagraphs } from '../tailoring/local';
import { useOptionalAuth } from '../auth/AuthProvider';
import { REGIONS } from '../auth/regions';
import { applicationEntries, applicationProgress, applicationSearchText, shortDate, type ComposerServiceReadiness } from './workspacePresentation';

export function AccountMenu({ profile, onProfile, onMemory, onSettings, onHelp }: { profile: PrivateProfile | null; onProfile: () => void; onMemory: () => void; onSettings: () => void; onHelp: () => void }) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const auth = useOptionalAuth(), user = auth?.status === 'signedIn' ? auth.user : null;
  const accountName = (user?.user_metadata?.full_name as string | undefined) || user?.email || '';
  const name = profile?.name || accountName || 'Your profile';
  const actions = [{ title: 'My profile', icon: UserRound, action: onProfile }, { title: 'Career memory', icon: BookOpen, action: onMemory }, { title: 'Settings', icon: Settings2, action: onSettings }, { title: 'Help', icon: HelpCircle, action: onHelp }];
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() { setOpen(false); trigger.current?.focus(); }
  return <div className="folio-account" ref={root} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    const items = Array.from(root.current?.querySelectorAll<HTMLButtonElement>('[role=menuitem]') ?? []), index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus(); }
  }}>
    {open && <div className="folio-account-menu" role="menu" aria-label="Private profile menu">{actions.map(({ title, icon: Icon, action }) => <button role="menuitem" key={title} onClick={() => { close(); action(); }}><Icon size={16} />{title}</button>)}{auth && (user
      ? <><p><LockKeyhole size={13} /> Signed in as {user.email}{auth.region ? ` · data in ${REGIONS[auth.region].label}` : ''}</p><button role="menuitem" onClick={() => { close(); void auth.signOut(); }}>Sign out</button></>
      : <><p><LockKeyhole size={13} /> Local workspace · not signed in</p><button role="menuitem" onClick={() => { close(); auth.openAuth('signin'); }}>Sign in or create account</button></>)}
    {!auth && <p><LockKeyhole size={13} /> Local workspace · no account connected</p>}</div>}
    <button ref={trigger} className="folio-account-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={`${name}, private profile menu`} onClick={() => setOpen(value => !value)}><span className="folio-avatar">{profile?.name ? profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase() : <UserRound size={18} />}</span><span><strong>{name}</strong><small>{user ? `Signed in · ${auth?.region ? REGIONS[auth.region].label : ''}` : 'Private · on this device'}</small></span><ChevronDown size={15} /></button>
  </div>;
}

export function TailoringHistory({ projects, selectedId, onOpen, onDelete, failedIds }: { projects: Project[]; selectedId?: string; onOpen: (project: Project) => void; onDelete: (project: Project) => void; failedIds: string[] }) {
  const entries = projects.filter(project => workspaceOf(project).kind === 'application').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  return <nav className="folio-history" aria-label="Tailored resumes">{!entries.length ? <p className="folio-history-empty">Your tailored resumes will appear here.</p> : entries.map(project => {
    const progress = applicationProgress(project);
    const currentDownload = progress.lastDownload?.content.revision === project.draft.revision;
    return <div className={`folio-history-row ${selectedId === project.id ? 'on' : ''}`} key={project.id}><button className="folio-history-open" aria-current={selectedId === project.id ? 'page' : undefined} aria-label={`Open ${project.name}`} title={`${project.job.title || project.name}${project.job.company ? `, ${project.job.company}` : ''} · ${progress.label}`} onClick={() => onOpen(project)}><span>{(project.job.title || project.name).replace(/^Senior /, 'Sr. ')}{project.job.company ? `, ${project.job.company}` : ''}</span>{(!currentDownload || failedIds.includes(project.id)) && <i className="kit-unreviewed-dot" aria-label={failedIds.includes(project.id) ? 'Not saved' : 'No PDF download recorded for this draft revision'} />}</button><button className="icon-button folio-history-remove" aria-label={`Delete ${project.name}`} onClick={() => onDelete(project)}><X size={12} /></button></div>;
  })}</nav>;
}

export function AllTailorings({ projects, onOpen, onDelete, onRename, onNew, failedIds, onRetry }: {
  failedIds: string[]; onRetry: (project: Project) => void; projects: Project[];
  onOpen: (project: Project) => void; onDelete: (project: Project) => void;
  onRename: (project: Project) => void; onNew: (project: Project) => void;
}) {
  const [sort, setSort] = useState('newest'), [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'draft' | 'review' | 'reviewed' | 'downloaded'>('all');
  const all = applicationEntries(projects), query = search.trim().normalize('NFKC').toLocaleLowerCase();
  const entries = all.filter(project => {
    const progress = applicationProgress(project);
    return applicationSearchText(project).includes(query) && (filter === 'all' || (filter === 'downloaded' ? !!progress.lastDownload : progress.stage === filter));
  }).sort((a, b) => sort === 'company' ? (a.job.company || a.name).localeCompare(b.job.company || b.name) : b.updatedAt.localeCompare(a.updatedAt));
  const filters = [{ key: 'all', label: 'All' }, { key: 'draft', label: 'Job drafts' }, { key: 'review', label: 'Needs review' }, { key: 'reviewed', label: 'Claims confirmed' }, { key: 'downloaded', label: 'PDF recorded' }] as const;
  const pending = all.filter(project => applicationProgress(project).lastDownload?.content.revision !== project.draft.revision).length;
  return <div className="workspace-applications">
    <div className="workspace-application-summary" aria-label="Application summary"><span><strong>{all.length}</strong> saved {all.length === 1 ? 'application' : 'applications'}</span><span><strong>{pending}</strong> to continue or review</span><span><LockKeyhole size={14} aria-hidden="true"/>On this device</span></div>
    <div className="folio-history-filters"><div className="segmented-control workspace-application-filters" aria-label="Filter applications">{filters.map(({ key, label }) => <button key={key} className={filter === key ? 'is-active' : ''} aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div><label className="kit-history-search"><Search size={16} aria-hidden="true"/><span className="visually-hidden">Search company, role or resume</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search company, role or resume"/></label><label className="kit-history-sort"><span className="visually-hidden">Sort applications</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">Recently updated</option><option value="company">Company / name</option></select></label></div>
    <p className="workspace-results-count" role="status">{entries.length} of {all.length} {all.length === 1 ? 'application' : 'applications'}{query ? ` matching “${search.trim()}”` : ''}</p>
    {!entries.length ? <div className="kit-history-empty"><FileText size={26} aria-hidden="true"/><h2>{query || filter !== 'all' ? 'No matching applications' : 'Your next opportunity starts here'}</h2><p>{query || filter !== 'all' ? 'Try another company, role or resume name.' : 'Start a new tailoring above. Its job, source resume and edits will be saved together.'}</p>{(query || filter !== 'all') && <button className="button button-secondary" onClick={() => { setSearch(''); setFilter('all'); }}>Clear search and filters</button>}</div> : <div className="kit-history-list workspace-application-list">{entries.map(project => {
      const progress = applicationProgress(project), failed = failedIds.includes(project.id);
      return <article className="kit-history-card workspace-application-card" key={project.id}>
        <div className="workspace-application-top"><button className="kit-history-open" onClick={() => onOpen(project)}><span className="kit-company-initial" aria-hidden="true">{(project.job.company || project.name).slice(0, 1).toUpperCase()}</span><span><strong>{project.job.title || project.name}</strong><span>{project.job.company || 'Company not added'}</span></span></button><span className={`kit-badge ${failed ? 'error' : progress.stage === 'reviewed' ? 'ok' : ''}`}>{failed ? 'Not saved' : progress.label}</span><details className="folio-row-actions" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); event.stopPropagation(); } }}><summary aria-label={`Actions for ${project.name}`}><MoreHorizontal size={18}/></summary><div><button onClick={() => onOpen(project)}>Open application</button><button onClick={() => onNew(project)}>Use job for a new draft</button><button onClick={() => onRename(project)}>Rename</button><button onClick={() => onDelete(project)}>Delete application</button></div></details></div>
        <p className="workspace-application-next">{failed ? 'This copy has unsaved changes. Retry saving before you leave it.' : progress.description}</p>
        <dl className="workspace-application-metadata"><div><dt>Source resume</dt><dd title={project.source.name}>{project.source.name}</dd></div><div><dt>Layout / draft</dt><dd>v{project.template.revision} / r{project.draft.revision}</dd></div><div><dt>Career Memory</dt><dd>{project.memorySnapshot ? `Pinned v${project.memorySnapshot.memoryRevision}` : 'No snapshot recorded'}</dd></div></dl>
        <details className="workspace-pinned-details"><summary>Source and version details</summary><p>Source fingerprint <code>{project.source.sha256}</code></p><p>Application ID <code>{project.id}</code></p>{project.memorySnapshot && <p>Source resume revision {project.memorySnapshot.sourceResumeRevision} · {project.memorySnapshot.eligibleFactIds.length} eligible saved facts at creation.</p>}<p>{progress.lastDownload ? <>PDF download recorded {shortDate(progress.lastDownload.createdAt)}, draft r{progress.lastDownload.content.revision}. New edits require another review.</> : project.folio?.historyKnown ? 'No PDF download recorded for this application.' : 'Earlier download history is unavailable for this application.'}</p></details>
        <footer><time dateTime={project.updatedAt}>Updated {shortDate(project.updatedAt)}</time>{failed ? <button className="text-button folio-unsaved" onClick={() => onRetry(project)}>Retry save<ArrowRight size={14}/></button> : <button className="text-button" aria-label={`${progress.stage === 'draft' ? 'Continue' : 'Open'} ${project.job.title || project.name}`} onClick={() => onOpen(project)}>{progress.stage === 'draft' ? 'Continue application' : 'Open application'}<ArrowRight size={14}/></button>}</footer>
      </article>;
    })}</div>}
    {!!all.length && <p className="workspace-storage-note"><LockKeyhole size={13} aria-hidden="true"/>Applications are saved in this browser. Keep a project backup in Settings for recovery.</p>}
  </div>;
}

export function HomeWorkspace({ profile, projects, resume, value, busy, onChange, onContinue, onOpen, onHistory, onLayout, onContext, onMemory, onUpload }: {
  profile: PrivateProfile | null; projects: Project[]; resume?: Project; value: string; busy: boolean;
  onChange: (text: string) => void; onContinue: () => void; onOpen: (project: Project) => void; onHistory: () => void;
  onLayout: () => void; onContext: () => void; onMemory: () => void; onUpload: () => void;
}) {
  const hour = new Date().getHours(), salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const name = profile?.name.trim().split(/\s+/)[0];
  const applications = applicationEntries(projects), recent = applications.slice(0, 3);
  const unfinished = applications.find(item => applicationProgress(item).lastDownload?.content.revision !== item.draft.revision);
  const approved = !!resume && hasValidApproval(resume);
  function submit() { if (value.trim() && !busy && approved) onContinue(); }
  return <section className="kit-home workspace-home" aria-labelledby="home-heading">
    <div className="workspace-home-heading"><p className="kit-overline">Your application workspace</p><h1 id="home-heading">{salutation}{name ? `, ${name}` : ''}<span>Make your next application count.</span></h1><p>Your experience. Your resume. A focused version for each role.</p></div>
    {unfinished && <section className="workspace-resume-work" aria-label="Continue unfinished application"><div><span className="kit-overline">Continue where you left off</span><h2>{unfinished.job.title || unfinished.name}</h2><p>{unfinished.job.company ? `${unfinished.job.company} · ` : ''}{applicationProgress(unfinished).label} · Updated {shortDate(unfinished.updatedAt)}</p></div><button className="button button-secondary" disabled={busy} onClick={() => onOpen(unfinished)}>Continue<ArrowRight size={16}/></button></section>}
    {resume ? <>
      <section className="workspace-selected-resume" aria-label="Selected resume"><span className="workspace-document-icon"><FileText size={23} aria-hidden="true"/></span><div><span className="kit-overline">Selected resume</span><h2 title={resume.source.name}>{resume.source.name}</h2><p>{resume.template.pages.length} {resume.template.pages.length === 1 ? 'page' : 'pages'} · Layout v{resume.template.revision} · {approved ? 'Layout approved' : 'Layout review needed'}</p></div><button className="text-button" disabled={busy} onClick={onLayout}>{approved ? 'Change' : 'Review layout'}<ChevronRight size={14}/></button></section>
      <form className="kit-home-composer workspace-home-composer" onSubmit={event => { event.preventDefault(); submit(); }}><label htmlFor="home-job">Tailor for a new job</label><textarea id="home-job" rows={4} value={value} maxLength={50000} placeholder="Paste the responsibilities and requirements from the job post…" readOnly={busy} aria-describedby="home-job-hint" onChange={event => onChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }}/><div><span id="home-job-hint">Your text carries into the next step.</span><button className="button button-primary" type="submit" aria-label="Continue to tailoring" disabled={!value.trim() || busy || !approved}>Continue<ArrowRight size={16}/></button></div></form>
    </> : <div className="kit-home-upload"><FileText size={26} aria-hidden="true"/><h2>Add your current resume</h2><p>Start with a PDF or Word document. Review the reconstructed layout before tailoring.</p><button className="button button-primary" disabled={busy} onClick={onUpload}>Choose a resume<ArrowRight size={16}/></button></div>}
    <div className="kit-home-recent-heading"><h2>Recent applications</h2><button className="text-button" disabled={busy} onClick={onHistory}>View all<ChevronRight size={14}/></button></div><div className="kit-home-recents">{recent.length ? recent.map(item => { const progress = applicationProgress(item); return <button className="kit-recent-row" key={item.id} disabled={busy} onClick={() => onOpen(item)}><FileText size={18} aria-hidden="true"/><span><strong>{item.job.title || item.name}</strong><small>{item.job.company ? `${item.job.company} · ` : ''}Updated {shortDate(item.updatedAt)}</small></span><span className={`kit-badge ${progress.stage === 'reviewed' ? 'ok' : ''}`}>{progress.label}</span></button>; }) : <p className="kit-home-empty">Your applications will appear here with their saved job and resume version.</p>}</div>
    <section className="kit-memory-prompt workspace-memory-prompt"><div><Brain size={22} aria-hidden="true"/><h2>Keep your experience ready</h2><p>Save confirmed achievements once and reuse them in future applications.</p></div><div><button disabled={busy || !resume} onClick={onContext}><Plus size={16}/>Add career context<ChevronRight size={14}/></button><button disabled={busy || !resume} onClick={onMemory}><BookOpen size={16}/>Review Career Memory<ChevronRight size={14}/></button></div></section>
  </section>;
}

export function JobComposer({ resume, value, consent, busy, error, onChange, onConsent, onTailor, onLayout, onUpload, onOpenDraft, service, onCheckService, jobDetails, onJobDetailsChange }: {
  resume?: Project; value: string; consent: boolean; busy: string; error: string;
  onChange: (text: string) => void; onConsent: (value: boolean) => void; onTailor: () => void;
  onLayout: () => void; onUpload: () => void; onOpenDraft: () => void;
  service?: ComposerServiceReadiness; onCheckService?: () => void;
  jobDetails?: { title: string; company: string }; onJobDetailsChange?: (details: { title: string; company: string }) => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null), deferredValue = useDeferredValue(value);
  const analysis = useMemo(() => resume && deferredValue.trim() && !/^https?:\/\/\S+$/i.test(deferredValue.trim())
    ? matchProject({ ...resume, job: { ...resume.job, description: deferredValue } }) : null, [resume, deferredValue]);
  const link = /^https?:\/\/\S+$/i.test(value.trim());
  const sourceBlocked = !!resume?.template.sourceType1Baseline;
  const serviceReady = service?.state === 'ready';
  const canTailor = !!value.trim() && !link && consent && !busy && serviceReady && !sourceBlocked && !!resume && hasValidApproval(resume);
  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    const height = Math.min(400, Math.max(268, input.current.scrollHeight));
    input.current.style.height = `${height}px`;
    input.current.closest<HTMLElement>('.folio-compose')?.style.setProperty('--composer-input-height', `${height}px`);
  }, [value]);
  if (busy && ['Reading the job', 'Tailoring supported content', 'Checking layout'].includes(busy)) {
    const phases = ['Reading the job', 'Tailoring supported content', 'Checking layout'], current = phases.indexOf(busy);
    return <section className="folio-compose kit-process workspace-composer" aria-labelledby="composer-heading"><p className="kit-overline">{jobDetails?.company || resume?.job.company || 'Your next role'}</p><h1 id="composer-heading">Tailoring your resume</h1><p>Using your resume and confirmed Career Memory.</p><div className="kit-process-card" role="status" aria-live="polite"><ol>{phases.map((phase, index) => <li className={index < current ? 'done' : index === current ? 'active' : ''} key={phase} aria-current={index === current ? 'step' : undefined}><span>{index < current ? <Check size={13}/> : index === current ? <i className="kit-spinner"/> : null}</span>{phase}{index < current && <span className="visually-hidden">Complete</span>}</li>)}</ol></div><p>You can cancel below. Your saved job and draft remain available.</p></section>;
  }
  return <section className="folio-compose workspace-composer" aria-labelledby="composer-heading">
    <div className="folio-compose-copy"><p className="kit-overline">A focused application</p><h1 id="composer-heading">Start with the job.</h1><p>Bring the requirements. Keep every change grounded in your experience.</p></div>
    {!resume ? <div className="folio-setup-card"><FileText size={24}/><h2>Start with your resume</h2><p>Upload and compare your layout before tailoring a job.</p><button className="button button-primary" onClick={onUpload}>Choose a resume</button></div> : <>
      <section className="workspace-selected-resume" aria-label="Resume for this application"><span className="workspace-document-icon"><FileText size={22}/></span><div><span className="kit-overline">Resume for this application</span><h2 title={resume.source.name}>{resume.source.name}</h2><p>Layout v{resume.template.revision} · {resume.template.pages.length} {resume.template.pages.length === 1 ? 'page' : 'pages'} · {hasValidApproval(resume) ? 'Approved' : 'Review needed'}</p></div><button className="text-button" disabled={!!busy} onClick={onLayout}>Change<ChevronRight size={14}/></button></section>
      {jobDetails && onJobDetailsChange && <div className="workspace-job-details"><label>Role title <span>Optional</span><input value={jobDetails.title} maxLength={300} readOnly={!!busy} placeholder="e.g. Product Designer" onChange={event => onJobDetailsChange({ ...jobDetails, title: event.target.value })}/></label><label>Company <span>Optional</span><input value={jobDetails.company} maxLength={300} readOnly={!!busy} placeholder="e.g. Northstar" onChange={event => onJobDetailsChange({ ...jobDetails, company: event.target.value })}/></label></div>}
      <label className="workspace-job-label" htmlFor="workspace-job-description">Job description</label>
      <div className={`folio-composer ${error ? 'has-error' : ''} ${value.length > 900 ? 'has-long-input' : ''}`}><textarea id="workspace-job-description" ref={input} aria-label="Job link or description" aria-describedby="composer-hint" value={value} maxLength={50000} placeholder="Paste responsibilities, requirements and preferred experience…" readOnly={!!busy} onChange={event => onChange(event.target.value)} onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); if (canTailor) onTailor(); } }}/><div className="folio-composer-footer"><span className="folio-type-chip">{value.trim() ? `${value.trim().split(/\s+/).length} words` : 'Full job text works best'}</span><span className="workspace-local-indicator"><LockKeyhole size={12}/>Local until you send</span></div></div>
      <p id="composer-hint" className={`folio-composer-hint ${link ? 'workspace-job-link-warning' : ''}`}>{link ? 'Paste the full job description. Job links are saved as text and are not fetched.' : 'Folio only uses facts from your own resume and notes.'}</p>
      {analysis && <details className="workspace-job-analysis" aria-busy={deferredValue !== value}><summary><Search size={16}/><span>Explore your saved evidence<small>Local word matching · no AI request</small></span><ChevronDown size={16}/></summary><div><p>This compares words in the posting with eligible resume facts and confirmed Career Memory. Read the quotes to assess relevance; this is not a qualification or ATS score.</p><div className="workspace-evidence-groups"><section><h3>Found in saved evidence</h3>{analysis.evidence.length ? <ul>{[...new Set(analysis.evidence.flatMap(item => item.matchedTerms))].map(term => <li key={term}>{term}</li>)}</ul> : <p>No direct term matches yet.</p>}</section><section><h3>Not found in saved evidence</h3>{analysis.gaps.length ? <ul>{analysis.gaps.map(term => <li key={term}>{term}</li>)}</ul> : <p>No unmatched terms in this local scan.</p>}</section></div>{!!analysis.evidence.length && <section className="workspace-evidence-quotes"><h3>Supporting quotes</h3>{analysis.evidence.slice(0, 4).map(item => <blockquote key={item.factId}><p>{item.text}</p><footer>{item.source === 'resume' ? 'Resume evidence' : 'Confirmed career evidence'} · {item.matchedTerms.join(', ')}</footer></blockquote>)}{analysis.evidence.length > 4 && <p>{analysis.evidence.length - 4} more matching facts are available during review.</p>}</section>}<p>Missing terms can reflect different wording or missing context. Add only details you can confirm.</p></div></details>}
      <section className={`workspace-ai-readiness ${serviceReady && !sourceBlocked ? 'is-ready' : ''}`} aria-label="AI tailoring readiness"><div><span className="workspace-service-indicator"/><h2>{sourceBlocked ? 'This layout needs manual editing' : serviceReady ? 'AI tailoring is available' : 'AI suggestions are off'}</h2>{onCheckService && <button className="text-button" disabled={!!busy || service?.state === 'checking'} onClick={onCheckService}>{service?.state === 'checking' ? 'Checking…' : 'Check service'}</button>}</div><p role="status">{sourceBlocked ? 'Full job tailoring is unavailable for this Type 1 source. Open the draft to use its marked editing capabilities, or select another supported template.' : service?.message || 'Service status has not been checked. Local evidence review and manual editing are available.'}</p></section>
      {serviceReady && <label className="checkbox-label folio-transfer-consent"><input type="checkbox" checked={consent} disabled={!!busy} onChange={event => onConsent(event.target.checked)}/>I agree to send this job and selected resume evidence to the configured provider.</label>}
      <div className="workspace-compose-actions">{serviceReady && !sourceBlocked ? <><button className="button button-secondary" disabled={!!busy || !value.trim() || !hasValidApproval(resume)} onClick={onOpenDraft}>Open draft editor</button><button className="button button-primary" disabled={!canTailor} aria-describedby="workspace-tailoring-gate" onClick={onTailor}>{busy || 'Tailor resume'}<ArrowRight size={16}/></button></> : <button className="button button-primary" disabled={!!busy || !value.trim() || !hasValidApproval(resume)} aria-describedby="workspace-tailoring-gate" onClick={onOpenDraft}>{busy || 'Continue'}<ArrowRight size={16}/></button>}</div>
      <p id="workspace-tailoring-gate" className="workspace-action-hint">{!hasValidApproval(resume) ? 'Review and approve the selected layout to continue.' : !value.trim() ? 'Add a job description to continue.' : link ? 'Paste the full job text before AI tailoring.' : !serviceReady || sourceBlocked ? 'Next: review your resume against this job and download it.' : !consent ? 'Allow the exact request above to enable AI tailoring.' : 'Ready to send · ⌘ / Ctrl Enter'}</p>
      <details className="folio-transfer-details"><summary>What is shared when I tailor?</summary><p>The job, selected resume paragraphs and eligible saved evidence are sent to the configured provider. Text can include contact details. Private workspace notes stay here.</p><p>Only Tailor resume sends an inference request. Local matching, service status and manual editing do not generate AI content. Saved drafts keep their evidence snapshot.</p></details>
      {error && <div className="folio-compose-error" role="alert"><strong>Tailoring didn’t finish</strong><p>{error}</p>{link && <button className="button button-secondary" onClick={() => { input.current?.focus(); input.current?.select(); }}>Paste the job description</button>}<button className="text-button" onClick={onOpenDraft}>Open the saved draft editor<ArrowRight size={14}/></button></div>}
    </>}
  </section>;
}

export function PrivateProfileView({ profile, projects, error, onSave, onOpen }: { profile: PrivateProfile | null; projects: Project[]; error: string; onSave: (profile: PrivateProfile) => Promise<void>; onOpen: (project: Project) => void }) {
  const [editing, setEditing] = useState(false), [name, setName] = useState(''), [headline, setHeadline] = useState(''), [zone, setZone] = useState(''), [saving, setSaving] = useState(false), [saveError, setSaveError] = useState('');
  const [offset, setOffset] = useState(0), [mobile, setMobile] = useState(() => matchMedia('(max-width:699px)').matches), [selected, setSelected] = useState('');
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => { const media = matchMedia('(max-width:699px)'), change = () => setMobile(media.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change); }, []);
  useEffect(() => {
    if (!mobile) return;
    const area = grid.current?.closest<HTMLElement>('.folio-heatmap-scroll');
    const selectedDay = grid.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!area || !selectedDay) return;
    const viewport = area.getBoundingClientRect(), cell = selectedDay.getBoundingClientRect();
    if (cell.right > viewport.right) area.scrollLeft += cell.right - viewport.right;
    else if (cell.left < viewport.left) area.scrollLeft += cell.left - viewport.left;
  }, [mobile, offset, profile?.countingSince]);
  if (!profile) return <section className="folio-profile"><h1>My profile</h1><p role={error ? 'alert' : 'status'}>{error || 'Opening your private profile…'}</p></section>;
  const summary = activitySummary(projects, profile), days = dayRange(summary.today, mobile ? 8 : 26, offset), activeDay = selected && days.includes(selected) ? selected : days.at(-1)!;
  const formatDay = (day: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: profile.timeZone }).format(new Date());
  const dayEvents = summary.days.get(activeDay) ?? [], identity = profile.name || 'Your private profile';
  async function save() { setSaving(true); setSaveError(''); try { await onSave({ ...profile!, name: name.trim(), headline: headline.trim(), timeZone: zone }); setEditing(false); } catch (reason) { setSaveError(reason instanceof Error ? reason.message : 'Profile could not be saved. Your edits remain here.'); } finally { setSaving(false); } }
  return <section className="folio-profile" aria-labelledby="profile-heading"><header className="folio-profile-identity"><div className="folio-profile-avatar">{profile.name ? profile.name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => [...word][0]).join('').toUpperCase() : <UserRound size={36} />}</div>{editing ? <form className="folio-profile-edit" onSubmit={event => { event.preventDefault(); void save(); }}><label>Name<input autoFocus value={name} maxLength={160} onChange={event => setName(event.target.value)} /></label><label>Headline<input value={headline} maxLength={240} onChange={event => setHeadline(event.target.value)} /></label><label>Activity timezone<input value={zone} onChange={event => setZone(event.target.value)} placeholder="Europe/London" /></label><div><button className="button button-primary" disabled={saving}>Save</button><button type="button" className="button button-secondary" disabled={saving} onClick={() => setEditing(false)}>Cancel</button></div>{saveError && <p role="alert">{saveError}</p>}</form> : <><h1 id="profile-heading">{identity}</h1><p>{profile.headline || 'Your resume, your experience, your next move.'}</p><button className="text-button" onClick={() => { setName(profile.name); setHeadline(profile.headline); setZone(profile.timeZone); setEditing(true); }}>Edit profile</button></>}<small><LockKeyhole size={13} />Private · saved on this device</small></header>
    <div className="folio-profile-metrics">{[{ value: summary.allTime, label: 'Resumes tailored' }, { value: summary.month, label: `Tailored in ${monthLabel}` }, { value: summary.jobs, label: 'Jobs tailored for' }].map(metric => <div key={metric.label}><strong>{metric.value ?? '—'}</strong><span>{metric.label}</span></div>)}</div>
    <p className="folio-profile-scope">{summary.legacy ? 'Older saved history has no reliable completion records. Unavailable totals are shown as —. ' : ''}Counts use successful tailoring runs, never downloads, edits or reopens. Recording began {formatDay(summary.firstDay)}.</p>
    <section className="folio-activity" aria-labelledby="activity-heading"><div className="folio-activity-heading"><div><h2 id="activity-heading">Daily activity</h2><p>{days[0].slice(0, 4) === summary.today.slice(0, 4) ? summary.today.slice(0, 4) : `${days[0].slice(0, 4)}–${summary.today.slice(0, 4)}`} · {profile.timeZone}</p></div><div><button className="icon-button" aria-label="Earlier activity weeks" onClick={() => { setOffset(value => value + (mobile ? 8 : 26)); setSelected(''); }}><ChevronLeft size={16} /></button><button className="icon-button" disabled={offset === 0} aria-label="Later activity weeks" onClick={() => { setOffset(value => Math.max(0, value - (mobile ? 8 : 26))); setSelected(''); }}><ChevronRight size={16} /></button></div></div>
    <div className="folio-heatmap-scroll"><div className="folio-heatmap-months" aria-hidden="true">{days.filter((_,index)=>index%7===0).map((day,index,weeks)=>{const month=day.slice(0,7),show=!index||month!==weeks[index-1].slice(0,7);return <span key={day}>{show?new Intl.DateTimeFormat(undefined,{month:'short',timeZone:'UTC'}).format(new Date(`${day}T12:00:00Z`)):''}</span>;})}</div><div className="folio-heatmap-axis" aria-hidden="true"><span/><span>Mon</span><span/><span>Wed</span><span/><span>Fri</span><span/></div><div ref={grid} className="folio-heatmap" role="group" aria-label="Daily successful resume tailorings" onKeyDown={event => { const current = (event.target as HTMLElement).dataset.day; if (!current) return; const index = days.indexOf(current), delta = event.key === 'ArrowRight' ? 7 : event.key === 'ArrowLeft' ? -7 : event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0; if (delta || event.key === 'Home' || event.key === 'End') { event.preventDefault(); const next = days[event.key === 'Home' ? 0 : event.key === 'End' ? days.length - 1 : Math.min(days.length - 1, Math.max(0, index + delta))]; setSelected(next); grid.current?.querySelector<HTMLButtonElement>(`[data-day="${next}"]`)?.focus(); } }}>{days.map(day => { const count = summary.days.get(day)?.length ?? 0, unavailable = day < summary.firstDay && !count, label = `${formatDay(day)}, ${unavailable ? 'no data' : `${count} tailored ${count === 1 ? 'resume' : 'resumes'}`}${day === summary.today ? ', today' : ''}`; return <button key={day} data-day={day} data-level={Math.min(count, 3)} className={`${unavailable ? 'no-data' : ''} ${day === summary.today ? 'today' : ''} ${day === activeDay ? 'selected' : ''}`} aria-label={label} aria-pressed={day === activeDay} title={label} tabIndex={day === activeDay ? 0 : -1} onFocus={() => setSelected(day)} onClick={() => setSelected(day)}><span /></button>; })}</div></div>
    <div className="folio-heatmap-legend"><span>Less</span>{[0, 1, 2, 3].map(level => <i key={level} data-level={level} />)}<span>More</span><i className="no-data" /><span>No data</span><i className="today" /><span>Today</span></div>
    <div className="folio-activity-day"><h3>{formatDay(activeDay)}</h3><p>{activeDay < summary.firstDay && !dayEvents.length ? 'No completion data for this day.' : dayEvents.length ? `${dayEvents.length} successful tailorings` : 'No resumes tailored on this day.'}</p>{dayEvents.map(event => { const target = projects.find(project => project.id === event.projectId); return <div className="folio-day-result" key={event.id}><FileText size={18} /><div><strong>{event.company || event.title}</strong><span>{event.title} · {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: profile.timeZone }).format(new Date(event.at))}</span></div>{target ? <button className="text-button" onClick={() => onOpen(target)}>Open<ArrowRight size={14} /></button> : <span>Saved result removed</span>}</div>; })}</div></section>
    {error && <p role="alert">{error}</p>}
  </section>;
}

export type InsightTab = 'changes' | 'job' | 'versions' | 'notes';
export function WorkspaceInsights({ project, tab, onTabChange, onClose, onNewFromJob, onPrivateNotes, onRevert, onAccept, onRestoreVersion, onCompareVersion, onAddEvidence, onDecideMany, onSelectBlock, selectedBlockId, readiness, busy = false, children }: {
  project: Project; tab: InsightTab; onTabChange: (tab: InsightTab) => void; onClose: () => void;
  onNewFromJob: () => void; onPrivateNotes: (text: string) => void; onRevert: (id: string) => void;
  onAccept: (id: string) => void; onRestoreVersion: (id: string) => void; onCompareVersion: (id: string) => void;
  onAddEvidence: (id?: string,text?:string) => void; selectedBlockId?: string; children?: React.ReactNode;
  onDecideMany?: (ids: string[], decision: 'accepted' | 'rejected') => void;
  onSelectBlock?: (id: string) => void; readiness?: React.ReactNode; busy?: boolean;
}) {
  const prefix = useId(), tabs: InsightTab[] = ['changes','job','versions','notes'];
  const root=useRef<HTMLElement>(null),[selectedReviewId,setSelectedReviewId]=useState<string|null>(null);
  useEffect(()=>{
    const opener=document.activeElement as HTMLElement|null;
    if(opener?.closest('.folio-region'))return;
    root.current?.querySelector<HTMLButtonElement>('[aria-label="Close insights"]')?.focus({preventScroll:true});
    return()=>{if(opener?.isConnected)opener.focus({preventScroll:true});};
  },[]);
  const changes = changedParagraphs(project), metadata = workspaceOf(project).kind === 'application' ? presentation(project) : null;
  const unsupported = new Set(sourceReviewIssues(project)), gaps = matchProject(project).gaps;
  const activeReviewId = changes.some(change=>change.id===selectedReviewId) ? selectedReviewId : changes.some(change=>change.id===selectedBlockId) ? selectedBlockId : changes[0]?.id;
  const acceptedIds = new Set(changes.filter(change => metadata?.changes[change.id] === 'accepted' && !unsupported.has(change.id)).map(change => change.id));
  const acceptedCount = acceptedIds.size;
  const unreviewedSupported = changes.filter(change => !unsupported.has(change.id) && metadata?.changes[change.id] !== 'accepted');
  useEffect(() => { setSelectedReviewId(selectedBlockId ?? null); }, [project.id, selectedBlockId]);
  function selectChange(id: string) { setSelectedReviewId(id); onSelectBlock?.(id); }
  function nextChange() { if (!changes.length) return; const index=changes.findIndex(change=>change.id===activeReviewId); selectChange(changes[(index+1)%changes.length].id); }
  useEffect(()=>{
    function keyboard(event: KeyboardEvent) {
      if(tab !== 'changes' || event.defaultPrevented || event.key.toLowerCase()!=='j'||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||event.isComposing)return;
      const target=event.target as HTMLElement|null;
      if (!changes.length || !target || !root.current?.contains(target) || !root.current.getClientRects().length) return;
      if(target?.closest('input,textarea,select,[contenteditable="true"],[role="textbox"]'))return;
      event.preventDefault(); nextChange();
    }
    document.addEventListener('keydown',keyboard);
    return()=>document.removeEventListener('keydown',keyboard);
  },[activeReviewId,changes.map(change=>change.id).join('|'),tab,onSelectBlock]);
  const rejected = Object.entries(metadata?.changes ?? {}).filter(([id,status]) => status === 'rejected' && !changes.some(change => change.id === id));
  return <section ref={root} className="folio-insights" aria-label="Tailoring insights" onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();onClose();}
  }}>
    <div className="folio-insights-heading"><h2>Review{project.job.company ? ` · ${project.job.company}` : ''}</h2><button className="icon-button" aria-label="Close insights" onClick={onClose}><X size={18}/></button></div>
    <div className="folio-insights-tabs" role="tablist" aria-label="Insight views" onKeyDown={event => {
      const index = tabs.indexOf(tab);
      if (['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) {
        event.preventDefault(); const next = tabs[event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index+(event.key === 'ArrowRight'?1:3))%4];
        onTabChange(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
      }
    }}>{tabs.map(value => <button role="tab" id={`${prefix}-${value}`} aria-controls={`${prefix}-panel`} data-tab={value} tabIndex={tab===value?0:-1} aria-selected={tab===value} key={value} className={tab===value?'on':''} onClick={()=>onTabChange(value)}>{value[0].toUpperCase()+value.slice(1)}</button>)}</div>
    <div className="folio-insights-body" id={`${prefix}-panel`} role="tabpanel" aria-labelledby={`${prefix}-${tab}`} tabIndex={0}>
      {tab==='changes' ? <>
        {readiness}
        <div className="kit-review-progress"><span>{changes.length} suggested {changes.length===1?'change':'changes'}</span><small>{acceptedCount} reviewed</small><div><i style={{width:`${changes.length?acceptedCount/changes.length*100:0}%`}}/></div></div>
        {onDecideMany && !!changes.length && <div className="kit-review-batch">{!!unreviewedSupported.length && <button className="button button-secondary" disabled={busy} onClick={()=>onDecideMany(unreviewedSupported.map(change=>change.id),'accepted')}>Accept {unreviewedSupported.length} source-supported {unreviewedSupported.length === 1 ? 'change' : 'changes'}</button>}<button className="text-button" disabled={busy} onClick={()=>onDecideMany(changes.map(change=>change.id),'rejected')}>Revert all changes</button></div>}
        {!!acceptedCount && <p className="upgrade-change-context" role="status">{acceptedCount} {acceptedCount === 1 ? 'change marked' : 'changes marked'} reviewed. Final claim confirmation is a separate step.</p>}
        {!changes.length && <p className="subtle">No wording changes yet. Your original text is preserved.</p>}
        {changes.filter(change=>change.id===activeReviewId).map(change=>{
          const block=project.draft.blocks.find(item=>item.id===change.id), ids=new Set([...(block?.sourceFactIds??[]),...(block?.runs.flatMap(run=>run.sourceFactIds??[])??[])]), sources=project.facts.filter(fact=>ids.has(fact.id));
          return <details className={`folio-change ${unsupported.has(change.id)?'needs-source':''}`} key={change.id} open>
            <summary className="kit-selected-change-summary"><span className="folio-change-swatch"/><span>{change.after.slice(0,110)||'Text removed'}</span><ChevronDown size={14}/></summary>
            <div><div className="kit-change-overline"><span>Review this change</span><span className={`kit-badge ${unsupported.has(change.id)?'warn':metadata?.changes[change.id]==='accepted'?'ok':'warn'}`}>{metadata?.changes[change.id]==='accepted'&&!unsupported.has(change.id)?'Accepted':'To review'}</span></div><p className="kit-change-reason">This wording is already in the current draft. Compare it with the original and its saved evidence before accepting.</p><div className="upgrade-change-position"><span>Change {changes.findIndex(item => item.id === change.id) + 1} of {changes.length}</span>{onSelectBlock && <button className="text-button" onClick={() => onSelectBlock(change.id)}>Locate on page<ArrowRight size={13}/></button>}</div><small>Original wording</small><p className="folio-before">{change.before || 'Empty paragraph'}</p><small>Current draft</small><p className="folio-after">{change.after || 'Text removed'}</p>
              {unsupported.has(change.id)&&<p className="folio-source-alert" role="status">This wording is not proved by a complete saved fact. Review your exact experience before download.</p>}
              <small>Linked source evidence</small>{!sources.length && <p className="upgrade-empty-source">No saved source is linked to this wording. Add a real career detail or restore the original.</p>}{sources.map(fact=>{const provenance=project.memorySnapshot?.evidence.find(item=>item.factId===fact.id)?.provenance,quote=provenance?.originalQuote,kind=provenance?.sourceKind;const label=kind==='linkedinPaste'?'LinkedIn import':kind==='localDictation'?'Voice note':fact.kind==='resume'?'Your resume':kind==='typed'?'Added by you':'Saved context';return <div className="kit-change-source" key={fact.id}><blockquote><p>{quote||fact.text}</p></blockquote><div><span className={`kit-badge ${kind==='linkedinPaste'?'blue':kind==='localDictation'?'violet':''}`}><FileText size={12}/>{label}</span><cite>{provenance?.locator || fact.locator}</cite></div>{provenance?.sourceName && <small className="upgrade-source-status">{provenance.sourceName}{project.memorySnapshot ? ` · pinned Career Memory v${project.memorySnapshot.memoryRevision}` : ''}</small>}<small className="upgrade-source-status">{fact.kind === 'resume' ? 'Extracted from the supplied resume' : fact.confirmed ? 'Confirmed by you' : 'Not confirmed'}{fact.text === change.after ? ' · exact current wording' : ' · compare with the current wording'}</small>{quote&&quote!==fact.text&&<details><summary>Saved fact wording</summary><p>{fact.text}</p></details>}</div>;})}
              <div className="folio-change-actions">{!unsupported.has(change.id)&&metadata?.changes[change.id]!=='accepted'&&<button className="button button-primary" disabled={busy} onClick={()=>{onAccept(change.id);nextChange();}}>Accept change</button>}<button className="button button-secondary" disabled={busy} onClick={()=>onRevert(change.id)}>Restore original</button>{unsupported.has(change.id)&&<button className="text-button" disabled={busy} onClick={()=>onAddEvidence(change.id)}>Add evidence</button>}</div>
              <button className="text-button kit-next-change" onClick={nextChange}>Next change<ArrowRight size={14}/></button>
            </div>
          </details>;
        })}
        {!!changes.length&&<section className="kit-all-changes"><h3>All changes</h3>{changes.map((change,index)=><button className={change.id===activeReviewId?'on':''} aria-pressed={change.id===activeReviewId} key={change.id} onClick={()=>selectChange(change.id)}><span className={acceptedIds.has(change.id)?'accepted':''}>{acceptedIds.has(change.id)?<Check size={11}/>:index+1}</span><p>{change.after||'Text removed'}</p></button>)}</section>}
        {rejected.map(([id])=><div key={id} className="folio-kept-change"><Check size={14}/>Rejected · original kept</div>)}
        {!!metadata?.held?.length&&<section className="folio-held"><h3>{metadata.held.length} suggestions kept out</h3>{metadata.held.map((item,index)=><details className="folio-change" key={`${item.blockId}-${index}`}><summary>{item.text.slice(0,100)}</summary><div><p>{item.text}</p><p className="subtle">{item.reason}</p><button className="button button-secondary" onClick={()=>onAddEvidence(item.blockId,item.text)}>Review this wording</button><small>Exact saved facts</small>{item.factIds.map(id=>{const fact=project.facts.find(f=>f.id===id);return fact&&<blockquote key={id}>{fact.text}<cite>{fact.locator}</cite></blockquote>;})}</div></details>)}</section>}
        {!!gaps.length&&<section className="folio-gap"><h3>Not found in saved sources</h3><div className="term-tags">{gaps.slice(0,12).map(term=><span key={term}>{term}</span>)}</div><p>The posting uses these terms. They were not added as qualifications and do not block download.</p><button className="text-button" onClick={()=>onAddEvidence()}>Add real experience</button></section>}
        <details className="folio-existing-tools"><summary>Evidence, tailoring setup and export review</summary>{children}</details>
      </> : tab==='job' ? <>
        <h3>{project.job.title||'Saved job description'}</h3>{project.job.company&&<p>{project.job.company}</p>}<p className="folio-saved-job">{project.job.description||'No job description saved.'}</p><p className="subtle">Resume: {project.source.name}<br/>Saved layout v{project.template.revision}{project.memorySnapshot&&<><br/>Career Memory v{project.memorySnapshot.memoryRevision} · pinned for this tailoring</>}</p><button className="button button-secondary" onClick={onNewFromJob}><Plus size={15}/>Edit as new tailoring</button>
      </> : tab==='notes' ? <>
        <h3>Private notes</h3><p className="subtle">Only you see this. Never added to files or provider requests.</p><label className="visually-hidden" htmlFor={`${prefix}-private-notes`}>Private notes for this tailoring</label><textarea id={`${prefix}-private-notes`} disabled={!metadata} value={metadata?.privateNotes??''} maxLength={10000} rows={8} onChange={event=>onPrivateNotes(event.target.value)}/><div className="folio-future-feature"><span>Cover letter</span><small>Not available yet</small></div><div className="folio-future-feature"><span>Mentor review</span><small>Not available yet</small></div>
      </> : <>
        <h3>Versions</h3><p>Current · revision {project.draft.revision}</p>{metadata?.versions.length?metadata.versions.map(version=><div className="folio-version" key={version.id}><FileText size={16}/><div><strong>{version.kind==='download'?'Downloaded · PDF':version.kind==='firstResult'?'First result':'Restored version'}</strong><span>{new Date(version.createdAt).toLocaleString()}</span></div><button className="text-button" onClick={()=>onCompareVersion(version.id)}>Compare</button><button className="text-button" onClick={()=>onRestoreVersion(version.id)}>Restore</button></div>):<p className="subtle">No version history recorded for this saved resume.</p>}<p className="subtle">Versions keep this tailoring’s original layout. Word export is unavailable.</p>
      </>}
    </div>
  </section>;
}

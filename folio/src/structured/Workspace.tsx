import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Briefcase, Check, FileText, Library, LoaderCircle, LogOut, Plus, Trash2, Upload } from 'lucide-react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { REGIONS } from '../auth/regions';
import { linkProps } from '../site/router';
import { MemoryPage } from './MemoryPage';
import { emptyMemory, pushMemory, readMemory, syncMemory, withItem, writeMemory, type Memory, type MemoryItem } from './memory';
import { readResume } from './api';
import { takeHandoff } from './handoff';
import { jobLabel, newResume, withJob, withoutJob, type ResumeRecord } from './model';
import { SAMPLE_JOB, SAMPLE_NAME, SAMPLE_RESUME } from './sample';
import { deleteResume, listResumes, putResume } from './store';
import { StructuredStudio } from './StructuredStudio';
import { accountSaving, pushResume, removeRemote, setAccountSaving, syncAll, tidyAfterOff, type Account } from './sync';
import '../ui/folio-kit-tokens.css';
import './workspace.css';

type SyncState = 'idle' | 'saving' | 'saved' | 'error';
interface Open { key: string; resume: ResumeRecord | Promise<ResumeRecord>; name: string; jobId: string | null; fresh?: boolean; note?: string; sampleJob?: string; retry?: () => void }
type Page = 'resumes' | 'jobs' | 'memory' | 'tailor';
const PATHS: Record<Page, string> = { resumes: '/app', jobs: '/app/jobs', memory: '/app/memory', tailor: '/app/tailor' };
const pageOf = (): Page => { const path = window.location.pathname.replace(/\/+$/, ''); return path === '/app/jobs' ? 'jobs' : path === '/app/memory' ? 'memory' : path === '/app/tailor' ? 'tailor' : 'resumes'; };
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: new Date(iso).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });

/** The resumes on this device, kept in step with the user's account when they are signed in. */
function useLibrary(account: Account | null) {
  const [resumes, setResumes] = useState<ResumeRecord[] | null>(null);
  // Whether the account keeps copies is the account's own setting; it is unknown (and nothing is sent) until asked.
  const [toAccount, setToAccount] = useState(false), [state, setState] = useState<SyncState>('idle');
  const queue = useRef(new Map<string, ResumeRecord>()), timer = useRef<number | null>(null);
  const live = account && toAccount ? account : null, liveRef = useRef(live); liveRef.current = live;
  const accountRef = useRef(account); accountRef.current = account;
  const user = account?.user ?? '', region = account?.region ?? null;

  const flush = useCallback(async () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const target = liveRef.current, waiting = [...queue.current.values()]; queue.current.clear();
    if (!target || !waiting.length) return;
    setState('saving');
    try {
      for (const record of waiting) {
        const saved = await pushResume(target, record);
        // Only mark it saved if nothing changed while it was on its way.
        setResumes(list => list?.map(item => { if (item.id !== saved.id || item.updatedAt !== saved.updatedAt) return item; void putResume(saved).catch(() => {}); return saved; }) ?? list);
      }
      setState('saved');
    } catch { for (const record of waiting) if (!queue.current.has(record.id)) queue.current.set(record.id, record); setState('error'); }
  }, []);

  const refresh = useCallback(async () => {
    const target = accountRef.current;
    if (!target) { setToAccount(false); setResumes(await listResumes()); setState('idle'); return; }
    setState('saving');
    try {
      // Checked with the server first: a session that has ended, or a switch turned off elsewhere, must not look like an empty account.
      const on = await accountSaving(target);
      setToAccount(on);
      if (on) setResumes(await syncAll(target)); else { await tidyAfterOff(target); setResumes(await listResumes()); }
      setState(on ? 'saved' : 'idle');
    } catch { setResumes(await listResumes()); setState('error'); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, user, region]);
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    document.addEventListener('visibilitychange', onHide);
    return () => { document.removeEventListener('visibilitychange', onHide); void flush(); };
  }, [flush]);

  const save = useCallback((record: ResumeRecord) => {
    setResumes(list => [record, ...(list ?? []).filter(item => item.id !== record.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
    void putResume(record).catch(() => {});
    if (liveRef.current) { queue.current.set(record.id, record); if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void flush(), 1200); }
    return record;
  }, [flush]);
  const remove = useCallback((id: string) => {
    queue.current.delete(id); setResumes(list => list?.filter(item => item.id !== id) ?? list);
    void deleteResume(id); if (liveRef.current) void removeRemote(liveRef.current, id);
  }, []);
  /** Turning the switch off deletes the account's copies and stops every device sending more; each device keeps what it has. */
  const setSaving = useCallback(async (on: boolean) => {
    const target = accountRef.current;
    if (!target) return false;
    setState('saving');
    try {
      if (!on) queue.current.clear();
      await setAccountSaving(target, on); setToAccount(on);
      if (on) setResumes(await syncAll(target)); else setResumes(await listResumes());
      setState(on ? 'saved' : 'idle'); return true;
    } catch { setState('error'); return false; }
  }, []);
  return { resumes, save, remove, flush, state, toAccount: !!live, setSaving, retry: () => void (queue.current.size ? flush() : refresh()) };
}

/** The applicant's career memory on this device, kept in step with the account when that is switched on. */
function useMemory(account: Account | null, toAccount: boolean) {
  const [memory, setMemory] = useState<Memory | null>(null);
  const live = account && toAccount ? account : null, liveRef = useRef(live); liveRef.current = live;
  const timer = useRef<number | null>(null), latest = useRef<Memory | null>(null);
  const user = account?.user ?? '';
  useEffect(() => {
    let active = true;
    void (async () => {
      const local = await readMemory();
      if (active) { latest.current = local; setMemory(local); }
      if (!liveRef.current) return;
      try { const merged = await syncMemory(liveRef.current); if (active) { latest.current = merged; setMemory(merged); } } catch { /* the local copy stays in use; the next change tries again */ }
    })();
    return () => { active = false; };
  }, [user, toAccount]);
  const save = useCallback((next: Memory) => {
    latest.current = next; setMemory(next); void writeMemory(next).catch(() => {});
    if (timer.current) window.clearTimeout(timer.current);
    if (liveRef.current) timer.current = window.setTimeout(() => { const target = liveRef.current, value = latest.current; if (target && value) void pushMemory(target, value).then(saved => { if (latest.current === value) { latest.current = saved; setMemory(saved); void writeMemory(saved).catch(() => {}); } }).catch(() => {}); }, 1000);
  }, []);
  const add = useCallback((item: MemoryItem) => save(withItem(latest.current ?? emptyMemory(), item)), [save]);
  return { memory, save, add };
}

export function Workspace() {
  const auth = useOptionalAuth(), user = auth?.user ?? null, region = auth?.region ?? null;
  const userId = user?.id ?? '';
  const account = useMemo<Account | null>(() => userId && region ? { user: userId, region } : null, [userId, region]);
  const library = useLibrary(account);
  const { resumes, save } = library;
  const career = useMemory(account, library.toAccount);
  const [page, setPage] = useState<Page>(pageOf), [open, setOpen] = useState<Open | null>(null);
  const [error, setError] = useState(''), [dragging, setDragging] = useState(false), [confirm, setConfirm] = useState(''), [confirmOff, setConfirmOff] = useState(false);
  /** A posting sent from the "Send to Folio" button on another site, waiting for a resume to go with it. */
  const [clipped, setClipped] = useState('');
  const input = useRef<HTMLInputElement>(null), clippedRef = useRef(''); clippedRef.current = clipped;

  const go = useCallback((next: Page, replace = false) => {
    if (window.location.pathname !== PATHS[next]) window.history[replace ? 'replaceState' : 'pushState'](null, '', PATHS[next]);
    setPage(next); if (next !== 'tailor') setOpen(null);
    window.scrollTo?.(0, 0);
  }, []);
  // The browser's Back button leaves the tailoring page like any other page.
  useEffect(() => {
    const onPop = () => { const next = pageOf(); setPage(next); if (next !== 'tailor') setOpen(null); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  // A reload on the tailoring page has nothing to show; go back to the resumes.
  useEffect(() => { if (page === 'tailor' && !open) go('resumes', true); }, [page, open, go]);
  const show = useCallback((next: Open) => { setError(''); setOpen(next); if (window.location.pathname !== PATHS.tailor) window.history.pushState(null, '', PATHS.tailor); setPage('tailor'); }, []);

  /** Starts reading straight away (once, here) so the resume is ready by the time the job is pasted. */
  const start = useCallback((name: string, file: Promise<{ text: string; pages: number | null }>, note?: string) => {
    const reading = file.then(async ({ text, pages }) => {
      if (text.trim().length < 200) throw new Error('This file has no readable text. It may be a scan or an image. Try a Word file or a PDF with selectable text.');
      return save(newResume(name, await readResume(text), pages));
    });
    reading.catch(() => {});
    show({ key: crypto.randomUUID(), resume: reading, name, jobId: null, fresh: true, note, retry: () => start(name, file, note) });
  }, [save, show]);
  const addFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Add a PDF or Word (.docx) file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('That file is larger than 10 MB. Add a smaller PDF or Word file.'); return; }
    start(file.name, import('./plainText').then(({ readFile }) => readFile(file)).catch(() => { throw new Error('This file could not be opened. Try saving it again as a PDF or Word file.'); }));
  }, [start]);
  const openResume = useCallback((resume: ResumeRecord, jobId: string | null = null) => show({ key: crypto.randomUUID(), resume, name: resume.sourceName, jobId, sampleJob: resume.sourceName === SAMPLE_NAME ? SAMPLE_JOB : undefined }), [show]);
  const openSample = useCallback(() => {
    const record = save(newResume(SAMPLE_NAME, SAMPLE_RESUME, 1));
    show({ key: crypto.randomUUID(), resume: record, name: SAMPLE_NAME, jobId: null, sampleJob: SAMPLE_JOB, note: 'This is a fictional sample. Paste any job posting, or use the sample one, to see how tailoring works.' });
  }, [save, show]);
  /** "New job": straight to the job step with the most recent resume, or to adding one. */
  const newJob = useCallback(() => { if (resumes?.length) openResume(resumes[0]); else { go('resumes'); input.current?.click(); } }, [resumes, openResume, go]);

  // Arriving with something in hand: a posting from the Send to Folio button, the landing page's sample link, or a resume from the exact-layout workspace.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return; arrived.current = true;
    const url = new URL(window.location.href);
    if (url.hash.startsWith('#job=')) {
      try { setClipped(decodeURIComponent(url.hash.slice(5)).replace(/\r/g, '').slice(0, 20000).trim()); } catch { /* not a posting Folio sent */ }
      window.history.replaceState(null, '', url.pathname + url.search);
    }
    const handed = takeHandoff();
    if (handed) { start(handed.name, Promise.resolve({ text: handed.text, pages: handed.pages ?? null }), handed.note); return; }
    if (url.searchParams.get('sample') === '1') { url.searchParams.delete('sample'); window.history.replaceState(null, '', url.pathname + url.search); openSample(); }
  }, [start, openSample]);
  // A clipped posting opens on the most recent resume as soon as the resumes are known.
  useEffect(() => { if (clipped && resumes?.length && !open) openResume(resumes[0]); }, [clipped, resumes, open, openResume]);

  const signOut = async () => { await library.flush(); await auth?.signOut(); };
  const hasResumes = !!resumes?.length, jobs = (resumes ?? []).flatMap(resume => resume.jobs.map(job => ({ resume, job }))).sort((a, b) => b.job.createdAt.localeCompare(a.job.createdAt));
  const status = !user ? (hasResumes ? 'Saved on this device' : '') : library.state === 'error' ? 'Couldn’t reach your account' : library.state === 'saving' ? 'Saving to your account…'
    : !library.toAccount ? 'Saved on this device only' : `Saved to your account${region ? ` (${REGIONS[region].label})` : ''}`;
  const applied = (resume: ResumeRecord, job: ResumeRecord['jobs'][number]) => save(withJob(resume, job.status === 'applied' ? { ...job, status: 'draft', appliedAt: null } : { ...job, status: 'applied', appliedAt: new Date().toISOString() }));
  const nav: { page: Page; label: string; icon: typeof FileText; count?: number }[] = [
    { page: 'resumes', label: 'Resumes', icon: FileText, count: resumes?.length }, { page: 'jobs', label: 'Jobs', icon: Briefcase, count: jobs.length }, { page: 'memory', label: 'Career memory', icon: Library, count: career.memory?.items.length },
  ];
  const current = page === 'tailor' ? 'jobs' : page;

  const accountBlock = <div className="shell-account">
    {status && <p className={`shell-status ${library.state === 'error' ? 'is-error' : ''}`} role="status">{library.toAccount && library.state === 'saved' && <Check size={13} aria-hidden="true" />}{status}{library.state === 'error' && <button type="button" className="text-button" onClick={library.retry}>Retry</button>}</p>}
    {user ? <>
      <p className="shell-who" title={user.email ?? ''}>{user.email}</p>
      {confirmOff
        ? <div className="shell-confirm"><p>Stop saving to your account? The copies there are deleted, nothing more is sent from any of your devices, and each device keeps what it has.</p><div className="structured-row"><button type="button" className="button button-secondary button-small" onClick={() => void library.setSaving(false).then(() => setConfirmOff(false))}>Turn off</button><button type="button" className="button button-secondary button-small" onClick={() => setConfirmOff(false)}>Keep on</button></div></div>
        : <div className="shell-switch" role="group" aria-label="Save my work to my account"><span>Save to my account</span><button type="button" aria-pressed={library.toAccount} disabled={library.state === 'saving'} onClick={() => { if (!library.toAccount) void library.setSaving(true); }}>On</button><button type="button" aria-pressed={!library.toAccount} disabled={library.state === 'saving'} onClick={() => { if (library.toAccount) setConfirmOff(true); }}>Off</button></div>}
      <button type="button" className="shell-link" onClick={() => void signOut()}><LogOut size={15} aria-hidden="true" />Sign out</button>
    </> : auth?.status !== 'loading' && <div className="structured-row"><button type="button" className="button button-secondary button-small" onClick={() => auth?.openAuth('signin')}>Sign in</button><button type="button" className="button button-secondary button-small" onClick={() => auth?.openAuth('signup')}>Create account</button></div>}
    <p className="shell-small"><a {...linkProps('classic')}>Exact-layout workspace</a><a {...linkProps('privacy')}>Privacy</a></p>
  </div>;

  return <div className={`shell ${page === 'tailor' ? 'is-tailoring' : ''}`} onDragOver={event => { if (event.dataTransfer.types.includes('Files') && page !== 'memory') { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={event => { if (page === 'memory') return; event.preventDefault(); setDragging(false); addFile(event.dataTransfer.files[0]); }}>
    <a className="site-skip" href="#main">Skip to content</a>
    <aside className="shell-side">
      <a className="shell-brand" href="/app" onClick={event => { event.preventDefault(); go('resumes'); }}><span className="home-logo" aria-hidden="true">F</span>Folio</a>
      <button type="button" className="button button-primary shell-new" onClick={newJob}><Plus size={16} aria-hidden="true" />New job</button>
      <nav className="shell-nav" aria-label="Folio">{nav.map(item => <a key={item.page} href={PATHS[item.page]} aria-current={current === item.page ? 'page' : undefined} onClick={event => { event.preventDefault(); go(item.page); }}><item.icon size={17} aria-hidden="true" /><span>{item.label}</span>{!!item.count && <em>{item.count}</em>}</a>)}</nav>
      {accountBlock}
    </aside>

    <main id="main" className="shell-main">
      <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={event => { addFile(event.target.files?.[0]); event.target.value = ''; }} />
      {open && page === 'tailor' ? <StructuredStudio key={open.key} resume={open.resume} name={open.name} jobId={open.jobId} note={open.note} fresh={open.fresh} sampleJob={open.sampleJob} initialJob={clipped} onJobTaken={() => setClipped('')}
          toAccount={library.toAccount} memory={career.memory} onAddMemory={career.add} onOpenMemory={() => go('memory')} resumes={resumes ?? []} onSwitch={resume => openResume(resume)} onSave={save} onRetry={open.retry} onExit={() => go('jobs')} />
      : <div className="shell-page">
        {error && <p className="structured-error" role="alert">{error}</p>}
        {clipped && !hasResumes && resumes !== null && <p className="home-account" role="status">Job posting received: “{clipped.split('\n')[0].slice(0, 90)}”. Add your resume and Folio will tailor it for this job.</p>}

        {page === 'memory' ? (career.memory ? <MemoryPage memory={career.memory} onChange={career.save} toAccount={library.toAccount} signedIn={!!user} /> : <p className="home-loading" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />Opening your career memory</p>)
        : resumes === null ? <p className="home-loading" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />Opening your resumes</p>
        : page === 'jobs' ? <>
            <div className="home-head"><div><h1>Jobs</h1><p className="home-lead">Every resume you’ve tailored, with its cover letter. Open one to download it again or keep working on it.</p></div><button type="button" className="button button-primary button-small" onClick={newJob}><Plus size={14} aria-hidden="true" />New job</button></div>
            {jobs.length === 0 ? <div className="home-empty"><h2>No jobs yet</h2><p>Paste a job posting and Folio rewrites your resume for it. Each one is saved here.</p><button type="button" className="button button-secondary" onClick={newJob}>{hasResumes ? 'Tailor for a job' : 'Add your resume to start'}</button></div>
            : <ul className="home-table" aria-label="Tailored jobs">{jobs.map(({ resume, job }) => <li key={job.id}>
                <button type="button" className="home-job" onClick={() => openResume(resume, job.id)}><strong>{jobLabel(job.job)}</strong><span>{resume.base.name || resume.sourceName} · Tailored {day(job.createdAt)}{job.letter ? ' · Cover letter' : ''}</span></button>
                {confirm === job.id
                  ? <span className="home-confirm">Delete this job? <button type="button" className="text-button" onClick={() => { save(withoutJob(resume, job.id)); setConfirm(''); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirm('')}>Keep</button></span>
                  : <span className="home-job-actions"><button type="button" className={`home-chip ${job.status === 'applied' ? 'is-on' : ''}`} aria-pressed={job.status === 'applied'} onClick={() => applied(resume, job)}>{job.status === 'applied' ? <><Check size={13} aria-hidden="true" />Applied {day(job.appliedAt ?? job.updatedAt)}</> : 'Mark as applied'}</button><button type="button" className="icon-button" aria-label={`Delete ${jobLabel(job.job)}`} onClick={() => setConfirm(job.id)}><Trash2 size={15} /></button></span>}
              </li>)}</ul>}
          </>
        : !hasResumes ? <section className={`home-start ${dragging ? 'is-dragging' : ''}`}>
            <h1>Tailor your resume to a job</h1>
            <p className="home-lead">Add your resume and a job posting. Folio rewrites the resume for that job using only what you’ve told it about yourself, keeps it on the same number of pages, and gives you a PDF or Word file.</p>
            <ol className="home-steps"><li><strong>1</strong>Add your resume</li><li><strong>2</strong>Paste the job link or text</li><li><strong>3</strong>Review and download</li></ol>
            <button type="button" className="button button-primary home-add" onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />Add your resume</button>
            <p className="home-hint">PDF or Word. You can also drop the file anywhere on this page. Its text is read by AI (OpenAI) as soon as you add it; the file itself stays on your device.</p>
            <button type="button" className="text-button home-sample" onClick={openSample}>Try a sample resume</button>
            {!user && <p className="home-hint">Your first tailoring is free. No account needed.</p>}
          </section>
        : <>
            <div className="home-head"><div><h1>Resumes</h1><p className="home-lead">Pick a resume to tailor for a job. Folio keeps your wording and page count, and saves every tailored version.</p></div><button type="button" className="button button-secondary button-small" onClick={() => input.current?.click()}><Upload size={14} aria-hidden="true" />Add a resume</button></div>
            {!user && <p className="home-account">These are saved in this browser only. <button type="button" className="text-button" onClick={() => auth?.openAuth('signup')}>Create a free account</button> to keep them safe and tailor more jobs.</p>}
            <ul className="home-resumes">{resumes.map((resume, index) => <li key={resume.id} className="home-resume">
              <div className="home-resume-head">
                <FileText size={18} aria-hidden="true" />
                <div><h2>{resume.base.name || resume.sourceName}</h2><p>{[resume.base.headline, resume.pages ? `${resume.pages} ${resume.pages === 1 ? 'page' : 'pages'}` : '', `Updated ${day(resume.updatedAt)}`].filter(Boolean).join(' · ')}</p></div>
                <button type="button" className={`button ${index === 0 ? 'button-primary' : 'button-secondary'} button-small`} onClick={() => openResume(resume)}>Tailor for a job</button>
              </div>
              {resume.jobs.length > 0 && <ul className="home-jobs">{resume.jobs.slice(0, 3).map(job => <li key={job.id}><button type="button" className="home-job" onClick={() => openResume(resume, job.id)}><strong>{jobLabel(job.job)}</strong><span>{job.status === 'applied' ? `Applied ${day(job.appliedAt ?? job.updatedAt)}` : `Tailored ${day(job.createdAt)}`}{job.letter ? ' · Cover letter' : ''}</span></button></li>)}</ul>}
              <div className="home-resume-foot">
                {resume.jobs.length > 3 ? <button type="button" className="text-button" onClick={() => go('jobs')}>All {resume.jobs.length} jobs</button> : <span>{resume.jobs.length ? `${resume.jobs.length} ${resume.jobs.length === 1 ? 'job' : 'jobs'}` : 'No jobs yet'}</span>}
                {confirm === resume.id
                  ? <span className="home-confirm">Delete this resume{resume.jobs.length ? ` and its ${resume.jobs.length} ${resume.jobs.length === 1 ? 'job' : 'jobs'}` : ''}? <button type="button" className="text-button" onClick={() => { library.remove(resume.id); setConfirm(''); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirm('')}>Keep</button></span>
                  : <button type="button" className="text-button" onClick={() => setConfirm(resume.id)}>Delete resume</button>}
              </div>
            </li>)}</ul>
          </>}
        <div className="shell-account-phone">{accountBlock}</div>
      </div>}
    </main>

    <nav className="shell-tabs" aria-label="Folio">{nav.map(item => <a key={item.page} href={PATHS[item.page]} aria-current={current === item.page ? 'page' : undefined} onClick={event => { event.preventDefault(); go(item.page); }}><item.icon size={19} aria-hidden="true" /><span>{item.label}</span></a>)}<button type="button" onClick={newJob}><Plus size={19} aria-hidden="true" /><span>New job</span></button></nav>
    {dragging && <div className="home-drop" aria-hidden="true">Drop your resume to add it</div>}
  </div>;
}

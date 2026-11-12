import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, LoaderCircle, MoreHorizontal, Plus, Upload } from 'lucide-react';
import { useOptionalAuth } from '../auth/AuthProvider';
import { REGIONS } from '../auth/regions';
import { linkProps } from '../site/router';
import { readResume } from './api';
import { takeHandoff } from './handoff';
import { useMenuDismiss } from './menu';
import { jobLabel, newResume, withJob, withoutJob, type ResumeRecord } from './model';
import { SAMPLE_JOB, SAMPLE_NAME, SAMPLE_RESUME } from './sample';
import { deleteResume, listResumes, putResume } from './store';
import { StructuredStudio } from './StructuredStudio';
import { accountSaving, pushResume, removeRemote, setAccountSaving, syncAll, tidyAfterOff, type Account } from './sync';
import '../ui/folio-kit-tokens.css';
import './workspace.css';

type SyncState = 'idle' | 'saving' | 'saved' | 'error';
interface Open { key: string; resume: ResumeRecord | Promise<ResumeRecord>; name: string; jobId: string | null; note?: string; sampleJob?: string; retry?: () => void }
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

export function Workspace() {
  const auth = useOptionalAuth(), user = auth?.user ?? null, region = auth?.region ?? null;
  const userId = user?.id ?? '';
  const account = useMemo<Account | null>(() => userId && region ? { user: userId, region } : null, [userId, region]);
  const library = useLibrary(account);
  const { resumes, save } = library;
  const [open, setOpen] = useState<Open | null>(null), [error, setError] = useState(''), [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState(''), [confirmOff, setConfirmOff] = useState(false);
  const input = useRef<HTMLInputElement>(null), menu = useRef<HTMLDetailsElement>(null);

  /** Starts reading straight away (once, here) so the resume is ready by the time the job is pasted. */
  const start = useCallback((name: string, text: Promise<string>, note?: string) => {
    const reading = text.then(value => {
      if (value.trim().length < 200) throw new Error('This file has no readable text. It may be a scan or an image. Try a Word file or a PDF with selectable text.');
      return readResume(value);
    }).then(base => save(newResume(name, base)));
    reading.catch(() => {});
    setError(''); setOpen({ key: crypto.randomUUID(), resume: reading, name, jobId: null, note, retry: () => start(name, text, note) });
  }, [save]);
  const addFile = useCallback((file: File | undefined) => {
    if (!file) return;
    if (!/\.(pdf|docx)$/i.test(file.name)) { setError('Add a PDF or Word (.docx) file.'); return; }
    if (file.size > 10 * 1024 * 1024) { setError('That file is larger than 10 MB. Add a smaller PDF or Word file.'); return; }
    start(file.name, import('./plainText').then(({ plainText }) => plainText(file)).catch(() => { throw new Error('This file could not be opened. Try saving it again as a PDF or Word file.'); }));
  }, [start]);
  const openSample = useCallback(() => {
    const record = save(newResume(SAMPLE_NAME, SAMPLE_RESUME));
    setError(''); setOpen({ key: crypto.randomUUID(), resume: record, name: SAMPLE_NAME, jobId: null, sampleJob: SAMPLE_JOB, note: 'This is a fictional sample. Paste any job posting, or use the sample one, to see how tailoring works.' });
  }, [save]);

  // Arriving from the landing page's sample link, or from the exact-layout workspace with a resume in hand.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current) return; arrived.current = true;
    const handed = takeHandoff();
    if (handed) { start(handed.name, Promise.resolve(handed.text), handed.note); return; }
    const url = new URL(window.location.href);
    if (url.searchParams.get('sample') === '1') { url.searchParams.delete('sample'); window.history.replaceState(null, '', url.pathname + url.search + url.hash); openSample(); }
  }, [start, openSample]);

  const closeMenu = () => { menu.current?.removeAttribute('open'); setConfirmOff(false); };
  useMenuDismiss(menu, useCallback(() => setConfirmOff(false), []));
  const signOut = async () => { closeMenu(); await library.flush(); await auth?.signOut(); };
  const hasResumes = !!resumes?.length;
  const status = !user ? (hasResumes ? 'Saved on this device' : '') : library.state === 'error' ? 'Couldn’t reach your account' : library.state === 'saving' ? 'Saving to your account…'
    : !library.toAccount ? 'Saved on this device only' : `Saved to your account${region ? ` (${REGIONS[region].label})` : ''}`;

  return <div className="home" onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addFile(event.dataTransfer.files[0]); }}>
    <header className="home-bar" inert={!!open}>
      <a className="home-brand" {...linkProps('app')}><span className="home-logo" aria-hidden="true">F</span>Folio</a>
      <div className="home-bar-actions">
        {status && <span className={`home-status ${library.state === 'error' ? 'is-error' : ''}`} role="status">{library.toAccount && library.state === 'saved' && <Check size={13} aria-hidden="true" />}{status}{library.state === 'error' && <button type="button" className="text-button" onClick={library.retry}>Retry</button>}</span>}
        {!user && auth?.status !== 'loading' && <button type="button" className="button button-secondary button-small" onClick={() => auth?.openAuth('signin')}>Sign in</button>}
        <details className="structured-menu" ref={menu}>
          <summary className="button button-secondary button-small" aria-label="Account and options"><MoreHorizontal size={16} aria-hidden="true" /></summary>
          <div className="structured-menu-list">
            {user && <p className="home-menu-who">{user.email}</p>}
            {status && <p className="home-menu-status">{status}</p>}
            {user && (confirmOff
              ? <div className="home-menu-confirm"><p>Stop saving to your account? The copies there are deleted, on all your devices nothing more is sent, and each device keeps the resumes it has.</p><div className="structured-row"><button type="button" className="button button-secondary button-small" onClick={() => void library.setSaving(false).then(closeMenu)}>Turn off</button><button type="button" className="button button-secondary button-small" onClick={() => setConfirmOff(false)}>Keep on</button></div></div>
              : <div className="structured-menu-row" role="group" aria-label="Save resumes to my account"><span>Save to my account</span><button type="button" aria-pressed={library.toAccount} disabled={library.state === 'saving'} onClick={() => { if (!library.toAccount) void library.setSaving(true); }}>On</button><button type="button" aria-pressed={!library.toAccount} disabled={library.state === 'saving'} onClick={() => { if (library.toAccount) setConfirmOff(true); }}>Off</button></div>)}
            <a {...linkProps('classic')}>Exact-layout workspace</a>
            <a {...linkProps('privacy')}>Privacy</a>
            {user ? <button type="button" onClick={() => void signOut()}>Sign out</button> : <button type="button" onClick={() => { closeMenu(); auth?.openAuth('signup'); }}>Create a free account</button>}
          </div>
        </details>
      </div>
    </header>

    <main id="main" className="home-main" inert={!!open}>
      <input ref={input} type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" hidden onChange={event => { addFile(event.target.files?.[0]); event.target.value = ''; }} />
      {error && <p className="structured-error" role="alert">{error}</p>}

      {resumes === null ? <p className="home-loading" role="status"><LoaderCircle size={18} className="spin" aria-hidden="true" />Opening your resumes</p>
      : !hasResumes ? <section className={`home-start ${dragging ? 'is-dragging' : ''}`}>
          <h1>Tailor your resume to a job</h1>
          <p className="home-lead">Add your resume and paste a job posting. Folio rewrites it for that job using only what your resume already says, and gives you a clean PDF or Word file.</p>
          <button type="button" className="button button-primary home-add" onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />Add your resume</button>
          <p className="home-hint">PDF or Word. You can also drop the file anywhere on this page. Its text is read by AI (OpenAI) as soon as you add it; the file itself stays on your device.</p>
          <button type="button" className="text-button home-sample" onClick={openSample}>Try a sample resume</button>
          {!user && <p className="home-hint">Your first tailoring is free. No account needed.</p>}
        </section>
      : <>
          <div className="home-head"><h1>Your resumes</h1><button type="button" className="button button-secondary button-small" onClick={() => input.current?.click()}><Plus size={14} aria-hidden="true" />Add a resume</button></div>
          {!user && <p className="home-account">These are saved in this browser only. <button type="button" className="text-button" onClick={() => auth?.openAuth('signup')}>Create a free account</button> to keep them safe and tailor more jobs.</p>}
          <ul className="home-resumes">{resumes!.map((resume, index) => <li key={resume.id} className="home-resume">
            <div className="home-resume-head">
              <FileText size={18} aria-hidden="true" />
              <div><h2>{resume.base.name || resume.sourceName}</h2><p>{resume.base.headline || resume.sourceName} · Updated {day(resume.updatedAt)}</p></div>
              <button type="button" className={`button ${index === 0 ? 'button-primary' : 'button-secondary'} button-small`} onClick={() => setOpen({ key: crypto.randomUUID(), resume, name: resume.sourceName, jobId: null, sampleJob: resume.sourceName === SAMPLE_NAME ? SAMPLE_JOB : undefined })}><Plus size={14} aria-hidden="true" />New job</button>
            </div>
            {resume.jobs.length > 0 && <ul className="home-jobs">{resume.jobs.map(job => <li key={job.id}>
              <button type="button" className="home-job" onClick={() => setOpen({ key: crypto.randomUUID(), resume, name: resume.sourceName, jobId: job.id })}><strong>{jobLabel(job.job)}</strong><span>{job.status === 'applied' ? `Applied ${day(job.appliedAt ?? job.updatedAt)}` : `Tailored ${day(job.createdAt)}`}{job.letter ? ' · Cover letter' : ''}</span></button>
              {confirm === job.id
                ? <span className="home-confirm">Delete? <button type="button" className="text-button" onClick={() => { save(withoutJob(resume, job.id)); setConfirm(''); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirm('')}>Keep</button></span>
                : <span className="home-job-actions"><button type="button" className="text-button" aria-pressed={job.status === 'applied'} onClick={() => save(withJob(resume, job.status === 'applied' ? { ...job, status: 'draft', appliedAt: null } : { ...job, status: 'applied', appliedAt: new Date().toISOString() }))}>{job.status === 'applied' ? <><Check size={13} aria-hidden="true" />Applied</> : 'Mark as applied'}</button><button type="button" className="text-button" onClick={() => setConfirm(job.id)}>Delete</button></span>}
            </li>)}</ul>}
            <div className="home-resume-foot">
              <span>{resume.jobs.length ? `${resume.jobs.length} ${resume.jobs.length === 1 ? 'job' : 'jobs'}` : 'No jobs yet'}</span>
              {confirm === resume.id
                ? <span className="home-confirm">Delete this resume{resume.jobs.length ? ` and its ${resume.jobs.length} ${resume.jobs.length === 1 ? 'job' : 'jobs'}` : ''}? <button type="button" className="text-button" onClick={() => { library.remove(resume.id); setConfirm(''); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirm('')}>Keep</button></span>
                : <button type="button" className="text-button" onClick={() => setConfirm(resume.id)}>Delete resume</button>}
            </div>
          </li>)}</ul>
        </>}
    </main>
    {dragging && <div className="home-drop" aria-hidden="true">Drop your resume to add it</div>}

    {open && <StructuredStudio key={open.key} resume={open.resume} name={open.name} jobId={open.jobId} note={open.note} sampleJob={open.sampleJob} toAccount={library.toAccount} onSave={save} onRetry={open.retry} onExit={() => setOpen(null)} />}
  </div>;
}

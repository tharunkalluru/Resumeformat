import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, LoaderCircle, MoreHorizontal, RotateCcw, Sparkles } from 'lucide-react';
import { detectRegion, rememberedRegion } from '../auth/regions';
import { useOptionalAuth } from '../auth/AuthProvider';
import { PdfPreview } from '../ui/PdfPreview';
import { safeName } from '../ui/fileNames';
import { readResume, tailorResume, StructuredAiError } from './api';
import { applyTailoring, clean, jobHeading, jobMatch, suggestionKeys, type Job, type StructuredRecord, type StructuredResume } from './model';
import { renderResumePdf, type Highlight, type Paper } from './pdf';
import { loadStructured, saveStructured } from './store';
import './structured.css';

type Phase = 'loading' | 'reading' | 'ready' | 'tailoring' | 'failed';
const message = (error: unknown) => error instanceof StructuredAiError || error instanceof Error ? error.message : 'Something went wrong. Try again.';
const save = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };

/** What the workspace needs from an upload: its words. `note` explains how the user got here. */
export interface StudioSource { id: string; name: string; text: string; job?: Job; note?: string }

export function StructuredStudio({ source, onExit, onExactLayout }: { source: StudioSource; onExit: () => void; onExactLayout?: () => void }) {
  const auth = useOptionalAuth(), signedIn = !!auth?.user;
  const [phase, setPhase] = useState<Phase>('loading'), [error, setError] = useState('');
  const [record, setRecord] = useState<StructuredRecord | null>(null);
  const [paper, setPaper] = useState<Paper>(() => (rememberedRegion() ?? detectRegion()) === 'in' ? 'a4' : 'letter');
  const [pdf, setPdf] = useState<{ bytes: Uint8Array; pages: number; tightened: boolean } | null>(null);
  const [editing, setEditing] = useState(false), [busyFile, setBusyFile] = useState<'' | 'pdf' | 'docx'>('');
  const abort = useRef<AbortController | null>(null), layer = useRef<HTMLDivElement>(null), menu = useRef<HTMLDetailsElement>(null);

  // The workspace covers the app, so keyboard focus stays inside it and returns to the opener on close.
  useEffect(() => {
    const opener = document.activeElement;
    layer.current?.querySelector<HTMLElement>('.structured-back')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !layer.current || document.querySelector('.auth-overlay')) return;
      const items = [...layer.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')].filter(item => !item.hasAttribute('disabled') && item.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1], active = document.activeElement;
      if (!layer.current.contains(active)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && active === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (opener instanceof HTMLElement && opener.isConnected) opener.focus(); };
  }, []);

  const update = useCallback((change: (current: StructuredRecord) => StructuredRecord) => {
    setRecord(current => { if (!current) return current; const next = change(current); void saveStructured(next).catch(() => {}); return next; });
  }, []);

  const read = useCallback(async () => {
    setPhase('reading'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      const base = await readResume(source.text, controller.signal);
      const next: StructuredRecord = { projectId: source.id, sourceName: source.name, base, updatedAt: new Date().toISOString(), job: { title: source.job?.title ?? '', company: source.job?.company ?? '', description: source.job?.description ?? '' }, tailoring: null, decisions: {} };
      await saveStructured(next).catch(() => {}); setRecord(next); setPhase('ready');
    } catch (reason) { if (!controller.signal.aborted) { setError(message(reason)); setPhase('failed'); } }
  }, [source]);

  // Open a saved reading if there is one; otherwise read the resume once the user is signed in.
  useEffect(() => {
    let active = true;
    void loadStructured(source.id).then(saved => {
      if (!active) return;
      if (saved) { setRecord(saved); setPhase('ready'); } else if (signedIn) void read(); else setPhase('failed');
    });
    return () => { active = false; abort.current?.abort(); };
  }, [source.id, signedIn, read]);

  const current = useMemo(() => record ? applyTailoring(clean(record.base), record.tailoring, record.decisions) : null, [record]);
  // Changed lines are tinted in the preview only; the downloaded file is rendered clean.
  const highlight = useMemo<Highlight>(() => new Set(record?.tailoring ? [...record.tailoring.bullets.filter(item => record.decisions[`bullet:${item.id}`] === 'accepted').map(item => item.id), ...(record.tailoring.summary && record.decisions.summary === 'accepted' ? ['summary'] : [])] : []), [record]);
  useEffect(() => {
    if (!current) return;
    let active = true;
    const timer = setTimeout(() => { void renderResumePdf(current, paper, highlight).then(result => { if (active) setPdf(result); }).catch(reason => { if (active) setError(message(reason)); }); }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [current, paper, highlight]);

  async function tailor() {
    if (!record?.job.description.trim()) return;
    setPhase('tailoring'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      // Role and company are read from the posting, so the user only pastes it.
      const job = { ...record.job, ...jobHeading(record.job.description) };
      const tailoring = await tailorResume(clean(record.base), job, controller.signal);
      // Changes are applied straight away; each one can be undone.
      update(value => ({ ...value, job, tailoring, decisions: Object.fromEntries(suggestionKeys(tailoring).map(key => [key, 'accepted' as const])) })); setPhase('ready');
    } catch (reason) { if (!controller.signal.aborted) { setError(message(reason)); } setPhase('ready'); }
  }
  async function download(kind: 'pdf' | 'docx') {
    if (!current || !record) return;
    setBusyFile(kind); menu.current?.removeAttribute('open');
    try {
      const name = [current.name, record.tailoring ? record.job.company : '', record.tailoring ? record.job.title : ''].map(part => safeName(part)).filter(Boolean).join('-') || 'Resume';
      if (kind === 'pdf') { const { bytes } = await renderResumePdf(current, paper); save(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${name}.pdf`); }
      else { const { renderResumeDocx } = await import('./docx'); save(await renderResumeDocx(current, paper), `${name}.docx`); }
    } catch (reason) { setError(message(reason)); } finally { setBusyFile(''); }
  }

  const tailoring = record?.tailoring ?? null, keys = tailoring ? suggestionKeys(tailoring) : [];
  const on = (key: string) => record?.decisions[key] === 'accepted';
  const toggle = (key: string) => update(value => ({ ...value, decisions: { ...value.decisions, [key]: value.decisions[key] === 'accepted' ? 'rejected' : 'accepted' } }));
  const applied = keys.filter(on).length, held = tailoring ? Object.values(tailoring.dropped).reduce((sum, count) => sum + count, 0) : 0;
  const match = current && record?.job.description.trim() ? jobMatch(current, record.job.description) : null;
  const bulletText = (id: string) => [...(record?.base.experience ?? []), ...(record?.base.projects ?? [])].flatMap(parent => parent.bullets).find(bullet => bullet.id === id)?.text ?? '';
  const closeMenu = () => menu.current?.removeAttribute('open');
  const jobLine = record ? [record.job.title, record.job.company].filter(Boolean).join(' at ') : '';

  return <div ref={layer} className="structured" role="dialog" aria-modal="true" aria-label="Resume template workspace">
    <header className="structured-bar">
      <button type="button" className="structured-back" onClick={onExit}><ArrowLeft size={18} aria-hidden="true" />Back</button>
      <strong title={source.name}>{current?.name || source.name}</strong>
      <div className="structured-bar-actions">
        <details className="structured-menu" ref={menu} onKeyDown={event => { if (event.key === 'Escape') { closeMenu(); event.stopPropagation(); } }}>
          <summary className="button button-secondary button-small" aria-label="More options"><MoreHorizontal size={16} aria-hidden="true" /></summary>
          <div className="structured-menu-list">
            <button type="button" disabled={!current || !!busyFile} onClick={() => void download('docx')}>Download as Word</button>
            <button type="button" disabled={!record} onClick={() => { setEditing(true); closeMenu(); }}>Edit resume text</button>
            <div className="structured-menu-row" role="group" aria-label="Paper size"><span>Paper</span>{(['a4', 'letter'] as Paper[]).map(size => <button key={size} type="button" aria-pressed={paper === size} onClick={() => setPaper(size)}>{size === 'a4' ? 'A4' : 'US Letter'}</button>)}</div>
            {onExactLayout && <button type="button" onClick={onExactLayout}>Keep my exact layout instead</button>}
          </div>
        </details>
        <button type="button" className="button button-primary button-small" disabled={!current || !!busyFile} onClick={() => void download('pdf')}>{busyFile ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}Download</button>
      </div>
    </header>

    <div className="structured-body">
      <section className="structured-panel" aria-label="Tailoring">
        {error && <p className="structured-error" role="alert">{error}</p>}
        {source.note && !error && phase !== 'failed' && !tailoring && <p className="structured-note structured-source-note">{source.note}</p>}

        {(phase === 'loading' || phase === 'reading') && <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Reading your resume</strong><p>About 10 seconds.</p></div></div>}

        {phase === 'failed' && <div className="structured-empty">
          <h1>{signedIn ? 'Your resume could not be read' : 'Sign in to tailor your resume'}</h1>
          <p>{signedIn ? 'Try again in a moment.' : 'Folio uses AI to read your resume and tailor it for each job, so it needs a free account.'}</p>
          <div className="structured-row">{signedIn ? <button type="button" className="button button-primary" onClick={() => void read()}><RotateCcw size={15} />Try again</button> : <button type="button" className="button button-primary" onClick={() => auth?.openAuth('signup')}>Create a free account</button>}{onExactLayout && <button type="button" className="button button-secondary" onClick={onExactLayout}>Keep my exact layout</button>}</div>
        </div>}

        {record && editing && phase !== 'failed' && <>
          <div className="structured-review-head"><h1>Edit resume text</h1><button type="button" className="button button-primary button-small" onClick={() => setEditing(false)}>Done</button></div>
          <ResumeEditor resume={record.base} onChange={base => update(value => ({ ...value, base }))} />
        </>}

        {record && !editing && phase !== 'reading' && phase !== 'loading' && phase !== 'failed' && !tailoring && <>
          <h1>Paste the job</h1>
          <label className="structured-job"><span className="visually-hidden">Job description</span><textarea value={record.job.description} maxLength={20000} rows={12} placeholder="Paste the job posting here…" readOnly={phase === 'tailoring'} onChange={event => update(value => ({ ...value, job: { ...value.job, description: event.target.value } }))} /></label>
          {phase === 'tailoring'
            ? <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Tailoring your resume</strong><p>About 20 seconds.</p></div><button type="button" className="text-button" onClick={() => { abort.current?.abort(); setPhase('ready'); }}>Cancel</button></div>
            : <><button type="button" className="button button-primary structured-primary" disabled={!record.job.description.trim()} onClick={() => void tailor()}><Sparkles size={16} aria-hidden="true" />Tailor my resume</button>
              <p className="structured-note">Folio only uses what your resume already says. The job and your resume text are sent to OpenAI.</p></>}
        </>}

        {record && tailoring && !editing && phase !== 'failed' && <>
          <div className="structured-review-head"><div><h1>{keys.length ? `${applied} of ${keys.length} ${keys.length === 1 ? 'change' : 'changes'} applied` : 'Your resume already fits'}</h1>{jobLine && <p className="structured-lead">For {jobLine}</p>}</div>
            {keys.length > 1 && <button type="button" className="text-button" onClick={() => update(value => ({ ...value, decisions: Object.fromEntries(keys.map(key => [key, applied ? 'rejected' as const : 'accepted' as const])) }))}>{applied ? 'Undo all' : 'Apply all'}</button>}</div>
          <p className="structured-note">{keys.length ? 'Your resume is ready to download. Changed lines are highlighted on the right; undo any you don’t want.' : 'Nothing needed changing for this posting. You can download it as it is.'}</p>

          {tailoring.cuts.length > 0 && <div className="structured-cuts"><h2>{tailoring.cuts.length} {tailoring.cuts.length === 1 ? 'line' : 'lines'} removed</h2>
            <ul>{tailoring.cuts.map(item => <li key={item.id} className={on(`cut:${item.id}`) ? '' : 'is-undone'}><p>{bulletText(item.id)}</p><button type="button" className="text-button" onClick={() => toggle(`cut:${item.id}`)}>{on(`cut:${item.id}`) ? 'Put back' : 'Remove again'}</button></li>)}</ul></div>}

          <ul className="structured-suggestions">
            {tailoring.summary && <Change label="Summary" before={record.base.summary} after={tailoring.summary.text} reason={tailoring.summary.reason} applied={on('summary')} onToggle={() => toggle('summary')} />}
            {tailoring.bullets.map(item => <Change key={item.id} label="Reworded" before={bulletText(item.id)} after={item.text} reason={item.reason} applied={on(`bullet:${item.id}`)} onToggle={() => toggle(`bullet:${item.id}`)} />)}
            {tailoring.order.length > 0 && <Change label="Reordered" before="" after="Most relevant bullets moved to the top of each role." reason="" applied={on('order')} onToggle={() => toggle('order')} />}
            {tailoring.skills.length > 0 && <Change label="Skills" before="" after={`Now leads with ${tailoring.skills.map(group => group.items.slice(0, 3).join(', ')).join(' · ')}.`} reason="" applied={on('skills')} onToggle={() => toggle('skills')} />}
          </ul>

          {(tailoring.missing.length > 0 || match || held > 0) && <details className="structured-more"><summary>How this resume fits the posting</summary>
            {match && <p><strong>{match.found.length} of {match.found.length + match.absent.length}</strong> key terms from the posting are in your resume.</p>}
            {tailoring.missing.length > 0 && <><p>The posting also asks for these. Folio won’t add them; if you have the experience, add it in your own words.</p><ul>{tailoring.missing.map(item => <li key={item}>{item}</li>)}</ul></>}
            {held > 0 && <p>{held} {held === 1 ? 'suggestion was' : 'suggestions were'} held back for using words or numbers not in your resume.</p>}
          </details>}
          <button type="button" className="text-button structured-again" onClick={() => update(value => ({ ...value, tailoring: null, decisions: {}, job: { title: '', company: '', description: '' } }))}>Tailor for a different job</button>
        </>}
      </section>

      <section className="structured-preview" aria-label="Resume preview">
        {pdf ? <>{Array.from({ length: pdf.pages }, (_, index) => <div className="structured-page" key={index}><PdfPreview bytes={pdf.bytes} page={index + 1} label={`Resume page ${index + 1} of ${pdf.pages}`} scale={1.6} /></div>)}
          {pdf.pages > 1 && <p className="structured-preview-foot">{pdf.pages} pages</p>}</>
          : <div className="structured-page structured-page-empty" aria-hidden="true" />}
      </section>
    </div>
  </div>;
}

function Change({ label, before, after, reason, applied, onToggle }: { label: string; before: string; after: string; reason: string; applied: boolean; onToggle: () => void }) {
  return <li className={`structured-suggestion ${applied ? '' : 'is-undone'}`}>
    <div className="structured-change-head"><span className="structured-kind">{label}</span><button type="button" className="text-button" onClick={onToggle}>{applied ? 'Undo' : 'Apply'}</button></div>
    {before && <p className="structured-before">{before}</p>}
    <p className="structured-after">{after}</p>
    {reason && <p className="structured-reason">{reason}</p>}
  </li>;
}

/** Corrections to what was read. This edits the applicant's own base resume, never an AI suggestion. */
function ResumeEditor({ resume, onChange }: { resume: StructuredResume; onChange: (next: StructuredResume) => void }) {
  const field = (label: string, value: string, set: (value: string) => void, multiline = false) => <label key={label}>{label}{multiline ? <textarea value={value} rows={3} onChange={event => set(event.target.value)} /> : <input value={value} onChange={event => set(event.target.value)} />}</label>;
  return <div className="structured-editor">
    {field('Name', resume.name, name => onChange({ ...resume, name }))}
    {field('Headline', resume.headline, headline => onChange({ ...resume, headline }))}
    {field('Contact (one per line)', resume.contact.join('\n'), text => onChange({ ...resume, contact: text.split('\n') }), true)}
    {field('Summary', resume.summary, summary => onChange({ ...resume, summary }), true)}
    {resume.experience.map((role, index) => {
      const set = (patch: Partial<typeof role>) => onChange({ ...resume, experience: resume.experience.map((item, at) => at === index ? { ...item, ...patch } : item) });
      return <fieldset key={role.id}><legend>{role.title || role.company || `Role ${index + 1}`}</legend>
        <div className="structured-fields">{field('Title', role.title, title => set({ title }))}{field('Company', role.company, company => set({ company }))}{field('Location', role.location, location => set({ location }))}{field('Dates', role.dates, dates => set({ dates }))}</div>
        {field('Bullets (one per line)', role.bullets.map(bullet => bullet.text).join('\n'), text => { const lines = text.split('\n'); set({ bullets: lines.map((line, at) => ({ id: role.bullets[at]?.id ?? crypto.randomUUID().slice(0, 8), text: line })) }); }, true)}
      </fieldset>;
    })}
    {resume.skills.map((group, index) => <fieldset key={group.id}><legend>Skills{group.label ? `: ${group.label}` : ''}</legend>{field('Items (comma separated)', group.items.join(', '), text => onChange({ ...resume, skills: resume.skills.map((item, at) => at === index ? { ...item, items: text.split(',').map(part => part.trim()).filter(Boolean) } : item) }), true)}</fieldset>)}
    <p className="structured-note">Education, projects and other sections are kept as read. Editing them comes next.</p>
  </div>;
}

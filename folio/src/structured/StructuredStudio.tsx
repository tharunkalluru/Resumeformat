import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Check, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { detectRegion, rememberedRegion } from '../auth/regions';
import { useOptionalAuth } from '../auth/AuthProvider';
import { PdfPreview } from '../ui/PdfPreview';
import { safeName } from '../ui/fileNames';
import { readResume, tailorResume, StructuredAiError } from './api';
import { applyTailoring, clean, jobMatch, suggestionKeys, type Decisions, type Job, type StructuredRecord, type StructuredResume, type Tailoring } from './model';
import { renderResumePdf, type Paper } from './pdf';
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
  const abort = useRef<AbortController | null>(null), layer = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    if (!current) return;
    let active = true;
    const timer = setTimeout(() => { void renderResumePdf(current, paper).then(result => { if (active) setPdf(result); }).catch(reason => { if (active) setError(message(reason)); }); }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [current, paper]);

  async function tailor() {
    if (!record?.job.description.trim()) return;
    setPhase('tailoring'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      const tailoring = await tailorResume(clean(record.base), record.job, controller.signal);
      update(value => ({ ...value, tailoring, decisions: {} })); setPhase('ready');
    } catch (reason) { if (!controller.signal.aborted) { setError(message(reason)); } setPhase('ready'); }
  }
  async function download(kind: 'pdf' | 'docx') {
    if (!current || !record) return;
    setBusyFile(kind);
    try {
      const name = [current.name, record.tailoring ? record.job.company : '', record.tailoring ? record.job.title : 'Resume'].map(part => safeName(part)).filter(Boolean).join('-') || 'Resume';
      if (kind === 'pdf') { const { bytes } = pdf ?? await renderResumePdf(current, paper); save(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${name}.pdf`); }
      else { const { renderResumeDocx } = await import('./docx'); save(await renderResumeDocx(current, paper), `${name}.docx`); }
    } catch (reason) { setError(message(reason)); } finally { setBusyFile(''); }
  }

  const tailoring = record?.tailoring ?? null, keys = tailoring ? suggestionKeys(tailoring) : [];
  const decide = (key: string, decision: Decisions[string] | null) => update(value => { const decisions = { ...value.decisions }; if (decision) decisions[key] = decision; else delete decisions[key]; return { ...value, decisions }; });
  const accepted = keys.filter(key => record?.decisions[key] === 'accepted').length, held = tailoring ? Object.values(tailoring.dropped).reduce((sum, count) => sum + count, 0) : 0;
  const match = current && record?.job.description.trim() ? jobMatch(current, record.job.description) : null;
  const bulletText = (id: string) => [...(record?.base.experience ?? []), ...(record?.base.projects ?? [])].flatMap(parent => parent.bullets).find(bullet => bullet.id === id)?.text ?? '';
  const setJob = (patch: Partial<Job>) => update(value => ({ ...value, job: { ...value.job, ...patch } }));

  return <div ref={layer} className="structured" role="dialog" aria-modal="true" aria-label="Resume template workspace">
    <header className="structured-bar">
      <button type="button" className="structured-back" onClick={onExit}><ArrowLeft size={18} aria-hidden="true" />Back</button>
      <strong title={source.name}>{current?.name || source.name}</strong>
      <div className="structured-bar-actions">
        {onExactLayout && <button type="button" className="text-button" onClick={onExactLayout}>Keep my exact layout instead</button>}
        <button type="button" className="button button-secondary button-small" disabled={!current || !!busyFile} onClick={() => void download('docx')}>{busyFile === 'docx' ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}Word</button>
        <button type="button" className="button button-primary button-small" disabled={!current || !!busyFile} onClick={() => void download('pdf')}>{busyFile === 'pdf' ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}Download PDF</button>
      </div>
    </header>

    <div className="structured-body">
      <section className="structured-panel" aria-label="Tailoring">
        {error && <p className="structured-error" role="alert">{error}</p>}
        {source.note && !error && phase !== 'failed' && <p className="structured-note structured-source-note">{source.note}</p>}

        {(phase === 'loading' || phase === 'reading') && <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Reading your resume</strong><p>Folio is sorting it into sections. This takes about 10 seconds.</p></div></div>}

        {phase === 'failed' && <div className="structured-empty">
          <h1>{signedIn ? 'Your resume could not be read' : 'Sign in to use a Folio template'}</h1>
          <p>{signedIn ? (onExactLayout ? 'You can try again, or keep working with your exact layout.' : 'You can try again in a moment.') : 'Templates let AI rewrite and reorder your resume for each job. Reading your resume uses AI, so it needs a free account.'}</p>
          <div className="structured-row">{signedIn ? <button type="button" className="button button-primary" onClick={() => void read()}><RotateCcw size={15} />Try again</button> : <button type="button" className="button button-primary" onClick={() => auth?.openAuth('signup')}>Create a free account</button>}{onExactLayout && <button type="button" className="button button-secondary" onClick={onExactLayout}>Keep my exact layout</button>}</div>
        </div>}

        {record && phase !== 'reading' && phase !== 'loading' && phase !== 'failed' && !tailoring && <>
          <h1>Tailor for a job</h1>
          <p className="structured-lead">Paste the posting. Folio rewrites, reorders and trims using only what your resume already says.</p>
          <div className="structured-fields"><label>Role<input value={record.job.title} maxLength={300} placeholder="e.g. Product Designer" onChange={event => setJob({ title: event.target.value })} /></label><label>Company<input value={record.job.company} maxLength={300} placeholder="e.g. Northstar" onChange={event => setJob({ company: event.target.value })} /></label></div>
          <label className="structured-job">Job description<textarea value={record.job.description} maxLength={20000} rows={9} placeholder="Paste responsibilities and requirements…" readOnly={phase === 'tailoring'} onChange={event => setJob({ description: event.target.value })} /></label>
          {phase === 'tailoring'
            ? <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Tailoring your resume</strong><p>About 20 seconds. Nothing changes until you accept it.</p></div><button type="button" className="text-button" onClick={() => { abort.current?.abort(); setPhase('ready'); }}>Cancel</button></div>
            : <><button type="button" className="button button-primary structured-primary" disabled={!record.job.description.trim()} onClick={() => void tailor()}><Sparkles size={16} aria-hidden="true" />Tailor resume</button>
              <p className="structured-note">Sends this job and your resume text to OpenAI through Folio. Uses 1 of your daily AI runs.</p></>}
          <button type="button" className="text-button structured-edit-toggle" aria-expanded={editing} onClick={() => setEditing(value => !value)}>{editing ? 'Done editing' : 'Fix something Folio read wrong'}</button>
          {editing && <ResumeEditor resume={record.base} onChange={base => update(value => ({ ...value, base }))} />}
        </>}

        {record && tailoring && phase !== 'failed' && <>
          <div className="structured-review-head"><div><h1>{keys.length ? `${keys.length} ${keys.length === 1 ? 'suggestion' : 'suggestions'}` : 'No changes suggested'}</h1><p className="structured-lead">{record.job.title || 'This job'}{record.job.company ? ` at ${record.job.company}` : ''}{keys.length ? ` · ${accepted} accepted` : ''}</p></div>
            {keys.length > 0 && <button type="button" className="button button-secondary button-small" onClick={() => update(value => ({ ...value, decisions: accepted === keys.length ? {} : Object.fromEntries(keys.map(key => [key, 'accepted' as const])) }))}>{accepted === keys.length ? 'Undo all' : 'Accept all'}</button>}</div>
          {match && <p className="structured-match"><strong>{match.found.length} of {match.found.length + match.absent.length}</strong> key terms from the posting are in your resume.</p>}
          {!keys.length && <p className="structured-note">Your resume already reads well for this posting. You can download it as it is.</p>}

          <ul className="structured-suggestions">
            {tailoring.summary && <Suggestion label="Summary" before={record.base.summary} after={tailoring.summary.text} reason={tailoring.summary.reason} state={record.decisions.summary} onDecide={decision => decide('summary', decision)} />}
            {tailoring.bullets.map(item => <Suggestion key={item.id} label="Rewrite" before={bulletText(item.id)} after={item.text} reason={item.reason} state={record.decisions[`bullet:${item.id}`]} onDecide={decision => decide(`bullet:${item.id}`, decision)} />)}
            {tailoring.cuts.map(item => <Suggestion key={item.id} label="Remove" before={bulletText(item.id)} after="" reason={item.reason} state={record.decisions[`cut:${item.id}`]} onDecide={decision => decide(`cut:${item.id}`, decision)} />)}
            {tailoring.order.length > 0 && <Suggestion label="Reorder bullets" before="" after={`Most relevant bullets first in ${tailoring.order.length} ${tailoring.order.length === 1 ? 'section' : 'sections'}.`} reason="Recruiters read the first lines of each role." state={record.decisions.order} onDecide={decision => decide('order', decision)} />}
            {tailoring.skills.length > 0 && <Suggestion label="Reorder skills" before="" after={tailoring.skills.map(group => group.items.slice(0, 6).join(', ')).join(' · ')} reason="Puts the skills this posting names first. Nothing is added." state={record.decisions.skills} onDecide={decision => decide('skills', decision)} />}
          </ul>

          {tailoring.missing.length > 0 && <div className="structured-missing"><h2>The posting asks for these, and your resume doesn’t show them</h2><ul>{tailoring.missing.map(item => <li key={item}>{item}</li>)}</ul><p>Folio won’t add them for you. If you have this experience, add it to your resume in your own words.</p></div>}
          {held > 0 && <p className="structured-note">Folio held back {held} {held === 1 ? 'suggestion' : 'suggestions'} that used words or numbers not found in your resume.</p>}
          <button type="button" className="text-button" onClick={() => update(value => ({ ...value, tailoring: null, decisions: {} }))}>Tailor for a different job</button>
        </>}
      </section>

      <section className="structured-preview" aria-label="Resume preview">
        {pdf ? <>{Array.from({ length: pdf.pages }, (_, index) => <div className="structured-page" key={index}><PdfPreview bytes={pdf.bytes} page={index + 1} label={`Resume page ${index + 1} of ${pdf.pages}`} scale={1.6} /></div>)}
          <p className="structured-preview-foot"><span>{pdf.pages} {pdf.pages === 1 ? 'page' : 'pages'}{pdf.tightened ? ' · spacing tightened to fit' : ''}</span><label>Paper<select value={paper} onChange={event => setPaper(event.target.value as Paper)}><option value="a4">A4</option><option value="letter">US Letter</option></select></label></p></>
          : <div className="structured-page structured-page-empty" aria-hidden="true" />}
      </section>
    </div>
  </div>;
}

function Suggestion({ label, before, after, reason, state, onDecide }: { label: string; before: string; after: string; reason: string; state?: Decisions[string]; onDecide: (decision: Decisions[string] | null) => void }) {
  return <li className={`structured-suggestion ${state ? `is-${state}` : ''}`}>
    <span className="structured-kind">{label}</span>
    {before && <p className="structured-before">{before}</p>}
    {after && <p className="structured-after">{after}</p>}
    {reason && <p className="structured-reason">{reason}</p>}
    <div className="structured-row">
      <button type="button" className={`button button-small ${state === 'accepted' ? 'button-primary' : 'button-secondary'}`} aria-pressed={state === 'accepted'} onClick={() => onDecide(state === 'accepted' ? null : 'accepted')}><Check size={14} aria-hidden="true" />{state === 'accepted' ? 'Accepted' : 'Accept'}</button>
      <button type="button" className="button button-small button-secondary" aria-pressed={state === 'rejected'} onClick={() => onDecide(state === 'rejected' ? null : 'rejected')}><X size={14} aria-hidden="true" />{state === 'rejected' ? 'Skipped' : 'Skip'}</button>
    </div>
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

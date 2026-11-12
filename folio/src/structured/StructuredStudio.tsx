import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, Check, FileText, Library, LoaderCircle, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import { detectRegion, rememberedRegion } from '../auth/regions';
import { useOptionalAuth } from '../auth/AuthProvider';
import { linkProps } from '../site/router';
import { PdfPreview } from '../ui/PdfPreview';
import { safeName } from '../ui/fileNames';
import { jobLink, needsAccount, readJobLink, tailorResume, writeLetter, StructuredAiError } from './api';
import { memoryText, newItem, type Memory, type MemoryItem } from './memory';
import { applyTailoring, clean, jobHeading, jobLabel, jobMatch, newJob, suggestionKeys, withJob, withoutJob, type JobRecord, type ResumeRecord, type StructuredResume } from './model';
import { renderResumePdf, TEMPLATES, type Highlight, type Paper, type Region, type Rendered } from './pdf';
import './structured.css';

const message = (error: unknown) => error instanceof StructuredAiError || error instanceof Error ? error.message : 'Something went wrong. Try again.';
const save = (blob: Blob, name: string) => { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); };
const PAPER_KEY = 'folio.paper';
const firstPaper = (): Paper => { try { const kept = window.localStorage.getItem(PAPER_KEY); if (kept === 'a4' || kept === 'letter') return kept; } catch { /* use the regional default */ } return (rememberedRegion() ?? detectRegion()) === 'in' ? 'a4' : 'letter'; };
/**
 * A bookmark that, pressed on any job page, sends that posting to Folio: the text the person selected,
 * else the posting the page itself publishes, else the page's main text. It runs in the person's own
 * browser on a page they have open; nothing is fetched on their behalf.
 */
const sender = (origin: string) => `javascript:(function(){var d=document,t=String(window.getSelection()||'').trim();if(t.length<200){t='';try{d.querySelectorAll('script[type="application/ld+json"]').forEach(function(e){try{var j=JSON.parse(e.textContent);[].concat(j['@graph']||j).forEach(function(p){if(!t&&p&&[].concat(p['@type']||[]).indexOf('JobPosting')>-1&&p.description){var c=p.hiringOrganization&&p.hiringOrganization.name||'';t=(p.title||'')+(c?' at '+c:'')+'\\n\\n'+String(p.description).replace(/<(br|\\/p|\\/li|\\/h\\d)[^>]*>/gi,'\\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&')}})}catch(_){}})}catch(_){}}if(!t){var m=d.querySelector('main,article,[role=main]')||d.body;t=d.title+'\\n\\n'+m.innerText}window.open('${origin}/app#job='+encodeURIComponent(t.slice(0,12000)))})();`;

export interface StudioProps {
  /** The resume, or a promise of it while a new upload is still being read. */
  resume: ResumeRecord | Promise<ResumeRecord>;
  name: string; jobId: string | null; note?: string; sampleJob?: string;
  /** True right after an upload, when the applicant first sees their resume in Folio's template. */
  fresh?: boolean;
  /** A posting that arrived from the Send to Folio button. */
  initialJob?: string; onJobTaken?: () => void;
  /** Whether saved work also goes to the user's account. */
  toAccount: boolean;
  memory: Memory | null; onAddMemory: (item: MemoryItem) => void; onOpenMemory: () => void;
  resumes: ResumeRecord[]; onSwitch: (resume: ResumeRecord) => void;
  onSave: (record: ResumeRecord) => void; onRetry?: () => void; onExit: () => void;
}

export function StructuredStudio({ resume, name, jobId: firstJob, note, sampleJob, fresh, initialJob, onJobTaken, toAccount, memory, onAddMemory, onOpenMemory, resumes, onSwitch, onSave, onRetry, onExit }: StudioProps) {
  const auth = useOptionalAuth(), signedIn = !!auth?.user;
  const [record, setRecord] = useState<ResumeRecord | null>(resume instanceof Promise ? null : resume);
  const [failure, setFailure] = useState<{ text: string; account: boolean } | null>(null);
  const [jobId, setJobId] = useState(firstJob), [link, setLink] = useState(''), [description, setDescription] = useState(initialJob ?? ''), [via, setVia] = useState('');
  const [busy, setBusy] = useState<'' | 'link' | 'tailoring' | 'letter'>(''), [error, setError] = useState(''), [gate, setGate] = useState('');
  const [paper, setPaperState] = useState<Paper>(firstPaper);
  const [pdf, setPdf] = useState<Rendered | null>(null);
  const [editing, setEditing] = useState(false), [busyFile, setBusyFile] = useState<'' | 'pdf' | 'docx'>(''), [downloaded, setDownloaded] = useState(false), [copied, setCopied] = useState(false);
  const [line, setLine] = useState<{ region: Region; text: string } | null>(null), [confirmDelete, setConfirmDelete] = useState(false);
  /** A requirement the posting asks for that the applicant is describing their experience of. */
  const [telling, setTelling] = useState<{ about: string; text: string } | null>(null), [told, setTold] = useState(0);
  const abort = useRef<AbortController | null>(null), latest = useRef(record), done = useRef<HTMLDivElement>(null), send = useRef<HTMLAnchorElement>(null);
  latest.current = record;

  useEffect(() => { if (initialJob) onJobTaken?.(); }, [initialJob, onJobTaken]);
  useEffect(() => () => abort.current?.abort(), []);
  // A new upload is read while the user pastes the job; the resume appears as soon as it is ready.
  useEffect(() => {
    if (!(resume instanceof Promise)) return;
    let active = true;
    resume.then(value => { if (active) { setRecord(value); setFailure(null); } }, reason => { if (active) setFailure({ text: message(reason), account: needsAccount(reason) }); });
    return () => { active = false; };
  }, [resume]);
  useEffect(() => { if (signedIn) setGate(''); }, [signedIn]);

  const commit = useCallback((change: (current: ResumeRecord) => ResumeRecord) => {
    if (!latest.current) return;
    const next = change(latest.current); latest.current = next; setRecord(next); onSave(next);
  }, [onSave]);
  const job = record?.jobs.find(item => item.id === jobId) ?? null;
  const changeJob = useCallback((change: (current: JobRecord) => JobRecord) => commit(value => { const found = value.jobs.find(item => item.id === jobId); return found ? withJob(value, change(found)) : value; }), [commit, jobId]);
  const setPaper = (size: Paper) => { setPaperState(size); try { window.localStorage.setItem(PAPER_KEY, size); } catch { /* applies to this visit */ } };

  const template = record?.template ?? 'classic', pageGoal = record?.pages ?? null;
  const current = useMemo(() => record ? applyTailoring(clean(record.base), job?.tailoring ?? null, job?.decisions ?? {}, job?.edits) : null, [record, job]);
  // Changed lines are tinted in the preview only; the downloaded file is rendered clean.
  const highlight = useMemo<Highlight>(() => new Set(job ? [
    ...job.tailoring.bullets.filter(item => job.decisions[`bullet:${item.id}`] === 'accepted').map(item => item.id), ...(job.tailoring.summary && job.decisions.summary === 'accepted' ? ['summary'] : []),
    ...(job.tailoring.additions ?? []).map(item => item.id), ...(job.tailoring.newProjects ?? []).flatMap(item => item.bullets.map(bullet => bullet.id)),
    ...Object.keys(job.edits).map(key => key.replace(/^bullet:/, '')),
  ] : []), [job]);
  useEffect(() => {
    if (!current) return;
    let active = true;
    const timer = setTimeout(() => { void renderResumePdf(current, paper, template, highlight, pageGoal).then(result => { if (active) setPdf(result); }).catch(reason => { if (active) setError(message(reason)); }); }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [current, paper, template, highlight, pageGoal]);
  // React refuses script links, so the bookmark's address is set on the element itself.
  const tip = !job && !editing && !failure;
  useEffect(() => { send.current?.setAttribute('href', sender(window.location.origin)); }, [tip]);

  const fail = (reason: unknown) => { if (needsAccount(reason) && !signedIn) setGate(message(reason)); else setError(message(reason)); };
  const pastedLink = jobLink(link) ?? (description.trim().length < 400 ? jobLink(description) : null);
  const ready = !!description.trim() || !!jobLink(link);

  /** Tailors for the posting in the box, or again for the open job (after career memory changed). */
  async function tailor(again?: JobRecord) {
    if (busy || (!again && !ready)) return;
    setError(''); setGate(''); setVia('');
    const controller = new AbortController(); abort.current = controller;
    try {
      let text = again ? again.job.description : description.trim();
      const address = again ? null : jobLink(link) && !text ? jobLink(link) : pastedLink && jobLink(text) ? pastedLink : null;
      if (address) { setBusy('link'); const read = await readJobLink(address, controller.signal); text = read.text; setDescription(text); setVia(read.via && read.via !== 'page' ? read.via : 'the page'); }
      setBusy('tailoring');
      // If the resume is still being read, this waits for it; the user does not have to.
      const base = latest.current ?? await resume;
      const tailoring = await tailorResume(clean(base.base), { title: '', company: '', description: text }, memoryText(memory, text), controller.signal);
      if (controller.signal.aborted) return;
      if (!latest.current) { latest.current = base; setRecord(base); }
      if (again) { changeJob(value => ({ ...value, tailoring, decisions: Object.fromEntries(suggestionKeys(tailoring).map(key => [key, 'accepted' as const])) })); setTold(0); return; }
      const guess = jobHeading(text);
      const made = newJob({ title: tailoring.job?.title || guess.title, company: tailoring.job?.company || guess.company, description: text }, tailoring);
      commit(value => withJob(value, made)); setJobId(made.id); setDownloaded(false); setDescription(''); setLink('');
    } catch (reason) { if (!controller.signal.aborted) fail(reason); } finally { if (abort.current === controller) setBusy(''); }
  }
  async function download(kind: 'pdf' | 'docx') {
    if (!current || !record) return;
    setBusyFile(kind); setError('');
    try {
      const fileName = [current.name, job?.job.company ?? '', job?.job.title ?? ''].filter(part => part.trim()).map(part => safeName(part)).join('-') || 'Resume';
      if (kind === 'pdf') { const { bytes } = await renderResumePdf(current, paper, template, undefined, pageGoal); save(new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }), `${fileName}.pdf`); }
      else { const { renderResumeDocx } = await import('./docx'); save(await renderResumeDocx(current, paper, template, pdf?.fit), `${fileName}.docx`); }
      setDownloaded(true); setTimeout(() => done.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 50);
    } catch (reason) { setError(message(reason)); } finally { setBusyFile(''); }
  }
  async function letter() {
    if (!current || !job || busy) return;
    if (!signedIn) { setGate('Create a free account to write a cover letter for this job.'); return; }
    setError(''); setBusy('letter');
    const controller = new AbortController(); abort.current = controller;
    try { const text = await writeLetter(current, job.job, memoryText(memory, job.job.description, 12_000), controller.signal); if (!controller.signal.aborted) changeJob(value => ({ ...value, letter: text })); }
    catch (reason) { if (!controller.signal.aborted) fail(reason); } finally { if (abort.current === controller) setBusy(''); }
  }
  async function letterFile() {
    if (!job?.letter.trim() || !current) return;
    try { const { renderLetterDocx } = await import('./docx'); save(await renderLetterDocx(job.letter, paper), `${[current.name, job.job.company, 'Cover letter'].filter(part => part.trim()).map(part => safeName(part)).join('-')}.docx`); } catch (reason) { setError(message(reason)); }
  }
  async function copyLetter() {
    if (!job) return;
    try { await navigator.clipboard.writeText(job.letter); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setError('Copying isn’t available in this browser. Select the text and copy it.'); }
  }
  function tell() {
    if (!telling || telling.text.trim().length < 20) return;
    onAddMemory(newItem('note', telling.about, `${telling.about}: ${telling.text.trim()}`)); setTelling(null); setTold(count => count + 1);
  }

  /** The text a clickable line currently shows. */
  const lineText = (key: string) => key === 'summary' ? current?.summary ?? '' : [...(current?.experience ?? []), ...(current?.projects ?? [])].flatMap(parent => parent.bullets).find(bullet => `bullet:${bullet.id}` === key)?.text ?? '';
  function saveLine() {
    if (!line || !record) return;
    const { key } = line.region, text = line.text.replace(/\s+/g, ' ').trim();
    if (text !== lineText(key)) {
      if (job) changeJob(value => ({ ...value, edits: { ...value.edits, [key]: text } }));
      else commit(value => ({ ...value, updatedAt: new Date().toISOString(), base: key === 'summary' ? { ...value.base, summary: text } : {
        ...value.base,
        experience: value.base.experience.map(role => ({ ...role, bullets: role.bullets.map(bullet => `bullet:${bullet.id}` === key ? { ...bullet, text } : bullet) })),
        projects: value.base.projects.map(project => ({ ...project, bullets: project.bullets.map(bullet => `bullet:${bullet.id}` === key ? { ...bullet, text } : bullet) })),
      } }));
    }
    setLine(null);
  }
  const restoreLine = () => { if (line && job) changeJob(value => { const { [line.region.key]: _gone, ...edits } = value.edits; return { ...value, edits }; }); setLine(null); };

  const tailoring = job?.tailoring ?? null, keys = tailoring ? suggestionKeys(tailoring) : [];
  const on = (key: string) => job?.decisions[key] === 'accepted';
  const toggle = (key: string) => changeJob(value => ({ ...value, decisions: { ...value.decisions, [key]: value.decisions[key] === 'accepted' ? 'rejected' : 'accepted' } }));
  const applied = keys.filter(on).length, held = tailoring ? Object.values(tailoring.dropped).reduce((sum, count) => sum + count, 0) : 0;
  const match = current && job ? jobMatch(current, job.job.description) : null;
  const bulletText = (id: string) => [...(record?.base.experience ?? []), ...(record?.base.projects ?? [])].flatMap(parent => parent.bullets).find(bullet => bullet.id === id)?.text ?? '';
  const parentName = (id: string) => { const role = record?.base.experience.find(item => item.id === id); return role ? role.title || role.company : record?.base.projects.find(item => item.id === id)?.name ?? ''; };
  const another = () => { setJobId(null); setDownloaded(false); setDescription(''); setLink(''); setError(''); setGate(''); setLine(null); setConfirmDelete(false); setTold(0); };
  const reading = !record && !failure, step = job ? 3 : record || reading ? 2 : 1, items = memory?.items.length ?? 0;

  const next = job && <div ref={downloaded ? done : undefined} className={`structured-next ${downloaded ? 'is-done' : ''}`}>
    {downloaded && <div><h2><Check size={16} aria-hidden="true" />Downloaded</h2><p>This version is saved under Jobs{toAccount ? ' and in your account' : ' on this device'}, so you can come back to it.</p></div>}
    <div className="structured-row">
      <button type="button" className="button button-secondary button-small" aria-pressed={job.status === 'applied'} onClick={() => changeJob(value => value.status === 'applied' ? { ...value, status: 'draft', appliedAt: null } : { ...value, status: 'applied', appliedAt: new Date().toISOString() })}>{job.status === 'applied' ? <><Check size={14} aria-hidden="true" />Applied</> : 'Mark as applied'}</button>
      {!job.letter && <button type="button" className="button button-secondary button-small" disabled={!!busy} onClick={() => void letter()}>Write a cover letter</button>}
      <button type="button" className="button button-secondary button-small" onClick={another}>Tailor for another job</button>
    </div>
  </div>;

  return <div className="structured">
    <header className="structured-bar">
      <button type="button" className="structured-back" onClick={onExit}><ArrowLeft size={18} aria-hidden="true" />Back</button>
      <ol className="structured-steps" aria-label="Steps">
        <li className={step > 1 ? 'is-done' : 'is-now'} aria-current={step === 1 ? 'step' : undefined}><span>{step > 1 ? <Check size={12} aria-hidden="true" /> : 1}</span>Resume</li>
        <li className={step > 2 ? 'is-done' : step === 2 ? 'is-now' : ''} aria-current={step === 2 ? 'step' : undefined}><span>{step > 2 ? <Check size={12} aria-hidden="true" /> : 2}</span>Job</li>
        <li className={step === 3 ? 'is-now' : ''} aria-current={step === 3 ? 'step' : undefined}><span>3</span>Review and download</li>
      </ol>
      <div className="structured-bar-actions">
        <button type="button" className="button button-secondary button-small structured-word" disabled={!current || !!busyFile} onClick={() => void download('docx')}>{busyFile === 'docx' ? <LoaderCircle size={14} className="spin" /> : <FileText size={14} />}Word</button>
        <button type="button" className="button button-primary button-small" disabled={!current || !!busyFile} onClick={() => void download('pdf')}>{busyFile === 'pdf' ? <LoaderCircle size={14} className="spin" /> : <ArrowDownToLine size={14} />}Download PDF</button>
      </div>
    </header>

    <div className="structured-body">
      <section className="structured-panel" aria-label="Tailoring">
        {error && <p className="structured-error" role="alert">{error}</p>}
        {gate && <div className="structured-gate" role="alert"><p>{gate}</p><div className="structured-row"><button type="button" className="button button-primary button-small" onClick={() => auth?.openAuth('signup')}>Create a free account</button><button type="button" className="button button-secondary button-small" onClick={() => auth?.openAuth('signin')}>Sign in</button></div></div>}

        {failure && <div className="structured-empty">
          <h1>{failure.account && !signedIn ? 'Create a free account to continue' : 'Your resume could not be read'}</h1>
          <p>{failure.text}</p>
          <div className="structured-row">{failure.account && !signedIn && <button type="button" className="button button-primary" onClick={() => auth?.openAuth('signup')}>Create a free account</button>}
            {onRetry && <button type="button" className={`button ${failure.account && !signedIn ? 'button-secondary' : 'button-primary'}`} onClick={onRetry}><RotateCcw size={15} aria-hidden="true" />Try again</button>}</div>
        </div>}

        {record && editing && <>
          <div className="structured-review-head"><h1>Edit resume text</h1><button type="button" className="button button-primary button-small" onClick={() => setEditing(false)}>Done</button></div>
          {record.jobs.length > 0 && <p className="structured-note">This changes the resume itself, for every job.</p>}
          <ResumeEditor resume={record.base} onChange={base => commit(value => ({ ...value, base, updatedAt: new Date().toISOString() }))} />
        </>}

        {!failure && !editing && !job && <>
          <div className="structured-resume-line">
            <FileText size={16} aria-hidden="true" />
            {reading ? <span role="status"><LoaderCircle size={12} className="spin" aria-hidden="true" /> Reading {name}. About 10 seconds; you can paste the job meanwhile.</span>
            : resumes.length > 1 ? <label><span className="visually-hidden">Resume to tailor</span><select value={record?.id} disabled={!!busy} onChange={event => { const chosen = resumes.find(item => item.id === event.target.value); if (chosen) onSwitch(chosen); }}>{resumes.map(item => <option key={item.id} value={item.id}>{item.base.name || item.sourceName}{item.base.headline ? `, ${item.base.headline}` : ''}</option>)}</select></label>
            : <span>{current?.name || name}</span>}
          </div>
          {fresh && record && !note && <p className="structured-note structured-source-note">Folio has put your resume into a clean template so it can rewrite and reflow it. Your wording is unchanged and it stays on {pageGoal ?? 1} {(pageGoal ?? 1) === 1 ? 'page' : 'pages'}. You can switch template above the preview, or <a {...linkProps('classic')}>keep your exact layout</a> instead.</p>}
          {note && <p className="structured-note structured-source-note">{note}</p>}

          <h1>Which job is this for?</h1>
          <label className="structured-link">Job link<input type="url" inputMode="url" value={link} placeholder="https://…" autoCapitalize="none" spellCheck={false} readOnly={!!busy} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && ready) void tailor(); }} /></label>
          <label className="structured-job">or paste the job text<textarea value={description} maxLength={20000} rows={7} placeholder="Paste the full posting here…" readOnly={!!busy} onChange={event => setDescription(event.target.value)} /></label>
          {busy === 'link' || busy === 'tailoring'
            ? <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>{busy === 'link' ? 'Reading the job posting' : reading ? 'Reading your resume, then tailoring it' : 'Tailoring your resume'}</strong><p>{busy === 'link' ? 'A few seconds.' : `${via ? `Read from ${via}. ` : ''}${reading ? 'About 30 seconds.' : 'About 20 seconds.'}`}</p></div><button type="button" className="text-button" onClick={() => { abort.current?.abort(); setBusy(''); }}>Cancel</button></div>
            : <><button type="button" className="button button-primary structured-primary" disabled={!ready} onClick={() => void tailor()}><Sparkles size={16} aria-hidden="true" />Tailor my resume</button>
              {sampleJob && !description && !link && <button type="button" className="text-button structured-again" onClick={() => setDescription(sampleJob)}>Use a sample job posting</button>}</>}

          <div className="structured-memory-line"><Library size={16} aria-hidden="true" /><p>{items ? <><strong>{items} {items === 1 ? 'item' : 'items'} in your career memory.</strong> Folio can bring in a real project or skill from them.</> : <>Add projects, notes or your GitHub to <strong>career memory</strong> and Folio can bring them into the resume when a job calls for them.</>} <button type="button" className="text-button" onClick={onOpenMemory}>{items ? 'Manage' : 'Open career memory'}</button></p></div>
          <details className="structured-more structured-send"><summary>Send a posting here from any job site, in one click</summary>
            <p>Folio reads links from Greenhouse, Lever, Ashby, SmartRecruiters and most company career pages. LinkedIn, Indeed and Naukri don’t let other apps read their pages, so for those, use this button from your own browser:</p>
            <p><a ref={send} className="structured-send-button" onClick={event => event.preventDefault()} draggable>Send to Folio</a> Drag it to your bookmarks bar. Then, on any job posting, click it and the posting opens here, ready to tailor.</p>
            <p>On a phone, select the posting’s text, copy it, and paste it above.</p>
          </details>
          <p className="structured-note">Folio only uses what you’ve told it about yourself. The job, your resume text and relevant career memory are sent to OpenAI.{!signedIn && ' Your first tailoring is free, no account needed.'}</p>
        </>}

        {record && job && tailoring && !editing && <>
          {downloaded && next}
          <div className="structured-review-head"><div><h1>{keys.length ? `${applied} of ${keys.length} ${keys.length === 1 ? 'change' : 'changes'} applied` : 'Your resume already fits'}</h1><p className="structured-lead">For {jobLabel(job.job)}</p></div>
            {keys.length > 1 && <button type="button" className="text-button" onClick={() => changeJob(value => ({ ...value, decisions: Object.fromEntries(keys.map(key => [key, applied ? 'rejected' as const : 'accepted' as const])) }))}>{applied ? 'Undo all' : 'Apply all'}</button>}</div>
          <p className="structured-note">{keys.length ? 'Your resume is ready to download. Changed lines are highlighted on the resume; undo any you don’t want, or click a line on the resume to reword it yourself.' : 'Nothing needed changing for this posting. You can download it as it is.'}</p>
          {busy === 'tailoring' && <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Tailoring again with your career memory</strong><p>About 20 seconds.</p></div></div>}

          {tailoring.cuts.length > 0 && <div className="structured-cuts"><h2>{tailoring.cuts.length} {tailoring.cuts.length === 1 ? 'line' : 'lines'} removed</h2>
            <ul>{tailoring.cuts.map(item => <li key={item.id} className={on(`cut:${item.id}`) ? '' : 'is-undone'}><p>{bulletText(item.id)}</p><button type="button" className="text-button" onClick={() => toggle(`cut:${item.id}`)}>{on(`cut:${item.id}`) ? 'Put back' : 'Remove again'}</button></li>)}</ul></div>}

          <ul className="structured-suggestions">
            {(tailoring.newProjects ?? []).map(item => <Change key={item.id} label="Project added from career memory" before="" after={`${item.name}: ${item.bullets.map(bullet => bullet.text).join(' ')}`} reason={item.reason} applied={on(`project:${item.id}`)} onToggle={() => toggle(`project:${item.id}`)} />)}
            {(tailoring.additions ?? []).map(item => <Change key={item.id} label={`Added from career memory · ${parentName(item.parentId)}`} before="" after={item.text} reason={item.reason} applied={on(`add:${item.id}`)} onToggle={() => toggle(`add:${item.id}`)} />)}
            {!!tailoring.newSkills?.length && <Change label="Skills added from career memory" before="" after={tailoring.newSkills.map(item => item.item).join(', ')} reason="" applied={on('newSkills')} onToggle={() => toggle('newSkills')} />}
            {tailoring.summary && <Change label="Summary" before={record.base.summary} after={tailoring.summary.text} reason={tailoring.summary.reason} applied={on('summary')} onToggle={() => toggle('summary')} />}
            {tailoring.bullets.map(item => <Change key={item.id} label="Reworded" before={bulletText(item.id)} after={item.text} reason={item.reason} applied={on(`bullet:${item.id}`)} onToggle={() => toggle(`bullet:${item.id}`)} />)}
            {tailoring.order.length > 0 && <Change label="Reordered" before="" after="Most relevant bullets moved to the top of each role." reason="" applied={on('order')} onToggle={() => toggle('order')} />}
            {tailoring.skills.length > 0 && <Change label="Skills" before="" after={`Now leads with ${tailoring.skills.map(group => group.items.slice(0, 3).join(', ')).join(' · ')}.`} reason="" applied={on('skills')} onToggle={() => toggle('skills')} />}
          </ul>

          {tailoring.missing.length > 0 && <div className="structured-missing"><h2>The posting also asks for</h2>
            <p>Folio won’t claim these for you. If you have the experience, say so in a sentence or two and it goes into your career memory.</p>
            <ul>{tailoring.missing.map(item => <li key={item}><span>{item}</span>{telling?.about !== item && <button type="button" className="text-button" onClick={() => setTelling({ about: item, text: '' })}>I have this</button>}
              {telling?.about === item && <div className="structured-tell"><label><span className="visually-hidden">Your experience with {item}</span><textarea autoFocus rows={3} maxLength={2000} value={telling.text} placeholder="Where and how you did this, with a result if you have one…" onChange={event => setTelling({ ...telling, text: event.target.value })} /></label><div className="structured-row"><button type="button" className="button button-primary button-small" disabled={telling.text.trim().length < 20} onClick={tell}>Save to career memory</button><button type="button" className="button button-secondary button-small" onClick={() => setTelling(null)}>Cancel</button></div></div>}</li>)}</ul>
            {told > 0 && <div className="structured-row"><button type="button" className="button button-primary button-small" disabled={!!busy} onClick={() => void tailor(job)}><Sparkles size={14} aria-hidden="true" />Tailor again with what you added</button></div>}
          </div>}

          {(busy === 'letter' || job.letter) && <div className="structured-letter">
            <h2>Cover letter</h2>
            {busy === 'letter' ? <div className="structured-wait" role="status"><LoaderCircle size={20} className="spin" aria-hidden="true" /><div><strong>Writing your cover letter</strong><p>About 10 seconds.</p></div></div> : <>
              <label><span className="visually-hidden">Cover letter text</span><textarea value={job.letter} rows={14} maxLength={6000} onChange={event => changeJob(value => ({ ...value, letter: event.target.value }))} /></label>
              <div className="structured-row"><button type="button" className="button button-secondary button-small" onClick={() => void copyLetter()}>{copied ? 'Copied' : 'Copy'}</button><button type="button" className="button button-secondary button-small" onClick={() => void letterFile()}>Download as Word</button><button type="button" className="text-button" onClick={() => void letter()}>Write it again</button></div>
              <p className="structured-note">A starting draft built only from what you’ve told Folio. Edit it so it sounds like you.</p></>}
          </div>}

          {(match || held > 0) && <details className="structured-more"><summary>How this resume fits the posting</summary>
            {match && <p><strong>{match.found.length} of {match.found.length + match.absent.length}</strong> key terms from the posting are in your resume.</p>}
            {held > 0 && <p>{held} {held === 1 ? 'suggestion was' : 'suggestions were'} held back for using words or numbers that are in neither your resume nor your career memory.</p>}
          </details>}
          {!downloaded && next}
          <div className="structured-foot">{confirmDelete
            ? <span className="home-confirm">Delete this job? <button type="button" className="text-button" onClick={() => { const id = job.id; another(); commit(value => withoutJob(value, id)); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirmDelete(false)}>Keep</button></span>
            : <button type="button" className="text-button" onClick={() => setConfirmDelete(true)}>Delete this job</button>}</div>
        </>}
      </section>

      <section className="structured-preview" aria-label="Resume preview">
        <div className="structured-tools" role="toolbar" aria-label="Resume options">
          <div role="group" aria-label="Template"><span>Template</span>{TEMPLATES.map(item => <button key={item.id} type="button" disabled={!record} aria-pressed={template === item.id} onClick={() => commit(value => ({ ...value, template: item.id, updatedAt: new Date().toISOString() }))}>{item.label}</button>)}</div>
          <div role="group" aria-label="Paper size"><span>Paper</span>{(['a4', 'letter'] as Paper[]).map(size => <button key={size} type="button" aria-pressed={paper === size} onClick={() => setPaper(size)}>{size === 'a4' ? 'A4' : 'US Letter'}</button>)}</div>
          <button type="button" className="structured-tool" disabled={!record} aria-pressed={editing} onClick={() => { setEditing(value => !value); setLine(null); }}><Pencil size={14} aria-hidden="true" />Edit text</button>
        </div>
        {pdf ? <>{Array.from({ length: pdf.pages }, (_, index) => <div className="structured-page" key={index}>
          <PdfPreview bytes={pdf.bytes} page={index + 1} label={`Resume page ${index + 1} of ${pdf.pages}`} scale={1.6} />
          {!editing && pdf.regions.filter(region => region.page === index).map(region => line?.region.key === region.key && line.region.page === index
            ? <form key={region.key} className="structured-line-edit" style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%` }} onSubmit={event => { event.preventDefault(); saveLine(); }}>
                <label><span className="visually-hidden">Reword this line</span><textarea autoFocus value={line.text} rows={Math.max(2, Math.ceil(line.text.length / 70))} maxLength={600} onChange={event => setLine({ ...line, text: event.target.value })} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setLine(null); } else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); saveLine(); } }} /></label>
                <div className="structured-row"><button type="submit" className="button button-primary button-small">Save</button><button type="button" className="button button-secondary button-small" onClick={() => setLine(null)}>Cancel</button>{job?.edits[region.key] !== undefined && <button type="button" className="text-button" onClick={restoreLine}>Restore</button>}<span className="structured-note">{job ? 'For this job only.' : 'Leave empty to remove the line.'}</span></div>
              </form>
            : <button key={region.key} type="button" className="structured-line" style={{ left: `${region.left * 100}%`, top: `${region.top * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} aria-label={`Reword: ${lineText(region.key).slice(0, 80)}`} title="Click to reword" onClick={() => setLine({ region, text: lineText(region.key) })} />)}
        </div>)}
          {pdf.over ? <p className="structured-preview-foot structured-over" role="status">This needs {pdf.pages} pages; your original had {pageGoal ?? 1}. Type and spacing are already as tight as they can readably go. To fit, undo a change or two, or click a line and clear it.</p>
            : <p className="structured-preview-foot">{pdf.pages} {pdf.pages === 1 ? 'page' : 'pages'}{pageGoal ? ', like your original' : ''}. Click any line to reword it.</p>}</>
          : <div className="structured-page structured-page-empty" role={reading ? 'status' : undefined}>{reading && <p><LoaderCircle size={18} className="spin" aria-hidden="true" />Reading your resume</p>}</div>}
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

const lines = (text: string) => text.split('\n');
const idFor = (items: { id: string }[], at: number) => items[at]?.id ?? crypto.randomUUID().slice(0, 8);

/** Corrections to what was read. This edits the applicant's own resume, never an AI suggestion. */
function ResumeEditor({ resume, onChange }: { resume: StructuredResume; onChange: (next: StructuredResume) => void }) {
  const field = (label: string, value: string, set: (value: string) => void, multiline = false) => <label key={label}>{label}{multiline ? <textarea value={value} rows={3} onChange={event => set(event.target.value)} /> : <input value={value} onChange={event => set(event.target.value)} />}</label>;
  return <div className="structured-editor">
    {field('Name', resume.name, name => onChange({ ...resume, name }))}
    {field('Headline', resume.headline, headline => onChange({ ...resume, headline }))}
    {field('Contact (one per line)', resume.contact.join('\n'), text => onChange({ ...resume, contact: lines(text) }), true)}
    {field('Summary', resume.summary, summary => onChange({ ...resume, summary }), true)}
    {resume.experience.map((role, index) => {
      const set = (patch: Partial<typeof role>) => onChange({ ...resume, experience: resume.experience.map((item, at) => at === index ? { ...item, ...patch } : item) });
      return <fieldset key={role.id}><legend>{role.title || role.company || `Role ${index + 1}`}</legend>
        <div className="structured-fields">{field('Title', role.title, title => set({ title }))}{field('Company', role.company, company => set({ company }))}{field('Location', role.location, location => set({ location }))}{field('Dates', role.dates, dates => set({ dates }))}</div>
        {field('Bullets (one per line)', role.bullets.map(bullet => bullet.text).join('\n'), text => set({ bullets: lines(text).map((item, at) => ({ id: idFor(role.bullets, at), text: item })) }), true)}
      </fieldset>;
    })}
    {resume.projects.map((project, index) => {
      const set = (patch: Partial<typeof project>) => onChange({ ...resume, projects: resume.projects.map((item, at) => at === index ? { ...item, ...patch } : item) });
      return <fieldset key={project.id}><legend>Project: {project.name || index + 1}</legend>
        <div className="structured-fields">{field('Name', project.name, value => set({ name: value }))}{field('Dates', project.dates, dates => set({ dates }))}</div>
        {field('Link', project.link, link => set({ link }))}
        {field('Bullets (one per line)', project.bullets.map(bullet => bullet.text).join('\n'), text => set({ bullets: lines(text).map((item, at) => ({ id: idFor(project.bullets, at), text: item })) }), true)}
      </fieldset>;
    })}
    {resume.education.map((item, index) => {
      const set = (patch: Partial<typeof item>) => onChange({ ...resume, education: resume.education.map((entry, at) => at === index ? { ...entry, ...patch } : entry) });
      return <fieldset key={index}><legend>Education{item.school ? `: ${item.school}` : ''}</legend>
        <div className="structured-fields">{field('Degree', item.degree, degree => set({ degree }))}{field('School', item.school, school => set({ school }))}{field('Location', item.location, location => set({ location }))}{field('Dates', item.dates, dates => set({ dates }))}</div>
        {field('Details (one per line)', item.details.join('\n'), text => set({ details: lines(text) }), true)}
      </fieldset>;
    })}
    {resume.skills.map((group, index) => {
      const set = (patch: Partial<typeof group>) => onChange({ ...resume, skills: resume.skills.map((item, at) => at === index ? { ...item, ...patch } : item) });
      return <fieldset key={group.id}><legend>Skills{group.label ? `: ${group.label}` : ''}</legend>{field('Label', group.label, label => set({ label }))}{field('Items (comma separated)', group.items.join(', '), text => set({ items: text.split(',').map(part => part.trimStart()) }), true)}</fieldset>;
    })}
    {resume.extras.map((extra, index) => {
      const set = (patch: Partial<typeof extra>) => onChange({ ...resume, extras: resume.extras.map((item, at) => at === index ? { ...item, ...patch } : item) });
      return <fieldset key={index}><legend>{extra.title || 'Other section'}</legend>{field('Section title', extra.title, title => set({ title }))}{field('Lines (one per line)', extra.items.join('\n'), text => set({ items: lines(text) }), true)}</fieldset>;
    })}
  </div>;
}

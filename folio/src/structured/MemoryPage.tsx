import { useRef, useState } from 'react';
import { Contact, FileUp, FolderGit2, Globe, LoaderCircle, Mic, NotebookPen, Square } from 'lucide-react';
import { readJobLink, StructuredAiError } from './api';
import { dictation, githubProjects, KIND_LABEL, newItem, withItem, withoutItem, type Memory, type MemoryItem, type MemoryKind } from './memory';

const SOURCES: { kind: MemoryKind; title: string; text: string; icon: typeof Mic }[] = [
  { kind: 'note', title: 'Write a note', text: 'A project, a result, a responsibility. In your own words.', icon: NotebookPen },
  { kind: 'file', title: 'Add a document', text: 'An older resume, a review, a project write-up. PDF, Word or text.', icon: FileUp },
  { kind: 'linkedin', title: 'LinkedIn', text: 'Your profile as a PDF, or its text pasted in.', icon: Contact },
  { kind: 'github', title: 'GitHub projects', text: 'Your public repositories, from your username.', icon: FolderGit2 },
  { kind: 'website', title: 'Website or portfolio', text: 'A page about your work, read from its link.', icon: Globe },
  { kind: 'voice', title: 'Voice note', text: 'Talk through what you did; edit the text before saving.', icon: Mic },
];
const message = (error: unknown) => error instanceof StructuredAiError || error instanceof Error ? error.message : 'Something went wrong. Try again.';
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function MemoryPage({ memory, onChange, toAccount, signedIn }: { memory: Memory; onChange: (next: Memory) => void; toAccount: boolean; signedIn: boolean }) {
  const [adding, setAdding] = useState<MemoryKind | null>(null), [title, setTitle] = useState(''), [text, setText] = useState(''), [link, setLink] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<MemoryItem | null>(null), [confirm, setConfirm] = useState(''), [listening, setListening] = useState(false);
  const files = useRef<HTMLInputElement>(null), recognition = useRef<{ stop(): void } | null>(null), latest = useRef(memory); latest.current = memory;
  const Speech = dictation();

  const begin = (kind: MemoryKind) => { stop(); setAdding(current => current === kind ? null : kind); setTitle(''); setText(''); setLink(''); setError(''); setNotice(''); };
  const add = (items: MemoryItem[], done: string) => { onChange(items.reduce((all, item) => withItem(all, item), latest.current)); setNotice(done); setAdding(null); setTitle(''); setText(''); setLink(''); };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await work(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); } };

  const saveText = (kind: MemoryKind) => { if (text.trim().length < 20) { setError('Write a sentence or two, so there is something Folio can use.'); return; } stop(); add([newItem(kind, title || text.trim().split(/[.\n]/)[0].slice(0, 70), text)], 'Saved to your career memory.'); };
  const addFiles = (list: FileList | null, kind: MemoryKind) => run(async () => {
    const picked = [...(list ?? [])].slice(0, 5), made: MemoryItem[] = [];
    for (const file of picked) {
      if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} is larger than 10 MB.`);
      const body = /\.txt$/i.test(file.name) ? await file.text() : /\.(pdf|docx)$/i.test(file.name) ? (await (await import('./plainText')).readFile(file).catch(() => { throw new Error(`${file.name} could not be opened. Try saving it again as a PDF or Word file.`); })).text : null;
      if (body === null) throw new Error('Add PDF, Word (.docx) or text files.');
      if (body.trim().length < 80) throw new Error(`${file.name} has no readable text. It may be a scan.`);
      made.push(newItem(kind, file.name.replace(/\.[a-z]+$/i, ''), body, file.name));
    }
    if (made.length) add(made, `${made.length} ${made.length === 1 ? 'document' : 'documents'} added to your career memory.`);
  });
  const importGithub = () => run(async () => { const items = await githubProjects(link); add(items, `${items.length} ${items.length === 1 ? 'project' : 'projects'} added from GitHub. Remove any you don’t want used.`); });
  const readSite = () => run(async () => {
    const url = /^https?:\/\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`;
    let host = ''; try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { throw new Error('Enter a web address, such as yourname.com.'); }
    const page = await readJobLink(url).catch(reason => { throw reason instanceof StructuredAiError && reason.code.startsWith('job_') ? new Error('Folio couldn’t read that page. Copy the text from it and save it as a note instead.') : reason; });
    add([newItem('website', host, page.text, url)], `Saved the text of ${host} to your career memory.`);
  });
  function stop() { recognition.current?.stop(); recognition.current = null; setListening(false); }
  function listen() {
    if (!Speech) return;
    const session = new Speech(); session.lang = navigator.language || 'en-US'; session.continuous = true; session.interimResults = false;
    session.onresult = event => { let heard = ''; for (let index = event.resultIndex; index < event.results.length; index++) if (event.results[index].isFinal) heard += event.results[index][0].transcript; if (heard.trim()) setText(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${heard.trim()}`); };
    session.onend = () => { recognition.current = null; setListening(false); };
    session.onerror = () => { setError('The microphone couldn’t be used. Check the browser’s permission, or type instead.'); stop(); };
    try { session.start(); recognition.current = session; setListening(true); setError(''); } catch { setError('Dictation could not start. Type instead.'); }
  }

  const noteForm = (kind: MemoryKind, placeholder: string) => <>
    <label>Title (optional)<input value={title} maxLength={160} onChange={event => setTitle(event.target.value)} /></label>
    <label>{kind === 'linkedin' ? 'Profile text' : 'What you did'}<textarea value={text} rows={7} maxLength={30000} placeholder={placeholder} onChange={event => setText(event.target.value)} /></label>
    <div className="structured-row"><button type="button" className="button button-primary button-small" onClick={() => saveText(kind)}>Save</button><button type="button" className="button button-secondary button-small" onClick={() => begin(kind)}>Cancel</button></div>
  </>;

  return <>
    <div className="home-head"><div><h1>Career memory</h1><p className="home-lead">Everything about your work that doesn’t fit on one resume. When you tailor for a job, Folio can bring in a real project or skill from here. It only ever uses what you’ve put in.</p></div></div>

    <ul className="memory-sources" aria-label="Add to career memory">{SOURCES.map(source => <li key={source.kind}><button type="button" aria-expanded={adding === source.kind} onClick={() => begin(source.kind)}><source.icon size={18} aria-hidden="true" /><strong>{source.title}</strong><span>{source.text}</span></button></li>)}</ul>
    <input ref={files} type="file" hidden multiple accept=".pdf,.docx,.txt,application/pdf,text/plain" onChange={event => { void addFiles(event.target.files, adding === 'linkedin' ? 'linkedin' : 'file'); event.target.value = ''; }} />

    {error && <p className="structured-error" role="alert">{error}</p>}
    {notice && <p className="memory-notice" role="status">{notice}</p>}

    {adding && <section className="memory-form" aria-label={SOURCES.find(source => source.kind === adding)?.title}>
      {adding === 'note' && noteForm('note', 'For example: At Lumen Cloud I led the migration of 60 integrations to a new public API with four engineering teams, finishing two months early.')}
      {adding === 'file' && <><p>Choose up to five files. Folio keeps their text; the files themselves stay on your device.</p><div className="structured-row"><button type="button" className="button button-primary button-small" disabled={busy} onClick={() => files.current?.click()}>{busy ? <LoaderCircle size={14} className="spin" /> : <FileUp size={14} />}Choose files</button><button type="button" className="button button-secondary button-small" onClick={() => begin('file')}>Cancel</button></div></>}
      {adding === 'linkedin' && <><p>LinkedIn doesn’t let other apps read a profile from its link. On LinkedIn, open your profile, choose <strong>More</strong>, then <strong>Save to PDF</strong>, and add that file here. Or copy your profile text and paste it below.</p>
        <div className="structured-row"><button type="button" className="button button-secondary button-small" disabled={busy} onClick={() => files.current?.click()}>{busy ? <LoaderCircle size={14} className="spin" /> : <FileUp size={14} />}Add the PDF</button></div>{noteForm('linkedin', 'Paste your LinkedIn profile text here…')}</>}
      {adding === 'github' && <><label>GitHub username<input value={link} placeholder="octocat" autoCapitalize="none" spellCheck={false} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && link.trim()) void importGithub(); }} /></label>
        <p>Folio reads your public repositories from GitHub: name, description, languages, topics and the start of each README. Up to eight, most starred first.</p>
        <div className="structured-row"><button type="button" className="button button-primary button-small" disabled={busy || !link.trim()} onClick={() => void importGithub()}>{busy && <LoaderCircle size={14} className="spin" />}Import projects</button><button type="button" className="button button-secondary button-small" onClick={() => begin('github')}>Cancel</button></div></>}
      {adding === 'website' && <><label>Page address<input value={link} type="url" placeholder="yourname.com/work" autoCapitalize="none" spellCheck={false} onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && link.trim()) void readSite(); }} /></label>
        <p>Folio’s server opens that one page and keeps its text. Pages that need a sign-in, or that block automated readers, can’t be read.</p>
        <div className="structured-row"><button type="button" className="button button-primary button-small" disabled={busy || !link.trim()} onClick={() => void readSite()}>{busy && <LoaderCircle size={14} className="spin" />}Read this page</button><button type="button" className="button button-secondary button-small" onClick={() => begin('website')}>Cancel</button></div></>}
      {adding === 'voice' && <>{Speech
        ? <div className="structured-row"><button type="button" className={`button ${listening ? 'button-secondary' : 'button-primary'} button-small`} onClick={listening ? stop : listen}>{listening ? <><Square size={13} aria-hidden="true" />Stop</> : <><Mic size={14} aria-hidden="true" />Start talking</>}</button>{listening && <span className="memory-live" role="status">Listening…</span>}</div>
        : <p>Dictation isn’t available in this browser. Type your note instead.</p>}
        {Speech && <p>Your browser’s own speech service turns your voice into text. Nothing is saved until you press Save.</p>}{noteForm('voice', 'What you say appears here. Fix anything it misheard before saving.')}</>}
    </section>}

    {memory.items.length === 0 ? <div className="home-empty"><h2>Nothing here yet</h2><p>Start with one thing a resume never has room for: a side project, a result you’re proud of, or your GitHub.</p></div>
    : <ul className="memory-items" aria-label="Your career memory">{memory.items.map(item => <li key={item.id}>
        {editing?.id === item.id ? <div className="memory-form">
          <label>Title<input value={editing.title} maxLength={160} onChange={event => setEditing({ ...editing, title: event.target.value })} /></label>
          <label>Text<textarea value={editing.text} rows={8} maxLength={30000} onChange={event => setEditing({ ...editing, text: event.target.value })} /></label>
          <div className="structured-row"><button type="button" className="button button-primary button-small" onClick={() => { onChange(withItem(memory, { ...editing, title: editing.title.trim() || KIND_LABEL[editing.kind], text: editing.text.trim() })); setEditing(null); }}>Save</button><button type="button" className="button button-secondary button-small" onClick={() => setEditing(null)}>Cancel</button></div>
        </div> : <>
          <div className="memory-item-head"><span className="structured-kind">{KIND_LABEL[item.kind]}</span><h2>{item.title}</h2><span className="memory-date">{day(item.updatedAt)}</span></div>
          <p>{item.text.replace(/\s+/g, ' ').slice(0, 220)}{item.text.length > 220 ? '…' : ''}</p>
          <div className="memory-item-actions">{confirm === item.id
            ? <span className="home-confirm">Delete this? <button type="button" className="text-button" onClick={() => { onChange(withoutItem(memory, item.id)); setConfirm(''); }}>Delete</button><button type="button" className="text-button" onClick={() => setConfirm('')}>Keep</button></span>
            : <><button type="button" className="text-button" onClick={() => setEditing(item)}>Edit</button><button type="button" className="text-button" onClick={() => setConfirm(item.id)}>Delete</button></>}</div>
        </>}
      </li>)}</ul>}
    <p className="home-hint">{toAccount ? 'Saved to your account, so it is there on your other devices.' : signedIn ? 'Saved on this device only.' : 'Saved in this browser. Create a free account to keep it safe.'} When you tailor, the relevant parts are sent to OpenAI with your resume.</p>
  </>;
}

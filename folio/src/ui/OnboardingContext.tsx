import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronDown, ExternalLink, FileText, FolderPlus, Link2, LoaderCircle, Mic, RotateCcw, Upload, X } from 'lucide-react';
import type { CareerMemory, MemorySource, MemorySourceKind } from '../core/model';
import { DictationInput } from './DictationInput';
import './career-memory.css';
import './folio-secondary.css';
import './memory-upgrade.css';

export type MemorySaveState = 'loading' | 'dirty' | 'saving' | 'saved' | 'error';
export type TextContextKind = Exclude<MemorySourceKind, 'supportingFile'>;
export interface PendingContextFile { id: string; name: string; format: string; state: 'reading' | 'error'; error?: string }

export interface ContextCaptureProps {
  memory: CareerMemory;
  onDraftChange: (text: string) => void;
  onAddFiles: (files: File[]) => Promise<void>;
  onAddTextSource: (text: string, kind: TextContextKind) => Promise<void>;
  onLinkedInReferenceChange: (url: string) => Promise<void> | void;
  onReviewSource: (sourceId: string) => void;
  onRemoveSource?: (sourceId: string) => Promise<void>;
  onRetrySource?: (sourceId: string) => Promise<void>;
  pendingFiles?: readonly PendingContextFile[];
  onRemovePendingFile?: (id: string) => void;
  onRetryPendingFile?: (id: string) => Promise<void>;
  language?: string;
  referenceSaved?: boolean;
}

export interface OnboardingContextProps extends ContextCaptureProps {
  resume: { groupId: string; name: string; format: 'pdf' | 'docx' };
  saveState: MemorySaveState;
  saveError?: string;
  busy?: boolean;
  onContinue: (deferContext: boolean) => Promise<void>;
  onDiscardDraft: () => Promise<void>;
  onRetrySave?: () => Promise<void> | void;
}

export function MemorySaveIndicator({ state, error, onRetry }: { state: MemorySaveState; error?: string; onRetry?: () => Promise<void> | void }) {
  const [retryError, setRetryError] = useState('');
  const [retrying, setRetrying] = useState(false);
  const retryPending = useRef(false);
  async function retry() {
    if (!onRetry || retryPending.current) return;
    retryPending.current = true; setRetrying(true); setRetryError('');
    try { await onRetry(); } catch (reason) { setRetryError(messageOf(reason)); } finally { retryPending.current = false; setRetrying(false); }
  }
  const label = state === 'saved' ? 'Career Memory saved in this browser' : state === 'saving' ? 'Saving Career Memory…' : state === 'dirty' ? 'Career Memory has unsaved changes' : state === 'loading' ? 'Loading Career Memory…' : 'Career Memory not saved';
  return <div className={`memory-save memory-save-${state}`}>
    <span role="status" aria-live="polite">{state === 'saving' || state === 'loading' ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : state === 'saved' ? <Check size={15} aria-hidden="true" /> : null}{label}</span>
    {state === 'saved' && <p className="memory-save-local-note">Local to this browser profile. Download a backup in Settings to keep a recoverable copy.</p>}
    {state === 'error' ? <>
      <p role="alert">{error || 'Your edits remain open. Retry saving before switching resumes or starting an application.'}</p>
      {onRetry ? <button type="button" className="memory-text-button" disabled={retrying} aria-busy={retrying} onClick={() => void retry()}><RotateCcw size={14} aria-hidden="true" />{retrying ? 'Retrying save…' : 'Retry saving'}</button> : null}
      {retryError ? <p role="alert">{retryError}</p> : null}
    </> : null}
  </div>;
}

export function messageOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'This action could not finish. Your existing context is still available.';
}

const sourceErrorCopy = new Map<string, string>([
  ['EMPTY_FILE', 'This file is empty. Choose a document containing text, or paste your career details.'],
  ['UNSUPPORTED_FORMAT', 'Choose a selectable-text PDF, standard DOCX or UTF-8 TXT. You can also paste selected text.'],
  ['MIME_MISMATCH', 'This file is reported as a different format. Export a fresh PDF, DOCX or UTF-8 TXT, or paste selected text.'],
  ['FILE_SIZE_MISMATCH', 'This file changed while it was being read. Choose it again or export a fresh copy.'],
  ['SIGNATURE_MISMATCH', 'The file contents do not match its format. Export a fresh PDF, DOCX or UTF-8 TXT, or paste selected text.'],
  ['ENCRYPTED_DOCUMENT', 'This PDF is encrypted or password-protected. Export an unencrypted copy, or paste selected text.'],
  ['CORRUPT_PDF', 'This PDF is corrupt or unreadable. Export a fresh PDF, or paste selected text.'],
  ['DOCX_ARCHIVE', 'This file could not be read as a Word document. Export a fresh standard DOCX, or paste selected text.'],
  ['DOCX_CONTENT_TYPE', 'This file is not a standard DOCX. Export a standard DOCX or selectable-text PDF, or paste selected text.'],
  ['DOCX_ROOT_RELATIONSHIP', 'This DOCX has an unreadable document structure. Export a fresh DOCX or selectable-text PDF, or paste selected text.'],
  ['DOCX_STRUCTURE', 'This DOCX has an unreadable document structure. Export a fresh DOCX or selectable-text PDF, or paste selected text.'],
  ['ACTIVE_CONTENT', 'This DOCX contains macros or embedded active content. Export a plain document without those objects, or paste selected text.'],
  ['ARCHIVE_INVALID', 'This document contains unreadable file data. Export a fresh standard DOCX, or paste selected text.'],
  ['ARCHIVE_WORKER', 'The local document reader could not start. Reload Folio and retry this file, or paste selected text.'],
  ['ARCHIVE_TIMEOUT', 'Reading this document took too long. Export a smaller DOCX, or paste selected text.'],
  ['XML_INVALID', 'This DOCX contains unreadable document text. Export a fresh DOCX or selectable-text PDF, or paste selected text.'],
  ['CONTEXT_FILENAME', 'This filename could not be used. Rename the file with a shorter plain-text name and choose it again.'],
  ['CONTEXT_SOURCE_ID', 'This source could not be attached. Remove the failed entry and choose the file again, or paste selected text.'],
  ['CONTEXT_LOCATOR_LIMIT', 'This document has unsupported text locations. Export a fresh document, or paste selected text.'],
  ['CONTEXT_SEGMENT_LIMIT', 'This file has too many or overly long text passages. Export a shorter document with shorter paragraphs, or paste selected text.'],
  ['CONTEXT_TEXT_LIMIT', 'This file exceeds 100,000 extracted characters. Export a shorter document, or paste selected text.'],
  ['CONTEXT_PAGE_LIMIT', 'This supporting PDF exceeds the 10-page limit. Export up to 10 selected pages, or paste selected text.'],
  ['CONTEXT_PDF_LAYERS', 'This PDF has optional text layers whose visible content could not be determined. Export a flattened PDF with selectable text, or paste selected text.'],
  ['CONTEXT_DOCX_UNSUPPORTED', 'This DOCX uses text features the reader cannot reliably extract. Export a flattened PDF with selectable text, or paste selected text.'],
  ['CONTEXT_UTF8', 'This TXT is not valid UTF-8. Save it as UTF-8 plain text, or paste selected text.'],
  ['CONTEXT_BINARY_TEXT', 'This TXT contains non-text or unsupported characters. Save plain UTF-8 text, or paste selected text.'],
  ['CONTEXT_TIMEOUT', 'Reading this file took too long. Export a smaller document, or paste selected text.'],
  ['CONTEXT_CANCELLED', 'Reading this file was canceled. Retry it from Career Memory or choose it again. You can also paste selected text.'],
  ['MEMORY_SOURCE_LIMIT', 'This source exceeds Career Memory file or text limits. Remove an unused source or choose a smaller file. You can also paste a shorter detail.'],
]);

/** Persisted sources keep bounded codes, never raw parser errors or paths. */
export function supportingSourceErrorMessage(source: Pick<MemorySource, 'errorCode' | 'format'>): string {
  if (source.errorCode === 'FILE_TOO_LARGE') return source.format === 'txt'
    ? 'This TXT exceeds the 1 MiB limit. Save a smaller UTF-8 text file, or paste selected text.'
    : 'This file exceeds the 10 MiB limit. Export a smaller PDF or DOCX, or paste selected text.';
  if (source.errorCode === 'TEXTLESS') return source.format === 'pdf'
    ? 'No selectable text was found in this PDF. Export a PDF with selectable text, or paste your career details.'
    : 'No readable text was found in this file. Choose a document containing text, or paste your career details.';
  return sourceErrorCopy.get(source.errorCode || '') || 'This supporting file could not be read. Export a fresh PDF, DOCX or UTF-8 TXT, or paste selected text.';
}

function linkedInUrl(value: string): string | null {
  try {
    if (/[\u0000-\u0020\u007f]/.test(value)) return null;
    const url = new URL(value);
    return url.protocol === 'https:' && ['linkedin.com', 'www.linkedin.com'].includes(url.hostname) && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/in\/[^/]+\/?$/.test(url.pathname) ? url.href : null;
  } catch { return null; }
}

function SourceRow({ source, onReview, onRemove, onRetry }: { source: MemorySource; onReview: () => void; onRemove?: () => Promise<void>; onRetry?: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const label = source.state === 'reading' ? 'Reading' : source.state === 'needsReview' ? 'Needs review' : source.state === 'ready' ? 'Source ready' : 'Could not read';
  async function run(action: () => Promise<void>) {
    setPending(true); setError('');
    try { await action(); } catch (reason) { setError(messageOf(reason)); } finally { setPending(false); }
  }
  return <li className="memory-source-row">
    <FileText size={18} aria-hidden="true" />
    <div className="memory-source-info"><strong>{source.name}</strong><span>{source.format.toUpperCase()} · {label}</span>
      {source.state === 'error' ? <p className="memory-help">{supportingSourceErrorMessage(source)}</p> : null}
      {error ? <p className="memory-error" role="alert">{error}</p> : null}
    </div>
    <div className="memory-source-actions">
      {source.state === 'needsReview' || source.state === 'ready' ? <button type="button" className="memory-text-button" onClick={onReview}>Review source</button> : null}
      {source.state === 'error' && onRetry ? <button type="button" className="memory-text-button" disabled={pending} onClick={() => void run(onRetry)}>Retry</button> : null}
      {onRemove ? <button type="button" className="memory-icon-button" aria-label={`Remove source ${source.name}`} disabled={pending} onClick={() => void run(onRemove)}><X size={17} /></button> : null}
    </div>
  </li>;
}

/** Context entry is presentation only. Root owns source parsing, memory commands and persistence. */
export type ContextEntryMethod = 'typed' | 'files' | 'linkedin' | 'voice';
export function ContextCapture({ memory, onDraftChange, onAddFiles, onAddTextSource, onLinkedInReferenceChange, onReviewSource, onRemoveSource, onRetrySource, pendingFiles = [], onRemovePendingFile, onRetryPendingFile, language = 'en-US', referenceSaved = false, method }: ContextCaptureProps & { method?: ContextEntryMethod }) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const linkedFileInput = useRef<HTMLInputElement>(null);
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState(memory.linkedInReference?.url || '');
  const [urlError, setUrlError] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(method === 'voice');
  const sources = memory.sources.filter(source => source.kind === 'supportingFile');
  const textSources = memory.sources.filter(source => source.kind !== 'supportingFile');
  const sourceLimit = sources.length + pendingFiles.length >= 5;
  async function run(label: string, callback: () => Promise<void> | void) {
    if (action) return;
    setAction(label); setError('');
    try { await callback(); } catch (reason) { setError(messageOf(reason)); } finally { setAction(''); }
  }
  function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length) void run('files', () => onAddFiles(list));
  }
  function saveReference() {
    if (url && !linkedInUrl(url)) { setUrlError('Use an HTTPS LinkedIn profile link, such as https://www.linkedin.com/in/your-name/.'); return; }
    setUrlError('');
    void run('link', () => onLinkedInReferenceChange(url));
  }
  const draftEntry = <>
    <label className="memory-field-label" htmlFor={`${id}-draft`}>Additional career context</label>
    <p className="memory-help" id={`${id}-draft-help`}>Name the role or project, what you personally did, and the result you can support. Dates and measures are optional; include them only when known.</p>
    <textarea id={`${id}-draft`} value={memory.draftText} onChange={event => onDraftChange(event.target.value)} maxLength={10000} rows={6} aria-describedby={`${id}-draft-help ${id}-draft-count ${id}-draft-state`} placeholder="Role or project: …&#10;My contribution: …&#10;Result or evidence I can support: …" />
    <div className="memory-field-footer"><p className="memory-help" id={`${id}-draft-state`}>Draft · Review and confirm before use in future applications.</p><span id={`${id}-draft-count`}>{memory.draftText.length.toLocaleString()} / 10,000</span></div>
    {memory.draftText.trim() ? <button type="button" className="memory-secondary" disabled={!!action} onClick={() => void run(method === 'linkedin' ? 'linkedin' : 'text', () => onAddTextSource(memory.draftText, method === 'linkedin' ? 'linkedinPaste' : 'typed'))}>{action === 'text' || action === 'linkedin' ? <LoaderCircle size={16} className="spin" aria-hidden="true" /> : null}{method === 'linkedin' ? 'Review pasted profile details' : 'Review and confirm'}</button> : null}
  </>;
  return <div className={`memory-capture ${method ? 'memory-capture-method' : ''}`} data-entry-method={method}>
    <ol className="memory-capture-steps" aria-label="How career details become usable"><li>Add a source</li><li>Review exact wording</li><li>Confirm each detail</li></ol>
    <p className="memory-capture-note">Saving a source does not confirm its facts. Unconfirmed details and edit drafts stay outside future application evidence.</p>
    {method !== 'files' && (method === 'linkedin' || method === 'voice' ? <details className="memory-entry-alternative" open={!!memory.draftText || undefined}><summary>{method === 'linkedin' ? 'Paste LinkedIn details' : 'Type a career detail'}<ChevronDown size={16} aria-hidden="true" /></summary><div>{draftEntry}</div></details> : draftEntry)}

    <div className="memory-alternatives">
      {(!method || method === 'files') && <details className="memory-disclosure" open={method === 'files' || undefined}>
        <summary><span><FolderPlus size={18} aria-hidden="true" />Add supporting files</span><ChevronDown size={17} aria-hidden="true" /></summary>
        <div className="memory-disclosure-content">
          <p className="memory-help" id={`${id}-file-help`}>Selectable-text PDF, DOCX or UTF-8 TXT. Up to 5 files; PDF/DOCX 10 MiB each, TXT 1 MiB; 25 MiB total. Supporting PDFs can have up to 10 pages. Scans need a text alternative.</p>
          <div className={`memory-file-picker ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); if (!sourceLimit) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!sourceLimit) addFiles(event.dataTransfer.files); }}>
            <input ref={fileInput} className="visually-hidden" tabIndex={-1} type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" multiple aria-label="Select supporting career files" aria-describedby={`${id}-file-help`} disabled={sourceLimit || !!action} onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
            <button type="button" className="memory-secondary" disabled={sourceLimit || !!action} aria-describedby={`${id}-file-help`} onClick={() => fileInput.current?.click()}><FolderPlus size={16} aria-hidden="true" />{action === 'files' ? 'Reading files…' : 'Choose files'}</button><span>{sourceLimit ? 'File limit reached. Remove a source before adding another.' : 'or drop them here'}</span>
          </div>
          {sources.length ? <ul className="memory-source-list">{sources.map(source => <SourceRow key={source.id} source={source} onReview={() => onReviewSource(source.id)} onRemove={onRemoveSource ? () => onRemoveSource(source.id) : undefined} onRetry={onRetrySource ? () => onRetrySource(source.id) : undefined} />)}</ul> : null}
          {pendingFiles.length ? <ul className="memory-source-list">{pendingFiles.map(file => <li className="memory-source-row" key={file.id}><FileText size={18} aria-hidden="true" /><div className="memory-source-info"><strong>{file.name}</strong><span>{file.format.toUpperCase()} · {file.state === 'reading' ? 'Reading' : 'Could not read'}</span>{file.error ? <p className="memory-error">{file.error}</p> : null}</div><div className="memory-source-actions">{file.state === 'error' && onRetryPendingFile ? <button type="button" className="memory-text-button" disabled={!!action} onClick={() => void run('retry', () => onRetryPendingFile(file.id))}>Retry</button> : null}{onRemovePendingFile ? <button type="button" className="memory-icon-button" aria-label={`Remove failed or pending file ${file.name}`} onClick={() => onRemovePendingFile(file.id)}><X size={17} /></button> : null}</div></li>)}</ul> : null}
        </div>
      </details>}
      {(!method || method === 'linkedin') && <details className="memory-disclosure" open={method === 'linkedin' || undefined}>
        <summary><span><Link2 size={18} aria-hidden="true" />Add LinkedIn details</span><ChevronDown size={17} aria-hidden="true" /></summary>
        <div className="memory-disclosure-content">
          <p className="memory-help">Upload an export from LinkedIn’s More → Save to PDF, or paste selected profile text. Review the extracted source and confirm any details before future use.</p>
          <button type="button" className="memory-linkedin-upload" disabled={sourceLimit || !!action} onClick={() => linkedFileInput.current?.click()}><Upload size={22} aria-hidden="true" /><strong>{action === 'files' ? 'Reading export…' : 'Upload profile export'}</strong><span>{sourceLimit ? 'File limit reached. Remove a source before adding another.' : 'Selectable-text PDF, DOCX or TXT'}</span></button>
          <details className="memory-entry-alternative memory-profile-reference"><summary>Save a profile link for reference<ChevronDown size={16} aria-hidden="true" /></summary><div>
          <p className="memory-help">A profile URL is saved for reference only. Folio cannot read LinkedIn from a link here.</p>
          <label className="memory-field-label" htmlFor={`${id}-url`}>LinkedIn profile URL</label>
          <div className="memory-inline-input"><input id={`${id}-url`} type="url" value={url} autoComplete="url" maxLength={2048} placeholder="https://www.linkedin.com/in/your-name/" aria-invalid={!!urlError} aria-describedby={urlError ? `${id}-url-error` : undefined} onChange={event => { setUrl(event.target.value); setUrlError(''); }} /><button type="button" className="memory-secondary" disabled={!!action} onClick={saveReference}>{url ? 'Save link' : 'Clear link'}</button></div>
          {urlError ? <p id={`${id}-url-error`} className="memory-error" role="alert">{urlError}</p> : null}
          {memory.linkedInReference ? <div className="memory-link-reference"><span>{referenceSaved ? 'Link saved' : 'Reference only'} · Profile content not imported</span><a href={linkedInUrl(memory.linkedInReference.url) || undefined} target="_blank" rel="noopener noreferrer">Open profile outside Folio<ExternalLink size={13} aria-hidden="true" /></a></div> : null}
          </div></details>
          {!method && <><p className="memory-help">Paste profile details into <a className="memory-inline-link" href={`#${id}-draft`} onClick={() => document.getElementById(`${id}-draft`)?.focus()}>Additional career context</a> above, then review them as LinkedIn details. The text stays an unconfirmed draft.</p><div className="memory-actions"><button type="button" className="memory-secondary" disabled={!memory.draftText.trim() || !!action} onClick={() => void run('linkedin', () => onAddTextSource(memory.draftText, 'linkedinPaste'))}>Review pasted profile details</button></div></>}
          <input ref={linkedFileInput} className="visually-hidden" tabIndex={-1} type="file" accept=".pdf,.docx,.txt" aria-label="Upload a supported LinkedIn profile export" disabled={sourceLimit || !!action} onChange={event => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; }} />
          <p className="memory-help">A profile PDF export may be available on LinkedIn desktop. Paste works when export is unavailable. ZIP archives are unsupported.</p>
        </div>
      </details>}
      {(!method || method === 'voice') && <details className="memory-disclosure" open={method === 'voice' || undefined} onToggle={event => setVoiceOpen(event.currentTarget.open)}>
        <summary><span><Mic size={18} aria-hidden="true" />Dictate</span><ChevronDown size={17} aria-hidden="true" /></summary>
        <div className="memory-disclosure-content">{voiceOpen ? <DictationInput language={language} onTranscriptAccepted={text => onAddTextSource(text, 'localDictation')} /> : null}</div>
      </details>}
    </div>
    {method === 'linkedin' && sources.length ? <ul className="memory-source-list">{sources.map(source => <SourceRow key={source.id} source={source} onReview={() => onReviewSource(source.id)} onRemove={onRemoveSource ? () => onRemoveSource(source.id) : undefined} onRetry={onRetrySource ? () => onRetrySource(source.id) : undefined} />)}</ul> : null}
    {method === 'linkedin' && pendingFiles.length ? <ul className="memory-source-list">{pendingFiles.map(file => <li className="memory-source-row" key={file.id}><FileText size={18} aria-hidden="true" /><div className="memory-source-info"><strong>{file.name}</strong><span>{file.format.toUpperCase()} · {file.state === 'reading' ? 'Reading' : 'Could not read'}</span>{file.error ? <p className="memory-error" role="alert">{file.error}</p> : null}</div><div className="memory-source-actions">{file.state === 'error' && onRetryPendingFile ? <button type="button" className="memory-text-button" disabled={!!action} onClick={() => void run('retry', () => onRetryPendingFile(file.id))}>Retry</button> : null}{onRemovePendingFile ? <button type="button" className="memory-icon-button" aria-label={`Remove failed or pending file ${file.name}`} onClick={() => onRemovePendingFile(file.id)}><X size={17} /></button> : null}</div></li>)}</ul> : null}
    {textSources.length ? <ul className="memory-source-list memory-text-sources">{textSources.map(source => <SourceRow key={source.id} source={source} onReview={() => onReviewSource(source.id)} onRemove={onRemoveSource ? () => onRemoveSource(source.id) : undefined} />)}</ul> : null}
    {error ? <p className="memory-error" role="alert">{error}</p> : null}
  </div>;
}

export function OnboardingContext({ resume, memory, saveState, saveError, busy = false, onContinue, onDiscardDraft, onRetrySave, ...capture }: OnboardingContextProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { heading.current?.focus(); }, []);
  async function act(callback: () => Promise<void>) {
    if (pending || busy) return;
    setPending(true); setError('');
    try { await callback(); } catch (reason) { setError(messageOf(reason)); } finally { setPending(false); }
  }
  return <section className="onboarding-context memory-surface" aria-labelledby="onboarding-context-title">
    <div className="memory-resume-summary"><span className="memory-resume-mark"><FileText size={22} aria-hidden="true" /></span><div><strong>{resume.name}</strong><span>{resume.format.toUpperCase()} · Resume ready for review</span></div><Check size={18} aria-hidden="true" /></div>
    <header className="memory-onboarding-heading"><span className="memory-eyebrow">Optional context</span><h1 ref={heading} id="onboarding-context-title" tabIndex={-1}>Anything your resume doesn't cover?</h1><p>Add an accomplishment, project, or career detail you want to reuse. You can do this later in Career Memory.</p></header>
    <ContextCapture memory={memory} referenceSaved={saveState === 'saved'} {...capture} />
    <div className="memory-onboarding-footer">
      <MemorySaveIndicator state={saveState} error={saveError} onRetry={onRetrySave} />
      <div className="memory-onboarding-actions"><button type="button" className="memory-primary" disabled={pending || busy} onClick={() => void act(() => onContinue(false))}>Continue to template review<ArrowRight size={17} aria-hidden="true" /></button><button type="button" className="memory-text-button" disabled={pending || busy} onClick={() => void act(() => onContinue(true))}>Skip for now</button></div>
      <p className="memory-help">Both options keep your context. Unconfirmed drafts stay available for later review.</p>
      {memory.draftText ? <button type="button" className="memory-text-button memory-discard" disabled={pending || busy} onClick={() => void act(onDiscardDraft)}>Discard this context draft</button> : null}
      {error ? <p className="memory-error" role="alert">{error}</p> : null}
    </div>
  </section>;
}

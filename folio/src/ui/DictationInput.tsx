import { useEffect, useId, useRef, useState } from 'react';
import { LoaderCircle, Mic, Square, X } from 'lucide-react';
import { checkLocalDictation, startLocalDictation, type LocalDictationSession } from '../input/dictation';
import './career-memory.css';

export interface DictationInputProps {
  language?: string;
  onTranscriptAccepted: (finalText: string) => Promise<void> | void;
  onSessionStateChange?: (state: 'idle' | 'listening' | 'error') => void;
}
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : 'Dictation could not finish. Type or paste your context instead.';

export function DictationInput({ language = 'en-US', onTranscriptAccepted, onSessionStateChange }: DictationInputProps) {
  const id = useId();
  const session = useRef<LocalDictationSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const onState = useRef(onSessionStateChange);
  onState.current = onSessionStateChange;
  const [capability, setCapability] = useState<'checking' | 'availableLocally' | 'unavailable'>('checking');
  const [state, setState] = useState<'idle' | 'starting' | 'listening' | 'stopped' | 'error'>('idle');
  const [message, setMessage] = useState('Checking installed on-device recognition…');
  const [transcript, setTranscript] = useState('');
  const [interim, setInterim] = useState('');
  const [accepting, setAccepting] = useState(false);
  const active = state === 'listening' || state === 'starting';

  useEffect(() => {
    let current = true;
    setCapability('checking');
    void checkLocalDictation(language).then(result => { if (current) { setCapability(result.state); setMessage(result.message); } }).catch(() => { if (current) { setCapability('unavailable'); setMessage("Local dictation isn't available in this browser. Type or paste your context instead."); } });
    function release() {
      generation.current += 1;
      controller.current?.abort(); controller.current = null;
      session.current?.dispose(); session.current = null;
      onState.current?.('idle');
    }
    function stopForPage() {
      const hadSession = !!controller.current || !!session.current;
      release();
      if (current && hadSession) { setState('stopped'); setInterim(''); setMessage('Dictation stopped when this page was hidden. Review any completed text, or type your context.'); }
    }
    function hide() { if (document.visibilityState === 'hidden') stopForPage(); }
    window.addEventListener('pagehide', stopForPage);
    document.addEventListener('visibilitychange', hide);
    return () => { current = false; release(); window.removeEventListener('pagehide', stopForPage); document.removeEventListener('visibilitychange', hide); };
  }, [language]);

  function cancel() {
    generation.current += 1;
    session.current?.cancel(); session.current?.dispose(); session.current = null;
    controller.current?.abort(); controller.current = null;
    setState('idle'); setTranscript(''); setInterim(''); setMessage('Dictation canceled. Your additional context draft is unchanged.');
    onState.current?.('idle');
  }
  function start() {
    if (capability !== 'availableLocally' || active || transcript || accepting) return;
    const token = ++generation.current;
    controller.current?.abort(); session.current?.dispose();
    const abort = new AbortController(); controller.current = abort;
    setState('starting'); setMessage('Starting local dictation…'); setInterim('');
    // Enter the adapter directly from this click while browser user activation is valid.
    const pending = startLocalDictation({ language, signal: abort.signal,
      onTranscript: result => { if (token === generation.current) { setTranscript(result.finalText); setInterim(result.interimText); } },
      onState: result => {
        if (token !== generation.current) return;
        setMessage(result.message);
        if (result.state === 'listening') { setState('listening'); onState.current?.('listening'); }
        else if (result.state === 'error') { setState('error'); setInterim(''); onState.current?.('error'); }
        else { setState('stopped'); setInterim(''); onState.current?.('idle'); }
      },
    });
    void pending.then(handle => { if (token === generation.current) session.current = handle; else handle.dispose(); }).catch(reason => {
      if (token !== generation.current) return;
      setState('error'); setInterim(''); setMessage(messageOf(reason)); onState.current?.('error');
    });
  }
  async function accept() {
    if (!transcript.trim() || transcript.length > 10000 || active || accepting) return;
    setAccepting(true);
    try { await onTranscriptAccepted(transcript); setMessage('Transcript added as an unconfirmed source. Review and confirm its exact wording.'); setTranscript(''); setState('idle'); }
    catch (reason) { setMessage(messageOf(reason)); setState('error'); }
    finally { setAccepting(false); }
  }
  return <div className="memory-dictation" onKeyDown={event => { if (event.key === 'Escape' && active) { event.preventDefault(); event.stopPropagation(); cancel(); } }}>
    <p className="memory-help" id={`${id}-privacy`}>Uses installed on-device recognition when available. Review the transcript before saving. Language: {language}. No audio is stored.</p>
    <p className={`memory-dictation-status ${state === 'error' ? 'memory-error' : ''}`} role={state === 'error' ? 'alert' : 'status'} aria-live="polite">{active ? <Mic size={15} aria-hidden="true" /> : capability === 'checking' ? <LoaderCircle size={15} className="spin" aria-hidden="true" /> : null}{message}</p>
    {capability === 'availableLocally' ? <>
      <div className="memory-actions">{active ? <><button type="button" className="memory-secondary" onClick={() => { if (session.current) { session.current.stop(); setMessage('Stopping dictation…'); } else cancel(); }}><Square size={14} aria-hidden="true" />Stop dictation</button><button type="button" className="memory-text-button" onClick={cancel}><X size={15} aria-hidden="true" />Cancel dictation</button></> : <button type="button" className="memory-secondary" onClick={start} disabled={!!transcript || accepting} aria-describedby={`${id}-privacy`}><Mic size={16} aria-hidden="true" />Start dictation</button>}</div>
      {active ? <div className="memory-live-transcript"><span className="memory-field-label">Completed speech</span><p>{transcript || 'Your completed words will appear here.'}</p>{interim ? <p className="memory-interim"><span>Still being recognized: </span>{interim}</p> : null}</div> : transcript ? <>
        <label className="memory-field-label" htmlFor={`${id}-transcript`}>Review and edit your transcript</label><textarea id={`${id}-transcript`} value={transcript} maxLength={10000} rows={5} disabled={accepting} onChange={event => setTranscript(event.target.value)} aria-describedby={`${id}-unconfirmed`} />
        <p className="memory-help" id={`${id}-unconfirmed`}>An editable draft. “Use transcript” adds an unconfirmed source; it does not attest or insert anything in the resume. {transcript.length.toLocaleString()} / 10,000 characters.</p>{transcript.length > 10000 ? <p className="memory-error" role="alert">Shorten this transcript to 10,000 characters before using it.</p> : null}<div className="memory-actions"><button type="button" className="memory-primary" disabled={!transcript.trim() || transcript.length > 10000 || accepting} onClick={() => void accept()}>Use transcript</button><button type="button" className="memory-text-button" disabled={accepting} onClick={cancel}>Discard transcript</button></div>
      </> : null}
    </> : <p className="memory-help">Type or paste in Additional career context. Your keyboard's own dictation can also enter text; Folio does not control that input method.</p>}
  </div>;
}

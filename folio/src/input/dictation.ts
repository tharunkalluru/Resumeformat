import { FolioError } from '../core/errors';

export type LocalVoiceCapability = 'checking' | 'availableLocally' | 'unavailable';
export interface LocalDictationCapability { state: 'availableLocally' | 'unavailable'; language: string; message: string }
export interface DictationTranscript { finalText: string; interimText: string }
export interface DictationState { state: 'listening' | 'stopped' | 'cancelled' | 'error'; message: string }
export interface LocalDictationSession { stop(): void; cancel(): void; dispose(): void }

interface RecognitionAlternative { transcript: string }
interface RecognitionResult { isFinal: boolean; length: number; [index: number]: RecognitionAlternative }
interface RecognitionResultEvent { resultIndex: number; results: { length: number; [index: number]: RecognitionResult } }
/** Structural experimental API types stay inside this adapter, without adding
 * browser globals or pretending that a prefixed remote engine is local. */
export interface LocalRecognition {
  processLocally: boolean; quality: string; lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void; stop(): void; abort(): void;
}
export interface LocalRecognitionConstructor {
  new(): LocalRecognition;
  available(options: { langs: string[]; processLocally: true; quality: 'dictation' }): Promise<unknown>;
}
export interface DictationEnvironment {
  SpeechRecognition?: unknown;
  webkitSpeechRecognition?: unknown;
  isSecureContext: boolean;
  userActivation?: { isActive: boolean };
  lifecycle?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  document?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
}
export interface LocalDictationOptions {
  language?: string; signal?: AbortSignal; environment?: DictationEnvironment;
  onTranscript(transcript: DictationTranscript): void;
  onState(state: DictationState): void;
}

const SESSION_MS = 60_000;
const PROBE_MS = 5_000;
const TRANSCRIPT_CHARACTERS = 10_000;
const fallback = 'Type or paste your career context instead.';
const abortError = () => new FolioError('DICTATION_CANCELLED', 'Dictation was cancelled. Your typed context is unchanged.');
function browserEnvironment(): DictationEnvironment {
  if (typeof window === 'undefined') return { isSecureContext: false };
  const browser = window as Window & { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  return { SpeechRecognition: browser.SpeechRecognition, webkitSpeechRecognition: browser.webkitSpeechRecognition, isSecureContext: window.isSecureContext, userActivation: navigator.userActivation, lifecycle: window, document };
}
function languageOrFallback(language: string): string | undefined {
  if (language.length > 64 || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(language)) return undefined;
  try { return Intl.getCanonicalLocales(language)[0]; } catch { return undefined; }
}
function constructorFor(environment: DictationEnvironment): LocalRecognitionConstructor | undefined {
  // Prefer the standard constructor. A prefixed constructor is considered only
  // when it exposes the same verified local API, never as a remote fallback.
  const candidate = environment.SpeechRecognition ?? environment.webkitSpeechRecognition;
  if (typeof candidate !== 'function' || typeof (candidate as unknown as { available?: unknown }).available !== 'function') return undefined;
  return candidate as unknown as LocalRecognitionConstructor;
}
function localInstance(Constructor: LocalRecognitionConstructor, language: string): LocalRecognition | undefined {
  try {
    const recognition = new Constructor();
    if (!('processLocally' in recognition) || !('quality' in recognition) || !('lang' in recognition) || typeof recognition.start !== 'function' || typeof recognition.stop !== 'function' || typeof recognition.abort !== 'function') return undefined;
    recognition.processLocally = true; recognition.quality = 'dictation'; recognition.lang = language;
    if (recognition.processLocally !== true || recognition.quality !== 'dictation' || recognition.lang !== language) return undefined;
    return recognition;
  } catch { return undefined; }
}
async function boundedProbe(Constructor: LocalRecognitionConstructor, language: string, signal?: AbortSignal): Promise<unknown> {
  if (signal?.aborted) throw abortError();
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const finish = (value: unknown, error = false) => { if (settled) return; settled = true; cleanup(); if (error) reject(value); else resolve(value); };
    const abort = () => finish(abortError(), true);
    const timer = setTimeout(() => finish(new FolioError('DICTATION_CAPABILITY', 'The local dictation check timed out.'), true), PROBE_MS);
    signal?.addEventListener('abort', abort, { once: true });
    try { Promise.resolve(Constructor.available({ langs: [language], processLocally: true, quality: 'dictation' })).then(value => finish(value), () => finish(new FolioError('DICTATION_CAPABILITY', 'The browser could not verify installed local dictation.'), true)); }
    catch { finish(new FolioError('DICTATION_CAPABILITY', 'The browser could not verify installed local dictation.'), true); }
  });
}

/** Read-only capability check: never starts a microphone or downloads a pack. */
export async function checkLocalDictation(language = 'en-US', environment: DictationEnvironment = browserEnvironment()): Promise<LocalDictationCapability> {
  const unavailable = (message: string): LocalDictationCapability => ({ state: 'unavailable', language, message: `${message} ${fallback}` });
  const locale = languageOrFallback(language);
  if (!locale) return unavailable('This dictation language is unsupported.');
  if (!environment.isSecureContext) return unavailable('Local dictation requires a secure browser context.');
  const Constructor = constructorFor(environment);
  if (!Constructor || !localInstance(Constructor, locale)) return unavailable('This browser cannot verify local dictation.');
  try {
    if (await boundedProbe(Constructor, locale) !== 'available') return unavailable(`Installed local dictation is unavailable for ${locale}.`);
    return { state: 'availableLocally', language: locale, message: `Installed local dictation is available for ${locale}. Start requests microphone permission; only text you choose to use will be saved.` };
  } catch { return unavailable('The browser could not verify installed local dictation.'); }
}

const errorMessages: Record<string, string> = {
  'not-allowed': 'Microphone permission was denied.',
  'service-not-allowed': 'The browser denied local dictation.',
  'audio-capture': 'The microphone could not be used.',
  'no-speech': 'No speech was detected.',
  'language-not-supported': 'Installed local dictation does not support this language.',
  'network': 'The local recognition engine failed.',
  'aborted': 'Dictation was interrupted.',
};

/** Call from an explicit Start button. No automatic retry, remote fallback,
 * MediaRecorder, audio track, persisted transcript or applicant confirmation. */
export async function startLocalDictation(options: LocalDictationOptions): Promise<LocalDictationSession> {
  const environment = options.environment ?? browserEnvironment();
  const language = languageOrFallback(options.language ?? 'en-US');
  const Constructor = constructorFor(environment);
  if (options.signal?.aborted) throw abortError();
  if (!environment.userActivation?.isActive) throw new FolioError('DICTATION_USER_ACTION', `Start dictation with its button. ${fallback}`);
  if (!environment.isSecureContext || !language || !Constructor) throw new FolioError('DICTATION_UNAVAILABLE', `This browser cannot verify local dictation. ${fallback}`);
  const recognition = localInstance(Constructor, language);
  if (!recognition || await boundedProbe(Constructor, language, options.signal) !== 'available') throw new FolioError('DICTATION_UNAVAILABLE', `Installed local dictation is unavailable for ${language}. ${fallback}`);
  if (options.signal?.aborted) throw abortError();
  if (environment.document && environment.document.visibilityState !== 'visible') throw abortError();
  // Recheck immediately before microphone use in case an experimental setter
  // refused or changed the required local properties during the availability check.
  try {
    recognition.processLocally = true; recognition.quality = 'dictation'; recognition.lang = language;
    if (recognition.processLocally !== true || recognition.quality !== 'dictation' || recognition.lang !== language) throw new Error('Local settings refused');
    recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
  } catch { throw new FolioError('DICTATION_UNAVAILABLE', `The browser could not enforce local dictation. ${fallback}`); }

  let closed = false; let stopping = false; let finalText = ''; let interimText = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  const finalized = new Map<number, string>();
  const detach = () => {
    if (timer) clearTimeout(timer); if (stopTimer) clearTimeout(stopTimer);
    options.signal?.removeEventListener('abort', cancel);
    environment.lifecycle?.removeEventListener('pagehide', cancel);
    environment.lifecycle?.removeEventListener('beforeunload', cancel);
    environment.document?.removeEventListener('visibilitychange', visibility);
    recognition.onstart = null; recognition.onend = null; recognition.onerror = null; recognition.onresult = null;
  };
  const finish = (state: DictationState['state'], message: string, abort: boolean, notify = true) => {
    if (closed) return; closed = true; detach();
    if (abort) { try { recognition.abort(); } catch { /* Already inactive. */ } }
    interimText = '';
    if (notify) { options.onTranscript({ finalText, interimText }); options.onState({ state, message }); }
  };
  function cancel() { finish('cancelled', 'Dictation cancelled. Your typed context is unchanged.', true); }
  function visibility() { if (environment.document?.visibilityState !== 'visible') cancel(); }
  const stop = () => {
    if (closed || stopping) return; stopping = true;
    if (timer) clearTimeout(timer);
    // stop() permits a final result; abort if the engine never sends its end event.
    stopTimer = setTimeout(() => finish('stopped', finalText ? 'Dictation stopped. Review the completed transcript before using it.' : `Dictation stopped without a completed transcript. ${fallback}`, true), 2_000);
    try { recognition.stop(); } catch { finish('error', `Dictation could not stop normally. ${fallback}`, true); }
  };
  recognition.onstart = () => { if (!closed) options.onState({ state: 'listening', message: `Listening locally in ${language}. Stop when finished.` }); };
  recognition.onend = () => finish('stopped', finalText ? 'Dictation stopped. Review the completed transcript before using it.' : `Dictation stopped without a completed transcript. ${fallback}`, true);
  recognition.onerror = event => finish('error', `${errorMessages[event.error] ?? 'Local dictation failed.'} ${fallback}`, true);
  recognition.onresult = event => {
    if (closed) return;
    if (!Number.isSafeInteger(event.results.length) || event.results.length < 0 || event.results.length > 2_000) { finish('error', `The recognition result was invalid. ${fallback}`, true); return; }
    const provisional: string[] = [];
    for (let index = 0; index < event.results.length; index++) {
      const result = event.results[index]; const text = result?.[0]?.transcript;
      if (!result || typeof result.isFinal !== 'boolean' || typeof text !== 'string' || /\u0000/.test(text)) { finish('error', `The recognition result was invalid. ${fallback}`, true); return; }
      if (result.isFinal) { if (!finalized.has(index)) finalized.set(index, text); }
      else provisional.push(text);
    }
    const stable = [...finalized.entries()].sort(([a], [b]) => a - b).map(([, text]) => text).join(' ');
    const interim = provisional.join(' ');
    if (stable.length + interim.length > TRANSCRIPT_CHARACTERS) { finish('error', `This transcript reached the 10,000 character limit. ${fallback}`, true); return; }
    finalText = stable; interimText = interim;
    options.onTranscript({ finalText, interimText });
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  environment.lifecycle?.addEventListener('pagehide', cancel);
  environment.lifecycle?.addEventListener('beforeunload', cancel);
  environment.document?.addEventListener('visibilitychange', visibility);
  timer = setTimeout(() => { stop(); }, SESSION_MS);
  try { recognition.start(); } catch { finish('error', `The browser could not start local dictation. ${fallback}`, true); throw new FolioError('DICTATION_START', `The browser could not start local dictation. ${fallback}`); }
  return { stop, cancel, dispose: () => finish('cancelled', '', true, false) };
}

export const getLocalDictationCapability = checkLocalDictation;

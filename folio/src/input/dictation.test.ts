// @vitest-environment node
// All recognition engines here are test doubles. They prove adapter control and
// callback behavior, never microphone capture or successful native dictation.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkLocalDictation, startLocalDictation, type DictationEnvironment, type DictationTranscript, type LocalRecognition } from './dictation';

function engine(status: unknown = 'available') {
  const instances: RecognitionDouble[] = [];
  class RecognitionDouble implements LocalRecognition {
    static available = vi.fn(async () => status);
    processLocally = false; quality = 'command'; lang = ''; continuous = false; interimResults = false; maxAlternatives = 0;
    onstart: LocalRecognition['onstart'] = null; onend: LocalRecognition['onend'] = null; onresult: LocalRecognition['onresult'] = null; onerror: LocalRecognition['onerror'] = null;
    start = vi.fn(() => { this.onstart?.(); }); stop = vi.fn(); abort = vi.fn();
    constructor() { instances.push(this); }
  }
  const lifecycle = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const environment: DictationEnvironment = { SpeechRecognition: RecognitionDouble, isSecureContext: true, userActivation: { isActive: true }, lifecycle, document };
  return { Constructor: RecognitionDouble, instances, environment, lifecycle, document, active: () => instances[instances.length - 1] };
}
function result(engine: LocalRecognition, entries: { text: string; final: boolean }[]) {
  engine.onresult?.({ resultIndex: 0, results: Object.assign(entries.map(entry => ({ isFinal: entry.final, length: 1, 0: { transcript: entry.text } })), { length: entries.length }) });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('local speech capability gate (test doubles; no microphone)', () => {
  it('requires an installed pack with local dictation quality and never starts recognition in a capability check', async () => {
    const test = engine();
    expect(await checkLocalDictation('en-US', test.environment)).toMatchObject({ state: 'availableLocally', language: 'en-US' });
    expect(test.Constructor.available).toHaveBeenCalledExactlyOnceWith({ langs: ['en-US'], processLocally: true, quality: 'dictation' });
    expect(test.active().start).not.toHaveBeenCalled(); expect(test.active().processLocally).toBe(true); expect(test.active().quality).toBe('dictation');
  });
  it.each(['unavailable', 'downloadable', 'downloading', 'unexpected', true, null])('fails closed for status %s with typed fallback and no engine start', async status => {
    const test = engine(status);
    const capability = await checkLocalDictation('en-US', test.environment);
    expect(capability.state).toBe('unavailable'); expect(capability.message).toContain('Type or paste');
    await expect(startLocalDictation({ environment: test.environment, onTranscript: vi.fn(), onState: vi.fn() })).rejects.toMatchObject({ code: 'DICTATION_UNAVAILABLE' });
    expect(test.instances.every(instance => instance.start.mock.calls.length === 0)).toBe(true);
  });
  it('rejects missing API, insecure context, absent local properties and a setter that refuses local mode', async () => {
    const noApi = { isSecureContext: true };
    expect((await checkLocalDictation('en-US', noApi)).state).toBe('unavailable');
    const insecure = engine(); insecure.environment.isSecureContext = false;
    expect((await checkLocalDictation('en-US', insecure.environment)).state).toBe('unavailable'); expect(insecure.Constructor.available).not.toHaveBeenCalled();
    class RemoteDouble { static available = vi.fn(async () => 'available'); lang = ''; start() {} stop() {} abort() {} }
    expect((await checkLocalDictation('en-US', { SpeechRecognition: RemoteDouble, isSecureContext: true })).state).toBe('unavailable');
    expect(RemoteDouble.available).not.toHaveBeenCalled();
    class RefusingDouble extends RemoteDouble { get processLocally() { return false; } set processLocally(_value: boolean) {} quality = 'dictation'; }
    expect((await checkLocalDictation('en-US', { SpeechRecognition: RefusingDouble, isSecureContext: true })).state).toBe('unavailable');
  });
  it('allows a prefixed constructor only when the same complete local contract is verified', async () => {
    const test = engine();
    const environment = { ...test.environment, SpeechRecognition: undefined, webkitSpeechRecognition: test.Constructor };
    expect((await checkLocalDictation('en-US', environment)).state).toBe('availableLocally');
    const oldPrefixed = class { start = vi.fn(); };
    expect((await checkLocalDictation('en-US', { ...environment, webkitSpeechRecognition: oldPrefixed })).state).toBe('unavailable');
  });
  it('catches availability failure and times out a hung probe without installing or using a microphone', async () => {
    const test = engine(); test.Constructor.available.mockRejectedValueOnce(new Error('Private engine error'));
    expect((await checkLocalDictation('en-US', test.environment)).state).toBe('unavailable');
    vi.useFakeTimers(); test.Constructor.available.mockImplementationOnce(() => new Promise(() => {}));
    const pending = checkLocalDictation('en-US', test.environment);
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).state).toBe('unavailable'); expect(vi.getTimerCount()).toBe(0);
    expect(test.instances.every(instance => instance.start.mock.calls.length === 0)).toBe(true);
  });
});

describe('explicit local speech session and teardown (test doubles)', () => {
  it('requires user activation before capability or microphone use', async () => {
    const test = engine(); test.environment.userActivation = { isActive: false };
    await expect(startLocalDictation({ environment: test.environment, onTranscript: vi.fn(), onState: vi.fn() })).rejects.toMatchObject({ code: 'DICTATION_USER_ACTION' });
    expect(test.Constructor.available).not.toHaveBeenCalled(); expect(test.instances).toHaveLength(0);
  });
  it('sets and verifies local properties before start; keeps final and interim text separate and stable across result repeats', async () => {
    const test = engine(), transcript = vi.fn(), state = vi.fn();
    const session = await startLocalDictation({ environment: test.environment, onTranscript: transcript, onState: state });
    const recognition = test.active();
    expect(recognition).toMatchObject({ processLocally: true, quality: 'dictation', lang: 'en-US', continuous: true, interimResults: true });
    expect(recognition.start).toHaveBeenCalledOnce(); expect(state).toHaveBeenCalledWith(expect.objectContaining({ state: 'listening' }));
    result(recognition, [{ text: 'Fictional completed detail.', final: true }, { text: 'unfinished', final: false }]);
    expect(transcript).toHaveBeenLastCalledWith({ finalText: 'Fictional completed detail.', interimText: 'unfinished' });
    result(recognition, [{ text: 'Fictional completed detail.', final: true }, { text: 'second completed detail.', final: true }]);
    expect(transcript).toHaveBeenLastCalledWith({ finalText: 'Fictional completed detail. second completed detail.', interimText: '' });
    result(recognition, [{ text: 'attempt to change a final result', final: true }]);
    expect(transcript).toHaveBeenLastCalledWith({ finalText: 'Fictional completed detail. second completed detail.', interimText: '' });
    session.dispose(); expect(recognition.abort).toHaveBeenCalledOnce();
  });
  it('allows stop to receive the last final result, then releases the engine and invalidates late events', async () => {
    const test = engine(), transcript = vi.fn(), state = vi.fn();
    const session = await startLocalDictation({ environment: test.environment, onTranscript: transcript, onState: state });
    const recognition = test.active(), late = recognition.onresult;
    session.stop(); expect(recognition.stop).toHaveBeenCalledOnce();
    result(recognition, [{ text: 'Final after explicit stop.', final: true }]); recognition.onend?.();
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'stopped' })); expect(transcript).toHaveBeenLastCalledWith({ finalText: 'Final after explicit stop.', interimText: '' });
    const count = transcript.mock.calls.length;
    late?.({ resultIndex: 0, results: { length: 0 } });
    expect(transcript).toHaveBeenCalledTimes(count); expect(recognition.onresult).toBeNull(); expect(recognition.abort).toHaveBeenCalledOnce();
  });
  it.each(['not-allowed', 'audio-capture', 'no-speech', 'language-not-supported', 'network'])('handles %s with fallback and never invents a final transcript', async error => {
    const test = engine(), transcript = vi.fn(), state = vi.fn();
    const session = await startLocalDictation({ environment: test.environment, onTranscript: transcript, onState: state });
    const recognition = test.active(); recognition.onerror?.({ error });
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error', message: expect.stringContaining('Type or paste') }));
    expect(transcript).toHaveBeenLastCalledWith({ finalText: '', interimText: '' }); expect(recognition.abort).toHaveBeenCalledOnce();
    session.cancel(); session.dispose(); expect(recognition.abort).toHaveBeenCalledOnce();
  });
  it.each(['signal', 'pagehide', 'navigation', 'hidden', 'cancel', 'dispose'])('tears down for %s and ignores subsequent callbacks', async action => {
    const test = engine(), controller = new AbortController(), transcript = vi.fn(), state = vi.fn();
    const session = await startLocalDictation({ environment: test.environment, signal: controller.signal, onTranscript: transcript, onState: state });
    const recognition = test.active(), late = recognition.onresult;
    if (action === 'signal') controller.abort();
    if (action === 'pagehide') test.lifecycle.dispatchEvent(new Event('pagehide'));
    if (action === 'navigation') test.lifecycle.dispatchEvent(new Event('beforeunload'));
    if (action === 'hidden') { test.document.visibilityState = 'hidden'; test.document.dispatchEvent(new Event('visibilitychange')); }
    if (action === 'cancel') session.cancel(); if (action === 'dispose') session.dispose();
    expect(recognition.abort).toHaveBeenCalledOnce(); expect(recognition.onresult).toBeNull();
    const count = transcript.mock.calls.length; late?.({ resultIndex: 0, results: { length: 0 } });
    expect(transcript).toHaveBeenCalledTimes(count);
    if (action === 'dispose') expect(state).toHaveBeenCalledTimes(1);
  });
  it('cancels an in-flight availability probe before it can start a microphone', async () => {
    const test = engine(), controller = new AbortController();
    test.Constructor.available.mockImplementationOnce(() => new Promise(() => {}));
    const pending = startLocalDictation({ environment: test.environment, signal: controller.signal, onTranscript: vi.fn(), onState: vi.fn() });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'DICTATION_CANCELLED' }); controller.abort(); await assertion;
    expect(test.active().start).not.toHaveBeenCalled();
  });
  it('does not start when the page became hidden during the installed-pack check', async () => {
    const test = engine(); let finish!: (status: string) => void;
    test.Constructor.available.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const pending = startLocalDictation({ environment: test.environment, onTranscript: vi.fn(), onState: vi.fn() });
    test.document.visibilityState = 'hidden'; finish('available');
    await expect(pending).rejects.toMatchObject({ code: 'DICTATION_CANCELLED' });
    expect(test.active().start).not.toHaveBeenCalled();
  });
  it('stops after 60 seconds and aborts after a bounded missing end event', async () => {
    vi.useFakeTimers();
    const test = engine(), state = vi.fn();
    await startLocalDictation({ environment: test.environment, onTranscript: vi.fn(), onState: state });
    await vi.advanceTimersByTimeAsync(60_000); expect(test.active().stop).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000); expect(test.active().abort).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'stopped' })); expect(vi.getTimerCount()).toBe(0);
  });
  it('fails visibly at the transcript limit without truncating retained completed text', async () => {
    const test = engine(), state = vi.fn(), transcripts: DictationTranscript[] = [];
    await startLocalDictation({ environment: test.environment, onTranscript: text => transcripts.push(text), onState: state });
    result(test.active(), [{ text: 'Existing completed fictional text.', final: true }]);
    result(test.active(), [{ text: 'Existing completed fictional text.', final: true }, { text: 'x'.repeat(10_000), final: true }]);
    expect(state).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'error' }));
    expect(transcripts.at(-1)?.finalText).toBe('Existing completed fictional text.');
    expect(test.active().abort).toHaveBeenCalledOnce();
  });
});

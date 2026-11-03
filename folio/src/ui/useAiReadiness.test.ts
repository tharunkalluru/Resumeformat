// @vitest-environment jsdom
// Real hook and status parser; every transport call is a controlled local stub.
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiReadiness } from './useAiReadiness';
import type { AiStatus } from '../tailoring/ai';

type PendingRequest = { signal: AbortSignal; resolve: (response: Response) => void; reject: (reason: Error) => void };
let host: HTMLDivElement, root: Root | null, latest: ReturnType<typeof useAiReadiness>;
let requests: PendingRequest[], observed: string[], transport: ReturnType<typeof vi.fn<typeof fetch>>;
const enabled: AiStatus = { keyConfigured: true, modelConfigured: true, supportedModel: true, paidRequestsEnabled: true, accountModelVerified: true, busy: false, verification: 'verified' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
function Harness({ active }: { active: boolean }) {
  latest = useAiReadiness(active);
  observed.push(latest.service.state);
  return createElement('p', { role: 'status' }, `${latest.service.state}: ${latest.service.message}`);
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests = []; observed = [];
  transport = vi.fn<typeof fetch>((url, options) => {
    // Any verification, inference, provider URL or transmitted body fails here.
    expect(url).toBe('/api/ai/status');
    expect(options?.method).toBe('GET');
    expect(options).not.toHaveProperty('body');
    expect(options).toMatchObject({ credentials: 'same-origin', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json' } });
    expect(Object.keys(options!.headers!)).toEqual(['Accept']);
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    return new Promise<Response>((resolve, reject) => requests.push({ signal: options!.signal!, resolve, reject }));
  });
  vi.stubGlobal('fetch', transport);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = null; host.remove(); vi.unstubAllGlobals(); });
async function mount(active: boolean) { await act(async () => root!.render(createElement(Harness, { active }))); }
async function answer(index: number, status: unknown) {
  await act(async () => { requests[index].resolve(json(status)); await new Promise(resolve => setTimeout(resolve, 0)); });
}
async function reject(index: number) {
  await act(async () => { requests[index].reject(new TypeError('Controlled network outage')); await new Promise(resolve => setTimeout(resolve, 0)); });
}

describe('local AI readiness status hook', () => {
  it('does not contact the service until active or explicitly checked, and only makes a bodyless status GET', async () => {
    await mount(false);
    expect(latest.service.state).toBe('unchecked');
    expect(transport).not.toHaveBeenCalled();
    await act(async () => { void latest.check(); });
    expect(transport).toHaveBeenCalledOnce();
    expect(latest.service.state).toBe('checking');
    await answer(0, enabled);
    expect(latest.service.state).toBe('ready');
    expect(latest.service.message).toContain('paid external transfer');
    expect(transport).toHaveBeenCalledOnce();
  });

  it.each([
    ['paid requests disabled', { ...enabled, paidRequestsEnabled: false }, 'Paid AI requests are disabled'],
    ['account unverified', { ...enabled, accountModelVerified: false, verification: 'unverified' }, 'Verify account access'],
    ['service busy', { ...enabled, busy: true }, 'already running'],
  ])('keeps %s blocked without trying to repair configuration or verify access', async (_name, status, message) => {
    await mount(true);
    expect(latest.service.state).toBe('checking');
    await answer(0, status);
    expect(latest.service.state).toBe('blocked');
    expect(latest.service.message).toContain(message);
    expect(transport).toHaveBeenCalledOnce();
  });

  it('aborts superseded requests and ignores out-of-order success, failure and finalization', async () => {
    await mount(true);
    await act(async () => { void latest.check(); });
    expect(requests[0].signal.aborted).toBe(true);
    expect(requests[1].signal.aborted).toBe(false);
    await answer(0, enabled); // A transport may finish even after cancellation.
    expect(latest.service.state).toBe('checking');
    await act(async () => { void latest.check(); });
    // The first request's finally must not have cleared the second owner.
    expect(requests[1].signal.aborted).toBe(true);
    expect(requests[2].signal.aborted).toBe(false);
    await answer(2, { ...enabled, paidRequestsEnabled: false });
    expect(latest.service.state).toBe('blocked');
    await reject(1);
    expect(latest.service.state).toBe('blocked');
    expect(observed).not.toContain('ready');
    expect(transport).toHaveBeenCalledTimes(3);
  });

  it('cancels on deactivation and gives a new activation its own request', async () => {
    await mount(true);
    await mount(false);
    expect(requests[0].signal.aborted).toBe(true);
    await answer(0, enabled);
    expect(observed).not.toContain('ready');
    await mount(true);
    expect(requests).toHaveLength(2);
    await answer(1, { ...enabled, paidRequestsEnabled: false });
    expect(latest.service.state).toBe('blocked');
  });

  it('aborts on unmount and ignores a later transport completion', async () => {
    await mount(true);
    await act(async () => root!.unmount()); root = null;
    expect(requests[0].signal.aborted).toBe(true);
    const before = [...observed];
    await answer(0, enabled);
    expect(observed).toEqual(before);
    expect(observed).not.toContain('ready');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('fails closed when the server is unavailable and does not retry automatically', async () => {
    await mount(true);
    await reject(0);
    expect(latest.service.state).toBe('unavailable');
    expect(latest.service.message).toContain('local AI server is unavailable');
    expect(observed).not.toContain('ready');
    expect(transport).toHaveBeenCalledOnce();
  });

  it('fails closed on malformed status rather than trusting a ready-looking response', async () => {
    await mount(true);
    await answer(0, { ...enabled, accountModelVerified: true, verification: 'unverified', providerKey: 'untrusted-response-value' });
    expect(latest.service.state).toBe('unavailable');
    expect(observed).not.toContain('ready');
    expect(host.textContent).not.toContain('untrusted-response-value');
    expect(transport).toHaveBeenCalledOnce();
  });
});

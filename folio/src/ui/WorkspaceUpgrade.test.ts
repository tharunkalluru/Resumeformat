// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { AllTailorings, HomeWorkspace, JobComposer } from './DesignChrome';
import { approvedControlProject } from './integrationControlFixture';
import { createApplication } from '../core/applications';
import type { Project } from '../core/model';

vi.hoisted(() => { vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor); });
let root: Root, host: HTMLDivElement, resume: Project;
beforeEach(async () => {
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor);
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network allowed in workspace controls'); }));
  resume = await approvedControlProject(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
const noop = () => {};
async function renderComposer(props: Partial<Parameters<typeof JobComposer>[0]> = {}) {
  const onTailor = vi.fn(), onOpenDraft = vi.fn(), onCheckService = vi.fn();
  await act(async () => root.render(createElement(JobComposer, { resume, value: 'Design accessible React interfaces.', consent: true, busy: '', error: '', onChange: noop, onConsent: noop, onTailor, onLayout: noop, onUpload: noop, onOpenDraft, onCheckService, ...props })));
  return { onTailor, onOpenDraft, onCheckService };
}
function button(text: string) { const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text); expect(found).toBeTruthy(); return found!; }

describe('Workspace actions respect real readiness', () => {
  it('keeps AI disabled for unchecked status while allowing local evidence and manual editing', async () => {
    const callbacks = await renderComposer();
    expect(button('Tailor resume').disabled).toBe(true);
    expect(host.textContent).toContain('Local word matching');
    await act(async () => button('Open draft editor').click());
    expect(callbacks.onOpenDraft).toHaveBeenCalledOnce(); expect(fetch).not.toHaveBeenCalled();
  });
  it('exposes the exact blocked service reason and a non-inference status action', async () => {
    const callbacks = await renderComposer({ service: { state: 'blocked', message: 'Paid AI requests are disabled.' } });
    expect(host.textContent).toContain('Paid AI requests are disabled.');
    await act(async () => button('Check service').click());
    expect(callbacks.onCheckService).toHaveBeenCalledOnce(); expect(callbacks.onTailor).not.toHaveBeenCalled();
  });
  it('requires both service readiness and exact transfer consent', async () => {
    await renderComposer({ service: { state: 'ready', message: 'Available' }, consent: false });
    expect(button('Tailor resume').disabled).toBe(true);
    const callbacks = await renderComposer({ service: { state: 'ready', message: 'Available' }, consent: true });
    await act(async () => button('Tailor resume').click()); expect(callbacks.onTailor).toHaveBeenCalledOnce();
  });
  it('blocks a job link even when AI is ready and consented', async () => {
    const callbacks = await renderComposer({ service: { state: 'ready', message: 'Available' }, value: 'https://example.com/jobs/1' });
    expect(button('Tailor resume').disabled).toBe(true); expect(host.textContent).toContain('Job links are saved as text');
    const input = host.querySelector('textarea')!;
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })));
    expect(callbacks.onTailor).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('renders supplied role and company values without inferring employment facts', async () => {
    await renderComposer({ jobDetails: { title: 'Design Lead', company: 'Cedar' }, onJobDetailsChange: noop });
    const inputs = [...host.querySelectorAll<HTMLInputElement>('input:not([type=checkbox])')];
    expect(inputs.map(input => input.value)).toEqual(['Design Lead', 'Cedar']);
  });
  it('allows Enter to create a new line in Home and uses the explicit continue action', async () => {
    const onContinue = vi.fn();
    await act(async () => root.render(createElement(HomeWorkspace, { profile: null, projects: [resume], resume, value: 'Line one', busy: false, onChange: noop, onContinue, onOpen: noop, onHistory: noop, onLayout: noop, onContext: noop, onMemory: noop, onUpload: noop })));
    const input = host.querySelector('textarea')!;
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => input.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false); expect(onContinue).not.toHaveBeenCalled();
    await act(async () => button('Continue').click()); expect(onContinue).toHaveBeenCalledOnce();
  });
  it('shows pinned application identity and distinguishes unknown download history', async () => {
    const project = await createApplication(resume, { title: 'Designer', company: 'Cedar', description: 'Design interfaces' });
    await act(async () => root.render(createElement(AllTailorings, { projects: [project], failedIds: [], onOpen: noop, onDelete: noop, onRename: noop, onNew: noop, onRetry: noop })));
    expect(host.textContent).toContain(project.source.sha256);
    expect(host.textContent).toContain(`v${project.template.revision} / r${project.draft.revision}`);
    expect(host.textContent).toContain('Earlier download history is unavailable');
    expect(host.textContent).not.toContain('Ready');
  });
});

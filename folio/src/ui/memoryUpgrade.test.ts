// @vitest-environment jsdom
// Authored evidence and actual UI components; no provider or private records.
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureProject } from '../core/testFixture';
import { addAssertion, addTextSource, initCareerMemory, memoryView, setMemoryDraft, sourceProvenance } from '../core/careerMemory';
import type { Project } from '../core/model';
import { CareerMemoryEditor, type CareerMemoryEditorProps } from './CareerMemoryEditor';
import { MemorySaveIndicator, ContextCapture } from './OnboardingContext';
import { PrivacySettings, type PrivacySettingsProps } from './PrivacySettings';

vi.hoisted(() => { vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor); });
let host: HTMLDivElement, root: Root, project: Project, props: CareerMemoryEditorProps;
beforeEach(async () => {
  vi.stubGlobal('Uint8Array', new TextEncoder().encode('').constructor);
  vi.stubGlobal('crypto', webcrypto); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('External requests are not allowed in these controls'); }));
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  project = initCareerMemory(await fixtureProject());
  project = setMemoryDraft(project, 'Unfinished detail about my release work.', project.careerMemory!.revision);
  const added = await addTextSource(project, 'Built React dashboards using TypeScript. Original context: Cedar release.', 'typed', project.careerMemory!.revision);
  project = await addAssertion(added.project, 'Built React dashboards using TypeScript.', await sourceProvenance(added.project, added.source.id, added.source.segments[0].id), added.project.careerMemory!.revision);
  props = {
    memory: project.careerMemory!, view: memoryView(project), resumeName: 'Authored Resume', resumeSourceName: 'Authored.pdf', saveState: 'saved',
    groups: [{ id: 'role-1', category: 'roles', title: 'Engineer | Cedar Systems', dates: '2021–2024', factIds: [project.facts[0].id], metadataFactIds: [] }],
    onDraftChange: vi.fn(), onAddFiles: vi.fn(async () => {}), onAddTextSource: vi.fn(async () => {}), onLinkedInReferenceChange: vi.fn(), onReviewSource: vi.fn(),
    onAssertionDraftChange: vi.fn(), onDiscardAssertionDraft: vi.fn(), onEditAssertion: vi.fn(async () => {}), onConfirmAssertion: vi.fn(async () => {}), onSetAssertionFuture: vi.fn(async () => {}), onCorrectResumeFact: vi.fn(async () => {}), onSetResumeFactFuture: vi.fn(async () => {}), onRequestDeleteGroup: vi.fn(), onClose: vi.fn(),
  };
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function flush(action?: () => void) { await act(async () => { action?.(); await new Promise<void>(resolve => setTimeout(resolve, 0)); }); }
function button(text: string) {
  const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent?.trim() === text || item.getAttribute('aria-label') === text);
  expect(match, text).toBeTruthy(); return match!;
}
async function type(input: HTMLInputElement, text: string) {
  await flush(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

describe('Career Memory discovery interactions', () => {
  it('searches outside the active role category, distinguishes pending facts and leaves confirmation untouched', async () => {
    await flush(() => root.render(createElement(CareerMemoryEditor, props)));
    expect(host.textContent).toContain('Career Memory saved in this browser');
    await flush(() => button('Search all Memory').click());
    await type(host.querySelector<HTMLInputElement>('input[type=search]')!, 'original context cedar');
    expect(host.querySelectorAll('.memory-discovery-result')).toHaveLength(1);
    expect(host.querySelector('.memory-discovery-result')?.textContent).toContain('Needs your confirmation');
    await flush(() => host.querySelector<HTMLButtonElement>('.memory-discovery-result')!.click());
    expect(button('Confirm this version').disabled).toBe(true);
    expect(props.onConfirmAssertion).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('filters future-eligible evidence without granting eligibility to matching unconfirmed wording', async () => {
    await flush(() => root.render(createElement(CareerMemoryEditor, props)));
    await flush(() => button('Search all Memory').click());
    const select = host.querySelector<HTMLSelectElement>('.memory-discovery-filter select')!;
    await flush(() => { select.value = 'available'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(host.querySelectorAll('.memory-discovery-result')).toHaveLength(1);
    expect(host.querySelector('.memory-discovery-result')?.textContent).toContain('Resume source');
    await flush(() => button('Clear search and filters').click());
    expect(host.querySelector('.memory-role-grid')).toBeTruthy();
  });
  it('compares repeated passages with their sources and never merges, excludes or confirms them', async () => {
    props.view = { ...props.view, assertions: props.view.assertions.map(row => ({ ...row, draftText: 'A revised but still unconfirmed draft.' })) };
    await flush(() => root.render(createElement(CareerMemoryEditor, props)));
    await flush(() => button('Review').click());
    const duplicate = host.querySelector<HTMLDetailsElement>('.memory-duplicate-group')!;
    expect(duplicate.textContent).toContain('Same wording');
    expect(duplicate.querySelectorAll('.memory-discovery-result')).toHaveLength(2);
    expect(duplicate.textContent).toContain('Engineer | Cedar Systems');
    expect(duplicate.textContent).toContain('Applicant-entered context');
    expect(duplicate.textContent).toContain('This match compares saved wording');
    expect(duplicate.textContent).not.toContain('A revised but still unconfirmed draft.');
    expect(props.onSetAssertionFuture).not.toHaveBeenCalled();
    expect(props.onSetResumeFactFuture).not.toHaveBeenCalled();
    expect(props.onConfirmAssertion).not.toHaveBeenCalled();
  });
  it('opens an explicit role question without replacing or confirming the existing draft', async () => {
    await flush(() => root.render(createElement(CareerMemoryEditor, props)));
    await flush(() => host.querySelector<HTMLButtonElement>('.memory-context-question')!.click());
    expect(host.querySelector('.memory-question-prompt')?.textContent).toContain('Engineer | Cedar Systems');
    await flush(() => button('Or write a career detail').click());
    expect(host.querySelector<HTMLTextAreaElement>('textarea')!.value).toBe(project.careerMemory!.draftText);
    expect(props.onDraftChange).not.toHaveBeenCalled(); expect(props.onAddTextSource).not.toHaveBeenCalled();
  });
  it('preserves pending import rows and makes the source-review-confirm stages explicit', async () => {
    const onRemovePendingFile = vi.fn();
    await flush(() => root.render(createElement(ContextCapture, { ...props, method: 'linkedin', pendingFiles: [{ id: 'pending-a', name: 'Authored.pdf', format: 'pdf', state: 'reading' }], onRemovePendingFile })));
    expect(host.querySelector('.memory-capture-steps')?.textContent).toContain('Confirm each detail');
    expect(host.textContent).toContain('Reading');
    await flush(() => button('Remove failed or pending file Authored.pdf').click());
    expect(onRemovePendingFile).toHaveBeenCalledWith('pending-a');
    expect(props.onConfirmAssertion).not.toHaveBeenCalled();
  });
});

describe('Local persistence controls', () => {
  it('serializes retry attempts and reports a failed save without claiming it was saved', async () => {
    let reject!: (reason: Error) => void;
    const onRetry = vi.fn(() => new Promise<void>((_, no) => { reject = no; }));
    await flush(() => root.render(createElement(MemorySaveIndicator, { state: 'error', onRetry })));
    await flush(() => { button('Retry saving').click(); button('Retry saving').click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(button('Retrying save…').disabled).toBe(true);
    await flush(() => reject(new Error('Storage is full')));
    expect(host.textContent).toContain('Storage is full');
    expect(host.textContent).not.toContain('saved in this browser');
    expect(button('Retry saving').disabled).toBe(false);
  });
  it('opens the existing restore callback, preserves its error and explains archive scope', async () => {
    const onRestoreBackup = vi.fn(async () => { throw new Error('Save the current draft first'); });
    const settings: PrivacySettingsProps = { onClose: vi.fn(), sources: [], backup: { title: 'Selected resume group', description: 'Includes its saved applications.' }, deletion: { title: 'Selected group', description: 'Review scope first.' }, modelConsent: { available: false, granted: false, detail: 'No request prepared.' }, storage: { status: 'saved', detail: 'Local record saved.' }, onRestoreBackup };
    await flush(() => root.render(createElement(PrivacySettings, settings)));
    await flush(() => button('Restore a backup').click());
    expect(onRestoreBackup).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain('Save the current draft first');
    expect(host.textContent).toContain('A project backup contains only the selected project');
    expect(host.textContent).toContain('does not overwrite your current group');
    expect(fetch).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '../core/model';
import { WorkspaceInsights } from './DesignChrome';

let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function authoredProject(): Project {
  return { id: 'authored-review', workspace: { kind: 'application', templateGroupId: 'authored-group' },
    baseline: { revision: 1, blocks: ['one', 'two', 'three'].map(id => ({ id, runs: [{ text: `Original ${id}` }], sourceFactIds: [] })) },
    draft: { revision: 2, blocks: ['one', 'two', 'three'].map(id => ({ id, runs: [{ text: `Current ${id}` }], sourceFactIds: id === 'three' ? [] : [`fact-${id}`] })) },
    template: { revision: 1, pages: [], warnings: [] }, source: { name: 'Authored.pdf' },
    facts: ['one', 'two'].map(id => ({ id: `fact-${id}`, text: `Current ${id}`, kind: 'careerNote', confirmed: true, locator: `Authored note ${id}` })),
    job: { title: 'Community coordinator', company: 'Fictional Company', description: '' },
  } as unknown as Project;
}
function props(project = authoredProject()) { return { project, tab: 'changes' as const, onTabChange: vi.fn(), onClose: vi.fn(), onNewFromJob: vi.fn(), onPrivateNotes: vi.fn(), onRevert: vi.fn(), onAccept: vi.fn(), onRestoreVersion: vi.fn(), onCompareVersion: vi.fn(), onAddEvidence: vi.fn(), onDecideMany: vi.fn(), onSelectBlock: vi.fn() }; }
function button(label: string) { return [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!; }

it('sends supported accept and all revert as one batch each, without per-item mutation loops', async () => {
  const input = props();
  await act(async () => root.render(createElement(WorkspaceInsights, input)));
  await act(async () => button('Accept 2 source-supported changes').click());
  expect(input.onDecideMany).toHaveBeenCalledExactlyOnceWith(['one', 'two'], 'accepted');
  expect(input.onAccept).not.toHaveBeenCalled();
  await act(async () => button('Revert all changes').click());
  expect(input.onDecideMany.mock.calls[1]).toEqual([['one', 'two', 'three'], 'rejected']);
  expect(input.onRevert).not.toHaveBeenCalled();
});

it('tracks canvas selection and shows missing-source wording without an accept control', async () => {
  const input = props();
  await act(async () => root.render(createElement(WorkspaceInsights, { ...input, selectedBlockId: 'three' })));
  expect(host.querySelector('.folio-change .folio-after')?.textContent).toBe('Current three');
  expect(host.textContent).toContain('No saved source is linked to this wording');
  expect(button('Accept change')).toBeUndefined();
  await act(async () => button('Locate on page').click());
  expect(input.onSelectBlock).toHaveBeenCalledWith('three');
  await act(async () => root.render(createElement(WorkspaceInsights, { ...input, selectedBlockId: 'one' })));
  expect(host.querySelector('.folio-change .folio-after')?.textContent).toBe('Current one');
  expect(host.textContent).toContain('Confirmed by you · exact current wording');
});

it('derives reviewed totals from actual saved presentation, not an optimistic batch click', async () => {
  const input = props();
  await act(async () => root.render(createElement(WorkspaceInsights, input)));
  await act(async () => button('Accept 2 source-supported changes').click());
  expect(host.textContent).not.toContain('2 changes marked reviewed');
  const next = { ...input.project, folio: { changes: { one: 'accepted' }, versions: [], held: [] } } as unknown as Project;
  await act(async () => root.render(createElement(WorkspaceInsights, { ...input, project: next })));
  expect(host.textContent).toContain('1 change marked reviewed. Final claim confirmation is a separate step.');
});

it('disables content decisions while another operation is in progress', async () => {
  const input = props();
  await act(async () => root.render(createElement(WorkspaceInsights, { ...input, busy: true })));
  for (const label of ['Accept 2 source-supported changes', 'Revert all changes', 'Accept change', 'Restore original']) expect(button(label).disabled).toBe(true);
});

it('does not label currently unsupported wording reviewed because an older decision was accepted', async () => {
  const input = props();
  input.project = { ...input.project, folio: { changes: { three: 'accepted' }, versions: [], held: [] } } as unknown as Project;
  await act(async () => root.render(createElement(WorkspaceInsights, { ...input, selectedBlockId: 'three' })));
  expect(host.querySelector('.kit-review-progress small')?.textContent).toBe('0 reviewed');
  expect(host.querySelectorAll('.kit-all-changes .accepted')).toHaveLength(0);
  expect(host.textContent).not.toContain('change marked reviewed');
  expect(host.querySelector('.kit-change-overline .kit-badge')?.textContent).toBe('To review');
});

it('limits the single-character shortcut to focus inside a visible changes inspector', async () => {
  const input = props();
  await act(async () => root.render(createElement(WorkspaceInsights, input)));
  const section = host.querySelector<HTMLElement>('.folio-insights')!;
  const visible = vi.spyOn(section, 'getClientRects').mockReturnValue([{ width: 320, height: 500 }] as unknown as DOMRectList);
  await act(async () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
  expect(input.onSelectBlock).not.toHaveBeenCalled();
  await act(async () => button('Locate on page').dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
  expect(input.onSelectBlock).toHaveBeenCalledExactlyOnceWith('two');
  input.onSelectBlock.mockClear();
  visible.mockReturnValue([] as unknown as DOMRectList);
  await act(async () => button('Locate on page').dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true })));
  expect(input.onSelectBlock).not.toHaveBeenCalled();
  visible.mockRestore();
});

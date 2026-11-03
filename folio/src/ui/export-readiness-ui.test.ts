// @vitest-environment jsdom
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Project } from '../core/model';
import { ExportReadiness } from './ExportReadiness';
import type { ExportReadinessState } from './readinessModel';

let host: HTMLDivElement, root: Root;
const project = { id: 'authored', draft: { revision: 1, blocks: [] }, template: { pages: [{ id: 'page-1', width: 612, height: 792, regions: [] }], warnings: [] } } as unknown as Project;
const state: ExportReadinessState = { approved: true, currentSaved: true, saveStatus: 'saved', composition: false, renderStatus: 'ready', renderCurrent: true, canvasCheckCurrent: true, overflows: [], layoutIssueRegionIds: [], unprovedBlockIds: [], pdfInspected: true, claimsConfirmed: true, exportReady: true, exportProblems: [] };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
function button(label: string) { return [...host.querySelectorAll('button')].find(item => item.textContent?.trim() === label)!; }

it('blocks download if canonical ready is false even when every displayed milestone is complete', async () => {
  const onAction = vi.fn();
  await act(async () => root.render(createElement(ExportReadiness, { project, state: { ...state, exportReady: false }, onAction })));
  expect(button('Download PDF').disabled).toBe(true);
  await act(async () => button('Download PDF').click());
  expect(onAction).not.toHaveBeenCalled();
  expect(host.textContent).toContain('The current export is not ready');
  await act(async () => button('Review document').click());
  expect(onAction).toHaveBeenCalledWith({ kind: 'canvas' });
});

it('dispatches exact region navigation for a current overflow', async () => {
  const onAction = vi.fn();
  await act(async () => root.render(createElement(ExportReadiness, { project, state: { ...state, exportReady: false, overflows: [{ pageId: 'page-1', regionId: 'authored-region', code: 'height', message: 'Paragraph exceeds its frame.' }] }, onAction })));
  await act(async () => button('Go to paragraph').click());
  expect(onAction).toHaveBeenCalledWith({ kind: 'region', pageId: 'page-1', regionId: 'authored-region' });
});

it('invalidates the download control immediately when a new PDF needs inspection', async () => {
  const onAction = vi.fn();
  await act(async () => root.render(createElement(ExportReadiness, { project, state, onAction })));
  expect(button('Download PDF').disabled).toBe(false);
  await act(async () => root.render(createElement(ExportReadiness, { project, state: { ...state, exportReady: false, pdfInspected: false }, onAction })));
  expect(button('Download PDF').disabled).toBe(true);
  await act(async () => button('Review current PDF').click());
  expect(onAction).toHaveBeenCalledWith({ kind: 'pdf' });
});

it('respects busy state without hiding the reason a download is unavailable', async () => {
  const onAction = vi.fn();
  await act(async () => root.render(createElement(ExportReadiness, { project, state: { ...state, currentSaved: false, exportReady: false, saveStatus: 'error' }, busy: true, onAction })));
  expect(button('Retry saving').disabled).toBe(true);
  expect(host.textContent).toContain('This draft has not saved');
  await act(async () => button('Retry saving').click());
  expect(onAction).not.toHaveBeenCalled();
});

import { describe, expect, it } from 'vitest';
import { MAX_SOURCE_PAGES } from '../core/model';
import { previewOwnerCurrent, previewOwnerKey, previewReviewComplete, recordPreviewPage, type PreviewReceipt, type PreviewReview, type PreviewStamp } from './previewReview';

const stamp = (): PreviewStamp => ({ purpose: 'draft', projectId: 'fictional-project', sourceSha256: 'fictional-source',
  templateRevision: 3, contentRevision: 5, bytes: new Uint8Array([1, 2, 3]), scale: 1.5 });
const receipt = (s: PreviewStamp, page: number, state: PreviewReceipt['state'] = 'ready'): PreviewReceipt =>
  ({ ownerKey: previewOwnerKey(s), bytes: s.bytes, page, scale: s.scale, state });
const complete = (s: PreviewStamp): PreviewReview => recordPreviewPage(
  recordPreviewPage(null, s, s, receipt(s, 2), 2), s, s, receipt(s, 1), 2)!;

describe('actual painted PDF page review', () => {
  it.each([3, MAX_SOURCE_PAGES])('requires every distinct page of an already admitted %i-page document', count => {
    const s=stamp();let r:PreviewReview|null=null;
    for(let page=count;page>1;page--)r=recordPreviewPage(r,s,s,receipt(s,page),count);
    r=recordPreviewPage(r,s,s,receipt(s,count),count);expect(previewReviewComplete(r,s,s,count)).toBe(false);
    expect(recordPreviewPage(r,s,s,receipt(s,count+1),count)).toBe(r);
    r=recordPreviewPage(r,s,s,receipt(s,1),count);expect(previewReviewComplete(r,s,s,count)).toBe(true);expect(r?.readyPages).toHaveLength(count);
    r=recordPreviewPage(r,s,s,receipt(s,count,'error'),count);expect(previewReviewComplete(r,s,s,count)).toBe(false);
    const stale={...s,bytes:new Uint8Array(s.bytes)};expect(recordPreviewPage(r,s,s,receipt(stale,count),count)).toBe(r);
    r=recordPreviewPage(r,s,s,receipt(s,count,'loading'),count);expect(previewReviewComplete(r,s,s,count)).toBe(false);
    r=recordPreviewPage(r,s,s,receipt(s,count),count);expect(previewReviewComplete(r,s,s,count)).toBe(true);
  });

  it('requires both distinct pages, preserves reverse-order navigation, and refuses duplicate page one', () => {
    const s = stamp(); let r = recordPreviewPage(null, s, s, receipt(s, 1), 2);
    r = recordPreviewPage(r, s, s, receipt(s, 1), 2);
    expect(previewReviewComplete(r, s, s, 2)).toBe(false);
    expect(previewReviewComplete(complete(s), s, s, 2)).toBe(true);
    expect(complete(s).readyPages).toEqual([1, 2]);
  });
  it('invalidates the matching loading or failed page and requires a successful paint after retry', () => {
    const s = stamp(); let r: PreviewReview | null = complete(s);
    r = recordPreviewPage(r, s, s, receipt(s, 2, 'error'), 2);
    expect(r?.readyPages).toEqual([1]); expect(r?.failedPages).toEqual([2]);
    expect(previewReviewComplete(r, s, s, 2)).toBe(false);
    r = recordPreviewPage(r, s, s, receipt(s, 2, 'loading'), 2);
    expect(r?.failedPages).toEqual([]); expect(previewReviewComplete(r, s, s, 2)).toBe(false);
    r = recordPreviewPage(r, s, s, receipt(s, 2), 2);
    expect(previewReviewComplete(r, s, s, 2)).toBe(true);
  });
  it('rejects stale success and error without erasing a newer review, including byte-identical replacement buffers', () => {
    const s = stamp(), r = complete(s), old = { ...s, bytes: new Uint8Array(s.bytes) };
    for (const state of ['ready', 'loading', 'error'] as const) {
      expect(recordPreviewPage(r, s, s, receipt(old, 1, state), 2)).toBe(r);
    }
    expect(previewReviewComplete(r, old, old, 2)).toBe(false);
  });
  it('binds project, exact source, template, content revision and rendered scale independently', () => {
    const s = stamp(), r = complete(s);
    for (const changed of [{ ...s, projectId: 'other' }, { ...s, sourceSha256: 'other' },
      { ...s, templateRevision: 4 }, { ...s, contentRevision: 6 }]) {
      expect(previewReviewComplete(r, changed, changed, 2)).toBe(false);
      expect(recordPreviewPage(r, s, changed, receipt(s, 1), 2)).toBe(r);
    }
    const scaled = { ...s, scale: 2 };
    expect(previewReviewComplete(r, scaled, scaled, 2)).toBe(false);
    expect(recordPreviewPage(r, scaled, scaled, receipt(s, 1), 2)).toBe(r);
    expect(previewOwnerCurrent(s, null)).toBe(false);
  });
  it('does not turn wrong pages, invalid scale, empty bytes or absent stamps into review', () => {
    const s = stamp();
    for (const page of [0, 3, -1, 1.5, NaN]) expect(recordPreviewPage(null, s, s, receipt(s, page), 2)).toBeNull();
    for (const count of [0, MAX_SOURCE_PAGES+1, -1, 1.5, NaN, Infinity]) expect(recordPreviewPage(null, s, s, receipt(s, 1), count)).toBeNull();
    for (const scale of [0, 5, NaN, Infinity]) {
      const invalid = { ...s, scale }; expect(recordPreviewPage(null, invalid, invalid, receipt(invalid, 1), 2)).toBeNull();
    }
    const empty = { ...s, bytes: new Uint8Array() };
    expect(recordPreviewPage(null, empty, empty, receipt(empty, 1), 2)).toBeNull();
    expect(recordPreviewPage(null, null, s, receipt(s, 1), 2)).toBeNull();
  });
  it('separates single-page inspection from a two-page owner and clears old pages on a new stamp', () => {
    const s = stamp(), next = { ...s, contentRevision: 6 };
    const old = complete(s), r = recordPreviewPage(old, next, next, receipt(next, 1), 2);
    expect(r?.readyPages).toEqual([1]); expect(previewReviewComplete(r, next, next, 2)).toBe(false);
    const one = recordPreviewPage(null, next, next, receipt(next, 1), 1);
    expect(previewReviewComplete(one, next, next, 1)).toBe(true);
    expect(previewReviewComplete(one, next, next, 2)).toBe(false);
  });
  it('does not reassign an old request to a new owner sharing the exact same PDF byte object', () => {
    const old = stamp();
    for (const next of [{ ...old, projectId: 'other' }, { ...old, sourceSha256: 'other' },
      { ...old, templateRevision: 4 }, { ...old, contentRevision: 6 }, { ...old, purpose: 'baseline' as const }]) {
      expect(next.bytes).toBe(old.bytes);
      expect(recordPreviewPage(null, next, next, receipt(old, 1), 1)).toBeNull();
      expect(previewReviewComplete(recordPreviewPage(null, next, next, receipt(next, 1), 1), next, next, 1)).toBe(true);
    }
  });
});

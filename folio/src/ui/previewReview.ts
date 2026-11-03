import { MAX_SOURCE_PAGES } from '../core/model';

/** Runtime view receipts are deliberately separate from persisted approval. */
export interface PreviewOwner {
  purpose: 'source' | 'baseline' | 'draft';
  projectId: string;
  sourceSha256: string;
  templateRevision: number;
  contentRevision: number;
}
export interface PreviewStamp extends PreviewOwner {
  bytes: Uint8Array;
  scale: number;
}
export interface PreviewReceipt {
  ownerKey: string;
  bytes: Uint8Array;
  page: number;
  scale: number;
  state: 'loading' | 'ready' | 'error';
}
export interface PreviewReview extends PreviewStamp {
  pageCount: number;
  readyPages: number[];
  failedPages: number[];
}

export function previewOwnerCurrent(stamp: PreviewStamp | null, owner: PreviewOwner | null): boolean {
  return !!stamp && !!owner && stamp.purpose === owner.purpose && stamp.projectId === owner.projectId &&
    stamp.sourceSha256 === owner.sourceSha256 &&
    stamp.templateRevision === owner.templateRevision && stamp.contentRevision === owner.contentRevision;
}
export function previewOwnerKey(owner: PreviewOwner | null): string {
  return owner ? JSON.stringify([owner.purpose, owner.projectId, owner.sourceSha256,
    owner.templateRevision, owner.contentRevision]) : '';
}
const validPages = (count: number) => Number.isInteger(count) && count >= 1 && count <= MAX_SOURCE_PAGES;
const sameStamp = (review: PreviewReview | null, stamp: PreviewStamp) => !!review &&
  previewOwnerCurrent(review, stamp) && review.bytes === stamp.bytes && review.scale === stamp.scale;

/** A stale success or failure cannot grant or erase another render's review. */
export function recordPreviewPage(review: PreviewReview | null, stamp: PreviewStamp | null,
  owner: PreviewOwner | null, receipt: PreviewReceipt, pageCount: number): PreviewReview | null {
  if (!stamp || !previewOwnerCurrent(stamp, owner) || !validPages(pageCount) ||
      receipt.ownerKey !== previewOwnerKey(stamp) || receipt.bytes !== stamp.bytes || receipt.scale !== stamp.scale || !stamp.bytes.byteLength ||
      !Number.isFinite(receipt.scale) || receipt.scale <= 0 || receipt.scale > 4 ||
      !Number.isInteger(receipt.page) || receipt.page < 1 || receipt.page > pageCount ||
      !['loading', 'ready', 'error'].includes(receipt.state)) return review;
  const existing = sameStamp(review, stamp) && review!.pageCount === pageCount ? review : null;
  const ready = new Set(existing?.readyPages ?? []), failed = new Set(existing?.failedPages ?? []);
  ready.delete(receipt.page); failed.delete(receipt.page);
  if (receipt.state === 'ready') ready.add(receipt.page);
  if (receipt.state === 'error') failed.add(receipt.page);
  return { ...stamp, pageCount, readyPages: [...ready].sort(), failedPages: [...failed].sort() };
}

export function previewReviewComplete(review: PreviewReview | null, stamp: PreviewStamp | null,
  owner: PreviewOwner | null, pageCount: number): boolean {
  return !!stamp && previewOwnerCurrent(stamp, owner) && validPages(pageCount) &&
    sameStamp(review, stamp) && review!.pageCount === pageCount && review!.failedPages.length === 0 &&
    Array.from({ length: pageCount }, (_, index) => index + 1).every(page => review!.readyPages.includes(page));
}

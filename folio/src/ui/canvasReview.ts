import {sourceDocumentFingerprint, type Project, type RenderedDocument} from '../core/model';

export interface CanvasReview {
  projectId: string;
  draftRevision: number;
  templateRevision: number;
  render: RenderedDocument;
}

/** Confirmation can change evidence and PDF bytes without changing the draft
 * revision. A layout receipt belongs to the render that was actually measured. */
export function canvasReviewCurrent(review: CanvasReview | null, project: Project | null,
  render: RenderedDocument | null): boolean {
  return !!project && !!render && review?.render === render &&
    review.projectId === project.id && review.draftRevision === project.draft.revision &&
    review.templateRevision === project.template.revision &&
    render.contentRevision === project.draft.revision &&
    (!render.sourceFingerprint || render.sourceFingerprint ===
      sourceDocumentFingerprint(project.template, project.draft));
}

import {it, expect} from 'vitest';
import {canvasReviewCurrent, type CanvasReview} from './canvasReview';
import type {Project, RenderedDocument} from '../core/model';
import {sourceDocumentFingerprint} from '../core/model';

const project = {id:'resume',draft:{revision:2},template:{revision:1}} as Project;
const render = {contentRevision:2,bytes:new Uint8Array([1])} as RenderedDocument;
const receipt:CanvasReview = {projectId:'resume',draftRevision:2,templateRevision:1,render};
it('requires the exact measured PDF after a same-revision confirmation render', () => {
  expect(canvasReviewCurrent(receipt, project, render)).toBe(true);
  const confirmed = {...render,bytes:new Uint8Array([2])};
  expect(canvasReviewCurrent(receipt, project, confirmed)).toBe(false);
  expect(canvasReviewCurrent({...receipt,render:confirmed}, project, confirmed)).toBe(true);
});
it('rejects stale owners, revisions, missing renders and late old receipts', () => {
  for(const changed of [{...project,id:'other'}, {...project,draft:{revision:3}},
    {...project,template:{revision:2}}] as Project[]) {
    expect(canvasReviewCurrent(receipt, changed, render)).toBe(false);
  }
  expect(canvasReviewCurrent(receipt, project, null)).toBe(false);
  expect(canvasReviewCurrent(null, project, render)).toBe(false);
  expect(canvasReviewCurrent(receipt, project, {...render})).toBe(false);
  expect(canvasReviewCurrent({...receipt,render:{...render,contentRevision:1}},project,
    {...render,contentRevision:1})).toBe(false);
});
it('invalidates an unchanged render reference after same-revision evidence confirmation', () => {
  const p={...project,draft:{revision:2,blocks:[{id:'block',runs:[{text:'Existing claim',sourceFactIds:['resume-fact']}],sourceFactIds:['resume-fact']}]}};
  const measured={...render,sourceFingerprint:sourceDocumentFingerprint(p.template,p.draft)};
  const receipt={projectId:p.id,draftRevision:2,templateRevision:1,render:measured};
  expect(canvasReviewCurrent(receipt,p,measured)).toBe(true);
  const confirmed={...p,draft:{...p.draft,blocks:[{...p.draft.blocks[0],sourceFactIds:['confirmed-fact']}]}};
  expect(canvasReviewCurrent(receipt,confirmed,measured)).toBe(false);
});

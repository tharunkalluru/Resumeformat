import { describe, expect, it } from 'vitest';
import { addCareerNote, approveTemplate, confirmDraft, dismissEvidence, editBlock, insertEvidence, removeCareerNote, validateExport } from './commands';
import { blockText, RENDERER_VERSION } from './model';
import { fixtureProject } from './testFixture';
import type { RenderedDocument } from './model';

const rendered = (revision: number): RenderedDocument => ({ bytes: new Uint8Array(), contentRevision: revision, rendererVersion: RENDERER_VERSION, layout: { regions: [], overflows: [] } });
describe('review, provenance and export invariants', () => {
  it('dismisses an inserted fact by restoring exact prior manual text, marks and provenance', async () => {
    let project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    const id = project.draft.blocks[0].id, note = project.notes[0];
    project = confirmDraft(editBlock(project, id, [{ text: 'My reviewed manual wording.', bold: false, italic: true, underline: true, href: 'https://example.com/' }]));
    const before = structuredClone(project.draft.blocks[0]);
    const inserted = insertEvidence(project, note.id, id);
    expect(blockText(inserted.draft.blocks[0])).toBe(note.text);
    const dismissed = dismissEvidence(inserted, note.id);
    expect(dismissed.draft.blocks[0]).toEqual(before);
    expect(dismissed.evidenceDecisions[note.id].status).toBe('rejected');
    expect(dismissed.reviewedDraftRevision).toBeNull();
    expect(dismissed.draft.revision).toBeGreaterThan(inserted.draft.revision);
    expect(dismissed.source).toBe(project.source); expect(dismissed.baseline).toBe(project.baseline);
  });
  it('refuses dismissal after later manual edits and preserves both text and decision', async () => {
    const project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    const note = project.notes[0], id = project.draft.blocks[0].id;
    const edited = editBlock(insertEvidence(project, note.id, id), id, [{ text: 'Reviewed accessible interfaces and trained colleagues.' }]);
    const before = structuredClone(edited);
    expect(() => dismissEvidence(edited, note.id)).toThrow('Your later edits are preserved');
    expect(edited).toEqual(before);
  });
  it('restores stacked insertions in order without discarding the newer source', async () => {
    let project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    project = addCareerNote(project, 'Documented accessible interfaces.');
    const [a,b] = project.notes, id = project.draft.blocks[0].id;
    const first = insertEvidence(project, a.id, id), second = insertEvidence(first, b.id, id);
    expect(() => dismissEvidence(second, a.id)).toThrow('paragraph changed');
    expect(() => insertEvidence(second, a.id, id)).toThrow('earlier insertion');
    expect(second.evidenceDecisions[a.id].insertions?.[0].before).toEqual(project.draft.blocks[0]);
    const dismissedB = dismissEvidence(second, b.id);
    expect(blockText(dismissedB.draft.blocks[0])).toBe(a.text);
    expect(dismissEvidence(dismissedB, a.id).draft.blocks[0]).toEqual(project.draft.blocks[0]);
  });
  it('records every unchanged insertion of one fact and restores every affected paragraph', async () => {
    const project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    const first = project.draft.blocks[0], second = { ...structuredClone(first), id: 'second-content' };
    project.draft.blocks.push(second); project.baseline.blocks.push(structuredClone(second));
    const firstRegion = project.template.pages[0].regions[0];
    if (firstRegion.kind !== 'text') throw new Error('Missing text region');
    project.template.pages[0].regions.push({ ...structuredClone(firstRegion), id: 'second-region', contentId: second.id, order: 1, bounds: { ...firstRegion.bounds, y: 120 } });
    const note = project.notes[0];
    const inserted = insertEvidence(insertEvidence(project, note.id, first.id), note.id, second.id);
    expect(inserted.evidenceDecisions[note.id].insertions).toHaveLength(2);
    expect(insertEvidence(inserted, note.id, second.id)).toBe(inserted);
    expect(dismissEvidence(inserted, note.id).draft.blocks).toEqual(project.draft.blocks);
  });
  it('requires review rather than restoring a paragraph whose prior supporting fact was removed', async () => {
    let project = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    project = addCareerNote(project, 'Documented accessible interfaces.');
    const [a,b] = project.notes, id = project.draft.blocks[0].id;
    const newer = removeCareerNote(insertEvidence(insertEvidence(project, a.id, id), b.id, id), a.id);
    expect(() => dismissEvidence(newer, b.id)).toThrow('evidence that was removed');
    expect(blockText(newer.draft.blocks[0])).toBe(b.text);
  });
  it('requires visible font warnings to be acknowledged and blocks unsupported imports', async () => {
    const project = await fixtureProject();
    project.template.warnings = [{ id: 'font', code: 'FONT_SUBSTITUTED', severity: 'review', message: 'Font substituted.' }];
    await expect(approveTemplate(project, [])).rejects.toMatchObject({ code: 'REVIEW_WARNINGS' });
    expect((await approveTemplate(project, ['font'])).approval?.acknowledgedWarnings).toEqual(['font']);
    project.template.warnings.push({ id: 'photo', code: 'PHOTO_UNSUPPORTED', severity: 'blocking', message: 'Photo cannot be safely reconstructed.' });
    await expect(approveTemplate(project, ['font', 'photo'])).rejects.toMatchObject({ code: 'UNSUPPORTED_TEMPLATE' });
  });
  it('keeps original/baseline immutable and creates manual evidence only after applicant confirmation', async () => {
    let project = await fixtureProject();
    const original = blockText(project.baseline.blocks[0]);
    const factCount = project.facts.length;
    project = editBlock(project, project.draft.blocks[0].id, [{ text: 'Built React dashboards and documented their accessibility.' }]);
    expect(blockText(project.baseline.blocks[0])).toBe(original);
    expect(project.facts).toHaveLength(factCount);
    expect(project.reviewedDraftRevision).toBeNull();
    project = confirmDraft(project);
    expect(project.facts.at(-1)?.kind).toBe('applicantEdit');
    expect(project.facts.at(-1)?.confirmed).toBe(true);
    expect(project.reviewedDraftRevision).toBe(project.draft.revision);
  });
  it('keeps optional knowledge separate and exact evidence attributed', async () => {
    let project = await fixtureProject();
    project = addCareerNote(project, 'Created a TypeScript component library.');
    const note = project.notes[0];
    project = editBlock(project, project.draft.blocks[0].id, [{ text: note.text, sourceFactIds: [note.id] }]);
    project = confirmDraft(project);
    expect(project.draft.blocks[0].sourceFactIds).toEqual([note.id]);
    expect(project.facts.filter(fact => fact.kind === 'applicantEdit')).toHaveLength(0);
    expect(() => removeCareerNote(project, note.id)).toThrow('supports the current draft');
  });
  it('refuses stale preview, unresolved fit and mutated approved geometry', async () => {
    let project = await approveTemplate(await fixtureProject(), []);
    project = confirmDraft(project);
    await expect(validateExport(project, rendered(project.draft.revision))).resolves.toBeUndefined();
    await expect(validateExport(project, rendered(project.draft.revision - 1))).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
    const overflow = rendered(project.draft.revision);
    overflow.layout.overflows.push({ pageId: 'x', regionId: 'x', code: 'height', message: 'Text does not fit.' });
    await expect(validateExport(project, overflow)).rejects.toMatchObject({ code: 'EXPORT_NOT_READY' });
    project.template.pages[0].regions[0].bounds.width += 1;
    await expect(validateExport(project, rendered(project.draft.revision))).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  });
  it('preserves explicit removal of inherited bold and italic formatting', async () => {
    const project = await fixtureProject();
    const region = project.template.pages[0].regions.find(r => r.kind === 'text')!;
    if (region.kind !== 'text') throw new Error('Missing text');
    region.style.fontWeight = 700; region.style.italic = true;
    const edited = editBlock(project, region.contentId, [{ text: 'Plain truthful wording', bold: false, italic: false }]);
    expect(edited.draft.blocks.find(b => b.id === region.contentId)?.runs[0]).toMatchObject({ bold: false, italic: false });
  });
  it('removes dangerous pasted links instead of exporting actions', async () => {
    const project = await fixtureProject();
    const edited = editBlock(project, project.draft.blocks[0].id, [{ text: 'Contact', href: 'javascript:alert(1)' }]);
    expect(edited.draft.blocks[0].runs[0].href).toBeUndefined();
  });
});

describe('claim confirmation keeps completed checks (phase 1)', () => {
  it('keeps the same draft object when no paragraph needs new evidence', async () => {
    const project = await fixtureProject();
    const confirmed = confirmDraft(project);
    expect(confirmed.draft).toBe(project.draft);
    expect(confirmed.reviewedDraftRevision).toBe(project.draft.revision);
    expect(confirmed.revision).toBe(project.revision + 1);
  });
  it('still records applicant-confirmed evidence for edited paragraphs', async () => {
    let project = await fixtureProject();
    project = editBlock(project, project.draft.blocks[0].id, [{ text: 'A fictional reviewed sentence.', bold: false, italic: false, underline: false }]);
    const confirmed = confirmDraft(project);
    expect(confirmed.draft).not.toBe(project.draft);
    expect(confirmed.facts.some(fact => fact.kind === 'applicantEdit' && fact.text === 'A fictional reviewed sentence.')).toBe(true);
  });
});

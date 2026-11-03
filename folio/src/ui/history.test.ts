import { describe, expect, it } from 'vitest';
import { addCareerNote, confirmDraft, dismissEvidence, editBlock, insertEvidence } from '../core/commands';
import { completedTailoring, saveVersion } from '../core/folio';
import { createApplication } from '../core/applications';
import { approveTemplate } from '../core/commands';
import { blockText } from '../core/model';
import { fixtureProject } from '../core/testFixture';
import { DocumentHistory } from './history';

describe('one document history for editing and evidence review', () => {
  it('keeps actual completion and version records through content undo and redo',async()=>{
    const original=await createApplication(await approveTemplate(await fixtureProject(),[])),history=new DocumentHistory();history.push({project:original,decisions:{}});
    const edited=editBlock(original,original.draft.blocks[0].id,[{text:'Precise edited content.'}]),ready=saveVersion(completedTailoring(edited,'actual-receipt'),'download');
    const undone=history.undo({project:ready,decisions:{}})!;expect(undone.project.draft.blocks[0].runs).toEqual(original.draft.blocks[0].runs);expect(undone.project.folio?.completions).toEqual(ready.folio?.completions);expect(undone.project.folio?.versions).toEqual(ready.folio?.versions);
    const redone=history.redo(undone)!;expect(redone.project.folio?.versions).toEqual(ready.folio?.versions);expect(redone.project.draft.blocks[0].runs).toEqual(ready.draft.blocks[0].runs);
  });
  it('undoes and redoes dismissal with persistable insertion snapshots and attribution', async () => {
    const original = addCareerNote(await fixtureProject(), 'Reviewed accessible interfaces.');
    const note = original.notes[0], id = original.draft.blocks[0].id;
    const inserted = insertEvidence(original, note.id, id), history = new DocumentHistory();
    history.push({ project: inserted, decisions: inserted.evidenceDecisions });
    const dismissed = dismissEvidence(inserted, note.id);
    const undone = history.undo({ project: dismissed, decisions: dismissed.evidenceDecisions })!;
    expect(undone.project.draft.blocks[0].sourceFactIds).toEqual([note.id]);
    expect(undone.project.evidenceDecisions).toEqual(inserted.evidenceDecisions);
    expect(history.redo(undone)!.project.evidenceDecisions).toEqual(dismissed.evidenceDecisions);
  });
  it('groups adjacent typing and advances revisions through undo and redo', async () => {
    const original = await fixtureProject();
    const id = original.draft.blocks[0].id;
    const history = new DocumentHistory();
    history.push({ project: original, decisions: {} }, `typing:${id}`);
    const first = editBlock(original, id, [{ text: 'Accessible design' }]);
    history.push({ project: first, decisions: {} }, `typing:${id}`);
    const second = editBlock(first, id, [{ text: 'Accessible design systems' }]);
    const undone = history.undo({ project: second, decisions: {} })!;
    expect(blockText(undone.project.draft.blocks[0])).toBe(blockText(original.draft.blocks[0]));
    expect(undone.project.revision).toBeGreaterThan(second.revision);
    expect(undone.project.draft.revision).toBeGreaterThan(second.draft.revision);
    expect(history.canUndo).toBe(false);
    const redone = history.redo(undone)!;
    expect(blockText(redone.project.draft.blocks[0])).toBe('Accessible design systems');
    expect(redone.project.draft.revision).toBeGreaterThan(undone.project.draft.revision);
  });

  it('restores evidence text, attribution, decisions, and manual confirmation together', async () => {
    const original = addCareerNote(await fixtureProject(), 'Created an accessible component library.');
    const note = original.notes[0];
    const id = original.draft.blocks[0].id;
    const history = new DocumentHistory();
    history.push({ project: original, decisions: {} });
    const inserted = editBlock(original, id, [{ text: note.text, sourceFactIds: [note.id] }]);
    const decisions = { [note.id]: { status: 'accepted' as const, blockId: id } };
    history.push({ project: inserted, decisions });
    const manual = confirmDraft(editBlock(inserted, id, [{ text: 'Created a library and trained colleagues.' }]));
    expect(manual.facts.some(fact => fact.kind === 'applicantEdit')).toBe(true);
    const undoneManual = history.undo({ project: manual, decisions })!;
    expect(blockText(undoneManual.project.draft.blocks[0])).toBe(note.text);
    expect(undoneManual.project.draft.blocks[0].sourceFactIds).toEqual([note.id]);
    expect(undoneManual.project.facts.some(fact => fact.kind === 'applicantEdit')).toBe(false);
    expect(undoneManual.project.reviewedDraftRevision).toBeNull();
    const undoneInsertion = history.undo(undoneManual)!;
    expect(undoneInsertion.decisions).toEqual({});
    expect(blockText(undoneInsertion.project.draft.blocks[0])).toBe(blockText(original.draft.blocks[0]));
    const redoneInsertion = history.redo(undoneInsertion)!;
    expect(redoneInsertion.decisions).toEqual(decisions);
    expect(redoneInsertion.project.draft.blocks[0].sourceFactIds).toEqual([note.id]);
  });

  it('shares immutable source assets while independently snapshotting editable state', async () => {
    const original = await fixtureProject();
    const history = new DocumentHistory();
    history.push({ project: original, decisions: {} });
    const edited = editBlock(original, original.draft.blocks[0].id, [{ text: 'A deliberate manual edit.' }]);
    const restored = history.undo({ project: edited, decisions: {} })!.project;
    expect(restored.source).toBe(original.source);
    expect(restored.assets).toBe(original.assets);
    expect(restored.baseline).toBe(original.baseline);
    expect(restored.template).toBe(original.template);
    expect(restored.draft).not.toBe(original.draft);
    expect(restored.facts).not.toBe(original.facts);
    restored.draft.blocks[0].runs[0].text = 'Another change';
    expect(blockText(original.draft.blocks[0])).not.toBe('Another change');
  });
});

it('document undo and redo preserve the current canonical memory rather than historical intake drafts', async () => {
  const { initCareerMemory, setMemoryDraft } = await import('../core/careerMemory');
  const original = initCareerMemory(await fixtureProject()), history = new DocumentHistory();
  history.push({ project: original, decisions: {} });
  const edited = editBlock(original, original.draft.blocks[0].id, [{ text: 'A document edit.' }]);
  const newer = setMemoryDraft(edited, 'Canonical context saved after the document frame.', edited.careerMemory!.revision);
  const undone = history.undo({ project: newer, decisions: {} })!;
  expect(undone.project.careerMemory).toBe(newer.careerMemory);
  expect(history.redo(undone)!.project.careerMemory).toBe(newer.careerMemory);
});

import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { addCareerNote, approveTemplate, editBlock } from '../core/commands';
import { createApplication } from '../core/applications';
import { setPresentation } from '../core/folio';
import { blockText, newId, sha256, type ContentBlock, type Project, type TextRegion } from '../core/model';
import { fixtureProject } from '../core/testFixture';
import { sourceParagraphGroups } from '../core/source-paragraphs';
import { decideChanges, reconcileChangeDecisions } from './reviewDecisions';

async function authoredApplication() {
  const source = await fixtureProject();
  const page = source.template.pages[0], first = page.regions[0] as TextRegion;
  const factId = newId(), blockId = newId(), text = 'Maintained reliable data pipelines.';
  page.regions.push({ ...structuredClone(first), id: newId(), contentId: blockId, order: 1, bounds: { ...first.bounds, y: 90 } });
  const second: ContentBlock = { id: blockId, runs: [{ text, sourceFactIds: [factId] }], sourceFactIds: [factId] };
  source.baseline.blocks.push(second); source.draft.blocks.push(structuredClone(second));
  source.facts.push({ id: factId, text, kind: 'resume', confirmed: true, locator: 'Authored second paragraph' });
  const pdf = await PDFDocument.load(source.source.bytes), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.getPage(0).drawText(text, { x: 50, y: 692, size: 10, font });
  source.source.bytes = new Uint8Array(await pdf.save()); source.source.sha256 = await sha256(source.source.bytes);
  return createApplication(await approveTemplate(source, []), { title: 'Engineer', company: 'Authored Example', description: 'React data pipelines' });
}

function supportedEdit(project: Project, blockId: string, text: string) {
  const next = addCareerNote(project, text), fact = next.facts.at(-1)!;
  return editBlock(next, blockId, [{ text, sourceFactIds: [fact.id] }]);
}

describe('review decisions follow the actual content', () => {
  it('clears acceptance after a later wording edit without changing the original or final confirmation', async () => {
    const app = await authoredApplication(), id = app.draft.blocks[0].id;
    const edited = supportedEdit(app, id, 'Built accessible React dashboards using TypeScript.');
    const accepted = decideChanges(edited, [id], 'accepted');
    expect(accepted.folio?.changes[id]).toBe('accepted');
    const next = reconcileChangeDecisions(accepted, editBlock(accepted, id, [{ text: 'Built another React dashboard.' }]));
    expect(next.folio?.changes[id]).toBeUndefined();
    expect(next.reviewedDraftRevision).toBeNull();
    expect(accepted.folio?.changes[id]).toBe('accepted');
    expect(next.baseline).toEqual(app.baseline);
  });

  it('accepts multiple supported changes atomically, and skips unsupported or absent blocks', async () => {
    const app = await authoredApplication(), [one, two] = app.draft.blocks.map(block => block.id);
    const first = supportedEdit(app, one, 'Built accessible React dashboards using TypeScript.');
    const edited = supportedEdit(first, two, 'Maintained reliable Python data pipelines.');
    const accepted = decideChanges(edited, [one, two, one, 'missing'], 'accepted');
    expect(accepted.folio?.changes).toEqual({ [one]: 'accepted', [two]: 'accepted' });
    expect(edited.folio).toBeUndefined();
    const unproved = editBlock(accepted, two, [{ text: 'Invented an unsupported qualification.' }]);
    const checked = decideChanges(reconcileChangeDecisions(accepted, unproved), [two], 'accepted');
    expect(checked.folio?.changes).toEqual({ [one]: 'accepted' });
  });

  it('preserves rejected restoration decisions for every restored original', async () => {
    const app = await authoredApplication(), [one, two] = app.draft.blocks.map(block => block.id);
    const edited = supportedEdit(supportedEdit(app, one, 'Built accessible React dashboards.'), two, 'Maintained Python pipelines.');
    const accepted = decideChanges(edited, [one, two], 'accepted');
    const restored = reconcileChangeDecisions(accepted, decideChanges(accepted, [one, two], 'rejected'));
    expect(restored.folio?.changes).toEqual({ [one]: 'rejected', [two]: 'rejected' });
    expect(restored.draft.blocks.map(blockText)).toEqual(app.baseline.blocks.map(blockText));
    expect(restored.baseline).toEqual(app.baseline);
    const revised = reconcileChangeDecisions(restored, editBlock(restored, one, [{ text: 'Another manual edit.' }]));
    expect(revised.folio?.changes).toEqual({ [two]: 'rejected' });
  });

  it('retains decisions for metadata updates and untouched paragraphs', async () => {
    const app = await authoredApplication(), [one, two] = app.draft.blocks.map(block => block.id);
    const edited = supportedEdit(supportedEdit(app, one, 'Built accessible React dashboards.'), two, 'Maintained Python pipelines.');
    const accepted = decideChanges(edited, [one, two], 'accepted');
    const metadata = setPresentation(accepted, { privateNotes: 'Private authored note.' });
    expect(reconcileChangeDecisions(accepted, metadata)).toBe(metadata);
    const changed = reconcileChangeDecisions(metadata, supportedEdit(metadata, one, 'Built accessible TypeScript dashboards.'));
    expect(changed.folio?.changes).toEqual({ [two]: 'accepted' });
    expect(changed.folio?.privateNotes).toBe('Private authored note.');
  });

  it('invalidates acceptance for evidence or native paragraph ownership changes even if text is unchanged', async () => {
    const app = await authoredApplication(), id = app.draft.blocks[0].id;
    const edited = supportedEdit(app, id, 'Built accessible React dashboards.');
    const accepted = decideChanges(edited, [id], 'accepted');
    for (const update of [
      (block: ContentBlock) => ({ ...block, sourceFactIds: [] }),
      (block: ContentBlock) => ({ ...block, sourceParagraphGroupId: 'authored-new-owner' }),
      (block: ContentBlock) => ({ ...block, runs: block.runs.map(run => ({ ...run, bold: true })) }),
    ]) {
      const changed = { ...accepted, revision: accepted.revision + 1, draft: { ...accepted.draft, revision: accepted.draft.revision + 1, blocks: accepted.draft.blocks.map(block => block.id === id ? update(block) : block) } };
      expect(reconcileChangeDecisions(accepted, changed).folio?.changes[id]).toBeUndefined();
    }
  });

  it('invalidates a native paragraph leader when only another member changes', () => {
    // Synthetic ownership geometry only; this does not assert PDF rendering support.
    const style = { fontFamily: 'sans', fontSize: 10, fontWeight: 400, italic: false, color: '#000000', lineHeight: 13, alignment: 'left', sourceFontId: 'font' } as const;
    const items = [['•', 44, 48], ['One', 57, 72], [' ', 72, 74], ['bullet', 74, 100]] as const;
    const blocks = items.map(([text], index) => ({ id: `b${index}`, runs: [{ text }], sourceFactIds: [`f${index}`] }));
    const regions = items.map(([text, x, end], index) => ({ kind: 'text', id: `r${index}`, pageId: 'page', contentId: `b${index}`, bounds: { x, y: 52, width: end - x, height: 10 }, style, order: index, role: 'body', sourceLocator: 'Authored geometry', sourceLayout: { version: 1, sourceSha256: 'a'.repeat(64), baselineRunsHash: 'b'.repeat(64), anchor: 'start', startX: x, endX: end, baseline: 60, fontSize: 10, glyphs: [{ fontId: 'font', cid: 1, unicode: text, x, advance: end - x, operatorIndex: index }] } }));
    const previous = { id: 'authored-group-test', workspace: { kind: 'application', templateGroupId: 'authored-group' }, source: { sha256: 'a'.repeat(64) }, template: { pages: [{ id: 'page', width: 612, height: 792, regions }], sourceFonts: [{ id: 'font', format: 'truetype', sourceVersion: 6, originalProgram: { sha256: 'c'.repeat(64) } }] }, baseline: { revision: 1, blocks }, draft: { revision: 2, blocks: structuredClone(blocks) }, folio: { changes: { b1: 'accepted' } } } as unknown as Project;
    const groups = sourceParagraphGroups(previous);
    expect(groups).toHaveLength(1);
    previous.draft.blocks[1].sourceParagraphGroupId = groups[0].id;
    const next = structuredClone(previous);
    next.draft.blocks[3].runs[0].text = 'revised member';
    expect(next.draft.blocks[1]).toEqual(previous.draft.blocks[1]);
    expect(reconcileChangeDecisions(previous, next).folio?.changes.b1).toBeUndefined();
    expect(previous.folio?.changes.b1).toBe('accepted');
  });
});

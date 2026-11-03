import { editBlock } from '../core/commands';
import { presentation, setPresentation } from '../core/folio';
import { canonicalJson, workspaceOf, type ContentBlock, type Project } from '../core/model';
import { resetSourceParagraph } from '../core/source-paragraph-commands';
import { activeSourceParagraphs } from '../core/source-paragraphs';
import { changedParagraphs } from '../tailoring/local';
import { sourceReviewIssues } from '../tailoring/sourceSupport';

const reviewedContent = (block: ContentBlock | undefined) => block && canonicalJson({
  runs: block.runs, sourceFactIds: block.sourceFactIds, sourceParagraphGroupId: block.sourceParagraphGroupId,
});

/** A review decision belongs to the wording and evidence that were reviewed.
 * Reconcile within the same mutation so a subsequent edit cannot retain an
 * earlier Accepted badge. Final claim confirmation is still a separate gate. */
export function reconcileChangeDecisions(previous: Project, next: Project): Project {
  if (previous === next || previous.id !== next.id || workspaceOf(next).kind !== 'application' || !next.folio) return next;
  const before = new Map(previous.draft.blocks.map(block => [block.id, block]));
  const after = new Map(next.draft.blocks.map(block => [block.id, block]));
  const baseline = new Map(next.baseline.blocks.map(block => [block.id, block]));
  const changed = new Set([...before.keys(), ...after.keys()].filter(id => reviewedContent(before.get(id)) !== reviewedContent(after.get(id))));
  if (!changed.size) return next;
  // A native paragraph's review entry belongs to its leader, while edits and
  // reset operations can update several original blocks together.
  const paragraphMembers = new Map<string, Set<string>>();
  for (const group of [...activeSourceParagraphs(previous), ...activeSourceParagraphs(next)]) {
    const leader = group.contentIds[0], members = paragraphMembers.get(leader) ?? new Set<string>();
    group.contentIds.forEach(id => members.add(id)); paragraphMembers.set(leader, members);
    if (group.contentIds.some(id => changed.has(id))) changed.add(group.contentIds[0]);
  }
  const decisions = { ...next.folio.changes };
  let removed = false;
  for (const [id, decision] of Object.entries(decisions)) {
    if (!changed.has(id)) continue;
    // Preserve the explicit Restore original gesture and its audit label.
    const originalIds = paragraphMembers.get(id) ?? new Set([id]);
    if (decision === 'rejected' && [...originalIds].every(memberId => after.has(memberId) && baseline.has(memberId) && reviewedContent(after.get(memberId)) === reviewedContent(baseline.get(memberId)))) continue;
    delete decisions[id]; removed = true;
  }
  return removed ? { ...next, folio: { ...next.folio, changes: decisions } } : next;
}

/** Apply a whole review gesture to one live snapshot and one undo entry. */
export function decideChanges(project: Project, ids: readonly string[], decision: 'accepted' | 'rejected'): Project {
  const changed = new Set(changedParagraphs(project).map(change => change.id));
  const unsupported = new Set(sourceReviewIssues(project));
  let next = project;
  for (const id of new Set(ids)) {
    if (!changed.has(id)) continue;
    if (decision === 'accepted' && unsupported.has(id)) continue;
    if (decision === 'rejected') {
      const group = next.draft.blocks.find(block => block.id === id)?.sourceParagraphGroupId;
      const original = next.baseline.blocks.find(block => block.id === id);
      if (group) next = resetSourceParagraph(next, group);
      else if (original) next = editBlock(next, id, structuredClone(original.runs));
    }
    if (workspaceOf(next).kind === 'application') next = setPresentation(next, { changes: { ...presentation(next).changes, [id]: decision } });
  }
  return next;
}

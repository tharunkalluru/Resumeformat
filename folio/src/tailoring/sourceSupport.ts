import { eligibleEvidence } from '../core/careerMemory';
import { blockText } from '../core/model';
import type { Project } from '../core/model';

/** Conservative proof, not a semantic-equivalence or qualification detector. */
export function sourceReviewIssues(project: Project): string[] {
  const eligible = new Map(eligibleEvidence(project).map(fact => [fact.id, fact]));
  return project.draft.blocks.filter(block => {
    const text = blockText(block);
    if (!text.trim()) return false;
    const original = project.baseline.blocks.find(item => item.id === block.id);
    if (original && blockText(original) === text && original.sourceFactIds.every(id => eligible.has(id))) return false;
    return !block.sourceFactIds.some(id => eligible.get(id)?.text === text);
  }).map(block => block.id);
}

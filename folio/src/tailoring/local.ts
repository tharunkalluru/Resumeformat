import {activeSourceParagraphs} from '../core/source-paragraphs';
import { blockText } from '../core/model';
import type { MatchingResult, Project } from '../core/model';
import { eligibleEvidence } from '../core/careerMemory';

const STOP = new Set('a an and are as at be by can company degree for from have in is it job of on or our role the their this to we will with work you your years experience responsibilities requirements candidate join team ability including such must skills preferred position looking seeking strong excellent'.split(' '));
const TECH = /(?:c\+\+|c#|\.net|[\p{L}][\p{L}\p{N}+#.-]{1,})/gu;
export function requirementTerms(text: string): string[] {
  const words = (text.toLowerCase().match(TECH) ?? []).map(word => word.replace(/[.,-]+$/, '')).filter(word => word.length > 2 && !STOP.has(word));
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 28).map(([word]) => word);
}
const NEGATION = /\b(?:never|no|not|without|lack(?:s|ed|ing)?|none|unable|cannot|can't|haven't|hasn't|hadn't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't)\b/u;
const QUALIFICATION = '(?:experience|knowledge|skills?|expertise|proficiency|practice|exposure)';
const ZERO_QUALIFICATION = new RegExp(`\\bzero\\s+${QUALIFICATION}\\b`, 'u');
const FOLLOWING_ZERO = new RegExp(`^\\s*(?:zero\\s+${QUALIFICATION}\\b|${QUALIFICATION}\\s+(?:(?:is|was)\\s+)?zero\\b)`, 'u');
const FOLLOWING_NEGATION = /^\s*(?:(?:experience|knowledge|skills?|expertise|proficiency|practice|exposure|use|used|is|was|are|were|has|have|had|i|we|it|they|am|do|did|with|in|of|the|any)\s+){0,6}(?:never|no|not|none|lacking|absent|unavailable|cannot|can't|haven't|hasn't|hadn't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't)\b/u;
function hasPositiveTerm(text: string, term: string): boolean {
  const normalized = text.toLowerCase().replace(/[’‘]/g, "'").replace(/\bnot\s+only\b/g, '');
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'gu');
  // Conservative English lexical filtering, not an entailment/qualification model.
  // Contrast and sentence boundaries let a later positive statement stand alone.
  return normalized.split(/(?<=[.!?])\s+|[\n;]|\b(?:but|however|yet|although)\b/u).some(clause =>
    [...clause.matchAll(pattern)].some(match => {
      const start = match.index + match[0].length - match[1].length;
      const before = clause.slice(0, start), after = clause.slice(start + match[1].length).replace(/[,:=\-–—]/g, ' ');
      const zeroTermExperience = /\bzero\s*$/u.test(before) && new RegExp(`^\\s+${QUALIFICATION}\\b`, 'u').test(after);
      return !NEGATION.test(before) && !ZERO_QUALIFICATION.test(before) && !zeroTermExperience && !FOLLOWING_NEGATION.test(after) && !FOLLOWING_ZERO.test(after);
    }));
}
export function matchProject(project: Project): MatchingResult {
  const terms = requirementTerms(project.job.description);
  const facts = eligibleEvidence(project);
  const evidence = facts.map(fact => ({ factId: fact.id, text: fact.text, source: fact.kind, matchedTerms: terms.filter(term => hasPositiveTerm(fact.text, term)) })).filter(item => item.matchedTerms.length).sort((a, b) => b.matchedTerms.length - a.matchedTerms.length);
  const covered = new Set(evidence.flatMap(item => item.matchedTerms));
  return { terms, evidence, gaps: terms.filter(term => !covered.has(term)) };
}
export function changedParagraphs(project: Project) {
  const baseline = new Map(project.baseline.blocks.map(block => [block.id, blockText(block)]));
  const groups = activeSourceParagraphs(project), members = new Set(groups.flatMap(g => g.contentIds));
  return [...groups.map(group => {const block = project.draft.blocks.find(b => b.id === group.contentIds[0])!; return {id: block.id, before: group.baselineText, after: blockText(block), sources: block.sourceFactIds};}),
    ...project.draft.blocks.filter(block => !members.has(block.id) && blockText(block) !== baseline.get(block.id)).map(block => ({ id: block.id, before: baseline.get(block.id) ?? '', after: blockText(block), sources: block.sourceFactIds }))];
}

import type { CareerMemoryView } from '../core/careerMemory';
import type { MemoryGroup } from './careerMemoryPresentation';

export type MemoryEvidenceFilter = 'all' | 'available' | 'review' | 'inactive';
export interface MemoryEvidenceItem {
  key: string;
  id: string;
  kind: 'resume' | 'extra';
  text: string;
  sourceName: string;
  locator: string;
  context: string;
  status: string;
  available: boolean;
  needsReview: boolean;
  inactive: boolean;
  searchText: string;
  /** Only committed wording participates in duplicate suggestions. */
  committedText: string;
}

/** Whitespace/case normalization for search, not evidence mutation. */
function searchText(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

/** A read-only index: context comes only from explicit source groups or correction links. */
export function memoryEvidenceIndex(view: CareerMemoryView, groups: readonly MemoryGroup[], resumeName: string): MemoryEvidenceItem[] {
  const contexts = new Map<string, string[]>();
  for (const group of groups) {
    for (const id of [...group.factIds, ...group.metadataFactIds]) {
      const list = contexts.get(id) ?? [];
      list.push([group.title, group.dates].filter(Boolean).join(' · '));
      contexts.set(id, list);
    }
  }
  const contextFor = (id?: string) => id ? [...new Set(contexts.get(id) ?? [])].join(' / ') : '';
  const resume = view.resumeFacts.map(row => {
    const context = contextFor(row.fact.id);
    const status = row.status === 'available' ? 'Resume source · Available for future applications' : row.status === 'pendingCorrection' ? 'Correction needs confirmation' : row.status === 'excluded' ? 'Excluded from future applications' : 'Replaced for future applications';
    return { key: `resume:${row.fact.id}`, id: row.fact.id, kind: 'resume' as const, text: row.fact.text, committedText: row.fact.text, sourceName: resumeName, locator: row.fact.locator, context, status, available: row.eligible, needsReview: row.status === 'pendingCorrection', inactive: row.excluded || row.superseded, searchText: searchText([row.fact.text, resumeName, row.fact.locator, context, status].join(' ')) };
  });
  const extra = view.assertions.map(row => {
    const context = contextFor(row.supersedes?.resumeFactId);
    const status = row.draftText !== undefined ? 'Edit draft · Future use paused' : row.superseded ? 'Replaced for future applications' : row.excluded ? 'Excluded from future applications' : row.confirmation ? 'Confirmed by you · Available for future applications' : 'Needs your confirmation';
    return { key: `extra:${row.assertionId}`, id: row.assertionId, kind: 'extra' as const, text: row.draftText ?? row.text, committedText: row.text, sourceName: row.provenance.sourceName, locator: row.provenance.locator, context, status, available: row.eligible, needsReview: !row.confirmation || row.draftText !== undefined, inactive: row.excluded || row.superseded, searchText: searchText([row.text, row.draftText, row.provenance.sourceName, row.provenance.locator, row.provenance.originalQuote, context, status].filter(Boolean).join(' ')) };
  });
  return [...resume, ...extra];
}

/** Every whitespace-separated query term must occur; never interpret a user query as a regex. */
export function searchMemoryEvidence(items: readonly MemoryEvidenceItem[], query: string, filter: MemoryEvidenceFilter = 'all'): MemoryEvidenceItem[] {
  const terms = searchText(query).split(' ').filter(Boolean);
  return items.filter(item => (filter === 'all' || (filter === 'available' ? item.available : filter === 'review' ? item.needsReview : item.inactive)) && terms.every(term => item.searchText.includes(term)));
}

/** Formatting-only equivalence. Preserve numbers, punctuation, word order and negation. */
export function normalizeDuplicateWording(text: string): string {
  return text.normalize('NFC').replace(/^[\s]*[•▪◦]\s*/, '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

export interface MemoryDuplicateGroup { key: string; items: MemoryEvidenceItem[]; exact: boolean }
export function memoryDuplicateGroups(items: readonly MemoryEvidenceItem[]): MemoryDuplicateGroup[] {
  const matches = new Map<string, MemoryEvidenceItem[]>();
  for (const item of items) {
    const key = normalizeDuplicateWording(item.committedText);
    // Repeated headings, dates and short skill labels are expected; keep suggestions actionable.
    if (key.length < 24 || key.split(' ').length < 4) continue;
    const list = matches.get(key) ?? [];
    list.push(item);
    matches.set(key, list);
  }
  return [...matches].filter(([, list]) => list.length > 1).map(([key, list]) => ({ key, items: list, exact: list.every(item => item.committedText === list[0].committedText) }));
}

export function memoryContextQuestions(group: MemoryGroup): string[] {
  if (group.category !== 'roles' && group.category !== 'projects') return [];
  return [
    ...(group.dates ? [] : [`Which dates belong to “${group.title}”? Check the original wording before adding them.`]),
    `For “${group.title}”, what did you personally do, and what changed? Include a result only if you can support it.`,
  ];
}

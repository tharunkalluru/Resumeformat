import { describe, expect, it } from 'vitest';
import type { CareerMemoryView } from '../core/careerMemory';
import { memoryContextQuestions, memoryDuplicateGroups, memoryEvidenceIndex, normalizeDuplicateWording, searchMemoryEvidence } from './memoryInsights';

function fixture(): CareerMemoryView {
  return {
    resumeFacts: [
      { fact: { id: 'resume-a', text: 'Reduced processing time by 12% with SQL.', locator: 'Page 1, Experience' }, eligible: true, excluded: false, superseded: false, status: 'available' },
      { fact: { id: 'resume-b', text: 'Reduced processing time by 21% with SQL.', locator: 'Page 2' }, eligible: false, excluded: true, superseded: false, status: 'excluded' },
    ],
    assertions: [
      { assertionId: 'extra-a', text: 'Reduced processing time by 12% with SQL.', version: 1, confirmation: null, eligible: false, excluded: false, superseded: false, provenance: { sourceName: 'Project diary', locator: 'Paragraph 7', originalQuote: 'Worked on an internal data pipeline at Northwind.' } },
      { assertionId: 'extra-b', text: 'Coached three colleagues in code review.', draftText: 'Coached four colleagues in code review.', version: 2, confirmation: { version: 2 }, eligible: false, excluded: false, superseded: false, supersedes: { resumeFactId: 'resume-a' }, provenance: { sourceName: 'Applicant notes', locator: 'Paragraph 2', originalQuote: 'Coached three colleagues in code review.' } },
    ],
  } as CareerMemoryView;
}
const groups = [{ id: 'role-a', category: 'roles' as const, title: 'Data engineer | Cedar Systems', dates: '2020–2023', factIds: ['resume-a'], metadataFactIds: [] }];

describe('Career Memory read-only discovery', () => {
  it('finds source quote, locator, role and date terms across categories', () => {
    const items = memoryEvidenceIndex(fixture(), groups, 'Resume.pdf');
    expect(searchMemoryEvidence(items, 'northwind pipeline').map(item => item.id)).toEqual(['extra-a']);
    expect(searchMemoryEvidence(items, 'cedar 2020').map(item => item.id)).toEqual(['resume-a', 'extra-b']);
    expect(searchMemoryEvidence(items, 'project diary paragraph 7').map(item => item.id)).toEqual(['extra-a']);
    expect(searchMemoryEvidence(items, '[')).toEqual([]);
  });
  it('does not call resume facts applicant-confirmed or draft assertions available', () => {
    const items = memoryEvidenceIndex(fixture(), groups, 'Resume.pdf');
    expect(searchMemoryEvidence(items, '', 'available').map(item => item.id)).toEqual(['resume-a']);
    expect(items[0].status).not.toContain('Confirmed');
    expect(searchMemoryEvidence(items, '', 'review').map(item => item.id)).toEqual(['extra-a', 'extra-b']);
    expect(searchMemoryEvidence(items, '', 'inactive').map(item => item.id)).toEqual(['resume-b']);
  });
  it('suggests committed repeated wording without conflating changed metrics or pending draft text', () => {
    const view = fixture(), before = JSON.stringify(view);
    const duplicates = memoryDuplicateGroups(memoryEvidenceIndex(view, groups, 'Resume.pdf'));
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].items.map(item => item.id)).toEqual(['resume-a', 'extra-a']);
    expect(duplicates[0].exact).toBe(true);
    expect(JSON.stringify(view)).toBe(before);
  });
  it('normalizes formatting only, preserving qualifications, negation and numeric notation', () => {
    expect(normalizeDuplicateWording('• Led  the “Atlas” project')).toBe(normalizeDuplicateWording('led the "Atlas" project'));
    expect(normalizeDuplicateWording('Used SQL')).not.toBe(normalizeDuplicateWording('Not used SQL'));
    expect(normalizeDuplicateWording('Raised 1.2 million')).not.toBe(normalizeDuplicateWording('Raised 12 million'));
    expect(normalizeDuplicateWording('Led A + B')).not.toBe(normalizeDuplicateWording('Led A B'));
  });
  it('keeps repeated headings and short labels out of duplicate suggestions', () => {
    const items = memoryEvidenceIndex(fixture(), groups, 'Resume.pdf');
    const short = items.map(item => ({ ...item, committedText: 'Technical skills' }));
    expect(memoryDuplicateGroups(short)).toEqual([]);
  });
  it('offers questions with explicit context without creating facts or assuming dates are absent', () => {
    expect(memoryContextQuestions(groups[0])).toHaveLength(1);
    expect(memoryContextQuestions({ ...groups[0], dates: undefined })[0]).toContain('Check the original wording');
    expect(memoryContextQuestions({ ...groups[0], category: 'skills' })).toEqual([]);
  });
});

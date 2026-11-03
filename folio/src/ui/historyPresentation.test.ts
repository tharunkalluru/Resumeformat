import { expect, it } from 'vitest';
import { historyGroups } from './historyPresentation';
import type { Project } from '../core/model';
it('groups only retained applications across local midnight without modifying input order or records', () => {
  const now = new Date(2026, 9, 10, 0, 1);
  const record = (id: string, at: Date, kind = 'application') => ({ id, updatedAt: at.toISOString(), workspace: { kind } } as Project);
  const records = [record('old', new Date(2026, 8, 28)), record('yesterday', new Date(2026, 9, 9, 23, 59)), record('today', new Date(2026, 9, 10)), record('resume', now, 'resume')];
  const snapshot = JSON.stringify(records), groups = historyGroups(records, now);
  expect(groups.map(group => [group.label, group.projects.map(project => project.id)])).toEqual([
    ['Today', ['today']], ['Previous 7 days', ['yesterday']], ['Earlier', ['old']],
  ]); expect(JSON.stringify(records)).toBe(snapshot);
});

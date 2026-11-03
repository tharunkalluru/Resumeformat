import { hasValidApproval, workspaceOf } from '../core/model';
import type { Project } from '../core/model';

export interface ComposerServiceReadiness {
  state: 'unchecked' | 'checking' | 'ready' | 'blocked' | 'unavailable';
  message: string;
}
export type ApplicationStage = 'draft' | 'review' | 'reviewed';

/** Presentation only. Neither generation completion nor claim confirmation proves human PDF review. */
export function applicationProgress(project: Project): {
  stage: ApplicationStage; label: string; description: string;
  lastDownload: NonNullable<Project['folio']>['versions'][number] | undefined;
} {
  const lastDownload = project.folio?.versions.filter(item => item.kind === 'download')
    .reduce<NonNullable<Project['folio']>['versions'][number] | undefined>((latest, item) =>
      !latest || item.createdAt > latest.createdAt ? item : latest, undefined);
  const reviewed = project.reviewedDraftRevision === project.draft.revision;
  const hasResult = !!project.folio?.completions.length || project.draft.revision !== project.baseline.revision;
  if (!hasValidApproval(project)) return { stage: 'review', label: 'Layout review needed', description: 'Compare the current layout before editing or exporting.', lastDownload };
  if (reviewed) return { stage: 'reviewed', label: 'Claims confirmed', description: 'Claim confirmation is recorded. Inspect the current PDF before download.', lastDownload };
  if (hasResult) return { stage: 'review', label: 'Review changes', description: 'Review the current wording, sources and page fit.', lastDownload };
  return { stage: 'draft', label: 'Job draft', description: 'Your job is saved. Continue tailoring or edit locally.', lastDownload };
}

export function applicationEntries(projects: Project[]): Project[] {
  return projects.filter(project => workspaceOf(project).kind === 'application')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function shortDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function applicationSearchText(project: Project): string {
  return [project.name, project.job.company, project.job.title, project.source.name].join(' ').normalize('NFKC').toLocaleLowerCase();
}

import { hasPermittedOriginalTrueType, documentScopedHistoryBinding, hashTextSync, newId, workspaceOf } from './model';
import type { FolioPresentation, FolioVersion, Project } from './model';
import { validateProject } from './schema';

export function presentation(project: Project): FolioPresentation {
  if (workspaceOf(project).kind !== 'application') throw new Error('Select a tailored resume first.');
  return project.folio ?? { state: project.reviewedDraftRevision === project.draft.revision ? 'ready' : 'draft', jobIdentity: project.id, privateNotes: '', historyKnown: false, completions: [], versions: [], changes: {} };
}
export function setPresentation(project: Project, patch: Partial<FolioPresentation>): Project {
  return validateProject({ ...project, folio: { ...presentation(project), ...patch }, revision: project.revision + 1, updatedAt: new Date().toISOString() });
}
/** Called only after validated generation and a successful full-document fit check. */
export function jobIdentity(project: Project): string {
  return `job-${hashTextSync(project.job.description.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase())}`;
}
export function completedTailoring(project: Project, requestId: string, completedAt = new Date().toISOString()): Project {
  const current = presentation(project);
  if (current.completions.some(event => event.id === requestId)) return project;
  const identity = current.completions.length ? current.jobIdentity : jobIdentity(project);
  return setPresentation(project, { state: 'ready', jobIdentity: identity, completions: [...current.completions, { id: requestId, completedAt, jobIdentity: identity }] });
}
export function saveVersion(project: Project, kind: FolioVersion['kind']): Project {
  const current = presentation(project);
  if (current.versions.length >= 12) throw new Error('This tailoring has 12 recorded versions. Download a backup before creating a new tailoring; existing versions remain intact.');
  return setPresentation(project, { versions: [...current.versions, { ...((hasPermittedOriginalTrueType(project.template)||project.template.sourceColorProfile||project.template.sourceFonts?.some(f=>f.sourceVersion===7||f.sourceVersion===8))?{documentScopedBinding:documentScopedHistoryBinding(project)}:{}), id: newId(), kind, createdAt: new Date().toISOString(), content: structuredClone(project.draft) }] });
}

import { hasValidApproval, workspaceOf, type Project } from './model';

export interface ComposerPreferences { selectedId: string | null; defaultId: string | null }
export const emptyComposerPreferences = (): ComposerPreferences => ({ selectedId: null, defaultId: null });
export const reusableSources = (projects: Project[]) => projects.filter(item => workspaceOf(item).kind === 'resume' && hasValidApproval(item));
export const sameComposerTemplate = (a: Project | undefined, b: Project) => !!a && a.source.sha256 === b.source.sha256 && a.template.id === b.template.id && a.template.revision === b.template.revision;

/** A saved application carries its own original and layout; live defaults cannot replace that snapshot. */
export function composerSource(projects: Project[], current: Project | null, draftId: string | null, preferences: ComposerPreferences): Project | undefined {
  if (current?.id === draftId && workspaceOf(current).kind === 'application') return current;
  const choices = reusableSources(projects);
  return choices.find(item => item.id === preferences.selectedId) ?? choices.find(item => item.id === preferences.defaultId) ?? choices[0];
}

export function sourceForNewJob(projects: Project[], current: Project | null, preferences: ComposerPreferences): Project | undefined {
  if (current && workspaceOf(current).kind === 'resume' && hasValidApproval(current)) return current;
  if (current && workspaceOf(current).kind === 'application') {
    const sameGroup = reusableSources(projects).find(item => workspaceOf(item).templateGroupId === workspaceOf(current).templateGroupId);
    if (sameGroup) return sameGroup;
  }
  return composerSource(projects, null, null, preferences);
}

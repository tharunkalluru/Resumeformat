// PROPOSED ONLY — uncompiled/unverified. Intended isolated-integration path.
import { hasValidApproval, workspaceOf, type Project } from '../core/model';
import type { ComposerPreferences } from '../core/composerSources';
import {
  composerSource, commitDefaultResume, defaultResumePreference, loadDefaultResume,
  preferenceMatches, type DefaultResumePreference,
} from './templatePreferences';

export function composerBridgeSource(
  projects: Project[], current: Project | null, pinnedDraftId: string | null,
  canonicalDefault: DefaultResumePreference | null, explicitSelection: DefaultResumePreference | null,
  ready: boolean, preferenceError: string, legacy: ComposerPreferences,
): Project | undefined {
  if (current?.id === pinnedDraftId && workspaceOf(current).kind === 'application') return current;
  const available = current ? [current, ...projects.filter(item => item.id !== current.id)] : projects;
  if (explicitSelection) return available.find(item => hasValidApproval(item) && preferenceMatches(item, explicitSelection));
  return freshComposerDefault(available, current, canonicalDefault, ready, preferenceError, legacy);
}

/** The sole eligible default for a fresh attempt, also used for UI labels. */
export function freshComposerDefault(
  projects: Project[], current: Project | null, canonicalDefault: DefaultResumePreference | null,
  ready: boolean, preferenceError: string, legacy: ComposerPreferences,
): Project | undefined {
  if (!ready || preferenceError) return undefined;
  const available = current ? [current, ...projects.filter(item => item.id !== current.id)] : projects;
  if (canonicalDefault) return composerSource(available, current, null, canonicalDefault) ?? undefined;
  // A retained earlier choice is not replaced by a different file in library order.
  if (legacy.defaultId || legacy.selectedId) return undefined;
  return composerSource(available, current, null, null) ?? undefined;
}

export function legacyChoiceNotice(projects: Project[], legacy: ComposerPreferences, canonical: DefaultResumePreference | null): string {
  const name = (id: string) => projects.find(item => item.id === id)?.name ?? 'an unavailable earlier resume';
  const retained: string[] = [];
  if (legacy.selectedId) retained.push(`Earlier selected resume: ${name(legacy.selectedId)}.`);
  if (legacy.defaultId && legacy.defaultId !== canonical?.resumeProjectId) retained.push(`Earlier default: ${name(legacy.defaultId)}.`);
  return retained.length ? `${retained.join(' ')} These earlier choices remain saved. Select a resume explicitly to use it for this attempt; the fingerprint-bound default remains the default for fresh attempts.` : '';
}

/** A single new canonical preference write. Never writes/deletes the legacy store. */
export async function migrateLegacyDefault(
  projects: Project[], legacy: ComposerPreferences, existing: DefaultResumePreference | null,
  current: (id: string) => Project | undefined, active: () => boolean,
): Promise<DefaultResumePreference | null> {
  if (existing || !legacy.defaultId) return existing;
  const target = projects.find(item => item.id === legacy.defaultId);
  if (!target || workspaceOf(target).kind !== 'resume' || !hasValidApproval(target)) {
    throw new Error('Your earlier default is retained but is missing or needs current layout approval. Choose an approved layout; no automatic replacement was saved.');
  }
  const revision = target.revision;
  const preference = await defaultResumePreference(target);
  const stillOwned = () => {
    const live = current(target.id);
    return active() && !!live && live.revision === revision && hasValidApproval(live) && preferenceMatches(live, preference);
  };
  if (!stillOwned()) throw new Error('The earlier default changed during verification. Its saved choice is retained; review its current layout.');
  try { return await commitDefaultResume(preference, null, stillOwned); }
  catch (reason) {
    // Another window may already have created the sole canonical preference.
    // Read it rather than overwrite it, and keep every legacy record unchanged.
    const canonical = await loadDefaultResume();
    if (canonical && active()) return canonical;
    throw reason;
  }
}

import { openDB } from 'idb';
import { z } from 'zod';
import { hasValidApproval, hashJson, sha256, workspaceOf, type Project } from '../core/model';

const schema = z.strictObject({
  version: z.literal(1), resumeProjectId: z.string().min(1).max(150), sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  templateId: z.string().min(1).max(150), templateRevision: z.number().int().positive(),
  layoutHash: z.string().regex(/^[a-f0-9]{64}$/), baselineHash: z.string().regex(/^[a-f0-9]{64}$/),
  rendererVersion: z.string().min(1).max(150), updatedAt: z.string().datetime(),
});
export type DefaultResumePreference = z.infer<typeof schema>;
const database = () => openDB('folio-private-ui-v1', 1, { upgrade(db) { db.createObjectStore('preferences'); } });

/** UI preference only. It never rewrites a project, template or evidence snapshot. */
export async function loadDefaultResume(): Promise<DefaultResumePreference | null> {
  const db = await database();
  try { const value = await db.get('preferences', 'defaultResume'); return value === undefined ? null : schema.parse(value); }
  finally { db.close(); }
}
export async function saveDefaultResume(preference: DefaultResumePreference): Promise<void> {
  const value = schema.parse(preference), db = await database();
  try { await db.put('preferences', value, 'defaultResume'); } finally { db.close(); }
}
export async function defaultResumePreference(project: Project): Promise<DefaultResumePreference> {
  if (workspaceOf(project).kind !== 'resume' || !hasValidApproval(project)) throw new Error('Compare and approve this reusable layout before making it the default.');
  const approval = project.approval!;
  const [sourceHash, layoutHash, baselineHash] = await Promise.all([sha256(project.source.bytes), hashJson(project.template), hashJson(project.baseline.blocks)]);
  if (sourceHash !== project.source.sha256 || layoutHash !== approval.layoutHash || baselineHash !== approval.baselineHash) throw new Error('This layout changed after approval. Compare and approve its current version.');
  return schema.parse({ version: 1, resumeProjectId: project.id, sourceSha256: sourceHash, templateId: project.template.id,
    templateRevision: project.template.revision, layoutHash, baselineHash, rendererVersion: approval.rendererVersion, updatedAt: new Date().toISOString() });
}
export function preferenceMatches(project: Project, preference: DefaultResumePreference): boolean {
  return workspaceOf(project).kind === 'resume' && hasValidApproval(project) && project.id === preference.resumeProjectId &&
    project.source.sha256 === preference.sourceSha256 && project.template.id === preference.templateId && project.template.revision === preference.templateRevision &&
    project.approval!.layoutHash === preference.layoutHash && project.approval!.baselineHash === preference.baselineHash && project.approval!.rendererVersion === preference.rendererVersion;
}
export function defaultResumeStatus(projects: Project[], preference: DefaultResumePreference | null): 'automatic' | 'ready' | 'missing' | 'changed' {
  if (!preference) return 'automatic';
  const source = projects.find(item => item.id === preference.resumeProjectId);
  return !source ? 'missing' : preferenceMatches(source, preference) ? 'ready' : 'changed';
}
/** A saved draft always keeps its source. An unavailable explicit default never silently falls back. */
export function composerSource(projects: Project[], current: Project | null, pinnedDraftId: string | null, preference: DefaultResumePreference | null): Project | null {
  if (current && current.id === pinnedDraftId && workspaceOf(current).kind === 'application') return current;
  if (preference) return projects.find(item => preferenceMatches(item, preference)) ?? null;
  return (current && workspaceOf(current).kind === 'resume' && hasValidApproval(current) ? current :
    projects.find(item => workspaceOf(item).kind === 'resume' && hasValidApproval(item) && (!current || workspaceOf(item).templateGroupId === workspaceOf(current).templateGroupId))) ??
    projects.find(item => workspaceOf(item).kind === 'resume' && hasValidApproval(item)) ?? null;
}

/** PROPOSED ONLY: one canonical-key transaction; no cross-database atomicity. */
export async function commitDefaultResume(
  preference: DefaultResumePreference, expected: DefaultResumePreference | null,
  current: () => boolean = () => true,
): Promise<DefaultResumePreference> {
  const value = schema.parse(preference), db = await database();
  const tx = db.transaction('preferences', 'readwrite');
  try {
    const stored = await tx.store.get('defaultResume');
    const parsed = stored === undefined ? null : schema.parse(stored);
    if (JSON.stringify(parsed) !== JSON.stringify(expected)) throw new Error('The default layout changed in another window. Review the current preference and try again.');
    if (!current()) throw new Error('The chosen source changed while saving its default. Review its current layout.');
    await tx.store.put(value, 'defaultResume');
    await tx.done;
    return value;
  } catch (reason) {
    try { tx.abort(); } catch { /* Transaction may already be complete or aborted. */ }
    await tx.done.catch(() => {});
    throw reason;
  } finally { db.close(); }
}

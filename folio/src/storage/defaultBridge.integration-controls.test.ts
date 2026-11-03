import 'fake-indexeddb/auto';
import { deleteDB, openDB } from 'idb';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { approvedControlProject, revisedControlProject } from '../ui/integrationControlFixture';
import { commitDefaultResume, defaultResumePreference, loadDefaultResume, preferenceMatches } from './templatePreferences';
import { migrateLegacyDefault, composerBridgeSource, freshComposerDefault } from './composerBridge';
import { loadComposerPreferences, saveComposerPreferences } from './composerPreferences';
import { loadPrivateProfile, savePrivateProfile } from './profile';
import { createApplication } from '../core/applications';
import { withdrawApproval } from '../core/commands';
import type { Project } from '../core/model';

let a: Project, b: Project;
const legacy = { selectedId: 'authored-selected', defaultId: 'authored-default' };
beforeEach(async () => { await deleteDB('folio-private-ui-v1'); a = await approvedControlProject('Control A'); b = await approvedControlProject('Control B'); });
afterEach(() => vi.restoreAllMocks());
async function seedIndependentKeys(choice: { selectedId: string | null; defaultId: string | null } = legacy) {
  await saveComposerPreferences(choice);
  const profile = await loadPrivateProfile(); await savePrivateProfile({ ...profile, name: 'Authored control profile' });
  return { composer: await loadComposerPreferences(), profile: await loadPrivateProfile() };
}
async function unchanged(keys: Awaited<ReturnType<typeof seedIndependentKeys>>) {
  expect(await loadComposerPreferences()).toEqual(keys.composer); expect(await loadPrivateProfile()).toEqual(keys.profile);
}

describe('real canonical preference transactions and conditional migration', () => {
  it('makes one verified canonical write only for absent canonical plus exact approved legacy default', async () => {
    const choice = { selectedId: b.id, defaultId: a.id }, keys = await seedIndependentKeys(choice), before = structuredClone([a, b]);
    const migrated = await migrateLegacyDefault([a, b], choice, null, id => [a, b].find(item => item.id === id), () => true);
    expect(migrated?.resumeProjectId).toBe(a.id); expect(await loadDefaultResume()).toEqual(migrated);
    expect(preferenceMatches(a, migrated!)).toBe(true); expect([a, b]).toEqual(before); await unchanged(keys);
  });
  it('does not let retained selection or a different legacy default replace an existing canonical record', async () => {
    const choice = { selectedId: a.id, defaultId: a.id }, keys = await seedIndependentKeys(choice), existing = await defaultResumePreference(b);
    await commitDefaultResume(existing, null);
    expect(await migrateLegacyDefault([a, b], choice, existing, () => a, () => true)).toEqual(existing);
    expect(await loadDefaultResume()).toEqual(existing); await unchanged(keys);
  });
  it('retains selected-only legacy state without manufacturing canonical absence fallback', async () => {
    const choice = { selectedId: b.id, defaultId: null }, keys = await seedIndependentKeys(choice);
    expect(await migrateLegacyDefault([a, b], choice, null, () => b, () => true)).toBeNull(); expect(await loadDefaultResume()).toBeNull();
    expect(freshComposerDefault([a, b], null, null, true, '', choice)).toBeUndefined(); await unchanged(keys);
  });
  it.each(['missing', 'unapproved', 'revised'] as const)('refuses %s legacy default and preserves unrelated keys', async kind => {
    const choice = { selectedId: b.id, defaultId: a.id }, keys = await seedIndependentKeys(choice), newer = await revisedControlProject(a);
    const projects = kind === 'missing' ? [b] : kind === 'unapproved' ? [withdrawApproval(a), b] : [a, b];
    await expect(migrateLegacyDefault(projects, choice, null, () => kind === 'revised' ? newer : projects[0], () => true)).rejects.toThrow();
    expect(await loadDefaultResume()).toBeNull(); await unchanged(keys);
  });
  it('serializes competing absent-key transactions so only one canonical choice wins', async () => {
    const keys = await seedIndependentKeys(), first = await defaultResumePreference(a), second = await defaultResumePreference(b);
    const outcomes = await Promise.allSettled([commitDefaultResume(first, null), commitDefaultResume(second, null)]);
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(result => result.status === 'rejected')).toHaveLength(1);
    const won = outcomes.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<typeof first>;
    expect(await loadDefaultResume()).toEqual(won.value); await unchanged(keys);
  });
  it('refuses a stale expected value without replacing canonical, composer or profile', async () => {
    const keys = await seedIndependentKeys(), first = await defaultResumePreference(a), next = await defaultResumePreference(b);
    await commitDefaultResume(first, null); await expect(commitDefaultResume(next, null)).rejects.toThrow('changed in another window');
    expect(await loadDefaultResume()).toEqual(first); await unchanged(keys);
  });
  it('aborts a lost source-owner guard before put and preserves all existing keys', async () => {
    const keys = await seedIndependentKeys(), first = await defaultResumePreference(a), next = await defaultResumePreference(b);
    await commitDefaultResume(first, null); await expect(commitDefaultResume(next, first, () => false)).rejects.toThrow('chosen source changed');
    expect(await loadDefaultResume()).toEqual(first); await unchanged(keys);
  });
  it('preserves canonical and independent keys when the actual transaction put fails', async () => {
    const keys = await seedIndependentKeys(), first = await defaultResumePreference(a), next = await defaultResumePreference(b);
    await commitDefaultResume(first, null);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Authored put refusal', 'QuotaExceededError'); });
    await expect(commitDefaultResume(next, first)).rejects.toThrow('Authored put refusal');
    expect(await loadDefaultResume()).toEqual(first); await unchanged(keys);
  });
  it('treats malformed canonical data as a read/write refusal, not a missing key', async () => {
    const keys = await seedIndependentKeys(), malformed = { version: 1, malformedControl: true };
    const db = await openDB('folio-private-ui-v1', 1); await db.put('preferences', malformed, 'defaultResume'); db.close();
    await expect(loadDefaultResume()).rejects.toThrow(); await expect(commitDefaultResume(await defaultResumePreference(a), null)).rejects.toThrow();
    const stored = await openDB('folio-private-ui-v1', 1); expect(await stored.get('preferences', 'defaultResume')).toEqual(malformed); stored.close(); await unchanged(keys);
  });
  it('uses full source/revision fingerprints and preserves explicit and pinned precedence without mutating any source', async () => {
    const canonical = await defaultResumePreference(a), explicit = await defaultResumePreference(b), newer = await revisedControlProject(a);
    expect(freshComposerDefault([newer, b], null, canonical, true, '', { selectedId: null, defaultId: null })).toBeUndefined();
    expect(composerBridgeSource([a, b], null, null, canonical, explicit, false, 'Authored read refusal', legacy)).toBe(b);
    const application = await createApplication(a); const before = structuredClone(application);
    expect(composerBridgeSource([newer, b], application, application.id, canonical, explicit, false, 'Authored read refusal', legacy)).toBe(application);
    expect(application).toEqual(before);
  });
});

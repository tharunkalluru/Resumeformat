import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { loadComposerPreferences, saveComposerPreferences } from './composerPreferences';
import { loadPrivateProfile, savePrivateProfile } from './profile';

beforeEach(async () => { await deleteDB('folio-private-ui-v1'); });
describe('private composer preferences', () => {
  it('persists selection and default without replacing independent profile data', async () => {
    const profile = await loadPrivateProfile();
    await Promise.all([saveComposerPreferences({ selectedId: 'resume-a', defaultId: 'resume-b' }), savePrivateProfile({ ...profile, name: 'Fictional Casey' })]);
    expect(await loadComposerPreferences()).toEqual({ selectedId: 'resume-a', defaultId: 'resume-b' });
    expect((await loadPrivateProfile()).name).toBe('Fictional Casey');
    await saveComposerPreferences({ selectedId: 'resume-b', defaultId: 'resume-b' });
    expect(await loadComposerPreferences()).toEqual({ selectedId: 'resume-b', defaultId: 'resume-b' });
  });
});

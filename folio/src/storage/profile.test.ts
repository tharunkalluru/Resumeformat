import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { deleteDB } from 'idb';
import { loadPrivateProfile, savePrivateProfile } from './profile';

beforeEach(async()=>{await deleteDB('folio-private-ui-v1');});
describe('atomic private profile persistence',()=>{
  it('preserves preference edits during concurrent activity writes and deduplicates restored receipts',async()=>{
    const original=await loadPrivateProfile();expect(original.name).toBe('');expect(original.events).toEqual([]);
    const event={id:'receipt',at:'2026-10-07T12:00:00.000Z',jobIdentity:'job-context',projectId:'app',company:'Fictional',title:'Engineer'};
    await Promise.all([savePrivateProfile({...original,name:'Casey Fixture',headline:'Designer',timeZone:'America/New_York'}),savePrivateProfile({...original,events:[event]},'activity')]);
    const latest=await loadPrivateProfile();expect(latest).toMatchObject({name:'Casey Fixture',headline:'Designer',timeZone:'America/New_York',events:[event]});
    await savePrivateProfile({...original,events:[event]},'activity');expect((await loadPrivateProfile()).events).toHaveLength(1);
  });
  it('does not erase known receipts on profile edits and keeps unknown history sticky',async()=>{
    const original=await loadPrivateProfile();const event={id:'receipt',at:'2026-10-07T12:00:00.000Z',jobIdentity:'job-context',projectId:'app',company:'Fixture',title:'Engineer'};
    await savePrivateProfile({...original,events:[event],historyUnavailable:true},'activity');
    await savePrivateProfile({...original,name:'Edited'});
    expect(await loadPrivateProfile()).toMatchObject({name:'Edited',events:[event],historyUnavailable:true});
    await expect(savePrivateProfile({...original,timeZone:'Not/AZone'})).rejects.toThrow();
    expect((await loadPrivateProfile()).name).toBe('Edited');
  });
});

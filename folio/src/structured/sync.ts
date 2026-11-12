import { regionClient, type RegionId } from '../auth/regions';
import { mergeResume, sameContent, type ResumeRecord } from './model';
import { deleteResume, listResumes, loadMemory, putResume, saveMemory } from './store';

/**
 * Signed-in users get a copy of their resumes in their own region's database, so the work follows
 * them to another device. One row per resume in public.resumes (schema_version 2); row-level
 * security limits each row to its account. Nothing is sent when the switch is off or signed out.
 * The switch is kept with the account (user metadata), so it holds on every device.
 */
const REMOVED = 'folio.sync.removed';
const removed = (): string[] => { try { return JSON.parse(window.localStorage.getItem(REMOVED) ?? '[]'); } catch { return []; } };
const setRemoved = (ids: string[]) => { try { window.localStorage.setItem(REMOVED, JSON.stringify(ids.slice(-200))); } catch { /* retried on the next delete */ } };

export interface Account { region: RegionId; user: string }
const accounts = new Map<string, string>();
async function accountId({ region, user }: Account): Promise<string> {
  const known = accounts.get(user);
  if (known) return known;
  const { data, error } = await regionClient(region).from('profiles').select('default_account_id').eq('user_id', user).single();
  if (error || !data?.default_account_id) throw new Error('account');
  accounts.set(user, data.default_account_id);
  return data.default_account_id;
}
const stripped = ({ synced: _synced, ...rest }: ResumeRecord) => rest;

export async function pushResume(account: Account, record: ResumeRecord): Promise<ResumeRecord> {
  const row = { id: record.id, account_id: await accountId(account), title: (record.base.name || record.sourceName || 'My resume').slice(0, 200), is_base: true, schema_version: 2, data: stripped(record), updated_at: record.updatedAt };
  const { error } = await regionClient(account.region).from('resumes').upsert(row);
  if (error) throw new Error('push');
  return { ...record, synced: { user: account.user, at: record.updatedAt } };
}
export async function removeRemote(account: Account, id: string): Promise<void> {
  setRemoved([...removed(), id]);
  const { error } = await regionClient(account.region).from('resumes').delete().eq('id', id);
  if (!error) setRemoved(removed().filter(item => item !== id));
}
/** Whether this account saves resumes to it. Asks the server, so a change made on another device is seen. */
export async function accountSaving(account: Account): Promise<boolean> {
  const { data, error } = await regionClient(account.region).auth.getUser();
  if (error || data.user?.id !== account.user) throw new Error('session');
  return data.user.user_metadata?.folio_sync !== 'off';
}
/** Removes every copy from the account. Local resumes are kept, on this device and the others. */
async function removeAllRemote(account: Account): Promise<void> {
  const { error } = await regionClient(account.region).from('resumes').delete().eq('account_id', await accountId(account)).in('schema_version', [2, 3]);
  if (error) throw new Error('remove');
  for (const record of await listResumes()) if (record.synced) { const { synced: _synced, ...rest } = record; await putResume(rest); }
  const memory = await loadMemory<{ synced?: unknown }>();
  if (memory?.synced) { const { synced: _synced, ...rest } = memory; await saveMemory(rest); }
}
export async function setAccountSaving(account: Account, on: boolean): Promise<void> {
  const { error } = await regionClient(account.region).auth.updateUser({ data: { folio_sync: on ? 'on' : 'off' } });
  if (error) throw new Error('switch');
  if (!on) await removeAllRemote(account);
}
/** Called when the switch turns out to be off: clears anything a device sent before it heard. */
export async function tidyAfterOff(account: Account): Promise<void> {
  if ((await listResumes()).some(record => record.synced?.user === account.user)) await removeAllRemote(account);
}

/** Brings this device and the account in line with each other and returns the result. */
export async function syncAll(account: Account): Promise<ResumeRecord[]> {
  const client = regionClient(account.region);
  for (const id of removed()) { const { error } = await client.from('resumes').delete().eq('id', id); if (!error) setRemoved(removed().filter(item => item !== id)); }
  const gone = new Set(removed());
  const { data, error } = await client.from('resumes').select('id, data').eq('schema_version', 2);
  if (error) throw new Error('pull');
  const remote = new Map((data ?? []).filter(row => row.data?.id === row.id && row.data?.base && !gone.has(row.id)).map(row => [row.id as string, row.data as ResumeRecord]));
  const local = new Map((await listResumes()).map(record => [record.id, record]));
  for (const [id, mine] of local) {
    const theirs = remote.get(id);
    if (theirs) continue;
    // In the account before, not any more: it was deleted on another device.
    if (mine.synced?.user === account.user) { await deleteResume(id); local.delete(id); }
    // Made on this device (for example before signing up): it joins the account now.
    else if (!mine.synced) { const saved = await pushResume(account, mine); await putResume(saved); local.set(id, saved); }
  }
  for (const [id, theirs] of remote) {
    const mine = local.get(id), merged = mine ? mergeResume(mine, theirs) : theirs;
    const saved = sameContent(merged, theirs) ? { ...merged, synced: { user: account.user, at: merged.updatedAt } } : await pushResume(account, merged);
    await putResume(saved); local.set(id, saved);
  }
  return [...local.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** On sign-out, copies that are safely in the account leave this browser; anything not yet saved there stays. */
export async function clearSyncedCopies(user: string): Promise<void> {
  for (const record of await listResumes()) if (record.synced?.user === user && record.synced.at >= record.updatedAt) await deleteResume(record.id);
  const memory = await loadMemory<{ updatedAt: string; synced?: { user: string; at: string } }>();
  if (memory?.synced?.user === user && memory.synced.at >= memory.updatedAt) await saveMemory(null);
}

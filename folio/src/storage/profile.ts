import { openDB } from 'idb';
import type { PrivateProfile } from '../core/activity';
import { z } from 'zod';
const schema = z.strictObject({ historyUnavailable: z.boolean().optional(), name: z.string().max(160), headline: z.string().max(240), timeZone: z.string().refine(value => { try { new Intl.DateTimeFormat('en', { timeZone: value }); return true; } catch { return false; } }), countingSince: z.string().datetime(), events: z.array(z.strictObject({ id: z.string().min(1).max(150), at: z.string().datetime(), jobIdentity: z.string().min(1).max(150), projectId: z.string().min(1).max(150), company: z.string().max(300), title: z.string().max(500) })).max(10000) });
const database = () => openDB('folio-private-ui-v1', 1, { upgrade(db) { db.createObjectStore('preferences'); } });
export async function loadPrivateProfile(): Promise<PrivateProfile> {
  const db = await database();
  try {
    const tx=db.transaction('preferences','readwrite');
    const saved = await tx.store.get('profile');
    if (saved) {await tx.done;return schema.parse(saved);}
    const profile = { name: '', headline: '', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', countingSince: new Date().toISOString(), events: [] };
    await tx.store.put(profile, 'profile');await tx.done;return profile;
  } finally { db.close(); }
}
export async function savePrivateProfile(profile: PrivateProfile, mode: 'preferences' | 'activity' = 'preferences'): Promise<PrivateProfile> {
  const value = schema.parse(profile), db = await database();
  try {
    const tx = db.transaction('preferences', 'readwrite');
    const stored = await tx.store.get('profile'), previous = stored ? schema.parse(stored) : value;
    const events = new Map(previous.events.map(event => [event.id,event]));
    for (const event of value.events) events.set(event.id,event);
    const next = schema.parse({...(mode === 'activity' ? previous : value), events:[...events.values()].sort((a,b)=>b.at.localeCompare(a.at)), countingSince:previous.countingSince<value.countingSince?previous.countingSince:value.countingSince, historyUnavailable:!!previous.historyUnavailable||!!value.historyUnavailable});
    await tx.store.put(next,'profile'); await tx.done; return next;
  } finally { db.close(); }
}


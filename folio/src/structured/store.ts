import { openDB } from 'idb';
import { fromV1, type ResumeRecord, type StructuredRecord } from './model';

/** Resumes and the jobs they were tailored for, kept in this browser. Signed-in users also get a copy in their account (see sync.ts). */
const database = () => openDB('folio-resumes-v2', 1, { upgrade(db) { db.createObjectStore('resumes', { keyPath: 'id' }); } });
const MIGRATED = 'folio.resumes.migrated';

/** Brings over resumes saved by the first template workspace. The old copies are left in place. */
async function migrate(): Promise<void> {
  try {
    if (window.localStorage.getItem(MIGRATED)) return;
    // Where the browser can't list databases, opening the old one is harmless: it is simply empty.
    const names = indexedDB.databases ? await indexedDB.databases().catch(() => null) : null;
    if (!names || names.some(item => item.name === 'folio-structured-v1')) {
      const old = await openDB('folio-structured-v1', 1, { upgrade(db) { if (!db.objectStoreNames.contains('resumes')) db.createObjectStore('resumes', { keyPath: 'projectId' }); } });
      const rows = await old.getAll('resumes') as StructuredRecord[]; old.close();
      const db = await database(), tx = db.transaction('resumes', 'readwrite');
      await Promise.all([...rows.map(row => tx.store.put(fromV1(row))), tx.done]);
    }
    window.localStorage.setItem(MIGRATED, '1');
  } catch { /* try again next time */ }
}
let ready: Promise<void> | null = null;
const prepared = () => (ready ??= migrate());

const normal = (record: ResumeRecord): ResumeRecord => ({ ...record, template: record.template ?? 'classic', jobs: record.jobs ?? [], deletedJobs: record.deletedJobs ?? [] });

export async function listResumes(): Promise<ResumeRecord[]> {
  await prepared();
  try { return ((await (await database()).getAll('resumes')) as ResumeRecord[]).map(normal).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); } catch { return []; }
}
export async function putResume(record: ResumeRecord): Promise<void> { await (await database()).put('resumes', record); }
export async function deleteResume(id: string): Promise<void> {
  try { await (await database()).delete('resumes', id); } catch { /* nothing stored */ }
}

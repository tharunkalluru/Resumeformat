import { openDB } from 'idb';
import type { StructuredRecord } from './model';

/** Sectioned resumes live beside the project library, keyed by the project they were read from. */
const database = () => openDB('folio-structured-v1', 1, { upgrade(db) { db.createObjectStore('resumes', { keyPath: 'projectId' }); } });

export async function loadStructured(projectId: string): Promise<StructuredRecord | null> {
  try { return (await (await database()).get('resumes', projectId)) ?? null; } catch { return null; }
}
export async function saveStructured(record: StructuredRecord): Promise<void> {
  await (await database()).put('resumes', { ...record, updatedAt: new Date().toISOString() });
}
export async function deleteStructured(projectId: string): Promise<void> {
  try { await (await database()).delete('resumes', projectId); } catch { /* nothing stored */ }
}
export async function listStructured(): Promise<StructuredRecord[]> {
  try { return ((await (await database()).getAll('resumes')) as StructuredRecord[]).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); } catch { return []; }
}

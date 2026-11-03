import { openDB } from 'idb';
import { emptyComposerPreferences, type ComposerPreferences } from '../core/composerSources';

const database = () => openDB('folio-private-ui-v1', 1, { upgrade(db) { db.createObjectStore('preferences'); } });
function parse(value: unknown): ComposerPreferences {
  if (!value || typeof value !== 'object') return emptyComposerPreferences();
  const item = value as Record<string, unknown>;
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 150 ? value : null;
  return { selectedId: id(item.selectedId), defaultId: id(item.defaultId) };
}
export async function loadComposerPreferences(): Promise<ComposerPreferences> {
  const db = await database();
  try { return parse(await db.get('preferences', 'composer')); } finally { db.close(); }
}
export async function saveComposerPreferences(preferences: ComposerPreferences): Promise<void> {
  const db = await database();
  try { await db.put('preferences', parse(preferences), 'composer'); } finally { db.close(); }
}

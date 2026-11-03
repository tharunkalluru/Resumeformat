import {hasOriginalCff,hasPermittedOriginalTrueType} from '../core/model';
import {validateSelectedOriginalFonts} from '../import/pdf-selected-fonts';
import {validateSourceColorProfiles} from '../import/pdf-icc';
import type {SourceFontAsset} from '../core/model';
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import JSZip from 'jszip';
import { FolioError } from '../core/errors';
import { canonicalJson, hashJson, MAX_SOURCE_BYTES, newId, sha256, workspaceOf } from '../core/model';
import type { GroupState, JobContext, Project } from '../core/model';
import { groupStateSchema, validateProject } from '../core/schema';
import { createApplication } from '../core/applications';
import { readBoundedArchive } from '../import/zip';
import { inspectZip } from '../import/zipCodec';
import { clearSourceFontCache } from '../layout/source-fonts';
import { validateOriginalPrograms } from '../import/pdf-original-tt';
import { validateSourceRulePaint } from '../import/pdf-source-rules';
import { validateSourceImagePaint } from '../import/pdf-source-images';
import { validateSourceScopedPaint } from '../import/pdf-scoped-source';
import { packScopedMetadata, unpackScopedMetadata } from '../core/source-scoped-codec';
import { packRecordMetadata, unpackRecordMetadata } from '../core/project-record-codec';
import {inspectLegacyArchive,preserveLegacyArchive,type LegacyArchiveSummary,type VerifiedOriginal} from './legacyArchives';

const DATABASE = 'folio-local-v1';
const knownRevisions = new Map<string, number>();
const knownMemoryRevisions = new Map<string, number | undefined>();
const knownEpochs = new Map<string, number>();
const removedIds = new Set<string>();
const loadedCheckpoints = new WeakMap<Project, { revision: number; memoryRevision: number | undefined; epoch: number }>();
/** Only an explicit open/reload adopts a library read as the next writer base. */
export function adoptProjectCheckpoint(project: Project): void {
  const checkpoint = loadedCheckpoints.get(project); if (!checkpoint) return;
  const groupId = workspaceOf(project).templateGroupId;
  if (checkpoint.revision < (knownRevisions.get(project.id) ?? 0) || checkpoint.epoch < (knownEpochs.get(groupId) ?? 0)) return;
  knownRevisions.set(project.id,checkpoint.revision); knownMemoryRevisions.set(project.id,checkpoint.memoryRevision); knownEpochs.set(groupId,checkpoint.epoch);
}
export interface GroupChange { templateGroupId: string; epoch: number; state: GroupState['state'] }
let channel: BroadcastChannel | undefined;
const subscribers = new Set<(change: GroupChange) => void>();
export function subscribeGroupChanges(listener: (change: GroupChange) => void): () => void {
  subscribers.add(listener);
  if (!channel && typeof BroadcastChannel !== 'undefined') { channel = new BroadcastChannel('folio-group-state-v2'); channel.onmessage = event => { const value = event.data as GroupChange; if (value && typeof value.templateGroupId === 'string' && value.templateGroupId.length <= 150 && Number.isInteger(value.epoch) && value.epoch > 0 && ['active','resumeRemoved','deleted'].includes(value.state)) for (const callback of subscribers) callback({ templateGroupId: value.templateGroupId, epoch: value.epoch, state: value.state }); }; }
  return () => { subscribers.delete(listener); if (!subscribers.size) { channel?.close(); channel = undefined; } };
}
function announce(state: GroupState) { channel?.postMessage({ templateGroupId: state.templateGroupId, epoch: state.epoch, state: state.state }); }
function remember(project: Project, epoch: number) { knownRevisions.set(project.id, project.revision); knownMemoryRevisions.set(project.id, project.careerMemory?.revision); knownEpochs.set(workspaceOf(project).templateGroupId, epoch); }
async function checkedProject(project: Project): Promise<Project> {
  const valid = validateProject(structuredClone(project));
  if((valid.template.sourceFonts?.length||valid.template.sourceStandardFonts?.length) && new TextEncoder().encode(JSON.stringify(metadata(valid))).length>2*1024*1024)throw new FolioError('SOURCE_FONT_METADATA_LIMIT','The positioned source font document exceeds the 2 MiB metadata limit. No data was omitted.');
  if(valid.source.format==='pdf')await (await import('../import/pdf-composite')).validateCompositeSourceClass(valid);
  if(valid.template.sourceCompositePages){await (await import('../import/pdf-composite')).validateCompositeProject(valid);}else{
  if(valid.source.format==='pdf')await (await import('../import/pdf-standard-native')).validateStandard14Source(valid,true);
  await validateSourceColorProfiles(valid.source.bytes,valid.template);
  await validateOriginalPrograms(valid.source.bytes, valid.template.sourceFonts ?? [], valid.template);
  await validateSelectedOriginalFonts(valid.source.bytes,valid.template);
  await validateSourceRulePaint(valid.source.bytes, valid.template);
  if (valid.source.format === 'pdf') await validateSourceImagePaint(valid.source.bytes, valid.template, valid.assets);
  await validateSourceScopedPaint(valid.source.bytes, valid.template, valid.assets);
  if(hasOriginalCff(valid.template)||hasPermittedOriginalTrueType(valid.template)||valid.template.sourceColorProfile||valid.template.sourceFonts?.some(font=>font.sourceVersion===7||font.sourceVersion===8)){const {validateDocumentScopedBaseline}=await import('../import/document-scoped-baseline');await validateDocumentScopedBaseline(valid);}
  }
  for (const source of valid.careerMemory?.sources ?? []) if (source.bytes && await sha256(source.bytes) !== source.sha256) throw new FolioError('SOURCE_CHECKSUM', 'A Career Memory original failed its integrity check. The saved record was not changed.');
  return valid;
}
function metadata(project: Project): unknown { return packRecordMetadata(packScopedMetadata({ ...project, source: { ...project.source, bytes: undefined }, assets: project.assets.map(asset => ({ ...asset, bytes: undefined })), template: { ...project.template,...(project.template.sourceStandardFonts?{sourceStandardFonts:project.template.sourceStandardFonts.map(f=>({...f,nativeAdapter:{...f.nativeAdapter,bytes:undefined}}))}:{}),...(project.template.sourceColorProfile?{sourceColorProfile:{...project.template.sourceColorProfile,bytes:undefined}}:{}), ...(project.template.sourceFonts ? {sourceFonts:project.template.sourceFonts.map(font=>({...font,bytes:undefined,...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:undefined}}:{})}))}: {}) }, ...(project.careerMemory ? { careerMemory: { ...project.careerMemory, sources: project.careerMemory.sources.map(source => ({ ...source, bytes: undefined })) } } : {}) })); }
const saves = new Map<string, Promise<void>>();
let databasePromise: Promise<IDBPDatabase> | undefined;
const db = () => databasePromise ??= openDB(DATABASE, 2, { upgrade(database) { if (!database.objectStoreNames.contains('projects')) database.createObjectStore('projects', { keyPath: 'id' }); if (!database.objectStoreNames.contains('groupState')) database.createObjectStore('groupState', { keyPath: 'templateGroupId' }); } });
export async function getGroupState(templateGroupId: string): Promise<GroupState> { const database = await db(), stored = await database.get('groupState', templateGroupId); return stored ? groupStateSchema.parse(stored) : { templateGroupId, epoch: 1, state: 'active', changedAt: new Date().toISOString() }; }

export interface UnavailableProject { key: IDBValidKey; name: string; reason: string }
export async function loadLibrary(): Promise<{ projects: Project[]; unavailable: UnavailableProject[] }> {
  const database = await db();
  const transaction = database.transaction(['projects','groupState'], 'readonly');
  const [raw, keys, rawStates] = await Promise.all([transaction.objectStore('projects').getAll(), transaction.objectStore('projects').getAllKeys(), transaction.objectStore('groupState').getAll()]);
  const states = new Map((rawStates as GroupState[]).map(state => [state.templateGroupId,state]));
  await transaction.done;
  const projects: Project[] = [], unavailable: UnavailableProject[] = [];
  for (let index = 0; index < raw.length; index++) {
    try {
      const project = await checkedProject(raw[index]);
      if (project.id !== keys[index]) throw new Error('Stored identity does not match its key');
      const groupId = workspaceOf(project).templateGroupId, storedState = states.get(groupId), state = storedState ? groupStateSchema.parse(storedState) : { templateGroupId: groupId, epoch: 1, state: 'active' as const, changedAt: new Date().toISOString() };
      if (state.state === 'deleted' || state.state === 'resumeRemoved' && workspaceOf(project).kind === 'resume') throw new Error('Saved record contradicts group deletion state');
      loadedCheckpoints.set(project,{ revision:project.revision,memoryRevision:project.careerMemory?.revision,epoch:state.epoch });
      if (!knownRevisions.has(project.id)) { knownRevisions.set(project.id,project.revision); knownMemoryRevisions.set(project.id,project.careerMemory?.revision); if (!knownEpochs.has(groupId)) knownEpochs.set(groupId,state.epoch); }
      projects.push(project);
    } catch {
      const record = raw[index] as { name?: unknown; schemaVersion?: unknown } | null;
      unavailable.push({ key: keys[index], name: typeof record?.name === 'string' ? record.name.slice(0, 500) : 'Unavailable saved resume', reason: typeof record?.schemaVersion === 'number' && record.schemaVersion !== 1 ? 'This saved version is not supported.' : 'This saved record could not be validated.' });
    }
  }
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { projects, unavailable };
}
export async function loadProjects(): Promise<Project[]> { return (await loadLibrary()).projects; }
/** Reads only retained source bytes; unavailable layout metadata grants no authority. */
export async function unavailableOriginal(key:IDBValidKey):Promise<VerifiedOriginal>{
 const raw=await(await db()).get('projects',key),source=raw?.source;
 if(!source||!['pdf','docx'].includes(source.format)||!(source.bytes instanceof Uint8Array)||source.bytes.length>MAX_SOURCE_BYTES||!source.bytes.length||typeof source.sha256!=='string'||await sha256(source.bytes)!==source.sha256)throw new FolioError('SOURCE_CHECKSUM','The saved original could not be verified. Download recovery data and choose the original file again.');
 const name=typeof source.name==='string'?source.name.slice(0,500):'Retained original';
 return {file:new File([new Uint8Array(source.bytes)],name,{type:source.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),sha256:source.sha256,name:typeof raw.name==='string'?raw.name.slice(0,500):name};
}
/** Raw recovery is separate from validated Folio backups; never mutate the record. */
export async function backupUnavailableProject(key: IDBValidKey): Promise<Blob> {
  try {
    const database = await db(), raw: unknown = await database.get('projects', key);
    if (raw === undefined) throw new FolioError('RECOVERY_MISSING', 'This saved record is no longer on this device.');
    const zip = new JSZip(); let binaryCount = 0, expanded = 0;
    const metadata = JSON.stringify(raw, function (name, value: unknown) {
      const original: unknown = name ? this[name] : value;
      if (original instanceof Date || original instanceof Blob || original instanceof Map || original instanceof Set || original instanceof RegExp) throw new Error('Unsupported recovery value');
      if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
        const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        expanded += bytes.byteLength;
        if (expanded > 50 * 1024 * 1024) throw new Error('Recovery data exceeds the export limit');
        const path = `binary/${++binaryCount}.bin`; zip.file(path, bytes);
        return { recoveryBinary: path, type: value.constructor.name };
      }
      if (typeof value === 'bigint' || typeof value === 'number' && !Number.isFinite(value)) return { recoveryValue: String(value), type: typeof value };
      if (value === undefined) return { recoveryValue: 'undefined', type: 'undefined' };
      return value;
    }, 2);
    if (new TextEncoder().encode(metadata).byteLength > 8 * 1024 * 1024) throw new Error('Recovery metadata exceeds the export limit');
    zip.file('record.json', metadata);
    zip.file('README.txt', 'Raw recovery data from an unavailable Folio saved record. The stored record remains unchanged. This is not a validated Folio backup and cannot be restored directly in the app. record.json retains metadata; binary references point to unchanged bytes in binary/. Keep this file private.');
    const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
  } catch (error) {
    if (error instanceof FolioError) throw error;
    throw new FolioError('RECOVERY_FAILED', 'Recovery data could not be exported safely. The saved record remains unchanged on this device.');
  }
}
export async function saveProject(project: Project): Promise<void> {
  const snapshot = await checkedProject(project);
  const prior = saves.get(project.id) ?? Promise.resolve();
  const operation = prior.catch(() => {}).then(async () => {
    const database = await db(), groupId = workspaceOf(snapshot).templateGroupId;
    const transaction = database.transaction(['projects', 'groupState'], 'readwrite'), projects = transaction.objectStore('projects'), groups = transaction.objectStore('groupState');
    const reject = async (code: string, message: string): Promise<never> => { transaction.abort(); await transaction.done.catch(() => {}); throw new FolioError(code, message); };
    const stored = await projects.get(snapshot.id) as Project | undefined, rawState = await groups.get(groupId);
    const state: GroupState = rawState ? groupStateSchema.parse(rawState) : { templateGroupId: groupId, epoch: 1, state: snapshot.memorySnapshot && !stored ? 'resumeRemoved' : 'active', changedAt: new Date().toISOString() };
    if (state.state === 'deleted' || removedIds.has(snapshot.id) || knownEpochs.has(groupId) && state.epoch !== knownEpochs.get(groupId)) return reject('SAVE_CONFLICT', 'This resume group was removed or changed in another tab. Download a backup of your edits before reloading.');
    if (workspaceOf(snapshot).kind === 'resume' && state.state !== 'active') return reject('SAVE_CONFLICT', 'The reusable resume was removed. It was not recreated.');
    if (!stored && rawState && workspaceOf(snapshot).kind === 'application' && state.state === 'resumeRemoved') return reject('SAVE_CONFLICT', 'The reusable resume was removed. New applications cannot be added to this group.');
    if (!stored && rawState && snapshot.memorySnapshot && state.state === 'active') { const primary = await projects.get(snapshot.memorySnapshot.sourceResumeId) as Project | undefined; if (!primary || workspaceOf(primary).kind !== 'resume' || workspaceOf(primary).templateGroupId !== groupId || primary.revision !== snapshot.memorySnapshot.sourceResumeRevision || primary.careerMemory?.revision !== snapshot.memorySnapshot.memoryRevision) return reject('APPLICATION_CONFLICT', 'This application snapshot does not match the current saved reusable resume and Career Memory.'); }
    const expected = knownRevisions.get(snapshot.id);
    if (expected !== undefined && !stored) return reject('SAVE_CONFLICT', 'This record was removed in another tab. Download a backup of your open edits; it was not recreated.');
    if (stored) {
      try { validateProject(stored); } catch { return reject('SAVE_CONFLICT', 'This saved record is unavailable. Download recovery data before repairing it; it was not overwritten.'); }
      if (stored.revision !== expected || stored.careerMemory?.revision !== knownMemoryRevisions.get(snapshot.id)) return reject('SAVE_CONFLICT', 'This project changed in another tab. Download a backup of your edits before reloading.');
      if (snapshot.revision < stored.revision || snapshot.careerMemory && stored.careerMemory && snapshot.careerMemory.revision < stored.careerMemory.revision) return reject('STALE_SAVE', 'A newer revision is already saved.');
      if (snapshot.revision === stored.revision && canonicalJson(metadata(snapshot)) !== canonicalJson(metadata(validateProject(stored)))) return reject('STALE_SAVE', 'Changed content requires a new project revision.');
    }
    try { await projects.put(snapshot); if (!rawState) await groups.put(state); await transaction.done; } catch (error) { try { transaction.abort(); } catch { /* already aborted */ } await transaction.done.catch(() => {}); throw error; }
    remember(snapshot, state.epoch); announce(state);
  }).catch(error => { if (error instanceof FolioError) throw error; throw new FolioError('SAVE_FAILED', 'Device storage could not save this revision. Keep this page open and download a backup.'); });
  saves.set(project.id, operation);
  try { await operation; } finally { if (saves.get(project.id) === operation) saves.delete(project.id); }
}
/** Exact saved memory checkpoint and application commit are checked in one transaction. */
export async function createSavedApplication(resume: Project, job: JobContext): Promise<Project> {
  await saveProject(resume);
  const candidate = await checkedProject(await createApplication(resume, job));
  const database = await db(), groupId = workspaceOf(resume).templateGroupId, epoch = knownEpochs.get(groupId)!;
  const transaction = database.transaction(['projects','groupState'], 'readwrite'), projects = transaction.objectStore('projects'), groups = transaction.objectStore('groupState');
  const durable = await projects.get(resume.id) as Project | undefined, state = await groups.get(groupId) as GroupState | undefined;
  if (!durable || !state || state.state !== 'active' || state.epoch !== epoch || durable.revision !== resume.revision || durable.careerMemory?.revision !== resume.careerMemory?.revision) {
    transaction.abort(); await transaction.done.catch(() => {}); throw new FolioError('APPLICATION_CONFLICT', 'The reusable resume or Career Memory changed before this application could be saved. Reload its saved version and try again.');
  }
  try { validateProject(durable); await projects.add(candidate); await transaction.done; } catch (error) { try { transaction.abort(); } catch { /* already aborted */ } await transaction.done.catch(() => {}); throw error instanceof FolioError ? error : new FolioError('SAVE_FAILED', 'Device storage could not save this application. Your reusable resume remains saved.'); }
  remember(candidate, epoch); announce(state); return candidate;
}
export async function removeProject(id: string): Promise<void> {
  await saves.get(id)?.catch(() => {});
  const database = await db(), transaction = database.transaction(['projects','groupState'], 'readwrite'), projects = transaction.objectStore('projects'), groups = transaction.objectStore('groupState');
  const project = await projects.get(id) as Project | undefined;
  if (project) {
    const groupId = workspaceOf(project).templateGroupId, raw = await groups.get(groupId) as GroupState | undefined;
    if (knownRevisions.has(id) && project.revision !== knownRevisions.get(id) || raw && knownEpochs.has(groupId) && raw.epoch !== knownEpochs.get(groupId)) { transaction.abort(); await transaction.done.catch(() => {}); throw new FolioError('DELETE_CONFLICT', 'This record changed in another tab. Reload before deleting it.'); }
    const state: GroupState = { templateGroupId: groupId, epoch: (raw?.epoch ?? 1) + (workspaceOf(project).kind === 'resume' ? 1 : 0), state: workspaceOf(project).kind === 'resume' ? 'resumeRemoved' : raw?.state ?? 'active', changedAt: new Date().toISOString() };
    try { await projects.delete(id); await groups.put(state); await transaction.done; } catch (error) { try { transaction.abort(); } catch { /* already aborted */ } await transaction.done.catch(() => {}); throw new FolioError('DELETE_FAILED', 'This record could not be removed. Saved records remain unchanged.'); }
    knownEpochs.set(groupId,state.epoch); announce(state);
  } else await transaction.done;
  clearSourceFontCache(project?.template.sourceFonts?.map(font=>font.id) ?? []);
  removedIds.add(id); // Keep the deletion guard for queued callbacks in this process.
}
export interface GroupRemovalPlan { templateGroupId: string; epoch: number; projects: { id: string; revision: number; name: string; kind: 'resume' | 'application' }[] }
export async function previewGroupRemoval(templateGroupId: string): Promise<GroupRemovalPlan> { const database = await db(), transaction = database.transaction(['projects','groupState'], 'readonly'); const records = await transaction.objectStore('projects').getAll() as Project[], raw = await transaction.objectStore('groupState').get(templateGroupId) as GroupState | undefined; await transaction.done; return { templateGroupId, epoch: raw?.epoch ?? 1, projects: records.filter(project => workspaceOf(project).templateGroupId === templateGroupId).map(project => ({ id: project.id, revision: project.revision, name: typeof project.name === 'string' ? project.name.slice(0,500) : 'Unavailable saved record', kind: workspaceOf(project).kind })).sort((a,b) => a.id.localeCompare(b.id)) }; }
export async function removeGroup(templateGroupId: string, expectedPlan?: GroupRemovalPlan): Promise<void> {
  const database = await db(), transaction = database.transaction(['projects','groupState'], 'readwrite'), projects = transaction.objectStore('projects'), groups = transaction.objectStore('groupState');
  const raw = await groups.get(templateGroupId) as GroupState | undefined;
  if (raw && knownEpochs.has(templateGroupId) && raw.epoch !== knownEpochs.get(templateGroupId)) { transaction.abort(); await transaction.done.catch(() => {}); throw new FolioError('DELETE_CONFLICT', 'This group changed in another tab. Reload before removing it.'); }
  const records = await projects.getAll() as Project[], affected = records.filter(project => workspaceOf(project).templateGroupId === templateGroupId);
  if (expectedPlan && (expectedPlan.templateGroupId !== templateGroupId || expectedPlan.epoch !== (raw?.epoch ?? 1) || canonicalJson(expectedPlan.projects.map(project => ({ id: project.id, revision: project.revision })).sort((a,b) => a.id.localeCompare(b.id))) !== canonicalJson(affected.map(project => ({ id: project.id, revision: project.revision })).sort((a,b) => a.id.localeCompare(b.id))))) { transaction.abort(); await transaction.done.catch(() => {}); throw new FolioError('DELETE_CONFLICT', 'The resume group changed after the removal preview. Review its current removal scope before confirming.'); }
  const state: GroupState = { templateGroupId, epoch: (raw?.epoch ?? 1) + 1, state: 'deleted', changedAt: new Date().toISOString() };
  try { for (const project of affected) await projects.delete(project.id); await groups.put(state); await transaction.done; } catch (error) { try { transaction.abort(); } catch { /* already aborted */ } await transaction.done.catch(() => {}); throw new FolioError('DELETE_FAILED', 'The group could not be removed. Its saved records remain unchanged.'); }
  for (const project of affected) { removedIds.add(project.id); clearSourceFontCache(project.template.sourceFonts?.map(font=>font.id) ?? []); }
  knownEpochs.set(templateGroupId, state.epoch); announce(state);
}

interface BackupManifest { schemaVersion: 1; format: 'folio'; files: { path: string; sha256: string; size: number }[] }
export async function backupProject(project: Project): Promise<Blob> {
  const valid = await checkedProject(project);
  if (valid.careerMemory) throw new FolioError('GROUP_BACKUP_REQUIRED', 'Career Memory and supporting originals require a full resume group backup.');
  const zip = new JSZip();
  const manifest: BackupManifest = { schemaVersion: 1, format: 'folio', files: [] };
  let expandedSize = 0;
  const add = async (path: string, value: Uint8Array) => {
    if (!/^(project\.json|source\.(pdf|docx)|assets\/[a-zA-Z0-9-]+\.bin|(?:fonts\/[0-9]+(?:\.original)?\.bin|standard-fonts\/[0-9]+\.bin)|colors\/0\.icc)$/.test(path)) throw new FolioError('BACKUP_INVALID', 'A project attachment has an unsupported backup identity. Use a full group backup to preserve it.');
    expandedSize += value.byteLength;
    if (manifest.files.length >= 63 || value.byteLength > MAX_SOURCE_BYTES || expandedSize > 50 * 1024 * 1024 || path === 'project.json' && value.byteLength > 2 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'This project exceeds the local backup limits. Your saved project remains on this device.');
    zip.file(path, value);
    manifest.files.push({ path, sha256: await sha256(value), size: value.byteLength });
  };
  await add(`source.${valid.source.format}`, valid.source.bytes);
  for (const asset of valid.assets) await add(`assets/${asset.id}.bin`, asset.bytes);
  for (const [index,font] of (valid.template.sourceFonts ?? []).entries()) { await add(`fonts/${index}.bin`,font.bytes); if('originalProgram'in font&&font.originalProgram)await add(`fonts/${index}.original.bin`,font.originalProgram.bytes); }
  for(const [index,f] of (valid.template.sourceStandardFonts??[]).entries())await add(`standard-fonts/${index}.bin`,f.nativeAdapter.bytes);
  if(valid.template.sourceColorProfile)await add('colors/0.icc',valid.template.sourceColorProfile.bytes);
  const json = metadata(valid);
  await add('project.json', new TextEncoder().encode(JSON.stringify(json)));
  zip.file('manifest.json', JSON.stringify(manifest));
  const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  if (bytes.byteLength > 20 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'This backup exceeds the 20 MiB restore limit. Your saved project remains on this device.');
  inspectZip(bytes);
  return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
}

async function restoreChecked(file: File, suppliedEntries?: Map<string, Uint8Array>): Promise<Project> {
  if (file.size > 20 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'The backup exceeds the 20 MiB local restore limit.');
  const entries = suppliedEntries ?? await readBoundedArchive(new Uint8Array(await file.arrayBuffer()), 20 * 1024 * 1024);
  if (entries.size > 64 || [...entries.keys()].some(name => !/^(manifest\.json|project\.json|source\.(pdf|docx)|assets\/[a-zA-Z0-9-]+\.bin|(?:fonts\/[0-9]+(?:\.original)?\.bin|standard-fonts\/[0-9]+\.bin)|colors\/0\.icc)$/.test(name))) throw new FolioError('BACKUP_INVALID', 'The archive is not a valid Folio backup.');
  const rawManifest = entries.get('manifest.json');
  if (!rawManifest) throw new FolioError('BACKUP_INVALID', 'This archive has no Folio manifest.');
  if (rawManifest.length > 64000) throw new FolioError('BACKUP_INVALID', 'The backup manifest is too large.');
  const manifest = JSON.parse(new TextDecoder().decode(rawManifest)) as BackupManifest;
  if (manifest.schemaVersion !== 1 || manifest.format !== 'folio' || !Array.isArray(manifest.files) || manifest.files.length > 63) throw new FolioError('BACKUP_VERSION', 'This backup version is unsupported. The current project is unchanged.');
  const files = new Map<string, Uint8Array>();
  let total = 0;
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || files.has(item.path) || !/^(project\.json|source\.(pdf|docx)|assets\/[a-zA-Z0-9-]+\.bin|(?:fonts\/[0-9]+(?:\.original)?\.bin|standard-fonts\/[0-9]+\.bin)|colors\/0\.icc)$/.test(item.path) || !Number.isInteger(item.size) || item.size < 0 || item.size > MAX_SOURCE_BYTES) throw new FolioError('BACKUP_INVALID', 'A backup entry is invalid.');
    total += item.size;
    if (total > 50 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'The expanded backup exceeds 50 MiB.');
    const bytes = entries.get(item.path);
    if (!bytes) throw new FolioError('BACKUP_INVALID', 'A backup asset is missing.');
    if (bytes.byteLength !== item.size || await sha256(bytes) !== item.sha256) throw new FolioError('BACKUP_CHECKSUM', 'A backup asset failed its integrity check.');
    files.set(item.path, bytes);
  }
  if (files.size + 1 !== entries.size) throw new FolioError('BACKUP_INVALID', 'The backup contains an unlisted entry.');
  const projectBytes = files.get('project.json');
  if (!projectBytes || projectBytes.byteLength > 2 * 1024 * 1024) throw new FolioError('BACKUP_INVALID', 'The backup project data is missing or too large.');
  const decoded = unpackScopedMetadata(unpackRecordMetadata(JSON.parse(new TextDecoder().decode(projectBytes)))) as Project;
  decoded.source.bytes = files.get(`source.${decoded.source.format}`)!;
  decoded.assets = decoded.assets.map(asset => ({ ...asset, bytes: files.get(`assets/${asset.id}.bin`)! }));
  if(decoded.template.sourceStandardFonts)decoded.template.sourceStandardFonts=decoded.template.sourceStandardFonts.map((f,index)=>({...f,nativeAdapter:{...f.nativeAdapter,bytes:files.get(`standard-fonts/${index}.bin`)!}}));
  if(decoded.template.sourceFonts)decoded.template.sourceFonts=decoded.template.sourceFonts.map((font,index)=>({...font,bytes:files.get(`fonts/${index}.bin`)!,...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:files.get(`fonts/${index}.original.bin`)!}}:{})} as SourceFontAsset));
  if(decoded.template.sourceColorProfile)decoded.template.sourceColorProfile.bytes=files.get('colors/0.icc')!;
  if(files.has('colors/0.icc')!==!!decoded.template.sourceColorProfile)throw new FolioError('BACKUP_INVALID','A color profile attachment has no owner.');
  if([...files.keys()].filter(path=>path.startsWith('fonts/')).length!==(decoded.template.sourceFonts?.reduce((count,font)=>count+1+('originalProgram'in font&&font.originalProgram?1:0),0)??0))throw new FolioError('BACKUP_INVALID','A source font attachment has no owner.');
  if([...files.keys()].filter(path=>path.startsWith('standard-fonts/')).length!==(decoded.template.sourceStandardFonts?.length??0))throw new FolioError('BACKUP_INVALID','A standard native font attachment has no owner.');
  if(['folio-import-v16','folio-import-v17','folio-import-v18','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31'].includes(decoded.template.importerVersion)||decoded.template.sourceFonts?.some(f=>f.sourceVersion===7)){decoded.approval=null;decoded.reviewedDraftRevision=null;}
  const project = await checkedProject(decoded);
  if(['folio-import-v16','folio-import-v17','folio-import-v18','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31'].includes(project.template.importerVersion)||project.template.sourceFonts?.some(f=>f.sourceVersion===7)){project.approval=null;project.reviewedDraftRevision=null;}
  if (project.careerMemory) throw new FolioError('BACKUP_INVALID', 'Canonical Career Memory requires a complete Folio group backup.');
  if (await sha256(project.source.bytes) !== project.source.sha256) throw new FolioError('BACKUP_CHECKSUM', 'The original source checksum does not match.');
  if (project.approval && (await hashJson(project.template) !== project.approval.layoutHash || await hashJson(project.baseline.blocks) !== project.approval.baselineHash)) project.approval = null;
  const restoredId = newId();
  if (project.memorySnapshot) { const sourceResumeId = newId(); return validateProject({ ...project, id: restoredId, workspace: { templateGroupId: restoredId, kind: 'application' }, memorySnapshot: { ...project.memorySnapshot, id: newId(), templateGroupId: restoredId, sourceResumeId, memoryHash: await hashJson({ priorMemoryHash: project.memorySnapshot.memoryHash, templateGroupId: restoredId, sourceResumeId }) }, revision: 1, reviewedDraftRevision: null, updatedAt: new Date().toISOString() }); }
  return { ...project, id: restoredId, workspace: { templateGroupId: restoredId, kind: 'resume' }, name: `${project.name.slice(0, 489)} (restored)`, revision: 1, reviewedDraftRevision: null, updatedAt: new Date().toISOString() };
}
export async function restoreProject(file: File): Promise<Project> {
  try { return await restoreChecked(file); }
  catch (error) {
    if (error instanceof FolioError) throw error;
    throw new FolioError('BACKUP_INVALID', 'This backup could not be read or validated. Your current project is unchanged.');
  }
}

interface GroupManifest extends Omit<BackupManifest, 'format'> {
  format: 'folio-group'; templateGroupId: string; projects: { id: string; path: string }[];
}
const groupPath = /^(projects\/[0-9]+\/(project\.json|source\.(pdf|docx)|assets\/[0-9]+\.bin|memory\/[0-9]+\.bin|(?:fonts\/[0-9]+(?:\.original)?\.bin|standard-fonts\/[0-9]+\.bin)|colors\/0\.icc))$/;
/** A complete group export includes live memory, originals, versions, drafts and every supplied application. */
export async function backupResumeGroup(input: readonly Project[], expectedGroupId?: string): Promise<Blob> {
  const projects = await Promise.all(input.map(checkedProject));
  if (!projects.length) throw new FolioError('BACKUP_INVALID', 'Choose a nonempty resume group to back up.');
  const groupId = workspaceOf(projects[0]).templateGroupId;
  if (expectedGroupId !== undefined && expectedGroupId !== groupId) throw new FolioError('BACKUP_INVALID', 'The supplied projects do not belong to the requested group.');
  if (projects.some(project => workspaceOf(project).templateGroupId !== groupId) || new Set(projects.map(project => project.id)).size !== projects.length || projects.filter(project => workspaceOf(project).kind === 'resume').length > 1) throw new FolioError('BACKUP_INVALID', 'Back up one complete resume group at a time.');
  const durable = ((await (await db()).getAll('projects')) as Project[]).filter(project => workspaceOf(project).templateGroupId === groupId);
  if (durable.some(project => !projects.some(candidate => candidate.id === project.id))) throw new FolioError('BACKUP_INCOMPLETE', 'Include every saved application in this group backup.');
  const primary = projects.find(project => workspaceOf(project).kind === 'resume');
  if (projects.some(project => project.memorySnapshot && primary && (project.memorySnapshot.sourceResumeId !== primary.id || project.source.id !== primary.source.id || project.source.sha256 !== primary.source.sha256)) || new Set(projects.filter(project => project.memorySnapshot).map(project => project.memorySnapshot!.sourceResumeId)).size > 1) throw new FolioError('BACKUP_INVALID', 'A snapshot points outside this resume group.');
  const zip = new JSZip(), manifest: GroupManifest = { schemaVersion: 1, format: 'folio-group', templateGroupId: groupId, projects: [], files: [] }; let total = 0;
  const add = async (path: string, bytes: Uint8Array) => {
    total += bytes.length;
    if (!groupPath.test(path) || bytes.length > MAX_SOURCE_BYTES || total > 50 * 1024 * 1024 || path.endsWith('project.json') && bytes.length > 2 * 1024 * 1024 || manifest.files.length >= 63) throw new FolioError('BACKUP_TOO_LARGE', 'This full group exceeds local backup limits. No sources or applications were omitted.');
    zip.file(path, bytes); manifest.files.push({ path, size: bytes.length, sha256: await sha256(bytes) });
  };
  for (let index = 0; index < projects.length; index++) {
    const project = projects[index], prefix = `projects/${index}`;
    await add(`${prefix}/source.${project.source.format}`, project.source.bytes);
    for (let assetIndex = 0; assetIndex < project.assets.length; assetIndex++) await add(`${prefix}/assets/${assetIndex}.bin`, project.assets[assetIndex].bytes);
    for(const [index,f] of (project.template.sourceStandardFonts??[]).entries())await add(`${prefix}/standard-fonts/${index}.bin`,f.nativeAdapter.bytes);
    if(project.template.sourceColorProfile)await add(`${prefix}/colors/0.icc`,project.template.sourceColorProfile.bytes);
    for(const [fontIndex,font] of (project.template.sourceFonts??[]).entries()){await add(`${prefix}/fonts/${fontIndex}.bin`,font.bytes);if('originalProgram'in font&&font.originalProgram)await add(`${prefix}/fonts/${fontIndex}.original.bin`,font.originalProgram.bytes);}
    for (let sourceIndex = 0; sourceIndex < (project.careerMemory?.sources.length ?? 0); sourceIndex++) { const source = project.careerMemory!.sources[sourceIndex]; if (source.bytes) await add(`${prefix}/memory/${sourceIndex}.bin`, source.bytes); }
    const path = `${prefix}/project.json`; await add(path, new TextEncoder().encode(JSON.stringify(metadata(project)))); manifest.projects.push({ id: project.id, path });
  }
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  if (manifestBytes.length > 64000) throw new FolioError('BACKUP_TOO_LARGE', 'This group manifest exceeds local backup limits.');
  zip.file('manifest.json', manifestBytes); const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  if (bytes.length > 20 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'This group exceeds the 20 MiB compressed backup limit.');
  inspectZip(bytes); return new Blob([new Uint8Array(bytes).buffer], { type: 'application/zip' });
}
async function decodeGroup(file: File, suppliedEntries?: Map<string, Uint8Array>): Promise<Project[]> {
  if (file.size > 20 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'The backup exceeds the 20 MiB local restore limit.');
  const entries = suppliedEntries ?? await readBoundedArchive(new Uint8Array(await file.arrayBuffer()), 20 * 1024 * 1024), manifestBytes = entries.get('manifest.json');
  if (!manifestBytes || manifestBytes.length > 64000 || entries.size > 64 || [...entries.keys()].some(path => path !== 'manifest.json' && !groupPath.test(path))) throw new FolioError('BACKUP_INVALID', 'This is not a bounded Folio group backup.');
  const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as GroupManifest;
  if (manifest.schemaVersion !== 1 || manifest.format !== 'folio-group' || typeof manifest.templateGroupId !== 'string' || !manifest.templateGroupId || manifest.templateGroupId.length > 150 || !Array.isArray(manifest.files) || !Array.isArray(manifest.projects) || !manifest.projects.length || manifest.files.length > 63 || manifest.projects.length > 63) throw new FolioError('BACKUP_VERSION', 'This group backup version is unsupported.');
  const files = new Map<string, Uint8Array>(); let total = 0;
  for (const item of manifest.files) {
    if (typeof item.path !== 'string' || !groupPath.test(item.path) || files.has(item.path) || !Number.isInteger(item.size) || item.size < 0 || item.size > MAX_SOURCE_BYTES || typeof item.sha256 !== 'string' || !/^[a-f\d]{64}$/.test(item.sha256)) throw new FolioError('BACKUP_INVALID', 'A group manifest entry is invalid.');
    total += item.size; if (total > 50 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'The expanded group exceeds 50 MiB.');
    const value = entries.get(item.path); if (!value || value.length !== item.size || await sha256(value) !== item.sha256) throw new FolioError('BACKUP_CHECKSUM', 'A group entry failed its integrity check.'); files.set(item.path, value);
  }
  if (files.size + 1 !== entries.size) throw new FolioError('BACKUP_INVALID', 'The group contains an unlisted entry.');
  const projects: Project[] = [], consumed = new Set<string>(), ids = new Set<string>();
  for (const item of manifest.projects) {
    if (typeof item.id !== 'string' || ids.has(item.id) || typeof item.path !== 'string' || !/^projects\/[0-9]+\/project\.json$/.test(item.path) || consumed.has(item.path)) throw new FolioError('BACKUP_INVALID', 'Duplicate or invalid project identity.');
    const bytes = files.get(item.path); if (!bytes || bytes.length > 2 * 1024 * 1024) throw new FolioError('BACKUP_INVALID', 'Group project metadata is missing or oversized.');
    consumed.add(item.path); ids.add(item.id); const decoded = unpackScopedMetadata(unpackRecordMetadata(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)))) as Project, prefix = item.path.slice(0, -'/project.json'.length);
    const take = (path: string): Uint8Array => { const value = files.get(path); if (!value || consumed.has(path)) throw new FolioError('BACKUP_INVALID', 'A referenced group attachment is missing or shared ambiguously.'); consumed.add(path); return value; };
    decoded.source.bytes = take(`${prefix}/source.${decoded.source.format}`);
    decoded.assets = decoded.assets.map((asset,index) => ({ ...asset, bytes: take(`${prefix}/assets/${index}.bin`) }));
    if(decoded.template.sourceColorProfile)decoded.template.sourceColorProfile.bytes=take(`${prefix}/colors/0.icc`);
    if(decoded.template.sourceStandardFonts)decoded.template.sourceStandardFonts=decoded.template.sourceStandardFonts.map((f,index)=>({...f,nativeAdapter:{...f.nativeAdapter,bytes:take(`${prefix}/standard-fonts/${index}.bin`)}}));
    if(decoded.template.sourceFonts)decoded.template.sourceFonts=decoded.template.sourceFonts.map((font,index)=>({...font,bytes:take(`${prefix}/fonts/${index}.bin`),...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:take(`${prefix}/fonts/${index}.original.bin`)}}:{})} as SourceFontAsset));
    if (decoded.careerMemory) decoded.careerMemory.sources = decoded.careerMemory.sources.map((source,index) => { const path = `${prefix}/memory/${index}.bin`; return files.has(path) ? { ...source, bytes: take(path) } : source; });
    if(['folio-import-v16','folio-import-v17','folio-import-v18','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31'].includes(decoded.template.importerVersion)||decoded.template.sourceFonts?.some(f=>f.sourceVersion===7)){decoded.approval=null;decoded.reviewedDraftRevision=null;}
  const project = await checkedProject(decoded);
  if(['folio-import-v16','folio-import-v17','folio-import-v18','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31'].includes(project.template.importerVersion)||project.template.sourceFonts?.some(f=>f.sourceVersion===7)){project.approval=null;project.reviewedDraftRevision=null;}
    if (project.id !== item.id || workspaceOf(project).templateGroupId !== manifest.templateGroupId || await sha256(project.source.bytes) !== project.source.sha256) throw new FolioError('BACKUP_INVALID', 'A group project has invalid identity or source integrity.');
    if (project.approval && (await hashJson(project.template) !== project.approval.layoutHash || await hashJson(project.baseline.blocks) !== project.approval.baselineHash)) project.approval = null;
    projects.push(project);
  }
  if (consumed.size !== files.size) throw new FolioError('BACKUP_INVALID', 'The group contains an attachment with no owner.');
  const primary = projects.filter(project => workspaceOf(project).kind === 'resume');
  if (primary.length > 1 || projects.some(project => project.memorySnapshot && primary.length && (project.memorySnapshot.sourceResumeId !== primary[0].id || project.source.id !== primary[0].source.id || project.source.sha256 !== primary[0].source.sha256)) || new Set(projects.filter(project => project.memorySnapshot).map(project => project.memorySnapshot!.sourceResumeId)).size > 1) throw new FolioError('BACKUP_INVALID', 'A group primary or snapshot reference is invalid.');
  const groupId = newId(), identities = new Map(projects.map(project => [project.id,newId()]));
  for (const project of projects) if (project.memorySnapshot && !identities.has(project.memorySnapshot.sourceResumeId)) identities.set(project.memorySnapshot.sourceResumeId,newId());
  const restored: Project[] = [];
  for (const project of projects) {
    const id = identities.get(project.id)!;
    const careerMemory = project.careerMemory ? { ...project.careerMemory, templateGroupId: groupId, resumeProjectId: id } : undefined;
    const memorySnapshot = project.memorySnapshot ? { ...project.memorySnapshot, id: newId(), templateGroupId: groupId, sourceResumeId: identities.get(project.memorySnapshot.sourceResumeId)!, memoryHash: await hashJson({ priorMemoryHash: project.memorySnapshot.memoryHash, templateGroupId: groupId, sourceResumeId: identities.get(project.memorySnapshot.sourceResumeId) }) } : undefined;
    restored.push(validateProject({ ...project, id, workspace: { ...workspaceOf(project), templateGroupId: groupId }, ...(careerMemory ? { careerMemory } : {}), ...(memorySnapshot ? { memorySnapshot } : {}), name: `${project.name.slice(0,489)} (restored)`, revision: 1, updatedAt: new Date().toISOString(), reviewedDraftRevision: null }));
  }
  return restored;
}
/** Validation and remapping finish before the atomic write; no partial restore is observable. */
export async function restoreGroup(file: File, suppliedEntries?: Map<string, Uint8Array>): Promise<Project[]> {
  try {
    const projects = await decodeGroup(file, suppliedEntries), database = await db(), groupId = workspaceOf(projects[0]).templateGroupId;
    const state: GroupState = { templateGroupId: groupId, epoch: 1, state: projects.some(project => workspaceOf(project).kind === 'resume') ? 'active' : 'resumeRemoved', changedAt: new Date().toISOString() };
    const transaction = database.transaction(['projects','groupState'], 'readwrite');
    try { for (const project of projects) await transaction.objectStore('projects').add(project); await transaction.objectStore('groupState').add(state); await transaction.done; } catch (error) { try { transaction.abort(); } catch { /* already aborted */ } await transaction.done.catch(() => {}); throw error; }
    for (const project of projects) { remember(project, state.epoch); loadedCheckpoints.set(project,{revision:project.revision,memoryRevision:project.careerMemory?.revision,epoch:state.epoch}); } announce(state); return projects;
  } catch (error) { if (error instanceof FolioError) throw error; throw new FolioError('BACKUP_INVALID', 'This group could not be restored safely. No group records were added.'); }
}
export const saveProjectGroupBackup = backupResumeGroup;

export const createApplicationRecord = createSavedApplication;
export const previewResumeGroupRemoval = previewGroupRemoval;
export async function removeResumeGroup(plan: GroupRemovalPlan): Promise<{ removedIds: string[] }> { await removeGroup(plan.templateGroupId, plan); return { removedIds: plan.projects.map(project => project.id) }; }
export async function restoreResumeGroup(file: File): Promise<{ projects: Project[]; groupId: string }> { const projects = await restoreGroup(file); return { projects, groupId: workspaceOf(projects[0]).templateGroupId }; }

export type RestoredBackup = { kind: 'group'; projects: Project[] } | { kind: 'project'; project: Project } | {kind:'archive';archive:LegacyArchiveSummary};
/** Decode one bounded archive and route by its explicit supported manifest version. */
export async function restoreBackup(file: File): Promise<RestoredBackup> {
  try {
    if (file.size > 20 * 1024 * 1024) throw new FolioError('BACKUP_TOO_LARGE', 'The backup exceeds the 20 MiB local restore limit.');
    const entries = await readBoundedArchive(new Uint8Array(await file.arrayBuffer()), 20 * 1024 * 1024), manifestBytes = entries.get('manifest.json');
    if (!manifestBytes || manifestBytes.length > 64000 || entries.size > 64) throw new FolioError('BACKUP_INVALID', 'This archive has no valid bounded Folio manifest.');
    const manifest = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes)) as { schemaVersion?: unknown; format?: unknown };
    if (manifest.schemaVersion !== 1 || manifest.format !== 'folio' && manifest.format !== 'folio-group') throw new FolioError('BACKUP_VERSION', 'This backup format or version is unsupported.');
    if(manifest.format==='folio-group'){
      try{return {kind:'group',projects:await restoreGroup(file,entries)};}
      catch(error){
        if(!(error instanceof FolioError)||error.code!=='BACKUP_INVALID')throw error;
        try{await inspectLegacyArchive(entries);}catch{throw error;}
        return {kind:'archive',archive:await preserveLegacyArchive(file,entries)};
      }
    }
    return {kind:'project',project:await restoreChecked(file,entries)};
  } catch (error) { if (error instanceof FolioError) throw error; throw new FolioError('BACKUP_INVALID', 'This backup could not be read or validated. Your current projects are unchanged.'); }
}

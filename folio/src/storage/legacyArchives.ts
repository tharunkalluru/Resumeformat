import {openDB} from 'idb';
import {FolioError} from '../core/errors';
import {MAX_SOURCE_BYTES,newId,sha256} from '../core/model';
import {unpackRecordMetadata} from '../core/project-record-codec';
import {unpackScopedMetadata} from '../core/source-scoped-codec';
import {readBoundedArchive} from '../import/zip';

// A separate database preserves rollback to the earlier app's database version.
export const LEGACY_ARCHIVE_DATABASE='folio-legacy-archives-v1';
export interface LegacyArchiveText {name:string;kind:'resume'|'application';draft:string;memoryDraft:string;notes:string[];versions:{kind:string;text:string}[]}
export interface LegacyArchiveSummary {id:string;name:string;sha256:string;createdAt:string;records:LegacyArchiveText[]}
interface StoredArchive extends LegacyArchiveSummary {bytes:Uint8Array}
export interface VerifiedOriginal {file:File;sha256:string;name:string}
const pathPattern=/^projects\/[0-9]+\/(?:project\.json|source\.(?:pdf|docx)|assets\/[0-9]+\.bin|fonts\/[0-9]+(?:\.original)?\.bin|standard-fonts\/[0-9]+\.bin|colors\/0\.icc|memory\/[0-9]+\.bin)$/;
const invalid=():never=>{throw new FolioError('LEGACY_ARCHIVE_INVALID','This earlier backup cannot be preserved safely. Keep the original backup file.');};
const text=(v:unknown,max=100000)=>typeof v==='string'?v.slice(0,max):'';
const draftText=(value:any):string=>Array.isArray(value?.blocks)?value.blocks.slice(0,10000).map((b:any)=>Array.isArray(b?.runs)?b.runs.map((r:any)=>text(r?.text,10000)).join(''):'').join('\n').slice(0,100000):'';
/** Opaque preservation only: no saved font, paint, approval or claim is admitted. */
export async function inspectLegacyArchive(entries:Map<string,Uint8Array>):Promise<{records:LegacyArchiveText[];original:{bytes:Uint8Array;sha256:string;format:'pdf'|'docx';name:string}}> {
 const raw=entries.get('manifest.json');if(!raw||raw.length>64000||entries.size>64)return invalid();
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
 if(manifest.schemaVersion!==1||manifest.format!=='folio-group'||!Array.isArray(manifest.files)||manifest.files.length>63||!Array.isArray(manifest.projects)||!manifest.projects.length||manifest.projects.length>63)return invalid();
 const files=new Map<string,Uint8Array>();let total=0;
 for(const item of manifest.files){const bytes=entries.get(item.path);if(typeof item.path!=='string'||!pathPattern.test(item.path)||files.has(item.path)||!Number.isInteger(item.size)||item.size<0||item.size>MAX_SOURCE_BYTES||!bytes||bytes.length!==item.size||await sha256(bytes)!==item.sha256)return invalid();total+=bytes.length;if(total>50*1024*1024)return invalid();files.set(item.path,bytes);}
 if(files.size+1!==entries.size)return invalid();const seen=new Set<string>(),records:LegacyArchiveText[]=[],sources:{bytes:Uint8Array;sha256:string;format:'pdf'|'docx';name:string;primary:boolean}[]=[];
 for(const row of manifest.projects){if(typeof row.path!=='string'||!/^projects\/[0-9]+\/project\.json$/.test(row.path)||seen.has(row.path))return invalid();seen.add(row.path);const metadata=files.get(row.path);if(!metadata||metadata.length>2*1024*1024)return invalid();
  const p:any=unpackScopedMetadata(unpackRecordMetadata(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(metadata))));
  if(p.template?.importerVersion!=='folio-import-v9'||!['pdf','docx'].includes(p.source?.format)||typeof p.source.sha256!=='string'||!/^[a-f0-9]{64}$/.test(p.source.sha256))return invalid();
  const prefix=row.path.slice(0,-'/project.json'.length),bytes=files.get(`${prefix}/source.${p.source.format}`);if(!bytes||await sha256(bytes)!==p.source.sha256)return invalid();
  const primary=p.workspace?.kind==='resume';sources.push({bytes,sha256:p.source.sha256,format:p.source.format,name:text(p.source.name,500)||'Retained original',primary});
  records.push({name:text(p.name,500)||'Earlier saved resume',kind:primary?'resume':'application',draft:draftText(p.draft),memoryDraft:text(p.careerMemory?.draftText),notes:Array.isArray(p.notes)?p.notes.slice(0,1000).map((n:any)=>text(n?.text)):[],versions:Array.isArray(p.folio?.versions)?p.folio.versions.slice(0,12).map((v:any)=>({kind:text(v.kind,30),text:draftText(v.content)})):[]});
 }
 if(sources.filter(s=>s.primary).length>1)return invalid();const {primary:_,...original}=sources.find(s=>s.primary)??sources[0];return {records,original};
}
const database=()=>openDB(LEGACY_ARCHIVE_DATABASE,1,{upgrade(db){db.createObjectStore('archives',{keyPath:'id'});}});
export async function preserveLegacyArchive(file:File,entries:Map<string,Uint8Array>):Promise<LegacyArchiveSummary>{
 if(file.size>20*1024*1024)return invalid();const {records}=await inspectLegacyArchive(entries),bytes=new Uint8Array(await file.arrayBuffer()),hash=await sha256(bytes),db=await database();
 try {
  const all:StoredArchive[]=await db.getAll('archives');
  for(const existing of all){
   if(existing.sha256!==hash||!(existing.bytes instanceof Uint8Array)||await sha256(existing.bytes)!==hash)continue;
   const {bytes:_,...summary}=existing;return summary;
  }
  // Keep any damaged earlier entry for recovery; a valid reimport is separate.
  const stored:StoredArchive={id:newId(),name:file.name.slice(0,500),createdAt:new Date().toISOString(),sha256:hash,records,bytes};
  await db.add('archives',stored);const {bytes:_,...summary}=stored;return summary;
 } finally {db.close();}
}
export async function loadLegacyArchives():Promise<LegacyArchiveSummary[]>{const db=await database();try{const rows:StoredArchive[]=await db.getAll('archives');return rows.map(({bytes:_,...summary})=>summary);}finally{db.close();}}
async function archiveBytes(id:string):Promise<Uint8Array>{const db=await database();try{const row:StoredArchive|undefined=await db.get('archives',id);if(!row||!(row.bytes instanceof Uint8Array)||row.bytes.length>20*1024*1024||await sha256(row.bytes)!==row.sha256)return invalid();return new Uint8Array(row.bytes);}finally{db.close();}}
export async function downloadLegacyArchive(id:string):Promise<Blob>{return new Blob([new Uint8Array(await archiveBytes(id))]);}
export async function legacyArchiveOriginal(id:string):Promise<VerifiedOriginal>{const bytes=await archiveBytes(id),{original}=await inspectLegacyArchive(await readBoundedArchive(bytes,20*1024*1024));return {file:new File([new Uint8Array(original.bytes)],original.name,{type:original.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}),sha256:original.sha256,name:original.name};}

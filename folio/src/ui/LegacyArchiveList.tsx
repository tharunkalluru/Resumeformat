import type {LegacyArchiveSummary} from '../storage/legacyArchives';

export function LegacyArchiveList({archives,busy,onDownload,onRebuild}:{archives:LegacyArchiveSummary[];busy:boolean;onDownload:(archive:LegacyArchiveSummary)=>void;onRebuild:(archive:LegacyArchiveSummary)=>void}){
 if(!archives.length)return null;
 return <section className="unavailable-library" aria-label="Preserved earlier backups">
  <h2>Earlier backups, preserved</h2><p>Drafts, history and context remain in the unchanged backup. Read-only text previews below may be shortened. Rebuild a separate layout from the retained original before editing.</p>
  {archives.map(archive=><details key={archive.id} className="legacy-archive"><summary>{archive.name} · {archive.records.length} saved records</summary>
   <div><button className="text-button" disabled={busy} onClick={()=>onRebuild(archive)}>Rebuild from archived original</button><button className="text-button" disabled={busy} onClick={()=>onDownload(archive)}>Download unchanged backup</button></div>
   {archive.records.map((record,i)=><details key={i}><summary>{record.name} · {record.kind} · {record.versions.length} history versions</summary><p>Saved draft</p><pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{record.draft}</pre>{record.memoryDraft&&<><p>Unfinished Career Memory</p><pre style={{whiteSpace:'pre-wrap'}}>{record.memoryDraft}</pre></>}{record.notes.map((note,j)=><p key={j}>{note}</p>)}{record.versions.map((version,j)=><details key={j}><summary>Saved version {j+1} · {version.kind}</summary><pre style={{whiteSpace:'pre-wrap',maxHeight:240,overflow:'auto'}}>{version.text}</pre></details>)}</details>)}
  </details>)}
 </section>;
}

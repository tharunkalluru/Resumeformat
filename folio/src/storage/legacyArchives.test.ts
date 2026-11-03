import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import JSZip from 'jszip';
import {openDB} from 'idb';
import {sha256} from '../core/model';
import {readBoundedArchive} from '../import/zip';
import {inspectLegacyArchive,preserveLegacyArchive,loadLegacyArchives,downloadLegacyArchive,legacyArchiveOriginal,LEGACY_ARCHIVE_DATABASE} from './legacyArchives';

async function fixture(version='folio-import-v9'){
 const source=new TextEncoder().encode('%PDF-1.7\nAuthored archive fixture only.'),sourceSha=await sha256(source),zip=new JSZip(),files:{path:string;size:number;sha256:string}[]=[],projects=[];
 for(let i=0;i<2;i++){
  const prefix=`projects/${i}`,p={id:`authored-${i}`,name:`Authored saved ${i}`,template:{importerVersion:version},workspace:{kind:i===0?'resume':'application'},source:{format:'pdf',name:'Authored.pdf',sha256:sourceSha},draft:{blocks:[{runs:[{text:`Saved wording ${i}`}]}]},careerMemory:i===0?{draftText:'Unfinished authored context'}:undefined,notes:[{text:'Authored note'}],folio:i===1?{versions:[{kind:'restored',content:{blocks:[{runs:[{text:'Earlier authored wording'}]}]}}]}:undefined};
  projects.push({id:p.id,path:prefix+'/project.json'});
  // Deliberately not a font. Opaque archive storage must never parse or admit it.
  for(const [path,bytes]of [[prefix+'/source.pdf',source],[prefix+'/project.json',new TextEncoder().encode(JSON.stringify(p))],[prefix+'/fonts/0.bin',new Uint8Array([1,2,3])]] as const){zip.file(path,bytes);files.push({path,size:bytes.length,sha256:await sha256(bytes)});}
 }
 zip.file('manifest.json',JSON.stringify({schemaVersion:1,format:'folio-group',templateGroupId:'authored',projects,files}));const bytes=await zip.generateAsync({type:'uint8array'});return {file:new File([new Uint8Array(bytes)],'authored-v9.zip'),bytes,entries:await readBoundedArchive(bytes),sourceSha};
}
it('preserves old wording, notes and history without admitting opaque old font bytes',async()=>{
 const f=await fixture(),result=await inspectLegacyArchive(f.entries);
 expect(result.records.map(r=>r.draft)).toEqual(['Saved wording 0','Saved wording 1']);expect(result.records[0].memoryDraft).toBe('Unfinished authored context');expect(result.records[1].versions[0].text).toBe('Earlier authored wording');expect(result.original.sha256).toBe(f.sourceSha);expect('template'in result).toBe(false);expect('approval'in result).toBe(false);
});
it('rejects changed attachments, unlisted entries, missing originals and current importer records',async()=>{
 const f=await fixture();for(const mutate of [(m:Map<string,Uint8Array>)=>m.set('projects/0/source.pdf',new Uint8Array([9])),(m:Map<string,Uint8Array>)=>m.set('extra.bin',new Uint8Array([1])),(m:Map<string,Uint8Array>)=>m.delete('projects/0/source.pdf')]){const entries=new Map(f.entries);mutate(entries);await expect(inspectLegacyArchive(entries)).rejects.toMatchObject({code:'LEGACY_ARCHIVE_INVALID'});}
 await expect(inspectLegacyArchive((await fixture('folio-import-v13')).entries)).rejects.toMatchObject({code:'LEGACY_ARCHIVE_INVALID'});
});
it('keeps the original backup bytes and leaves the old project database version and rows unchanged',async()=>{
 const old=await openDB('folio-local-v1',2,{upgrade(db){db.createObjectStore('projects');}});await old.put('projects',{draft:'Stored old draft',versions:['Stored history']},'old');const before=await old.get('projects','old');old.close();
 const f=await fixture(),summary=await preserveLegacyArchive(f.file,f.entries);expect((await loadLegacyArchives()).some(x=>x.id===summary.id)).toBe(true);expect(new Uint8Array(await(await downloadLegacyArchive(summary.id)).arrayBuffer())).toEqual(f.bytes);expect((await legacyArchiveOriginal(summary.id)).sha256).toBe(f.sourceSha);
 const unchanged=await openDB('folio-local-v1',2);expect(unchanged.version).toBe(2);expect(await unchanged.get('projects','old')).toEqual(before);unchanged.close();expect(LEGACY_ARCHIVE_DATABASE).not.toBe('folio-local-v1');
});
it('rechecks archive integrity before downloads or rebuilding a retained original',async()=>{
 const f=await fixture(),summary=await preserveLegacyArchive(f.file,f.entries),db=await openDB(LEGACY_ARCHIVE_DATABASE,1),row=await db.get('archives',summary.id);row.bytes[0]^=1;await db.put('archives',row);db.close();
 await expect(downloadLegacyArchive(summary.id)).rejects.toMatchObject({code:'LEGACY_ARCHIVE_INVALID'});await expect(legacyArchiveOriginal(summary.id)).rejects.toMatchObject({code:'LEGACY_ARCHIVE_INVALID'});
});
it('deduplicates valid bytes but preserves a damaged entry when reimporting its original backup',async()=>{
 const f=await fixture(),summary=await preserveLegacyArchive(f.file,f.entries);
 expect((await preserveLegacyArchive(f.file,f.entries)).id).toBe(summary.id);
 const db=await openDB(LEGACY_ARCHIVE_DATABASE,1),row=await db.get('archives',summary.id);row.bytes[0]^=1;await db.put('archives',row);db.close();
 const restored=await preserveLegacyArchive(f.file,f.entries);expect(restored.id).not.toBe(summary.id);
 expect(new Uint8Array(await(await downloadLegacyArchive(restored.id)).arrayBuffer())).toEqual(f.bytes);
 const unchanged=await openDB(LEGACY_ARCHIVE_DATABASE,1);expect(await unchanged.get('archives',summary.id)).toEqual(row);unchanged.close();
});

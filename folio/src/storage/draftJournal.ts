import { canonicalJson, hashTextSync, workspaceOf } from '../core/model';
import type { Project } from '../core/model';
import { validateProject } from '../core/schema';

const prefix='folio-unsaved-draft-v1:';
const identity=(project:Project)=>hashTextSync(canonicalJson({source:project.source.sha256,template:{...project.template,sourceFonts:project.template.sourceFonts?.map(font=>({...font,bytes:undefined}))},baseline:project.baseline}));
type Entry={version:1;id:string;identity:string;revision:number;updatedAt:string;draft:Project['draft'];facts:Project['facts'];notes:Project['notes'];job:Project['job'];evidenceDecisions:Project['evidenceDecisions'];reviewedDraftRevision:Project['reviewedDraftRevision'];folio?:Project['folio'];name:string};

/** A small, separate recovery journal for failed writes of existing job content.
 * Originals, assets, fonts, credentials and live reusable Career Memory stay out.
 * Recovery is permitted only against the same retained source and full template.
 */
export function journalDraft(project:Project,store:Storage=localStorage):boolean{
  if(workspaceOf(project).kind!=='application')return false;
  const checked=validateProject(project);
  const entry:Entry={version:1,id:checked.id,identity:identity(checked),revision:checked.revision,updatedAt:checked.updatedAt,draft:checked.draft,facts:checked.facts,notes:checked.notes,job:checked.job,evidenceDecisions:checked.evidenceDecisions,reviewedDraftRevision:checked.reviewedDraftRevision,folio:checked.folio,name:checked.name};
  const text=JSON.stringify(entry);if(new TextEncoder().encode(text).byteLength>2*1024*1024)return false;
  try{store.setItem(prefix+checked.id,text);return true;}catch{return false;}
}
export function recoverJournal(saved:Project,store:Storage=localStorage):Project|null{
  try{
    const text=store.getItem(prefix+saved.id);if(!text||text.length>2*1024*1024||workspaceOf(saved).kind!=='application')return null;
    const entry=JSON.parse(text) as Entry;
    if(entry.version!==1||entry.id!==saved.id||entry.identity!==identity(saved)||entry.revision<=saved.revision)return null;
    const {version:_v,id:_id,identity:_identity,...content}=entry;
    // Explicit fields exclude arbitrary JSON properties and preserve original ownership.
    return validateProject({...saved,revision:content.revision,updatedAt:content.updatedAt,draft:content.draft,facts:content.facts,notes:content.notes,job:content.job,evidenceDecisions:content.evidenceDecisions,reviewedDraftRevision:content.reviewedDraftRevision,folio:content.folio,name:content.name});
  }catch{return null;}
}
export function clearJournal(id:string,throughRevision:number=Infinity,store:Storage=localStorage):void{
  try{const text=store.getItem(prefix+id);if(text&&JSON.parse(text).revision<=throughRevision)store.removeItem(prefix+id);}catch{/* A failed cleanup never claims persistence succeeded. */}
}

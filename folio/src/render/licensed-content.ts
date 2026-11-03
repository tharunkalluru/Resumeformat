import {licensedInputRunsAllowed,licensedRunsMatchBaseline} from '../core/licensed-edit';
import {compileLicensedCurrent,type GeneratedCurrentShow} from './licensed-current';
import {canonicalJson,type ContentSnapshot,type Project} from '../core/model';
import {FolioError} from '../core/errors';
import type {VerifiedScopedReplay} from '../import/pdf-scoped-source';
const fail=():never=>{throw new FolioError('PDF_LICENSED_CONTENT','This licensed subset requires original shows, complete unlinked removal, or covered wording in one independently owned paragraph with unchanged formatting and evidence.');};
/** Called only after full immutable source/baseline and complete occurrence recapture. */
export function licensedSubsetDeletedRegions(project:Project,content:ContentSnapshot,replay:VerifiedScopedReplay,replacements:Map<string,GeneratedCurrentShow>=new Map(),restorations:Map<string,ContentSnapshot['blocks'][number]>=new Map()):ReadonlySet<string>{
 if(!replay.atomicPages||content.blocks.length!==project.baseline.blocks.length)return fail();
 const deleted=new Set<string>();const runs=(r:ContentSnapshot['blocks'][number]['runs'])=>r.map(({sourceFactIds:_facts,...paint})=>paint);
 for(let i=0;i<project.baseline.blocks.length;i++){
  const baseline=project.baseline.blocks[i],current=content.blocks[i];if(current.id!==baseline.id)return fail();
  const text=current.runs.map(r=>r.text).join(''),validIds=(ids:readonly string[])=>canonicalJson(ids)===canonicalJson(baseline.sourceFactIds)||ids.length===1&&project.facts.some(f=>f.id===ids[0]&&f.kind==='applicantEdit'&&f.confirmed&&f.text===text);
  if(!validIds(current.sourceFactIds)||current.runs.some(r=>!validIds(r.sourceFactIds??current.sourceFactIds)))return fail();
  for(const id of baseline.sourceFactIds){const fact=project.facts.find(f=>f.id===id);if(!fact||fact.kind!=='resume'||fact.text!==baseline.runs.map(r=>r.text).join(''))return fail();}

  if(canonicalJson(runs(current.runs))===canonicalJson(runs(baseline.runs)))continue;

  const owners=project.template.pages.flatMap(p=>p.regions).filter(r=>r.kind==='text'&&r.contentId===baseline.id);if(owners.length!==1)return fail();const region=owners[0];if(region.kind==='text'&&licensedRunsMatchBaseline(region,current.runs,baseline.runs)){restorations.set(current.id,{...current,runs:baseline.runs.map(run=>({...run,sourceFactIds:[...current.sourceFactIds]}))});continue;}const witness=replay.get(region.id);if(!witness?.wholeShow||witness.atomicLeader!==region.id||[...replay.values()].filter(w=>w.atomicLeader===region.id).length!==1)return fail();
  if(project.template.sourceLinks?.some(link=>link.bindings.some(binding=>binding.regionId===region.id)))return fail();
  if(region.kind!=='text'||!licensedInputRunsAllowed(project,region,current.runs))return fail();
  if(current.runs.some(r=>r.text!=='')){replacements.set(region.id,compileLicensedCurrent(project,content,region,witness,replay));}else deleted.add(region.id);
 }
 return deleted;
}

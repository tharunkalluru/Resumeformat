import {useEffect,useMemo,useState} from 'react';
import {blockText,type ContentBlock,type Project,type RenderedDocument} from '../core/model';
import {sourceWordingBlock,sourceWordingPreviewReady,sourceWordingTargets} from '../core/source-wording';
import './sourceParagraph.css';

export function SourceWordingEditor({project,render,selectedRegion,onSelect,onEdit,onError}:{project:Project;render:RenderedDocument|null;selectedRegion:string|null;onSelect:(id:string|null)=>void;onEdit:(blocks:ContentBlock[],group:string)=>void;onError:(message:string)=>void}){
 const targets=useMemo(()=>sourceWordingTargets(project),[project]),selected=targets.find(r=>r.id===selectedRegion),saved=selected?blockText(project.draft.blocks.find(b=>b.id===selected.contentId)!):'',original=selected?blockText(project.baseline.blocks.find(b=>b.id===selected.contentId)!):'';
 const [text,setText]=useState(saved);useEffect(()=>setText(saved),[selected?.id,saved]);
 if(!targets.length)return null;
 const ready=!!selected&&sourceWordingPreviewReady(project,render,selected.id);
 function apply(value:string){if(!selected||!ready)return;try{onEdit([sourceWordingBlock(project,selected.id,value)],`source-wording:${selected.id}`);}catch(error){onError(error instanceof Error?error.message:'This text span is unavailable.');}}
 return <section className="source-paragraph-editor" aria-label="Source wording editor">
  <div className="source-paragraph-heading"><strong>Resume wording</strong><select aria-label="Choose a text span to edit" value={selected?.id??''} onChange={e=>onSelect(e.target.value||null)}><option value="">Select text on the page</option>{targets.map(r=><option key={r.id} value={r.id}>{blockText(project.draft.blocks.find(b=>b.id===r.contentId)!).slice(0,100)}</option>)}</select></div>
  {selected&&<><label htmlFor="source-span-wording" className="visually-hidden">Selected span wording</label><textarea id="source-span-wording" rows={2} maxLength={10000} value={text} onChange={e=>setText(e.target.value)} aria-describedby="source-span-help"/><div className="source-paragraph-actions"><p id="source-span-help">The original font, color and frame stay fixed. Review the PDF for exact appearance. Wording that does not fit blocks export.</p><button className="text-button" type="button" disabled={!ready||saved===original} onClick={()=>apply(original)}>Restore original span</button><button className="button button-primary button-small" type="button" disabled={!ready||text===saved} onClick={()=>apply(text)}>Apply wording</button></div></>}
 </section>;
}

import {useEffect,useRef,useState} from 'react';
import {type1CurrentReviewAllows} from '../import/pdf-type1-baseline';
import {PdfPreview} from './PdfPreview';
import type {Project,RenderedDocument,ContentBlock} from '../core/model';
import {type1EditableRegions} from '../core/type1-baseline';

/** A PDF review surface, with no text inputs or native caret authority. */
export function OriginalType1Review({project,render,visible,onLayoutReview,onEdit}:{project:Project;render:RenderedDocument|null;visible:boolean;onLayoutReview:(issues:string[],revision:number,render:RenderedDocument|null)=>void;onEdit:(blocks:ContentBlock[],group:string)=>void}){
 const regions=type1EditableRegions(project.template),[selected,setSelected]=useState(regions[0]?.sourceLocator??''),region=regions.find(r=>r.sourceLocator===selected)??regions[0],block=region&&project.draft.blocks.find(b=>b.id===region.contentId),currentText=block?.runs.map(r=>r.text).join('')??'';
 const [wording,setWording]=useState(currentText),[truthful,setTruthful]=useState(false);
 useEffect(()=>{setWording(currentText);setTruthful(false);},[project.id,region?.sourceLocator,currentText]);
 const latest=useRef({project,render,visible,onLayoutReview});latest.current={project,render,visible,onLayoutReview};
 const checked=useRef<{bytes:Uint8Array|null;pages:Set<number>;published:boolean}>({bytes:null,pages:new Set(),published:false});
 if(checked.current.bytes!==render?.bytes)checked.current={bytes:render?.bytes??null,pages:new Set(),published:false};
 const publish=()=>{const p=latest.current;if(p.visible&&checked.current.pages.size===p.project.template.pages.length&&!checked.current.published&&type1CurrentReviewAllows(p.render,p.project)){checked.current.published=true;p.onLayoutReview(p.render!.layout.overflows.map(o=>o.regionId),p.project.draft.revision,p.render);}};
 useEffect(()=>{publish();},[visible,render,project]);
 return <div className="document-editor original-type1-review" aria-label={project.template.sourceType1Baseline?.version==='original-type1-baseline-v8'?'Original layout review':'Original Type 1 layout review'}>
  <div className="reconstruction-notice" role="status"><div><h2>{region?'Edit proved lines in their original fonts':'Original layout preserved · wording locked'}</h2><p>{region?'Choose a complete line and use characters covered by its original font. Each line keeps its original position and a bounded frame. Split columns, links and unsupported text stay locked. Full job tailoring and line reflow remain unavailable.':'You can review and download the original layout with its embedded fonts. Wording edits and job tailoring are unavailable for this source. Upload a DOCX or a PDF using supported editable fonts to tailor it.'}</p></div></div>
  {block&&<section className="panel-section"><label htmlFor="type1-edit-owner">Choose original text to edit</label><select id="type1-edit-owner" value={region?.sourceLocator??''} onChange={e=>setSelected(e.target.value)}>{regions.map(r=><option key={r.sourceLocator} value={r.sourceLocator}>Page {project.template.pages.findIndex(p=>p.id===r.pageId)+1} · {project.baseline.blocks.find(b=>b.id===r.contentId)?.runs.map(v=>v.text).join('')}</option>)}</select><label htmlFor="type1-line-wording">Complete line wording</label><textarea id="type1-line-wording" value={wording} maxLength={project.template.sourceType1Baseline?.editableSlots?2048:256} onChange={e=>{setWording(e.target.value);setTruthful(false);}}/><label><input type="checkbox" checked={truthful} onChange={e=>setTruthful(e.target.checked)}/>This wording is truthful and based on my resume.</label><button className="button button-primary" disabled={!truthful||wording===currentText} onClick={()=>onEdit([{...block,runs:[{...block.runs[0],text:wording}]}],'type1-line-wording')}>Apply line wording</button>{render?.layout.overflows.map(o=><p key={o.regionId} role="alert">{o.message}</p>)}</section>}
  <div className="canvas-scroll">{render&&project.template.pages.map((_page,index)=><PdfPreview key={index} bytes={render.bytes} page={index+1} scale={.85} label={`${project.template.sourceType1Baseline?.version==='original-type1-baseline-v8'?'Original':'Original Type 1'} layout review page ${index+1}`} ownerKey={`${render.sourceFingerprint}:${render.contentRevision}:${index}`} onReady={receipt=>{
   const p=latest.current;if(receipt.bytes!==p.render?.bytes||receipt.bytes!==checked.current.bytes)return;
   checked.current.pages.add(index+1);publish();
  }} />)}</div>
 </div>;
}

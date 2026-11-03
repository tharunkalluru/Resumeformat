import {useEffect,useState} from 'react';
import {type Project} from '../core/model';
import {sourceParagraphText,type SourceParagraphGroup} from '../core/source-paragraphs';
import './sourceParagraph.css';

export function SourceParagraphEditor({project,groups,selectedRegion,onSelect,onEdit,onReset}:{project:Project;groups:SourceParagraphGroup[];selectedRegion:string|null;onSelect:(id:string|null)=>void;onEdit:(id:string,text:string)=>void;onReset:(id:string)=>void}) {
  const selected=groups.find(g=>g.markerId===selectedRegion||g.memberIds.includes(selectedRegion??''));
  const saved=selected?sourceParagraphText(project,selected):'';
  const [text,setText]=useState(saved);
  useEffect(()=>{setText(saved);},[selected?.id,saved]);
  return <section className="source-paragraph-editor" aria-label="Complete bullet editor">
    <div className="source-paragraph-heading"><strong>Bullet wording</strong><select aria-label="Choose a bullet to edit" value={selected?.id??''} onChange={e=>onSelect(groups.find(g=>g.id===e.target.value)?.leaderId??null)}><option value="">Select a bullet on the page</option>{groups.map(g=><option key={g.id} value={g.id}>{g.baselineText.slice(0,100)}</option>)}</select></div>
    {selected&&<><label htmlFor="source-bullet-wording" className="visually-hidden">Complete bullet wording</label><textarea id="source-bullet-wording" rows={3} maxLength={10000} value={text} onChange={e=>setText(e.target.value)} aria-describedby="source-bullet-help"/><div className="source-paragraph-actions"><p id="source-bullet-help">Original font and {selected.baselines.length}-line frame. Longer wording stays visible and blocks export if it does not fit.</p><button className="text-button" type="button" onClick={()=>onReset(selected.id)}>Restore original bullet</button><button className="button button-primary button-small" type="button" disabled={text===saved} onClick={()=>onEdit(selected.id,text)}>Apply bullet wording</button></div></>}
  </section>;
}

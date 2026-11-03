import {licensedInputRunsAllowed} from '../core/licensed-edit';
import type {Node as PMNode} from '@tiptap/pm/model';
import {safeHref,type Project,type ContentBlock,type TextRegion} from '../core/model';
import type {JSONContent} from '@tiptap/core';
/** Inspect the actual proposed PM document, including pasted and injected marks. */
export function documentScopedMarksAllowed(project:Project,document:PMNode):boolean {
 const fonts=new Set(project.template.sourceFonts?.filter(f=>f.sourceVersion===7).map(f=>f.id));
 const regions=new Set(project.template.pages.flatMap(page=>page.regions).filter(r=>r.kind==='text'&&fonts.has(r.style.sourceFontId??'')).map(r=>r.id));
 if(!regions.size)return true;
 let valid=true;
 document.descendants(node=>{if(node.type.name==='folioRegion'&&regions.has(String(node.attrs.id)))node.descendants(child=>{if(child.marks.some(mark=>mark.type.name==='bold'||mark.type.name==='italic'))valid=false;});});
 return valid;
}

/** Covered native input is provisional; current rendering independently proves its whole owner. */
export function licensedSubsetInputAllowed(project:Project,document:PMNode,previous:PMNode,rewriteAllowed?:(regionId:string)=>boolean):boolean {
 const fonts=new Set(project.template.sourceFonts?.filter(f=>f.sourceVersion===8).map(f=>f.id));if(!fonts.size)return true;
 const regions=new Map(project.template.pages.flatMap(p=>p.regions).filter(r=>r.kind==='text'&&fonts.has(r.style.sourceFontId??'')).map(r=>[r.id,r]));
 const prior=new Map<string,PMNode>();previous.descendants(n=>{if(n.type.name==='folioRegion')prior.set(String(n.attrs.id),n);});let valid=true;
 document.descendants(node=>{if(node.type.name!=='folioRegion')return;const region=regions.get(String(node.attrs.id));if(!region||node.eq(prior.get(region.id)??node))return;const owners=project.template.pages.find(p=>p.id===region.pageId)?.regions.filter(r=>r.kind==='text'&&r.order===region.order);if(region.kind!=='text'||owners?.length!==1||project.template.sourceLinks?.some(l=>l.bindings.some(b=>b.regionId===region.id))){valid=false;return;} const baseline=project.baseline.blocks.find(block=>block.id===region.contentId);if(baseline){const expected=node.type.schema.nodeFromJSON({type:node.type.name,attrs:node.attrs,content:sourceBlockParagraphs(baseline,region.style)});if(node.eq(expected))return;} if(node.textContent===''){node.descendants(child=>{if(child.marks.length)valid=false;});return;}
 if(rewriteAllowed&&!rewriteAllowed(region.id)){valid=false;return;}
 if(!baseline||node.childCount!==1||node.firstChild?.type.name!=='paragraph'){valid=false;return;}
 const runs:ContentBlock['runs']=[];node.firstChild.forEach(child=>{if(!child.isText||child.marks.some(mark=>!['bold','italic','folioEvidence'].includes(mark.type.name))){valid=false;return;}runs.push({text:child.text??'',bold:child.marks.some(mark=>mark.type.name==='bold'),italic:child.marks.some(mark=>mark.type.name==='italic'),sourceFactIds:child.marks.find(mark=>mark.type.name==='folioEvidence')?.attrs.ids??baseline.sourceFactIds});});
 if(!licensedInputRunsAllowed(project,region,runs))valid=false;});return valid;
}

export function sourceBlockParagraphs(block: ContentBlock, style: TextRegion['style']): JSONContent[] {
  const result: JSONContent[] = [{ type: 'paragraph', content: [] }];
  for (const run of block.runs) {
    const parts = run.text.split('\n');
    parts.forEach((text, index) => {
      if (index > 0) result.push({ type: 'paragraph', content: [] });
      if (!text) return;
      const marks: NonNullable<JSONContent['marks']> = [];
      if (run.bold ?? style.fontWeight === 700) marks.push({ type: 'bold' });
      if (run.italic ?? style.italic) marks.push({ type: 'italic' });
      if (run.underline) marks.push({ type: 'underline' });
      if (run.href && safeHref(run.href)) marks.push({ type: 'link', attrs: { href: safeHref(run.href) } });
      if (run.sourceFactIds?.length) marks.push({ type: 'folioEvidence', attrs: { ids: run.sourceFactIds } });
      result.at(-1)!.content!.push({ type: 'text', text, marks });
    });
  }
  return result;
}


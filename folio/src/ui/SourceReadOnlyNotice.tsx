import type {Project} from '../core/model';

/** Source shear owns appearance, never an editable line or native caret. */
export function SourceReadOnlyNotice({project}:{project:Project}){
 if(project.template.sourceCompositePages)return <p className="subtle" role="note" aria-label="Read-only source artwork"><strong>Original artwork and numerical fonts are locked.</strong> Use Resume wording for supported text spans, then review the PDF for its exact appearance.</p>;
 const count=project.template.pages.reduce((n,page)=>n+page.regions.filter(region=>region.kind==='text'&&region.sourceLayout?.version===4).length,0);
 if(!count)return null;
 return <p className="subtle" role="note" aria-label="Read-only source text"><strong>{count} {count===1?'line is':'lines are'} read-only.</strong> Text with slanted source geometry keeps its original appearance and cannot be edited. Resume wording lists the text you can edit.</p>;
}

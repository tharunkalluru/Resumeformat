import { canonicalJson, hasOriginalCff, hasPermittedOriginalTrueType, type ContentSnapshot, type Fact, type Project, type Template } from '../core/model';
import { FolioError } from '../core/errors';

const fail = (): never => { throw new FolioError('PDF_DOCUMENT_BASELINE', 'The document baseline wording, formatting or hyperlinks do not match the retained original PDF.'); };

/** Generated IDs are not source evidence. All paint-bearing values stay literal. */
function projection(template: Template, baseline: ContentSnapshot, facts?:readonly Fact[]) {
  const blocks = new Map(baseline.blocks.map(block => [block.id, block]));
  const regions = new Map<string, string>(), contents = new Map<string, string>();
  const factKeys=new Map<string,number>();
  const evidence=(ids:readonly string[]|undefined)=>facts?(ids??[]).map(id=>{const fact=facts.find(f=>f.id===id);if(!fact||fact.kind!=='resume')return fail();if(!factKeys.has(id))factKeys.set(id,factKeys.size);return {key:factKeys.get(id),text:fact.text,locator:fact.locator};}):undefined;
  let count = 0;
  const pages = template.pages.map((page, p) => ({width:page.width,height:page.height,text:page.regions.flatMap((region, r) => {
    if (region.kind !== 'text') return [];
    const key = `${p}/${r}`, block = blocks.get(region.contentId);
    if (!block || contents.has(region.contentId)) return fail();
    count++; regions.set(region.id,key); contents.set(region.contentId,key);
    const font = template.sourceFonts?.find(font => font.id === region.style.sourceFontId);
    const {sourceFontId:_font, ...style} = region.style;
    return [{key,order:region.order,bounds:region.bounds,style,font:font ? {sha256:font.sha256,original:'originalProgram' in font && font.originalProgram ? [font.originalProgram.sha256,font.originalProgram.pdfFontRef] : null} : null,
      ...(facts?{evidence:evidence(block.sourceFactIds)}:{}),runs:block.runs.map(({sourceFactIds,...run})=>({...run,...(facts?{evidence:evidence(sourceFactIds)}:{})}))}];
  })}));
  if (count !== baseline.blocks.length) fail();
  const links = (template.sourceLinks??[]).map(link => ({page:template.pages.findIndex(p=>p.id===link.pageId),sourceSha256:link.sourceSha256,
    annotationIndex:link.annotationIndex,annotationId:link.annotationId,bounds:link.bounds,href:link.href,
    bindings:link.bindings.map(binding=>{const region=regions.get(binding.regionId),content=contents.get(binding.contentId);if(!region||region!==content)return fail();return region;})}));
  return {pages,links,...(facts?{resumeFacts:facts.filter(f=>f.kind==='resume').map(f=>({text:f.text,locator:f.locator}))}:{})};
}

/** Shared storage/render authority: fresh bounded source extraction, never saved hashes. */
export async function validateDocumentScopedBaseline(project: Project): Promise<void> {
  if (!hasOriginalCff(project.template)&&!hasPermittedOriginalTrueType(project.template)&&!project.template.sourceColorProfile&&!project.template.sourceFonts?.some(font=>font.sourceVersion===7||font.sourceVersion===8)) return;
  const {importPdf}=await import('./pdf');
  const original=await importPdf(new File([new Uint8Array(project.source.bytes)],'retained-original.pdf',{type:'application/pdf'}),new Uint8Array(project.source.bytes),project.template.importerVersion==='folio-import-v28');
  // A rederived extractor-only separator shares its exact full semantic item
  // fact across physical fragments. Bind that sharing and quote without IDs.
  const refs=original.baseline.blocks.flatMap(block=>block.sourceFactIds),shared=refs.length!==new Set(refs).size;
  if (original.source.sha256!==project.source.sha256 || canonicalJson(projection(original.template,original.baseline,shared?original.facts:undefined))!==canonicalJson(projection(project.template,project.baseline,shared?project.facts:undefined))) fail();
}

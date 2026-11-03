import { canonicalJson, hashTextSync, safeHref, type ContentSnapshot, type SourceLink, type Template } from './model';
import { FolioError } from './errors';
import type {ContentBlock,SourceLinkBinding} from './model';

const fail = (): never => { throw new FolioError('SOURCE_LINK_PROOF', 'An original hyperlink is not bound to its source page, geometry, destination and text.'); };
function boundRunsMatch(block:ContentBlock,binding:SourceLinkBinding,href:string):boolean {
 const range=binding.utf16Range,total=block.runs.reduce((n,r)=>n+r.text.length,0),start=range?.[0]??0,end=range?.[1]??total;
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>total)return false;
 let offset=0,matched=0,nonblank=false;
 for(const run of block.runs){const a=Math.max(start,offset),b=Math.min(end,offset+run.text.length);if(b>a){if(!run.href||safeHref(run.href)!==safeHref(href))return false;matched+=b-a;nonblank ||=!!run.text.slice(a-offset,b-offset).trim();}offset+=run.text.length;}
 return matched===end-start&&nonblank;
}
export function sourceLinkProofHash(link: Omit<SourceLink, 'proofHash'> | SourceLink): string {
  const { proofHash: _proof, ...binding } = link as SourceLink;
  return hashTextSync(canonicalJson(binding));
}

/** Original annotation evidence is immutable; edited drafts never redefine it. */
export function validateSourceLinks(template: Template, sourceSha256?: string, baseline?: ContentSnapshot): void {
  const links = template.sourceLinks ?? [], ids = new Set<string>(), annotations = new Set<string>();
  if (links.length > 1000) fail();
  const pages=new Map(template.pages.map(p=>[p.id,p])),regionsByPage=new Map(template.pages.map(p=>[p.id,new Map(p.regions.map(r=>[r.id,r]))])),fonts=new Map((template.sourceFonts??[]).map(f=>[f.id,f])),standards=new Map((template.sourceStandardFonts??[]).map(f=>[f.id,f])),blocks=new Map((baseline?.blocks??[]).map(b=>[b.id,b])),hashes=new Map<string,string>();
  const runHash=(contentId:string)=>{const block=blocks.get(contentId);if(!block)return undefined;if(!hashes.has(contentId))hashes.set(contentId,hashTextSync(canonicalJson(block.runs)));return hashes.get(contentId);};
  for (const link of links) {
    const page = pages.get(link.pageId), b = link.bounds;
    if (!page) return fail();
    const key = canonicalJson([link.pageId, link.annotationIndex]);
    if (!link.id || ids.has(link.id) || annotations.has(key) || !page ||
      !/^[a-f0-9]{64}$/.test(link.sourceSha256) || sourceSha256 && link.sourceSha256 !== sourceSha256 ||
      !Number.isInteger(link.annotationIndex) || link.annotationIndex < 0 || link.annotationIndex > 10000 ||
      !link.annotationId || link.annotationId.length > 150 || /[\u0000-\u001f\u007f]/.test(link.annotationId) ||
      ![b.x,b.y,b.width,b.height].every(Number.isFinite) || b.width <= 0 || b.height <= 0 || b.width > 5000 || b.height > 5000 ||
      b.x + b.width <= 0 || b.y + b.height <= 0 || b.x >= page.width || b.y >= page.height ||
      !link.href || link.href.length > 2048 || /[^\x20-\x7e]/.test(link.href) || !safeHref(link.href) ||
      !link.bindings.length || link.bindings.length > 100 || sourceLinkProofHash(link) !== link.proofHash) fail();
    ids.add(link.id); annotations.add(key);
    const regions = new Set<string>();
    for (const binding of link.bindings) {
      const region = regionsByPage.get(page.id)?.get(binding.regionId);
      const layout=region?.kind==='text'?(region.sourceStandardLayout??region.sourceLayout):undefined;
      if (regions.has(binding.regionId) || region?.kind !== 'text' || region.contentId !== binding.contentId ||
        layout?.sourceSha256 !== link.sourceSha256 || layout.baselineRunsHash !== binding.baselineRunsHash ||
        binding.utf16Range&&!region.sourceStandardLayout) fail();
      const font = region?.kind === 'text' ? region.style.sourceStandardFontId?standards.get(region.style.sourceStandardFontId):fonts.get(region.style.sourceFontId!) : undefined;
      if (!font || font.sourceSha256 !== link.sourceSha256) fail();
      regions.add(binding.regionId);
      if (baseline) {
        const block = blocks.get(binding.contentId);
        if (!block || runHash(binding.contentId) !== binding.baselineRunsHash ||
          !boundRunsMatch(block,binding,link.href)) fail();
      }
    }
  }
}

/** A current text/mark/evidence change drops only the old annotation, never text. */
export function currentSourceLinks(template: Template, content: ContentSnapshot, pageId: string): { links: SourceLink[]; coveredRegions: Set<string> } {
  validateSourceLinks(template);
  const blocks = new Map(content.blocks.map(b => [b.id,b])),hashes=new Map<string,string>();
  const runHash=(contentId:string)=>{const block=blocks.get(contentId);if(!block)return undefined;if(!hashes.has(contentId))hashes.set(contentId,hashTextSync(canonicalJson(block.runs)));return hashes.get(contentId);};
  const links = (template.sourceLinks ?? []).filter(link => link.pageId === pageId && link.bindings.every(binding => {
    const block = blocks.get(binding.contentId);
    return !!block && runHash(binding.contentId) === binding.baselineRunsHash &&
      boundRunsMatch(block,binding,link.href);
  }));
  return { links, coveredRegions: new Set(links.flatMap(link => link.bindings.map(b => b.regionId))) };
}

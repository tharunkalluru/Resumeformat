import {canonicalJson,sha256Sync,type Template,type ContentSnapshot,type TextRun,type TextRegion} from './model';
import {FolioError} from './errors';

/** New parser coverage may prove more lines or selectors. A saved record keeps
 * its narrower authority: every retained binding must still be independently
 * reproduced, while additions to the fresh proof never expand that record. */
export function type1SourceProofContains(retained:Template['sourceType1Baseline'],fresh:Template['sourceType1Baseline']):boolean{
 if(!retained||!fresh)return false;
 if(retained.version==='original-type1-baseline-v8'||fresh.version==='original-type1-baseline-v8')return canonicalJson(retained)===canonicalJson(fresh);
 if(!['original-type1-baseline-v4','original-type1-baseline-v5','original-type1-baseline-v6','original-type1-baseline-v7'].includes(retained.version)||!['original-type1-baseline-v4','original-type1-baseline-v5','original-type1-baseline-v6','original-type1-baseline-v7'].includes(fresh.version)||retained.version==='original-type1-baseline-v7'&&fresh.version!=='original-type1-baseline-v7'||retained.version==='original-type1-baseline-v6'&&!['original-type1-baseline-v6','original-type1-baseline-v7'].includes(fresh.version)||retained.version==='original-type1-baseline-v5'&&!['original-type1-baseline-v5','original-type1-baseline-v6','original-type1-baseline-v7'].includes(fresh.version))return canonicalJson(retained)===canonicalJson(fresh);
 const {editableSlots:oldSlots,version:oldVersion,...oldBase}=retained,{editableSlots:newSlots,version:newVersion,...newBase}=fresh;
 if(!oldSlots?.length&&!newSlots?.length)return canonicalJson(retained)===canonicalJson(fresh);
 if(!oldSlots?.length||!newSlots?.length||canonicalJson(oldBase)!==canonicalJson(newBase))return false;
 const identity=(s:NonNullable<typeof oldSlots>[number])=>`${s.pageNumber}:${s.sourceLocator}`,candidates=new Map(newSlots.map(s=>[identity(s),s])),seen=new Set<string>();
 if(candidates.size!==newSlots.length)return false;
 return oldSlots.every(slot=>{
  const id=identity(slot),candidate=candidates.get(id);if(seen.has(id)||!candidate)return false;seen.add(id);
  const {codes,...binding}=slot,{codes:newCodes,...newBinding}=candidate;
  if(canonicalJson(binding)!==canonicalJson(newBinding))return false;
  const covered=new Map(newCodes.map(c=>[c.unicode,c]));
  return new Set(codes.map(c=>c.unicode)).size===codes.length&&codes.every(c=>canonicalJson(c)===canonicalJson(covered.get(c.unicode)));
 });
}

/** Separate-copy restore remaps IDs/provenance, while wording and frames stay
 * immutable. These records are a semantic inventory, never editable ink. */
export function type1BaselineSignature(template:Template,content:ContentSnapshot):string{
 const blocks=new Map(content.blocks.map(b=>[b.id,b]));
 const ids=template.pages.flatMap(p=>p.regions.map(r=>r.kind==='text'?r.contentId:null));
 if(ids.some(id=>id===null)||new Set(ids).size!==ids.length||blocks.size!==content.blocks.length||blocks.size!==ids.length||ids.some(id=>!blocks.has(id!)))throw new FolioError('PDF_TYPE1_BASELINE','Original Type 1 text ownership changed.');
 return sha256Sync(new TextEncoder().encode(canonicalJson(template.pages.map(p=>[p.width,p.height,p.regions.map(r=>{
  if(r.kind!=='text')throw new FolioError('PDF_TYPE1_BASELINE','Invalid original Type 1 inventory.');
  const b=blocks.get(r.contentId);if(!b)throw new FolioError('PDF_TYPE1_BASELINE','Missing original Type 1 text.');
  return [r.order,r.bounds,r.style,b.runs.map(v=>({text:v.text,...(v.bold!==undefined?{bold:v.bold}:{}),...(v.italic!==undefined?{italic:v.italic}:{}),...(v.underline!==undefined?{underline:v.underline}:{}),...(v.href?{href:v.href}:{})}))];
 })]))));
}
export function type1EditableSlots(template:Template){const proof=template.sourceType1Baseline;return proof?.editableSlots??(proof?.editableSlot?[proof.editableSlot]:[]);}
export function type1EditableRegions(template:Template):TextRegion[]{return type1EditableSlots(template).flatMap(slot=>{const rs=template.pages[slot.pageNumber-1]?.regions.filter(r=>r.kind==='text'&&r.sourceLocator===slot.sourceLocator)??[];return rs.length===1&&rs[0].kind==='text'?[rs[0]]:[];});}
export function type1EditableRegion(template:Template,sourceLocator?:string):TextRegion|undefined{return type1EditableRegions(template).find(r=>!sourceLocator||r.sourceLocator===sourceLocator);}
export function type1LineProgram(template:Template,runs:TextRun[],sourceLocator?:string):{program:string;width:number;advance:number}{
 const region=type1EditableRegion(template,sourceLocator),slot=type1EditableSlots(template).find(s=>s.sourceLocator===region?.sourceLocator&&s.pageNumber===template.pages.findIndex(p=>p.id===region?.pageId)+1),general=!!template.sourceType1Baseline?.editableSlots;
 if(!slot||!region||runs.length!==1||runs.some(r=>r.bold||r.italic||r.underline||r.href))throw new FolioError('PDF_TYPE1_EDIT','Only an owned complete line in its original font can be edited.');
 const text=runs[0].text;if(text.length>(general?2048:256)||!(general?/^[^\s\p{C}]+(?: [^\s\p{C}]+)*$/u:/^[A-Za-z]+(?: [A-Za-z]+)*$/).test(text))throw new FolioError('PDF_TYPE1_EDIT','Use covered characters and single spaces in one line.');
 const map=new Map(slot.codes.map(c=>[c.unicode,c]));let advance=0,upperAdvance=0;
 const words=text.split(' ').map(word=>'<'+Array.from(word).map(c=>{const glyph=map.get(c);if(!glyph)throw new FolioError('PDF_TYPE1_EDIT',`The original font has no proved selector for ${JSON.stringify(c)}. Saved wording is unchanged.`);advance+=glyph.pdfWidth;upperAdvance+=Math.ceil(glyph.pdfWidth);return glyph.code.toString(16).padStart(2,'0').toUpperCase();}).join('')+'>');
 advance-=(words.length-1)*slot.spaceAdjustment;upperAdvance-=(words.length-1)*slot.spaceAdjustment;
 // Use an upper width bound for dependent lines; it only blocks overflow and
 // never changes visible glyph positions or the original advance recipe.
 // TJ numbers move the text cursor without painting text. Preserve the source
 // advance even when a following show uses the same text matrix or another font.
 const correction=general&&!slot.cursorRestore?advance-slot.originalAdvance:0;
 return {program:'['+words.join(' '+slot.spaceAdjustment+' ')+(correction?' '+Number(correction.toFixed(8)):'')+']',width:(slot.cursorRestore?Math.max(advance,upperAdvance):advance)*region.style.fontSize*(slot.horizontalScale??1)/1000,advance:general?slot.originalAdvance:advance};
}
export function type1CurrentInventoryMatches(template:Template,baseline:ContentSnapshot,current:ContentSnapshot):boolean{
 const editable=type1EditableRegions(template),originals=new Map(baseline.blocks.map(b=>[b.id,b]));
 if(editable.length!==type1EditableSlots(template).length)return false;
 for(const region of editable){const original=originals.get(region.contentId),block=current.blocks.find(b=>b.id===region.contentId);if(!original||!block)return false;if(canonicalJson(block.runs.map(r=>({text:r.text,bold:r.bold,italic:r.italic,underline:r.underline,href:r.href})))!==canonicalJson(original.runs.map(r=>({text:r.text,bold:r.bold,italic:r.italic,underline:r.underline,href:r.href}))))type1LineProgram(template,block.runs,region.sourceLocator);}
 const ids=new Set(editable.map(r=>r.contentId));return type1BaselineSignature(template,{...current,blocks:current.blocks.map(b=>ids.has(b.id)?originals.get(b.id)!:b)})===template.sourceType1Baseline?.baselineSignature;
}

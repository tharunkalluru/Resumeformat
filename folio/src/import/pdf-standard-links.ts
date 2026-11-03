import {PDFArray,PDFDict,PDFDocument,PDFName,PDFNumber,PDFString,PDFHexString} from 'pdf-lib';
import {newId,safeHref,canonicalJson,hashTextSync,type Rect,type TemplatePage,type ContentBlock,type SourceLink} from '../core/model';
import {sourceLinkProofHash} from '../core/source-links';
import {FolioError} from '../core/errors';
const fail=():never=>{throw new FolioError('PDF_STANDARD_LINK','The original standard-font link needs a bounded passive URI rectangle and complete source text ownership.');};
interface OriginalLink{annotationIndex:number;annotationId:string;bounds:Rect;href:string}

/** Only invisible-border passive URI links. Forms, appearances, scripts,
 * destinations and additional actions require separate rendering support. */
export function originalStandardLinks(doc:PDFDocument,pageNumber:number):OriginalLink[]{
 const page=doc.getPages()[pageNumber-1],annotations=page.node.Annots();if(!annotations)return[];if(annotations.size()>1000)return fail();const height=page.getHeight();
 return annotations.asArray().map((ref,index)=>{
  const a=doc.context.lookup(ref);if(!(a instanceof PDFDict)||a.lookupMaybe(PDFName.of('Subtype'),PDFName)?.decodeText()!=='Link'||a.keys().some(k=>!['Type','Subtype','Rect','A','Border','F','P','H'].includes(k.decodeText())))return fail();
  if(a.has(PDFName.of('F'))){const f=a.lookup(PDFName.of('F'));if(!(f instanceof PDFNumber)||![0,4].includes(f.asNumber()))return fail();}
  const border=a.lookupMaybe(PDFName.of('Border'),PDFArray);if(!border||border.size()!==3||border.asArray().some((_,i)=>!(border.lookup(i) instanceof PDFNumber)||(border.lookup(i) as PDFNumber).asNumber()!==0))return fail();
  const action=a.lookup(PDFName.of('A'));if(!(action instanceof PDFDict)||action.keys().some(k=>!['Type','S','URI'].includes(k.decodeText()))||action.lookupMaybe(PDFName.of('S'),PDFName)?.decodeText()!=='URI')return fail();
  const uri=action.lookup(PDFName.of('URI'));if(!(uri instanceof PDFString||uri instanceof PDFHexString))return fail();const href=uri.decodeText();if(!safeHref(href)||/[^\x20-\x7e]/.test(href)||href.length>2048)return fail();
  const rect=a.lookup(PDFName.of('Rect'));if(!(rect instanceof PDFArray)||rect.size()!==4)return fail();const values=rect.asArray().map((_,i)=>{const v=rect.lookup(i);if(!(v instanceof PDFNumber)||!Number.isFinite(v.asNumber())||Math.abs(v.asNumber())>1000000)return fail();return v.asNumber();});
  const [x1,y1,x2,y2]=values,bounds={x:Math.min(x1,x2),y:height-Math.max(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1)};if(bounds.width<=0||bounds.height<=0||Math.max(bounds.width,bounds.height)>5000||bounds.x>=page.getWidth()||bounds.y>=height||bounds.x+bounds.width<=0||bounds.y+bounds.height<=0)return fail();
  return{annotationIndex:index,annotationId:ref.toString(),bounds,href};
 });
}

export function bindStandardLinks(page:TemplatePage,blocks:ContentBlock[],links:OriginalLink[],sourceSha256:string):SourceLink[]{
 const pending:{original:OriginalLink;regions:{region:Extract<TemplatePage['regions'][number],{kind:'text'}>;block:ContentBlock;range:[number,number]}[]}[]=[],marks=new Map<string,(string|undefined)[]>();
 for(const original of links){const regions:typeof pending[number]['regions']=[];for(const region of page.regions){if(region.kind!=='text'||!region.sourceStandardLayout)continue;const b=original.bounds,r=region.bounds;if(b.y+b.height<=r.y||b.y>=r.y+r.height)continue;const glyphs=region.sourceStandardLayout.glyphs,selected=glyphs.flatMap((g,i)=>g.x+g.advance/2>=b.x&&g.x+g.advance/2<=b.x+b.width?[i]:[]);if(!selected.length)continue;const first=selected[0],last=selected.at(-1)!;if(selected.length!==last-first+1)return fail();const block=blocks.find(x=>x.id===region.contentId);if(!block)return fail();const start=glyphs.slice(0,first).reduce((n,g)=>n+g.unicode.length,0),end=start+glyphs.slice(first,last+1).reduce((n,g)=>n+g.unicode.length,0),href=safeHref(original.href)!;const map=marks.get(block.id)??Array.from({length:block.runs.map(r=>r.text).join('').length},()=>undefined);for(let i=start;i<end;i++){if(map[i]&&map[i]!==href)return fail();map[i]=href;}marks.set(block.id,map);regions.push({region,block,range:[start,end]});}if(!regions.length||regions.length>100)return fail();pending.push({original,regions});}
 for(const [contentId,map]of marks){const block=blocks.find(b=>b.id===contentId)!,original=block.runs[0],text=block.runs.map(r=>r.text).join('');if(block.runs.length!==1)return fail();block.runs=[];let start=0;for(let end=1;end<=text.length;end++)if(end===text.length||map[end]!==map[start]){block.runs.push({...original,text:text.slice(start,end),...(map[start]?{href:map[start]}:{})});start=end;}const region=page.regions.find(r=>r.kind==='text'&&r.contentId===contentId);if(region?.kind!=='text'||!region.sourceStandardLayout)return fail();region.sourceStandardLayout.baselineRunsHash=hashTextSync(canonicalJson(block.runs));}
 return pending.map(({original,regions})=>{const value:Omit<SourceLink,'proofHash'>={id:newId(),pageId:page.id,sourceSha256,...original,bindings:regions.map(({region,block,range})=>({regionId:region.id,contentId:block.id,baselineRunsHash:region.sourceStandardLayout!.baselineRunsHash,utf16Range:range}))};return{...value,proofHash:sourceLinkProofHash(value)};});
}

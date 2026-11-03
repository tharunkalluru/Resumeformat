import {canonicalJson,type Project,type TextRegion,type TextRun,type SourceFontAsset,type SourceGlyphMapping} from './model';
/** Input eligibility only. Rendering independently recaptures original whole-show authority. */
export function licensedCoveredMaps(asset:SourceFontAsset,text:string):SourceGlyphMapping[]|undefined {
 if(asset.sourceVersion!==8||Array.from(text).length>10000||/[\r\n\u0000-\u001f\u007f]/u.test(text))return;
 const byText=new Map<string,SourceGlyphMapping[]>();for(const map of asset.glyphMap){const list=byText.get(map.unicode)??[];list.push(map);byText.set(map.unicode,list);}
 const result:SourceGlyphMapping[]=[];for(const scalar of text){const matches=byText.get(scalar);if(matches?.length!==1)return;const m=matches[0];if(Array.from(m.unicode).length!==1||!(m.glyphId>0)||!(m.originalGlyphId!>0)||!Number.isInteger(m.originalCharCode)||![m.pdfWidth,m.nativeWidth].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))return;result.push(m);}return result;
}
/** Paint equivalence only; callers separately validate every evidence reference. */
export function licensedRunsMatchBaseline(region:TextRegion,runs:readonly TextRun[],baseline:readonly TextRun[]):boolean{
 const normalized=(values:readonly TextRun[])=>{const out:{text:string;bold:boolean;italic:boolean;underline:boolean;href:string|null}[]=[];for(const r of values){if(!r.text)continue;const v={text:r.text,bold:r.bold??region.style.fontWeight===700,italic:r.italic??region.style.italic,underline:!!r.underline,href:r.href??null},last=out.at(-1);if(last&&last.bold===v.bold&&last.italic===v.italic&&last.underline===v.underline&&last.href===v.href)last.text+=v.text;else out.push(v);}return out;};
 return canonicalJson(normalized(runs))===canonicalJson(normalized(baseline));
}
export function licensedInputRunsAllowed(project:Project,region:TextRegion,runs:readonly TextRun[]):boolean {
 const baseline=project.baseline.blocks.find(b=>b.id===region.contentId),asset=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId);
 if(!baseline||!asset||asset.sourceVersion!==8)return false;
 if(licensedRunsMatchBaseline(region,runs,baseline.runs))return true;
 const owners=project.template.pages.find(p=>p.id===region.pageId)?.regions.filter(r=>r.kind==='text'&&r.order===region.order);
 if(owners?.length!==1||project.template.sourceLinks?.some(l=>l.bindings.some(b=>b.regionId===region.id)))return false;
 const text=runs.map(r=>r.text).join('');if(!text)return runs.every(r=>!r.bold&&!r.italic&&!r.underline&&!r.href);
 if(region.sourceLayout?.anchor!=='start'||baseline.runs.length!==1||baseline.runs[0].underline||baseline.runs[0].href)return false;
 const original=baseline.runs[0],bold=original.bold??region.style.fontWeight===700,italic=original.italic??region.style.italic;
 if(runs.some(run=>(run.bold??region.style.fontWeight===700)!==bold||(run.italic??region.style.italic)!==italic||run.underline||run.href))return false;
 if(!licensedCoveredMaps(asset,text))return false;
 return runs.every(run=>{const ids=run.sourceFactIds??baseline.sourceFactIds;return canonicalJson(ids)===canonicalJson(baseline.sourceFactIds)||ids.length===1&&project.facts.some(f=>f.id===ids[0]&&f.kind==='applicantEdit'&&f.confirmed&&f.text===text);});
}

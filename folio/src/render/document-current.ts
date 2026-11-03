import {canonicalJson,type ContentSnapshot,type Project,type SourceFontAsset,type SourcePositionedGlyph,type TextRegion} from '../core/model';
import {sourceGlyphs} from '../core/source-graph';
import {sourceWordingTargets} from '../core/source-wording';
import type {VerifiedRegionDecomposition,VerifiedScopedReplay} from '../import/pdf-scoped-source';
import type {SourceCurrentGeometry} from '../layout/source-layout';
import {FolioError} from '../core/errors';
import {pdfDecimal} from './pdf-decimal';
const fail=():never=>{throw new FolioError('PDF_DOCUMENT_CURRENT','This wording requires a complete independently owned source show, covered characters and unchanged formatting.');};
export interface GeneratedDocumentCurrent extends SourceCurrentGeometry{readonly kind:'generated-document-current-v1';readonly fontId:string;readonly regionId:string;readonly ctm:readonly number[];readonly textMatrix:readonly number[];readonly nominalFontSize:number;readonly characterSpacing:number;readonly contentText:string;readonly programSha256:string}
const minted=new WeakSet<object>();
export function assertDocumentCurrent(plan:GeneratedDocumentCurrent,asset:SourceFontAsset,glyphs:readonly SourcePositionedGlyph[]):void{if(!minted.has(plan)||asset.sourceVersion!==7||plan.fontId!==asset.id||plan.programSha256!==asset.originalProgram.sha256||canonicalJson(plan.glyphs)!==canonicalJson(glyphs))return fail();}
/** Fresh source proof and explicit reuse consent precede this render-only plan.
 * Raw matrices anchor the changed show; source TJ adjustments stay with their
 * original wording. No native font/caret or provider capability is granted.
 */
export function compileDocumentCurrent(project:Project,content:ContentSnapshot,region:TextRegion,witness:VerifiedRegionDecomposition,replay:VerifiedScopedReplay):GeneratedDocumentCurrent{
 const current={...project,draft:content},font=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId),block=content.blocks.find(b=>b.id===region.contentId),original=project.baseline.blocks.find(b=>b.id===region.contentId),show=witness.wholeShow,d=witness.decomposition;
 if(!sourceWordingTargets(current).some(r=>r.id===region.id)||!font||font.sourceVersion!==7||!block||!original||!show||witness.atomicLeader!==region.id||[...replay.values()].filter(w=>w.atomicLeader===region.id).length!==1||!witness.atomicGroupGlyphs||witness.atomicGroupGlyphs.some(g=>g.inferredGap)||Array.from(sourceGlyphs(region)).some(g=>g.inferredGap))return fail();
 if(witness.regionId!==region.id||witness.pageId!==region.pageId||witness.fontId!==font.id||witness.programSha256!==font.originalProgram.sha256||witness.sourceSha256!==font.sourceSha256||witness.sourceSha256!==region.sourceLayout?.sourceSha256||d.operatorIndex!==region.order||show.operatorIndex!==d.operatorIndex||show.rawOperatorIndex!==d.rawOperatorIndex||show.fullTextMatrix.slice(0,4).some((v,i)=>v!==d.linearTextMatrix[i]))return fail();
 for(const part of show.parts){if(typeof part!=='number'){if(part.length)break;}else if(part!==0)return fail();}
 const text=block.runs[0].text,validIds=(ids:readonly string[])=>canonicalJson(ids)===canonicalJson(original.sourceFactIds)||ids.length===1&&project.facts.some(f=>f.id===ids[0]&&f.kind==='applicantEdit'&&f.confirmed&&f.text===text);
 if(!validIds(block.sourceFactIds)||!validIds(block.runs[0].sourceFactIds??block.sourceFactIds)||/[\r\n\u0000-\u001f\u007f]/.test(text)||Array.from(text).length>10000||block.runs.some(r=>(r.bold??region.style.fontWeight===700)!==(original.runs[0].bold??region.style.fontWeight===700)||(r.italic??region.style.italic)!==(original.runs[0].italic??region.style.italic)))return fail();
 const c=d.ctm,m=show.fullTextMatrix,sx=c[0]*m[0],sy=c[3]*m[3],size=d.nominalFontSize*sx;
 if(c.length!==6||m.length!==6||c[0]<=0||c[3]<=0||m[0]<=0||m[3]<=0||c[1]!==0||c[2]!==0||m[1]!==0||m[2]!==0||sx<=0||sx!==sy||size!==d.effectiveFontSize||size!==region.style.fontSize||size<=0||size>144||region.sourceLayout?.anchor!=='start'||show.characterSpacing*(c[0]*show.decodedTextScaleX)!==(region.sourceLayout.version===3?region.sourceLayout.characterSpacing:0))return fail();
 [...c,...m,d.nominalFontSize,show.characterSpacing].forEach(pdfDecimal);const page=project.template.pages.find(p=>p.id===region.pageId);if(!page)return fail();
 let cursor=0;const glyphs:SourcePositionedGlyph[]=Array.from(text).map(scalar=>{const maps=font.glyphMap.filter(v=>v.unicode===scalar),signatures=new Set(maps.map(v=>canonicalJson([v.glyphId,v.originalGlyphId,v.pdfWidth,v.nativeWidth,!!v.nonPainting])));if(signatures.size!==1)return fail();const map=maps[0];if(!(map.glyphId>0)||!(map.originalGlyphId!>0)||!Number.isInteger(map.originalCharCode)||![map.pdfWidth,map.nativeWidth].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>0))return fail();const x=c[0]*(m[0]*cursor+m[4])+c[4],advance=d.nominalFontSize*map.pdfWidth/1000*sx,step=d.nominalFontSize*map.pdfWidth/1000+show.characterSpacing;if(step<=0||!Number.isFinite(step))return fail();cursor+=step;pdfDecimal(x);return Object.freeze({fontId:font.id,cid:map.cid,unicode:map.unicode,x,advance,operatorIndex:region.order});});
 const baseline=page.height-(c[3]*m[5]+c[5]);pdfDecimal(baseline);const plan:GeneratedDocumentCurrent=Object.freeze({kind:'generated-document-current-v1',fontId:font.id,regionId:region.id,ctm:Object.freeze([...c]),textMatrix:Object.freeze([...m]),nominalFontSize:d.nominalFontSize,characterSpacing:show.characterSpacing,contentText:text,programSha256:font.originalProgram.sha256,glyphs:Object.freeze(glyphs),baseline,fontSize:size});minted.add(plan);return plan;
}
export function documentCurrentReplacements(project:Project,content:ContentSnapshot,replay:VerifiedScopedReplay):Map<string,GeneratedDocumentCurrent>{
 const plans=new Map<string,GeneratedDocumentCurrent>();if(!replay.atomicPages||content.blocks.length!==project.baseline.blocks.length)return fail();
 const paint=(b:ContentSnapshot['blocks'][number])=>b.runs.map(({sourceFactIds:_,...run})=>run);
 for(let i=0;i<content.blocks.length;i++){const current=content.blocks[i],baseline=project.baseline.blocks[i];if(current.id!==baseline.id)return fail();if(canonicalJson(paint(current))===canonicalJson(paint(baseline)))continue;const owners=project.template.pages.flatMap(p=>p.regions).filter((r):r is TextRegion=>r.kind==='text'&&r.contentId===current.id);if(owners.length!==1)return fail();const witness=replay.get(owners[0].id);if(!witness)return fail();plans.set(owners[0].id,compileDocumentCurrent(project,content,owners[0],witness,replay));}
 return plans;
}

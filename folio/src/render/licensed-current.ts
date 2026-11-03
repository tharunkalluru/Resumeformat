import {sourceGlyphs} from '../core/source-graph';
import {canonicalJson,type Project,type ContentSnapshot,type TextRegion,type SourcePositionedGlyph,type SourceFontAsset} from '../core/model';
import {FolioError} from '../core/errors';
import {licensedCoveredMaps,licensedInputRunsAllowed} from '../core/licensed-edit';
import type {VerifiedRegionDecomposition,VerifiedScopedReplay} from '../import/pdf-scoped-source';
import {pdfDecimal} from './pdf-decimal';
import type {SourceCurrentGeometry} from '../layout/source-layout';
const fail=():never=>{throw new FolioError('PDF_LICENSED_CONTENT','This wording lacks a complete single-owner covered source show with unchanged style and evidence.');};
export interface GeneratedCurrentShow extends SourceCurrentGeometry {readonly kind:'generated-current-v2';readonly fontId:string;readonly regionId:string;readonly ctm:readonly number[];readonly textMatrix:readonly number[];readonly nominalFontSize:number;readonly characterSpacing:number;readonly contentText:string;readonly programSha256:string}
const minted=new WeakSet<object>();
export function assertGeneratedCurrent(plan:GeneratedCurrentShow,asset:SourceFontAsset,glyphs:readonly SourcePositionedGlyph[]):void{if(!minted.has(plan)||asset.sourceVersion!==8||plan.fontId!==asset.id||plan.programSha256!==asset.originalProgram.sha256||canonicalJson(plan.glyphs)!==canonicalJson(glyphs))return fail();}
/** Only the project renderer invokes this after complete source/approval/baseline recapture. */
export function compileLicensedCurrent(project:Project,content:ContentSnapshot,region:TextRegion,witness:VerifiedRegionDecomposition,replay:VerifiedScopedReplay):GeneratedCurrentShow {
 const block=content.blocks.find(b=>b.id===region.contentId),font=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId),show=witness.wholeShow,d=witness.decomposition;
 if(!block||!font||font.sourceVersion!==8||!licensedInputRunsAllowed(project,region,block.runs)||!show||witness.atomicLeader!==region.id||[...replay.values()].filter(w=>w.atomicLeader===region.id).length!==1||!witness.atomicGroupGlyphs||(witness.atomicGroupGlyphs.some(g=>g.inferredGap)||Array.from(sourceGlyphs(region)).some(g=>g.inferredGap)))return fail();
 if(witness.regionId!==region.id||witness.pageId!==region.pageId||witness.fontId!==font.id||witness.programSha256!==font.originalProgram.sha256||witness.sourceSha256!==font.sourceSha256||witness.sourceSha256!==region.sourceLayout?.sourceSha256||d.operatorIndex!==region.order||show.operatorIndex!==d.operatorIndex||show.rawOperatorIndex!==d.rawOperatorIndex||show.fullTextMatrix.slice(0,4).some((v,i)=>v!==d.linearTextMatrix[i]))return fail();
 for(const part of show.parts){if(typeof part!=='number'){if(part.length)break;}else if(part!==0)return fail();}
 const c=d.ctm,m=show.fullTextMatrix,sx=c[0]*m[0],sy=c[3]*m[3],size=d.nominalFontSize*sx;
 if(c.length!==6||m.length!==6||c[0]<=0||c[3]<=0||m[0]<=0||m[3]<=0||c[1]!==0||c[2]!==0||m[1]!==0||m[2]!==0||sx<=0||sx!==sy||!Number.isFinite(size)||size<=0||size>144||region.sourceLayout?.anchor!=='start'||show.characterSpacing*(c[0]*show.decodedTextScaleX)!==(region.sourceLayout.version===3?region.sourceLayout.characterSpacing:0))return fail();
 [...c,...m,d.nominalFontSize,show.characterSpacing].forEach(pdfDecimal);
 const original=project.baseline.blocks.find(b=>b.id===region.contentId);if(original?.runs.length!==1||original.runs[0].underline||original.runs[0].href)return fail();
 const page=project.template.pages.find(p=>p.id===region.pageId);if(!page)return fail();
 const text=block.runs.map(r=>r.text).join(''),maps=licensedCoveredMaps(font,text);if(!maps?.length)return fail();
 let cursor=0;const glyphs:SourcePositionedGlyph[]=maps.map(map=>{const x=c[0]*(m[0]*cursor+m[4])+c[4],advance=d.nominalFontSize*map.pdfWidth/1000*sx,step=d.nominalFontSize*map.pdfWidth/1000+show.characterSpacing;if(step<=0||!Number.isFinite(step))return fail();cursor+=step;pdfDecimal(x);return Object.freeze({fontId:font.id,cid:map.cid,unicode:map.unicode,x,advance,operatorIndex:region.order});});
 const baseline=page.height-(c[3]*m[5]+c[5]);pdfDecimal(baseline);
 const plan:GeneratedCurrentShow=Object.freeze({kind:'generated-current-v2',fontId:font.id,regionId:region.id,ctm:Object.freeze([...c]),textMatrix:Object.freeze([...m]),nominalFontSize:d.nominalFontSize,characterSpacing:show.characterSpacing,contentText:text,programSha256:font.originalProgram.sha256,glyphs:Object.freeze(glyphs),baseline,fontSize:size});minted.add(plan);return plan;
}

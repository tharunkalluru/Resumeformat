import {licensedCurrentPreviewRewriteAllows,licensedCurrentPreviewRewriteIds} from '../render/pdf';
import {blockText,hasValidApproval,rendererVersionFor,sourceDocumentFingerprint,type ContentBlock,type Project,type RenderedDocument,type TextRegion} from './model';
import {currentSourceScopedPaint} from './source-scoped-paint';
import {FolioError} from './errors';

/** Plain wording input owns no native resume caret or CSS color authority.
 * Each candidate still passes the unchanged source-bound PDF renderer.
 */
export function sourceWordingTargets(project:Project):TextRegion[]{
 if(!hasValidApproval(project))return [];
 const composite=['folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31','folio-import-v27','folio-import-v28'].includes(project.template.importerVersion)&&project.template.sourceCompositePages?.sourceSha256===project.source.sha256,grouped=composite||['folio-import-v16','folio-import-v17','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31','folio-import-v27','folio-import-v28'].includes(project.template.importerVersion);
 if(!grouped&&project.template.sourceColorProfile?.sourceSha256!==project.source.sha256)return [];
 return project.template.pages.flatMap(page=>page.regions.filter((region):region is TextRegion=>{
  if(region.kind!=='text'||!region.sourceLayout||region.sourceLayout.sourceSha256!==project.source.sha256)return false;
  if(grouped){if(Array.from((region.sourceLayout.glyphEncoding==='shared-font-tuple-v1'?region.sourceLayout.glyphs.map(g=>g[1]):region.sourceLayout.glyphs.map(g=>g.unicode))).some(u=>Array.from(u).length!==1))return false;if(!composite&&!region.sourceScopedPaint?.showGroup||region.sourceLayout.version!==1||region.sourceLayout.anchor!=='start'||Array.from((region.sourceLayout.glyphEncoding==='shared-font-tuple-v1'?region.sourceLayout.glyphs.map(g=>g.length===6):region.sourceLayout.glyphs.map(g=>g.inferredGap))).some(Boolean))return false;}
  else if(region.sourceScopedPaint?.color.space!=='ICCBased'||region.sourceScopedPaint.color.profileSha256!==project.template.sourceColorProfile!.sha256||region.sourceLayout.version===1||region.sourceLayout.editPolicy!=='scalarCovered')return false;
  const font=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId),baseline=project.baseline.blocks.find(b=>b.id===region.contentId),draft=project.draft.blocks.find(b=>b.id===region.contentId);
  if(font?.format!=='truetype'||(grouped?!(['folio-import-v27','folio-import-v28','folio-import-v30','folio-import-v31'].includes(project.template.importerVersion)?[7]:['folio-import-v22','folio-import-v23'].includes(project.template.importerVersion)?[4,5,6,11]:['folio-import-v21','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31','folio-import-v27','folio-import-v28'].includes(project.template.importerVersion)?[4,5,6]:[4,5]).includes(font.sourceVersion??0):font.sourceVersion!==7)||!font.originalProgram||font.sourceSha256!==project.source.sha256||!baseline||!draft||!blockText(baseline).trim()||baseline.runs.length!==1||draft.runs.length!==1||[baseline,draft].some(b=>b.sourceParagraphGroupId||b.runs.some(r=>r.href||r.underline))||project.template.sourceLinks?.some(l=>l.bindings.some(b=>b.regionId===region.id))||page.regions.filter(r=>r.kind==='text'&&r.order===region.order).length!==1)return false;
  try{return composite||!!currentSourceScopedPaint(region,project.template);}catch{return false;}
 }));
}
export function sourceWordingRenderReady(project:Project,render:RenderedDocument|null):boolean{
 return !!render&&render.documentScopedPurpose==='current'&&render.rendererVersion===rendererVersionFor(project.template)&&render.contentRevision===project.draft.revision&&render.sourceFingerprint===sourceDocumentFingerprint(project.template,project.draft);
}
export function sourceWordingPreviewReady(project:Project,render:RenderedDocument|null,regionId:string):boolean{
 return sourceWordingRenderReady(project,render)&&(!['folio-import-v16','folio-import-v17','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31','folio-import-v27','folio-import-v28'].includes(project.template.importerVersion)||licensedCurrentPreviewRewriteAllows(render,project,regionId))&&sourceWordingTargets(project).some(r=>r.id===regionId)&&!!render?.layout.regions.find(r=>r.regionId===regionId);
}
export function sourceWordingBlock(project:Project,regionId:string,text:string):ContentBlock{
 const region=sourceWordingTargets(project).find(r=>r.id===regionId);if(!region||text.length>10000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))throw new FolioError('SOURCE_WORDING','Select a supported approved span and keep its wording below 10,000 characters.');
 const block=project.draft.blocks.find(b=>b.id===region.contentId)!;return {...block,runs:[{...block.runs[0],text}]};
}

/** Same per-span predicate as sourceWordingPreviewReady, with document-sized
 * hashes and candidate discovery evaluated once for a complete canvas pass. */
export function sourceWordingPreviewTargets(project:Project,render:RenderedDocument|null):TextRegion[]{
 if(!sourceWordingRenderReady(project,render))return [];
 const gated=['folio-import-v16','folio-import-v17','folio-import-v19','folio-import-v20','folio-import-v21','folio-import-v22','folio-import-v23','folio-import-v24','folio-import-v25','folio-import-v29','folio-import-v30','folio-import-v31','folio-import-v27','folio-import-v28'].includes(project.template.importerVersion),ids=gated?licensedCurrentPreviewRewriteIds(render,project):null,visible=new Set(render!.layout.regions.map(r=>r.regionId));
 return sourceWordingTargets(project).filter(r=>(!ids||ids.has(r.id))&&visible.has(r.id));
}

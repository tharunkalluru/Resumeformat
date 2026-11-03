import {captureGroupedPagePlan,groupedWordingEligible,paintGroupedSourcePage,type GroupedPagePlan} from './source-grouped-page';
import {paintStandardGlyphs} from './standard-pdf';
import {standardFontKey,StandardFontFaceMetrics} from '../layout/standard-fonts';
import {MAX_SOURCE_PAGES} from '../core/model';
import {validateSelectedOriginalFonts} from '../import/pdf-selected-fonts';
import {compileLicensedCurrent,type GeneratedCurrentShow} from './licensed-current';
import {documentCurrentReplacements,type GeneratedDocumentCurrent} from './document-current';
import {rawClipTransformChain,rawClipReplayOperands} from '../import/pdf-atomic-paint';
import {pdfDecimal} from './pdf-decimal';
import type {VerifiedScopedReplay} from '../import/pdf-scoped-source';
import {validateSourceColorProfiles} from '../import/pdf-icc';
import {installSourceColor,iccColorOperators} from './source-color';
import {canonicalJson,hasOriginalCff,hasPermittedOriginalTrueType,hasLicensedSubset,hasValidApproval,hashJson,documentScopedHistoryBinding,type Project} from '../core/model';
import fontkit from '@pdf-lib/fontkit';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, PDFHexString, pushGraphicsState, popGraphicsState, concatTransformationMatrix, rgb,grayscale,rectangle,clip,clipEvenOdd,endPath,fill,PDFOperator,PDFOperatorNames,moveTo,lineTo,setLineWidth,stroke } from 'pdf-lib';
import type { PDFFont, PDFPage } from 'pdf-lib';
import type { ContentSnapshot, ImageAsset, LayoutRun, RenderedDocument, Template } from '../core/model';
import { RENDERER_VERSION, rendererVersionFor, safeHref, sourceDocumentFingerprint } from '../core/model';
import { FolioError } from '../core/errors';
import { layoutDocument, prepareFonts, validateGeometry } from '../layout/engine';
import { FONT_FEATURES, fontKey } from '../layout/fonts';
import type { FontFaceMetrics, FontKey } from '../layout/fonts';
import { loadSourceFont, sourceFontKey, SourceFontFaceMetrics } from '../layout/source-fonts';
import { installSourceCidMap, paintSourceGlyphs } from './source-pdf';
import { currentSourceLinks } from '../core/source-links';
import {sourceImageBinding} from '../core/source-images';
import {currentSourceScopedPaint} from '../core/source-scoped-paint';
import {checkSourceGraphBudget} from '../core/source-graph';
import {packRecordMetadata} from '../core/project-record-codec';
import {packScopedMetadata} from '../core/source-scoped-codec';
import {MAX_SOURCE_BYTES} from '../core/model';

const standardAuthorizations=new WeakMap<Template,ContentSnapshot>();
const standardNativeOwners=new WeakMap<RenderedDocument,{projectId:string;fingerprint:string;evidence:string;bytes:Uint8Array}>();
export function standardCurrentPreviewAllows(render:RenderedDocument|null,project:Project):boolean{const owner=render&&standardNativeOwners.get(render);if(!owner||!render||!hasValidApproval(project)||render.documentScopedPurpose!=='current'||owner.projectId!==project.id||owner.fingerprint!==sourceDocumentFingerprint(project.template,project.draft)||render.sourceFingerprint!==owner.fingerprint||render.contentRevision!==project.draft.revision||nativeEvidence(render)!==owner.evidence||render.bytes.length!==owner.bytes.length)return false;for(let i=0;i<render.bytes.length;i++)if(render.bytes[i]!==owner.bytes[i])return false;return true;}
// Only this renderer can mint native current authority. No writer/capability is exported.
const nativeOwners=new WeakMap<RenderedDocument,{projectId:string;fingerprint:string;evidence:string;bytes:Uint8Array;regions:ReadonlyMap<string,'delete'|'rewrite'>}>();
const nativeEvidence=(r:RenderedDocument)=>canonicalJson({layout:r.layout,contentRevision:r.contentRevision,rendererVersion:r.rendererVersion,sourceFingerprint:r.sourceFingerprint,documentScopedPurpose:r.documentScopedPurpose});
function registerLicensedCurrentPreview(render:RenderedDocument,project:Project,regions:ReadonlyMap<string,'delete'|'rewrite'>):void{nativeOwners.set(render,{projectId:project.id,fingerprint:sourceDocumentFingerprint(project.template,project.draft),evidence:nativeEvidence(render),bytes:new Uint8Array(render.bytes),regions:new Map(regions)});}
export function licensedCurrentPreviewAllows(render:RenderedDocument|null,project:Project,regionId:string):boolean{
 try{const owner=render&&nativeOwners.get(render);if(!render||!owner||!hasValidApproval(project)||render.documentScopedPurpose!=='current'||render.rendererVersion!==rendererVersionFor(project.template)||owner.projectId!==project.id||owner.fingerprint!==sourceDocumentFingerprint(project.template,project.draft)||render.sourceFingerprint!==owner.fingerprint||render.contentRevision!==project.draft.revision||!owner.regions.has(regionId)||nativeEvidence(render)!==owner.evidence||!(render.bytes instanceof Uint8Array)||render.bytes.length!==owner.bytes.length)return false;
 for(let i=0;i<owner.bytes.length;i++)if(render.bytes[i]!==owner.bytes[i])return false;return true;}catch{return false;}
}
/** Validate a current preview once per synchronous UI pass, then copy its
 * private rewrite membership. Never cache authority across project mutations. */
export function licensedCurrentPreviewRewriteIds(render:RenderedDocument|null,project:Project):ReadonlySet<string>{
 const owner=render&&nativeOwners.get(render),first=owner?.regions.keys().next().value;
 if(!first||!licensedCurrentPreviewAllows(render,project,first))return new Set();
 return new Set([...owner!.regions].filter(([,mode])=>mode==='rewrite').map(([id])=>id));
}
export function licensedCurrentPreviewRewriteAllows(render:RenderedDocument|null,project:Project,regionId:string):boolean{return licensedCurrentPreviewAllows(render,project,regionId)&&nativeOwners.get(render!)!.regions.get(regionId)==='rewrite';}

const paragraphOwners = new WeakMap<RenderedDocument, {projectId:string; fingerprint:string; evidence:string; bytes:Uint8Array; members:ReadonlySet<string>}>();
/** Current glyph display authority only; this does not grant native caret editing. */
export function sourceParagraphCurrentPreviewAllows(render:RenderedDocument|null,project:Project,regionId:string):boolean {
 try {const owner=render&&paragraphOwners.get(render);if(!render||!owner||!hasValidApproval(project)||render.documentScopedPurpose!=='current'||render.rendererVersion!==rendererVersionFor(project.template)||owner.projectId!==project.id||owner.fingerprint!==sourceDocumentFingerprint(project.template,project.draft)||render.sourceFingerprint!==owner.fingerprint||render.contentRevision!==project.draft.revision||!owner.members.has(regionId)||nativeEvidence(render)!==owner.evidence||render.bytes.length!==owner.bytes.length)return false;return owner.bytes.every((v,i)=>render.bytes[i]===v);}catch{return false;}
}

/** Reject oversized supplied state before cloning or parsing retained source bytes. */
function projectRenderBudget(project:Project):void {
 const fail=():never=>{throw new FolioError('SOURCE_RENDER_BUDGET','The project exceeds the bounded source rendering limits.');};
 if(!(project.source.bytes instanceof Uint8Array)||project.source.bytes.length>MAX_SOURCE_BYTES||project.template.pages.length>MAX_SOURCE_PAGES||project.template.pages.some(p=>p.regions.length>4000))fail();
 const fonts=project.template.sourceFonts??[],standards=project.template.sourceStandardFonts??[];if(fonts.length+standards.length>32)fail();let bytes=0;
 for(const font of fonts){for(const program of [font.bytes,...('originalProgram'in font&&font.originalProgram?[font.originalProgram.bytes]:[])]){if(!(program instanceof Uint8Array)||program.length>4*1024*1024)fail();bytes+=program.length;}if(bytes>16*1024*1024)fail();}
 for(const f of standards){const p=f.nativeAdapter.bytes;if(!(p instanceof Uint8Array)||p.length>4*1024*1024||f.glyphMap.length>256)fail();bytes+=p.length;if(bytes>16*1024*1024)fail();}let standardGlyphs=0;for(const p of project.template.pages)for(const r of p.regions)if(r.kind==='text'&&r.sourceStandardLayout){standardGlyphs+=r.sourceStandardLayout.glyphs.length;if(standardGlyphs>100000)fail();}
 const profile=project.template.sourceColorProfile;if(profile&&(!(profile.bytes instanceof Uint8Array)||profile.bytes.length>65536||profile.encodedLength>65536))fail();
 checkSourceGraphBudget(project.template);
 if(!fonts.length&&!standards.length)return; // The existing positioned-font wire cap is not a legacy font-free cap.
 const metadata={...project,source:{...project.source,bytes:undefined},assets:project.assets.map(a=>({...a,bytes:undefined})),template:{...project.template,...(standards.length?{sourceStandardFonts:standards.map(f=>({...f,nativeAdapter:{...f.nativeAdapter,bytes:undefined}}))}:{}),...(project.template.sourceColorProfile?{sourceColorProfile:{...project.template.sourceColorProfile,bytes:undefined}}:{}),...(project.template.sourceFonts?{sourceFonts:fonts.map(font=>({...font,bytes:undefined,...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:undefined}}:{})}))}:{})},...(project.careerMemory?{careerMemory:{...project.careerMemory,sources:project.careerMemory.sources.map(s=>({...s,bytes:undefined}))}}:{})};
 if(new TextEncoder().encode(JSON.stringify(packRecordMetadata(packScopedMetadata(metadata)))).length>2*1024*1024)throw new FolioError('SOURCE_FONT_METADATA_LIMIT','The positioned source font document exceeds the 2 MiB metadata limit. No data was omitted.');
}

// Authorization never leaves this module. Immutable clones prevent asynchronous
// callers from exchanging content/programs after retained-source verification.
const authorizedDocumentScopes=new WeakMap<Template,{content:ContentSnapshot;purpose:'baselinePreview'|'current'|'historyPreview';decompositions:VerifiedScopedReplay;groupedPages?:ReadonlyMap<string,GroupedPagePlan>;groupedApproved?:boolean;originalRectangleBaseline?:true;permittedLegacyCurrent?:true;originalChanges?:ReadonlySet<string>;deleted?:ReadonlySet<string>;replacements?:ReadonlyMap<string,GeneratedCurrentShow|GeneratedDocumentCurrent>;restorations?:ReadonlyMap<string,ContentSnapshot['blocks'][number]>;paragraphPlans?:ReadonlyMap<string,import('./source-paragraph-current').CompiledSourceParagraph>;paragraphSuppressed?:ReadonlySet<string>}>();
export async function renderProjectHistory(project:Project,versionId:string):Promise<RenderedDocument>{
 return renderBoundProject(project,'historyPreview',versionId);
}
export async function renderProjectDocument(project:Project,purpose:'baselinePreview'|'current'):Promise<RenderedDocument>{
 return renderBoundProject(project,purpose);
}
async function renderBoundProject(project:Project,purpose:'baselinePreview'|'current'|'historyPreview',versionId?:string):Promise<RenderedDocument>{
 projectRenderBudget(project);
 const input=structuredClone(project);
 const [{validateProject},{validateDocumentScopedSourceClass}]=await Promise.all([import('../core/schema'),import('../import/pdf-original-tt')]);
 const snapshot=validateProject(input);
 if(snapshot.source.format==='pdf')await (await import('../import/pdf-composite')).validateCompositeSourceClass(snapshot);
 if(snapshot.template.sourceType1Baseline){
  const saved=purpose==='historyPreview'?snapshot.folio?.versions.find(v=>v.id===versionId):undefined;
  if(purpose==='historyPreview'&&!saved)throw new FolioError('SOURCE_HISTORY_PROOF','This saved version does not belong to the current application.');
  return (await import('../import/pdf-type1-baseline')).renderOriginalType1Baseline(snapshot,purpose,saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft));
 }
 if(snapshot.template.sourceCompositePages&&snapshot.template.sourceCompositePages.version!=='original-native-composite-v1'){const nativeSaved=purpose==='historyPreview'?snapshot.folio?.versions.find(v=>v.id===versionId):undefined;if(purpose==='historyPreview'&&(!nativeSaved||nativeSaved.documentScopedBinding!==documentScopedHistoryBinding(snapshot)))throw new FolioError('SOURCE_HISTORY_PROOF','Saved composite version binding changed.');const result=await (await import('../import/pdf-composite')).renderCompositeProject(snapshot,purpose,nativeSaved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft));if(purpose==='current'&&hasValidApproval(snapshot))registerLicensedCurrentPreview(result.document,snapshot,result.eligible);return result.document;}
 await validateSourceColorProfiles(snapshot.source.bytes,snapshot.template);
 await validateDocumentScopedSourceClass(snapshot.source.bytes,snapshot.template.sourceFonts??[],snapshot.template);
 await (await import('../import/pdf-licensed-source')).validateLicensedSubsetSourceClass(snapshot.source.bytes,snapshot.template.sourceFonts??[],snapshot.template);
 await validateSelectedOriginalFonts(snapshot.source.bytes,snapshot.template);
 if(snapshot.source.format==='pdf')await (await import('../import/pdf-standard-native')).validateStandard14Source(snapshot,purpose!=='current');
 const saved=purpose==='historyPreview'?snapshot.folio?.versions.find(v=>v.id===versionId):undefined;
 if(purpose==='historyPreview'&&!saved)throw new FolioError('SOURCE_HISTORY_PROOF','This saved version does not belong to the current application.');
 if(snapshot.template.sourceStandardFonts?.length){
  const content=saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft);
  if(purpose!=='baselinePreview'&&canonicalJson(content.blocks)!==canonicalJson(snapshot.baseline.blocks)&&(!hasValidApproval(snapshot)||snapshot.approval!.layoutHash!==await hashJson(snapshot.template)||snapshot.approval!.baselineHash!==await hashJson(snapshot.baseline.blocks)))throw new FolioError('SOURCE_TEMPLATE_APPROVAL','Approve the original standard template before changed-current rendering.');
  standardAuthorizations.set(snapshot.template,content);
  try{const result=await renderDocument(snapshot.template,content,snapshot.assets);result.documentScopedPurpose=purpose;result.sourceFingerprint=sourceDocumentFingerprint(snapshot.template,content);if(purpose==='current')standardNativeOwners.set(result,{projectId:snapshot.id,fingerprint:result.sourceFingerprint,evidence:nativeEvidence(result),bytes:new Uint8Array(result.bytes)});return result;}finally{standardAuthorizations.delete(snapshot.template);}
 }
 if(snapshot.template.sourceCompositePages){if(purpose==='historyPreview'&&saved?.documentScopedBinding!==documentScopedHistoryBinding(snapshot))throw new FolioError('SOURCE_HISTORY_PROOF','Saved composite version binding changed.');const composite=await (await import('../import/pdf-composite')).renderCompositeProject(snapshot,purpose,saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft));if(purpose==='current'&&hasValidApproval(snapshot))registerLicensedCurrentPreview(composite.document,snapshot,composite.eligible);return composite.document;}
 if(hasOriginalCff(snapshot.template)||hasPermittedOriginalTrueType(snapshot.template))return renderPermittedOriginalBaseline(snapshot,purpose,saved);
 if(!hasLicensedSubset(snapshot.template)&&!snapshot.template.sourceColorProfile&&!snapshot.template.sourceFonts?.some(f=>f.sourceVersion===7))return renderDocument(snapshot.template,saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft),snapshot.assets);
 const [{validateOriginalPrograms},{validateSourceScopedPaint},{validateSourceImagePaint},{validateSourceRulePaint}]=await Promise.all([import('../import/pdf-original-tt'),import('../import/pdf-scoped-source'),import('../import/pdf-source-images'),import('../import/pdf-source-rules')]);
 if(purpose==='historyPreview'&&(!saved?.documentScopedBinding||saved.documentScopedBinding!==documentScopedHistoryBinding(snapshot)))throw new FolioError('SOURCE_HISTORY_PROOF','This saved version has no matching source, template and renderer binding. Historical comparison is unavailable.');
 await validateOriginalPrograms(snapshot.source.bytes,snapshot.template.sourceFonts??[],snapshot.template);
 const selectedContent=saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft);
 const documentAtomic=!!snapshot.template.sourceColorProfile&&!!snapshot.template.sourceFonts?.some(f=>f.sourceVersion===7);
 const atomic=hasLicensedSubset(snapshot.template)||documentAtomic;
 const decompositions=await validateSourceScopedPaint(snapshot.source.bytes,snapshot.template,snapshot.assets,true,atomic);
 if(!decompositions)throw new FolioError('PDF_TEXT_DECOMPOSITION','Original scoped text decomposition is unavailable.');
 const groupedPages=new Map<string,GroupedPagePlan>();
 if(['folio-import-v27','folio-import-v28'].includes(snapshot.template.importerVersion))for(const [pageId,captured]of decompositions.groupedCaptures??[]){const page=snapshot.template.pages.find(p=>p.id===pageId)!;groupedPages.set(pageId,await captureGroupedPagePlan(snapshot.source.bytes,snapshot.template.pages.indexOf(page)+1,page,snapshot.template.sourceFonts??[],captured,snapshot.baseline,true));}
 if(['folio-import-v27','folio-import-v28'].includes(snapshot.template.importerVersion)&&!groupedPages.size)throw new FolioError('PDF_GROUPED_SOURCE','Grouped document source pages are missing.');

 if(decompositions.sourceSemanticSplit&&canonicalJson(selectedContent.blocks)!==canonicalJson(snapshot.baseline.blocks))throw new FolioError('PDF_SOURCE_SEMANTIC_SPLIT','Extractor-separated source spans support only unchanged complete original baseline replay.');
 await validateSourceImagePaint(snapshot.source.bytes,snapshot.template,snapshot.assets);
 await validateSourceRulePaint(snapshot.source.bytes,snapshot.template);
 const {validateDocumentScopedBaseline}=await import('../import/document-scoped-baseline');
 await validateDocumentScopedBaseline(snapshot);
 if(purpose!=='baselinePreview'){
  if(!hasValidApproval(snapshot)||snapshot.approval!.layoutHash!==await hashJson(snapshot.template)||snapshot.approval!.baselineHash!==await hashJson(snapshot.baseline.blocks))throw new FolioError('SOURCE_FONT_REUSE_REQUIRED','The current document font reuse choice must be approved before rendering an edited document.');
 }
 const content=saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft);
 // The shared retained-source validator binds baseline wording, marks and links;
 // history selects only an explicitly owned version, never caller-supplied content.
 const licensedReplacements=new Map<string,GeneratedCurrentShow>(),restorations=new Map<string,ContentSnapshot['blocks'][number]>();
 const deleted=hasLicensedSubset(snapshot.template)?(await import('./licensed-content')).licensedSubsetDeletedRegions(snapshot,content,decompositions,licensedReplacements,restorations):undefined;
 const replacements:ReadonlyMap<string,GeneratedCurrentShow|GeneratedDocumentCurrent>=documentAtomic&&!groupedPages.size?documentCurrentReplacements(snapshot,content,decompositions):licensedReplacements;
 // V7 wording changes retain every independently proved primitive. Text plans
 // replace only their whole show; they grant no rectangle mutation authority.
 // Licensed subset behavior keeps its existing deletion/equivalence contract.
 const originalRectangleBaseline=documentAtomic||canonicalJson(content.blocks)===canonicalJson(snapshot.baseline.blocks)||hasLicensedSubset(snapshot.template)&&deleted!==undefined&&deleted.size===0&&replacements.size===0;
 for(const page of snapshot.template.pages)if(groupedPages.size&&!groupedPages.has(page.id))for(const r of page.regions)if(r.kind==='text'&&canonicalJson(content.blocks.find(b=>b.id===r.contentId))!==canonicalJson(snapshot.baseline.blocks.find(b=>b.id===r.contentId)))throw new FolioError('PDF_GROUPED_SOURCE','Ungrouped document pages retain their baseline content.');
 authorizedDocumentScopes.set(snapshot.template,{content,purpose,...(groupedPages.size?{groupedPages,groupedApproved:hasValidApproval(snapshot)}:{}),decompositions,deleted,replacements,restorations,...(originalRectangleBaseline?{originalRectangleBaseline:true as const}:{})});
 try{
  const result={...await renderDocument(snapshot.template,content,snapshot.assets),documentScopedPurpose:purpose};
  if(groupedPages.size&&purpose==='current'&&hasValidApproval(snapshot)){const eligible=new Map<string,'rewrite'>();for(const [pageId,plan]of groupedPages)for(const region of snapshot.template.pages.find(p=>p.id===pageId)!.regions)if(region.kind==='text'&&groupedWordingEligible(plan,region.id))eligible.set(region.id,'rewrite');registerLicensedCurrentPreview(result,snapshot,eligible);}
  if(purpose==='current'&&hasLicensedSubset(snapshot.template)&&!decompositions.sourceSemanticSplit){
   const eligible=new Map<string,'delete'|'rewrite'>();for(const page of snapshot.template.pages)for(const region of page.regions)if(region.kind==='text'){const witness=decompositions.get(region.id);if(!witness)continue;if(witness.wholeShow&&witness.atomicLeader===region.id&&[...decompositions.values()].filter(w=>w.atomicLeader===region.id).length===1&&!snapshot.template.sourceLinks?.some(link=>link.bindings.some(binding=>binding.regionId===region.id)))eligible.set(region.id,'delete');try{const nativePlan=compileLicensedCurrent(snapshot,snapshot.baseline,region,witness,decompositions);if(nativePlan.fontSize===region.style.fontSize&&nativePlan.characterSpacing*(nativePlan.ctm[0]*nativePlan.textMatrix[0])===(region.sourceLayout?.version===3?region.sourceLayout.characterSpacing:0))eligible.set(region.id,'rewrite');}catch{/* Ineligible source stays readable; it receives no native rewrite capability. */}}
   registerLicensedCurrentPreview(result,snapshot,eligible);
  }return result;
 }finally{authorizedDocumentScopes.delete(snapshot.template);}
}

/** Known original permissions are unchanged. This is not V7 consent or V8 native authority. */
async function renderPermittedOriginalBaseline(snapshot:Project,purpose:'baselinePreview'|'current'|'historyPreview',saved?:NonNullable<Project['folio']>['versions'][number]):Promise<RenderedDocument>{
 const content=saved?.content??(purpose==='baselinePreview'?snapshot.baseline:snapshot.draft),original=canonicalJson(content.blocks)===canonicalJson(snapshot.baseline.blocks);
 if(hasOriginalCff(snapshot.template)&&!original&&!hasValidApproval(snapshot))throw new FolioError('SOURCE_CFF_CURRENT','Approve the current reconstructed template before changing original CFF wording.');

 if(purpose==='historyPreview'&&(!saved?.documentScopedBinding||saved.documentScopedBinding!==documentScopedHistoryBinding(snapshot)||!hasValidApproval(snapshot)))throw new FolioError('SOURCE_HISTORY_PROOF','This saved version has no current permitted-font source, template and renderer binding.');
 if(purpose==='current'&&snapshot.approval&&!hasValidApproval(snapshot))throw new FolioError('SOURCE_TEMPLATE_REVIEW','Review the original template with the current permitted-font renderer before using this approval.');
 const [{validateOriginalPrograms},{validateSourceScopedPaint},{validateSourceImagePaint},{validateSourceRulePaint},{validateDocumentScopedBaseline}]=await Promise.all([import('../import/pdf-original-tt'),import('../import/pdf-scoped-source'),import('../import/pdf-source-images'),import('../import/pdf-source-rules'),import('../import/document-scoped-baseline')]);
 await validateOriginalPrograms(snapshot.source.bytes,snapshot.template.sourceFonts??[],snapshot.template);
 const replay=await validateSourceScopedPaint(snapshot.source.bytes,snapshot.template,snapshot.assets,true,true);
 const groupedPages=new Map<string,GroupedPagePlan>();for(const [pageId,captured]of replay?.groupedCaptures??[]){const page=snapshot.template.pages.find(p=>p.id===pageId)!;groupedPages.set(pageId,await captureGroupedPagePlan(snapshot.source.bytes,snapshot.template.pages.indexOf(page)+1,page,snapshot.template.sourceFonts??[],captured,snapshot.baseline));}
 let mixedTrueType=false;
 if(!original&&!groupedPages.size&&hasPermittedOriginalTrueType(snapshot.template)&&hasValidApproval(snapshot)&&replay){
  try{validatePermittedCurrent(snapshot,content,replay);mixedTrueType=true;}catch(error){if(!(error instanceof FolioError)||error.code!=='SOURCE_TT_CURRENT')throw error;}
 }
 const originalChanges=new Set<string>();
 if((hasOriginalCff(snapshot.template)||mixedTrueType)&&!original){
  if(!replay)throw new FolioError('SOURCE_CFF_CURRENT','Current CFF wording needs complete original ownership.');
  if(hasOriginalCff(snapshot.template))validateCffCurrent(snapshot,content,replay);
  for(const page of snapshot.template.pages)for(const region of page.regions)if(region.kind==='text'){const before=snapshot.baseline.blocks.find(b=>b.id===region.contentId),after=content.blocks.find(b=>b.id===region.contentId);if(canonicalJson(before?.runs.map(({sourceFactIds:_,...run})=>run))!==canonicalJson(after?.runs.map(({sourceFactIds:_,...run})=>run)))originalChanges.add(region.id);}
  // The full immutable replay remains authoritative for every untouched owner.
  // Only these validated changed slots use freshly laid-out current glyphs.

 }
 if(replay?.sourceSemanticSplit&&!original)throw new FolioError('PDF_SOURCE_SEMANTIC_SPLIT','Extractor-separated source spans support only unchanged complete original baseline replay.');
 await validateSourceImagePaint(snapshot.source.bytes,snapshot.template,snapshot.assets);
 await validateSourceRulePaint(snapshot.source.bytes,snapshot.template);
 await validateDocumentScopedBaseline(snapshot);
 if(original&&!replay)throw new FolioError('PDF_TEXT_DECOMPOSITION','The original permitted-font baseline needs complete retained-source show and paint proof.');
 // Changed complete identity owners retain fresh replay for untouched shows.
 // Unsupported legacy TrueType edits retain their pre-existing per-glyph route.
 const paragraphs=(await import('./source-paragraph-current')).compileSourceParagraphs(snapshot,content,replay??new Map());
 authorizedDocumentScopes.set(snapshot.template,{content,purpose,...(groupedPages.size?{groupedPages,groupedApproved:hasValidApproval(snapshot)}:{}),decompositions:original||hasOriginalCff(snapshot.template)||mixedTrueType?replay??new Map():new Map(),...((hasOriginalCff(snapshot.template)||mixedTrueType)?{originalChanges,originalRectangleBaseline:true as const}:original?{originalRectangleBaseline:true as const}:{permittedLegacyCurrent:true as const}),paragraphPlans:paragraphs.plans,paragraphSuppressed:paragraphs.suppressed,restorations:paragraphs.restorations});
 try{const rendered:RenderedDocument={...await renderDocument(snapshot.template,content,snapshot.assets),documentScopedPurpose:purpose,sourceReplay:original?'original-baseline':hasOriginalCff(snapshot.template)?'original-cff-current':mixedTrueType?'original-tt-current':'legacy-current'};if(purpose==='current'&&paragraphs.plans.size)paragraphOwners.set(rendered,{projectId:snapshot.id,fingerprint:sourceDocumentFingerprint(snapshot.template,content),evidence:nativeEvidence(rendered),bytes:new Uint8Array(rendered.bytes),members:new Set(paragraphs.suppressed)});if(groupedPages.size&&purpose==='current'&&hasValidApproval(snapshot)){const eligible=new Map<string,'rewrite'>();for(const [pageId,plan]of groupedPages)for(const region of snapshot.template.pages.find(p=>p.id===pageId)!.regions)if(region.kind==='text'&&groupedWordingEligible(plan,region.id))eligible.set(region.id,'rewrite');registerLicensedCurrentPreview(rendered,snapshot,eligible);}if(hasOriginalCff(snapshot.template)&&purpose==='current'&&hasValidApproval(snapshot)&&replay){const eligible=new Map<string,'rewrite'>();for(const page of snapshot.template.pages)for(const region of page.regions)if(region.kind==='text'){try{validateCffCurrent(snapshot,content,replay,true,region.id);eligible.set(region.id,'rewrite');}catch{/* Only this unsupported owner remains read-only. */}}registerLicensedCurrentPreview(rendered,snapshot,eligible);}return rendered;}
 finally{authorizedDocumentScopes.delete(snapshot.template);}
}

/** A narrow mixed-paint route; no new native edit authority is minted here. */
function validatePermittedCurrent(project:Project,content:ContentSnapshot,replay:VerifiedScopedReplay):void {
 const fail=():never=>{throw new FolioError('SOURCE_TT_CURRENT','Changed original TrueType wording is not one complete covered identity owner.');};
 if(content.blocks.length!==project.baseline.blocks.length)return fail();
 const paintRuns=(runs:ContentSnapshot['blocks'][number]['runs'])=>runs.map(({sourceFactIds:_,...run})=>run);
 for(const before of project.baseline.blocks){
  const after=content.blocks.find(b=>b.id===before.id);if(!after)return fail();
  if(canonicalJson(paintRuns(before.runs))===canonicalJson(paintRuns(after.runs)))continue;
  const region=project.template.pages.flatMap(p=>p.regions).find(r=>r.kind==='text'&&r.contentId===before.id);
  if(!region||region.kind!=='text')return fail();
  const font=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId),w=replay.get(region.id);
  if(!font||font.format!=='truetype'||!('originalProgram'in font)||!font.originalProgram||![4,5,6].includes(font.sourceVersion??0)||!w?.wholeShow||w.atomicLeader!==region.id||[...replay.values()].filter(v=>v.atomicLeader===region.id).length!==1||region.sourceLayout?.version!==1||region.sourceLayout.anchor!=='start'||before.runs.length!==1||after.runs.length!==1)return fail();
  const c=w.decomposition.ctm,m=w.wholeShow.fullTextMatrix;
  if(c[0]!==1||c[1]!==0||c[2]!==0||c[3]!==1||m[0]!==1||m[1]!==0||m[2]!==0||m[3]!==1||w.wholeShow.characterSpacing!==0||w.atomicGroupGlyphs?.some(g=>g.inferredGap))return fail();
  const strip=({text:_,sourceFactIds:__,...rest}:typeof before.runs[number])=>rest;
  if(before.runs[0].href||before.runs[0].underline||canonicalJson(strip(before.runs[0]))!==canonicalJson(strip(after.runs[0]))||/[\r\n]/.test(after.runs[0].text))return fail();
  const face=loadSourceFont(font);if(Array.from(after.runs[0].text).some(c=>!face.mapping(c)))return fail();
 }
}

function validateCffCurrent(project:Project,content:ContentSnapshot,replay:VerifiedScopedReplay,all=false,onlyRegionId?:string):void {
 const fail=():never=>{throw new FolioError('SOURCE_CFF_CURRENT','Changed CFF wording requires one complete covered source owner with unchanged style.');};
 if(content.blocks.length!==project.baseline.blocks.length)return fail();
 for(const before of project.baseline.blocks){
  const after=content.blocks.find(b=>b.id===before.id);if(!after)return fail();
  if(!all&&canonicalJson(before.runs)===canonicalJson(after.runs))continue;
  const region=project.template.pages.flatMap(p=>p.regions).find(r=>r.kind==='text'&&r.contentId===before.id);
  if(!region||region.kind!=='text')return fail();
  if(onlyRegionId&&region.id!==onlyRegionId)continue;
  const font=project.template.sourceFonts?.find(f=>f.id===region.style.sourceFontId),w=replay.get(region.id);
  if(!font||font.sourceVersion!==9||font.originalCff.permission.fsType===4||!w?.wholeShow||w.atomicLeader!==region.id||[...replay.values()].filter(v=>v.atomicLeader===region.id).length!==1||region.sourceLayout?.version!==1||region.sourceLayout.anchor!=='start'||before.runs.length!==1||after.runs.length!==1)return fail();
  const c=w.decomposition.ctm,m=w.wholeShow.fullTextMatrix;
  if(c[0]!==1||c[1]!==0||c[2]!==0||c[3]!==1||m[0]!==1||m[1]!==0||m[2]!==0||m[3]!==1||w.wholeShow.characterSpacing!==0||w.atomicGroupGlyphs?.some(g=>g.inferredGap))return fail();
  const strip=({text:_,sourceFactIds:__,...rest}:typeof before.runs[number])=>rest;
  if(before.runs[0].href||before.runs[0].underline||canonicalJson(strip(before.runs[0]))!==canonicalJson(strip(after.runs[0]))||/[\r\n]/.test(after.runs[0].text))return fail();
  const face=loadSourceFont(font);if(Array.from(after.runs[0].text).some(c=>!face.mapping(c)))return fail();
 }
}

function color(value: string) {
  const expanded = /^#[\da-f]{3}$/i.test(value)
    ? `#${[...value.slice(1)].map(digit => digit + digit).join('')}` : value;
  if (!/^#[\da-f]{6}$/i.test(expanded)) throw new FolioError('render-color', `Unsupported document color ${JSON.stringify(value)}. Use a hex RGB color.`);
  return rgb(Number.parseInt(expanded.slice(1, 3), 16) / 255,
    Number.parseInt(expanded.slice(3, 5), 16) / 255, Number.parseInt(expanded.slice(5, 7), 16) / 255);
}

/** Isolated low-level PDF URI annotation: only allowlisted current visible links. */
function addLink(document: PDFDocument, page: PDFPage, run: LayoutRun, baseline: number,
  size: number, face: FontFaceMetrics): void {
  const href = run.href && safeHref(run.href);
  if (!href || run.width <= 0 || !run.text.trim()) return;
  const rect = [run.x, page.getHeight() - baseline - face.descent(size),
    run.x + run.width, page.getHeight() - baseline + face.ascent(size)];
  const annotation = document.context.obj({
    Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'), Rect: rect,
    Border: [0, 0, 0],
    A: { Type: PDFName.of('Action'), S: PDFName.of('URI'),
      URI: PDFString.of(href.replace(/[^\x20-\x7e]/gu, character => encodeURIComponent(character))) },
  });
  page.node.addAnnot(document.context.register(annotation));
}

/** Reject huge decoded raster dimensions before the PNG decoder allocates them. */
function imageDimensions(asset: ImageAsset): { width: number; height: number } {
  const bytes = asset.bytes;
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('Image exceeds the 10 MiB asset limit or is empty.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (asset.mime === 'image/png') {
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || !signature.every((value, i) => bytes[i] === value) ||
        String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') throw new Error('PNG signature or header is invalid.');
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG signature is invalid.');
  let offset = 2;
  while (offset < bytes.length) {
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) break;
    const length = view.getUint16(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      if (length < 8) break;
      return { width: view.getUint16(offset + 5), height: view.getUint16(offset + 3) };
    }
    offset += length;
  }
  throw new Error('JPEG has no valid image dimensions.');
}

/**
 * Creates a fresh PDF, never accepting source PDF bytes or copying source pages.
 * Overflows remain in canonical lines and the preview PDF. Callers must block
 * export while layout.overflows is nonempty and reject stale contentRevision.
 */
export async function renderDocument(template: Template, content: ContentSnapshot,
  assets: ImageAsset[]): Promise<RenderedDocument> {
  if(template.sourceCompositePages&&['original-native-composite-v4','original-native-composite-v5','original-native-composite-v6','original-native-composite-v7','original-native-composite-v8','original-native-composite-v9','original-native-composite-v10'].includes(template.sourceCompositePages.version))throw new FolioError('PDF_COMPOSITE_PROOF','Original ligature templates require a fresh project-bound native proof.');
  if(template.sourceStandardFonts?.length&&standardAuthorizations.get(template)!==content)throw new FolioError('PDF_STANDARD_FONT','Original standard fonts require a fresh project-bound source proof.');
  if((['folio-import-v16','folio-import-v17','folio-import-v18'].includes(template.importerVersion)||hasOriginalCff(template)||hasLicensedSubset(template)||template.sourceColorProfile||template.sourceFonts?.some(f=>f.sourceVersion===7))&&authorizedDocumentScopes.get(template)?.content!==content)throw new FolioError('SOURCE_FONT_REUSE_REQUIRED','Document-scoped fonts require a current project-bound render authorization.');
  if(template.sourceFonts?.some(f=>f.sourceVersion===7)){for(const page of template.pages)for(const r of page.regions)if(r.kind==='text'&&template.sourceFonts.some(f=>f.sourceVersion===7&&f.id===r.style.sourceFontId)){const block=content.blocks.find(b=>b.id===r.contentId);if(block?.runs.some(run=>run.bold===true||run.italic===true))throw new FolioError('SOURCE_DOCUMENT_FONT_STYLE','Document-scoped fonts cannot switch bold or italic faces.');}}
  validateGeometry(template);
  if (assets.length > 100) throw new FolioError('render-limit', 'The document exceeds 100 image assets.');
  const fonts = await prepareFonts(template, content);
  const context=authorizedDocumentScopes.get(template),layoutContent=context?.restorations?.size?{...content,blocks:content.blocks.map(block=>context.restorations!.get(block.id)??block)}:content;
  const baseLayout = layoutDocument(template, layoutContent, fonts,context?.replacements);
  const layout = (await import('../layout/source-paragraph-layout')).applySourceParagraphLayout(template,baseLayout,context?.paragraphPlans??new Map());
  const document = await PDFDocument.create({ updateMetadata: false });
  document.registerFontkit(fontkit);
  const embedded = new Map<FontKey, PDFFont>();
  const standardRefs=new Map<string,import('pdf-lib').PDFRef>();
  for(const f of template.sourceStandardFonts??[]){const dict=document.context.obj({Type:'Font',Subtype:'Type1',BaseFont:f.baseFont,Encoding:'WinAnsiEncoding',...(f.widths?{FirstChar:f.widths.firstChar,LastChar:f.widths.lastChar,Widths:f.widths.values}:{})});standardRefs.set(f.id,document.context.register(dict));}
  for (const [key, face] of fonts) {
    if(key.startsWith('standard:'))continue;
    embedded.set(key, await document.embedFont(face.pdfBytes, {
      subset: !key.startsWith('times-') && !key.startsWith('source:'), customName: `Folio-${key}`, features: FONT_FEATURES,
    }));
  }
  const layouts = new Map(layout.regions.map(region => [region.regionId, region]));
  const assetMap = new Map(assets.map(asset => [asset.id, asset]));
  if (assetMap.size !== assets.length) throw new FolioError('render-assets', 'Image identifiers must be unique.');
  const imageCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
  for (const templatePage of template.pages) {
    const page = document.addPage([templatePage.width, templatePage.height]);
    const scopedPage=template.sourceScopedPages?.pages[template.pages.indexOf(templatePage)],frame=scopedPage?.pageFrame;
    if(frame){if(!context?.groupedPages?.has(templatePage.id))throw new FolioError('PDF_PAGE_FRAME','Translated pages require complete source-coordinate reset replay.');for(const [key,box] of Object.entries(frame.boxes))page.node.set(PDFName.of(key),document.context.obj(box));}
    if(scopedPage?.pageGroup)page.node.set(PDFName.of('Group'),document.context.obj({Type:'Group',S:'Transparency',CS:'DeviceRGB',I:scopedPage.pageGroup.isolated,K:false}));
    const sourceLinkState = currentSourceLinks(template, content, templatePage.id);
    for (const link of sourceLinkState.links) {
      const b = link.bounds;
      const annotation = document.context.obj({
        Type: PDFName.of('Annot'), Subtype: PDFName.of('Link'),
        Rect: frame?[b.x+frame.boxes.MediaBox[0],frame.boxes.MediaBox[3]-b.y-b.height,b.x+b.width+frame.boxes.MediaBox[0],frame.boxes.MediaBox[3]-b.y]:[b.x, page.getHeight() - b.y - b.height, b.x + b.width, page.getHeight() - b.y], Border: [0,0,0],
        A: { Type: PDFName.of('Action'), S: PDFName.of('URI'), URI: PDFString.of(link.href) },
      });
      page.node.addAnnot(document.context.register(annotation));
    }
    const groupedPlan=context?.groupedPages?.get(templatePage.id);if(groupedPlan){paintGroupedSourcePage(groupedPlan,document,page,embedded,content,context?.groupedApproved===true,template.sourceColorProfile);continue;}
    const atomicPlan=authorizedDocumentScopes.get(template)?.decompositions.atomicPages?.get(templatePage.id);let atomicIndex=0;let activeClips:readonly import('../import/pdf-scoped-paint').ScopedPaintClip[]=[];const consumedShows=new Set<number>();
    const atomicOwners=new Set<string>();
    if(atomicPlan)for(const region of templatePage.regions){const witness=authorizedDocumentScopes.get(template)!.decompositions.get(region.id);if(!witness?.atomicLeader||authorizedDocumentScopes.get(template)?.deleted?.has(region.id)||authorizedDocumentScopes.get(template)?.replacements?.has(region.id)||authorizedDocumentScopes.get(template)?.originalChanges?.has(region.id))continue;const lines=layouts.get(region.id)?.lines,run=lines?.[0]?.runs[0];if(region.kind!=='text'||lines?.length!==1||lines[0].runs.length!==1||!run?.sourceGlyphs||run.sourceFontId!==witness.fontId||lines[0].baseline!==region.sourceLayout?.baseline||canonicalJson(run.sourceGlyphs.map(g=>[g.fontId,g.cid,g.unicode,g.x,g.advance,g.operatorIndex,g.inferredGap??false]))!==witness.atomicOwnerGlyphs)throw new FolioError('PDF_ATOMIC_PAINT','A complete source show owner was split, changed or omitted.');}
    for (const region of [...templatePage.regions].sort((a, b) => a.order - b.order)) {
      const b = region.bounds;
      const scoped=currentSourceScopedPaint(region,template),iccKey=scoped?installSourceColor(document,page,scoped.color,template.sourceColorProfile):undefined,scopedColor=scoped&&scoped.color.space!=='ICCBased'?(scoped.color.space==='DeviceRGB'?rgb(...scoped.color.components as [number,number,number]):grayscale(scoped.color.components[0])):undefined;
      if(atomicPlan){
       if(!scoped)throw new FolioError('PDF_ATOMIC_PAINT','Missing current scoped paint.');
       const expected=atomicPlan[atomicIndex];
       // Integral split text regions may share a single original paint; preserve
       // that lifetime without treating any fragment as a whole show.
       if(expected?.operatorIndex!==region.order){const prior=atomicPlan[atomicIndex-1];if(region.kind!=='text'||prior?.operatorIndex!==region.order)throw new FolioError('PDF_ATOMIC_PAINT','Atomic paint order differs.');}
       else atomicIndex++;
       const groupWitness=context?.decompositions.get(region.id)?.showGroup;
       if(scoped.showGroup){if(!groupWitness||groupWitness.length!==scoped.showGroup.operators.length)throw new FolioError('PDF_ATOMIC_PAINT','Grouped show proof is missing.');for(let i=1;i<groupWitness.length;i++){const member=atomicPlan[atomicIndex];if(member?.operatorIndex!==groupWitness[i].operatorIndex||canonicalJson(member.clips)!==canonicalJson(scoped.clipStack))throw new FolioError('PDF_ATOMIC_PAINT','Grouped shows cross original paint or clip order.');atomicIndex++;}}
       const target=atomicPlan[atomicIndex-1].clips;if(canonicalJson(target)!==canonicalJson(scoped.clipStack))throw new FolioError('PDF_ATOMIC_PAINT','Atomic clip owner differs.');
       let common=0;while(common<activeClips.length&&common<target.length&&canonicalJson(activeClips[common])===canonicalJson(target[common]))common++;
       for(let i=activeClips.length;i>common;i--)page.pushOperators(popGraphicsState());
       for(let i=common;i<target.length;i++){const originalClip=target[i],raw=atomicPlan[atomicIndex-1].rawClips?.[i];if(!raw)throw new FolioError('PDF_ATOMIC_PAINT','The original clip construction is unavailable.');const chain=rawClipTransformChain(raw,originalClip);page.pushOperators(pushGraphicsState());if(chain.length)page.pushOperators(pushGraphicsState(),...chain.map(n=>PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,n.operands.map(pdfDecimal))));page.pushOperators(PDFOperator.of(PDFOperatorNames.AppendRectangle,rawClipReplayOperands(raw,originalClip).map(pdfDecimal)));if(chain.length)page.pushOperators(popGraphicsState());page.pushOperators(originalClip.fillRule==='evenodd'?clipEvenOdd():clip(),endPath());}
       activeClips=target;page.pushOperators(pushGraphicsState());
      }else if(scoped){page.pushOperators(pushGraphicsState());for(const originalClip of scoped.clipStack){const c=originalClip.bounds;page.pushOperators(rectangle(c.x,page.getHeight()-c.y-c.height,c.width,c.height),originalClip.fillRule==='evenodd'?clipEvenOdd():clip(),endPath());}}
      try{
      if(scoped?.zeroFill){const key=page.node.newExtGState('SourceZeroFill',document.context.register(document.context.obj({Type:'ExtGState',ca:0})));page.pushOperators(PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams,[key]));}
      if(scoped?.appleAA!==undefined){const key=page.node.newExtGState('SourceAppleAA',document.context.register(document.context.obj({Type:'ExtGState','AAPL:AA':scoped.appleAA})));page.pushOperators(PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams,[key]));}
      if(context?.paragraphSuppressed?.has(region.id)){
        const witness=context.decompositions.get(region.id);
        if(!witness?.wholeShow||witness.atomicLeader!==region.id||atomicOwners.has(region.id)||consumedShows.has(region.order))throw new FolioError('SOURCE_PARAGRAPH_PROOF','A grouped original owner was omitted or duplicated.');
        atomicOwners.add(region.id);consumedShows.add(region.order);
      }
      const paragraph=context?.paragraphPlans?.get(region.id);
      if(paragraph){
        const face=fonts.get(sourceFontKey(paragraph.group.fontId));
        if(!(face instanceof SourceFontFaceMetrics))throw new FolioError('SOURCE_PARAGRAPH_PROOF','The original bullet font is unavailable.');
        for(const line of paragraph.lines)paintSourceGlyphs(page,embedded.get(sourceFontKey(face.asset.id))!,face.asset,line.glyphs,line.baseline,line.fontSize,region.kind==='text'?region.style.color:'#000000',scoped?.color,iccKey,paragraph.witness.decomposition,undefined,line);
        continue;
      }
      if(context?.paragraphSuppressed?.has(region.id))continue;
      switch (region.kind) {
        case 'text': {
          if(authorizedDocumentScopes.get(template)?.deleted?.has(region.id)){const witness=authorizedDocumentScopes.get(template)!.decompositions.get(region.id);if(!witness?.wholeShow||witness.atomicLeader!==region.id)throw new FolioError('PDF_LICENSED_CONTENT','Deleted source show lacks its whole owner.');atomicOwners.add(region.id);consumedShows.add(region.order);break;}
          const lines = layouts.get(region.id)!.lines;
          for (const line of lines) for (const run of line.runs) {
            if(run.sourceStandardFontId&&run.sourceStandardGlyphs){
              const face=fonts.get(standardFontKey(run.sourceStandardFontId)),ref=standardRefs.get(run.sourceStandardFontId),source=region.sourceStandardLayout;if(!(face instanceof StandardFontFaceMetrics)||!ref||!source)throw new FolioError('PDF_STANDARD_FONT','An original standard run has no fresh source resource.');
              paintStandardGlyphs(page,ref,face.asset,source,run.sourceStandardGlyphs,line.baseline,region.style.fontSize);if(run.underline&&run.width)page.drawLine({start:{x:run.x,y:page.getHeight()-line.baseline-face.underlineOffset(region.style.fontSize)},end:{x:run.x+run.width,y:page.getHeight()-line.baseline-face.underlineOffset(region.style.fontSize)},thickness:face.underlineThickness(region.style.fontSize),color:color(region.style.color)});if(!sourceLinkState.coveredRegions.has(region.id))addLink(document,page,run,line.baseline,region.style.fontSize,face);continue;
            }
            if (run.sourceFontId && run.sourceGlyphs) {
              const key=sourceFontKey(run.sourceFontId),face=fonts.get(key);
              if(!(face instanceof SourceFontFaceMetrics))throw new FolioError('SOURCE_FONT_MISSING','The verified source font is missing.');
              const context=authorizedDocumentScopes.get(template),witness=context?.decompositions.get(region.id);
              if(context&&!context.permittedLegacyCurrent&&(!witness||witness.pageId!==templatePage.id||witness.regionId!==region.id||witness.fontId!==face.asset.id||!('originalProgram'in face.asset)||witness.programSha256!==face.asset.originalProgram?.sha256||witness.sourceSha256!==region.sourceLayout?.sourceSha256||witness.decomposition.operatorIndex!==region.order||witness.decomposition.effectiveFontSize!==region.style.fontSize))throw new FolioError('PDF_TEXT_DECOMPOSITION','The current run lacks its verified source matrix.');
              if(witness?.atomicLeader){if(atomicOwners.has(region.id))throw new FolioError('PDF_ATOMIC_PAINT','A source show owner was duplicated.');atomicOwners.add(region.id);}
              if(witness?.wholeShow){if(consumedShows.has(region.order)||!witness.atomicGroupGlyphs||canonicalJson(witness.atomicGroupGlyphs.map(g=>[g.fontId,g.cid,g.unicode,g.x,g.advance,g.operatorIndex,g.inferredGap??false]))!==witness.atomicGlyphs)throw new FolioError('PDF_ATOMIC_PAINT','Whole source show was changed or duplicated.');consumedShows.add(region.order);}
              const generated=context?.replacements?.get(region.id),ownerChanged=context?.originalChanges?.has(region.id)===true;
              if(witness?.showGroup)throw new FolioError('PDF_GROUPED_SOURCE','Grouped shows require their complete original reset-positioned page sequence.');
              if(!witness?.atomicLeader||witness.atomicLeader===region.id)paintSourceGlyphs(page,embedded.get(key)!,face.asset,generated?.glyphs??(ownerChanged?run.sourceGlyphs:witness?.atomicGroupGlyphs??run.sourceGlyphs),line.baseline,generated?.fontSize??region.style.fontSize,region.style.color,scoped?.color,iccKey,witness?.decomposition,generated||ownerChanged?undefined:witness?.wholeShow,generated);
              if(iccKey&&run.underline)throw new FolioError('PDF_ICC_PROOF','Native ICC formatting is unavailable; review the original PDF preview.');
              if(run.underline&&run.width>0)page.drawLine({start:{x:run.x,y:page.getHeight()-line.baseline-face.underlineOffset(region.style.fontSize)},end:{x:run.x+run.width,y:page.getHeight()-line.baseline-face.underlineOffset(region.style.fontSize)},thickness:face.underlineThickness(region.style.fontSize),color:scopedColor??color(region.style.color)});
              if (!sourceLinkState.coveredRegions.has(region.id)) addLink(document,page,run,line.baseline,region.style.fontSize,face);
              continue;
            }
            const key = fontKey(region.style, run.bold, run.italic);
            const face = fonts.get(key)!;
            page.setFont(embedded.get(key)!);
            for (const segment of face.positionedSegments(run.text, region.style.fontSize)) page.drawText(segment.text, { size: region.style.fontSize,
              x: run.x + segment.x, y: page.getHeight() - line.baseline, color: color(region.style.color) });
            if (run.underline && run.width > 0) {
              const y = page.getHeight() - line.baseline - face.underlineOffset(region.style.fontSize);
              page.drawLine({ start: { x: run.x, y }, end: { x: run.x + run.width, y },
                thickness: face.underlineThickness(region.style.fontSize), color: color(region.style.color) });
            }
            addLink(document, page, run, line.baseline, region.style.fontSize, face);
          }
          break;
        }
        case 'sourceShape': {
          const face=fonts.get(sourceFontKey(region.sourceFontId));if(!(face instanceof SourceFontFaceMetrics)||face.asset.format!=='opentype-cff'||face.asset.sha256!==region.sourceProgramSha256||!face.asset.shapeMap?.some(m=>m.glyphId===region.glyphId&&m.fontChar===region.fontChar))throw new FolioError('SOURCE_SHAPE_PROOF','The source decoration has no owned outline proof.');
          // drawSvgPath reverses SVG y; this isolated outer reversal restores font-up geometry.
          page.pushOperators(pushGraphicsState(),concatTransformationMatrix(1,0,0,-1,0,0));
          page.drawSvgPath(face.font.getGlyph(region.glyphId).path.toSVG(),{x:region.sourceX,y:-(page.getHeight()-region.sourceBaseline),scale:region.fontSize/face.font.unitsPerEm,color:color(region.color)});
          page.pushOperators(popGraphicsState());break;
        }
        case 'rule':
          if(scoped?.strokeAdjustment){const key=page.node.newExtGState('SourceAdjustedStroke',document.context.register(document.context.obj({Type:'ExtGState',SA:true})));page.pushOperators(PDFOperator.of(PDFOperatorNames.SetGraphicsStateParams,[key]));}
          if(iccKey){page.pushOperators(...iccColorOperators(iccKey,scoped!.color.components,true),setLineWidth(region.thickness),moveTo(b.x,page.getHeight()-b.y),lineTo(b.x+b.width,page.getHeight()-b.y-b.height),stroke());break;}
          if (region.thickness > 0) page.drawLine({
            start: { x: b.x, y: page.getHeight() - b.y },
            end: { x: b.x + b.width, y: page.getHeight() - b.y - b.height },
            thickness: region.thickness, color: scopedColor??color(region.color),
          });
          break;
        case 'rectangle':
          if(atomicPlan&&context?.originalRectangleBaseline&&!scoped?.rectanglePath){
            const replay=atomicPlan[atomicIndex-1].originalRectangle,invalid=()=>{throw new FolioError('PDF_ATOMIC_PAINT','The original plain rectangle is not a complete current baseline occurrence.');};
            if(!replay||!scoped||scoped.kind!=='fillRect'||!region.fill||region.stroke)invalid();
            const raw=replay!.construction,original=replay!.occurrence;
            if(raw.pageNumber!==template.pages.indexOf(templatePage)+1||raw.sourceSha256!==scoped!.sourceSha256||raw.viewport[5]!==page.getHeight()||raw.paintOperatorIndex!==scoped!.rawOperatorIndex||original.rawOperatorIndex!==scoped!.rawOperatorIndex||canonicalJson(original.bounds)!==canonicalJson(b)||canonicalJson(original.color)!==canonicalJson(scoped!.color)||b.width<=0||b.height<=0)invalid();
            // The source collector proves construction and paint transforms equal.
            // Keep the source chain active through fill for complete consumer geometry.
            if(replay!.transforms.length)page.pushOperators(pushGraphicsState(),...replay!.transforms.map(n=>PDFOperator.of(PDFOperatorNames.ConcatTransformationMatrix,n.operands.map(pdfDecimal))));
            page.pushOperators(PDFOperator.of(PDFOperatorNames.AppendRectangle,raw.operands.map(pdfDecimal)));
            page.pushOperators(...(iccKey?iccColorOperators(iccKey,scoped!.color.components):[scoped!.color.space==='DeviceGray'?PDFOperator.of(PDFOperatorNames.NonStrokingColorGray,scoped!.color.components.map(pdfDecimal)):PDFOperator.of(PDFOperatorNames.NonStrokingColorRgb,scoped!.color.components.map(pdfDecimal))]),PDFOperator.of(raw.fillOperator as PDFOperatorNames,[]));
            if(replay!.transforms.length)page.pushOperators(popGraphicsState());
            break;
          }
          if(atomicPlan&&scoped?.rectanglePath){
            const path=scoped.rectanglePath,points=path.points,indices=path.operatorIndices;
            const invalid=()=>{throw new FolioError('PDF_ATOMIC_PAINT','The original closed rectangle path is not a complete current identity-axis occurrence.');};
            if(path.version!=='closed-axis-rectangle-v1'||!region.fill||region.stroke||path.constructionCtm.length!==6||path.constructionCtm.some((v,i)=>v!==[1,0,0,1,0,0][i])||points.length!==4||points.some(p=>p.length!==2||p.some(v=>!Number.isFinite(v)||Math.abs(v)>1e6))||indices.length!==5||indices.some((v,i)=>!Number.isSafeInteger(v)||v<0||v>=scoped.rawOperatorIndex||i>0&&v<=indices[i-1])||new Set(points.map(p=>canonicalJson(p))).size!==4||new Set(points.map(p=>p[0])).size!==2||new Set(points.map(p=>p[1])).size!==2||!points.every((p,i)=>{const n=points[(i+1)%4],a=points[(i+2)%4];return((p[0]===n[0])!==(p[1]===n[1]))&&((p[0]===n[0])!==(n[0]===a[0]));})||!['nonzero','evenodd'].includes(path.fillRule))invalid();
            // Match the independently recaptured tracer operation order exactly; raw and viewport differences need not have identical floating representations.
            const projected=points.map(p=>[1*p[0]+0,-1*p[1]+page.getHeight()]),xs=projected.map(p=>p[0]),ys=projected.map(p=>p[1]);if(Math.min(...xs)!==b.x||Math.min(...ys)!==b.y||Math.max(...xs)-Math.min(...xs)!==b.width||Math.max(...ys)-Math.min(...ys)!==b.height||b.width<=0||b.height<=0)invalid();
            page.pushOperators(...(iccKey?iccColorOperators(iccKey,scoped.color.components):[scoped.color.space==='DeviceGray'?PDFOperator.of(PDFOperatorNames.NonStrokingColorGray,scoped.color.components.map(pdfDecimal)):PDFOperator.of(PDFOperatorNames.NonStrokingColorRgb,scoped.color.components.map(pdfDecimal))]),PDFOperator.of(PDFOperatorNames.MoveTo,points[0].map(pdfDecimal)),...points.slice(1).map(p=>PDFOperator.of(PDFOperatorNames.LineTo,p.map(pdfDecimal))),PDFOperator.of(PDFOperatorNames.ClosePath,[]),path.fillRule==='evenodd'?PDFOperator.of(PDFOperatorNames.FillEvenOdd,[]):fill());break;
          }
          if(iccKey){if(!region.fill||region.stroke)throw new FolioError('PDF_ICC_PROOF','Compound original ICC paint is unsupported.');page.pushOperators(...iccColorOperators(iccKey,scoped!.color.components),rectangle(b.x,page.getHeight()-b.y-b.height,b.width,b.height),scoped!.rectanglePath?.fillRule==='evenodd'?PDFOperator.of(PDFOperatorNames.FillEvenOdd,[]):fill());break;}
          page.drawRectangle({ x: b.x, y: page.getHeight() - b.y - b.height,
            width: b.width, height: b.height,
            ...(region.fill ? { color: scopedColor??color(region.fill) } : {}),
            ...(region.stroke ? { borderColor: color(region.stroke), borderWidth: region.thickness } : { borderWidth: 0 }),
            ...(region.fill ? {} : { opacity: 0 }),
          });
          break;
        case 'image': {
          const asset = assetMap.get(region.assetId);
          try {
            if (!asset) throw new Error('The approved PNG/JPEG asset is missing.');
            if(region.sourcePaint&&!sourceImageBinding(region,asset))throw new Error('The locked original image pixels or placement changed.');
            let image = imageCache.get(asset.id);
            if (!image) {
              const dims = imageDimensions(asset);
              if (dims.width <= 0 || dims.height <= 0 || dims.width * dims.height > 20_000_000) {
                throw new Error('Image exceeds the 20 megapixel decoded limit or has invalid dimensions.');
              }
              image = asset.mime === 'image/png' ? await document.embedPng(asset.bytes) : await document.embedJpg(asset.bytes);
              imageCache.set(asset.id, image);
            }
            const sourceClip=region.sourcePaint?.pageClip;
            if(sourceClip)page.pushOperators(pushGraphicsState(),rectangle(sourceClip.x,page.getHeight()-sourceClip.y-sourceClip.height,sourceClip.width,sourceClip.height),clip(),endPath());
            try{page.drawImage(image, { x: b.x, y: page.getHeight() - b.y - b.height,
              width: b.width, height: b.height });}finally{if(sourceClip)page.pushOperators(popGraphicsState());}
          } catch (error) {
            layout.overflows.push({ pageId: templatePage.id, regionId: region.id,
              code: 'asset', message: `Image could not be rendered: ${error instanceof Error ? error.message : 'Invalid image.'}` });
          }
          break;
        }
      }
      }finally{if(scoped)page.pushOperators(popGraphicsState());}
    }
    if(atomicPlan){const expectedOwners=[...authorizedDocumentScopes.get(template)!.decompositions.values()].filter(w=>w.pageId===templatePage.id&&w.atomicLeader).length;if(atomicOwners.size!==expectedOwners)throw new FolioError('PDF_ATOMIC_PAINT','Incomplete source show owner consumption.');const expectedShows=[...authorizedDocumentScopes.get(template)!.decompositions.values()].filter(w=>w.pageId===templatePage.id).reduce((n,w)=>n+(w.showGroup?.length??(w.wholeShow?1:0)),0);if(consumedShows.size!==expectedShows)throw new FolioError('PDF_ATOMIC_PAINT','Incomplete whole-show consumption.');if(atomicIndex!==atomicPlan.length)throw new FolioError('PDF_ATOMIC_PAINT','Incomplete atomic paint plan.');for(let i=activeClips.length;i>0;i--)page.pushOperators(popGraphicsState());}
  }
  await document.flush();
  for(const [key,face] of fonts)if(face instanceof SourceFontFaceMetrics)installSourceCidMap(document,embedded.get(key)!,face.asset);
  // pdf-lib 1.17.1 checks fontkit's legacy `cff` property. The bundled fontkit
  // exposes these converted faces under 'CFF ', so its default descriptor
  // mislabels an OpenType/CFF program as TrueType. Correct the PDF dictionary
  // while retaining the complete licensed program and explicit glyph advances.
  for (const [key, font] of embedded) if (key.startsWith('times-')) {
    const dictionary = document.context.lookup(font.ref, PDFDict);
    const descendant = dictionary.lookup(PDFName.of('DescendantFonts'), PDFArray).lookup(0, PDFDict);
    const descriptor = descendant.lookup(PDFName.of('FontDescriptor'), PDFDict);
    const reference = descriptor.get(PDFName.of('FontFile2'));
    if (!reference) throw new FolioError('font-program', 'The bundled Times font program was not embedded.');
    const stream = document.context.lookup(reference);
    if (!(stream instanceof PDFRawStream)) throw new FolioError('font-program', 'The bundled font program is invalid.');
    stream.dict.set(PDFName.of('Subtype'), PDFName.of('OpenType'));
    descriptor.delete(PDFName.of('FontFile2'));
    descriptor.set(PDFName.of('FontFile3'), reference);
    descendant.set(PDFName.of('Subtype'), PDFName.of('CIDFontType0'));
    descendant.delete(PDFName.of('CIDToGIDMap'));
  }
  return { bytes: await document.save(), layout, contentRevision: content.revision,
    rendererVersion:hasPermittedOriginalTrueType(template)&&!context?(template.sourceScopedPages?.version==='source-scoped-pages-v2'?'folio-pdf-scoped-color-v1':RENDERER_VERSION):rendererVersionFor(template), ...((template.sourceFonts?.length||template.sourceStandardFonts?.length) ? {sourceFingerprint:sourceDocumentFingerprint(template,content)} : {}) };
}

export { computeLayout } from '../layout/engine';
export { FONT_FAMILIES, getFontMetrics, setFontLoader } from '../layout/fonts';
export type { FontLoader } from '../layout/fonts';

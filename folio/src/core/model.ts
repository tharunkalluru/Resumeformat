export const SCHEMA_VERSION = 1 as const;
export const RENDERER_VERSION = 'folio-pdf-v1' as const;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
/** Bounded source/preview page capacity; all aggregate work and asset limits remain independent. */
export const MAX_SOURCE_PAGES = 32;

export type Id = string;
export type FontFamily = 'sans' | 'serif' | 'mono' | 'times';
export type Color = string;
export interface Rect { x: number; y: number; width: number; height: number }
export interface TextStyle {
  fontFamily: FontFamily; fontSize: number; fontWeight: number;
  italic: boolean; color: Color; lineHeight: number;
  alignment: 'left' | 'center' | 'right';
  baselineOffset?: number;
  sourceFontId?: Id;
  sourceStandardFontId?: Id;
}
/** Original nonembedded PDF declarations. Native adapter bytes are local decoder
 * derivatives, never an embedded source programme or a rights assertion. */
export interface SourceStandardFont {
 version:'standard14-winansi-v1';id:Id;sourceSha256:string;pdfFontRef:string;sourceResource:string;
 baseFont:string;encoding:'WinAnsiEncoding';declarationSha256:string;
 widths?:{firstChar:number;lastChar:number;values:number[]};
 glyphMap:{code:number;unicode:string;glyphName:string;pdfWidth:number;nativeGlyphId:number}[];
 nativeAdapter:{version:'pdfjs-standard14-native-v1';supplier:'pdfjs-dist-6.4.299-bundled-standard';licence:'bundled-Foxit-Liberation';metricContract:'original-pdf-widths-no-kerning';sha256:string;bytes:Uint8Array;decoderProgrammeSha256:string;format:'truetype'|'opentype-cff'};
}
export interface SourceStandardGlyph {code:number;unicode:string;x:number;textX?:number;advance:number;operatorIndex:number}
export interface SourceStandardLayout {
 version:1;sourceSha256:string;baselineRunsHash:string;startX:number;endX:number;baseline:number;fontSize:number;characterSpacing:number;nominalFontSize:number;linearMatrix:number[];
 coordinateFrame?:{ctm:number[];textMatrix:number[];cursorX:number;cursorY:number;characterSpacing:number};
 colorSpace:'DeviceRGB'|'DeviceGray';colorComponents:number[];glyphs:SourceStandardGlyph[];
}
export interface TextRun {
  text: string; bold?: boolean; italic?: boolean; underline?: boolean;
  href?: string; sourceFactIds?: Id[];
}
export interface ContentBlock { id: Id; runs: TextRun[]; sourceFactIds: Id[]; sourceParagraphGroupId?: string }
export interface ContentSnapshot { revision: number; blocks: ContentBlock[] }
export interface SourceGlyphMapping {
  cid: number; glyphId: number; fontChar: number; unicode: string;
  pdfWidth: number; nonPainting: boolean;
  originalGlyphId?: number; originalCharCode?: number;
  /** V6: immutable original/converted hmtx advance in 1000/em, independent of PDF positioning. */
  nativeWidth?: number;
  /** V5 only: original ToUnicode + positive Identity CID owns a retained unencoded blank. */
  selectorProvenance?: 'original-identity-positive-blank-v1' | 'original-positive-blank-v2';
}
interface SourceFontCommon {
  id: Id; sourceSha256: string; sourceResource: string; sha256: string;
  bytes: Uint8Array; unitsPerEm: number;
}
export interface LicensedSubsetDerivation {
 version:'licensed-catalogue-subset-v1';catalogueFace:import('../layout/fonts').CatalogFontKey;
 fullProgramSha256:string;licenseSha256:string;encoderVersion:'fontkit-2.0.4';subsetProgramSha256:string;
 originalPermission:'absent'|'present-permitted';
}
export interface SourceFontAssetV1 extends SourceFontCommon {
  format: 'truetype'; fontWeight: 400 | 700; italic: boolean; glyphMap: SourceGlyphMapping[];
  /** New Identity-H admission retains the actual original resource/program proof. */
  sourceVersion?: 4 | 5 | 6;
  originalProgram?: { bytes: Uint8Array; sha256: string; pdfFontRef: string; selectorContract?: 'identity-h-v1' | 'winansi-3-1-v1' };
}
export interface SourceGlyphMappingV2 extends SourceGlyphMapping {
  editPolicy: 'coveredScalar' | 'baselineOnly';
  widthProvenance: 'sourceGlyph' | 'sourceEncodingWidths' | 'baselineGap';
}
export interface SourceFontAssetV2 extends SourceFontCommon {
  sourceVersion: 2; format: 'opentype-cff';
  declaredStyle: { weightClass: number | null; italic: boolean | null; semanticBold: 'unknown' };
  glyphMap: SourceGlyphMappingV2[];
  shapeMap?: {glyphId:number;fontChar:number}[];
}
export interface SourceFontAssetV7 extends SourceFontCommon {
  sourceVersion:7; groupedDescriptor?:Readonly<Record<string,number|readonly number[]>>; namelessDescriptor?:Readonly<Record<string,number|readonly number[]>>; format:'truetype'; capability:'document-scoped-source-v1'; originalPermission:'absent'; registrationFaceToken:'neutral-400-normal-v1';
  declaredStyle:import('../layout/document-scoped-program').DocumentScopedProperties;
  fontWeight?:never; italic?:never;
  originalProgram:{bytes:Uint8Array;sha256:string;pdfFontRef:string;selectorContract:'macroman-1-0-format6-v1'|'symbolic-raw-byte-1-0-format6-v1'};
  glyphMap:SourceGlyphMapping[];
}
export interface SourceFontAssetV8 extends SourceFontCommon {
 sourceVersion:8;format:'truetype';capability:'licensed-catalogue-subset-v1';licensedDerivation:LicensedSubsetDerivation;
 fontWeight:400|700;italic:boolean;glyphMap:SourceGlyphMapping[];
 originalProgram:{bytes:Uint8Array;sha256:string;pdfFontRef:string;selectorContract:'identity-h-v1'};
}
export interface SourceFontAssetV9 extends Omit<SourceFontAssetV2,'sourceVersion'> {
 sourceVersion:9; capability:'original-cff-glyphs-v1'; originalProgram:{bytes:Uint8Array;sha256:string;pdfFontRef:string}; originalCff:import('../import/cff-resource-spec').CffResourceSpec;
}
export interface SourceFontAssetV10 extends SourceFontCommon {
 sourceVersion:10;format:'truetype';capability:'original-tt-numeric-style-v1';fontWeight:number;italic:boolean;
 semanticBlankPolicy?:'original-space-and-nbsp-v1';
 originalProgram:{bytes:Uint8Array;sha256:string;pdfFontRef:string;selectorContract:'identity-h-v1'};
 glyphMap:SourceGlyphMapping[];
}
export interface SourceFontAssetV11 extends Omit<SourceFontAssetV1,'sourceVersion'|'originalProgram'> {sourceVersion:11;capability:'original-tt-null-ligature-v1';originalProgram:{bytes:Uint8Array;sha256:string;pdfFontRef:string;selectorContract:'identity-h-v1'};}
export type SourceFontAsset = SourceFontAssetV1 | SourceFontAssetV2 | SourceFontAssetV7 | SourceFontAssetV8 | SourceFontAssetV9 | SourceFontAssetV10 | SourceFontAssetV11;
export interface SourcePositionedGlyph {
  fontId: Id; cid: number; unicode: string; x: number; advance: number; operatorIndex: number; inferredGap?: true;
}
interface SourceLayoutCommon {
  sourceSha256: string; baselineRunsHash: string;
  anchor: 'start' | 'end'; startX: number; endX: number; baseline: number; fontSize: number;
  glyphs: SourcePositionedGlyph[];
  glyphEncoding?: undefined;
}
export interface SourceTextLayoutV1 extends SourceLayoutCommon { version: 1 }
export interface SourceTextLayoutV2 extends SourceLayoutCommon {
  version: 2; baselineStyle: {fontWeight:400|700;italic:boolean};
  editPolicy:'scalarCovered'|'baselineOnly'; editReason?:'sourceLigature'|'nativeMappingUnproved';
}
/** TrueType source spacing in page points; raw PDF glyph advances remain unchanged. */
export interface SourceTextLayoutV3 extends SourceLayoutCommon {
  version: 3; characterSpacing: number;
  editPolicy:'scalarCovered'|'baselineOnly'; editReason?:'nonPositiveStep'|'nativeMappingUnproved';
}
/** Exact original horizontal Tm shear, with no native/current editing authority. */
export interface SourceTextLayoutV4 extends SourceLayoutCommon {version:4;shearX:number;characterSpacing:number;editPolicy:'baselineOnly'}
export interface SourceTextLayoutV5 extends SourceLayoutCommon {version:5;showSpacing:[operatorIndex:number,characterSpacing:number][];editPolicy:'baselineOnly'}
export interface SourceTextLayoutV6 extends SourceLayoutCommon {version:6;rotation:[number,number,number,number];characterSpacing:number;editPolicy:'baselineOnly'}
export type LegacySourceTextLayout = SourceTextLayoutV1 | SourceTextLayoutV2 | SourceTextLayoutV3 | SourceTextLayoutV4 | SourceTextLayoutV5 | SourceTextLayoutV6;
export type SourceGlyphTuple = [cid:number, unicode:string, x:number, advance:number, operatorIndex:number] |
  [cid:number, unicode:string, x:number, advance:number, operatorIndex:number, inferredGap:1];
type SharedFontLayout<T> = Omit<T, 'glyphs' | 'glyphEncoding'> & {glyphEncoding:'shared-font-tuple-v1';glyphs:SourceGlyphTuple[]};
export type NormalizedSourceTextLayout = SharedFontLayout<SourceTextLayoutV1> | SharedFontLayout<SourceTextLayoutV2> | SharedFontLayout<SourceTextLayoutV3> | SharedFontLayout<SourceTextLayoutV4> | SharedFontLayout<SourceTextLayoutV5> | SharedFontLayout<SourceTextLayoutV6>;
export type SourceTextLayout = LegacySourceTextLayout | NormalizedSourceTextLayout;
export interface TextRegion<L extends SourceTextLayout = SourceTextLayout> {
  kind: 'text'; id: Id; pageId: Id; bounds: Rect; order: number;
  contentId: Id; role: 'heading' | 'body' | 'bullet' | 'contact';
  style: TextStyle; sourceLocator: string; sourceLayout?: L;sourceScopedPaint?:SourceScopedPaint;sourceStandardLayout?:SourceStandardLayout;
}
export interface RuleRegion {
  kind: 'rule'; id: Id; pageId: Id; bounds: Rect; order: number;
  color: Color; thickness: number;
  sourcePaint?: SourceRulePaint;
  sourceScopedPaint?:SourceScopedPaint;
}
/** Import-captured opaque, solid, butt-cap horizontal stroke in original paint order. */
export interface SourceRulePaint {
  kind:'horizontal-solid-stroke-v1';sourceSha256:string;pageNumber:number;operatorIndex:number;
  bounds:Rect;color:Color;thickness:number;lineCap:0;lineJoin:0;opacity:1;blendMode:'Normal';
}
export interface RectangleRegion {
  kind: 'rectangle'; id: Id; pageId: Id; bounds: Rect; order: number;
  fill?: Color; stroke?: Color; thickness: number;
  sourceScopedPaint?:SourceScopedPaint;
}
export interface ImageRegion {
  kind: 'image'; id: Id; pageId: Id; bounds: Rect; order: number;
  assetId: Id; alt: string;
  sourcePaint?: SourceImagePaint;
}
export interface SourceImageClip {rawOperatorIndex:number;ctm:number[];bounds:Rect}
export interface SourceImagePaint {
  kind:'direct-image-rect-clip-v1';sourceSha256:string;pageNumber:number;
  rawOperatorIndex:number;operatorIndex:number;imageOrdinal:number;imageRef:string;
  smaskRef?:string;imageProgramSha256:string;maskProgramSha256?:string;colorProfileSha256?:string;
  imageCtm:number[];bounds:Rect;clipStack:SourceImageClip[];pageClip?:Rect;
  pixelWidth:number;pixelHeight:number;rgbaSha256:string;assetSha256:string;
  interpolate:false;maskInterpolate:false;opacity:1;blendMode:'Normal';
}
export type SourceImagePageAdmission={pageNumber:number;status:'none'|'unsupported'|'legacy-catalogue-unclipped-v1'}|{pageNumber:number;status:'proved';occurrences:{operatorIndex:number;paintSha256:string}[]};
export interface SourceImageContract {version:'direct-image-inventory-v1';sourceSha256:string;pages:SourceImagePageAdmission[]}
export interface SourceShapeRegion {
  kind:'sourceShape';id:Id;pageId:Id;bounds:Rect;order:number;
  sourceFontId:Id;glyphId:number;fontChar:number;sourceSha256:string;sourceProgramSha256:string;
  sourceX:number;sourceBaseline:number;fontSize:number;color:Color;
  operatorIndex:number;sourceLocator:string;originalCodepoints:number[];originalCharCode:number|null;
}
export interface SourceGlyphOccurrence {regionId:Id;glyphOrdinal:number}
export interface SourceOverlapProof {first:SourceGlyphOccurrence;second:SourceGlyphOccurrence;sourceSha256:string;proofHash:string}
export interface SourceRuleOverlapProof {glyph:SourceGlyphOccurrence;ruleId:Id;sourceSha256:string;proofHash:string}
export type SourceOverlapTuple = [firstRegionId:Id,firstGlyphOrdinal:number,secondRegionId:Id,secondGlyphOrdinal:number,proofHash:string];
export interface NormalizedSourceOverlaps {encoding:'occurrence-tuples-v1';sourceSha256:string;pairs:SourceOverlapTuple[]}
export interface SourceLinkBinding { regionId: Id; contentId: Id; baselineRunsHash: string; utf16Range?:[number,number] }
export interface SourceLink {
  id: Id; pageId: Id; sourceSha256: string; annotationIndex: number; annotationId: string;
  bounds: Rect; href: string; bindings: SourceLinkBinding[]; proofHash: string;
}
export type Region = TextRegion | RuleRegion | RectangleRegion | ImageRegion | SourceShapeRegion;
export interface TemplatePage { id: Id; width: number; height: number; regions: Region[] }
export interface ImportWarning {
  id: Id; code: string; severity: 'info' | 'review' | 'blocking';
  message: string; pageId?: Id; regionId?: Id;
  fontMapping?: { sourceResource: string; sourceName: string | null; targetFace: string; sourceStyle: 'unknown' };
}
export interface Template {
  id: Id; revision: number; pages: TemplatePage[]; warnings: ImportWarning[];
  importerVersion: string;
  /** Original Type 1 paint only. This capability never grants wording edits. */
  sourceType1Baseline?: {version:'original-type1-baseline-v1'|'original-type1-baseline-v2'|'original-type1-baseline-v3'|'original-type1-baseline-v4'|'original-type1-baseline-v5'|'original-type1-baseline-v6'|'original-type1-baseline-v7'|'original-type1-baseline-v8';sourceSha256:string;pagePaintSha256s:string[];pageAnnotationSha256s?:string[];editableSlot?:Type1EditableSlot;editableSlots?:Type1EditableSlot[];programSha256s:string[];bitmapFontSha256s?:string[];layeredResourcesSha256?:string;baselineSignature:string};
  sourceFonts?: SourceFontAsset[];
  sourceStandardFonts?: SourceStandardFont[];
  sourceOverlaps?: SourceOverlapProof[] | NormalizedSourceOverlaps;
  sourceRuleOverlaps?: SourceRuleOverlapProof[];
  sourceImageContract?: SourceImageContract;
  sourceScopedPages?:SourceScopedPages;
  sourceCompositePages?:SourceCompositePages;
  sourceColorProfile?:SourceColorProfile;
  sourceLinks?: SourceLink[];
  fidelity?: { mode: 'approximate'; reasons: string[] };
  adjustments?: { regionId: Id; before: Rect; after: Rect }[];
}
export interface SourceColorProfile {version:'original-icc-rgb-v1';sourceSha256:string;pdfProfileRef:string;encodedSha256:string;encodedLength:number;sha256:string;bytes:Uint8Array;N:3;filter:'FlateDecode'|null;alternate:'DeviceRGB'|null}
export type SourceScopedColor = {space:'DeviceRGB'|'DeviceGray';components:number[]} | {space:'ICCBased';components:number[];resourceName:string;profileRef:string;profileSha256:string;selectionOperatorIndex:number;componentsOperatorIndex:number|null;componentOperator:'sc'|'scn'|'default';renderingIntent:'RelativeColorimetric'};
export interface SourceRectanglePath {version:'closed-axis-rectangle-v1';operatorIndices:number[];points:number[][];constructionCtm:number[];fillRule:'nonzero'|'evenodd'}
export interface SourceScopedClip {pathOperatorIndex:number;clipOperatorIndex:number;endOperatorIndex:number;fillRule:'nonzero'|'evenodd';constructionCtm:number[];bounds:Rect;pageCover?:{version:'integer-page-cover-v1';operands:number[]}}
export interface SourceScopedPaint {version:'source-scoped-occurrence-v1'|'source-scoped-occurrence-v2'|'source-scoped-occurrence-v3'|'source-scoped-occurrence-v4'|'source-scoped-occurrence-v5';kind:'text'|'fillRect'|'strokeRule';sourceSha256:string;pageNumber:number;rawOperatorIndex:number;operatorIndex:number;color:SourceScopedColor;clipStack:SourceScopedClip[];effectiveClip:Rect;stateHash:string;strokeAdjustment?:true;appleAA?:boolean;zeroFill?:true;rectanglePath?:SourceRectanglePath;derivedGaps?:{version:'pinned-extractor-gap-v1';count:number};showGroup?:{version:'homogeneous-source-shows-v1';operators:[number,number][]}}
export interface SourcePageFrame {version:'original-equal-page-boxes-v1';boxes:{MediaBox:[number,number,number,number];CropBox?:[number,number,number,number];TrimBox?:[number,number,number,number];BleedBox?:[number,number,number,number];ArtBox?:[number,number,number,number]};viewport:[number,number,number,number,number,number];width:number;height:number}
export interface SourceCompositeSemanticRelation {version:'inter-show-extractor-gap-v1';itemIndex:number;semanticText:string;extractorItemHash:string;physicalPartsHash:string;previousRawOperatorIndex:number;nextRawOperatorIndex:number;previousStateHash:string;nextStateHash:string;previousEndpoint:[number,number];nextEndpoint:[number,number];gap:number}
export interface SourceCompositePages {version:'original-native-composite-v1'|'original-native-composite-v2'|'original-native-composite-v3'|'original-native-composite-v4'|'original-native-composite-v5'|'original-native-composite-v6'|'original-native-composite-v7'|'original-native-composite-v8'|'original-native-composite-v9'|'original-native-composite-v10';sourceSha256:string;pages:{pageNumber:number;width:number;height:number;frame:SourcePageFrame;inventoryHash:string;semanticRelations?:SourceCompositeSemanticRelation[];artifactCounts:{paths:number;images:number;clips:number;curves:number;rotatedTransforms:number;zeroFills:number}}[]}
export interface SourceScopedPages {version:'source-scoped-pages-v1'|'source-scoped-pages-v2';sourceSha256:string;pages:{pageNumber:number;width:number;height:number;inventoryHash:string;pageFrame?:SourcePageFrame;pageGroup?:{version:'rgb-page-transparency-v1';colorSpace:'DeviceRGB';isolated:boolean;knockout:false}}[]}
export interface SourceAsset {
  id: Id; name: string; format: 'pdf' | 'docx'; bytes: Uint8Array;
  sha256: string; sourcePageCount: number | null;
}
export interface ImageAsset {
  id: Id; name: string; mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array;
}
export interface Fact {
  id: Id; text: string; kind: 'resume' | 'careerNote' | 'applicantEdit';
  locator: string; confirmed: boolean;
}
export interface CareerNote { id: Id; text: string; confirmed: boolean }
export interface EvidenceInsertion { blockId: Id; before: ContentBlock; after: ContentBlock }
export interface EvidenceDecision { status: 'accepted' | 'rejected'; blockId: Id; insertions?: EvidenceInsertion[] }
export type EvidenceDecisions = Record<Id, EvidenceDecision>;
export interface JobContext { title: string; company: string; description: string }
export interface SourceFontReuse {
  policyVersion:'document-scoped-source-v1'; sourceSha256:string; originalProgramSha256s:string[]; attestedAt:string;
}
export interface Approval {
  sourceFontReuse?:SourceFontReuse;
  templateId: Id; templateRevision: number; layoutHash: string;
  baselineHash: string; rendererVersion: string; acknowledgedWarnings: Id[];
  approvedAt: string;
}
export interface ProjectWorkspace { templateGroupId: Id; kind: 'resume' | 'application' }
export type MemorySourceKind = 'supportingFile' | 'typed' | 'linkedinPaste' | 'localDictation';
export interface MemorySource {
  id: Id; version: 1; kind: MemorySourceKind; name: string; ingestedAt: string;
  extractorVersion: string; format: 'pdf' | 'docx' | 'txt' | 'text'; bytes?: Uint8Array;
  sha256: string; segments: { id: Id; text: string; locator: string }[];
  state: 'reading' | 'needsReview' | 'ready' | 'error'; errorCode?: string;
}
export interface MemoryProvenance {
  sourceId: Id; sourceKind: 'resume' | MemorySourceKind; sourceName: string;
  sourceHash: string; locator: string; originalQuote: string; quoteHash: string;
  resumeFactId?: Id; sourceSegmentId?: Id;
}
export interface AssertionVersion {
  assertionId: Id; version: number; factId: Id; text: string; provenance: MemoryProvenance;
  confirmation: null | { actor: 'applicant'; version: number; textHash: string; confirmedAt: string };
  supersedes?: { assertionId?: Id; version?: number; resumeFactId?: Id };
}
export interface MemoryAssertion { id: Id; currentVersion: number; eligibleForFuture: boolean; versions: AssertionVersion[] }
export interface CareerMemory {
  schemaVersion: 1; templateGroupId: Id; resumeProjectId: Id; resumeSourceId: Id;
  resumeSourceHash: string; revision: number; createdAt: string; updatedAt: string;
  sources: MemorySource[]; assertions: MemoryAssertion[]; excludedResumeFactIds: Id[];
  draftText: string; assertionDrafts: { assertionId: Id; baseVersion: number; text: string }[];
  linkedInReference: null | { url: string; state: 'referenceOnly' };
  onboarding: 'contextPending' | 'contextDeferred' | 'contextCompleted';
}
export interface MemorySnapshot {
  id: Id; templateGroupId: Id; memoryRevision: number; memoryHash: string; createdAt: string;
  sourceResumeId: Id; sourceResumeRevision: number; eligibleFactIds: Id[];
  evidence: { factId: Id; assertionId?: Id; assertionVersion?: number; provenance: MemoryProvenance; confirmation: AssertionVersion['confirmation'] }[];
  baselineReviewBlocks: Id[];
}
export interface GroupState { templateGroupId: Id; epoch: number; state: 'active' | 'resumeRemoved' | 'deleted'; changedAt: string }
export interface TailoringCompletion { id: Id; completedAt: string; jobIdentity: Id }
export interface FolioVersion { documentScopedBinding?:string; id: Id; createdAt: string; kind: 'firstResult' | 'download' | 'restored'; content: ContentSnapshot }
export interface FolioPresentation {
  state: 'draft' | 'ready'; jobIdentity: Id; privateNotes: string; historyKnown: boolean;
  completions: TailoringCompletion[]; versions: FolioVersion[];
  changes: Record<Id, 'accepted' | 'rejected'>;
  held?: { blockId: Id; text: string; factIds: Id[]; reason: string }[];
}
export interface Project {
  schemaVersion: typeof SCHEMA_VERSION; id: Id; name: string;
  workspace: ProjectWorkspace;
  revision: number; createdAt: string; updatedAt: string; fictional: boolean;
  source: SourceAsset; assets: ImageAsset[]; template: Template;
  baseline: ContentSnapshot; draft: ContentSnapshot; facts: Fact[];
  notes: CareerNote[]; job: JobContext; approval: Approval | null;
  evidenceDecisions: EvidenceDecisions;
  reviewedDraftRevision: number | null;
  careerMemory?: CareerMemory;
  memorySnapshot?: MemorySnapshot;
  folio?: FolioPresentation;
}
export interface ImportResult {
  source: SourceAsset; assets: ImageAsset[]; template: Template;
  baseline: ContentSnapshot; facts: Fact[];
}
export interface Type1EditableSlot {horizontalScale?:number;pageNumber:number;sourceLocator:string;operatorIndex:number;fontResource:string;fontProgramSha256:string;baselineText:string;originalAdvance:number;spaceAdjustment:number;maximumWidth:number;operatorWord?:'Tj'|'TJ';operatorSha256?:string;stateSha256?:string;cursorRestore?:{version:'type1-blank-advance-v1';fontSize:number};codes:{unicode:string;code:number;pdfWidth:number}[]}
export interface Overflow {
  pageId: Id; regionId: Id; code: 'width' | 'height' | 'page' | 'glyph' | 'asset' | 'collision';
  message: string; required?: number; available?: number;
}
export interface LayoutRun {
  text: string; x: number; width: number; bold: boolean; italic: boolean;
  underline: boolean; href?: string;
  sourceFontId?: Id; sourceGlyphs?: SourcePositionedGlyph[]; sourceStandardFontId?:Id;sourceStandardGlyphs?:SourceStandardGlyph[];
}
export interface LayoutLine { baseline: number; runs: LayoutRun[]; width: number }
export interface RegionLayout { regionId: Id; pageId: Id; bounds: Rect; lines: LayoutLine[] }
export interface LayoutResult { regions: RegionLayout[]; overflows: Overflow[] }
export interface RenderedDocument {
  bytes: Uint8Array; layout: LayoutResult; contentRevision: number;
  rendererVersion: string; sourceReplay?:'original-baseline'|'legacy-current'|'original-cff-current'|'original-tt-current'|'original-type1-baseline'|'original-type1-current'; sourceFingerprint?: string; documentScopedPurpose?:'baselinePreview'|'current'|'historyPreview';
}
export interface MatchingEvidence {
  factId: Id; text: string; matchedTerms: string[]; source: Fact['kind'];
}
export interface MatchingResult { terms: string[]; evidence: MatchingEvidence[]; gaps: string[] }

export const newId = () => crypto.randomUUID();
export const blockText = (block: ContentBlock) => block.runs.map(run => run.text).join('');
export const contentText = (content: ContentSnapshot) => content.blocks.map(blockText).join('\n');
export function safeHref(value: string): string | undefined {
  if (/[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'tel:') {
      const number = url.pathname;
      const parts = number.match(/^(\+?[0-9().\- ]{3,40})(?:;ext=([0-9]{1,20}))?$/i);
      if (url.host || url.search || url.hash || !parts || (parts[1].match(/\d/g)?.length ?? 0) < 3) return undefined;
      // Preserve a valid original telephone URI, including extension and case.
      // Legacy surrounding whitespace still follows URL's previous normalization.
      return value === value.trim() && /^tel:/i.test(value) ? value : url.href;
    }
    if (!['https:', 'http:', 'mailto:'].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  const stable = new Uint8Array(bytes);
  const digest = await crypto.subtle.digest('SHA-256', stable.buffer);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
/** Synchronous SHA-256 lets trust-boundary schema validation bind exact text and bytes. */
export function sha256Sync(bytes: Uint8Array): string {
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const length = Math.ceil((bytes.length + 9) / 64) * 64, data = new Uint8Array(length), view = new DataView(data.buffer);
  data.set(bytes); data[bytes.length] = 0x80; view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000)); view.setUint32(length - 4, (bytes.length * 8) >>> 0);
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19], words = new Uint32Array(64);
  const rotate = (n: number, bits: number) => (n >>> bits) | (n << (32 - bits));
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) { const a = words[i - 15], b = words[i - 2]; words[i] = (words[i - 16] + (rotate(a,7)^rotate(a,18)^(a>>>3)) + words[i - 7] + (rotate(b,17)^rotate(b,19)^(b>>>10))) >>> 0; }
    let [a,b,c,d,e,f,g,h] = state;
    for (let i = 0; i < 64; i++) { const t1 = (h + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + ((e&f)^(~e&g)) + constants[i] + words[i]) >>> 0, t2 = ((rotate(a,2)^rotate(a,13)^rotate(a,22)) + ((a&b)^(a&c)^(b&c))) >>> 0; h=g; g=f; f=e; e=(d+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0; }
    for (let i = 0; i < 8; i++) state[i] = (state[i] + [a,b,c,d,e,f,g,h][i]) >>> 0;
  }
  return state.map(value => value.toString(16).padStart(8, '0')).join('');
}
export const hashTextSync = (text: string) => sha256Sync(new TextEncoder().encode(text));
const canonicalByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length')!.get!;
const canonicalByteBrand = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
export function canonicalJson(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    // Preserve the historical copied string-key byte snapshot without sorting
    // numeric indexes. Never consult an own or subsequently shadowed length.
    if (ArrayBuffer.isView(input) && Object.getPrototypeOf(input) === Uint8Array.prototype && !Object.prototype.hasOwnProperty.call(input, 'length') && canonicalByteBrand.call(input) === 'Uint8Array' && Object.keys(input).length === canonicalByteLength.call(input)) return Object.fromEntries(Object.entries(input));
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sort(v)]));
    return input;
  }
  return JSON.stringify(sort(value));
}
export const hashJson = (value: unknown) => sha256(new TextEncoder().encode(canonicalJson(value)));
/** Additive schema-1 records may predate workspace metadata. */
export function workspaceOf(project: Pick<Project, 'id'> & { workspace?: ProjectWorkspace }): ProjectWorkspace {
  return project.workspace ?? { templateGroupId: project.id, kind: 'resume' };
}
export function makeProject(result: ImportResult, fictional = false): Project {
  const timestamp = new Date().toISOString(), id = newId();
  return {
    schemaVersion: SCHEMA_VERSION, id, name: result.source.name.replace(/\.[^.]+$/, ''),
    workspace: { templateGroupId: id, kind: 'resume' },
    revision: 1, createdAt: timestamp, updatedAt: timestamp, fictional,
    ...result, draft: structuredClone(result.baseline), notes: [], evidenceDecisions: {},
    job: { title: '', company: '', description: '' }, approval: null,
    reviewedDraftRevision: null,
  };
}
export const SOURCE_FONT_REUSE_POLICY='document-scoped-source-v1' as const;
export const SOURCE_FONT_REUSE_TEXT='I have permission to reuse the fonts embedded in this resume for my edited application.';
export function documentScopedProgramHashes(template:Template):string[]{if(template.sourceType1Baseline)return [...new Set([...template.sourceType1Baseline.programSha256s,...(template.sourceType1Baseline.bitmapFontSha256s??[]),...(template.sourceType1Baseline.layeredResourcesSha256?[template.sourceType1Baseline.layeredResourcesSha256]:[])])].sort();if(!template.sourceFonts?.some(font=>font.sourceVersion===7))return [];return [...new Set(template.sourceFonts.flatMap(font=>font.format==='truetype'&&font.originalProgram?[font.originalProgram.sha256]:[]))].sort();}
export function hasCurrentSourceFontReuse(project:Project):boolean {
 const hashes=documentScopedProgramHashes(project.template);if(!hashes.length)return true;
 const choice=project.approval?.sourceFontReuse;
 return !!choice&&choice.policyVersion===SOURCE_FONT_REUSE_POLICY&&choice.sourceSha256===project.source.sha256&&canonicalJson(choice.originalProgramSha256s)===canonicalJson(hashes)&&Number.isFinite(Date.parse(choice.attestedAt));
}
export const DOCUMENT_SCOPED_RENDERER_VERSION='folio-document-scoped-tt-v2' as const;
export function hasSourceStandardFonts(template:Template):boolean{return !!template.sourceStandardFonts?.length;}
export function hasLicensedSubset(template:Template):boolean{return !!template.sourceFonts?.some(f=>f.sourceVersion===8);}
/** A routing candidate only. Project rendering independently proves the retained original. */
export function hasPermittedOriginalTrueType(template:Template):boolean{return !!template.sourceFonts?.length&&template.sourceFonts.every(font=>font.format==='truetype'&&!!font.originalProgram&&(font.sourceVersion===4||font.sourceVersion===5||font.sourceVersion===6||font.sourceVersion===10||font.sourceVersion===11));}
export function hasOriginalCff(template:Template):boolean{return !!template.sourceFonts?.some(f=>f.sourceVersion===9);}
export function rendererVersionFor(template:Template):string{
 if(template.importerVersion==='folio-import-v28')return 'folio-document-scoped-spacing-shows-v1';
 if(template.importerVersion==='folio-import-v27')return 'folio-document-scoped-mixed-shows-v1';
 if(template.importerVersion==='folio-import-v26')return 'folio-document-scoped-nameless-v1';
 if(template.sourceCompositePages)return template.sourceCompositePages.version==='original-native-composite-v10'?'folio-document-scoped-native-artwork-v10':template.sourceCompositePages.version==='original-native-composite-v9'?'folio-document-scoped-native-composite-v9':template.sourceCompositePages.version==='original-native-composite-v8'?'folio-permitted-tt-native-composite-v8':template.sourceCompositePages.version==='original-native-composite-v7'?'folio-permitted-tt-native-composite-v7':template.sourceCompositePages.version==='original-native-composite-v6'?'folio-permitted-tt-native-composite-v6':template.sourceCompositePages.version==='original-native-composite-v5'?'folio-permitted-tt-native-composite-v5':template.sourceCompositePages.version==='original-native-composite-v4'?'folio-permitted-tt-native-composite-v4':template.sourceCompositePages.version==='original-native-composite-v3'?'folio-permitted-tt-native-composite-v3':template.sourceCompositePages.version==='original-native-composite-v2'?'folio-permitted-tt-native-composite-v2':'folio-permitted-tt-native-composite-v1';
 if(template.sourceScopedPages?.pages.some(p=>p.pageFrame))return 'folio-permitted-tt-page-frame-v1';
 if(template.sourceType1Baseline)return template.sourceType1Baseline.version==='original-type1-baseline-v8'?'folio-original-layered-lines-v1':template.sourceType1Baseline.version==='original-type1-baseline-v7'?'folio-original-type1-lines-v4':template.sourceType1Baseline.version==='original-type1-baseline-v6'?'folio-original-type1-lines-v3':template.sourceType1Baseline.version==='original-type1-baseline-v5'?'folio-original-type1-lines-v2':template.sourceType1Baseline.version==='original-type1-baseline-v4'?'folio-original-type1-lines-v1':template.sourceType1Baseline.version==='original-type1-baseline-v3'?'folio-original-type1-single-line-v1':template.sourceType1Baseline.version==='original-type1-baseline-v2'?'folio-original-type1-baseline-v2':'folio-original-type1-baseline-v1';
 if(template.sourceStandardFonts?.length)return 'folio-standard14-structured-v1';
 if(template.pages.some(p=>p.regions.some(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint?.zeroFill)))return 'folio-original-zero-fill-v1';
 if(template.sourceFonts?.some(f=>f.sourceVersion===10))return 'folio-permitted-tt-numeric-style-v1';
 if(template.pages.some(p=>p.regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===4)))return 'folio-permitted-tt-shear-shows-v1';
 if(hasOriginalCff(template))return 'folio-original-cff-glyphs-v2';
 const clipped=template.pages.some(p=>p.regions.some(r=>'sourceScopedPaint' in r&&!!r.sourceScopedPaint?.clipStack.length));
 // This conservative saved-shape predicate invalidates old approvals only.
 // Fresh source recapture, not a version label, mints rectangle replay authority.
 const plainRectangle=template.pages.some(p=>p.regions.some(r=>r.kind==='rectangle'&&r.sourceScopedPaint?.kind==='fillRect'&&!r.sourceScopedPaint.rectanglePath));
 if(hasPermittedOriginalTrueType(template)&&template.pages.some(p=>p.regions.some(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint?.version==='source-scoped-occurrence-v3')))return 'folio-permitted-tt-shows-v1';
 if(hasPermittedOriginalTrueType(template))return plainRectangle?(clipped?'folio-permitted-tt-baseline-v14':'folio-permitted-tt-baseline-v13'):(clipped?'folio-permitted-tt-baseline-v12':'folio-permitted-tt-baseline-v11');
 if(hasLicensedSubset(template))return plainRectangle?(clipped?'folio-licensed-subset-current-v7':'folio-licensed-subset-current-v6'):(clipped?'folio-licensed-subset-current-v3':'folio-licensed-subset-current-v2');
 if(template.sourceColorProfile&&documentScopedProgramHashes(template).length)return plainRectangle?(clipped?'folio-document-scoped-atomic-v13':'folio-document-scoped-atomic-v14'):(clipped?'folio-document-scoped-atomic-v9':'folio-document-scoped-atomic-v10');
 return template.sourceScopedPages?.version==='source-scoped-pages-v2'?(documentScopedProgramHashes(template).length?(plainRectangle?(clipped?'folio-pdf-scoped-color-v7':'folio-pdf-scoped-color-v6'):(clipped?'folio-pdf-scoped-color-v3':'folio-pdf-scoped-color-v2')):template.sourceColorProfile?'folio-pdf-scoped-color-v2':'folio-pdf-scoped-color-v1'):documentScopedProgramHashes(template).length?(plainRectangle?(clipped?'folio-document-scoped-tt-v7':'folio-document-scoped-tt-v6'):(clipped?'folio-document-scoped-tt-v3':DOCUMENT_SCOPED_RENDERER_VERSION)):RENDERER_VERSION;
}
export function sourceFontReuseChoiceOwner(project:Project):string{return canonicalJson([project.id,project.source.sha256,project.template.id,project.template.revision,SOURCE_FONT_REUSE_POLICY,rendererVersionFor(project.template),documentScopedProgramHashes(project.template)]);}
export function hasValidApproval(project: Project): boolean {
  const approval = project.approval;
  return !!approval && hasCurrentSourceFontReuse(project) && approval.templateId === project.template.id &&
    approval.templateRevision === project.template.revision &&
    approval.rendererVersion === rendererVersionFor(project.template);
}
export function unresolvedMemoryBaselineBlocks(project: Project): Id[] {
  const withheld = new Set(project.careerMemory?.excludedResumeFactIds ?? []);
  for (const assertion of project.careerMemory?.assertions ?? []) { const value = assertion.versions.find(item => item.version === assertion.currentVersion); if (value?.supersedes?.resumeFactId) withheld.add(value.supersedes.resumeFactId); }
  if (project.memorySnapshot) { const eligible = new Set(project.memorySnapshot.eligibleFactIds); for (const fact of project.facts) if (fact.kind === 'resume' && !eligible.has(fact.id)) withheld.add(fact.id); }
  const affected = new Set(project.memorySnapshot?.baselineReviewBlocks ?? project.baseline.blocks.filter(block => [...block.sourceFactIds, ...block.runs.flatMap(run => run.sourceFactIds ?? [])].some(id => withheld.has(id))).map(block => block.id));
  return project.baseline.blocks.filter(block => {
    if (!affected.has(block.id)) return false;
    const before = blockText(block), current = project.draft.blocks.find(draft => draft.id === block.id);
    if (!current) return true;
    const retained = blockText(current), refs = new Set([...block.sourceFactIds, ...block.runs.flatMap(run => run.sourceFactIds ?? [])]);
    const exactQuotes = project.facts.filter(fact => fact.kind === 'resume' && withheld.has(fact.id) && refs.has(fact.id) && fact.text.trim() && before.includes(fact.text)).map(fact => fact.text);
    return exactQuotes.length ? exactQuotes.some(quote => retained.includes(quote)) : !!before.trim() && retained.includes(before);
  }).map(block => block.id);
}
export function exportProblems(project: Project, render: RenderedDocument | null): string[] {
  const problems: string[] = [];
  if (unresolvedMemoryBaselineBlocks(project).length) problems.push('Revise the retained source wording for corrected or excluded Career Memory before export.');
  if (!hasValidApproval(project)) problems.push('Approve the reconstructed template first.');
  if (project.reviewedDraftRevision !== project.draft.revision) problems.push('Review and confirm the current draft.');
  if (!render || render.contentRevision !== project.draft.revision) problems.push('Wait for the current document layout.');
  if((!!project.template.sourceStandardFonts?.length||hasOriginalCff(project.template)||hasPermittedOriginalTrueType(project.template)||hasLicensedSubset(project.template)||project.template.sourceColorProfile||documentScopedProgramHashes(project.template).length)&&render&&(render.documentScopedPurpose!=='current'||render.rendererVersion!==rendererVersionFor(project.template)||render.sourceFingerprint!==sourceDocumentFingerprint(project.template,project.draft)))problems.push('Wait for the current document-scoped renderer and source proof.');
  if (render?.layout.overflows.length) problems.push('Resolve the visible layout issues before export.');
  if (project.template.warnings.some(w => w.severity === 'blocking')) problems.push('This template contains unsupported features that block export.');
  return problems;
}

/** Current positioned graph identity; binary programs are represented by validated hashes. */
export function sourceDocumentFingerprint(template: Template, content: ContentSnapshot): string {
  return hashTextSync(canonicalJson({ template: { ...template,...(template.sourceStandardFonts?{sourceStandardFonts:template.sourceStandardFonts.map(f=>({...f,nativeAdapter:{...f.nativeAdapter,bytes:undefined}}))}:{}),...(template.sourceColorProfile?{sourceColorProfile:{...template.sourceColorProfile,bytes:undefined}}:{}), sourceFonts: template.sourceFonts?.map(({bytes: _bytes, ...font}) => ({...font,...('originalProgram'in font&&font.originalProgram?{originalProgram:{...font.originalProgram,bytes:undefined}}:{})})) }, content, adapterVersion: 1,...((!!template.sourceStandardFonts?.length||hasOriginalCff(template)||hasPermittedOriginalTrueType(template)||hasLicensedSubset(template)||template.sourceColorProfile||documentScopedProgramHashes(template).length)?{rendererContract:rendererVersionFor(template)}:{}) }));
}

/** Explicit saved-version owner; absence never authorizes V7 history. */
export function documentScopedHistoryBinding(project:Project):string{return hashTextSync(canonicalJson([project.source.sha256,project.template,rendererVersionFor(project.template)]));}

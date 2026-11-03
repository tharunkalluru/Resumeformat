import {sourceOutlineBox} from '../layout/source-shear';
import {MAX_SOURCE_PAGES} from '../core/model';
import {localPdfDecoderOptions} from '../render/pdf-decoder-options';
import {sourceIccProfile} from './pdf-icc';
import {normalizeFreshSourceTemplate} from '../core/source-graph';
import { getDocument, GlobalWorkerOptions, OPS, Util, type PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem, TextStyle as PdfTextStyle } from 'pdfjs-dist/types/src/display/api';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
import { newId, safeHref, type ContentBlock, type Fact, type FontFamily, type ImageAsset, type ImportResult, type ImportWarning, type Rect, type Region, type TemplatePage, type TextRun } from '../core/model';
import { FolioError } from '../core/errors';
import { IMPORTER_VERSION, MAX_TEXT, sourceAsset, warning } from './common';
import { simpleSourcePath } from './pdf-path';
import { FONT_FILES, fontKey, loadFont } from '../layout/fonts';
import { knownPdfFont, reportedPdfFontName, type PdfFontIdentity } from './pdf-fonts';
import { extractPdfImage } from './pdf-images';
import {preflightPdfImages} from './pdf-image-preflight';
import {captureSourceImages,provedImageClipOperators,sourceImagePageAdmission,legacyCatalogueImagePage,type CapturedSourceImage} from './pdf-source-images';
import type {SourceImagePageAdmission} from '../core/model';
import { reconcilePdfText } from './pdf-text';
import { captureSourceGlyphs, associateSourceItems } from './pdf-source';
import {buildSourceOverlapManifest,buildSourceRuleOverlapManifest,currentSourceScopedGlyphOverlapKeys} from '../layout/source-overlaps';
import {captureSourceRulePaint} from './pdf-source-rules';
import { loadSourceFont } from '../layout/source-fonts';
import { hashTextSync, canonicalJson,sha256Sync, type SourceFontAsset } from '../core/model';
import type { SourceLink } from '../core/model';
import { sourceLinkProofHash } from '../core/source-links';
import {captureScopedPage,bindScopedRegion,homogeneousSourceShows,scopedRegionOperators,scopedPages,validateSourceScopedPaint,type CapturedScopedPage} from './pdf-scoped-source';

GlobalWorkerOptions.workerSrc = workerUrl;
type Matrix = number[];
interface GraphicsState { matrix: Matrix; fill: string; stroke: string; lineWidth: number }
interface PaintSpan { text: string; color: string; font: string }
interface ObservedItem { item: TextItem; index: number; bounds: Rect; baseline: number; fontSize: number; family: FontFamily; fontWeight: 400 | 700; italic: boolean; color: string; href?: string }
const familyFor = (name: string): FontFamily => /mono|courier/i.test(name) ? 'mono' : /serif|times/i.test(name) && !/sans/i.test(name) ? 'serif' : 'sans';
const normalize = (text: string) => text.replace(/\s/g, '');
function overlap(a: Rect, b: Rect): number { return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)); }
function rectFromPoints(points: number[][]): Rect { const xs = points.map(point => point[0]), ys = points.map(point => point[1]); return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }; }
function color(value: unknown, fallback: string): string { return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }

/** Public PDF text styles can label embedded monospaced faces as sans-serif.
 * Infer the bundled mono family only when several independent source advances
 * match it closely and disagree with the reported family. This identifies a
 * compatible replacement, not the original font or its weight. */
async function compatibleFamilies(items: TextItem[], styles: Record<string, PdfTextStyle>, transform: Matrix): Promise<Map<string, FontFamily>> {
  const families = new Map<string, FontFamily>();
  const groups = new Map<string, TextItem[]>();
  for (const item of items) {
    families.set(item.fontName, familyFor(styles[item.fontName]?.fontFamily ?? ''));
    if (item.str.trim().length < 3 || item.width <= 0 || item.dir !== 'ltr') continue;
    const group = groups.get(item.fontName) ?? []; if (group.length < 24) group.push(item); groups.set(item.fontName, group);
  }
  const mono = await loadFont('mono-400-normal');
  const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  for (const [name, group] of groups) {
    const reported = families.get(name)!;
    if (reported === 'mono' || group.length < 3) continue;
    const face = await loadFont(`${reported}-400-normal`);
    const errors = (candidate: typeof mono) => group.map(item => {
      const matrix = Util.transform(transform, item.transform), size = Math.hypot(matrix[2], matrix[3]);
      const width = item.width * Math.hypot(transform[0], transform[1]);
      return Math.abs(candidate.measure(item.str, size).width - width) / Math.max(1, width);
    });
    if (median(errors(mono)) < .005 && median(errors(face)) > .02) families.set(name, 'mono');
  }
  return families;
}

interface PaintCursor { spanIndex: number; rawOffset: number; last?: PaintSpan }
/** PDF.js can split one paint span into text/space items; consume source substrings. */
function correlatePaint(text: string, spans: PaintSpan[], cursor: PaintCursor): { span?: PaintSpan; text: string; matched: boolean } {
  const itemText = normalize(text);
  if (!itemText) {
    const span = spans[cursor.spanIndex];
    const sourceSpace = span?.text.slice(cursor.rawOffset).match(/^\s+/)?.[0];
    if (sourceSpace && span) {
      cursor.rawOffset += sourceSpace.length; cursor.last = span;
      if (cursor.rawOffset === span.text.length) { cursor.spanIndex++; cursor.rawOffset = 0; }
      return { span, text: sourceSpace, matched: true };
    }
    return { span: cursor.last ?? span, text, matched: false };
  }
  for (let index = cursor.spanIndex; index < Math.min(spans.length, cursor.spanIndex + 16); index++) {
    const span = spans[index], positions: number[] = [];
    for (let raw = 0; raw < span.text.length; raw++) if (!/\s/.test(span.text[raw])) positions.push(raw);
    const normalizedStart = index === cursor.spanIndex ? positions.findIndex(position => position >= cursor.rawOffset) : 0;
    if (normalizedStart < 0) continue;
    const location = normalize(span.text).indexOf(itemText, normalizedStart);
    if (location < 0) continue;
    const start = positions[location], end = positions[location + itemText.length - 1] + 1;
    const prefix = index === cursor.spanIndex && cursor.rawOffset > 0 ? span.text.slice(cursor.rawOffset, start) : '';
    const sourceText = (/^\s+$/.test(prefix) ? prefix : '') + span.text.slice(start, end);
    cursor.spanIndex = index; cursor.rawOffset = end; cursor.last = span;
    if (end === span.text.length) { cursor.spanIndex++; cursor.rawOffset = 0; }
    return { span, text: sourceText, matched: true };
  }
  return { text, matched: false };
}

export async function inspectOperators(page: PDFPageProxy, pageId: string, viewport: Matrix, warnings: ImportWarning[], assets: ImageAsset[],sourceSha256:string,pageNumber:number,sourceBytes:Uint8Array): Promise<{ regions: Region[]; spans: PaintSpan[];imageAdmission:SourceImagePageAdmission }> {
  const operators = await page.getOperatorList(); const regions: Region[] = [], spans: PaintSpan[] = [];
  const sourceRules=captureSourceRulePaint(operators,viewport,pageNumber,sourceSha256);
  if (operators.fnArray.length > 100_000) throw new FolioError('PDF_COMPLEXITY', 'This PDF has too many drawing operations. Export a simpler PDF.');
  let state: GraphicsState = { matrix: [1, 0, 0, 1, 0, 0], fill: '#000000', stroke: '#000000', lineWidth: 1 }, font = '';
  const stack: GraphicsState[] = []; const seen = new Set<string>();
  const add = (code: string, message: string, severity: ImportWarning['severity'] = 'blocking') => { if (!seen.has(code)) { seen.add(code); warnings.push(warning(code, message, severity, pageId)); } };
  let sourceImages=new Map<number,CapturedSourceImage>(),provedClips=new Set<number>(),imagesUnsupported=false,legacyImages=false;
  try{sourceImages=await captureSourceImages(page,sourceBytes,pageNumber);provedClips=provedImageClipOperators(operators,sourceImages);}catch(error){sourceImages.clear();imagesUnsupported=true;legacyImages=await legacyCatalogueImagePage(page,sourceBytes,pageNumber);if(!legacyImages)add('PDF_IMAGE_PROOF',error instanceof Error?error.message:'The actual image clipping and pixel ownership cannot be proved.');}
  const mapped = (point: number[]) => { const result = [...point]; Util.applyTransform(result, Util.transform(viewport, state.matrix)); return result; };
  const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObject, OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintSolidColorImageMask]);
  for (let index = 0; index < operators.fnArray.length; index++) {
    const op = operators.fnArray[index], args = operators.argsArray[index] as any[];
    if(provedClips.has(index))continue;
    if (op === OPS.save) stack.push({ ...state, matrix: [...state.matrix] });
    else if (op === OPS.restore) { state = stack.pop() ?? state; }
    else if (op === OPS.transform) state.matrix = Util.transform(state.matrix, args as number[]);
    else if (op === OPS.paintFormXObjectBegin) { stack.push({ ...state, matrix: [...state.matrix] }); if (args[0]) state.matrix = Util.transform(state.matrix, args[0]); if (args[1]) add('PDF_FORM_CLIP', 'A form drawing uses a clipping boundary that is not reconstructed. Review the source artwork.'); }
    else if (op === OPS.paintFormXObjectEnd) state = stack.pop() ?? state;
    else if (op === OPS.setLineWidth) state.lineWidth = Number(args[0]);
    else if (op === OPS.setFillRGBColor) state.fill = color(args[0], state.fill);
    else if (op === OPS.setStrokeRGBColor) state.stroke = color(args[0], state.stroke);
    else if (op === OPS.setFont) font = String(args[0]);
    else if (op === OPS.showText || op === OPS.showSpacedText || op === OPS.nextLineShowText) {
      const glyphs = args[0] as unknown[];
      if (Array.isArray(glyphs)) { const text = glyphs.map(glyph => typeof glyph === 'object' && glyph !== null && 'unicode' in glyph ? String((glyph as { unicode: unknown }).unicode) : '').join(''); if (text) spans.push({ text, color: state.fill, font }); }
    } else if (imageOps.has(op)) {
      const owned=sourceImages.get(index);
      if(owned&&assets.length<30){let asset=assets.find(a=>a.mime==='image/png'&&sha256Sync(a.bytes)===owned.paint.assetSha256);if(!asset){if(assets.reduce((sum,a)=>sum+a.bytes.length,0)+owned.bytes.length>10*1024*1024)throw new FolioError('PDF_IMAGE_PREFLIGHT','The owned PNG transport exceeds the document byte budget.');asset={id:newId(),name:`pdf-image-${assets.length+1}.png`,mime:'image/png',bytes:owned.bytes};assets.push(asset);}regions.push({kind:'image',id:newId(),pageId,order:index,bounds:{...owned.paint.bounds},assetId:asset.id,alt:'Imported PDF image',sourcePaint:owned.paint});continue;}
      const matrix = Util.transform(viewport, state.matrix);
      if (op === OPS.paintImageXObject && typeof args[0] === 'string' && matrix[0] > 0 && matrix[3] < 0 && Math.abs(matrix[1]) < .01 && Math.abs(matrix[2]) < .01 && assets.length < 30) {
        const bytes = await extractPdfImage(page, args[0]);
        if (bytes) {
          const asset: ImageAsset = { id: newId(), name: `pdf-image-${assets.length + 1}.png`, mime: 'image/png', bytes }; assets.push(asset);
          regions.push({ kind: 'image', id: newId(), pageId, order: index, bounds: rectFromPoints([mapped([0, 0]), mapped([1, 1])]), assetId: asset.id, alt: 'Imported PDF image' });
          continue;
        }
      }
      add('PDF_IMAGE_OMITTED', 'An image uses an unsupported placement, mask, repetition, pixel format or size. Its visible content cannot be safely reconstructed; import a simpler source before export.');
    }
    else if (op === OPS.constructPath) {
      const paint = args[0] as number, data = args[1]?.[0] as ArrayLike<number> | undefined;
      // The original `n` operator ends a path without painting any ink.
      // Clip operators are checked separately and still block.
      if (paint === OPS.endPath) continue;
      const path = simpleSourcePath(data);
      if (!path) { add('PDF_COMPLEX_ART', 'A curved or compound drawing path cannot be reconstructed. Import a simpler source or review a replacement before export.'); continue; }
      const points = path.points.map(mapped), closed = path.closed;
      if (points.length === 2 && [OPS.stroke, OPS.closeStroke].includes(paint)) {
        const bounds = rectFromPoints(points);
        if (bounds.width < .05 || bounds.height < .05) {const thickness=Math.max(.1,state.lineWidth*Math.hypot(state.matrix[0],state.matrix[1]));if(!Number.isFinite(thickness)||thickness>100)throw new FolioError('PDF_DRAWING_GEOMETRY','A source stroke exceeds the supported 100-point width. Export a simpler PDF; its original remains intact.');const sourcePaint=sourceRules.get(index);regions.push({ kind: 'rule', id: newId(), pageId, order: index, bounds:sourcePaint?{...sourcePaint.bounds}:bounds, color:sourcePaint?.color??state.stroke, thickness:sourcePaint?.thickness??thickness,...(sourcePaint?{sourcePaint}:{}) });}
        else add('PDF_DIAGONAL_RULE', 'A diagonal rule cannot be reconstructed by the supported rule geometry.');
      } else {
        const bounds = rectFromPoints(points), unique = points.filter((point, i) => !points.slice(0, i).some(other => Math.hypot(point[0] - other[0], point[1] - other[1]) < .01));
        const rectangle = (closed || points.length === 5) && unique.length === 4 && unique.every(point => (Math.abs(point[0] - bounds.x) < .01 || Math.abs(point[0] - bounds.x - bounds.width) < .01) && (Math.abs(point[1] - bounds.y) < .01 || Math.abs(point[1] - bounds.y - bounds.height) < .01));
        if (rectangle && [OPS.fill, OPS.eoFill, OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke].includes(paint)) {
          const fill = ![OPS.stroke, OPS.closeStroke].includes(paint), stroke = ![OPS.fill, OPS.eoFill].includes(paint);
          const thickness=stroke?Math.max(.1,state.lineWidth*Math.hypot(state.matrix[0],state.matrix[1])):0;
          if(!Number.isFinite(thickness)||thickness>100)throw new FolioError('PDF_DRAWING_GEOMETRY','A source stroke exceeds the supported 100-point width. Export a simpler PDF; its original remains intact.');
          regions.push({ kind: 'rectangle', id: newId(), pageId, order: index, bounds, ...(fill ? { fill: state.fill } : {}), ...(stroke ? { stroke: state.stroke } : {}), thickness });
        } else add('PDF_COMPLEX_ART', 'A nonrectangular or compound drawing cannot be reconstructed. Import a simpler source or review a replacement before export.');
      }
    } else if ([OPS.clip, OPS.eoClip, OPS.shadingFill, OPS.beginGroup, OPS.setFillColorN, OPS.setStrokeColorN, OPS.setFillTransparent, OPS.setStrokeTransparent, OPS.rawFillPath].includes(op)) add('PDF_COMPLEX_ART', 'Clipping, shading, patterns, masks, or transparency cannot be reconstructed. Import a simpler source or review a replacement before export.');
    else if (op === OPS.setGState) {
      const entries = args[0] as [string, unknown][];
      if (Array.isArray(entries)) for (const [key, value] of entries) {
        if (key === 'LW') state.lineWidth = Number(value);
        else if ((key === 'ca' || key === 'CA') && value !== 1 || key === 'BM' && value !== 'source-over' && value !== 'Normal' || key === 'SMask' && value) add('PDF_TRANSPARENCY', 'A blend mode, opacity, or image mask cannot be reconstructed. Review a simpler source before export.');
      }
    } else if (op === OPS.setDash && Array.isArray(args[0]) && args[0].length) add('PDF_DASH_PATTERN', 'Dashed drawing rules are reconstructed as solid rules. Review their appearance.', 'review');
    else if (op === OPS.setTextRenderingMode && Number(args[0]) !== 0) add('PDF_TEXT_PAINT', 'Outlined, invisible, or clipping text has unsupported paint behavior. Correct it against the source before export.');
    else if (op === OPS.setHScale && Number(args[0]) !== 100 || op === OPS.setCharSpacing && Number(args[0]) !== 0 || op === OPS.setWordSpacing && Number(args[0]) !== 0) add('PDF_TEXT_SPACING', 'Custom character spacing or horizontal scaling differs in the reconstruction. Review text widths.', 'review');
  }
  return { regions, spans,imageAdmission:legacyImages?{pageNumber,status:'legacy-catalogue-unclipped-v1'}:sourceImagePageAdmission(pageNumber,sourceImages,imagesUnsupported) };
}

export async function importPdf(file: File, bytes: Uint8Array, mixedSpacing=true): Promise<ImportResult> {
  if(await (await import('./pdf-layered-original')).hasLayeredOriginalSource(bytes)){const layered=await (await import('./pdf-type1-baseline')).importOriginalType1Pdf(file,bytes);if(layered)return layered;}
  const composite=await import('./pdf-composite');if(await composite.needsCompositeSource(bytes))return composite.importCompositePdf(file,bytes);
  const type1=await (await import('./pdf-type1-baseline')).importOriginalType1Pdf(file,bytes);if(type1)return type1;
  const standard=await (await import('./pdf-standard-native')).importStandard14Pdf(file,bytes);if(standard)return standard;
  const source = await sourceAsset(file, bytes, 'pdf');
  // PDF.js may transfer/detach its input. Only give it a private disposable copy.
  const sourceColorProfile=await sourceIccProfile(bytes);
  const loading = getDocument({...localPdfDecoderOptions(), data: new Uint8Array(bytes), useSystemFonts: false, isOffscreenCanvasSupported:false, fontExtraProperties: true, stopAtErrors: true, maxImageSize: 20_000_000, verbosity: 0 });
  const reconstruct = async (): Promise<ImportResult> => {
  let pdf;
  try { pdf = await loading.promise; } catch (error) {
    void loading.destroy().catch(() => {});
    if (error instanceof Error && error.name === 'PasswordException') throw new FolioError('ENCRYPTED_DOCUMENT', 'Encrypted PDFs are not supported. Export an unencrypted PDF first.');
    throw new FolioError('CORRUPT_PDF', 'This PDF is corrupt or unreadable. Export a fresh PDF and try again.');
  }
  try {
    if (pdf.numPages < 1 || pdf.numPages > MAX_SOURCE_PAGES) throw new FolioError('PAGE_LIMIT', `This PDF has more than ${MAX_SOURCE_PAGES} pages. Choose a shorter PDF.`);
    const metadata = await pdf.getMetadata();
    if (await pdf.getPermissions() !== null || (metadata.info as { EncryptFilterName?: unknown }).EncryptFilterName) throw new FolioError('ENCRYPTED_DOCUMENT', 'Encrypted PDFs are not supported. Export an unencrypted PDF first.');
    // Loading PDF metadata preserves the original actionable parser refusals.
    // Inventory actual image resources before getPage/operator/text/raster decoding.
    await preflightPdfImages(bytes);
    source.sourcePageCount = pdf.numPages;
    const imageAdmissions:SourceImagePageAdmission[]=[];
    const scopedCaptures:(CapturedScopedPage|undefined)[]=[];
    const pages: TemplatePage[] = [], blocks: ContentBlock[] = [], facts: Fact[] = [], warnings: ImportWarning[] = [], assets: ImageAsset[] = [], sourceFonts: SourceFontAsset[] = [], sourceLinks: SourceLink[] = [];
    const optionalContent = await pdf.getOptionalContentConfig();
    if (Array.from(optionalContent).length) warnings.push(warning('PDF_OPTIONAL_CONTENT', 'The source contains optional content layers. Hidden and visible layer text cannot be safely distinguished for reconstruction. Export a flattened text PDF first.', 'blocking'));
    warnings.push(warning('PDF_FIXED_LINES', 'Selectable PDF text uses fixed line regions. Edits retain their approved bounds and may overflow.'));
    if (await pdf.getJSActions() || await pdf.getAttachments()) warnings.push(warning('PDF_ACTIVE_CONTENT', 'Scripts or attached files were excluded. The original remains available; the reconstructed PDF contains editable resume content only.', 'review'));
    let characters = 0,semanticSplitSeen=false;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const originalPage = await pdf.getPage(pageNumber), viewport = originalPage.getViewport({ scale: 1 });
      if (viewport.width > 2000 || viewport.height > 2000) throw new FolioError('PAGE_GEOMETRY', 'This PDF has an unsupported page size. Use pages no larger than 2000 points.');
      const page: TemplatePage = { id: newId(), width: viewport.width, height: viewport.height, regions: [] }; pages.push(page);
      const { regions, spans,imageAdmission } = await inspectOperators(originalPage, page.id, viewport.transform, warnings, assets,source.sha256,pageNumber,bytes);
      page.regions.push(...regions);imageAdmissions.push(imageAdmission);
      const links: { bounds: Rect; href: string; originalHref: string; annotationIndex: number; annotationId: string }[] = [];
      const annotations = await originalPage.getAnnotations({ intent: 'display' });
      for (const [annotationIndex, annotation] of annotations.entries()) {
        if (annotation.subtype !== 'Link') { warnings.push(warning('PDF_ANNOTATION_OMITTED', 'A form, signature, note, or other annotation was excluded from reconstruction. Import a flattened text PDF to preserve visible annotation content.', 'blocking', page.id)); continue; }
        const originalHref = annotation.unsafeUrl ?? annotation.url ?? '';
        const href = safeHref(originalHref);
        if (!href) { warnings.push(warning('UNSAFE_LINK', 'An unsafe, scripted, or internal link was removed. Visible text remains editable.', 'review', page.id)); continue; }
        const [x1, y1, x2, y2] = annotation.rect as number[];
        links.push({ bounds: rectFromPoints([viewport.convertToViewportPoint(x1, y1), viewport.convertToViewportPoint(x2, y2)]), href, originalHref, annotationIndex, annotationId: String(annotation.id ?? annotationIndex) });
      }
      const text = await originalPage.getTextContent({ disableNormalization: true });
      if (text.items.length > 10000) throw new FolioError('PDF_COMPLEXITY', 'This PDF contains too many text fragments. Export a simpler resume PDF.');
      let captured;
      const provedCatalogueFaces=new Map<string,PdfFontIdentity>();
      const previousFontCount = sourceFonts.length;
      try {
        const graph = await captureSourceGlyphs(originalPage, viewport.transform, source.sha256, sourceFonts,bytes,pageNumber,provedCatalogueFaces);
        if (graph) captured = associateSourceItems(text.items, graph, viewport.transform, sourceFonts,undefined,mixedSpacing);
      } catch (error) {
        if(sourceColorProfile||sourceFonts.some(f=>f.sourceVersion===7||f.sourceVersion===8||f.sourceVersion===9||f.sourceVersion===10))throw error;
        sourceFonts.splice(previousFontCount);
        warnings.push(warning('PDF_SOURCE_PROOF', error instanceof FolioError ? error.message : 'The source font and glyph graph could not be verified.', 'blocking', page.id));
      }
      if (captured) {
        const semanticSplit=captured.some(entry=>entry.semanticSplit),semanticFacts=new Map<number,Fact>(),semanticPhysicalLengths=new Map<number,number>();semanticSplitSeen ||= semanticSplit;
        if(semanticSplit)for(const entry of captured)if(entry.semanticSplit)semanticPhysicalLengths.set(entry.index,(semanticPhysicalLengths.get(entry.index)??0)+entry.glyphs.reduce((n,g)=>n+g.unicode.length,0));
        const permittedResetFonts=sourceFonts.every(f=>f.format==='truetype'&&(f.sourceVersion===4||f.sourceVersion===5||f.sourceVersion===10));
        const sourceWidths=new Map(sourceFonts.map(f=>[f.id,new Map(f.glyphMap.map(g=>[g.cid,g.pdfWidth]))]));
        const fractionalOperators=new Set(permittedResetFonts?captured.flatMap(e=>e.glyphs.filter(g=>!g.inferredGap&&!Number.isSafeInteger(sourceWidths.get(g.fontId)?.get(g.cid))).map(g=>g.operatorIndex)):[]);
        const mixedDocumentFonts=sourceFonts.some(f=>f.sourceVersion===7&&f.namelessDescriptor)&&sourceFonts.some(f=>f.sourceVersion===7&&f.declaredStyle.post!==null);
        let groupingRequired=mixedDocumentFonts||permittedResetFonts&&((originalPage.view[0]!==0||originalPage.view[1]!==0)||captured.some(e=>e.glyphs.some(g=>g.shearX))||captured.reduce((n,e)=>n+new Set(e.glyphs.map(g=>g.operatorIndex)).size,regions.length)>1000),fractionalResetReplay=false;
        let scoped:CapturedScopedPage|undefined;
        if(sourceFonts.some(f=>'originalProgram'in f&&f.originalProgram))try{scoped=await captureScopedPage(originalPage,bytes,pageNumber,semanticSplit||groupingRequired||fractionalOperators.size>0,semanticSplit||groupingRequired||fractionalOperators.size>0,groupingRequired||fractionalOperators.size>0,captured.some(e=>e.glyphs.some(g=>g.shearX)));}catch(error){if(groupingRequired||semanticSplit||sourceColorProfile||sourceFonts.some(f=>f.sourceVersion===7||f.sourceVersion===8||f.sourceVersion===9||f.sourceVersion===10))throw error;/* Legacy preview retains its blocking scope refusal. */}
        // Fractional relative Td needs the original reset sequence even below
        // the representation-size trigger. Every source show must retain reset
        // ownership; the existing V16 compiler still proves complete coverage.
        if(!groupingRequired&&scoped&&[...fractionalOperators].some(op=>!scoped!.wholeShows?.has(op))){
          const operators=new Set(captured.flatMap(e=>e.glyphs.filter(g=>!g.inferredGap).map(g=>g.operatorIndex)));
          if([...operators].every(op=>scoped!.positionedShows?.has(op))){groupingRequired=true;fractionalResetReplay=true;}
        }
        scopedCaptures[pageNumber-1]=scoped;
        const faces = new Map(sourceFonts.map(font => [font.id, loadSourceFont(font)]));
        const sourceItems = captured.filter(entry => entry.item.str.length && !(entry.glyphs.every(glyph=>glyph.inferredGap) && /^\s+$/.test(entry.item.str))).flatMap(entry=>{
          // A source span cannot move glyph paint across a later interleaved image.
          const imageOrders=regions.flatMap(r=>r.kind==='image'?[r.order]:[]),groups:typeof entry.glyphs[]=[];for(const glyph of entry.glyphs){const group=groups.at(-1);if(group&&(!scoped||group.at(-1)!.operatorIndex===glyph.operatorIndex||groupingRequired&&group[0].fontId===glyph.fontId&&group[0].resource===glyph.resource&&group[0].baseline===glyph.baseline&&group[0].size===glyph.size&&group[0].color===glyph.color&&(group[0].shearX??0)===(glyph.shearX??0)&&(mixedDocumentFonts&&mixedSpacing||(group[0].characterSpacing??0)===(glyph.characterSpacing??0))&&glyph.x>=group.at(-1)!.x&&homogeneousSourceShows(scoped,[group.at(-1)!.operatorIndex,glyph.operatorIndex],mixedDocumentFonts,mixedDocumentFonts&&mixedSpacing))&&!imageOrders.some(op=>op>group.at(-1)!.operatorIndex&&op<glyph.operatorIndex))group.push(glyph);else groups.push([glyph]);}
          return groups.map(glyphs=>({...entry,item:{...entry.item,str:glyphs.map(g=>g.unicode).join('')},glyphs}));
        }); 
        if(pages.reduce((n,p)=>n+p.regions.length,0)+sourceItems.length>1000)throw new FolioError('PDF_COMPLEXITY','This PDF exceeds the bounded region or source glyph graph limit. Export a simpler resume.');
        for (const entry of sourceItems) {
          if(entry.glyphs.some(g=>g.shapeOnly)) {
            if(!entry.glyphs.every(g=>g.shapeOnly))throw new FolioError('PDF_SOURCE_PROOF','A shape-only source glyph cannot share an editable text span.');
            for(const glyph of entry.glyphs){const face=faces.get(glyph.fontId)!,box=face.font.getGlyph(glyph.glyphId!).bbox,scale=glyph.size/face.font.unitsPerEm;page.regions.push({kind:'sourceShape',id:newId(),pageId:page.id,order:glyph.operatorIndex,bounds:{x:glyph.x+box.minX*scale,y:glyph.baseline-box.maxY*scale,width:box.width*scale,height:box.height*scale},sourceFontId:glyph.fontId,glyphId:glyph.glyphId!,fontChar:glyph.fontChar!,sourceSha256:source.sha256,sourceProgramSha256:face.asset.sha256,sourceX:glyph.x,sourceBaseline:glyph.baseline,fontSize:glyph.size,color:glyph.color,operatorIndex:glyph.operatorIndex,originalCodepoints:[5],originalCharCode:glyph.originalCharCode??null,sourceLocator:`pdf/page[${pageNumber}]/operator[${glyph.operatorIndex}]/shape`});}
            warnings.push(warning('PDF_SOURCE_SHAPE','A source control-coded icon is retained as its exact noneditable outline. It contributes no resume text or qualification evidence.','review',page.id));continue;
          }
          const first = entry.glyphs[0], last = entry.glyphs.at(-1)!, face = faces.get(first.fontId)!, size = first.size;
          characters += entry.item.str.length;
          if (characters > MAX_TEXT) throw new FolioError('TEXT_LIMIT', 'This PDF contains too much text.');
          const endX = last.x + last.advance;
          let top = first.baseline - face.ascent(size), bottom = first.baseline + face.descent(size), right = endX, left = first.x;
          for (const glyph of entry.glyphs) {
            const map = face.asset.glyphMap.find(map => map.cid === glyph.cid)!;
            if (map.nonPainting) continue;
            const box = sourceOutlineBox(face.font.getGlyph(map.glyphId).path,first.shearX??0), scale = size / face.font.unitsPerEm;
            top = Math.min(top, first.baseline - box.maxY * scale); bottom = Math.max(bottom, first.baseline - box.minY * scale); right = Math.max(right, glyph.x + box.maxX * scale); left = Math.min(left,glyph.x+box.minX*scale);
          }
          const bounds = { x:left, y:top, width:Math.max(.1, right-left), height:Math.max(.1,bottom-top) };
          const hits = links.filter(link => overlap(bounds, link.bounds) >= Math.max(.01, bounds.width * bounds.height * .25));
          const contentId = newId(), locator = `pdf/page[${pageNumber}]/item[${entry.index}]`;
          let fact=entry.semanticSplit?semanticFacts.get(entry.index):undefined;
          if(!fact){
            const value=entry.semanticSplit?entry.semanticText!:entry.item.str;
            if(entry.semanticSplit){characters+=Math.max(0,value.length-semanticPhysicalLengths.get(entry.index)!);if(characters>MAX_TEXT)throw new FolioError('TEXT_LIMIT','This PDF contains too much text.');}
            fact={id:newId(),text:value,kind:'resume',locator,confirmed:false};facts.push(fact);if(entry.semanticSplit)semanticFacts.set(entry.index,fact);
          }
          const factId=fact.id;
          const runs: TextRun[] = [{ text:entry.item.str, bold:face.editorStyle.fontWeight===700, italic:face.editorStyle.italic, sourceFactIds:[factId], ...(hits.length===1 ? {href:hits[0].href} : {}) }];
          const row = sourceItems.filter(other => other !== entry && Math.abs(other.glyphs[0].baseline-first.baseline)<=Math.min(size,other.glyphs[0].size)*.15);
          const anchor = row.length>0 && row.every(other=>other.glyphs.at(-1)!.x+other.glyphs.at(-1)!.advance < first.x-size) ? 'end' : 'start';
          blocks.push({id:contentId,runs,sourceFactIds:[factId]});
          page.regions.push({kind:'text',id:newId(),pageId:page.id,order:first.operatorIndex,bounds,contentId,role:size>=15?'heading':hits.length===1?'contact':'body',style:{fontFamily:face.asset.sourceVersion===8?face.asset.licensedDerivation.catalogueFace.split('-')[0] as FontFamily:'sans',fontSize:size,fontWeight:face.editorStyle.fontWeight,italic:face.editorStyle.italic,color:first.color,alignment:anchor==='end'?'right':'left',lineHeight:size*1.25,baselineOffset:first.baseline-top,sourceFontId:first.fontId},sourceLocator:locator,sourceLayout:{...(new Set(entry.glyphs.map(g=>g.characterSpacing??0)).size>1?{version:5 as const,showSpacing:[...new Map(entry.glyphs.map(g=>[g.operatorIndex,g.characterSpacing??0])).entries()],editPolicy:'baselineOnly' as const}:first.shearX?{version:4 as const,shearX:first.shearX,characterSpacing:first.characterSpacing??0,editPolicy:'baselineOnly' as const}:(face.asset.format==='truetype'||face.asset.sourceVersion===9)?(first.characterSpacing?{version:3 as const,characterSpacing:first.characterSpacing,editPolicy:entry.glyphs.some(g=>g.advance+first.characterSpacing!<=0)?'baselineOnly' as const:'scalarCovered' as const,...(entry.glyphs.some(g=>g.advance+first.characterSpacing!<=0)?{editReason:'nonPositiveStep' as const}:{})}:{version:1 as const}):{version:2 as const,baselineStyle:{fontWeight:400 as const,italic:face.editorStyle.italic},editPolicy:entry.glyphs.some(g=>Array.from(g.unicode).length>1)?'baselineOnly' as const:'scalarCovered' as const,...(entry.glyphs.some(g=>Array.from(g.unicode).length>1)?{editReason:'sourceLigature' as const}: {})}),sourceSha256:source.sha256,baselineRunsHash:hashTextSync(canonicalJson(runs)),anchor,startX:first.x,endX,baseline:first.baseline,fontSize:size,glyphs:entry.glyphs.map(({fontId,cid,unicode,x,advance,operatorIndex,inferredGap})=>({fontId,cid,unicode,x,advance,operatorIndex,...(inferredGap?{inferredGap}: {})}))}});
        }
        if(sourceFonts.some(font=>font.format==='opentype-cff')&&!warnings.some(w=>w.code==='PDF_SOURCE_STYLE_UNKNOWN'))warnings.push(warning('PDF_SOURCE_STYLE_UNKNOWN','Source CFF outlines are retained exactly. Their declared weight is program metadata; semantic bold is unknown. Ligature regions remain readable with editing unavailable until their native mapping is proved.','review',page.id));
        warnings.push(warning('PDF_SOURCE_FIXED_LINES', 'Verified source font outlines and glyph positions are retained. Each source span stays on one fixed line; edits require proved characters and its original style.', 'review', page.id));
        for (const link of links) {
          const bindings = page.regions.flatMap(region => {
            if (region.kind !== 'text' || !region.sourceLayout) return [];
            const block = blocks.find(block => block.id === region.contentId);
            if (!block?.runs.some(run=>run.text.trim()) || !block.runs.every(run => !!run.href && safeHref(run.href) === safeHref(link.href)) || overlap(region.bounds, link.bounds) < Math.max(.01, region.bounds.width * region.bounds.height * .25)) return [];
            return [{regionId:region.id, contentId:region.contentId, baselineRunsHash:region.sourceLayout.baselineRunsHash}];
          });
          if (!bindings.length || bindings.length > 100 || /[^\x20-\x7e]/.test(link.originalHref) || !Object.values(link.bounds).every(Number.isFinite) || link.bounds.width<=0 || link.bounds.height<=0 || Math.max(link.bounds.width,link.bounds.height)>5000 || link.bounds.x>=page.width || link.bounds.y>=page.height || link.bounds.x+link.bounds.width<=0 || link.bounds.y+link.bounds.height<=0) {
            warnings.push(warning('PDF_LINK_SOURCE', 'An original link rectangle could not be bound to exact source text. Its admitted destination uses current visible text geometry.', 'review', page.id)); continue;
          }
          const evidence: Omit<SourceLink, 'proofHash'> = {id:newId(),pageId:page.id,sourceSha256:source.sha256,annotationIndex:link.annotationIndex,annotationId:link.annotationId,bounds:link.bounds,href:link.originalHref,bindings};
          sourceLinks.push({...evidence,proofHash:sourceLinkProofHash(evidence)});
          if (sourceLinks.length > 1000) throw new FolioError('PDF_LINK_LIMIT', 'This PDF exceeds the bounded original hyperlink inventory.');
        }
        if(scoped)try{
          if(page.regions.some(r=>r.kind==='sourceShape'||r.kind==='image'||r.kind==='text'&&!r.sourceLayout))throw new FolioError('PDF_SCOPED_PAINT','Mixed decoration or normalized text has no scoped source replay proof.');
          const staged=structuredClone(page.regions);for(const region of staged)if('sourceScopedPaint'in region||['text','rule','rectangle'].includes(region.kind)){(region as Extract<Region,{kind:'text'|'rule'|'rectangle'}>).sourceScopedPaint=bindScopedRegion(region,scoped,source.sha256,pageNumber,sourceFonts);}
          const covered=new Map<number,number>();for(const region of staged)for(const op of scopedRegionOperators(region)){const count=(covered.get(op)??0)+1;if((region.kind!=='text'||region.sourceScopedPaint?.showGroup)&&count>1)throw new FolioError('PDF_SCOPED_PAINT','A grouped show or primitive cannot share an original paint occurrence.');covered.set(op,count);}if([...scoped.byOperator.keys()].some(op=>!covered.has(op)))throw new FolioError('PDF_SCOPED_PAINT','Some original paint occurrences have no reconstructed owner.');
          // A bound scoped rule owns the exact original numeric geometry.
          // The earlier decoder-only witness uses Float32 path coordinates;
          // retaining it after binding would assert two different geometries.
          // Scope restoration independently rederives the complete primitive.
          for(const region of staged)if(region.kind==='rule'&&region.sourceScopedPaint)delete region.sourcePaint;
          if(fractionalResetReplay&&!staged.some(r=>r.kind==='text'&&r.sourceScopedPaint?.showGroup))throw new FolioError('PDF_SCOPED_PAINT','Fractional relative text needs actual homogeneous groups and complete reset replay ownership.');
          page.regions=staged;
        }catch(error){if(groupingRequired||semanticSplit||sourceColorProfile||sourceFonts.some(f=>f.sourceVersion===7||f.sourceVersion===8||f.sourceVersion===9||f.sourceVersion===10))throw error;scopedCaptures[pageNumber-1]=undefined;for(const region of page.regions)if('sourceScopedPaint'in region)delete region.sourceScopedPaint;}
        originalPage.cleanup();
        continue;
      }
      const families = await compatibleFamilies(text.items.filter((item): item is TextItem => 'str' in item), text.styles, viewport.transform);
      if ([...families].some(([name, family]) => family !== familyFor(text.styles[name]?.fontFamily ?? ''))) warnings.push(warning('PDF_FONT_METRICS', 'A bundled monospaced font was selected by comparing source text widths. Compare its appearance; source font names and styling remain uncertain.', 'review', page.id));
      const observed: ObservedItem[] = []; const paintCursor: PaintCursor = { spanIndex: 0, rawOffset: 0 };
      let previousEmittedText = '', previousMatchedSpan: PaintSpan | undefined;
      const fontMappings = new Set<string>();
      for (let itemIndex = 0; itemIndex < text.items.length; itemIndex++) {
        const item = text.items[itemIndex]; if (!('str' in item) || !item.str.length) continue;
        characters += item.str.length; if (characters > MAX_TEXT) throw new FolioError('TEXT_LIMIT', 'This PDF contains too much text. Use a shorter PDF.');
        const transform = Util.transform(viewport.transform, item.transform), fontSize = Math.hypot(transform[2], transform[3]) || Math.hypot(transform[0], transform[1]);
        if (!transform.every(Number.isFinite) || !Number.isFinite(item.width) || fontSize < .1 || fontSize > 144) throw new FolioError('PDF_TEXT_GEOMETRY', 'This PDF contains invalid or unsupported text geometry. Export a fresh PDF.');
        const style = text.styles[item.fontName] as PdfTextStyle;
        const ascent = Number.isFinite(style?.ascent) ? style.ascent : .8;
        const baseline = transform[5], bounds = { x: transform[4], y: baseline - fontSize * ascent, width: Math.max(.1, item.width * Math.hypot(viewport.transform[0], viewport.transform[1])), height: fontSize * 1.25 };
        if (item.dir !== 'ltr' || style?.vertical || Math.abs(transform[1]) > .01 || Math.abs(transform[2]) > .01 || transform[0] <= 0) warnings.push(warning('PDF_ROTATED_OR_RTL_TEXT', 'Rotated, vertical, or right-to-left text is retained for inspection but its layout cannot be reconstructed. Import horizontal text before export.', 'blocking', page.id));
        if (/[\ufffd\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(item.str)) warnings.push(warning('PDF_UNREADABLE_TEXT', 'Text has missing or unsupported Unicode mappings. Correct it against the source before export.', 'blocking', page.id));
        const previousCursorSpan = spans[paintCursor.spanIndex], previousRawOffset = paintCursor.rawOffset;
        const correlation = correlatePaint(item.str, spans, paintCursor);
        const selected = correlation.span;
        const reconciledText = reconcilePdfText(item.str, correlation.text, correlation.matched && selected === previousMatchedSpan && selected === previousCursorSpan && previousRawOffset > 0 && !/\s$/.test(previousEmittedText));
        previousEmittedText = reconciledText;
        previousMatchedSpan = correlation.matched ? selected : undefined;
        const sourceResource = selected?.font ?? item.fontName;
        const identity = provedCatalogueFaces.get(sourceResource) ?? knownPdfFont(originalPage, sourceResource);
        const family = identity?.family ?? families.get(item.fontName) ?? familyFor(style?.fontFamily ?? '');
        if (!identity) {
          const targetFace = FONT_FILES[`${family}-400-normal`], mappingKey = `${sourceResource}\0${targetFace}`;
          if (!fontMappings.has(mappingKey)) {
            if (!sourceResource || sourceResource.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(sourceResource)) throw new FolioError('PDF_FONT_METADATA', 'A PDF font resource has invalid metadata. Export a fresh PDF and try again.');
            if (warnings.length >= 1000) throw new FolioError('IMPORT_WARNING_LIMIT', 'This PDF has too many distinct import observations. Export a simpler source before continuing.');
            fontMappings.add(mappingKey);
            const sourceName = reportedPdfFontName(originalPage, sourceResource);
            warnings.push({ ...warning('FONT_SUBSTITUTION', `Source font ${sourceName ? `“${sourceName}”` : '(reported name unavailable)'} uses ${targetFace}, regular 400. Source weight and italic are uncertain; compare glyph shapes, spacing and line endings.`, 'review', page.id), fontMapping: { sourceResource, sourceName, targetFace, sourceStyle: 'unknown' } });
          }
          if (!warnings.some(w => w.code === 'PDF_STYLE_UNCERTAINTY' && w.pageId === page.id)) warnings.push(warning('PDF_STYLE_UNCERTAINTY', 'Weight and italic could not be identified for an unfamiliar source font. Its reconstruction uses regular text; compare it before approval.', 'review', page.id));
        }
        if (!selected && !warnings.some(w => w.code === 'PDF_COLOR_UNCERTAINTY' && w.pageId === page.id)) warnings.push(warning('PDF_COLOR_UNCERTAINTY', 'Some PDF text could not be correlated with paint operators. Its color defaults to black; review the source comparison.', 'review', page.id));
        const hits = links.filter(link => overlap(bounds, link.bounds) >= Math.max(.01, bounds.width * bounds.height * .25));
        if (hits.length === 1 && overlap(bounds, hits[0].bounds) < bounds.width * bounds.height * .9 && !warnings.some(w => w.code === 'PDF_LINK_RANGE' && w.pageId === page.id)) warnings.push(warning('PDF_LINK_RANGE', 'A link covers only part of a source text fragment. Reconstruction links that editable fragment; review the clickable area.', 'review', page.id));
        if (hits.length > 1) warnings.push(warning('PDF_LINK_AMBIGUITY', 'A text fragment intersects multiple links. Its link was excluded; review the intended destination.', 'review', page.id));
        observed.push({ item: { ...item, str: reconciledText }, index: itemIndex, bounds, baseline, fontSize, family, fontWeight: identity?.fontWeight ?? 400, italic: identity?.italic ?? false, color: selected?.color ?? '#000000', ...(hits.length === 1 ? { href: hits[0].href } : {}) });
      }
      // Use spatial line order and retain source item indexes; object order is not treated as reading order.
      observed.sort((a, b) => Math.abs(a.baseline - b.baseline) > Math.max(1, Math.min(a.fontSize, b.fontSize) * .2) ? a.baseline - b.baseline : a.bounds.x - b.bounds.x);
      const lines: ObservedItem[][] = [];
      for (const item of observed) {
        const line = lines.at(-1), previous = line?.at(-1);
        if (previous && Math.abs(previous.baseline - item.baseline) <= Math.max(1, item.fontSize * .15) && Math.abs(previous.fontSize - item.fontSize) < .05 && previous.family === item.family && previous.fontWeight === item.fontWeight && previous.italic === item.italic && previous.color === item.color && item.bounds.x - previous.bounds.x - previous.bounds.width < item.fontSize * 3 && item.bounds.x >= previous.bounds.x) line!.push(item);
        else lines.push([item]);
      }
      const originalOrder = observed.map(item => item.index), spatialChanged = originalOrder.some((value, index) => index > 0 && value < originalOrder[index - 1]);
      if (spatialChanged || lines.some((line, i) => lines.slice(i + 1).some(other => Math.abs(other[0].baseline - line[0].baseline) < 2 && Math.abs(other[0].bounds.x - line[0].bounds.x) > page.width * .25))) warnings.push(warning('PDF_READING_ORDER', 'Position-based reading order may differ from columns or the PDF object order. Review the sequence of editable regions.', 'review', page.id));
      for (const line of lines) {
        const first = line[0], last = line.at(-1)!, factId = newId(), contentId = newId(), runs: TextRun[] = [];
        line.forEach((item, index) => {
          const previous = line[index - 1];
          if (previous && item.bounds.x - previous.bounds.x - previous.bounds.width > item.fontSize * .12 && !/\s$/.test(previous.item.str) && !/^\s/.test(item.item.str)) runs.push({ text: ' ', sourceFactIds: [factId] });
          runs.push({ text: item.item.str, bold: item.fontWeight === 700, italic: item.italic, sourceFactIds: [factId], ...(item.href ? { href: item.href } : {}) });
        });
        const value = runs.map(run => run.text).join(''), locator = `pdf/page[${pageNumber}]/items[${line.map(item => item.index).join(',')}]`;
        const sourceTop = Math.min(...line.map(item => item.bounds.y)), lineHeight = first.fontSize * 1.25;
        const metrics = (await loadFont(fontKey({ fontFamily: first.family, fontWeight: first.fontWeight, italic: first.italic }))).measure(value, first.fontSize);
        // Infer the initial editable box using the actual replacement font. The
        // source baseline and text origin remain fixed; later edits never grow
        // these approved regions. Avoid borrowing space from a neighboring
        // column or containing rectangle when the substitute is wider.
        const observedWidth = Math.max(.1, last.bounds.x + last.bounds.width - first.bounds.x) + .5;
        let rightEdge = page.width - Math.min(...observed.map(item => Math.max(0, item.bounds.x)));
        for (const other of lines) {
          const next = other[0];
          if (next !== first && next.bounds.x >= first.bounds.x + observedWidth && Math.abs(next.baseline - first.baseline) < Math.max(next.fontSize, first.fontSize)) rightEdge = Math.min(rightEdge, next.bounds.x - .5);
        }
        for (const region of regions) if (region.kind === 'rectangle' && first.bounds.x >= region.bounds.x && first.bounds.x < region.bounds.x + region.bounds.width && first.baseline >= region.bounds.y && first.baseline <= region.bounds.y + region.bounds.height) rightEdge = Math.min(rightEdge, region.bounds.x + region.bounds.width - .5);
        const width = Math.max(observedWidth, Math.min(Math.max(metrics.width, metrics.right) + .5, rightEdge - first.bounds.x));
        const top = Math.min(sourceTop, first.baseline + metrics.top), height = Math.max(lineHeight, first.baseline + metrics.bottom - top);
        if ((width > observedWidth + .05 || top < sourceTop - .05) && !warnings.some(w => w.code === 'PDF_REGION_METRICS' && w.pageId === page.id)) warnings.push(warning('PDF_REGION_METRICS', 'Initial text regions include measured replacement-font widths while preserving source text origins and baselines. Compare line endings and neighboring columns; approved regions stay fixed during editing.', 'review', page.id));
        facts.push({ id: factId, text: value, kind: 'resume', locator, confirmed: false });
        blocks.push({ id: contentId, runs, sourceFactIds: [factId] });
        page.regions.push({ kind: 'text', id: newId(), pageId: page.id, order: page.regions.length, bounds: { x: first.bounds.x, y: top, width, height }, contentId, role: /^[•◦▪‣–\-*]\s/.test(value) ? 'bullet' : first.fontSize >= 15 ? 'heading' : line.some(item => item.href) ? 'contact' : 'body', style: { fontFamily: first.family, fontSize: first.fontSize, fontWeight: first.fontWeight, italic: first.italic, color: first.color, alignment: 'left', lineHeight, baselineOffset: first.baseline - top }, sourceLocator: locator });
      }
      const linkedRegions = observed.filter(item => item.href).length;
      if (links.length && !linkedRegions) warnings.push(warning('PDF_UNBOUND_LINK', 'A safe link annotation could not be bound to selectable text. It was excluded; review its visible source location.', 'review', page.id));
      originalPage.cleanup();
    }
    if(pages.reduce((count,page)=>count+page.regions.length,0)>1000 || sourceFonts.reduce((count,font)=>count+font.glyphMap.length,0)>100000 || pages.reduce((count,page)=>count+page.regions.reduce((n,r)=>n+(r.kind==='text'?(r.sourceLayout?.glyphs.length??0):0),0),0)>100000)throw new FolioError('PDF_COMPLEXITY','This PDF exceeds the bounded region or source glyph graph limit. Export a simpler resume.');
    if (warnings.length > 1000) throw new FolioError('IMPORT_WARNING_LIMIT', 'This PDF has too many distinct import observations. Export a simpler source before continuing.');
    if(sourceFonts.some(f=>f.format==='truetype'&&(f.sourceVersion===4||f.sourceVersion===5||f.sourceVersion===6||f.sourceVersion===7||f.sourceVersion===8)))for(const state of imageAdmissions)if(state.status==='legacy-catalogue-unclipped-v1'){state.status='unsupported';warnings.push(warning('PDF_IMAGE_PROOF','An original-owned source font cannot borrow the legacy catalogue image representation.','blocking',pages[state.pageNumber-1].id));}
    for(const page of pages)if(page.regions.some(r=>r.kind==='image'&&r.sourcePaint)&&page.regions.some(r=>r.kind==='sourceShape'))warnings.push(warning('PDF_IMAGE_SHAPE_ORDER','Original CFF decoration and image compositing order is outside the current image proof. Import a simpler source before approval.','blocking',page.id));
    const hasV6=sourceFonts.some(f=>f.format==='truetype'&&f.sourceVersion===6),hasScoped=scopedCaptures.length===pages.length&&pages.every((_page,index)=>!!scopedCaptures[index]);
    if(!hasScoped)for(const page of pages){for(const region of page.regions)if('sourceScopedPaint'in region)delete region.sourceScopedPaint;if(hasV6)warnings.push(warning('PDF_SCOPED_PAINT','The original paint, clip and glyph occurrence replay is outside the current source proof. Approval remains unavailable.','blocking',page.id));}
    if(hasScoped){for(let i=0;i<pages.length;i++)imageAdmissions[i]={pageNumber:i+1,status:'none'};for(let i=warnings.length-1;i>=0;i--)if(warnings[i].code==='PDF_COMPLEX_ART'||warnings[i].code==='PDF_IMAGE_PROOF')warnings.splice(i,1);else if(warnings[i].code==='PDF_TEXT_SPACING')warnings[i].message='Custom source spacing is preserved in the PDF. Native editing is available only where current caret positions are verified on this device.';}
    if(sourceFonts.some(f=>f.sourceVersion===8))warnings.push(warning('LICENSED_SUBSET_OCCURRENCES','Original subset glyphs are reproduced from the bundled licensed face. Complete unlinked paragraphs can be removed or rewritten using proved characters when their current source and native layout checks pass. Original formatting remains fixed.','review'));
    const template={...(sourceColorProfile?{sourceColorProfile}:{}),id:newId(),revision:1,pages,warnings,importerVersion:pages.some(p=>p.regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===5))?'folio-import-v28':pages.some(p=>p.regions.some(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint?.version==='source-scoped-occurrence-v4'))?'folio-import-v27':sourceFonts.some(f=>f.sourceVersion===7&&f.namelessDescriptor)?'folio-import-v26':sourceFonts.some(f=>f.sourceVersion===10)?'folio-import-v18':pages.some(p=>p.regions.some(r=>r.kind==='text'&&r.sourceLayout?.version===4))?'folio-import-v17':(scopedCaptures.some(c=>c?.inventory.pageFrame)||pages.some(p=>p.regions.some(r=>'sourceScopedPaint'in r&&r.sourceScopedPaint?.showGroup)))?'folio-import-v16':sourceFonts.some(f=>f.sourceVersion===8)?'folio-import-v15':sourceFonts.some(f=>f.sourceVersion===7)?'folio-import-v14':IMPORTER_VERSION,sourceImageContract:{version:'direct-image-inventory-v1' as const,sourceSha256:source.sha256,pages:imageAdmissions},...(hasScoped?{sourceScopedPages:scopedPages(source.sha256,scopedCaptures as CapturedScopedPage[])}:{}),...(sourceFonts.length?{sourceFonts}:{}),...(sourceLinks.length?{sourceLinks}:{})};const sourceOverlaps=buildSourceOverlapManifest(template);if(sourceOverlaps.length||currentSourceScopedGlyphOverlapKeys(template).size){warnings.push(warning('PDF_SOURCE_OVERLAP','Original source glyph overlaps are retained with exact occurrence-level paint provenance. Any changed glyph, position, face, color or added decoration is checked again.','review'));}
    const sourceRuleOverlaps=buildSourceRuleOverlapManifest(template),pairedRules=new Set(sourceRuleOverlaps.map(p=>p.ruleId));
    for(const page of pages)page.regions=page.regions.map(region=>{if(region.kind!=='rule'||!region.sourcePaint||pairedRules.has(region.id))return region;const copy={...region};delete copy.sourcePaint;return copy;});
    if(sourceRuleOverlaps.length)warnings.push(warning('PDF_SOURCE_RULE_OVERLAP','Some original rules intersect glyph bounds. Their source positions and paint order are preserved; changed content is checked for new collisions.','review'));
    const normalized=normalizeFreshSourceTemplate({...template,...(sourceOverlaps.length?{sourceOverlaps}:{}),...(sourceRuleOverlaps.length?{sourceRuleOverlaps}:{})},source.sha256);
    if(semanticSplitSeen)await validateSourceScopedPaint(bytes,normalized,assets,true,true);
    return {source,assets,template:normalized,baseline:{revision:1,blocks},facts};
  } finally { void loading.destroy().catch(() => {}); }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      void loading.destroy().catch(() => {});
      reject(new FolioError('PDF_TIMEOUT', 'PDF parsing exceeded 15 seconds. Export a simpler PDF.'));
    }, 15000);
  });
  try { return await Promise.race([reconstruct(), deadline]); } finally { clearTimeout(timer); }
}

import {validateSourceRotation} from './source-rotation';
import {loadStandardFont,standardFontKey,StandardFontFaceMetrics} from './standard-fonts';
import {layoutStandardRegion} from './standard-layout';
import {MAX_SOURCE_PAGES} from '../core/model';
import {checkSourceGraphBudget,sourceGlyphs} from '../core/source-graph';
import type { ContentSnapshot, LayoutLine, LayoutResult, LayoutRun, Overflow,
  Rect, Region, Template, TextRegion, TextRun } from '../core/model';
import { safeHref } from '../core/model';
import { FolioError } from '../core/errors';
import { fontKey, loadFont } from './fonts';
import type { FontFaceMetrics, FontKey, CatalogFontKey } from './fonts';
import { loadSourceFont, sourceFontKey, SourceFontFaceMetrics } from './source-fonts';
import {currentSourceOverlapKeys,sourceOverlapKey,currentSourceRuleOverlapKeys,sourceRuleOverlapKey,currentSourceScopedOverlapKeys,sourceTextUnderlay,sourceScopedOverlapKey,currentSourceScopedGlyphOverlapKeys} from './source-overlaps';
import type {SourceGlyphOccurrence} from '../core/model';
import { layoutSourceRegion } from './source-layout';
import { validateSourceLinks } from '../core/source-links';
import {sourceImageVisibleBounds} from '../core/source-images';
import {currentSourceScopedPaint,isSourcePageBackground} from '../core/source-scoped-paint';
import {canonicalJson,hashTextSync} from '../core/model';

const EPSILON = 0.01;
const MAX_TEXT = 100_000;
interface Piece { text: string; bold: boolean; italic: boolean; underline: boolean; href?: string }
interface Token { kind: 'word' | 'space' | 'newline'; pieces: Piece[] }
interface Occupied { regionId: string; kind: Region['kind']; bounds: Rect;sourceOccurrence?:SourceGlyphOccurrence }

export type FontRegistry = Map<FontKey, FontFaceMetrics>;

export async function prepareFonts(template: Template, content: ContentSnapshot): Promise<FontRegistry> {
  const keys = new Set<CatalogFontKey>();
  const sourceFonts = new Map((template.sourceFonts ?? []).map(asset=>[asset.id,asset]));
  const owned: FontRegistry = new Map();
  const blocks = new Map(content.blocks.map(block => [block.id, block]));
  for (const page of template.pages) for (const region of page.regions) {
    if(region.kind==='sourceShape'){const asset=sourceFonts.get(region.sourceFontId);if(!asset)throw new FolioError('SOURCE_FONT_MISSING','A source decoration has no owned font.');owned.set(sourceFontKey(asset.id),loadSourceFont(asset));continue;}
    if (region.kind !== 'text') continue;
    if(region.style.sourceStandardFontId){const asset=template.sourceStandardFonts?.find(a=>a.id===region.style.sourceStandardFontId);if(!asset||!region.sourceStandardLayout)throw new FolioError('PDF_STANDARD_FONT','The standard font or its positioned source line is missing.');owned.set(standardFontKey(asset.id),loadStandardFont(asset));continue;}
    if (region.style.sourceFontId) { const asset=sourceFonts.get(region.style.sourceFontId); if(!asset||!region.sourceLayout)throw new FolioError('SOURCE_FONT_MISSING','A source font or fixed-line graph is missing.'); owned.set(sourceFontKey(asset.id),loadSourceFont(asset)); continue; }
    keys.add(fontKey(region.style));
    for (const run of blocks.get(region.contentId)?.runs ?? []) {
      keys.add(fontKey(region.style, run.bold ?? region.style.fontWeight === 700, run.italic ?? region.style.italic));
    }
  }
  return new Map([...owned, ...await Promise.all([...keys].map(async key => [key, await loadFont(key)] as const))]);
}

export function validateGeometry(template: Template): void {
  checkSourceGraphBudget(template);
  validateSourceLinks(template);
  if((template.sourceFonts?.length??0)>32||(template.sourceFonts??[]).reduce((sum,font)=>sum+font.bytes.length+(font.format==='truetype'?font.originalProgram?.bytes.length??0:0),0)>16*1024*1024)throw new FolioError('SOURCE_FONT_LIMIT','The source font inventory exceeds its bounded program budget.');
  if (!template.pages.length || template.pages.length > MAX_SOURCE_PAGES) {
    throw new FolioError('render-pages', `The local renderer supports up to ${MAX_SOURCE_PAGES} pages.`);
  }
  const ids = new Set<string>();
  let count = 0;
  for (const page of template.pages) {
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) ||
        page.width <= 0 || page.height <= 0 || page.width > 14_400 || page.height > 14_400) {
      throw new FolioError('render-geometry', 'Page dimensions must be finite, positive PDF points within 200 inches.');
    }
    if (ids.has(page.id)) throw new FolioError('render-geometry', 'Page identifiers must be unique.');
    ids.add(page.id);
    for (const region of page.regions) {
      if (++count > 1_000) throw new FolioError('render-limit', 'The template exceeds 1,000 regions.');
      if (ids.has(region.id) || region.pageId !== page.id) {
        throw new FolioError('render-geometry', 'Region identifiers and page bindings must be unique and valid.');
      }
      ids.add(region.id);
      const box = region.bounds;
      if (![box.x, box.y, box.width, box.height, region.order].every(Number.isFinite) ||
          box.width < 0 || box.height < 0 || (region.kind !== 'rule' && (box.width === 0 || box.height === 0))) {
        throw new FolioError('render-geometry', `Region ${region.id} has invalid point geometry.`);
      }
      if (region.kind === 'text') {
        const style = region.style;
        const source=region.sourceLayout;
        const glyphs=source?Array.from(sourceGlyphs(region)):[];
        if(!!style.sourceFontId!==!!source)throw new FolioError('SOURCE_FONT_MISSING','A source font and its fixed-line graph must be present together.');
        if(source?.version===5&&(!(template.importerVersion==='folio-import-v31'&&template.sourceCompositePages?.version==='original-native-composite-v10')&&(template.importerVersion!=='folio-import-v28'||region.sourceScopedPaint?.version!=='source-scoped-occurrence-v5')||source.editPolicy!=='baselineOnly'||source.showSpacing.length!==new Set(glyphs.map(g=>g.operatorIndex)).size||source.showSpacing.some(([op,spacing],i)=>op!==[...new Set(glyphs.map(g=>g.operatorIndex))][i]||!Number.isFinite(spacing)||Math.abs(spacing)>source.fontSize)))throw new FolioError('SOURCE_FONT_GRAPH','Variable source spacing has invalid ownership.');
        if(source && ((source.version!==1&&source.version!==2&&source.version!==3&&source.version!==4&&source.version!==5&&source.version!==6) || source.fontSize!==style.fontSize || ![source.startX,source.endX,source.baseline,source.fontSize].every(Number.isFinite) || !/^[a-f0-9]{64}$/.test(source.sourceSha256) || !/^[a-f0-9]{64}$/.test(source.baselineRunsHash) || !glyphs.length || glyphs.length>100000 || glyphs.some(glyph=>glyph.fontId!==style.sourceFontId||!Number.isInteger(glyph.cid)||glyph.cid<1||glyph.cid>65535||![glyph.x,glyph.advance,glyph.operatorIndex].every(Number.isFinite)||glyph.advance<0)))throw new FolioError('SOURCE_FONT_GRAPH','The source fixed-line graph has invalid geometry or ownership.');

        if(source?.version===6){validateSourceRotation(source.rotation);if(template.importerVersion!=='folio-import-v29'||template.sourceCompositePages?.version!=='original-native-composite-v8'||source.editPolicy!=='baselineOnly'||!Number.isFinite(source.characterSpacing)||Math.abs(source.characterSpacing)>source.fontSize)throw new FolioError('SOURCE_FONT_GRAPH','Invalid rotated source ownership.');}
        if(source?.version===4&&(!Number.isFinite(source.shearX)||source.shearX===0||Math.abs(source.shearX)>1||!Number.isFinite(source.characterSpacing)||Math.abs(source.characterSpacing)>source.fontSize||source.editPolicy!=='baselineOnly'||!region.sourceScopedPaint&&!(template.importerVersion==='folio-import-v23'&&template.sourceCompositePages?.version==='original-native-composite-v5')))throw new FolioError('SOURCE_FONT_GRAPH','The source horizontal shear policy is invalid.');
        if(source?.version===3&&(!Number.isFinite(source.characterSpacing)||!source.characterSpacing||Math.abs(source.characterSpacing)>source.fontSize||source.editPolicy==='scalarCovered'&&glyphs.some(g=>g.advance+source.characterSpacing<=0)||source.editPolicy==='baselineOnly'&&!source.editReason))throw new FolioError('SOURCE_FONT_GRAPH','The source character-spacing policy is invalid.');
        if (!Number.isFinite(style.fontSize) || style.fontSize <= 0 || style.fontSize > 200 ||
            !Number.isFinite(style.lineHeight) || style.lineHeight <= 0 ||
            (style.baselineOffset !== undefined && !Number.isFinite(style.baselineOffset))) {
          throw new FolioError('render-style', `Region ${region.id} has an invalid font size, line height, or baseline.`);
        }
      } else if (region.kind === 'rule' || region.kind === 'rectangle') {
        if (!Number.isFinite(region.thickness) || region.thickness < 0) {
          throw new FolioError('render-style', `Region ${region.id} has an invalid stroke thickness.`);
        }
      }
    }
  }
}

function pieces(region: TextRegion, runs: TextRun[]): Piece[] {
  const result = runs.map(run => ({
    text: run.text.replace(/\r\n?/g, '\n'), bold: run.bold ?? region.style.fontWeight === 700,
    italic: run.italic ?? region.style.italic, underline: run.underline ?? false,
    ...(run.href && safeHref(run.href) ? { href: safeHref(run.href) } : {}),
  }));
  if (region.role === 'bullet' && result.some(piece => piece.text.length) &&
      !/^[•◦▪‣–—\-*]\s/u.test(result.map(piece => piece.text).join(''))) {
    result.unshift({ text: '• ', bold: region.style.fontWeight === 700,
      italic: region.style.italic, underline: false });
  }
  return result;
}

function tokenize(parts: Piece[]): Token[] {
  const tokens: Token[] = [];
  for (const part of parts) {
    for (const text of part.text.match(/\n| +|[^ \n]+/gu) ?? []) {
      const kind = text === '\n' ? 'newline' : /^ +$/.test(text) ? 'space' : 'word';
      const last = tokens.at(-1);
      if (kind !== 'newline' && last?.kind === kind) last.pieces.push({ ...part, text });
      else tokens.push({ kind, pieces: [{ ...part, text }] });
    }
  }
  return tokens;
}

function faceFor(region: TextRegion, piece: Pick<Piece, 'bold' | 'italic'>, fonts: FontRegistry): FontFaceMetrics {
  const face = fonts.get(fontKey(region.style, piece.bold, piece.italic));
  if (!face) throw new FolioError('font-unavailable', `The font variant for region ${region.id} is missing.`);
  return face;
}
function measurePieces(region: TextRegion, parts: Piece[], fonts: FontRegistry): number {
  return lineTextRuns(region, parts, 0, fonts).reduce((sum, run) => sum + run.width, 0);
}

function hangingIndent(region: TextRegion, parts: Piece[], fonts: FontRegistry): number {
  if (region.role !== 'bullet') return 0;
  const match = /^[•◦▪‣–—\-*] +/u.exec(parts.map(piece => piece.text).join(''));
  if (!match) return 0;
  let remaining = match[0].length;
  const prefix: Piece[] = [];
  for (const piece of parts) {
    if (!remaining) break;
    const text = piece.text.slice(0, remaining);
    prefix.push({ ...piece, text }); remaining -= text.length;
  }
  return measurePieces(region, prefix, fonts);
}

function lineTextRuns(region: TextRegion, parts: Piece[], start: number, fonts: FontRegistry): LayoutRun[] {
  const runs: LayoutRun[] = [];
  let x = start;
  for (const piece of parts) {
    const last = runs.at(-1);
    if (last && last.bold === piece.bold && last.italic === piece.italic &&
        last.underline === piece.underline && last.href === piece.href) {
      last.text += piece.text;
      last.width = faceFor(region, piece, fonts).measure(last.text, region.style.fontSize).width;
      x = last.x + last.width;
    } else {
      const width = faceFor(region, piece, fonts).measure(piece.text, region.style.fontSize).width;
      runs.push({ ...piece, x, width }); x += width;
    }
  }
  return runs;
}

function intersects(a: Rect, b: Rect): boolean {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > EPSILON &&
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > EPSILON;
}

function staticInk(region: Region): Rect[] {
  const b = region.bounds;
  if(region.kind==='rectangle'&&region.sourceScopedPaint&&region.fill)return[b];
  if(region.kind==='image'){const visible=sourceImageVisibleBounds(region);return visible?[visible]:[];}
  if(region.kind==='sourceShape') return [b];
  if (region.kind === 'rule') {
    // A rule's bounds describe its centerline endpoints.
    const t = region.thickness / 2;
    return [{ x: b.x - (region.sourceScopedPaint?0:t), y: b.y - t, width: b.width + (region.sourceScopedPaint?0:t * 2), height: b.height + t * 2 }];
  }
  if (region.kind === 'rectangle' && region.stroke && region.thickness > 0) {
    const t = region.thickness;
    return [
      { x: b.x - t / 2, y: b.y - t / 2, width: b.width + t, height: t },
      { x: b.x - t / 2, y: b.y + b.height - t / 2, width: b.width + t, height: t },
      { x: b.x - t / 2, y: b.y, width: t, height: b.height },
      { x: b.x + b.width - t / 2, y: b.y, width: t, height: b.height },
    ];
  }
  return [];
}

/** Canonical lines use absolute top-left page points and include overflowing text. */
export function layoutDocument(template: Template, content: ContentSnapshot, fonts: FontRegistry,currentGeometry?:ReadonlyMap<string,import('./source-layout').SourceCurrentGeometry>): LayoutResult {
  validateGeometry(template);
  if (content.blocks.reduce((n, block) => n + block.runs.reduce((m, run) => m + run.text.length, 0), 0) > MAX_TEXT) {
    throw new FolioError('render-limit', 'Document content exceeds 100,000 characters.');
  }
  const originalOverlapKeys=currentSourceOverlapKeys(template);
  const originalRuleOverlapKeys=currentSourceRuleOverlapKeys(template);
  const originalScopedOverlapKeys=currentSourceScopedOverlapKeys(template);
  const originalScopedGlyphKeys=currentSourceScopedGlyphOverlapKeys(template);
  const unchangedScopedText=new Set(template.pages.flatMap(page=>page.regions.flatMap(region=>region.kind==='text'&&region.sourceLayout&&region.sourceScopedPaint&&hashTextSync(canonicalJson(content.blocks.find(block=>block.id===region.contentId)?.runs??[]))===region.sourceLayout.baselineRunsHash?[region.id]:[])));
  const scopedPair=(glyph:SourceGlyphOccurrence|undefined,primitiveId:string)=>!!glyph&&unchangedScopedText.has(glyph.regionId)&&originalScopedOverlapKeys.has(sourceScopedOverlapKey(glyph,primitiveId));
  const scopedGlyphPair=(a:SourceGlyphOccurrence|undefined,b:SourceGlyphOccurrence|undefined)=>!!a&&!!b&&unchangedScopedText.has(a.regionId)&&unchangedScopedText.has(b.regionId)&&originalScopedGlyphKeys.has(sourceOverlapKey(a,b));
  const underlays=new Map<string,Rect|undefined>();
  const underlayAllows=(textId:string,primitiveId:string,box:Rect)=>{const key=JSON.stringify([textId,primitiveId]);if(!underlays.has(key))underlays.set(key,sourceTextUnderlay(template,textId,primitiveId));const b=underlays.get(key);return !!b&&box.x>=b.x&&box.y>=b.y&&box.x+box.width<=b.x+b.width&&box.y+box.height<=b.y+b.height;};
  const blocks = new Map(content.blocks.map(block => [block.id, block]));
  if (blocks.size !== content.blocks.length) throw new FolioError('render-content', 'Content identifiers must be unique.');
  const result: LayoutResult = { regions: [], overflows: [] };
  const report = (region: Region, code: Overflow['code'], message: string, required?: number, available?: number) => {
    result.overflows.push({ pageId: region.pageId, regionId: region.id, code, message,
      ...(required !== undefined ? { required } : {}), ...(available !== undefined ? { available } : {}) });
  };
  for (const page of template.pages) {
    const occupied: Occupied[] = [];
    for (const region of [...page.regions].sort((a, b) => a.order - b.order)) {
      const b = region.bounds;
      const scoped=currentSourceScopedPaint(region,template);
      let ink: Rect[] = staticInk(region),inkOccurrences:(SourceGlyphOccurrence|undefined)[]=[];
      if (!scoped&&(b.x < -EPSILON || b.y < -EPSILON || b.x + b.width > page.width + EPSILON || b.y + b.height > page.height + EPSILON)) {
        report(region, 'page', `Region extends beyond the ${page.width.toFixed(2)} × ${page.height.toFixed(2)} pt page.`);
      }
      if (region.kind !== 'text') {
        result.regions.push({ regionId: region.id, pageId: page.id, bounds: { ...b }, lines: [] });
      } else if(region.style.sourceStandardFontId&&region.sourceStandardLayout){const face=fonts.get(standardFontKey(region.style.sourceStandardFontId));if(!(face instanceof StandardFontFaceMetrics))throw new FolioError('PDF_STANDARD_FONT','The original standard metrics are unavailable.');const positioned=layoutStandardRegion(region,blocks.get(region.contentId),face);for(const issue of positioned.issues)report(region,issue.code,issue.message,issue.required,issue.available);ink=positioned.ink;result.regions.push({regionId:region.id,pageId:page.id,bounds:{...b},lines:[positioned.line]});
      } else if (region.style.sourceFontId && region.sourceLayout) {
        const face=fonts.get(sourceFontKey(region.style.sourceFontId));
        if(!(face instanceof SourceFontFaceMetrics))throw new FolioError('SOURCE_FONT_MISSING','A verified source font is unavailable.');
        const positioned=layoutSourceRegion(region,blocks.get(region.contentId),face,currentGeometry?.get(region.id));
        for(const issue of positioned.issues) report(region,issue.code,issue.message,issue.required,issue.available);
        ink=positioned.ink;inkOccurrences=positioned.inkOccurrences;
        const unchangedNativeShear=template.importerVersion==='folio-import-v23'&&template.sourceCompositePages?.version==='original-native-composite-v5'&&region.sourceLayout.version===4&&hashTextSync(canonicalJson(blocks.get(region.contentId)?.runs??[]))===region.sourceLayout.baselineRunsHash;
        // Project-bound V5 capture rederives the complete original shear graph.
        // Unchanged baseline-only glyphs may retain their original ink overlap.
        if((region.sourceLayout.version===3||region.sourceLayout.version===4)&&!unchangedNativeShear){let internal=false,comparisons=0;const sorted=ink.map((bounds,index)=>({bounds,index})).sort((a,b)=>a.bounds.x-b.bounds.x);let active:typeof sorted=[];for(const current of sorted){active=active.filter(r=>r.bounds.x+r.bounds.width>current.bounds.x+EPSILON);for(const previous of active){if(++comparisons>2_000_000)throw new FolioError('SOURCE_OVERLAP_LIMIT','Current source-span collision checks exceed the bounded comparison budget.');const i=current.index,j=previous.index;if(intersects(current.bounds,previous.bounds)&&!(inkOccurrences[i]&&inkOccurrences[j]&&originalOverlapKeys.has(sourceOverlapKey(inkOccurrences[i]!,inkOccurrences[j]!)))&&!scopedGlyphPair(inkOccurrences[i],inkOccurrences[j]))internal=true;}active.push(current);}if(internal)report(region,'collision','Changed source glyphs overlap within this fixed character-spaced span. Shorten or revise its wording.');}
        result.regions.push({regionId:region.id,pageId:page.id,bounds:{...b},lines:[positioned.line]});
      } else {
        const block = blocks.get(region.contentId);
        if (!block) report(region, 'asset', `The bound text block ${region.contentId} is missing.`);
        const parts = pieces(region, block?.runs ?? []);
        for (const piece of parts) {
          const unsupported = faceFor(region, piece, fonts).unsupportedCharacters(piece.text);
          if (unsupported.length) report(region, 'glyph', `Unsupported glyph or script: ${unsupported.map(c =>
            `${JSON.stringify(c)} (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`).join(', ')}. Choose supported text or repair the template.`);
        }
        const indent = hangingIndent(region, parts, fonts);
        const base = fonts.get(fontKey(region.style))!;
        const firstBaseline = region.style.baselineOffset ??
          (region.style.lineHeight + base.ascent(region.style.fontSize) - base.descent(region.style.fontSize)) / 2;
        const lines: LayoutLine[] = [];
        let current: Piece[] = [], currentWidth = 0;
        let lineIndex = 0, lineIndent = 0;
        const emitLine = () => {
          const available = b.width - lineIndent;
          let offset = 0;
          if (region.style.alignment === 'center') offset = (available - currentWidth) / 2;
          if (region.style.alignment === 'right') offset = available - currentWidth;
          const runs = lineTextRuns(region, current, b.x + lineIndent + offset, fonts);
          lines.push({ baseline: b.y + firstBaseline + lineIndex * region.style.lineHeight,
            runs, width: currentWidth });
          current = []; currentWidth = 0; lineIndex++; lineIndent = indent;
        };
        const tokens = tokenize(parts);
        for (const token of tokens) {
          if (token.kind === 'newline') { emitLine(); continue; }
          const width = measurePieces(region, token.pieces, fonts);
          if (token.kind === 'word' && current.some(piece => /[^ ]/.test(piece.text)) &&
              measurePieces(region, [...current, ...token.pieces], fonts) > b.width - lineIndent + EPSILON) emitLine();
          current.push(...token.pieces); currentWidth = region.style.fontFamily === 'times' ? measurePieces(region, current, fonts) : currentWidth + width;
        }
        if (current.length || tokens.at(-1)?.kind === 'newline') emitLine();
        ink = [];
        let minX = b.x, maxX = b.x, minY = b.y, maxY = b.y;
        let maxLogicalWidth = 0;
        let internalCollision = false;
        for (const [index, line] of lines.entries()) {
          const lineInk: Rect[] = [];
          let trailing = true, visibleWidth = line.width;
          for (let r = line.runs.length - 1; r >= 0 && trailing; r--) {
            const run = line.runs[r];
            const trimmed = run.text.replace(/ +$/, '');
            visibleWidth -= run.width - faceFor(region, run, fonts).measure(trimmed, region.style.fontSize).width;
            trailing = !trimmed.length;
          }
          maxLogicalWidth = Math.max(maxLogicalWidth, visibleWidth + (index > 0 ? indent : 0));
          if (line.runs.every(run => /^ *$/.test(run.text))) {
            maxY = Math.max(maxY, line.baseline + base.descent(region.style.fontSize));
          }
          for (const run of line.runs) {
            const face = faceFor(region, run, fonts);
            const metrics = face.measure(run.text, region.style.fontSize);
            if (/[^ ]/.test(run.text)) {
              const rect = { x: run.x + metrics.left, y: line.baseline + metrics.top,
                width: metrics.right - metrics.left, height: metrics.bottom - metrics.top };
              if (run.underline) {
                rect.height = Math.max(rect.height, line.baseline + face.underlineOffset(region.style.fontSize) +
                  face.underlineThickness(region.style.fontSize) / 2 - rect.y);
              }
              lineInk.push(rect);
              minX = Math.min(minX, rect.x); maxX = Math.max(maxX, rect.x + rect.width);
              minY = Math.min(minY, rect.y); maxY = Math.max(maxY, rect.y + rect.height);
            }
          }
          if (lineInk.some(rect => ink.some(previous => intersects(rect, previous)))) internalCollision = true;
          ink.push(...lineInk);
        }
        if (internalCollision) report(region, 'collision', 'Text lines overlap within this region. Increase the approved line height or repair its content.');
        // A text box starts at the font's advance origin. Ordinary J/italic
        // glyphs can have negative left bearings without changing that origin
        // or wrapping width. Their actual ink is still checked against the
        // page and every neighboring region below; it is never clipped.
        const neededWidth = Math.max(maxLogicalWidth, maxX - b.x);
        if (neededWidth > b.width + EPSILON) {
          report(region, 'width', `Text needs ${neededWidth.toFixed(2)} pt of width; region has ${b.width.toFixed(2)} pt. An unbroken word or glyph extends outside the region.`, neededWidth, b.width);
        }
        const neededHeight = maxY - Math.min(b.y, minY);
        if (maxY > b.y + b.height + EPSILON || minY < b.y - EPSILON) {
          const first = lines.findIndex(line => line.baseline + base.descent(region.style.fontSize) > b.y + b.height);
          report(region, 'height', `Text needs ${neededHeight.toFixed(2)} pt of height; region has ${b.height.toFixed(2)} pt${first >= 0 ? ` (line ${first + 1} is the first outside the boundary)` : ''}.`, neededHeight, b.height);
        }
        result.regions.push({ regionId: region.id, pageId: page.id, bounds: { ...b }, lines });
      }
      if(scoped){const clip=scoped.effectiveClip,contains=(box:Rect)=>box.x>=clip.x&&box.y>=clip.y&&box.x+box.width<=clip.x+clip.width&&box.y+box.height<=clip.y+clip.height;
        if(region.kind==='text'&&region.sourceLayout&&hashTextSync(canonicalJson(blocks.get(region.contentId)?.runs??[]))!==region.sourceLayout.baselineRunsHash&&ink.some(box=>!contains(box)))report(region,'glyph','Edited glyph ink crosses the retained original clip. Use Undo or choose text that fits the original visible area.');
        const visible=ink.map((box,index)=>{const x=Math.max(box.x,clip.x),y=Math.max(box.y,clip.y);return{bounds:{x,y,width:Math.max(0,Math.min(box.x+box.width,clip.x+clip.width)-x),height:Math.max(0,Math.min(box.y+box.height,clip.y+clip.height)-y)},occurrence:inkOccurrences[index]};}).filter(({bounds})=>bounds.width>0&&bounds.height>0);ink=visible.map(v=>v.bounds);inkOccurrences=visible.map(v=>v.occurrence);
      }
      if (ink.some(rect => rect.x < -EPSILON || rect.y < -EPSILON ||
          rect.x + rect.width > page.width + EPSILON || rect.y + rect.height > page.height + EPSILON) &&
          !result.overflows.some(o => o.regionId === region.id && o.code === 'page')) {
        report(region, 'page', 'Rendered text, image, or stroke extends beyond the page boundary.');
      }
      const collided = new Set<string>();
      // Fixed artwork may intentionally share edges (table cells, frames, or
      // layered decoration). Only editable text must avoid reserved ink. Check
      // both orders so a later photo/rule still blocks text crossing it.
      for (const previous of occupied) if ((region.kind === 'text' || previous.kind === 'text') && ink.some((rect,index) => intersects(rect, previous.bounds)&&!(region.kind==='text'&&!unchangedScopedText.has(region.id)&&previous.kind==='rectangle'&&underlayAllows(region.id,previous.regionId,rect))&&!(inkOccurrences[index]&&previous.sourceOccurrence&&originalOverlapKeys.has(sourceOverlapKey(inkOccurrences[index]!,previous.sourceOccurrence)))&&!scopedGlyphPair(inkOccurrences[index],previous.sourceOccurrence)&&!(region.kind==='rule'&&previous.sourceOccurrence&&originalRuleOverlapKeys.has(sourceRuleOverlapKey(previous.sourceOccurrence,region.id)))&&!(previous.kind==='rule'&&inkOccurrences[index]&&originalRuleOverlapKeys.has(sourceRuleOverlapKey(inkOccurrences[index]!,previous.regionId)))&&!scopedPair(previous.sourceOccurrence,region.id)&&!scopedPair(inkOccurrences[index],previous.regionId))) collided.add(previous.regionId);
      for (const id of collided) report(region, 'collision', `Rendered content overlaps reserved region ${id}. Repair the region bounds or shorten the text.`);
      if(!isSourcePageBackground(region,template))occupied.push(...ink.map((bounds,index) => ({ regionId: region.id, kind: region.kind, bounds,...(inkOccurrences[index]?{sourceOccurrence:inkOccurrences[index]}:{}) })));
    }
  }
  return result;
}

export async function computeLayout(template: Template, content: ContentSnapshot): Promise<LayoutResult> {
  validateGeometry(template);
  return layoutDocument(template, content, await prepareFonts(template, content));
}

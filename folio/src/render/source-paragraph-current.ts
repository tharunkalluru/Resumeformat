import {FolioError} from '../core/errors';
import {blockText, canonicalJson, hasValidApproval, type ContentSnapshot, type LayoutLine, type Project, type SourceFontAsset, type SourcePositionedGlyph} from '../core/model';
import {sourceParagraphGroups, type SourceParagraphGroup} from '../core/source-paragraphs';
import {loadSourceFont} from '../layout/source-fonts';
import type {SourceCurrentGeometry} from '../layout/source-layout';
import type {VerifiedScopedReplay, VerifiedRegionDecomposition} from '../import/pdf-scoped-source';
import {pdfDecimal} from './pdf-decimal';

export interface GeneratedParagraphLine extends SourceCurrentGeometry {
  readonly kind: 'generated-source-paragraph-v1'; readonly fontId: string;
  readonly regionId: string; readonly ctm: readonly number[]; readonly textMatrix: readonly number[];
  readonly nominalFontSize: number; readonly characterSpacing: 0;
  readonly contentText: string; readonly programSha256: string;
}
export interface CompiledSourceParagraph {
  group: SourceParagraphGroup; lines: GeneratedParagraphLine[]; layoutLines: LayoutLine[];
  witness: VerifiedRegionDecomposition;
}
const minted = new WeakSet<object>();
function fail(): never {throw new FolioError('SOURCE_PARAGRAPH_PROOF', 'This bullet needs complete original owners, unchanged style, covered characters and a reviewed layout.');}

export function assertParagraphLine(plan: GeneratedParagraphLine, asset: SourceFontAsset, glyphs: readonly SourcePositionedGlyph[]): void {
  if (!minted.has(plan) || asset.format !== 'truetype' || ![4, 5, 6].includes(asset.sourceVersion ?? 0) ||
      asset.id !== plan.fontId || asset.originalProgram?.sha256 !== plan.programSha256 || canonicalJson(plan.glyphs) !== canonicalJson(glyphs)) fail();
}

/** Invoked only after project rendering independently recaptures the original. */
export function compileSourceParagraphs(project: Project, content: ContentSnapshot, replay: VerifiedScopedReplay) {
  const plans = new Map<string, CompiledSourceParagraph>(), suppressed = new Set<string>();
  const restorations = new Map<string, ContentSnapshot['blocks'][number]>();
  if (project.baseline.blocks.some(b => b.sourceParagraphGroupId)) fail();
  const edited = content.blocks.filter(b => b.sourceParagraphGroupId);
  if (!edited.length) return {plans, suppressed, restorations};
  if (!hasValidApproval(project) || !replay.atomicPages) fail();
  const groups = sourceParagraphGroups(project), used = new Set<string>();
  for (const block of edited) {
    const group = groups.find(g => g.id === block.sourceParagraphGroupId && g.contentIds[0] === block.id);
    if (!group || used.has(group.id)) fail(); used.add(group.id);
    const font = project.template.sourceFonts!.find(f => f.id === group.fontId)!;
    if (font.format !== 'truetype' || !font.originalProgram) fail();
    const face = loadSourceFont(font), text = blockText(block);
    if (block.runs.length !== 1 || /[\r\n\t]/.test(text) || text.length > 10000 || face.unsupportedCharacters(text).length) fail();
    const validIds = (ids: readonly string[]) => canonicalJson(ids) === canonicalJson(group.sourceFactIds) ||
      ids.length === 1 && project.facts.some(f => f.id === ids[0] && f.kind === 'applicantEdit' && f.confirmed && f.text === text);
    if (!validIds(block.sourceFactIds) || !validIds(block.runs[0].sourceFactIds ?? block.sourceFactIds)) fail();
    const marks = (runs: typeof block.runs) => runs.map(({text: _text, sourceFactIds: _ids, ...style}) => style);
    let witness: VerifiedRegionDecomposition | undefined;
    for (const [index, regionId] of group.memberIds.entries()) {
      const original = project.baseline.blocks.find(b => b.id === group.contentIds[index])!, current = content.blocks.find(b => b.id === original.id);
      const region = project.template.pages.flatMap(p => p.regions).find(r => r.id === regionId), w = replay.get(regionId);
      if (!current || !region || region.kind !== 'text' || canonicalJson(marks(current.runs)) !== canonicalJson(marks(original.runs)) ||
          index > 0 && (blockText(current) !== '' || current.sourceParagraphGroupId) || !w?.wholeShow || w.atomicLeader !== regionId ||
          [...replay.values()].filter(v => v.atomicLeader === regionId).length !== 1 || w.fontId !== font.id || w.programSha256 !== font.originalProgram.sha256 ||
          w.sourceSha256 !== project.source.sha256 || w.wholeShow.characterSpacing !== 0 ||
          canonicalJson(w.decomposition.ctm) !== canonicalJson([1, 0, 0, 1, 0, 0]) ||
          canonicalJson(w.wholeShow.fullTextMatrix.slice(0, 4)) !== canonicalJson([1, 0, 0, 1]) || w.decomposition.nominalFontSize !== group.fontSize ||
          w.atomicGroupGlyphs?.some(g => g.inferredGap)) fail();
      if (index === 0) witness = w;
      suppressed.add(regionId); restorations.set(original.id, original);
    }
    const page = project.template.pages.find(p => p.id === group.pageId)!;
    const strings: string[] = []; let line = '';
    // Retain the break-space in the preceding show: canonical text remains exact.
    for (const token of text.match(/\S+\s*|\s+/g) ?? []) {
      const word = token.trimEnd();
      if (line && face.measure(line + word, group.fontSize).width > group.frame.width) {strings.push(line); line = '';}
      line += token;
    }
    if (line || !strings.length) strings.push(line);
    const step = group.baselines.length > 1 ? group.baselines[1] - group.baselines[0] : group.fontSize * 1.3;
    const lines = strings.map((contentText, index): GeneratedParagraphLine => {
      const baseline = group.baselines[index] ?? group.baselines[0] + index * step; let x = group.frame.x;
      const glyphs = Array.from(contentText).map(character => {
        const map = face.mapping(character); if (!map) return fail();
        const advance = map.pdfWidth * group.fontSize / 1000;
        const glyph = Object.freeze({fontId: font.id, cid: map.cid, unicode: character, x, advance, operatorIndex: witness!.decomposition.operatorIndex}); x += advance; return glyph;
      });
      const textMatrix = [1, 0, 0, 1, group.frame.x, page.height - baseline];
      [...textMatrix, baseline, group.fontSize, ...glyphs.flatMap(g => [g.x, g.advance])].forEach(pdfDecimal);
      const plan: GeneratedParagraphLine = Object.freeze({kind: 'generated-source-paragraph-v1', fontId: font.id, regionId: group.leaderId, ctm: Object.freeze([1, 0, 0, 1, 0, 0]), textMatrix: Object.freeze(textMatrix), nominalFontSize: group.fontSize, characterSpacing: 0, contentText, programSha256: font.originalProgram!.sha256, glyphs: Object.freeze(glyphs), baseline, fontSize: group.fontSize});
      minted.add(plan); return plan;
    });
    const style = project.template.pages.flatMap(p => p.regions).find(r => r.id === group.leaderId)!;
    if (style.kind !== 'text') fail();
    const layoutLines: LayoutLine[] = lines.map(l => ({baseline: l.baseline, width: face.measure(l.contentText, group.fontSize).width, runs: [{text: l.contentText, x: group.frame.x, width: face.measure(l.contentText, group.fontSize).width, bold: style.style.fontWeight === 700, italic: style.style.italic, underline: false, sourceFontId: font.id, sourceGlyphs: [...l.glyphs]}]}));
    plans.set(group.leaderId, {group, lines, layoutLines, witness: witness!});
  }
  return {plans, suppressed, restorations};
}

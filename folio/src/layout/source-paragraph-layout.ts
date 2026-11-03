import type {LayoutResult, Rect, Template} from '../core/model';
import type {CompiledSourceParagraph} from '../render/source-paragraph-current';
import {loadSourceFont} from './source-fonts';
import {sourceImageVisibleBounds} from '../core/source-images';

const intersects = (a: Rect, b: Rect) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > .01 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > .01;

/** Current semantic geometry replaces its owners without altering the source template. */
export function applySourceParagraphLayout(template: Template, layout: LayoutResult, plans: ReadonlyMap<string, CompiledSourceParagraph>): LayoutResult {
  if (!plans.size) return layout;
  const regions = layout.regions.map(r => ({...r, lines: [...r.lines]})), overflows = [...layout.overflows];
  for (const [leaderId, plan] of plans) {
    const members = new Set(plan.group.memberIds), leader = regions.find(r => r.regionId === leaderId)!;
    leader.bounds = {...plan.group.frame}; leader.lines = plan.layoutLines;
    for (const region of regions) if (members.has(region.regionId) && region.regionId !== leaderId) region.lines = [];
  }
  for (const [leaderId, plan] of plans) {
    const members = new Set(plan.group.memberIds);
    const report = (code: 'width' | 'height' | 'collision', message: string, required?: number, available?: number) => overflows.push({pageId: plan.group.pageId, regionId: leaderId, code, message, ...(required !== undefined ? {required} : {}), ...(available !== undefined ? {available} : {})});
    if (plan.lines.length > plan.group.baselines.length) report('height', 'This bullet needs more lines than the original layout provides.', plan.lines.length, plan.group.baselines.length);
    if (plan.layoutLines.some(l => l.width > plan.group.frame.width + .01)) report('width', 'A word or line exceeds the original bullet width. Shorten the wording.');
    const asset = template.sourceFonts!.find(a => a.id === plan.group.fontId)!, face = loadSourceFont(asset);
    const ink = plan.lines.flatMap(line => line.glyphs.flatMap(glyph => {
      const map = face.mapping(glyph.unicode)!; if (map.nonPainting) return [];
      const box = face.font.getGlyph(map.glyphId).bbox, scale = plan.group.fontSize / face.font.unitsPerEm;
      return [{x: glyph.x + box.minX * scale, y: line.baseline - box.maxY * scale, width: box.width * scale, height: box.height * scale}];
    }));
    const frame = plan.group.frame;
    if (ink.some(b => b.y < frame.y - .01 || b.y + b.height > frame.y + frame.height + .01)) report('height', 'The edited bullet extends beyond its original vertical space.');
    if (ink.some(b => b.x < frame.x - .01 || b.x + b.width > frame.x + frame.width + .01)) report('width', 'The edited bullet extends beyond its original horizontal space.');
    const others: Rect[] = [];
    for (const region of template.pages.find(p => p.id === plan.group.pageId)!.regions) {
      if (members.has(region.id)) continue;
      const positioned = regions.find(r => r.regionId === region.id);
      if (region.kind === 'text') {
        for (const line of positioned?.lines ?? []) for (const run of line.runs) {
          const font = template.sourceFonts?.find(f => f.id === run.sourceFontId);
          if (!font || !run.sourceGlyphs) {others.push({...positioned!.bounds}); continue;}
          const metrics = loadSourceFont(font), scale = region.style.fontSize / metrics.font.unitsPerEm;
          for (const glyph of run.sourceGlyphs) {
            const map = font.glyphMap.find(m => m.cid === glyph.cid); if (!map || map.nonPainting) continue;
            const box = metrics.font.getGlyph(map.glyphId).bbox;
            others.push({x: glyph.x + box.minX * scale, y: line.baseline - box.maxY * scale, width: box.width * scale, height: box.height * scale});
          }
        }
      } else if (region.kind === 'rule' && region.thickness > 0) others.push({x: region.bounds.x, y: region.bounds.y - region.thickness / 2, width: region.bounds.width, height: Math.max(region.thickness, region.bounds.height)});
      else if (region.kind === 'image') others.push(sourceImageVisibleBounds(region) ?? region.bounds);
      else if (region.kind === 'rectangle' && (region.fill || region.stroke) || region.kind === 'sourceShape') others.push(region.bounds);
    }
    if (ink.some(a => others.some(b => intersects(a, b)))) report('collision', 'The edited bullet overlaps neighboring resume content. Shorten the wording.');
  }
  return {...layout, regions, overflows};
}

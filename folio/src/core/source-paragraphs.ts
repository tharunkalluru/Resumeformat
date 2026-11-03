import {blockText, canonicalJson, hashTextSync, hasPermittedOriginalTrueType, type Project, type Rect, type TextRegion} from './model';
import {sourceGlyphs} from './source-graph';

/** Semantic ownership is separate from the immutable original paint owners. */
export interface SourceParagraphGroup {
  id: string; pageId: string; leaderId: string; markerId: string;
  memberIds: string[]; contentIds: string[]; sourceFactIds: string[];
  fontId: string; fontSize: number; frame: Rect; baselines: number[];
  baselineText: string;
}

export function sourceParagraphGroups(project: Pick<Project, 'template' | 'baseline' | 'source'>): SourceParagraphGroup[] {
  if (!hasPermittedOriginalTrueType(project.template)) return [];
  const blocks = new Map(project.baseline.blocks.map(block => [block.id, block]));
  const groups: SourceParagraphGroup[] = [];
  const value = (region: TextRegion) => blockText(blocks.get(region.contentId)!);
  const eligible = (region: TextRegion) => {
    const block = blocks.get(region.contentId), font = project.template.sourceFonts?.find(f => f.id === region.style.sourceFontId);
    return !!block && !!font && font.format === 'truetype' && [4, 5, 6].includes(font.sourceVersion ?? 0) &&
      !!font.originalProgram && region.role === 'body' && region.sourceLayout?.version === 1 &&
      region.sourceLayout.anchor === 'start' && region.style.alignment === 'left' && block.runs.length === 1 &&
      !block.runs[0].href && !block.runs[0].underline && !project.template.sourceLinks?.some(link => link.bindings.some(b => b.regionId === region.id)) &&
      !Array.from(sourceGlyphs(region)).some(g => g.inferredGap);
  };
  for (const [pageIndex, page] of project.template.pages.entries()) {
    const rows = new Map<number, TextRegion[]>();
    for (const region of page.regions) if (region.kind === 'text' && region.sourceLayout && blocks.has(region.contentId)) {
      const row = rows.get(region.sourceLayout.baseline) ?? []; row.push(region); rows.set(region.sourceLayout.baseline, row);
    }
    const sorted = [...rows].sort(([a], [b]) => a - b).map(([baseline, regions]) => ({baseline, regions: regions.sort((a, b) => a.sourceLayout!.startX - b.sourceLayout!.startX)}));
    for (let rowIndex = 0; rowIndex < sorted.length; rowIndex++) {
      const row = sorted[rowIndex], markers = row.regions.filter(r => /^[•◦▪]$/.test(value(r)));
      // Mixed columns, style changes and ambiguous continuations remain separate.
      if (markers.length !== 1 || !eligible(markers[0])) continue;
      const marker = markers[0], first = row.regions.find(r => r.sourceLayout!.startX > marker.sourceLayout!.endX && value(r).trim());
      if (!first || !eligible(first)) continue;
      const same = (r: TextRegion) => eligible(r) && canonicalJson(r.style) === canonicalJson(first.style) &&
        canonicalJson(r.sourceScopedPaint?.clipStack) === canonicalJson(first.sourceScopedPaint?.clipStack) &&
        canonicalJson(r.sourceScopedPaint?.effectiveClip) === canonicalJson(first.sourceScopedPaint?.effectiveClip);
      const firstMembers = row.regions.filter(r => r.sourceLayout!.startX >= first.sourceLayout!.startX);
      if (!firstMembers.length || !firstMembers.every(same)) continue;
      const lines = [firstMembers], baselines = [row.baseline];
      for (let next = rowIndex + 1; next < sorted.length; next++) {
        const candidate = sorted[next], delta = candidate.baseline - baselines.at(-1)!;
        if (delta <= 0 || delta > first.style.fontSize * 1.6 || candidate.regions.some(r => /^[•◦▪]$/.test(value(r))) ||
            candidate.regions[0]?.sourceLayout?.startX !== first.sourceLayout!.startX || !candidate.regions.every(same)) break;
        lines.push(candidate.regions); baselines.push(candidate.baseline);
        if (lines.length >= 8) break;
      }
      const members = lines.flat();
      if (members.length < 3 || members.length > 100 || members.some((r, i) => i > 0 && r.order <= members[i - 1].order)) continue;
      if (page.regions.some(r => !members.includes(r as TextRegion) && r.order >= members[0].order && r.order <= members.at(-1)!.order)) continue;
      const texts: string[] = []; let ambiguous = false;
      for (const line of lines) {
        let text = '';
        for (const [index, r] of line.entries()) {
          const previous = line[index - 1], gap = previous ? r.sourceLayout!.startX - previous.sourceLayout!.endX : 0;
          if (gap > first.style.fontSize) { ambiguous = true; break; }
          if (previous && gap > 0 && !/\s$/.test(text) && !/^\s/.test(value(r))) text += ' ';
          text += value(r);
        }
        texts.push(text.trim());
      }
      if (ambiguous) continue;
      const sourceFactIds = [...new Set(members.flatMap(r => blocks.get(r.contentId)!.sourceFactIds))];
      if (sourceFactIds.length > 100) continue;
      const x = first.sourceLayout!.startX, right = Math.max(...members.map(r => Math.max(r.sourceLayout!.endX, r.bounds.x + r.bounds.width)));
      const y = Math.min(...members.map(r => r.bounds.y)), bottom = Math.max(...members.map(r => r.bounds.y + r.bounds.height));
      const font = project.template.sourceFonts!.find(f => f.id === first.style.sourceFontId)!;
      if (font.format !== 'truetype' || !font.originalProgram) continue;
      const id = `paragraph:${hashTextSync(canonicalJson([project.source.sha256, pageIndex, marker.order, members.map(r => r.order), font.originalProgram!.sha256]))}`;
      groups.push({id, pageId: page.id, leaderId: first.id, markerId: marker.id, memberIds: members.map(r => r.id), contentIds: members.map(r => r.contentId), sourceFactIds, fontId: font.id, fontSize: first.style.fontSize, frame: {x, y, width: right - x, height: bottom - y}, baselines, baselineText: texts.join(' ')});
    }
  }
  return groups;
}

export function activeSourceParagraphs(project: Project, content = project.draft): SourceParagraphGroup[] {
  const ids = new Set(content.blocks.flatMap(b => b.sourceParagraphGroupId ? [b.sourceParagraphGroupId] : []));
  return sourceParagraphGroups(project).filter(group => ids.has(group.id));
}

/** Reflect earlier fixed-slot edits before the applicant switches to complete wording. */
export function sourceParagraphText(project:Project,group:SourceParagraphGroup,content=project.draft):string {
  const blocks=new Map(content.blocks.map(b=>[b.id,b]));
  const leader=blocks.get(group.contentIds[0]);
  if(leader?.sourceParagraphGroupId===group.id)return blockText(leader);
  const regions=group.memberIds.map(id=>project.template.pages.flatMap(p=>p.regions).find((r):r is TextRegion=>r.kind==='text'&&r.id===id)!);
  return group.baselines.map(baseline=>{
    let text='',previous:TextRegion|undefined;
    for(const region of regions.filter(r=>r.sourceLayout!.baseline===baseline)){
      const block=blocks.get(region.contentId),value=block?blockText(block):'';
      if(previous&&region.sourceLayout!.startX>previous.sourceLayout!.endX&&!/\s$/.test(text)&&!/^\s/.test(value))text+=' ';
      text+=value;previous=region;
    }
    return text.trim();
  }).join(' ');
}

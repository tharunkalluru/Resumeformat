import { blockText, type FolioVersion, type Project, type TextRegion } from '../core/model';

export interface WordDifference { kind: 'same' | 'removed' | 'added'; text: string }
export interface PassageDifference { id: string; label: string; page: number | null; before: string; after: string; wording: WordDifference[]; formattingOnly: boolean }
const tokens = (text: string) => text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu) ?? [];
/** Presentation only. Every character stays on its original side; this never edits content. */
export function diffWords(before: string, after: string): WordDifference[] {
  const a = tokens(before), b = tokens(after), result: WordDifference[] = [];
  function append(kind: WordDifference['kind'], text: string) {
    if (!text) return;
    const last = result.at(-1);
    if (last?.kind === kind) last.text += text; else result.push({ kind, text });
  }
  // Large passages use a bounded common-prefix/suffix comparison, avoiding a
  // quadratic allocation while still showing every changed character honestly.
  if ((a.length + 1) * (b.length + 1) > 400_000) {
    let start = 0, endA = a.length, endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) start++;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
    append('same', a.slice(0, start).join('')); append('removed', a.slice(start, endA).join(''));
    append('added', b.slice(start, endB).join('')); append('same', a.slice(endA).join(''));
    return result;
  }
  const width = b.length + 1, matrix = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    matrix[i * width + j] = a[i] === b[j] ? matrix[(i + 1) * width + j + 1] + 1 : Math.max(matrix[(i + 1) * width + j], matrix[i * width + j + 1]);
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { append('same', a[i++]); j++; }
    else if (i < a.length && (j === b.length || matrix[(i + 1) * width + j] >= matrix[i * width + j + 1])) append('removed', a[i++]);
    else append('added', b[j++]);
  }
  return result;
}

export function versionDifferences(project: Project, version: FolioVersion): PassageDifference[] {
  const current = new Map(project.draft.blocks.map(block => [block.id, block]));
  const saved = new Map(version.content.blocks.map(block => [block.id, block]));
  return [...new Set([...saved.keys(), ...current.keys()])].flatMap(id => {
    const beforeBlock = saved.get(id), afterBlock = current.get(id);
    if (JSON.stringify(beforeBlock?.runs) === JSON.stringify(afterBlock?.runs)) return [];
    const before = beforeBlock ? blockText(beforeBlock) : '', after = afterBlock ? blockText(afterBlock) : '';
    const index = project.template.pages.findIndex(page => page.regions.some(region => region.kind === 'text' && region.contentId === id));
    const region = index < 0 ? null : project.template.pages[index].regions.find((region): region is TextRegion => region.kind === 'text' && region.contentId === id);
    const ordinal = project.template.pages.flatMap(page => page.regions).filter(region => region.kind === 'text').findIndex(region => region.contentId === id) + 1;
    return [{ id, label: region?.sourceLocator || (ordinal ? `Paragraph ${ordinal}` : 'Saved passage'), page: index < 0 ? null : index + 1,
      before, after, wording: diffWords(before, after), formattingOnly: before === after }];
  });
}

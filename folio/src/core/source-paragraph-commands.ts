import {FolioError} from './errors';
import {blockText, hasValidApproval, type Project} from './model';
import {sourceParagraphGroups} from './source-paragraphs';
import {loadSourceFont} from '../layout/source-fonts';

/** One canonical edit supersedes the complete group; original paint stays immutable. */
export function editSourceParagraph(project: Project, groupId: string, text: string): Project {
  if (!hasValidApproval(project)) throw new FolioError('SOURCE_PARAGRAPH_APPROVAL', 'Approve the original layout before editing a bullet.');
  const group = sourceParagraphGroups(project).find(g => g.id === groupId);
  if (!group) throw new FolioError('SOURCE_PARAGRAPH_OWNER', 'This bullet no longer has an unambiguous original owner.');
  if (text.length > 10000 || /[\r\n\t]/.test(text)) throw new FolioError('SOURCE_PARAGRAPH_TEXT', 'Use one paragraph below 10,000 characters. Line wrapping follows the original layout.');
  if (text === group.baselineText) return resetSourceParagraph(project, groupId);
  const asset = project.template.sourceFonts!.find(f => f.id === group.fontId)!;
  const unsupported = loadSourceFont(asset).unsupportedCharacters(text);
  if (unsupported.length) throw new FolioError('SOURCE_PARAGRAPH_GLYPH', `The original font does not cover ${unsupported.map(c => JSON.stringify(c)).join(', ')}. Your saved wording is unchanged.`);
  const original = project.baseline.blocks.find(b => b.id === group.contentIds[0])!;
  const ids = new Set(group.contentIds);
  const blocks = project.draft.blocks.map(block => {
    if (!ids.has(block.id)) return block;
    const baseline = project.baseline.blocks.find(b => b.id === block.id)!;
    return block.id === original.id
      ? {...block, sourceParagraphGroupId: group.id, sourceFactIds: [...group.sourceFactIds], runs: [{...original.runs[0], text, sourceFactIds: [...group.sourceFactIds]}]}
      : {...baseline, runs: baseline.runs.map(run => ({...run, text: ''}))};
  });
  const current = project.draft.blocks.find(b => b.id === original.id);
  if (current?.sourceParagraphGroupId === group.id && blockText(current) === text) return project;
  return {...project, revision: project.revision + 1, updatedAt: new Date().toISOString(), draft: {revision: project.draft.revision + 1, blocks}, reviewedDraftRevision: null};
}

export function resetSourceParagraph(project: Project, groupId: string): Project {
  const group = sourceParagraphGroups(project).find(g => g.id === groupId);
  if (!group) throw new FolioError('SOURCE_PARAGRAPH_OWNER', 'This original bullet is no longer available.');
  const ids = new Set(group.contentIds), originals = new Map(project.baseline.blocks.map(b => [b.id, b]));
  const blocks = project.draft.blocks.map(block => ids.has(block.id) ? structuredClone(originals.get(block.id)!) : block);
  return {...project, revision: project.revision + 1, updatedAt: new Date().toISOString(), draft: {revision: project.draft.revision + 1, blocks}, reviewedDraftRevision: null};
}

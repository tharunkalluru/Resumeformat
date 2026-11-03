import { FolioError } from './errors';
import { canonicalJson, workspaceOf, type Project, type Rect } from './model';

/** A deliberate preapproval edit of one text box. No content or other geometry moves. */
export function adjustTextRegion(project: Project, regionId: string, bounds: Rect): Project {
  if(project.template.sourceFonts?.some(font=>font.sourceVersion===7))throw new FolioError('DOCUMENT_SCOPED_REPAIR_UNAVAILABLE','This document-scoped font template requires its original text boxes. Box adjustment is unavailable; use the unchanged source layout.');
  if (workspaceOf(project).kind !== 'resume' || project.approval) throw new FolioError('REPAIR_STATE', 'Withdraw template approval on the reusable resume before adjusting its layout.');
  const page = project.template.pages.find(item => item.regions.some(region => region.id === regionId));
  const region = page?.regions.find(item => item.id === regionId);
  if (!page || region?.kind !== 'text') throw new FolioError('REPAIR_REGION', 'Choose a supported text box to adjust.');
  if (!Object.values(bounds).every(Number.isFinite) || bounds.width < 1 || bounds.height < 1 || bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > page.width || bounds.y + bounds.height > page.height) throw new FolioError('REPAIR_BOUNDS', 'Keep the text box inside its page with positive width and height.');
  if (canonicalJson(region.bounds) === canonicalJson(bounds)) return project;
  const prior = project.template.adjustments?.find(item => item.regionId === regionId);
  const before = prior?.before ?? region.bounds;
  const adjustments = (project.template.adjustments ?? []).filter(item => item.regionId !== regionId);
  if (canonicalJson(before) !== canonicalJson(bounds)) adjustments.push({ regionId, before: { ...before }, after: { ...bounds } });
  return {
    ...project, revision: project.revision + 1, updatedAt: new Date().toISOString(),
    approval: null, reviewedDraftRevision: null,
    template: { ...project.template, revision: project.template.revision + 1, adjustments,
      pages: project.template.pages.map(item => item.id === page.id ? { ...item, regions: item.regions.map(value => value.id === regionId ? { ...value, bounds: { ...bounds } } : value) } : item),
    },
  };
}

export function resetTextRegion(project: Project, regionId: string): Project {
  const adjustment = project.template.adjustments?.find(item => item.regionId === regionId);
  return adjustment ? adjustTextRegion(project, regionId, adjustment.before) : project;
}

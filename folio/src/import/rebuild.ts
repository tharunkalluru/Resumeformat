import { initCareerMemory } from '../core/careerMemory';
import { FolioError } from '../core/errors';
import { makeProject, sha256, workspaceOf, type Project } from '../core/model';
import { IMPORTER_VERSION } from './common';
import { importResume } from './index';

/** Saved layouts are immutable imports; reopening does not run a newer parser. */
export function hasEarlierReconstruction(project: Project): boolean {
  const earlier = /^folio-import-v(\d+)$/.exec(project.template.importerVersion);
  const current = /^folio-import-v(\d+)$/.exec(IMPORTER_VERSION);
  return !!earlier && !!current && Number(earlier[1]) < Number(current[1]);
}

/** Find a newer source reconstruction without mixing in a tailored application. */
export function currentReconstruction(project: Project, library: Project[]): Project | undefined {
  return library.filter(candidate => candidate.id !== project.id &&
    workspaceOf(candidate).kind === 'resume' &&
    candidate.source.sha256 === project.source.sha256 && candidate.source.format === project.source.format &&
    candidate.template.importerVersion === IMPORTER_VERSION && !candidate.template.fidelity &&
    !candidate.template.warnings.some(item => item.severity === 'blocking'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
}

/** Pure reconstruction into a new resume group. Never migrate an existing draft. */
export async function rebuildFromOriginal(project: Project): Promise<Project> {
  const original = project.source;
  const bytes = new Uint8Array(original.bytes);
  if (await sha256(bytes) !== original.sha256) {
    throw new FolioError('SOURCE_CHECKSUM', 'The retained original failed its integrity check. Choose your original file again.');
  }
  const type = original.format === 'pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const result = await importResume(new File([bytes.buffer], original.name, { type }));
  if (result.source.sha256 !== original.sha256 || result.source.format !== original.format) {
    throw new FolioError('SOURCE_CHECKSUM', 'The reconstruction does not match the retained original. The saved resume was not changed.');
  }
  const fresh = initCareerMemory(makeProject(result, project.fictional));
  return { ...fresh, name: `${project.name.slice(0, 488)} · Rebuilt` };
}

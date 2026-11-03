// Wholly authored controls. These fixtures are not engine/fidelity evidence.
import { fixtureProject } from '../core/testFixture';
import { hashJson, rendererVersionFor, type Project } from '../core/model';

export async function approvedControlProject(name = 'Control A'): Promise<Project> {
  const project = await fixtureProject();
  project.name = name; project.source.name = `${name}.pdf`;
  project.approval = { templateId: project.template.id, templateRevision: project.template.revision,
    layoutHash: await hashJson(project.template), baselineHash: await hashJson(project.baseline.blocks),
    rendererVersion: rendererVersionFor(project.template), acknowledgedWarnings: [], approvedAt: new Date().toISOString() };
  return project;
}
export async function revisedControlProject(project: Project): Promise<Project> {
  const next = structuredClone(project); next.revision++; next.template.revision++;
  next.approval = { ...next.approval!, templateRevision: next.template.revision, layoutHash: await hashJson(next.template) };
  return next;
}
export function deferred<Value>() {
  let resolve!: (value: Value) => void, reject!: (error: Error) => void;
  const promise = new Promise<Value>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

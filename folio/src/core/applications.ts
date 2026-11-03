import { FolioError } from './errors';
import { hasValidApproval, hashJson, newId, sha256, workspaceOf } from './model';
import type { CareerMemory, JobContext, Project } from './model';
import { validateProject } from './schema';
import { createMemorySnapshot, eligibleEvidence } from './careerMemory';

export function applicationName(job: JobContext): string {
  const title = job.title.trim(), company = job.company.trim();
  return (title && company ? `${title} at ${company}` : title || (company ? `Application for ${company}` : 'Untitled application')).slice(0, 500);
}

/** A new job starts from an approved baseline, never another job's wording. */
export async function createApplication(project: Project, job: JobContext = { title: '', company: '', description: '' }, memory: CareerMemory | undefined = project.careerMemory): Promise<Project> {
  const resume = validateProject(structuredClone(project));
  if (workspaceOf(resume).kind !== 'resume') throw new FolioError('RESUME_REQUIRED', 'Open the reusable resume to start a new application.');
  if (!hasValidApproval(resume)) throw new FolioError('TEMPLATE_NOT_APPROVED', 'Compare and approve this resume template before starting an application.');
  if (resume.template.warnings.some(warning => warning.severity === 'blocking')) throw new FolioError('UNSUPPORTED_TEMPLATE', 'Resolve the blocking template warnings before starting an application.');
  const [layoutHash, baselineHash, sourceHash] = await Promise.all([hashJson(resume.template), hashJson(resume.baseline.blocks), sha256(resume.source.bytes)]);
  if (sourceHash !== resume.source.sha256) throw new FolioError('SOURCE_CHANGED', 'The original resume checksum has changed. Restore a valid backup or import the original before starting an application.');
  if (layoutHash !== resume.approval!.layoutHash || baselineHash !== resume.approval!.baselineHash)
    throw new FolioError('APPROVAL_STALE', 'The template changed. Compare and approve it again before starting an application.');
  if (job.description.length > 50000) throw new FolioError('JD_TOO_LONG', 'Keep the job description below 50,000 characters.');

  const facts = resume.facts.filter(fact => fact.kind === 'resume');
  const sourceFactIds = new Set(facts.map(fact => fact.id));
  const baselineReferences = resume.baseline.blocks.flatMap(block => [...block.sourceFactIds, ...block.runs.flatMap(run => run.sourceFactIds ?? [])]);
  if (baselineReferences.some(id => !sourceFactIds.has(id))) throw new FolioError('BASELINE_EVIDENCE_INVALID', 'The original resume baseline contains evidence from a draft or career note. Restore the original resume before starting an application.');

  const timestamp = new Date().toISOString();
  const nextJob = { title: job.title.slice(0, 300), company: job.company.slice(0, 300), description: job.description };
  const memorySnapshot = memory ? await createMemorySnapshot(resume, memory) : undefined;
  const applicationFacts = memorySnapshot ? [...facts, ...eligibleEvidence(resume, 'futureApplication').filter(fact => fact.kind !== 'resume')] : facts;
  const { careerMemory: _liveMemory, folio: _presentation, ...base } = resume;
  return validateProject({
    ...base, id: newId(), name: applicationName(nextJob),
    workspace: { templateGroupId: workspaceOf(resume).templateGroupId, kind: 'application' },
    revision: 1, createdAt: timestamp, updatedAt: timestamp,
    draft: structuredClone(resume.baseline), facts: applicationFacts, notes: [], job: nextJob,
    ...(memorySnapshot ? { memorySnapshot } : {}),
    evidenceDecisions: {}, reviewedDraftRevision: null,
  });
}

export function renameApplication(project: Project, name: string): Project {
  if (workspaceOf(project).kind !== 'application') throw new FolioError('APPLICATION_REQUIRED', 'Select an application to rename it.');
  const value = name.trim();
  if (!value || value.length > 500) throw new FolioError('APPLICATION_NAME_INVALID', 'Give this application a name between 1 and 500 characters.');
  if (value === project.name) return project;
  return { ...project, name: value, revision: project.revision + 1, updatedAt: new Date().toISOString() };
}

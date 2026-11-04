import type { Project } from '../core/model';

/** Letters, digits, spaces, hyphens and underscores only; spaces become hyphens. */
export const safeName = (value: string) => value.replace(/[^a-zA-Z0-9 _-]/g, '').trim().replace(/\s+/g, '-').slice(0, 100) || 'resume';

/** Company-Role for applications (the role is never repeated); otherwise the project name. */
export function defaultResumeFileName(project: Pick<Project, 'name' | 'job'>): string {
  const { company, title } = project.job;
  if (company.trim() || title.trim()) return safeName([company, title].filter(part => part.trim()).join(' '));
  return safeName(project.name);
}

import { workspaceOf, type Project } from '../core/model';
export interface HistoryGroup { label: 'Today' | 'Previous 7 days' | 'Earlier'; projects: Project[] }
/** Groups retained application records by the device's actual local calendar. */
export function historyGroups(projects: Project[], now = new Date()): HistoryGroup[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).getTime();
  const groups: HistoryGroup[] = [{ label: 'Today', projects: [] }, { label: 'Previous 7 days', projects: [] }, { label: 'Earlier', projects: [] }];
  const entries = projects.filter(project => workspaceOf(project).kind === 'application').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  for (const project of entries) {
    const at = new Date(project.updatedAt).getTime();
    groups[at >= today ? 0 : at >= weekStart ? 1 : 2].projects.push(project);
  }
  return groups.filter(group => group.projects.length > 0);
}

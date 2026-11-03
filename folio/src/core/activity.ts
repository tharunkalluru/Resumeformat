import type { Project } from './model';
export interface ActivityEvent { id: string; at: string; jobIdentity: string; projectId: string; company: string; title: string }
export interface PrivateProfile { name: string; headline: string; timeZone: string; countingSince: string; events: ActivityEvent[]; historyUnavailable?: boolean }
export function localDay(at: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(at));
  const part = (name: string) => parts.find(p => p.type === name)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function mergeActivity(projects: Project[], previous: ActivityEvent[] = []): ActivityEvent[] {
  const events = new Map(previous.map(event => [event.id, event]));
  for (const project of projects) for (const event of project.folio?.completions ?? []) {
    if (!events.has(event.id)) events.set(event.id, { id: event.id, at: event.completedAt, jobIdentity: event.jobIdentity, projectId: project.id, company: project.job.company, title: project.job.title || project.name });
    // Restoring a backup retains the same completion identity, not another success.
    else if (!projects.some(candidate => candidate.id === events.get(event.id)!.projectId)) events.set(event.id, { ...events.get(event.id)!, projectId: project.id });
  }
  return [...events.values()].sort((a, b) => b.at.localeCompare(a.at));
}
export function activitySummary(projects: Project[], profile: PrivateProfile, now = new Date()) {
  const events = mergeActivity(projects, profile.events).filter(event => new Date(event.at) <= now), today = localDay(now, profile.timeZone), month = today.slice(0, 7);
  const legacy = !!profile.historyUnavailable || projects.some(project => project.workspace.kind === 'application' && !project.folio?.historyKnown);
  return { events, today, firstDay: localDay(profile.countingSince, profile.timeZone), legacy,
    allTime: legacy ? null : events.length,
    month: legacy ? null : events.filter(event => localDay(event.at, profile.timeZone).startsWith(month)).length,
    jobs: legacy ? null : new Set(events.map(event => event.jobIdentity)).size,
    days: events.reduce((days, event) => { const key = localDay(event.at, profile.timeZone); days.set(key, [...(days.get(key) ?? []), event]); return days; }, new Map<string, ActivityEvent[]>()) };
}
export function dayRange(today: string, weeks: number, earlierWeeks = 0): string[] {
  const end = new Date(`${today}T12:00:00Z`); end.setUTCDate(end.getUTCDate() - earlierWeeks * 7);
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - (weeks - 1) * 7 - start.getUTCDay());
  const days: string[] = [];
  for (let date = start; date <= end; date = new Date(date.getTime() + 86400000)) days.push(date.toISOString().slice(0, 10));
  return days;
}

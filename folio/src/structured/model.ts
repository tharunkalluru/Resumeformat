import { requirementTerms } from '../tailoring/local';

/** A resume as sections, free to reflow. The exact-layout engine is not involved. */
export interface Bullet { id: string; text: string }
export interface Role { id: string; title: string; company: string; location: string; dates: string; bullets: Bullet[] }
export interface Education { degree: string; school: string; location: string; dates: string; details: string[] }
export interface SkillGroup { id: string; label: string; items: string[] }
export interface ProjectEntry { id: string; name: string; link: string; dates: string; bullets: Bullet[] }
export interface Extra { title: string; items: string[] }
export interface StructuredResume {
  name: string; headline: string; contact: string[]; summary: string;
  experience: Role[]; education: Education[]; skills: SkillGroup[]; projects: ProjectEntry[]; extras: Extra[];
}

/** What the server returns after its own checks; every item still needs the applicant's accept. */
export interface Tailoring {
  /** Role and company as the posting writes them; empty when it does not say. */
  job?: { title: string; company: string };
  summary: { text: string; reason: string } | null;
  bullets: { id: string; text: string; reason: string }[];
  cuts: { id: string; reason: string }[];
  order: { parentId: string; ids: string[] }[];
  skills: { groupId: string; items: string[] }[];
  /** From the applicant's career memory: new bullets under an existing role or project, skills, and whole projects. */
  additions?: { id: string; parentId: string; text: string; reason: string }[];
  newSkills?: { groupId: string; item: string }[];
  newProjects?: { id: string; name: string; link: string; dates: string; bullets: Bullet[]; reason: string }[];
  missing: string[];
  dropped: Record<string, number>;
}
export type Decision = 'accepted' | 'rejected';
/** Keys: `bullet:<id>`, `cut:<id>`, `add:<id>`, `project:<id>`, `summary`, `order`, `skills`, `newSkills`. Undecided suggestions are not applied. */
export type Decisions = Record<string, Decision>;

export interface Job { title: string; company: string; description: string }
export interface StructuredRecord {
  projectId: string; sourceName: string; base: StructuredResume; updatedAt: string;
  job: Job; tailoring: Tailoring | null; decisions: Decisions;
}

export type TemplateId = 'classic' | 'modern' | 'compact';
/** One tailoring of a resume for one job. Saved as soon as it exists. `edits` are the applicant's own rewording of a line for this job. */
export interface JobRecord {
  id: string; job: Job; tailoring: Tailoring; decisions: Decisions; edits: Record<string, string>; letter: string;
  status: 'draft' | 'applied'; appliedAt: string | null; createdAt: string; updatedAt: string;
}
/** A resume and every job it has been tailored for. `synced` is local bookkeeping and is never sent to the account. */
export interface ResumeRecord {
  id: string; sourceName: string; base: StructuredResume; template: TemplateId; createdAt: string; updatedAt: string;
  /** How many pages the original file had; tailored versions are kept to this. Null when unknown. */
  pages?: number | null;
  jobs: JobRecord[]; deletedJobs: string[]; synced?: { user: string; at: string };
}

const newId = () => crypto.randomUUID().slice(0, 8);
const now = () => new Date().toISOString();

export function newResume(sourceName: string, base: StructuredResume, pages: number | null = null): ResumeRecord {
  return { id: crypto.randomUUID(), sourceName, base, template: 'classic', pages, createdAt: now(), updatedAt: now(), jobs: [], deletedJobs: [] };
}
export function newJob(job: Job, tailoring: Tailoring): JobRecord {
  return { id: crypto.randomUUID(), job, tailoring, decisions: Object.fromEntries(suggestionKeys(tailoring).map(key => [key, 'accepted' as const])), edits: {}, letter: '', status: 'draft', appliedAt: null, createdAt: now(), updatedAt: now() };
}
/** Replaces (or adds) one job and stamps both as changed. */
export function withJob(resume: ResumeRecord, job: JobRecord): ResumeRecord {
  const next = { ...job, updatedAt: now() };
  return { ...resume, updatedAt: now(), jobs: resume.jobs.some(item => item.id === job.id) ? resume.jobs.map(item => item.id === job.id ? next : item) : [next, ...resume.jobs] };
}
export function withoutJob(resume: ResumeRecord, jobId: string): ResumeRecord {
  return { ...resume, updatedAt: now(), jobs: resume.jobs.filter(item => item.id !== jobId), deletedJobs: [...new Set([...resume.deletedJobs, jobId])] };
}
/** Records saved before jobs were kept separately: one resume with at most one tailoring. */
export function fromV1(old: StructuredRecord): ResumeRecord {
  const resume = { ...newResume(old.sourceName, old.base), createdAt: old.updatedAt, updatedAt: old.updatedAt };
  if (!old.tailoring) return resume;
  return { ...resume, jobs: [{ ...newJob(old.job, old.tailoring), decisions: old.decisions, createdAt: old.updatedAt, updatedAt: old.updatedAt }] };
}
/** Two copies of the same resume (this device and the account): the newer resume text wins, and no job is lost. */
export function mergeResume(a: ResumeRecord, b: ResumeRecord): ResumeRecord {
  const [newer, older] = a.updatedAt >= b.updatedAt ? [a, b] : [b, a];
  const deletedJobs = [...new Set([...(a.deletedJobs ?? []), ...(b.deletedJobs ?? [])])], jobs = new Map<string, JobRecord>();
  for (const job of [...older.jobs, ...newer.jobs]) { const seen = jobs.get(job.id); if (!seen || job.updatedAt >= seen.updatedAt) jobs.set(job.id, job); }
  return { ...newer, deletedJobs, jobs: [...jobs.values()].filter(job => !deletedJobs.includes(job.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
}
/** JSON with keys in a fixed order, so copies that went through the database compare equal. */
const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]`
  : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value ?? null);
/** True when the two copies hold the same content, whatever their bookkeeping or key order. */
export function sameContent(a: ResumeRecord, b: ResumeRecord): boolean {
  const plain = ({ synced: _synced, ...rest }: ResumeRecord) => stable(rest);
  return plain(a) === plain(b);
}
export const jobLabel = (job: Job) => [job.title, job.company].filter(Boolean).join(' at ') || 'Untitled job';

/** The model returns plain strings; ids are added here so suggestions can point at bullets. */
export function withIds(raw: {
  name: string; headline: string; contact: string[]; summary: string;
  experience: (Omit<Role, 'id' | 'bullets'> & { bullets: string[] })[]; education: Education[];
  skills: Omit<SkillGroup, 'id'>[]; projects: (Omit<ProjectEntry, 'id' | 'bullets'> & { bullets: string[] })[]; extras: Extra[];
}): StructuredResume {
  const bullets = (items: string[]) => items.filter(text => text.trim()).map(text => ({ id: newId(), text: text.trim() }));
  return {
    name: raw.name.trim(), headline: raw.headline.trim(), contact: raw.contact.map(item => item.trim()).filter(Boolean), summary: raw.summary.trim(),
    experience: raw.experience.map(role => ({ ...role, id: newId(), bullets: bullets(role.bullets) })),
    education: raw.education,
    skills: raw.skills.filter(group => group.items.length).map(group => ({ ...group, id: newId() })),
    projects: raw.projects.map(project => ({ ...project, id: newId(), bullets: bullets(project.bullets) })),
    extras: raw.extras.filter(extra => extra.items.length),
  };
}

export function resumeText(resume: StructuredResume): string {
  const lines = [resume.name, resume.headline, ...resume.contact, resume.summary];
  for (const role of resume.experience) lines.push(role.title, role.company, role.location, role.dates, ...role.bullets.map(bullet => bullet.text));
  for (const item of resume.education) lines.push(item.degree, item.school, item.location, item.dates, ...item.details);
  for (const group of resume.skills) lines.push(group.label, ...group.items);
  for (const project of resume.projects) lines.push(project.name, project.link, project.dates, ...project.bullets.map(bullet => bullet.text));
  for (const extra of resume.extras) lines.push(extra.title, ...extra.items);
  return lines.filter(Boolean).join('\n');
}

/** Drops blank lines and stray spaces left behind by hand edits. */
export function clean(resume: StructuredResume): StructuredResume {
  const kept = (items: string[]) => items.map(item => item.trim()).filter(Boolean);
  const filled = <T extends { bullets: Bullet[] }>(parent: T): T => ({ ...parent, bullets: parent.bullets.filter(bullet => bullet.text.trim()) });
  return {
    ...resume, contact: kept(resume.contact), experience: resume.experience.map(filled), projects: resume.projects.map(filled),
    education: resume.education.map(item => ({ ...item, details: kept(item.details) })),
    skills: resume.skills.map(group => ({ ...group, items: kept(group.items) })).filter(group => group.items.length),
    extras: resume.extras.map(extra => ({ ...extra, items: kept(extra.items) })).filter(extra => extra.items.length),
  };
}

/** The base resume with only the accepted suggestions applied. */
export function applyTailoring(base: StructuredResume, tailoring: Tailoring | null, decisions: Decisions, edits: Record<string, string> = {}): StructuredResume {
  if (!tailoring) return base;
  const yes = (key: string) => decisions[key] === 'accepted';
  const rewrites = new Map(tailoring.bullets.filter(item => yes(`bullet:${item.id}`)).map(item => [item.id, item.text]));
  const cuts = new Set(tailoring.cuts.filter(item => yes(`cut:${item.id}`)).map(item => item.id));
  const order = new Map(yes('order') ? tailoring.order.map(item => [item.parentId, item.ids]) : []);
  const skills = new Map(yes('skills') ? tailoring.skills.map(item => [item.groupId, item.items]) : []);
  const added = (tailoring.additions ?? []).filter(item => yes(`add:${item.id}`)), extraSkills = yes('newSkills') ? tailoring.newSkills ?? [] : [];
  const own = (bullet: Bullet): Bullet => { const text = edits[`bullet:${bullet.id}`]; return text !== undefined ? { ...bullet, text } : bullet; };
  const bullets = <T extends { id: string; bullets: Bullet[] }>(parent: T): T => {
    const ranked = order.get(parent.id);
    const sorted = ranked ? [...parent.bullets].sort((a, b) => ranked.indexOf(a.id) - ranked.indexOf(b.id)) : parent.bullets;
    // Lines brought in from career memory lead the role: they were chosen for this job.
    const fresh = added.filter(item => item.parentId === parent.id).map(item => own({ id: item.id, text: item.text }));
    // The applicant's own wording for this job wins over both the original line and a suggestion.
    return { ...parent, bullets: [...fresh, ...sorted.filter(bullet => !cuts.has(bullet.id)).map(bullet => {
      const mine = edits[`bullet:${bullet.id}`];
      return mine !== undefined ? { ...bullet, text: mine } : rewrites.has(bullet.id) ? { ...bullet, text: rewrites.get(bullet.id)! } : bullet;
    })].filter(bullet => bullet.text.trim()) };
  };
  return {
    ...base,
    summary: edits.summary !== undefined ? edits.summary : tailoring.summary && yes('summary') ? tailoring.summary.text : base.summary,
    experience: base.experience.map(bullets),
    projects: [...base.projects.map(bullets), ...(tailoring.newProjects ?? []).filter(item => yes(`project:${item.id}`)).map(item => ({ id: item.id, name: item.name, link: item.link, dates: item.dates, bullets: item.bullets.map(own).filter(bullet => bullet.text.trim()) }))],
    skills: base.skills.map(group => {
      const items = skills.get(group.id) ?? group.items, extra = extraSkills.filter(item => item.groupId === group.id && !items.includes(item.item)).map(item => item.item);
      return extra.length || skills.has(group.id) ? { ...group, items: [...items, ...extra] } : group;
    }),
  };
}

export const suggestionKeys = (tailoring: Tailoring): string[] => [
  ...(tailoring.summary ? ['summary'] : []), ...tailoring.bullets.map(item => `bullet:${item.id}`), ...tailoring.cuts.map(item => `cut:${item.id}`),
  ...(tailoring.order.length ? ['order'] : []), ...(tailoring.skills.length ? ['skills'] : []),
  ...(tailoring.additions ?? []).map(item => `add:${item.id}`), ...(tailoring.newSkills?.length ? ['newSkills'] : []), ...(tailoring.newProjects ?? []).map(item => `project:${item.id}`),
];

/** Share of the posting's key terms that the resume text contains. A reading aid, not a hiring score. */
export function jobMatch(resume: StructuredResume, jobDescription: string): { found: string[]; absent: string[]; percent: number } {
  const terms = requirementTerms(jobDescription), text = ` ${resumeText(resume).toLowerCase()} `;
  const has = (term: string) => new RegExp(`(?:^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'u').test(text);
  const found = terms.filter(has), absent = terms.filter(term => !has(term));
  return { found, absent, percent: terms.length ? Math.round(found.length / terms.length * 100) : 0 };
}

/** Best guess at role and company from the posting's first line, e.g. "Senior PM, Platform at Acme". */
export function jobHeading(description: string): { title: string; company: string } {
  const first = description.trim().split(/\n|(?<=[.!?])\s/u)[0]?.trim().replace(/[.!?]$/u, '') ?? '';
  const match = first.length <= 140 ? first.match(/^(.{3,90}?)\s+(?:at|@)\s+(\p{Lu}[\p{L}\p{N}&.' -]{1,50})$/u) ?? first.match(/^(.{3,90}?)\s+[|–—-]\s+(\p{Lu}[\p{L}\p{N}&.' -]{1,50})$/u) : null;
  if (match) return { title: match[1].trim(), company: match[2].trim() };
  return { title: first.length <= 70 && !/[.:;]/u.test(first) ? first : '', company: '' };
}

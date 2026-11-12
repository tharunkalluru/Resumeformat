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
  summary: { text: string; reason: string } | null;
  bullets: { id: string; text: string; reason: string }[];
  cuts: { id: string; reason: string }[];
  order: { parentId: string; ids: string[] }[];
  skills: { groupId: string; items: string[] }[];
  missing: string[];
  dropped: Record<string, number>;
}
export type Decision = 'accepted' | 'rejected';
/** Keys: `bullet:<id>`, `cut:<id>`, `summary`, `order`, `skills`. Undecided suggestions are not applied. */
export type Decisions = Record<string, Decision>;

export interface Job { title: string; company: string; description: string }
export interface StructuredRecord {
  projectId: string; sourceName: string; base: StructuredResume; updatedAt: string;
  job: Job; tailoring: Tailoring | null; decisions: Decisions;
}

const newId = () => crypto.randomUUID().slice(0, 8);

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

/** Drops blank lines left behind by hand edits. */
export function clean(resume: StructuredResume): StructuredResume {
  const filled = <T extends { bullets: Bullet[] }>(parent: T): T => ({ ...parent, bullets: parent.bullets.filter(bullet => bullet.text.trim()) });
  return { ...resume, contact: resume.contact.map(item => item.trim()).filter(Boolean), experience: resume.experience.map(filled), projects: resume.projects.map(filled) };
}

/** The base resume with only the accepted suggestions applied. */
export function applyTailoring(base: StructuredResume, tailoring: Tailoring | null, decisions: Decisions): StructuredResume {
  if (!tailoring) return base;
  const yes = (key: string) => decisions[key] === 'accepted';
  const rewrites = new Map(tailoring.bullets.filter(item => yes(`bullet:${item.id}`)).map(item => [item.id, item.text]));
  const cuts = new Set(tailoring.cuts.filter(item => yes(`cut:${item.id}`)).map(item => item.id));
  const order = new Map(yes('order') ? tailoring.order.map(item => [item.parentId, item.ids]) : []);
  const skills = new Map(yes('skills') ? tailoring.skills.map(item => [item.groupId, item.items]) : []);
  const bullets = <T extends { id: string; bullets: Bullet[] }>(parent: T): T => {
    const ranked = order.get(parent.id);
    const sorted = ranked ? [...parent.bullets].sort((a, b) => ranked.indexOf(a.id) - ranked.indexOf(b.id)) : parent.bullets;
    return { ...parent, bullets: sorted.filter(bullet => !cuts.has(bullet.id)).map(bullet => rewrites.has(bullet.id) ? { ...bullet, text: rewrites.get(bullet.id)! } : bullet) };
  };
  return {
    ...base,
    summary: tailoring.summary && yes('summary') ? tailoring.summary.text : base.summary,
    experience: base.experience.map(bullets), projects: base.projects.map(bullets),
    skills: base.skills.map(group => skills.has(group.id) ? { ...group, items: skills.get(group.id)! } : group),
  };
}

export const suggestionKeys = (tailoring: Tailoring): string[] => [
  ...(tailoring.summary ? ['summary'] : []), ...tailoring.bullets.map(item => `bullet:${item.id}`), ...tailoring.cuts.map(item => `cut:${item.id}`),
  ...(tailoring.order.length ? ['order'] : []), ...(tailoring.skills.length ? ['skills'] : []),
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

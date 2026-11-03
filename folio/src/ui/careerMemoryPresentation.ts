import type { Project } from '../core/model';

export type MemoryCategory = 'roles' | 'projects' | 'skills' | 'achievements' | 'education' | 'other';
export interface MemoryGroup {
  id: string;
  category: MemoryCategory;
  title: string;
  dates?: string;
  factIds: string[];
  /** Headings and dates remain actual source facts, even when shown as card metadata. */
  metadataFactIds: string[];
}
export interface MemorySkill { label: string; factIds: string[] }

const headings: Record<string, MemoryCategory> = {
  experience: 'roles', 'work experience': 'roles', 'professional experience': 'roles',
  employment: 'roles', 'employment history': 'roles',
  projects: 'projects', 'selected projects': 'projects',
  skills: 'skills', 'technical skills': 'skills', 'skills & competencies': 'skills',
  achievements: 'achievements', awards: 'achievements', 'awards & achievements': 'achievements',
  education: 'education', 'academic qualifications': 'education',
};
const labels: Record<MemoryCategory, string> = {
  roles: 'Experience', projects: 'Projects', skills: 'Skills', achievements: 'Achievements',
  education: 'Education', other: 'Other resume details',
};
const roleLabel = /\b(?:designer|engineer|developer|manager|analyst|director|consultant|specialist|researcher|intern|founder|coordinator|officer|physician|nurse|teacher|professor|assistant|architect|administrator|technician)\b/i;
const literalTitle = /^(?:(?:senior|junior|associate|lead|staff|principal|chief|assistant|software|product|data|business|financial|quality|assurance|systems|system|information|technology|technical|project|program|operations|marketing|sales|account|ux|ui|research|security|support|human|resources|clinical|registered)\s+){0,6}(?:designer|engineer|developer|manager|analyst|director|consultant|specialist|researcher|intern|founder|coordinator|officer|physician|nurse|teacher|professor|assistant|architect|administrator|technician)(?:\s+(?:I|II|III|IV))?$/i;
const otherSectionLabels = new Set(['profile', 'summary', 'professional summary', 'certifications', 'certificates', 'courses', 'tools used', 'personal skills', 'interests', 'publications', 'languages', 'references', 'volunteering']);
function literalRoleAndOrganization(text: string): boolean {
  const parts = text.split(/[·|,]/).map(part => part.trim());
  return parts.length === 2 && parts.every(Boolean) && ((literalTitle.test(parts[0]) && parts[1].length <= 100) || (literalTitle.test(parts[1]) && parts[0].length <= 100));
}

/** A view projection only. It never creates evidence or writes to the source/model. */
export function careerMemoryGroups(project: Pick<Project, 'template' | 'baseline' | 'facts'>): MemoryGroup[] {
  const facts = new Map(project.facts.filter(fact => fact.kind === 'resume').map(fact => [fact.id, fact]));
  const blocks = new Map(project.baseline.blocks.map(block => [block.id, block]));
  const seen = new Set<string>();
  const groups: MemoryGroup[] = [];
  let category: MemoryCategory = 'other';
  let group: MemoryGroup | undefined;
  const create = (title: string) => {
    const item: MemoryGroup = { id: `memory-group-${groups.length}`, category, title, factIds: [], metadataFactIds: [] };
    groups.push(item); group = item; return item;
  };
  for (const page of project.template.pages) {
    for (const region of [...page.regions].sort((a, b) => a.order - b.order)) {
      if (region.kind !== 'text') continue;
      const block = blocks.get(region.contentId);
      const ids = [...new Set([...(block?.sourceFactIds ?? []), ...(block?.runs.flatMap(run => run.sourceFactIds ?? []) ?? [])])].filter(id => facts.has(id) && !seen.has(id));
      if (!ids.length) continue;
      ids.forEach(id => seen.add(id));
      const text = ids.map(id => facts.get(id)!.text).join(' ').trim();
      const normalized = text.toLocaleLowerCase().replace(/\s+/g, ' ').replace(/:$/, '');
      const literalSection = ids.length === 1 && text === text.toLocaleUpperCase() && (headings[normalized] !== undefined || otherSectionLabels.has(normalized));
      const explicitHeading = region.role !== 'bullet' && (region.role === 'heading' || region.style.fontWeight === 700 || literalSection);
      const section = explicitHeading ? headings[normalized] : undefined;
      if (section) {
        category = section; group = undefined;
        create(labels[category]).metadataFactIds.push(...ids);
        continue;
      }
      if (explicitHeading && text.length <= 80 && (category !== 'roles' || !roleLabel.test(text))) {
        category = 'other'; group = undefined;
        create(text).metadataFactIds.push(...ids);
        continue;
      }
      const roleHeading = category === 'roles' && text.length <= 180 && region.role !== 'bullet'
        && (region.style.fontWeight === 700 || region.role === 'heading' || (ids.length === 1 && literalRoleAndOrganization(text)))
        && roleLabel.test(text)
        && !/^[\s•·▪◦*-]/.test(text) && !/\b(?:19|20)\d{2}\b/.test(text);
      if (roleHeading) {
        if (group && !group.factIds.length && group.title === labels[category]) {
          group.title = text; group.metadataFactIds.push(...ids);
        } else create(text).metadataFactIds.push(...ids);
      } else if (category === 'roles' && group && !group.factIds.length && !group.dates
        && /^(?:[A-Za-z]{3,9}\s+)?(?:19|20)\d{2}(?:\s*[–—-]\s*(?:(?:[A-Za-z]{3,9}\s+)?(?:19|20)\d{2}|Present|Current))?(?:\s*\|\s*[^|]{1,80})?$/.test(text) && region.role !== 'bullet') {
        group.dates = text; group.metadataFactIds.push(...ids);
      } else {
        (group ?? create(labels[category])).factIds.push(...ids);
      }
    }
  }
  const remaining = [...facts.keys()].filter(id => !seen.has(id));
  if (remaining.length) { category = 'other'; create(labels.other).factIds.push(...remaining); }
  return groups;
}

// These exact standalone labels have no shared sentence qualifier. Every other
// passage stays whole, including unknown skills, negation and learning context.
const independentSkillLabels = new Set(['figma', 'research', 'product design', 'interaction design', 'prototyping', 'design systems', 'accessibility', 'python', 'sql', 'javascript', 'typescript', 'java', 'react', 'html', 'css', 'excel', 'git']);

/** Preserve source wording. Only a middle-dot list of known standalone labels splits. */
export function careerMemorySkills(groups: MemoryGroup[], facts: Pick<Project, 'facts'>['facts']): MemorySkill[] {
  const byId = new Map(facts.map(fact => [fact.id, fact]));
  const skills = new Map<string, MemorySkill>();
  for (const factId of groups.filter(group => group.category === 'skills').flatMap(group => group.factIds)) {
    const fact = byId.get(factId);
    if (!fact) continue;
    const terms = fact.text.split('·').map(text => text.trim());
    const independent = terms.length > 1 && terms.every(term => independentSkillLabels.has(term.toLocaleLowerCase()));
    for (const label of independent ? terms : [fact.text.trim()]) {
      if (!label) continue;
      const key = label.toLocaleLowerCase();
      const existing = skills.get(key);
      if (existing) { if (!existing.factIds.includes(factId)) existing.factIds.push(factId); }
      else skills.set(key, { label, factIds: [factId] });
    }
  }
  return [...skills.values()];
}

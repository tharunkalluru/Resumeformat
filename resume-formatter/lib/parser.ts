import { escapeHtml } from './formatMetrics';

export interface ContactInfo {
  name: string;
  linkedin?: string;
  website?: string;
  email?: string;
  phone?: string;
}

export interface JobExperience {
  title: string;
  company: string;
  location: string;
  dateRange: string;
  bullets: string[];
}

export interface Education {
  school: string;
  location: string;
  dateRange: string;
  degree: string;
  gpa?: string;
  coursework?: string;
}

export interface SkillCategory {
  label: string;
  skills: string;
}

export interface StartupEntry {
  role: string;
  description: string;
}

export interface ParsedResume {
  contact: ContactInfo;
  experience: JobExperience[];
  startups: StartupEntry[];
  skills: SkillCategory[];
  education: Education[];
  rawSections: Record<string, string>;
  targetCompany?: string;
  warnings: string[];
}

type SectionKind = 'EXPERIENCE' | 'EDUCATION' | 'SKILLS' | 'PROJECTS' | 'IGNORE';

const SECTION_ALIASES: Record<string, SectionKind> = {
  EXPERIENCE: 'EXPERIENCE',
  'WORK EXPERIENCE': 'EXPERIENCE',
  'PROFESSIONAL EXPERIENCE': 'EXPERIENCE',
  'RELEVANT EXPERIENCE': 'EXPERIENCE',
  'LEADERSHIP EXPERIENCE': 'EXPERIENCE',
  EMPLOYMENT: 'EXPERIENCE',
  'EMPLOYMENT HISTORY': 'EXPERIENCE',
  'EMPLOYMENT EXPERIENCE': 'EXPERIENCE',
  'WORK HISTORY': 'EXPERIENCE',
  'CAREER HISTORY': 'EXPERIENCE',
  EDUCATION: 'EDUCATION',
  'ACADEMIC BACKGROUND': 'EDUCATION',
  'ACADEMIC EXPERIENCE': 'EDUCATION',
  ACADEMICS: 'EDUCATION',
  'SKILLS & COMPETENCIES': 'SKILLS',
  SKILLS: 'SKILLS',
  'TECHNICAL SKILLS': 'SKILLS',
  'CORE COMPETENCIES': 'SKILLS',
  COMPETENCIES: 'SKILLS',
  'TOOLS & TECHNOLOGIES': 'SKILLS',
  TECHNOLOGIES: 'SKILLS',
  'TECHNICAL PROFICIENCIES': 'SKILLS',
  CERTIFICATIONS: 'SKILLS',
  'SIDE PROJECTS': 'PROJECTS',
  PROJECTS: 'PROJECTS',
  'PERSONAL PROJECTS': 'PROJECTS',
  'SELECTED PROJECTS': 'PROJECTS',
  'PROJECT EXPERIENCE': 'PROJECTS',
  'UNIVERSITY STARTUPS': 'PROJECTS',
  STARTUPS: 'PROJECTS',
  SUMMARY: 'IGNORE',
  'PROFESSIONAL SUMMARY': 'IGNORE',
  PROFILE: 'IGNORE',
  OBJECTIVE: 'IGNORE',
  AWARDS: 'IGNORE',
  HONORS: 'IGNORE',
  VOLUNTEERING: 'IGNORE',
  LEADERSHIP: 'IGNORE',
  ACTIVITIES: 'IGNORE',
  ACHIEVEMENTS: 'IGNORE',
  PUBLICATIONS: 'IGNORE',
  LANGUAGES: 'IGNORE',
  INTERESTS: 'IGNORE',
  REFERENCES: 'IGNORE',
  'ADDITIONAL INFORMATION': 'IGNORE',
};

const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\\.?';
const SEASON = '(?:Spring|Summer|Fall|Autumn|Winter)';
const DATE_VALUE = `(?:${MONTH}\\s+\\d{4}|${SEASON}\\s+\\d{4}|\\d{1,2}[/-]\\d{2,4}|\\d{4})`;
const DATE_RANGE_PATTERN = new RegExp(`(${DATE_VALUE})\\s*(?:[-–—]|to)\\s*(Present|Current|Now|Ongoing|${DATE_VALUE})`, 'i');
const BULLET_PATTERN = /^(?:[-–—−*•●▪◦○‣·➤►✓]|\d{1,2}[.)])\s*(.+)$/;
const TERMINAL_PUNCTUATION = /[.!?]["')\]]?$/;

interface DateMatch {
  raw: string;
  value: string;
}

interface ParsedSection {
  kind: SectionKind;
  label: string;
  startIndex: number;
  endIndex: number;
}

function cleanPastedLine(value: string): string {
  let line = value
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

  line = line
    .replace(/^>\s*/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/\\([@#*_|])/g, '$1')
    .replace(/\\+\s*$/, '')
    .trim();

  // Rich-text and AI tools commonly put Markdown emphasis around individual
  // fields (for example "**Role** | **Company**"). Keep the text, not the
  // formatting tokens, because the preview supplies its own typography.
  line = line.replace(/(\*\*|__)(.+?)\1/g, '$2').trim();

  const wrappedEmphasis = line.match(/^(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?[\s]*$/);
  if (wrappedEmphasis) line = wrappedEmphasis[1].trim();

  return line;
}

function normalizeSectionLabel(line: string): string {
  return line
    .replace(/^(?:\*\*|__)/, '')
    .replace(/(?:\*\*|__)$/, '')
    .replace(/:\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function getSection(line: string): { kind: SectionKind; label: string } | null {
  const label = normalizeSectionLabel(line);
  const kind = SECTION_ALIASES[label];
  return kind ? { kind, label } : null;
}

function isSectionHeader(line: string): boolean {
  return getSection(line) !== null;
}

function findDateRange(line: string): DateMatch | null {
  const match = line.match(DATE_RANGE_PATTERN);
  if (!match) return null;

  const end = /^(?:Current|Now|Ongoing)$/i.test(match[2]) ? 'Present' : match[2];
  return {
    raw: match[0],
    value: `${match[1].replace(/\s+/g, ' ').trim()} - ${end.replace(/\s+/g, ' ').trim()}`,
  };
}

function stripDate(line: string, date: DateMatch | null): string {
  if (!date) return line.trim();
  return line
    .replace(date.raw, '')
    .replace(/[|,;:\s-]+$/, '')
    .trim();
}

function isStandaloneDate(line: string, date: DateMatch): boolean {
  return stripDate(line, date).replace(/[()[\]|,:;\s]/g, '') === '';
}

function extractBullet(line: string): string | null {
  const match = line.match(BULLET_PATTERN);
  return match ? match[1].trim() : null;
}

function looksLikePersonName(line: string): boolean {
  const words = line.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  return words.every(word => /^[\p{L}][\p{L}'’.-]*$/u.test(word));
}

function looksLikeCompanyName(line: string): boolean {
  if (!line || line.length > 60 || isSectionHeader(line)) return false;
  if (/[@|●•]/.test(line)) return false;
  if (/\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line)) return false;
  return !/[\w.-]+@[\w.-]+\.\w+/.test(line);
}

function mergeSkillCategories(target: SkillCategory[], additions: SkillCategory[]) {
  for (const addition of additions) {
    const existing = target.find(item => item.label.toLowerCase() === addition.label.toLowerCase());
    if (!existing) {
      target.push(addition);
    } else if (!existing.skills.toLowerCase().includes(addition.skills.toLowerCase())) {
      existing.skills = `${existing.skills}, ${addition.skills}`;
    }
  }
}

export function parseResumeText(text: string): ParsedResume {
  const normalizedText = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n');
  const lines = normalizedText.split('\n').map(cleanPastedLine);

  const result: ParsedResume = {
    contact: { name: '' },
    experience: [],
    startups: [],
    skills: [],
    education: [],
    rawSections: {},
    warnings: [],
  };

  let currentIndex = 0;
  while (currentIndex < lines.length && !lines[currentIndex]) currentIndex++;

  if (currentIndex < lines.length) {
    const firstLine = lines[currentIndex];
    const followingLines = lines.slice(currentIndex + 1, currentIndex + 6).filter(Boolean);
    const nextLine = followingLines[0] || '';
    const hasContactInfoSoon = followingLines.slice(1).some(line =>
      /[@●•|]/.test(line) || /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(line)
    );

    if (
      hasContactInfoSoon &&
      looksLikeCompanyName(firstLine) &&
      looksLikePersonName(nextLine)
    ) {
      result.targetCompany = firstLine;
      currentIndex++;
      while (currentIndex < lines.length && !lines[currentIndex]) currentIndex++;
    }
  }

  if (currentIndex < lines.length && !isSectionHeader(lines[currentIndex])) {
    result.contact.name = lines[currentIndex];
    currentIndex++;
  }

  for (let i = currentIndex; i < Math.min(currentIndex + 6, lines.length); i++) {
    const line = lines[i];
    if (!line) continue;
    if (isSectionHeader(line)) break;

    const parts = line
      .split(/[●•|]\s*|\s{3,}/)
      .map(part => part.replace(/^[-•●]\s*/, '').trim())
      .filter(Boolean);

    for (const part of parts) {
      const email = part.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
      const phone = part.match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/)?.[0];
      const linkedin = part.match(/(?:https?:\/\/(?:www\.)?linkedin\.com\/)?in\/[\w-]+\/?/i)?.[0];
      const website = part.match(/(?:https?:\/\/)?(?:www\.)?[\w-]+(?:\.[\w-]+)+\/?/i)?.[0];

      if (email) result.contact.email = email;
      else if (phone) result.contact.phone = phone;
      else if (linkedin || /linkedin/i.test(part)) result.contact.linkedin = linkedin || part;
      else if (website && !/@|linkedin/i.test(part)) result.contact.website = website;
    }
  }

  const sections: ParsedSection[] = [];
  for (let i = 0; i < lines.length; i++) {
    const section = getSection(lines[i]);
    if (section) {
      sections.push({ ...section, startIndex: i, endIndex: lines.length });
    }
  }
  for (let i = 0; i < sections.length - 1; i++) {
    sections[i].endIndex = sections[i + 1].startIndex;
  }

  for (const section of sections) {
    const sectionLines = lines.slice(section.startIndex + 1, section.endIndex);
    const content = sectionLines.filter(Boolean).join('\n');
    result.rawSections[section.label] = result.rawSections[section.label]
      ? `${result.rawSections[section.label]}\n${content}`
      : content;

    switch (section.kind) {
      case 'EXPERIENCE':
        result.experience.push(...parseExperience(sectionLines));
        break;
      case 'EDUCATION':
        result.education.push(...parseEducation(sectionLines));
        break;
      case 'SKILLS': {
        const defaultLabel = section.label === 'CERTIFICATIONS' ? 'Certifications' : 'Skills';
        mergeSkillCategories(result.skills, parseSkills(sectionLines, defaultLabel));
        break;
      }
      case 'PROJECTS':
        result.startups.push(...parseProjects(sectionLines));
        break;
      case 'IGNORE':
        break;
    }
  }

  const recognizedSections = sections.filter(section => section.kind !== 'IGNORE');
  if (!recognizedSections.length) {
    result.warnings.push('No supported section headings were found. Add headings such as EXPERIENCE, SIDE PROJECTS, or SKILLS.');
  } else if (sections.some(section => section.kind === 'EXPERIENCE') && !result.experience.length) {
    result.warnings.push('The EXPERIENCE section was found, but no jobs were recognized. Use a header such as “Role | Company | Jan 2023 - Present”.');
  }

  return result;
}

function parseDelimitedJobHeader(line: string): JobExperience | null {
  if (extractBullet(line) !== null) return null;

  const date = findDateRange(line);
  const hasPipe = line.includes('|');
  const hasTab = /\t/.test(line);
  let parts = hasPipe || hasTab
    ? line.split(hasPipe ? /\s*\|\s*/ : /\t+/).map(part => part.trim()).filter(Boolean)
    : [];

  if (parts.length >= 2) {
    parts = parts.map(part => stripDate(part, date)).filter(Boolean);
    let title = parts[0] || '';
    let company = parts[1] || '';
    let location = parts.slice(2).join(' | ');

    // "Title at Company | Date", "Title, Company | Date", and
    // "Title — Company | Date" are common two-column exports.
    if (parts.length === 1 && date) {
      const split = splitTitleAndCompany(parts[0]);
      if (split) ({ title, company } = split);
    } else if (!company && date) {
      const split = splitTitleAndCompany(title);
      if (split) ({ title, company } = split);
    }

    if (title && company) {
      return { title, company, location, dateRange: date?.value || '', bullets: [] };
    }
  }

  if (date) {
    const body = stripDate(line, date);
    const split = splitTitleAndCompany(body);
    if (split) {
      return { ...split, location: '', dateRange: date.value, bullets: [] };
    }
  }

  return null;
}

function splitTitleAndCompany(value: string): { title: string; company: string } | null {
  const patterns = [
    /^(.+?)\s+at\s+(.+)$/i,
    /^(.+?)\s+[–—-]\s+(.+)$/,
    /^([^,]+),\s*(.+)$/,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1] && match[2]) {
      return { title: match[1].trim(), company: match[2].trim() };
    }
  }
  return null;
}

function parseStackedJobHeader(lines: string[], index: number): { job: JobExperience; consumed: number } | null {
  const title = lines[index]?.trim();
  const companyLine = lines[index + 1]?.trim();
  if (!title || !companyLine || title.length > 120 || findDateRange(title) || extractBullet(title)) return null;
  if (extractBullet(companyLine) || isSectionHeader(companyLine)) return null;

  let date = findDateRange(companyLine);
  let consumed = 1;

  if (!date) {
    const candidate = lines[index + 2]?.trim();
    const candidateDate = candidate ? findDateRange(candidate) : null;
    if (!candidate || !candidateDate || !isStandaloneDate(candidate, candidateDate)) return null;
    date = candidateDate;
    consumed = 2;
  }

  const delimiter = companyLine.includes('|') ? /\s*\|\s*/ : /\t+/;
  const parts = (companyLine.includes('|') || /\t/.test(companyLine)
    ? companyLine.split(delimiter)
    : [companyLine]
  )
    .map(part => stripDate(part.trim(), date))
    .filter(Boolean);
  if (!parts.length || !date) return null;

  return {
    job: {
      title,
      company: parts[0],
      location: parts.slice(1).join(' | '),
      dateRange: date.value,
      bullets: [],
    },
    consumed,
  };
}

function parseExperience(lines: string[]): JobExperience[] {
  const experiences: JobExperience[] = [];
  let current: JobExperience | null = null;
  let lastLineWasBullet = false;

  const commitCurrent = () => {
    if (current) experiences.push(current);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) {
      lastLineWasBullet = false;
      continue;
    }

    const stacked = parseStackedJobHeader(lines, i);
    if (stacked) {
      commitCurrent();
      current = stacked.job;
      i += stacked.consumed;
      lastLineWasBullet = false;
      continue;
    }

    const header = parseDelimitedJobHeader(line);
    if (header) {
      commitCurrent();
      current = header;
      lastLineWasBullet = false;
      continue;
    }

    if (!current) continue;

    const bullet = extractBullet(line);
    if (bullet !== null) {
      current.bullets.push(bullet);
      lastLineWasBullet = true;
      continue;
    }

    const date = findDateRange(line);
    if (date && isStandaloneDate(line, date)) {
      if (!current.dateRange) current.dateRange = date.value;
      lastLineWasBullet = false;
      continue;
    }

    const previous = current.bullets[current.bullets.length - 1];
    const looksLikeContinuation = Boolean(
      previous &&
      lastLineWasBullet &&
      (!TERMINAL_PUNCTUATION.test(previous) || /^[a-z(]/.test(line))
    );

    if (looksLikeContinuation) {
      current.bullets[current.bullets.length - 1] = `${previous} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      current.bullets.push(line);
      lastLineWasBullet = false;
    }
  }

  commitCurrent();
  return experiences;
}

function looksLikeSchool(line: string): boolean {
  return /\b(?:University|College|Institute|School|Academy)\b/i.test(line);
}

function parseEducation(lines: string[]): Education[] {
  const education: Education[] = [];
  let current: Education | null = null;

  const commitCurrent = () => {
    if (current) education.push(current);
  };

  for (const line of lines) {
    if (!line) continue;
    const date = findDateRange(line);

    if (looksLikeSchool(line)) {
      commitCurrent();
      const body = stripDate(line, date);
      const parts = body.includes('|')
        ? body.split(/\s*\|\s*/)
        : body.split(/,\s*/);
      current = {
        school: parts.shift()?.trim() || body,
        location: parts.join(', ').trim(),
        dateRange: date?.value || '',
        degree: '',
      };
      continue;
    }

    if (!current) continue;
    if (date && isStandaloneDate(line, date)) {
      if (!current.dateRange) current.dateRange = date.value;
      continue;
    }

    const gpa = line.match(/\b(?:CGPA|GPA)\s*:?\s*([\d.]+(?:\s*\/\s*[\d.]+)?)/i)?.[1];
    const coursework = line.match(/(?:Selected\s+|Relevant\s+)?Coursework\s*:\s*(.+)/i)?.[1];
    if (coursework) {
      current.coursework = coursework.trim();
      continue;
    }
    if (gpa) current.gpa = gpa.replace(/\s+/g, '');

    if (/\b(?:Master|Bachelor|PhD|Doctor|Associate|M\.?S\.?|B\.?S\.?|M\.?A\.?|B\.?A\.?)\b/i.test(line)) {
      current.degree = line
        .replace(/^(?:[-*•●▪◦○‣·➤►]|\d{1,2}[.)])\s*/, '')
        .replace(/\s*\b(?:CGPA|GPA)\s*:?\s*[\d.]+(?:\s*\/\s*[\d.]+)?/i, '')
        .trim();
    }
  }

  commitCurrent();
  return education;
}

function parseSkills(lines: string[], defaultLabel: string): SkillCategory[] {
  const skills: SkillCategory[] = [];

  for (const rawLine of lines) {
    if (!rawLine) continue;
    const cleanLine = extractBullet(rawLine) ?? rawLine;
    const segments = cleanLine.split(/;\s*(?=[A-Za-z][^:]{0,40}:)/);

    for (const segment of segments) {
      const colonIndex = segment.indexOf(':');
      if (colonIndex > 0) {
        const label = segment.slice(0, colonIndex).trim();
        const content = segment.slice(colonIndex + 1).trim();
        if (label && content && label.length <= 50) {
          mergeSkillCategories(skills, [{ label, skills: content }]);
        }
      } else if (segment.trim()) {
        const target = skills[skills.length - 1];
        if (target) target.skills = `${target.skills}, ${segment.trim()}`;
        else skills.push({ label: defaultLabel, skills: segment.trim() });
      }
    }
  }

  return skills;
}

function parseProjects(lines: string[]): StartupEntry[] {
  const projects: StartupEntry[] = [];

  for (const rawLine of lines) {
    if (!rawLine) continue;
    let line = extractBullet(rawLine) ?? rawLine;
    line = line.replace(/Co\s*[-–—]\s*founder/gi, 'Co-founder').trim();

    const match = line.match(/^(.+?):\s+(.+)$/) ||
      line.match(/^(.+?,\s*.+?)\s+[-–—]\s+(.+)$/) ||
      line.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (match) {
      projects.push({ role: match[1].trim(), description: match[2].trim() });
      continue;
    }

    const previous = projects[projects.length - 1];
    if (previous && (!TERMINAL_PUNCTUATION.test(previous.description) || /^[a-z(]/.test(line))) {
      previous.description = `${previous.description} ${line}`.replace(/\s+/g, ' ').trim();
    } else {
      projects.push({ role: '', description: line });
    }
  }

  return projects;
}

export function resumeToHTML(parsed: ParsedResume): string {
  let html = `<h1>${escapeHtml(parsed.contact.name)}</h1>\n`;
  const contactParts = [parsed.contact.linkedin, parsed.contact.website, parsed.contact.email, parsed.contact.phone]
    .filter((part): part is string => Boolean(part))
    .map(escapeHtml);
  if (contactParts.length) html += `<p>${contactParts.join(' • ')}</p>\n`;

  if (parsed.experience.length) {
    html += '<h2>EXPERIENCE</h2>\n';
    for (const job of parsed.experience) {
      const heading = [job.title, job.company, job.location].filter(Boolean).map(escapeHtml).join(' | ');
      html += `<h3>${heading}</h3>\n`;
      if (job.dateRange) html += `<p><em>${escapeHtml(job.dateRange)}</em></p>\n`;
      if (job.bullets.length) {
        html += `<ul>\n${job.bullets.map(bullet => `<li>${escapeHtml(bullet)}</li>`).join('\n')}\n</ul>\n`;
      }
    }
  }

  if (parsed.startups.length) {
    html += '<h2>SIDE PROJECTS</h2>\n';
    for (const project of parsed.startups) {
      const text = project.role ? `${project.role} - ${project.description}` : project.description;
      html += `<p>${escapeHtml(text)}</p>\n`;
    }
  }

  if (parsed.skills.length) {
    html += '<h2>SKILLS & COMPETENCIES</h2>\n';
    for (const category of parsed.skills) {
      html += `<p><strong>${escapeHtml(category.label)}:</strong> ${escapeHtml(category.skills)}</p>\n`;
    }
  }

  if (parsed.education.length) {
    html += '<h2>EDUCATION</h2>\n';
    for (const education of parsed.education) {
      const school = [education.school, education.location].filter(Boolean).map(escapeHtml).join(', ');
      html += `<h3>${school}</h3>\n`;
      if (education.dateRange) html += `<p><em>${escapeHtml(education.dateRange)}</em></p>\n`;
      if (education.degree) html += `<p>${escapeHtml(education.degree)}</p>\n`;
      if (education.gpa) html += `<p>CGPA: ${escapeHtml(education.gpa)}</p>\n`;
      if (education.coursework) html += `<p>Selected Coursework: ${escapeHtml(education.coursework)}</p>\n`;
    }
  }

  return html;
}

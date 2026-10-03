import { ParsedResume } from './parser';
import { RESUME_PROFILE } from './profile';

export interface DocumentNode {
  type: 'doc' | 'paragraph' | 'heading' | 'bulletList' | 'orderedList' | 'listItem' | 'text' | 'hardBreak';
  attrs?: { level?: number; start?: number };
  content?: DocumentNode[];
  text?: string;
  marks?: { type: 'bold' | 'italic' | 'underline' }[];
}

const inline = (value: string, marks?: DocumentNode['marks']): DocumentNode => ({
  type: 'text', text: value, ...(marks ? { marks } : {}),
});
const paragraph = (...content: DocumentNode[]): DocumentNode => ({ type: 'paragraph', content });
const heading = (level: number, value: string): DocumentNode => ({ type: 'heading', attrs: { level }, content: [inline(value)] });

/** The canvas starts with this document and then owns every character in it. */
export function resumeToDocument(resume: ParsedResume, overrideEmail?: string, rawText?: string): DocumentNode {
  const contact = RESUME_PROFILE.contact;
  const education = RESUME_PROFILE.education;
  if (!resume.experience.length && !resume.startups.length && !resume.skills.length && rawText?.trim()) {
    const lines = rawText.replace(/\r\n?/g, '\n').split('\n');
    const first = lines.findIndex(line => !!line.trim());
    return { type: 'doc', content: lines.slice(first).map((line, index) => index === 0
      ? heading(1, line.trim())
      : paragraph(...(line ? [inline(line)] : []))) };
  }
  const parsedContact = resume.contact;
  const blocks: DocumentNode[] = [
    heading(1, parsedContact.name || contact.name),
    paragraph(inline([
      parsedContact.linkedin || contact.linkedin,
      parsedContact.website || contact.portfolio,
      overrideEmail || parsedContact.email || contact.email,
      parsedContact.phone || contact.phone,
    ].filter(Boolean).join('  •  '))),
  ];

  if (resume.experience.length) {
    blocks.push(heading(2, 'EXPERIENCE'));
    for (const job of resume.experience) {
      blocks.push(paragraph(
        inline([job.title, job.company, job.location].filter(Boolean).join(' | '), [{ type: 'bold' }]),
        ...(job.dateRange ? [inline(`  ${job.dateRange}`, [{ type: 'italic' }])] : []),
      ));
      if (job.bullets.length) blocks.push({
        type: 'bulletList',
        content: job.bullets.map(bullet => ({ type: 'listItem', content: [paragraph(inline(bullet))] })),
      });
    }
  }
  if (resume.startups.length) {
    blocks.push(heading(2, RESUME_PROFILE.projectSectionTitle));
    for (const project of resume.startups) {
      blocks.push(paragraph(
        ...(project.role ? [inline(project.role, [{ type: 'bold' }])] : []),
        ...(project.description ? [inline(`${project.role ? ' - ' : ''}${project.description}`)] : []),
      ));
    }
  }
  if (resume.skills.length) {
    blocks.push(heading(2, 'SKILLS & COMPETENCIES'));
    for (const skill of resume.skills) {
      blocks.push(paragraph(inline(`${skill.label}: `, [{ type: 'bold' }]), inline(skill.skills)));
    }
  }
  blocks.push(heading(2, 'EDUCATION'));
  const entries = resume.education.length ? resume.education : [{
    school: education.school, location: education.location, dateRange: education.dateRange,
    degree: education.degree, gpa: education.gpa, coursework: education.coursework,
  }];
  for (const entry of entries) {
    blocks.push(paragraph(
      inline([entry.school, entry.location].filter(Boolean).join(', '), [{ type: 'bold' }]),
      ...(entry.dateRange ? [inline(`  ${entry.dateRange}`, [{ type: 'italic' }])] : []),
    ));
    if (entry.degree || entry.gpa) blocks.push(paragraph(inline(`${entry.degree}${entry.gpa ? `  ${education.gpaLabel}: ${entry.gpa}` : ''}`)));
    if (entry.coursework) blocks.push(paragraph(inline(`Selected Coursework: ${entry.coursework}`)));
  }
  for (const [section, content] of Object.entries(resume.rawSections)) {
    if (!['SUMMARY', 'PROFESSIONAL SUMMARY', 'PROFILE', 'OBJECTIVE', 'AWARDS', 'HONORS', 'VOLUNTEERING', 'LEADERSHIP', 'ACTIVITIES', 'ACHIEVEMENTS', 'PUBLICATIONS', 'LANGUAGES', 'INTERESTS', 'REFERENCES', 'ADDITIONAL INFORMATION'].includes(section)) continue;
    blocks.push(heading(2, section));
    blocks.push(...content.split('\n').filter(Boolean).map(line => paragraph(inline(line))));
  }
  return { type: 'doc', content: blocks };
}

/** Accept only the editor's small semantic schema; reject excessive or malformed input. */
export function validateDocument(value: unknown): DocumentNode {
  let nodes = 0;
  let characters = 0;
  const visit = (input: unknown, depth: number): DocumentNode => {
    if (!input || typeof input !== 'object' || Array.isArray(input) || depth > 8) {
      throw new TypeError('document contains an invalid node.');
    }
    const node = input as Record<string, unknown>;
    const type = node.type;
    if (!['doc', 'paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'text', 'hardBreak'].includes(String(type))) {
      throw new TypeError('document contains an unsupported node.');
    }
    if (++nodes > 2_000) throw new TypeError('document has too many nodes.');
    if (type === 'text') {
      if (typeof node.text !== 'string') throw new TypeError('document text must be a string.');
      characters += node.text.length;
      if (characters > 100_000) throw new TypeError('document is too long.');
      const rawMarks = node.marks ?? [];
      if (!Array.isArray(rawMarks) || rawMarks.length > 3 || rawMarks.some(mark =>
        !mark || typeof mark !== 'object' || !['bold', 'italic', 'underline'].includes(String((mark as Record<string, unknown>).type))
      )) throw new TypeError('document has unsupported text formatting.');
      return { type: 'text', text: node.text, marks: rawMarks.map(mark => ({ type: (mark as { type: 'bold' | 'italic' | 'underline' }).type })) };
    }
    if (type === 'hardBreak') return { type: 'hardBreak' };
    const rawContent = node.content ?? (['paragraph', 'heading', 'listItem'].includes(String(type)) ? [] : undefined);
    if (!Array.isArray(rawContent)) throw new TypeError('document nodes must have content arrays.');
    const content = rawContent.map(child => visit(child, depth + 1));
    const childTypes = content.map(child => child.type);
    const allowed = type === 'doc' ? ['paragraph', 'heading', 'bulletList', 'orderedList']
      : type === 'bulletList' || type === 'orderedList' ? ['listItem']
      : type === 'listItem' ? ['paragraph', 'bulletList', 'orderedList'] : ['text', 'hardBreak'];
    if (childTypes.some(child => !allowed.includes(child))) throw new TypeError('document has an invalid structure.');
    if (type === 'doc' && (!content.length || !characters)) throw new TypeError('document cannot be empty.');
    const result: DocumentNode = { type: type as DocumentNode['type'], content };
    if (type === 'heading') {
      const level = (node.attrs as Record<string, unknown> | undefined)?.level;
      if (![1, 2, 3].includes(Number(level))) throw new TypeError('heading level must be 1, 2, or 3.');
      result.attrs = { level: Number(level) };
    }
    if (type === 'orderedList') {
      const start = Number((node.attrs as Record<string, unknown> | undefined)?.start ?? 1);
      if (!Number.isInteger(start) || start < 1 || start > 999) throw new TypeError('ordered list start is invalid.');
      result.attrs = { start };
    }
    return result;
  };
  const document = visit(value, 0);
  if (document.type !== 'doc') throw new TypeError('document must be a doc node.');
  return document;
}

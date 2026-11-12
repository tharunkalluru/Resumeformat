import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { Bullet, StructuredResume, TemplateId } from './model';

/** One column, real text, standard section names: every template reads cleanly in applicant-tracking systems. */
export type Paper = 'letter' | 'a4';
const PAPER: Record<Paper, [number, number]> = { letter: [612, 792], a4: [595.28, 841.89] };
const INK = rgb(0.07, 0.07, 0.07), MUTED = rgb(0.33, 0.33, 0.32), RULE = rgb(0.78, 0.78, 0.76);

/** The templates differ in spacing, header alignment and one accent colour; content and order are the same. */
interface Look { margin: number; size: number; centered: boolean; accent: ReturnType<typeof rgb> | null; rule: ReturnType<typeof rgb>; name: number }
const LOOKS: Record<TemplateId, Look> = {
  classic: { margin: 46, size: 1, centered: false, accent: null, rule: RULE, name: 21 },
  modern: { margin: 50, size: 1, centered: true, accent: rgb(0.09, 0.27, 0.45), rule: rgb(0.62, 0.72, 0.82), name: 23 },
  compact: { margin: 36, size: 0.9, centered: false, accent: null, rule: RULE, name: 19 },
};
export const TEMPLATES: { id: TemplateId; label: string }[] = [{ id: 'classic', label: 'Classic' }, { id: 'modern', label: 'Modern' }, { id: 'compact', label: 'Compact' }];

type Face = 'regular' | 'bold' | 'italic';
// Small Latin-only fonts keep a download under 100 KB. Text with other characters uses the full fonts, then DejaVu.
const FILES: Record<Face, [string, string, string]> = {
  regular: ['structured/Inter-Regular-Latin.ttf', 'structured/Inter-Regular.ttf', 'DejaVuSans.ttf'],
  bold: ['structured/Inter-SemiBold-Latin.ttf', 'structured/Inter-SemiBold.ttf', 'DejaVuSans-Bold.ttf'],
  italic: ['structured/Inter-Italic-Latin.ttf', 'structured/Inter-Italic.ttf', 'DejaVuSans-Oblique.ttf'],
};
const coverage = new Map<string, Promise<Set<number>>>();
/** The characters a font file can draw. */
function covers(file: string): Promise<Set<number>> {
  let pending = coverage.get(file);
  if (!pending) {
    pending = (async () => { const probe = await PDFDocument.create(); probe.registerFontkit(fontkit); return new Set((await probe.embedFont(await loadFont(file), { subset: false })).getCharacterSet()); })();
    pending.catch(() => coverage.delete(file)); coverage.set(file, pending);
  }
  return pending;
}
const fontBytes = new Map<string, Promise<Uint8Array>>();
function loadFont(file: string): Promise<Uint8Array> {
  let pending = fontBytes.get(file);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}fonts/${file}`).then(async response => {
      if (!response.ok) throw new Error('A font for this template could not be loaded. Check your connection and try again.');
      return new Uint8Array(await response.arrayBuffer());
    });
    pending.catch(() => fontBytes.delete(file)); fontBytes.set(file, pending);
  }
  return pending;
}

interface Fonts { face: Record<Face, PDFFont>; fallback: Partial<Record<Face, PDFFont>>; covered: Set<number> }
type Segment = { text: string; font: PDFFont };

/** Ids of changed bullets (and 'summary') to tint in the on-screen preview. Never used for downloads. */
export type Highlight = ReadonlySet<string>;
const TINT = rgb(0.996, 0.953, 0.78);
/** Where an editable line sits on a page, as fractions of the page, so the preview can make it clickable. */
export interface Region { key: string; page: number; left: number; top: number; width: number; height: number }
export interface Rendered { bytes: Uint8Array; pages: number; tightened: boolean; regions: Region[] }

async function render(resume: StructuredResume, paper: Paper, template: TemplateId, tighten: number, highlight?: Highlight) {
  const look = LOOKS[template] ?? LOOKS.classic, scale = look.size * tighten;
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  pdf.setTitle(`${resume.name} — Resume`); pdf.setAuthor(resume.name); pdf.setCreator('Folio');
  // Each face needs its own name, or viewers treat the subsets as one font and drop glyphs.
  const embed = async (file: string) => pdf.embedFont(await loadFont(file), { subset: false, customName: `Folio-${file.replace(/^.*\//, '').replace(/\.ttf$/, '')}`, features: { kern: false, liga: false, clig: false, calt: false } });
  const used = [...new Set([...JSON.stringify(resume)].filter(char => char > ' ').map(char => char.codePointAt(0)!))];
  const lacks = async (file: string) => { const set = await covers(file); return used.some(code => !set.has(code)); };
  const tier = await lacks(FILES.regular[0]) ? 1 : 0;
  const fonts: Fonts = { face: { regular: await embed(FILES.regular[tier]), bold: await embed(FILES.bold[tier]), italic: await embed(FILES.italic[tier]) }, fallback: {}, covered: await covers(FILES.regular[tier]) };
  // Characters the main font lacks (other scripts, rare symbols) are drawn with a wide-coverage font.
  if (tier === 1 && await lacks(FILES.regular[1]))
    for (const face of ['regular', 'bold', 'italic'] as Face[]) fonts.fallback[face] = await embed(FILES[face][2]);

  const [width, height] = PAPER[paper], margin = look.margin, right = width - margin, s = (value: number) => value * scale;
  let page: PDFPage = pdf.addPage([width, height]), y = height - margin, pageIndex = 0;
  const room = (needed: number) => { if (y - needed < margin) { page = pdf.addPage([width, height]); y = height - margin; pageIndex += 1; } };
  const regions: Region[] = [];
  /** Adds the line just drawn (baseline at y) to the clickable area of `key`. */
  const mark = (key: string, x: number, leading: number) => {
    const top = (height - y - leading * 0.78) / height, left = (x - 3) / width, wide = (right - x + 6) / width, tall = leading / height;
    const last = regions.at(-1);
    if (last?.key === key && last.page === pageIndex) last.height = top + tall - last.top; else regions.push({ key, page: pageIndex, left, top, width: wide, height: tall });
  };

  const split = (text: string, face: Face): Segment[] => {
    const out: Segment[] = [], other = fonts.fallback[face];
    for (const char of text.replace(/[\u0000-\u001f\u007f]/g, ' ')) {
      const font = !other || fonts.covered.has(char.codePointAt(0)!) ? fonts.face[face] : other, last = out.at(-1);
      if (last?.font === font) last.text += char; else out.push({ text: char, font });
    }
    return out;
  };
  const measure = (text: string, face: Face, size: number) => split(text, face).reduce((total, part) => total + part.font.widthOfTextAtSize(part.text, size), 0);
  const draw = (text: string, x: number, face: Face, size: number, color = INK) => {
    for (const part of split(text, face)) { page.drawText(part.text, { x, y, size, font: part.font, color }); x += part.font.widthOfTextAtSize(part.text, size); }
  };
  const wrap = (text: string, face: Face, size: number, max: number): string[] => {
    const lines: string[] = []; let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, face, size) > max) { lines.push(line); line = word; } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const tint = (x: number, leading: number) => page.drawRectangle({ x: x - 3, y: y - leading * 0.26, width: right - x + 6, height: leading, color: TINT });
  const paragraph = (text: string, face: Face, size: number, leading: number, x = margin, color = INK, marked = false, key = '', center = false) => {
    for (const line of wrap(text, face, size, right - x)) { room(leading); y -= leading; if (marked) tint(x, leading); if (key) mark(key, x, leading); draw(line, center ? (width - measure(line, face, size)) / 2 : x, face, size, color); }
  };
  const section = (title: string) => {
    room(s(48)); y -= s(20);
    draw(title.toUpperCase(), margin, 'bold', s(9), look.accent ?? INK);
    y -= s(4.5); page.drawLine({ start: { x: margin, y }, end: { x: right, y }, thickness: look.accent ? 0.9 : 0.6, color: look.rule }); y -= s(2.5);
  };
  /** Left text with a right-aligned note (dates) on the same line; the left side wraps short of the note. */
  const heading = (left: string, note: string, size: number) => {
    const noteWidth = note ? measure(note, 'regular', s(9.4)) + s(12) : 0, lines = wrap(left, 'bold', size, right - margin - noteWidth);
    lines.forEach((line, index) => {
      room(s(14)); y -= s(index ? 13 : 14.5); draw(line, margin, 'bold', size);
      if (!index && note) draw(note, right - measure(note, 'regular', s(9.4)), 'regular', s(9.4), MUTED);
    });
  };
  const bullets = (items: Bullet[] | string[]) => {
    for (const item of items) {
      const text = typeof item === 'string' ? item : item.text, lines = wrap(text, 'regular', s(9.8), right - margin - s(11));
      const marked = typeof item !== 'string' && !!highlight?.has(item.id);
      lines.forEach((line, index) => { room(s(13.6)); y -= s(13.6); if (marked) tint(margin + s(11), s(13.6)); if (typeof item !== 'string') mark(`bullet:${item.id}`, margin + s(11), s(13.6)); if (!index) draw('•', margin + s(1), 'regular', s(9.8), MUTED); draw(line, margin + s(11), 'regular', s(9.8)); });
    }
  };

  const head = (text: string, face: Face, size: number, color = INK) => draw(text, look.centered ? Math.max(margin, (width - measure(text, face, size)) / 2) : margin, face, size, color);
  y -= s(look.name); head(resume.name, 'bold', s(look.name), look.accent ?? INK);
  if (resume.headline) { y -= s(15); head(resume.headline, 'regular', s(11), MUTED); }
  if (resume.contact.length) { y -= s(3); paragraph(resume.contact.join('  ·  '), 'regular', s(9.2), s(13), margin, MUTED, false, '', look.centered); }
  if (resume.summary) { section('Summary'); y -= s(1); paragraph(resume.summary, 'regular', s(9.8), s(14), margin, INK, !!highlight?.has('summary'), 'summary'); }
  if (resume.experience.length) {
    section('Experience');
    for (const role of resume.experience) {
      heading(role.title || role.company, role.dates, s(10.4));
      const place = [role.title ? role.company : '', role.location].filter(Boolean).join(' · ');
      if (place) paragraph(place, 'italic', s(9.6), s(13), margin, MUTED);
      y -= s(1.5); bullets(role.bullets); y -= s(5);
    }
    y += s(5);
  }
  if (resume.projects.length) {
    section('Projects');
    for (const project of resume.projects) {
      heading(project.name, project.dates, s(10.2));
      if (project.link) paragraph(project.link, 'regular', s(9.2), s(12.6), margin, MUTED);
      y -= s(1.5); bullets(project.bullets); y -= s(5);
    }
    y += s(5);
  }
  if (resume.education.length) {
    section('Education');
    for (const item of resume.education) {
      heading(item.degree || item.school, item.dates, s(10.2));
      const place = [item.degree ? item.school : '', item.location].filter(Boolean).join(' · ');
      if (place) paragraph(place, 'italic', s(9.6), s(13), margin, MUTED);
      for (const detail of item.details) paragraph(detail, 'regular', s(9.6), s(13.2));
      y -= s(4);
    }
    y += s(4);
  }
  if (resume.skills.length) {
    section('Skills'); y -= s(1);
    for (const group of resume.skills) {
      const label = group.label ? `${group.label}: ` : '', indent = label ? measure(label, 'bold', s(9.8)) : 0;
      const lines = wrap(group.items.join(', '), 'regular', s(9.8), right - margin - indent);
      lines.forEach((line, index) => { room(s(14)); y -= s(14); if (!index && label) draw(label, margin, 'bold', s(9.8)); draw(line, margin + indent, 'regular', s(9.8)); });
    }
  }
  for (const extra of resume.extras) { section(extra.title); y -= s(1); bullets(extra.items); }

  return { bytes: await pdf.save(), pages: pdf.getPageCount(), regions };
}

/** Renders the resume, tightening slightly when that brings a near-miss back onto one page. */
export async function renderResumePdf(resume: StructuredResume, paper: Paper, template: TemplateId = 'classic', highlight?: Highlight): Promise<Rendered> {
  const full = await render(resume, paper, template, 1, highlight);
  if (full.pages === 1) return { ...full, tightened: false };
  for (const tighten of [0.95, 0.9]) { const tight = await render(resume, paper, template, tighten, highlight); if (tight.pages === 1) return { ...tight, tightened: true }; }
  return { ...full, tightened: false };
}

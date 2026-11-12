import JSZip from 'jszip';
import type { Paper } from './pdf';
import type { StructuredResume, TemplateId } from './model';

/** A plain, editable Word file with the same content and order as the PDF. */
const esc = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
type Run = { text: string; bold?: boolean; italic?: boolean; size?: number; color?: string; tab?: boolean };
/** Compact templates set every run two half-points smaller. */
let shrink = 0;
const run = ({ text, bold, italic, size = 20, color, tab }: Run) =>
  `<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>${bold ? '<w:b/>' : ''}${italic ? '<w:i/>' : ''}${color ? `<w:color w:val="${color}"/>` : ''}<w:sz w:val="${size - shrink}"/><w:szCs w:val="${size - shrink}"/></w:rPr>${tab ? '<w:tab/>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
const para = (runs: Run[], options: { before?: number; after?: number; bullet?: boolean; rightTab?: number; rule?: string; center?: boolean } = {}) =>
  `<w:p><w:pPr>${options.center ? '<w:jc w:val="center"/>' : ''}${options.bullet ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}${options.rule ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="2" w:color="${options.rule}"/></w:pBdr>` : ''}${options.rightTab ? `<w:tabs><w:tab w:val="right" w:pos="${options.rightTab}"/></w:tabs>` : ''}<w:spacing w:before="${options.before ?? 0}" w:after="${options.after ?? 0}" w:line="264" w:lineRule="auto"/></w:pPr>${runs.map(item => run(item)).join('')}</w:p>`;

export async function renderResumeDocx(resume: StructuredResume, paper: Paper, template: TemplateId = 'classic'): Promise<Blob> {
  const modern = template === 'modern', compact = template === 'compact', accent = modern ? '17456F' : undefined;
  const [width, height] = paper === 'a4' ? [11906, 16838] : [12240, 15840], margin = compact ? 720 : modern ? 1000 : 920, text = width - margin * 2, MUTED = '555552';
  shrink = compact ? 2 : 0;
  const body: string[] = [];
  const section = (title: string) => body.push(para([{ text: title.toUpperCase(), bold: true, size: 18, color: accent }], { before: compact ? 160 : 220, after: compact ? 50 : 80, rule: modern ? '9EB8D1' : 'C8C8C4' }));
  const heading = (left: string, note: string) => body.push(para([{ text: left, bold: true, size: 21 }, ...(note ? [{ text: note, size: 19, color: MUTED, tab: true }] : [])], { before: 100, rightTab: text }));
  const bullets = (items: string[]) => items.forEach(item => body.push(para([{ text: item }], { bullet: true })));

  body.push(para([{ text: resume.name, bold: true, size: modern ? 46 : 42, color: accent }], { center: modern }));
  if (resume.headline) body.push(para([{ text: resume.headline, size: 22, color: MUTED }], { center: modern }));
  if (resume.contact.length) body.push(para([{ text: resume.contact.join('  ·  '), size: 18, color: MUTED }], { before: 40, center: modern }));
  if (resume.summary) { section('Summary'); body.push(para([{ text: resume.summary }])); }
  if (resume.experience.length) {
    section('Experience');
    for (const role of resume.experience) {
      heading(role.title || role.company, role.dates);
      const place = [role.title ? role.company : '', role.location].filter(Boolean).join(' · ');
      if (place) body.push(para([{ text: place, italic: true, size: 19, color: MUTED }], { after: 30 }));
      bullets(role.bullets.map(bullet => bullet.text));
    }
  }
  if (resume.projects.length) {
    section('Projects');
    for (const project of resume.projects) {
      heading(project.name, project.dates);
      if (project.link) body.push(para([{ text: project.link, size: 18, color: MUTED }], { after: 30 }));
      bullets(project.bullets.map(bullet => bullet.text));
    }
  }
  if (resume.education.length) {
    section('Education');
    for (const item of resume.education) {
      heading(item.degree || item.school, item.dates);
      const place = [item.degree ? item.school : '', item.location].filter(Boolean).join(' · ');
      if (place) body.push(para([{ text: place, italic: true, size: 19, color: MUTED }]));
      item.details.forEach(detail => body.push(para([{ text: detail, size: 19 }])));
    }
  }
  if (resume.skills.length) {
    section('Skills');
    for (const group of resume.skills) body.push(para([...(group.label ? [{ text: `${group.label}: `, bold: true }] : []), { text: group.items.join(', ') }]));
  }
  for (const extra of resume.extras) { section(extra.title); bullets(extra.items); }

  return pack(body, width, height, margin);
}

/** A cover letter as a plain Word file: one paragraph per block of text. */
export async function renderLetterDocx(letter: string, paper: Paper): Promise<Blob> {
  const [width, height] = paper === 'a4' ? [11906, 16838] : [12240, 15840];
  shrink = 0;
  const body = letter.trim().split(/\n{2,}/).flatMap(block => { const lines = block.split('\n').map(line => line.trim()).filter(Boolean); return lines.map((line, index) => para([{ text: line, size: 22 }], { after: index === lines.length - 1 ? 220 : 0 })); });
  return pack(body, width, height, 1300);
}

function pack(body: string[], width: number, height: number, margin: number): Promise<Blob> {
  const zip = new JSZip(), W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  // No folder entries: some Word versions refuse archives that list directories.
  const add = (name: string, xml: string) => zip.file(name, xml, { createFolders: false });
  add('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>');
  add('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  add('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>');
  add('word/numbering.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="300" w:hanging="220"/></w:pPr><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`);
  add('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="${width}" w:h="${height}"/><w:pgMar w:top="${margin}" w:right="${margin}" w:bottom="${margin}" w:left="${margin}" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', compression: 'DEFLATE' });
}

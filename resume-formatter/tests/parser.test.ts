import assert from 'node:assert/strict';
import test from 'node:test';
import { boldMetrics } from '../lib/formatMetrics';
import { parseResumeText, resumeToHTML } from '../lib/parser';

test('parses a target company, contact, one-pipe role, and bullets', () => {
  const parsed = parseResumeText(`Example Corp
Alex Example
alex@example.com • (555) 123-4567
EXPERIENCE
Product Manager | Acme Systems Feb 2022 - Present\\
• Raised adoption by 40%.\\
• Launched 4 products.
SKILLS
Tools: Figma, Jira`);
  assert.equal(parsed.targetCompany, 'Example Corp');
  assert.equal(parsed.contact.email, 'alex@example.com');
  assert.equal(parsed.experience[0].title, 'Product Manager');
  assert.equal(parsed.experience[0].company, 'Acme Systems');
  assert.equal(parsed.experience[0].bullets.length, 2);
  assert.ok(parsed.experience[0].bullets.every(bullet => !bullet.endsWith('\\')));
});

test('accepts Markdown headings, dates, and multiple bullet glyphs', () => {
  const parsed = parseResumeText(`Alex Example
alex@example.com
## PROFESSIONAL EXPERIENCE
**Engineer** | **Acme** | Spring 2022 to Current
▪ Improved conversion by 21%.
1. Reduced support tickets.
## TECHNICAL SKILLS
Languages: TypeScript, SQL`);
  assert.equal(parsed.experience[0].title, 'Engineer');
  assert.equal(parsed.experience[0].dateRange, 'Spring 2022 - Present');
  assert.equal(parsed.experience[0].bullets.length, 2);
  assert.equal(parsed.skills[0].label, 'Languages');
});

test('parses stacked job headers and separate dates', () => {
  const parsed = parseResumeText(`Alex Example
WORK EXPERIENCE
Senior Engineer
Acme | Austin, TX
2020 - 2024
• Built a platform.`);
  assert.deepEqual(parsed.experience[0], {
    title: 'Senior Engineer', company: 'Acme', location: 'Austin, TX',
    dateRange: '2020 - 2024', bullets: ['Built a platform.'],
  });
});

test('joins wrapped bullets while keeping separate achievements', () => {
  const parsed = parseResumeText(`Alex Example
EXPERIENCE
Engineer | Acme | 2021 - 2024
• Built a platform used by
  40 teams across the company.
• Reduced incidents by 25%.`);
  assert.deepEqual(parsed.experience[0].bullets, [
    'Built a platform used by 40 teams across the company.',
    'Reduced incidents by 25%.',
  ]);
});

test('accumulates repeated skills and certifications', () => {
  const parsed = parseResumeText(`Alex Example
SKILLS
TypeScript, SQL
CERTIFICATIONS
Cloud Certification
SKILLS & COMPETENCIES
Tools: Figma, Jira`);
  assert.deepEqual(parsed.skills, [
    { label: 'Skills', skills: 'TypeScript, SQL' },
    { label: 'Certifications', skills: 'Cloud Certification' },
    { label: 'Tools', skills: 'Figma, Jira' },
  ]);
});

test('recognizes a multiword target company', () => {
  const parsed = parseResumeText(`Example Holdings
Alex Example
alex@example.com
EXPERIENCE
Analyst | Bank | 2022 - Present
• Delivered reporting.`);
  assert.equal(parsed.targetCompany, 'Example Holdings');
});

test('parses colon projects and warns on unsupported input', () => {
  const project = parseResumeText(`Alex Example
PROJECT EXPERIENCE
Example App: Built a planning tool.`);
  assert.deepEqual(project.startups[0], { role: 'Example App', description: 'Built a planning tool.' });
  const unsupported = parseResumeText('Alex Example\nThis text has no supported section headings.');
  assert.match(unsupported.warnings[0], /No supported section headings/);
});

test('escapes hostile pasted HTML in preview helpers', () => {
  const formatted = boldMetrics('<img src=x onerror=alert(1)> raised sales 40%');
  assert.ok(formatted.includes('&lt;img'));
  assert.ok(!formatted.includes('<img'));
  const parsed = parseResumeText(`Alex Example
EXPERIENCE
<script>alert(1)</script> | Acme | 2022 - Present
• Shipped <b>unsafe</b> content.`);
  const html = resumeToHTML(parsed);
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<b>unsafe</b>'));
});

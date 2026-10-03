import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResumeText } from '../lib/parser';
import { resumeToDocument, validateDocument } from '../lib/document';

function textOf(value: unknown) {
  const parts: string[] = [];
  const walk = (node: any) => {
    if (typeof node?.text === 'string') parts.push(node.text);
    for (const child of node?.content || []) walk(child);
  };
  walk(value);
  return parts.join(' ');
}

test('canvas import keeps unsupported plain text editable', () => {
  const raw = 'Alex Example\nA completely custom introduction\nAnother paragraph';
  const document = resumeToDocument(parseResumeText(raw), undefined, raw);
  assert.match(textOf(document), /completely custom introduction/);
  assert.doesNotThrow(() => validateDocument(document));
});

test('canvas import keeps summary and supplied education', () => {
  const raw = `Alex Example
alex@example.com
SUMMARY
I build reliable tools.
EXPERIENCE
Engineer | Acme | 2020 - Present
• Improved uptime.
EDUCATION
Example University, Boston, MA 2015 - 2019
Bachelor of Science: Computing GPA: 3.9`;
  const document = resumeToDocument(parseResumeText(raw));
  const text = textOf(document);
  assert.match(text, /I build reliable tools/);
  assert.match(text, /Example University/);
  assert.match(text, /Alex Example/);
  assert.doesNotThrow(() => validateDocument(document));
});

test('share email takes priority in the initial document', () => {
  const parsed = parseResumeText(`Alex Example
alex@example.com
SKILLS
SQL, TypeScript`);
  const text = textOf(resumeToDocument(parsed, 'alternate@example.com'));
  assert.match(text, /alternate@example.com/);
  assert.ok(!text.includes('alex@example.com'));
});

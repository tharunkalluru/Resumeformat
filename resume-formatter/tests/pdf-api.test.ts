import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { GET, POST } from '../app/api/resume/pdf/route';
import { generateResumePdf, ResumeTooLongError } from '../lib/serverPdfGenerator';
import { parseResumeText } from '../lib/parser';
import { generateDocumentPdf } from '../lib/documentPdf';
import { resumeToDocument, validateDocument } from '../lib/document';

const textResume = `Alex Example
alex@example.com
EXPERIENCE
Product Manager | Acme Systems | 2022 - Present
• Launched 4 products and improved conversion by 40%.
SKILLS
Tools: Figma, Jira`;

function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/resume/pdf', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function code(response: Response) {
  const body = await response.json();
  return body.error.code as string;
}

test('GET documents all request modes', async () => {
  const response = await GET();
  assert.equal(response.status, 200);
  const contract = await response.json();
  assert.equal(contract.endpoint, '/api/resume/pdf');
  assert.ok(contract.accepts.document);
});

test('raw text, structured resume, and canvas document produce PDFs', async () => {
  const cases = [
    { text: textResume },
    { resume: { experience: [{ title: 'Engineer', company: 'Acme', bullets: ['Improved uptime by 25%.'] }] } },
    { document: resumeToDocument(parseResumeText(textResume)) },
  ];
  for (const body of cases) {
    const response = await POST(request(body));
    assert.equal(response.status, 200, JSON.stringify(body).slice(0, 80));
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.byteLength > 4_000);
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
  }
});

test('sanitizes the PDF filename', async () => {
  const response = await POST(request({ text: textResume, filename: '../unsafe/name?.pdf' }));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition') || '', /unsafe-name-/);
  assert.ok(!(response.headers.get('content-disposition') || '').includes('../'));
});

test('rejects ambiguous, missing, malformed, and unparseable input', async () => {
  assert.equal(await code(await POST(request({ text: textResume, resume: {} }))), 'INVALID_INPUT');
  assert.equal(await code(await POST(request({}))), 'INVALID_INPUT');
  assert.equal(await code(await POST(request('{oops'))), 'INVALID_JSON');
  assert.equal(await code(await POST(request('[]'))), 'INVALID_JSON');
  assert.equal(await code(await POST(request({ text: 'Alex Example\nNo sections.' }))), 'UNPARSEABLE_RESUME');
  assert.equal(await code(await POST(request({ resume: { experience: [{ title: 123 }] } }))), 'INVALID_INPUT');
  assert.equal(await code(await POST(request({ text: textResume, filename: 42 }))), 'INVALID_INPUT');
});

test('rejects unsupported content types and oversized bodies', async () => {
  const wrongType = await POST(request({ text: textResume }, { 'content-type': 'text/plain' }));
  assert.equal(wrongType.status, 415);
  const statedTooLarge = await POST(request({ text: textResume }, { 'content-length': '250001' }));
  assert.equal(statedTooLarge.status, 413);
  const actualTooLarge = await POST(request({ text: 'x'.repeat(250_001) }));
  assert.equal(actualTooLarge.status, 413);
});

test('enforces API key via bearer or x-api-key and rejects missing key', async () => {
  const previous = process.env.RESUME_API_KEY;
  process.env.RESUME_API_KEY = 'test-secret';
  try {
    assert.equal((await POST(request({ text: textResume }))).status, 401);
    assert.equal((await POST(request({ text: textResume }, { authorization: 'Bearer wrong' }))).status, 401);
    assert.equal((await POST(request({ text: textResume }, { authorization: 'Bearer test-secret' }))).status, 200);
    assert.equal((await POST(request({ text: textResume }, { 'x-api-key': 'test-secret' }))).status, 200);
  } finally {
    if (previous === undefined) delete process.env.RESUME_API_KEY;
    else process.env.RESUME_API_KEY = previous;
  }
});

test('rejects invalid canvas node types and structure', async () => {
  const document = resumeToDocument(parseResumeText(textResume));
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'script', text: 'x' }] }), /unsupported/);
  assert.throws(() => validateDocument({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link' }] }] }] }), /formatting/);
  assert.equal(await code(await POST(request({ document: { ...document, content: [{ type: 'script' }] } }))), 'INVALID_INPUT');
});

test('accepts empty paragraphs and nested lists created by the canvas', () => {
  const document = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Resume' }] },
    { type: 'paragraph' },
    { type: 'bulletList', content: [{ type: 'listItem', content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
      { type: 'orderedList', attrs: { start: 2 }, content: [{ type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Child' }] },
      ] }] },
    ] }] },
  ] };
  assert.doesNotThrow(() => validateDocument(document));
  assert.equal(new TextDecoder().decode(generateDocumentPdf(document).slice(0, 5)), '%PDF-');
});

test('canvas PDF continues onto more pages instead of clipping', () => {
  const document = resumeToDocument(parseResumeText(textResume));
  document.content?.push(...Array.from({ length: 110 }, (_, index) => ({
    type: 'paragraph' as const, content: [{ type: 'text' as const, text: `Achievement ${index + 1} improved workflow reliability by 40%.` }],
  })));
  const bytes = generateDocumentPdf(document);
  const pdfText = new TextDecoder('latin1').decode(bytes);
  assert.ok((pdfText.match(/\/Type \/Page\b/g) || []).length > 1);
});

test('canvas PDF keeps visible contact links clickable', () => {
  const document = { type: 'doc', content: [{ type: 'paragraph', content: [{
    type: 'text', text: 'alex@example.com https://example.com in/alex',
  }] }] };
  const pdfText = new TextDecoder('latin1').decode(generateDocumentPdf(document));
  assert.match(pdfText, /\/URI \(mailto:alex@example\.com\)/);
  assert.match(pdfText, /\/URI \(https:\/\/example\.com\)/);
  assert.match(pdfText, /\/URI \(https:\/\/www\.linkedin\.com\/in\/alex\/\)/);
});

test('structured renderer rejects content that cannot fit one page', async () => {
  const resume = parseResumeText(textResume);
  resume.experience = Array.from({ length: 8 }, (_, index) => ({
    title: `Engineer ${index}`, company: 'Acme', location: '', dateRange: '2020 - Present',
    bullets: Array.from({ length: 20 }, (_, bullet) => `Achievement ${bullet} improved a major workflow by 40% across many teams.`),
  }));
  await assert.rejects(generateResumePdf(resume), ResumeTooLongError);
});

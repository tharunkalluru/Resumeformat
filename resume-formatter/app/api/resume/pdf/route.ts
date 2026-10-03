import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  JobExperience,
  ParsedResume,
  SkillCategory,
  StartupEntry,
  parseResumeText,
} from '@/lib/parser';
import { RESUME_PROFILE } from '@/lib/profile';
import { generateResumePdf, ResumeTooLongError } from '@/lib/serverPdfGenerator';
import { validateDocument } from '@/lib/document';
import { generateDocumentPdf } from '@/lib/documentPdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 250_000;
const MAX_TEXT_LENGTH = 100_000;

interface PdfRequestBody {
  text?: unknown;
  resume?: unknown;
  document?: unknown;
  filename?: unknown;
}

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status }
  );
}

function requireString(value: unknown, field: string, maxLength = 10_000): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} cannot be empty.`);
  if (normalized.length > maxLength) throw new TypeError(`${field} is too long.`);
  return normalized;
}

function optionalString(value: unknown, field: string, maxLength = 10_000): string {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, maxLength);
}

function parseStringArray(value: unknown, field: string, limit: number): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  if (value.length > limit) throw new TypeError(`${field} has too many entries.`);
  return value.map((item, index) => requireString(item, `${field}[${index}]`, 5_000));
}

function parseExperience(value: unknown): JobExperience[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('resume.experience must be an array.');
  if (value.length > 25) throw new TypeError('resume.experience has too many entries.');

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`resume.experience[${index}] must be an object.`);
    }
    const job = entry as Record<string, unknown>;
    return {
      title: requireString(job.title, `resume.experience[${index}].title`, 250),
      company: optionalString(job.company, `resume.experience[${index}].company`, 250),
      location: optionalString(job.location, `resume.experience[${index}].location`, 250),
      dateRange: optionalString(job.dateRange, `resume.experience[${index}].dateRange`, 100),
      bullets: parseStringArray(job.bullets ?? [], `resume.experience[${index}].bullets`, 30),
    };
  });
}

function parseProjects(value: unknown): StartupEntry[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('resume.startups must be an array.');
  if (value.length > 20) throw new TypeError('resume.startups has too many entries.');

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`resume.startups[${index}] must be an object.`);
    }
    const project = entry as Record<string, unknown>;
    const role = optionalString(project.role, `resume.startups[${index}].role`, 250);
    const description = optionalString(project.description, `resume.startups[${index}].description`, 2_000);
    if (!role && !description) {
      throw new TypeError(`resume.startups[${index}] needs a role or description.`);
    }
    return { role, description };
  });
}

function parseSkills(value: unknown): SkillCategory[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('resume.skills must be an array.');
  if (value.length > 20) throw new TypeError('resume.skills has too many entries.');

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError(`resume.skills[${index}] must be an object.`);
    }
    const skill = entry as Record<string, unknown>;
    return {
      label: requireString(skill.label, `resume.skills[${index}].label`, 100),
      skills: requireString(skill.skills, `resume.skills[${index}].skills`, 3_000),
    };
  });
}

function parseStructuredResume(value: unknown): ParsedResume {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('resume must be an object.');
  }
  const input = value as Record<string, unknown>;
  const resume: ParsedResume = {
    contact: {
      name: RESUME_PROFILE.contact.name,
      linkedin: RESUME_PROFILE.contact.linkedin,
      email: RESUME_PROFILE.contact.email,
      phone: RESUME_PROFILE.contact.phone,
    },
    experience: parseExperience(input.experience),
    startups: parseProjects(input.startups),
    skills: parseSkills(input.skills),
    education: [],
    rawSections: {},
    warnings: [],
    targetCompany: optionalString(input.targetCompany, 'resume.targetCompany', 150) || undefined,
  };

  if (!resume.experience.length && !resume.startups.length && !resume.skills.length) {
    throw new TypeError('resume must include at least one experience, startup, or skills entry.');
  }
  return resume;
}

function resolveFilename(requested: unknown, targetCompany?: string): string {
  const fallback = targetCompany
    ? `${RESUME_PROFILE.firstName} - ${targetCompany}.pdf`
    : `${RESUME_PROFILE.firstName}.pdf`;
  const source = typeof requested === 'string' && requested.trim() ? requested.trim() : fallback;
  const withoutExtension = source.replace(/\.pdf$/i, '');
  const safe = withoutExtension
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || RESUME_PROFILE.firstName;
  return `${safe}.pdf`;
}

async function readBoundedBody(request: NextRequest): Promise<string> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BODY_BYTES) throw new RangeError('Request body is too large.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

let documentFontsPromise: Promise<Record<string, string>> | undefined;
function documentFonts() {
  if (!documentFontsPromise) {
    documentFontsPromise = Promise.all(['Carlito-Regular.ttf', 'Carlito-Bold.ttf', 'Carlito-Italic.ttf', 'Carlito-BoldItalic.ttf']
      .map(async name => [name, (await readFile(path.join(process.cwd(), 'public', 'fonts', name))).toString('base64')] as const))
      .then(Object.fromEntries)
      .catch(error => { documentFontsPromise = undefined; throw error; });
  }
  return documentFontsPromise;
}

function isAuthorized(request: NextRequest): boolean {
  const configuredKey = process.env.RESUME_API_KEY;
  if (!configuredKey) return true;
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const headerKey = request.headers.get('x-api-key');
  return bearer === configuredKey || headerKey === configuredKey;
}

export async function GET() {
  return NextResponse.json({
    endpoint: '/api/resume/pdf',
    method: 'POST',
    accepts: {
      text: 'Raw resume text in the same format accepted by ResumeForge.',
      resume: {
        targetCompany: 'Optional company name used in the generated filename.',
        experience: '[{ title, company?, location?, dateRange?, bullets[] }]',
        startups: '[{ role?, description? }]',
        skills: '[{ label, skills }]',
      },
      document: 'Validated editor JSON document (headings, paragraphs, lists and bold/italic/underline text).',
      filename: 'Optional PDF filename.',
    },
    note: 'Provide exactly one of text, resume, or document. This repository’s default contact and education are applied to text and resume requests. Document requests preserve all canvas edits and may span multiple PDF pages.',
    authentication: process.env.RESUME_API_KEY
      ? 'Send Authorization: Bearer <key> or X-API-Key.'
      : 'Not enabled. Set RESUME_API_KEY before exposing this endpoint publicly.',
  });
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return errorResponse(401, 'UNAUTHORIZED', 'A valid API key is required.');
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return errorResponse(413, 'PAYLOAD_TOO_LARGE', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`);
  }
  if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers.get('content-type') || '')) {
    return errorResponse(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use Content-Type: application/json.');
  }

  let body: PdfRequestBody;
  try {
    const rawBody = await readBoundedBody(request);
    const parsedBody = JSON.parse(rawBody) as unknown;
    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return errorResponse(400, 'INVALID_JSON', 'The request body must be a JSON object.');
    }
    body = parsedBody as PdfRequestBody;
  } catch (error) {
    if (error instanceof RangeError) return errorResponse(413, 'PAYLOAD_TOO_LARGE', `Request bodies are limited to ${MAX_BODY_BYTES} bytes.`);
    return errorResponse(400, 'INVALID_JSON', 'The request body is not valid JSON.');
  }

  const modeCount = [body.text, body.resume, body.document].filter(value => value !== undefined).length;
  if (modeCount !== 1) {
    return errorResponse(400, 'INVALID_INPUT', 'Provide exactly one of text, resume, or document.');
  }
  if (body.filename !== undefined && (typeof body.filename !== 'string' || body.filename.length > 250)) {
    return errorResponse(400, 'INVALID_INPUT', 'filename must be a string of at most 250 characters.');
  }

  let resume: ParsedResume | undefined;
  try {
    if (body.document !== undefined) {
      validateDocument(body.document);
    } else if (body.text !== undefined) {
      const text = requireString(body.text, 'text', MAX_TEXT_LENGTH);
      resume = parseResumeText(text);
      if (!resume.experience.length && !resume.startups.length && !resume.skills.length) {
        return errorResponse(
          422,
          'UNPARSEABLE_RESUME',
          'No supported resume content was recognized.',
          resume.warnings
        );
      }
    } else {
      resume = parseStructuredResume(body.resume);
    }
  } catch (error) {
    return errorResponse(
      400,
      'INVALID_INPUT',
      error instanceof Error ? error.message : 'The resume data is invalid.'
    );
  }

  try {
    const pdf = resume
      ? await generateResumePdf(resume)
      : generateDocumentPdf(body.document, await documentFonts());
    const filename = resolveFilename(body.filename, resume?.targetCompany);
    const encodedFilename = encodeURIComponent(filename);
    const asciiFilename = filename.normalize('NFKD').replace(/[^\x20-\x7E]/g, '_');
    const responseBody = Uint8Array.from(pdf).buffer;

    return new Response(responseBody, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdf.byteLength),
        'Content-Disposition': `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ResumeTooLongError) {
      return errorResponse(
        422,
        error.code,
        error.message,
        { overflowPoints: error.overflowPoints }
      );
    }
    console.error('Resume PDF generation failed:', error);
    return errorResponse(500, 'PDF_GENERATION_FAILED', 'The PDF could not be generated.');
  }
}

// Folio structured-resume AI, deployed identically to each regional project.
// POST /structure reads a resume's text into sections. POST /tailor proposes changes for one job.
// Signed-in users only; shares the daily limits and the public.ai_runs log with the `ai` function.
import { createClient } from '@supabase/supabase-js';
import {
  MODEL, MAX_RESUME_CHARS, MAX_JOB_CHARS, STRUCTURE_SCHEMA, STRUCTURE_INSTRUCTIONS, TAILOR_SCHEMA, TAILOR_INSTRUCTIONS,
  checkStructure, checkTailoring, validResume,
} from './structured.mjs';

const env = (name: string) => Deno.env.get(name)?.trim() ?? '';
const USER_DAILY_LIMIT = Number(env('AI_DAILY_USER_LIMIT') || 20);
const GLOBAL_DAILY_LIMIT = Number(env('AI_DAILY_GLOBAL_LIMIT') || 300);
const ALLOWED_ORIGINS = new Set(['http://localhost:4594', 'http://127.0.0.1:4594', ...env('ALLOWED_ORIGINS').split(',').map(o => o.trim()).filter(Boolean)]);
const PAGES_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?folio-app-78s\.pages\.dev$/;
const MAX_BODY_BYTES = 160 * 1024;

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const apiKey = env('OPENAI_API_KEY');

class Failure extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || PAGES_ORIGIN.test(origin)) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowed, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '600',
  };
}
const json = (status: number, body: unknown, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** One OpenAI call with a fixed output schema. Provider error bodies are never read or returned. */
async function ask(instructions: string, input: unknown, schema: unknown, name: string, effort: 'low' | 'medium', maxOutputTokens: number) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 110_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST', signal: controller.signal, redirect: 'error',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        model: MODEL, store: false, stream: false, reasoning: { effort }, max_output_tokens: maxOutputTokens, instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
        text: { format: { type: 'json_schema', name, strict: true, schema } },
      }),
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Failure(502, response.status === 429 ? 'provider_rate_limit' : response.status === 401 ? 'provider_auth' : 'provider_error', 'The AI provider could not complete the request.');
    }
    const result = await response.json();
    if (result?.status !== 'completed' || !Array.isArray(result.output)) throw new Failure(502, 'provider_incomplete', 'The AI response was incomplete.');
    const parts = result.output.filter((item: { type?: string }) => item?.type === 'message').flatMap((item: { content?: unknown[] }) => item.content ?? []) as { type?: string; text?: string }[];
    if (parts.some(part => part.type === 'refusal')) throw new Failure(502, 'provider_refusal', 'The AI declined this request.');
    const text = parts.filter(part => part.type === 'output_text').map(part => part.text ?? '').join('');
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Failure(502, 'provider_invalid_response', 'The AI response could not be read.'); }
    if (JSON.stringify(value).includes(apiKey)) throw new Failure(502, 'provider_invalid_response', 'The AI response could not be read.');
    return { value, usage: result.usage as { input_tokens?: number; output_tokens?: number } | undefined };
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(504, 'provider_timeout', 'The AI took too long. Try again.');
  } finally { clearTimeout(timer); }
}

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const fail = (status: number, code: string, message: string) => json(status, { error: { code, message } }, origin);
  const route = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return fail(401, 'sign_in_required', 'Sign in to use AI.');
  if (request.method !== 'POST' || (route !== 'structure' && route !== 'tailor')) return fail(404, 'not_found', 'Unknown route.');
  if (!apiKey) return fail(503, 'not_configured', 'AI is not configured yet.');

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return fail(413, 'body_too_large', 'The request is too large.');
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = JSON.parse(raw); } catch { return fail(400, 'invalid_request', 'The request is invalid.'); }
  const requestId = typeof body?.requestId === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(body.requestId) ? body.requestId : '';
  if (!requestId) return fail(400, 'invalid_request', 'The request is invalid.');

  if (route === 'structure') {
    if (typeof body.text !== 'string' || body.text.trim().length < 40 || body.text.length > MAX_RESUME_CHARS) return fail(400, 'invalid_request', 'The resume text is missing or too long.');
  } else {
    const job = body.job;
    if (!validResume(body.resume) || !job || typeof job.description !== 'string' || !job.description.trim() || job.description.length > MAX_JOB_CHARS ||
        typeof job.title !== 'string' || job.title.length > 300 || typeof job.company !== 'string' || job.company.length > 300) return fail(400, 'invalid_request', 'The resume or job is missing or too long.');
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [mine, everyone] = await Promise.all([
    admin.from('ai_runs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since),
    admin.from('ai_runs').select('id', { count: 'exact', head: true }).gte('created_at', since),
  ]);
  if ((mine.count ?? 0) >= USER_DAILY_LIMIT) return fail(429, 'daily_limit', `You’ve used today’s ${USER_DAILY_LIMIT} AI runs. Try again tomorrow.`);
  if ((everyone.count ?? 0) >= GLOBAL_DAILY_LIMIT) return fail(429, 'service_limit', 'AI is at capacity for today. Try again tomorrow.');

  const claim = await admin.from('ai_runs').insert({ user_id: user.id, request_id: `${user.id}:${route}:${requestId}`, model: MODEL }).select('id').single();
  if (claim.error) return fail(409, 'request_already_sent', 'This request was already sent.');
  const finish = (fields: Record<string, unknown>) => admin.from('ai_runs').update(fields).eq('id', claim.data.id);

  try {
    let result: unknown, usage;
    if (route === 'structure') {
      const answer = await ask(STRUCTURE_INSTRUCTIONS, { resumeText: body.text }, STRUCTURE_SCHEMA, 'folio_resume_sections', 'low', 9000);
      const problem = checkStructure(answer.value, body.text);
      if (problem) { console.error('structure rejected', problem); throw new Failure(502, 'provider_invalid_response', 'The resume could not be read reliably. Try again.'); }
      result = { resume: answer.value }; usage = answer.usage;
    } else {
      const { title, company, description } = body.job;
      const answer = await ask(TAILOR_INSTRUCTIONS, { job: { title, company, description }, resume: body.resume }, TAILOR_SCHEMA, 'folio_resume_tailoring', 'medium', 9000);
      const checked = checkTailoring(answer.value, body.resume, `${title}\n${company}\n${description}`);
      if (Object.keys(checked.dropped).length) console.error('tailoring dropped', JSON.stringify(checked.dropped), 'kept', checked.bullets.length);
      result = checked; usage = answer.usage;
    }
    await finish({ status: 'succeeded', input_tokens: usage?.input_tokens ?? null, output_tokens: usage?.output_tokens ?? null });
    return json(200, result, origin);
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure(500, 'internal_error', 'The AI service could not complete the request.');
    if (!(error instanceof Failure)) console.error('unexpected', String(error).slice(0, 300));
    await finish({ status: 'failed', error_code: failure.code });
    return fail(failure.status, failure.code, failure.message);
  }
});

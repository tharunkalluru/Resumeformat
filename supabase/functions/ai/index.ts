// Folio AI tailoring, deployed identically to each regional project.
// Signed-in users only; per-user and project-wide daily limits; every run logged in public.ai_runs.
import { createClient } from '@supabase/supabase-js';
import { createAiAdapter, SafeAiError } from './adapter.mjs';
import { MODEL, MAX_BODY_BYTES } from './contract.mjs';

const env = (name: string) => Deno.env.get(name)?.trim() ?? '';
const USER_DAILY_LIMIT = Number(env('AI_DAILY_USER_LIMIT') || 20);
const GLOBAL_DAILY_LIMIT = Number(env('AI_DAILY_GLOBAL_LIMIT') || 300);
const ALLOWED_ORIGINS = new Set(['http://localhost:4594', 'http://127.0.0.1:4594', ...env('ALLOWED_ORIGINS').split(',').map(o => o.trim()).filter(Boolean)]);
// Cloudflare Pages production and preview deployments of the Folio project.
const PAGES_ORIGIN = /^https:\/\/([a-z0-9-]+\.)?folio-app\.pages\.dev$/;

const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const configuration = Object.freeze({ apiKey: env('OPENAI_API_KEY'), model: MODEL, requestsEnabled: true });

function cors(origin: string | null): Record<string, string> {
  const allowed = origin && (ALLOWED_ORIGINS.has(origin) || PAGES_ORIGIN.test(origin)) ? origin : 'null';
  return {
    'Access-Control-Allow-Origin': allowed, Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, accept, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Max-Age': '600',
  };
}
function json(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
const fail = (status: number, code: string, message: string, origin: string | null) => json(status, { error: { code, message } }, origin);

function status() {
  const keyConfigured = configuration.apiKey.length > 0;
  // The server owns the key and the limits; a configured server counts as verified for clients.
  return { keyConfigured, modelConfigured: true, supportedModel: true, paidRequestsEnabled: keyConfigured,
    accountModelVerified: keyConfigured, busy: false, verification: keyConfigured ? 'verified' : 'unverified' };
}

Deno.serve(async request => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });
  const route = new URL(request.url).pathname.split('/').filter(Boolean).at(-1);

  const token = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return fail(401, 'sign_in_required', 'Sign in to use AI tailoring.', origin);

  try {
    if (request.method === 'GET' && route === 'status') return json(200, status(), origin);
    if (request.method === 'POST' && route === 'verify') return json(200, status(), origin);
    if (request.method !== 'POST' || route !== 'tailor') return fail(404, 'not_found', 'Unknown AI route.', origin);
    if (!configuration.apiKey) return fail(503, 'not_configured', 'AI tailoring is not configured yet.', origin);

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return fail(413, 'body_too_large', 'The request is too large.', origin);
    let body: { requestId?: unknown };
    try { body = JSON.parse(raw); } catch { return fail(400, 'invalid_request', 'The AI request is invalid.', origin); }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [mine, everyone] = await Promise.all([
      admin.from('ai_runs').select('id', { count: 'exact', head: true }).eq('user_id', user.id).gte('created_at', since),
      admin.from('ai_runs').select('id', { count: 'exact', head: true }).gte('created_at', since),
    ]);
    if ((mine.count ?? 0) >= USER_DAILY_LIMIT) return fail(429, 'daily_limit', `You’ve used today’s ${USER_DAILY_LIMIT} AI tailorings. Try again tomorrow, or edit by hand.`, origin);
    if ((everyone.count ?? 0) >= GLOBAL_DAILY_LIMIT) return fail(429, 'service_limit', 'AI tailoring is at capacity for today. You can still edit and download.', origin);

    const requestId = typeof body.requestId === 'string' ? body.requestId.slice(0, 128) : '';
    if (!requestId) return fail(400, 'invalid_request', 'The AI request is invalid.', origin);
    const claim = await admin.from('ai_runs').insert({ user_id: user.id, request_id: `${user.id}:${requestId}`, model: MODEL }).select('id').single();
    if (claim.error) return fail(409, 'request_already_sent', 'This request was already sent. Review a new request before sending again.', origin);

    try {
      const result = await createAiAdapter({ configuration }).tailor(body);
      await admin.from('ai_runs').update({ status: 'succeeded', input_tokens: result.usage?.inputTokens ?? null, output_tokens: result.usage?.outputTokens ?? null }).eq('id', claim.data.id);
      return json(200, result, origin);
    } catch (error) {
      const code = error instanceof SafeAiError ? error.code : 'internal_error';
      await admin.from('ai_runs').update({ status: 'failed', error_code: code }).eq('id', claim.data.id);
      throw error;
    }
  } catch (error) {
    if (error instanceof SafeAiError) return fail(error.status, error.code, error.message, origin);
    return fail(500, 'internal_error', 'The AI service could not complete the request.', origin);
  }
});

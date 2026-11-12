import { cloudAiEndpoint } from '../tailoring/ai';
import { REGIONS, detectRegion, rememberedRegion } from '../auth/regions';
import { withIds, type Job, type StructuredResume, type Tailoring } from './model';

const MESSAGES: Record<string, string> = {
  sign_in_required: 'Create a free account to do this.',
  trial_used: 'You’ve used your free try. Create a free account to keep going.',
  trial_closed: 'Free tries are used up for today. Create a free account to continue.',
  job_unreadable: 'That page couldn’t be read. Paste the job text instead.',
  job_refused: 'This site doesn’t let Folio read its pages. Open the posting and use the Send to Folio button, or paste the job text here.',
  job_gone: 'This posting seems to have closed or moved. Check the link, or paste the job text.',
  job_empty: 'Folio couldn’t find the job text on that page. Open the posting and use the Send to Folio button, or paste the job text here.',
  request_already_sent: 'That request was already sent. Try again.',
  daily_limit: 'You’ve used today’s AI runs. Try again tomorrow.',
  service_limit: 'AI is at capacity for today. Try again tomorrow.',
  provider_timeout: 'The AI took too long. Try again.',
  provider_rate_limit: 'The AI is busy right now. Wait a minute, then try again.',
  provider_invalid_response: 'The AI answer could not be used. Try again.',
  invalid_request: 'This resume or job is too long to send. Shorten it and try again.',
  body_too_large: 'This resume or job is too long to send. Shorten it and try again.',
  not_configured: 'AI isn’t set up on the server yet.',
  offline: 'Can’t reach Folio’s servers. Check your connection and try again.',
};
export class StructuredAiError extends Error {
  constructor(public readonly code: string) { super(MESSAGES[code] ?? 'Something went wrong with the AI request. Try again.'); }
}

/** These codes mean "this needs an account", so the workspace offers sign-up instead of a retry. */
export const needsAccount = (error: unknown) => error instanceof StructuredAiError && ['sign_in_required', 'trial_used', 'trial_closed'].includes(error.code);

async function call<T>(route: 'structure' | 'tailor' | 'job' | 'cover', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  // Without an account the request carries only the public key; the server allows one try per visitor.
  const region = REGIONS[rememberedRegion() ?? detectRegion()];
  const endpoint = await cloudAiEndpoint() ?? { baseUrl: `${region.url}/functions/v1/ai`, headers: { apikey: region.publishableKey } };
  // Nobody should watch a spinner forever: give up well after the usual time and say so.
  const limit = new AbortController(), both = limit.signal, cancel = () => limit.abort();
  let late = false;
  const timer = setTimeout(() => { late = true; limit.abort(); }, route === 'job' ? 20_000 : 75_000);
  if (signal?.aborted) limit.abort(); else signal?.addEventListener('abort', cancel, { once: true });
  const settle = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl.replace(/\/ai$/, '/resume-ai')}/${route}`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', signal: both,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
    });
  } catch (error) {
    settle();
    if (signal?.aborted) throw error;
    throw new StructuredAiError(late ? (route === 'job' ? 'job_unreadable' : 'provider_timeout') : 'offline');
  }
  const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  settle();
  if (!value && late) throw new StructuredAiError('provider_timeout');
  if (!response.ok || !value) throw new StructuredAiError(value?.error?.code ?? (response.status >= 502 ? 'offline' : 'unknown'));
  return value as T;
}

/** Reads resume text into sections. The server rejects a reading that is not made of the resume's own words. */
export async function readResume(text: string, signal?: AbortSignal): Promise<StructuredResume> {
  const { resume } = await call<{ resume: Parameters<typeof withIds>[0] }>('structure', { text: text.slice(0, 30_000) }, signal);
  return withIds(resume);
}

const short = () => crypto.randomUUID().slice(0, 8);
/** `memory` is the applicant's career memory as text; the server may draw on it as well as the resume. */
export async function tailorResume(resume: StructuredResume, job: Job, memory = '', signal?: AbortSignal): Promise<Tailoring> {
  type Raw = Omit<Tailoring, 'additions' | 'newProjects'> & { additions?: { parentId: string; text: string; reason: string }[]; newProjects?: { name: string; link: string; dates: string; bullets: string[]; reason: string }[] };
  const raw = await call<Raw>('tailor', { resume, job, ...(memory ? { memory } : {}) }, signal);
  // Suggestions that add lines need ids of their own, so each can be undone or reworded.
  return { ...raw, additions: (raw.additions ?? []).map(item => ({ ...item, id: short() })), newProjects: (raw.newProjects ?? []).map(item => ({ ...item, id: short(), bullets: item.bullets.map(text => ({ id: short(), text })) })) };
}

/** A single web address and nothing else: the user pasted a link to the posting instead of its text. */
export const jobLink = (text: string) => /^https?:\/\/\S+$/i.test(text.trim()) ? text.trim().replace(/^http:/i, 'https:') : null;
/** The text of a job posting page. Many job sites refuse automated readers; the caller then asks for the text. */
export const readJobLink = (url: string, signal?: AbortSignal) => call<{ text: string; via?: string }>('job', { url }, signal);
export const writeLetter = async (resume: StructuredResume, job: Job, memory = '', signal?: AbortSignal) => (await call<{ letter: string }>('cover', { resume, job, ...(memory ? { memory } : {}) }, signal)).letter;

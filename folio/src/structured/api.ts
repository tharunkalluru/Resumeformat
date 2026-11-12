import { cloudAiEndpoint } from '../tailoring/ai';
import { withIds, type Job, type StructuredResume, type Tailoring } from './model';

const MESSAGES: Record<string, string> = {
  sign_in_required: 'Sign in to use Folio templates and AI tailoring.',
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

async function call<T>(route: 'structure' | 'tailor', body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const endpoint = await cloudAiEndpoint();
  if (!endpoint) throw new StructuredAiError('sign_in_required');
  let response: Response;
  try {
    response = await fetch(`${endpoint.baseUrl.replace(/\/ai$/, '/resume-ai')}/${route}`, {
      method: 'POST', credentials: 'omit', cache: 'no-store', signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...endpoint.headers },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...body }),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new StructuredAiError('offline');
  }
  const value = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  if (!response.ok || !value) throw new StructuredAiError(value?.error?.code ?? (response.status >= 502 ? 'offline' : 'unknown'));
  return value as T;
}

/** Reads resume text into sections. The server rejects a reading that is not made of the resume's own words. */
export async function readResume(text: string, signal?: AbortSignal): Promise<StructuredResume> {
  const { resume } = await call<{ resume: Parameters<typeof withIds>[0] }>('structure', { text: text.slice(0, 30_000) }, signal);
  return withIds(resume);
}

export const tailorResume = (resume: StructuredResume, job: Job, signal?: AbortSignal) => call<Tailoring>('tailor', { resume, job }, signal);

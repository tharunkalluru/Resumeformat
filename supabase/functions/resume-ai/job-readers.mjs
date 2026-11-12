// Reading a job posting from a link. Folio reads a posting only where the site offers it: through the
// public job feeds that hiring platforms publish for this purpose, or as an ordinary page fetched under
// Folio's own name. It never pretends to be a browser or a person; a site that refuses is left alone,
// and the applicant is asked to bring the text themselves (paste, or the "Send to Folio" button).
import { MAX_JOB_CHARS, htmlToJobText, safeJobUrl, strip } from './structured.mjs';

const IDENTITY = { 'User-Agent': 'FolioJobReader/1.0 (+https://folio-app-78s.pages.dev; reads one job posting when an applicant pastes its link)' };

/** One request with a time limit. `refused` tells apart "the site said no" from "nothing useful there". */
async function get(url, { json = false, ms = 9000 } = {}) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow', headers: { ...IDENTITY, Accept: json ? 'application/json' : 'text/html,application/xhtml+xml' } });
    // A redirect must not lead somewhere the first check would have refused.
    if (!response.ok || !safeJobUrl(response.url)) { await response.body?.cancel().catch(() => {}); return { refused: true }; }
    // A feed lists every opening of a company, so it can be large; a page is cut to a sensible size.
    const body = (await response.text()).slice(0, json ? 12_000_000 : 2_000_000);
    return { url: response.url, body: json ? JSON.parse(body) : body };
  } catch { return { refused: true }; } finally { clearTimeout(timer); }
}
const posting = (title, company, parts) => {
  const body = parts.map(part => strip(String(part ?? ''))).filter(Boolean).join('\n\n');
  if (body.length < 200) return null;
  return [`${title ?? ''}${company ? ` at ${company}` : ''}`.trim(), body].filter(Boolean).join('\n\n').slice(0, MAX_JOB_CHARS);
};
const unescape = (text) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** Hiring platforms with a documented public feed of their customers' postings. */
const FEEDS = [
  { name: 'Greenhouse', test: (url) => /(^|\.)greenhouse\.io$/.test(url.hostname), async read(url) {
    const [, board, id] = url.pathname.match(/^\/(?:embed\/)?([^/]+)\/jobs\/(\d+)/) ?? [];
    const token = board ?? url.searchParams.get('for'), job = id ?? url.searchParams.get('token') ?? url.searchParams.get('gh_jid');
    if (!token || !job) return null;
    const data = (await get(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs/${encodeURIComponent(job)}`, { json: true })).body;
    return data ? posting(data.title, data.company_name ?? token, [data.location?.name, unescape(data.content ?? '')]) : null;
  } },
  { name: 'Lever', test: (url) => /(^|\.)lever\.co$/.test(url.hostname), async read(url) {
    const [, company, id] = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/) ?? [];
    if (!company) return null;
    const data = (await get(`https://api.${url.hostname.includes('.eu.') ? 'eu.' : ''}lever.co/v0/postings/${encodeURIComponent(company)}/${id}`, { json: true })).body;
    return data ? posting(data.text, company, [data.categories?.location, data.descriptionPlain ?? data.description, ...(data.lists ?? []).map(list => `${list.text}\n${list.content}`), data.additionalPlain ?? data.additional]) : null;
  } },
  { name: 'Ashby', test: (url) => url.hostname === 'jobs.ashbyhq.com', async read(url) {
    const [, org, id] = url.pathname.match(/^\/([^/]+)\/([0-9a-f-]{36})/) ?? [];
    if (!org) return null;
    const job = (await get(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org)}`, { json: true })).body?.jobs?.find(item => item.id === id);
    return job ? posting(job.title, decodeURIComponent(org), [job.location, job.descriptionPlain ?? job.descriptionHtml]) : null;
  } },
  { name: 'SmartRecruiters', test: (url) => url.hostname === 'jobs.smartrecruiters.com', async read(url) {
    const [, company, id] = url.pathname.match(/^\/([^/]+)\/(\d+)/) ?? [];
    if (!company) return null;
    const data = (await get(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings/${id}`, { json: true })).body;
    const sections = data?.jobAd?.sections ?? {};
    return data ? posting(data.name, data.company?.name ?? company, [data.location?.city, sections.jobDescription?.text, sections.qualifications?.text, sections.additionalInformation?.text]) : null;
  } },
];
/** The posting from its platform's feed; { problem: 'gone' } when the platform no longer lists it; null for other sites. */
const feed = async (url) => {
  for (const source of FEEDS) if (source.test(url)) { const text = await source.read(url).catch(() => null); return text ? { text, via: source.name } : { problem: 'gone' }; }
  return null;
};

/**
 * The posting behind a link: { text, via } when it could be read, otherwise { problem }:
 * 'refused' when the site does not allow it, 'gone' when its platform no longer lists it, 'empty' when
 * the page has no posting text of its own (for example a page drawn entirely by scripts).
 */
export async function readJob(input) {
  const url = safeJobUrl(input);
  if (!url) return { problem: 'refused' };
  const known = await feed(url);
  if (known) return known;
  const page = await get(url.href);
  if (page.refused) return { problem: 'refused' };
  // A short or tracking link that lands on a platform with a feed is read the proper way.
  const landed = safeJobUrl(page.url);
  if (landed && landed.hostname !== url.hostname) { const moved = await feed(landed); if (moved) return moved; }
  const text = htmlToJobText(page.body);
  return text ? { text, via: 'page' } : { problem: 'empty' };
}

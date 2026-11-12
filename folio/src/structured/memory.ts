import { regionClient } from '../auth/regions';
import { requirementTerms } from '../tailoring/local';
import { loadMemory, saveMemory } from './store';
import type { Account } from './sync';

/**
 * Career memory: what the applicant has told Folio about their work beyond one resume, such as notes,
 * other documents, public GitHub projects and their own site. Tailoring may draw on it, so a
 * resume can gain a real project or skill that the uploaded file left out. It is the applicant's own
 * account of themselves; nothing here is written by AI.
 */
export type MemoryKind = 'note' | 'file' | 'linkedin' | 'github' | 'website' | 'voice';
export interface MemoryItem { id: string; kind: MemoryKind; title: string; text: string; source: string; createdAt: string; updatedAt: string }
export interface Memory { id: string; items: MemoryItem[]; removed: string[]; updatedAt: string; synced?: { user: string; at: string } }

export const KIND_LABEL: Record<MemoryKind, string> = { note: 'Note', file: 'Document', linkedin: 'LinkedIn', github: 'GitHub', website: 'Website', voice: 'Voice note' };
export const MAX_ITEM_CHARS = 30_000;
const now = () => new Date().toISOString();
export const emptyMemory = (): Memory => ({ id: crypto.randomUUID(), items: [], removed: [], updatedAt: now() });
export const newItem = (kind: MemoryKind, title: string, text: string, source = ''): MemoryItem =>
  ({ id: crypto.randomUUID(), kind, title: title.trim().slice(0, 160) || KIND_LABEL[kind], text: text.trim().slice(0, MAX_ITEM_CHARS), source, createdAt: now(), updatedAt: now() });

/** Adds an item, or replaces the one that came from the same source (a re-imported repository or page). */
export function withItem(memory: Memory, item: MemoryItem): Memory {
  const same = memory.items.find(have => have.id === item.id || (item.source && have.source === item.source && have.kind === item.kind));
  const next = same ? { ...item, id: same.id, createdAt: same.createdAt, updatedAt: now() } : item;
  return { ...memory, updatedAt: now(), items: same ? memory.items.map(have => have.id === same.id ? next : have) : [next, ...memory.items] };
}
export const withoutItem = (memory: Memory, id: string): Memory => ({ ...memory, updatedAt: now(), items: memory.items.filter(item => item.id !== id), removed: [...new Set([...memory.removed, id])] });

/** Two copies of the memory (this device and the account): every item is kept, the newer edit wins, removed items stay removed. */
export function mergeMemory(a: Memory, b: Memory): Memory {
  const removed = [...new Set([...a.removed, ...b.removed])], items = new Map<string, MemoryItem>();
  for (const item of [...a.items, ...b.items]) { const seen = items.get(item.id); if (!seen || item.updatedAt > seen.updatedAt) items.set(item.id, item); }
  return { id: a.id, removed, updatedAt: a.updatedAt >= b.updatedAt ? a.updatedAt : b.updatedAt, items: [...items.values()].filter(item => !removed.includes(item.id)).sort((x, y) => y.createdAt.localeCompare(x.createdAt)) };
}

/**
 * The memory as text for one tailoring. When it is too long to send whole, the items that share the
 * most terms with the posting go first, so the relevant projects are the ones the AI sees.
 */
export function memoryText(memory: Memory | null, jobText: string, limit = 22_000): string {
  if (!memory?.items.length) return '';
  const terms = requirementTerms(jobText), score = (item: MemoryItem) => { const text = `${item.title} ${item.text}`.toLowerCase(); return terms.filter(term => text.includes(term)).length; };
  const ranked = [...memory.items].map(item => ({ item, score: score(item) })).sort((a, b) => b.score - a.score || b.item.updatedAt.localeCompare(a.item.updatedAt));
  let out = '';
  for (const { item } of ranked) {
    const block = `## ${item.title} (${KIND_LABEL[item.kind]}${item.source ? `, ${item.source}` : ''})\n${item.text.slice(0, 6000)}\n\n`;
    if (out.length + block.length > limit) { if (!out) out = block.slice(0, limit); break; }
    out += block;
  }
  return out.trim();
}

export const readMemory = async (): Promise<Memory> => (await loadMemory<Memory>()) ?? emptyMemory();
export const writeMemory = (memory: Memory) => saveMemory(memory);

// ---- The account's copy: one row in public.resumes with schema_version 3 ----
const strip = ({ synced: _synced, ...rest }: Memory) => rest;
async function accountId(account: Account): Promise<string> {
  const { data, error } = await regionClient(account.region).from('profiles').select('default_account_id').eq('user_id', account.user).single();
  if (error || !data?.default_account_id) throw new Error('account');
  return data.default_account_id;
}
export async function pushMemory(account: Account, memory: Memory): Promise<Memory> {
  const { error } = await regionClient(account.region).from('resumes').upsert({ id: memory.id, account_id: await accountId(account), title: 'Career memory', is_base: false, schema_version: 3, data: strip(memory), updated_at: memory.updatedAt });
  if (error) throw new Error('push');
  return { ...memory, synced: { user: account.user, at: memory.updatedAt } };
}
/** Brings this device's memory and the account's into one, and returns it. */
export async function syncMemory(account: Account): Promise<Memory> {
  const client = regionClient(account.region);
  const { data, error } = await client.from('resumes').select('id, data').eq('schema_version', 3);
  if (error) throw new Error('pull');
  const remote = (data ?? []).filter(row => Array.isArray(row.data?.items)).map(row => ({ ...(row.data as Memory), id: row.id as string, removed: row.data.removed ?? [] }));
  const local = await readMemory();
  // A memory that belonged to someone else who used this browser is not carried into this account.
  const mine = local.synced && local.synced.user !== account.user ? emptyMemory() : local;
  if (!remote.length && !mine.items.length && !mine.removed.length) return mine;
  // The account keeps a single copy; if two devices each started one, they are folded together.
  const merged = remote.reduce((all, next) => mergeMemory(all, next), { ...mine, id: remote[0]?.id ?? mine.id });
  for (const extra of remote.slice(1)) await client.from('resumes').delete().eq('id', extra.id);
  const same = remote.length === 1 && JSON.stringify(remote[0].items) === JSON.stringify(merged.items) && remote[0].removed.length === merged.removed.length;
  const saved = same ? { ...merged, synced: { user: account.user, at: merged.updatedAt } } : await pushMemory(account, merged);
  await writeMemory(saved);
  return saved;
}

// ---- Sources ----
/** Public repositories of a GitHub user, read from GitHub's public API straight from this browser. */
export async function githubProjects(input: string): Promise<MemoryItem[]> {
  const user = input.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  if (!/^[A-Za-z\d](?:[A-Za-z\d-]{0,38})$/.test(user)) throw new Error('Enter a GitHub username, such as octocat.');
  const response = await fetch(`https://api.github.com/users/${user}/repos?per_page=100&sort=pushed`, { headers: { Accept: 'application/vnd.github+json' } }).catch(() => null);
  if (!response) throw new Error('GitHub could not be reached. Check your connection and try again.');
  if (response.status === 404) throw new Error(`GitHub has no user called ${user}.`);
  if (response.status === 403 || response.status === 429) throw new Error('GitHub is limiting requests from your network right now. Try again in a few minutes.');
  if (!response.ok) throw new Error('GitHub could not list those projects. Try again.');
  type Repo = { name: string; full_name: string; html_url: string; description: string | null; language: string | null; topics?: string[]; stargazers_count: number; fork: boolean; archived: boolean; homepage: string | null; created_at: string; pushed_at: string };
  const repos = ((await response.json()) as Repo[]).filter(repo => !repo.fork).sort((a, b) => b.stargazers_count - a.stargazers_count || b.pushed_at.localeCompare(a.pushed_at)).slice(0, 8);
  if (!repos.length) throw new Error(`${user} has no public projects of their own on GitHub.`);
  return Promise.all(repos.map(async (repo, index) => {
    // The README says what the project is; only the first few are fetched, to stay within GitHub's hourly allowance.
    const readme = index < 5 ? await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, { headers: { Accept: 'application/vnd.github.raw' } }).then(result => result.ok ? result.text() : '').catch(() => '') : '';
    const about = readme.replace(/<[^>]+>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#*`>|_~]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
    const years = `${repo.created_at.slice(0, 4)}${repo.pushed_at.slice(0, 4) !== repo.created_at.slice(0, 4) ? ` – ${repo.pushed_at.slice(0, 4)}` : ''}`;
    const facts = [`Project: ${repo.name}`, `Link: ${repo.html_url.replace(/^https:\/\//, '')}`, `Dates: ${years}`, repo.description && `Summary: ${repo.description}`, repo.language && `Main language: ${repo.language}`, repo.topics?.length && `Topics: ${repo.topics.join(', ')}`, repo.stargazers_count > 0 && `GitHub stars: ${repo.stargazers_count}`, repo.homepage && `Site: ${repo.homepage}`, about && `From its README:\n${about}`];
    return newItem('github', repo.name, facts.filter(Boolean).join('\n'), repo.html_url);
  }));
}

/** Dictation through the browser's own speech service, where it has one. */
type Recognition = { lang: string; continuous: boolean; interimResults: boolean; onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null; start(): void; stop(): void };
export function dictation(): (new () => Recognition) | null {
  const scope = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

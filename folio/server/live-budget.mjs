import { open, mkdir, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { MODEL, MAX_OUTPUT_TOKENS } from './contract.mjs';

export const LIVE_BUDGET_USD = 5;
export const MAX_LIVE_GENERATIONS = 3;
const INPUT_RESERVE_PER_MILLION = 3;
const OUTPUT_RESERVE_PER_MILLION = 12;
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usd = z.number().finite().nonnegative().max(LIVE_BUDGET_USD);
const usageSchema = z.object({ inputTokens: revision, outputTokens: revision, totalTokens: revision }).strict();
const RESULT_CODES = ['reserved', 'success', 'provider_auth', 'provider_access', 'provider_rate_limit', 'provider_error', 'provider_timeout', 'provider_invalid_response', 'provider_refusal', 'provider_incomplete', 'internal_error'];
const entrySchema = z.object({
  requestId: z.string().uuid(), fixture: z.literal('independent-positive'), reservedAt: z.string().datetime(),
  providerBodyBytes: revision, inputTokenBound: revision, maxOutputTokens: z.literal(MAX_OUTPUT_TOKENS),
  reservationUsd: usd, result: z.enum(RESULT_CODES), durationMs: revision.nullable(),
  usage: usageSchema.nullable(), estimatedStandardCostUsd: usd.nullable(), proposalCount: revision.nullable(),
}).strict();
const ledgerSchema = z.object({
  schemaVersion: z.literal(1), model: z.literal(MODEL), budgetUsd: z.literal(LIVE_BUDGET_USD),
  maxGenerationCalls: z.literal(MAX_LIVE_GENERATIONS),
  reservationPolicy: z.literal('retain-full-reservation-for-every-call'),
  account: z.object({ verified: z.boolean(), checkedAt: z.string().datetime(), durationMs: revision, result: z.enum(['verified', ...RESULT_CODES]) }).strict().nullable(),
  entries: z.array(entrySchema).max(MAX_LIVE_GENERATIONS),
}).strict().refine(value => new Set(value.entries.map(entry => entry.requestId)).size === value.entries.length)
  .refine(value => value.entries.reduce((sum, entry) => sum + entry.reservationUsd, 0) <= LIVE_BUDGET_USD);

export class BudgetGuardError extends Error {
  constructor(code) { super('The live validation budget guard stopped the operation.'); this.code = code; }
}

export function generationReservation(body) {
  if (typeof body !== 'string') throw new BudgetGuardError('invalid_provider_body');
  const parsed = JSON.parse(body);
  if (parsed.model !== MODEL || parsed.max_output_tokens !== MAX_OUTPUT_TOKENS || parsed.store !== false ||
      parsed.reasoning?.effort !== 'medium' || parsed.stream !== false || parsed.tools !== undefined) {
    throw new BudgetGuardError('invalid_provider_body');
  }
  const providerBodyBytes = Buffer.byteLength(body, 'utf8');
  // Entire encoded provider body includes instructions and schema; add framing margin.
  const inputTokenBound = providerBodyBytes + 2048;
  const reservationUsd = Math.ceil((inputTokenBound * INPUT_RESERVE_PER_MILLION + MAX_OUTPUT_TOKENS * OUTPUT_RESERVE_PER_MILLION)) / 1_000_000;
  if (reservationUsd > LIVE_BUDGET_USD) throw new BudgetGuardError('budget_exhausted');
  return { providerBodyBytes, inputTokenBound, maxOutputTokens: MAX_OUTPUT_TOKENS, reservationUsd };
}

export function safeUsage(value) {
  const result = usageSchema.safeParse(value);
  if (!result.success || result.data.totalTokens !== result.data.inputTokens + result.data.outputTokens) return null;
  return result.data;
}

export function estimatedStandardCost(usage) {
  // Estimate, not an invoice; no cached-token discount and no reasoning subtraction.
  return Math.round((usage.inputTokens * 2 + usage.outputTokens * 10)) / 1_000_000;
}

async function atomicJson(path, value) {
  const temporary = join(dirname(path), `.budget-write-${randomUUID()}.json`);
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(dirname(path), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function openLiveBudget(directory) {
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, '.live-validation.lock');
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new BudgetGuardError('live_validation_locked'); }
  const ledgerPath = join(directory, 'budget-ledger.json');
  let ledger;
  try {
    try {
      const raw = await readFile(ledgerPath, 'utf8');
      const parsed = ledgerSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) throw new BudgetGuardError('invalid_budget_ledger');
      ledger = parsed.data;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      ledger = {
        schemaVersion: 1, model: MODEL, budgetUsd: LIVE_BUDGET_USD, maxGenerationCalls: MAX_LIVE_GENERATIONS,
        reservationPolicy: 'retain-full-reservation-for-every-call', account: null, entries: [],
      };
      await atomicJson(ledgerPath, ledger);
    }
  } catch {
    await lock.close(); await unlink(lockPath);
    throw new BudgetGuardError('invalid_budget_ledger');
  }

  const committed = () => ledger.entries.reduce((sum, entry) => sum + entry.reservationUsd, 0);
  return {
    summary() { return { budgetUsd: LIVE_BUDGET_USD, generationCalls: ledger.entries.length, committedReservationUsd: Number(committed().toFixed(6)), remainingBudgetUsd: Number((LIVE_BUDGET_USD - committed()).toFixed(6)) }; },
    hasSuccessfulGeneration() { return ledger.entries.some(entry => entry.result === 'success'); },
    async account(result, durationMs) {
      ledger.account = { verified: result === 'verified', checkedAt: new Date().toISOString(), durationMs, result: RESULT_CODES.includes(result) || result === 'verified' ? result : 'internal_error' };
      await atomicJson(ledgerPath, ledger);
    },
    async reserve(requestId, body) {
      if (!z.string().uuid().safeParse(requestId).success) throw new BudgetGuardError('invalid_request_id');
      if (ledger.entries.length >= MAX_LIVE_GENERATIONS || ledger.entries.some(entry => entry.requestId === requestId)) throw new BudgetGuardError('generation_limit');
      const reservation = generationReservation(body);
      if (committed() + reservation.reservationUsd > LIVE_BUDGET_USD) throw new BudgetGuardError('budget_exhausted');
      ledger.entries.push({
        requestId, fixture: 'independent-positive', reservedAt: new Date().toISOString(), ...reservation,
        result: 'reserved', durationMs: null, usage: null, estimatedStandardCostUsd: null, proposalCount: null,
      });
      // Durable reservation completes before the caller is allowed to fetch.
      await atomicJson(ledgerPath, ledger);
      return reservation;
    },
    async settle(requestId, { result, durationMs, usage = null, proposalCount = null }) {
      const entry = ledger.entries.find(item => item.requestId === requestId);
      if (!entry || entry.result !== 'reserved') throw new BudgetGuardError('invalid_settlement');
      const validatedUsage = safeUsage(usage);
      const measuredUsage = validatedUsage && validatedUsage.inputTokens <= entry.inputTokenBound && validatedUsage.outputTokens <= MAX_OUTPUT_TOKENS ? validatedUsage : null;
      Object.assign(entry, {
        result: RESULT_CODES.includes(result) && result !== 'reserved' ? result : 'internal_error', durationMs,
        usage: measuredUsage, estimatedStandardCostUsd: measuredUsage ? estimatedStandardCost(measuredUsage) : null, proposalCount,
      });
      if (!ledgerSchema.safeParse(ledger).success) throw new BudgetGuardError('invalid_settlement');
      await atomicJson(ledgerPath, ledger);
      return structuredClone(entry);
    },
    async writeArtifact(name, value) {
      if (!/^[a-z][a-z0-9-]*\.json$/.test(name)) throw new BudgetGuardError('invalid_artifact_name');
      await atomicJson(join(directory, name), value);
    },
    async close() { await lock.close(); await unlink(lockPath); },
  };
}

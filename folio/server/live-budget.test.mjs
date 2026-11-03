import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL, MAX_OUTPUT_TOKENS } from './contract.mjs';
import { openLiveBudget, generationReservation, safeUsage } from './live-budget.mjs';

const providerBody = () => JSON.stringify({ model: MODEL, store: false, stream: false, reasoning: { effort: 'medium' }, max_output_tokens: MAX_OUTPUT_TOKENS, instructions: 'Fictional fixture', input: 'Fictional only' });
const expectCode = code => error => error.code === code;

test('precall reservation includes encoded instructions, schema/body, framing margin and all output tokens', () => {
  const body = providerBody();
  const reserve = generationReservation(body);
  assert.equal(reserve.providerBodyBytes, Buffer.byteLength(body));
  assert.equal(reserve.inputTokenBound, Buffer.byteLength(body) + 2048);
  assert.ok(reserve.reservationUsd >= 0.024);
  assert.throws(() => generationReservation(JSON.stringify({ model: 'other' })), expectCode('invalid_provider_body'));
  assert.equal(safeUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 3 }).outputTokens, 2);
  assert.equal(safeUsage({ inputTokens: 1, outputTokens: 2, totalTokens: 1 }), null);
});

test('lock blocks concurrent callers; durable reservation survives reopen; unknown usage retains its entire commitment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-live-budget-'));
  let budget;
  try {
    budget = await openLiveBudget(directory);
    await assert.rejects(openLiveBudget(directory), expectCode('live_validation_locked'));
    const requestId = randomUUID();
    const reservation = await budget.reserve(requestId, providerBody());
    const persisted = JSON.parse(await readFile(join(directory, 'budget-ledger.json'), 'utf8'));
    assert.equal(persisted.entries[0].result, 'reserved');
    assert.equal(persisted.entries[0].requestId, requestId);
    await budget.close(); budget = await openLiveBudget(directory);
    assert.equal(budget.summary().generationCalls, 1);
    await budget.settle(requestId, { result: 'provider_timeout', durationMs: 45_000 });
    assert.equal(budget.summary().committedReservationUsd, reservation.reservationUsd);
    assert.equal(budget.hasSuccessfulGeneration(), false);
    for (let i = 0; i < 2; i++) {
      const nextId = randomUUID(); await budget.reserve(nextId, providerBody());
      await budget.settle(nextId, { result: 'success', durationMs: 1, usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, proposalCount: 1 });
    }
    assert.equal(budget.hasSuccessfulGeneration(), true);
    await assert.rejects(budget.reserve(randomUUID(), providerBody()), expectCode('generation_limit'));
    assert.equal(budget.summary().generationCalls, 3);
  } finally { if (budget) await budget.close(); await rm(directory, { recursive: true, force: true }); }
});

test('existing malformed or inflated ledger fails closed rather than resetting the budget', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'folio-live-budget-invalid-'));
  try {
    await writeFile(join(directory, 'budget-ledger.json'), '{"budgetUsd":999}');
    await assert.rejects(openLiveBudget(directory), expectCode('invalid_budget_ledger'));
    assert.equal(await readFile(join(directory, 'budget-ledger.json'), 'utf8'), '{"budgetUsd":999}');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { MODEL, MAX_OUTPUT_TOKENS } from './contract.mjs';
import { buildExpandedProfileRequest, openExpandedProfileBudget } from './live-expanded-profile-validation.mjs';

const body = () => JSON.stringify({ model: MODEL, store: false, stream: false, reasoning: { effort: 'medium' }, max_output_tokens: MAX_OUTPUT_TOKENS, input: 'Fictional only' });
async function directories() {
  const root = await mkdtemp(join(tmpdir(), 'folio-expanded-profile-')), priorDirectory = join(root, 'prior'), outputDirectory = join(root, 'new');
  await mkdir(priorDirectory);
  await writeFile(join(priorDirectory, 'budget-ledger.json'), JSON.stringify({ schemaVersion: 1, model: MODEL, budgetUsd: 5, maxGenerationCalls: 3, reservationPolicy: 'retain-full-reservation-for-every-call', entries: [{ result: 'success', reservationUsd: 0.038106, estimatedStandardCostUsd: 0.003156 }] }));
  for (const name of ['live-result.json', 'positive-proposal.json', 'protocol-envelope-label.json', 'source-grounding-review.json']) await writeFile(join(priorDirectory, name), '{"fictionalOnly":true}');
  return { root, priorDirectory, outputDirectory };
}
const expectCode = code => error => error.code === code;

test('historical completed expanded runner cannot resubmit its budgetless fixture under the current contract', async () => {
  await assert.rejects(buildExpandedProfileRequest(), expectCode('invalid_expanded_fixture'));
});

test('separate cumulative ledger includes prior spend, globally locks both routes and permanently consumes its one-call scope', async () => {
  const paths = await directories(); let budget;
  try {
    const priorBytes = await readFile(join(paths.priorDirectory, 'budget-ledger.json'));
    budget = await openExpandedProfileBudget(paths);
    assert.equal(budget.summary().committedReservationUsd, 0.038106);
    await assert.rejects(openExpandedProfileBudget(paths), expectCode('live_validation_locked'));
    const requestId = randomUUID(), reservation = await budget.reserve(requestId, body());
    assert.equal(budget.summary().cumulativeGenerationCalls, 2);
    assert.ok(budget.summary().committedReservationUsd > reservation.reservationUsd);
    const persisted = JSON.parse(await readFile(join(paths.outputDirectory, 'cumulative-budget-ledger.json')));
    assert.equal(persisted.entries[0].result, 'reserved');
    assert.equal(persisted.anchor.priorCommittedReservationUsd, 0.038106);
    await budget.settle(requestId, { result: 'provider_timeout', durationMs: 45_000 });
    await budget.preservePrior();
    assert.deepEqual(await readFile(join(paths.priorDirectory, 'budget-ledger.json')), priorBytes);
    await budget.close(); budget = await openExpandedProfileBudget(paths);
    assert.throws(() => budget.assertAvailable(), expectCode('purpose_call_already_consumed'));
    await assert.rejects(budget.reserve(randomUUID(), body()), expectCode('purpose_call_already_consumed'));
    assert.ok(budget.summary().remainingBudgetUsd < 5 - 0.038106);
  } finally { if (budget) await budget.close(); await rm(paths.root, { recursive: true, force: true }); }
});

test('changed prior evidence and inflated or malformed cumulative ledger fail closed without reset', async () => {
  const paths = await directories(); let budget;
  try {
    budget = await openExpandedProfileBudget(paths); await budget.close(); budget = null;
    await writeFile(join(paths.priorDirectory, 'live-result.json'), '{"changed":true}');
    await assert.rejects(openExpandedProfileBudget(paths), expectCode('cumulative_budget_mismatch'));
    await writeFile(join(paths.outputDirectory, 'cumulative-budget-ledger.json'), '{"budgetUsd":999}');
    await assert.rejects(openExpandedProfileBudget(paths), expectCode('cumulative_budget_mismatch'));
    assert.equal(await readFile(join(paths.outputDirectory, 'cumulative-budget-ledger.json'), 'utf8'), '{"budgetUsd":999}');
  } finally { if (budget) await budget.close(); await rm(paths.root, { recursive: true, force: true }); }
});

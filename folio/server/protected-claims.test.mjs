import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnsupportedNumericClaims, numericExpressions } from './protected-claims.mjs';
import { validateProposals } from './contract.mjs';

const unsupported = (afterText, ...facts) => hasUnsupportedNumericClaims(afterText, facts.map(text => ({ text })));

test('new counts, decimals, thousands, percentages, currencies and numeric dates need the cited exact expressions', () => {
  for (const expression of ['23', '12.5', '1,000', '10%', '$10', 'USD 100', '100 euros', '2026-10-04', '10/04/2026', 'January 15, 2025', '15 January 2025', '3x', '5×']) {
    assert.equal(unsupported(`Achieved ${expression}.`, 'Built interfaces.'), true, expression);
    assert.equal(unsupported(`Achieved ${expression}.`, `Evidence: ${expression}.`), false, expression);
  }
});

test('unit preservation rejects 10 projects to 10 percent and two years to two decades', () => {
  assert.equal(unsupported('Improved throughput by 10%.', 'Delivered 10 projects.'), true);
  assert.equal(unsupported('Has 2 decades of experience.', 'Has 2 years of experience.'), true);
  assert.equal(unsupported('Has a 2-year tenure.', 'Delivered 2 projects.'), true);
  assert.equal(unsupported('Has a five-year tenure.', 'Has five decades of experience.'), true);
  assert.equal(unsupported('Served from Jan. 2026.', 'Delivered 2026 items.'), true);
  assert.equal(unsupported('Won 1st place.', 'Delivered 1 project.'), true);
  assert.equal(unsupported('Has two decades of experience.', 'Has two years of experience.'), true);
  assert.equal(unsupported('Saved $10 million.', 'Saved $10.'), true);
  assert.equal(unsupported('Has 5+ years of experience.', 'Has five years of experience.'), true);
  assert.equal(unsupported('Has 5 years of experience.', 'Has five years of experience.'), true);
});

test('only case and whitespace are normalized; no arithmetic or reformatted equivalence is asserted', () => {
  assert.equal(unsupported('Has Five   Years of experience.', 'Has five years of experience.'), false);
  assert.equal(unsupported('Served from January  2024.', 'Served from january 2024.'), false);
  assert.equal(unsupported('Delivered 1000 items.', 'Delivered 1,000 items.'), true);
  assert.equal(unsupported('Has 4 years of experience.', 'First role: 2 years.', 'Second role: 2 years.'), true);
});

test('unsupported numeric claims reject all proposals; uncited evidence cannot authorize a metric', () => {
  const beforeText = 'Built interfaces, with supporting details retained for applicant review.';
  const request = {
    blocks: [{ id: 'block-1', text: beforeText, requiredFactIds: ['fact-1'],
      layoutBudget: { version: 1, regionId: 'region-numeric', widthPt: 400, heightPt: 60, fontFamily: 'sans',
        fontSizePt: 10, fontWeight: 400, italic: false, lineHeightPt: 12, maxLines: 5, maxCharacters: beforeText.length },
    }],
    facts: [{ id: 'fact-1', text: 'Built interfaces.' }, { id: 'fact-2', text: 'Improved throughput by 10%.' }],
  };
  const value = { proposals: [{ blockId: 'block-1', beforeText, afterText: 'Improved throughput by 10%.', factIds: ['fact-1'], reason: 'Unsupported metric.' }] };
  assert.equal(validateProposals(value, request), null);
  value.proposals[0].factIds = ['fact-1', 'fact-2'];
  assert.equal(validateProposals(value, request).length, 1);
});

test('literal guard is explicitly narrower than semantic truth verification', () => {
  assert.deepEqual(numericExpressions('Built HTML5 and ES2022 interfaces.'), []);
  assert.equal(unsupported('Led the team.', 'Participated in the team.'), false);
  assert.equal(unsupported('Has expertise with TypeScript.', 'Has exposure to TypeScript.'), false);
});

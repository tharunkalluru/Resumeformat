import assert from 'node:assert/strict';
import test from 'node:test';
import { annotateProposals, consentHash, hashText, tailorRequestSchema, validateProposals } from './contract.mjs';
const BEFORE_TEXT = 'Built interfaces. Supporting experience and project details remain available for applicant review.';

function resumeFact(text = 'Built accessible interfaces.', factId = 'resume-fact') {
  return {
    id: factId, text, kind: 'resume', confirmed: false, version: 1, assertionId: null, textHash: hashText(text),
    source: { id: 'resume-source', kind: 'resume', version: 1, hash: hashText('fictional-pdf-bytes'), quote: text, quoteHash: hashText(text), locator: 'page 1, text 4' },
    confirmation: null,
  };
}
function legacyFact(text = 'Designed accessible search.', factId = 'legacy-fact', kind = 'careerNote') {
  return {
    id: factId, text, kind, confirmed: true, version: 1, assertionId: null, textHash: hashText(text),
    source: { id: factId, kind, version: 1, hash: hashText(text), quote: text, quoteHash: hashText(text), locator: 'application note' },
    confirmation: { version: 1, textHash: hashText(text), confirmedAt: null },
  };
}
function memoryFact() {
  const text = 'Led 4 accessibility workshops for a fictional project.', quote = 'Led 6 accessibility workshops for a fictional project.';
  return {
    id: 'memory-fact-version-2', text, kind: 'careerNote', confirmed: true, version: 2, assertionId: 'assertion-1', textHash: hashText(text),
    source: { id: 'memory-source', kind: 'typed', version: 1, hash: hashText(quote), quote, quoteHash: hashText(quote), locator: 'typed paragraph 1' },
    confirmation: { version: 2, textHash: hashText(text), confirmedAt: '2026-10-04T12:00:00.000Z' },
  };
}
function request(facts = [resumeFact()]) {
  const body = {
    schemaVersion: 1, allowedOperations: ['replaceParagraphText'], requestId: 'expanded-request',
    context: {
      projectId: 'project-1', projectRevision: 4, draftRevision: 3,
      templateId: 'template-1', templateRevision: 1, templateHash: hashText('fictional-template'),
      baselineRevision: 1, baselineHash: hashText('fictional-baseline'), memorySnapshotId: null, memoryRevision: null, memoryHash: null,
    },
    job: { title: '', company: '', description: 'Accessible interface design.' },
    facts, blocks: [{ id: 'block-1', text: BEFORE_TEXT, textHash: hashText(BEFORE_TEXT), requiredFactIds: [facts[0].id],
      layoutBudget: { version: 1, regionId: 'region-contract', widthPt: 400, heightPt: 60, fontFamily: 'sans',
        fontSizePt: 10, fontWeight: 400, italic: false, lineHeightPt: 12, maxLines: 5, maxCharacters: BEFORE_TEXT.length },
    }],
  };
  if (facts.some(fact => fact.assertionId !== null)) Object.assign(body.context, { memorySnapshotId: 'snapshot-1', memoryRevision: 4, memoryHash: hashText('pinned-memory-snapshot') });
  return { ...body, consent: { confirmed: true, contextHash: consentHash(body) } };
}
const valid = value => tailorRequestSchema.safeParse(value).success;

test('exact UTF8 SHA256 vectors and expanded imported-resume envelope validate', () => {
  assert.equal(hashText('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.notEqual(hashText('é'), hashText('e\u0301'), 'no Unicode normalization');
  assert.equal(valid(request()), true);
});

test('claim, source quote and block checksums are recomputed; resume quotes remain exact', () => {
  for (const mutate of [
    value => { value.facts[0].textHash = hashText('changed claim'); },
    value => { value.facts[0].source.quoteHash = hashText('changed quote'); },
    value => { value.facts[0].source.quote = 'Different quote.'; value.facts[0].source.quoteHash = hashText('Different quote.'); },
    value => { value.blocks[0].textHash = hashText('changed paragraph'); },
    value => { value.facts[0].source.version = 2; },
    value => { value.facts[0].source.hash = 'not-a-hash'; },
    value => { value.facts[0].version = 2; },
    value => { value.facts[0].confirmation = { version: 1, textHash: value.facts[0].textHash, confirmedAt: null }; },
    value => { value.facts[0].source.kind = 'typed'; },
  ]) {
    const value = request(); mutate(value); assert.equal(valid(value), false);
  }
});

test('pinned memory assertions require the selected version confirmation and actual timestamp while original quotes remain immutable', () => {
  const value = request([memoryFact()]);
  assert.equal(valid(value), true);
  assert.notEqual(value.facts[0].source.quote, value.facts[0].text);
  for (const mutate of [
    fact => { fact.confirmed = false; },
    fact => { fact.kind = 'applicantEdit'; },
    fact => { fact.confirmation = null; },
    fact => { fact.confirmation.version = 1; },
    fact => { fact.confirmation.textHash = fact.source.quoteHash; },
    fact => { fact.confirmation.confirmedAt = null; },
    fact => { fact.confirmation.confirmedAt = 'not-a-date'; },
    fact => { fact.source.kind = 'careerNote'; },
  ]) {
    const changed = request([memoryFact()]); mutate(changed.facts[0]); assert.equal(valid(changed), false);
  }
  const correctedResume = request([memoryFact()]); correctedResume.facts[0].source.kind = 'resume';
  assert.equal(valid(correctedResume), true, 'confirmed correction can cite a different immutable resume quote');
  const unpinnedAssertion = request([memoryFact()]);
  Object.assign(unpinnedAssertion.context, { memorySnapshotId: null, memoryRevision: null, memoryHash: null });
  assert.equal(valid(unpinnedAssertion), false, 'an assertion requires a pinned snapshot context');
});

test('legacy application-only facts retain truthful unknown timestamps and self-contained provenance', () => {
  for (const kind of ['careerNote', 'applicantEdit']) assert.equal(valid(request([legacyFact(undefined, undefined, kind)])), true);
  for (const mutate of [
    fact => { fact.source.kind = 'typed'; },
    fact => { fact.source.id = 'other-fact'; },
    fact => { fact.source.hash = hashText('other-source'); },
    fact => { fact.confirmation = null; },
    fact => { fact.version = 2; fact.confirmation.version = 2; },
  ]) {
    const value = request([legacyFact()]); mutate(value.facts[0]); assert.equal(valid(value), false);
  }
});

test('snapshot identity/revision/hash triplet and fixed permitted operation fail closed', () => {
  for (const mutate of [
    value => { value.context.memoryHash = hashText('memory'); },
    value => { value.context.memorySnapshotId = 'snapshot'; value.context.memoryRevision = 1; },
    value => { delete value.context.templateId; },
    value => { value.context.baselineHash = 'invalid'; },
    value => { value.allowedOperations = ['addFact']; },
    value => { value.allowedOperations.push('replaceParagraphText'); },
    value => { value.schemaVersion = 2; },
  ]) {
    const value = request(); mutate(value); assert.equal(valid(value), false);
  }
});

test('consent binds schema, permitted operations, versions, source hashes, locators and confirmation time', () => {
  const value = request([memoryFact()]), original = consentHash(value);
  for (const mutate of [
    input => { input.schemaVersion = 2; },
    input => { input.allowedOperations = ['addFact']; },
    input => { input.context.templateId = 'different-template'; },
    input => { input.context.baselineRevision++; },
    input => { input.context.memoryHash = hashText('different-memory'); },
    input => { input.facts[0].version++; },
    input => { input.facts[0].source.hash = hashText('different-original'); },
    input => { input.facts[0].source.locator = 'typed paragraph 2'; },
    input => { input.facts[0].confirmation.confirmedAt = '2026-10-04T13:00:00.000Z'; },
  ]) {
    const changed = structuredClone(value); mutate(changed); assert.notEqual(consentHash(changed), original);
  }
});

test('source quotes and locators keep the existing per-field and aggregate caps', () => {
  const quoteTooLong = request([memoryFact()]);
  quoteTooLong.facts[0].source.quote = 'x'.repeat(10_001); quoteTooLong.facts[0].source.quoteHash = hashText(quoteTooLong.facts[0].source.quote);
  assert.equal(valid(quoteTooLong), false);
  const locatorTooLong = request(); locatorTooLong.facts[0].source.locator = 'x'.repeat(1001);
  assert.equal(valid(locatorTooLong), false);
  const aggregate = request(Array.from({ length: 10 }, (_, index) => legacyFact('x'.repeat(5000), `legacy-${index}`)));
  assert.equal(valid(aggregate), false, 'claim text plus source quote consumes 100k before job, locator and block text');
});

test('server derives the permitted edit, before/after hashes and exact ordered fact references', () => {
  const value = request([resumeFact(), memoryFact()]);
  const raw = { blockId: 'block-1', beforeText: BEFORE_TEXT, afterText: 'Built accessible interfaces and led 4 accessibility workshops for a fictional project.', factIds: ['memory-fact-version-2', 'resume-fact'], reason: 'Uses selected current evidence.' };
  const proposals = validateProposals({ proposals: [raw] }, value);
  assert.notEqual(proposals, null);
  assert.equal(validateProposals({ proposals: [{ ...raw, afterText: raw.afterText.replace('4 accessibility', '6 accessibility') }] }, value), null, 'immutable source quote cannot authorize a superseded numeric claim');
  const [annotated] = annotateProposals(proposals, value);
  assert.equal(annotated.operation, 'replaceParagraphText');
  assert.equal(annotated.beforeHash, hashText(raw.beforeText));
  assert.equal(annotated.afterHash, hashText(raw.afterText));
  assert.deepEqual(annotated.factRefs.map(reference => [reference.factId, reference.version, reference.assertionId]), [['memory-fact-version-2', 2, 'assertion-1'], ['resume-fact', 1, null]]);
  assert.deepEqual(annotated.factRefs[0], {
    factId: 'memory-fact-version-2', version: 2, assertionId: 'assertion-1', sourceId: 'memory-source', sourceVersion: 1,
    sourceHash: value.facts[1].source.hash, quoteHash: value.facts[1].source.quoteHash, textHash: value.facts[1].textHash,
  });
  for (const extra of [{ operation: 'replaceParagraphText' }, { beforeHash: hashText('forged') }, { factRefs: [] }]) {
    assert.equal(validateProposals({ proposals: [{ ...raw, ...extra }] }, value), null, 'model cannot own derived metadata');
  }
});

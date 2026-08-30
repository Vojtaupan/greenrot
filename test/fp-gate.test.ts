import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measure } from '../scripts/fp-measure.mjs';

test('calling a REAL test FAKE is a false positive', () => {
  const m = measure({ a: 'REAL' }, { a: 'FAKE' });
  assert.equal(m.falseFake, 1);
  assert.equal(m.fpRate, 1);
});

test('calling a FAKE test REAL is a miss, not a false positive', () => {
  const m = measure({ a: 'FAKE' }, { a: 'REAL' });
  assert.equal(m.falseFake, 0);
  assert.equal(m.falseClean, 1);
});

test('UNKNOWN on a labelled test is never counted against us', () => {
  const m = measure({ a: 'REAL' }, { a: 'UNKNOWN' });
  assert.equal(m.falseFake, 0);
  assert.equal(m.falseClean, 0);
  assert.equal(m.compared, 0);
});

test('calling a WEAK test FAKE is a false positive - WEAK is not an accusation', () => {
  const m = measure({ a: 'WEAK' }, { a: 'FAKE' });
  assert.equal(m.falseFake, 1);
});

test('_comment keys in labels.json are not treated as labels', () => {
  const m = measure({ _comment: 'notes', a: 'REAL' }, { a: 'REAL' });
  assert.equal(m.total, 1);
  assert.equal(m.agreements, 1);
});

// This is the gate proving it can go red. A publish gate nobody has ever seen
// fail is a check-13 defect: it would pass a bad release silently.
test('THE GATE GOES RED on a planted false positive', () => {
  const m = measure(
    { good: 'REAL', bad: 'REAL' },
    { good: 'REAL', bad: 'FAKE' },
  );
  assert.ok(m.falseFake > 0, 'a planted false FAKE must be detected');
  assert.ok(m.fpRate > 0);
});

test('a gate that compares nothing is detectable, not silently green', () => {
  // The id-prefix mismatch failure mode: labels and results never line up, so
  // zero comparisons happen and every count is trivially zero. fp-gate.mjs
  // exits 1 on compared === 0 precisely because these numbers look clean.
  const m = measure({ 'python/x::a': 'REAL' }, { 'wrong-prefix::a': 'REAL' });
  assert.equal(m.compared, 0);
  assert.equal(m.falseFake, 0);
  assert.equal(m.agreements, 0);
});

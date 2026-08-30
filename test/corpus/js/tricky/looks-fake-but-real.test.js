// Heavy mocking, but every assertion checks real production behaviour.
// None of these may be flagged FAKE. If greenrot accuses one, the
// false-positive gate blocks the release - which is the point.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Service, collect, toJson } from './service.js';

test('label uppercases the name from the repo', () => {
  const repo = { find: mock.fn(() => ({ name: 'ada' })) };
  // The mock supplies the INPUT; the assertion checks a transformation the
  // production code performs. A real test, despite the mocking.
  assert.equal(new Service(repo).label('k'), 'found:ADA');
});

test('label handles a missing row', () => {
  const repo = { find: mock.fn(() => null) };
  assert.equal(new Service(repo).label('k'), 'missing');
});

test('spy array is filled by production code', () => {
  // THE SPY PATTERN - 3 of 3 false positives on the first real repo greenrot
  // analysed. `seen` looks test-constructed; production code fills it.
  const seen = [];
  collect([1, -2, 3], (n) => {
    seen.push(n);
  });
  assert.deepEqual(seen, [1, 3]);
});

test('asserts by throwing, with no assert call at all', () => {
  // No assertion, but JSON.parse throws on bad input - so this test fails if
  // toJson() ever emits something malformed. "No assertion" is not "checks
  // nothing" when production code runs.
  JSON.parse(toJson({ a: 1 }));
});

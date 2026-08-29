import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocation, type Evidence } from '../../src/core/evidence.ts';
import { probeRequired } from '../../src/core/obligation.ts';

test('every finding renders as path:line so a human can verify it', () => {
  const e: Evidence = {
    kind: 'structural',
    check: 'A1-no-assertion',
    file: 'tests/test_thing.py',
    line: 42,
    detail: 'test body contains no assertion',
  };
  assert.equal(formatLocation(e), 'tests/test_thing.py:42');
});

test('a probe obligation names the test and why it is owed', () => {
  const o = probeRequired('tests/test_thing.py::test_a', 'asserts on production-derived value');
  assert.equal(o.kind, 'probe-required');
  assert.equal(o.testId, 'tests/test_thing.py::test_a');
  assert.match(o.why, /production-derived/);
});

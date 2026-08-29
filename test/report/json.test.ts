import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderJson } from '../../src/core/report/json.ts';
import type { Verdict } from '../../src/core/verdict.ts';

test('json carries the clean claim as a boolean, not prose', () => {
  const out = JSON.parse(renderJson(
    new Map<string, Verdict>([
      ['a', { name: 'UNKNOWN', code: 'probe-timeout', reason: 'slow', evidence: [] }],
    ]),
    new Map([['probe-timeout', 1] as const]),
  ));
  assert.equal(out.canClaimClean, false);
  assert.equal(out.tally.unknown, 1);
  assert.equal(out.tests[0].code, 'probe-timeout');
  assert.equal(out.schema, 1);
});

test('json is stable enough to diff - tests appear in insertion order', () => {
  const out = JSON.parse(renderJson(
    new Map<string, Verdict>([
      ['z', { name: 'REAL', reason: 'x', evidence: [] }],
      ['a', { name: 'REAL', reason: 'x', evidence: [] }],
    ]),
    new Map(),
  ));
  assert.deepEqual(out.tests.map((t: { id: string }) => t.id), ['z', 'a']);
});

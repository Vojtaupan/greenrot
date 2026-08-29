import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderHuman } from '../../src/core/report/human.ts';
import type { Verdict } from '../../src/core/verdict.ts';

const fake: Verdict = {
  name: 'FAKE', reason: 'nothing is ever checked',
  evidence: [{
    kind: 'structural', check: 'A1-no-assertion',
    file: 'tests/test_a.py', line: 12, detail: 'test body contains no assertion',
  }],
};

test('a fake test is rendered with path:line and a named reason', () => {
  const out = renderHuman(new Map([['tests/test_a.py::test_a', fake]]), new Map(), { color: false });
  assert.match(out, /tests\/test_a\.py:12/);
  assert.match(out, /A1-no-assertion/);
  assert.match(out, /no assertion/);
});

test('the headline never claims clean while an unknown exists', () => {
  const out = renderHuman(
    new Map<string, Verdict>([
      ['a', { name: 'REAL', reason: 'ok', evidence: [] }],
      ['b', { name: 'UNKNOWN', code: 'parse-failure', reason: 'bad syntax', evidence: [] }],
    ]),
    new Map([['parse-failure', 1] as const]),
    { color: false },
  );
  assert.match(out, /could not/i);
  // The clean phrasing is "no fake tests across N tests". The hedged phrasing
  // legitimately also opens with "no fake tests", followed by "among the N I
  // could vouch for" - so the invariant is the absence of the CLEAN form, not
  // the absence of those three words.
  assert.doesNotMatch(out, /no fake tests across \d+ tests/i);
  assert.match(out, /no fake tests among the \d+ I could vouch for/i);
});

test('REAL tests are not listed as findings - only what needs attention', () => {
  const out = renderHuman(
    new Map<string, Verdict>([['ok', { name: 'REAL', reason: 'proven', evidence: [] }]]),
    new Map(), { color: false },
  );
  assert.doesNotMatch(out, /^REAL/m);
  assert.match(out, /1 real/);
});

test('color codes are absent when color is off', () => {
  const out = renderHuman(new Map([['a', fake]]), new Map(), { color: false });
  assert.doesNotMatch(out, /\[/);
});

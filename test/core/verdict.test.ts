import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialVerdict, discharge, isTerminal, type Verdict } from '../../src/core/verdict.ts';

const v = (name: Verdict['name'], reason = 'x'): Verdict => ({ name, reason, evidence: [] });

test('every test starts UNKNOWN/not-analyzed', () => {
  const v0 = initialVerdict();
  assert.equal(v0.name, 'UNKNOWN');
  assert.equal(v0.code, 'not-analyzed');
});

test('UNKNOWN may move to any verdict', () => {
  for (const n of ['FAKE', 'WEAK', 'REAL'] as const) {
    assert.equal(discharge(initialVerdict(), v(n)).name, n);
  }
});

test('WEAK may be refined by the probe in both directions', () => {
  assert.equal(discharge(v('WEAK'), v('FAKE')).name, 'FAKE');
  assert.equal(discharge(v('WEAK'), v('REAL')).name, 'REAL');
});

test('FAKE and REAL are terminal - overwriting them is a programming error', () => {
  assert.ok(isTerminal(v('FAKE')));
  assert.ok(isTerminal(v('REAL')));
  assert.throws(() => discharge(v('FAKE'), v('REAL')), /terminal/i);
  assert.throws(() => discharge(v('REAL'), v('FAKE')), /terminal/i);
});

test('a proven verdict can never silently decay back to UNKNOWN', () => {
  assert.throws(
    () => discharge(v('REAL'), { ...v('UNKNOWN'), code: 'probe-timeout' }),
    /terminal/i,
  );
});

test('WEAK cannot decay to UNKNOWN either', () => {
  assert.throws(
    () => discharge(v('WEAK'), { ...v('UNKNOWN'), code: 'probe-timeout' }),
    /decay/i,
  );
});

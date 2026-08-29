import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tally, headline, exitCode } from '../../src/core/honesty.ts';
import type { Verdict } from '../../src/core/verdict.ts';

const v = (name: Verdict['name'], code?: Verdict['code']): Verdict =>
  ({ name, reason: 'x', code, evidence: [] });

test('a fully proven clean run may claim clean', () => {
  const t = tally([v('REAL'), v('REAL')]);
  const h = headline(t, new Map());
  assert.equal(h.canClaimClean, true);
  assert.match(h.text, /no fake tests/i);
});

test('ONE unknown revokes the clean claim - the gate can fail', () => {
  const t = tally([v('REAL'), v('REAL'), v('UNKNOWN', 'probe-timeout')]);
  const h = headline(t, new Map([['probe-timeout', 1] as const]));
  assert.equal(h.canClaimClean, false);
  assert.equal(h.vouchedFor, 2);
  assert.equal(h.notVouchedFor, 1);
  assert.match(h.text, /could not/i);
  assert.match(h.text, /probe-timeout/);
});

test('the clean claim is never emitted as a bare sentence when unknowns exist', () => {
  const h = headline(
    tally([v('UNKNOWN', 'parse-failure')]),
    new Map([['parse-failure', 1] as const]),
  );
  assert.doesNotMatch(h.text, /^no fake tests\.?$/i);
});

test('exit codes: clean 0, fake 1, unknown 2', () => {
  assert.equal(exitCode(tally([v('REAL')]), { strictUnknown: true }), 0);
  assert.equal(exitCode(tally([v('FAKE')]), { strictUnknown: true }), 1);
  assert.equal(exitCode(tally([v('UNKNOWN', 'parse-failure')]), { strictUnknown: true }), 2);
});

test('a proven accusation outranks an admission of ignorance', () => {
  const t = tally([v('FAKE'), v('UNKNOWN', 'probe-timeout')]);
  assert.equal(exitCode(t, { strictUnknown: true }), 1);
});

test('strictUnknown:false downgrades unknown to success but never hides it', () => {
  const t = tally([v('UNKNOWN', 'parse-failure')]);
  assert.equal(exitCode(t, { strictUnknown: false }), 0);
  assert.equal(headline(t, new Map([['parse-failure', 1] as const])).canClaimClean, false);
});

test('WEAK is reported but does not by itself revoke the no-fake-tests claim', () => {
  const t = tally([v('REAL'), v('WEAK')]);
  const h = headline(t, new Map());
  assert.equal(h.canClaimClean, true);
  assert.match(h.text, /1 weak/i);
});

test('tally counts every verdict exactly once', () => {
  const t = tally([v('FAKE'), v('WEAK'), v('REAL'), v('UNKNOWN', 'no-mutants')]);
  assert.deepEqual(t, { fake: 1, weak: 1, real: 1, unknown: 1, total: 4 });
});

test('an EMPTY run is never clean - analysing nothing proves nothing', () => {
  const t = tally([]);
  const h = headline(t, new Map());
  assert.equal(h.canClaimClean, false);
  assert.match(h.text, /no tests were analysed/i);
  assert.doesNotMatch(h.text, /no fake tests/i);
});

test('an empty run exits 2 under strict mode, never 0', () => {
  const t = tally([]);
  assert.equal(exitCode(t, { strictUnknown: true }), 2);
  assert.equal(exitCode(t, { strictUnknown: false }), 0);
});

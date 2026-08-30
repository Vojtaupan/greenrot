import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeTest } from '../../src/core/probe.ts';
import type {
  CoveredLines, Frontend, Mutant, RunOutcome, TestCase,
} from '../../src/frontend/contract.ts';

const T: TestCase = { id: 'f.py::t', file: 'f.py', line: 1, name: 't', skipped: false };

const M = (n: number): Mutant => ({
  id: `m${n}`, file: 'f.py', line: 1, original: 'a', mutated: 'b', operator: 'arith',
});

function fakeFrontend(mutants: Mutant[], outcomes: RunOutcome[]): Frontend & { calls: number } {
  const fe = {
    calls: 0,
    language: 'python' as const,
    discover: async () => [T],
    model: async () => [],
    cover: async (): Promise<CoveredLines> => ({ byFile: new Map([['f.py', [1, 2]]]) }),
    mutate: async () => mutants,
    run: async (): Promise<RunOutcome> => outcomes[fe.calls++] ?? 'pass',
  };
  return fe;
}

// The probe can prove a test honest (REAL) but it CANNOT prove one vacuous.
// Our operator set is four families, one mutant per family per line - a narrow
// sample of possible defects - so "detected none of them" is evidence of
// weakness, not proof that the test cannot fail. greenrot's own suite made
// this concrete: a scoped self-audit returned 23 empirical FAKEs, every one of
// which was an honest test that simply ignored the edits we happened to try.
test('detecting no mutant is WEAK, never FAKE', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1), M(2), M(3)], ['pass', 'pass', 'pass']), T, {});
  assert.equal(v.name, 'WEAK');
  assert.equal(v.evidence[0]!.kind, 'empirical');
  assert.equal(v.evidence[0]!.check, 'E-probe-total-insensitivity');
});

test('a truncated probe says so, so the evidence is not overstated', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1), M(2), M(3)], ['pass', 'pass', 'pass']), T,
                            { maxMutants: 2 });
  assert.equal(v.name, 'WEAK');
  assert.match(v.evidence[0]!.detail, /2 mutations tried \(of 3 available\)/);
});

test('only STRUCTURAL evidence can produce FAKE - the probe never does', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1)], ['pass']), T, {});
  assert.notEqual(v.name, 'FAKE');
});

test('ONE detected mutant makes it REAL, not FAKE - the false-positive guard', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1), M(2), M(3)], ['pass', 'fail', 'pass']), T, {});
  assert.equal(v.name, 'REAL');
});

test('no mutants generated is UNKNOWN, never FAKE - absence of a probe is not evidence', async () => {
  const v = await probeTest('/r', fakeFrontend([], []), T, {});
  assert.equal(v.name, 'UNKNOWN');
  assert.equal(v.code, 'no-mutants');
});

test('a run that errors is UNKNOWN, never a survival', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1)], ['error']), T, {});
  assert.equal(v.name, 'UNKNOWN');
});

test('the probe stops as soon as a mutant is detected', async () => {
  const fe = fakeFrontend([M(1), M(2), M(3)], ['fail', 'pass', 'pass']);
  await probeTest('/r', fe, T, {});
  assert.equal(fe.calls, 1, 'REAL is provable from the first detection');
});

test('a cover failure is UNKNOWN with the frontend reason preserved', async () => {
  const fe = fakeFrontend([M(1)], ['pass']);
  const broken: Frontend = {
    ...fe,
    cover: async () => ({ error: true, code: 'runner-missing', file: 'f.py', line: 1, detail: 'no pytest' }),
  };
  const v = await probeTest('/r', broken, T, {});
  assert.equal(v.name, 'UNKNOWN');
  assert.equal(v.code, 'runner-missing');
  assert.match(v.reason, /no pytest/);
});

test('maxMutants caps the work; undetected within the cap is WEAK', async () => {
  const v = await probeTest('/r', fakeFrontend([M(1), M(2), M(3)], ['pass', 'pass', 'fail']), T,
                            { maxMutants: 2 });
  assert.equal(v.name, 'WEAK', 'nothing was detected within the cap');
});

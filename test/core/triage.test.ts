import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triage } from '../../src/core/triage.ts';
import type { AssertionModel, TestModel } from '../../src/frontend/contract.ts';

const A = (p: Partial<AssertionModel> = {}): AssertionModel => ({
  line: 10, kind: 'assert', origins: ['production-derived'],
  callOnly: false, broadException: false, swallowed: false, unreachable: false, ...p,
});

const M = (p: Partial<TestModel> = {}): TestModel => ({
  test: { id: 'f.py::t', file: 'f.py', line: 1, name: 't', skipped: false },
  assertions: [A()], mocks: [], unitUnderTest: null, overMocked: false, ...p,
});

test('A1: no assertion at all is structurally FAKE', () => {
  const r = triage(M({ assertions: [] }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.check, 'A1-no-assertion');
  assert.equal(r.verdict.evidence[0]!.kind, 'structural');
});

test('A2: literal vs literal is FAKE and cites the assertion line', () => {
  const r = triage(M({ assertions: [A({ origins: ['literal', 'literal'], line: 7 })] }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.line, 7);
});

test('A3: asserting only test-constructed values is FAKE', () => {
  const r = triage(M({ assertions: [A({ origins: ['test-constructed', 'literal'] })] }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.check, 'A3-test-constructed-only');
});

test('A4: asserting a configured mock return is FAKE', () => {
  const r = triage(M({ assertions: [A({ origins: ['mock-configured', 'literal'] })] }));
  assert.equal(r.verdict.evidence[0]!.check, 'A4-mock-echo');
});

test('A5: an unreachable assertion is FAKE', () => {
  const r = triage(M({ assertions: [A({ unreachable: true })] }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.check, 'A5-unreachable-assertion');
});

test('A6: a swallowed assertion is FAKE', () => {
  const r = triage(M({ assertions: [A({ swallowed: true })] }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.check, 'A6-swallowed-assertion');
});

test('C12: a permanently skipped test is FAKE, not silently absent', () => {
  const r = triage(M({ test: { id: 'f.py::t', file: 'f.py', line: 1, name: 't', skipped: true } }));
  assert.equal(r.verdict.name, 'FAKE');
  assert.equal(r.verdict.evidence[0]!.check, 'C12-permanently-skipped');
});

test('B7: call-only assertions are WEAK and still owe a probe', () => {
  const r = triage(M({ assertions: [A({ callOnly: true })] }));
  assert.equal(r.verdict.name, 'WEAK');
  assert.equal(r.obligations.length, 1);
});

test('B9: an over-mocked test is WEAK', () => {
  const r = triage(M({ overMocked: true }));
  assert.equal(r.verdict.name, 'WEAK');
  assert.equal(r.verdict.evidence[0]!.check, 'B9-over-mocked');
});

test('B11: a broad exception expectation is WEAK', () => {
  const r = triage(M({ assertions: [A({ broadException: true })] }));
  assert.equal(r.verdict.name, 'WEAK');
  assert.equal(r.verdict.evidence[0]!.check, 'B11-broad-exception');
});

test('an unknown origin is never grounds for FAKE - it owes a probe', () => {
  const r = triage(M({ assertions: [A({ origins: ['unknown'] })] }));
  assert.equal(r.verdict.name, 'UNKNOWN');
  assert.equal(r.obligations[0]!.kind, 'probe-required');
});

test('a production-derived assertion is UNKNOWN until the probe rules', () => {
  const r = triage(M());
  assert.equal(r.verdict.name, 'UNKNOWN');
  assert.equal(r.obligations.length, 1);
});

test('a mix of one inert and one real assertion is NOT fake', () => {
  const r = triage(M({ assertions: [A({ origins: ['literal', 'literal'] }), A()] }));
  assert.notEqual(r.verdict.name, 'FAKE');
});

test('B8: mocking the very thing under test is WEAK and owes a probe', () => {
  const r = triage(M({
    unitUnderTest: 'calc.add',
    mocks: [{ line: 5, target: 'calc.add', configuredReturn: true }],
    assertions: [A({ origins: ['mock-configured', 'literal'] })],
  }));
  assert.equal(r.verdict.name, 'WEAK');
  assert.equal(r.verdict.evidence[0]!.check, 'B8-unit-under-test-mocked');
  assert.equal(r.obligations.length, 1);
});

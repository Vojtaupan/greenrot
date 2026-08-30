import type { AssertionModel, TestModel } from '../frontend/contract.ts';
import type { CheckId, Evidence } from './evidence.ts';
import { probeRequired, type Obligation } from './obligation.ts';
import { initialVerdict, type Verdict } from './verdict.ts';

export interface TriageResult {
  readonly verdict: Verdict;
  readonly obligations: readonly Obligation[];
}

const ev = (check: CheckId, m: TestModel, line: number, detail: string): Evidence =>
  ({ kind: 'structural', check, file: m.test.file, line, detail });

const fake = (e: Evidence, reason: string): Verdict => ({ name: 'FAKE', reason, evidence: [e] });
const weak = (e: Evidence, reason: string): Verdict => ({ name: 'WEAK', reason, evidence: [e] });

/** True when nothing in the assertion could ever have come from production code. */
function isInert(a: AssertionModel): boolean {
  return a.origins.length > 0
    && a.origins.every(o => o === 'literal' || o === 'test-constructed');
}

/**
 * Static triage. Proves what can be proven without executing anything, and
 * hands everything else to the probe as an obligation.
 *
 * Ordering is load-bearing: the FAKE branches are checked before the WEAK ones,
 * and every branch requires that ALL effective assertions exhibit the defect.
 * A single honest assertion anywhere in the test is enough to spare it.
 */
export function triage(m: TestModel): TriageResult {
  const none: readonly Obligation[] = [];

  if (m.test.skipped) {
    return {
      verdict: fake(
        ev('C12-permanently-skipped', m, m.test.line,
           'permanently skipped - counted as coverage, executes nothing'),
        'the test never runs'),
      obligations: none,
    };
  }

  if (m.assertions.length === 0) {
    return {
      verdict: fake(
        ev('A1-no-assertion', m, m.test.line, 'test body contains no assertion'),
        'nothing is ever checked'),
      obligations: none,
    };
  }

  const live = m.assertions.filter(a => !a.unreachable);
  if (live.length === 0) {
    return {
      verdict: fake(
        ev('A5-unreachable-assertion', m, m.assertions[0]!.line,
           'every assertion sits after an unconditional return or raise'),
        'no assertion is reachable'),
      obligations: none,
    };
  }

  if (live.every(a => a.swallowed)) {
    return {
      verdict: fake(
        ev('A6-swallowed-assertion', m, live[0]!.line,
           'assertion sits inside a try whose handler swallows AssertionError'),
        'a failing assertion would be caught and ignored'),
      obligations: none,
    };
  }

  const effective = live.filter(a => !a.swallowed);

  if (effective.every(a => a.origins.length > 0 && a.origins.every(o => o === 'literal'))) {
    return {
      verdict: fake(
        ev('A2-tautology', m, effective[0]!.line, 'compares literals to literals'),
        'the comparison cannot vary'),
      obligations: none,
    };
  }

  // Before A4 on purpose: patching the unit under test is a different and more
  // informative finding than echoing a mock, and A4 would otherwise swallow it.
  // It is WEAK rather than FAKE because the test may still assert something
  // real about the surrounding wiring - the probe decides.
  const selfMock = m.unitUnderTest
    ? m.mocks.find(mk => mk.target === m.unitUnderTest)
    : undefined;
  if (selfMock) {
    return {
      verdict: weak(
        ev('B8-unit-under-test-mocked', m, selfMock.line,
           `the unit under test (${m.unitUnderTest}) is itself replaced by a mock`),
        'the code being tested never runs'),
      obligations: none,
    };
  }

  // A4 means "asserts a mock's configured RETURN against the constant it was
  // configured with". A call-count assertion is not that: `callCount() === 1`
  // reads a mock, so its origin is mock-configured, but it would fail the
  // moment the call it counts is removed. That is WEAK (B7), not an accusation.
  // Caught by the JS corpus, where `assert.equal(save.mock.callCount(), 1)`
  // was being reported FAKE.
  if (effective.every(a => a.origins.includes('mock-configured'))
      && !effective.some(a => a.origins.includes('production-derived'))
      && !effective.some(a => a.callOnly)) {
    return {
      verdict: fake(
        ev('A4-mock-echo', m, effective[0]!.line,
           'asserts a mock return value against the constant it was configured with'),
        'the assertion checks the test against itself'),
      obligations: none,
    };
  }

  // A3's claim is "production code never reached", so it must stand down the
  // moment production code was in fact reached. Without this guard the SPY
  // pattern - a list created empty in the test, filled by production code
  // through a callback, then asserted on - reads as test-constructed and gets
  // falsely accused. That pattern produced 3 of 3 false positives on the first
  // real 449-test suite greenrot was pointed at.
  if (effective.every(isInert)) {
    if (m.productionCalls > 0) {
      return {
        verdict: initialVerdict(),
        obligations: [probeRequired(
          m.test.id,
          'asserts on test-constructed values, but production code also ran - possibly a spy',
        )],
      };
    }
    return {
      verdict: fake(
        ev('A3-test-constructed-only', m, effective[0]!.line,
           'asserts only on values the test constructed; production code never reached'),
        'no production code participates'),
      obligations: none,
    };
  }

  // WEAK branches deliberately owe NO probe. WEAK is a statement about what the
  // test CHECKS, not about whether it can fail, and the probe can answer only
  // the second question. Letting it refine WEAK was wrong in both directions:
  // escalating to FAKE accused call-only tests that would fail if the call were
  // removed (our operators never delete a call), and exonerating to REAL erased
  // a true quality signal whenever a mutant merely crashed the code path.
  const owed = [probeRequired(m.test.id, 'static triage could not prove it either way')];

  if (effective.every(a => a.callOnly)) {
    return {
      verdict: weak(
        ev('B7-call-only', m, effective[0]!.line,
           'asserts only that a call happened; no value is ever compared'),
        'behaviour is never checked, only invocation'),
      obligations: none,
    };
  }

  if (m.overMocked) {
    return {
      verdict: weak(
        ev('B9-over-mocked', m, m.test.line,
           'every collaborator is mocked; little or no real code executes'),
        'the unit is surrounded by fakes'),
      obligations: none,
    };
  }

  if (effective.every(a => a.broadException)) {
    return {
      verdict: weak(
        ev('B11-broad-exception', m, effective[0]!.line,
           'exception expectation is broad enough to catch an import error'),
        'almost any failure satisfies it'),
      obligations: none,
    };
  }

  return { verdict: initialVerdict(), obligations: owed };
}

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

  if (effective.every(a => a.origins.includes('mock-configured'))
      && !effective.some(a => a.origins.includes('production-derived'))) {
    return {
      verdict: fake(
        ev('A4-mock-echo', m, effective[0]!.line,
           'asserts a mock return value against the constant it was configured with'),
        'the assertion checks the test against itself'),
      obligations: none,
    };
  }

  if (effective.every(isInert)) {
    return {
      verdict: fake(
        ev('A3-test-constructed-only', m, effective[0]!.line,
           'asserts only on values the test constructed; production code never reached'),
        'no production code participates'),
      obligations: none,
    };
  }

  const owed = [probeRequired(m.test.id, 'static triage could not prove it either way')];

  if (effective.every(a => a.callOnly)) {
    return {
      verdict: weak(
        ev('B7-call-only', m, effective[0]!.line,
           'asserts only that a call happened; no value is ever compared'),
        'behaviour is never checked, only invocation'),
      obligations: owed,
    };
  }

  if (m.overMocked) {
    return {
      verdict: weak(
        ev('B9-over-mocked', m, m.test.line,
           'every collaborator is mocked; little or no real code executes'),
        'the unit is surrounded by fakes'),
      obligations: owed,
    };
  }

  if (effective.every(a => a.broadException)) {
    return {
      verdict: weak(
        ev('B11-broad-exception', m, effective[0]!.line,
           'exception expectation is broad enough to catch an import error'),
        'almost any failure satisfies it'),
      obligations: owed,
    };
  }

  return { verdict: initialVerdict(), obligations: owed };
}

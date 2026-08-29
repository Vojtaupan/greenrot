import { isFrontendError, type Frontend, type TestCase } from '../frontend/contract.ts';
import type { Evidence } from './evidence.ts';
import type { UnknownReason, Verdict } from './verdict.ts';

export interface ProbeOptions {
  /**
   * Cap on mutants tried per test. Survival of ALL attempted mutants is what
   * proves FAKE, so a lower cap makes the tool faster and its FAKE verdicts
   * weaker - never more numerous, because a cap can only reduce the number of
   * chances a test gets to prove itself... and equally the number of chances we
   * get to catch it. It is a speed/thoroughness dial, not a strictness dial.
   */
  readonly maxMutants?: number;
}

const unknown = (code: UnknownReason, reason: string): Verdict =>
  ({ name: 'UNKNOWN', code, reason, evidence: [] });

/**
 * THE EMPIRICAL FAKE BAR.
 *
 * A test is FAKE only when it is blind to EVERY mutant in the lines it
 * executes. One detection means REAL. No mutants at all means UNKNOWN.
 *
 * A looser rule - "a mutant survived, therefore fake" - would accuse nearly
 * every honest test ever written, because no test detects every possible
 * change to the code it touches. A false FAKE is an accusation, and it is how
 * this tool would die in its first week.
 */
export async function probeTest(
  root: string,
  fe: Frontend,
  test: TestCase,
  opts: ProbeOptions,
): Promise<Verdict> {
  const covered = await fe.cover(root, test);
  if (isFrontendError(covered)) {
    return unknown(covered.code, covered.detail);
  }

  const all = await fe.mutate(root, covered);
  const mutants = opts.maxMutants ? all.slice(0, opts.maxMutants) : all;

  if (mutants.length === 0) {
    return unknown('no-mutants',
      'no mutation operators applied to the lines this test executes');
  }

  for (const m of mutants) {
    const outcome = await fe.run(root, test, m);
    if (outcome === 'fail') {
      return {
        name: 'REAL',
        reason: `detected a mutation at ${m.file}:${m.line}`,
        evidence: [],
      };
    }
    if (outcome === 'error') {
      // An error is not a survival. Treating it as one would manufacture a
      // false accusation out of an infrastructure problem.
      return unknown('probe-timeout', `the probe could not complete for mutant ${m.id}`);
    }
  }

  const first = mutants[0]!;
  const e: Evidence = {
    kind: 'empirical',
    check: 'E-probe-total-insensitivity',
    file: first.file,
    line: first.line,
    detail: `all ${mutants.length} mutation${mutants.length === 1 ? '' : 's'} of the code this test executes went undetected`,
  };
  return {
    name: 'FAKE',
    reason: 'the test is blind to every change in the code it runs',
    evidence: [e],
  };
}

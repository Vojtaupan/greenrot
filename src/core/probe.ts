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
  const truncated = all.length > mutants.length;
  const e: Evidence = {
    kind: 'empirical',
    check: 'E-probe-total-insensitivity',
    file: first.file,
    line: first.line,
    detail: truncated
      ? `detected none of the ${mutants.length} mutations tried (of ${all.length} available) in the code it executes`
      : `detected none of the ${mutants.length} mutation${mutants.length === 1 ? '' : 's'} of the code it executes`,
  };

  // WEAK, NOT FAKE - and this is the most important judgement in the probe.
  //
  // "Insensitive to every mutant we generated" is NOT the same claim as
  // "cannot fail". The operator set is four families with one mutant per family
  // per line - a narrow sample of the defects a test might catch - and
  // --max-mutants truncates even that. greenrot's own suite proved the point:
  // a scoped self-audit returned 23 FAKE verdicts, and inspection showed them
  // all to be honest tests that simply did not detect the particular edits
  // tried. `color codes are absent when color is off` would fail the moment
  // paint() emitted codes; it just does not care whether an unrelated `===`
  // flips.
  //
  // So the probe may now conclude only two things: REAL (proven honest, it
  // caught a mutation) or WEAK (it caught none of the ones we tried). FAKE
  // stays reserved for STRUCTURAL proof, where no assertion can vary at all.
  // That is a narrower product claim, and it is the true one.
  return {
    name: 'WEAK',
    reason: 'the test detected none of the mutations tried in the code it runs',
    evidence: [e],
  };
}

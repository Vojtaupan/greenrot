import type { UnknownReason, Verdict } from './verdict.ts';

export interface Tally {
  fake: number;
  weak: number;
  real: number;
  unknown: number;
  total: number;
}

export interface Headline {
  /** False whenever a single test went unvouched-for. */
  readonly canClaimClean: boolean;
  readonly text: string;
  readonly vouchedFor: number;
  readonly notVouchedFor: number;
}

export function tally(verdicts: readonly Verdict[]): Tally {
  const t: Tally = { fake: 0, weak: 0, real: 0, unknown: 0, total: verdicts.length };
  for (const v of verdicts) {
    if (v.name === 'FAKE') t.fake++;
    else if (v.name === 'WEAK') t.weak++;
    else if (v.name === 'REAL') t.real++;
    else t.unknown++;
  }
  return t;
}

/**
 * THE GATE.
 *
 * The headline may assert cleanliness only when every test reached a proven
 * state. This is the single place in the codebase permitted to phrase a clean
 * claim, so that "we could not check" can never be rendered as "fine".
 *
 * Every other tool in this category folds an un-analysable test into the
 * passing pile. That is the false all-clear this product exists to refuse.
 */
export function headline(t: Tally, reasons: ReadonlyMap<UnknownReason, number>): Headline {
  const vouchedFor = t.total - t.unknown;
  // An empty run is NOT clean. "I analysed nothing, therefore nothing is
  // wrong" is a vacuous truth and exactly the false all-clear this tool
  // exists to refuse - and it is what a misconfigured path or an over-broad
  // --exclude actually looks like from the outside.
  const canClaimClean = t.total > 0 && t.fake === 0 && t.unknown === 0;
  const weakNote = t.weak > 0 ? `, ${t.weak} weak` : '';

  if (t.total === 0) {
    return {
      canClaimClean: false,
      vouchedFor: 0,
      notVouchedFor: 0,
      text: 'no tests were analysed - nothing here can be vouched for',
    };
  }

  if (canClaimClean) {
    return {
      canClaimClean: true,
      vouchedFor,
      notVouchedFor: 0,
      text: `no fake tests across ${t.total} tests${weakNote}`,
    };
  }

  const breakdown = [...reasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([code, n]) => `${n} ${code}`)
    .join(', ');

  const fakePart =
    t.fake > 0
      ? `${t.fake} fake test${t.fake === 1 ? '' : 's'} found`
      : `no fake tests among the ${vouchedFor} I could vouch for`;

  const unknownPart =
    t.unknown > 0 ? `; ${t.unknown} I could not${breakdown ? ` (${breakdown})` : ''}` : '';

  return {
    canClaimClean: false,
    vouchedFor,
    notVouchedFor: t.unknown,
    text: `${fakePart}${weakNote}${unknownPart}`,
  };
}

/** 1 outranks 2: a proven accusation is more actionable than admitted ignorance. */
export function exitCode(t: Tally, opts: { strictUnknown: boolean }): 0 | 1 | 2 {
  if (t.fake > 0) return 1;
  // An empty run exits 2, not 0. Reporting success for a run that analysed
  // nothing is how a mistyped path or an over-broad --exclude turns into a
  // green CI badge - and the headline already refuses to call it clean, so a
  // 0 here would have the exit code contradicting the report.
  if (t.total === 0 && opts.strictUnknown) return 2;
  if (t.unknown > 0 && opts.strictUnknown) return 2;
  return 0;
}

/**
 * Stable check ids, so a report is greppable and a suppression is meaningful.
 *
 * Groups follow the spec's catalogue: A = structural FAKE (provable without
 * executing anything), B = WEAK (can fail, but never for a behavioural reason),
 * C = the coverage lie, D = gates that cannot go red, E = empirical proof.
 */
export type CheckId =
  | 'A1-no-assertion'
  | 'A2-tautology'
  | 'A3-test-constructed-only'
  | 'A4-mock-echo'
  | 'A5-unreachable-assertion'
  | 'A6-swallowed-assertion'
  | 'B7-call-only'
  | 'B8-unit-under-test-mocked'
  | 'B9-over-mocked'
  | 'B10-snapshot-autowrite'
  | 'B11-broad-exception'
  | 'C12-permanently-skipped'
  | 'D13-ci-gate-cannot-fail'
  | 'E-probe-total-insensitivity';

export interface Evidence {
  readonly kind: 'structural' | 'empirical';
  readonly check: CheckId;
  readonly file: string;
  readonly line: number;
  /** One sentence a human can check against the file. Never a stack trace. */
  readonly detail: string;
}

/** Constraint 4: a finding a human cannot verify against the file is a bug. */
export function formatLocation(e: Evidence): string {
  return `${e.file}:${e.line}`;
}

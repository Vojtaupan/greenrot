/**
 * A debt the static pass could not settle. Triage emits obligations; the probe
 * discharges them. An obligation that is never discharged leaves its test
 * UNKNOWN, which the honesty gate then refuses to call clean.
 */
export interface Obligation {
  readonly testId: string;
  readonly kind: 'probe-required';
  readonly why: string;
}

export function probeRequired(testId: string, why: string): Obligation {
  return { testId, kind: 'probe-required', why };
}

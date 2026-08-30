import type { Evidence } from './evidence.ts';

export type VerdictName = 'FAKE' | 'WEAK' | 'REAL' | 'UNKNOWN';

export type UnknownReason =
  | 'not-analyzed'
  | 'parse-failure'
  | 'runner-missing'
  | 'probe-timeout'
  | 'frontend-crash'
  | 'no-mutants';

export interface Verdict {
  readonly name: VerdictName;
  /** Human-readable, always present. Shown to the user verbatim. */
  readonly reason: string;
  /** Present if and only if name === 'UNKNOWN'. */
  readonly code?: UnknownReason;
  readonly evidence: readonly Evidence[];
}

export function initialVerdict(): Verdict {
  return { name: 'UNKNOWN', code: 'not-analyzed', reason: 'not analyzed yet', evidence: [] };
}

export function isTerminal(v: Verdict): boolean {
  return v.name === 'FAKE' || v.name === 'REAL';
}

/**
 * The ONLY legal way to change a verdict. The lattice is deliberately narrow:
 * UNKNOWN -> anything, WEAK -> FAKE|REAL (the probe refines it), and nothing
 * else. FAKE and REAL are proven states; overwriting one means two subsystems
 * disagree about a proof, which is a bug, not a value to be reconciled.
 */
export function discharge(current: Verdict, next: Verdict): Verdict {
  if (isTerminal(current)) {
    throw new Error(
      `illegal transition: ${current.name} is terminal and cannot become ${next.name}`,
    );
  }
  if (current.name === 'WEAK' && next.name === 'UNKNOWN') {
    throw new Error('illegal transition: WEAK cannot decay to UNKNOWN');
  }
  return next;
}

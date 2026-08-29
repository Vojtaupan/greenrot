import { headline, tally } from '../honesty.ts';
import type { UnknownReason, Verdict } from '../verdict.ts';

/**
 * Machine-readable output. `canClaimClean` is a boolean rather than prose so a
 * consuming script cannot accidentally read a hedged sentence as a pass.
 */
export function renderJson(
  verdicts: ReadonlyMap<string, Verdict>,
  reasons: ReadonlyMap<UnknownReason, number>,
): string {
  const t = tally([...verdicts.values()]);
  const h = headline(t, reasons);
  return JSON.stringify({
    schema: 1,
    canClaimClean: h.canClaimClean,
    headline: h.text,
    vouchedFor: h.vouchedFor,
    notVouchedFor: h.notVouchedFor,
    tally: t,
    unknownReasons: Object.fromEntries(reasons),
    tests: [...verdicts].map(([id, v]) => ({
      id,
      verdict: v.name,
      code: v.code ?? null,
      reason: v.reason,
      evidence: v.evidence,
    })),
  }, null, 2);
}

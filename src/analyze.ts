import { isFrontendError, type Frontend, type TestCase } from './frontend/contract.ts';
import type { Obligation } from './core/obligation.ts';
import { triage } from './core/triage.ts';
import type { UnknownReason, Verdict } from './core/verdict.ts';

export interface StructuralResult {
  verdicts: Map<string, Verdict>;
  obligations: Obligation[];
  unknownReasons: Map<UnknownReason, number>;
}

/**
 * Stage 1 only: static triage, nothing executed. Everything it cannot prove
 * leaves an obligation behind, and every failure becomes an UNKNOWN carrying a
 * reason - which the honesty gate then refuses to render as clean.
 */
export async function analyzeStructural(root: string, fe: Frontend): Promise<StructuralResult> {
  const verdicts = new Map<string, Verdict>();
  const obligations: Obligation[] = [];
  const unknownReasons = new Map<UnknownReason, number>();

  const bump = (c: UnknownReason) => unknownReasons.set(c, (unknownReasons.get(c) ?? 0) + 1);

  const discovered = await fe.discover(root);
  if (isFrontendError(discovered)) {
    bump(discovered.code);
    verdicts.set('<discovery>', {
      name: 'UNKNOWN', code: discovered.code, reason: discovered.detail, evidence: [],
    });
    return { verdicts, obligations, unknownReasons };
  }

  const models = await fe.model(root, discovered);
  for (const m of models) {
    if (isFrontendError(m)) {
      bump(m.code);
      verdicts.set(`${m.file}:${m.line}`, {
        name: 'UNKNOWN', code: m.code, reason: m.detail, evidence: [],
      });
      continue;
    }
    const { verdict, obligations: owed } = triage(m);
    verdicts.set(m.test.id, verdict);
    obligations.push(...owed);
    if (verdict.name === 'UNKNOWN' && verdict.code) bump(verdict.code);
  }

  return { verdicts, obligations, unknownReasons };
}

export { type Frontend, type TestCase };

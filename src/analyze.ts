import { isFrontendError, type Frontend, type TestCase } from './frontend/contract.ts';
import type { Obligation } from './core/obligation.ts';
import { probeTest, type ProbeOptions } from './core/probe.ts';
import { triage } from './core/triage.ts';
import { discharge, isTerminal, type UnknownReason, type Verdict } from './core/verdict.ts';

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

/**
 * Both stages. Structural triage first, then the probe discharges whatever
 * obligations it left behind.
 */
export async function analyze(
  root: string,
  fe: Frontend,
  opts: ProbeOptions = {},
): Promise<StructuralResult> {
  const base = await analyzeStructural(root, fe);

  const discovered = await fe.discover(root);
  if (isFrontendError(discovered)) return base;
  const byId = new Map(discovered.map(t => [t.id, t]));

  for (const o of base.obligations) {
    const current = base.verdicts.get(o.testId);
    const tc = byId.get(o.testId);
    // Only UNKNOWN is probeable. FAKE and REAL are proven; WEAK is a structural
    // conclusion the probe is not equipped to overturn (see triage).
    if (!current || !tc || isTerminal(current) || current.name !== 'UNKNOWN') continue;

    const proven = await probeTest(root, fe, tc, opts);
    base.verdicts.set(o.testId, discharge(current, proven));
    if (proven.name === 'UNKNOWN' && proven.code) {
      base.unknownReasons.set(proven.code, (base.unknownReasons.get(proven.code) ?? 0) + 1);
    }
  }

  return base;
}

export { type Frontend, type TestCase };

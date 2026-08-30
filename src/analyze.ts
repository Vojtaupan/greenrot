import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isFrontendError, type Frontend, type TestCase } from './frontend/contract.ts';
import { auditWorkflow } from './core/ci-gate.ts';
import type { Evidence } from './core/evidence.ts';
import type { Obligation } from './core/obligation.ts';
import { probeTest, type ProbeOptions } from './core/probe.ts';
import { triage } from './core/triage.ts';
import { discharge, isTerminal, type UnknownReason, type Verdict } from './core/verdict.ts';

export interface StructuralResult {
  verdicts: Map<string, Verdict>;
  obligations: Obligation[];
  unknownReasons: Map<UnknownReason, number>;
  /**
   * Check 13 findings: CI steps that cannot produce a nonzero exit. Kept
   * separate from `verdicts` because a workflow step is not a test, and
   * folding it into the test tally would muddy the headline.
   */
  ciFindings: Evidence[];
}

const CI_GLOBS = ['.github/workflows', 'scripts', '.gitlab-ci.yml', 'Makefile'];

/** Scan workflow and script files for gates that cannot go red. */
async function auditCiFiles(root: string): Promise<Evidence[]> {
  const found: Evidence[] = [];
  const seen = new Set<string>();

  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 4) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.github' && e.name !== '.gitlab-ci.yml') continue;
      if (e.name === 'node_modules' || e.name === '.venv') continue;
      const abs = join(dir, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(abs, relPath, depth + 1);
        continue;
      }
      if (!/\.(ya?ml|sh|ps1)$|^Makefile$/.test(e.name)) continue;
      if (!CI_GLOBS.some(g => relPath.startsWith(g) || relPath === g)) continue;
      if (seen.has(relPath)) continue;
      seen.add(relPath);
      try {
        found.push(...auditWorkflow(relPath, await readFile(abs, 'utf8')));
      } catch {
        // Unreadable file: not a finding, and never a claim of cleanliness.
      }
    }
  };

  await walk(root, '', 0);
  return found;
}

/**
 * Stage 1 only: static triage, nothing executed. Everything it cannot prove
 * leaves an obligation behind, and every failure becomes an UNKNOWN carrying a
 * reason - which the honesty gate then refuses to render as clean.
 */
/**
 * Stage 1 across every frontend. The CI audit runs ONCE - it is
 * language-agnostic, and running it per frontend would report each D13 finding
 * as many times as there are languages.
 */
export async function analyzeStructural(
  root: string,
  frontends: readonly Frontend[],
): Promise<StructuralResult> {
  const verdicts = new Map<string, Verdict>();
  const obligations: Obligation[] = [];
  const unknownReasons = new Map<UnknownReason, number>();
  const ciFindings = await auditCiFiles(root);

  for (const fe of frontends) {
    const part = await analyzeOneFrontend(root, fe);
    for (const [id, v] of part.verdicts) verdicts.set(id, v);
    obligations.push(...part.obligations);
    for (const [code, n] of part.unknownReasons) {
      unknownReasons.set(code, (unknownReasons.get(code) ?? 0) + n);
    }
  }

  return { verdicts, obligations, unknownReasons, ciFindings };
}

/** One frontend's structural pass. No CI audit - the caller owns that. */
async function analyzeOneFrontend(root: string, fe: Frontend): Promise<StructuralResult> {
  const verdicts = new Map<string, Verdict>();
  const obligations: Obligation[] = [];
  const unknownReasons = new Map<UnknownReason, number>();
  const ciFindings: Evidence[] = [];

  const bump = (c: UnknownReason) => unknownReasons.set(c, (unknownReasons.get(c) ?? 0) + 1);

  const discovered = await fe.discover(root);
  if (isFrontendError(discovered)) {
    bump(discovered.code);
    verdicts.set('<discovery>', {
      name: 'UNKNOWN', code: discovered.code, reason: discovered.detail, evidence: [],
    });
    return { verdicts, obligations, unknownReasons, ciFindings };
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

  return { verdicts, obligations, unknownReasons, ciFindings };
}

/**
 * Both stages. Structural triage first, then the probe discharges whatever
 * obligations it left behind.
 */
export async function analyze(
  root: string,
  frontends: readonly Frontend[],
  opts: ProbeOptions = {},
): Promise<StructuralResult> {
  const base = await analyzeStructural(root, frontends);

  // Each obligation must be probed by the frontend that raised it. A Python
  // frontend cannot run a JS test, and handing it one would produce an error
  // that the probe would honestly - but uselessly - report as UNKNOWN.
  const owners = new Map<string, { fe: Frontend; tc: TestCase }>();
  for (const fe of frontends) {
    const discovered = await fe.discover(root);
    if (isFrontendError(discovered)) continue;
    for (const tc of discovered) owners.set(tc.id, { fe, tc });
  }

  for (const o of base.obligations) {
    const current = base.verdicts.get(o.testId);
    const owner = owners.get(o.testId);
    // Only UNKNOWN is probeable. FAKE and REAL are proven; WEAK is a structural
    // conclusion the probe is not equipped to overturn (see triage).
    if (!current || !owner || isTerminal(current) || current.name !== 'UNKNOWN') continue;

    const proven = await probeTest(root, owner.fe, owner.tc, opts);
    base.verdicts.set(o.testId, discharge(current, proven));
    if (proven.name === 'UNKNOWN' && proven.code) {
      base.unknownReasons.set(proven.code, (base.unknownReasons.get(proven.code) ?? 0) + 1);
    }
  }

  return base;
}

export { type Frontend, type TestCase };

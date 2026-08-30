import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execPath } from 'node:process';
import { promisify } from 'node:util';
import type { RunOutcome, TestCase } from '../contract.ts';
import { SCRATCH_DIRNAME } from '../python/scratch.ts';

const execFileAsync = promisify(execFile);

/** --test-name-pattern is a REGEX, so ( ) [ ] . + must be escaped. */
export function namePattern(name: string): string {
  return `^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`;
}

/**
 * node:test matches --test-name-pattern at EACH nesting level, so a nested
 * test needs one pattern per path segment. Passing the joined
 * "suite > case" string would match nothing at all.
 */
export function patternArgs(fullName: string): string[] {
  return fullName
    .split(' > ')
    .flatMap(seg => ['--test-name-pattern', namePattern(seg)]);
}

/**
 * Variables that make a spawned `node --test` STOP REPORTING VIA ITS EXIT CODE.
 *
 * When greenrot runs from inside a test runner - our own suite, someone's CI
 * step, a pre-commit hook - the child inherits NODE_TEST_CONTEXT, decides it is
 * a subprocess of a runner, reports over IPC, prints nothing, and **exits 0
 * even when the test fails**.
 *
 * Every mutant would then survive, every test would come back REAL, and the
 * report would be a confident, silent lie. Measured: with the variable set, a
 * deliberately broken calc.js still exited 0.
 *
 * NODE_OPTIONS is dropped for the same reason - it can inject a loader or the
 * runner itself into the child.
 */
const POISON_ENV = ['NODE_TEST_CONTEXT', 'NODE_OPTIONS', 'NODE_V8_COVERAGE'];

export function cleanEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(source)) {
    if (POISON_ENV.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

export interface RunResult {
  readonly outcome: RunOutcome;
  readonly coverageDir: string | null;
}

export async function runOneTest(
  root: string,
  test: TestCase,
  opts: { coverage: boolean },
): Promise<RunResult> {
  let covDir: string | null = null;
  if (opts.coverage) {
    // ABSOLUTE, always. The child runs with cwd: root, so a relative
    // NODE_V8_COVERAGE would be resolved against the CHILD's cwd and the
    // coverage would land in a doubled path the parent never reads - which
    // silently produced "no-mutants" for every test on the default `.` root.
    const base = resolve(root, SCRATCH_DIRNAME);
    await mkdir(base, { recursive: true });
    covDir = resolve(await mkdtemp(join(base, 'cov-')));
  }

  const env = { ...cleanEnv(), ...(covDir ? { NODE_V8_COVERAGE: covDir } : {}) };

  try {
    await execFileAsync(
      execPath,
      ['--test', ...patternArgs(test.name), test.file],
      { cwd: root, env, timeout: 60_000, maxBuffer: 64 * 1024 * 1024, windowsHide: true },
    );
    return { outcome: 'pass', coverageDir: covDir };
  } catch (e) {
    const code = (e as { code?: number | string }).code;
    // node --test exits 1 when a test fails. Anything else - a spawn failure, a
    // timeout, a module that will not load - is an ERROR, which becomes UNKNOWN
    // rather than being misread as a surviving mutant.
    if (code === 1) return { outcome: 'fail', coverageDir: covDir };
    return { outcome: 'error', coverageDir: covDir };
  }
}

export async function cleanupCoverage(dir: string | null): Promise<void> {
  if (dir) await rm(dir, { recursive: true, force: true });
}

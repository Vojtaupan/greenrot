import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { locateInterpreter } from './locate.ts';
import { withScratchCopy } from './scratch.ts';
import {
  isFrontendError,
  type CoveredLines,
  type Frontend,
  type FrontendError,
  type Mutant,
  type RunOutcome,
  type TestCase,
  type TestModel,
} from '../contract.ts';

const execFileAsync = promisify(execFile);

/**
 * Resolved relative to this module, so it works both from src/ during
 * development and from dist/ after `npm run build` copies the helper across.
 */
const HELPER = fileURLToPath(new URL('./helper/greenrot_helper.py', import.meta.url));

const crash = (detail: string): FrontendError =>
  ({ error: true, code: 'frontend-crash', file: '', line: 1, detail });

export class PythonFrontend implements Frontend {
  readonly language = 'python' as const;

  /** Repo-relative path prefixes to skip, e.g. a directory of test fixtures. */
  readonly excludes: readonly string[];

  // An explicit field, NOT a constructor parameter property. Node's type
  // stripping rejects parameter properties outright, and `tsc --noEmit` does
  // not catch it - typechecking and type-stripping have different capabilities,
  // so the build was green while every test file failed to load.
  constructor(excludes: readonly string[] = []) {
    this.excludes = excludes;
  }

  protected async call(
    root: string,
    cmd: string,
    extra: string[] = [],
    timeoutMs = 120_000,
    interpreter?: string,
  ): Promise<unknown> {
    // `interpreter` exists because a scratch copy lives in TEMP, where walking
    // up finds no virtualenv - the interpreter must be the one belonging to the
    // repository under analysis, not to the throwaway directory holding a mutant.
    const py = interpreter ?? locateInterpreter(root);
    if (!py) {
      return { error: true, code: 'runner-missing', file: '', line: 1,
               detail: 'no python interpreter found' } satisfies FrontendError;
    }
    try {
      // PYTHONUTF8: this machine's console is cp1250 and unicode print()
      // crashes on redirected stdout without it.
      const { stdout } = await execFileAsync(py, [HELPER, cmd, root, ...extra], {
        env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        maxBuffer: 64 * 1024 * 1024,
        timeout: timeoutMs,
        windowsHide: true,
      });
      return JSON.parse(stdout);
    } catch (e) {
      return crash(e instanceof Error ? e.message : String(e));
    }
  }

  async discover(root: string): Promise<TestCase[] | FrontendError> {
    const res = await this.call(root, 'discover', [this.excludes.join(',')]);
    if (isFrontendError(res)) return res;
    // The helper may interleave per-file parse errors with test cases; keep the
    // cases here and let `model` surface the errors, so discovery never throws
    // away a whole run because one file would not parse.
    return (res as Array<TestCase | FrontendError>).filter(
      (x): x is TestCase => !isFrontendError(x),
    );
  }

  async model(
    root: string,
    _tests: readonly TestCase[],
  ): Promise<Array<TestModel | FrontendError>> {
    const res = await this.call(root, 'model', [this.excludes.join(',')]);
    if (isFrontendError(res)) return [res];
    return res as Array<TestModel | FrontendError>;
  }

  async cover(root: string, test: TestCase): Promise<CoveredLines | FrontendError> {
    const res = await this.call(root, 'trace', [test.id]);
    if (isFrontendError(res)) return res;
    const raw = (res as { byFile: Record<string, number[]> }).byFile;
    return { byFile: new Map(Object.entries(raw)) };
  }

  async mutate(root: string, lines: CoveredLines): Promise<Mutant[]> {
    const spec = JSON.stringify(Object.fromEntries(lines.byFile));
    const res = await this.call(root, 'mutants', [spec]);
    // No mutants is a legitimate answer, and the probe turns it into UNKNOWN
    // rather than FAKE. Returning [] here is therefore never a false all-clear.
    if (isFrontendError(res)) return [];
    return res as Mutant[];
  }

  async run(root: string, test: TestCase, mutant?: Mutant): Promise<RunOutcome> {
    const py = locateInterpreter(root) ?? undefined;
    const exec = async (r: string): Promise<RunOutcome> => {
      const res = await this.call(r, 'runtest', [test.id], 60_000, py);
      if (isFrontendError(res)) return 'error';
      return (res as { outcome: RunOutcome }).outcome;
    };
    if (!mutant) return exec(root);
    try {
      return await withScratchCopy(root, mutant, exec);
    } catch {
      // A scratch copy that could not be made or written is an 'error', which
      // the probe turns into UNKNOWN. It must never look like a survival.
      return 'error';
    }
  }
}

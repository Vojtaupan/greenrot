import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { locateInterpreter } from './locate.ts';
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

  protected async call(
    root: string,
    cmd: string,
    extra: string[] = [],
    timeoutMs = 120_000,
  ): Promise<unknown> {
    const py = locateInterpreter(root);
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
    const res = await this.call(root, 'discover');
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
    const res = await this.call(root, 'model');
    if (isFrontendError(res)) return [res];
    return res as Array<TestModel | FrontendError>;
  }

  async cover(root: string, test: TestCase): Promise<CoveredLines | FrontendError> {
    const res = await this.call(root, 'trace', [test.id]);
    if (isFrontendError(res)) return res;
    const raw = (res as { byFile: Record<string, number[]> }).byFile;
    return { byFile: new Map(Object.entries(raw)) };
  }

  async mutate(_root: string, _lines: CoveredLines): Promise<Mutant[]> {
    throw new Error('not implemented until Task 4.2');
  }

  async run(_root: string, _test: TestCase, _mutant?: Mutant): Promise<RunOutcome> {
    throw new Error('not implemented until Task 4.3');
  }
}

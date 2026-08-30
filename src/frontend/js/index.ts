import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import { withScratchCopy } from '../python/scratch.ts';
import { discoverInSource } from './discover.ts';
import { modelInSource } from './model.ts';
import { loadParser, type Parser } from './parse.ts';
import { mutateFiles } from './mutate.ts';
import { cleanupCoverage, runOneTest } from './runner.ts';
import { readCoverageDir } from './coverage.ts';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.greenrot-scratch',
  '.venv', 'venv', '__pycache__', 'coverage',
]);
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Repo-relative test file paths, honouring the exclude prefixes. */
export async function listTestFiles(
  root: string,
  excludes: readonly string[],
): Promise<string[]> {
  const found: string[] = [];

  const walkDir = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (depth > 12) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (excludes.some(x => relPath === x || relPath.startsWith(`${x.replace(/\/$/, '')}/`))) {
        continue;
      }
      if (e.isDirectory()) {
        await walkDir(join(dir, e.name), relPath, depth + 1);
      } else if (e.isFile() && IS_TEST.test(e.name)) {
        found.push(relPath);
      }
    }
  };

  await walkDir(root, '', 0);
  return found.sort();
}

export class JsFrontend implements Frontend {
  readonly language = 'javascript' as const;
  readonly excludes: readonly string[];

  // An explicit field, NOT a constructor parameter property. Node's type
  // stripping rejects parameter properties and `tsc --noEmit` does not catch
  // it, so the build would go green while every test file failed to load.
  constructor(excludes: readonly string[] = []) {
    this.excludes = excludes;
  }

  private async parser(root: string): Promise<Parser | FrontendError> {
    const p = await loadParser(root);
    if (p) return p;
    return {
      error: true, code: 'runner-missing', file: '', line: 1,
      detail: 'no JavaScript parser available',
    };
  }

  async discover(root: string): Promise<TestCase[] | FrontendError> {
    const parser = await this.parser(root);
    if (isFrontendError(parser)) return parser;

    const out: TestCase[] = [];
    for (const rel of await listTestFiles(root, this.excludes)) {
      let src: string;
      try {
        src = await readFile(join(root, ...rel.split('/')), 'utf8');
      } catch {
        continue;
      }
      for (const x of discoverInSource(src, rel, parser)) {
        if (!isFrontendError(x)) out.push(x);
      }
    }
    return out;
  }

  async model(
    root: string,
    _tests: readonly TestCase[],
  ): Promise<Array<TestModel | FrontendError>> {
    const parser = await this.parser(root);
    if (isFrontendError(parser)) return [parser];

    const out: Array<TestModel | FrontendError> = [];
    for (const rel of await listTestFiles(root, this.excludes)) {
      let src: string;
      try {
        src = await readFile(join(root, ...rel.split('/')), 'utf8');
      } catch {
        continue;
      }
      const cases = discoverInSource(src, rel, parser)
        .filter((x): x is TestCase => !isFrontendError(x));
      // A file that would not parse yields its error from discoverInSource;
      // surface it here so it becomes an UNKNOWN rather than a silent skip.
      for (const x of discoverInSource(src, rel, parser)) {
        if (isFrontendError(x)) out.push(x);
      }
      if (cases.length > 0) out.push(...modelInSource(src, rel, parser, cases));
    }
    return out;
  }

  async cover(root: string, test: TestCase): Promise<CoveredLines | FrontendError> {
    const res = await runOneTest(root, test, { coverage: true });
    try {
      if (res.outcome === 'error' || !res.coverageDir) {
        return {
          error: true, code: 'probe-timeout', file: test.file, line: test.line,
          detail: 'the test could not be run under coverage',
        };
      }
      return { byFile: await readCoverageDir(res.coverageDir, root) };
    } finally {
      await cleanupCoverage(res.coverageDir);
    }
  }

  async mutate(root: string, lines: CoveredLines): Promise<Mutant[]> {
    return mutateFiles(root, lines);
  }

  async run(root: string, test: TestCase, mutant?: Mutant): Promise<RunOutcome> {
    const once = async (r: string): Promise<RunOutcome> =>
      (await runOneTest(r, test, { coverage: false })).outcome;

    if (!mutant) return once(root);
    try {
      // The scratch copy lives INSIDE the repo, so Node's module resolution
      // walks up and finds the real node_modules on its own - no copy, no
      // symlink, no Windows junction permissions.
      return await withScratchCopy(root, mutant, once);
    } catch {
      // A scratch copy that could not be made is an error, which the probe
      // turns into UNKNOWN. It must never look like a surviving mutant.
      return 'error';
    }
  }
}

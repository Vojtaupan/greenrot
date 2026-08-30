import { copyFile, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Mutant } from '../contract.ts';

const SKIP = new Set([
  '.git', 'node_modules', '__pycache__', '.greenrot-scratch',
  '.venv', 'venv', '.pytest_cache', '.mypy_cache', '.tox', 'dist', 'build',
]);

export const SCRATCH_DIRNAME = '.greenrot-scratch';

/**
 * Where a mutant copy lives.
 *
 * NOT the system temp directory, for two measured reasons:
 *
 *  1. Speed. pytest walks upward from the target file doing rootdir and
 *     conftest discovery. On this machine %TEMP% holds 21,483 entries and that
 *     walk costs ~16s per run, against 0.65s for the same copy placed inside
 *     the repository - a 25x difference that decides whether the probe is
 *     usable at all. Nesting deeper inside TEMP does not help; the walk still
 *     crosses it.
 *
 *  2. Fidelity, which matters more. A copy in TEMP runs WITHOUT the
 *     repository's conftest.py, pytest.ini and sys.path layout, so it is not
 *     the run the developer actually gets - and a verdict derived from a
 *     different run is a wrong verdict.
 *
 * $GREENROT_SCRATCH_DIR overrides, for read-only checkouts and CI caches.
 */
export function scratchBase(root: string): string {
  const override = process.env['GREENROT_SCRATCH_DIR'];
  if (override) return override;
  return join(root, SCRATCH_DIRNAME);
}

/** Recursive copy that skips SKIP segments, including the scratch dir itself. */
async function copyTree(from: string, to: string): Promise<void> {
  const entries = await readdir(from, { withFileTypes: true });
  await mkdir(to, { recursive: true });
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const src = join(from, e.name);
    const dst = join(to, e.name);
    if (e.isDirectory()) await copyTree(src, dst);
    else if (e.isFile()) await copyFile(src, dst);
    // symlinks and devices are deliberately not followed
  }
}

/**
 * Constraint 1: mutants are applied to a COPY.
 *
 * Never an edit-then-revert of the real tree. A probe killed mid-revert - by a
 * timeout, a Ctrl-C, an OOM - would leave someone's working copy holding a
 * deliberately broken line with no indication we put it there. The copy costs
 * ~17ms and removes the entire class of accident.
 */
export async function withScratchCopy<T>(
  root: string,
  mutant: Mutant,
  fn: (scratchRoot: string) => Promise<T>,
): Promise<T> {
  const base = scratchBase(root);
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'm-'));
  try {
    // Hand-rolled rather than fs.cp: the destination is a subdirectory of the
    // source, and fs.cp rejects that outright with ERR_FS_CP_EINVAL. Skipping
    // SCRATCH_DIRNAME is what makes it safe - without it the walk would copy
    // previous copies of itself, forever.
    await copyTree(root, dir);

    const target = join(dir, ...mutant.file.split('/'));
    const src = await readFile(target, 'utf8');
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    const lines = src.split(/\r?\n/);
    if (lines[mutant.line - 1] === undefined) {
      throw new Error(`mutant ${mutant.id} points past the end of ${mutant.file}`);
    }
    lines[mutant.line - 1] = mutant.mutated;
    await writeFile(target, lines.join(eol), 'utf8');

    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export const SYSTEM_TMP = tmpdir();
export const SCRATCH_SKIP = SKIP;

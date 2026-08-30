import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { platform } from 'node:process';

const WIN = platform === 'win32';

function venvCandidates(dir: string): string[] {
  return WIN
    ? [join(dir, '.venv', 'Scripts', 'python.exe'), join(dir, 'venv', 'Scripts', 'python.exe')]
    : [join(dir, '.venv', 'bin', 'python'), join(dir, 'venv', 'bin', 'python')];
}

/**
 * Prefer the interpreter whose site-packages actually contains the project's
 * pytest, in this order:
 *
 *   1. $GREENROT_PYTHON  - explicit override, for CI and odd layouts
 *   2. a .venv/venv found by walking UP from `root` (bounded)
 *   3. python on PATH
 *
 * The upward walk matters: a venv at the repository root with tests in a
 * subdirectory is the normal shape of a real Python project, and checking only
 * `root` would miss it and mis-report the repo as `runner-missing`.
 */
export function locateInterpreter(root: string, maxUp = 6): string | null {
  const override = process.env['GREENROT_PYTHON'];
  if (override && existsSync(override)) return override;

  let dir = root;
  for (let i = 0; i <= maxUp; i++) {
    for (const c of venvCandidates(dir)) if (existsSync(c)) return c;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return WIN ? 'python' : 'python3';
}

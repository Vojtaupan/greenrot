import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface V8Range {
  readonly startOffset: number;
  readonly endOffset: number;
  readonly count: number;
}

/**
 * V8 reports byte offsets, not lines. Positive ranges add lines; zero-count
 * ranges - which V8 nests inside their enclosing positive range - take them
 * back. Subtracting SECOND is what stops an untaken branch from being handed
 * to the mutator as a target.
 *
 * For TypeScript this is exact with no source map, because Node's type
 * stripping replaces types with whitespace and preserves every offset.
 */
export function offsetsToLines(source: string, ranges: readonly V8Range[]): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < source.length; i++) if (source[i] === '\n') starts.push(i + 1);

  const lineAt = (offset: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const linesIn = (r: V8Range): number[] => {
    const from = lineAt(Math.max(0, r.startOffset));
    const to = lineAt(Math.max(0, Math.min(source.length, r.endOffset) - 1));
    const out: number[] = [];
    for (let l = from; l <= to; l++) out.push(l);
    return out;
  };

  const covered = new Set<number>();
  for (const r of ranges) if (r.count > 0) for (const l of linesIn(r)) covered.add(l);
  for (const r of ranges) if (r.count === 0) for (const l of linesIn(r)) covered.delete(l);
  return [...covered].sort((a, b) => a - b);
}

const SKIP = /node_modules|\.greenrot-scratch|[\\/]dist[\\/]/;
const IS_TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;

/**
 * Read a NODE_V8_COVERAGE directory into repo-relative file -> covered lines.
 * Production files only: test files are never mutation targets, and anything
 * outside the analysed root is not ours to touch.
 */
export async function readCoverageDir(
  dir: string,
  root: string,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();

  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return out;
  }

  for (const f of files) {
    if (!f.endsWith('.json')) continue;

    let doc: { result?: Array<{ url: string; functions?: Array<{ ranges: V8Range[] }> }> };
    try {
      doc = JSON.parse(await readFile(join(dir, f), 'utf8'));
    } catch {
      continue;
    }

    for (const script of doc.result ?? []) {
      if (!script.url?.startsWith('file:')) continue;

      let abs: string;
      try {
        abs = fileURLToPath(script.url);
      } catch {
        continue;
      }

      const rel = relative(root, abs).replace(/\\/g, '/');
      if (rel.startsWith('..') || SKIP.test(rel) || IS_TEST.test(rel)) continue;

      let source: string;
      try {
        source = await readFile(abs, 'utf8');
      } catch {
        continue;
      }

      const ranges = (script.functions ?? []).flatMap(fn => fn.ranges ?? []);
      const lines = offsetsToLines(source, ranges);
      if (lines.length === 0) continue;

      const prev = out.get(rel) ?? [];
      out.set(rel, [...new Set([...prev, ...lines])].sort((a, b) => a - b));
    }
  }

  return out;
}

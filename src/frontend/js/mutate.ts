import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CoveredLines, Mutant } from '../contract.ts';

const MUTATIONS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ['arith', [[' + ', ' - '], [' - ', ' + '], [' * ', ' / ']]],
  ['compare', [[' === ', ' !== '], [' !== ', ' === '], [' == ', ' != '],
               [' <= ', ' > '], [' >= ', ' < '], [' < ', ' >= '], [' > ', ' <= ']]],
  ['bool', [[' && ', ' || '], [' || ', ' && ']]],
  ['const', [['true', 'false'], ['false', 'true'], [' ?? ', ' || ']]],
];

/** Line-scoped text mutation, confined to lines a single test actually ran. */
export async function mutateFiles(root: string, lines: CoveredLines): Promise<Mutant[]> {
  const out: Mutant[] = [];

  for (const [rel, wanted] of lines.byFile) {
    let src: string;
    try {
      src = await readFile(join(root, ...rel.split('/')), 'utf8');
    } catch {
      continue;
    }

    const all = src.split(/\r?\n/);
    const want = new Set(wanted);

    for (let i = 0; i < all.length; i++) {
      const lineNo = i + 1;
      if (!want.has(lineNo)) continue;

      const text = all[i]!;
      const trimmed = text.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
      // A bare import/export line executes at module load and shows up as
      // covered, but perturbing it tests nothing about behaviour.
      if (/^(import|export)\b/.test(trimmed) && !/[({]/.test(trimmed)) continue;

      for (const [operator, pairs] of MUTATIONS) {
        for (const [find, repl] of pairs) {
          if (text.includes(find)) {
            out.push({
              id: `${rel}:${lineNo}:${operator}:${find.trim()}`,
              file: rel,
              line: lineNo,
              original: text,
              mutated: text.replace(find, repl),
              operator,
            });
            break; // one mutant per operator family per line
          }
        }
      }
    }
  }

  return out;
}

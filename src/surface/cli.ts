#!/usr/bin/env node
import { resolve } from 'node:path';
import { argv, env, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { analyze, analyzeStructural } from '../analyze.ts';
import { exitCode, tally } from '../core/honesty.ts';
import { renderHuman } from '../core/report/human.ts';
import { renderJson } from '../core/report/json.ts';
import { renderSarif } from '../core/report/sarif.ts';
import { PythonFrontend } from '../frontend/python/index.ts';
import { VERSION } from '../index.ts';

export interface CliOptions {
  root: string;
  format: 'human' | 'json' | 'sarif';
  strictUnknown: boolean;
  maxMutants: number;
  /**
   * Skip the probe entirely: structural checks only, nothing executed.
   * Seconds instead of minutes, and safe precisely because everything the
   * static pass cannot prove stays UNKNOWN - so a --static run can never
   * report clean. Speed here costs certainty, never honesty.
   */
  staticOnly: boolean;
}

const USAGE = `greenrot ${VERSION} - which of your tests cannot fail?

  npx greenrot [path]              analyse a repository (default: .)

  --json                           machine-readable report
  --sarif                          SARIF 2.1.0 for GitHub code scanning
  --static                         structural checks only, nothing executed (fast)
  --max-mutants <n>                mutants tried per test (default 12)
  --no-strict-unknown              exit 0 even when some tests could not be checked
  --version                        print version
  --help                           this text

exit codes
  0  provably clean
  1  fake tests found
  2  could not vouch - some tests were not analysable
`;

export function parseArgs(args: readonly string[]): CliOptions {
  const o: CliOptions = {
    root: '.', format: 'human', strictUnknown: true, maxMutants: 12, staticOnly: false,
  };
  const rest = [...args];
  while (rest.length > 0) {
    const a = rest.shift()!;
    if (a === '--json') o.format = 'json';
    else if (a === '--sarif') o.format = 'sarif';
    else if (a === '--no-strict-unknown') o.strictUnknown = false;
    else if (a === '--static') o.staticOnly = true;
    else if (a === '--max-mutants') o.maxMutants = Number(rest.shift() ?? 12);
    else if (!a.startsWith('-')) o.root = a;
  }
  return o;
}

export async function runCli(
  o: CliOptions,
  write: (s: string) => void,
): Promise<0 | 1 | 2> {
  const fe = new PythonFrontend();
  const r = o.staticOnly
    ? await analyzeStructural(o.root, fe)
    : await analyze(o.root, fe, { maxMutants: o.maxMutants });

  if (o.format === 'json') write(renderJson(r.verdicts, r.unknownReasons));
  else if (o.format === 'sarif') write(renderSarif(r.verdicts));
  else write(renderHuman(r.verdicts, r.unknownReasons, { color: stdout.isTTY === true }));

  return exitCode(tally([...r.verdicts.values()]), { strictUnknown: o.strictUnknown });
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    stdout.write(USAGE);
    exit(0);
  }
  if (args.includes('--version') || args.includes('-v')) {
    stdout.write(`${VERSION}\n`);
    exit(0);
  }
  const code = await runCli(parseArgs(args), s => stdout.write(`${s}\n`));
  exit(code);
}

// Only run when invoked as the binary, never when imported by a test. Compare
// resolved paths rather than matching basenames: "cli.js" is a common enough
// filename that a substring check would eventually fire in the wrong process.
const invokedDirectly =
  argv[1] !== undefined && resolve(fileURLToPath(import.meta.url)) === resolve(argv[1]);

if (invokedDirectly && env['GREENROT_NO_MAIN'] !== '1') {
  await main();
}

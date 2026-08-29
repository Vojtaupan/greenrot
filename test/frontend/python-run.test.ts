import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PythonFrontend } from '../../src/frontend/python/index.ts';
import type { Mutant } from '../../src/frontend/contract.ts';
import { scratchBase, SYSTEM_TMP } from '../../src/frontend/python/scratch.ts';

const ROOT = fileURLToPath(new URL('../corpus/python/simple/', import.meta.url));
const CALC = `${ROOT}calc.py`;

const T = {
  id: 'test_basic.py::test_add_returns_sum',
  file: 'test_basic.py', line: 4, name: 'test_add_returns_sum', skipped: false,
};

const breakAdd = (id: string): Mutant => ({
  id, file: 'calc.py', line: 2,
  original: '    return a + b', mutated: '    return a - b', operator: 'arith',
});

test('an unmutated run passes', async () => {
  assert.equal(await new PythonFrontend().run(ROOT, T), 'pass');
});

test('a mutant that breaks add() makes the test fail', async () => {
  assert.equal(await new PythonFrontend().run(ROOT, T, breakAdd('m1')), 'fail');
});

test('the working tree is never modified - source is byte-identical after a mutant run', async () => {
  const before = readFileSync(CALC, 'utf8');
  await new PythonFrontend().run(ROOT, T, breakAdd('m2'));
  assert.equal(readFileSync(CALC, 'utf8'), before);
});

// Regression guard for a measured 25x regression: a scratch copy in the system
// temp directory costs ~16s per mutant here (21,483 entries in %TEMP%, and
// pytest walks up through all of it), and additionally runs WITHOUT the repo's
// conftest.py - so the verdict would come from a run the developer never gets.
test('the scratch copy lives inside the repo, never in the system temp dir', () => {
  const base = scratchBase(ROOT);
  assert.ok(base.startsWith(ROOT), `scratch base ${base} must be under the analysed root`);
  assert.ok(!base.startsWith(SYSTEM_TMP), 'scratch must not be under the system temp dir');
});

test('GREENROT_SCRATCH_DIR overrides, for read-only checkouts', () => {
  const prev = process.env['GREENROT_SCRATCH_DIR'];
  process.env['GREENROT_SCRATCH_DIR'] = 'X:/elsewhere';
  try {
    assert.equal(scratchBase(ROOT), 'X:/elsewhere');
  } finally {
    if (prev === undefined) delete process.env['GREENROT_SCRATCH_DIR'];
    else process.env['GREENROT_SCRATCH_DIR'] = prev;
  }
});

test('a mutant probe completes fast enough to be usable', async () => {
  const t = Date.now();
  const outcome = await new PythonFrontend().run(ROOT, T, breakAdd('perf'));
  const ms = Date.now() - t;
  // Asserting the outcome as well as the clock is the whole point: an earlier
  // version checked only elapsed time, so an error path returning in 4ms passed
  // it. That is a B7 "asserts nothing about behaviour" test - in greenrot's own
  // suite. A timing assertion without an outcome assertion cannot fail usefully.
  assert.equal(outcome, 'fail', 'a fast error must not be mistaken for a fast success');
  assert.ok(ms < 8000, `one mutant run took ${ms}ms; the temp-dir regression makes this ~17000ms`);
});

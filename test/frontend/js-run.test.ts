import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JsFrontend } from '../../src/frontend/js/index.ts';
import { cleanEnv, patternArgs } from '../../src/frontend/js/runner.ts';
import { isFrontendError, type CoveredLines, type Mutant } from '../../src/frontend/contract.ts';

const ROOT = fileURLToPath(new URL('../corpus/js/simple/', import.meta.url));
const CALC = `${ROOT}calc.js`;

const T = {
  id: 'basic.test.js::add returns the sum',
  file: 'basic.test.js', line: 5, name: 'add returns the sum', skipped: false,
};

const NESTED = {
  id: 'basic.test.js::isEven > is true for even numbers',
  file: 'basic.test.js', line: 10,
  name: 'isEven > is true for even numbers', skipped: false,
};

const breakAdd = (id: string): Mutant => ({
  id, file: 'calc.js', line: 2,
  original: '  return a + b;', mutated: '  return a - b;', operator: 'arith',
});

test('a nested name becomes one pattern per level, not one joined pattern', () => {
  assert.deepEqual(
    patternArgs('isEven > is true for even numbers'),
    ['--test-name-pattern', '^isEven$',
     '--test-name-pattern', '^is true for even numbers$'],
  );
});

test('an unmutated run passes', async () => {
  assert.equal(await new JsFrontend().run(ROOT, T), 'pass');
});

test('a nested test can actually be selected and run', async () => {
  assert.equal(await new JsFrontend().run(ROOT, NESTED), 'pass');
});

test('a mutant that breaks add() makes the test fail', async () => {
  assert.equal(await new JsFrontend().run(ROOT, T, breakAdd('m1')), 'fail');
});

test('the working tree is never modified', async () => {
  const before = readFileSync(CALC, 'utf8');
  await new JsFrontend().run(ROOT, T, breakAdd('m2'));
  assert.equal(readFileSync(CALC, 'utf8'), before);
});

test('coverage attributes production lines, not test lines', async () => {
  const res = await new JsFrontend().cover(ROOT, T);
  assert.equal(isFrontendError(res), false);
  const byFile = (res as CoveredLines).byFile;
  assert.ok(byFile.has('calc.js'), 'must attribute to the production module');
  assert.ok(!byFile.has('basic.test.js'), 'test files are never mutation targets');
  assert.ok(byFile.get('calc.js')!.includes(2), 'add() body must be covered');
  assert.ok(!byFile.get('calc.js')!.includes(6), 'isEven() body must not be');
});

test('mutants are confined to the covered lines', async () => {
  const ms = await new JsFrontend().mutate(ROOT, { byFile: new Map([['calc.js', [2]]]) });
  assert.ok(ms.length > 0);
  assert.ok(ms.every(m => m.file === 'calc.js' && m.line === 2));
  assert.ok(ms.every(m => m.mutated !== m.original));
});

test('discovery finds the corpus tests through the frontend', async () => {
  const found = await new JsFrontend().discover(ROOT);
  assert.equal(isFrontendError(found), false);
  assert.equal((found as { length: number }).length, 3);
});

// Regression for a false all-clear in the runner itself. When greenrot runs
// from inside a test runner, a spawned `node --test` inherits NODE_TEST_CONTEXT,
// reports over IPC instead of an exit code, and EXITS 0 EVEN WHEN THE TEST
// FAILS. Every mutant would survive, every test would come back REAL, and the
// report would be a confident silent lie. These tests run inside node --test,
// so they only pass because the child env is scrubbed.
test('poisonous runner env vars are stripped from the child', () => {
  const cleaned = cleanEnv({
    PATH: '/usr/bin',
    NODE_TEST_CONTEXT: 'child-v8',
    NODE_OPTIONS: '--import=something',
    NODE_V8_COVERAGE: '/stale/dir',
  });
  assert.equal(cleaned['PATH'], '/usr/bin', 'ordinary vars survive');
  assert.equal(cleaned['NODE_TEST_CONTEXT'], undefined);
  assert.equal(cleaned['NODE_OPTIONS'], undefined);
  assert.equal(cleaned['NODE_V8_COVERAGE'], undefined);
});

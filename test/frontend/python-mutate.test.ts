import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PythonFrontend } from '../../src/frontend/python/index.ts';

const ROOT = fileURLToPath(new URL('../corpus/python/simple/', import.meta.url));

test('mutants are generated only inside the covered lines', async () => {
  const mutants = await new PythonFrontend().mutate(ROOT, {
    byFile: new Map([['calc.py', [2]]]),
  });
  assert.ok(mutants.length > 0, 'line 2 is `return a + b` and must yield operators');
  assert.ok(mutants.every(m => m.file === 'calc.py' && m.line === 2));
  assert.ok(mutants.some(m => m.operator === 'arith'));
  assert.ok(mutants.every(m => m.mutated !== m.original));
});

test('an uncovered line yields no mutants rather than a guess', async () => {
  const mutants = await new PythonFrontend().mutate(ROOT, {
    byFile: new Map([['calc.py', [1]]]),
  });
  assert.equal(mutants.length, 0);
});

test('a comment-only or blank covered line yields nothing', async () => {
  const mutants = await new PythonFrontend().mutate(ROOT, {
    byFile: new Map([['calc.py', [3, 4]]]),
  });
  assert.equal(mutants.length, 0);
});

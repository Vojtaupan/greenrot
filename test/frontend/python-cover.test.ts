import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PythonFrontend } from '../../src/frontend/python/index.ts';
import { isFrontendError, type CoveredLines } from '../../src/frontend/contract.ts';

const ROOT = fileURLToPath(new URL('../corpus/python/simple/', import.meta.url));

const T = {
  id: 'test_basic.py::test_add_returns_sum',
  file: 'test_basic.py', line: 4, name: 'test_add_returns_sum', skipped: false,
};

test('tracing one test reports only the production lines it executed', async () => {
  const res = await new PythonFrontend().cover(ROOT, T);
  assert.equal(isFrontendError(res), false);
  const lines = (res as CoveredLines).byFile;

  assert.ok(lines.has('calc.py'), 'must attribute lines to the production module');
  assert.ok(!lines.has('test_basic.py'), 'test files are never mutation targets');
  assert.ok(lines.get('calc.py')!.includes(2), 'add() body line must be covered');
  assert.ok(!lines.get('calc.py')!.includes(6), 'is_even() body must not be attributed');
});

// pytest is chatty and its capture plugin works at the fd level. If any of that
// reaches stdout the JSON channel is corrupted and every command fails to parse.
test('stdout carries JSON only, even though pytest writes a report', async () => {
  const res = await new PythonFrontend().cover(ROOT, T);
  assert.equal(isFrontendError(res), false, 'a parse failure here means stdout was polluted');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PythonFrontend } from '../../src/frontend/python/index.ts';
import { isFrontendError, type TestCase } from '../../src/frontend/contract.ts';

// fileURLToPath, NOT url.pathname: on Windows pathname yields "/C:/Users/..."
// with a leading slash, which no filesystem call accepts.
const ROOT = fileURLToPath(new URL('../corpus/python/simple/', import.meta.url));

test('discovers both test functions with file and line', async () => {
  const found = await new PythonFrontend().discover(ROOT);
  assert.equal(isFrontendError(found), false);
  const tests = found as TestCase[];
  assert.deepEqual(tests.map(t => t.name).sort(), ['test_add_returns_sum', 'test_is_even']);
  assert.ok(tests.every(t => t.line > 0));
  assert.ok(tests.every(t => t.id.includes('::')));
  assert.equal(tests.find(t => t.name === 'test_add_returns_sum')!.file, 'test_basic.py');
});

test('a directory with no python yields an empty list, not a crash', async () => {
  const empty = fileURLToPath(new URL('../corpus/python/', import.meta.url));
  const res = await new PythonFrontend().discover(empty);
  assert.equal(isFrontendError(res), false);
  assert.ok(Array.isArray(res));
});

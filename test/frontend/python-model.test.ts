import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { PythonFrontend } from '../../src/frontend/python/index.ts';
import { isFrontendError, type TestModel } from '../../src/frontend/contract.ts';

const ROOT = fileURLToPath(new URL('../corpus/python/shapes/', import.meta.url));

let cache: Map<string, TestModel> | null = null;
async function models(): Promise<Map<string, TestModel>> {
  if (cache) return cache;
  const fe = new PythonFrontend();
  const tests = await fe.discover(ROOT);
  if (isFrontendError(tests)) throw new Error('discover failed');
  const out = await fe.model(ROOT, tests);
  const m = new Map<string, TestModel>();
  for (const x of out) if (!isFrontendError(x)) m.set(x.test.name, x);
  cache = m;
  return m;
}

test('a test with no assertion has an empty assertion list', async () => {
  assert.equal((await models()).get('test_no_assertion')!.assertions.length, 0);
});

test('literal-vs-literal is tagged literal on both sides', async () => {
  const a = (await models()).get('test_tautology')!.assertions[0]!;
  assert.deepEqual([...a.origins].sort(), ['literal', 'literal']);
});

test('a value built only from literals is test-constructed, never production-derived', async () => {
  const a = (await models()).get('test_only_test_constructed')!.assertions[0]!;
  assert.ok(a.origins.includes('test-constructed'));
  assert.ok(!a.origins.includes('production-derived'));
});

test('asserting a configured mock return is tagged mock-configured', async () => {
  const m = (await models()).get('test_mock_echo')!;
  assert.ok(m.assertions[0]!.origins.includes('mock-configured'));
  assert.ok(m.mocks.some(mk => mk.configuredReturn));
});

test('assert_called_once is call-only', async () => {
  assert.equal((await models()).get('test_call_only')!.assertions[0]!.callOnly, true);
});

test('pytest.raises(Exception) is flagged broad', async () => {
  assert.equal((await models()).get('test_broad_exception')!.assertions[0]!.broadException, true);
});

test('an assertion inside a bare except is flagged swallowed', async () => {
  assert.equal((await models()).get('test_swallowed')!.assertions[0]!.swallowed, true);
});

test('a genuinely production-derived assertion is tagged as such', async () => {
  const fe = new PythonFrontend();
  const simple = fileURLToPath(new URL('../corpus/python/simple/', import.meta.url));
  const tests = await fe.discover(simple);
  if (isFrontendError(tests)) throw new Error('discover failed');
  const out = await fe.model(simple, tests);
  const add = out.find(x => !isFrontendError(x) && x.test.name === 'test_add_returns_sum') as TestModel;
  assert.ok(add.assertions[0]!.origins.includes('production-derived'));
});

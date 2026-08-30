import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadParser } from '../../src/frontend/js/parse.ts';
import { discoverInSource } from '../../src/frontend/js/discover.ts';
import { modelInSource } from '../../src/frontend/js/model.ts';
import { isFrontendError, type TestCase, type TestModel } from '../../src/frontend/contract.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = fileURLToPath(new URL('../corpus/js/shapes/shapes.test.js', import.meta.url));

let cache: Map<string, TestModel> | null = null;
async function models(): Promise<Map<string, TestModel>> {
  if (cache) return cache;
  const parser = (await loadParser(ROOT))!;
  const src = readFileSync(FILE, 'utf8');
  const cases = discoverInSource(src, 'shapes.test.js', parser)
    .filter((x): x is TestCase => !isFrontendError(x));
  const out = modelInSource(src, 'shapes.test.js', parser, cases);
  const m = new Map<string, TestModel>();
  for (const x of out) if (!isFrontendError(x)) m.set(x.test.name, x);
  cache = m;
  return m;
}

test('every discovered test gets a model', async () => {
  assert.equal((await models()).size, 8);
});

test('a test with no assertion has an empty assertion list', async () => {
  assert.equal((await models()).get('no assertion')!.assertions.length, 0);
});

test('literal vs literal is literal on both sides', async () => {
  const a = (await models()).get('tautology')!.assertions[0]!;
  assert.deepEqual([...a.origins].sort(), ['literal', 'literal']);
});

test('an object built from literals is test-constructed, not production-derived', async () => {
  const a = (await models()).get('only test constructed')!.assertions[0]!;
  assert.ok(a.origins.includes('test-constructed'));
  assert.ok(!a.origins.includes('production-derived'));
});

test('mock.fn() results are mock-configured', async () => {
  const m = (await models()).get('mock echo')!;
  assert.ok(m.assertions[0]!.origins.includes('mock-configured'));
  assert.ok(m.mocks.length > 0);
});

test('assert.throws with no matcher is broad', async () => {
  assert.equal((await models()).get('broad throw')!.assertions[0]!.broadException, true);
});

test('an assertion inside try/catch is swallowed', async () => {
  assert.equal((await models()).get('swallowed')!.assertions[0]!.swallowed, true);
});

test('a call into imported production code is production-derived', async () => {
  const a = (await models()).get('genuinely real')!.assertions[0]!;
  assert.ok(a.origins.includes('production-derived'));
});

test('productionCalls counts real calls, and ignores the assert framework', async () => {
  const m = await models();
  assert.ok(m.get('genuinely real')!.productionCalls > 0, 'add() is production');
  assert.equal(m.get('only test constructed')!.productionCalls, 0,
    'assert.equal is framework, not production - counting it would disable A3');
  assert.equal(m.get('tautology')!.productionCalls, 0);
});

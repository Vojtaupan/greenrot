import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadParser } from '../../src/frontend/js/parse.ts';
import { discoverInSource } from '../../src/frontend/js/discover.ts';
import { isFrontendError, type TestCase } from '../../src/frontend/contract.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FILE = fileURLToPath(new URL('../corpus/js/simple/basic.test.js', import.meta.url));

async function cases(): Promise<TestCase[]> {
  const parser = (await loadParser(ROOT))!;
  const out = discoverInSource(readFileSync(FILE, 'utf8'), 'basic.test.js', parser);
  return out.filter((x): x is TestCase => !isFrontendError(x));
}

test('finds top-level tests', async () => {
  assert.ok((await cases()).some(t => t.name === 'add returns the sum'));
});

test('nested tests carry their describe path in the id', async () => {
  const nested = (await cases()).find(t => t.name.includes('is true for even'));
  assert.ok(nested, 'must find the test inside describe()');
  assert.equal(nested!.name, 'isEven > is true for even numbers');
  assert.match(nested!.id, /^basic\.test\.js::isEven > is true for even numbers$/);
});

test('a top-level test is NOT given a describe path it does not have', async () => {
  const top = (await cases()).find(t => t.name === 'add returns the sum');
  assert.ok(top, 'the top-level test must not absorb a later describe');
});

test('test.skip is discovered AND marked skipped, never silently dropped', async () => {
  const skipped = (await cases()).find(t => t.name.includes('skipped on purpose'));
  assert.ok(skipped, 'a skipped test must still be discovered - C12 depends on it');
  assert.equal(skipped!.skipped, true);
});

test('non-skipped tests are not marked skipped', async () => {
  assert.equal((await cases()).find(t => t.name === 'add returns the sum')!.skipped, false);
});

test('every case cites a real line', async () => {
  const all = await cases();
  assert.equal(all.length, 3);
  assert.ok(all.every(t => t.line > 0));
});

test('a file that will not parse yields a parse-failure, not a throw', async () => {
  const parser = (await loadParser(ROOT))!;
  const out = discoverInSource('test(((', 'broken.test.js', parser);
  assert.equal(out.length, 1);
  assert.ok(isFrontendError(out[0]!));
  assert.equal((out[0] as { code: string }).code, 'parse-failure');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { parseArgs, runCli } from '../src/surface/cli.ts';

const SHAPES = fileURLToPath(new URL('./corpus/python/shapes/', import.meta.url));

test('defaults: human format, strict unknowns', () => {
  const o = parseArgs([]);
  assert.equal(o.format, 'human');
  assert.equal(o.strictUnknown, true);
  assert.equal(o.root, '.');
});

test('flags parse', () => {
  const o = parseArgs(['./repo', '--json', '--max-mutants', '8', '--no-strict-unknown']);
  assert.equal(o.root, './repo');
  assert.equal(o.format, 'json');
  assert.equal(o.maxMutants, 8);
  assert.equal(o.strictUnknown, false);
});

test('--sarif selects sarif', () => {
  assert.equal(parseArgs(['--sarif']).format, 'sarif');
});

test('a shapes run exits 1 because proven fakes are present', async () => {
  let out = '';
  const code = await runCli(
    { root: SHAPES, format: 'json', strictUnknown: true, maxMutants: 1 },
    s => { out += s; },
  );
  assert.equal(code, 1);
  const parsed = JSON.parse(out);
  assert.ok(parsed.tally.fake > 0);
  assert.equal(parsed.canClaimClean, false);
});

const JS_SHAPES = fileURLToPath(new URL('./corpus/js/shapes/', import.meta.url));

test('a JS-only directory is analysed without needing a python interpreter', async () => {
  let out = '';
  const code = await runCli(
    {
      root: JS_SHAPES, format: 'json', strictUnknown: true, maxMutants: 1,
      staticOnly: true, exclude: [],
    },
    s => { out += s; },
  );
  const parsed = JSON.parse(out);
  assert.ok(parsed.tally.total > 0, 'JS tests must be discovered');
  assert.equal(code, 1, 'the shapes corpus contains proven fakes');
});

test('both frontends run, so a polyglot root is audited in one pass', async () => {
  let out = '';
  const corpus = fileURLToPath(new URL('./corpus/', import.meta.url));
  await runCli(
    {
      root: corpus, format: 'json', strictUnknown: true, maxMutants: 1,
      staticOnly: true, exclude: [],
    },
    s => { out += s; },
  );
  const parsed = JSON.parse(out);
  const ids: string[] = parsed.tests.map((t: { id: string }) => t.id);
  assert.ok(ids.some(i => i.endsWith('.py::test_no_assertion')), 'python tests found');
  assert.ok(ids.some(i => i.includes('.test.js::no assertion')), 'js tests found');
});

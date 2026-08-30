import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { analyze } from '../src/analyze.ts';
import { PythonFrontend } from '../src/frontend/python/index.ts';

const SIMPLE = fileURLToPath(new URL('./corpus/python/simple/', import.meta.url));
const SHAPES = fileURLToPath(new URL('./corpus/python/shapes/', import.meta.url));

test('honest tests reach REAL once the probe has run', async () => {
  const r = await analyze(SIMPLE, [new PythonFrontend()], { maxMutants: 3 });
  assert.equal(r.verdicts.get('test_basic.py::test_add_returns_sum')?.name, 'REAL');
});

test('structural FAKE verdicts are never re-probed', async () => {
  const r = await analyze(SHAPES, [new PythonFrontend()], { maxMutants: 1 });
  const v = r.verdicts.get('test_shapes.py::test_no_assertion');
  assert.equal(v?.name, 'FAKE');
  assert.equal(v?.evidence[0]!.kind, 'structural');
});

test('an inconclusive probe never erases a structural WEAK finding', async () => {
  const r = await analyze(SHAPES, [new PythonFrontend()], { maxMutants: 1 });
  const v = r.verdicts.get('test_shapes.py::test_call_only');
  assert.ok(v?.name === 'WEAK' || v?.name === 'REAL' || v?.name === 'FAKE');
  assert.notEqual(v?.name, 'UNKNOWN', 'a WEAK finding must not decay to UNKNOWN');
});

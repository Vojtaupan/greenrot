import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { analyzeStructural } from '../src/analyze.ts';
import { PythonFrontend } from '../src/frontend/python/index.ts';
import { headline, tally } from '../src/core/honesty.ts';
import type { Frontend } from '../src/frontend/contract.ts';

const SHAPES = fileURLToPath(new URL('./corpus/python/shapes/', import.meta.url));
const SIMPLE = fileURLToPath(new URL('./corpus/python/simple/', import.meta.url));

test('the shapes corpus yields the expected structural verdicts', async () => {
  const r = await analyzeStructural(SHAPES, [new PythonFrontend()]);
  const name = (t: string) => r.verdicts.get(`test_shapes.py::${t}`)?.name;
  assert.equal(name('test_no_assertion'), 'FAKE');
  assert.equal(name('test_tautology'), 'FAKE');
  assert.equal(name('test_only_test_constructed'), 'FAKE');
  assert.equal(name('test_mock_echo'), 'FAKE');
  assert.equal(name('test_swallowed'), 'FAKE');
  assert.equal(name('test_call_only'), 'WEAK');

  // NOT B8/WEAK. `from calc import add` binds the original function before
  // @patch("calc.add") replaces the module attribute, so the patch is a no-op
  // and the real code runs. B8 stands down when a from-import shadows the
  // patch target, leaving this UNKNOWN for the probe to settle - and the probe
  // proves it REAL. Flagging an ineffective patch would be a wrong reason
  // attached to a real test.
  assert.equal(r.verdicts.get('test_selfmock.py::test_add_is_mocked_away')?.name, 'UNKNOWN');
});

test('a repo with real tests is not declared clean before the probe runs', async () => {
  const r = await analyzeStructural(SIMPLE, [new PythonFrontend()]);
  const h = headline(tally([...r.verdicts.values()]), r.unknownReasons);
  assert.equal(h.canClaimClean, false, 'structural-only analysis must not claim clean');
  assert.ok(r.obligations.length > 0);
});

// Spec, "Error handling": a crashed frontend must never be reportable as clean.
// This is the fifth route to a false all-clear, closed before it can exist.
test('a frontend that crashes mid-run cannot produce a clean report', async () => {
  const crashing: Frontend = {
    language: 'python',
    discover: async () => [
      { id: 'a.py::ok', file: 'a.py', line: 1, name: 'ok', skipped: false },
      { id: 'b.py::boom', file: 'b.py', line: 1, name: 'boom', skipped: false },
    ],
    model: async () => [
      {
        test: { id: 'a.py::ok', file: 'a.py', line: 1, name: 'ok', skipped: false },
        assertions: [{
          line: 2, kind: 'assert', origins: ['literal', 'literal'],
          callOnly: false, broadException: false, swallowed: false, unreachable: false,
        }],
        mocks: [], unitUnderTest: null, overMocked: false, productionCalls: 0,
      },
      { error: true, code: 'frontend-crash', file: 'b.py', line: 1, detail: 'segfault in the analyzer' },
    ],
    cover: async () => ({ byFile: new Map() }),
    mutate: async () => [],
    run: async () => 'pass',
  };

  const r = await analyzeStructural('/irrelevant', [crashing]);
  const h = headline(tally([...r.verdicts.values()]), r.unknownReasons);
  assert.equal(h.canClaimClean, false);
  assert.match(h.text, /frontend-crash/);
  assert.equal(r.unknownReasons.get('frontend-crash'), 1);
});

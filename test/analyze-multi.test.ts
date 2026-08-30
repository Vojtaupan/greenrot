import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStructural } from '../src/analyze.ts';
import type { Frontend, TestCase, TestModel } from '../src/frontend/contract.ts';

function stub(language: Frontend['language'], file: string, name: string): Frontend {
  const tc: TestCase = { id: `${file}::${name}`, file, line: 1, name, skipped: false };
  const model: TestModel = {
    test: tc,
    assertions: [{
      line: 2, kind: 'assert', origins: ['literal', 'literal'],
      callOnly: false, broadException: false, swallowed: false, unreachable: false,
    }],
    mocks: [], unitUnderTest: null, overMocked: false, productionCalls: 0,
  };
  return {
    language,
    discover: async () => [tc],
    model: async () => [model],
    cover: async () => ({ byFile: new Map() }),
    mutate: async () => [],
    run: async () => 'pass',
  };
}

test('verdicts from every frontend appear in one result', async () => {
  const r = await analyzeStructural('/r', [
    stub('python', 'a.py', 'test_a'),
    stub('javascript', 'b.test.ts', 'b works'),
  ]);
  assert.equal(r.verdicts.size, 2);
  assert.ok(r.verdicts.has('a.py::test_a'));
  assert.ok(r.verdicts.has('b.test.ts::b works'));
});

test('one frontend failing does not discard the other frontend results', async () => {
  const broken: Frontend = {
    language: 'javascript',
    discover: async () => ({ error: true, code: 'runner-missing', file: '', line: 1, detail: 'no node' }),
    model: async () => [],
    cover: async () => ({ byFile: new Map() }),
    mutate: async () => [],
    run: async () => 'pass',
  };
  const r = await analyzeStructural('/r', [stub('python', 'a.py', 'test_a'), broken]);
  assert.ok(r.verdicts.has('a.py::test_a'), 'the working frontend still reports');
  assert.equal(r.unknownReasons.get('runner-missing'), 1, 'and the failure is still admitted');
});

test('no frontend finding anything yields an empty result, not a clean one', async () => {
  const empty: Frontend = {
    language: 'javascript',
    discover: async () => [],
    model: async () => [],
    cover: async () => ({ byFile: new Map() }),
    mutate: async () => [],
    run: async () => 'pass',
  };
  const r = await analyzeStructural('/r', [empty]);
  assert.equal(r.verdicts.size, 0);
});

test('the CI audit runs once, not once per frontend', async () => {
  const two = await analyzeStructural('/r', [
    stub('python', 'a.py', 'test_a'),
    stub('javascript', 'b.test.ts', 'b works'),
  ]);
  const one = await analyzeStructural('/r', [stub('python', 'a.py', 'test_a')]);
  assert.equal(two.ciFindings.length, one.ciFindings.length,
    'D13 findings must not be duplicated per frontend');
});

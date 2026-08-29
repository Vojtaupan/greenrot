import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isFrontendError, type TestModel, type FrontendError } from '../../src/frontend/contract.ts';

test('a frontend error is distinguishable from a model at runtime', () => {
  const err: FrontendError = {
    error: true, code: 'parse-failure', file: 'a.py', line: 1, detail: 'bad syntax',
  };
  const ok: TestModel = {
    test: { id: 'a.py::t', file: 'a.py', line: 2, name: 't', skipped: false },
    assertions: [], mocks: [], unitUnderTest: null, overMocked: false,
  };
  assert.equal(isFrontendError(err), true);
  assert.equal(isFrontendError(ok), false);
});

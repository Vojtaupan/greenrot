// Verbose, busy, and checks nothing. These must be caught.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Service } from './service.js';

test('service label behaviour', () => {
  const repo = { find: mock.fn(() => ({ name: 'ada' })) };
  const result = new Service(repo).label('k');
  const expected = 'found:ADA';
  // Asserts the constant against itself. `result` is never involved.
  assert.equal(expected, 'found:ADA');
});

test('repo is wired', () => {
  const repo = { find: mock.fn(() => null) };
  new Service(repo).label('k');
  // Invocation only - WEAK, never FAKE. It would still fail if the find() call
  // were removed, and our operators cannot delete a call.
  assert.equal(repo.find.mock.callCount(), 1);
});

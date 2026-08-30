import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './calc.js';

test('no assertion', () => {
  const x = 1 + 1;
});

test('tautology', () => {
  assert.equal(5, 5);
});

test('only test constructed', () => {
  const data = { a: 1 };
  assert.equal(data.a, 1);
});

test('mock echo', () => {
  const fetchThing = mock.fn(() => 42);
  assert.equal(fetchThing(), 42);
});

test('call only', () => {
  const save = mock.fn();
  save();
  assert.equal(save.mock.callCount(), 1);
});

test('broad throw', () => {
  assert.throws(() => {
    throw new Error('x');
  });
});

test('swallowed', () => {
  try {
    assert.equal(1, 2);
  } catch {
    // ignored
  }
});

test('genuinely real', () => {
  assert.equal(add(2, 3), 5);
});

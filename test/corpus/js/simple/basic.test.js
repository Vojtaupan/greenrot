import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { add, isEven } from './calc.js';

test('add returns the sum', () => {
  assert.equal(add(2, 3), 5);
});

describe('isEven', () => {
  test('is true for even numbers', () => {
    assert.equal(isEven(4), true);
  });

  test.skip('is skipped on purpose', () => {
    assert.equal(isEven(3), false);
  });
});

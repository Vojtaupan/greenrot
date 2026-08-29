import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VERSION } from '../src/index.ts';

test('package exposes a version string', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+\.\d+$/);
});

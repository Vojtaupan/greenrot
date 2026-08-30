import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetsToLines } from '../../src/frontend/js/coverage.ts';

const SRC = [
  'export function add(a, b) {',   // 1
  '  return a + b;',               // 2
  '}',                             // 3
  '',                              // 4
  'export function isEven(n) {',   // 5
  '  return n % 2 === 0;',         // 6
  '}',                             // 7
  '',
].join('\n');

const at = (needle: string) => SRC.indexOf(needle);

test('a covered range yields its lines', () => {
  const lines = offsetsToLines(SRC, [
    { startOffset: at('export function add'), endOffset: at('}') + 1, count: 1 },
  ]);
  assert.ok(lines.includes(2), 'the body line must be covered');
});

test('a zero-count range removes lines a positive range added', () => {
  const lines = offsetsToLines(SRC, [
    { startOffset: 0, endOffset: SRC.length, count: 1 },
    { startOffset: at('export function isEven'), endOffset: SRC.length, count: 0 },
  ]);
  assert.ok(lines.includes(2), 'add() stays covered');
  assert.ok(!lines.includes(6), 'isEven() body must be excluded - it never ran');
});

test('no positive ranges yields nothing, not everything', () => {
  assert.deepEqual(
    offsetsToLines(SRC, [{ startOffset: 0, endOffset: SRC.length, count: 0 }]),
    [],
  );
});

test('an empty range list yields nothing', () => {
  assert.deepEqual(offsetsToLines(SRC, []), []);
});

test('lines come back sorted and unique', () => {
  const lines = offsetsToLines(SRC, [
    { startOffset: at('  return a + b;'), endOffset: at('  return a + b;') + 5, count: 1 },
    { startOffset: at('export function add'), endOffset: at('}') + 1, count: 3 },
  ]);
  assert.deepEqual([...lines].sort((a, b) => a - b), lines);
  assert.equal(new Set(lines).size, lines.length);
});

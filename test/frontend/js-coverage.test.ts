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

// Regression: a zero-count range that merely STARTS on a line must not delete
// that line. `if (row === null) return 'missing';` produces a zero range for
// the untaken branch beginning mid-line; touch-based subtraction removed the
// whole line, losing the mutation target on exactly the branch-y lines that
// matter most.
test('a partially-dead line stays covered', () => {
  const src = [
    'function label(row) {',                       // 1
    "  if (row === null) return 'missing';",       // 2
    "  return 'found';",                           // 3
    '}',                                           // 4
    '',
  ].join('\n');
  const lineStart = src.indexOf("  if (row");
  const deadStart = src.indexOf("return 'found'");

  const lines = offsetsToLines(src, [
    { startOffset: 0, endOffset: src.length, count: 1 },
    // The untaken branch: starts on line 2 after the taken return, runs to EOF.
    { startOffset: lineStart + 20, endOffset: src.length, count: 0 },
  ]);

  assert.ok(lines.includes(2), 'line 2 ran and must remain a mutation target');
  assert.ok(deadStart > 0);
});

test('a fully-dead line is still removed', () => {
  const src = ['const a = 1;', 'const b = 2;', ''].join('\n');
  const lines = offsetsToLines(src, [
    { startOffset: 0, endOffset: src.length, count: 1 },
    { startOffset: src.indexOf('const b'), endOffset: src.length, count: 0 },
  ]);
  assert.ok(lines.includes(1));
  assert.ok(!lines.includes(2), 'a wholly-uncovered line must still be excluded');
});

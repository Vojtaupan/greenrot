import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadParser, TS_UNSUPPORTED } from '../../src/frontend/js/parse.ts';

// fileURLToPath, NOT url.pathname: on Windows pathname yields "/C:/Users/..."
// with a leading slash, which no filesystem call accepts.
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('a parser is always available - acorn is bundled', async () => {
  const p = await loadParser(ROOT);
  assert.ok(p);
  assert.ok(['acorn', 'strip+acorn'].includes(p!.kind));
});

test('plain JavaScript parses', async () => {
  const p = (await loadParser(ROOT))!;
  const r = p.parse('export function add(a, b) { return a + b; }\n', 'calc.js');
  assert.ok(!('failed' in r), 'valid JS must parse');
  assert.equal((r as { ast: { type?: string } }).ast.type, 'Program');
});

// Deliberately not a skip. A conditional skip would be invisible on older Node
// AND would itself trip greenrot's own C12 check. This asserts the real
// contract instead: either TypeScript parses, or the failure names the reason.
test('TypeScript either parses, or fails with a reason naming the requirement', async () => {
  const p = (await loadParser(ROOT))!;
  const r = p.parse('export function add(a: number): number {\n  return a;\n}\n', 'calc.ts');
  if (p.canParseTypeScript) {
    assert.ok(!('failed' in r), 'with a stripper available, TS must parse');
  } else {
    assert.ok('failed' in r);
    assert.equal((r as { detail: string }).detail, TS_UNSUPPORTED);
  }
});

test('type stripping preserves line positions', async (t) => {
  const p = (await loadParser(ROOT))!;
  if (!p.canParseTypeScript) return; // asserted by the test above on old Node
  const src = 'const a = 1;\nexport function add(x: number): number {\n  return x;\n}\n';
  const r = p.parse(src, 'calc.ts');
  assert.ok(!('failed' in r));
  const body = ((r as { ast: { body: Array<{ loc?: { start?: { line?: number } } }> } }).ast).body;
  const fn = body[1]!;
  assert.equal(fn.loc?.start?.line, 2, 'the function must still be reported on line 2');
  t.diagnostic('positions survive stripping, so findings can cite the original .ts');
});

test('a syntax error is a reported failure, never a throw', async () => {
  const p = (await loadParser(ROOT))!;
  const r = p.parse('function ( { !!!', 'broken.js');
  assert.ok('failed' in r, 'must return a failure object');
  assert.ok((r as { line: number }).line >= 1, 'and cite a line');
});

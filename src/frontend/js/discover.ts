import type { FrontendError, TestCase } from '../contract.ts';
import type { EsNode, Parser } from './parse.ts';

const TEST_FNS = new Set(['test', 'it']);
const SUITE_FNS = new Set(['describe', 'suite']);
const SKIP_MODIFIERS = new Set(['skip', 'todo']);

interface Span {
  readonly start: number;
  readonly end: number;
}

/** `test('x')` -> base 'test'; `test.skip('x')` -> base 'test', modifier 'skip'. */
export function calleeParts(node: EsNode): { base: string; modifier: string | null } | null {
  const callee = node['callee'] as EsNode | undefined;
  if (!callee) return null;

  if (callee['type'] === 'Identifier') {
    return { base: String(callee['name']), modifier: null };
  }
  if (callee['type'] === 'MemberExpression') {
    const obj = callee['object'] as EsNode | undefined;
    const prop = callee['property'] as EsNode | undefined;
    if (obj?.['type'] === 'Identifier' && prop?.['type'] === 'Identifier') {
      return { base: String(obj['name']), modifier: String(prop['name']) };
    }
  }
  return null;
}

/** The first argument, when it is a plain string literal. */
function literalName(node: EsNode): string | null {
  const args = node['arguments'] as EsNode[] | undefined;
  const first = args?.[0];
  if (!first) return null;
  const v = first['value'];
  return typeof v === 'string' ? v : null;
}

export function walk(node: unknown, visit: (n: EsNode) => void): void {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const c of node) walk(c, visit);
    return;
  }
  const n = node as EsNode;
  if (typeof n['type'] === 'string') visit(n);
  for (const key of Object.keys(n)) {
    if (key === 'loc' || key === 'range') continue;
    const child = n[key];
    if (child && typeof child === 'object') walk(child, visit);
  }
}

const lineOf = (n: EsNode): number => n.loc?.start?.line ?? 1;
const spanOf = (n: EsNode): Span => ({
  start: Number(n['start'] ?? 0),
  end: Number(n['end'] ?? 0),
});

export function discoverInSource(
  source: string,
  file: string,
  parser: Parser,
): Array<TestCase | FrontendError> {
  const parsed = parser.parse(source, file);
  if ('failed' in parsed) {
    return [{ error: true, code: 'parse-failure', file, line: parsed.line, detail: parsed.detail }];
  }

  // Collect suites with their byte ranges. Nesting is then an exact
  // containment question rather than a line-ordering guess - a top-level test
  // written above a describe() must not absorb that describe's name.
  const suites: Array<Span & { name: string }> = [];
  walk(parsed.ast, (n) => {
    if (n['type'] !== 'CallExpression') return;
    const parts = calleeParts(n);
    if (!parts || !SUITE_FNS.has(parts.base)) return;
    const name = literalName(n);
    if (name === null) return;
    suites.push({ ...spanOf(n), name });
  });

  const out: Array<TestCase | FrontendError> = [];
  walk(parsed.ast, (n) => {
    if (n['type'] !== 'CallExpression') return;
    const parts = calleeParts(n);
    if (!parts || !TEST_FNS.has(parts.base)) return;
    const name = literalName(n);
    if (name === null) return;

    const span = spanOf(n);
    const path = suites
      .filter(s => s.start < span.start && span.end <= s.end)
      .sort((a, b) => a.start - b.start)
      .map(s => s.name);
    const full = [...path, name].join(' > ');

    out.push({
      id: `${file}::${full}`,
      file,
      line: lineOf(n),
      name: full,
      skipped: parts.modifier !== null && SKIP_MODIFIERS.has(parts.modifier),
    });
  });

  return out;
}

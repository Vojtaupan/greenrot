import type {
  AssertionModel, FrontendError, MockModel, TestCase, TestModel, ValueOrigin,
} from '../contract.ts';
import type { EsNode, Parser } from './parse.ts';
import { calleeParts, walk } from './discover.ts';

const MOCK_FACTORIES = new Set(['mock', 'vi', 'jest', 'sinon']);
const MOCK_METHODS = new Set(['fn', 'method', 'spyOn', 'stub']);
const CONFIGURES_RETURN = new Set([
  'mockReturnValue', 'mockResolvedValue', 'mockReturnValueOnce',
  'mockImplementation', 'returns', 'resolves',
]);
const CALL_ONLY_MATCHERS = new Set([
  'toHaveBeenCalled', 'toHaveBeenCalledTimes', 'toHaveBeenCalledWith', 'callCount',
]);
const THROW_ASSERTS = new Set(['throws', 'rejects', 'toThrow', 'toThrowError']);

/**
 * Roots that belong to the TEST FRAMEWORK, not to production code.
 *
 * This set is load-bearing for check A3. `assert.equal(...)` is a
 * CallExpression whose root identifier is unknown to the origin table, so
 * without this it would classify as production-derived, `productionCalls`
 * would never be zero, and A3 could never fire on anything.
 */
const FRAMEWORK_ROOTS = new Set([
  'assert', 'expect', 'test', 'it', 'describe', 'suite', 'before', 'after',
  'beforeEach', 'afterEach', 'mock', 'vi', 'jest', 'sinon', 't', 'chai', 'should',
]);

const ORIGIN_RANK: readonly ValueOrigin[] = [
  'production-derived', 'unknown', 'mock-configured', 'test-constructed', 'literal',
];

function merge(kids: readonly ValueOrigin[]): ValueOrigin {
  for (const rank of ORIGIN_RANK) if (kids.includes(rank)) return rank;
  return 'unknown';
}

const start = (n: EsNode): number => Number(n['start'] ?? 0);
const end = (n: EsNode): number => Number(n['end'] ?? 0);
const lineOf = (n: EsNode): number => n.loc?.start?.line ?? 1;

/** The leftmost identifier of a callee chain: `a.b.c()` -> 'a'. */
export function calleeRootName(node: EsNode): string {
  let cur = node['callee'] as EsNode | undefined;
  while (cur && cur['type'] === 'MemberExpression') cur = cur['object'] as EsNode | undefined;
  return cur?.['type'] === 'Identifier' ? String(cur['name']) : '';
}

function childExpressions(node: EsNode): EsNode[] {
  const out: EsNode[] = [];
  for (const key of ['elements', 'properties']) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    for (const el of arr) {
      if (!el || typeof el !== 'object') continue;
      const e = el as EsNode;
      if (e['type'] === 'Property') {
        const v = e['value'];
        if (v && typeof v === 'object') out.push(v as EsNode);
      } else {
        out.push(e);
      }
    }
  }
  return out;
}

/**
 * Where a value came from. Mirrors the Python frontend's `_OriginTable`
 * exactly, including its conservatism: anything untraceable is 'unknown',
 * which can never justify a FAKE - only a probe obligation.
 */
export function classify(node: EsNode | undefined, names: Map<string, ValueOrigin>): ValueOrigin {
  if (!node) return 'unknown';
  const t = String(node['type'] ?? '');

  if (t === 'Literal' || t === 'TemplateLiteral') return 'literal';

  if (t === 'ObjectExpression' || t === 'ArrayExpression') {
    const kids = childExpressions(node).map(k => classify(k, names));
    if (kids.length === 0) return 'test-constructed';
    return kids.every(k => k === 'literal' || k === 'test-constructed')
      ? 'test-constructed'
      : merge(kids);
  }

  if (t === 'Identifier') return names.get(String(node['name'])) ?? 'unknown';
  if (t === 'MemberExpression') return classify(node['object'] as EsNode, names);
  if (t === 'AwaitExpression' || t === 'UnaryExpression') {
    return classify(node['argument'] as EsNode, names);
  }
  if (t === 'BinaryExpression' || t === 'LogicalExpression') {
    return merge([classify(node['left'] as EsNode, names), classify(node['right'] as EsNode, names)]);
  }

  if (t === 'CallExpression' || t === 'NewExpression') {
    const root = calleeRootName(node);
    const parts = calleeParts(node);
    if (parts && MOCK_FACTORIES.has(parts.base) && parts.modifier
        && MOCK_METHODS.has(parts.modifier)) {
      return 'mock-configured';
    }
    if (names.get(root) === 'mock-configured') return 'mock-configured';
    if (FRAMEWORK_ROOTS.has(root)) return 'unknown';
    const base = names.get(root);
    if (base === 'literal' || base === 'test-constructed') return 'test-constructed';
    // An untraced callable is assumed to reach production code. This is the
    // SAFE direction - it buys a probe obligation, never an accusation.
    return 'production-derived';
  }

  return 'unknown';
}

/** Byte ranges of try-blocks whose handler would swallow an assertion error. */
function swallowingRanges(fnBody: EsNode): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  walk(fnBody, (n) => {
    if (n['type'] !== 'TryStatement') return;
    if (!n['handler']) return;
    const block = n['block'] as EsNode | undefined;
    if (block) out.push({ start: start(block), end: end(block) });
  });
  return out;
}

/** Byte ranges made unreachable by an earlier return/throw in the same block. */
function unreachableRanges(fnBody: EsNode): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  walk(fnBody, (n) => {
    const body = n['body'];
    if (!Array.isArray(body)) return;
    let dead = false;
    for (const stmt of body as EsNode[]) {
      if (dead) out.push({ start: start(stmt), end: end(stmt) });
      else if (stmt['type'] === 'ReturnStatement' || stmt['type'] === 'ThrowStatement') dead = true;
    }
  });
  return out;
}

const inAny = (n: EsNode, ranges: ReadonlyArray<{ start: number; end: number }>): boolean =>
  ranges.some(r => r.start <= start(n) && end(n) <= r.end);

/** The `expect(x).toBe(y)` shape: a member call on an `expect(...)` call. */
function expectSubject(node: EsNode): EsNode | null {
  const callee = node['callee'] as EsNode | undefined;
  if (callee?.['type'] !== 'MemberExpression') return null;
  const obj = callee['object'] as EsNode | undefined;
  if (obj?.['type'] !== 'CallExpression') return null;
  const inner = obj['callee'] as EsNode | undefined;
  if (inner?.['type'] !== 'Identifier' || inner['name'] !== 'expect') return null;
  const args = obj['arguments'] as EsNode[] | undefined;
  return args?.[0] ?? null;
}

function collectBindings(fnBody: EsNode, names: Map<string, ValueOrigin>, mocks: MockModel[]): void {
  const ordered: EsNode[] = [];
  walk(fnBody, (n) => {
    if (n['type'] === 'VariableDeclarator' || n['type'] === 'AssignmentExpression') ordered.push(n);
    if (n['type'] === 'CallExpression') ordered.push(n);
  });
  ordered.sort((a, b) => start(a) - start(b));

  for (const n of ordered) {
    if (n['type'] === 'VariableDeclarator' || n['type'] === 'AssignmentExpression') {
      const target = (n['id'] ?? n['left']) as EsNode | undefined;
      const value = (n['init'] ?? n['right']) as EsNode | undefined;
      if (target?.['type'] !== 'Identifier') continue;
      const name = String(target['name']);
      names.set(name, classify(value, names));

      if (value && (value['type'] === 'CallExpression')) {
        const parts = calleeParts(value);
        if (parts && MOCK_FACTORIES.has(parts.base) && parts.modifier
            && MOCK_METHODS.has(parts.modifier)) {
          const args = value['arguments'] as EsNode[] | undefined;
          mocks.push({
            line: lineOf(n),
            target: name,
            // mock.fn(() => 42) configures a return; mock.fn() does not.
            configuredReturn: Boolean(args && args.length > 0),
          });
          names.set(name, 'mock-configured');
        }
      }
      continue;
    }

    // `m.mockReturnValue(5)` configures an existing mock.
    const parts = calleeParts(n);
    if (parts?.modifier && CONFIGURES_RETURN.has(parts.modifier)) {
      for (const mk of mocks) {
        if (mk.target === parts.base) {
          (mk as { configuredReturn: boolean }).configuredReturn = true;
        }
      }
      names.set(parts.base, 'mock-configured');
    }
  }
}

function collectAssertions(
  fnBody: EsNode,
  names: Map<string, ValueOrigin>,
): AssertionModel[] {
  const swallow = swallowingRanges(fnBody);
  const dead = unreachableRanges(fnBody);
  const out: AssertionModel[] = [];

  const nodes: EsNode[] = [];
  walk(fnBody, (n) => { if (n['type'] === 'CallExpression') nodes.push(n); });
  nodes.sort((a, b) => start(a) - start(b));

  for (const n of nodes) {
    const parts = calleeParts(n);
    const subject = expectSubject(n);
    const args = (n['arguments'] as EsNode[] | undefined) ?? [];

    const isAssertCall = parts?.base === 'assert';
    const isExpectCall = subject !== null;
    if (!isAssertCall && !isExpectCall) continue;

    const matcher = parts?.modifier ?? String(
      ((n['callee'] as EsNode)['property'] as EsNode | undefined)?.['name'] ?? '',
    );

    const operands = isExpectCall ? [subject!, ...args] : args;
    const origins = operands.map(o => classify(o, names));

    out.push({
      line: lineOf(n),
      kind: matcher || 'assert',
      origins: origins.length > 0 ? origins : ['unknown'],
      callOnly: CALL_ONLY_MATCHERS.has(matcher)
        || operands.some(o => o['type'] === 'CallExpression'
          && CALL_ONLY_MATCHERS.has(String(
            ((o['callee'] as EsNode | undefined)?.['property'] as EsNode | undefined)?.['name'] ?? '',
          ))),
      // A throw assertion with no second argument accepts ANY error, including
      // the module failing to import.
      broadException: THROW_ASSERTS.has(matcher) && args.length <= 1,
      swallowed: inAny(n, swallow),
      unreachable: inAny(n, dead),
    });
  }

  return out;
}

function countProductionCalls(fnBody: EsNode, names: Map<string, ValueOrigin>): number {
  let n = 0;
  walk(fnBody, (node) => {
    if (node['type'] !== 'CallExpression') return;
    if (FRAMEWORK_ROOTS.has(calleeRootName(node))) return;
    if (classify(node, names) === 'production-derived') n++;
  });
  return n;
}

export function modelInSource(
  source: string,
  file: string,
  parser: Parser,
  cases: readonly TestCase[],
): Array<TestModel | FrontendError> {
  const parsed = parser.parse(source, file);
  if ('failed' in parsed) {
    return [{ error: true, code: 'parse-failure', file, line: parsed.line, detail: parsed.detail }];
  }

  // Index the test-callback bodies by the id discovery already assigned, so
  // the two passes cannot disagree about which test is which.
  const bodies = new Map<number, EsNode>();
  walk(parsed.ast, (n) => {
    if (n['type'] !== 'CallExpression') return;
    const parts = calleeParts(n);
    if (!parts || !(parts.base === 'test' || parts.base === 'it')) return;
    const args = n['arguments'] as EsNode[] | undefined;
    const fn = args?.find(a => a['type'] === 'ArrowFunctionExpression'
      || a['type'] === 'FunctionExpression');
    if (fn) bodies.set(lineOf(n), (fn['body'] as EsNode) ?? fn);
  });

  const out: Array<TestModel | FrontendError> = [];
  for (const tc of cases) {
    const body = bodies.get(tc.line);
    if (!body) {
      out.push({
        error: true, code: 'parse-failure', file, line: tc.line,
        detail: `could not locate the callback body for ${tc.name}`,
      });
      continue;
    }
    const names = new Map<string, ValueOrigin>();
    const mocks: MockModel[] = [];
    collectBindings(body, names, mocks);
    const assertions = collectAssertions(body, names);
    const productionCalls = countProductionCalls(body, names);

    out.push({
      test: tc,
      assertions,
      mocks,
      unitUnderTest: null,
      // B9 means what it says: mocks exist and NO production code runs. Not a ratio.
      overMocked: mocks.length > 0 && productionCalls === 0,
      productionCalls,
    });
  }
  return out;
}

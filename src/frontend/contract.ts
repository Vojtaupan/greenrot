import type { UnknownReason } from '../core/verdict.ts';

export interface TestCase {
  /** Stable across runs: `<relpath>::<name>`. */
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly name: string;
  readonly skipped: boolean;
}

/**
 * Where the value on the left of an assertion came from. The heart of triage:
 * an assertion whose operands never touched production code cannot fail
 * because of production code.
 *
 * 'unknown' is deliberately present and deliberately inert - it can never
 * justify a FAKE verdict, only a probe obligation.
 */
export type ValueOrigin =
  | 'literal'
  | 'test-constructed'
  | 'mock-configured'
  | 'production-derived'
  | 'unknown';

export interface AssertionModel {
  readonly line: number;
  readonly kind: string;
  readonly origins: readonly ValueOrigin[];
  readonly callOnly: boolean;
  readonly broadException: boolean;
  readonly swallowed: boolean;
  readonly unreachable: boolean;
}

export interface MockModel {
  readonly line: number;
  readonly target: string;
  readonly configuredReturn: boolean;
}

export interface TestModel {
  readonly test: TestCase;
  readonly assertions: readonly AssertionModel[];
  readonly mocks: readonly MockModel[];
  readonly unitUnderTest: string | null;
  readonly overMocked: boolean;
  /**
   * How many calls in this test reach production code. Check A3 asserts that
   * production code was never reached, so it must stand down when this is > 0.
   */
  readonly productionCalls: number;
}

export interface FrontendError {
  readonly error: true;
  readonly code: UnknownReason;
  readonly file: string;
  readonly line: number;
  readonly detail: string;
}

export function isFrontendError(x: unknown): x is FrontendError {
  return typeof x === 'object' && x !== null && (x as FrontendError).error === true;
}

export interface CoveredLines {
  /** file -> executed line numbers, production files only (tests excluded). */
  readonly byFile: ReadonlyMap<string, readonly number[]>;
}

export interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly line: number;
  readonly original: string;
  readonly mutated: string;
  readonly operator: string;
}

export type RunOutcome = 'pass' | 'fail' | 'error';

/** The five capabilities. A language is supported when it implements these. */
export interface Frontend {
  readonly language: 'python' | 'javascript';
  discover(root: string): Promise<TestCase[] | FrontendError>;
  model(root: string, tests: readonly TestCase[]): Promise<Array<TestModel | FrontendError>>;
  cover(root: string, test: TestCase): Promise<CoveredLines | FrontendError>;
  mutate(root: string, lines: CoveredLines): Promise<Mutant[]>;
  run(root: string, test: TestCase, mutant?: Mutant): Promise<RunOutcome>;
}

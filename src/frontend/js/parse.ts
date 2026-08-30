export interface ParseFailure {
  readonly failed: true;
  readonly line: number;
  readonly detail: string;
}

export type ParserKind = 'acorn' | 'strip+acorn';

export interface ParsedFile {
  readonly ast: EsNode;
  readonly kind: ParserKind;
}

/** The ESTree subset this frontend reads. Deliberately loose - acorn's real
 *  nodes carry far more, and nothing downstream should depend on the extras. */
export interface EsNode {
  type?: string;
  loc?: { start?: { line?: number } };
  [k: string]: unknown;
}

export interface Parser {
  readonly kind: ParserKind;
  /** True when TypeScript sources can be analysed at all on this runtime. */
  readonly canParseTypeScript: boolean;
  parse(source: string, file: string): ParsedFile | ParseFailure;
}

const isTs = (file: string) => /\.(ts|tsx|mts|cts)$/.test(file);

export const TS_UNSUPPORTED =
  'TypeScript analysis needs Node >= 23.10 (module.stripTypeScriptTypes)';

/**
 * Acorn is the ONLY AST producer, and that is a deliberate narrowing.
 *
 * The obvious alternative - use the target repo's `typescript` when it has one
 * - means every downstream classifier has to read two structurally different
 * ASTs (`kind` vs `type`, `expression` vs `callee`). That doubles the surface
 * of exactly the code that decides the false-positive rate, to support a route
 * that is only sometimes available anyway.
 *
 * So TypeScript is normalised to JavaScript first, via Node's own type
 * stripping, which replaces types with WHITESPACE and therefore preserves
 * every line and column. That is what lets a finding cite the original .ts
 * file with no source map at all.
 *
 * The cost is honest and stated: on Node < 23.10 there is no stripper, and a
 * .ts file becomes a reported UNKNOWN rather than a guess.
 */
export async function loadParser(_root: string): Promise<Parser | null> {
  let acorn: { parse: (s: string, o: unknown) => EsNode };
  try {
    acorn = (await import('acorn')) as unknown as typeof acorn;
  } catch {
    return null;
  }

  const mod = (await import('node:module')) as unknown as {
    stripTypeScriptTypes?: (s: string) => string;
  };
  const strip = mod.stripTypeScriptTypes;

  return {
    kind: strip ? 'strip+acorn' : 'acorn',
    canParseTypeScript: Boolean(strip),

    parse(source, file) {
      let text = source;
      if (isTs(file)) {
        if (!strip) return { failed: true, line: 1, detail: TS_UNSUPPORTED };
        try {
          text = strip(source);
        } catch (e) {
          return { failed: true, line: 1, detail: e instanceof Error ? e.message : String(e) };
        }
      }
      try {
        const ast = acorn.parse(text, {
          ecmaVersion: 'latest',
          sourceType: 'module',
          locations: true,
          allowHashBang: true,
          allowAwaitOutsideFunction: true,
        });
        return { ast, kind: strip ? 'strip+acorn' : 'acorn' };
      } catch (e) {
        const err = e as { loc?: { line?: number }; message?: string };
        return { failed: true, line: err.loc?.line ?? 1, detail: err.message ?? String(e) };
      }
    },
  };
}

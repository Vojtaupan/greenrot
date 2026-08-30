# Self-audit — 2026-08-30

greenrot pointed at greenrot, for the first time. This is what the JS frontend
was built for: until it existed, greenrot's own tests were TypeScript and its
Python frontend could not see them.

## Result

Full probe over the pure unit tests (`test/core`, `test/report`, `test/fp-gate`,
`test/analyze-multi`, `test/scaffold`):

```
no fake tests among the 70 I could vouch for, 24 weak; 3 I could not
73 tests: 46 real, 24 weak, 0 fake, 3 unknown          (78 seconds)
```

Static pass over the whole suite, 140 tests, 0.8s: **zero structural fakes**.

46 tests are *proven honest* — greenrot broke the code each one covers and each
one went red.

## The audit changed the product

The first run reported **23 FAKE verdicts**. Every one was a false positive, and
they shared a single cause that was a genuine soundness flaw in the design:

> "Insensitive to every mutant we generated" is **not** the same claim as
> "cannot fail."

The operator set is four families with one mutant per family per line - a narrow
sample of the defects a test might catch - and `--max-mutants` truncates even
that. So "detected none of them" is evidence of weakness, not proof of vacuity.

The clearest example, `color codes are absent when color is off`:

```ts
const out = renderHuman(new Map([['a', fake]]), new Map(), { color: false });
assert.doesNotMatch(out, /\[/);
```

The probe flipped a `===` elsewhere in `renderHuman`; the test still passed; the
old rule called that total insensitivity and accused it. But that test would
fail the instant `paint()` emitted codes with colour off. It is a real test that
simply does not care about an unrelated comparison.

**The fix:** the probe may now conclude only `REAL` (it caught a mutation) or
`WEAK` (it caught none of the ones we tried). `FAKE` is reserved for
**structural** proof, where no assertion in the test can vary at all.

That narrows the product's headline claim. It is the true version of it, and the
23 accusations are gone without losing a single corpus true positive - the gate
still reports 31/31 agreements and 0 false FAKE, because every labelled FAKE in
the corpus was always structural.

A truncated probe now also says so in its evidence - *"detected none of the 2
mutations tried (of 6 available)"* - so the report never overstates how hard it
looked.

## Limitation found: greenrot's own suite is a hostile probe target

The full-repo probe was abandoned after several minutes. About half of
greenrot's tests spawn subprocesses (`node --test`, `pytest`), so probing them
means running subprocess-spawning tests *under mutants of greenrot's own
source*. The cost compounds.

The scoped run above excludes those (`test/frontend`, `test/cli.test.ts`,
`test/analyze-full.test.ts`, `test/analyze-structural.test.ts`) and finishes in
78 seconds.

This is the same scalability limitation the README already states, in its
sharpest form. CI therefore runs `--static` on the whole repo, which enforces
what a fast pass can honestly enforce: **zero structural fakes, and zero CI
gates that cannot go red.**

## What CI now checks

| Job | Enforces |
|---|---|
| `gate` | 0 false FAKE across the python and JS corpora, 31 labelled |
| `selfaudit` | 0 structural fakes in greenrot's own suite, 0 D13 findings |
| `test` | 144 tests, Linux + Windows, Node 22 and 24 |
| `smoke` | the built artifact runs on Node 20 |

# greenrot

**Which of your tests cannot fail?**

Not *"is my coverage weak"* — that question has good answers already. This one:
**this specific test cannot fail, here is the line, here is why.**

```
npx greenrot .
```

Real output, from `npx greenrot test/corpus/python/shapes` in this repository:

```
FAKE  test_shapes.py:6   A1-no-assertion
      test body contains no assertion
FAKE  test_shapes.py:11  A2-tautology
      compares literals to literals
FAKE  test_shapes.py:16  A3-test-constructed-only
      asserts only on values the test constructed; production code never reached
FAKE  test_shapes.py:22  A4-mock-echo
      asserts a mock return value against the constant it was configured with
WEAK  test_shapes.py:28  B7-call-only
      asserts only that a call happened; no value is ever compared
WEAK  test_shapes.py:32  B11-broad-exception
      exception expectation is broad enough to catch an import error
FAKE  test_shapes.py:38  A6-swallowed-assertion
      assertion sits inside a try whose handler swallows AssertionError

5 fake tests found, 2 weak
8 tests: 1 real, 2 weak, 5 fake, 0 unknown
```

Your suite is green. Some of it is green because it is *correct*, and some of it
is green because it is *incapable of being anything else*. Coverage cannot tell
those apart — it reports that a line executed, never that anything was checked.

## The four verdicts

| Verdict | Meaning | How it is established |
|---|---|---|
| **FAKE** | Proven it cannot fail | *Structurally* — no assertion that can ever be false. Or *empirically* — every mutation of the code it runs went undetected. |
| **WEAK** | Can fail, but never for a behavioural reason | Asserts only that a call happened; the unit under test is itself mocked; nothing real executes. |
| **REAL** | Proven honest | We broke the code it covers and it went red. |
| **UNKNOWN** | We could not vouch for it | Parse failure, missing runner, probe timeout, frontend crash — always with a reason code. |

### `UNKNOWN` is the point

Every tool in this category quietly folds "couldn't analyse that one" into the
passing pile. greenrot refuses to. The headline may only say *"no fake tests"*
when **every** test reached a proven state. Otherwise it says exactly what it
does and does not know:

```
no fake tests among the 412 I could vouch for; 8 I could not (3 parse-failure, 5 probe-timeout)
```

A run that analysed **nothing** is not clean either — it reports
*"no tests were analysed"* and exits non-zero, because a mistyped path should
never look like a passing grade.

There is one function in the codebase permitted to phrase a clean claim, and it
has a test proving it can refuse.

## How it works

Two stages, and the staging is the whole trick.

**1. Static triage — seconds, nothing executed.** Every assertion is modelled by
where its value came from: *literal · test-constructed · mock-configured ·
production-derived*. A test asserting only on values it built itself is
structurally incapable of failing. No mutants, no test runs, no cost.

**2. Targeted probe — only on what survives.** For tests that still owe proof:
trace which production lines *that one test* executes, mutate **only those
lines**, re-run **only that test**.

Classic mutation testing costs `mutants × the whole suite`. This costs
`suspect tests × a few mutants × one test`.

## Accuracy

**FAKE is an accusation, so it requires proof**, never suspicion:

- *Structural* FAKE means no assertion in the test can vary.
- *Empirical* FAKE means **total insensitivity** — every mutant in the lines
  that test executes survived. Detect **one** and the verdict is `REAL`.
  Generate none and it is `UNKNOWN`, because absence of a probe is not evidence.

Measured against a hand-labelled corpus of tricky cases — real tests that look
fake, fake tests that look real:

```
corpus       : 15 labelled, 15 compared
agreements   : 15
false FAKE   : 0
false-positive rate: 0.00%
```

A single false FAKE **blocks release**. The gate is in CI, and there is a test
proving the gate can go red.

## Usage

```
npx greenrot [path]

  --static             structural checks only, nothing executed (fast)
  --json               machine-readable
  --sarif              SARIF 2.1.0, renders inline on GitHub pull requests
  --exclude <a,b>      skip path prefixes (a fixtures directory, usually)
  --max-mutants <n>    mutants tried per test (default 12)
  --no-strict-unknown  exit 0 even when some tests could not be checked
```

| Exit | Meaning |
|---|---|
| `0` | provably clean |
| `1` | fake tests found, or a CI gate that cannot go red |
| `2` | could not vouch — some tests were not analysable |

`1` outranks `2`: a proven accusation is more actionable than admitted ignorance.

## The checks

**Structurally fake** — A1 no assertion · A2 tautology · A3 asserts only
test-constructed values · A4 asserts a mock's own configured return · A5
unreachable assertion · A6 assertion swallowed by a bare `except`

**Weak** — B7 call-only · B8 the unit under test is itself mocked · B9
over-mocked, nothing real runs · B11 exception expectation broad enough to catch
the import error

**The coverage lie** — C12 permanently skipped, counted as coverage, executes
nothing

**Gates that cannot go red** — D13 a CI step incapable of a nonzero exit:
`continue-on-error: true`, `|| true`, an exit code swallowed by a pipe. Same
disease as a fake test, one level up.

## Requirements and limits

- **Node >= 20.** Python analysis uses the *target repository's own* interpreter
  and a stdlib-only helper — nothing to `pip install`. Override with
  `$GREENROT_PYTHON`.
- **Python + pytest today.** JavaScript/TypeScript is next; the frontend
  contract is five methods, so a new language is a contribution-sized change.
- **The probe does not scale yet.** On a 449-test suite the static pass is
  ~1.6s; a full probe run is minutes to tens of minutes. Use `--static` in a
  pre-commit hook and the full run in CI. Concurrency is not implemented.
- **Read-only.** Mutants are applied to a scratch copy, never to your working
  tree, never edit-then-revert. Zero network, zero LLM calls, deterministic.
- **Zero runtime dependencies** in the core and the Python frontend.

## Prior art

Others have built versions of this; none shipped. greenrot does not claim the
idea is new — it claims to be the one that works and proves it. Full screen with
links in [PRIOR-ART.md](PRIOR-ART.md).

## License

MIT

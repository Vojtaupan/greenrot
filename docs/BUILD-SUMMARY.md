# greenrot — build summary, 2026-08-29/30

Phases 2–6 of `_system/plans/2026-08-29-greenrot.md`, built attended in one
session. Phase 1 (name + positioning screen) ran earlier the same evening.

## State

| | |
|---|---|
| Tests | **97 passing** |
| Typecheck | clean (`strict`, `noUncheckedIndexedAccess`) |
| False-positive gate | **0 false FAKE on 15 labelled fixtures — 0.00%** |
| Self-audit | clean |
| Runtime dependencies | **zero** |
| Branch | `night/greenrot`, not merged |

Minimum shippable (Phases 1–6) is complete: a working Python tool with a
published accuracy number. Phases 7–10 (JS/TS frontend, MCP + hook, the public
study, npm publish) are not started.

## What the build actually found

Nine defects, most of them in greenrot rather than in the code it was pointed
at. Listed because they are the reason to believe the number above.

1. **A3 was unsound.** The first real dogfood — a 449-test suite — produced 3
   FAKE verdicts and **all 3 were false positives**, all the spy pattern: a
   container created empty in the test, filled by production code through a
   callback, then asserted on. A3 now stands down whenever production code ran.
2. **B8 had its condition backwards.** It fired when a from-import shadowed the
   patch target — precisely the case where `@patch` is a *no-op* and the real
   code runs.
3. **B9 over-mocking was a bad ratio.** `mocks * 2 >= calls` flagged any small
   test with one mock and one genuine call, and counted the `@patch` decorator
   itself as a call. It now means what it says: mocks exist and no production
   code runs.
4. **D13 accused greenrot's own verify script.** The "unconditional exit 0" rule
   flagged an `exit 0` that was the last line after every exit code had already
   been checked. Removed as unsound rather than softened.
5. **The false-positive gate silently did nothing.** Its entry-point guard
   evaluated false on Windows, so it exited 0 without comparing anything — a
   gate that cannot go red, inside the false-positive gate. Fixed structurally
   by splitting the pure scorer into its own module so the script always runs.
6. **An empty run claimed to be clean.** *"no fake tests across 0 tests"* is a
   vacuous truth and is exactly what a mistyped path looks like. Now reports
   "no tests were analysed" and exits 2.
7. **greenrot's own perf test was fake.** It asserted `ms < 8000` and nothing
   else, so an error path returning in 4ms passed it — a textbook B7. It now
   asserts the outcome too.
8. **The probe ran 21× too slow.** Scratch copies in `%TEMP%` cost ~17s per
   mutant (21,483 entries there, and pytest walks up through all of them) versus
   0.79s inside the repo. Worse than the speed: a copy in TEMP runs *without*
   the repo's `conftest.py`, so the verdict came from a run the developer never
   gets.
9. **`WEAK` should be terminal.** Letting the probe refine it was wrong in both
   directions — escalating accused call-only tests (our operators never delete a
   call) and exonerating erased a real signal when a mutant merely crashed.

## Known limitations, stated plainly

- **The probe does not scale.** Static pass on 449 tests: 1.6s. Full probe on
  the same repo: timed out at 10 minutes. `--static` exists because of this.
  Concurrency is not implemented.
- **Python + pytest only.** The frontend contract is five methods; JS/TS is
  Phase 7.
- **The self-audit is thin today.** greenrot's own tests are TypeScript, so its
  Python frontend cannot see them. What the self-audit currently enforces is
  check 13 on our own CI. This closes when the JS frontend lands.
- **`sys.monitoring` is untested here.** This machine is Python 3.11, so every
  run exercised the `settrace` fallback. The 3.12+ path is written and unproven.

## Before publishing

- Re-verify `greenrot` is free on npm — the check was 2026-08-29 and a stale
  registry check is not a check.
- Phase 7 (JS/TS) before the study: the study's headline needs both languages.
- Do not write "nobody has built this" anywhere. See `PRIOR-ART.md`.

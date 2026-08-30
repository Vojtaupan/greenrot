# Dogfood — noterot, 2026-08-30

The spec named this one: *"noterot's tests become the first JS datapoint."* It
is the right second repository — someone else's shape of code, zero-dependency
Node, `node:test`, and built under a "prove the gate can fail" ethic, so a pile
of findings there would have been informative either way.

## Numbers

| | |
|---|---|
| Tests discovered | **486** |
| Static pass runtime | **1.7 s** |
| Findings, first run | 1 FAKE, 4 WEAK |
| Findings, after the fix | **0 FAKE, 4 WEAK** |
| False positives | **1 of 5** |
| True positives | **4 of 5** |

## The false positive: a test can assert BY THROWING

```js
test('the scrub gate passes on a clean tree', () => {
  execFileSync('sh', ['scripts/scrub-check.sh'], { cwd: REPO, stdio: 'pipe' })
})
```

greenrot called this `A1-no-assertion` — *"nothing is ever checked"*. That is
wrong. `execFileSync` **throws** on a non-zero exit, so this test fails the
moment the scrub gate fails. It checks a great deal; it just does not spell the
check as an `assert`.

The idiom is common in Node: `execFileSync`, `JSON.parse`, any call that throws
on bad input. A1 now stands down whenever the test runs production code at all,
and emits a probe obligation instead — the same guard A3 already had, for the
same reason.

Preserved as a permanent fixture:
`test/corpus/js/tricky/looks-fake-but-real.test.js::asserts by throwing`.

## The four true positives, all the same shape

```js
test('the guard throws when a real kind is missing from precedence', () => {
  assert.throws(() => assertPrecedenceCoversAllDeadlineKinds(['due', 'scheduled'], DEADLINE_KINDS))
})
```

`assert.throws(fn)` with no error matcher accepts **any** throw. If the imported
function were renamed or its import broke, a `ReferenceError` is still a throw
and the test stays green. That is exactly the smell B11 exists for, and WEAK —
a quality signal, not an accusation — is the right verdict.

Four occurrences: `test/decay.test.js:344`, `test/decay.test.js:348`,
`test/init.test.js:435`, `test/scrub.test.js:14`.

Cheap fix, if the maintainer wants it: give the matcher a shape, e.g.
`assert.throws(fn, /precedence/)`.

## What this run says about the tool

**486 tests in 1.7 seconds, 1 false positive, and the false positive taught us
something general.** The static pass alone is fast enough for a pre-commit hook
on a real repository.

482 tests came back `UNKNOWN` from the static pass, which is correct and is the
point — a structural pass vouches for very little, and greenrot says so rather
than reporting a clean bill of health it did not earn.

The full probe was not run here: at roughly a second per test it is minutes, and
the README already states that limitation. It is the obvious next piece of work.

Nothing from noterot's source is reproduced beyond the snippets above, which are
from a public repository under the same author.

# Prior art

Screened before any code was written, at the mechanism level, on GitHub **and**
npm. Written down because overstating novelty is a bigger risk to a tool like
this than any competitor is.

## Others have built this. None of them shipped.

**[kamalbuilds/canfail](https://github.com/kamalbuilds/canfail)** — the closest
thing that exists. *"Prove your tests can actually fail. Finds checks that are
green because they cannot go red: vacuous tests, surviving mutants, reachable
mocks, and failures reported as success."* That is substantially greenrot's
design, and it is a real implementation — ~121 KB of TypeScript, 28 unit tests
plus 12 CLI integration tests, four detectors, a mutation probe, fixtures, its
own prior-art file. Built 2026-08-23 in a single day as a hackathon submission,
untouched since, never published to a registry.

**[adindamochamad/GreenLie](https://github.com/adindamochamad/GreenLie)** —
*"Test integrity guard: catches when AI agents weaken tests to pass CI."*
Explicitly a hackathon entry; last touched 2026-08-14.

**[phoenix-assistant/test-mutant](https://github.com/phoenix-assistant/test-mutant)**
— *"CI gate that catches tautological AI-generated tests."* One commit.

**[andrehora/agent-mock-detection](https://github.com/andrehora/agent-mock-detection)**
— not a tool: the analysis scripts for the peer-reviewed MSR paper *"Are Coding
Agents Generating Over-Mocked Tests? An Empirical Study."* The problem is
measured and real. Check B9 exists because of it.

## Mutation testing is a mature category, and greenrot is not competing with it

[Stryker](https://github.com/stryker-mutator/stryker-js) (JS/TS),
[infection](https://github.com/infection/infection) (PHP),
[mutant](https://github.com/mbj/mutant) (Ruby),
[pitest](https://github.com/hcoles/pitest) (JVM),
[mutmut](https://pypi.org/project/mutmut/) (Python). `mutant`'s tagline is
already *"AI writes your code. AI writes your tests. But who tests the tests?"* —
the category has noticed the framing.

Mutation testing has had fifteen years and thousands of stars and is still run
by almost nobody, for two reasons greenrot attacks directly:

- **Cost.** Classic mutation testing is `mutants × the whole suite`. greenrot is
  `suspect tests × a few mutants × one test`, because static triage settles most
  cases without executing anything.
- **The answer.** Mutation testing tells you coverage is weak. greenrot tells you
  *this specific test cannot fail, here is the line, and here is the named
  reason* — `A4-mock-echo`, not `mutant survived at line 42`.

greenrot is the triage layer above mutation testing, not a replacement for it.
If you want an exhaustive mutation score, use Stryker or mutmut.

## What greenrot claims

Not *"nobody built this"* — that is false, and the repository above proves it.

What is true, and what this project is actually betting on:

1. **Nobody shipped one.** All four repositories above are unpublished and
   inactive. There is no `npx` for any of them.
2. **Nobody proved one accurate.** greenrot publishes its measured
   false-positive rate against a labelled corpus, and a single false accusation
   blocks release. No tool in this space publishes that number.
3. **`UNKNOWN` is a first-class verdict.** Every other tool in this category
   folds "could not analyse" into the passing pile.

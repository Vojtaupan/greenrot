import type { Evidence } from './evidence.ts';

/**
 * Check 13 - a CI step that cannot produce a nonzero exit.
 *
 * The same disease as a test that cannot fail, one level up: the pipeline
 * claims to be checking something and structurally cannot report a problem.
 * It is in scope because it has already cost real time - a CRLF line-ending on
 * a shell script silently killed a scrub gate while every run stayed green.
 *
 * Line-based on purpose. A YAML parser would be a dependency, and every
 * pattern that matters here is lexical.
 */
export function auditWorkflow(file: string, source: string): Evidence[] {
  const out: Evidence[] = [];
  const add = (line: number, detail: string) =>
    out.push({ kind: 'structural', check: 'D13-ci-gate-cannot-fail', file, line, detail });

  source.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const text = raw.trim();

    // A comment discussing a pattern is not the pattern.
    if (text.startsWith('#')) return;

    if (/^continue-on-error:\s*true\b/.test(text)) {
      add(line, 'continue-on-error: true - this step can never fail the job');
      return;
    }
    if (/\|\|\s*true\b/.test(text)) {
      add(line, '|| true discards the command exit code');
      return;
    }
    if (/\|\s*(tail|head|tee|cat|less|more)\b/.test(text)) {
      add(line, 'the exit code of a pipe is its LAST command, so a failure upstream is invisible');
    }

    // There is deliberately NO "unconditional exit 0" rule.
    //
    // It was here, and greenrot's first self-audit caught it accusing
    // greenrot's own verify script - where `exit 0` is the LAST line, reached
    // only after every command's exit code has already been checked. That is
    // correct and idiomatic, and flagging it was a false positive.
    //
    // "This script's status cannot reflect a failure" is not a lexical
    // question. Constraint 5 says an accusation needs proof, so an unsound
    // check is removed rather than softened.
  });

  return out;
}

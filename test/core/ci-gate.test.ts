import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditWorkflow } from '../../src/core/ci-gate.ts';

test('continue-on-error makes a step incapable of failing the job', () => {
  const f = auditWorkflow('w.yml',
    'jobs:\n  a:\n    steps:\n      - run: npm test\n        continue-on-error: true\n');
  assert.equal(f.length, 1);
  assert.equal(f[0]!.check, 'D13-ci-gate-cannot-fail');
  assert.equal(f[0]!.line, 5);
});

test('|| true masks the exit code', () => {
  const f = auditWorkflow('w.yml', 'jobs:\n  a:\n    steps:\n      - run: npm test || true\n');
  assert.equal(f.length, 1);
  assert.match(f[0]!.detail, /exit code/i);
});

test('piping to tail discards the exit code of the command that matters', () => {
  const f = auditWorkflow('w.yml', 'jobs:\n  a:\n    steps:\n      - run: npm test | tail -5\n');
  assert.equal(f.length, 1);
  assert.match(f[0]!.detail, /pipe/i);
});

// Regression: this rule existed, and greenrot's first self-audit caught it
// accusing greenrot's own verify script, where `exit 0` is the final line after
// every exit code has already been checked. Removed as unsound, not softened.
test('a trailing exit 0 after real checks is NOT flagged', () => {
  const script = [
    'npm test',
    'if ($LASTEXITCODE -ne 0) { exit 1 }',
    'exit 0',
  ].join('\n');
  assert.equal(auditWorkflow('verify.ps1', script).length, 0);
});

test('an honest step produces no finding', () => {
  assert.equal(
    auditWorkflow('w.yml', 'jobs:\n  a:\n    steps:\n      - run: npm test\n').length,
    0,
  );
});

test('a comment mentioning || true is not a finding', () => {
  assert.equal(auditWorkflow('w.yml', '      # never use || true here\n').length, 0);
});

test('every finding cites path:line', () => {
  const f = auditWorkflow('.github/workflows/ci.yml', 'a\nb\n      - run: x || true\n');
  assert.equal(f[0]!.file, '.github/workflows/ci.yml');
  assert.equal(f[0]!.line, 3);
});

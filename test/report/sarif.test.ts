import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderSarif } from '../../src/core/report/sarif.ts';
import type { Verdict } from '../../src/core/verdict.ts';

const fake: Verdict = {
  name: 'FAKE', reason: 'nothing is checked',
  evidence: [{
    kind: 'structural', check: 'A1-no-assertion',
    file: 'tests/test_a.py', line: 12, detail: 'no assertion',
  }],
};

test('emits SARIF 2.1.0 with one result anchored at path:line', () => {
  const s = JSON.parse(renderSarif(new Map([['tests/test_a.py::t', fake]])));
  assert.equal(s.version, '2.1.0');
  const run = s.runs[0];
  assert.equal(run.tool.driver.name, 'greenrot');
  const loc = run.results[0].locations[0].physicalLocation;
  assert.equal(loc.artifactLocation.uri, 'tests/test_a.py');
  assert.equal(loc.region.startLine, 12);
  assert.equal(run.results[0].level, 'error');
});

test('WEAK is a warning, never an error - only proven fakes are errors', () => {
  const weak: Verdict = {
    name: 'WEAK', reason: 'call only',
    evidence: [{ kind: 'structural', check: 'B7-call-only', file: 'a.py', line: 3, detail: 'x' }],
  };
  const s = JSON.parse(renderSarif(new Map([['a', weak]])));
  assert.equal(s.runs[0].results[0].level, 'warning');
});

test('REAL tests produce no SARIF result', () => {
  const s = JSON.parse(renderSarif(
    new Map<string, Verdict>([['a', { name: 'REAL', reason: 'x', evidence: [] }]]),
  ));
  assert.equal(s.runs[0].results.length, 0);
});

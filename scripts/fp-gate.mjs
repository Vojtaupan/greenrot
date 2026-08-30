// The publish gate. Always runs when executed; imports nothing that runs.
//
// There is deliberately NO "was I invoked directly?" guard here. The first
// version had one, it silently evaluated false on Windows, and the gate exited
// 0 without comparing anything - a gate that cannot go red, which is check D13,
// inside the false-positive gate itself. The structural fix is to give this
// script exactly one job and put the importable part in fp-measure.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { measure } from './fp-measure.mjs';

const ROOTS = ['simple', 'shapes', 'tricky'];

const { analyze } = await import('../dist/analyze.js');
const { PythonFrontend } = await import('../dist/frontend/python/index.js');

const labels = JSON.parse(
  readFileSync(new URL('../test/corpus/labels.json', import.meta.url), 'utf8'),
);

const actual = {};
for (const name of ROOTS) {
  const root = fileURLToPath(new URL(`../test/corpus/python/${name}/`, import.meta.url));
  const r = await analyze(root, [new PythonFrontend()], { maxMutants: 6 });
  for (const [id, v] of r.verdicts) actual[`python/${name}/${id}`] = v.name;
}

const m = measure(labels, actual);

console.log(`corpus       : ${m.total} labelled, ${m.compared} compared`);
console.log(`agreements   : ${m.agreements}`);
console.log(`false FAKE   : ${m.falseFake}   <- blocks release`);
console.log(`missed FAKE  : ${m.falseClean}   <- tracked, does not block`);
console.log(`false-positive rate: ${(m.fpRate * 100).toFixed(2)}%`);

// A gate that compares nothing cannot go red. This guards the silent failure
// where an id-prefix mismatch yields zero comparisons and a green run.
if (m.compared === 0) {
  console.error('');
  console.error('GATE ERROR: nothing was compared - label ids do not match analyser output.');
  process.exit(1);
}

if (m.falseFake > 0) {
  console.error('');
  console.error('FALSE POSITIVES:');
  for (const [id, expected] of Object.entries(labels)) {
    if (id.startsWith('_')) continue;
    if (actual[id] === 'FAKE' && expected !== 'FAKE') {
      console.error(`  ${id}`);
      console.error(`    labelled ${expected}, greenrot said FAKE`);
    }
  }
  process.exit(1);
}

if (m.falseClean > 0) {
  console.log('');
  console.log('misses (tracked, not blocking):');
  for (const [id, expected] of Object.entries(labels)) {
    if (id.startsWith('_')) continue;
    if (expected === 'FAKE' && actual[id] && actual[id] !== 'FAKE') {
      console.log(`  ${id}`);
      console.log(`    labelled FAKE, greenrot said ${actual[id]}`);
    }
  }
}

console.log('');
console.log('gate: PASS');

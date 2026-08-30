// Pure scoring, no side effects, safe to import from tests.
//
// A false FAKE is calling a REAL/WEAK test fake - an accusation, and it blocks
// release. A miss is calling a FAKE test real - incomplete, tracked, allowed.
// UNKNOWN is never counted against us: admitting we could not vouch for a test
// is the one answer that is never wrong.
export function measure(labels, actual) {
  let falseFake = 0;
  let falseClean = 0;
  let agreements = 0;
  let compared = 0;

  const labelled = Object.entries(labels).filter(([k]) => !k.startsWith('_'));

  for (const [id, expected] of labelled) {
    const got = actual[id];
    // A missing or UNKNOWN result is not a false positive. Admitting we could
    // not vouch for a test is the one answer that is never wrong.
    if (got === undefined || got === 'UNKNOWN') continue;
    compared++;
    if (got === expected) { agreements++; continue; }
    if (got === 'FAKE' && expected !== 'FAKE') falseFake++;
    else if (expected === 'FAKE' && got !== 'FAKE') falseClean++;
  }

  return {
    falseFake,
    falseClean,
    agreements,
    compared,
    total: labelled.length,
    fpRate: compared ? falseFake / compared : 0,
  };
}

import type { Evidence } from '../evidence.ts';
import type { Verdict } from '../verdict.ts';

/**
 * SARIF 2.1.0, so GitHub code scanning renders findings inline on a pull
 * request. Only proven FAKE verdicts are `error`; WEAK is `warning`, because
 * an accusation and a suspicion should not look the same to a reviewer.
 */
export function renderSarif(
  verdicts: ReadonlyMap<string, Verdict>,
  ciFindings: readonly Evidence[] = [],
): string {
  const results = [];
  const ruleIds = new Set<string>();

  for (const [id, v] of verdicts) {
    if (v.name === 'REAL') continue;
    const e = v.evidence[0];
    if (!e) continue;
    ruleIds.add(e.check);
    results.push({
      ruleId: e.check,
      level: v.name === 'FAKE' ? 'error' : 'warning',
      message: { text: `${id}: ${e.detail}` },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: e.file },
          region: { startLine: e.line },
        },
      }],
    });
  }

  for (const e of ciFindings) {
    ruleIds.add(e.check);
    results.push({
      ruleId: e.check,
      level: 'error',
      message: { text: e.detail },
      locations: [{
        physicalLocation: {
          artifactLocation: { uri: e.file },
          region: { startLine: e.line },
        },
      }],
    });
  }

  return JSON.stringify({
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'greenrot',
          informationUri: 'https://github.com/Vojtaupan/greenrot',
          rules: [...ruleIds].map(id => ({ id })),
        },
      },
      results,
    }],
  }, null, 2);
}

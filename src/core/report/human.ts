import { formatLocation } from '../evidence.ts';
import { headline, tally } from '../honesty.ts';
import type { UnknownReason, Verdict } from '../verdict.ts';

export interface HumanOptions {
  readonly color: boolean;
}

const paint = (on: boolean, code: string, s: string) =>
  (on ? `[${code}m${s}[0m` : s);

/**
 * The human report. Every line it prints about cleanliness comes from
 * `headline`, never from a local judgement - so there is exactly one place in
 * the codebase that can phrase a clean claim.
 */
export function renderHuman(
  verdicts: ReadonlyMap<string, Verdict>,
  reasons: ReadonlyMap<UnknownReason, number>,
  opts: HumanOptions,
): string {
  const lines: string[] = [];
  const t = tally([...verdicts.values()]);
  const h = headline(t, reasons);

  for (const [id, v] of verdicts) {
    if (v.name === 'REAL') continue;
    const tag =
      v.name === 'FAKE' ? paint(opts.color, '31', 'FAKE')
      : v.name === 'WEAK' ? paint(opts.color, '33', 'WEAK')
      : paint(opts.color, '90', 'UNKNOWN');
    const first = v.evidence[0];
    const loc = first ? formatLocation(first) : id;
    const check = first?.check ?? v.code ?? '';
    lines.push(`${tag}  ${loc}  ${check}`);
    lines.push(`      ${first?.detail ?? v.reason}`);
  }

  if (lines.length > 0) lines.push('');
  lines.push(h.canClaimClean
    ? paint(opts.color, '32', h.text)
    : paint(opts.color, '31', h.text));
  lines.push(
    `${t.total} tests: ${t.real} real, ${t.weak} weak, ${t.fake} fake, ${t.unknown} unknown`,
  );
  return lines.join('\n');
}

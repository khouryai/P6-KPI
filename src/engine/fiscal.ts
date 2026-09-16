/**
 * Fiscal years.
 *
 * A programme is funded and reported by fiscal year, and a table of forty months
 * cannot answer "how did FY27 go" without somebody adding up rows by hand. The
 * arithmetic is trivial; the part worth writing down is the convention, because
 * getting it silently wrong shifts every figure by twelve months.
 *
 * The year is named for the calendar year it ENDS in, which is the US federal and
 * transit convention: with a July start, July 2026 through June 2027 is FY2027.
 * A start month of January makes a fiscal year a calendar year, and the labels say
 * so rather than pretending otherwise.
 */
import type { BurnRow } from './types';

/** The default start. July is the usual transit-agency fiscal year. */
export const DEFAULT_FY_START_MONTH = 7;

export function fyStart(startMonth: number | undefined): number {
  const n = Math.trunc(Number(startMonth));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : DEFAULT_FY_START_MONTH;
}

/** Which fiscal year a `YYYY-MM` month belongs to, named by the year it ends in. */
export function fiscalYearOf(month: string, startMonth: number): number {
  const [y, m] = month.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return NaN;
  const start = fyStart(startMonth);
  // A January start means the fiscal year IS the calendar year; anything later
  // means months from the start onwards belong to the year that follows.
  if (start === 1) return y;
  return m >= start ? y + 1 : y;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The first and last `YYYY-MM` of a fiscal year. */
export function fiscalYearRange(fy: number, startMonth: number): { from: string; to: string } {
  const start = fyStart(startMonth);
  const startYear = start === 1 ? fy : fy - 1;
  const endMonth = start === 1 ? 12 : start - 1;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { from: `${startYear}-${pad(start)}`, to: `${fy}-${pad(endMonth)}` };
}

export function fiscalYearLabel(fy: number, startMonth: number): string {
  const start = fyStart(startMonth);
  if (start === 1) return String(fy);
  return `FY${String(fy).slice(2)}`;
}

/** "Jul 25 – Jun 26", for the label to explain itself without a legend. */
export function fiscalYearSpan(fy: number, startMonth: number): string {
  const { from, to } = fiscalYearRange(fy, startMonth);
  const part = (m: string) => `${MONTH_NAMES[Number(m.split('-')[1]) - 1]} ${m.slice(2, 4)}`;
  return `${part(from)} – ${part(to)}`;
}

export type FiscalYear = {
  fy: number;
  label: string;
  span: string;
  from: string;
  to: string;
  months: BurnRow[];
  /** Earned and built INSIDE the year, not cumulative. */
  earned: number;
  built: number;
  variance: number;
  /** Earned per hour built across the year. null when nothing was built in it. */
  factor: number | null;
  /** Where the cumulative figures stood at the end of the year. */
  cumEarned: number;
  cumBuilt: number;
};

/**
 * Group monthly rows into fiscal years.
 *
 * The in-year figures are summed from the months, and the cumulative figures are
 * taken from the LAST month of the year rather than summed — they are already
 * running totals, and adding them together would produce a number that means
 * nothing at all.
 */
export function groupByFiscalYear(months: BurnRow[], startMonth: number): FiscalYear[] {
  const start = fyStart(startMonth);
  const buckets = new Map<number, BurnRow[]>();
  for (const m of months) {
    const fy = fiscalYearOf(m.month, start);
    if (!Number.isFinite(fy)) continue;
    const list = buckets.get(fy);
    if (list) list.push(m);
    else buckets.set(fy, [m]);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([fy, list]) => {
      const ordered = [...list].sort((a, b) => a.month.localeCompare(b.month));
      const earned = ordered.reduce((s, m) => s + m.earned, 0);
      const built = ordered.reduce((s, m) => s + m.built, 0);
      const lastMonth = ordered[ordered.length - 1];
      const range = fiscalYearRange(fy, start);
      return {
        fy,
        label: fiscalYearLabel(fy, start),
        span: fiscalYearSpan(fy, start),
        from: range.from,
        to: range.to,
        months: ordered,
        earned,
        built,
        variance: earned - built,
        factor: built > 0 ? earned / built : null,
        cumEarned: lastMonth?.cumEarned ?? 0,
        cumBuilt: lastMonth?.cumBuilt ?? 0,
      };
    });
}

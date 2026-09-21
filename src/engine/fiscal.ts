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
import type { BurnRow, ForecastRow } from './types';

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

/** One resource's year: what it earned, what it actually spent, and the gap. */
export type ResourceYear = {
  code: string;
  label: string;
  earned: number;
  built: number;
  variance: number;
  factor: number | null;
  /** Share of everything earned in the year, so the big contributors stand out. */
  shareOfEarned: number;
};

/**
 * Roll the per-resource cells of a set of months into one row per resource.
 *
 * Deliberately NOT a forecast. To-complete and at-completion divide the whole
 * remaining budget by a rate, and a remaining budget is not a thing a single
 * fiscal year has — quoting one per year would be inventing a number. What a year
 * does have is what each resource earned in it, what it spent, and the ratio.
 */
export function resourcesInYear(months: BurnRow[]): ResourceYear[] {
  const acc = new Map<string, { label: string; earned: number; built: number }>();
  for (const m of months) {
    for (const c of m.bySubsystem) {
      const prev = acc.get(c.code) ?? { label: c.label, earned: 0, built: 0 };
      prev.earned += c.earned;
      prev.built += c.built;
      if (c.label) prev.label = c.label;
      acc.set(c.code, prev);
    }
  }
  const totalEarned = [...acc.values()].reduce((s, v) => s + v.earned, 0);
  return [...acc.entries()]
    .map(([code, v]) => ({
      code,
      label: v.label,
      earned: v.earned,
      built: v.built,
      variance: v.earned - v.built,
      factor: v.built > 0 ? v.earned / v.built : null,
      shareOfEarned: totalEarned ? v.earned / totalEarned : 0,
    }))
    .filter((r) => Math.abs(r.earned) > 1e-9 || Math.abs(r.built) > 1e-9)
    .sort((a, b) => b.earned - a.earned || b.built - a.built);
}

/** One resource in one month: the cell a "by group, by month" grid is made of. */
export type ResourceMonth = {
  month: string;
  earned: number;
  built: number;
  variance: number;
  factor: number | null;
};

/**
 * Every month a resource appears in, in order.
 *
 * The monthly rows are keyed by month and hold a cell per resource; reading them
 * the other way round — a resource holding its months — is what lets one group's
 * run of months be read as a story rather than hunted for down forty rows. The
 * months handed in decide the span, so passing one fiscal year's months gives that
 * year's detail and passing them all gives the whole project's.
 */
export function monthsForResource(months: BurnRow[], code: string): ResourceMonth[] {
  const out: ResourceMonth[] = [];
  for (const m of months) {
    const cell = m.bySubsystem.find((c) => c.code === code);
    if (!cell) continue;
    if (Math.abs(cell.earned) < 1e-9 && Math.abs(cell.built) < 1e-9) continue;
    out.push({ month: m.month, earned: cell.earned, built: cell.built, variance: cell.variance, factor: cell.factor });
  }
  return out.sort((a, b) => a.month.localeCompare(b.month));
}

/** Every resource that appears anywhere in the months handed in, biggest earner first. */
export function resourceCodes(months: BurnRow[]): { code: string; label: string }[] {
  const acc = new Map<string, { label: string; weight: number }>();
  for (const m of months) {
    for (const c of m.bySubsystem) {
      const prev = acc.get(c.code) ?? { label: c.label, weight: 0 };
      prev.weight += Math.abs(c.earned) + Math.abs(c.built);
      if (c.label) prev.label = c.label;
      acc.set(c.code, prev);
    }
  }
  return [...acc.entries()]
    .sort((a, b) => b[1].weight - a[1].weight || a[0].localeCompare(b[0]))
    .map(([code, v]) => ({ code, label: v.label }));
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

/** One resource inside one fiscal year, with the months that made it up. */
export type ResourceYearDetail = ResourceYear & { months: ResourceMonth[] };

/** A fiscal year with its groups broken out, each carrying its own months. */
export type FiscalYearDetail = FiscalYear & { resources: ResourceYearDetail[] };

/**
 * The whole by-group-by-year picture in one pass.
 *
 * The screen and the workbook both need it, and deriving it twice is how the two
 * drift apart: a spreadsheet that disagreed with the screen it was exported from
 * would be worse than no spreadsheet. So it is computed here once and both read it.
 */
export function fiscalYearDetail(months: BurnRow[], startMonth: number): FiscalYearDetail[] {
  return groupByFiscalYear(months, startMonth).map((y) => ({
    ...y,
    resources: resourcesInYear(y.months).map((r) => ({ ...r, months: monthsForResource(y.months, r.code) })),
  }));
}

// ---------------------------------------------------------------------------
// The years that have not happened yet
// ---------------------------------------------------------------------------

/** One group's share of one future month. */
export type ForecastResourceMonth = { month: string; earned: number; built: number | null };

/** One group inside one future fiscal year, with the months behind the figures. */
export type ForecastYearResource = {
  code: string;
  label: string;
  /** Budget still to earn in this year on this group. */
  earned: number;
  /** What earning it costs at the rate this group has achieved. null = no rate yet. */
  built: number | null;
  /** Cost minus value: how much more than budget this year is forecast to take. */
  variance: number | null;
  /** This group as a share of everything the year has left to earn. */
  shareOfEarned: number;
  months: ForecastResourceMonth[];
};

/** A fiscal year still ahead, broken out by group. */
export type ForecastYear = {
  fy: number;
  label: string;
  span: string;
  from: string;
  to: string;
  months: ForecastRow[];
  earned: number;
  built: number | null;
  variance: number | null;
  resources: ForecastYearResource[];
};

/**
 * Group the work still to come into fiscal years, each broken down by resource.
 *
 * The mirror image of `fiscalYearDetail`, and deliberately a separate type rather
 * than the same one with a flag. A past year reports what happened: earned against
 * built, both measured, with a factor between them. A future year reports what the
 * schedule intends and what that will cost at the rate achieved so far — the first
 * is a fact, the second is arithmetic on an assumption, and a table that let them
 * share a column would be inviting somebody to read one as the other.
 *
 * There is no cumulative column here for the same reason: a running total that
 * crosses from measured into projected is a number with two meanings.
 */
export function forecastYears(months: ForecastRow[], startMonth: number): ForecastYear[] {
  const start = fyStart(startMonth);
  const buckets = new Map<number, ForecastRow[]>();
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
      const range = fiscalYearRange(fy, start);

      const acc = new Map<string, { label: string; earned: number; built: number | null; months: ForecastResourceMonth[] }>();
      for (const m of ordered) {
        for (const c of m.bySubsystem) {
          const prev = acc.get(c.code) ?? { label: c.label, earned: 0, built: null, months: [] };
          prev.earned += c.earned;
          // A group with no rate in any month keeps a null total; one with a rate in
          // some of them totals only the months it could cost, which is the honest
          // sum rather than a zero standing in for "unknown".
          if (c.built !== null) prev.built = (prev.built ?? 0) + c.built;
          if (c.label) prev.label = c.label;
          prev.months.push({ month: m.month, earned: c.earned, built: c.built });
          acc.set(c.code, prev);
        }
      }

      const earned = ordered.reduce((s, m) => s + m.earned, 0);
      const costed = ordered.filter((m) => m.built !== null);
      const built = costed.length ? costed.reduce((s, m) => s + (m.built ?? 0), 0) : null;
      const resources: ForecastYearResource[] = [...acc.entries()]
        .map(([code, v]) => ({
          code,
          label: v.label,
          earned: v.earned,
          built: v.built,
          variance: v.built === null ? null : v.earned - v.built,
          shareOfEarned: earned ? v.earned / earned : 0,
          months: v.months.sort((a, b) => a.month.localeCompare(b.month)),
        }))
        .filter((r) => Math.abs(r.earned) > 1e-9)
        .sort((a, b) => b.earned - a.earned || a.label.localeCompare(b.label));

      return {
        fy,
        label: fiscalYearLabel(fy, start),
        span: fiscalYearSpan(fy, start),
        from: range.from,
        to: range.to,
        months: ordered,
        earned,
        built,
        variance: built === null ? null : earned - built,
        resources,
      };
    });
}

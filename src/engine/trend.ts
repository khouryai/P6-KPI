/**
 * Which way the job is moving.
 *
 * Every other figure in the application reports a position: where the curve is,
 * what the factor is, how much is left. None of them says whether last month was
 * better than the one before, and that is the only thing that tells you whether a
 * recovery plan is working.
 *
 * The series here are read off the monthly earned-against-built rows, which are
 * already history — no new data is keyed, and nothing has to be snapshotted for it
 * to exist. A month that has not happened yet is not in it.
 */
import type { BurnRow } from './types';

export type TrendPoint = {
  month: string;
  /** Earned in the month. */
  earned: number;
  /** Built in the month. */
  built: number;
  /** Earned per hour built, this month alone. null where nothing was built. */
  factor: number | null;
  /** Earned per hour built over the whole job to this month. */
  cumFactor: number | null;
  /** How complete the job was at the end of the month. */
  pctComplete: number;
  /** Percentage points added in the month. */
  pctGained: number;
};

export type Trend = {
  points: TrendPoint[];
  /** The last month with anything in it, which is what "now" means here. */
  latest: TrendPoint | null;
  /**
   * The mean monthly factor over the last `window` active months, and over the
   * `window` before those. Two numbers rather than a slope, because a slope through
   * six noisy points invites more confidence than six noisy points deserve.
   */
  recentFactor: number | null;
  priorFactor: number | null;
  /** Percentage points a month, averaged over the recent window. */
  recentPctPerMonth: number | null;
  priorPctPerMonth: number | null;
  /**
   * Months to finish at the recent rate, from the last month. null when the rate is
   * zero or negative, because dividing by it would produce a date rather than an
   * admission that nothing is moving.
   */
  monthsToFinish: number | null;
  /** How many months each window covers, after quiet months are dropped. */
  window: number;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Read the trend off the monthly rows.
 *
 * Months where nothing was earned and nothing was built are dropped before the
 * windows are taken. A programme with a quiet December would otherwise report a
 * collapsing rate every January, which is an artefact of the calendar rather than
 * anything about the work.
 */
export function trendFrom(months: BurnRow[], budgetHours: number, window = 3): Trend {
  const active = months.filter((m) => Math.abs(m.earned) > 1e-9 || Math.abs(m.built) > 1e-9);

  let prevPct = 0;
  const points: TrendPoint[] = active.map((m) => {
    const pctComplete = budgetHours ? m.cumEarned / budgetHours : 0;
    const point: TrendPoint = {
      month: m.month,
      earned: m.earned,
      built: m.built,
      factor: m.factor,
      cumFactor: m.cumBuilt > 0 ? m.cumEarned / m.cumBuilt : null,
      pctComplete,
      pctGained: pctComplete - prevPct,
    };
    prevPct = pctComplete;
    return point;
  });

  const recent = points.slice(-window);
  const prior = points.slice(-window * 2, -window);
  const factors = (ps: TrendPoint[]) => ps.map((p) => p.factor).filter((f): f is number => f !== null);

  const recentPctPerMonth = mean(recent.map((p) => p.pctGained));
  const latest = points[points.length - 1] ?? null;
  const left = latest ? 1 - latest.pctComplete : 1;
  const monthsToFinish = recentPctPerMonth && recentPctPerMonth > 1e-6 ? left / recentPctPerMonth : null;

  return {
    points,
    latest,
    recentFactor: mean(factors(recent)),
    priorFactor: mean(factors(prior)),
    recentPctPerMonth,
    priorPctPerMonth: mean(prior.map((p) => p.pctGained)),
    monthsToFinish,
    window: recent.length,
  };
}

/** Which way a pair of window figures points, for a screen to say so in a word. */
export function direction(recent: number | null, prior: number | null, tolerance = 0.02): 'better' | 'worse' | 'flat' | 'unknown' {
  if (recent === null || prior === null) return 'unknown';
  const diff = recent - prior;
  if (Math.abs(diff) <= tolerance) return 'flat';
  return diff > 0 ? 'better' : 'worse';
}

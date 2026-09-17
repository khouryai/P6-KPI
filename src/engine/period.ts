/**
 * What was planned, and what actually happened, over one window of dates.
 *
 * The S-curve answers "where is the job" across years. This answers the question
 * asked at every fortnightly review instead: in the last two weeks, what was the
 * plan, what got done, and what did not. Those are different questions and the
 * second one is not readable off the first — a curve that is 3% short says nothing
 * about *which* activities slipped.
 *
 * Hours over a window are measured exactly as the curve measures them: the accrued
 * fraction at the end of the window minus the fraction at the start. Reusing
 * `accruedFraction` is the point — a fortnight's planned hours summed across every
 * fortnight has to come back to the same total the S-curve draws, or the two
 * screens would quietly disagree.
 */
import type { BudgetRow } from './types';
import { accruedFraction } from './curves';
import { isoToMs, msToISO, isValidISO } from './dates';

/** A day, in milliseconds. Windows are whole calendar days, inclusive at both ends. */
const DAY = 86_400_000;

/**
 * What became of one activity across the window.
 *
 * The order matters: these are tested in sequence and the first that fits wins, so
 * COMPLETED beats STARTED for an activity that both started and finished inside the
 * same fortnight, and MISSED beats NOT STARTED for one that was due to do both.
 */
export type PeriodOutcome =
  /** Reached 100%, and its earn window ended inside the period. */
  | 'COMPLETED'
  /** Began inside the period and is still running. */
  | 'STARTED'
  /** Began earlier, still running, and earned hours inside the period. */
  | 'CONTINUED'
  /** The baseline had it finishing inside the period. It did not finish. */
  | 'MISSED'
  /** The baseline had it starting inside the period. It never started. */
  | 'NOT STARTED';

export type PeriodActivity = {
  activityId: string;
  activityName: string;
  location: string;
  /** The raw phase key, e.g. "P2". Joins this row to its phase's figures. */
  phase: string;
  phaseName: string;
  outcome: PeriodOutcome;
  /** Budget hours the baseline said would accrue inside the window. */
  plannedHours: number;
  /** Budget hours actually earned inside the window. */
  earnedHours: number;
  /** The whole activity's budget, for context on a row that only part-accrued. */
  budgetHours: number;
  pctComplete: number;
  baselineStart: string | null;
  baselineFinish: string | null;
  actualStart: string | null;
  actualFinish: string | null;
  /** Calendar days between the baseline finish and the actual one. Negative is early. */
  finishVarianceDays: number | null;
  testsTotal: number | null;
  testsComplete: number | null;
};

/**
 * The same log, for one phase of the job.
 *
 * "97% of plan" across a program says nothing about whether the phase somebody is
 * actually running had a good fortnight: one phase finishing early routinely hides
 * another stalling. Every figure here is measured exactly as the project-wide one
 * is, over the same window, against that phase's own budget — so a phase's
 * achievement is answerable on its own terms rather than as a share of the whole.
 */
export type PeriodPhase = {
  /** The raw phase key, e.g. "P2". '' when the Activity ID carries no phase. */
  key: string;
  label: string;
  /** In-budget activities in this phase, whether or not they moved in the window. */
  activities: number;
  /** The phase's whole budget, which its percent complete is taken against. */
  budgetHours: number;
  plannedHours: number;
  earnedHours: number;
  /** Earned ÷ planned for this phase. null when the phase planned nothing. */
  achievement: number | null;
  /** The phase's own percent complete at each end of the window. */
  pctAtStart: number;
  pctAtEnd: number;
  /** Activities of this phase appearing in the log, by outcome. */
  counts: Record<PeriodOutcome, number>;
};

/** One slice of the window, for the chart. A fortnight splits into two weeks. */
export type PeriodSlice = { from: string; to: string; label: string; planned: number; earned: number };

export type PeriodLog = {
  from: string;
  to: string;
  days: number;
  /** Hours the baseline expected to accrue in the window. */
  plannedHours: number;
  /** Hours actually earned in the window. */
  earnedHours: number;
  /** Earned ÷ planned. null when nothing was planned, which is not 0%. */
  achievement: number | null;
  /** Earned hours in the window as a share of the whole project budget. */
  shareOfBudget: number;
  /** Planned hours in the window as a share of the whole project budget. */
  plannedShareOfBudget: number;
  /**
   * The whole in-budget total these shares are taken against. Carried so a screen
   * reporting in percent divides by the same number the engine did, rather than
   * reaching for a total from somewhere else and quietly disagreeing.
   */
  projectBudgetHours: number;
  /** Percent complete for the whole project at the start and end of the window. */
  pctAtStart: number;
  pctAtEnd: number;
  counts: Record<PeriodOutcome, number>;
  /** Activities due to finish in the window, and how many actually did. */
  dueToFinish: number;
  finishedOnTime: number;
  activities: PeriodActivity[];
  slices: PeriodSlice[];
  /**
   * The same window cut by phase, in phase order. Every phase carrying budget is
   * here, including one that did nothing in the window — "Phase 3 planned nothing
   * and did nothing" is an answer, and a phase vanishing from the list would read
   * as the log having lost it.
   */
  phases: PeriodPhase[];
};

export const OUTCOMES: PeriodOutcome[] = ['COMPLETED', 'STARTED', 'CONTINUED', 'MISSED', 'NOT STARTED'];

/** The day before an ISO date. Windows are inclusive, so "before the window" is from−1. */
export function dayBefore(iso: string): string {
  return msToISO(isoToMs(iso) - DAY);
}

export function addDays(iso: string, n: number): string {
  return msToISO(isoToMs(iso) + n * DAY);
}

/** Whole days from `a` to `b`. Negative when `b` is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((isoToMs(b) - isoToMs(a)) / DAY);
}

/** True when an ISO date falls inside the inclusive window. */
function within(iso: string | null, from: string, to: string): boolean {
  return !!iso && iso >= from && iso <= to;
}

/**
 * Hours accrued inside the window for one span, as the curve would draw it: the
 * fraction complete at the end minus the fraction complete the day before it began.
 */
function accruedIn(hours: number, start: string | null, end: string | null, from: string, to: string): number {
  if (!hours || !start || !end) return 0;
  const before = dayBefore(from);
  return hours * (accruedFraction(to, start, end) - accruedFraction(before, start, end));
}

/**
 * Split the window into roughly week-long slices for the chart. A 14 day window
 * gives two weeks of seven; anything else divides as evenly as it can, because a
 * log over an odd number of days is still worth drawing.
 */
function sliceWindow(from: string, to: string): { from: string; to: string; label: string }[] {
  const total = daysBetween(from, to) + 1;
  const count = Math.max(1, Math.min(6, Math.round(total / 7) || 1));
  const size = Math.ceil(total / count);
  const out: { from: string; to: string; label: string }[] = [];
  for (let i = 0; i < count; i += 1) {
    const sFrom = addDays(from, i * size);
    if (daysBetween(sFrom, to) < 0) break;
    const sTo = daysBetween(sFrom, to) < size - 1 ? to : addDays(sFrom, size - 1);
    out.push({ from: sFrom, to: sTo, label: count === 1 ? 'Period' : `Week ${i + 1}` });
  }
  return out;
}

/**
 * Build the log for one window.
 *
 * An activity earns a row when it did something, or was supposed to. That means
 * hours accrued either way, or a baseline date or an actual date landing inside the
 * window — so an activity that was due to start and simply never did is listed,
 * which is the whole point of a log that reports what was *planned*.
 */
export function periodLog(rows: BudgetRow[], from: string, to: string): PeriodLog {
  const safeFrom = isValidISO(from) ? from : to;
  const safeTo = isValidISO(to) ? to : from;
  const lo = safeFrom <= safeTo ? safeFrom : safeTo;
  const hi = safeFrom <= safeTo ? safeTo : safeFrom;
  const before = dayBefore(lo);

  const inBudget = rows.filter((r) => r.status === 'IN BUDGET');
  const activities: PeriodActivity[] = [];

  for (const r of inBudget) {
    const plannedHours = accruedIn(r.budgetHours, r.baselineStart, r.baselineFinish, lo, hi);
    const earnedHours = accruedIn(r.earnedHours, r.earnStart, r.earnEnd, lo, hi);
    const finished = r.pctComplete >= 1;
    const actualStart = r.earnStart;
    const actualFinish = finished ? r.earnEnd : null;

    const touched =
      Math.abs(plannedHours) > 1e-9 ||
      Math.abs(earnedHours) > 1e-9 ||
      within(r.baselineStart, lo, hi) ||
      within(r.baselineFinish, lo, hi) ||
      within(actualStart, lo, hi) ||
      within(actualFinish, lo, hi);
    if (!touched) continue;

    let outcome: PeriodOutcome;
    if (finished && within(actualFinish, lo, hi)) outcome = 'COMPLETED';
    else if (within(actualStart, lo, hi)) outcome = 'STARTED';
    else if (within(r.baselineFinish, lo, hi) && !finished) outcome = 'MISSED';
    else if (!actualStart) outcome = 'NOT STARTED';
    else outcome = 'CONTINUED';

    activities.push({
      activityId: r.activityId,
      activityName: r.activityName,
      location: r.location,
      phase: r.phase,
      phaseName: r.phaseName,
      outcome,
      plannedHours,
      earnedHours,
      budgetHours: r.budgetHours,
      pctComplete: r.pctComplete,
      baselineStart: r.baselineStart,
      baselineFinish: r.baselineFinish,
      actualStart,
      actualFinish,
      finishVarianceDays: r.baselineFinish && actualFinish ? daysBetween(r.baselineFinish, actualFinish) : null,
      testsTotal: r.testsTotal,
      testsComplete: r.testsComplete,
    });
  }

  const plannedHours = activities.reduce((s, a) => s + a.plannedHours, 0);
  const earnedHours = activities.reduce((s, a) => s + a.earnedHours, 0);

  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<PeriodOutcome, number>;
  for (const a of activities) counts[a.outcome] += 1;

  // "Due to finish" is a baseline question, so it is counted over every in-budget
  // activity rather than over the rows above: one can be due to finish in the window
  // having accrued nothing in it.
  const dueToFinish = inBudget.filter((r) => within(r.baselineFinish, lo, hi)).length;
  const finishedOnTime = inBudget.filter((r) => within(r.baselineFinish, lo, hi) && r.pctComplete >= 1 && within(r.earnEnd, lo, hi)).length;

  const totalBudget = inBudget.reduce((s, r) => s + r.budgetHours, 0);
  const earnedBy = (rs: BudgetRow[], date: string) => rs.reduce((s, r) => s + r.earnedHours * accruedFraction(date, r.earnStart, r.earnEnd), 0);

  /*
   * By phase, over the same window. The phases come from every in-budget activity
   * rather than from the rows in the log, so a phase that planned nothing is still
   * listed; the outcome counts come from the log, since an outcome is something
   * that happened in the window.
   */
  const phaseRows = new Map<string, BudgetRow[]>();
  for (const r of inBudget) {
    const list = phaseRows.get(r.phase);
    if (list) list.push(r);
    else phaseRows.set(r.phase, [r]);
  }
  const phases: PeriodPhase[] = [...phaseRows]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
    .map(([key, rs]) => {
      const budgetHours = rs.reduce((s, r) => s + r.budgetHours, 0);
      const planned = rs.reduce((s, r) => s + accruedIn(r.budgetHours, r.baselineStart, r.baselineFinish, lo, hi), 0);
      const earned = rs.reduce((s, r) => s + accruedIn(r.earnedHours, r.earnStart, r.earnEnd, lo, hi), 0);
      const c = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<PeriodOutcome, number>;
      for (const a of activities) if (a.phase === key) c[a.outcome] += 1;
      return {
        key,
        label: rs[0].phaseName,
        activities: rs.length,
        budgetHours,
        plannedHours: planned,
        earnedHours: earned,
        achievement: Math.abs(planned) > 1e-9 ? earned / planned : null,
        pctAtStart: budgetHours ? earnedBy(rs, before) / budgetHours : 0,
        pctAtEnd: budgetHours ? earnedBy(rs, hi) / budgetHours : 0,
        counts: c,
      };
    });

  return {
    from: lo,
    to: hi,
    days: daysBetween(lo, hi) + 1,
    plannedHours,
    earnedHours,
    achievement: Math.abs(plannedHours) > 1e-9 ? earnedHours / plannedHours : null,
    shareOfBudget: totalBudget ? earnedHours / totalBudget : 0,
    plannedShareOfBudget: totalBudget ? plannedHours / totalBudget : 0,
    projectBudgetHours: totalBudget,
    pctAtStart: totalBudget ? earnedBy(inBudget, before) / totalBudget : 0,
    pctAtEnd: totalBudget ? earnedBy(inBudget, hi) / totalBudget : 0,
    counts,
    dueToFinish,
    finishedOnTime,
    activities,
    slices: sliceWindow(lo, hi).map((s) => ({
      ...s,
      planned: inBudget.reduce((sum, r) => sum + accruedIn(r.budgetHours, r.baselineStart, r.baselineFinish, s.from, s.to), 0),
      earned: inBudget.reduce((sum, r) => sum + accruedIn(r.earnedHours, r.earnStart, r.earnEnd, s.from, s.to), 0),
    })),
    phases,
  };
}

/**
 * Earned against built, month by month, and the work still to come.
 *
 * Earned is what the budget says the completed work was worth; built is what the
 * timesheets say it cost. Everything here exists to make the gap between them
 * visible early enough to do something about it.
 */
import type {
  BudgetRow,
  BurnCell,
  BurnRow,
  BurnSummary,
  ForecastCell,
  ForecastRow,
  MonthlyEarned,
  Reforecast,
  Subsystem,
  TeamActual,
} from './types';
import { UNASSIGNED } from './pricing';
import { subsystemLabel, sumRecord } from './rollup';
import { accruedFraction } from './curves';
import { maxISO, monthEnd, isoToMs, msToISO } from './dates';


/**
 * Hours earned IN each month, per subsystem. Stops at the data date for the same
 * reason the earned curve does: past it nothing has been reported yet, and a zero
 * there would read as "we earned nothing" rather than "we do not know".
 */
export function monthlyEarned(rows: BudgetRow[], periods: string[], dataDate: string | null): MonthlyEarned[] {
  const out: MonthlyEarned[] = [];
  let prevTotal = 0;
  let prevBy = new Map<string, number>();
  for (const p of periods) {
    if (dataDate && p > dataDate) break;
    let total = 0;
    const by = new Map<string, number>();
    for (const r of rows) {
      if (!r.earnStart) continue;
      const f = accruedFraction(p, r.earnStart, r.earnEnd);
      if (f <= 0) continue;
      total += r.earnedHours * f;
      for (const [code, h] of Object.entries(r.subsystemEarned)) by.set(code, (by.get(code) ?? 0) + h * f);
    }
    const bySubsystem: Record<string, number> = {};
    for (const code of new Set([...by.keys(), ...prevBy.keys()])) {
      bySubsystem[code] = (by.get(code) ?? 0) - (prevBy.get(code) ?? 0);
    }
    out.push({ month: p.slice(0, 7), periodEnd: p, earned: total - prevTotal, bySubsystem });
    prevTotal = total;
    prevBy = by;
  }
  return out;
}

/**
 * Where the work that is LEFT falls, month by month, on the current schedule.
 *
 * `monthlyEarned` answers "what did we earn"; this answers "what is still to come,
 * and when". It is the same spread in the other direction: each activity's
 * remaining budget laid calendar-linearly across the part of its current-schedule
 * window that has not happened yet.
 *
 * Three cases, because remaining work does not always have a future to sit in:
 *
 * - **Still to come.** The window is clipped at the data date and the remainder
 *   spreads across what is left of it. An activity half elapsed carries all of its
 *   remaining budget over its remaining days, not half of it.
 * - **Overdue.** The schedule says the activity should already have finished and it
 *   has not. Its remaining budget lands in the first month ahead, because that is
 *   when the work is actually owed; spreading it over a window that has closed
 *   would put spending in the past.
 * - **Undated.** No usable current-schedule dates, so there is no month it belongs
 *   in. It is returned separately rather than folded in anywhere, and the caller
 *   reports the gap.
 */
export function monthlyRemaining(
  rows: BudgetRow[],
  periods: string[],
  dataDate: string | null,
): { months: { month: string; periodEnd: string; total: number; bySubsystem: Map<string, number> }[]; unphased: number; overdue: number } {
  const future = dataDate ? periods.filter((p) => p > dataDate) : [...periods];
  /*
   * A schedule that ends before the data date leaves no month ahead to put anything
   * in — but work still left on it is not undated, it is late, and calling it
   * unplaceable would hide exactly the case worth seeing. One month is added past
   * the data date so overdue work has a "now" to land in.
   */
  if (!future.length) {
    if (!dataDate) return { months: [], unphased: rows.reduce((t, r) => t + Math.max(0, r.remainingHours), 0), overdue: 0 };
    future.push(monthEnd(msToISO(isoToMs(monthEnd(dataDate)) + 86_400_000)));
  }

  const acc = future.map((p) => ({ month: p.slice(0, 7), periodEnd: p, total: 0, bySubsystem: new Map<string, number>() }));
  let unphased = 0;
  let overdue = 0;

  const put = (i: number, code: string, hours: number) => {
    acc[i].total += hours;
    acc[i].bySubsystem.set(code, (acc[i].bySubsystem.get(code) ?? 0) + hours);
  };

  for (const r of rows) {
    const remaining = r.remainingHours;
    if (remaining <= 1e-9) continue;
    /*
     * Split the remainder the way the budget itself was split, so a group's future
     * and its budget can never disagree. Falling back to the whole figure under
     * Unassigned keeps the months adding up when an activity has no crew breakdown.
     */
    const parts: [string, number][] = [];
    const codes = new Set([...Object.keys(r.subsystemHours), ...Object.keys(r.subsystemEarned)]);
    let split = 0;
    for (const code of codes) {
      const left = (r.subsystemHours[code] ?? 0) - (r.subsystemEarned[code] ?? 0);
      if (Math.abs(left) <= 1e-9) continue;
      parts.push([code, left]);
      split += left;
    }
    if (!parts.length || Math.abs(split - remaining) > 1e-6) {
      parts.length = 0;
      parts.push([UNASSIGNED, remaining]);
    }

    const start = r.currentStart;
    const end = r.currentFinish;
    if (!start || !end) {
      unphased += remaining;
      continue;
    }
    if (dataDate && end <= dataDate) {
      overdue += remaining;
      for (const [code, hours] of parts) put(0, code, hours);
      continue;
    }
    // Clip to the future. A window that has not begun keeps its own start.
    const from = dataDate && start < dataDate ? dataDate : start;
    const to = maxISO(from, end);
    let prev = 0;
    acc.forEach((cell, i) => {
      const f = i === acc.length - 1 ? 1 : accruedFraction(cell.periodEnd, from, to);
      const share = f - prev;
      prev = f;
      if (share <= 1e-12) return;
      for (const [code, hours] of parts) put(i, code, hours * share);
    });
  }

  return { months: acc, unphased, overdue };
}

function reforecastOf(code: string, label: string, budgetHours: number, cumEarned: number, cumBuilt: number): Reforecast {
  const factor = cumBuilt > 0 ? cumEarned / cumBuilt : null;
  const remainingHours = budgetHours - cumEarned;
  // Dividing by the rate achieved so far is the estimate at completion. A factor of
  // zero would divide to infinity, so it is treated as "no rate yet".
  const hoursToComplete = factor && factor > 0 ? remainingHours / factor : null;
  const forecastTotalHours = hoursToComplete === null ? null : cumBuilt + hoursToComplete;
  return {
    code,
    label,
    budgetHours,
    cumEarned,
    cumBuilt,
    factor,
    remainingHours,
    hoursToComplete,
    forecastTotalHours,
    varianceAtCompletion: forecastTotalHours === null ? null : budgetHours - forecastTotalHours,
  };
}

/**
 * Earned against built, month by month.
 *
 * Earned is what the budget says the completed work was worth. Built is what the
 * timesheets say it cost. Earning 5,000 in a month the team built 6,000 is a
 * 1,000-hour hole, and at that rate the rest of the job costs more than it is worth;
 * that is what `factor` and the reforecast are for.
 */
export function burnSummary(
  rows: BudgetRow[],
  months: MonthlyEarned[],
  actuals: TeamActual[],
  subsystems: Subsystem[],
  /** The month ends the curve spans, so the forecast can be laid across the future ones. */
  periods: string[] = [],
  dataDate: string | null = null,
): BurnSummary {
  const clean = actuals.filter((a) => /^\d{4}-\d{2}$/.test((a.month ?? '').trim()) && Number.isFinite(a.hours));
  const builtByMonth = new Map<string, Map<string, number>>();
  for (const a of clean) {
    const m = a.month.trim();
    const code = (a.subsystem ?? '').trim();
    const inner = builtByMonth.get(m) ?? new Map<string, number>();
    inner.set(code, (inner.get(code) ?? 0) + a.hours);
    builtByMonth.set(m, inner);
  }

  const earnedByMonth = new Map(months.map((m) => [m.month, m]));
  const everyMonth = [...new Set([...earnedByMonth.keys(), ...builtByMonth.keys()])].sort();

  /*
   * Trim the empty months off each end. The curve runs to the last date in the
   * schedule, which on a five year project is dozens of months in which nothing
   * has been earned and nothing has been built; a cumulative figure repeated down
   * forty identical rows reads as data and is not. A gap in the MIDDLE is kept,
   * because a month where the team built nothing is worth seeing.
   */
  const carries = (m: string) => (earnedByMonth.get(m)?.earned ?? 0) !== 0 || (builtByMonth.get(m)?.size ?? 0) > 0;
  const first = everyMonth.findIndex(carries);
  const last = everyMonth.length - 1 - [...everyMonth].reverse().findIndex(carries);
  const allMonths = first < 0 ? [] : everyMonth.slice(first, last + 1);

  const budgetBy = sumRecord(rows, (r) => r.subsystemHours);
  const earnedBy = sumRecord(rows, (r) => r.subsystemEarned);

  let cumEarned = 0;
  let cumBuilt = 0;
  const rowsOut: BurnRow[] = allMonths.map((month) => {
    const e = earnedByMonth.get(month);
    const built = builtByMonth.get(month) ?? new Map<string, number>();
    const earned = e?.earned ?? 0;
    const builtTotal = [...built.values()].reduce((a, b) => a + b, 0);
    cumEarned += earned;
    cumBuilt += builtTotal;
    const codes = [...new Set([...Object.keys(e?.bySubsystem ?? {}), ...built.keys()])];
    const bySubsystem: BurnCell[] = codes
      .map((code) => {
        const ce = e?.bySubsystem[code] ?? 0;
        const cb = built.get(code) ?? 0;
        return {
          code,
          label: subsystemLabel(code, subsystems),
          earned: ce,
          built: cb,
          variance: ce - cb,
          factor: cb > 0 ? ce / cb : null,
        };
      })
      .sort((a, b) => b.built - a.built || a.label.localeCompare(b.label));
    return {
      month,
      earned,
      built: builtTotal,
      variance: earned - builtTotal,
      cumEarned,
      cumBuilt,
      cumVariance: cumEarned - cumBuilt,
      factor: builtTotal > 0 ? earned / builtTotal : null,
      bySubsystem,
    };
  });

  const totalEarned = rows.reduce((s, r) => s + r.earnedHours, 0);
  const phasedEarned = months.reduce((s, m) => s + m.earned, 0);
  const totalBuilt = clean.reduce((s, a) => s + a.hours, 0);
  const builtBy = new Map<string, number>();
  for (const a of clean) {
    const code = (a.subsystem ?? '').trim();
    builtBy.set(code, (builtBy.get(code) ?? 0) + a.hours);
  }

  const codes = [...new Set([...budgetBy.keys(), ...builtBy.keys(), ...subsystems.map((x) => x.code.trim())])];
  const bySubsystem = codes
    .map((code) =>
      reforecastOf(
        code,
        subsystemLabel(code, subsystems),
        budgetBy.get(code) ?? 0,
        earnedBy.get(code) ?? 0,
        builtBy.get(code) ?? 0,
      ),
    )
    .sort((a, b) => b.budgetHours - a.budgetHours || a.code.localeCompare(b.code));

  /*
   * The future, at the rate each group has actually managed.
   *
   * The value of the work left comes from the schedule; what it will COST comes
   * from the group's own factor, because that is the whole argument this screen
   * exists to make — a group converting hours at 0.69 needs half again as many
   * hours to finish as its budget says. A group that has built nothing has no rate
   * to project with, and gets a null rather than a number that looks measured.
   */
  const factorOf = new Map(bySubsystem.map((f) => [f.code, f.factor]));
  const remaining = monthlyRemaining(rows, periods, dataDate);
  const forecastMonths: ForecastRow[] = remaining.months
    .map((m) => {
      const cells: ForecastCell[] = [...m.bySubsystem.entries()]
        .filter(([, hours]) => Math.abs(hours) > 1e-9)
        .map(([code, hours]) => {
          const f = factorOf.get(code) ?? null;
          return {
            code,
            label: subsystemLabel(code, subsystems),
            earned: hours,
            built: f && f > 0 ? hours / f : null,
          };
        })
        .sort((a, b) => b.earned - a.earned || a.label.localeCompare(b.label));
      // The month's cost is the sum of the groups that HAVE a rate. Null only when
      // not one of them does, so a single unrated group cannot blank the whole row.
      const costed = cells.filter((c) => c.built !== null);
      return {
        month: m.month,
        periodEnd: m.periodEnd,
        earned: m.total,
        built: costed.length ? costed.reduce((t, c) => t + (c.built ?? 0), 0) : null,
        bySubsystem: cells,
      };
    })
    .filter((m) => Math.abs(m.earned) > 1e-9);

  return {
    months: rowsOut,
    totalEarned,
    phasedEarned,
    unphasedEarned: totalEarned - phasedEarned,
    totalBuilt,
    project: reforecastOf(
      '',
      'Whole project',
      rows.reduce((s, r) => s + r.budgetHours, 0),
      totalEarned,
      totalBuilt,
    ),
    bySubsystem,
    builtWithNoBudget: [...builtBy.keys()].filter((c) => (budgetBy.get(c) ?? 0) === 0 && builtBy.get(c)! > 0),
    forecastMonths,
    unphasedRemaining: remaining.unphased,
    overdueRemaining: remaining.overdue,
  };
}

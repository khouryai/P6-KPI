/**
 * The curves, and the headline totals that must agree with them.
 *
 * Both take rows rather than reading the model, which is what lets a phase be drawn
 * and counted on its own: the same arithmetic over a subset can never disagree with
 * the programme it is part of.
 */
import type { BudgetRow, CurvePoint } from './types';
import { accruedAt, prepWindow } from './curves';
import { isoToMs, periodEndsBetween, type Cadence } from './dates';

/**
 * The planned, forecast and earned curves for a set of rows.
 *
 * Taking rows as an argument rather than reading the whole model is what lets the
 * dashboard draw one phase on its own: the same arithmetic runs over the subset, so
 * a phase curve can never disagree with the project curve it is part of. The
 * percentages are of the subset's own budget, because a phase at 40 per cent of its
 * own scope is the number anyone asking for a phase curve wants.
 */
/**
 * The dates a curve would span, without summing anything over them.
 *
 * `buildCurve` needs this and so does the monthly earned-against-built grid, and
 * the grid needs ONLY this. Asking `buildCurve` for it meant computing a whole
 * second curve — every activity accrued across every period — and throwing the
 * result away, which doubled the cost of building the model for nothing.
 */
export function curvePeriods(rows: BudgetRow[], dataDate: string | null, cadence: Cadence = 'month'): string[] {
  const dates: string[] = [];
  for (const r of rows) {
    for (const d of [r.baselineStart, r.baselineFinish, r.currentStart, r.currentFinish, r.earnStart, r.earnEnd]) {
      if (d) dates.push(d);
    }
  }
  if (dataDate) dates.push(dataDate);
  if (!dates.length) return [];
  dates.sort();
  return periodEndsBetween(dates[0], dates[dates.length - 1], cadence, dataDate);
}

export function buildCurve(
  rows: BudgetRow[],
  dataDate: string | null,
  cadence: Cadence = 'month',
): { curve: CurvePoint[]; periods: string[] } {
  const periods = curvePeriods(rows, dataDate, cadence);
  if (!periods.length) return { curve: [], periods: [] };
  const totalBudget = rows.reduce((s, r) => s + r.budgetHours, 0);
  /*
   * Every date parsed once, not once per period.
   *
   * This loop is rows × periods × three series, so at 675 activities over 21
   * periods it runs forty thousand times. Parsing the same handful of ISO strings
   * inside it was three quarters of the cost of building the whole model, and it
   * is why a keyed percent took a moment to land on the curve.
   */
  const prepped = rows
    .filter((r) => r.budgetHours !== 0 || r.earnedHours !== 0)
    .map((r) => ({
      budget: r.budgetHours,
      earned: r.earnedHours,
      planned: prepWindow(r.baselineStart, r.baselineFinish),
      forecast: prepWindow(r.currentStart, r.currentFinish),
      actual: prepWindow(r.earnStart, r.earnEnd),
    }));
  const curve = periods.map((p) => {
    const at = isoToMs(p);
    let planned = 0;
    let forecast = 0;
    let earned = 0;
    for (const r of prepped) {
      planned += r.budget * accruedAt(at, r.planned);
      forecast += r.budget * accruedAt(at, r.forecast);
      earned += r.earned * accruedAt(at, r.actual);
    }
    const earnedOrNull = dataDate && p > dataDate ? null : earned;
    return {
      periodEnd: p,
      planned,
      forecast,
      earned: earnedOrNull,
      plannedPct: totalBudget ? planned / totalBudget : 0,
      earnedPct: earnedOrNull === null ? null : totalBudget ? earnedOrNull / totalBudget : 0,
    };
  });
  return { curve, periods };
}


/**
 * The headline figures for a set of rows: the same ones the Summary carries for the
 * whole project, so the dashboard's cards can follow a filter without the screen
 * re-deriving arithmetic the engine already owns.
 */
export type RowTotals = {
  inBudget: number;
  budgetHours: number;
  earnedHours: number;
  remainingHours: number;
  pctComplete: number;
  notStarted: number;
  inProgress: number;
  finished: number;
  /** In-budget activities whose percent complete somebody keyed by hand. */
  pctKeyed: number;
  pctFromP6: number;
};

export function rowTotals(rows: BudgetRow[]): RowTotals {
  const budgetHours = rows.reduce((s, r) => s + r.budgetHours, 0);
  const earnedHours = rows.reduce((s, r) => s + r.earnedHours, 0);
  // Counted over the budgeted rows only, as the phase rollup does. An excluded row is
  // "not started" in P6's sense and carries no hours, so counting it would put a bigger
  // number beside the budget than the phase tiles underneath show.
  const inBudgetRows = rows.filter((r) => r.status === 'IN BUDGET');
  const n = (pred: (r: BudgetRow) => boolean) => inBudgetRows.filter(pred).length;
  return {
    inBudget: inBudgetRows.length,
    budgetHours,
    earnedHours,
    remainingHours: budgetHours - earnedHours,
    pctComplete: budgetHours ? earnedHours / budgetHours : 0,
    notStarted: n((r) => r.earnWindowSource === 'NOT STARTED'),
    inProgress: n((r) => r.earnWindowSource === 'IN PROGRESS'),
    finished: n((r) => r.earnWindowSource === 'P6 ACTUAL' || r.earnWindowSource === 'TEST WINDOW'),
    pctKeyed: n((r) => r.pctSource === 'OVERRIDE'),
    pctFromP6: n((r) => r.pctSource === 'P6'),
  };
}

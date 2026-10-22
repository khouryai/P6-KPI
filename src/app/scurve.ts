/**
 * What the S-curve picture shows, before anything is drawn.
 *
 * One panel per curve asked for — the whole project, or a phase — each with its own
 * curve, its own budget to take percentages against, and the two figures a reader
 * looks for first: how complete it is, and how complete the baseline expected it to
 * be by now. Kept apart from the drawing so it can be tested without a browser.
 */
import type { Model, Settings } from '../engine/types';
import { buildCurve, curvePointAt, rowTotals, withPointsAt } from '../engine/compute';
import { isValidISO } from '../engine/dates';
import type { CurvePoint } from '../engine/types';

/** The whole project, in a list of phase keys. */
export const WHOLE_PROJECT = '*';

export type SCurvePanel = {
  key: string;
  label: string;
  curve: CurvePoint[];
  /** The budget the panel's percentages are taken against. */
  budgetHours: number;
  earnedHours: number;
  /** Earned over budget: the percent complete the Dashboard reports. */
  complete: number;
  /** What the baseline had planned to be complete by the data date. null without one. */
  expected: number | null;
  /** What the baseline had planned to be complete by today. */
  expectedToday: number;
  /**
   * Where the earned line reaches at the data date. Lower than `complete` when some
   * of the progress has no actual start: it is in the percent, but has no date to be
   * drawn at, and the picture should say so rather than leave the gap to puzzle over.
   */
  earnedOnLine: number | null;
  activities: number;
};

/** Phases in their own order: P2 before P10, codes that are not P<n> last. */
export function phaseOrder(key: string): number {
  const m = /^P(\d+)$/i.exec(key.trim());
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** What can be picked: the whole project, then every phase with work in the budget. */
export function scurveChoices(model: Model): { key: string; label: string }[] {
  const phases = model.groups.phase
    .filter((g) => g.inBudget > 0)
    .sort((a, b) => phaseOrder(a.key) - phaseOrder(b.key) || a.label.localeCompare(b.label))
    .map((g) => ({ key: g.key, label: g.label }));
  return [{ key: WHOLE_PROJECT, label: 'Whole project' }, ...phases];
}

/**
 * The panels for these choices, in the order they are offered — the whole project
 * first, then phase by phase — whatever order they were ticked in. A choice with no
 * work in the budget (a phase gone in the latest import) is dropped.
 */
export function scurvePanels(model: Model, settings: Settings, keys: string[], today: string): SCurvePanel[] {
  const dataDate = isValidISO(settings.dataDate) ? settings.dataDate : null;
  const cadence = settings.curveCadence ?? 'month';
  const wanted = new Set(keys);
  return scurveChoices(model)
    .filter((c) => wanted.has(c.key))
    .map((c) => {
      const rows = c.key === WHOLE_PROJECT ? model.rows : model.rows.filter((r) => r.phase === c.key);
      const totals = rowTotals(rows);
      // Both dates stretch the axis when they fall outside it: a finished phase still
      // shows where today is, and one not yet begun still shows the data date.
      const curve = withPointsAt(buildCurve(rows, dataDate, cadence).curve, rows, [dataDate, today], dataDate, { extend: true });
      const atDataDate = dataDate ? curve.find((c) => c.periodEnd === dataDate) : undefined;
      return {
        key: c.key,
        label: c.label,
        curve,
        budgetHours: totals.budgetHours,
        earnedHours: totals.earnedHours,
        complete: totals.pctComplete,
        expected: dataDate ? curvePointAt(rows, dataDate, dataDate).plannedPct : null,
        expectedToday: curvePointAt(rows, today, dataDate).plannedPct,
        earnedOnLine: atDataDate?.earnedPct ?? null,
        activities: totals.inBudget,
      };
    })
    .filter((p) => p.activities > 0 && p.curve.length > 0);
}

const pct = (n: number) => `${(Math.round(n * 1000) / 10).toFixed(1)}%`;

/** A panel's title: its name, how complete it is, and how complete it was expected to be. */
export function panelTitle(p: SCurvePanel): string {
  return `${p.label}:  ${pct(p.complete)} complete  ·  ${pct(p.expected ?? p.expectedToday)} expected`;
}

/** The line under the title: what each figure is measured at, and the gap between them. */
export function panelSummary(p: SCurvePanel, opts: { dataDateLabel: string; todayLabel: string; hours: boolean; fmtHours: (n: number) => string }): string {
  const parts: string[] = [];
  parts.push(`Complete ${pct(p.complete)}${opts.hours ? ` (${opts.fmtHours(p.earnedHours)} of ${opts.fmtHours(p.budgetHours)} h earned)` : ''}`);
  if (p.expected !== null) {
    parts.push(`expected ${pct(p.expected)} by the data date ${opts.dataDateLabel}`);
    const gap = Math.round((p.complete - p.expected) * 1000) / 10;
    parts.push(gap > 0 ? `${gap.toFixed(1)} points ahead of plan` : gap < 0 ? `${Math.abs(gap).toFixed(1)} points behind plan` : 'on plan');
  } else parts.push('no data date set, so nothing is measured as complete yet');
  parts.push(`expected ${pct(p.expectedToday)} by today ${opts.todayLabel}`);
  if (p.earnedOnLine !== null && p.complete - p.earnedOnLine > 0.0005) {
    parts.push(`the earned line reaches ${pct(p.earnedOnLine)}: the rest has no actual start, so no date to be drawn at`);
  }
  return parts.join('  ·  ');
}

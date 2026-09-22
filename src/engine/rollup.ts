/**
 * Rolling the budget up: by phase, location, work type or discipline, and by the
 * resource groups the crews name.
 *
 * The invariant every function here keeps is that the hours add back to the budget
 * exactly, however the rows are cut.
 */
import type { BudgetRow, GroupDim, GroupStat, Subsystem, SubsystemCell, SubsystemStat } from './types';
import { normKey } from './keys';
import { phaseLabel } from './parse';


export function subsystemLabel(code: string, subsystems: Subsystem[]): string {
  const c = code.trim();
  if (c === '') return 'Unassigned';
  const named = subsystems.find((s) => normKey(s.code) === normKey(c));
  return named?.name ? `${c} — ${named.name}` : c;
}

export function sumRecord(rows: BudgetRow[], pick: (r: BudgetRow) => Record<string, number>): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    for (const [code, h] of Object.entries(pick(r))) out.set(code, (out.get(code) ?? 0) + h);
  }
  return out;
}

/**
 * Hours per subsystem, and the same hours cut by phase and by location.
 *
 * This is not a partition: an activity needing an ATS and an IXL engineer appears
 * under both, so the activity counts overlap. The hours do not overlap — every hour
 * belongs to exactly one subsystem — so the hour totals still add back to the budget.
 */
export function subsystemRollup(rows: BudgetRow[], subsystems: Subsystem[]): SubsystemStat[] {
  const budget = sumRecord(rows, (r) => r.subsystemHours);
  const earned = sumRecord(rows, (r) => r.subsystemEarned);
  // A subsystem the user named but has not used yet still deserves a row, so the
  // naming screen and this one agree on what exists.
  for (const s of subsystems) if (!budget.has(s.code.trim())) budget.set(s.code.trim(), 0);
  const totalBudget = [...budget.values()].reduce((a, b) => a + b, 0);

  const cut = (code: string, dim: 'phase' | 'location'): SubsystemCell[] => {
    const by = new Map<string, { b: number; e: number }>();
    for (const r of rows) {
      const h = r.subsystemHours[code];
      if (h === undefined) continue;
      const k = dim === 'phase' ? r.phase : r.location;
      const cell = by.get(k) ?? { b: 0, e: 0 };
      cell.b += h;
      cell.e += r.subsystemEarned[code] ?? 0;
      by.set(k, cell);
    }
    return [...by]
      .map(([key, v]) => ({
        key,
        label: DIM_LABEL[dim](key),
        budgetHours: v.b,
        earnedHours: v.e,
        pctComplete: v.b ? v.e / v.b : 0,
      }))
      .sort((a, b) => b.budgetHours - a.budgetHours || a.label.localeCompare(b.label));
  };

  return [...budget.keys()]
    .map((code) => {
      const b = budget.get(code) ?? 0;
      const e = earned.get(code) ?? 0;
      return {
        code,
        label: subsystemLabel(code, subsystems),
        activities: rows.filter((r) => (r.subsystemHours[code] ?? 0) > 0).length,
        budgetHours: b,
        earnedHours: e,
        remainingHours: b - e,
        pctComplete: b ? e / b : 0,
        shareOfBudget: totalBudget ? b / totalBudget : 0,
        byPhase: cut(code, 'phase'),
        byLocation: cut(code, 'location'),
      };
    })
    .sort((a, b) => b.budgetHours - a.budgetHours || a.code.localeCompare(b.code));
}

/**
 * Which group(s) a row belongs to on one dimension, and with how much of itself.
 *
 * Three of the four dimensions come off the Activity ID and an activity is in
 * exactly one of each. Subsystem is the exception: it is free text on the Activity
 * Library key and can name several groups at once, and an activity two groups both
 * work belongs to both. Its hours are shared evenly between them — the box says who
 * is on it, not how much each does, and an even split is the only reading of that
 * which does not invent a number nobody gave. The weights always sum to 1, so every
 * rollup still adds back to the budget exactly.
 */
const DIM_PARTS: Record<GroupDim, (r: BudgetRow) => { key: string; weight: number }[]> = {
  phase: (r) => [{ key: r.phase, weight: 1 }],
  location: (r) => [{ key: r.location, weight: 1 }],
  discipline: (r) =>
    r.disciplines.length > 1
      ? r.disciplines.map((d) => ({ key: d, weight: 1 / r.disciplines.length }))
      : [{ key: r.disciplines[0] ?? '', weight: 1 }],
  workType: (r) => [{ key: r.workType, weight: 1 }],
};

const DIM_LABEL: Record<GroupDim, (key: string) => string> = {
  phase: (k) => (k === '' ? 'No phase in the ID' : phaseLabel(k)),
  location: (k) => (k === '' ? 'No location in the ID' : k),
  discipline: (k) => (k === '' ? 'No discipline set' : k),
  workType: (k) => (k === '' ? 'No work type in the ID' : k),
};

/**
 * Roll the budget up by one dimension. Every activity lands in exactly one group,
 * including the ones whose Activity ID does not carry the segment, so the group
 * totals always add back to the whole.
 */
export function groupRows(rows: BudgetRow[], dim: GroupDim): GroupStat[] {
  const parts = DIM_PARTS[dim];
  /** Each row in this group, with the share of itself that belongs here. */
  const buckets = new Map<string, { row: BudgetRow; weight: number }[]>();
  for (const r of rows) {
    for (const p of parts(r)) {
      const list = buckets.get(p.key);
      if (list) list.push({ row: r, weight: p.weight });
      else buckets.set(p.key, [{ row: r, weight: p.weight }]);
    }
  }
  const out: GroupStat[] = [];
  // The share is of the rows handed in, so a rollup inside one phase reports shares
  // of that phase rather than of the project. The screen's own total then agrees.
  const grandTotal = rows.reduce((s, r) => s + r.budgetHours, 0);
  for (const [key, members] of buckets) {
    /*
     * Hours are shared, counts are not. An activity worked by two groups puts half
     * its hours in each — so the hours still add back to the budget — but it is one
     * whole activity to each of them, and reporting "1.5 activities" would be
     * arithmetic nobody can act on. The counts therefore overlap across groups,
     * exactly as they do on the Resources screen, and `shared` says by how much.
     */
    const list = members.map((m) => m.row);
    const inBudgetRows = list.filter((r) => r.status === 'IN BUDGET');
    const budgetHours = members.reduce((s, m) => s + m.row.budgetHours * m.weight, 0);
    const earnedHours = members.reduce((s, m) => s + m.row.earnedHours * m.weight, 0);
    const dates = (pick: (r: BudgetRow) => string | null) => list.map(pick).filter((d): d is string => !!d).sort();
    const starts = dates((r) => r.currentStart ?? r.baselineStart);
    const finishes = dates((r) => r.currentFinish ?? r.baselineFinish);
    out.push({
      key,
      label: DIM_LABEL[dim](key),
      activities: list.length,
      shared: members.filter((m) => m.weight < 1).length,
      inBudget: inBudgetRows.length,
      budgetHours,
      earnedHours,
      remainingHours: budgetHours - earnedHours,
      shareOfBudget: grandTotal ? budgetHours / grandTotal : 0,
      pctComplete: budgetHours ? earnedHours / budgetHours : 0,
      notStarted: inBudgetRows.filter((r) => r.earnWindowSource === 'NOT STARTED').length,
      inProgress: inBudgetRows.filter((r) => r.earnWindowSource === 'IN PROGRESS').length,
      finished: inBudgetRows.filter((r) => r.earnWindowSource === 'P6 ACTUAL' || r.earnWindowSource === 'TEST WINDOW').length,
      withKeyedPct: inBudgetRows.filter((r) => r.pctSource === 'OVERRIDE').length,
      earliestStart: starts[0] ?? null,
      latestFinish: finishes[finishes.length - 1] ?? null,
    });
  }
  // Biggest budget first: that is the order someone reviewing progress wants.
  return out.sort((a, b) => b.budgetHours - a.budgetHours || a.label.localeCompare(b.label));
}

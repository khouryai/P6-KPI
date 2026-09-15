import type {
  ActivityOverride,
  BurnCell,
  BurnRow,
  BurnSummary,
  CrewLine,
  MonthlyEarned,
  Reforecast,
  Subsystem,
  SubsystemCell,
  SubsystemStat,
  TeamActual,
  ActivityStatus,
  BaselineSource,
  Basis,
  BudgetRow,
  CurvePoint,
  EarnWindowSource,
  LibraryEntry,
  LibraryStat,
  Location,
  LocationStat,
  Model,
  ModelInput,
  P6Activity,
  PctSource,
  RateStatus,
  Settings,
  GroupDim,
  GroupStat,
  Snapshot,
  SnapshotMarker,
  Summary,
  TestProgress,
  TestProgressCheck,
} from './types';
import { normKey, containsCI } from './keys';
import { indexLibrary, resolveMatchKey } from './match';
import { phaseOf, workTypeOf, phaseLabel } from './parse';
import { accruedFraction } from './curves';
import { maxISO, monthEndsBetween, isValidISO } from './dates';

// ---------------------------------------------------------------------------
// Library helpers
// ---------------------------------------------------------------------------

export function effectiveInclude(entry: LibraryEntry): 'Y' | 'N' {
  if (entry.includeOverride) return entry.includeOverride;
  const k = entry.matchKey;
  if (containsCI(k, '(by BART)') || containsCI(k, '(by Others)') || containsCI(k, '(Deleted)')) return 'N';
  return 'Y';
}

export function effectiveBasis(entry: LibraryEntry, settings: Settings): Basis {
  return entry.basis ?? settings.defaultBasis;
}

/** The code used for hours that were never attributed to a subsystem. */
export const UNASSIGNED = '';

/**
 * The crew breakdown in effect, with blank and non-positive lines dropped and
 * repeated subsystems merged. Empty when the entry is priced as a plain headcount.
 */
export function crewLines(entry: LibraryEntry): CrewLine[] {
  if (!entry.crew || !entry.crew.length) return [];
  const merged = new Map<string, CrewLine>();
  for (const line of entry.crew) {
    const count = Number(line?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const code = (line.subsystem ?? '').trim();
    // Lines for the same subsystem at different shift lengths stay separate, since
    // merging them would lose the shift length.
    const k = `${normKey(code)}|${line.shiftHours ?? ''}`;
    const prev = merged.get(k);
    if (prev) prev.count += count;
    else merged.set(k, { subsystem: code, count, shiftHours: line.shiftHours });
  }
  return [...merged.values()];
}

export function effectiveCrew(entry: LibraryEntry, settings: Settings): number {
  const lines = crewLines(entry);
  if (lines.length) return lines.reduce((s, l) => s + l.count, 0);
  return entry.crewSize ?? settings.defaultCrew;
}

export function effectiveShiftHours(entry: LibraryEntry, settings: Settings): number {
  return entry.shiftHours ?? settings.defaultShiftHours;
}

export function isOnDefaults(entry: LibraryEntry): boolean {
  return (
    entry.basis === undefined &&
    (entry.crew === undefined || crewLines(entry).length === 0) &&
    entry.crewSize === undefined &&
    entry.shiftHours === undefined &&
    entry.durationShifts === undefined
  );
}

export function libraryRateStatus(entry: LibraryEntry, settings: Settings): RateStatus {
  if (effectiveInclude(entry) === 'N') return 'EXCLUDED';
  if (isOnDefaults(entry)) return 'DEFAULT';
  if (effectiveBasis(entry, settings) === 'RATE' && entry.durationShifts === undefined) return 'NEEDS SHIFTS';
  return 'SET';
}

/**
 * Hours per person-unit for each crew line: count times that line's shift length.
 * This is both the per-shift cost of the crew and the weight used to split the
 * budget between subsystems, so the two can never drift apart.
 */
export function crewWeights(entry: LibraryEntry, settings: Settings): { key: string; weight: number }[] {
  const shift = effectiveShiftHours(entry, settings);
  const lines = crewLines(entry);
  if (!lines.length) return [{ key: UNASSIGNED, weight: (entry.crewSize ?? settings.defaultCrew) * shift }];
  const byCode = new Map<string, number>();
  for (const l of lines) {
    const code = l.subsystem.trim();
    byCode.set(code, (byCode.get(code) ?? 0) + l.count * (l.shiftHours ?? shift));
  }
  return [...byCode].map(([key, weight]) => ({ key, weight }));
}

/** Standard hours for one instance of an activity under a library entry. */
export function stdHoursFor(entry: LibraryEntry, settings: Settings, originalDuration: number | null): number {
  const units =
    effectiveBasis(entry, settings) === 'RATE' ? (entry.durationShifts ?? 0) : Math.max(0, originalDuration ?? 0);
  // Summing the crew lines rather than crew x shift lets one group work a shorter
  // shift than the rest. With no breakdown the two are identical.
  return crewWeights(entry, settings).reduce((s, w) => s + w.weight, 0) * units;
}

/**
 * Split a total across weighted buckets so the parts sum to the total EXACTLY.
 *
 * An integer total is split into integers by largest remainder, so a budget of 24
 * hours across three equal groups reads 8/8/8 and not 8.0000001. Anything else is
 * split proportionally with the rounding residue landing on the largest bucket.
 * Either way no rollup by subsystem can disagree with the budget it came from.
 */
export function allocate(total: number, weights: { key: string; weight: number }[]): Record<string, number> {
  const usable = weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  if (!usable.length || !Number.isFinite(total)) return { [UNASSIGNED]: Number.isFinite(total) ? total : 0 };
  if (usable.length === 1) return { [usable[0].key]: total };
  const sum = usable.reduce((s, w) => s + w.weight, 0);
  const out: Record<string, number> = {};

  if (Number.isInteger(total)) {
    const exact = usable.map((w) => ({ key: w.key, want: (total * w.weight) / sum }));
    const floors = exact.map((e) => ({ key: e.key, base: Math.floor(e.want), rem: e.want - Math.floor(e.want) }));
    let left = total - floors.reduce((s, f) => s + f.base, 0);
    // Biggest fractional part first, so the spare hours go where they are most owed.
    const order = [...floors].sort((a, b) => b.rem - a.rem);
    for (const f of floors) out[f.key] = f.base;
    for (const f of order) {
      if (left <= 0) break;
      out[f.key] += 1;
      left -= 1;
    }
    return out;
  }

  let running = 0;
  usable.forEach((w, i) => {
    const v = i === usable.length - 1 ? total - running : (total * w.weight) / sum;
    out[w.key] = v;
    running += v;
  });
  return out;
}

function scaleRecord(rec: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = v * factor;
  return out;
}

/** Excel ROUND(x, 0): half away from zero. */
export function excelRound(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

// ---------------------------------------------------------------------------
// Percent complete
// ---------------------------------------------------------------------------

/** Effective pct from a test progress row, or null if it says nothing (workbook Test_Progress column E). */
export function testPctEffective(tp: TestProgress | undefined): { pct: number; source: PctSource } | null {
  if (!tp) return null;
  if (tp.pctOverride !== undefined && tp.pctOverride !== null && Number.isFinite(tp.pctOverride)) {
    return { pct: tp.pctOverride, source: 'OVERRIDE' };
  }
  if (tp.testsTotal !== undefined && tp.testsTotal !== null && tp.testsTotal > 0) {
    const pct = Math.max(0, Math.min(1, (tp.testsComplete ?? 0) / tp.testsTotal));
    return { pct, source: 'TESTS' };
  }
  return null;
}

/** P6 fallback: 1 if the finish is an actual, else (OD - RD) / OD clamped, 0 if OD is zero or not numeric. */
export function p6PctComplete(a: P6Activity): number {
  if (a.actualFinish) return 1;
  const od = a.originalDuration;
  if (od === null || !Number.isFinite(od) || od === 0) return 0;
  const rd = a.remainingDuration ?? 0;
  return Math.max(0, Math.min(1, (od - rd) / od));
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

function firstByKey<T>(items: T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) {
    const k = normKey(key(it));
    if (k && !m.has(k)) m.set(k, it);
  }
  return m;
}

export function computeModel(input: ModelInput): Model {
  const { settings, overrides, testProgress, current, snapshots } = input;
  const notes: string[] = [];
  const libIdx = indexLibrary(input.library);
  const locIdx = firstByKey<Location>(input.locations, (l) => l.code);
  const baseIdx = firstByKey<P6Activity>((input.baseline ?? []).filter((a) => a.rowType === 'ACTIVITY'), (a) => a.activityId);
  const ovIdx = firstByKey<ActivityOverride>(overrides, (o) => o.activityId);
  const tpIdx = firstByKey<TestProgress>(testProgress, (t) => t.activityId);
  const hasBaseline = input.baseline !== null && input.baseline.length > 0;
  const dataDate = isValidISO(settings.dataDate) ? settings.dataDate : null;
  if (!dataDate) notes.push('No data date is set. In-progress work cannot earn and the earned curve has no end.');

  const rows: BudgetRow[] = [];
  for (const a of current) {
    if (a.rowType !== 'ACTIVITY') continue;
    const match = resolveMatchKey(a.activityType, libIdx);
    const entry = match.entry;
    const rateStatus: RateStatus = entry ? libraryRateStatus(entry, settings) : 'NO MATCH';

    let status: ActivityStatus;
    if (a.excludeReason) status = a.excludeReason;
    else if (!entry) status = 'REVIEW';
    else if (effectiveInclude(entry) !== 'Y') status = 'EXCLUDED';
    else status = 'IN BUDGET';

    const inBudget = status === 'IN BUDGET' && entry !== null;
    const basis = inBudget && entry ? effectiveBasis(entry, settings) : null;
    const loc = locIdx.get(normKey(a.location));
    const complexity = inBudget ? (loc?.complexityFactor ?? settings.defaultComplexity) : null;
    const stdHours = inBudget && entry ? stdHoursFor(entry, settings, a.originalDuration) : null;
    const ov = ovIdx.get(normKey(a.activityId));
    const overrideHours = inBudget && ov && Number.isFinite(ov.overrideHours) ? ov.overrideHours : null;
    const budgetHours = !inBudget
      ? 0
      : overrideHours !== null
        ? overrideHours
        : excelRound((stdHours ?? 0) * (complexity ?? 1));
    const loeFlag = inBudget && basis === 'DUR' && (a.originalDuration ?? 0) > settings.loeDurationDays;
    const needsShifts = inBudget && rateStatus === 'NEEDS SHIFTS';

    // Baseline dates: matched on trimmed Activity ID. Fall back to current dates when absent.
    const bl = baseIdx.get(normKey(a.activityId));
    let baselineSource: BaselineSource;
    if (!bl || !bl.finishDate) baselineSource = a.finishDate ? 'CURRENT' : 'NONE';
    else baselineSource = 'BASELINE';
    const baselineStart = baselineSource === 'BASELINE' ? bl!.startDate : baselineSource === 'CURRENT' ? a.startDate : null;
    const baselineFinish = baselineSource === 'BASELINE' ? bl!.finishDate : baselineSource === 'CURRENT' ? a.finishDate : null;

    // Percent complete: override, then tests, then P6 duration.
    const tp = tpIdx.get(normKey(a.activityId));
    const tpe = testPctEffective(tp);
    const pctComplete = tpe ? tpe.pct : p6PctComplete(a);
    const pctSource: PctSource = tpe ? tpe.source : 'P6';
    const earnedHours = budgetHours * pctComplete;

    // The split is of the FINAL budget figure, not of the standard hours, so an
    // override or the rounding both carry through to every subsystem proportionally.
    const subsystemHours = inBudget && entry ? allocate(budgetHours, crewWeights(entry, settings)) : { [UNASSIGNED]: 0 };

    // Earn window.
    const testStart = tp?.testStartOverride && isValidISO(tp.testStartOverride) ? tp.testStartOverride : null;
    const testEnd = tp?.testEndOverride && isValidISO(tp.testEndOverride) ? tp.testEndOverride : null;
    const earnStart = testStart ?? (a.actualStart ? a.startDate : null);
    let earnEnd: string | null = null;
    let earnWindowSource: EarnWindowSource = 'NOT STARTED';
    if (earnStart) {
      const end = testEnd ?? (a.actualFinish ? a.finishDate : dataDate);
      earnEnd = end ? maxISO(earnStart, end) : earnStart;
      earnWindowSource = testStart ? 'TEST WINDOW' : a.actualFinish ? 'P6 ACTUAL' : 'IN PROGRESS';
    }

    rows.push({
      activity: a,
      activityId: a.activityId,
      location: a.location,
      // Derived from the Activity ID rather than stored, so imports written by an
      // earlier version of the app group correctly without a migration.
      phase: phaseOf(a.activityId),
      phaseName: phaseLabel(phaseOf(a.activityId)),
      workType: workTypeOf(a.activityId),
      seqCode: a.seqCode,
      activityType: a.activityType,
      matchKey: match.matchKey,
      matchTier: match.tier,
      rateStatus,
      status,
      discipline: entry?.discipline ?? '',
      basis,
      loeFlag,
      needsShifts,
      complexity,
      stdHours,
      overrideHours,
      budgetHours,
      baselineStart,
      baselineFinish,
      baselineSource,
      currentStart: a.startDate,
      currentFinish: a.finishDate,
      pctComplete,
      pctSource,
      testsTotal: tp?.testsTotal ?? null,
      testsComplete: tp?.testsComplete ?? null,
      hasTestCounts: !!tp && tp.testsTotal !== undefined && tp.testsTotal !== null && tp.testsTotal > 0,
      earnedHours,
      remainingHours: budgetHours - earnedHours,
      earnStart,
      earnEnd,
      earnWindowSource,
      onPlannedCurve: budgetHours > 0 && !!baselineStart && !!baselineFinish,
      onForecastCurve: budgetHours > 0 && !!a.startDate && !!a.finishDate,
      subsystemHours,
      subsystemEarned: scaleRecord(subsystemHours, pctComplete),
    });
  }

  // Library stats.
  const libraryStats: LibraryStat[] = input.library.filter((e) => !e.retired).map((entry) => {
    const k = normKey(entry.matchKey);
    const mine = rows.filter((r) => normKey(r.matchKey) === k && r.matchTier !== null);
    // Count and total P6 days follow the workbook: every ACTIVITY row whose raw type equals the key.
    const rawMine = current.filter((a) => a.rowType === 'ACTIVITY' && normKey(a.activityType) === k);
    const basisEff = effectiveBasis(entry, settings);
    const crewEff = effectiveCrew(entry, settings);
    const shiftEff = effectiveShiftHours(entry, settings);
    return {
      matchKey: entry.matchKey,
      count: rawMine.length,
      totalP6Days: rawMine.reduce((s, a) => s + (a.originalDuration ?? 0), 0),
      include: effectiveInclude(entry),
      basisEff,
      crewEff,
      crewEffLines: crewLines(entry),
      shiftEff,
      rateStatus: libraryRateStatus(entry, settings),
      stdHoursIfRate: basisEff === 'RATE' ? crewEff * shiftEff * (entry.durationShifts ?? 0) : null,
      budgetHours: mine.reduce((s, r) => s + r.budgetHours, 0),
      entry,
    };
  });

  // Location stats.
  const locationStats: LocationStat[] = input.locations.map((loc) => {
    const k = normKey(loc.code);
    const mine = rows.filter((r) => normKey(r.location) === k);
    return {
      code: loc.code,
      count: mine.length,
      effectiveFactor: loc.complexityFactor ?? settings.defaultComplexity,
      budgetHours: mine.reduce((s, r) => s + r.budgetHours, 0),
      location: loc,
    };
  });

  // Test progress checks.
  const curIdx = firstByKey<P6Activity>(current, (a) => a.activityId);
  const rowIdx = firstByKey<BudgetRow>(rows, (r) => r.activityId);
  const testProgressChecks: TestProgressCheck[] = testProgress.map((t) => {
    const k = normKey(t.activityId);
    const r = rowIdx.get(k);
    const a = curIdx.get(k);
    return {
      activityId: t.activityId,
      matched: !!r,
      status: r ? r.status : a ? 'not budgeted' : 'not in extract',
      activityName: a ? a.activityName : null,
      pctEffective: testPctEffective(t)?.pct ?? null,
    };
  });

  // Curves.
  const dates: string[] = [];
  for (const r of rows) {
    for (const d of [r.baselineStart, r.baselineFinish, r.currentStart, r.currentFinish, r.earnStart, r.earnEnd]) {
      if (d) dates.push(d);
    }
  }
  if (dataDate) dates.push(dataDate);
  for (const s of snapshots) if (isValidISO(s.statusDate)) dates.push(s.statusDate);
  const totalBudget = rows.reduce((s, r) => s + r.budgetHours, 0);
  const snapshotMarkers: SnapshotMarker[] = snapshots.map((s) => ({
    statusDate: s.statusDate,
    earnedHours: s.lines.reduce((x, l) => x + l.earnedHours, 0),
    budgetHours: s.lines.reduce((x, l) => x + l.budgetHours, 0),
  }));
  const snapByDate = new Map<string, number>();
  for (const m of snapshotMarkers) snapByDate.set(m.statusDate, (snapByDate.get(m.statusDate) ?? 0) + m.earnedHours);

  let curve: CurvePoint[] = [];
  let periods: string[] = [];
  if (dates.length) {
    dates.sort();
    periods = monthEndsBetween(dates[0], dates[dates.length - 1]);
    curve = periods.map((p) => {
      let planned = 0;
      let forecast = 0;
      let earned = 0;
      for (const r of rows) {
        if (r.budgetHours === 0 && r.earnedHours === 0) continue;
        planned += r.budgetHours * accruedFraction(p, r.baselineStart, r.baselineFinish);
        forecast += r.budgetHours * accruedFraction(p, r.currentStart, r.currentFinish);
        earned += r.earnedHours * accruedFraction(p, r.earnStart, r.earnEnd);
      }
      const earnedOrNull = dataDate && p > dataDate ? null : earned;
      return {
        periodEnd: p,
        planned,
        forecast,
        earned: earnedOrNull,
        plannedPct: totalBudget ? planned / totalBudget : 0,
        earnedPct: earnedOrNull === null ? null : totalBudget ? earnedOrNull / totalBudget : 0,
        snapshot: snapByDate.get(p) ?? null,
      };
    });
  }

  // Summary.
  const acts = current.filter((a) => a.rowType === 'ACTIVITY');
  const count = (pred: (r: BudgetRow) => boolean) => rows.filter(pred).length;
  const earnedTotal = rows.reduce((s, r) => s + r.earnedHours, 0);
  const tpMatched = testProgress.filter((t) => rowIdx.has(normKey(t.activityId))).length;
  const latestStatus = snapshots.map((s) => s.statusDate).filter(isValidISO).sort().pop() ?? null;
  const summary: Summary = {
    extractRows: current.length,
    wbsRows: current.length - acts.length,
    activities: acts.length,
    locations: input.locations.length,
    activityTypes: input.library.filter((e) => !e.retired).length,
    typesOnDefaults: libraryStats.filter((l) => l.rateStatus === 'DEFAULT').length,
    typesNeedingShifts: libraryStats.filter((l) => l.rateStatus === 'NEEDS SHIFTS').length,
    inBudget: count((r) => r.status === 'IN BUDGET'),
    excluded: count((r) => r.status === 'EXCLUDED'),
    deletedOrCancelled: count((r) => r.status === 'DELETED' || r.status === 'CANCELLED'),
    review: count((r) => r.status === 'REVIEW'),
    totalBudgetHours: totalBudget,
    earnedHours: earnedTotal,
    remainingHours: totalBudget - earnedTotal,
    pctComplete: totalBudget ? earnedTotal / totalBudget : 0,
    baselineMatched: count((r) => r.baselineSource === 'BASELINE'),
    baselineFallback: count((r) => r.baselineSource === 'CURRENT'),
    noDates: count((r) => r.baselineSource === 'NONE'),
    pctFromTests: count((r) => r.pctSource === 'TESTS' || r.pctSource === 'OVERRIDE'),
    pctFromP6: count((r) => r.pctSource === 'P6' && r.status === 'IN BUDGET'),
    pctFromOverride: count((r) => r.pctSource === 'OVERRIDE'),
    inProgress: count((r) => r.earnWindowSource === 'IN PROGRESS'),
    p6Actual: count((r) => r.earnWindowSource === 'P6 ACTUAL'),
    testWindow: count((r) => r.earnWindowSource === 'TEST WINDOW'),
    notStarted: count((r) => r.earnWindowSource === 'NOT STARTED'),
    testProgressKeyed: testProgress.filter((t) => t.activityId.trim() !== '').length,
    testProgressNotMatching: testProgress.length - tpMatched,
    testProgressUsingOverride: testProgress.filter((t) => t.pctOverride !== undefined && t.pctOverride !== null).length,
    loeFlags: count((r) => r.loeFlag),
    rateNeedsShifts: count((r) => r.needsShifts),
    tier2Resolved: count((r) => r.matchTier === 2),
    onNoCurve: count((r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve),
    latestStatusDate: latestStatus,
    typesWithCrewSplit: libraryStats.filter((l) => l.crewEffLines.length > 0).length,
    unassignedHours: rows.reduce((s, r) => s + (r.subsystemHours[UNASSIGNED] ?? 0), 0),
  };
  if (!hasBaseline) notes.push('No baseline import. The planned curve mirrors the forecast for every activity.');
  if (summary.onNoCurve > 0) {
    notes.push(`${summary.onNoCurve} in-budget activities have hours but no usable dates. They count in the total but appear on no curve.`);
  }

  const subsystemDefs = input.subsystems ?? [];
  const subsystems = subsystemRollup(rows, subsystemDefs);
  const burn = burnSummary(rows, monthlyEarned(rows, periods, dataDate), input.teamActuals ?? [], subsystemDefs);
  if (burn.builtWithNoBudget.length) {
    notes.push(
      `Hours were built against ${burn.builtWithNoBudget.map((c) => c || 'Unassigned').join(', ')}, which hold no budget. Those hours can never be earned back.`,
    );
  }
  if (Math.abs(burn.unphasedEarned) > 0.5) {
    notes.push(
      `${Math.round(burn.unphasedEarned)} earned hours belong to no month, because those activities have no usable dates. The monthly earned-against-built rows are that much short of the project total.`,
    );
  }

  const groups: Record<GroupDim, GroupStat[]> = {
    phase: groupRows(rows, 'phase'),
    location: groupRows(rows, 'location'),
    discipline: groupRows(rows, 'discipline'),
    workType: groupRows(rows, 'workType'),
  };

  return {
    rows,
    subsystems,
    burn,
    groups,
    library: libraryStats,
    locations: locationStats,
    curve,
    snapshotMarkers,
    summary,
    testProgressChecks,
    notes,
  };
}

const DIM_VALUE: Record<GroupDim, (r: BudgetRow) => string> = {
  phase: (r) => r.phase,
  location: (r) => r.location,
  discipline: (r) => r.discipline,
  workType: (r) => r.workType,
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
  const value = DIM_VALUE[dim];
  const buckets = new Map<string, BudgetRow[]>();
  for (const r of rows) {
    const k = value(r);
    const list = buckets.get(k);
    if (list) list.push(r);
    else buckets.set(k, [r]);
  }
  const out: GroupStat[] = [];
  for (const [key, list] of buckets) {
    const inBudgetRows = list.filter((r) => r.status === 'IN BUDGET');
    const budgetHours = list.reduce((s, r) => s + r.budgetHours, 0);
    const earnedHours = list.reduce((s, r) => s + r.earnedHours, 0);
    const dates = (pick: (r: BudgetRow) => string | null) => list.map(pick).filter((d): d is string => !!d).sort();
    const starts = dates((r) => r.currentStart ?? r.baselineStart);
    const finishes = dates((r) => r.currentFinish ?? r.baselineFinish);
    out.push({
      key,
      label: DIM_LABEL[dim](key),
      activities: list.length,
      inBudget: inBudgetRows.length,
      budgetHours,
      earnedHours,
      remainingHours: budgetHours - earnedHours,
      pctComplete: budgetHours ? earnedHours / budgetHours : 0,
      notStarted: inBudgetRows.filter((r) => r.earnWindowSource === 'NOT STARTED').length,
      inProgress: inBudgetRows.filter((r) => r.earnWindowSource === 'IN PROGRESS').length,
      finished: inBudgetRows.filter((r) => r.earnWindowSource === 'P6 ACTUAL' || r.earnWindowSource === 'TEST WINDOW').length,
      withCounts: inBudgetRows.filter((r) => r.hasTestCounts).length,
      testsTotal: list.reduce((s, r) => s + (r.testsTotal ?? 0), 0),
      testsComplete: list.reduce((s, r) => s + (r.testsComplete ?? 0), 0),
      earliestStart: starts[0] ?? null,
      latestFinish: finishes[finishes.length - 1] ?? null,
    });
  }
  // Biggest budget first: that is the order someone reviewing progress wants.
  return out.sort((a, b) => b.budgetHours - a.budgetHours || a.label.localeCompare(b.label));
}

// ---------------------------------------------------------------------------
// Subsystems: who the hours belong to
// ---------------------------------------------------------------------------

export function subsystemLabel(code: string, subsystems: Subsystem[]): string {
  const c = code.trim();
  if (c === '') return 'Unassigned';
  const named = subsystems.find((s) => normKey(s.code) === normKey(c));
  return named?.name ? `${c} — ${named.name}` : c;
}

function sumRecord(rows: BudgetRow[], pick: (r: BudgetRow) => Record<string, number>): Map<string, number> {
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

// ---------------------------------------------------------------------------
// Earned per month, and earned against built
// ---------------------------------------------------------------------------

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
   * schedule, which on a five year programme is dozens of months in which nothing
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
  };
}

/** Build the snapshot that a "take snapshot" action would write, without writing it. */
export function buildSnapshot(model: Model, statusDate: string, note?: string, takenAt = new Date().toISOString()): Snapshot {
  return {
    statusDate,
    takenAt,
    note,
    lines: model.rows
      .filter((r) => r.status === 'IN BUDGET')
      .map((r) => ({
        activityId: r.activityId,
        pctComplete: r.pctComplete,
        budgetHours: r.budgetHours,
        earnedHours: r.earnedHours,
      })),
  };
}

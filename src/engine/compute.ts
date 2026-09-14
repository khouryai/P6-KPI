import type {
  ActivityOverride,
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
  Snapshot,
  SnapshotMarker,
  Summary,
  TestProgress,
  TestProgressCheck,
} from './types';
import { normKey, containsCI } from './keys';
import { indexLibrary, resolveMatchKey } from './match';
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

export function effectiveCrew(entry: LibraryEntry, settings: Settings): number {
  return entry.crewSize ?? settings.defaultCrew;
}

export function effectiveShiftHours(entry: LibraryEntry, settings: Settings): number {
  return entry.shiftHours ?? settings.defaultShiftHours;
}

export function isOnDefaults(entry: LibraryEntry): boolean {
  return (
    entry.basis === undefined &&
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

/** Standard hours for one instance of an activity under a library entry. */
export function stdHoursFor(entry: LibraryEntry, settings: Settings, originalDuration: number | null): number {
  const crew = effectiveCrew(entry, settings);
  const shift = effectiveShiftHours(entry, settings);
  if (effectiveBasis(entry, settings) === 'RATE') return crew * shift * (entry.durationShifts ?? 0);
  return crew * shift * Math.max(0, originalDuration ?? 0);
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
      earnedHours,
      remainingHours: budgetHours - earnedHours,
      earnStart,
      earnEnd,
      earnWindowSource,
      onPlannedCurve: budgetHours > 0 && !!baselineStart && !!baselineFinish,
      onForecastCurve: budgetHours > 0 && !!a.startDate && !!a.finishDate,
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
  if (dates.length) {
    dates.sort();
    const periods = monthEndsBetween(dates[0], dates[dates.length - 1]);
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
  };
  if (!hasBaseline) notes.push('No baseline import. The planned curve mirrors the forecast for every activity.');
  if (summary.onNoCurve > 0) {
    notes.push(`${summary.onNoCurve} in-budget activities have hours but no usable dates. They count in the total but appear on no curve.`);
  }

  return { rows, library: libraryStats, locations: locationStats, curve, snapshotMarkers, summary, testProgressChecks, notes };
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

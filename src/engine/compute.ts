/**
 * The model the screens read.
 *
 * `computeModel` is the one place a schedule, a rate library, the user's edits and
 * the timesheets meet. It owns the order those are resolved in and nothing else:
 * the pricing, the curves, the rollups and the earned-against-built arithmetic all
 * live in their own modules and are called from here.
 *
 * Everything those modules export is re-exported at the bottom, so a screen can go
 * on importing from `./compute` and this split stays an internal matter.
 */
import type {
  ActivityOverride,
  ActivityStatus,
  ActivityVisibility,
  BaselineSource,
  BudgetRow,
  EarnWindowSource,
  GroupDim,
  GroupStat,
  LibraryStat,
  Location,
  LocationStat,
  Model,
  ModelInput,
  P6Activity,
  PctSource,
  RateStatus,
  StaleOverride,
  Summary,
  TeamActual,
  TestProgress,
  TestProgressCheck,
  ModelBase,
} from './types';
import { normKey } from './keys';
import { indexLibrary, resolveMatchKey } from './match';
import { phaseOf, workTypeOf, phaseLabel, matchIdRule, normalisePhaseValue } from './parse';
import { isValidISO, maxISO } from './dates';
import {
  UNASSIGNED,
  allocate,
  crewLines,
  crewWeights,
  effectiveBasis,
  effectiveCrew,
  effectiveInclude,
  effectiveShiftHours,
  libraryRateStatus,
  resourceLines,
  splitDisciplines,
  stdHoursFor,
  excelRound,
} from './pricing';
import { checkReason, marksActuals, p6PctComplete, testPctEffective } from './progress';
import { buildCurve, curvePeriods } from './curve';
import { groupRows, subsystemRollup } from './rollup';
import { burnSummary, monthlyEarned } from './burn';

function scaleRecord(rec: Record<string, number>, factor: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec)) out[k] = v * factor;
  return out;
}

function firstByKey<T>(items: T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const it of items) {
    const k = normKey(key(it));
    if (k && !m.has(k)) m.set(k, it);
  }
  return m;
}

export function computeBase(input: Omit<ModelInput, 'teamActuals'>): ModelBase {
  const { settings, overrides, testProgress, current } = input;
  const notes: string[] = [];
  const libIdx = indexLibrary(input.library);
  const locIdx = firstByKey<Location>(input.locations, (l) => l.code);
  const baseIdx = firstByKey<P6Activity>((input.baseline ?? []).filter((a) => a.rowType === 'ACTIVITY'), (a) => a.activityId);
  const ovIdx = firstByKey<ActivityOverride>(overrides, (o) => o.activityId);
  const tpIdx = firstByKey<TestProgress>(testProgress, (t) => t.activityId);
  const hasBaseline = input.baseline !== null && input.baseline.length > 0;
  const dataDate = isValidISO(settings.dataDate) ? settings.dataDate : null;
  /* Asked of the file once, and handed to every row: see `p6PctComplete`. */
  const p6Opts = { marksActuals: marksActuals(current) };
  /*
   * Exceptions to how an Activity ID is read, applied here rather than at import so
   * that adding one re-groups the schedule already loaded. Nothing is rewritten on
   * disk: the import stays exactly as P6 wrote it, and the rule is a lens over it.
   */
  const idRules = (input.idRules ?? []).filter((r) => !r.disabled && r.match.trim() !== '' && r.value.trim() !== '');
  if (!dataDate) notes.push('No data date is set. In-progress work cannot earn and the earned curve has no end.');

  const allRows: BudgetRow[] = [];
  for (const a of current) {
    if (a.rowType !== 'ACTIVITY') continue;
    /*
     * What this ID is read as, before anything reads it. The complexity factor is
     * looked up by location, so a rule that moves an activity to another location
     * has to move it before the rate is picked, not after.
     */
    const locRule = matchIdRule(a.activityId, 'location', idRules);
    const phaseRule = matchIdRule(a.activityId, 'phase', idRules);
    const locationOfRow = locRule ? locRule.value.trim() : a.location;
    const phaseOfRow = phaseRule ? normalisePhaseValue(phaseRule.value) : phaseOf(a.activityId);
    const match = resolveMatchKey(a.activityType, libIdx);
    const entry = match.entry;
    const ovEarly = ovIdx.get(normKey(a.activityId));
    const visibility: ActivityVisibility | null = ovEarly?.visibility ?? null;
    const forcedIn = visibility === 'INCLUDED';
    const rateStatus: RateStatus = entry ? libraryRateStatus(entry, settings, forcedIn) : 'NO MATCH';

    /*
     * The user's decision about this one activity beats the library's decision about
     * its type, and beats P6's "(Deleted)" marker in the name. That is the whole
     * point: a schedule nobody controls should not be able to force work into or out
     * of a budget somebody is accountable for.
     *
     * INCLUDED still needs a rate. Forcing in an activity whose type is not in the
     * library would budget zero hours and read as a bug, so it stays REVIEW and says
     * what is missing instead.
     */
    let status: ActivityStatus;
    if (visibility === 'EXCLUDED') status = 'EXCLUDED';
    else if (forcedIn) status = entry ? 'IN BUDGET' : 'REVIEW';
    else if (a.excludeReason) status = a.excludeReason;
    else if (!entry) status = 'REVIEW';
    else if (effectiveInclude(entry) !== 'Y') status = 'EXCLUDED';
    else status = 'IN BUDGET';

    const inBudget = status === 'IN BUDGET' && entry !== null;
    const basis = inBudget && entry ? effectiveBasis(entry, settings) : null;
    const loc = locIdx.get(normKey(locationOfRow));
    const complexity = inBudget ? (loc?.complexityFactor ?? settings.defaultComplexity) : null;
    const stdHours = inBudget && entry ? stdHoursFor(entry, settings, a.originalDuration) : null;
    const ov = ovEarly;
    const overrideHours = inBudget && ov && ov.overrideHours !== undefined && Number.isFinite(ov.overrideHours) ? ov.overrideHours : null;
    const budgetHours = !inBudget
      ? 0
      : overrideHours !== null
        ? overrideHours
        : excelRound((stdHours ?? 0) * (complexity ?? 1));
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
    const pctComplete = tpe ? tpe.pct : p6PctComplete(a, p6Opts);
    const pctSource: PctSource = tpe ? tpe.source : 'P6';
    const earnedHours = budgetHours * pctComplete;

    // The split is of the FINAL budget figure, not of the standard hours, so an
    // override or the rounding both carry through to every subsystem proportionally.
    const subsystemHours = inBudget && entry ? allocate(budgetHours, crewWeights(entry, settings)) : { [UNASSIGNED]: 0 };
    const resources = inBudget && entry ? resourceLines(entry, settings, subsystemHours, pctComplete) : [];

    /*
     * When the work really happened, and the window its hours accrue over.
     *
     * These are two different facts and only the first of them is ever a guess-free
     * answer. `actualStart` and `actualFinish` are what somebody would point at on a
     * calendar: the test window dates if they were typed, otherwise P6's dates but
     * ONLY where P6 flags them actual — a planned finish is a forecast, not a fact,
     * and a screen that read one as the other would report work as done because the
     * plan said it would be. Either may be null; an activity that has started and
     * not finished genuinely has no actual finish.
     *
     * The earn window is the same pair with the open end closed off at the data
     * date, because hours have to accrue somewhere for an activity still running.
     * That substitution is why the two are kept apart: `earnEnd` on a running
     * activity is the data date, which is not a finish and must never be read as one.
     */
    const testStart = tp?.testStartOverride && isValidISO(tp.testStartOverride) ? tp.testStartOverride : null;
    const testEnd = tp?.testEndOverride && isValidISO(tp.testEndOverride) ? tp.testEndOverride : null;
    const progressAsOf = tp?.progressAsOf && isValidISO(tp.progressAsOf) ? tp.progressAsOf : null;
    const actualStart = testStart ?? (a.actualStart ? a.startDate : null);
    const rawFinish = testEnd ?? (a.actualFinish ? a.finishDate : null);
    const actualFinish = rawFinish && actualStart ? maxISO(actualStart, rawFinish) : rawFinish;
    const earnStart = actualStart;
    let earnEnd: string | null = null;
    let earnWindowSource: EarnWindowSource = 'NOT STARTED';
    if (earnStart) {
      /*
       * The open end. A finish closes the window; failing that, the date somebody
       * said the progress was true as at; failing that, the data date, which is the
       * app admitting it does not know and assuming the work is still going on.
       * That last assumption is the one that quietly spreads a stale activity's
       * hours across every fortnight since it started.
       */
      const end = actualFinish ?? progressAsOf ?? dataDate;
      earnEnd = end ? maxISO(earnStart, end) : earnStart;
      // Either end being yours makes it your window: a keyed test end closes the
      // window on that date, so calling it IN PROGRESS — which means "running to the
      // data date" — would name the wrong end of it.
      earnWindowSource = testStart || testEnd ? 'TEST WINDOW' : a.actualFinish ? 'P6 ACTUAL' : progressAsOf ? 'PROGRESS AS AT' : 'IN PROGRESS';
    }

    const renamed = !!ov?.nameOverride?.trim();
    const disciplineText = ov?.discipline?.trim() || entry?.discipline || '';
    allRows.push({
      activity: a,
      activityId: a.activityId,
      activityName: renamed ? ov!.nameOverride!.trim() : a.activityName,
      renamed,
      visibility,
      hidden: visibility === 'HIDDEN',
      location: locationOfRow,
      locationFromRule: !!locRule,
      // Derived from the Activity ID rather than stored, so imports written by an
      // earlier version of the app group correctly without a migration.
      phase: phaseOfRow,
      phaseFromRule: !!phaseRule,
      phaseName: phaseLabel(phaseOfRow),
      workType: workTypeOf(a.activityId),
      seqCode: a.seqCode,
      activityType: a.activityType,
      matchKey: match.matchKey,
      rateStatus,
      status,
      discipline: disciplineText,
      disciplines: splitDisciplines(disciplineText),
      basis,
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
      actualStart,
      actualFinish,
      progressAsOf,
      earnStart,
      earnEnd,
      earnWindowSource,
      onPlannedCurve: budgetHours > 0 && !!baselineStart && !!baselineFinish,
      onForecastCurve: budgetHours > 0 && !!a.startDate && !!a.finishDate,
      subsystemHours,
      subsystemEarned: scaleRecord(subsystemHours, pctComplete),
      resources,
      crewSize: resources.reduce((s, x) => s + x.count, 0),
    });
  }

  /*
   * Hidden activities leave here and never come back.
   *
   * Everything below — the library counts, the locations, the rollups, the curves,
   * the summary, the export — reads `rows`, so hiding is a single cut rather than a
   * flag every consumer has to remember to test. `hiddenRows` keeps them priced so
   * the hidden list can say what bringing one back would add to the budget.
   */
  const rows = allRows.filter((r) => !r.hidden);
  const hiddenRows = allRows.filter((r) => r.hidden);
  const hiddenIds = new Set(hiddenRows.map((r) => normKey(r.activityId)));
  /** ACTIVITY rows still in play: the extract minus what the user hid. */
  const visibleActs = current.filter((a) => a.rowType === 'ACTIVITY' && !hiddenIds.has(normKey(a.activityId)));

  // Library stats. The share is of the whole budget, so the keys that matter stand out.
  const libraryTotal = rows.reduce((s, r) => s + r.budgetHours, 0);
  const libraryStats: LibraryStat[] = input.library.filter((e) => !e.retired).map((entry) => {
    const k = normKey(entry.matchKey);
    // A row whose type did not match anything keeps its raw type as matchKey, so the
    // match has to be confirmed against a real entry rather than against the name alone.
    const mine = rows.filter((r) => normKey(r.matchKey) === k && r.status !== 'REVIEW');
    // Count and total P6 days follow the workbook: every ACTIVITY row whose raw type equals the key.
    const rawMine = visibleActs.filter((a) => normKey(a.activityType) === k);
    const mineBudget = mine.reduce((s, r) => s + r.budgetHours, 0);
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
      budgetHours: mineBudget,
      shareOfBudget: libraryTotal ? mineBudget / libraryTotal : 0,
      entry,
    };
  });

  // Location stats.
  const budgetAllRows = rows.reduce((s, r) => s + r.budgetHours, 0);
  /*
   * A rule can name a location the schedule never spelled — "anything with HTT in
   * it is at HTT" — and `locations.json` only ever learns codes discovery found. A
   * code that rows are grouped under but that appears in no list would be missing
   * from the Locations screen and unable to carry a complexity factor, so the ones
   * the rules produced are added here.
   */
  const knownLocs = new Set(input.locations.map((l) => normKey(l.code)));
  const ruleLocs: Location[] = [];
  for (const r of rows) {
    const k = normKey(r.location);
    if (!r.location || knownLocs.has(k)) continue;
    knownLocs.add(k);
    ruleLocs.push({ code: r.location });
  }
  const allLocationStats: LocationStat[] = [...input.locations, ...ruleLocs].map((loc) => {
    const k = normKey(loc.code);
    const mine = rows.filter((r) => normKey(r.location) === k);
    const budgetHours = mine.reduce((s, r) => s + r.budgetHours, 0);
    const earnedHours = mine.reduce((s, r) => s + r.earnedHours, 0);
    return {
      code: loc.code,
      count: mine.length,
      effectiveFactor: loc.complexityFactor ?? settings.defaultComplexity,
      budgetHours,
      shareOfBudget: budgetAllRows ? budgetHours / budgetAllRows : 0,
      earnedHours,
      pctComplete: budgetHours ? earnedHours / budgetHours : 0,
      location: loc,
    };
  });

  /*
   * A location with no activities is noise.
   *
   * Import discovers a location the moment one Activity ID mentions it, and never
   * removes it — the code may come back in a later schedule revision, and a
   * complexity factor typed against it should survive that. But a code carrying no
   * activities has nothing to price, nothing to roll up and nothing to say, and a
   * list padded with them makes the real ones harder to find. So they are dropped
   * here, once, and every screen and count below is computed without them. They are
   * kept on `unusedLocations` so the Locations screen can still admit they exist.
   */
  const locationStats = allLocationStats.filter((l) => l.count > 0);
  const unusedLocations = allLocationStats.filter((l) => l.count === 0);

  // Test progress checks.
  const curIdx = firstByKey<P6Activity>(current, (a) => a.activityId);
  const rowIdx = firstByKey<BudgetRow>(rows, (r) => r.activityId);
  const hiddenIdx = firstByKey<BudgetRow>(hiddenRows, (r) => r.activityId);
  const testProgressChecks: TestProgressCheck[] = testProgress.map((t) => {
    const k = normKey(t.activityId);
    const r = rowIdx.get(k);
    const hidden = hiddenIdx.get(k);
    const a = curIdx.get(k);
    const row = r ?? hidden ?? null;
    const inBudget = !!r && r.status === 'IN BUDGET';
    const status: TestProgressCheck['status'] = hidden ? 'hidden' : r ? r.status : a ? 'not budgeted' : 'not in extract';
    return {
      activityId: t.activityId,
      matched: !!r,
      inBudget,
      status,
      activityName: row ? row.activityName : a ? a.activityName : null,
      p6Name: row && row.renamed ? row.activity.activityName : null,
      rowType: a ? a.rowType : null,
      location: row?.location ?? a?.location ?? '',
      phaseName: row ? row.phaseName : a ? phaseLabel(phaseOf(a.activityId)) : '',
      activityType: row?.activityType ?? a?.activityType ?? '',
      matchKey: row ? row.matchKey : null,
      budgetHours: row ? row.budgetHours : null,
      pctOverride: t.pctOverride ?? null,
      testStartOverride: t.testStartOverride ?? null,
      testEndOverride: t.testEndOverride ?? null,
      progressAsOf: t.progressAsOf ?? null,
      note: t.note ?? '',
      updatedAt: t.updatedAt,
      pctEffective: testPctEffective(t)?.pct ?? null,
      reason: checkReason(status, a, row, inBudget),
    };
  });

  /** Overrides keyed against an Activity ID this schedule does not have. */
  const staleOverrides: StaleOverride[] = overrides
    .filter((o) => o.activityId.trim() !== '' && !curIdx.has(normKey(o.activityId)))
    .map((o) => ({
      activityId: o.activityId,
      hasHours: o.overrideHours !== undefined && Number.isFinite(o.overrideHours),
      renamed: !!o.nameOverride?.trim(),
      visibility: o.visibility ?? null,
      note: o.note ?? '',
    }));

  // Curves.
  const totalBudget = rows.reduce((s, r) => s + r.budgetHours, 0);
  /*
   * Two different grids, on purpose. The curve reports at whatever cadence the
   * review runs at — anchored on the data date, so the line ends on the day it was
   * measured. Earned-against-built is monthly because timesheets are monthly, and
   * feeding it fortnightly periods would key two rows to the same month.
   */
  const { curve } = buildCurve(rows, dataDate, settings.curveCadence ?? 'month');
  const periods = curvePeriods(rows, dataDate, 'month');

  // Summary.
  const acts = visibleActs;
  const count = (pred: (r: BudgetRow) => boolean) => rows.filter(pred).length;
  const earnedTotal = rows.reduce((s, r) => s + r.earnedHours, 0);
  const tpMatched = testProgress.filter((t) => rowIdx.has(normKey(t.activityId))).length;
  const summary: Summary = {
    extractRows: current.length - hiddenRows.length,
    wbsRows: current.filter((a) => a.rowType === 'WBS').length,
    activities: acts.length,
    locations: locationStats.length,
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
    noRemainingDuration: count(
      (r) => r.status === 'IN BUDGET' && r.activity.originalDuration !== null && r.activity.remainingDuration === null,
    ),
    pctFromP6: count((r) => r.pctSource === 'P6' && r.status === 'IN BUDGET'),
    pctFromOverride: count((r) => r.pctSource === 'OVERRIDE'),
    inProgress: count((r) => r.earnWindowSource === 'IN PROGRESS'),
    p6Actual: count((r) => r.earnWindowSource === 'P6 ACTUAL'),
    testWindow: count((r) => r.earnWindowSource === 'TEST WINDOW'),
    notStarted: count((r) => r.earnWindowSource === 'NOT STARTED'),
    testProgressKeyed: testProgress.filter((t) => t.activityId.trim() !== '').length,
    testProgressNotMatching: testProgress.length - tpMatched,
    testProgressUsingOverride: testProgress.filter((t) => t.pctOverride !== undefined && t.pctOverride !== null).length,
    rateNeedsShifts: count((r) => r.needsShifts),
    onNoCurve: count((r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve),
    typesWithCrewSplit: libraryStats.filter((l) => l.crewEffLines.length > 0).length,
    unassignedHours: rows.reduce((s, r) => s + (r.subsystemHours[UNASSIGNED] ?? 0), 0),
    hidden: hiddenRows.length,
    renamed: count((r) => r.renamed),
    forcedIn: count((r) => r.visibility === 'INCLUDED'),
    forcedInUnpriced: count((r) => r.visibility === 'INCLUDED' && r.status === 'IN BUDGET' && r.budgetHours === 0),
    forcedOut: count((r) => r.visibility === 'EXCLUDED'),
    staleOverrides: staleOverrides.length,
  };
  if (!hasBaseline) notes.push('No baseline import. The planned curve mirrors the forecast for every activity.');
  if (hiddenRows.length > 0) {
    notes.push(
      `${hiddenRows.length} ${hiddenRows.length === 1 ? 'activity is' : 'activities are'} hidden, so ${hiddenRows.length === 1 ? 'it is' : 'they are'} in no figure on any screen. Budget Master lists them and can bring them back.`,
    );
  }
  if (staleOverrides.length > 0) {
    notes.push(
      `${staleOverrides.length} of your activity edits point at an Activity ID the current schedule does not have. They are kept in case the activity returns, and do nothing until it does.`,
    );
  }
  if (summary.noRemainingDuration > 0) {
    notes.push(
      `${summary.noRemainingDuration} in-budget ${summary.noRemainingDuration === 1 ? 'activity has' : 'activities have'} no Remaining Duration in the import, so P6 can say nothing about their progress and they read 0% until somebody keys one. Check the Remaining Duration column was mapped on Import.`,
    );
  }
  if (summary.onNoCurve > 0) {
    notes.push(`${summary.onNoCurve} in-budget activities have hours but no usable dates. They count in the total but appear on no curve.`);
  }

  const subsystemDefs = input.subsystems ?? [];
  const subsystems = subsystemRollup(rows, subsystemDefs);

  const groups: Record<GroupDim, GroupStat[]> = {
    phase: groupRows(rows, 'phase'),
    location: groupRows(rows, 'location'),
    discipline: groupRows(rows, 'discipline'),
    workType: groupRows(rows, 'workType'),
  };

  return {
    rows,
    hiddenRows,
    unusedLocations,
    staleOverrides,
    subsystems,
    subsystemDefs,
    groups,
    library: libraryStats,
    locations: locationStats,
    curve,
    periods,
    dataDate,
    summary,
    testProgressChecks,
    notes,
  };
}

/**
 * Add the timesheet side to a model that already knows the schedule.
 *
 * The split is here because the two halves change at different times. Keying a
 * month of team hours cannot move an activity, re-price it or bend a curve — it can
 * only change what the completed work is being compared against. Rebuilding a
 * thousand rows and their curves to absorb one pasted column was work nobody asked
 * for, and the screens that paste team hours are the ones that do it most.
 *
 * The notes the burn produces are appended here rather than in `computeBase`, since
 * that is where the facts behind them first exist.
 */
export function attachBurn(base: ModelBase, teamActuals: TeamActual[]): Model {
  const burn = burnSummary(
    base.rows,
    monthlyEarned(base.rows, base.periods, base.dataDate),
    teamActuals,
    base.subsystemDefs,
    base.periods,
    base.dataDate,
  );
  const notes = [...base.notes];
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
  return { ...base, burn, notes };
}

/** The whole model, for callers with no reason to stage it. */
export function computeModel(input: ModelInput): Model {
  return attachBurn(computeBase(input), input.teamActuals ?? []);
}

// ---------------------------------------------------------------------------
// The engine's public surface
//
// Screens and tests import from `./compute`, and did so before this file was split
// into modules. Re-exporting here keeps that true, so the split is an internal
// matter rather than a rename that reaches every import in the application.
// ---------------------------------------------------------------------------
export * from './pricing';
export * from './progress';
export * from './curve';
export * from './rollup';
export * from './burn';

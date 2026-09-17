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
  ActivityVisibility,
  StaleOverride,
  ResourceAllocation,
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

/**
 * How well priced a library entry is.
 *
 * `forcedIn` is for a row the user pulled into the budget against the library's
 * advice. Reporting EXCLUDED there would be answering a question nobody asked: the
 * row IS in the budget, and what its reader needs to know is whether the rate
 * behind it is any good. So the include flag is skipped and the rate is judged on
 * its own.
 */
export function libraryRateStatus(entry: LibraryEntry, settings: Settings, forcedIn = false): RateStatus {
  if (!forcedIn && effectiveInclude(entry) === 'N') return 'EXCLUDED';
  /*
   * Missing shifts is checked BEFORE "on defaults", and the order is the whole
   * point. An entry with nothing set at all reads as DEFAULT, which sounds
   * harmless — but when Settings makes RATE the default basis, that same entry
   * prices every one of its activities at zero, because RATE hours are
   * crew x shift x durationShifts and durationShifts is undefined. Reporting
   * DEFAULT there hid a silent zero behind a reassuring word.
   */
  if (effectiveBasis(entry, settings) === 'RATE' && entry.durationShifts === undefined) return 'NEEDS SHIFTS';
  if (isOnDefaults(entry)) return 'DEFAULT';
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

/**
 * The Subsystem field read as a list.
 *
 * It is one free-text box on an Activity Library key, and people use it to name
 * more than one group: "ATS, IXL" or "ATS / COMMS" is an activity two groups both
 * work. Rolling that up as a single string invents a group called "ATS, IXL" that
 * is neither of them, and leaves both real groups looking smaller than they are.
 * So the text is split, and a rollup by subsystem shares the activity's hours out
 * between the names — evenly, because the box says who, not how much.
 *
 * Splitting on separators only — comma, semicolon, slash, pipe, plus. A name with
 * a space in it survives whole, and "&" and "and" are deliberately not separators:
 * "Test & Commissioning" is one group with an ampersand in its name, and cutting it
 * in half would be the app overruling what somebody typed. A name that repeats
 * itself is merged, so "ATS, ats" is one group and not a half-share each.
 */
export function splitDisciplines(text: string | undefined | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,;/|+]/)) {
    const t = part.trim();
    if (!t || seen.has(normKey(t))) continue;
    seen.add(normKey(t));
    out.push(t);
  }
  return out;
}

/**
 * What one activity is crewed with: the resource groups, their headcounts, and the
 * hours each one carries.
 *
 * The counts come from the library entry and the hours from the split that was
 * already made of THIS activity's budget, so the two can never drift: read the
 * hours off `subsystemHours` rather than recomputing them and an override or a
 * rounding residue lands on the resource lines exactly as it landed on the split.
 * An entry priced as a plain headcount yields one unnamed line, which is the
 * truthful answer — that many people, nobody has said who.
 */
export function resourceLines(
  entry: LibraryEntry,
  settings: Settings,
  budgetBy: Record<string, number>,
  pctComplete: number,
): ResourceAllocation[] {
  const shift = effectiveShiftHours(entry, settings);
  const lines = crewLines(entry);
  const byCode = new Map<string, { count: number; shiftHours: number }>();
  if (lines.length) {
    for (const l of lines) {
      const code = l.subsystem.trim();
      const prev = byCode.get(code);
      if (prev) prev.count += l.count;
      else byCode.set(code, { count: l.count, shiftHours: l.shiftHours ?? shift });
    }
  } else {
    byCode.set(UNASSIGNED, { count: entry.crewSize ?? settings.defaultCrew, shiftHours: shift });
  }
  return [...byCode].map(([code, l]) => {
    const budgetHours = budgetBy[code] ?? 0;
    return {
      code,
      label: code || 'Unassigned',
      count: l.count,
      shiftHours: l.shiftHours,
      budgetHours,
      earnedHours: budgetHours * pctComplete,
    };
  });
}

/**
 * Put an entry's crew under one subsystem, the way the Activity Library's table does.
 *
 * Nearly every activity type is one group's work, so naming that group has to be as
 * cheap as typing it. The headcount is carried across unchanged, which is what keeps
 * the budget still: a crew of two under "ATS" prices exactly as a crew of two did.
 * An empty code puts the entry back to a plain headcount.
 */
export function assignSubsystem(entry: LibraryEntry, raw: string, defaultCrew: number): Partial<LibraryEntry> {
  const code = raw.trim();
  const line = crewLines(entry)[0];
  if (!code) {
    // The number is kept only when it was said out loud, so clearing the group does
    // not quietly pin the Settings default onto the entry and make it read as priced.
    const pinned = line ? (entry.crewSize ?? (line.count === defaultCrew ? undefined : line.count)) : entry.crewSize;
    return { crew: undefined, crewSize: pinned };
  }
  const count = line?.count ?? entry.crewSize ?? defaultCrew;
  return { crew: [{ ...(line ?? {}), subsystem: code, count }], crewSize: undefined };
}

/**
 * Edit the headcount in place, whether the entry is a plain crew size or a single crew
 * line. Clearing the number on a named group falls back to the default rather than
 * dropping the group, since a line with no number is not a line.
 */
export function setCrewCount(entry: LibraryEntry, n: number | undefined, defaultCrew: number): Partial<LibraryEntry> {
  const lines = crewLines(entry);
  if (lines.length !== 1) return { crewSize: n };
  return { crew: [{ ...lines[0], count: n !== undefined && n > 0 ? n : defaultCrew }] };
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

/**
 * Why a keyed Test Progress row matches nothing, in the words a person would use.
 *
 * "0-P2-TC-W40-FA-0100 does not match" tells nobody whether deleting it loses
 * anything. What they need is which of the five quite different things happened, so
 * they can decide in one read: a WBS header pasted in by mistake is junk, an
 * activity that left the schedule may be worth keeping, and an activity that is
 * there but priced at zero is a library problem, not a test-progress problem.
 */
function checkReason(
  status: TestProgressCheck['status'],
  a: P6Activity | undefined,
  row: BudgetRow | null,
  inBudget: boolean,
): string {
  if (inBudget) return '';
  switch (status) {
    case 'not in extract':
      return 'No activity with this ID is in the current schedule. Either it was renumbered or removed in P6, or the ID was mistyped. Keeping it costs nothing and it starts counting again if the activity comes back.';
    case 'hidden':
      return 'You hid this activity, so it is out of the budget and these counts do nothing. Unhide it on Budget Master to put them back to work, or clear the row.';
    case 'not budgeted':
      return a?.rowType === 'WBS'
        ? 'This is a WBS summary header, not an activity. It can never carry hours or test counts. Safe to remove.'
        : 'This ID is in the schedule but produced no budget row, which should not happen. Worth reporting.';
    case 'REVIEW':
      return `Its activity type "${row?.activityType ?? ''}" is not priced in the Activity Library, so it budgets zero hours and nothing can be earned. Price the type and these counts start working. Do not remove it.`;
    case 'EXCLUDED':
      return row?.visibility === 'EXCLUDED'
        ? 'You marked this activity excluded, so it carries no hours. The counts are kept and do nothing until you put it back in the budget.'
        : 'Its activity type is set to exclude in the Activity Library, so it carries no hours. Include the type, or force this one activity in from Budget Master.';
    case 'DELETED':
    case 'CANCELLED':
      return `P6 marks this activity ${status.toLowerCase()} in its name, so it is out of the budget. If it is really live work, force it in from Budget Master.`;
    case 'IN BUDGET':
      return 'This activity is in the budget but carries zero hours, so the counts change nothing. Check its rate in the Activity Library.';
    default:
      return '';
  }
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
  const { settings, overrides, testProgress, current } = input;
  /*
   * A snapshot the user has taken off the curve is dropped here, once, before
   * anything reads it. That keeps it out of the markers, out of the curve's
   * `snapshot` column and out of the date range the curve spans — a hidden snapshot
   * must not be able to stretch the chart to a month nothing else reaches. The
   * record itself is untouched on disk.
   */
  const snapshots = input.snapshots.filter((s) => !s.hidden);
  const notes: string[] = [];
  const libIdx = indexLibrary(input.library);
  const locIdx = firstByKey<Location>(input.locations, (l) => l.code);
  const baseIdx = firstByKey<P6Activity>((input.baseline ?? []).filter((a) => a.rowType === 'ACTIVITY'), (a) => a.activityId);
  const ovIdx = firstByKey<ActivityOverride>(overrides, (o) => o.activityId);
  const tpIdx = firstByKey<TestProgress>(testProgress, (t) => t.activityId);
  const hasBaseline = input.baseline !== null && input.baseline.length > 0;
  const dataDate = isValidISO(settings.dataDate) ? settings.dataDate : null;
  if (!dataDate) notes.push('No data date is set. In-progress work cannot earn and the earned curve has no end.');

  const allRows: BudgetRow[] = [];
  for (const a of current) {
    if (a.rowType !== 'ACTIVITY') continue;
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
    const loc = locIdx.get(normKey(a.location));
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
    const pctComplete = tpe ? tpe.pct : p6PctComplete(a);
    const pctSource: PctSource = tpe ? tpe.source : 'P6';
    const earnedHours = budgetHours * pctComplete;

    // The split is of the FINAL budget figure, not of the standard hours, so an
    // override or the rounding both carry through to every subsystem proportionally.
    const subsystemHours = inBudget && entry ? allocate(budgetHours, crewWeights(entry, settings)) : { [UNASSIGNED]: 0 };
    const resources = inBudget && entry ? resourceLines(entry, settings, subsystemHours, pctComplete) : [];

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

    const renamed = !!ov?.nameOverride?.trim();
    const disciplineText = ov?.discipline?.trim() || entry?.discipline || '';
    allRows.push({
      activity: a,
      activityId: a.activityId,
      activityName: renamed ? ov!.nameOverride!.trim() : a.activityName,
      renamed,
      visibility,
      hidden: visibility === 'HIDDEN',
      location: a.location,
      // Derived from the Activity ID rather than stored, so imports written by an
      // earlier version of the app group correctly without a migration.
      phase: phaseOf(a.activityId),
      phaseName: phaseLabel(phaseOf(a.activityId)),
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
  const allLocationStats: LocationStat[] = input.locations.map((loc) => {
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
      testsTotal: t.testsTotal ?? null,
      testsComplete: t.testsComplete ?? null,
      pctOverride: t.pctOverride ?? null,
      testStartOverride: t.testStartOverride ?? null,
      testEndOverride: t.testEndOverride ?? null,
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
  const snapshotMarkers: SnapshotMarker[] = snapshots.map((s) => ({
    statusDate: s.statusDate,
    earnedHours: s.lines.reduce((x, l) => x + l.earnedHours, 0),
    budgetHours: s.lines.reduce((x, l) => x + l.budgetHours, 0),
  }));
  const { curve, periods } = buildCurve(rows, snapshots, dataDate);

  // Summary.
  const acts = visibleActs;
  const count = (pred: (r: BudgetRow) => boolean) => rows.filter(pred).length;
  const earnedTotal = rows.reduce((s, r) => s + r.earnedHours, 0);
  const tpMatched = testProgress.filter((t) => rowIdx.has(normKey(t.activityId))).length;
  const latestStatus = snapshots.map((s) => s.statusDate).filter(isValidISO).sort().pop() ?? null;
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
    rateNeedsShifts: count((r) => r.needsShifts),
    onNoCurve: count((r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve),
    latestStatusDate: latestStatus,
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
    hiddenRows,
    unusedLocations,
    staleOverrides,
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

/**
 * The planned, forecast and earned curves for a set of rows.
 *
 * Taking rows as an argument rather than reading the whole model is what lets the
 * dashboard draw one phase on its own: the same arithmetic runs over the subset, so
 * a phase curve can never disagree with the project curve it is part of. The
 * percentages are of the subset's own budget, because a phase at 40 per cent of its
 * own scope is the number anyone asking for a phase curve wants.
 */
export function buildCurve(
  rows: BudgetRow[],
  snapshots: Snapshot[],
  dataDate: string | null,
): { curve: CurvePoint[]; periods: string[] } {
  const dates: string[] = [];
  for (const r of rows) {
    for (const d of [r.baselineStart, r.baselineFinish, r.currentStart, r.currentFinish, r.earnStart, r.earnEnd]) {
      if (d) dates.push(d);
    }
  }
  if (dataDate) dates.push(dataDate);
  for (const s of snapshots) if (isValidISO(s.statusDate)) dates.push(s.statusDate);
  if (!dates.length) return { curve: [], periods: [] };

  // A snapshot records every activity that was in budget when it was taken. Cutting it
  // down to the rows on this curve keeps the diamonds comparable with the line they sit
  // against, instead of marking the whole project on a single phase's chart.
  const ids = new Set(rows.map((r) => normKey(r.activityId)));
  const snapByDate = new Map<string, number>();
  for (const s of snapshots) {
    const earned = s.lines.reduce((x, l) => x + (ids.has(normKey(l.activityId)) ? l.earnedHours : 0), 0);
    if (earned === 0 && !s.lines.some((l) => ids.has(normKey(l.activityId)))) continue;
    snapByDate.set(s.statusDate, (snapByDate.get(s.statusDate) ?? 0) + earned);
  }

  const totalBudget = rows.reduce((s, r) => s + r.budgetHours, 0);
  dates.sort();
  const periods = monthEndsBetween(dates[0], dates[dates.length - 1]);
  const curve = periods.map((p) => {
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
  pctFromTests: number;
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
    pctFromTests: n((r) => r.pctSource === 'TESTS' || r.pctSource === 'OVERRIDE'),
    pctFromP6: n((r) => r.pctSource === 'P6'),
  };
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

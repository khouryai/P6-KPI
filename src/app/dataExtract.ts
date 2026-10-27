/**
 * Everything in the application, as one workbook a person can read without it.
 *
 * `buildWorkbook` is the source workbook's layout, kept sheet for sheet so project
 * controls can drop it where the old spreadsheet went. This is the rest: every
 * activity with every field the screens show, hidden ones included; every split,
 * crew line, rollup, review, headcount, rule and import; and, first, a Contents
 * sheet, a Data_Dictionary that defines every column on every sheet, and a
 * Status_Codes sheet that says what every status value means.
 *
 * The definitions live beside the columns they describe — a column cannot be added
 * here without saying what it is — and a test holds every sheet, the source
 * workbook's included, to having a definition for every heading it carries.
 *
 * Kept apart from the screens for the same reason `workbookExport.ts` is: it needs
 * the spreadsheet library, and nothing reaches it except through a dynamic import.
 */
import * as XLSX from 'xlsx';
import type { ActivityVisibility, BudgetRow, Model } from '../engine/types';
import { ACTIVITY_KINDS, KIND_LABEL as KIND_NAME } from '../engine/types';
import { phaseOrder } from './scurve';
import type { StoreData } from '../storage/store';
import { formatLocationSplit } from '../engine/compute';
import { periodLog, addDays, needsReason, OUTCOMES, type PeriodActivity, type PeriodPhase } from '../engine/period';
import { capacityByMonth, DEFAULT_CAPACITY, type CapacityRow } from '../engine/capacity';
import { normKey } from '../engine/keys';
import { isValidISO } from '../engine/dates';
import { buildWorkbook } from './workbookExport';
import { effectiveReasonFor, isOutsideControl } from './missedReasons';
import { BUILD_COMMIT } from './build';

/** How a column's values are written, and so what number format the cells carry. */
export type ColumnKind = 'text' | 'date' | 'datetime' | 'hours' | 'pct' | 'factor' | 'int' | 'number' | 'flag';

const FORMAT: Record<ColumnKind, string | undefined> = {
  text: undefined,
  date: 'dd-mmm-yy',
  datetime: 'dd-mmm-yy hh:mm',
  hours: '#,##0.0',
  pct: '0.0%',
  factor: '0.00',
  int: '0',
  number: 'General',
  flag: undefined,
};

/** What the Format column of the dictionary says, in words. */
const KIND_LABEL: Record<ColumnKind, string> = {
  text: 'Text',
  date: 'Date',
  datetime: 'Date and time',
  hours: 'Man-hours',
  pct: 'Percent (0-100%)',
  factor: 'Factor (1.00 = no change)',
  int: 'Whole number',
  number: 'Number',
  flag: 'Y, or blank for no',
};

type Def = { meaning: string; kind: ColumnKind };
type Col<T> = { h: string; meaning: string; kind?: ColumnKind; v: (row: T) => unknown };

/** One sheet of the extract, with what it is for and what each of its columns means. */
export type ExtractSheet = { name: string; purpose: string; ws: XLSX.WorkSheet; columns: { header: string; def: Def }[]; rows: number; headerRow: number };

const toDate = (iso: string | null | undefined): Date | '' => {
  if (!iso) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return new Date(`${iso}T00:00:00`);
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t;
};
const flag = (b: boolean) => (b ? 'Y' : '');
const blank = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? '' : v);

/** Number formats, column widths and a filter on the heading row. */
function dress(ws: XLSX.WorkSheet, kinds: ColumnKind[], headerRow = 0): void {
  if (!ws['!ref']) return;
  const range = XLSX.utils.decode_range(ws['!ref']);
  const widths: number[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const z = FORMAT[kinds[c] ?? 'text'];
    let w = 8;
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })] as XLSX.CellObject | undefined;
      if (!cell) continue;
      if (r > headerRow && z && (cell.t === 'n' || cell.t === 'd')) cell.z = z;
      if (r >= headerRow) {
        const len = cell.t === 'd' ? 10 : cell.t === 'n' ? 10 : String(cell.v ?? '').length;
        w = Math.max(w, Math.min(60, len + 2));
      }
    }
    widths.push(w);
  }
  ws['!cols'] = widths.map((wch) => ({ wch }));
  if (range.e.r > headerRow) ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: headerRow, c: range.s.c }, e: { r: range.e.r, c: range.e.c } }) };
}

function table<T>(name: string, purpose: string, cols: Col<T>[], rows: T[]): ExtractSheet {
  const aoa: unknown[][] = [cols.map((c) => c.h), ...rows.map((r) => cols.map((c) => c.v(r) ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
  const kinds = cols.map((c) => c.kind ?? 'text');
  dress(ws, kinds);
  return { name, purpose, ws, rows: rows.length, headerRow: 0, columns: cols.map((c) => ({ header: c.h, def: { meaning: c.meaning, kind: c.kind ?? 'text' } })) };
}

const SHOW: Record<ActivityVisibility, string> = { INCLUDED: 'Include', EXCLUDED: 'Exclude', HIDDEN: 'Hide (remove)' };
const source = (edited: boolean, rule: boolean) => (edited ? 'Moved by hand' : rule ? 'Activity ID Rule' : 'Activity ID');

/**
 * What every status value means. One row per value, so a filter on Field gives the
 * key to one column, and the Appears_In column says where to look for it.
 */
export const STATUS_CODES: { field: string; value: string; meaning: string; appearsIn: string }[] = [
  { field: 'Status', value: 'IN BUDGET', meaning: 'Priced by the Activity Library and carrying budget hours.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Status', value: 'EXCLUDED', meaning: 'Listed but carrying no hours: its library key is marked not to include, or you set Show to Exclude.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Status', value: 'REVIEW', meaning: 'Its activity type has no Activity Library key, so there is no rate and no hours. Price the type, or hide the activity.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Status', value: 'DELETED', meaning: 'P6 marks the activity name (Deleted). Out of the budget unless you force it in.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Status', value: 'CANCELLED', meaning: 'P6 marks the activity name (Cancelled). Out of the budget unless you force it in.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Rate_Status', value: 'SET', meaning: 'The library key has its own rate (crew, shift and, for RATE, shifts).', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Rate_Status', value: 'DEFAULT', meaning: 'The library key is priced on the Settings defaults: nobody has set its crew or shift yet.', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Rate_Status', value: 'NEEDS SHIFTS', meaning: 'A RATE key with no number of shifts, so it prices at zero until one is set.', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Rate_Status', value: 'EXCLUDED', meaning: 'The library key is marked not to include.', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Rate_Status', value: 'NO MATCH', meaning: 'No library key matches the activity type.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Basis', value: 'RATE', meaning: 'Hours = crew x shift hours x a number of shifts you set. Does not move when the schedule does.', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Basis', value: 'DUR', meaning: 'Hours = crew x shift hours x the P6 original duration in days.', appearsIn: 'All_Activities, Budget_Master, Activity_Library' },
  { field: 'Baseline_Source', value: 'BASELINE', meaning: 'Planned dates matched in the baseline import.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Baseline_Source', value: 'CURRENT', meaning: 'Not in the baseline, so the current schedule dates stand in as the plan.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Baseline_Source', value: 'NONE', meaning: 'No usable dates at all. The hours count in the total but are on no curve.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Pct_Source', value: 'OVERRIDE', meaning: 'Percent complete was keyed by hand on Progress or the Two-Week Log.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Pct_Source', value: 'P6', meaning: 'Nobody keyed one, so it is (Original - Remaining duration) / Original duration from P6.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Earn_Window', value: 'TEST WINDOW', meaning: 'Hours accrue between an actual start or finish keyed by hand.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Earn_Window', value: 'P6 ACTUAL', meaning: 'Hours accrue between P6 actual start and actual finish.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Earn_Window', value: 'PROGRESS AS AT', meaning: 'Started, not finished; hours accrue from the actual start to the Progress as at date keyed.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Earn_Window', value: 'IN PROGRESS', meaning: 'Started, not finished; hours accrue from the actual start to the data date.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'Earn_Window', value: 'NOT STARTED', meaning: 'No actual start, so nothing has been earned on a date.', appearsIn: 'All_Activities, Budget_Master' },
  { field: 'In_Budget_Setting', value: 'Auto', meaning: 'In or out of the budget as the Activity Library decides.', appearsIn: 'All_Activities' },
  { field: 'In_Budget_Setting', value: 'Include', meaning: 'You put it in the budget, whatever the library or a P6 (Deleted) marker says.', appearsIn: 'All_Activities, Stale_Edits' },
  { field: 'In_Budget_Setting', value: 'Exclude', meaning: 'You took it out of the budget: listed, carrying no hours, out of every total and the percent complete.', appearsIn: 'All_Activities, Stale_Edits' },
  { field: 'In_Budget_Setting', value: 'Hide (remove)', meaning: 'You removed it from the program: in no total, curve or other sheet. Listed on All_Activities with Hidden = Y.', appearsIn: 'All_Activities, Stale_Edits' },
  { field: 'Review_Cause', value: 'NO KEY', meaning: 'Its activity type is not in the Activity Library, so it has no rate. Add the type to the library, or exclude or hide it.', appearsIn: 'All_Activities' },
  { field: 'Review_Cause', value: 'RETIRED KEY', meaning: 'Its activity type has a library key that was retired. Restore the key, or exclude or hide it.', appearsIn: 'All_Activities' },
  { field: 'Review_Cause', value: 'NO TYPE', meaning: 'P6 gave it no name, so there is no activity type to price it by.', appearsIn: 'All_Activities' },
  { field: 'Phase_Source / Location_Source', value: 'Activity ID', meaning: 'Read from the Activity ID: 2nd segment for phase, 4th for location.', appearsIn: 'All_Activities' },
  { field: 'Phase_Source / Location_Source', value: 'Activity ID Rule', meaning: 'An Activity ID Rule overrides what the ID says.', appearsIn: 'All_Activities' },
  { field: 'Phase_Source / Location_Source', value: 'Moved by hand', meaning: 'Moved in Budget Master. Beats a rule and the ID.', appearsIn: 'All_Activities' },
  { field: 'Outcome', value: 'COMPLETED', meaning: 'Reached 100% and finished inside the fortnight.', appearsIn: 'Two_Week_Log' },
  { field: 'Outcome', value: 'COMPLETED EARLY', meaning: 'Finished before the fortnight began; listed only because the plan still had it running.', appearsIn: 'Two_Week_Log' },
  { field: 'Outcome', value: 'STARTED', meaning: 'Began inside the fortnight and is still running.', appearsIn: 'Two_Week_Log' },
  { field: 'Outcome', value: 'CONTINUED', meaning: 'Began earlier, still running, and earned hours inside the fortnight.', appearsIn: 'Two_Week_Log' },
  { field: 'Outcome', value: 'MISSED', meaning: 'The plan had it finishing inside the fortnight. It did not finish.', appearsIn: 'Two_Week_Log' },
  { field: 'Outcome', value: 'NOT STARTED', meaning: 'The plan had it starting inside the fortnight. It never started.', appearsIn: 'Two_Week_Log' },
  { field: 'Static_Dynamic', value: 'Static', meaning: 'Static testing.', appearsIn: 'All_Activities, Activity_Locations, Activity_Resources, Two_Week_Log, KPI_By_Static_Dynamic, Budget_Master, Activity_Library' },
  { field: 'Static_Dynamic', value: 'Dynamic', meaning: 'Dynamic testing.', appearsIn: 'All_Activities, Activity_Locations, Activity_Resources, Two_Week_Log, KPI_By_Static_Dynamic, Budget_Master, Activity_Library' },
  { field: 'Static_Dynamic', value: 'Other', meaning: 'Neither, or not set yet: an activity whose key and own setting are both blank is Other.', appearsIn: 'All_Activities, Activity_Locations, Activity_Resources, Two_Week_Log, KPI_By_Static_Dynamic, Budget_Master, Activity_Library' },
  { field: 'Static_Dynamic', value: 'All', meaning: 'Static, Dynamic and Other together: the phase or project total.', appearsIn: 'KPI_By_Static_Dynamic' },
  { field: 'Static_Dynamic_Source', value: 'Set on the activity', meaning: 'Chosen for this one activity in Budget Master. Beats the library.', appearsIn: 'All_Activities' },
  { field: 'Static_Dynamic_Source', value: 'Activity Library key', meaning: 'Taken from the activity’s Activity Library key.', appearsIn: 'All_Activities' },
  { field: 'Static_Dynamic_Source', value: 'Not set', meaning: 'Set nowhere, so Other.', appearsIn: 'All_Activities' },
  { field: 'Include', value: 'Y / N', meaning: 'Whether an activity type carries hours. Types marked (by BART), (by Others) or (Deleted) default to N.', appearsIn: 'Activity_Library' },
  { field: 'Group', value: 'Unassigned', meaning: 'Hours whose crew names no resource group: the library key is priced as a plain headcount.', appearsIn: 'Resources, Activity_Resources, Earned_vs_Actual sheets' },
];

/**
 * The new sheets: everything the source workbook's layout has no room for.
 */
function extractSheets(model: Model, data: StoreData): ExtractSheet[] {
  const ovIdx = new Map(data.overrides.map((o) => [normKey(o.activityId), o]));
  const kindOf = new Map(model.rows.map((r) => [normKey(r.activityId), r.kind]));
  const tpIdx = new Map(data.testProgress.map((t) => [normKey(t.activityId), t]));
  const ov = (r: BudgetRow) => ovIdx.get(normKey(r.activityId));
  const tp = (r: BudgetRow) => tpIdx.get(normKey(r.activityId));
  const all = [...model.rows, ...model.hiddenRows];
  const out: ExtractSheet[] = [];

  out.push(
    table<BudgetRow>(
      'All_Activities',
      'Every activity in the current schedule, one row each, with every field the screens show and every edit you made. Hidden activities are included and marked; they are in no other sheet.',
      [
        { h: 'Activity_ID', meaning: 'The P6 Activity ID, trimmed. Everything joins on it.', v: (r) => r.activityId },
        { h: 'P6_Activity_ID_Raw', meaning: 'The Activity ID exactly as P6 exported it, leading spaces intact.', v: (r) => r.activity.rawActivityId },
        { h: 'Activity_Name', meaning: 'The name every screen shows: your rename if there is one, otherwise P6’s.', v: (r) => r.activityName },
        { h: 'P6_Activity_Name', meaning: 'The name P6 exported. It still decides the activity type, so a rename never re-prices.', v: (r) => r.activity.activityName },
        { h: 'Renamed', meaning: 'Y when you renamed the activity in Budget Master.', kind: 'flag', v: (r) => flag(r.renamed) },
        { h: 'In_Budget_Setting', meaning: 'What you set in Budget Master’s In budget? column. See Status_Codes.', v: (r) => (r.visibility ? SHOW[r.visibility] : 'Auto') },
        { h: 'Hidden', meaning: 'Y when hidden: out of every total and every other sheet.', kind: 'flag', v: (r) => flag(r.hidden) },
        { h: 'Status', meaning: 'Whether the activity is in the budget, and if not why. See Status_Codes.', v: (r) => r.status },
        { h: 'Status_Reason', meaning: 'Why the status is what it is, and what to do about it. Blank for an activity in the budget carrying hours.', v: (r) => r.statusReason },
        { h: 'Review_Cause', meaning: 'For an activity in REVIEW, why it has no rate. See Status_Codes.', v: (r) => r.reviewCause ?? '' },
        { h: 'Hours_If_Priced', meaning: 'For an activity in REVIEW, the hours it would carry if its type were priced on the default rate.', kind: 'hours', v: (r) => blank(r.hoursIfPriced) },
        { h: 'In_Percent_Complete', meaning: 'Y when the activity is in the budget, so its hours are in the percent complete on the Dashboard.', kind: 'flag', v: (r) => flag(!r.hidden && r.status === 'IN BUDGET') },
        { h: 'Rate_Status', meaning: 'How completely its Activity Library key is priced. See Status_Codes.', v: (r) => r.rateStatus },
        { h: 'Phase_Code', meaning: 'The phase key, e.g. P2: the 2nd segment of the Activity ID unless a rule or a move says otherwise.', v: (r) => r.phase },
        { h: 'Phase', meaning: 'The phase as reported, e.g. Phase 2.', v: (r) => r.phaseName },
        { h: 'Phase_Source', meaning: 'Where the phase came from. See Status_Codes.', v: (r) => source(r.phaseEdited, r.phaseFromRule) },
        { h: 'Work_Type', meaning: '3rd segment of the Activity ID: TC is test and commissioning, AC acceptance.', v: (r) => r.workType },
        { h: 'Static_Dynamic', meaning: 'Static, Dynamic or Other: the activity’s own setting in Budget Master, else its Activity Library key’s, else Other. See Status_Codes.', v: (r) => KIND_NAME[r.kind] },
        { h: 'Static_Dynamic_Source', meaning: 'Where Static_Dynamic came from. See Status_Codes.', v: (r) => (r.kindSource === 'activity' ? 'Set on the activity' : r.kindSource === 'library' ? 'Activity Library key' : 'Not set') },
        { h: 'Location_Code', meaning: 'The location code: the 4th segment of the Activity ID unless a rule or a move says otherwise. Where a split leaves a share.', v: (r) => r.location },
        { h: 'Location_Name', meaning: 'The location as reported: its name from the Locations screen (the code where it has none), with every share when split.', v: (r) => r.locationName },
        { h: 'Location_Source', meaning: 'Where the location code came from. See Status_Codes.', v: (r) => source(r.locationEdited, r.locationFromRule) },
        { h: 'Location_Split', meaning: 'The split across locations, by code, e.g. W40 50%, 2W 50%. Blank when the activity is all at one location. Activity_Locations has one row per share.', v: (r) => (r.locationSplit ? formatLocationSplit(r.locationShares) : '') },
        { h: 'Seq_Code', meaning: 'The trailing segments of the Activity ID, e.g. FA-0100.', v: (r) => r.seqCode },
        { h: 'Activity_Type', meaning: 'The activity type read from the P6 name, stripped of its location and phase prefix.', v: (r) => r.activityType },
        { h: 'Match_Key', meaning: 'The Activity Library key the type resolved to. The raw type where nothing matched.', v: (r) => r.matchKey },
        { h: 'Subsystem', meaning: 'The resource group(s) the activity belongs to, from the library key or your override. Several are comma-separated and share the hours evenly.', v: (r) => r.discipline },
        { h: 'Resources', meaning: 'Who the activity is crewed with and how many of each, from the library key’s crew. Activity_Resources has one row per line.', v: (r) => r.resources.map((x) => `${x.label} x${x.count}`).join(', ') },
        { h: 'Crew_Size', meaning: 'Heads on the activity across every resource line.', kind: 'int', v: (r) => r.crewSize },
        { h: 'Basis', meaning: 'How the hours are priced. See Status_Codes.', v: (r) => r.basis ?? '' },
        { h: 'Original_Duration', meaning: 'P6 original duration, in working days.', kind: 'number', v: (r) => blank(r.activity.originalDuration) },
        { h: 'Remaining_Duration', meaning: 'P6 remaining duration, in working days.', kind: 'number', v: (r) => blank(r.activity.remainingDuration) },
        { h: 'Complexity', meaning: 'The location complexity factor applied to standard hours; share-weighted across a split.', kind: 'factor', v: (r) => blank(r.complexity) },
        { h: 'Std_Hours', meaning: 'Standard hours from the rate, before the complexity factor.', kind: 'hours', v: (r) => blank(r.stdHours) },
        { h: 'Override_Hours', meaning: 'Budget hours you typed in place of the calculated figure. Bypasses the complexity factor.', kind: 'hours', v: (r) => blank(r.overrideHours) },
        { h: 'Budget_Hours', meaning: 'The activity’s budget: the override where there is one, otherwise standard hours x complexity, rounded.', kind: 'hours', v: (r) => r.budgetHours },
        { h: 'Pct_Complete', meaning: 'How complete the activity is.', kind: 'pct', v: (r) => r.pctComplete },
        { h: 'Pct_Source', meaning: 'Where the percent complete came from. See Status_Codes.', v: (r) => r.pctSource },
        { h: 'Earned_Hours', meaning: 'Budget hours x percent complete.', kind: 'hours', v: (r) => r.earnedHours },
        { h: 'Remaining_Hours', meaning: 'Budget hours not yet earned.', kind: 'hours', v: (r) => r.remainingHours },
        { h: 'Baseline_Start', meaning: 'Planned start the planned curve uses: the baseline’s, or the current schedule’s where the baseline lacks it.', kind: 'date', v: (r) => toDate(r.baselineStart) },
        { h: 'Baseline_Finish', meaning: 'Planned finish the planned curve uses.', kind: 'date', v: (r) => toDate(r.baselineFinish) },
        { h: 'Baseline_Source', meaning: 'Where the planned dates came from. See Status_Codes.', v: (r) => r.baselineSource },
        { h: 'Current_Start', meaning: 'Start used for the forecast: a date you keyed, otherwise P6’s.', kind: 'date', v: (r) => toDate(r.currentStart) },
        { h: 'Current_Finish', meaning: 'Finish used for the forecast: a date you keyed, otherwise P6’s.', kind: 'date', v: (r) => toDate(r.currentFinish) },
        { h: 'P6_Start', meaning: 'The start P6 exported.', kind: 'date', v: (r) => toDate(r.activity.startDate) },
        { h: 'P6_Finish', meaning: 'The finish P6 exported.', kind: 'date', v: (r) => toDate(r.activity.finishDate) },
        { h: 'Dates_Changed', meaning: 'Y when you keyed a start or finish over P6’s in Budget Master.', kind: 'flag', v: (r) => flag(r.datesEdited) },
        { h: 'P6_Now_Agrees', meaning: 'Y when a later import carries the dates you keyed, so yours can be cleared.', kind: 'flag', v: (r) => flag(r.p6Agrees) },
        { h: 'Date_Note', meaning: 'Why the dates were changed: what to raise with the scheduler.', v: (r) => r.dateNote },
        { h: 'Actual_Start', meaning: 'When the work really began: a date keyed by hand, otherwise P6’s start where P6 flags it actual.', kind: 'date', v: (r) => toDate(r.actualStart) },
        { h: 'Actual_Finish', meaning: 'When the work really finished. Blank while it is running.', kind: 'date', v: (r) => toDate(r.actualFinish) },
        { h: 'Progress_As_At', meaning: 'The date the percent complete was true as at, for an activity still running.', kind: 'date', v: (r) => toDate(r.progressAsOf) },
        { h: 'Earn_Start', meaning: 'First day the activity accrues earned hours.', kind: 'date', v: (r) => toDate(r.earnStart) },
        { h: 'Earn_End', meaning: 'Last day it accrues earned hours; the data date for one still running. Not a finish.', kind: 'date', v: (r) => toDate(r.earnEnd) },
        { h: 'Earn_Window', meaning: 'Which dates the earned hours accrue between. See Status_Codes.', v: (r) => r.earnWindowSource },
        { h: 'On_Planned_Curve', meaning: 'Y when the activity has hours and planned dates, so it is on the planned S-curve.', kind: 'flag', v: (r) => flag(r.onPlannedCurve) },
        { h: 'On_Forecast_Curve', meaning: 'Y when it has hours and current dates, so it is on the forecast S-curve.', kind: 'flag', v: (r) => flag(r.onForecastCurve) },
        { h: 'Progress_Note', meaning: 'The progress note written on Progress or the Two-Week Log.', v: (r) => tp(r)?.note ?? '' },
        { h: 'Budget_Note', meaning: 'The Budget Master note: why the activity was renamed, hidden, excluded or re-priced.', v: (r) => ov(r)?.note ?? '' },
        { h: 'Edited_At', meaning: 'When an edit of yours on this activity (Budget Master) was last made.', kind: 'datetime', v: (r) => toDate(ov(r)?.updatedAt) },
        { h: 'Progress_Keyed_At', meaning: 'When its progress (percent, actual dates, note) was last keyed.', kind: 'datetime', v: (r) => toDate(tp(r)?.updatedAt) },
        // What only an XER carries. Blank throughout after an Excel import, never zero.
        { h: 'P6_Status', meaning: 'P6’s own activity status at its data date. Blank unless the schedule was imported from an XER.', v: (r) => r.activity.p6?.status ?? '' },
        { h: 'P6_Total_Float_Days', meaning: 'Total float in working days on the activity’s calendar, from the XER. Blank once complete, and after an Excel import.', kind: 'number', v: (r) => blank(r.activity.p6?.totalFloat) },
        { h: 'P6_Free_Float_Days', meaning: 'Free float in working days: how far it can slip before delaying a successor. From the XER.', kind: 'number', v: (r) => blank(r.activity.p6?.freeFloat) },
        { h: 'P6_Critical', meaning: 'Y when critical the way the project defines it in P6 (float at or under its threshold, or on the longest path).', kind: 'flag', v: (r) => flag(!!r.activity.p6?.critical) },
        { h: 'P6_Late_Start', meaning: 'The latest the activity can start without delaying the project, from the XER.', kind: 'date', v: (r) => toDate(r.activity.p6?.lateStart) },
        { h: 'P6_Late_Finish', meaning: 'The latest the activity can finish without delaying the project, from the XER.', kind: 'date', v: (r) => toDate(r.activity.p6?.lateFinish) },
        { h: 'P6_Constraint', meaning: 'The activity’s own constraint in P6, e.g. Start On or After, from the XER.', v: (r) => r.activity.p6?.constraint ?? '' },
        { h: 'P6_Constraint_Date', meaning: 'The date that constraint holds it to.', kind: 'date', v: (r) => toDate(r.activity.p6?.constraintDate) },
        { h: 'P6_Pct_Complete', meaning: 'P6’s own percent complete for the activity’s percent complete type. The budget’s Pct_Complete is separate.', kind: 'pct', v: (r) => (r.activity.p6 ? r.activity.p6.p6Pct : '') },
        { h: 'P6_WBS', meaning: 'Where the activity sits in the P6 work breakdown structure, as a path of names.', v: (r) => r.activity.p6?.wbs ?? '' },
        { h: 'P6_Predecessors', meaning: 'How many predecessors the activity has in the P6 logic.', kind: 'int', v: (r) => blank(r.activity.p6?.preds) },
        { h: 'P6_Successors', meaning: 'How many successors the activity has in the P6 logic.', kind: 'int', v: (r) => blank(r.activity.p6?.succs) },
        { h: 'P6_Open_Predecessors', meaning: 'Predecessors not yet finished: what the activity is still waiting on. P6_Waiting_On lists them.', kind: 'int', v: (r) => blank(r.activity.p6?.waitingOnCount) },
        { h: 'P6_Waiting_On_Outside_TC', meaning: 'Y when at least one open predecessor is outside the T&C scope: somebody else’s work.', kind: 'flag', v: (r) => flag(!!r.activity.p6?.waitingOn.some((l) => !l.inScope)) },
        { h: 'P6_Planned_Labour_Hours', meaning: 'Labour hours P6 plans on the activity through its resource assignments. Built separately from Budget_Hours.', kind: 'hours', v: (r) => (r.activity.p6 && r.activity.p6.resources.length ? r.activity.p6.resources.reduce((n, l) => n + l.budget, 0) : '') },
      ],
      all,
    ),
  );

  type OpenLink = { r: BudgetRow; l: NonNullable<BudgetRow['activity']['p6']>['waitingOn'][number] };
  out.push(
    table<OpenLink>(
      'P6_Waiting_On',
      'One row per predecessor still open on an activity, from the logic in the XER: what each activity is waiting on, whose work that is, and whether it is the one holding the date. Empty after an Excel import, which carries no logic.',
      [
        { h: 'Activity_ID', meaning: 'The P6 Activity ID of the activity that is waiting.', v: (x) => x.r.activityId },
        { h: 'Activity_Name', meaning: 'Its name as reported.', v: (x) => x.r.activityName },
        { h: 'Phase', meaning: 'Its phase as reported.', v: (x) => x.r.phaseName },
        { h: 'Current_Start', meaning: 'Its start as the forecast uses it.', kind: 'date', v: (x) => toDate(x.r.currentStart) },
        { h: 'Predecessor_ID', meaning: 'The Activity ID of the predecessor still open.', v: (x) => x.l.id },
        { h: 'Predecessor_Name', meaning: 'The predecessor’s name in P6.', v: (x) => x.l.name },
        { h: 'Relationship', meaning: 'FS, SS, FF or SF: which end of the predecessor drives which end of the activity.', v: (x) => x.l.rel },
        { h: 'Lag_Days', meaning: 'Lag on the relationship in working days; negative is a lead.', kind: 'number', v: (x) => x.l.lagDays },
        { h: 'Predecessor_Status', meaning: 'The predecessor’s P6 status.', v: (x) => x.l.status },
        { h: 'Predecessor_Finish', meaning: 'When the predecessor is forecast to finish (actual where it has).', kind: 'date', v: (x) => toDate(x.l.finish) },
        { h: 'In_TC_Scope', meaning: 'Y when the predecessor is itself T&C work; blank when it is somebody else’s.', kind: 'flag', v: (x) => flag(x.l.inScope) },
        { h: 'Whose', meaning: 'Whose work the predecessor is, as near as the file says: the work type in its Activity ID, or its WBS.', v: (x) => x.l.group },
        { h: 'Predecessor_WBS', meaning: 'The predecessor’s WBS as a path of names.', v: (x) => x.l.wbs },
        { h: 'Driving', meaning: 'Y when no working time separates the two: this predecessor is what holds the activity’s date.', kind: 'flag', v: (x) => flag(x.l.driving) },
      ],
      model.rows.flatMap((r) => (r.activity.p6?.waitingOn ?? []).map((l) => ({ r, l }))),
    ),
  );

  type LocShare = { r: BudgetRow; code: string; name: string; share: number };
  out.push(
    table<LocShare>(
      'Activity_Locations',
      'One row per activity per location it is reported under. An activity at one location has one row with a share of 100%; a split activity has one row per share. Sum the hours by location for any cut the rollups do not give.',
      [
        { h: 'Activity_ID', meaning: 'The P6 Activity ID.', v: (x) => x.r.activityId },
        { h: 'Activity_Name', meaning: 'The name as reported.', v: (x) => x.r.activityName },
        { h: 'Phase', meaning: 'The phase as reported.', v: (x) => x.r.phaseName },
        { h: 'Static_Dynamic', meaning: 'Static, Dynamic or Other. See Status_Codes.', v: (x) => KIND_NAME[x.r.kind] },
        { h: 'Location_Code', meaning: 'The location code of this share.', v: (x) => x.code },
        { h: 'Location_Name', meaning: 'That location’s name from the Locations screen, or the code where it has none.', v: (x) => x.name },
        { h: 'Share', meaning: 'This location’s share of the activity. The shares of one activity add to 100%.', kind: 'pct', v: (x) => x.share },
        { h: 'Split', meaning: 'Y when the activity is split across locations.', kind: 'flag', v: (x) => flag(x.r.locationSplit) },
        { h: 'Status', meaning: 'The activity’s status. See Status_Codes.', v: (x) => x.r.status },
        { h: 'Budget_Hours_Here', meaning: 'The activity’s budget hours x this share.', kind: 'hours', v: (x) => x.r.budgetHours * x.share },
        { h: 'Earned_Hours_Here', meaning: 'The activity’s earned hours x this share.', kind: 'hours', v: (x) => x.r.earnedHours * x.share },
        { h: 'Remaining_Hours_Here', meaning: 'The activity’s remaining hours x this share.', kind: 'hours', v: (x) => x.r.remainingHours * x.share },
        { h: 'Pct_Complete', meaning: 'The activity’s percent complete; the same at each of its locations.', kind: 'pct', v: (x) => x.r.pctComplete },
      ],
      model.rows.flatMap((r) => r.locationShares.map((s) => ({ r, ...s }))),
    ),
  );

  type ResLine = { r: BudgetRow; x: BudgetRow['resources'][number] };
  out.push(
    table<ResLine>(
      'Activity_Resources',
      'One row per activity per resource group on its crew: how many of them, and that group’s share of the activity’s hours. The hours add back to each activity’s budget.',
      [
        { h: 'Activity_ID', meaning: 'The P6 Activity ID.', v: (l) => l.r.activityId },
        { h: 'Activity_Name', meaning: 'The name as reported.', v: (l) => l.r.activityName },
        { h: 'Phase', meaning: 'The phase as reported.', v: (l) => l.r.phaseName },
        { h: 'Static_Dynamic', meaning: 'Static, Dynamic or Other. See Status_Codes.', v: (l) => KIND_NAME[l.r.kind] },
        { h: 'Location_Name', meaning: 'The location as reported.', v: (l) => l.r.locationName },
        { h: 'Resource_Code', meaning: 'The resource group code, e.g. ATS. Blank when the type is priced as a plain headcount.', v: (l) => l.x.code },
        { h: 'Resource', meaning: 'The resource group as reported, or Unassigned.', v: (l) => l.x.label },
        { h: 'Heads', meaning: 'How many of this group the activity asks for.', kind: 'number', v: (l) => l.x.count },
        { h: 'Shift_Hours', meaning: 'Hours in one shift for this line.', kind: 'number', v: (l) => l.x.shiftHours },
        { h: 'Budget_Hours', meaning: 'This group’s share of the activity’s budget hours.', kind: 'hours', v: (l) => l.x.budgetHours },
        { h: 'Earned_Hours', meaning: 'This group’s share of the activity’s earned hours.', kind: 'hours', v: (l) => l.x.earnedHours },
      ],
      model.rows.flatMap((r) => r.resources.map((x) => ({ r, x }))),
    ),
  );

  /*
   * The KPIs split by Static / Dynamic, phase by phase and for the whole project.
   * Every phase has a row for each of the three, even one carrying nothing, so the
   * sheet reads the same shape every time it is opened.
   */
  type KpiRow = { phase: string; kind: string; rows: BudgetRow[] };
  const phases = [...new Map(model.rows.map((r) => [r.phase, r.phaseName])).entries()].sort((a, b) => phaseOrder(a[0]) - phaseOrder(b[0]) || a[1].localeCompare(b[1]));
  const kpiRows: KpiRow[] = [
    ...[['', 'Whole project'] as [string, string], ...phases].flatMap(([key, name]) => {
      const inPhase = key === '' && name === 'Whole project' ? model.rows : model.rows.filter((r) => r.phase === key);
      return [...ACTIVITY_KINDS.map((k) => ({ phase: name || 'No phase in the ID', kind: KIND_NAME[k], rows: inPhase.filter((r) => r.kind === k) })), { phase: name || 'No phase in the ID', kind: 'All', rows: inPhase }];
    }),
  ];
  const sum = (rs: BudgetRow[], f: (r: BudgetRow) => number) => rs.reduce((s, r) => s + f(r), 0);
  out.push(
    table<KpiRow>(
      'KPI_By_Static_Dynamic',
      'The KPIs split by Static / Dynamic: for the whole project and each phase, a row each for Static, Dynamic and Other, and one for all three together. Percentages are of that row’s own budget.',
      [
        { h: 'Phase', meaning: 'The phase as reported, or Whole project.', v: (x) => x.phase },
        { h: 'Static_Dynamic', meaning: 'Static, Dynamic, Other, or All for the three together. See Status_Codes.', v: (x) => x.kind },
        { h: 'In_Budget', meaning: 'Activities in the budget.', kind: 'int', v: (x) => x.rows.filter((r) => r.status === 'IN BUDGET').length },
        { h: 'Budget_Hours', meaning: 'Budget hours.', kind: 'hours', v: (x) => sum(x.rows, (r) => r.budgetHours) },
        { h: 'Earned_Hours', meaning: 'Earned hours.', kind: 'hours', v: (x) => sum(x.rows, (r) => r.earnedHours) },
        { h: 'Remaining_Hours', meaning: 'Budget hours not yet earned.', kind: 'hours', v: (x) => sum(x.rows, (r) => r.remainingHours) },
        { h: 'Pct_Complete', meaning: 'Earned over budget hours, for this row alone.', kind: 'pct', v: (x) => { const b = sum(x.rows, (r) => r.budgetHours); return b ? sum(x.rows, (r) => r.earnedHours) / b : ''; } },
        { h: 'Share_Of_Phase_Budget', meaning: 'This row’s budget as a share of its phase’s (or the project’s) whole budget.', kind: 'pct', v: (x) => { const whole = sum(x.phase === 'Whole project' ? model.rows : model.rows.filter((r) => r.phaseName === x.phase), (r) => r.budgetHours); return whole ? sum(x.rows, (r) => r.budgetHours) / whole : ''; } },
        { h: 'Not_Started', meaning: 'In-budget activities not yet begun.', kind: 'int', v: (x) => x.rows.filter((r) => r.status === 'IN BUDGET' && r.earnWindowSource === 'NOT STARTED').length },
        { h: 'In_Progress', meaning: 'In-budget activities started and not finished.', kind: 'int', v: (x) => x.rows.filter((r) => r.status === 'IN BUDGET' && (r.earnWindowSource === 'IN PROGRESS' || r.earnWindowSource === 'PROGRESS AS AT')).length },
        { h: 'Finished', meaning: 'In-budget activities with an actual finish.', kind: 'int', v: (x) => x.rows.filter((r) => r.status === 'IN BUDGET' && !!r.actualFinish).length },
      ],
      kpiRows,
    ),
  );

  const DIM_NAME = { phase: 'Phase', location: 'Location', discipline: 'Subsystem', workType: 'Work type', kind: 'Static / Dynamic' } as const;
  type G = { dim: keyof typeof DIM_NAME; g: Model['groups']['phase'][number] };
  out.push(
    table<G>(
      'Rollups',
      'The budget rolled up by phase, location, subsystem and work type: the By Phase & Location screen. Within one Dimension the hours add to the budget; an activity shared between groups counts in each.',
      [
        { h: 'Dimension', meaning: 'What the budget is cut by: Phase, Location, Subsystem or Work type. Filter on it.', v: (x) => DIM_NAME[x.dim] },
        { h: 'Key', meaning: 'The group’s code: P2, W40, ATS, TC.', v: (x) => x.g.key },
        { h: 'Group', meaning: 'The group as reported: Phase 2, a location’s name, a subsystem.', v: (x) => x.g.label },
        { h: 'Activities', meaning: 'Activities with any part of their hours in the group.', kind: 'int', v: (x) => x.g.activities },
        { h: 'Shared_Activities', meaning: 'Of those, the ones carrying only part of their hours here (split locations, several subsystems).', kind: 'int', v: (x) => x.g.shared },
        { h: 'In_Budget', meaning: 'Activities in the group carrying hours.', kind: 'int', v: (x) => x.g.inBudget },
        { h: 'Budget_Hours', meaning: 'Budget hours in the group.', kind: 'hours', v: (x) => x.g.budgetHours },
        { h: 'Earned_Hours', meaning: 'Earned hours in the group.', kind: 'hours', v: (x) => x.g.earnedHours },
        { h: 'Remaining_Hours', meaning: 'Budget hours not yet earned.', kind: 'hours', v: (x) => x.g.remainingHours },
        { h: 'Pct_Complete', meaning: 'Earned over budget hours.', kind: 'pct', v: (x) => x.g.pctComplete },
        { h: 'Share_Of_Budget', meaning: 'The group’s budget as a share of the whole budget.', kind: 'pct', v: (x) => x.g.shareOfBudget },
        { h: 'Not_Started', meaning: 'In-budget activities not yet begun.', kind: 'int', v: (x) => x.g.notStarted },
        { h: 'In_Progress', meaning: 'In-budget activities started and not finished.', kind: 'int', v: (x) => x.g.inProgress },
        { h: 'Finished', meaning: 'In-budget activities with an actual finish.', kind: 'int', v: (x) => x.g.finished },
        { h: 'Pct_Keyed', meaning: 'In-budget activities whose percent complete was keyed by hand.', kind: 'int', v: (x) => x.g.withKeyedPct },
        { h: 'First_Start', meaning: 'Earliest start in the group (current schedule, else planned).', kind: 'date', v: (x) => toDate(x.g.earliestStart) },
        { h: 'Last_Finish', meaning: 'Latest finish in the group (current schedule, else planned).', kind: 'date', v: (x) => toDate(x.g.latestFinish) },
      ],
      (Object.keys(DIM_NAME) as (keyof typeof DIM_NAME)[]).flatMap((dim) => model.groups[dim].map((g) => ({ dim, g }))),
    ),
  );

  out.push(
    table<Model['subsystems'][number]>(
      'Resources',
      'Hours by resource group, from the crews on the Activity Library keys: the Resources screen. The hours add to the budget; the activity counts overlap, since one activity can need several groups.',
      [
        { h: 'Resource_Code', meaning: 'The resource group code. Blank is Unassigned.', v: (s) => s.code },
        { h: 'Resource', meaning: 'The group as reported, with its name where one is set.', v: (s) => s.label },
        { h: 'Activities', meaning: 'Activities drawing on this group.', kind: 'int', v: (s) => s.activities },
        { h: 'Budget_Hours', meaning: 'This group’s budget hours.', kind: 'hours', v: (s) => s.budgetHours },
        { h: 'Earned_Hours', meaning: 'This group’s earned hours.', kind: 'hours', v: (s) => s.earnedHours },
        { h: 'Remaining_Hours', meaning: 'This group’s budget hours not yet earned.', kind: 'hours', v: (s) => s.remainingHours },
        { h: 'Pct_Complete', meaning: 'Earned over budget hours.', kind: 'pct', v: (s) => s.pctComplete },
        { h: 'Share_Of_Budget', meaning: 'This group’s share of the whole budget.', kind: 'pct', v: (s) => s.shareOfBudget },
      ],
      model.subsystems,
    ),
  );

  type Cut = { s: Model['subsystems'][number]; cut: 'Phase' | 'Location'; c: Model['subsystems'][number]['byPhase'][number] };
  out.push(
    table<Cut>(
      'Resource_Cuts',
      'Each resource group’s hours cut by phase and by location. A split activity puts each share of its hours at each location.',
      [
        { h: 'Resource', meaning: 'The resource group as reported.', v: (x) => x.s.label },
        { h: 'Cut', meaning: 'Phase or Location.', v: (x) => x.cut },
        { h: 'Key', meaning: 'The phase or location code.', v: (x) => x.c.key },
        { h: 'Group', meaning: 'The phase or location as reported.', v: (x) => x.c.label },
        { h: 'Budget_Hours', meaning: 'This group’s budget hours there.', kind: 'hours', v: (x) => x.c.budgetHours },
        { h: 'Earned_Hours', meaning: 'This group’s earned hours there.', kind: 'hours', v: (x) => x.c.earnedHours },
        { h: 'Pct_Complete', meaning: 'Earned over budget hours.', kind: 'pct', v: (x) => x.c.pctComplete },
      ],
      model.subsystems.flatMap((s) => [
        ...s.byPhase.map((c) => ({ s, cut: 'Phase' as const, c })),
        ...s.byLocation.map((c) => ({ s, cut: 'Location' as const, c })),
      ]),
    ),
  );

  /*
   * The fortnight to the data date, against the baseline. The Two-Week Log can be
   * stepped to any period and measured against a schedule update; an export has to
   * pick one, and the fortnight ending on the data date is the one every review is
   * about. The reason given for a miss is the one the log would show for it.
   */
  const dataDate = isValidISO(data.settings.dataDate) ? data.settings.dataDate : null;
  const log = dataDate ? periodLog(model.rows, addDays(dataDate, -13), dataDate) : null;
  // Only a row still owed an answer carries one: anything with an actual start or finish is under way or done.
  const reasonOf = (a: PeriodActivity) => (log && needsReason(a) ? effectiveReasonFor(data.missedReasons, a.activityId, log.to) : undefined);
  const periodLabel = log ? `${log.from} to ${log.to}` : 'No data date set';
  out.push(
    table<PeriodActivity>(
      'Two_Week_Log',
      `The fortnight ending on the data date (${periodLabel}), measured against the baseline: every activity that was planned in it or moved in it, and why each missed one was missed.`,
      [
        { h: 'Period_From', meaning: 'First day of the fortnight.', kind: 'date', v: () => toDate(log?.from) },
        { h: 'Period_To', meaning: 'Last day of the fortnight: the data date.', kind: 'date', v: () => toDate(log?.to) },
        { h: 'Activity_ID', meaning: 'The P6 Activity ID.', v: (a) => a.activityId },
        { h: 'Activity_Name', meaning: 'The name as reported.', v: (a) => a.activityName },
        { h: 'Phase', meaning: 'The phase as reported.', v: (a) => a.phaseName },
        { h: 'Static_Dynamic', meaning: 'Static, Dynamic or Other. See Status_Codes.', v: (a) => KIND_NAME[kindOf.get(normKey(a.activityId)) ?? 'OTHER'] },
        { h: 'Location_Name', meaning: 'The location as reported.', v: (a) => a.locationName },
        { h: 'Outcome', meaning: 'What happened to the activity in the fortnight. See Status_Codes.', v: (a) => a.outcome },
        { h: 'Planned_Hours', meaning: 'Budget hours the baseline planned to accrue inside the fortnight.', kind: 'hours', v: (a) => a.plannedHours },
        { h: 'Earned_Hours', meaning: 'Budget hours actually earned inside the fortnight.', kind: 'hours', v: (a) => a.earnedHours },
        { h: 'Shortfall_Hours', meaning: 'Planned minus earned, where earned fell short. Blank otherwise.', kind: 'hours', v: (a) => (a.plannedHours > a.earnedHours ? a.plannedHours - a.earnedHours : '') },
        { h: 'Budget_Hours', meaning: 'The whole activity’s budget.', kind: 'hours', v: (a) => a.budgetHours },
        { h: 'Pct_Complete', meaning: 'Percent complete now.', kind: 'pct', v: (a) => a.pctComplete },
        { h: 'Phase_Contribution', meaning: 'What this activity moved its phase by in the fortnight: earned hours over the phase’s whole budget.', kind: 'pct', v: (a) => blank(a.phaseContribution) },
        { h: 'Plan_Start', meaning: 'The start the outcome is judged against.', kind: 'date', v: (a) => toDate(a.planStart) },
        { h: 'Plan_Finish', meaning: 'The finish the outcome is judged against.', kind: 'date', v: (a) => toDate(a.planFinish) },
        { h: 'Current_Start', meaning: 'Start in the current schedule.', kind: 'date', v: (a) => toDate(a.currentStart) },
        { h: 'Current_Finish', meaning: 'Finish in the current schedule.', kind: 'date', v: (a) => toDate(a.currentFinish) },
        { h: 'Actual_Start', meaning: 'When the work really began.', kind: 'date', v: (a) => toDate(a.actualStart) },
        { h: 'Actual_Finish', meaning: 'When the work really finished.', kind: 'date', v: (a) => toDate(a.actualFinish) },
        { h: 'Start_Slip_Days', meaning: 'Calendar days the current start is past the planned one. Negative is pulled in.', kind: 'int', v: (a) => blank(a.startSlipDays) },
        { h: 'Finish_Variance_Days', meaning: 'Calendar days between the planned and the actual finish. Negative is early.', kind: 'int', v: (a) => blank(a.finishVarianceDays) },
        { h: 'Spread_To_Data_Date', meaning: 'Y when nobody said when its progress happened, so its hours are spread to the data date — not evidence of work in this fortnight.', kind: 'flag', v: (a) => flag(a.spreadToDataDate) },
        { h: 'Needs_Reason', meaning: 'Y for a MISSED or NOT STARTED activity with no actual start or finish: the plan counted on it and nothing has happened. Anything under way or done is never asked why it missed.', kind: 'flag', v: (a) => flag(needsReason(a)) },
        { h: 'Why_Missed', meaning: 'The reason recorded on the Two-Week Log, for a row that needs one. Blank on anything with an actual start or finish.', v: (a) => reasonOf(a)?.entry.reason ?? '' },
        { h: 'Reason_From_Other_Period', meaning: 'Y when the activity’s current reason was given at a review ending on a different date. A reason is the activity’s at every reporting date.', kind: 'flag', v: (a) => flag(!!reasonOf(a)?.carried) },
        {
          h: 'Outside_Team_Control',
          meaning: 'Y when the reason is marked outside the team’s control, which takes the shortfall out of the workable plan.',
          kind: 'flag',
          v: (a) => {
            const e = reasonOf(a);
            return flag(!!e && isOutsideControl(data.missedReasons, e.entry.reason));
          },
        },
        { h: 'Reason_Note', meaning: 'Anything the reason itself cannot say.', v: (a) => reasonOf(a)?.entry.note ?? '' },
        { h: 'Rows_In_Export', meaning: 'How many P6 rows this line stands for; more than one when the export repeats the Activity ID.', kind: 'int', v: (a) => a.rows },
      ],
      log?.activities ?? [],
    ),
  );

  out.push(
    table<PeriodPhase>(
      'Two_Week_Phases',
      `The same fortnight (${periodLabel}) by phase, each against its own budget.`,
      [
        { h: 'Phase_Code', meaning: 'The phase key.', v: (p) => p.key },
        { h: 'Phase', meaning: 'The phase as reported.', v: (p) => p.label },
        { h: 'Activities', meaning: 'In-budget activities in the phase.', kind: 'int', v: (p) => p.activities },
        { h: 'Budget_Hours', meaning: 'The phase’s whole budget.', kind: 'hours', v: (p) => p.budgetHours },
        { h: 'Planned_Hours', meaning: 'Hours planned in the fortnight.', kind: 'hours', v: (p) => p.plannedHours },
        { h: 'Earned_Hours', meaning: 'Hours earned in the fortnight.', kind: 'hours', v: (p) => p.earnedHours },
        { h: 'Achievement', meaning: 'Earned over planned. Blank when nothing was planned.', kind: 'pct', v: (p) => blank(p.achievement) },
        { h: 'Pct_At_Start', meaning: 'The phase’s percent complete the day before the fortnight.', kind: 'pct', v: (p) => p.pctAtStart },
        { h: 'Pct_At_End', meaning: 'The phase’s percent complete at the data date.', kind: 'pct', v: (p) => p.pctAtEnd },
        ...OUTCOMES.map<Col<PeriodPhase>>((o) => ({ h: `Count_${o.replace(/ /g, '_')}`, meaning: `Activities of the phase with outcome ${o}. See Status_Codes.`, kind: 'int', v: (p) => p.counts[o] })),
      ],
      log?.phases ?? [],
    ),
  );

  const cap = data.settings.capacity ?? DEFAULT_CAPACITY;
  type CapLine = { month: string; r: CapacityRow };
  out.push(
    table<CapLine>(
      'Capacity_By_Month',
      `What the work still ahead asks of each resource group in each month, against the headcount keyed on Capacity (${cap.hoursPerPersonPerMonth} h per person per month at ${Math.round(cap.utilisation * 100)}% utilisation).`,
      [
        { h: 'Month', meaning: 'The month, YYYY-MM.', v: (x) => x.month },
        { h: 'Resource', meaning: 'The resource group as reported.', v: (x) => x.r.label },
        { h: 'Demand_Hours', meaning: 'Hours the work in the month will take at the rate the group achieves; the budget where it has no rate yet.', kind: 'hours', v: (x) => x.r.demandHours },
        { h: 'People', meaning: 'Headcount keyed for the group in the month. Blank where none is keyed.', kind: 'number', v: (x) => blank(x.r.people) },
        { h: 'Supply_Hours', meaning: 'Hours that headcount can give in the month.', kind: 'hours', v: (x) => blank(x.r.supplyHours) },
        { h: 'Short_Spare_Hours', meaning: 'Supply minus demand. Negative is short of people.', kind: 'hours', v: (x) => blank(x.r.gapHours) },
        { h: 'Load', meaning: 'Demand over supply. Over 100% is more work than the group can take.', kind: 'pct', v: (x) => blank(x.r.loadFactor) },
      ],
      capacityByMonth(model.burn.forecastMonths, data.headcounts, data.subsystems, cap).flatMap((p) => p.rows.map((r) => ({ month: p.key, r }))),
    ),
  );

  out.push(
    table<StoreData['headcounts'][number]>(
      'Headcount',
      'The headcount keyed on Capacity: how many people each resource group has, from which month.',
      [
        { h: 'Resource_Code', meaning: 'The resource group.', v: (h) => h.subsystem },
        { h: 'People', meaning: 'How many people. Fractional is allowed.', kind: 'number', v: (h) => h.people },
        { h: 'From_Month', meaning: 'The month this headcount takes effect. Blank means always.', v: (h) => h.from ?? '' },
        { h: 'Note', meaning: 'Anything said about it.', v: (h) => h.note ?? '' },
      ],
      data.headcounts,
    ),
  );

  out.push(
    table<StoreData['teamActuals'][number]>(
      'Team_Hours',
      'Hours the team actually booked, as keyed or pasted on Earned vs Actual: one row per month per group, optionally per person.',
      [
        { h: 'Month', meaning: 'The month the hours were booked in, YYYY-MM.', v: (t) => t.month },
        { h: 'Resource_Code', meaning: 'The resource group the hours were booked against. Blank is not attributed.', v: (t) => t.subsystem },
        { h: 'Person', meaning: 'Who booked them, when the timesheet says.', v: (t) => t.person ?? '' },
        { h: 'Hours', meaning: 'Hours booked.', kind: 'hours', v: (t) => t.hours },
        { h: 'Note', meaning: 'Anything said about them.', v: (t) => t.note ?? '' },
      ],
      [...data.teamActuals].sort((a, b) => a.month.localeCompare(b.month) || a.subsystem.localeCompare(b.subsystem)),
    ),
  );

  out.push(
    table<StoreData['subsystems'][number]>(
      'Resource_Names',
      'The names given to resource group codes on the Resources screen.',
      [
        { h: 'Resource_Code', meaning: 'The resource group code.', v: (s) => s.code },
        { h: 'Name', meaning: 'Its friendly name.', v: (s) => s.name ?? '' },
        { h: 'Notes', meaning: 'Notes on the group.', v: (s) => s.notes ?? '' },
      ],
      data.subsystems,
    ),
  );

  type CrewRow = { key: string; subsystem: string; count: number; shift: number | '' };
  out.push(
    table<CrewRow>(
      'Library_Crew',
      'The crew on each Activity Library key, one row per resource line. A key priced as a plain headcount has one line with no resource code.',
      [
        { h: 'Match_Key', meaning: 'The Activity Library key.', v: (c) => c.key },
        { h: 'Resource_Code', meaning: 'The resource group on the crew. Blank for a plain headcount.', v: (c) => c.subsystem },
        { h: 'Heads', meaning: 'How many of them.', kind: 'number', v: (c) => c.count },
        { h: 'Shift_Hours', meaning: 'A shift length for this line only, where it differs from the key’s.', kind: 'number', v: (c) => c.shift },
      ],
      model.library.flatMap((l) =>
        l.crewEffLines.length
          ? l.crewEffLines.map((c) => ({ key: l.matchKey, subsystem: c.subsystem, count: c.count, shift: c.shiftHours ?? ('' as const) }))
          : [{ key: l.matchKey, subsystem: '', count: l.crewEff, shift: '' as const }],
      ),
    ),
  );

  out.push(
    table<StoreData['idRules'][number]>(
      'ID_Rules',
      'Activity ID Rules: exceptions to how an Activity ID is read for location and phase. First match wins.',
      [
        { h: 'Match_Text', meaning: 'Text found anywhere in the Activity ID, ignoring case.', v: (r) => r.match },
        { h: 'Sets', meaning: 'Which reading the rule replaces: location or phase.', v: (r) => r.field },
        { h: 'To', meaning: 'The location code or phase it sets.', v: (r) => r.value },
        { h: 'On', meaning: 'Y when the rule applies; blank when it is switched off.', kind: 'flag', v: (r) => flag(!r.disabled) },
        { h: 'Note', meaning: 'Why the exception exists.', v: (r) => r.note ?? '' },
      ],
      data.idRules,
    ),
  );

  out.push(
    table<StoreData['importsIndex'][number]>(
      'Import_History',
      'Every schedule imported, newest first.',
      [
        { h: 'Kind', meaning: 'current or baseline.', v: (i) => i.kind },
        { h: 'Imported_At', meaning: 'When it was imported.', kind: 'datetime', v: (i) => toDate(i.importedAt) },
        { h: 'Source_File', meaning: 'The file it came from.', v: (i) => i.sourceFilename },
        { h: 'Rows', meaning: 'Rows in the file.', kind: 'int', v: (i) => i.rowCount },
        { h: 'Schedule_Data_Date', meaning: 'The schedule’s own data date, where known.', kind: 'date', v: (i) => toDate(i.dataDate) },
        { h: 'Data_Date_Estimated', meaning: 'Y when that date was worked out from the file’s actual dates rather than known.', kind: 'flag', v: (i) => flag(!!i.dataDateEstimated) },
        { h: 'In_Use', meaning: 'Y for the current schedule and the baseline the model is measured against.', kind: 'flag', v: (i) => flag(i.id === data.current?.id || i.id === data.baseline?.id) },
      ],
      [...data.importsIndex].sort((a, b) => b.importedAt.localeCompare(a.importedAt)),
    ),
  );

  out.push(
    table<Model['staleOverrides'][number]>(
      'Stale_Edits',
      'Edits keyed against an Activity ID the current schedule does not have. They do nothing until the ID comes back.',
      [
        { h: 'Activity_ID', meaning: 'The Activity ID the edit was keyed against.', v: (o) => o.activityId },
        { h: 'Has_Hours', meaning: 'Y when it carries an hours override.', kind: 'flag', v: (o) => flag(o.hasHours) },
        { h: 'Renamed', meaning: 'Y when it carries a rename.', kind: 'flag', v: (o) => flag(o.renamed) },
        { h: 'In_Budget_Setting', meaning: 'The In budget? setting it carries, if any.', v: (o) => (o.visibility ? SHOW[o.visibility] : '') },
        { h: 'Note', meaning: 'The note it carries.', v: (o) => o.note },
      ],
      model.staleOverrides,
    ),
  );

  out.push(
    table<string>(
      'Data_Notes',
      'What the application says about the quality of the data, as on the Dashboard.',
      [{ h: 'Note', meaning: 'One data-quality note.', v: (n) => n }],
      model.notes,
    ),
  );

  return out;
}

/** A definition shared by every sheet of the source layout that carries the heading. */
const d = (meaning: string, kind: ColumnKind = 'text'): Def => ({ meaning, kind });

/**
 * The source workbook's sheets, defined. Headings that mean the same thing on every
 * sheet are defined once in COMMON; a sheet lists only what is particular to it.
 */
const COMMON: Record<string, Def> = {
  P6_Activity_ID: d('The Activity ID exactly as P6 exported it.'),
  'Activity ID': d('The Activity ID exactly as P6 exported it.'),
  'Activity Name': d('The activity name as P6 exported it.'),
  'Original Duration': d('P6 original duration, in working days.', 'number'),
  'Remaining Duration': d('P6 remaining duration, in working days.', 'number'),
  Start: d('The start as P6 wrote it, with A marking an actual.'),
  Finish: d('The finish as P6 wrote it, with A marking an actual.'),
  Match_Key: d('The Activity Library key.'),
  Rate_Status: d('How completely the library key is priced. See Status_Codes.'),
  Status: d('Whether the activity is in the budget, and if not why. See Status_Codes.'),
  Basis: d('How hours are priced. See Status_Codes.'),
  Budget_Hours: d('Budget man-hours.', 'hours'),
  Earned_Hours: d('Budget hours earned.', 'hours'),
  Remaining_Hours: d('Budget hours not yet earned.', 'hours'),
  Built_Hours: d('Hours the team booked, from the timesheets on Earned vs Actual.', 'hours'),
  Variance_Hours: d('Earned minus built. Negative means the work cost more hours than it earned.', 'hours'),
  Factor: d('Earned per hour built. Below 1.00 means hours cost more than they earn. Blank when nothing was built.', 'factor'),
  Cum_Earned: d('Earned hours to the end of this period, from the start of the job.', 'hours'),
  Cum_Built: d('Built hours to the end of this period, from the start of the job.', 'hours'),
  Cum_Variance: d('Cumulative earned minus cumulative built.', 'hours'),
  Planned_PV_Hours: d('Planned value: budget hours the baseline planned to earn in the month.', 'hours'),
  Cum_PV: d('Planned value to the end of the month, from the first month of the baseline.', 'hours'),
  Month: d('The month, YYYY-MM.'),
  Month_Label: d('The month as the screens label it, e.g. Aug 26.'),
  Fiscal_Year: d('The fiscal year, named for the calendar year it ends in (Settings sets the start month).'),
  Span: d('The months the fiscal year runs over.'),
  Group: d('The resource group. Unassigned is hours whose crew names none. WHOLE PROJECT is every group together.'),
  Months: d('Months in the period.', 'int'),
  Period_End: d('The last day of the period.', 'date'),
  Activity_Name: d('The activity name as reported.'),
  Phase: d('The phase as reported, e.g. Phase 2.'),
  Subsystem: d('The resource group(s) the activity type belongs to. Several share the hours evenly.'),
  Notes: d('Notes.'),
  Note: d('Anything said about it.'),
  Location_Name: d('The location as reported: its name from the Locations screen, or the code.'),
  Budget_Left_Hours: d('Budget hours the current schedule still plans to earn in the period.', 'hours'),
  Forecast_Cost_Hours: d('What earning them will cost at the rate the group has achieved. Blank without a rate.', 'hours'),
  Over_Under_Hours: d('Budget left minus forecast cost. Negative is an overrun.', 'hours'),
};

const SOURCE_SHEETS: Record<string, { purpose: string; keyValue?: boolean; columns?: Record<string, Def> }> = {
  Settings: { purpose: 'The settings the figures were calculated with: defaults, the data date and the fiscal year start.', keyValue: true },
  Summary: { purpose: 'The Dashboard’s counts and totals: what was imported, what is in the budget, and data quality.', keyValue: true },
  P6_Extract: {
    purpose: 'The current schedule exactly as imported, with what the application read from each row.',
    columns: {
      Row_Type: d('ACTIVITY, or WBS for a summary row that is never budgeted.'),
      Location: d('The location code read from the 4th segment of the Activity ID.'),
      Seq_Code: d('The trailing segments of the Activity ID.'),
      Activity_Type: d('The activity type read from the P6 name.'),
      Exclude_Reason: d('DELETED or CANCELLED when P6 marks the name so.'),
      Start_Date: d('The start, read as a date.', 'date'),
      Finish_Date: d('The finish, read as a date.', 'date'),
      'Actual?': d('A when P6 marks the finish actual.'),
      P6_Pct_Complete: d('(Original - Remaining duration) / Original duration.', 'pct'),
      'Actual_Start?': d('A when P6 marks the start actual.'),
    },
  },
  Baseline_Extract: {
    purpose: 'The baseline schedule exactly as imported.',
    columns: { BL_Start_Date: d('The baseline start, read as a date.', 'date'), BL_Finish_Date: d('The baseline finish, read as a date.', 'date') },
  },
  Locations: {
    purpose: 'Every location carrying activities, with its name and complexity factor.',
    columns: {
      Location_Code: d('The location code from the Activity IDs.'),
      Activities: d('Activities with any share at the location.', 'int'),
      Complexity_Factor: d('The factor keyed for the location. Blank uses the default.', 'factor'),
      Effective_Factor: d('The factor in use.', 'factor'),
      Location_Name: d('The name given on the Locations screen; what every report shows in place of the code.'),
      Split_Activities: d('Activities with only part of their hours here, because they are split across locations.', 'int'),
      Budget_Hours: d('Budget hours at the location, split activities by their share.', 'hours'),
    },
  },
  Activity_Library: {
    purpose: 'The rate library: how each activity type is priced.',
    columns: {
      Count: d('Activities of this type in the current schedule.', 'int'),
      Total_P6_Days: d('Original duration summed over those activities, in days.', 'number'),
      Subsystem: d('The resource group(s) the type belongs to.'),
      Include_Override: d('Y or N where somebody set it; blank follows the type name.'),
      Include: d('Whether the type carries hours. See Status_Codes.'),
      Basis: d('The basis set on the key; blank follows the Settings default.'),
      Crew_Size: d('Headcount keyed on the key.', 'number'),
      Shift_Hours: d('Shift hours keyed on the key.', 'number'),
      Duration_Shifts: d('Shifts one instance takes, for the RATE basis.', 'number'),
      Basis_Eff: d('The basis in use. See Status_Codes.'),
      Crew_Eff: d('The headcount in use: the crew lines summed, or the default.', 'number'),
      Shift_Eff: d('The shift hours in use.', 'number'),
      Std_Hours_If_RATE: d('Hours one instance carries on the RATE basis; n/a for DUR.', 'hours'),
      Notes: d('Notes on the key.'),
      Static_Dynamic: d('Static, Dynamic or Other, for every activity of the type unless one is set on its own in Budget Master. See Status_Codes.'),
    },
  },
  Progress: {
    purpose: 'Every percent complete, actual date and progress note keyed, checked against the schedule.',
    columns: {
      Pct_Complete_Keyed: d('The percent complete keyed by hand.', 'pct'),
      Pct_Effective: d('The percent complete in use from it.', 'pct'),
      Activity_Name_Check: d('The activity it matched, or ID NOT IN EXTRACT.'),
      Budget_Status_Check: d('That activity’s status, or why it matches nothing.'),
      Actual_Start_Override: d('Actual start keyed by hand.', 'date'),
      Actual_Finish_Override: d('Actual finish keyed by hand.', 'date'),
      Progress_As_At: d('The date the percent complete was true as at.', 'date'),
      Progress_Note: d('The progress note.'),
    },
  },
  Budget_Master: {
    purpose: 'The source workbook’s activity sheet: one row per activity in the budget model (hidden ones excluded). All_Activities carries every field.',
    columns: {
      Row: d('Row number as it was in the source workbook.', 'int'),
      Location: d('The location code (where a split leaves its share).'),
      Seq_Code: d('The trailing segments of the Activity ID.'),
      Complexity: d('The complexity factor applied.', 'factor'),
      Std_Hours: d('Standard hours before complexity.', 'hours'),
      Override_Hours: d('Hours typed in place of the calculation.', 'hours'),
      Baseline_Start: d('Planned start.', 'date'),
      Baseline_Finish: d('Planned finish.', 'date'),
      Baseline_Source: d('Where the planned dates came from. See Status_Codes.'),
      Current_Start: d('Start in use for the forecast.', 'date'),
      Current_Finish: d('Finish in use for the forecast.', 'date'),
      Actual_Start: d('When the work really began.', 'date'),
      Actual_Finish: d('When the work really finished.', 'date'),
      Progress_As_At: d('The date the percent complete was true as at.', 'date'),
      Pct_Complete: d('Percent complete.', 'pct'),
      Pct_Source: d('Where it came from. See Status_Codes.'),
      Work_Type: d('3rd segment of the Activity ID.'),
      Activity_Type: d('The activity type read from the P6 name.'),
      Earn_Start: d('First day earned hours accrue.', 'date'),
      Earn_End: d('Last day earned hours accrue.', 'date'),
      Earn_Window_Source: d('Which dates the hours accrue between. See Status_Codes (Earn_Window).'),
      P6_Activity_Name: d('The name P6 exported.'),
      Renamed_By_User: d('Y when renamed in Budget Master.'),
      Visibility_Override: d('INCLUDED, EXCLUDED or HIDDEN as set in Show; blank is Auto.'),
      Crew_Size: d('Heads across every resource line.', 'int'),
      Resources: d('The crew, e.g. ATS x1, IXL x1.'),
      Location_Split: d('The split across locations by code. Blank when at one location.'),
      Static_Dynamic: d('Static, Dynamic or Other for the activity. See Status_Codes.'),
    },
  },
  Missed_Reasons: {
    purpose: 'Every reason recorded for a missed activity, one row per activity per review period.',
    columns: {
      Location: d('The location as reported.'),
      Reason: d('The reason picked on the Two-Week Log.'),
      Is_Current: d('Y for the answer the activity currently stands on: the last one given, shown at every reporting date. Blank for an earlier review’s answer that a later one replaced, kept as the history of what was said when.'),
      Still_Applies: d('Y while the activity still has no actual start or finish. Blank once it has started or finished: the reason is kept as a record of that review, but is no longer shown, tallied or carried to a later fortnight.'),
      Recorded_At: d('When it was recorded.'),
      Period_End: d('The last day of the review period it was recorded against.', 'date'),
    },
  },
  S_Curve: {
    purpose: 'The S-curve, period by period: planned, forecast and earned cumulative hours.',
    columns: {
      Planned_Cum_Hours: d('Cumulative hours the baseline planned by the period end.', 'hours'),
      Forecast_Cum_Hours: d('Cumulative hours the current schedule forecasts by the period end.', 'hours'),
      'Earned_Cum_Hours (actual dates)': d('Cumulative hours earned by the period end, on actual dates. Blank after the data date.', 'hours'),
      Planned_Pct: d('Planned as a share of the budget.', 'pct'),
      Earned_Pct: d('Earned as a share of the budget.', 'pct'),
    },
  },
  Earned_vs_Actual: {
    purpose: 'Earned against built, month by month, with planned value.',
    columns: {
      Pct_Complete_At_Month_End: d('How complete the job was at the month end.', 'pct'),
      SV_Hours: d('Schedule variance: cumulative earned minus cumulative planned. Negative is behind the baseline.', 'hours'),
      SPI: d('Schedule performance index: cumulative earned over cumulative planned. Below 1.00 is behind.', 'factor'),
    },
  },
  PV_By_Group_Month: { purpose: 'Planned value by resource group for every month of the plan.' },
  Fiscal_Year: {
    purpose: 'Earned against built, by fiscal year.',
    columns: {
      First_Month: d('The first month of the year with figures.'),
      Last_Month: d('The last month of the year with figures.'),
      Pct_Complete_At_Year_End: d('How complete the job was at the year end.', 'pct'),
    },
  },
  FY_By_Group: {
    purpose: 'Each resource group inside each fiscal year.',
    columns: { Share_Of_Year_Earned: d('The group’s share of everything earned in the year.', 'pct'), Months_Active: d('Months the group earned or built anything.', 'int') },
  },
  FY_By_Group_Month: { purpose: 'The group-by-month grid the fiscal year totals are made of.' },
  Forecast_By_Group: {
    purpose: 'Each group’s estimate at completion, at the rate it has achieved.',
    columns: {
      Pct_Complete: d('Earned over budget.', 'pct'),
      Remaining_Budget: d('Budget hours not yet earned.', 'hours'),
      Hours_To_Complete: d('Remaining budget at the rate achieved so far.', 'hours'),
      Forecast_Total_Hours: d('Built so far plus hours to complete.', 'hours'),
      Variance_At_Completion: d('Budget minus forecast. Negative is a forecast overrun.', 'hours'),
      Overrun_Share_Of_Budget: d('Variance at completion as a share of the budget.', 'pct'),
    },
  },
  FY_Forecast: {
    purpose: 'The fiscal years still ahead: what the current schedule plans to earn and what it will cost.',
    columns: {
      Groups: d('Resource groups with work in the year.', 'int'),
    },
  },
  FY_Forecast_By_Group: {
    purpose: 'The years still ahead, by group.',
    columns: { Share_Of_Year_Left: d('The group’s share of the year’s budget left.', 'pct'), Months_With_Work: d('Months the group has work in.', 'int') },
  },
  FY_Forecast_By_Month: { purpose: 'The years still ahead, by group by month.' },
};

/** The definition of a heading on one of the source layout's sheets, if there is one. */
function sourceDef(sheet: string, header: string): Def | undefined {
  const own = SOURCE_SHEETS[sheet]?.columns?.[header];
  if (own) return own;
  if (COMMON[header]) return COMMON[header];
  // Headings shared with the new sheets are defined there already.
  return undefined;
}

/** The source workbook's sheets, dressed and defined, in their own order. */
function sourceSheets(model: Model, data: StoreData): ExtractSheet[] {
  const wb = buildWorkbook(model, data.settings, data.current?.activities ?? [], data.baseline?.activities ?? [], data.testProgress, data.missedReasons);
  const out: ExtractSheet[] = [];
  for (const name of wb.SheetNames) {
    if (name === 'README') continue; // Contents takes its place.
    const ws = wb.Sheets[name];
    const meta = SOURCE_SHEETS[name] ?? { purpose: '' };
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true });
    const rows = Math.max(0, aoa.length - 1);
    if (meta.keyValue) {
      ws['!cols'] = [{ wch: 48 }, { wch: 18 }, { wch: 24 }];
      out.push({ name, purpose: meta.purpose, ws, rows, headerRow: 0, columns: [] });
      continue;
    }
    const headers = ((aoa[0] ?? []) as unknown[]).map((h) => String(h ?? ''));
    const columns = headers.map((header) => ({ header, def: sourceDef(name, header) ?? d('') }));
    dress(ws, columns.map((c) => c.def.kind));
    out.push({ name, purpose: meta.purpose, ws, rows, headerRow: 0, columns });
  }
  return out;
}

export type ExtractInfo = {
  /** When it was made, for the Contents sheet. */
  generatedAt: Date;
  /** What made it: a click, or the schedule. */
  trigger: 'manual' | 'scheduled';
};

/** The whole extract: Contents, Data_Dictionary, Status_Codes, then every sheet. */
export function buildDataExtract(model: Model, data: StoreData, info: ExtractInfo): { wb: XLSX.WorkBook; sheets: ExtractSheet[] } {
  const sheets = [...extractSheets(model, data), ...sourceSheets(model, data)];

  const dictionary = table<{ sheet: string; header: string; def: Def }>(
    'Data_Dictionary',
    'What every column on every sheet means, and how its values are written. Filter on Sheet.',
    [
      { h: 'Sheet', meaning: 'The sheet the column is on.', v: (x) => x.sheet },
      { h: 'Column', meaning: 'The column heading.', v: (x) => x.header },
      { h: 'Meaning', meaning: 'What the column holds.', v: (x) => x.def.meaning },
      { h: 'Format', meaning: 'How its values are written.', v: (x) => KIND_LABEL[x.def.kind] },
    ],
    [],
  );
  const codes = table<(typeof STATUS_CODES)[number]>(
    'Status_Codes',
    'What every status and code value means. Filter on Field to read one column’s values.',
    [
      { h: 'Field', meaning: 'The column the value appears in.', v: (c) => c.field },
      { h: 'Value', meaning: 'The value.', v: (c) => c.value },
      { h: 'Meaning', meaning: 'What it means.', v: (c) => c.meaning },
      { h: 'Appears_In', meaning: 'The sheets it appears on.', v: (c) => c.appearsIn },
    ],
    STATUS_CODES,
  );
  const contents = table<ExtractSheet>(
    'Contents',
    'Every sheet in this workbook and what it holds.',
    [
      { h: 'Sheet', meaning: 'The sheet name.', v: (s) => s.name },
      { h: 'What_It_Holds', meaning: 'What the sheet is for.', v: (s) => s.purpose },
      { h: 'Rows', meaning: 'Data rows on the sheet, heading excluded.', kind: 'int', v: (s) => s.rows },
    ],
    [],
  );

  // The dictionary covers itself and the other front sheets too, so nothing in the
  // workbook is undefined, including the sheets that explain the rest.
  const front = [contents, dictionary, codes];
  const everything = [...front, ...sheets];
  const dictRows = everything.flatMap((s) => s.columns.map((c) => ({ sheet: s.name, header: c.header, def: c.def })));
  const dictWs = XLSX.utils.aoa_to_sheet([dictionary.columns.map((c) => c.header), ...dictRows.map((r) => [r.sheet, r.header, r.def.meaning, KIND_LABEL[r.def.kind]])]);
  dress(dictWs, ['text', 'text', 'text', 'text']);
  dictWs['!cols'] = [{ wch: 22 }, { wch: 30 }, { wch: 100 }, { wch: 24 }];
  dictionary.ws = dictWs;
  dictionary.rows = dictRows.length;

  const s = data.settings;
  const head: unknown[][] = [
    ['T&C P6 Budget and S-Curve: full data extract'],
    ['Generated at', info.generatedAt],
    ['Generated by', info.trigger === 'scheduled' ? 'The scheduled export' : 'Export, by hand'],
    ['Data date', toDate(s.dataDate)],
    ['Current schedule', data.current ? `${data.current.sourceFilename} (imported ${data.current.importedAt.slice(0, 10)})` : 'none imported'],
    ['Baseline', data.baseline ? `${data.baseline.sourceFilename} (imported ${data.baseline.importedAt.slice(0, 10)})` : 'none imported'],
    ['Application build', BUILD_COMMIT],
    ['How to read it', 'Data_Dictionary defines every column on every sheet; Status_Codes says what every status value means. All cells are values: the application, not this workbook, is the calculation engine.'],
    [],
  ];
  const headerRow = head.length;
  contents.rows = everything.length;
  const contentsWs = XLSX.utils.aoa_to_sheet(
    [...head, contents.columns.map((c) => c.header), ...everything.map((x) => [x.name, x.purpose, x.rows])],
    { cellDates: true },
  );
  const at = contentsWs[XLSX.utils.encode_cell({ r: 1, c: 1 })] as XLSX.CellObject | undefined;
  if (at) at.z = 'dd-mmm-yy hh:mm';
  const dd = contentsWs[XLSX.utils.encode_cell({ r: 3, c: 1 })] as XLSX.CellObject | undefined;
  if (dd && dd.t === 'd') dd.z = 'dd-mmm-yy';
  dress(contentsWs, ['text', 'text', 'int'], headerRow);
  contentsWs['!cols'] = [{ wch: 24 }, { wch: 110 }, { wch: 8 }];
  contents.ws = contentsWs;
  contents.headerRow = headerRow;

  const wb = XLSX.utils.book_new();
  for (const x of everything) XLSX.utils.book_append_sheet(wb, x.ws, x.name);
  return { wb, sheets: everything };
}

/** The bytes of the extract, ready to write. */
export function dataExtractBytes(model: Model, data: StoreData, info: ExtractInfo): Uint8Array {
  const { wb } = buildDataExtract(model, data, info);
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer);
}

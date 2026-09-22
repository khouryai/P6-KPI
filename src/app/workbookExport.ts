/**
 * The exported workbook.
 *
 * Kept apart from the rest of `export.ts` because it is the only thing in the
 * application that needs the spreadsheet library, and that library is a third of
 * the bundle. Everything here is reached through a dynamic import, so opening the
 * dashboard does not pay for a workbook nobody asked for.
 */
import * as XLSX from 'xlsx';
import type { BurnRow, Model, Settings, P6Activity, TestProgress, MissedReasonLog } from '../engine/types';
import { p6PctComplete, marksActuals } from '../engine/compute';
import { fiscalYearDetail, forecastYears, fyStart } from '../engine/fiscal';

const d = (iso: string | null | undefined): Date | '' => (iso ? new Date(`${iso}T00:00:00`) : '');
const wsFrom = (rows: unknown[][]) => XLSX.utils.aoa_to_sheet(rows, { cellDates: true });

function extractSheet(acts: P6Activity[], withDerived: boolean): XLSX.WorkSheet {
  // Read the same way the model reads it, so the sheet cannot quote a percent the
  // application never used.
  const p6Opts = { marksActuals: marksActuals(acts) };
  const header = ['Activity ID', 'Activity Name', 'Original Duration', 'Remaining Duration', 'Start', 'Finish'];
  const derived = ['Row_Type', 'Location', 'Seq_Code', 'Activity_Type', 'Exclude_Reason', 'Start_Date', 'Finish_Date', 'Actual?', 'P6_Pct_Complete', 'Actual_Start?'];
  const rows: unknown[][] = [withDerived ? [...header, ...derived] : [...header, 'BL_Start_Date', 'BL_Finish_Date']];
  for (const a of acts) {
    const base: unknown[] = [a.rawActivityId, a.activityName, a.originalDuration ?? '', a.remainingDuration ?? '', a.startRaw, a.finishRaw];
    if (withDerived) {
      rows.push([...base, a.rowType, a.location, a.rowType === 'ACTIVITY' ? a.seqCode : '', a.activityType, a.excludeReason ?? '', d(a.startDate), d(a.finishDate), a.actualFinish ? 'A' : '', a.rowType === 'ACTIVITY' ? p6PctComplete(a, p6Opts) : '', a.actualStart ? 'A' : '']);
    } else rows.push([...base, d(a.startDate), d(a.finishDate)]);
  }
  return wsFrom(rows);
}

/** A month as "Aug 26", matching the way Earned vs Actual labels its rows. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(2, 4)}`;

/** A factor or a share that has no meaning yet reads as blank, never as zero. */
const orBlank = (n: number | null) => (n === null ? '' : n);

/**
 * The Earned vs Actual screen, as sheets.
 *
 * The screen's own question — where are we against what we have spent, and which
 * group is carrying the gap — is asked by fiscal year as often as by month, and
 * answering it in a spreadsheet used to mean pivoting the monthly rows by hand.
 * Four sheets instead: the months, the fiscal years, the groups inside each fiscal
 * year, and the group-by-month grid those totals are made of. Every figure comes
 * from `fiscalYearDetail`, which is what the screen reads too, so the workbook and
 * the screen cannot disagree.
 */
function earnedVsActualSheets(model: Model, settings: Settings): [string, XLSX.WorkSheet][] {
  const months: BurnRow[] = model.burn.months;
  const start = fyStart(settings.fiscalYearStartMonth);
  const years = fiscalYearDetail(months, start);
  const budget = model.burn.project.budgetHours;
  const pctOf = (cum: number) => (budget ? cum / budget : '');

  const monthSheet = wsFrom([
    ['Month', 'Fiscal_Year', 'Earned_Hours', 'Built_Hours', 'Variance_Hours', 'Factor', 'Cum_Earned', 'Cum_Built', 'Cum_Variance', 'Pct_Complete_At_Month_End'],
    ...years.flatMap((y) =>
      y.months.map((m) => [m.month, y.label, m.earned, m.built, m.variance, orBlank(m.factor), m.cumEarned, m.cumBuilt, m.cumVariance, pctOf(m.cumEarned)]),
    ),
  ]);

  const yearSheet = wsFrom([
    ['Fiscal_Year', 'Span', 'First_Month', 'Last_Month', 'Months', 'Earned_Hours', 'Built_Hours', 'Variance_Hours', 'Factor', 'Cum_Earned', 'Cum_Built', 'Pct_Complete_At_Year_End'],
    ...years.map((y) => [y.label, y.span, y.from, y.to, y.months.length, y.earned, y.built, y.variance, orBlank(y.factor), y.cumEarned, y.cumBuilt, pctOf(y.cumEarned)]),
  ]);

  /*
   * The by-group detail, one row per group per fiscal year. Deliberately no
   * forecast column: to-complete and at-completion divide a REMAINING budget by a
   * rate, and a remaining budget is not something one fiscal year has. The
   * whole-project forecast per group is on Forecast_By_Group instead.
   */
  const yearGroupSheet = wsFrom([
    ['Fiscal_Year', 'Span', 'Group', 'Earned_Hours', 'Built_Hours', 'Variance_Hours', 'Factor', 'Share_Of_Year_Earned', 'Months_Active'],
    ...years.flatMap((y) =>
      y.resources.map((r) => [y.label, y.span, r.code || 'Unassigned', r.earned, r.built, r.variance, orBlank(r.factor), r.shareOfEarned, r.months.length]),
    ),
  ]);

  const yearGroupMonthSheet = wsFrom([
    ['Fiscal_Year', 'Month', 'Month_Label', 'Group', 'Earned_Hours', 'Built_Hours', 'Variance_Hours', 'Factor'],
    ...years.flatMap((y) =>
      y.resources.flatMap((r) =>
        r.months.map((m) => [y.label, m.month, monthLabel(m.month), r.code || 'Unassigned', m.earned, m.built, m.variance, orBlank(m.factor)]),
      ),
    ),
  ]);

  const forecastSheet = wsFrom([
    ['Group', 'Budget_Hours', 'Cum_Earned', 'Cum_Built', 'Factor', 'Pct_Complete', 'Remaining_Budget', 'Hours_To_Complete', 'Forecast_Total_Hours', 'Variance_At_Completion', 'Overrun_Share_Of_Budget'],
    ...[model.burn.project, ...model.burn.bySubsystem].map((f) => [
      f.code || (f.label === 'Whole project' ? 'WHOLE PROJECT' : 'Unassigned'),
      f.budgetHours,
      f.cumEarned,
      f.cumBuilt,
      orBlank(f.factor),
      f.budgetHours ? f.cumEarned / f.budgetHours : '',
      f.remainingHours,
      orBlank(f.hoursToComplete),
      orBlank(f.forecastTotalHours),
      orBlank(f.varianceAtCompletion),
      f.budgetHours && f.varianceAtCompletion !== null ? f.varianceAtCompletion / f.budgetHours : '',
    ]),
  ]);

  /*
   * The years that have not happened yet, by group. Kept in their own sheets rather
   * than added as rows to the ones above, because "budget left" and "forecast cost"
   * are not the same measurements as "earned" and "built" — one is the schedule's
   * intent and one is arithmetic on a rate, and a single table carrying both under
   * one set of headings would be read as though they were.
   */
  const ahead = forecastYears(model.burn.forecastMonths, start);
  const futureYearSheet = wsFrom([
    ['Fiscal_Year', 'Span', 'Months', 'Groups', 'Budget_Left_Hours', 'Forecast_Cost_Hours', 'Over_Under_Hours'],
    ...ahead.map((y) => [y.label, y.span, y.months.length, y.resources.length, y.earned, orBlank(y.built), orBlank(y.variance)]),
  ]);
  const futureGroupSheet = wsFrom([
    ['Fiscal_Year', 'Span', 'Group', 'Budget_Left_Hours', 'Forecast_Cost_Hours', 'Over_Under_Hours', 'Share_Of_Year_Left', 'Months_With_Work'],
    ...ahead.flatMap((y) =>
      y.resources.map((r) => [y.label, y.span, r.code || 'Unassigned', r.earned, orBlank(r.built), orBlank(r.variance), r.shareOfEarned, r.months.length]),
    ),
  ]);
  const futureGroupMonthSheet = wsFrom([
    ['Fiscal_Year', 'Month', 'Month_Label', 'Group', 'Budget_Left_Hours', 'Forecast_Cost_Hours'],
    ...ahead.flatMap((y) =>
      y.resources.flatMap((r) =>
        r.months.map((m) => [y.label, m.month, monthLabel(m.month), r.code || 'Unassigned', m.earned, orBlank(m.built)]),
      ),
    ),
  ]);

  return [
    ['Earned_vs_Actual', monthSheet],
    ['Fiscal_Year', yearSheet],
    ['FY_By_Group', yearGroupSheet],
    ['FY_By_Group_Month', yearGroupMonthSheet],
    ['Forecast_By_Group', forecastSheet],
    ['FY_Forecast', futureYearSheet],
    ['FY_Forecast_By_Group', futureGroupSheet],
    ['FY_Forecast_By_Month', futureGroupMonthSheet],
  ];
}

/** Build the export workbook with the same sheet names and column layouts as the source workbook. Values only, no formulas. */
export function buildWorkbook(
  model: Model,
  settings: Settings,
  current: P6Activity[],
  baseline: P6Activity[],
  testProgress: TestProgress[],
  missedReasons: MissedReasonLog = { reasons: [], entries: [] },
): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const s = model.summary;
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['T&C P6 Budget and S-Curve'],
    ['Generated by', 'T&C Budget desktop application'],
    ['Generated at', new Date().toISOString()],
    ['Note', 'All cells are values. The application, not this workbook, is the calculation engine.'],
    ['Spread', 'Curves are calendar-linear and ignore the P6 work calendar. Same-day activities credit in full on that day.'],
  ]), 'README');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Settings'], [],
    ['Default_Basis', settings.defaultBasis], ['Default_Crew', settings.defaultCrew], ['Default_Shift_Hours', settings.defaultShiftHours],
    ['Default_Complexity', settings.defaultComplexity],
    ['Data_Date', d(settings.dataDate)],
    ['Fiscal_Year_Starts_In_Month', fyStart(settings.fiscalYearStartMonth)],
  ]), 'Settings');
  XLSX.utils.book_append_sheet(wb, extractSheet(current, true), 'P6_Extract');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Location_Code', 'Activities', 'Complexity_Factor', 'Effective_Factor', 'Location_Name'],
    ...model.locations.map((l) => [l.code, l.count, l.location.complexityFactor ?? '', l.effectiveFactor, l.location.name ?? '']),
  ]), 'Locations');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Match_Key', 'Count', 'Total_P6_Days', 'Subsystem', 'Include_Override', 'Include', 'Basis', 'Crew_Size', 'Shift_Hours', 'Duration_Shifts', 'Basis_Eff', 'Crew_Eff', 'Shift_Eff', 'Rate_Status', 'Std_Hours_If_RATE', 'Notes'],
    ...model.library.map((l) => [l.matchKey, l.count, l.totalP6Days, l.entry.discipline ?? '', l.entry.includeOverride ?? '', l.include, l.entry.basis ?? '', l.entry.crewSize ?? '', l.entry.shiftHours ?? '', l.entry.durationShifts ?? '', l.basisEff, l.crewEff, l.shiftEff, l.rateStatus, l.stdHoursIfRate ?? 'n/a', l.entry.notes ?? '']),
  ]), 'Activity_Library');
  const checks = new Map(model.testProgressChecks.map((c) => [c.activityId, c]));
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['P6_Activity_ID', 'Pct_Complete_Keyed', 'Pct_Effective', 'Activity_Name_Check', 'Budget_Status_Check', 'Actual_Start_Override', 'Actual_Finish_Override', 'Progress_As_At', 'Progress_Note'],
    ...testProgress.map((t) => {
      const c = checks.get(t.activityId);
      return [t.activityId, t.pctOverride ?? '', c?.pctEffective ?? '', c?.activityName ?? 'ID NOT IN EXTRACT', c?.status ?? '', d(t.testStartOverride), d(t.testEndOverride), d(t.progressAsOf), t.note ?? ''];
    }),
  ]), 'Progress');
  XLSX.utils.book_append_sheet(wb, extractSheet(baseline, false), 'Baseline_Extract');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Row', 'P6_Activity_ID', 'Location', 'Seq_Code', 'Match_Key', 'Rate_Status', 'Status', 'Basis', 'Complexity', 'Std_Hours', 'Override_Hours', 'Budget_Hours', 'Baseline_Start', 'Baseline_Finish', 'Baseline_Source', 'Current_Start', 'Current_Finish', 'Actual_Start', 'Actual_Finish', 'Progress_As_At', 'Pct_Complete', 'Pct_Source', 'Earned_Hours', 'Remaining_Hours', 'Phase', 'Work_Type', 'Activity_Name', 'Activity_Type', 'Subsystem', 'Earn_Start', 'Earn_End', 'Earn_Window_Source', 'P6_Activity_Name', 'Renamed_By_User', 'Visibility_Override', 'Crew_Size', 'Resources'],
    ...model.rows.map((r, i) => [i + 2, r.activity.rawActivityId, r.location, r.seqCode, r.matchKey, r.rateStatus, r.status, r.basis ?? '', r.complexity ?? '', r.stdHours ?? '', r.overrideHours ?? '', r.budgetHours, d(r.baselineStart), d(r.baselineFinish), r.baselineSource, d(r.currentStart), d(r.currentFinish), d(r.actualStart), d(r.actualFinish), d(r.progressAsOf), r.pctComplete, r.pctSource, r.earnedHours, r.remainingHours, r.phaseName, r.workType, r.activityName, r.activityType, r.discipline, d(r.earnStart), d(r.earnEnd), r.earnWindowSource, r.activity.activityName, r.renamed ? 'Y' : '', r.visibility ?? '', r.crewSize, r.resources.map((x) => `${x.label} x${x.count}`).join(', ')]),
  ]), 'Budget_Master');
  /*
   * Why activities were missed, one row per activity per review period, with the
   * name and the phase carried alongside so the sheet can be read on its own. The
   * whole point of recording a reason is that somebody totals them up later, and a
   * workbook that held the misses but not the reasons would send them back to the
   * app to do it by hand.
   */
  const byId = new Map(model.rows.map((r) => [r.activityId, r]));
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Period_End', 'P6_Activity_ID', 'Activity_Name', 'Phase', 'Location', 'Reason', 'Note', 'Recorded_At'],
    ...[...missedReasons.entries]
      .sort((a, b) => b.periodEnd.localeCompare(a.periodEnd) || a.activityId.localeCompare(b.activityId))
      .map((e) => {
        const r = byId.get(e.activityId);
        return [d(e.periodEnd), e.activityId, r?.activityName ?? '', r?.phaseName ?? '', r?.location ?? '', e.reason, e.note ?? '', e.updatedAt];
      }),
  ]), 'Missed_Reasons');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Budget Summary'], [],
    ['Extract rows', s.extractRows], ['  WBS summary rows', s.wbsRows, 'Auto-excluded'], ['  Real activities', s.activities], [],
    ['Locations discovered', s.locations], ['Activity types discovered', s.activityTypes], ['  Types still on defaults', s.typesOnDefaults], ['  Types missing shift count', s.typesNeedingShifts], [],
    ['Activities in budget', s.inBudget], ['Excluded by library', s.excluded], ['Deleted or cancelled', s.deletedOrCancelled], ['Needing REVIEW', s.review], [],
    ['Your activity edits'], ['Hidden, and so in no figure in this workbook', s.hidden], ['Renamed', s.renamed], ['Forced into the budget', s.forcedIn], ['Excluded by you', s.forcedOut], ['Edits keyed against an ID not in this schedule', s.staleOverrides], [],
    ['Total budget man-hours', s.totalBudgetHours], ['Earned man-hours', s.earnedHours], ['Remaining man-hours', s.remainingHours], ['Overall percent complete', s.pctComplete], [],
    ['Dates from baseline import', s.baselineMatched], ['Dates falling back to current', s.baselineFallback], ['Activities with no dates at all', s.noDates], [],
    ['Percent complete keyed by hand', s.pctFromOverride], ['Percent complete from P6 duration', s.pctFromP6], [],
    ['Earned-value data quality'], ['Progress rows keyed', s.testProgressKeyed], ['  not matching a budgeted activity', s.testProgressNotMatching], ['  carrying a percent complete', s.testProgressUsingOverride], [],
    ['Activities started, not finished', s.inProgress], ['Activities with P6 actual dates', s.p6Actual], ['Activities on a test window', s.testWindow], ['Activities not started', s.notStarted],
  ]), 'Summary');
  XLSX.utils.book_append_sheet(wb, wsFrom([
    ['Period_End', 'Planned_Cum_Hours', 'Forecast_Cum_Hours', 'Earned_Cum_Hours (actual dates)', 'Planned_Pct', 'Earned_Pct'],
    ...model.curve.map((c) => [d(c.periodEnd), c.planned, c.forecast, c.earned ?? '', c.plannedPct, c.earnedPct ?? '']),
  ]), 'S_Curve');
  for (const [name, sheet] of earnedVsActualSheets(model, settings)) XLSX.utils.book_append_sheet(wb, sheet, name);
  return wb;
}



export function workbookBytes(wb: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx', cellDates: true }) as ArrayBuffer);
}

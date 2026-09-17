/**
 * Parity check against the real workbook. The workbook is commercially sensitive and
 * is never committed; point TC_WORKBOOK at a local copy to run this suite:
 *
 *   TC_WORKBOOK=/path/to/TC_P6_Budget_SCurve.xlsx npm test
 *
 * It rebuilds the model from the workbook's own inputs (P6_Extract, Baseline_Extract,
 * Activity_Library, Locations, Test_Progress, Settings) and compares against the
 * workbook's cached Summary, Budget_Master and S_Curve values.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { parseTable } from '../src/engine/parse';
import { sheetToGrid } from '../src/engine/workbook';
import { computeModel } from '../src/engine/compute';
import { parseP6Date } from '../src/engine/dates';
import { accruedFraction } from '../src/engine/curves';
import { isoToMs } from '../src/engine/dates';
import type { LibraryEntry, Location, Settings, TestProgress, Basis, BudgetRow } from '../src/engine/types';

const path = process.env.TC_WORKBOOK;
const available = !!path && existsSync(path);

/** The workbook's own spread: a same-day window credits from the next period, not the day itself. */
function workbookFraction(periodEnd: string, s: string | null, e: string | null): number {
  if (!s || !e) return 0;
  const days = (isoToMs(e) - isoToMs(s)) / 86_400_000 + (e === s ? 1 : 0);
  const f = (isoToMs(periodEnd) - isoToMs(s)) / 86_400_000 / days;
  return f >= 1 ? 1 : f > 0 ? f : 0;
}

describe.skipIf(!available)('real workbook parity', () => {
  if (!available) return;
  const wb = XLSX.read(readFileSync(path!), { cellDates: true });
  const sheet = (n: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[n], { defval: null, raw: true });
  const cellOf = (n: string, ref: string) => wb.Sheets[n][ref]?.v as unknown;

  const settingsRows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Settings'], { header: 1, raw: true, defval: null });
  const setting = (name: string) => settingsRows.find((r) => r[0] === name)?.[1];
  const settings: Settings = {
    storageFolderName: 'x',
    defaultBasis: setting('Default_Basis') as Basis,
    defaultCrew: setting('Default_Crew') as number,
    defaultShiftHours: setting('Default_Shift_Hours') as number,
    defaultComplexity: setting('Default_Complexity') as number,
    dataDate: parseP6Date(setting('Data_Date')).iso ?? '',
    statusDate: parseP6Date(setting('Status_Date')).iso ?? '',
  };

  const current = parseTable(sheetToGrid(wb.Sheets['P6_Extract']));
  const baseline = parseTable(sheetToGrid(wb.Sheets['Baseline_Extract']));

  const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
  const library: LibraryEntry[] = sheet('Activity_Library')
    .filter((r) => str(r['Match_Key']) && str(r['Match_Key'])!.length < 200 && r['Count'] !== null)
    .map((r) => ({
      matchKey: str(r['Match_Key'])!,
      discipline: str(r['Discipline']),
      includeOverride: str(r['Include_Override']) as 'Y' | 'N' | undefined,
      basis: str(r['Basis']) as Basis | undefined,
      crewSize: num(r['Crew_Size']),
      shiftHours: num(r['Shift_Hours']),
      durationShifts: num(r['Duration_Shifts']),
      notes: str(r['Notes']),
    }));
  const locations: Location[] = sheet('Locations')
    .filter((r) => str(r['Location_Code']) && r['Activities'] !== null)
    .map((r) => ({ code: str(r['Location_Code'])!, name: str(r['Location_Name']), complexityFactor: num(r['Complexity_Factor']) }));
  const testProgress: TestProgress[] = sheet('Test_Progress')
    .filter((r) => str(r['P6_Activity_ID']))
    .map((r) => ({
      activityId: str(r['P6_Activity_ID'])!,
      testsTotal: num(r['Tests_Total']),
      testsComplete: num(r['Tests_Complete']),
      pctOverride: num(r['Pct_Override']),
      testStartOverride: parseP6Date(r['Test_Start_Override']).iso ?? undefined,
      testEndOverride: parseP6Date(r['Test_End_Override']).iso ?? undefined,
      updatedAt: '',
    }));

  const model = computeModel({
    settings,
    locations,
    library,
    overrides: [],
    testProgress,
    current: current.activities,
    baseline: baseline.activities,
    snapshots: [],
  });

  it('matches the Summary sheet', () => {
    const s = model.summary;
    expect(s.extractRows).toBe(cellOf('Summary', 'B3'));
    expect(s.wbsRows).toBe(cellOf('Summary', 'B4'));
    expect(s.activities).toBe(cellOf('Summary', 'B5'));
    expect(s.locations).toBe(cellOf('Summary', 'B7'));
    expect(s.activityTypes).toBe(cellOf('Summary', 'B8'));
    expect(s.typesOnDefaults).toBe(cellOf('Summary', 'B9'));
    expect(s.typesNeedingShifts).toBe(cellOf('Summary', 'B10'));
    expect(s.inBudget).toBe(cellOf('Summary', 'B12'));
    expect(s.excluded).toBe(cellOf('Summary', 'B13'));
    expect(s.deletedOrCancelled).toBe(cellOf('Summary', 'B14'));
    expect(s.review).toBe(cellOf('Summary', 'B15'));
    expect(s.totalBudgetHours).toBe(cellOf('Summary', 'B17'));
    expect(s.earnedHours).toBeCloseTo(cellOf('Summary', 'B18') as number, 6);
    expect(s.remainingHours).toBeCloseTo(cellOf('Summary', 'B19') as number, 6);
    expect(s.baselineMatched).toBe(cellOf('Summary', 'B22'));
    expect(s.baselineFallback).toBe(cellOf('Summary', 'B23'));
    expect(s.noDates).toBe(cellOf('Summary', 'B24'));
    expect(s.pctFromTests).toBe(cellOf('Summary', 'B26'));
    expect(s.pctFromP6).toBe(cellOf('Summary', 'B27'));
    expect(s.inProgress).toBe(cellOf('Summary', 'B36'));
    expect(s.p6Actual).toBe(cellOf('Summary', 'B37'));
    expect(s.testWindow).toBe(cellOf('Summary', 'B38'));
    expect(s.notStarted).toBe(cellOf('Summary', 'B39'));
    console.log('Workbook figures reproduced:', JSON.stringify({
      extractRows: s.extractRows, wbsRows: s.wbsRows, activities: s.activities, locations: s.locations,
      activityTypes: s.activityTypes, inBudget: s.inBudget, excluded: s.excluded, deletedOrCancelled: s.deletedOrCancelled,
      review: s.review, totalBudgetHours: s.totalBudgetHours,
    }));
  });

  it('matches Budget_Master row for row', () => {
    const bm = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['Budget_Master'], { defval: null, raw: true });
    const byId = new Map<string, BudgetRow>(model.rows.map((r) => [r.activityId.toLowerCase(), r]));
    let compared = 0;
    for (const r of bm) {
      const id = str(r['P6_Activity_ID']);
      if (!id) continue;
      const m = byId.get(id.toLowerCase());
      expect(m, id).toBeDefined();
      if (!m) continue;
      compared++;
      expect(m.status, `${id} status`).toBe(r['Status']);
      expect(m.matchKey.toLowerCase(), `${id} key`).toBe(String(r['Match_Key']).toLowerCase());
      expect(m.budgetHours, `${id} budget`).toBe(r['Budget_Hours']);
      expect(m.earnedHours, `${id} earned`).toBeCloseTo(r['Earned_Hours'] as number, 6);
      expect(m.baselineSource, `${id} bl src`).toBe(r['Baseline_Source']);
      expect(m.pctSource === 'P6' ? 'P6' : 'TESTS', `${id} pct src`).toBe(r['Pct_Source']);
      expect(m.earnWindowSource, `${id} earn src`).toBe(r['Earn_Window_Source']);
      const rs = r['Rate_Status'];
      expect(m.rateStatus, `${id} rate status`).toBe(rs);
      const es = parseP6Date(r['Earn_Start']).iso;
      expect(m.earnStart, `${id} earn start`).toBe(es);
      const ee = parseP6Date(r['Earn_End']).iso;
      expect(m.earnEnd, `${id} earn end`).toBe(ee);
    }
    expect(compared).toBe(model.rows.length);
  });

  it('rolls the real schedule up by phase without losing or double counting hours', () => {
    const byPhase = model.groups.phase;
    expect(byPhase.reduce((n, g) => n + g.activities, 0)).toBe(model.rows.length);
    expect(byPhase.reduce((n, g) => n + g.budgetHours, 0)).toBeCloseTo(model.summary.totalBudgetHours, 6);
    // The live schedule runs two phases. Its one SW activity (the Training
    // Facility) is Phase 2 work and rolls up there rather than standing alone.
    expect(byPhase.map((g) => g.key).sort()).toEqual(['P2', 'P3']);
    const byLoc = model.groups.location;
    expect(byLoc.reduce((n, g) => n + g.budgetHours, 0)).toBeCloseTo(model.summary.totalBudgetHours, 6);
    expect(byLoc.length).toBe(model.summary.locations);
    console.log('Phase rollup:', JSON.stringify(byPhase.map((g) => ({ phase: g.label, activities: g.activities, budget: g.budgetHours, pct: Math.round(g.pctComplete * 100) }))));
    console.log('Top locations:', JSON.stringify(byLoc.slice(0, 5).map((g) => ({ loc: g.label, budget: g.budgetHours, pct: Math.round(g.pctComplete * 100) }))));
  });

  it('matches the S_Curve sheet using the workbook spread, and only differs by the same-day rule', () => {
    const sc = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets['S_Curve'], { defval: null, raw: true });
    const byPeriod = new Map(model.curve.map((c) => [c.periodEnd, c]));
    let sameDayDiffs = 0;
    for (const r of sc) {
      const p = parseP6Date(r['Period_End']).iso;
      if (!p) continue;
      let planned = 0;
      let forecast = 0;
      let earned = 0;
      for (const m of model.rows) {
        planned += m.budgetHours * workbookFraction(p, m.baselineStart, m.baselineFinish);
        forecast += m.budgetHours * workbookFraction(p, m.currentStart, m.currentFinish);
        earned += m.earnedHours * workbookFraction(p, m.earnStart, m.earnEnd);
      }
      expect(planned, `${p} planned`).toBeCloseTo(r['Planned_Cum_Hours'] as number, 6);
      expect(forecast, `${p} forecast`).toBeCloseTo(r['Forecast_Cum_Hours'] as number, 6);
      const e = r['Earned_Cum_Hours (actual dates)'];
      if (e === null || e === '') expect(p > settings.dataDate).toBe(true);
      else expect(earned, `${p} earned`).toBeCloseTo(e as number, 6);
      // The application's own curve differs only where a same-day window sits exactly on a period end.
      const app = byPeriod.get(p);
      if (app) {
        const sameDay = model.rows.reduce((s, m) => {
          const f = accruedFraction(p, m.baselineStart, m.baselineFinish) - workbookFraction(p, m.baselineStart, m.baselineFinish);
          return s + m.budgetHours * f;
        }, 0);
        expect(app.planned - planned, `${p} app planned delta`).toBeCloseTo(sameDay, 6);
        if (Math.abs(sameDay) > 1e-9) sameDayDiffs++;
      }
    }
    console.log(`S_Curve periods where the same-day rule changes the value: ${sameDayDiffs}`);
  });
});

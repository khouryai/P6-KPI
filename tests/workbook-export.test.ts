/**
 * The exported workbook.
 *
 * It is what leaves the application: somebody opens it in a funding meeting with
 * nobody from the project in the room. So the sheets that answer "which group is
 * carrying the gap, and in which year" have to be in it, and they have to agree
 * with the screen they were exported from rather than being a second pivot of the
 * same months that drifted.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { computeModel } from '../src/engine/compute';
import { fiscalYearDetail, forecastYears, fyStart } from '../src/engine/fiscal';
import { buildWorkbook } from '../src/app/export';
import { DEFAULT_SETTINGS, type LibraryEntry, type Settings, type TeamActual } from '../src/engine/types';
import { makeActivity } from './helpers';

const settings: Settings = { ...DEFAULT_SETTINGS, dataDate: '2026-12-31', fiscalYearStartMonth: 7 };

const library: LibraryEntry[] = [
  { matchKey: 'Test Type', basis: 'RATE', shiftHours: 10, durationShifts: 4, crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'IXL', count: 1 }] },
];

/**
 * Two finished activities in different fiscal years, so the backward split has
 * something to split, and two unfinished ones in years still ahead, so the forward
 * split does too.
 */
const current = [
  makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-05-01', finishDate: '2026-06-30', actualStart: true, actualFinish: true, originalDuration: 10, remainingDuration: 0 }),
  makeActivity({ activityId: '0-P2-TC-A10-FA-0020', startDate: '2026-09-01', finishDate: '2026-10-31', actualStart: true, actualFinish: true, originalDuration: 10, remainingDuration: 0 }),
  makeActivity({ activityId: '0-P2-TC-A10-FA-0030', startDate: '2027-03-01', finishDate: '2027-04-30', originalDuration: 10, remainingDuration: 10 }),
  makeActivity({ activityId: '0-P2-TC-A10-FA-0040', startDate: '2027-09-01', finishDate: '2027-10-31', originalDuration: 10, remainingDuration: 10 }),
];

const teamActuals: TeamActual[] = [
  { id: '1', month: '2026-06', subsystem: 'ATS', hours: 30 },
  { id: '2', month: '2026-06', subsystem: 'IXL', hours: 20 },
  { id: '3', month: '2026-10', subsystem: 'ATS', hours: 25 },
];

const model = computeModel({
  settings,
  locations: [],
  library,
  overrides: [],
  testProgress: [],
  teamActuals,
  current,
  baseline: null,
});

const wb = buildWorkbook(model, settings, current, [], []);
const rows = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name], { defval: null, raw: true });

describe('the earned-against-built sheets', () => {
  it('ships every cut the screen offers', () => {
    for (const name of ['Earned_vs_Actual', 'Fiscal_Year', 'FY_By_Group', 'FY_By_Group_Month', 'Forecast_By_Group']) {
      expect(wb.SheetNames, `${name} missing from the workbook`).toContain(name);
    }
  });

  it('breaks each fiscal year down by group, which is the sheet this was all for', () => {
    const fyGroups = rows('FY_By_Group');
    expect(fyGroups.length).toBeGreaterThan(0);
    for (const r of fyGroups) {
      expect(r).toHaveProperty('Fiscal_Year');
      expect(r).toHaveProperty('Group');
      expect(r).toHaveProperty('Earned_Hours');
      expect(r).toHaveProperty('Built_Hours');
      expect(r).toHaveProperty('Variance_Hours');
    }
    // Both groups are crewed on both activities, so both appear in both years.
    expect(new Set(fyGroups.map((r) => r.Group))).toEqual(new Set(['ATS', 'IXL']));
    expect(new Set(fyGroups.map((r) => r.Fiscal_Year)).size).toBe(2);
  });

  it('says the same thing the screen does, group for group and year for year', () => {
    const detail = fiscalYearDetail(model.burn.months, fyStart(settings.fiscalYearStartMonth));
    const onScreen = detail.flatMap((y) => y.resources.map((r) => [y.label, r.code || 'Unassigned', r.earned, r.built] as const));
    const inSheet = rows('FY_By_Group').map((r) => [r.Fiscal_Year, r.Group, r.Earned_Hours, r.Built_Hours] as const);
    expect(inSheet.length).toBe(onScreen.length);
    for (const [label, group, earned, built] of onScreen) {
      const row = inSheet.find((x) => x[0] === label && x[1] === group);
      expect(row, `${label} / ${group} missing from FY_By_Group`).toBeDefined();
      expect(row![2] as number).toBeCloseTo(earned, 6);
      expect(row![3] as number).toBeCloseTo(built, 6);
    }
  });

  it('adds the group-by-month grid back to the group-by-year totals', () => {
    const byYear = new Map<string, number>();
    for (const r of rows('FY_By_Group_Month')) {
      const k = `${r.Fiscal_Year}|${r.Group}`;
      byYear.set(k, (byYear.get(k) ?? 0) + (r.Built_Hours as number));
    }
    for (const r of rows('FY_By_Group')) {
      expect(byYear.get(`${r.Fiscal_Year}|${r.Group}`) ?? 0).toBeCloseTo(r.Built_Hours as number, 6);
    }
  });

  it('carries the whole project alongside the groups on the forecast sheet', () => {
    const forecast = rows('Forecast_By_Group');
    expect(forecast[0].Group).toBe('WHOLE PROJECT');
    expect(forecast[0].Budget_Hours).toBe(model.burn.project.budgetHours);
  });

  it('leaves a factor blank where nothing was built, rather than reporting a zero rate', () => {
    for (const r of rows('Earned_vs_Actual')) {
      // An empty cell, not a zero: 0.00 would read as "this month earned nothing
      // per hour spent", which is a different claim from "nothing was spent".
      if ((r.Built_Hours as number) === 0) expect(r.Factor).toBe('');
    }
  });
});

describe('what the workbook no longer carries', () => {
  it('has no snapshot sheets, because there are no snapshots', () => {
    expect(wb.SheetNames).not.toContain('Status_History');
    expect(wb.SheetNames).not.toContain('Snapshot');
  });

  it('reports progress as the percent somebody keyed, not as test case counts', () => {
    const header = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['Progress'], { header: 1 })[0] as string[];
    expect(header).toContain('Pct_Complete_Keyed');
    expect(header.join(' ')).not.toMatch(/Tests?_/);
  });
});

/**
 * The forward-looking sheets. A funding conversation happens a year at a time and
 * a group at a time, and the answer to "what does IXL need in FY28" should not
 * require anybody to pivot a month table by hand.
 */
describe('the fiscal years still ahead', () => {
  it('ships the future cut as its own sheets', () => {
    for (const name of ['FY_Forecast', 'FY_Forecast_By_Group', 'FY_Forecast_By_Month']) {
      expect(wb.SheetNames, `${name} missing from the workbook`).toContain(name);
    }
  });

  it('carries a row per group per year still ahead', () => {
    const ahead = rows('FY_Forecast_By_Group');
    expect(ahead.length).toBeGreaterThan(0);
    // FY27 (Mar–Apr 27) and FY28 (Sep–Oct 27), each worked by both groups.
    expect(new Set(ahead.map((r) => r.Fiscal_Year))).toEqual(new Set(['FY27', 'FY28']));
    expect(new Set(ahead.map((r) => r.Group))).toEqual(new Set(['ATS', 'IXL']));
  });

  it('accounts for every hour of remaining budget across the years ahead', () => {
    const placed = rows('FY_Forecast').reduce((s, r) => s + (r.Budget_Left_Hours as number), 0);
    expect(placed + model.burn.unphasedRemaining).toBeCloseTo(model.burn.project.remainingHours, 6);
  });

  it('leaves the forecast cost blank for a group with no rate to project with', () => {
    // IXL booked hours in June only; ATS has a rate in both. Whatever the data, a
    // blank must never be written as a zero — a zero cost reads as free work.
    for (const r of rows('FY_Forecast_By_Group')) {
      expect(r.Forecast_Cost_Hours === '' || typeof r.Forecast_Cost_Hours === 'number').toBe(true);
      if (r.Forecast_Cost_Hours === '') expect(r.Over_Under_Hours).toBe('');
    }
  });

  it('keeps forecast columns out of the sheets that report measurements', () => {
    // A past year reports what happened; a future year reports intent plus a rate.
    // Sharing headings would invite one to be read as the other.
    const past = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['FY_By_Group'], { header: 1 })[0] as string[];
    const ahead = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets['FY_Forecast_By_Group'], { header: 1 })[0] as string[];
    expect(past).toContain('Earned_Hours');
    expect(past).not.toContain('Budget_Left_Hours');
    expect(ahead).toContain('Budget_Left_Hours');
    expect(ahead).toContain('Forecast_Cost_Hours');
    expect(ahead).not.toContain('Earned_Hours');
  });

  it('says the same thing the screen does, group for group and year for year', () => {
    const ahead = forecastYears(model.burn.forecastMonths, fyStart(settings.fiscalYearStartMonth));
    const onScreen = ahead.flatMap((y) => y.resources.map((r) => [y.label, r.code || 'Unassigned', r.earned] as const));
    const inSheet = rows('FY_Forecast_By_Group').map((r) => [r.Fiscal_Year, r.Group, r.Budget_Left_Hours] as const);
    expect(inSheet.length).toBe(onScreen.length);
    for (const [label, group, left] of onScreen) {
      const row = inSheet.find((x) => x[0] === label && x[1] === group);
      expect(row, `${label} / ${group} missing from FY_Forecast_By_Group`).toBeDefined();
      expect(row![2] as number).toBeCloseTo(left, 6);
    }
  });

  it('adds the future months back to the future year totals', () => {
    const byYear = new Map<string, number>();
    for (const r of rows('FY_Forecast_By_Month')) {
      const k = `${r.Fiscal_Year}|${r.Group}`;
      byYear.set(k, (byYear.get(k) ?? 0) + (r.Budget_Left_Hours as number));
    }
    for (const r of rows('FY_Forecast_By_Group')) {
      expect(byYear.get(`${r.Fiscal_Year}|${r.Group}`) ?? 0).toBeCloseTo(r.Budget_Left_Hours as number, 6);
    }
  });
});

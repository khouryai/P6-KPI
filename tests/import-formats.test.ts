import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { parseTable } from '../src/engine/parse';
import { detectLayout, columnLabel, DEFAULT_MAP } from '../src/engine/columns';
import { readWorkbook, workbookGrid, parseWorkbookSheet } from '../src/engine/workbook';
import { parseXer, isXer, xerToActivities } from '../src/engine/xer';
import { computeModel } from '../src/engine/compute';
import { FIXTURE_DIR, fixtureModelInput, loadFixtureWorkbook } from './helpers';

const grid = (file: string, sheet: string) => workbookGrid(readWorkbook(new Uint8Array(readFileSync(resolve(FIXTURE_DIR, file)))), sheet);

describe('column detection', () => {
  it('finds the header by name and skips P6 title rows above it', () => {
    const g = grid('tc-fixture-shuffled.xlsx', 'Export');
    const lay = detectLayout(g);
    expect(lay.fromHeader).toBe(true);
    expect(lay.headerRow).toBe(2);
    expect(lay.map).toEqual({ activityName: 0, start: 1, finish: 2, activityId: 3, remainingDuration: 4, originalDuration: 5 });
  });

  it('a reordered export with title rows parses identically to the standard one', () => {
    const straight = parseWorkbookSheet(readWorkbook(new Uint8Array(readFileSync(resolve(FIXTURE_DIR, 'tc-fixture.xlsx')))), 'P6_Extract');
    const shuffled = parseTable(grid('tc-fixture-shuffled.xlsx', 'Export'));
    expect(shuffled.skippedBeforeHeader).toBe(2);
    expect(shuffled.activities.length).toBe(straight.activities.length);
    const key = (a: { activityId: string; rowType: string; originalDuration: number | null; startDate: string | null; finishDate: string | null; actualStart: boolean }) =>
      [a.activityId, a.rowType, a.originalDuration, a.startDate, a.finishDate, a.actualStart].join('|');
    expect(shuffled.activities.map(key)).toEqual(straight.activities.map(key));
  });

  it('falls back to column position when there is no header', () => {
    const lay = detectLayout([['0-P2-TC-W40-FA-0010', '[T&C] W40 - A', 5, 5, '01-Jan-26', '05-Jan-26']]);
    expect(lay.fromHeader).toBe(false);
    expect(lay.headerRow).toBeNull();
    expect(lay.map).toEqual(DEFAULT_MAP);
  });

  it('respects a mapping supplied by the user over the detected one', () => {
    const g = [
      ['Widget', 'Thing', 'A', 'B', 'C', 'D'],
      ['[T&C] W40 - Core DCS', '0-P2-TC-W40-FA-0010', 5, 5, '01-Jan-26', '05-Jan-26'],
    ];
    const forced = parseTable(g, { headerRow: 0, firstDataRow: 1, fromHeader: true, matchedNames: {}, map: { activityId: 1, activityName: 0, originalDuration: 2, remainingDuration: 3, start: 4, finish: 5 } });
    expect(forced.activities[0].activityId).toBe('0-P2-TC-W40-FA-0010');
    expect(forced.activities[0].activityType).toBe('Core DCS');
  });

  it('labels columns like a spreadsheet', () => {
    expect(columnLabel(0, null)).toBe('A');
    expect(columnLabel(26, null)).toBe('AA');
    expect(columnLabel(2, ['a', 'b', 'Original Duration'])).toBe('C: Original Duration');
  });
});

describe('P6 XER import', () => {
  const text = readFileSync(resolve(FIXTURE_DIR, 'tc-fixture.xer'), 'utf8');

  it('recognises the format and splits the tables', () => {
    expect(isXer(text)).toBe(true);
    expect(isXer('Activity ID\tActivity Name')).toBe(false);
    const tables = parseXer(text);
    expect([...tables.keys()].sort()).toEqual(['CALENDAR', 'PROJECT', 'TASK']);
    expect(tables.get('TASK')!.rows.length).toBe(25);
  });

  it('converts hours to days using each activity own calendar', () => {
    const r = xerToActivities(parseXer(text), { hoursPerDay: 8 });
    expect(r.usedFallbackHours).toBe(0);
    expect(r.calendarHours.map((c) => c.hoursPerDay).sort((a, b) => a - b)).toEqual([8, 10]);
    // 96 hours on an 8 hour calendar is 12 days.
    expect(r.activities.find((a) => a.activityId === '0-P2-TC-A10-FA-0010')!.originalDuration).toBe(12);
    // 200 hours on the 10 hour calendar is still 20 days, not 25.
    expect(r.activities.find((a) => a.activityId === '0-P2-TC-C30-FA-0030')!.originalDuration).toBe(20);
  });

  it('falls back to the supplied hours per day and says so when no calendar is present', () => {
    const noCal = text.split('\r\n').filter((l) => !l.startsWith('%R\t1\tStandard') && !l.startsWith('%R\t2\tNight')).join('\r\n');
    const r = xerToActivities(parseXer(noCal), { hoursPerDay: 10 });
    expect(r.usedFallbackHours).toBe(25);
    expect(r.warnings.join(' ')).toMatch(/10 hours per day/);
    expect(r.activities.find((a) => a.activityId === '0-P2-TC-A10-FA-0010')!.originalDuration).toBe(9.6);
  });

  it('carries the actual start and finish flags across', () => {
    const r = xerToActivities(parseXer(text), { hoursPerDay: 8 });
    const done = r.activities.find((a) => a.activityId === '0-P2-TC-A10-FA-0010')!;
    expect([done.actualStart, done.actualFinish]).toEqual([true, true]);
    const running = r.activities.find((a) => a.activityId === '0-P2-TC-A10-FA-0030')!;
    expect([running.actualStart, running.actualFinish]).toEqual([true, false]);
    expect(running.startDate).toBe('2026-08-18');
    const future = r.activities.find((a) => a.activityId === '0-P2-TC-B20-FA-0010')!;
    expect([future.actualStart, future.actualFinish]).toEqual([false, false]);
  });

  it('holds activities only, so there are no WBS rows to exclude', () => {
    const r = xerToActivities(parseXer(text), { hoursPerDay: 8 });
    expect(r.activities.every((a) => a.rowType === 'ACTIVITY')).toBe(true);
    const excel = loadFixtureWorkbook().current.activities.filter((a) => a.rowType === 'ACTIVITY');
    expect(r.activities.map((a) => a.activityId).sort()).toEqual(excel.map((a) => a.activityId).sort());
  });

  it('budgets the same hours as the Excel path, and reads a date Excel could not', () => {
    const r = xerToActivities(parseXer(text), { hoursPerDay: 8 });
    const viaXer = computeModel(fixtureModelInput({ current: r.activities }));
    const viaExcel = computeModel(fixtureModelInput());
    expect(viaXer.summary.totalBudgetHours).toBe(viaExcel.summary.totalBudgetHours);
    expect(viaXer.summary.inBudget).toBe(viaExcel.summary.inBudget);
    expect(viaXer.summary.wbsRows).toBe(0);
    // The Excel export carried a P6 constraint star that DATEVALUE cannot read; the
    // native format carries a real date, so one fewer activity is missing a start.
    const starred = '0-P2-TC-C30-FA-0060';
    expect(viaExcel.rows.find((x) => x.activityId === starred)!.currentStart).toBeNull();
    expect(viaXer.rows.find((x) => x.activityId === starred)!.currentStart).toBe('2026-10-01');
  });

  it('lists the projects in a multi project file', () => {
    const two = text.replace('%R\t100\tSAMPLE-PH2', '%R\t100\tSAMPLE-PH2\n%R\t200\tOTHER-PROJ').replace(/%R\t1000\t100\t/, '%R\t1000\t200\t');
    const tables = parseXer(two);
    const all = xerToActivities(tables, { hoursPerDay: 8 });
    expect(all.projects.map((p) => p.shortName).sort()).toEqual(['OTHER-PROJ', 'SAMPLE-PH2']);
    expect(all.warnings.join(' ')).toMatch(/2 projects/);
    const one = xerToActivities(tables, { hoursPerDay: 8, projectShortName: 'SAMPLE-PH2' });
    expect(one.activities.length).toBe(24);
  });

  it('reports a file with no TASK table instead of throwing', () => {
    const r = xerToActivities(parseXer('ERMHDR\t19.12\n%T\tPROJECT\n%F\tproj_id\n%R\t1\n'), { hoursPerDay: 8 });
    expect(r.activities).toEqual([]);
    expect(r.warnings[0]).toMatch(/no TASK table/);
  });
});

describe('spreadsheet sniffing', () => {
  it('reads the fixture workbook sheets by name', () => {
    const wb = readWorkbook(new Uint8Array(readFileSync(resolve(FIXTURE_DIR, 'tc-fixture.xlsx'))));
    expect(wb.SheetNames).toContain('P6_Extract');
    expect(XLSX.utils.sheet_to_json(wb.Sheets['P6_Extract']).length).toBe(32);
  });
});

/**
 * The full data extract: everything in the application, every column defined.
 *
 * The promise the workbook makes is that nobody needs the application to read it.
 * So every heading on every sheet has to have a meaning in Data_Dictionary, every
 * sheet has to be on Contents, and the things the source layout leaves out — hidden
 * activities, splits, crews — have to be in it.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { computeModel } from '../src/engine/compute';
import { buildDataExtract, dataExtractBytes, STATUS_CODES } from '../src/app/dataExtract';
import { emptyStoreData, type StoreData } from '../src/storage/store';
import { fixtureModelInput } from './helpers';

const input = fixtureModelInput();
const first = input.current.find((a) => a.rowType === 'ACTIVITY')!;
const second = input.current.filter((a) => a.rowType === 'ACTIVITY')[1];
const overrides = [
  ...input.overrides,
  { activityId: first.activityId, locationSplit: [{ location: 'ZZ9', share: 0.25 }], note: 'shared with ZZ9' },
  { activityId: second.activityId, visibility: 'HIDDEN' as const },
];
const model = computeModel({ ...input, overrides, locations: [...input.locations, { code: 'ZZ9', name: 'Millbury Station' }] });
const data: StoreData = {
  ...emptyStoreData(),
  settings: input.settings,
  locations: [...input.locations, { code: 'ZZ9', name: 'Millbury Station' }],
  library: input.library,
  overrides,
  testProgress: input.testProgress,
  teamActuals: [{ id: 't1', month: '2026-01', subsystem: 'ATS', hours: 120 }],
  current: { id: 'c1', kind: 'current', importedAt: '2026-09-01T10:00:00Z', sourceFilename: 'current.xlsx', rowCount: input.current.length, activities: input.current },
  baseline: input.baseline ? { id: 'b1', kind: 'baseline', importedAt: '2026-01-01T10:00:00Z', sourceFilename: 'baseline.xlsx', rowCount: input.baseline.length, activities: input.baseline } : null,
};
const { wb, sheets } = buildDataExtract(model, data, { generatedAt: new Date('2026-10-21T08:00:00Z'), trigger: 'scheduled' });
const rowsOf = (name: string) => XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[name]);

describe('the full data extract', () => {
  it('opens on Contents, Data_Dictionary and Status_Codes', () => {
    expect(wb.SheetNames.slice(0, 3)).toEqual(['Contents', 'Data_Dictionary', 'Status_Codes']);
  });

  it('defines every heading on every tabular sheet', () => {
    const dict = rowsOf('Data_Dictionary');
    const defined = new Set(dict.filter((r) => String(r.Meaning ?? '').trim()).map((r) => `${r.Sheet}|${r.Column}`));
    const missing: string[] = [];
    for (const s of sheets) {
      if (s.columns.length === 0) continue; // a key/value sheet, described on Contents
      const headers = (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[s.name], { header: 1 })[s.headerRow] ?? []) as unknown[];
      for (const h of headers) if (!defined.has(`${s.name}|${h}`)) missing.push(`${s.name}: ${h}`);
    }
    expect(missing).toEqual([]);
  });

  it('lists every sheet on Contents, with what it holds', () => {
    const contents = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Contents, { header: 1 });
    const listed = new Map(contents.filter((r) => r.length >= 2).map((r) => [String(r[0]), String(r[1] ?? '')]));
    for (const name of wb.SheetNames) {
      expect(listed.has(name), `${name} is not on Contents`).toBe(true);
      expect(listed.get(name)!.length, `${name} has no description`).toBeGreaterThan(10);
    }
  });

  it('keeps every sheet name within Excel’s 31 characters', () => {
    for (const n of wb.SheetNames) expect(n.length).toBeLessThanOrEqual(31);
  });

  it('carries every activity, hidden ones marked, with its status and its location by name', () => {
    const acts = rowsOf('All_Activities');
    expect(acts).toHaveLength(model.rows.length + model.hiddenRows.length);
    const hidden = acts.find((r) => r.Activity_ID === second.activityId)!;
    expect(hidden.Hidden).toBe('Y');
    expect(hidden.In_Budget_Setting).toBe('Hide (remove)');
    const split = acts.find((r) => r.Activity_ID === first.activityId)!;
    expect(String(split.Location_Name)).toContain('Millbury Station 25%');
    expect(split.Budget_Note).toBe('shared with ZZ9');
    expect(['IN BUDGET', 'EXCLUDED', 'REVIEW', 'DELETED', 'CANCELLED']).toContain(split.Status);
  });

  it('gives a split activity one row per location, adding back to its budget', () => {
    const lines = rowsOf('Activity_Locations').filter((r) => r.Activity_ID === first.activityId);
    expect(lines.map((r) => r.Location_Name)).toContain('Millbury Station');
    const row = model.rows.find((r) => r.activityId === first.activityId)!;
    expect(lines.reduce((s, r) => s + Number(r.Budget_Hours_Here), 0)).toBeCloseTo(row.budgetHours, 6);
  });

  it('defines every status value the activities carry', () => {
    const known = new Set(STATUS_CODES.filter((c) => c.field === 'Status').map((c) => c.value));
    for (const r of rowsOf('All_Activities')) expect(known.has(String(r.Status))).toBe(true);
  });

  it('writes percentages, hours and dates with their number formats', () => {
    const ws = wb.Sheets.All_Activities;
    const header = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 })[0] as string[];
    const cell = (col: string) => ws[XLSX.utils.encode_cell({ r: 1, c: header.indexOf(col) })] as XLSX.CellObject;
    expect(cell('Pct_Complete').z).toBe('0.0%');
    expect(cell('Budget_Hours').z).toBe('#,##0.0');
  });

  it('still carries the source workbook’s sheets', () => {
    for (const n of ['Budget_Master', 'Locations', 'Activity_Library', 'S_Curve', 'Earned_vs_Actual', 'Summary']) expect(wb.SheetNames).toContain(n);
  });

  it('writes to a file Excel can open', () => {
    const bytes = dataExtractBytes(model, data, { generatedAt: new Date(), trigger: 'manual' });
    const back = XLSX.read(bytes, { type: 'array' });
    expect(back.SheetNames).toEqual(wb.SheetNames);
  });
});

/**
 * Static, Dynamic or Other: set on an Activity Library key for the whole type, or on
 * one activity, which wins. Unset is Other. Rollups and exports split by it.
 */
import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { computeModel } from '../src/engine/compute';
import { buildDataExtract } from '../src/app/dataExtract';
import { emptyStoreData } from '../src/storage/store';
import { makeActivity } from './helpers';
import type { ActivityOverride, LibraryEntry, ModelInput } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const settings = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', defaultCrew: 1, defaultShiftHours: 8, defaultComplexity: 1 };
const lib: LibraryEntry[] = [
  { matchKey: 'Static Test', basis: 'DUR', crewSize: 1, shiftHours: 8, kind: 'STATIC' },
  { matchKey: 'Loose Type', basis: 'DUR', crewSize: 1, shiftHours: 8 },
];
function input(overrides: ActivityOverride[] = []): ModelInput {
  return {
    settings,
    locations: [{ code: 'X10' }],
    library: lib,
    overrides,
    testProgress: [{ activityId: 'A-P2-TC-X10-FA-0010', pctOverride: 0.5, updatedAt: 'x' }],
    current: [
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', activityType: 'Static Test', sortOrder: 0 }),
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0020', activityType: 'Static Test', sortOrder: 1 }),
      makeActivity({ activityId: 'A-P3-TC-X10-FA-0030', activityType: 'Loose Type', sortOrder: 2 }),
    ],
    baseline: null,
  };
}
const kindOf = (m: ReturnType<typeof computeModel>, id: string) => m.rows.find((r) => r.activityId === id)!;

describe('Static / Dynamic', () => {
  it('follows the library key, and is Other where nothing is set', () => {
    const m = computeModel(input());
    expect(kindOf(m, 'A-P2-TC-X10-FA-0010')).toMatchObject({ kind: 'STATIC', kindSource: 'library' });
    expect(kindOf(m, 'A-P3-TC-X10-FA-0030')).toMatchObject({ kind: 'OTHER', kindSource: 'default' });
  });

  it('is overridden on one activity in Budget Master', () => {
    const m = computeModel(input([{ activityId: 'A-P2-TC-X10-FA-0020', kind: 'DYNAMIC' }]));
    expect(kindOf(m, 'A-P2-TC-X10-FA-0020')).toMatchObject({ kind: 'DYNAMIC', kindSource: 'activity' });
    expect(kindOf(m, 'A-P2-TC-X10-FA-0010').kind).toBe('STATIC');
  });

  it('splits the KPIs, adding back to the whole', () => {
    const m = computeModel(input([{ activityId: 'A-P2-TC-X10-FA-0020', kind: 'DYNAMIC' }]));
    const g = Object.fromEntries(m.groups.kind.map((x) => [x.label, x]));
    expect(g.Static.budgetHours).toBe(80);
    expect(g.Static.pctComplete).toBeCloseTo(0.5, 10);
    expect(g.Dynamic.budgetHours).toBe(80);
    expect(m.groups.kind.reduce((s, x) => s + x.budgetHours, 0)).toBe(m.summary.totalBudgetHours);
  });

  it('is in the export, with a KPI sheet by phase', () => {
    const overrides: ActivityOverride[] = [{ activityId: 'A-P2-TC-X10-FA-0020', kind: 'DYNAMIC' }];
    const m = computeModel(input(overrides));
    const { wb } = buildDataExtract(m, { ...emptyStoreData(), settings, library: lib, overrides }, { generatedAt: new Date(), trigger: 'manual' });
    const acts = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.All_Activities);
    expect(acts.find((r) => r.Activity_ID === 'A-P2-TC-X10-FA-0020')).toMatchObject({ Static_Dynamic: 'Dynamic', Static_Dynamic_Source: 'Set on the activity' });
    const kpi = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.KPI_By_Static_Dynamic);
    const p2Static = kpi.find((r) => r.Phase === 'Phase 2' && r.Static_Dynamic === 'Static')!;
    expect(p2Static.Budget_Hours).toBe(80);
    expect(p2Static.Pct_Complete).toBeCloseTo(0.5, 10);
    expect(kpi.find((r) => r.Phase === 'Whole project' && r.Static_Dynamic === 'All')!.Budget_Hours).toBe(240);
    const bm = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Budget_Master);
    expect(bm.every((r) => ['Static', 'Dynamic', 'Other'].includes(String(r.Static_Dynamic)))).toBe(true);
    const lib2 = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets.Activity_Library);
    expect(lib2.find((r) => r.Match_Key === 'Static Test')!.Static_Dynamic).toBe('Static');
  });
});

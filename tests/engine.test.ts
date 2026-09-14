import { describe, it, expect } from 'vitest';
import { parseP6Date, parseDdMmmYy, excelSerialToISO, monthEndsBetween } from '../src/engine/dates';
import { parseTable, parseTsv, parseCsv, activityTypeOf, locationOf, seqCodeOf } from '../src/engine/parse';
import { discoverLibrary, discoverLocations } from '../src/engine/discover';
import { indexLibrary, resolveMatchKey, dropLastParenthetical } from '../src/engine/match';
import { accruedFraction } from '../src/engine/curves';
import { computeModel, buildSnapshot, effectiveInclude } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type LibraryEntry } from '../src/engine/types';
import { fixtureModelInput, loadExpected, loadFixtureWorkbook, makeActivity, FIXTURE_DIR } from './helpers';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', statusDate: '2026-08-31' };

describe('date parsing', () => {
  it('parses a two digit year in the 2030s as 2030, not 1930', () => {
    expect(parseDdMmmYy('26-Aug-30')).toBe('2030-08-26');
    expect(parseP6Date('26-Aug-30').iso).toBe('2030-08-26');
    expect(parseP6Date('5-Apr-30').iso).toBe('2030-04-05');
  });
  it('strips the trailing A on actual dates and sets the actual flag', () => {
    const d = parseP6Date('31-Jan-25 A');
    expect(d).toMatchObject({ iso: '2025-01-31', actual: true, unparseable: false });
    expect(parseP6Date('31-Jan-25').actual).toBe(false);
  });
  it('accepts Excel serials and Date objects', () => {
    expect(excelSerialToISO(45658)).toBe('2025-01-01');
    expect(parseP6Date(45658)).toMatchObject({ iso: '2025-01-01', actual: false });
    expect(parseP6Date(new Date(2027, 2, 1)).iso).toBe('2027-03-01');
  });
  it('treats an empty cell as no date, not an error', () => {
    expect(parseP6Date('')).toMatchObject({ iso: null, actual: false, unparseable: false });
    expect(parseP6Date(null)).toMatchObject({ iso: null, unparseable: false });
  });
  it('flags a constraint-starred date as unparseable, like the workbook', () => {
    expect(parseP6Date('01-Oct-26*')).toMatchObject({ iso: null, unparseable: true });
  });
  it('lists month ends across a year boundary and a leap year', () => {
    expect(monthEndsBetween('2027-11-15', '2028-03-01')).toEqual([
      '2027-11-30', '2027-12-31', '2028-01-31', '2028-02-29', '2028-03-31',
    ]);
  });
});

describe('row parsing', () => {
  it('derives location, seq code and activity type', () => {
    expect(locationOf('                    0-P2-TC-W40-FA-0100')).toBe('W40');
    expect(locationOf('0-P2-MS-0010')).toBe('');
    expect(seqCodeOf('0-P2-TC-W40-FA-0100')).toBe('FA-0100');
    expect(activityTypeOf('[T&C] W40 (Ph2) - Core DCS (IP Network)')).toBe('Core DCS (IP Network)');
    expect(activityTypeOf('Plain name')).toBe('Plain name');
  });
  it('keeps the raw indented ID and trims the join key', () => {
    const t = parseTable([['Activity ID', 'Activity Name', 'OD', 'RD', 'Start', 'Finish'], ['    0-P2-TC-W40-FA-0100', '[T&C] W40 - X', 5, 5, '', '']]);
    expect(t.headerSkipped).toBe(true);
    expect(t.activities[0].rawActivityId).toBe('    0-P2-TC-W40-FA-0100');
    expect(t.activities[0].activityId).toBe('0-P2-TC-W40-FA-0100');
  });
  it('classifies WBS rows, deleted and cancelled rows', () => {
    const t = parseTable([
      ['  Phase 2', '', 1814, 1814, '31-Jan-25 A', '26-Aug-30'],
      ['0-P2-TC-W40-FA-0010', '[T&C] W40 - Thing (Deleted)', 1, 1, '', ''],
      ['0-P2-TC-W40-FA-0020', '[T&C] W40 - Thing (cancelled)', 1, 1, '', ''],
    ]);
    expect(t.activities.map((a) => a.rowType)).toEqual(['WBS', 'ACTIVITY', 'ACTIVITY']);
    expect(t.activities.map((a) => a.excludeReason)).toEqual([null, 'DELETED', 'CANCELLED']);
    expect(t.activities[0].originalDuration).toBe(1814);
  });
  it('reports duplicate IDs, unparseable dates and tolerates trailing columns', () => {
    const t = parseTable([
      ['0-P2-TC-W40-FA-0010', '[T&C] W40 - A', 1, 1, '01-Oct-26*', '', 'extra', 'cols'],
      ['0-P2-TC-W40-FA-0010', '[T&C] W40 - A', 1, 1, '', ''],
    ]);
    expect(t.duplicateIds).toEqual(['0-P2-TC-W40-FA-0010']);
    expect(t.unparseableDates).toBe(1);
  });
  it('parses a clipboard TSV block and a CSV block', () => {
    const tsv = readFileSync(resolve(FIXTURE_DIR, 'tc-fixture-current.tsv'), 'utf8');
    const grid = parseTsv(tsv);
    const t = parseTable(grid);
    expect(t.headerSkipped).toBe(true);
    expect(t.activities.length).toBe(32);
    expect(t.activities.filter((a) => a.rowType === 'ACTIVITY').length).toBe(25);
    // Excel writes real dates as m/d/yyyy on the clipboard.
    const a = t.activities.find((x) => x.activityId === '0-P2-TC-A10-FA-0040')!;
    expect(a.startDate).toBe('2026-10-05');
    const csv = parseCsv('a,"b,c",d\n1,"say ""hi""",3\n');
    expect(csv).toEqual([['a', 'b,c', 'd'], ['1', 'say "hi"', '3']]);
  });
});

describe('discovery', () => {
  it('discovers locations and types in first appearance order, case-insensitively', () => {
    const { current } = loadFixtureWorkbook();
    const exp = loadExpected();
    expect(discoverLocations(current.activities, []).map((l) => l.code)).toEqual(exp.locationsDiscovered);
    expect(discoverLibrary(current.activities, []).map((e) => e.matchKey)).toEqual(exp.typesDiscovered);
  });
  it('keeps existing entries and their rates, never deletes, never re-adds retired keys', () => {
    const { current } = loadFixtureWorkbook();
    const existing: LibraryEntry[] = [
      { matchKey: 'Core Network Test', crewSize: 9, durationShifts: 3 },
      { matchKey: 'Something Gone', basis: 'RATE' },
      { matchKey: 'Special Test (Ad hoc)', retired: true },
    ];
    const lib = discoverLibrary(current.activities, existing);
    expect(lib[0]).toEqual(existing[0]);
    expect(lib.find((e) => e.matchKey === 'Something Gone')).toBeDefined();
    expect(lib.filter((e) => e.matchKey === 'Special Test (Ad hoc)').length).toBe(1);
    const locs = discoverLocations(current.activities, [{ code: 'C30', complexityFactor: 1.25 }]);
    expect(locs[0]).toEqual({ code: 'C30', complexityFactor: 1.25 });
    expect(locs.length).toBe(5);
  });
});

describe('two tier match resolution', () => {
  it('drops the last parenthetical group', () => {
    expect(dropLastParenthetical('IXL Sim Mode Test (Adjacent Location) (DF: W40 -> Y10)')).toBe('IXL Sim Mode Test (Adjacent Location)');
    expect(dropLastParenthetical('No parens')).toBe('No parens');
  });
  it('maps all four DF variants to one consolidated library key', () => {
    const idx = indexLibrary([{ matchKey: 'IXL Sim Mode Test (Adjacent Location)' }]);
    for (const v of ['W40 -> Y10', 'Y10 -> W40', 'W40 -> W34', 'W34 -> W40']) {
      const r = resolveMatchKey(`IXL Sim Mode Test (Adjacent Location) (DF: ${v})`, idx);
      expect(r.matchKey).toBe('IXL Sim Mode Test (Adjacent Location)');
      expect(r.tier).toBe(2);
    }
  });
  it('leaves an unresolved type for REVIEW', () => {
    const idx = indexLibrary([{ matchKey: 'Other' }]);
    expect(resolveMatchKey('Special Test (Ad hoc)', idx)).toEqual({ matchKey: 'Special Test', entry: null, tier: null });
  });
  it('matches case-insensitively, like Excel', () => {
    const idx = indexLibrary([{ matchKey: 'IXL Cutover (by BART)' }]);
    expect(resolveMatchKey('IXL Cutover (By BART)', idx).tier).toBe(1);
  });
});

describe('include and exclude', () => {
  it('excludes (by BART), (by Others) and (Deleted) keys with no user input', () => {
    expect(effectiveInclude({ matchKey: 'IXL Cutover (by BART)' })).toBe('N');
    expect(effectiveInclude({ matchKey: 'Wiring (By Others)' })).toBe('N');
    expect(effectiveInclude({ matchKey: 'Thing (Deleted)' })).toBe('N');
    expect(effectiveInclude({ matchKey: 'Thing' })).toBe('Y');
    expect(effectiveInclude({ matchKey: 'IXL Cutover (by BART)', includeOverride: 'Y' })).toBe('Y');
  });
});

describe('accrued fraction', () => {
  it('credits a same day activity in full on that day', () => {
    expect(accruedFraction('2025-12-31', '2025-12-31', '2025-12-31')).toBe(1);
    expect(accruedFraction('2025-11-30', '2025-12-31', '2025-12-31')).toBe(0);
  });
  it('spreads linearly and clamps', () => {
    expect(accruedFraction('2026-01-11', '2026-01-01', '2026-01-21')).toBeCloseTo(0.5);
    expect(accruedFraction('2026-02-01', '2026-01-01', '2026-01-21')).toBe(1);
    expect(accruedFraction('2025-12-31', '2026-01-01', '2026-01-21')).toBe(0);
    expect(accruedFraction('2026-01-01', null, '2026-01-21')).toBe(0);
  });
});

describe('fixture acceptance', () => {
  const model = computeModel(fixtureModelInput());
  const exp = loadExpected();

  it('reproduces the headline figures', () => {
    for (const [k, v] of Object.entries(exp.summary)) {
      if (k === 'activityTypesDiscovered') continue;
      const got = (model.summary as unknown as Record<string, number>)[k];
      expect(got, k).toBeCloseTo(v, 6);
    }
  });

  it('reproduces every activity line', () => {
    for (const r of model.rows) {
      const e = exp.activities[r.activityId];
      expect(e, r.activityId).toBeDefined();
      expect(r.status).toBe(e.status);
      expect(r.matchKey).toBe(e.matchKey);
      expect(r.matchTier).toBe(e.tier);
      expect(r.budgetHours).toBe(e.budget);
      expect(r.earnedHours).toBeCloseTo(e.earned as number, 9);
      expect(r.pctSource).toBe(e.pctSource);
      expect(r.baselineSource).toBe(e.blsrc);
      expect(r.earnWindowSource).toBe(e.esrc);
      expect(r.earnStart).toBe(e.earnStart);
      expect(r.earnEnd).toBe(e.earnEnd);
      expect(r.loeFlag).toBe(e.loe);
    }
    expect(model.rows.length).toBe(Object.keys(exp.activities).length);
  });

  it('reproduces the three curves period by period', () => {
    expect(model.curve.map((c) => c.periodEnd)).toEqual(exp.curve.map((c) => c.periodEnd));
    model.curve.forEach((c, i) => {
      expect(c.planned, c.periodEnd).toBeCloseTo(exp.curve[i].planned, 6);
      expect(c.forecast, c.periodEnd).toBeCloseTo(exp.curve[i].forecast, 6);
      if (exp.curve[i].earned === null) expect(c.earned).toBeNull();
      else expect(c.earned, c.periodEnd).toBeCloseTo(exp.curve[i].earned as number, 6);
    });
  });

  it('an indented Activity ID matches its trimmed counterpart in the baseline import', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-B20-FA-0010')!;
    expect(r.activity.rawActivityId.startsWith('    ')).toBe(true);
    expect(r.baselineSource).toBe('BASELINE');
    expect(r.baselineStart).toBe('2026-10-19'); // 14 days before the current start
  });

  it('a WBS row with a 1,814 day duration contributes zero hours', () => {
    expect(model.rows.some((r) => r.activity.rawActivityId.trim() === 'Phase 2')).toBe(false);
    expect(model.summary.wbsRows).toBe(7);
  });

  it('a (by BART) activity is excluded without any user input', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-A10-FA-0050')!;
    expect(r.status).toBe('EXCLUDED');
    expect(r.budgetHours).toBe(0);
    expect(model.library.find((l) => l.matchKey === 'Cutover (by BART)')!.entry.includeOverride).toBeUndefined();
  });

  it('a same day activity credits its full hours on that day', () => {
    const p = model.curve.find((c) => c.periodEnd === '2025-12-31')!;
    const before = model.curve.find((c) => c.periodEnd === '2025-11-30')!;
    expect(p.planned - before.planned).toBe(50); // 40 std x 1.25 complexity
    expect((p.earned ?? 0) - (before.earned ?? 0)).toBe(50);
  });

  it('the earned curve returns null for every period after the data date', () => {
    for (const c of model.curve) {
      if (c.periodEnd > '2026-08-31') expect(c.earned, c.periodEnd).toBeNull();
      else expect(c.earned).not.toBeNull();
    }
  });

  it('an in-progress activity earns from its actual start to the data date, scaled by pct', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-A10-FA-0030')!;
    expect(r.earnWindowSource).toBe('IN PROGRESS');
    expect(r.earnStart).toBe('2026-08-18');
    expect(r.earnEnd).toBe('2026-08-31');
    expect(r.pctComplete).toBeCloseTo(0.7);
    expect(r.earnedHours).toBeCloseTo(42);
    const aug = model.curve.find((c) => c.periodEnd === '2026-08-31')!;
    const jul = model.curve.find((c) => c.periodEnd === '2026-07-31')!;
    expect((aug.earned ?? 0) - (jul.earned ?? 0)).toBeCloseTo(42);
  });

  it('the override bypasses the complexity factor and flags LOE', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-B20-FA-0060')!;
    expect(r.stdHours).toBe(1440);
    expect(r.overrideHours).toBe(400);
    expect(r.budgetHours).toBe(400);
    expect(r.loeFlag).toBe(true);
  });

  it('a RATE type with no shift count budgets zero and is flagged', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-B20-FA-0070')!;
    expect(r.budgetHours).toBe(0);
    expect(r.needsShifts).toBe(true);
    expect(model.summary.typesNeedingShifts).toBe(1);
  });

  it('warns on test progress rows that do not match a budgeted activity', () => {
    const bad = model.testProgressChecks.filter((c) => !c.matched);
    expect(bad.map((c) => c.status).sort()).toEqual(['not budgeted', 'not in extract']);
  });

  it('plots snapshots as markers, not as the curve', () => {
    expect(model.snapshotMarkers).toEqual([{ statusDate: '2026-07-31', earnedHours: 210, budgetHours: 210 }]);
    expect(model.curve.find((c) => c.periodEnd === '2026-07-31')!.snapshot).toBe(210);
    const snap = buildSnapshot(model, '2026-08-31', 'test', '2026-09-01T00:00:00Z');
    expect(snap.lines.length).toBe(model.summary.inBudget);
    expect(snap.lines.reduce((s, l) => s + l.earnedHours, 0)).toBeCloseTo(267);
  });

  it('falls back to current dates and says so when the baseline lacks the activity', () => {
    const r = model.rows.find((x) => x.activityId === '0-P2-TC-D40-FA-0020')!;
    expect(r.baselineSource).toBe('CURRENT');
    expect(r.baselineStart).toBe(r.currentStart);
  });
});

describe('edge rules', () => {
  const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 }];
  it('unpriced types fall back to defaults so the first import has a usable total', () => {
    const a = makeActivity({ activityId: '0-P2-TC-X10-FA-0010', originalDuration: 5 });
    const m = computeModel({ settings: S, locations: [], library: [{ matchKey: 'Test Type' }], overrides: [], testProgress: [], current: [a], baseline: null, snapshots: [] });
    expect(m.rows[0].budgetHours).toBe(2 * 8 * 5);
    expect(m.library[0].rateStatus).toBe('DEFAULT');
    expect(m.notes.some((n) => n.includes('No baseline'))).toBe(true);
  });
  it('percent complete priority: override, tests, then P6 duration', () => {
    const a = makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 2 });
    const base = { settings: S, locations: [], library: lib, overrides: [], current: [a], baseline: null, snapshots: [] };
    expect(computeModel({ ...base, testProgress: [] }).rows[0]).toMatchObject({ pctComplete: 0.8, pctSource: 'P6' });
    expect(computeModel({ ...base, testProgress: [{ activityId: 'A', testsTotal: 4, testsComplete: 1, updatedAt: '' }] }).rows[0]).toMatchObject({ pctComplete: 0.25, pctSource: 'TESTS' });
    expect(computeModel({ ...base, testProgress: [{ activityId: 'A', testsTotal: 4, testsComplete: 1, pctOverride: 0.5, updatedAt: '' }] }).rows[0]).toMatchObject({ pctComplete: 0.5, pctSource: 'OVERRIDE' });
    expect(computeModel({ ...base, testProgress: [{ activityId: 'A', testsTotal: 0, testsComplete: 1, updatedAt: '' }] }).rows[0].pctSource).toBe('P6');
    const done = makeActivity({ activityId: 'B', originalDuration: 10, remainingDuration: 10, actualFinish: true, finishDate: '2026-01-01' });
    expect(computeModel({ ...base, current: [done], testProgress: [] }).rows[0].pctComplete).toBe(1);
  });
  it('earn end never precedes earn start', () => {
    const a = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-09-15', actualFinish: false });
    const m = computeModel({ settings: S, locations: [], library: lib, overrides: [], testProgress: [], current: [a], baseline: null, snapshots: [] });
    expect(m.rows[0].earnStart).toBe('2026-09-15');
    expect(m.rows[0].earnEnd).toBe('2026-09-15');
  });
  it('an activity with no dates at all counts in the total but on no curve', () => {
    const a = makeActivity({ activityId: 'A' });
    const m = computeModel({ settings: S, locations: [], library: lib, overrides: [], testProgress: [], current: [a], baseline: null, snapshots: [] });
    expect(m.summary.totalBudgetHours).toBe(80);
    expect(m.summary.onNoCurve).toBe(1);
    expect(m.curve.every((c) => c.planned === 0 && c.forecast === 0)).toBe(true);
  });
});

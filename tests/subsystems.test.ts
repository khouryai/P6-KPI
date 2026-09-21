/**
 * Crews split by subsystem, and earned against built.
 *
 * The rule that everything here defends: the hours attributed to subsystems must
 * add back to the budget they came from, exactly, whatever the rounding. A rollup
 * that disagrees with the total it was cut from is worse than no rollup at all.
 */
import { describe, it, expect } from 'vitest';
import {
  allocate,
  computeModel,
  crewLines,
  crewWeights,
  effectiveCrew,
  monthlyEarned,
  stdHoursFor,
  UNASSIGNED,
} from '../src/engine/compute';
import { DEFAULT_SETTINGS, type LibraryEntry, type TeamActual } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', statusDate: '2026-08-31' };
const base = { settings: S, locations: [], overrides: [], testProgress: [], baseline: null };

describe('crew composition', () => {
  it('prices one ATS plus one IXL the same as a crew of two', () => {
    const split: LibraryEntry = { matchKey: 'ATSCTP', basis: 'RATE', durationShifts: 3, crew: [
      { subsystem: 'ATS', count: 1 },
      { subsystem: 'IXL', count: 1 },
    ] };
    const flat: LibraryEntry = { matchKey: 'ATSCTP', basis: 'RATE', durationShifts: 3, crewSize: 2 };
    expect(stdHoursFor(split, S, null)).toBe(stdHoursFor(flat, S, null));
    expect(stdHoursFor(split, S, null)).toBe(2 * 8 * 3);
    expect(effectiveCrew(split, S)).toBe(2);
  });

  it('lets one group work a shorter shift than the rest', () => {
    const e: LibraryEntry = { matchKey: 'T', basis: 'RATE', durationShifts: 1, shiftHours: 10, crew: [
      { subsystem: 'ATS', count: 1 },
      { subsystem: 'IXL', count: 1, shiftHours: 4 },
    ] };
    expect(stdHoursFor(e, S, null)).toBe(10 + 4);
    expect(crewWeights(e, S)).toEqual([{ key: 'ATS', weight: 10 }, { key: 'IXL', weight: 4 }]);
  });

  it('ignores blank and non-positive crew lines, and merges repeats', () => {
    const e: LibraryEntry = { matchKey: 'T', crew: [
      { subsystem: 'ATS', count: 1 },
      { subsystem: 'ATS', count: 2 },
      { subsystem: 'IXL', count: 0 },
      { subsystem: 'COMMS', count: Number.NaN },
    ] };
    expect(crewLines(e)).toEqual([{ subsystem: 'ATS', count: 3, shiftHours: undefined }]);
    expect(effectiveCrew(e, S)).toBe(3);
  });

  it('falls back to the headcount when the breakdown is empty', () => {
    const e: LibraryEntry = { matchKey: 'T', crewSize: 5, crew: [] };
    expect(effectiveCrew(e, S)).toBe(5);
    expect(crewWeights(e, S)).toEqual([{ key: UNASSIGNED, weight: 5 * 8 }]);
  });
});

describe('splitting the budget', () => {
  it('splits an integer total into integers that still add up', () => {
    const out = allocate(100, [{ key: 'A', weight: 1 }, { key: 'B', weight: 1 }, { key: 'C', weight: 1 }]);
    expect(Object.values(out).reduce((a, b) => a + b, 0)).toBe(100);
    expect(Object.values(out).every(Number.isInteger)).toBe(true);
    expect(Object.values(out).sort()).toEqual([33, 33, 34]);
  });

  it('gives the spare hour to the group with the biggest fractional claim', () => {
    // 10 hours over weights 1:2 wants 3.33 and 6.67; the .67 is owed more.
    expect(allocate(10, [{ key: 'A', weight: 1 }, { key: 'B', weight: 2 }])).toEqual({ A: 3, B: 7 });
  });

  it('keeps a fractional total exact', () => {
    const out = allocate(10.5, [{ key: 'A', weight: 1 }, { key: 'B', weight: 3 }]);
    expect(out.A + out.B).toBe(10.5);
  });

  it('puts everything under Unassigned when there is nothing to split by', () => {
    expect(allocate(40, [])).toEqual({ [UNASSIGNED]: 40 });
    expect(allocate(40, [{ key: 'A', weight: 0 }])).toEqual({ [UNASSIGNED]: 40 });
  });
});

describe('the split survives an override and the rounding', () => {
  const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', durationShifts: 1, crew: [
    { subsystem: 'ATS', count: 1 },
    { subsystem: 'IXL', count: 2 },
  ] }];

  it('cuts the ROUNDED budget, not the raw standard hours', () => {
    const m = computeModel({
      ...base,
      library: lib,
      locations: [{ code: 'X10', complexityFactor: 1.1 }],
      current: [makeActivity({ activityId: '0-P2-TC-X10-FA-0010' })],
    });
    const r = m.rows[0];
    // 3 people x 8h x 1 shift x 1.1 = 26.4, rounded to 26.
    expect(r.budgetHours).toBe(26);
    expect(Object.values(r.subsystemHours).reduce((a, b) => a + b, 0)).toBe(26);
    expect(r.subsystemHours).toEqual({ ATS: 9, IXL: 17 });
  });

  it('cuts an override the same way', () => {
    const m = computeModel({
      ...base,
      library: lib,
      overrides: [{ activityId: 'A', overrideHours: 30 }],
      current: [makeActivity({ activityId: 'A' })],
    });
    expect(m.rows[0].budgetHours).toBe(30);
    expect(m.rows[0].subsystemHours).toEqual({ ATS: 10, IXL: 20 });
  });

  it('earns each subsystem in proportion to the activity', () => {
    const m = computeModel({
      ...base,
      library: lib,
      testProgress: [{ activityId: 'A', pctOverride: 0.5, updatedAt: '' }],
      current: [makeActivity({ activityId: 'A' })],
    });
    expect(m.rows[0].subsystemEarned).toEqual({ ATS: 4, IXL: 8 });
    expect(m.rows[0].earnedHours).toBe(12);
  });
});

describe('subsystem rollup', () => {
  const lib: LibraryEntry[] = [
    { matchKey: 'ATSCTP', basis: 'RATE', durationShifts: 1, crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'IXL', count: 1 }] },
    { matchKey: 'IXLONLY', basis: 'RATE', durationShifts: 1, crew: [{ subsystem: 'IXL', count: 1 }] },
  ];
  const current = [
    makeActivity({ activityId: '0-P2-TC-W40-FA-0010', activityType: 'ATSCTP', location: 'W40' }),
    makeActivity({ activityId: '0-P3-TC-D40-FA-0020', activityType: 'IXLONLY', location: 'D40' }),
  ];

  it('adds every subsystem back to the budget total', () => {
    const m = computeModel({ ...base, library: lib, current });
    const sum = m.subsystems.reduce((s, x) => s + x.budgetHours, 0);
    expect(sum).toBe(m.summary.totalBudgetHours);
  });

  it('counts an activity under every subsystem it draws on, but its hours only once', () => {
    const m = computeModel({ ...base, library: lib, current });
    const ats = m.subsystems.find((s) => s.code === 'ATS')!;
    const ixl = m.subsystems.find((s) => s.code === 'IXL')!;
    expect(ats.activities).toBe(1);
    expect(ixl.activities).toBe(2); // both activities need an IXL engineer
    expect(ats.budgetHours).toBe(8);
    expect(ixl.budgetHours).toBe(16);
    expect(m.summary.totalBudgetHours).toBe(24);
  });

  it('cuts each subsystem by phase and by location', () => {
    const m = computeModel({ ...base, library: lib, current });
    const ixl = m.subsystems.find((s) => s.code === 'IXL')!;
    expect(ixl.byPhase.map((c) => [c.key, c.budgetHours])).toEqual(
      expect.arrayContaining([['P2', 8], ['P3', 8]]),
    );
    expect(ixl.byLocation.map((c) => [c.key, c.budgetHours])).toEqual(
      expect.arrayContaining([['W40', 8], ['D40', 8]]),
    );
    // Phase totals for a subsystem add back to that subsystem.
    expect(ixl.byPhase.reduce((s, c) => s + c.budgetHours, 0)).toBe(ixl.budgetHours);
  });

  it('keeps a named but unused subsystem visible, at zero', () => {
    const m = computeModel({ ...base, library: lib, current, subsystems: [{ code: 'COMMS', name: 'Communications' }] });
    const comms = m.subsystems.find((s) => s.code === 'COMMS')!;
    expect(comms.budgetHours).toBe(0);
    expect(comms.label).toBe('COMMS — Communications');
  });

  it('files an unpriced crew under Unassigned rather than losing it', () => {
    const m = computeModel({ ...base, library: [{ matchKey: 'ATSCTP', basis: 'RATE', durationShifts: 1, crewSize: 2 }], current: [current[0]] });
    expect(m.subsystems.map((s) => s.code)).toEqual([UNASSIGNED]);
    expect(m.subsystems[0].label).toBe('Unassigned');
    expect(m.summary.unassignedHours).toBe(16);
  });
});

describe('earned per month', () => {
  const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', durationShifts: 10, crew: [
    { subsystem: 'ATS', count: 1 },
    { subsystem: 'IXL', count: 1 },
  ] }];
  // 160 budget hours, earned evenly across June and July.
  const a = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-06-01', actualFinish: true, finishDate: '2026-07-31' });

  it('reports hours earned IN a month, not cumulative', () => {
    const m = computeModel({ ...base, library: lib, current: [a], testProgress: [{ activityId: 'A', pctOverride: 1, updatedAt: '' }] });
    const months = monthlyEarned(m.rows, m.curve.map((c) => c.periodEnd), '2026-08-31');
    const june = months.find((x) => x.month === '2026-06')!;
    const july = months.find((x) => x.month === '2026-07')!;
    expect(june.earned + july.earned).toBeCloseTo(160);
    expect(june.earned).toBeGreaterThan(0);
    expect(july.earned).toBeGreaterThan(0);
    // The split holds inside each month too.
    expect(june.bySubsystem.ATS).toBeCloseTo(june.earned / 2);
    expect(june.bySubsystem.IXL).toBeCloseTo(june.earned / 2);
  });

  it('stops at the data date, because past it nothing has been reported', () => {
    const m = computeModel({ ...base, settings: { ...S, dataDate: '2026-06-30' }, library: lib, current: [a] });
    const months = monthlyEarned(m.rows, m.curve.map((c) => c.periodEnd), '2026-06-30');
    expect(months.every((x) => x.periodEnd <= '2026-06-30')).toBe(true);
  });
});

describe('earned against built', () => {
  const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', durationShifts: 10, crew: [{ subsystem: 'ATS', count: 1 }] }];
  const a = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-06-01', actualFinish: true, finishDate: '2026-06-30' });
  const actuals: TeamActual[] = [
    { id: '1', month: '2026-06', subsystem: 'ATS', person: 'A. Engineer', hours: 100 },
    { id: '2', month: '2026-06', subsystem: 'ATS', person: 'B. Engineer', hours: 20 },
  ];

  it('earning less than the team built is a negative variance', () => {
    const m = computeModel({ ...base, library: lib, current: [a], teamActuals: actuals });
    const june = m.burn.months.find((x) => x.month === '2026-06')!;
    expect(june.earned).toBeCloseTo(80); // 1 x 8h x 10 shifts
    expect(june.built).toBe(120);
    expect(june.variance).toBeCloseTo(-40);
    expect(june.factor).toBeCloseTo(80 / 120);
  });

  it('carries a cumulative running total', () => {
    const m = computeModel({
      ...base,
      library: lib,
      current: [a],
      teamActuals: [...actuals, { id: '3', month: '2026-07', subsystem: 'ATS', hours: 50 }],
    });
    const last = m.burn.months[m.burn.months.length - 1];
    expect(last.cumBuilt).toBe(170);
    expect(last.cumVariance).toBeCloseTo(80 - 170);
  });

  it('forecasts the overrun at the rate achieved so far', () => {
    // Half done, and every earned hour cost two built hours.
    const half = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-06-01' });
    const m = computeModel({
      ...base,
      library: lib,
      current: [half],
      testProgress: [{ activityId: 'A', pctOverride: 0.5, updatedAt: '' }],
      teamActuals: [{ id: '1', month: '2026-06', subsystem: 'ATS', hours: 80 }],
    });
    const p = m.burn.project;
    expect(p.budgetHours).toBe(80);
    expect(p.cumEarned).toBe(40);
    expect(p.cumBuilt).toBe(80);
    expect(p.factor).toBe(0.5);
    expect(p.remainingHours).toBe(40);
    expect(p.hoursToComplete).toBe(80); // 40 remaining at 0.5 earned per hour built
    expect(p.forecastTotalHours).toBe(160);
    expect(p.varianceAtCompletion).toBe(-80); // the job is forecast to cost double
  });

  it('says nothing about a forecast before any hours are built', () => {
    const m = computeModel({ ...base, library: lib, current: [a] });
    expect(m.burn.project.factor).toBeNull();
    expect(m.burn.project.forecastTotalHours).toBeNull();
    expect(m.burn.totalBuilt).toBe(0);
  });

  it('flags hours built against a subsystem that holds no budget', () => {
    const m = computeModel({
      ...base,
      library: lib,
      current: [a],
      teamActuals: [{ id: '1', month: '2026-06', subsystem: 'COMMS', hours: 40 }],
    });
    expect(m.burn.builtWithNoBudget).toEqual(['COMMS']);
    expect(m.notes.some((n) => n.includes('hold no budget'))).toBe(true);
  });

  it('states how much earned value belongs to no month', () => {
    // No dates at all: the hours are earned but cannot be placed in a month.
    const nodates = makeActivity({ activityId: 'A' });
    const m = computeModel({
      ...base,
      library: lib,
      current: [nodates],
      testProgress: [{ activityId: 'A', pctOverride: 1, updatedAt: '' }],
    });
    expect(m.burn.totalEarned).toBe(80);
    expect(m.burn.phasedEarned).toBe(0);
    expect(m.burn.unphasedEarned).toBe(80);
    expect(m.notes.some((n) => n.includes('belong to no month'))).toBe(true);
  });

  it('ignores a malformed month rather than inventing a bucket for it', () => {
    const m = computeModel({
      ...base,
      library: lib,
      current: [a],
      teamActuals: [{ id: '1', month: 'August', subsystem: 'ATS', hours: 40 }],
    });
    expect(m.burn.totalBuilt).toBe(0);
    expect(m.burn.months.every((x) => /^\d{4}-\d{2}$/.test(x.month))).toBe(true);
  });
});

describe('the monthly table stays readable', () => {
  const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', durationShifts: 1, crew: [{ subsystem: 'ATS', count: 1 }] }];

  it('does not run empty months out to the end of the schedule', () => {
    // Work in June 2026, but an activity dated 2030 stretches the curve four years.
    const worked = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-06-01', actualFinish: true, finishDate: '2026-06-30' });
    const distant = makeActivity({ activityId: 'B', startDate: '2030-06-01', finishDate: '2030-06-30' });
    const m = computeModel({
      ...base,
      settings: { ...S, dataDate: '' },
      library: lib,
      current: [worked, distant],
      teamActuals: [{ id: '1', month: '2026-06', subsystem: 'ATS', hours: 100 }],
    });
    expect(m.burn.months.length).toBeLessThan(6);
    expect(m.burn.months[m.burn.months.length - 1].month).toBe('2026-06');
  });

  it('keeps a quiet month between two busy ones', () => {
    const a = makeActivity({ activityId: 'A', actualStart: true, startDate: '2026-06-01', actualFinish: true, finishDate: '2026-06-30' });
    const m = computeModel({
      ...base,
      library: lib,
      current: [a],
      teamActuals: [
        { id: '1', month: '2026-06', subsystem: 'ATS', hours: 100 },
        { id: '2', month: '2026-08', subsystem: 'ATS', hours: 100 },
      ],
    });
    expect(m.burn.months.map((x) => x.month)).toEqual(['2026-06', '2026-07', '2026-08']);
    expect(m.burn.months[1].built).toBe(0);
  });

  it('has nothing to show when nothing has happened', () => {
    const m = computeModel({ ...base, library: lib, current: [makeActivity({ activityId: 'A' })] });
    expect(m.burn.months).toEqual([]);
  });
});

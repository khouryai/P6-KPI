import { describe, it, expect } from 'vitest';
import { phaseOf, workTypeOf, phaseLabel } from '../src/engine/parse';
import { computeModel, groupRows } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type GroupDim } from '../src/engine/types';
import { fixtureModelInput, makeActivity } from './helpers';

describe('phase and work type derivation', () => {
  it('reads the phase and work type segments of an Activity ID', () => {
    expect(phaseOf('0-P2-TC-W40-FA-0100')).toBe('P2');
    expect(workTypeOf('0-P2-TC-W40-FA-0100')).toBe('TC');
    expect(phaseOf('  0-P3-AC-SW-SW-0020  ')).toBe('P3');
    expect(workTypeOf('0-P3-AC-SW-SW-0020')).toBe('AC');
    // The live schedule carries one non-phase code in that segment.
    expect(phaseOf('0-SW-TC-TF-FA-0000')).toBe('SW');
    // Short IDs simply have no segment rather than throwing.
    expect(phaseOf('0-P2-MS-0010')).toBe('P2');
    expect(workTypeOf('0-P2-MS-0010')).toBe('MS');
    expect(phaseOf('single')).toBe('');
    expect(workTypeOf('a-b')).toBe('');
  });

  it('formats P<n> as a phase name and leaves anything else alone', () => {
    expect(phaseLabel('P2')).toBe('Phase 2');
    expect(phaseLabel('P12')).toBe('Phase 12');
    expect(phaseLabel('SW')).toBe('SW');
    expect(phaseLabel('')).toBe('');
  });
});

describe('rollups', () => {
  const model = computeModel(fixtureModelInput());

  it('puts every activity in exactly one group, on every dimension', () => {
    for (const dim of ['phase', 'location', 'discipline', 'workType'] as GroupDim[]) {
      const groups = model.groups[dim];
      expect(groups.reduce((n, g) => n + g.activities, 0), dim).toBe(model.rows.length);
      expect(groups.reduce((n, g) => n + g.budgetHours, 0), dim).toBeCloseTo(model.summary.totalBudgetHours, 6);
      expect(groups.reduce((n, g) => n + g.earnedHours, 0), dim).toBeCloseTo(model.summary.earnedHours, 6);
      // Group keys are unique.
      expect(new Set(groups.map((g) => g.key)).size).toBe(groups.length);
    }
  });

  it('groups the fixture by location with the right budget split', () => {
    const byLoc = Object.fromEntries(model.groups.location.map((g) => [g.key, g]));
    expect(Object.keys(byLoc).sort()).toEqual(['', 'A10', 'B20', 'C30', 'D40', 'E50']);
    // The milestone activity has no location segment and lands in its own group.
    expect(byLoc[''].activities).toBe(1);
    expect(byLoc[''].label).toBe('No location in the ID');
    expect(byLoc['A10'].budgetHours + byLoc['B20'].budgetHours + byLoc['C30'].budgetHours + byLoc['D40'].budgetHours + byLoc['E50'].budgetHours + byLoc[''].budgetHours).toBe(model.summary.totalBudgetHours);
  });

  it('is sorted by budget hours, biggest first', () => {
    const h = model.groups.location.map((g) => g.budgetHours);
    expect([...h].sort((a, b) => b - a)).toEqual(h);
  });

  it('counts progress state and test coverage per group', () => {
    const a10 = model.groups.location.find((g) => g.key === 'A10')!;
    // A10 has a finished pair, one in progress, one with a test window override.
    expect(a10.inBudget).toBeGreaterThan(0);
    expect(a10.finished + a10.inProgress + a10.notStarted).toBe(a10.inBudget);
    expect(a10.withCounts).toBe(2); // FA-0010 and FA-0030 carry test counts
    expect(a10.testsTotal).toBe(40);
    expect(a10.testsComplete).toBe(37);
    expect(a10.pctComplete).toBeCloseTo(a10.earnedHours / a10.budgetHours, 9);
  });

  it('spans several phases when the schedule does', () => {
    const lib = [{ matchKey: 'Test Type', basis: 'RATE' as const, crewSize: 2, shiftHours: 10, durationShifts: 4 }];
    const acts = [
      makeActivity({ activityId: '0-P2-TC-W40-FA-0010', sortOrder: 0 }),
      makeActivity({ activityId: '0-P3-TC-Y10-FA-0010', sortOrder: 1 }),
      makeActivity({ activityId: '0-P3-AC-SW-SW-0020', sortOrder: 2 }),
      makeActivity({ activityId: '0-SW-TC-TF-FA-0000', sortOrder: 3 }),
    ];
    const m = computeModel({ settings: { ...DEFAULT_SETTINGS, dataDate: '2026-08-31' }, locations: [], library: lib, overrides: [], testProgress: [], current: acts, baseline: null, snapshots: [] });
    expect(m.groups.phase.map((g) => g.label).sort()).toEqual(['Phase 2', 'Phase 3', 'SW']);
    const p3 = m.groups.phase.find((g) => g.key === 'P3')!;
    expect(p3.activities).toBe(2);
    expect(p3.budgetHours).toBe(160);
    expect(m.groups.workType.map((g) => g.key).sort()).toEqual(['AC', 'TC']);
  });

  it('groupRows is a pure function of the rows it is given', () => {
    const subset = model.rows.filter((r) => r.location === 'A10');
    const g = groupRows(subset, 'location');
    expect(g.length).toBe(1);
    expect(g[0].activities).toBe(subset.length);
  });
});

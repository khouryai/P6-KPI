/**
 * An activity shared between locations, and locations reported by name.
 *
 * The Activity ID names one location. A split says how the budget really divides
 * between several, and every rollup by location has to honour it while still adding
 * back to the budget exactly. A location's name, where one is given, is what every
 * report shows in place of the code.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { formatLocationSplit, parseLocationSplit, resolveLocationShares } from '../src/engine/locations';
import { staffingTasks, outOfScope, FULL_SCOPE } from '../src/engine/staffing';
import { makeActivity } from './helpers';
import type { ActivityOverride, LibraryEntry, Location, ModelInput } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const settings = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', defaultCrew: 2, defaultShiftHours: 8, defaultComplexity: 1 };

function scenario(overrides: ActivityOverride[] = [], locations: Location[] = [{ code: 'X10' }, { code: 'W40' }]): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crew: [{ subsystem: 'ATS', count: 2 }], shiftHours: 8 }];
  return {
    settings,
    locations,
    library,
    overrides,
    testProgress: [{ activityId: 'A-P2-TC-X10-FA-0010', pctOverride: 0.5, updatedAt: '2026-08-01' }],
    current: [
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', sortOrder: 0 }),
      makeActivity({ activityId: 'A-P2-TC-W40-FA-0020', location: 'W40', sortOrder: 1 }),
    ],
    baseline: null,
  };
}

describe('reading a split', () => {
  it('reads codes and percentages, with or without the % sign', () => {
    expect(parseLocationSplit('W40 50, 2W 50')).toEqual({ split: [{ location: 'W40', share: 0.5 }, { location: '2W', share: 0.5 }] });
    expect(parseLocationSplit('W40 25%; 2W: 75%')).toEqual({ split: [{ location: 'W40', share: 0.25 }, { location: '2W', share: 0.75 }] });
  });

  it('does not read the digits at the end of a code as a percentage', () => {
    expect(parseLocationSplit('W40')).toEqual({ split: [{ location: 'W40', share: 1 }] });
  });

  it('shares what the percentages leave evenly between the locations named without one', () => {
    expect(parseLocationSplit('W40, 2W')).toEqual({ split: [{ location: 'W40', share: 0.5 }, { location: '2W', share: 0.5 }] });
    expect(parseLocationSplit('A10 40, W40, 2W')).toEqual({
      split: [{ location: 'A10', share: 0.4 }, { location: 'W40', share: 0.3 }, { location: '2W', share: 0.3 }],
    });
  });

  it('refuses more than 100% and a percentage with no location', () => {
    expect('error' in parseLocationSplit('W40 60, 2W 60')).toBe(true);
    expect('error' in parseLocationSplit('50%')).toBe(true);
  });

  it('reads blank as no split', () => {
    expect(parseLocationSplit('  ')).toEqual({ split: [] });
  });

  it('writes a split back the way it is typed', () => {
    expect(formatLocationSplit([{ location: 'W40', share: 0.5 }, { location: '2W', share: 0.5 }])).toBe('W40 50%, 2W 50%');
  });

  it('leaves whatever the split does not hand out at the activity’s own location', () => {
    const shares = resolveLocationShares('X10', [{ location: 'W40', share: 0.3 }], new Map());
    expect(shares.map((s) => [s.code, s.share])).toEqual([
      ['W40', 0.3],
      ['X10', 0.7],
    ]);
  });
});

describe('an activity split between two locations', () => {
  const split: ActivityOverride = { activityId: 'A-P2-TC-X10-FA-0010', locationSplit: [{ location: 'W40', share: 0.5 }] };

  it('puts half its hours and half its earned hours at each, and the locations still add to the budget', () => {
    const m = computeModel(scenario([split]));
    const total = m.summary.totalBudgetHours;
    const x10 = m.groups.location.find((g) => g.key === 'X10')!;
    const w40 = m.groups.location.find((g) => g.key === 'W40')!;
    expect(x10.budgetHours).toBe(80);
    expect(w40.budgetHours).toBe(240);
    expect(x10.earnedHours).toBe(40);
    expect(w40.earnedHours).toBe(40);
    expect(m.groups.location.reduce((s, g) => s + g.budgetHours, 0)).toBe(total);
    expect(w40.activities).toBe(2);
    expect(w40.shared).toBe(1);
  });

  it('counts the split on the Locations stats by share', () => {
    const m = computeModel(scenario([split]));
    const w40 = m.locations.find((l) => l.code === 'W40')!;
    expect(w40.count).toBe(2);
    expect(w40.shared).toBe(1);
    expect(w40.budgetHours).toBe(240);
  });

  it('prices it at the share-weighted complexity factor of its locations', () => {
    const m = computeModel(scenario([split], [{ code: 'X10', complexityFactor: 1.2 }, { code: 'W40', complexityFactor: 1.0 }]));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.complexity).toBeCloseTo(1.1, 10);
    expect(r.budgetHours).toBe(176);
  });

  it('cuts each subsystem’s hours by location by the same share', () => {
    const m = computeModel(scenario([split]));
    const ats = m.subsystems.find((s) => s.code === 'ATS')!;
    expect(ats.byLocation.find((c) => c.key === 'X10')!.budgetHours).toBe(80);
    expect(ats.byLocation.find((c) => c.key === 'W40')!.budgetHours).toBe(240);
  });

  it('keeps the location the ID gives, and says it is split', () => {
    const r = computeModel(scenario([split])).rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.location).toBe('X10');
    expect(r.locationSplit).toBe(true);
    expect(r.locationName).toBe('W40 50%, X10 50%');
  });

  it('is at each of its locations for the staffing filter', () => {
    const m = computeModel(scenario([split]));
    const tasks = staffingTasks(m.rows, { group: 'ATS', dataDate: '2026-08-31', efficiency: 1, hoursPerPersonPerMonth: 140, utilisation: 1 });
    const t = tasks.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(outOfScope(t, { ...FULL_SCOPE, location: 'W40' })).toBeNull();
    expect(outOfScope(t, { ...FULL_SCOPE, location: 'X10' })).toBeNull();
    expect(outOfScope(t, { ...FULL_SCOPE, location: 'B20' })).toBe('location');
  });

  it('changes nothing for an activity that is not split', () => {
    const before = computeModel(scenario()).rows.find((x) => x.activityId === 'A-P2-TC-W40-FA-0020')!;
    const after = computeModel(scenario([split])).rows.find((x) => x.activityId === 'A-P2-TC-W40-FA-0020')!;
    expect(after.budgetHours).toBe(before.budgetHours);
    expect(after.locationSplit).toBe(false);
    expect(after.locationShares).toEqual([{ code: 'W40', name: 'W40', share: 1 }]);
  });
});

describe('a location reported by name', () => {
  const named: Location[] = [{ code: 'X10', name: 'Phase 2' }, { code: 'W40', name: 'Millbury Station' }];

  it('labels the rollup, the row and the Locations stats with the name instead of the code', () => {
    const m = computeModel(scenario([], named));
    expect(m.groups.location.find((g) => g.key === 'W40')!.label).toBe('Millbury Station');
    expect(m.rows.find((r) => r.activityId === 'A-P2-TC-W40-FA-0020')!.locationName).toBe('Millbury Station');
    expect(m.locations.find((l) => l.code === 'X10')!.label).toBe('Phase 2');
    // The code is still the key everything joins on.
    expect(m.rows.find((r) => r.activityId === 'A-P2-TC-W40-FA-0020')!.location).toBe('W40');
  });

  it('names every share of a split', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', locationSplit: [{ location: 'W40', share: 0.5 }] }], named));
    expect(m.rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0010')!.locationName).toBe('Millbury Station 50%, Phase 2 50%');
    expect(m.subsystems.find((s) => s.code === 'ATS')!.byLocation.map((c) => c.label).sort()).toEqual(['Millbury Station', 'Phase 2']);
  });
});

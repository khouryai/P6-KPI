/**
 * What each activity is crewed with.
 *
 * The Resources screen already answers "how many hours does ATS carry"; this is the
 * other direction — stand on ONE activity and ask who works it and how many of
 * them. The rule that matters is that the two answers are the same answer: the
 * hours on an activity's resource lines are the hours of its subsystem split, never
 * a second calculation that can drift from it.
 */
import { describe, it, expect } from 'vitest';
import { computeModel, resourceLines, UNASSIGNED } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type LibraryEntry } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', statusDate: '2026-08-31' };
const base = { settings: S, locations: [], overrides: [], testProgress: [], baseline: null };

/** One activity of one type, priced by the entry given. */
function modelOf(entry: LibraryEntry, activityType = 'Test Type') {
  return computeModel({
    ...base,
    library: [entry],
    current: [makeActivity({ activityId: '0-P2-TC-X10-FA-0010', activityType, originalDuration: 10 })],
  });
}

describe('resource lines on one activity', () => {
  it('names each group and how many of them, from the crew on its library key', () => {
    const m = modelOf({ matchKey: 'Test Type', basis: 'RATE', durationShifts: 2, crew: [
      { subsystem: 'ATS', count: 1 },
      { subsystem: 'IXL', count: 3 },
    ] });
    const r = m.rows[0];
    expect(r.resources.map((x) => [x.code, x.count])).toEqual([['ATS', 1], ['IXL', 3]]);
    expect(r.crewSize).toBe(4);
  });

  it('gives an unnamed crew one line, because "two people, nobody has said who" is the truth', () => {
    const r = modelOf({ matchKey: 'Test Type', crewSize: 2 }).rows[0];
    expect(r.resources).toHaveLength(1);
    expect(r.resources[0].code).toBe(UNASSIGNED);
    expect(r.resources[0].label).toBe('Unassigned');
    expect(r.crewSize).toBe(2);
  });

  it('carries the hours of the subsystem split, never a second calculation', () => {
    const m = modelOf({ matchKey: 'Test Type', basis: 'RATE', durationShifts: 3, crew: [
      { subsystem: 'ATS', count: 1 },
      { subsystem: 'IXL', count: 2 },
    ] });
    const r = m.rows[0];
    for (const x of r.resources) expect(x.budgetHours).toBe(r.subsystemHours[x.code]);
    expect(r.resources.reduce((s, x) => s + x.budgetHours, 0)).toBe(r.budgetHours);
  });

  it('keeps adding up when the hours were overridden by hand', () => {
    const m = computeModel({
      ...base,
      library: [{ matchKey: 'Test Type', crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'IXL', count: 2 }] }],
      overrides: [{ activityId: '0-P2-TC-X10-FA-0010', overrideHours: 101 }],
      current: [makeActivity({ activityId: '0-P2-TC-X10-FA-0010' })],
    });
    const r = m.rows[0];
    expect(r.budgetHours).toBe(101);
    expect(r.resources.reduce((s, x) => s + x.budgetHours, 0)).toBe(101);
  });

  it('earns each line in proportion, so a resource cannot be ahead of its own activity', () => {
    const m = computeModel({
      ...base,
      library: [{ matchKey: 'Test Type', crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'IXL', count: 1 }] }],
      testProgress: [{ activityId: '0-P2-TC-X10-FA-0010', pctOverride: 0.5, updatedAt: '' }],
      current: [makeActivity({ activityId: '0-P2-TC-X10-FA-0010' })],
    });
    const r = m.rows[0];
    expect(r.resources.reduce((s, x) => s + x.earnedHours, 0)).toBeCloseTo(r.earnedHours, 9);
  });

  it('asks for nobody when the activity is not in the budget', () => {
    const m = modelOf({ matchKey: 'Test Type', includeOverride: 'N', crewSize: 4 });
    expect(m.rows[0].status).toBe('EXCLUDED');
    expect(m.rows[0].resources).toEqual([]);
    expect(m.rows[0].crewSize).toBe(0);
  });

  it('merges two lines naming the same group, as the pricing does', () => {
    const lines = resourceLines(
      { matchKey: 'T', crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'ATS', count: 2 }] },
      S,
      { ATS: 24 },
      0.25,
    );
    expect(lines).toEqual([{ code: 'ATS', label: 'ATS', count: 3, shiftHours: 8, budgetHours: 24, earnedHours: 6 }]);
  });
});

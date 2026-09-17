/**
 * An activity two subsystems both work.
 *
 * The Subsystem box on an Activity Library key is free text, and people use it to
 * name more than one group. Rolled up as a single string it produced a group called
 * "ATS, IXL" that is neither of them, while both real groups read smaller than they
 * are. So the text is split and the hours are shared evenly between the names.
 *
 * The invariant that everything here defends is the one every rollup in this app
 * rests on: however the hours are shared out, the groups still add back to the
 * budget they were cut from, exactly. What does NOT add up is the activity count,
 * deliberately — one activity is one whole activity to each group that works it,
 * and "1.5 activities" is arithmetic nobody can act on.
 */
import { describe, it, expect } from 'vitest';
import { computeModel, groupRows, splitDisciplines } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type ModelInput } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', statusDate: '2026-08-31' };

function modelOf(discipline: string, extra: Partial<ModelInput> = {}) {
  return computeModel({
    settings: S,
    locations: [],
    overrides: [],
    testProgress: [],
    snapshots: [],
    baseline: null,
    library: [{ matchKey: 'Test Type', discipline, crewSize: 1 }],
    current: [
      makeActivity({ activityId: '0-P2-TC-A10-FA-0010', originalDuration: 10, sortOrder: 0 }),
      makeActivity({ activityId: '0-P2-TC-A10-FA-0020', originalDuration: 30, sortOrder: 1 }),
    ],
    ...extra,
  });
}

describe('reading the Subsystem box', () => {
  it('splits on the separators people actually type', () => {
    expect(splitDisciplines('ATS, IXL')).toEqual(['ATS', 'IXL']);
    expect(splitDisciplines('ATS/IXL/COMMS')).toEqual(['ATS', 'IXL', 'COMMS']);
    expect(splitDisciplines('ATS; IXL')).toEqual(['ATS', 'IXL']);
    expect(splitDisciplines('ATS + IXL')).toEqual(['ATS', 'IXL']);
  });

  it('leaves a single name, however it is spaced, as one group', () => {
    expect(splitDisciplines('  Signalling  ')).toEqual(['Signalling']);
    expect(splitDisciplines('')).toEqual([]);
    expect(splitDisciplines(undefined)).toEqual([]);
  });

  it('does not cut a name that merely contains "and" or an ampersand', () => {
    // "Test & Commissioning" is one group with an ampersand in its name. Splitting
    // it would be the app overruling what somebody typed.
    expect(splitDisciplines('Test & Commissioning')).toEqual(['Test & Commissioning']);
    expect(splitDisciplines('Power and Distribution')).toEqual(['Power and Distribution']);
  });

  it('merges a name repeated in the same box, so it is not given two shares', () => {
    expect(splitDisciplines('ATS, ats')).toEqual(['ATS']);
  });
});

describe('rolling up by subsystem', () => {
  it('shares an activity between the subsystems named on it', () => {
    const m = modelOf('ATS, IXL');
    const by = Object.fromEntries(m.groups.discipline.map((g) => [g.key, g]));
    expect(Object.keys(by).sort()).toEqual(['ATS', 'IXL']);
    // 80 + 240 budget hours, half to each group.
    expect(by.ATS.budgetHours).toBeCloseTo(160, 9);
    expect(by.IXL.budgetHours).toBeCloseTo(160, 9);
  });

  it('still adds back to the budget it was cut from', () => {
    const m = modelOf('ATS, IXL, COMMS');
    const total = m.groups.discipline.reduce((s, g) => s + g.budgetHours, 0);
    expect(total).toBeCloseTo(m.summary.totalBudgetHours, 6);
    expect(m.groups.discipline.reduce((s, g) => s + g.earnedHours, 0)).toBeCloseTo(m.summary.earnedHours, 6);
  });

  it('counts a shared activity whole in each group, and says how many are shared', () => {
    const m = modelOf('ATS, IXL');
    for (const g of m.groups.discipline) {
      expect(g.activities).toBe(2);
      expect(g.shared).toBe(2);
    }
  });

  it('leaves a single-subsystem rollup exactly as it was', () => {
    const m = modelOf('ATS');
    const g = m.groups.discipline;
    expect(g).toHaveLength(1);
    expect(g[0].key).toBe('ATS');
    expect(g[0].activities).toBe(2);
    expect(g[0].shared).toBe(0);
    expect(g[0].budgetHours).toBeCloseTo(m.summary.totalBudgetHours, 9);
  });

  it('never shares an activity on a dimension it can only be in one of', () => {
    const m = modelOf('ATS, IXL');
    for (const dim of ['phase', 'location', 'workType'] as const) {
      const groups = m.groups[dim];
      expect(groups.reduce((n, g) => n + g.activities, 0)).toBe(m.rows.length);
      expect(groups.every((g) => g.shared === 0)).toBe(true);
    }
  });

  it('shares an activity the user re-subsystemed by hand, not just one the library named', () => {
    const m = modelOf('ATS', {
      overrides: [{ activityId: '0-P2-TC-A10-FA-0020', discipline: 'IXL, COMMS' }],
    });
    const by = Object.fromEntries(m.groups.discipline.map((g) => [g.key, g]));
    expect(Object.keys(by).sort()).toEqual(['ATS', 'COMMS', 'IXL']);
    expect(by.ATS.budgetHours).toBeCloseTo(80, 9); // the untouched activity, whole
    expect(by.IXL.budgetHours).toBeCloseTo(120, 9); // half of the 240 hour one
    expect(by.COMMS.budgetHours).toBeCloseTo(120, 9);
  });

  it('is the same answer when a subset of rows is rolled up on its own', () => {
    const m = modelOf('ATS, IXL');
    const g = groupRows(m.rows.filter((r) => r.activityId.endsWith('0020')), 'discipline');
    expect(g.map((x) => x.key).sort()).toEqual(['ATS', 'IXL']);
    expect(g.reduce((s, x) => s + x.budgetHours, 0)).toBeCloseTo(240, 9);
  });
});

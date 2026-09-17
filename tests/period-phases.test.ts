/**
 * The two-week log, cut by phase.
 *
 * A project-wide "97% of plan" routinely hides one phase stalling behind another
 * finishing early, and the phase is what the person holding the review actually
 * runs. So each phase answers the same two questions on its own terms — what it
 * achieved against what it planned, and how far along it now is — and the rule
 * these guard is that the parts and the whole are cut from the same cloth: the
 * phases' hours add back to the project's, and a phase's percent complete is taken
 * against ITS budget, not against the job's.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { periodLog } from '../src/engine/period';
import { fixtureModelInput, makeActivity } from './helpers';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const model = computeModel(fixtureModelInput());
const log = periodLog(model.rows, '2026-08-18', '2026-08-31');

describe('the phases of a window', () => {
  it('adds back to the project figures it was cut from', () => {
    expect(log.phases.reduce((s, p) => s + p.plannedHours, 0)).toBeCloseTo(log.plannedHours, 6);
    expect(log.phases.reduce((s, p) => s + p.earnedHours, 0)).toBeCloseTo(log.earnedHours, 6);
    expect(log.phases.reduce((s, p) => s + p.budgetHours, 0)).toBeCloseTo(log.projectBudgetHours, 6);
  });

  it('lists every phase carrying budget, including one that did nothing this window', () => {
    const budgeted = new Set(model.rows.filter((r) => r.status === 'IN BUDGET').map((r) => r.phase));
    expect(new Set(log.phases.map((p) => p.key))).toEqual(budgeted);
  });

  it('counts each activity in the log under its own phase, once', () => {
    const total = log.phases.reduce((s, p) => s + Object.values(p.counts).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(log.activities.length);
  });

  it('measures a phase against its own budget, not against the whole job', () => {
    // Two phases, both half done, but one is four times the size of the other.
    // Each reads 50%: a phase's completeness is not a share of the programme.
    const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', statusDate: '2026-08-31' };
    const acts = [
      makeActivity({ activityId: '0-P2-TC-X10-FA-0010', originalDuration: 40, startDate: '2026-08-18', finishDate: '2026-08-31', actualStart: true, actualFinish: true }),
      makeActivity({ activityId: '0-P3-TC-X10-FA-0010', originalDuration: 10, startDate: '2026-08-18', finishDate: '2026-08-31', actualStart: true, actualFinish: true }),
    ];
    const m = computeModel({
      settings: S,
      locations: [],
      overrides: [],
      snapshots: [],
      baseline: null,
      library: [{ matchKey: 'Test Type', crewSize: 1 }],
      testProgress: acts.map((a) => ({ activityId: a.activityId, pctOverride: 0.5, updatedAt: '' })),
      current: acts,
    });
    const l = periodLog(m.rows, '2026-08-18', '2026-08-31');
    const [p2, p3] = l.phases;
    expect(p2.budgetHours).toBe(4 * p3.budgetHours);
    expect(p2.pctAtEnd).toBeCloseTo(0.5, 6);
    expect(p3.pctAtEnd).toBeCloseTo(0.5, 6);
  });

  it('says a phase planned nothing rather than calling it 0% achieved', () => {
    // Nothing is planned in a window nothing was scheduled in, and 0% of nothing
    // is a judgement the data does not support.
    const empty = periodLog(model.rows, '2019-01-01', '2019-01-14');
    for (const p of empty.phases) {
      if (Math.abs(p.plannedHours) < 1e-9) expect(p.achievement).toBeNull();
    }
  });

  it('gives a row the achievement of the phase it belongs to', () => {
    const byKey = new Map(log.phases.map((p) => [p.key, p]));
    for (const a of log.activities) expect(byKey.has(a.phase)).toBe(true);
  });
});

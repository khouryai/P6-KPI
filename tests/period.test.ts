/**
 * The two-week log.
 *
 * The property that matters most is agreement: a window's hours are measured the
 * way the S-curve measures them, so summing every consecutive window has to come
 * back to the same total the curve draws. If that ever drifts, two screens are
 * telling the person different things about the same fortnight, which is worse
 * than not having the screen.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { periodLog, addDays, daysBetween, dayBefore } from '../src/engine/period';
import { fixtureModelInput, makeActivity } from './helpers';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import type { LibraryEntry, ModelInput, P6Activity } from '../src/engine/types';

const model = computeModel(fixtureModelInput());

describe('date helpers', () => {
  it('walks days without tripping over a month or year end', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(dayBefore('2026-01-01')).toBe('2025-12-31');
    expect(daysBetween('2026-08-18', '2026-08-31')).toBe(13);
    expect(daysBetween('2026-08-31', '2026-08-18')).toBe(-13);
  });
});

describe('a window agrees with the curve', () => {
  it('every consecutive fortnight sums to the planned budget', () => {
    let planned = 0;
    for (let i = 0; i < 365 * 8; i += 14) {
      const from = addDays('2024-01-01', i);
      planned += periodLog(model.rows, from, addDays(from, 13)).plannedHours;
    }
    const onCurve = model.rows
      .filter((r) => r.status === 'IN BUDGET' && r.baselineStart && r.baselineFinish)
      .reduce((s, r) => s + r.budgetHours, 0);
    expect(planned).toBeCloseTo(onCurve, 6);
  });

  it('every consecutive fortnight sums to the earned hours the curve can place', () => {
    let earned = 0;
    for (let i = 0; i < 365 * 8; i += 14) {
      const from = addDays('2024-01-01', i);
      earned += periodLog(model.rows, from, addDays(from, 13)).earnedHours;
    }
    // Not totalEarned: an activity with progress but no usable dates earns hours
    // that belong to no window at all, which the burn summary already reports.
    expect(earned).toBeCloseTo(model.burn.phasedEarned, 6);
    expect(model.burn.totalEarned - earned).toBeCloseTo(model.burn.unphasedEarned, 6);
  });

  it('splitting a window in two splits its hours', () => {
    const whole = periodLog(model.rows, '2026-08-18', '2026-08-31');
    const a = periodLog(model.rows, '2026-08-18', '2026-08-24');
    const b = periodLog(model.rows, '2026-08-25', '2026-08-31');
    expect(a.earnedHours + b.earnedHours).toBeCloseTo(whole.earnedHours, 9);
    expect(a.plannedHours + b.plannedHours).toBeCloseTo(whole.plannedHours, 9);
  });
});

// A window where one activity does each thing, so the outcomes can be read off.
function scenario(): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 1, shiftHours: 10, durationShifts: 1 }];
  const act = (id: string, start: string | null, finish: string | null, actualStart: boolean, actualFinish: boolean, sortOrder: number): P6Activity =>
    makeActivity({ activityId: id, activityName: '[T&C] X10 (Ph2) - Test Type', startDate: start, finishDate: finish, actualStart, actualFinish, sortOrder });
  return {
    settings: { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', defaultComplexity: 1 },
    locations: [{ code: 'X10' }],
    library,
    overrides: [],
    // Baselines all sit inside the window; what differs is what actually happened.
    testProgress: [
      { activityId: 'A-P2-TC-X10-FA-0001', pctOverride: 1, testStartOverride: '2026-08-20', testEndOverride: '2026-08-25', updatedAt: 'x' },
      { activityId: 'A-P2-TC-X10-FA-0002', pctOverride: 0.5, testStartOverride: '2026-08-22', updatedAt: 'x' },
      { activityId: 'A-P2-TC-X10-FA-0003', pctOverride: 0.5, testStartOverride: '2026-08-01', updatedAt: 'x' },
      { activityId: 'A-P2-TC-X10-FA-0004', pctOverride: 0, updatedAt: 'x' },
      { activityId: 'A-P2-TC-X10-FA-0005', pctOverride: 0, updatedAt: 'x' },
    ],
    current: [
      act('A-P2-TC-X10-FA-0001', '2026-08-20', '2026-08-25', true, true, 0),
      act('A-P2-TC-X10-FA-0002', '2026-08-22', '2026-08-28', true, false, 1),
      act('A-P2-TC-X10-FA-0003', '2026-08-01', '2026-08-28', true, false, 2),
      act('A-P2-TC-X10-FA-0004', '2026-08-21', '2026-08-26', false, false, 3),
      act('A-P2-TC-X10-FA-0005', '2026-08-21', '2026-08-23', false, false, 4),
    ],
    baseline: [
      act('A-P2-TC-X10-FA-0001', '2026-08-20', '2026-08-25', false, false, 0),
      act('A-P2-TC-X10-FA-0002', '2026-08-22', '2026-08-28', false, false, 1),
      // Runs on past the window, so it is genuinely still going rather than late.
      act('A-P2-TC-X10-FA-0003', '2026-08-01', '2026-09-30', false, false, 2),
      act('A-P2-TC-X10-FA-0004', '2026-08-21', '2026-08-26', false, false, 3),
      act('A-P2-TC-X10-FA-0005', '2026-08-21', '2026-08-23', false, false, 4),
    ],
    snapshots: [],
  };
}

describe('what each activity did', () => {
  const m = computeModel(scenario());
  const log = periodLog(m.rows, '2026-08-18', '2026-08-31');
  const outcome = (id: string) => log.activities.find((a) => a.activityId === id)?.outcome;

  it('finished inside the window reads COMPLETED', () => {
    expect(outcome('A-P2-TC-X10-FA-0001')).toBe('COMPLETED');
  });
  it('began inside the window and still running reads STARTED', () => {
    expect(outcome('A-P2-TC-X10-FA-0002')).toBe('STARTED');
  });
  it('began earlier and still running reads CONTINUED', () => {
    expect(outcome('A-P2-TC-X10-FA-0003')).toBe('CONTINUED');
  });
  it('was due to finish here and did not reads MISSED', () => {
    expect(outcome('A-P2-TC-X10-FA-0004')).toBe('MISSED');
    expect(outcome('A-P2-TC-X10-FA-0005')).toBe('MISSED');
  });

  it('late beats still-running: due to finish here and did not is MISSED, not CONTINUED', () => {
    // 0002 began inside the window AND was due to finish inside it. Reporting it as
    // merely "started" would bury the fact that it is already late.
    const late = computeModel({
      ...scenario(),
      baseline: scenario().baseline!.map((a) => (a.activityId === 'A-P2-TC-X10-FA-0003' ? { ...a, finishDate: '2026-08-28' } : a)),
    });
    expect(periodLog(late.rows, '2026-08-18', '2026-08-31').activities.find((a) => a.activityId === 'A-P2-TC-X10-FA-0003')!.outcome).toBe('MISSED');
  });

  it('counts what was due to finish against what actually did', () => {
    expect(log.dueToFinish).toBe(4);
    expect(log.finishedOnTime).toBe(1);
  });

  it('reports the project moving, not just the window', () => {
    expect(log.pctAtEnd).toBeGreaterThan(log.pctAtStart);
    expect(log.achievement).not.toBeNull();
  });

  it('an activity that was neither planned nor touched is left out entirely', () => {
    const quiet = periodLog(m.rows, '2027-06-01', '2027-06-14');
    expect(quiet.activities).toEqual([]);
    expect(quiet.plannedHours).toBe(0);
    // Nothing planned is not the same as 0% achieved, and must not read as failure.
    expect(quiet.achievement).toBeNull();
  });
});

describe('the window itself', () => {
  it('splits a fortnight into two weeks that cover it exactly', () => {
    const log = periodLog(model.rows, '2026-08-18', '2026-08-31');
    expect(log.slices).toHaveLength(2);
    expect(log.slices[0].from).toBe('2026-08-18');
    expect(log.slices[1].to).toBe('2026-08-31');
    expect(log.slices.reduce((s, x) => s + x.earned, 0)).toBeCloseTo(log.earnedHours, 9);
    expect(log.slices.reduce((s, x) => s + x.planned, 0)).toBeCloseTo(log.plannedHours, 9);
  });

  it('survives a backwards window by reading it the right way round', () => {
    const a = periodLog(model.rows, '2026-08-31', '2026-08-18');
    const b = periodLog(model.rows, '2026-08-18', '2026-08-31');
    expect(a.from).toBe(b.from);
    expect(a.to).toBe(b.to);
    expect(a.earnedHours).toBeCloseTo(b.earnedHours, 9);
  });

  it('counts a single day as one day, not zero', () => {
    const log = periodLog(model.rows, '2026-08-20', '2026-08-20');
    expect(log.days).toBe(1);
    expect(log.slices).toHaveLength(1);
  });

  it('only reports activities that are in the budget', () => {
    const log = periodLog(model.rows, '2024-01-01', '2030-12-31');
    const ids = new Set(model.rows.filter((r) => r.status === 'IN BUDGET').map((r) => r.activityId));
    expect(log.activities.every((a) => ids.has(a.activityId))).toBe(true);
  });
});

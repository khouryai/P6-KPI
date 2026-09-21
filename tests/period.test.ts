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

/**
 * An activity that beat its baseline, and the fortnight after it finished.
 *
 * Baseline 31 Aug to 10 Sep; actually run 24 Aug to 2 Sep. The fortnight to 9 Sep
 * signs it off, and the fortnight to 23 Sep still lists it, because its baseline
 * hours accrue into that window — it is part of what the plan asked for there. What
 * it must not say is that the work is still going.
 */
function earlyFinish(): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 1, shiftHours: 10, durationShifts: 1 }];
  const id = 'A-P2-TC-X10-FA-0100';
  const act = (start: string, finish: string, actual: boolean): P6Activity =>
    makeActivity({ activityId: id, startDate: start, finishDate: finish, actualStart: actual, actualFinish: actual, sortOrder: 0 });
  return {
    settings: { ...DEFAULT_SETTINGS, dataDate: '2026-09-30', defaultComplexity: 1 },
    locations: [{ code: 'X10' }],
    library,
    overrides: [],
    testProgress: [{ activityId: id, pctOverride: 1, updatedAt: 'x' }],
    current: [act('2026-08-24', '2026-09-02', true)],
    baseline: [act('2026-08-31', '2026-09-10', false)],
  };
}

describe('an activity that finished early', () => {
  const m = computeModel(earlyFinish());
  const id = 'A-P2-TC-X10-FA-0100';
  const row = (from: string, to: string) => periodLog(m.rows, from, to).activities.find((a) => a.activityId === id);

  it('reads COMPLETED in the fortnight it finished in', () => {
    expect(row('2026-08-27', '2026-09-09')!.outcome).toBe('COMPLETED');
  });

  it('is COMPLETED EARLY in the next fortnight, not CONTINUED', () => {
    // The bug: its baseline ran to 10 Sep, so it is listed again — and asking only
    // whether it finished INSIDE that window sent it to CONTINUED, telling the
    // review an activity it had already signed off was still running.
    const next = row('2026-09-10', '2026-09-23')!;
    expect(next.outcome).toBe('COMPLETED EARLY');
    expect(next.plannedHours).toBeGreaterThan(0);
    expect(next.earnedHours).toBe(0);
  });

  it('does not let work signed off earlier inflate what this fortnight finished', () => {
    // The whole reason COMPLETED EARLY is its own outcome: the headline count of
    // what got finished has to mean this fortnight.
    const next = periodLog(m.rows, '2026-09-10', '2026-09-23');
    expect(next.counts.COMPLETED).toBe(0);
    expect(next.counts['COMPLETED EARLY']).toBe(1);
    // And the fortnight it really finished in counts it, and only it.
    const own = periodLog(m.rows, '2026-08-27', '2026-09-09');
    expect(own.counts.COMPLETED).toBe(1);
    expect(own.counts['COMPLETED EARLY']).toBe(0);
  });

  it('reads the actual dates, and reports how early it was', () => {
    const a = row('2026-08-27', '2026-09-09')!;
    expect(a.actualStart).toBe('2026-08-24');
    expect(a.actualFinish).toBe('2026-09-02');
    expect(a.finishVarianceDays).toBe(-8);
  });

  it('counts as finished against a baseline that was due in a later window', () => {
    const late = periodLog(m.rows, '2026-09-10', '2026-09-23');
    expect(late.dueToFinish).toBe(1);
    expect(late.finishedOnTime).toBe(1);
    expect(late.counts.MISSED).toBe(0);
  });

  it('is never late and never still running, in any window', () => {
    for (let i = 0; i < 26; i += 1) {
      const from = addDays('2026-08-01', i * 14);
      const to = addDays(from, 13);
      const a = periodLog(m.rows, from, to).activities.find((x) => x.activityId === id);
      if (!a) continue;
      expect(a.outcome, `${from} to ${to}`).not.toBe('MISSED');
      expect(a.outcome, `${from} to ${to}`).not.toBe('CONTINUED');
      // Every window that has reached the day it finished says so, one way or the
      // other: inside the window it is COMPLETED, after it, COMPLETED EARLY.
      if (to >= '2026-09-02') expect(a.outcome, `${from} to ${to}`).toMatch(/^COMPLETED/);
    }
  });
});

describe('keying an actual date', () => {
  const id = 'A-P2-TC-X10-FA-0100';

  it('overrides P6, and moves the outcome with it', () => {
    // What the Two-Week Log's Actual finish box writes: the test end override. P6
    // has this one finishing on 2 Sep; somebody at the review says it was the 12th.
    const input = earlyFinish();
    const corrected = computeModel({
      ...input,
      testProgress: [{ activityId: id, pctOverride: 1, testEndOverride: '2026-09-12', updatedAt: 'x' }],
    });
    const row = corrected.rows.find((r) => r.activityId === id)!;
    expect(row.actualFinish).toBe('2026-09-12');
    expect(row.earnWindowSource).toBe('TEST WINDOW');
    // It no longer finished before the later fortnight — it finished inside it.
    expect(periodLog(corrected.rows, '2026-09-10', '2026-09-23').activities.find((a) => a.activityId === id)!.outcome).toBe('COMPLETED');
  });

  it('shows P6\u2019s own dates beside it, so a screen can say what is being overridden', () => {
    const corrected = computeModel({
      ...earlyFinish(),
      testProgress: [{ activityId: id, pctOverride: 1, testStartOverride: '2026-08-20', updatedAt: 'x' }],
    });
    const a = periodLog(corrected.rows, '2026-08-18', '2026-08-31').activities.find((x) => x.activityId === id)!;
    expect(a.actualStart).toBe('2026-08-20');
    expect(a.p6ActualStart).toBe('2026-08-24');
    expect(a.p6ActualFinish).toBe('2026-09-02');
  });

  it('closes the earn window on a keyed end even with no keyed start', () => {
    // IN PROGRESS means "running to the data date", which is the wrong end of a
    // window somebody has just dated.
    const m2 = computeModel({
      ...earlyFinish(),
      testProgress: [{ activityId: id, pctOverride: 1, testEndOverride: '2026-09-05', updatedAt: 'x' }],
    });
    const row = m2.rows.find((r) => r.activityId === id)!;
    expect(row.earnStart).toBe('2026-08-24');
    expect(row.earnEnd).toBe('2026-09-05');
    expect(row.earnWindowSource).toBe('TEST WINDOW');
  });

  it('keeps a finish date visible before the activity reads 100%', () => {
    // The date is editable, so it has to survive being typed: one that vanished
    // until the percent complete caught up would look like the box had eaten it.
    const partial = computeModel({
      ...earlyFinish(),
      testProgress: [{ activityId: id, pctOverride: 0.5, testEndOverride: '2026-09-02', updatedAt: 'x' }],
    });
    const a = periodLog(partial.rows, '2026-08-27', '2026-09-09').activities.find((x) => x.activityId === id)!;
    expect(a.actualFinish).toBe('2026-09-02');
    // Shown, but not finished: the outcome still judges it on the percent complete.
    expect(a.outcome).not.toMatch(/^COMPLETED/);
  });
});

/**
 * The stale half-done activity.
 *
 * Baseline 24 Jul to 14 Aug. P6 records an actual start and no finish, and it has
 * sat at 50% ever since. With nothing saying WHEN that 50% was reached, its earned
 * hours spread from the actual start to the data date — so every fortnight between
 * the two gets a slice of them and reports movement that never happened.
 */
function stalled(progressAsOf?: string): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 1, shiftHours: 10, durationShifts: 10 }];
  const id = 'A-P2-TC-X10-FA-0200';
  const act = (start: string, finish: string, actualStart: boolean): P6Activity =>
    makeActivity({ activityId: id, startDate: start, finishDate: finish, actualStart, actualFinish: false, sortOrder: 0 });
  return {
    settings: { ...DEFAULT_SETTINGS, dataDate: '2026-10-07', defaultComplexity: 1 },
    locations: [{ code: 'X10' }],
    library,
    overrides: [],
    testProgress: [{ activityId: id, pctOverride: 0.5, ...(progressAsOf ? { progressAsOf } : {}), updatedAt: 'x' }],
    current: [act('2026-07-24', '2026-11-30', true)],
    baseline: [act('2026-07-24', '2026-08-14', false)],
  };
}

describe('an activity that has not moved since it started', () => {
  const id = 'A-P2-TC-X10-FA-0200';
  const earnedIn = (m2: ReturnType<typeof computeModel>, from: string, to: string) =>
    periodLog(m2.rows, from, to).activities.find((a) => a.activityId === id)?.earnedHours ?? 0;

  it('dribbles its hours into every window while nothing says when the work happened', () => {
    // Not a bug in the arithmetic — it is the app assuming the work is still going
    // on, which is all it can do until somebody tells it otherwise.
    const m2 = computeModel(stalled());
    expect(earnedIn(m2, '2026-09-09', '2026-09-22')).toBeGreaterThan(0);
    expect(earnedIn(m2, '2026-09-23', '2026-10-07')).toBeGreaterThan(0);
    const a = periodLog(m2.rows, '2026-09-09', '2026-10-07').activities.find((x) => x.activityId === id)!;
    expect(a.spreadToDataDate).toBe(true);
    expect(a.progressAsOf).toBeNull();
  });

  it('stops dead once the progress is dated, and reports nothing afterwards', () => {
    const m2 = computeModel(stalled('2026-08-02'));
    expect(m2.rows.find((r) => r.activityId === id)!.earnEnd).toBe('2026-08-02');
    expect(m2.rows.find((r) => r.activityId === id)!.earnWindowSource).toBe('PROGRESS AS AT');
    // The window it was really earned in still has the hours ...
    expect(earnedIn(m2, '2026-07-24', '2026-08-06')).toBeGreaterThan(0);
    // ... and every window after it reports exactly nothing.
    expect(earnedIn(m2, '2026-09-09', '2026-09-22')).toBe(0);
    expect(earnedIn(m2, '2026-09-23', '2026-10-07')).toBe(0);
    const a = periodLog(m2.rows, '2026-09-09', '2026-10-07').activities.find((x) => x.activityId === id);
    if (a) expect(a.spreadToDataDate).toBe(false);
  });

  it('moves the hours rather than losing them', () => {
    // Whatever the window says, the same 50% is earned in total: this is about WHEN
    // the hours land, never how many there are.
    const sum = (m2: ReturnType<typeof computeModel>) => {
      let total = 0;
      for (let i = 0; i < 40; i += 1) {
        const from = addDays('2026-07-01', i * 14);
        total += earnedIn(m2, from, addDays(from, 13));
      }
      return total;
    };
    const open = computeModel(stalled());
    const dated = computeModel(stalled('2026-08-02'));
    const half = open.rows.find((r) => r.activityId === id)!.budgetHours * 0.5;
    expect(sum(open)).toBeCloseTo(half, 6);
    expect(sum(dated)).toBeCloseTo(half, 6);
  });

  it('is still flagged as unfinished: a progress date is not a finish', () => {
    const m2 = computeModel(stalled('2026-08-02'));
    const row = m2.rows.find((r) => r.activityId === id)!;
    expect(row.actualFinish).toBeNull();
    expect(row.pctComplete).toBe(0.5);
    // It was due to finish on 14 Aug and did not, so that fortnight still says so.
    expect(periodLog(m2.rows, '2026-08-07', '2026-08-20').activities.find((a) => a.activityId === id)!.outcome).toBe('MISSED');
  });

  it('gives way to a real finish, which is the better answer', () => {
    const m2 = computeModel({
      ...stalled('2026-08-02'),
      testProgress: [{ activityId: id, pctOverride: 1, progressAsOf: '2026-08-02', testEndOverride: '2026-08-20', updatedAt: 'x' }],
    });
    const row = m2.rows.find((r) => r.activityId === id)!;
    expect(row.earnEnd).toBe('2026-08-20');
    expect(row.earnWindowSource).toBe('TEST WINDOW');
  });
});

describe('what a row put into its own phase', () => {
  const m = computeModel(scenario());
  const log = periodLog(m.rows, '2026-08-18', '2026-08-31');

  it('is the row’s own achieved hours over its phase’s whole budget', () => {
    for (const a of log.activities) {
      expect(a.phaseBudgetHours).toBeGreaterThan(0);
      expect(a.phaseContribution).toBeCloseTo(a.earnedHours / a.phaseBudgetHours, 9);
    }
  });

  it('adds up across the phase to exactly how far that phase moved', () => {
    // The property that makes the column worth reading: the rows are parts of one
    // figure, not five copies of a heading.
    for (const p of log.phases) {
      const summed = log.activities.filter((a) => a.phase === p.key).reduce((s, a) => s + (a.phaseContribution ?? 0), 0);
      expect(summed).toBeCloseTo(p.pctAtEnd - p.pctAtStart, 9);
    }
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

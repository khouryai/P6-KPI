/**
 * Planned to achieved, by why — and the current schedule beside the baseline.
 *
 * The property that matters most is that nothing is hidden: the bridge never takes
 * an hour out of the plan, it only files the gap between planned and achieved under
 * a cause, and the causes have to add back to achieved exactly. A bridge that leaked
 * would be the one thing worse than the bare percentage it exists to explain.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { periodLog, periodBridge, addDays, canTakeReason, needsReason, SHORTFALL_CAUSES, type PeriodActivity, type PeriodBridge } from '../src/engine/period';
import { bridgeFor, isOutsideControl, setMissedReason, setOutsideControl } from '../src/app/missedReasons';
import { fixtureModelInput, makeActivity } from './helpers';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import type { LibraryEntry, MissedReasonLog, ModelInput, P6Activity } from '../src/engine/types';
import type { DataUpdater } from '../src/app/state';

const FROM = '2026-08-18';
const TO = '2026-08-31';

const PRED = 'A-P2-TC-X10-FA-0001';
const IDLE = 'A-P2-TC-X10-FA-0002';
const SLOW = 'A-P2-TC-X10-FA-0003';
const DONE = 'A-P2-TC-X10-FA-0004';

/**
 * One activity doing each thing the review argues about:
 * - PRED was due to be running all fortnight, has not started, and the current
 *   schedule has already pushed it a month out — a late predecessor.
 * - IDLE was due to run inside the window and has not started either, with the
 *   current schedule still showing it where the baseline does.
 * - SLOW is under way and earning slower than its baseline spread.
 * - DONE finished inside the window.
 */
function scenario(): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 1, shiftHours: 10, durationShifts: 1 }];
  const act = (id: string, start: string, finish: string, actualStart: boolean, actualFinish: boolean, sortOrder: number): P6Activity =>
    makeActivity({ activityId: id, activityName: '[T&C] X10 (Ph2) - Test Type', startDate: start, finishDate: finish, actualStart, actualFinish, sortOrder });
  return {
    settings: { ...DEFAULT_SETTINGS, dataDate: TO, defaultComplexity: 1 },
    locations: [{ code: 'X10' }],
    library,
    overrides: [],
    testProgress: [
      { activityId: PRED, pctOverride: 0, updatedAt: 'x' },
      { activityId: IDLE, pctOverride: 0, updatedAt: 'x' },
      { activityId: SLOW, pctOverride: 0.2, testStartOverride: '2026-08-11', updatedAt: 'x' },
      { activityId: DONE, pctOverride: 1, testStartOverride: '2026-08-19', testEndOverride: '2026-08-26', updatedAt: 'x' },
    ],
    current: [
      act(PRED, '2026-09-21', '2026-10-10', false, false, 0),
      act(IDLE, '2026-08-20', '2026-08-29', false, false, 1),
      act(SLOW, '2026-08-11', '2026-09-20', true, false, 2),
      act(DONE, '2026-08-19', '2026-08-26', true, true, 3),
    ],
    baseline: [
      act(PRED, '2026-08-11', '2026-09-10', false, false, 0),
      act(IDLE, '2026-08-20', '2026-08-29', false, false, 1),
      act(SLOW, '2026-08-11', '2026-08-31', false, false, 2),
      act(DONE, '2026-08-19', '2026-08-26', false, false, 3),
    ],
  };
}

const m = computeModel(scenario());
const log = periodLog(m.rows, FROM, TO);
const row = (id: string) => log.activities.find((a) => a.activityId === id) as PeriodActivity;

/** A stand-in for the store, as the screens hand it to the helpers. */
function harness(initial: MissedReasonLog = { reasons: [], entries: [] }) {
  const box = { log: initial };
  const update = ((_key: string, fn: (prev: unknown) => unknown) => {
    box.log = fn(box.log) as MissedReasonLog;
  }) as unknown as DataUpdater;
  return { box, update };
}

/** Every planned hour, accounted for. */
function balances(b: PeriodBridge) {
  const short = SHORTFALL_CAUSES.reduce((s, c) => s + b.shortfall[c], 0);
  expect(b.planned - short + b.ahead).toBeCloseTo(b.earned, 6);
}

describe('the scenario reads as intended', () => {
  it('has one of each outcome the review argues about', () => {
    expect(row(PRED).outcome).toBe('NOT STARTED');
    expect(row(IDLE).outcome).toBe('MISSED');
    expect(row(SLOW).outcome).toBe('MISSED');
    expect(row(DONE).outcome).toBe('COMPLETED');
  });
});

describe('which rows take a reason', () => {
  it('missed and not started are owed one; finished rows are not offered one', () => {
    expect(needsReason(row(PRED))).toBe(true);
    expect(needsReason(row(IDLE))).toBe(true);
    expect(canTakeReason(row(DONE))).toBe(false);
  });

  it('a running row behind its plan can take one without being owed one', () => {
    const running = { ...row(SLOW), outcome: 'CONTINUED' as const };
    expect(needsReason(running)).toBe(false);
    expect(canTakeReason(running)).toBe(true);
    expect(canTakeReason({ ...running, earnedHours: running.plannedHours + 1 })).toBe(false);
  });
});

describe('the bridge from planned to achieved', () => {
  it('with no reasons given, a missed or not-started shortfall is owed an answer', () => {
    const b = periodBridge(log.activities, () => null);
    balances(b);
    expect(b.shortfall.CONSTRAINT).toBe(0);
    expect(b.shortfall.UNEXPLAINED).toBeCloseTo(row(PRED).plannedHours + row(IDLE).plannedHours + (row(SLOW).plannedHours - row(SLOW).earnedHours), 6);
    // Nothing is held by a constraint, so the workable plan is the whole plan.
    expect(b.workablePlanned).toBeCloseTo(log.plannedHours, 6);
    expect(b.workableAchievement).toBeCloseTo(log.achievement as number, 6);
  });

  it('a predecessor reason takes exactly that activity’s shortfall out of the workable plan, and nothing out of the plan', () => {
    const { box, update } = harness();
    setMissedReason(update, PRED, TO, 'Predecessor work not complete');
    const b = bridgeFor(box.log, log.activities, TO);
    balances(b);
    expect(b.planned).toBeCloseTo(log.plannedHours, 6);
    expect(b.shortfall.CONSTRAINT).toBeCloseTo(row(PRED).plannedHours, 6);
    expect(b.workablePlanned).toBeCloseTo(log.plannedHours - row(PRED).plannedHours, 6);
    expect(b.workableAchievement).toBeCloseTo(log.earnedHours / (log.plannedHours - row(PRED).plannedHours), 6);
    expect(b.workableAchievement as number).toBeGreaterThan(log.achievement as number);
    expect(b.byReason).toEqual([{ reason: 'Predecessor work not complete', outsideControl: true, hours: row(PRED).plannedHours, activities: 1 }]);
  });

  it('a team-side reason stays against the team', () => {
    const { box, update } = harness();
    setMissedReason(update, IDLE, TO, 'Resource not available');
    const b = bridgeFor(box.log, log.activities, TO);
    balances(b);
    expect(b.shortfall.TEAM).toBeCloseTo(row(IDLE).plannedHours, 6);
    expect(b.shortfall.CONSTRAINT).toBe(0);
    expect(b.workablePlanned).toBeCloseTo(log.plannedHours, 6);
  });

  it('a reason somebody typed is the team’s own until they say otherwise, and saying so is kept', () => {
    const { box, update } = harness();
    setMissedReason(update, PRED, TO, 'Signalling contractor late');
    expect(isOutsideControl(box.log, 'Signalling contractor late')).toBe(false);
    expect(bridgeFor(box.log, log.activities, TO).shortfall.TEAM).toBeCloseTo(row(PRED).plannedHours, 6);

    setOutsideControl(update, 'signalling contractor LATE', true);
    expect(isOutsideControl(box.log, 'Signalling contractor late')).toBe(true);
    expect(bridgeFor(box.log, log.activities, TO).shortfall.CONSTRAINT).toBeCloseTo(row(PRED).plannedHours, 6);

    // And a built-in one can be turned the other way.
    setOutsideControl(update, 'Weather', false);
    expect(isOutsideControl(box.log, 'Weather')).toBe(false);
  });

  it('a running row with no reason is pace, not an unanswered miss', () => {
    const running = log.activities.map((a) => (a.activityId === SLOW ? { ...a, outcome: 'CONTINUED' as const } : a));
    const b = periodBridge(running, () => null);
    balances(b);
    expect(b.shortfall.PACE).toBeCloseTo(row(SLOW).plannedHours - row(SLOW).earnedHours, 6);
    expect(b.activitiesBy.PACE).toBe(1);
  });

  it('finished-early hours are timing, not a shortfall of work', () => {
    const early = { ...row(DONE), outcome: 'COMPLETED EARLY' as const, earnedHours: 0 };
    const b = periodBridge([early], () => ({ reason: 'Weather', outsideControl: true }));
    balances(b);
    expect(b.shortfall.EARLIER).toBeCloseTo(early.plannedHours, 6);
    expect(b.shortfall.CONSTRAINT).toBe(0);
  });

  it('balances on every fortnight of a real job, whatever the reasons say', () => {
    const fixture = computeModel(fixtureModelInput());
    const reasons = ['Predecessor work not complete', 'Resource not available', null];
    for (let i = 0; i < 365 * 3; i += 14) {
      const from = addDays('2025-01-01', i);
      const l = periodLog(fixture.rows, from, addDays(from, 13));
      const b = periodBridge(l.activities, (a) => {
        const r = reasons[a.activityId.length % 3];
        return r ? { reason: r, outsideControl: r.startsWith('Pred') } : null;
      });
      balances(b);
      expect(b.planned).toBeCloseTo(l.plannedHours, 6);
      expect(b.earned).toBeCloseTo(l.earnedHours, 6);
    }
  });
});

describe('the current schedule beside the baseline', () => {
  it('a predecessor slip the schedule already carries shows as planned the current schedule no longer has here', () => {
    expect(row(PRED).plannedHours).toBeGreaterThan(0);
    expect(row(PRED).currentPlannedHours).toBe(0);
    expect(row(PRED).startSlipDays).toBe(41);
    expect(row(IDLE).currentPlannedHours).toBeCloseTo(row(IDLE).plannedHours, 6);
    expect(row(IDLE).startSlipDays).toBe(0);
    expect(log.currentPlannedHours).toBeLessThan(log.plannedHours);
    expect(log.currentAchievement as number).toBeGreaterThan(log.achievement as number);
  });

  it('the phase carries the same figure', () => {
    const p = log.phases.find((x) => x.key === row(PRED).phase)!;
    expect(p.currentPlannedHours).toBeCloseTo(log.currentPlannedHours, 6);
  });

  it('every consecutive fortnight sums to what the forecast curve draws', () => {
    const fixture = computeModel(fixtureModelInput());
    let current = 0;
    for (let i = 0; i < 365 * 8; i += 14) {
      const from = addDays('2024-01-01', i);
      current += periodLog(fixture.rows, from, addDays(from, 13)).currentPlannedHours;
    }
    const onCurve = fixture.rows
      .filter((r) => r.status === 'IN BUDGET' && r.currentStart && r.currentFinish)
      .reduce((s, r) => s + r.budgetHours, 0);
    expect(current).toBeCloseTo(onCurve, 6);
  });
});

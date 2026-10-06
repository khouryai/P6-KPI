/**
 * Measuring a fortnight against the schedule update in force when it began.
 *
 * Two things are pinned here. The plan itself: an update's activities spread the
 * way that update had them, which for work in progress means only what was left,
 * from the update's data date on. And which update is the plan: the latest one
 * dated on or before the window's first day, with each update knowing its own data
 * date even though an import only ever recorded when the file arrived.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { periodLog, planFromUpdate, addDays } from '../src/engine/period';
import { latestActualDate, outgoingDataDate, updateDataDate, updateFor } from '../src/app/updateDates';
import { fixtureModelInput, makeActivity } from './helpers';
import { DEFAULT_SETTINGS } from '../src/engine/types';
import type { ImportIndexEntry, LibraryEntry, ModelInput, P6Activity } from '../src/engine/types';

const FROM = '2026-08-18';
const TO = '2026-08-31';
/** The month's update, run a fortnight before the window began. */
const UPDATE_DATE = '2026-08-03';

const PRED = 'A-P2-TC-X10-FA-0001';
const IDLE = 'A-P2-TC-X10-FA-0002';
const SLOW = 'A-P2-TC-X10-FA-0003';
const DONE = 'A-P2-TC-X10-FA-0004';
const NEW = 'A-P2-TC-X10-FA-0005';

const act = (id: string, start: string, finish: string, actualStart: boolean, actualFinish: boolean, sortOrder: number, extra: Partial<P6Activity> = {}): P6Activity =>
  makeActivity({ activityId: id, activityName: '[T&C] X10 (Ph2) - Test Type', startDate: start, finishDate: finish, actualStart, actualFinish, sortOrder, ...extra });

function scenario(): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 1, shiftHours: 10, durationShifts: 1 }];
  return {
    settings: { ...DEFAULT_SETTINGS, dataDate: TO, defaultComplexity: 1 },
    locations: [{ code: 'X10' }],
    library,
    overrides: [],
    testProgress: [
      { activityId: PRED, pctOverride: 0, updatedAt: 'x' },
      { activityId: IDLE, pctOverride: 0, updatedAt: 'x' },
      { activityId: SLOW, pctOverride: 0.6, testStartOverride: '2026-07-20', updatedAt: 'x' },
      { activityId: DONE, pctOverride: 1, testStartOverride: '2026-08-19', testEndOverride: '2026-08-26', updatedAt: 'x' },
      { activityId: NEW, pctOverride: 0, updatedAt: 'x' },
    ],
    current: [
      act(PRED, '2026-09-21', '2026-10-10', false, false, 0),
      act(IDLE, '2026-09-01', '2026-09-10', false, false, 1),
      act(SLOW, '2026-07-20', '2026-09-15', true, false, 2),
      act(DONE, '2026-08-19', '2026-08-26', true, true, 3),
      act(NEW, '2026-08-20', '2026-08-28', false, false, 4),
    ],
    baseline: [
      act(PRED, '2026-08-11', '2026-09-10', false, false, 0),
      act(IDLE, '2026-08-20', '2026-08-29', false, false, 1),
      act(SLOW, '2026-07-20', '2026-08-31', false, false, 2),
      act(DONE, '2026-08-19', '2026-08-26', false, false, 3),
      act(NEW, '2026-08-20', '2026-08-28', false, false, 4),
    ],
  };
}

/**
 * What the August update said on the 3rd. PRED was already pushed out by its late
 * predecessor; IDLE was still due inside the window; SLOW was half done and due to
 * finish on the 31st; DONE was forecast as the baseline had it. NEW was not in it.
 */
const update: P6Activity[] = [
  act(PRED, '2026-09-21', '2026-10-10', false, false, 0),
  act(IDLE, '2026-08-20', '2026-08-29', false, false, 1),
  act(SLOW, '2026-07-20', '2026-08-31', true, false, 2, { originalDuration: 20, remainingDuration: 10 }),
  act(DONE, '2026-08-19', '2026-08-26', false, false, 3),
];

const m = computeModel(scenario());
const plan = planFromUpdate(update, UPDATE_DATE, { id: 'aug', label: 'update of 03-Aug-26' });
const onUpdate = periodLog(m.rows, FROM, TO, plan);
const onBaseline = periodLog(m.rows, FROM, TO);
const row = (log: typeof onUpdate, id: string) => log.activities.find((a) => a.activityId === id);
const budget = (id: string) => m.rows.find((r) => r.activityId === id)!.budgetHours;

describe('an update as a plan', () => {
  it('splits work in progress at the data date, and plans only what was left after it', () => {
    const e = plan.entries.get(SLOW.toLowerCase())!;
    expect(e.spans).toEqual([
      { share: 0.5, start: '2026-07-20', end: UPDATE_DATE },
      { share: 0.5, start: UPDATE_DATE, end: '2026-08-31' },
    ]);
    // Half the budget over the 28 days from the 3rd to the 31st; the window has the last 14 of them.
    expect(row(onUpdate, SLOW)!.plannedHours).toBeCloseTo(budget(SLOW) * 0.5 * (14 / 28), 6);
  });

  it('an activity the update had already pushed out is not this window’s plan, and is not listed', () => {
    expect(row(onBaseline, PRED)!.outcome).toBe('NOT STARTED');
    expect(row(onUpdate, PRED)).toBeUndefined();
  });

  it('the slip the update already carried shows as baseline over planned', () => {
    expect(onUpdate.plan).toEqual({ id: 'aug', label: 'update of 03-Aug-26', dataDate: UPDATE_DATE });
    expect(onUpdate.baselinePlannedHours).toBeCloseTo(onBaseline.plannedHours, 6);
    expect(onUpdate.plannedHours).toBeLessThan(onUpdate.baselinePlannedHours);
    expect(onUpdate.achievement as number).toBeGreaterThan(onBaseline.achievement as number);
    expect(onUpdate.baselineAchievement).toBeCloseTo(onBaseline.achievement as number, 6);
  });

  it('outcomes are judged against the update’s dates', () => {
    const idle = row(onUpdate, IDLE)!;
    expect(idle.outcome).toBe('MISSED');
    expect(idle.planFinish).toBe('2026-08-29');
    expect(idle.baselineFinish).toBe('2026-08-29');
    // DONE was due and finished; IDLE and SLOW were due and did not.
    expect(onUpdate.dueToFinish).toBe(3);
    expect(onUpdate.finishedOnTime).toBe(1);
  });

  it('work the update did not have is not planned, whatever the baseline says', () => {
    // Not in the update, not started: nothing asked for it here, so it is not listed —
    // but its baseline hours are still in the baseline figure beside the plan.
    expect(row(onUpdate, NEW)).toBeUndefined();
    expect(row(onBaseline, NEW)!.plannedHours).toBeGreaterThan(0);
    const listed = onUpdate.activities.reduce((s2, a) => s2 + a.baselinePlannedHours, 0);
    expect(onUpdate.baselinePlannedHours - listed).toBeCloseTo(row(onBaseline, NEW)!.plannedHours + row(onBaseline, PRED)!.plannedHours, 6);
  });

  it('started work the update did not have is listed, with no plan behind it', () => {
    const started = computeModel({
      ...scenario(),
      testProgress: scenario().testProgress.map((t) => (t.activityId === NEW ? { ...t, pctOverride: 0.5, testStartOverride: '2026-08-21' } : t)),
    });
    const n = periodLog(started.rows, FROM, TO, plan).activities.find((a) => a.activityId === NEW)!;
    expect(n.outcome).toBe('STARTED');
    expect(n.planStart).toBeNull();
    expect(n.plannedHours).toBe(0);
    expect(n.baselinePlannedHours).toBeGreaterThan(0);
  });

  it('measured against the baseline, nothing changes from before', () => {
    expect(onBaseline.plan).toBeNull();
    expect(onBaseline.baselinePlannedHours).toBe(onBaseline.plannedHours);
    for (const a of onBaseline.activities) {
      expect(a.planStart).toBe(a.baselineStart);
      expect(a.planFinish).toBe(a.baselineFinish);
    }
  });

  it('every fortnight from long before to long after sums back to the budget the update planned', () => {
    const fixture = computeModel(fixtureModelInput());
    const acts = fixtureModelInput().current;
    const p = planFromUpdate(acts, '2026-03-01', { id: 'x', label: 'x' });
    let planned = 0;
    for (let i = 0; i < 365 * 8; i += 14) {
      const from = addDays('2023-01-01', i);
      planned += periodLog(fixture.rows, from, addDays(from, 13), p).plannedHours;
    }
    const expected = fixture.rows
      .filter((r) => r.status === 'IN BUDGET')
      .reduce((s, r) => s + r.budgetHours * (p.entries.get(r.activityId.toLowerCase())?.spans.reduce((t, x) => t + x.share, 0) ?? 0), 0);
    expect(expected).toBeGreaterThan(0);
    expect(planned).toBeCloseTo(expected, 6);
  });
});

const entry = (id: string, importedAt: string, extra: Partial<ImportIndexEntry> = {}): ImportIndexEntry => ({
  id,
  kind: 'current',
  importedAt,
  sourceFilename: `${id}.xlsx`,
  rowCount: 1,
  file: `imports/${id}-current.json`,
  ...extra,
});

describe('which update a window is measured against', () => {
  const index: ImportIndexEntry[] = [
    entry('jul', '2026-07-03T09:00:00Z', { dataDate: '2026-07-01' }),
    entry('aug', '2026-08-05T09:00:00Z', { dataDate: '2026-08-01' }),
    entry('sep', '2026-09-04T09:00:00Z'),
    { ...entry('bl', '2026-01-01T00:00:00Z', { dataDate: '2026-01-01' }), kind: 'baseline' },
  ];

  it('the schedule in use takes Settings’ data date; an older one its stamp', () => {
    expect(updateDataDate(index[2], 'sep', '2026-09-01')).toEqual({ date: '2026-09-01', source: 'settings' });
    expect(updateDataDate(index[1], 'sep', '2026-09-01')).toEqual({ date: '2026-08-01', source: 'stamped' });
    expect(updateDataDate(index[2], 'other', null)).toEqual({ date: '2026-09-04', source: 'imported' });
  });

  it('a fortnight takes the latest update dated on or before its first day', () => {
    // First fortnight of August: the August update, run on its first day.
    expect(updateFor(index, 'sep', '2026-09-01', '2026-08-01')?.entry.id).toBe('aug');
    // Second fortnight of August: still the August update.
    expect(updateFor(index, 'sep', '2026-09-01', '2026-08-15')?.entry.id).toBe('aug');
    // The fortnight ending on the new data date began before it, so it is August's too.
    expect(updateFor(index, 'sep', '2026-09-01', '2026-08-19')?.entry.id).toBe('aug');
    // And the first fortnight of September is the September update in use.
    expect(updateFor(index, 'sep', '2026-09-01', '2026-09-01')?.entry.id).toBe('sep');
  });

  it('before the first update there is none, and baselines never count', () => {
    expect(updateFor(index, 'sep', '2026-09-01', '2026-06-15')).toBeNull();
  });

  it('a corrected re-import of the same update wins over the first one', () => {
    const again = [...index, entry('aug2', '2026-08-06T09:00:00Z', { dataDate: '2026-08-01' })];
    expect(updateFor(again, 'sep', '2026-09-01', '2026-08-15')?.entry.id).toBe('aug2');
  });
});

describe('stamping an update as it is replaced', () => {
  const july = [act(PRED, '2026-06-01', '2026-06-20', true, true, 0), act(IDLE, '2026-06-25', '2026-07-30', true, false, 1)];
  const august = [...july, act(SLOW, '2026-07-10', '2026-07-28', true, true, 2)];

  it('reads the newest actual date in a file', () => {
    expect(latestActualDate(july)).toBe('2026-06-25');
    expect(latestActualDate(august)).toBe('2026-07-28');
  });

  it('Settings still on the old date is the outgoing update’s date', () => {
    // The incoming file has actuals after Settings, so Settings has not moved yet.
    expect(outgoingDataDate(july, august, '2026-07-01')).toEqual({ dataDate: '2026-07-01', estimated: false });
  });

  it('Settings already moved for the incoming file falls back to an estimate from the outgoing one', () => {
    expect(outgoingDataDate(july, august, '2026-08-01')).toEqual({ dataDate: '2026-06-25', estimated: true });
  });

  it('no Settings date at all is an estimate too, or nothing when the file has no actuals', () => {
    expect(outgoingDataDate(july, august, '')).toEqual({ dataDate: '2026-06-25', estimated: true });
    expect(outgoingDataDate([act(PRED, '2026-06-01', '2026-06-20', false, false, 0)], august, null)).toBeNull();
  });
});

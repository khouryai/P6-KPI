/**
 * What changed between two schedules.
 *
 * The monthly import used to answer this with counts. The question is which
 * activities moved and by how much, and it has to be answerable before confirming
 * the import — while it is still a decision rather than a fact.
 */
import { describe, it, expect } from 'vitest';
import { diffSchedules } from '../src/engine/scheduleDiff';
import { makeActivity } from './helpers';

const act = (id: string, over: Parameters<typeof makeActivity>[0] extends infer _ ? Record<string, unknown> : never = {}) =>
  makeActivity({ activityId: id, ...over } as Parameters<typeof makeActivity>[0]);

describe('comparing two schedules', () => {
  const before = [
    act('A-1', { finishDate: '2026-03-31', startDate: '2026-03-01' }),
    act('A-2', { finishDate: '2026-04-30', startDate: '2026-04-01' }),
    act('A-3', { finishDate: '2026-05-29', startDate: '2026-05-01' }),
    act('GONE', { finishDate: '2026-06-30' }),
  ];

  it('names what moved, and by how many days', () => {
    const after = [
      act('A-1', { finishDate: '2026-04-30', startDate: '2026-03-01' }), // 30 days later
      act('A-2', { finishDate: '2026-04-30', startDate: '2026-04-01' }), // untouched
      act('A-3', { finishDate: '2026-05-15', startDate: '2026-05-01' }), // pulled in
      act('NEW', { finishDate: '2026-07-31' }),
    ];
    const d = diffSchedules(before, after);
    expect(d.slipped.map((c) => c.activityId)).toEqual(['A-1']);
    expect(d.slipped[0].finishMovedDays).toBe(30);
    expect(d.pulledIn.map((c) => c.activityId)).toEqual(['A-3']);
    expect(d.pulledIn[0].finishMovedDays).toBe(-14);
    expect(d.added.map((c) => c.activityId)).toEqual(['NEW']);
    expect(d.removed.map((c) => c.activityId)).toEqual(['GONE']);
    expect(d.unchanged).toBe(1);
  });

  it('sorts the slip list worst first, which is the order it is read in', () => {
    const after = [
      act('A-1', { finishDate: '2026-04-07' }),
      act('A-2', { finishDate: '2026-07-30' }),
      act('A-3', { finishDate: '2026-06-01' }),
    ];
    const d = diffSchedules(before, after);
    const slips = d.slipped.map((c) => c.finishMovedDays ?? 0);
    expect([...slips].sort((a, b) => b - a)).toEqual(slips);
    expect(d.slipped[0].activityId).toBe('A-2');
  });

  it('reports what completed between the two', () => {
    const after = [
      act('A-1', { finishDate: '2026-03-31', startDate: '2026-03-01', actualStart: true, actualFinish: true }),
      act('A-2', { finishDate: '2026-04-30', startDate: '2026-04-01', actualStart: true }),
    ];
    const d = diffSchedules(before, after);
    expect(d.finished.map((c) => c.activityId)).toEqual(['A-1']);
    // Newly started but not finished is its own list: an activity is not both.
    expect(d.started.map((c) => c.activityId)).toEqual(['A-2']);
  });

  it('spells out each field that differs, old to new', () => {
    const after = [act('A-1', { finishDate: '2026-03-31', startDate: '2026-03-01', originalDuration: 22, activityName: 'Renamed' })];
    const [change] = diffSchedules([before[0]], after).changed;
    const fields = Object.fromEntries(change.fields.map((f) => [f.field, `${f.from} → ${f.to}`]));
    expect(fields['Original duration']).toBe('10 → 22');
    expect(fields['Name']).toContain('→ Renamed');
    expect(fields['Start']).toBeUndefined();
  });

  it('counts a date becoming actual as a change, because it is one', () => {
    const after = [act('A-1', { finishDate: '2026-03-31', startDate: '2026-03-01', actualFinish: true })];
    const [change] = diffSchedules([before[0]], after).changed;
    expect(change.fields.find((f) => f.field === 'Finish')?.to).toBe('2026-03-31 A');
    expect(change.finishMovedDays).toBeNull();
  });

  it('leaves WBS rows out, so summary rollups do not bury the real changes', () => {
    const wbs = makeActivity({ activityId: '  Phase 2', activityName: '', rowType: 'WBS', originalDuration: 900 });
    const wbsMoved = makeActivity({ activityId: '  Phase 2', activityName: '', rowType: 'WBS', originalDuration: 950 });
    const d = diffSchedules([wbs, before[0]], [wbsMoved, before[0]]);
    expect(d.changed).toEqual([]);
    expect(d.unchanged).toBe(1);
  });

  it('finds nothing to report when a schedule is re-imported unchanged', () => {
    const d = diffSchedules(before, before);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.unchanged).toBe(before.length);
  });

  it('treats a duplicate Activity ID the way every other join does: first wins', () => {
    const dupes = [act('A-1', { finishDate: '2026-03-31' }), act('A-1', { finishDate: '2027-01-01' })];
    const d = diffSchedules([before[0]], dupes);
    expect(d.changed.length + d.unchanged).toBe(1);
    expect(d.added).toEqual([]);
  });
});

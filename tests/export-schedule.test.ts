/**
 * When the scheduled export runs. Local time throughout.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_SCHEDULE, exportFileNames, fortnightAnchor, isDue, lastScheduled, nextScheduled, type ExportSchedule } from '../src/app/exportSchedule';

const sched = (p: Partial<ExportSchedule>): ExportSchedule => ({ ...DEFAULT_SCHEDULE, enabled: true, since: new Date(2026, 0, 1).toISOString(), ...p });
// Wednesday 21 October 2026.
const wed = (h: number, m = 0) => new Date(2026, 9, 21, h, m);

describe('the export schedule', () => {
  it('runs every weekday at the time set, and not at weekends', () => {
    const s = sched({ frequency: 'weekdays', time: '07:00' });
    expect(nextScheduled(s, wed(6))?.getTime()).toBe(wed(7).getTime());
    expect(nextScheduled(s, wed(8))?.getTime()).toBe(new Date(2026, 9, 22, 7).getTime());
    // Friday after seven: the next is Monday.
    expect(nextScheduled(s, new Date(2026, 9, 23, 9))?.getTime()).toBe(new Date(2026, 9, 26, 7).getTime());
  });

  it('runs weekly on the day chosen', () => {
    const s = sched({ frequency: 'weekly', weekday: 1, time: '06:30' });
    expect(nextScheduled(s, wed(12))?.getTime()).toBe(new Date(2026, 9, 26, 6, 30).getTime());
    expect(lastScheduled(s, wed(12))?.getTime()).toBe(new Date(2026, 9, 19, 6, 30).getTime());
  });

  it('runs every other week from its first day', () => {
    const anchor = fortnightAnchor(1, wed(12)); // the next Monday, 26 Oct
    expect(anchor).toBe('2026-10-26');
    const s = sched({ frequency: 'fortnightly', weekday: 1, anchor, time: '07:00' });
    expect(nextScheduled(s, wed(12))?.getTime()).toBe(new Date(2026, 9, 26, 7).getTime());
    expect(nextScheduled(s, new Date(2026, 9, 26, 8))?.getTime()).toBe(new Date(2026, 10, 9, 7).getTime());
  });

  it('runs monthly, on the last day where the month is short', () => {
    const s = sched({ frequency: 'monthly', monthDay: 31, time: '18:00' });
    expect(nextScheduled(s, new Date(2026, 10, 2))?.getTime()).toBe(new Date(2026, 10, 30, 18).getTime());
    expect(nextScheduled(s, new Date(2027, 1, 2))?.getTime()).toBe(new Date(2027, 1, 28, 18).getTime());
  });

  it('is due once a scheduled moment passes, and not again until the next', () => {
    const s = sched({ frequency: 'daily', time: '07:00' });
    expect(isDue({ ...s, lastRunAt: new Date(2026, 9, 20, 7, 1).toISOString() }, wed(6))).toBe(false);
    expect(isDue({ ...s, lastRunAt: new Date(2026, 9, 20, 7, 1).toISOString() }, wed(7, 1))).toBe(true);
    expect(isDue({ ...s, lastRunAt: wed(7, 1).toISOString() }, wed(16))).toBe(false);
  });

  it('catches up once when the app was closed at the scheduled time', () => {
    const s = sched({ frequency: 'daily', time: '07:00', lastRunAt: new Date(2026, 9, 16, 7).toISOString() });
    expect(isDue(s, wed(10))).toBe(true);
    expect(isDue({ ...s, lastRunAt: wed(10).toISOString() }, wed(11))).toBe(false);
  });

  it('owes nothing for a time already gone when the schedule was set', () => {
    const s = sched({ frequency: 'daily', time: '07:00', since: wed(9).toISOString() });
    expect(isDue(s, wed(10))).toBe(false);
    expect(isDue(s, new Date(2026, 9, 22, 7, 5))).toBe(true);
  });

  it('never runs while switched off', () => {
    expect(isDue(sched({ enabled: false }), wed(23))).toBe(false);
  });

  it('names a dated file that sorts in time order, a fixed one, or both', () => {
    const when = new Date(2026, 9, 21, 7, 5);
    expect(exportFileNames('dated', when)).toEqual(['TC_Budget_Data_2026-10-21_0705.xlsx']);
    expect(exportFileNames('latest', when)).toEqual(['TC_Budget_Data_latest.xlsx']);
    expect(exportFileNames('both', when)).toHaveLength(2);
  });
});

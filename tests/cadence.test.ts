/**
 * How often the S-curve reports.
 *
 * Month ends are the obvious cadence and the wrong one for a fortnightly review. A
 * data date of Wed 23 Sep against month-end periods put the last earned point at
 * 31 Aug — three weeks of reported progress missing from the line — and the DATA
 * DATE marker on 30 Sep, the period the data date falls inside rather than the day
 * itself. Nothing was stale; the grid was too coarse to land on the day reported.
 */
import { describe, it, expect } from 'vitest';
import { periodEndsBetween, addDaysISO } from '../src/engine/dates';
import { buildCurve, computeModel } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type LibraryEntry } from '../src/engine/types';
import { makeActivity } from './helpers';

const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 }];

/** One activity running well past the data date, so the curve has a span. */
const acts = [
  makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-01-05', finishDate: '2026-09-15', actualStart: true, actualFinish: true, originalDuration: 10, remainingDuration: 0 }),
  makeActivity({ activityId: '0-P2-TC-A10-FA-0020', startDate: '2026-10-01', finishDate: '2027-02-26', originalDuration: 10, remainingDuration: 10 }),
];

const build = (dataDate: string, curveCadence: 'month' | 'fortnight' | 'week') =>
  computeModel({
    settings: { ...DEFAULT_SETTINGS, dataDate, curveCadence },
    locations: [],
    library: lib,
    overrides: [],
    testProgress: [],
    current: acts,
    baseline: null,
  });

describe('period ends', () => {
  it('falls back to month ends with no cadence and no anchor', () => {
    expect(periodEndsBetween('2026-08-01', '2026-10-31')).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
    expect(periodEndsBetween('2026-08-01', '2026-10-31', 'fortnight', null)).toEqual(['2026-08-31', '2026-09-30', '2026-10-31']);
  });

  it('lands exactly on the data date, which is the whole point', () => {
    const p = periodEndsBetween('2026-08-01', '2026-11-01', 'fortnight', '2026-09-23');
    expect(p).toContain('2026-09-23');
  });

  it('steps a clean fortnight, so every period is the same weekday', () => {
    const p = periodEndsBetween('2026-06-01', '2026-11-01', 'fortnight', '2026-09-23');
    for (let i = 1; i < p.length; i++) {
      expect(Math.round((Date.parse(p[i]) - Date.parse(p[i - 1])) / 86_400_000)).toBe(14);
    }
    // 23 Sep 2026 is a Wednesday, so every period is.
    for (const d of p) expect(new Date(`${d}T00:00:00Z`).getUTCDay()).toBe(3);
  });

  it('covers the whole span, reaching back before the start and past the end', () => {
    // A fixed step rarely lands on the last date in the schedule, and a curve whose
    // final period falls short of the last finish never reaches 100% — which reads
    // as a plan that does not complete rather than as a grid that stopped early.
    const p = periodEndsBetween('2026-09-01', '2026-10-10', 'fortnight', '2026-09-23');
    expect(p[0] <= '2026-09-01').toBe(true);
    expect(p[p.length - 1] >= '2026-10-10').toBe(true);
  });

  it('steps weekly when asked', () => {
    const p = periodEndsBetween('2026-09-01', '2026-10-01', 'week', '2026-09-23');
    expect(p).toContain('2026-09-23');
    expect(p).toContain(addDaysISO('2026-09-23', -7));
    expect(p).toContain(addDaysISO('2026-09-23', 7));
  });

  it('keeps the data date on its own chart even when the schedule ends before it', () => {
    const p = periodEndsBetween('2026-01-01', '2026-02-01', 'fortnight', '2026-09-23');
    expect(p[p.length - 1]).toBe('2026-09-23');
  });
});

describe('the curve a fortnightly review reads', () => {
  it('runs the earned line to the data date, not to the month end before it', () => {
    const monthly = build('2026-09-23', 'month');
    const fortnightly = build('2026-09-23', 'fortnight');

    const lastEarned = (m: ReturnType<typeof build>) => [...m.curve].reverse().find((c) => c.earned !== null)!.periodEnd;
    // The bug: three weeks of reported progress off the end of the line.
    expect(lastEarned(monthly)).toBe('2026-08-31');
    expect(lastEarned(fortnightly)).toBe('2026-09-23');
  });

  it('puts a period exactly on the data date for the marker to sit on', () => {
    const m = build('2026-09-23', 'fortnight');
    expect(m.curve.some((c) => c.periodEnd === '2026-09-23')).toBe(true);
    // The marker is drawn at the last period at or before the data date, which here
    // is the data date itself rather than the month end after it.
    const marker = [...m.curve].filter((c) => c.periodEnd <= '2026-09-23').pop()!;
    expect(marker.periodEnd).toBe('2026-09-23');
  });

  it('earns nothing after the data date whatever the cadence', () => {
    for (const cadence of ['month', 'fortnight', 'week'] as const) {
      const m = build('2026-09-23', cadence);
      expect(m.curve.filter((c) => c.periodEnd > '2026-09-23').every((c) => c.earned === null)).toBe(true);
    }
  });

  it('reports the same totals however often it reports them', () => {
    // Changing the cadence changes where the line is sampled, never what it sums to.
    const monthly = build('2026-09-23', 'month');
    const fortnightly = build('2026-09-23', 'fortnight');
    expect(fortnightly.summary.earnedHours).toBeCloseTo(monthly.summary.earnedHours, 9);
    expect(fortnightly.summary.totalBudgetHours).toBe(monthly.summary.totalBudgetHours);
    const end = (m: ReturnType<typeof build>) => m.curve[m.curve.length - 1];
    expect(end(fortnightly).planned).toBeCloseTo(end(monthly).planned, 6);
  });

  it('keeps earned-against-built monthly, whatever the curve does', () => {
    /*
     * Timesheets are monthly. Feeding the burn a fortnightly grid would key two
     * rows to the same month and silently halve one of them.
     */
    const m = build('2026-09-23', 'fortnight');
    const months = m.burn.months.map((x) => x.month);
    expect(new Set(months).size).toBe(months.length);
    for (const x of months) expect(x).toMatch(/^\d{4}-\d{2}$/);
  });

  it('lets a phase curve be drawn at the same cadence as the project one', () => {
    const m = build('2026-09-23', 'fortnight');
    const phase = buildCurve(m.rows.filter((r) => r.phase === 'P2'), '2026-09-23', 'fortnight').curve;
    expect(phase.some((c) => c.periodEnd === '2026-09-23')).toBe(true);
  });
});

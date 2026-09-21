/**
 * The years that have not happened yet.
 *
 * "How did FY26 go" is answered by measurement. "What does FY28 need, and from
 * whom" is answered by the schedule plus a rate, and the two must not be allowed
 * to look alike. These pin where the remaining budget lands, who it belongs to,
 * and what the projection refuses to guess.
 */
import { describe, it, expect } from 'vitest';
import { computeModel, monthlyRemaining, buildCurve } from '../src/engine/compute';
import { forecastYears } from '../src/engine/fiscal';
import { DEFAULT_SETTINGS, type LibraryEntry, type TeamActual } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-06-30', fiscalYearStartMonth: 7 };

/** One ATS and one IXL engineer, so every activity splits evenly between two groups. */
const lib: LibraryEntry[] = [
  { matchKey: 'Test Type', basis: 'RATE', shiftHours: 10, durationShifts: 4, crew: [{ subsystem: 'ATS', count: 1 }, { subsystem: 'IXL', count: 1 }] },
];

/** ATS has run at a loss, IXL has not been booked to at all. */
const teamActuals: TeamActual[] = [
  { id: '1', month: '2026-05', subsystem: 'ATS', hours: 80 },
];

const build = (acts: ReturnType<typeof makeActivity>[], actuals = teamActuals) =>
  computeModel({ settings: S, locations: [], library: lib, overrides: [], testProgress: [], teamActuals: actuals, current: acts, baseline: null });

describe('where the work that is left falls', () => {
  it('spreads an activity that has not begun across its own window', () => {
    const acts = [makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-09-01', finishDate: '2026-10-31', originalDuration: 10, remainingDuration: 10 })];
    const m = build(acts);
    const months = m.burn.forecastMonths.map((f) => f.month);
    expect(months).toEqual(['2026-09', '2026-10']);
    expect(m.burn.forecastMonths.reduce((s, f) => s + f.earned, 0)).toBeCloseTo(m.burn.project.remainingHours, 6);
  });

  it('carries ALL of a half-elapsed activity over the days it has left, not half of it', () => {
    /*
     * The activity is 100% budget and 0% earned at the data date. Spreading its
     * whole window would put budget it still has to earn in months that are gone.
     */
    const acts = [makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-05-01', finishDate: '2026-08-31', originalDuration: 10, remainingDuration: 10 })];
    const m = build(acts);
    expect(m.burn.forecastMonths.map((f) => f.month)).toEqual(['2026-07', '2026-08']);
    expect(m.burn.forecastMonths.reduce((s, f) => s + f.earned, 0)).toBeCloseTo(m.burn.project.remainingHours, 6);
  });

  it('puts work the schedule says is already late in the first month ahead, and counts it', () => {
    const acts = [makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-02-02', finishDate: '2026-03-31', originalDuration: 10, remainingDuration: 10 })];
    const m = build(acts);
    expect(m.burn.overdueRemaining).toBeCloseTo(m.burn.project.remainingHours, 6);
    expect(m.burn.forecastMonths[0].month).toBe('2026-07');
    expect(m.burn.forecastMonths[0].earned).toBeCloseTo(m.burn.project.remainingHours, 6);
  });

  it('refuses to place an activity with no dates, and says how much it could not place', () => {
    const acts = [makeActivity({ activityId: '0-P2-TC-A10-FA-0010', originalDuration: 10, remainingDuration: 10 })];
    const m = build(acts);
    expect(m.burn.forecastMonths).toEqual([]);
    expect(m.burn.unphasedRemaining).toBeCloseTo(m.burn.project.remainingHours, 6);
  });

  it('leaves finished work out of the future entirely', () => {
    const acts = [
      makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-01-05', finishDate: '2026-02-27', originalDuration: 10, remainingDuration: 0, actualStart: true, actualFinish: true }),
      makeActivity({ activityId: '0-P2-TC-A10-FA-0020', startDate: '2026-09-01', finishDate: '2026-09-30', originalDuration: 10, remainingDuration: 10 }),
    ];
    const m = build(acts);
    const ahead = m.burn.forecastMonths.reduce((s, f) => s + f.earned, 0);
    expect(ahead).toBeCloseTo(m.burn.project.remainingHours, 6);
    expect(ahead).toBeLessThan(m.burn.project.budgetHours);
  });

  it('splits the remainder the same way the budget was split', () => {
    const acts = [makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-09-01', finishDate: '2026-09-30', originalDuration: 10, remainingDuration: 10 })];
    const m = build(acts);
    const sep = m.burn.forecastMonths.find((f) => f.month === '2026-09')!;
    const ats = sep.bySubsystem.find((c) => c.code === 'ATS')!;
    const ixl = sep.bySubsystem.find((c) => c.code === 'IXL')!;
    expect(ats.earned).toBeCloseTo(ixl.earned, 6);
    expect(ats.earned + ixl.earned).toBeCloseTo(sep.earned, 6);
  });

  it('still has somewhere to put late work when the schedule ends before the data date', () => {
    /*
     * Nothing in the curve's span is ahead of this data date, so there is no month
     * to spread into. The work left is not undated, though — it is late, which is
     * the case most worth seeing — so a month past the data date is added for it.
     */
    const rows = build([makeActivity({ activityId: 'A', startDate: '2026-09-01', finishDate: '2026-09-30', originalDuration: 10, remainingDuration: 10 })]).rows;
    const { periods } = buildCurve(rows, S.dataDate);
    const out = monthlyRemaining(rows, periods, '2099-12-31');
    expect(out.months).toHaveLength(1);
    expect(out.months[0].month).toBe('2100-01');
    expect(out.overdue).toBeGreaterThan(0);
    expect(out.unphased).toBe(0);
    expect(out.months[0].total).toBeCloseTo(out.overdue, 6);
  });
});

describe('what a future fiscal year costs', () => {
  const acts = [
    // Finished, so ATS has a rate to be judged by.
    makeActivity({ activityId: '0-P2-TC-A10-FA-0010', startDate: '2026-05-01', finishDate: '2026-05-29', originalDuration: 10, remainingDuration: 0, actualStart: true, actualFinish: true }),
    // FY27 (Jul 26 – Jun 27) and FY28 (Jul 27 – Jun 28).
    makeActivity({ activityId: '0-P2-TC-A10-FA-0020', startDate: '2026-09-01', finishDate: '2026-09-30', originalDuration: 10, remainingDuration: 10 }),
    makeActivity({ activityId: '0-P2-TC-A10-FA-0030', startDate: '2027-09-01', finishDate: '2027-09-30', originalDuration: 10, remainingDuration: 10 }),
  ];
  const m = build(acts);
  const ahead = forecastYears(m.burn.forecastMonths, 7);

  it('splits the work left on the fiscal boundary', () => {
    expect(ahead.map((y) => y.label)).toEqual(['FY27', 'FY28']);
  });

  it('loses none of the remaining budget between the years', () => {
    const placed = ahead.reduce((s, y) => s + y.earned, 0);
    expect(placed + m.burn.unphasedRemaining).toBeCloseTo(m.burn.project.remainingHours, 6);
  });

  it('breaks every year down by group, and every group down by month', () => {
    for (const y of ahead) {
      expect(y.resources.map((r) => r.code).sort()).toEqual(['ATS', 'IXL']);
      expect(y.resources.reduce((s, r) => s + r.earned, 0)).toBeCloseTo(y.earned, 6);
      for (const r of y.resources) {
        expect(r.months.reduce((s, x) => s + x.earned, 0)).toBeCloseTo(r.earned, 6);
      }
    }
  });

  it('costs the work at the rate the group actually achieved', () => {
    // ATS earned 40 h of budget for 80 h booked: a factor of 0.5, so its remaining
    // budget costs twice what it is worth.
    const ats = m.burn.bySubsystem.find((f) => f.code === 'ATS')!;
    expect(ats.factor).toBeCloseTo(0.5, 6);
    const fy27 = ahead.find((y) => y.label === 'FY27')!;
    const atsAhead = fy27.resources.find((r) => r.code === 'ATS')!;
    expect(atsAhead.built).toBeCloseTo(atsAhead.earned / 0.5, 6);
    expect(atsAhead.variance).toBeCloseTo(atsAhead.earned - atsAhead.built!, 6);
  });

  it('refuses to cost a group that has never booked an hour', () => {
    // IXL holds budget but no timesheet ever reached it. There is no rate, and a
    // number here would look exactly like a measured one.
    const fy27 = ahead.find((y) => y.label === 'FY27')!;
    const ixl = fy27.resources.find((r) => r.code === 'IXL')!;
    expect(ixl.earned).toBeGreaterThan(0);
    expect(ixl.built).toBeNull();
    expect(ixl.variance).toBeNull();
  });

  it('still totals the year from the groups that do have a rate', () => {
    const fy27 = ahead.find((y) => y.label === 'FY27')!;
    const costed = fy27.resources.filter((r) => r.built !== null);
    expect(costed.length).toBe(1);
    expect(fy27.built).toBeCloseTo(costed.reduce((s, r) => s + (r.built ?? 0), 0), 6);
  });

  it('shares add up to the year they are shares of', () => {
    for (const y of ahead) {
      expect(y.resources.reduce((s, r) => s + r.shareOfEarned, 0)).toBeCloseTo(1, 9);
    }
  });
});

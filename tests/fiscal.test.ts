/**
 * Fiscal years.
 *
 * The arithmetic is trivial; the convention is what has to be right. A year named
 * for the wrong end shifts every reported figure by twelve months, and it does it
 * quietly, so the boundary cases are pinned rather than assumed.
 */
import { describe, it, expect } from 'vitest';
import { fiscalYearOf, fiscalYearRange, fiscalYearLabel, fiscalYearSpan, fyStart, groupByFiscalYear, resourcesInYear, monthsForResource, resourceCodes, fiscalYearDetail } from '../src/engine/fiscal';
import type { BurnRow } from '../src/engine/types';

const row = (month: string, earned: number, built: number, cumEarned: number, cumBuilt: number): BurnRow => ({
  month,
  earned,
  built,
  variance: earned - built,
  cumEarned,
  cumBuilt,
  cumVariance: cumEarned - cumBuilt,
  factor: built ? earned / built : null,
  bySubsystem: [],
});

describe('which year a month belongs to', () => {
  it('names a July-start year for the calendar year it ends in', () => {
    // FY27 runs Jul 2026 to Jun 2027, the US federal and transit convention.
    expect(fiscalYearOf('2026-07', 7)).toBe(2027);
    expect(fiscalYearOf('2026-12', 7)).toBe(2027);
    expect(fiscalYearOf('2027-06', 7)).toBe(2027);
    expect(fiscalYearOf('2027-07', 7)).toBe(2028);
  });

  it('puts the month before the start in the previous year', () => {
    expect(fiscalYearOf('2026-06', 7)).toBe(2026);
  });

  it('makes a January start a plain calendar year', () => {
    expect(fiscalYearOf('2026-01', 1)).toBe(2026);
    expect(fiscalYearOf('2026-12', 1)).toBe(2026);
    expect(fiscalYearLabel(2026, 1)).toBe('2026');
  });

  it('handles an April start, which is the other common one', () => {
    expect(fiscalYearOf('2026-03', 4)).toBe(2026);
    expect(fiscalYearOf('2026-04', 4)).toBe(2027);
  });

  it('falls back to July when the setting is missing or nonsense', () => {
    expect(fyStart(undefined)).toBe(7);
    expect(fyStart(0)).toBe(7);
    expect(fyStart(13)).toBe(7);
    expect(fyStart(NaN)).toBe(7);
    expect(fyStart(4)).toBe(4);
  });
});

describe('the span a year covers', () => {
  it('runs from the start month to the month before it, a year later', () => {
    expect(fiscalYearRange(2027, 7)).toEqual({ from: '2026-07', to: '2027-06' });
    expect(fiscalYearRange(2026, 1)).toEqual({ from: '2026-01', to: '2026-12' });
    expect(fiscalYearRange(2027, 4)).toEqual({ from: '2026-04', to: '2027-03' });
  });

  it('labels itself so nobody has to remember the convention', () => {
    expect(fiscalYearLabel(2027, 7)).toBe('FY27');
    expect(fiscalYearSpan(2027, 7)).toBe('Jul 26 – Jun 27');
  });

  it('every month of a year maps back to that year', () => {
    const { from } = fiscalYearRange(2027, 7);
    let [y, m] = from.split('-').map(Number);
    for (let i = 0; i < 12; i += 1) {
      expect(fiscalYearOf(`${y}-${String(m).padStart(2, '0')}`, 7)).toBe(2027);
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }
  });
});

describe('grouping the monthly rows', () => {
  const months: BurnRow[] = [
    row('2026-05', 10, 20, 10, 20), // FY26
    row('2026-06', 10, 10, 20, 30), // FY26
    row('2026-07', 30, 20, 50, 50), // FY27
    row('2026-08', 40, 30, 90, 80), // FY27
  ];
  const years = groupByFiscalYear(months, 7);

  it('splits at the year boundary', () => {
    expect(years.map((y) => y.label)).toEqual(['FY26', 'FY27']);
    expect(years[0].months.map((m) => m.month)).toEqual(['2026-05', '2026-06']);
    expect(years[1].months.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
  });

  it('sums what happened INSIDE each year', () => {
    expect(years[0].earned).toBe(20);
    expect(years[0].built).toBe(30);
    expect(years[0].variance).toBe(-10);
    expect(years[1].earned).toBe(70);
    expect(years[1].built).toBe(50);
  });

  it('takes the cumulative figures from the last month rather than summing them', () => {
    // Adding running totals together would produce a number meaning nothing at all.
    expect(years[0].cumEarned).toBe(20);
    expect(years[1].cumEarned).toBe(90);
    expect(years[1].cumBuilt).toBe(80);
  });

  it('computes the factor over the year, not by averaging the months', () => {
    expect(years[1].factor).toBeCloseTo(70 / 50, 9);
    expect(years[0].factor).toBeCloseTo(20 / 30, 9);
  });

  it('reports no factor for a year that built nothing, rather than zero', () => {
    const quiet = groupByFiscalYear([row('2026-07', 5, 0, 5, 0)], 7);
    expect(quiet[0].factor).toBeNull();
  });

  it('loses no month and no hours', () => {
    expect(years.flatMap((y) => y.months)).toHaveLength(months.length);
    expect(years.reduce((s, y) => s + y.earned, 0)).toBe(months.reduce((s, m) => s + m.earned, 0));
    expect(years.reduce((s, y) => s + y.built, 0)).toBe(months.reduce((s, m) => s + m.built, 0));
  });

  it('comes back in chronological order whatever order it was given', () => {
    const shuffled = groupByFiscalYear([...months].reverse(), 7);
    expect(shuffled.map((y) => y.fy)).toEqual([2026, 2027]);
    expect(shuffled[0].months.map((m) => m.month)).toEqual(['2026-05', '2026-06']);
  });
});

describe('resources inside one year', () => {
  const withCells = (month: string, cells: { code: string; earned: number; built: number }[]): BurnRow => ({
    ...row(month, 0, 0, 0, 0),
    bySubsystem: cells.map((c) => ({ code: c.code, label: c.code || 'Unassigned', earned: c.earned, built: c.built, variance: c.earned - c.built, factor: c.built ? c.earned / c.built : null })),
  });
  const months = [
    withCells('2026-07', [{ code: 'ATS', earned: 30, built: 20 }, { code: 'IXL', earned: 10, built: 25 }]),
    withCells('2026-08', [{ code: 'ATS', earned: 20, built: 20 }, { code: 'IXL', earned: 5, built: 5 }]),
  ];
  const res = resourcesInYear(months);

  it('adds each resource up across the months of the year', () => {
    expect(res.find((r) => r.code === 'ATS')).toMatchObject({ earned: 50, built: 40, variance: 10 });
    expect(res.find((r) => r.code === 'IXL')).toMatchObject({ earned: 15, built: 30, variance: -15 });
  });

  it('computes the factor over the whole year, not by averaging months', () => {
    expect(res.find((r) => r.code === 'IXL')!.factor).toBeCloseTo(15 / 30, 9);
  });

  it('orders by what was earned, so the biggest contributor is first', () => {
    expect(res.map((r) => r.code)).toEqual(['ATS', 'IXL']);
  });

  it('shares add up to the whole year', () => {
    expect(res.reduce((s, r) => s + r.shareOfEarned, 0)).toBeCloseTo(1, 9);
  });

  it('drops a resource that neither earned nor spent anything', () => {
    const quiet = resourcesInYear([withCells('2026-07', [{ code: 'ATS', earned: 5, built: 0 }, { code: 'GONE', earned: 0, built: 0 }])]);
    expect(quiet.map((r) => r.code)).toEqual(['ATS']);
  });

  it('reports no factor for a resource that spent nothing', () => {
    const none = resourcesInYear([withCells('2026-07', [{ code: 'ATS', earned: 5, built: 0 }])]);
    expect(none[0].factor).toBeNull();
  });

  it('agrees with the year total it was taken from', () => {
    const [year] = groupByFiscalYear(months.map((m, i) => ({ ...m, earned: [40, 25][i], built: [45, 25][i] })), 7);
    expect(resourcesInYear(year.months).reduce((s, r) => s + r.earned, 0)).toBe(year.earned);
    expect(resourcesInYear(year.months).reduce((s, r) => s + r.built, 0)).toBe(year.built);
  });
});

/**
 * The by-group detail, which the screen and the exported workbook both read.
 *
 * The figures are the same ones `resourcesInYear` already reports; what is pinned
 * here is that cutting them the other way round — a group holding its months rather
 * than a month holding its groups — loses nothing and invents nothing.
 */
describe('a group, month by month', () => {
  const cell = (code: string, earned: number, built: number) => ({
    code,
    label: code || 'Unassigned',
    earned,
    built,
    variance: earned - built,
    factor: built ? earned / built : null,
  });
  const withCells = (month: string, cells: ReturnType<typeof cell>[]): BurnRow => ({ ...row(month, 0, 0, 0, 0), bySubsystem: cells });
  const months = [
    withCells('2026-06', [cell('ATS', 10, 12), cell('IXL', 4, 4)]),
    withCells('2026-07', [cell('ATS', 30, 20), cell('IXL', 10, 25)]),
    withCells('2026-08', [cell('ATS', 20, 20)]),
    withCells('2026-09', [cell('ATS', 0, 0), cell('IXL', 6, 3)]),
  ];

  it('gives a group only the months it appears in, in order', () => {
    expect(monthsForResource(months, 'IXL').map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-09']);
  });

  it('drops a month where a group did nothing, rather than reporting a zero it did not report', () => {
    // ATS is listed in 2026-09 carrying nothing at all. A row of zeros in a group's
    // own timeline reads as "we worked and earned nothing", which is not what happened.
    expect(monthsForResource(months, 'ATS').map((m) => m.month)).toEqual(['2026-06', '2026-07', '2026-08']);
  });

  it('adds back to what the year says that group earned', () => {
    const [year] = groupByFiscalYear(months.filter((m) => m.month >= '2026-07'), 7);
    const ats = resourcesInYear(year.months).find((r) => r.code === 'ATS')!;
    const byMonth = monthsForResource(year.months, 'ATS');
    expect(byMonth.reduce((s, m) => s + m.earned, 0)).toBe(ats.earned);
    expect(byMonth.reduce((s, m) => s + m.built, 0)).toBe(ats.built);
  });

  it('lists every group that appears anywhere, biggest first', () => {
    expect(resourceCodes(months).map((r) => r.code)).toEqual(['ATS', 'IXL']);
  });

  it('carries an unnamed group as Unassigned rather than losing it', () => {
    const codes = resourceCodes([withCells('2026-07', [cell('', 5, 5)])]);
    expect(codes).toEqual([{ code: '', label: 'Unassigned' }]);
  });
});

describe('the fiscal year detail the screen and the workbook share', () => {
  const cell = (code: string, earned: number, built: number) => ({
    code,
    label: code || 'Unassigned',
    earned,
    built,
    variance: earned - built,
    factor: built ? earned / built : null,
  });
  const months: BurnRow[] = [
    { ...row('2026-06', 14, 16, 14, 16), bySubsystem: [cell('ATS', 10, 12), cell('IXL', 4, 4)] },
    { ...row('2026-07', 40, 45, 54, 61), bySubsystem: [cell('ATS', 30, 20), cell('IXL', 10, 25)] },
    { ...row('2026-08', 20, 20, 74, 81), bySubsystem: [cell('ATS', 20, 20)] },
  ];
  const detail = fiscalYearDetail(months, 7);

  it('splits on the fiscal boundary and keeps every year', () => {
    expect(detail.map((y) => y.fy)).toEqual([2026, 2027]);
  });

  it('breaks each year down by group, and each group down by month', () => {
    const fy27 = detail.find((y) => y.fy === 2027)!;
    expect(fy27.resources.map((r) => r.code)).toEqual(['ATS', 'IXL']);
    expect(fy27.resources.find((r) => r.code === 'ATS')!.months.map((m) => m.month)).toEqual(['2026-07', '2026-08']);
    // June belongs to FY26 and must not leak into the FY27 group detail.
    expect(fy27.resources.find((r) => r.code === 'IXL')!.months.map((m) => m.month)).toEqual(['2026-07']);
  });

  it('keeps the group rows adding back to the year they sit under', () => {
    for (const y of detail) {
      expect(y.resources.reduce((s, r) => s + r.earned, 0)).toBeCloseTo(y.months.reduce((s, m) => s + m.bySubsystem.reduce((t, c) => t + c.earned, 0), 0), 9);
      expect(y.resources.reduce((s, r) => s + r.built, 0)).toBeCloseTo(y.months.reduce((s, m) => s + m.bySubsystem.reduce((t, c) => t + c.built, 0), 0), 9);
    }
  });

  it('carries the year totals through untouched, cumulatives included', () => {
    const fy27 = detail.find((y) => y.fy === 2027)!;
    expect(fy27.earned).toBe(60);
    expect(fy27.built).toBe(65);
    // Taken from the last month, never summed: these are already running totals.
    expect(fy27.cumEarned).toBe(74);
    expect(fy27.cumBuilt).toBe(81);
  });
});

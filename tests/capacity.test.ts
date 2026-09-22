/**
 * What the work ahead asks for, against what there is to give.
 *
 * The forecast is a cost. Capacity turns it into a staffing answer, and the one
 * thing it must never do is invent the fact it depends on: how many people are in
 * the group. "Nobody has said" and "nobody is available" are different claims.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_CAPACITY, capacityByFiscalYear, capacityByMonth, peopleIn, type Headcount } from '../src/engine/capacity';
import type { ForecastRow } from '../src/engine/types';

const cell = (code: string, earned: number, built: number | null) => ({ code, label: code || 'Unassigned', earned, built });
const month = (m: string, cells: ReturnType<typeof cell>[]): ForecastRow => ({
  month: m,
  periodEnd: `${m}-28`,
  earned: cells.reduce((s, c) => s + c.earned, 0),
  built: cells.reduce((s, c) => s + (c.built ?? 0), 0),
  bySubsystem: cells,
});

const hc = (subsystem: string, people: number, from?: string): Headcount => ({ id: `${subsystem}${from ?? ''}`, subsystem, people, from });
/** 160 h × 0.8 = 128 h a person a month. */
const cap = DEFAULT_CAPACITY;
const PER_PERSON = 128;

describe('the headcount in force', () => {
  const rows = [hc('ATS', 2), hc('ATS', 4, '2027-04'), hc('IXL', 1, '2027-01')];

  it('takes the latest row on or before the month', () => {
    expect(peopleIn('2027-03', 'ATS', rows)).toBe(2);
    expect(peopleIn('2027-04', 'ATS', rows)).toBe(4);
    expect(peopleIn('2028-01', 'ATS', rows)).toBe(4);
  });

  it('is nothing at all before the first row that has a date', () => {
    // Not zero. Nobody has said what IXL was in 2026, and zero would read as a
    // claim that it had no people.
    expect(peopleIn('2026-12', 'IXL', rows)).toBeNull();
    expect(peopleIn('2027-01', 'IXL', rows)).toBe(1);
  });

  it('is nothing for a group nobody keyed', () => {
    expect(peopleIn('2027-01', 'POWER', rows)).toBeNull();
  });
});

describe('demand against supply', () => {
  const forecast = [
    month('2027-01', [cell('ATS', 100, 200), cell('IXL', 50, null)]),
    month('2027-02', [cell('ATS', 100, 200)]),
  ];

  it('takes demand from the forecast COST, not the budget', () => {
    // ATS converts at 0.5, so 100 hours of budget takes 200 hours to earn. Staffing
    // against the budget would under-staff the group by half.
    const [jan] = capacityByMonth(forecast, [hc('ATS', 2)], [], cap);
    expect(jan.rows.find((r) => r.code === 'ATS')!.demandHours).toBe(200);
  });

  it('falls back to the budget where a group has no rate to cost with', () => {
    const [jan] = capacityByMonth(forecast, [hc('IXL', 1)], [], cap);
    expect(jan.rows.find((r) => r.code === 'IXL')!.demandHours).toBe(50);
  });

  it('turns headcount into hours at the keyed rate', () => {
    const [jan] = capacityByMonth(forecast, [hc('ATS', 2)], [], cap);
    const ats = jan.rows.find((r) => r.code === 'ATS')!;
    expect(ats.supplyHours).toBe(2 * PER_PERSON);
    expect(ats.gapHours).toBe(2 * PER_PERSON - 200);
    expect(ats.loadFactor).toBeCloseTo(200 / (2 * PER_PERSON), 9);
  });

  it('reports demand and no verdict for a group nobody staffed', () => {
    const [jan] = capacityByMonth(forecast, [], [], cap);
    const ats = jan.rows.find((r) => r.code === 'ATS')!;
    expect(ats.demandHours).toBe(200);
    expect(ats.supplyHours).toBeNull();
    expect(ats.gapHours).toBeNull();
    expect(ats.loadFactor).toBeNull();
    // And the period as a whole says nothing rather than claiming a shortfall.
    expect(jan.supplyHours).toBeNull();
    expect(jan.gapHours).toBeNull();
  });

  it('totals supply only over the groups that have it', () => {
    const [jan] = capacityByMonth(forecast, [hc('ATS', 2)], [], cap);
    expect(jan.demandHours).toBe(250);
    expect(jan.supplyHours).toBe(2 * PER_PERSON);
  });

  it('respects utilisation, which is where leave and other jobs live', () => {
    const [jan] = capacityByMonth(forecast, [hc('ATS', 1)], [], { hoursPerPersonPerMonth: 160, utilisation: 0.5 });
    expect(jan.rows.find((r) => r.code === 'ATS')!.supplyHours).toBe(80);
  });
});

describe('rolled into fiscal years', () => {
  const forecast = [
    month('2026-08', [cell('ATS', 100, 100)]),
    month('2026-09', [cell('ATS', 100, 100)]),
    month('2027-08', [cell('ATS', 100, 100)]),
  ];

  it('splits on the fiscal boundary and adds the months inside each year', () => {
    const years = capacityByFiscalYear(forecast, [hc('ATS', 1)], [], cap, 7);
    expect(years.map((y) => y.label)).toEqual(['FY27', 'FY28']);
    expect(years[0].demandHours).toBe(200);
    expect(years[0].supplyHours).toBe(2 * PER_PERSON);
    expect(years[1].demandHours).toBe(100);
    expect(years[1].supplyHours).toBe(PER_PERSON);
  });

  it('adds supply only for the months that had a headcount', () => {
    // Nobody staffed ATS until Sep, so FY27's supply is one month's worth, not two.
    const years = capacityByFiscalYear(forecast, [hc('ATS', 1, '2026-09')], [], cap, 7);
    expect(years[0].demandHours).toBe(200);
    expect(years[0].supplyHours).toBe(PER_PERSON);
    expect(years[0].gapHours).toBe(PER_PERSON - 200);
  });

  it('counts the months a group has work in, so people-needed is a rate not a total', () => {
    const years = capacityByFiscalYear(forecast, [hc('ATS', 1)], [], cap, 7);
    expect(years[0].rows[0].months).toBe(2);
  });
});

/**
 * What the work ahead asks for, against what there is to give.
 *
 * The forecast says IXL needs 2,974 hours in FY27. On its own that is a cost. The
 * question anybody staffing a programme actually has is whether IXL *can* do 2,974
 * hours in FY27, and that needs one more fact the app cannot derive: how many
 * people are in the group.
 *
 * So headcount is keyed, per group, optionally from a date. Everything else here is
 * arithmetic on it. A group with no headcount keyed reports demand and no verdict,
 * because "0 available" and "nobody has said" are different claims and only one of
 * them is true.
 */
import type { ForecastRow, Subsystem } from './types';
import { normKey } from './keys';
import { fiscalYearLabel, fiscalYearOf, fiscalYearRange, fiscalYearSpan, fyStart } from './fiscal';

/**
 * How many people a group has, from a date.
 *
 * `from` lets a ramp be described without inventing a scheduling language: two
 * engineers now, four from April, is two rows. The latest row on or before a month
 * is the one in force for it.
 */
export type Headcount = {
  id: string;
  /** The resource group code. '' is Unassigned, which can be staffed like any other. */
  subsystem: string;
  /** People in the group. Fractional is allowed: half a person is a real thing. */
  people: number;
  /** `YYYY-MM` this count takes effect. Absent means it always has. */
  from?: string;
  note?: string;
};

/** Hours one person is available for in a month, before any allowance. */
export type CapacitySettings = {
  /** Working hours per person per month. 160 is a 40-hour week averaged over a year. */
  hoursPerPersonPerMonth: number;
  /**
   * The share of those hours that reaches this project, 0 to 1. Leave, training,
   * other jobs and everything else nobody bills to a test activity lives here.
   */
  utilisation: number;
};

export const DEFAULT_CAPACITY: CapacitySettings = { hoursPerPersonPerMonth: 160, utilisation: 0.8 };

/** The headcount in force for a group in a given month, or null if none is keyed. */
export function peopleIn(month: string, subsystem: string, headcounts: Headcount[]): number | null {
  const mine = headcounts
    .filter((h) => normKey(h.subsystem) === normKey(subsystem) && Number.isFinite(h.people))
    .filter((h) => !h.from || h.from <= month)
    .sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
  const last = mine[mine.length - 1];
  return last ? last.people : null;
}

/** One group's demand and supply over a span. */
export type CapacityRow = {
  code: string;
  label: string;
  /** Hours of work the schedule wants done, at the rate this group achieves. */
  demandHours: number;
  /** Hours the keyed headcount can supply. null when nobody has said. */
  supplyHours: number | null;
  /** Supply minus demand. Negative is short. null when there is no supply figure. */
  gapHours: number | null;
  /** Demand as a share of supply. Over 1 is oversubscribed. */
  loadFactor: number | null;
  /** People keyed for the last month of the span, for the row to say what it assumed. */
  people: number | null;
  /** Months in the span this group has work in. */
  months: number;
};

export type CapacityPeriod = {
  /** `YYYY-MM` for a month, or a fiscal year label. */
  key: string;
  label: string;
  span: string;
  rows: CapacityRow[];
  demandHours: number;
  supplyHours: number | null;
  gapHours: number | null;
};

/**
 * Lay the forecast against the headcount, month by month.
 *
 * Demand is the FORECAST COST, not the budget: what the work will take at the rate
 * the group actually achieves. Comparing budget to capacity would answer a question
 * nobody has — the budget is what the work is worth, and a group converting at 0.7
 * needs half again as many hours as it is worth. Where a group has no rate yet the
 * budget is used and the row says so by carrying the same figure for both.
 */
export function capacityByMonth(
  forecast: ForecastRow[],
  headcounts: Headcount[],
  subsystems: Subsystem[],
  cap: CapacitySettings,
): CapacityPeriod[] {
  const label = (code: string) => {
    const named = subsystems.find((s) => normKey(s.code) === normKey(code));
    return code === '' ? 'Unassigned' : named?.name ? `${code} — ${named.name}` : code;
  };
  const perPerson = Math.max(0, cap.hoursPerPersonPerMonth) * Math.max(0, Math.min(1, cap.utilisation));

  return forecast.map((m) => {
    const rows: CapacityRow[] = m.bySubsystem
      .map((c) => {
        // The cost where there is a rate to cost it with, the budget where there is
        // not. Never zero: an unrated group still needs people.
        const demandHours = c.built ?? c.earned;
        const people = peopleIn(m.month, c.code, headcounts);
        const supplyHours = people === null ? null : people * perPerson;
        return {
          code: c.code,
          label: label(c.code),
          demandHours,
          supplyHours,
          gapHours: supplyHours === null ? null : supplyHours - demandHours,
          loadFactor: supplyHours && supplyHours > 0 ? demandHours / supplyHours : null,
          people,
          months: 1,
        };
      })
      .filter((r) => Math.abs(r.demandHours) > 1e-9)
      .sort((a, b) => b.demandHours - a.demandHours || a.label.localeCompare(b.label));

    const supplied = rows.filter((r) => r.supplyHours !== null);
    const demandHours = rows.reduce((s, r) => s + r.demandHours, 0);
    const supplyHours = supplied.length ? supplied.reduce((s, r) => s + (r.supplyHours ?? 0), 0) : null;
    return {
      key: m.month,
      label: m.month,
      span: m.month,
      rows,
      demandHours,
      supplyHours,
      gapHours: supplyHours === null ? null : supplyHours - demandHours,
    };
  });
}

/** The same, rolled into fiscal years, which is how staffing is actually funded. */
export function capacityByFiscalYear(
  forecast: ForecastRow[],
  headcounts: Headcount[],
  subsystems: Subsystem[],
  cap: CapacitySettings,
  startMonth: number,
): CapacityPeriod[] {
  const start = fyStart(startMonth);
  const months = capacityByMonth(forecast, headcounts, subsystems, cap);
  const buckets = new Map<number, CapacityPeriod[]>();
  for (const m of months) {
    const fy = fiscalYearOf(m.key, start);
    if (!Number.isFinite(fy)) continue;
    const list = buckets.get(fy);
    if (list) list.push(m);
    else buckets.set(fy, [m]);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([fy, list]) => {
      const acc = new Map<string, CapacityRow>();
      for (const m of list) {
        for (const r of m.rows) {
          const prev = acc.get(r.code);
          if (!prev) {
            acc.set(r.code, { ...r });
            continue;
          }
          prev.demandHours += r.demandHours;
          // Supply adds only where it exists. A year with a headcount in some months
          // and none in others reports what it knows, not a total padded with zeros.
          if (r.supplyHours !== null) prev.supplyHours = (prev.supplyHours ?? 0) + r.supplyHours;
          prev.people = r.people ?? prev.people;
          prev.months += 1;
        }
      }
      const rows = [...acc.values()]
        .map((r) => ({
          ...r,
          gapHours: r.supplyHours === null ? null : r.supplyHours - r.demandHours,
          loadFactor: r.supplyHours && r.supplyHours > 0 ? r.demandHours / r.supplyHours : null,
        }))
        .sort((a, b) => b.demandHours - a.demandHours || a.label.localeCompare(b.label));

      const supplied = rows.filter((r) => r.supplyHours !== null);
      const demandHours = rows.reduce((s, r) => s + r.demandHours, 0);
      const supplyHours = supplied.length ? supplied.reduce((s, r) => s + (r.supplyHours ?? 0), 0) : null;
      const range = fiscalYearRange(fy, start);
      return {
        key: String(fy),
        label: fiscalYearLabel(fy, start),
        span: fiscalYearSpan(fy, start),
        rows,
        demandHours,
        supplyHours,
        gapHours: supplyHours === null ? null : supplyHours - demandHours,
        from: range.from,
        to: range.to,
      };
    });
}

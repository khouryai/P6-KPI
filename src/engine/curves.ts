import { isoToMs } from './dates';

/**
 * Even calendar-linear spread of a quantity across a window, evaluated at a period end.
 *
 * Same-day windows credit in full on that day. This deliberately differs from the
 * workbook's SUMPRODUCT, which credits a same-day activity only from the following
 * period (its denominator is forced to one day). The build prompt requires the
 * same-day rule, and it is the intended behaviour; see docs/DESIGN.md.
 *
 * The spread ignores the P6 work calendar. An activity spanning a holiday shutdown
 * accrues straight through it. This is a known limitation, surfaced in the UI.
 */
export function accruedFraction(
  periodEnd: string,
  windowStart: string | null,
  windowEnd: string | null,
): number {
  if (!windowStart || !windowEnd) return 0;
  if (periodEnd < windowStart) return 0;
  if (windowEnd <= windowStart) return periodEnd >= windowEnd ? 1 : 0;
  const p = isoToMs(periodEnd);
  const s = isoToMs(windowStart);
  const e = isoToMs(windowEnd);
  return Math.min(1, (p - s) / (e - s));
}

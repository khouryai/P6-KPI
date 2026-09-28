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
  return accruedAt(isoToMs(periodEnd), prepWindow(windowStart, windowEnd));
}

/**
 * A window with both ends already parsed.
 *
 * The curve and the burn grid both accrue every row across every period, so the
 * string form above parses the same handful of dates tens of thousands of times:
 * 675 activities over 21 periods is 42,525 calls, each splitting three strings.
 * That was three quarters of the cost of building the model. Parsed once per row
 * and once per period end, the inner loop is arithmetic.
 */
export type AccrualWindow = { s: number; e: number } | null;

export function prepWindow(windowStart: string | null, windowEnd: string | null): AccrualWindow {
  if (!windowStart || !windowEnd) return null;
  const s = isoToMs(windowStart);
  const e = isoToMs(windowEnd);
  // A date the parser could not read arrives as null, so this is belt and braces:
  // a NaN would otherwise propagate silently into every total on the screen.
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return { s, e };
}

export function accruedAt(periodEndMs: number, w: AccrualWindow): number {
  if (!w) return 0;
  if (periodEndMs < w.s) return 0;
  if (w.e <= w.s) return periodEndMs >= w.e ? 1 : 0;
  const f = (periodEndMs - w.s) / (w.e - w.s);
  return f > 1 ? 1 : f;
}

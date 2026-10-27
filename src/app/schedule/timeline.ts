/**
 * The Gantt's time axis: where a date falls in pixels, and the ticks along the top.
 *
 * Dates are the XER's own wall-clock times read as UTC (see `parseXerDate`), so a
 * day here is always exactly 24 hours and no time zone can move a bar.
 */

export type Zoom = 'week' | 'month' | 'quarter' | 'year';

export const ZOOMS: { key: Zoom; label: string }[] = [
  { key: 'week', label: 'Weeks' },
  { key: 'month', label: 'Months' },
  { key: 'quarter', label: 'Quarters' },
  { key: 'year', label: 'Years' },
];

/** Pixels per day at each zoom. */
export const PX_PER_DAY: Record<Zoom, number> = { week: 16, month: 3.6, quarter: 1.3, year: 0.42 };

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type Scale = {
  from: number;
  to: number;
  pxPerDay: number;
  width: number;
  x: (ms: number) => number;
  /** The date at a pixel, for reading the pointer. */
  at: (px: number) => number;
};

/**
 * A scale covering `min` to `max`, padded so the first bar does not sit on the edge
 * and a milestone at the end has room for its diamond. Snapped to month starts so
 * the ticks begin on a boundary.
 */
export function makeScale(min: number, max: number, zoom: Zoom): Scale {
  const lo = new Date(min - 14 * DAY);
  const from = Date.UTC(lo.getUTCFullYear(), lo.getUTCMonth(), 1);
  const hi = new Date(Math.max(max, min) + 45 * DAY);
  const to = Date.UTC(hi.getUTCFullYear(), hi.getUTCMonth() + 1, 1);
  const pxPerDay = PX_PER_DAY[zoom];
  const width = Math.ceil(((to - from) / DAY) * pxPerDay);
  return { from, to, pxPerDay, width, x: (ms) => ((ms - from) / DAY) * pxPerDay, at: (px) => from + (px / pxPerDay) * DAY };
}

export type Tick = { x: number; w: number; label: string };

/**
 * Two tiers of ticks for the part of the axis in view (plus a margin), so a
 * ten-year programme at week zoom does not draw five hundred labels nobody sees.
 */
export function ticksFor(scale: Scale, zoom: Zoom, viewFrom: number, viewTo: number): { top: Tick[]; bottom: Tick[] } {
  const pad = 400 / scale.pxPerDay;
  const from = Math.max(scale.from, viewFrom - pad * DAY);
  const to = Math.min(scale.to, viewTo + pad * DAY);
  const top: Tick[] = [];
  const bottom: Tick[] = [];
  const span = (a: number, b: number, label: string, into: Tick[]) => into.push({ x: scale.x(a), w: scale.x(b) - scale.x(a), label });

  const start = new Date(from);
  if (zoom === 'week') {
    // Months on top, weeks (from each Monday) beneath.
    for (let m = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1); m < to; ) {
      const d = new Date(m);
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      span(m, next, `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, top);
      m = next;
    }
    const dow = new Date(from).getUTCDay();
    let w = Math.floor(from / DAY) * DAY - ((dow + 6) % 7) * DAY;
    for (; w < to; w += 7 * DAY) span(w, w + 7 * DAY, String(new Date(w).getUTCDate()), bottom);
  } else if (zoom === 'month') {
    for (let y = start.getUTCFullYear(); Date.UTC(y, 0, 1) < to; y++) span(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), String(y), top);
    for (let m = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1); m < to; ) {
      const d = new Date(m);
      const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      span(m, next, MONTHS[d.getUTCMonth()].slice(0, 3), bottom);
      m = next;
    }
  } else if (zoom === 'quarter') {
    for (let y = start.getUTCFullYear(); Date.UTC(y, 0, 1) < to; y++) {
      span(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), String(y), top);
      for (let q = 0; q < 4; q++) span(Date.UTC(y, q * 3, 1), Date.UTC(y, q * 3 + 3, 1), `Q${q + 1}`, bottom);
    }
  } else {
    for (let y = start.getUTCFullYear(); Date.UTC(y, 0, 1) < to; y++) span(Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1), String(y), bottom);
  }
  return { top, bottom };
}

/** A date for a tooltip: 14-Sep-26. */
export function fmtMs(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}-${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

/** A date and time, for the activity panel where the hour matters: 14-Sep-26 08:00. */
export function fmtMsTime(ms: number | null): string {
  if (ms === null) return '';
  const d = new Date(ms);
  return `${fmtMs(ms)} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

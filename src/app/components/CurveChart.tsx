import { forwardRef } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { CurvePoint } from '../../engine/types';
import { fmtHours, fmtPct, fmtDate } from '../format';

/**
 * Chart colors stay literal hex rather than var(--…): SVG attributes rendered by
 * Recharts resolve fine, but the PNG export rasterises through a detached SVG
 * where custom properties are not inherited. These are the cx-portal COLORS
 * values, so the curves match the portal's charts.
 */
const INK = '#1a1a1a';
const AMBER = '#d97706';
const GOOD = '#00875a';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

type TipItem = { name?: string; value?: unknown; color?: string; dataKey?: string };

function CurveTooltip({ active, payload, percent }: { active?: boolean; payload?: TipItem[]; percent?: boolean }) {
  if (!active || !payload?.length) return null;
  const point = (payload[0] as TipItem & { payload?: { periodEnd?: string } }).payload;
  const items = payload.filter((p) => p.dataKey !== 'label' && typeof p.value === 'number');
  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid #e4e7ec',
        borderRadius: 8,
        boxShadow: '0 1px 2px rgba(15,17,21,0.04), 0 6px 16px -8px rgba(15,17,21,0.14)',
        padding: '9px 12px',
        fontSize: 12,
      }}
    >
      <div
        style={{
          fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
          fontSize: 9.5,
          fontWeight: 600,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: '#697280',
          marginBottom: 5,
        }}
      >
        Period end {fmtDate(point?.periodEnd)}
      </div>
      {items.map((p) => (
        <div key={String(p.dataKey)} style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1.6 }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: p.color, display: 'inline-block' }} />
          <span style={{ color: '#6e7179' }}>{p.name}</span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>
            {percent ? fmtPct(p.value as number, 1) : `${fmtHours(p.value as number, 1)} h`}
          </span>
        </div>
      ))}
    </div>
  );
}

export const CurveChart = forwardRef<
  HTMLDivElement,
  {
    curve: CurvePoint[];
    dataDate: string | null;
    height?: number;
    /**
     * Draw the curves as percent complete rather than man hours. Every series is
     * divided by the SAME total, so the shapes are identical and only the axis
     * changes — a percent curve that disagreed in shape with the hours curve would
     * mean one of them was lying.
     */
    percent?: boolean;
    /** The divisor for percent mode: the whole budget these curves are drawn from. */
    total?: number;
    /** Month-end periods label as YYYY-MM; anything finer needs the day. */
    monthly?: boolean;
  }
>(function CurveChart({ curve, dataDate, height = 380, percent = false, total = 0, monthly = true }, ref) {
  const scale = percent && total > 0 ? (v: number | null) => (v === null ? null : v / total) : (v: number | null) => v;
  /*
   * The tick is the period end itself, not the month it falls in.
   *
   * A month label was fine while every period WAS a month end. On a fortnightly
   * curve two periods share a month, so a month label puts two points on one tick
   * and — worse — the DATA DATE marker, which is matched against this label, lands
   * on whichever of them Recharts drew last rather than on the data date. The full
   * date is unambiguous, and the axis formats it short.
   */
  const data = curve.map((c) => ({
    ...c,
    planned: scale(c.planned),
    forecast: scale(c.forecast),
    earned: scale(c.earned),
    label: c.periodEnd,
  }));
  /*
   * The marker sits on a period the axis actually has. With the curve anchored on
   * the data date that is the data date itself; where it is not — a curve still on
   * month ends, or a data date outside the schedule — the last period at or before
   * it is the honest place for the line, rather than no line at all.
   */
  const marker = dataDate
    ? (curve.filter((c) => c.periodEnd <= dataDate).pop()?.periodEnd ?? null)
    : null;
  const axisTick = { fontSize: 10.5, fill: AXIS, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace" };
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* The top margin is the DATA DATE label's room: at 8 it was cropped by the frame. */}
        <ComposedChart data={data} margin={{ top: 20, right: 44, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval="preserveStartEnd"
            minTickGap={28}
            tickFormatter={(v: string) => (monthly ? v.slice(0, 7) : fmtDate(v))}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => (percent ? fmtPct(v, 0) : fmtHours(v))}
            width={54}
            domain={percent ? [0, (max: number) => Math.max(1, max)] : undefined}
          />
          <Tooltip content={<CurveTooltip percent={percent} />} cursor={{ stroke: '#cfd5df', strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
          {marker && (
            <ReferenceLine
              x={marker}
              stroke="#cfd5df"
              strokeDasharray="4 4"
              /* The date itself, not just the words. On a printed page or a PNG
                 pasted into a mail nobody can hover the line to find out when the
                 schedule was measured, and "as at when?" is the first question
                 anybody asks of an S-curve. */
              label={{ value: `DATA DATE ${fmtDate(dataDate)}`, position: 'top', fontSize: 9.5, fill: AXIS, letterSpacing: '0.08em' }}
            />
          )}
          <Line type="monotone" dataKey="planned" legendType="plainline" name="Planned (baseline)" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" legendType="plainline" name="Forecast (current)" stroke={AMBER} strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />
          <Line type="monotone" dataKey="earned" legendType="plainline" name="Earned (actual dates)" stroke={GOOD} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

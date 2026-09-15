import { forwardRef } from 'react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { CurvePoint } from '../../engine/types';
import { fmtHours, fmtDate } from '../format';

/**
 * Chart colors stay literal hex rather than var(--…): SVG attributes rendered by
 * Recharts resolve fine, but the PNG export rasterises through a detached SVG
 * where custom properties are not inherited. These are the cx-portal COLORS
 * values, so the curves match the portal's charts.
 */
const INK = '#1a1a1a';
const BRAND = '#e60012';
const AMBER = '#d97706';
const GOOD = '#00875a';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

type TipItem = { name?: string; value?: unknown; color?: string; dataKey?: string };

function CurveTooltip({ active, payload }: { active?: boolean; payload?: TipItem[] }) {
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
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(p.value as number, 1)} h</span>
        </div>
      ))}
    </div>
  );
}

export const CurveChart = forwardRef<HTMLDivElement, { curve: CurvePoint[]; dataDate: string | null; height?: number }>(function CurveChart(
  { curve, dataDate, height = 380 },
  ref,
) {
  const data = curve.map((c) => ({ ...c, label: c.periodEnd.slice(0, 7) }));
  const axisTick = { fontSize: 10.5, fill: AXIS, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace" };
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {/* The top margin is the DATA DATE label's room: at 8 it was cropped by the frame. */}
        <ComposedChart data={data} margin={{ top: 18, right: 16, left: 8, bottom: 0 }}>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={axisTick} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => fmtHours(v)}
            width={54}
          />
          <Tooltip content={<CurveTooltip />} cursor={{ stroke: '#cfd5df', strokeDasharray: '3 3' }} />
          <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
          {dataDate && (
            <ReferenceLine
              x={dataDate.slice(0, 7)}
              stroke="#cfd5df"
              strokeDasharray="4 4"
              label={{ value: 'DATA DATE', position: 'top', fontSize: 9.5, fill: AXIS, letterSpacing: '0.1em' }}
            />
          )}
          <Line type="monotone" dataKey="planned" legendType="plainline" name="Planned (baseline)" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" legendType="plainline" name="Forecast (current)" stroke={AMBER} strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />
          <Line type="monotone" dataKey="earned" legendType="plainline" name="Earned (actual dates)" stroke={GOOD} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          <Scatter dataKey="snapshot" name="Snapshot (status date)" fill={BRAND} shape="diamond" legendType="diamond" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

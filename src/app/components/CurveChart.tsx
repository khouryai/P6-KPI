import { forwardRef } from 'react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import type { CurvePoint } from '../../engine/types';
import { fmtHours, fmtDate } from '../format';

type TipItem = { name?: string; value?: unknown; color?: string; dataKey?: string };
function CurveTooltip({ active, payload }: { active?: boolean; payload?: TipItem[] }) {
  if (!active || !payload?.length) return null;
  const point = (payload[0] as TipItem & { payload?: { periodEnd?: string } }).payload;
  const items = payload.filter((p) => p.dataKey !== 'label' && typeof p.value === 'number');
  return (
    <div className="rounded border border-slate-300 bg-white px-3 py-2 text-[12px] shadow">
      <div className="mb-1 font-semibold">Period end {fmtDate(point?.periodEnd)}</div>
      {items.map((p) => (
        <div key={String(p.dataKey)} style={{ color: p.color }}>
          {p.name}: {fmtHours(p.value as number, 1)} h
        </div>
      ))}
    </div>
  );
}

export const CurveChart = forwardRef<HTMLDivElement, { curve: CurvePoint[]; dataDate: string | null; height?: number }>(function CurveChart({ curve, dataDate, height = 380 }, ref) {
  const data = curve.map((c) => ({ ...c, label: c.periodEnd.slice(0, 7) }));
  return (
    <div ref={ref} className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => fmtHours(v)} width={64} label={{ value: 'Cumulative man hours', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#64748b' } }} />
          <Tooltip content={<CurveTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {dataDate && <ReferenceLine x={dataDate.slice(0, 7)} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: 'Data date', position: 'top', fontSize: 11, fill: '#64748b' }} />}
          <Line type="monotone" dataKey="planned" name="Planned (baseline)" stroke="#1e3a5f" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="forecast" name="Forecast (current)" stroke="#f59e0b" strokeWidth={2} dot={false} strokeDasharray="6 3" isAnimationActive={false} />
          <Line type="monotone" dataKey="earned" name="Earned (actual dates)" stroke="#059669" strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false} />
          <Scatter dataKey="snapshot" name="Snapshot (status date)" fill="#dc2626" shape="diamond" legendType="diamond" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

/**
 * P6's resource loading: who is assigned to what, how many hours, and when.
 *
 * P6 here carries planned units only — nobody books actuals into it — so this is
 * the plan's own view of the people it needs. Against it sits the T&C budget the
 * rate library produces, by activity type, because the two were built separately
 * and a type where they disagree by half is worth a look.
 */
import { useMemo, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { monthlyLoading, resourceSummaries, type ResourceSummary } from '../../engine/xerLogic';
import { normKey } from '../../engine/keys';
import { SortableTable, type Column } from '../components/ui';
import { fmtHours } from '../format';
import type { ScheduleCtx } from './context';
import { fmtMs } from './timeline';

const BLUE = '#1d4eaf';
const INK = '#1a1a1a';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

const h = (n: number) => fmtHours(n, 0);

export function ResourcesView({ ctx }: { ctx: ScheduleCtx }) {
  const { model, tasks, inScope } = ctx;
  const summaries = useMemo(() => resourceSummaries(model, tasks, inScope), [model, tasks, inScope]);
  const [picked, setPicked] = useState<string | null>(null);
  const [scope, setScope] = useState<'in' | 'all'>('in');
  const isLabour = (s: ResourceSummary) => s.type === 'Labor' || s.type === '';
  // Start on whoever carries the most T&C work, since that is the question asked most.
  const chosen = picked ?? (summaries.filter(isLabour).sort((a, b) => b.scopeBudget - a.scopeBudget)[0] ?? summaries.find(isLabour))?.uid ?? null;
  const chosenRow = summaries.find((s) => s.uid === chosen) ?? null;
  const taskUids = useMemo(() => new Set((scope === 'in' ? tasks.filter(inScope) : tasks).map((t) => t.uid)), [scope, tasks, inScope]);
  const loading = useMemo(() => monthlyLoading(model, taskUids, chosen), [model, taskUids, chosen]);
  const chart = loading.map((b) => ({ label: b.label, budget: Math.round(b.budget), remaining: Math.round(b.remaining) }));
  const dataMonth = ctx.dataDate !== null ? new Date(ctx.dataDate).toISOString().slice(0, 7) : null;

  // P6's planned labour against the budget, by activity type, over the T&C scope.
  const compare = useMemo(() => {
    const m = new Map<string, { type: string; n: number; p6: number; budget: number }>();
    for (const t of tasks) {
      if (!inScope(t)) continue;
      const row = ctx.budgetById.get(normKey(t.code));
      const type = row ? row.matchKey || row.activityType || '(no type)' : '(not in the budget)';
      let units = 0;
      for (const a of model.assignmentsOf.get(t.uid) ?? []) {
        const rt = a.rsrcType || model.resources.get(a.rsrcUid)?.type || 'Labor';
        if (rt === 'Labor') units += a.budgetQty;
      }
      let e = m.get(type);
      if (!e) m.set(type, (e = { type, n: 0, p6: 0, budget: 0 }));
      e.n += 1;
      e.p6 += units;
      e.budget += row?.budgetHours ?? 0;
    }
    return [...m.values()].sort((a, b) => b.budget - a.budget || b.p6 - a.p6);
  }, [tasks, inScope, ctx.budgetById, model]);

  const columns: Column<ResourceSummary>[] = [
    {
      key: 'name',
      label: 'Resource',
      locked: true,
      value: (r) => r.name,
      render: (r) => (
        <button className={`btn-link${r.uid === chosen ? ' font-semibold' : ''}`} onClick={() => setPicked(r.uid)} title="Chart this resource by month">
          {r.name}
        </button>
      ),
    },
    { key: 'code', label: 'Code', value: (r) => r.code },
    { key: 'type', label: 'Type', value: (r) => r.type },
    { key: 'n', label: 'Activities', num: true, value: (r) => r.activities },
    { key: 'budget', label: 'Budgeted units', num: true, value: (r) => Math.round(r.budget), render: (r) => h(r.budget) },
    { key: 'remaining', label: 'Remaining units', num: true, value: (r) => Math.round(r.remaining), render: (r) => h(r.remaining) },
    { key: 'scopeBudget', label: 'T&C budgeted', num: true, value: (r) => Math.round(r.scopeBudget), render: (r) => (r.scopeBudget ? h(r.scopeBudget) : '') },
    { key: 'scopeRemaining', label: 'T&C remaining', num: true, value: (r) => Math.round(r.scopeRemaining), render: (r) => (r.scopeRemaining ? h(r.scopeRemaining) : '') },
    { key: 'first', label: 'First start', value: (r) => r.firstStart, render: (r) => fmtMs(r.firstStart) },
    { key: 'last', label: 'Last finish', value: (r) => r.lastFinish, render: (r) => fmtMs(r.lastFinish) },
  ];

  if (summaries.length === 0) {
    return <div className="text-[13px] text-[var(--text-muted)]">This project has no resource assignments in the file.</div>;
  }

  const p6Total = compare.reduce((s, c) => s + c.p6, 0);
  const budgetTotal = compare.reduce((s, c) => s + c.budget, 0);

  return (
    <div className="space-y-4">
      <SortableTable rows={summaries} columns={columns} rowKey={(r) => r.uid || r.name} tableId="schedule-resources" exportName="P6-Resources" maxHeight="320px" />

      <div className="card">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="card-title">{chosenRow ? `${chosenRow.name}, hours by month` : 'Hours by month'}</h2>
          <div className="seg" role="group">
            <button type="button" aria-pressed={scope === 'in'} onClick={() => setScope('in')}>
              T&amp;C scope
            </button>
            <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              Whole project
            </button>
          </div>
        </div>
        <p className="text-[12px] text-[var(--text-muted)]">
          Budgeted units spread evenly over each assignment&rsquo;s planned dates, and remaining units over its remaining dates — P6&rsquo;s uniform curve. Labour only.
        </p>
        {chart.length === 0 ? (
          <div className="py-8 text-center text-[12px] text-[var(--text-subtle)]">No labour hours for this resource {scope === 'in' ? 'in the T&C scope' : 'in the project'}.</div>
        ) : (
          <div style={{ height: 260 }} className="mt-2">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={12} />
                <YAxis tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 100) / 10}K` : String(v))} />
                <Tooltip formatter={(v, name) => [`${h(Number(v))} h`, String(name)]} />
                <Legend wrapperStyle={{ fontSize: 11.5 }} />
                {dataMonth && <ReferenceLine x={dataMonth} stroke="#9a9da4" strokeDasharray="4 4" label={{ value: 'DATA DATE', position: 'top', fontSize: 9.5, fill: AXIS }} />}
                <Bar dataKey="remaining" name="Remaining" fill={BLUE} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} legendType="square" />
                <Line type="stepAfter" dataKey="budget" name="Budgeted (planned dates)" stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} legendType="plainline" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">P6&rsquo;s planned labour against the T&amp;C budget</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          By activity type, over the T&amp;C scope. P6 planned {h(p6Total)} h of labour on these activities; the budget carries {h(budgetTotal)} h. The two are built
          separately — P6 from resource assignments, the budget from the rate library — so a type where they disagree widely is worth checking in one or the other.
        </p>
        <table className="tbl mt-2">
          <thead>
            <tr>
              <th>Activity type</th>
              <th className="num">Activities</th>
              <th className="num">P6 planned h</th>
              <th className="num">Budget h</th>
              <th className="num">Difference</th>
              <th className="num">P6 ÷ budget</th>
            </tr>
          </thead>
          <tbody>
            {compare.map((c) => {
              const ratio = c.budget > 0 ? c.p6 / c.budget : null;
              const off = ratio !== null && c.p6 > 0 && (ratio < 0.5 || ratio > 1.5);
              return (
                <tr key={c.type} className={off ? 'row-warn' : ''}>
                  <td className="cell-text" style={{ maxWidth: '26rem' }} title={c.type}>
                    {c.type}
                  </td>
                  <td className="num">{c.n}</td>
                  <td className="num">{c.p6 ? h(c.p6) : <span className="text-[var(--text-subtle)]">none</span>}</td>
                  <td className="num">{h(c.budget)}</td>
                  <td className="num">{c.p6 ? h(c.p6 - c.budget) : ''}</td>
                  <td className="num">{ratio !== null && c.p6 ? `${ratio.toFixed(2)}×` : ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

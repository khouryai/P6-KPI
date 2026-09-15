import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useApp } from '../state';
import { Page, SortableTable, Panel, Stat, Notice, type Column, type HeroStat } from '../components/ui';
import type { GroupDim, GroupStat } from '../../engine/types';
import { groupRows } from '../../engine/compute';
import { fmtHours, fmtPct, fmtDate } from '../format';
import { href } from '../router';

const DIMS: { id: GroupDim; label: string; note: string }[] = [
  { id: 'phase', label: 'Phase', note: 'From the 2nd segment of the Activity ID, so P2 is Phase 2.' },
  { id: 'location', label: 'Location', note: 'From the 4th segment of the Activity ID.' },
  { id: 'discipline', label: 'Discipline', note: 'From the discipline you set on each Activity Library key.' },
  { id: 'workType', label: 'Work type', note: 'From the 3rd segment of the Activity ID, so TC is Testing and Commissioning.' },
];

const GOOD = '#00875a';
const AMBER = '#d97706';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

function barTone(pct: number): string {
  if (pct >= 0.995) return GOOD;
  if (pct >= 0.5) return AMBER;
  return '#9a9da4';
}

export function Rollup() {
  const { state, model } = useApp();
  const [dim, setDim] = useState<GroupDim>('phase');
  /** Narrow to one phase, then roll up by something else inside it. */
  const [withinPhase, setWithinPhase] = useState('');

  const active = DIMS.find((d) => d.id === dim)!;

  const groups = useMemo<GroupStat[]>(() => {
    if (!withinPhase) return model.groups[dim];
    return groupRows(model.rows.filter((r) => r.phase === withinPhase), dim);
  }, [model, dim, withinPhase]);

  const phases = model.groups.phase;
  const scope = withinPhase ? phases.find((p) => p.key === withinPhase) : null;
  const totalBudget = groups.reduce((s, g) => s + g.budgetHours, 0);
  const totalEarned = groups.reduce((s, g) => s + g.earnedHours, 0);

  const chartData = useMemo(
    () => groups.slice(0, 18).map((g) => ({ label: g.label, pct: Math.round(g.pctComplete * 1000) / 10, budget: g.budgetHours, earned: g.earnedHours })),
    [groups],
  );

  const heroStats: HeroStat[] = [
    { label: active.label === 'Work type' ? 'Types' : `${active.label}s`, value: groups.length, tone: 'muted' },
    { label: 'Budget', value: `${fmtHours(totalBudget)} h`, tone: 'muted' },
    { label: 'Complete', value: fmtPct(totalBudget ? totalEarned / totalBudget : 0, 0), tone: 'blue' },
  ];

  const drillTo = (g: GroupStat): string => {
    const params: Record<string, string> = {};
    if (dim === 'location') params.loc = g.key;
    if (dim === 'phase') params.phase = g.key;
    if (dim === 'discipline') params.disc = g.key;
    if (dim === 'workType') params.work = g.key;
    if (withinPhase && dim !== 'phase') params.phase = withinPhase;
    return href('budget', params);
  };

  const columns: Column<GroupStat>[] = [
    {
      key: 'label',
      label: active.label,
      value: (g) => g.label,
      render: (g) => (
        <a className="btn-link" href={drillTo(g)} title={`Open Budget Master filtered to ${g.label}`}>
          {g.label}
        </a>
      ),
    },
    { key: 'inBudget', label: 'In budget', value: (g) => g.inBudget, num: true },
    { key: 'budget', label: 'Budget h', value: (g) => g.budgetHours, num: true, render: (g) => fmtHours(g.budgetHours) },
    { key: 'earned', label: 'Earned h', value: (g) => g.earnedHours, num: true, render: (g) => fmtHours(g.earnedHours, 1) },
    { key: 'remaining', label: 'Remaining h', value: (g) => g.remainingHours, num: true, render: (g) => fmtHours(g.remainingHours, 1) },
    {
      key: 'pct',
      label: '% complete',
      value: (g) => g.pctComplete,
      num: true,
      width: '200px',
      render: (g) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-10 text-right tabular-nums font-semibold">{fmtPct(g.pctComplete, 0)}</span>
          <div className="bar bar-lg" style={{ width: 96 }}>
            <span style={{ width: `${Math.min(100, Math.round(g.pctComplete * 100))}%`, background: barTone(g.pctComplete) }} />
          </div>
        </div>
      ),
    },
    {
      key: 'state',
      label: 'Finished / running / not started',
      value: (g) => g.finished,
      render: (g) => (
        <span className="tabular-nums text-[var(--text-muted)]">
          <b className="text-[var(--good)]">{g.finished}</b> / <b className="text-[var(--warn)]">{g.inProgress}</b> / {g.notStarted}
        </span>
      ),
    },
    {
      key: 'counts',
      label: 'Test coverage',
      value: (g) => (g.inBudget ? g.withCounts / g.inBudget : 0),
      num: true,
      render: (g) => (
        <span className={g.withCounts === g.inBudget ? 'text-[var(--good)]' : 'text-[var(--text-muted)]'}>
          {g.withCounts}/{g.inBudget}
        </span>
      ),
    },
    { key: 'tests', label: 'Test cases', value: (g) => g.testsTotal, num: true, render: (g) => (g.testsTotal ? `${g.testsComplete}/${g.testsTotal}` : '') },
    { key: 'start', label: 'First start', value: (g) => g.earliestStart, render: (g) => fmtDate(g.earliestStart) },
    { key: 'finish', label: 'Last finish', value: (g) => g.latestFinish, render: (g) => fmtDate(g.latestFinish) },
  ];

  // Ties on percent are broken by budget: the biggest bucket is the one worth naming.
  const best = [...groups].filter((g) => g.inBudget > 0).sort((a, b) => b.pctComplete - a.pctComplete || b.budgetHours - a.budgetHours)[0];
  const worst = [...groups]
    .filter((g) => g.inBudget > 0 && g.budgetHours > 0)
    .sort((a, b) => a.pctComplete - b.pctComplete || b.budgetHours - a.budgetHours)[0];
  const biggestRemaining = [...groups].sort((a, b) => b.remainingHours - a.remainingHours)[0];

  return (
    <Page
      eyebrow="Progress"
      title={`Progress by ${active.label.toLowerCase()}`}
      subtitle={
        <>
          Where the hours are and how far each part has got. {active.note}
          {withinPhase && <> Scoped to {scope?.label}.</>}
        </>
      }
      stats={heroStats}
      toolbar={
        <>
          <div className="seg" role="group" aria-label="Roll up by">
            {DIMS.map((d) => (
              <button key={d.id} aria-pressed={dim === d.id} onClick={() => setDim(d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <select className="input ml-2" value={withinPhase} onChange={(e) => setWithinPhase(e.target.value)}>
            <option value="">Whole programme</option>
            {phases.map((p) => (
              <option key={p.key} value={p.key}>
                Within {p.label}
              </option>
            ))}
          </select>
          {dim === 'phase' && withinPhase && (
            <span className="text-[11.5px] text-[var(--text-muted)]">Rolling up by phase inside one phase shows a single row. Pick another dimension.</span>
          )}
        </>
      }
    >
      {model.rows.length === 0 ? (
        <Notice tone="info">
          Nothing to roll up yet. Import a schedule on the <a href={href('import')}>Import</a> screen.
        </Notice>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Budget in scope" value={`${fmtHours(totalBudget)} h`} sub={`${groups.reduce((n, g) => n + g.inBudget, 0)} activities`} primary />
            <Stat
              label="Furthest ahead"
              value={best ? fmtPct(best.pctComplete, 0) : '—'}
              tone="good"
              sub={best ? <>{best.label}, {fmtHours(best.budgetHours)} h</> : undefined}
            />
            <Stat
              label="Furthest behind"
              value={worst ? fmtPct(worst.pctComplete, 0) : '—'}
              tone="warn"
              sub={worst ? <>{worst.label}, {fmtHours(worst.budgetHours)} h</> : undefined}
            />
            <Stat
              label="Most hours left"
              value={biggestRemaining ? `${fmtHours(biggestRemaining.remainingHours)} h` : '—'}
              sub={biggestRemaining ? biggestRemaining.label : undefined}
            />
          </div>

          <div className="mt-4">
            <Panel title={`Percent complete by ${active.label.toLowerCase()}`} meta={groups.length > 18 ? `Top 18 of ${groups.length} by budget` : undefined}>
              <div style={{ height: Math.max(180, chartData.length * 26 + 40) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 40, left: 8, bottom: 4 }}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" horizontal={false} />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tick={{ fontSize: 10.5, fill: AXIS, fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace" }}
                      tickLine={false}
                      axisLine={{ stroke: GRID }}
                      tickFormatter={(v: number) => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="label"
                      width={150}
                      tick={{ fontSize: 11, fill: AXIS }}
                      tickLine={false}
                      axisLine={false}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(15,17,21,0.04)' }}
                      content={({ active: on, payload }) => {
                        if (!on || !payload?.length) return null;
                        const d = payload[0].payload as { label: string; pct: number; budget: number; earned: number };
                        return (
                          <div style={{ background: '#fff', border: '1px solid #e4e7ec', borderRadius: 8, padding: '8px 11px', fontSize: 12, boxShadow: '0 6px 16px -8px rgba(15,17,21,0.2)' }}>
                            <div style={{ fontWeight: 700, marginBottom: 3 }}>{d.label}</div>
                            <div style={{ color: '#6e7179' }}>
                              {fmtHours(d.earned, 1)} of {fmtHours(d.budget)} h · <b style={{ color: '#1a1a1a' }}>{d.pct}%</b>
                            </div>
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="pct" radius={[0, 4, 4, 0]} barSize={14} isAnimationActive={false}>
                      {chartData.map((d) => (
                        <Cell key={d.label} fill={barTone(d.pct / 100)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Panel>
          </div>

          <div className="mt-4">
            <SortableTable
              rows={groups}
              columns={columns}
              rowKey={(g) => g.key || '(none)'}
              defaultSort={{ key: 'budget', dir: 'desc' }}
              maxHeight="none"
            />
          </div>

          {state.data.settings.dataDate === '' && (
            <div className="mt-4">
              <Notice tone="warn">
                No data date is set, so nothing in progress can earn. Set it on <a href={href('settings')}>Settings</a> for these figures to mean anything.
              </Notice>
            </div>
          )}
        </>
      )}
    </Page>
  );
}

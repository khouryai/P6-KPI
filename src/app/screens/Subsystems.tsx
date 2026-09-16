import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { useApp } from '../state';
import { Page, SortableTable, Panel, Notice, Term, type Column, type HeroStat } from '../components/ui';
import type { SubsystemStat, SubsystemCell } from '../../engine/types';
import { crewLines, UNASSIGNED } from '../../engine/compute';
import { fmtHours, fmtPct } from '../format';
import { href } from '../router';
import { TERMS } from '../../engine/vocab';

const GRID = '#e4e7ec';
const AXIS = '#6e7179';
const TONES = ['#e60012', '#0b6bcb', '#00875a', '#d97706', '#6d28d9', '#0e7490', '#b91c1c', '#4d7c0f'];

/**
 * Workload per resource group.
 *
 * The budget answers "how many hours", the phase rollup answers "when", and this
 * answers "whose". Two people at eight hours is a number; one ATS engineer and one
 * IXL engineer is a staffing problem, and only this screen can see it.
 */
export function Subsystems() {
  /*
   * There is deliberately no Name column. A subsystem code is ATS, IXL or COMMS:
   * it is already the name everyone on the job uses, and a second column repeating
   * it in longhand cost a column's width and told nobody anything. Names already
   * stored are kept in the file and simply not shown.
   */
  const { model } = useApp();
  const [cut, setCut] = useState<'phase' | 'location'>('phase');
  const [open, setOpen] = useState<string | null>(null);

  const stats = model.subsystems;
  const total = stats.reduce((s, x) => s + x.budgetHours, 0);
  const earned = stats.reduce((s, x) => s + x.earnedHours, 0);
  const split = model.summary.typesWithCrewSplit;
  const unassigned = model.summary.unassignedHours;

  const heroStats: HeroStat[] = [
    { label: TERMS.subsystemPlural, value: stats.filter((s) => s.budgetHours > 0).length, tone: 'muted' },
    { label: 'Budget', value: `${fmtHours(total)} h`, tone: 'muted' },
    { label: 'Complete', value: fmtPct(total ? earned / total : 0, 0), tone: 'blue' },
  ];

  /*
   * Horizontal, and stacked earned-then-remaining.
   *
   * Vertical bars do not work here: one group can hold twenty times another's
   * hours, which flattens every small bar to nothing, and the names do not fit
   * under the axis. Along the side each group gets a readable label and a bar that
   * reads as a progress bar, which is what it is.
   */
  const chart = useMemo(
    () => stats.filter((s) => s.budgetHours > 0).slice(0, 14).map((s) => ({
      label: s.code || 'Unassigned',
      budget: Math.round(s.budgetHours),
      earned: Math.round(s.earnedHours),
      remaining: Math.max(0, Math.round(s.budgetHours - s.earnedHours)),
      pct: Math.round(s.pctComplete * 1000) / 10,
    })),
    [stats],
  );

  const columns: Column<SubsystemStat>[] = [
    {
      key: 'code',
      label: TERMS.subsystem,
      value: (r) => r.code || 'zzz',
      width: '150px',
      render: (r) =>
        r.code === UNASSIGNED ? (
          <span className="text-[var(--text-muted)]" title={`Hours from crews that were never split by ${TERMS.subsystemLower}. Split them in the Activity Library.`}>
            Unassigned
          </span>
        ) : (
          <a className="mono font-semibold" href={href('budget', { sub: r.code })} title={`Show the activities that draw on this ${TERMS.subsystemLower}`}>
            {r.code}
          </a>
        ),
    },
    { key: 'acts', label: 'Activities', value: (r) => r.activities, num: true },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    { key: 'share', label: 'Share', value: (r) => r.shareOfBudget, num: true, render: (r) => fmtPct(r.shareOfBudget, 0) },
    { key: 'earned', label: 'Earned h', value: (r) => r.earnedHours, num: true, render: (r) => fmtHours(r.earnedHours) },
    { key: 'remaining', label: 'Remaining h', value: (r) => r.remainingHours, num: true, render: (r) => fmtHours(r.remainingHours) },
    {
      key: 'pct',
      label: 'Complete',
      value: (r) => r.pctComplete,
      num: true,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-10 text-right tabular-nums font-semibold">{fmtPct(r.pctComplete, 0)}</span>
          <div className="bar" style={{ width: 72 }} title={`${fmtPct(r.pctComplete, 1)} of ${fmtHours(r.budgetHours)} h`}>
            <span style={{ width: `${Math.min(100, Math.round(r.pctComplete * 100))}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'cut',
      label: '',
      value: () => '',
      hint: '',
      render: (r) => (
        <button className="btn-link text-[11px] font-normal" onClick={() => setOpen(open === r.code ? null : r.code)}>
          {open === r.code ? 'hide' : `by ${cut}`}
        </button>
      ),
    },
  ];

  const cellColumns: Column<SubsystemCell>[] = [
    { key: 'label', label: cut === 'phase' ? 'Phase' : 'Location', value: (c) => c.label },
    { key: 'budget', label: 'Budget h', value: (c) => c.budgetHours, num: true, render: (c) => fmtHours(c.budgetHours) },
    { key: 'earned', label: 'Earned h', value: (c) => c.earnedHours, num: true, render: (c) => fmtHours(c.earnedHours) },
    { key: 'pct', label: 'Complete', value: (c) => c.pctComplete, num: true, render: (c) => fmtPct(c.pctComplete, 0) },
  ];

  // Unassigned's code is the empty string, so this must test against null rather
  // than truthiness: `open ? ...` would leave that row unable to ever open.
  const opened = open === null ? null : (stats.find((s) => s.code === open) ?? null);

  return (
    <Page
      eyebrow="Budget"
      title={TERMS.subsystemPlural}
      subtitle={`Man-hours by ${TERMS.subsystemLower}, and the same hours cut by phase and location. An activity needing an ATS and an IXL engineer counts under both; its hours are split between them, so the totals still add back to the budget.`}
      stats={heroStats}
      toolbar={
        <>
          <select className="input" value={cut} onChange={(e) => setCut(e.target.value as 'phase' | 'location')}>
            <option value="phase">Cut by phase</option>
            <option value="location">Cut by location</option>
          </select>
          <a className="btn" href={href('library')}>Edit crews</a>
        </>
      }
    >
      {split === 0 && (
        <Notice tone="warn">
          No activity type has its crew split by {TERMS.subsystemLower} yet, so every hour is Unassigned. Open the <a href={href('library')}>Activity Library</a>, find a type, and
          click <b>split</b> on its Crew cell. Pricing does not change: a crew of two becomes one ATS plus one IXL, same hours.
        </Notice>
      )}
      {split > 0 && unassigned > 0 && (
        <Notice tone="info">
          {fmtHours(unassigned)} hours are still Unassigned, from {model.library.filter((l) => l.crewEffLines.length === 0 && l.budgetHours > 0).length} activity types
          priced as a plain headcount. They are in the budget, just not attributed to a group.
        </Notice>
      )}

      {chart.length > 0 && (
        <Panel title={`Budget by ${TERMS.subsystemLower}`} meta="Whole bar is the budget; the solid part is earned." className="mb-3">
          <div style={{ height: Math.max(150, chart.length * 34 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart layout="vertical" data={chart} margin={{ top: 4, right: 16, left: 4, bottom: 4 }} barCategoryGap="22%">
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis type="category" dataKey="label" width={104} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: 'rgba(15,17,21,0.04)' }}
                  content={({ active: on, payload }) => {
                    if (!on || !payload?.length) return null;
                    const d = payload[0].payload as { label: string; pct: number; budget: number; earned: number };
                    return (
                      <div style={{ background: '#fff', border: `1px solid ${GRID}`, borderRadius: 8, padding: '8px 11px', fontSize: 12, boxShadow: '0 6px 16px -8px rgba(15,17,21,0.2)' }}>
                        <div style={{ fontWeight: 600 }}>{d.label}</div>
                        <div>{fmtHours(d.earned)} of {fmtHours(d.budget)} h earned</div>
                        <div style={{ color: AXIS }}>{d.pct}% complete</div>
                      </div>
                    );
                  }}
                />
                <Bar dataKey="earned" stackId="a">
                  {chart.map((c, i) => (
                    <Cell key={c.label} fill={TONES[i % TONES.length]} />
                  ))}
                </Bar>
                <Bar dataKey="remaining" stackId="a" fill="#e9ebef" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      <SortableTable tableId="subsystems" rows={stats} columns={columns} rowKey={(r) => r.code || '(unassigned)'} defaultSort={{ key: 'budget', dir: 'desc' }} maxHeight="calc(100vh - 560px)" />

      {opened && (
        <Panel
          title={
            // Panel only styles a string title, so a node has to bring its own.
            <h2 className="card-title">
              <Term text={opened.code || 'Unassigned'} hint={`Every hour budgeted to ${opened.code || 'no subsystem'}, cut by ${cut}.`} /> by {cut}
            </h2>
          }
          meta={`${fmtHours(opened.budgetHours)} h in total`}
          className="mt-3"
        >
          <SortableTable
            rows={cut === 'phase' ? opened.byPhase : opened.byLocation}
            columns={cellColumns}
            rowKey={(c) => c.key || '(none)'}
            defaultSort={{ key: 'budget', dir: 'desc' }}
            maxHeight="300px"
          />
        </Panel>
      )}

      <Panel title={`How a crew becomes ${TERMS.subsystemLower} hours`} className="mt-3">
        <p className="text-[12px] text-[var(--text-muted)]">
          Each activity type in the library carries a crew. Give that crew named lines — <span className="mono">ATS 1</span>, <span className="mono">IXL 1</span> — and the
          activity’s budget is divided between them in proportion to what each line costs per shift. The division is of the final, rounded budget figure, so an override or
          a location complexity factor carries through to every group and the parts always add back to the whole.
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          {model.library.filter((l) => l.crewEffLines.length > 0).length} of {model.library.length} types are split.{' '}
          {model.library
            .filter((l) => l.crewEffLines.length > 0)
            .slice(0, 3)
            .map((l) => `${l.matchKey} = ${crewLines(l.entry).map((c) => `${c.count} ${c.subsystem || 'Unassigned'}`).join(' + ')}`)
            .join('; ')}
        </p>
      </Panel>
    </Page>
  );
}

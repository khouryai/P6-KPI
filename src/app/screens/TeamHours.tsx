import { useMemo, useRef, useState } from 'react';
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useApp } from '../state';
import { Page, SortableTable, Panel, Notice, Term, CellInput, type Column, type HeroStat } from '../components/ui';
import type { BurnRow, Reforecast, TeamActual } from '../../engine/types';
import { parseTeamHours, type TeamPaste } from '../../engine/teamHours';
import { parseDelimitedText } from '../../engine/parse';
import { UNASSIGNED } from '../../engine/compute';
import { normKey } from '../../engine/keys';
import { fmtHours, fmtPct } from '../format';
import { href } from '../router';
import { readWorkbook, workbookGrid } from '../../engine/workbook';

const GRID = '#e4e7ec';
const AXIS = '#6e7179';
const EARNED = '#0b6bcb';
const BUILT = '#e60012';

function monthLabel(m: string): string {
  const [y, mm] = m.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(mm) - 1] ?? mm} ${y.slice(2)}`;
}

function varianceTone(v: number): 'good' | 'bad' | 'muted' {
  if (Math.abs(v) < 0.5) return 'muted';
  return v >= 0 ? 'good' : 'bad';
}

/**
 * Earned against built.
 *
 * The budget says what the work was worth. Timesheets say what it cost. Earning
 * 5,000 hours in a month the team built 6,000 is a 1,000 hour hole, and if that
 * rate holds the rest of the job costs more than it is worth. Everything here
 * exists to make that visible early enough to do something about it.
 */
export function TeamHours() {
  const { state, model, actions } = useApp();
  const burn = model.burn;
  const [paste, setPaste] = useState('');
  const [pending, setPending] = useState<TeamPaste | null>(null);
  const [labelsAre, setLabelsAre] = useState<'subsystem' | 'person'>('subsystem');
  const [pendingSubsystem, setPendingSubsystem] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [hideQuiet, setHideQuiet] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const knownSubsystems = useMemo(
    () => model.subsystems.map((s) => s.code).filter((c) => c !== UNASSIGNED),
    [model.subsystems],
  );

  const project = burn.project;
  const heroStats: HeroStat[] = [
    { label: 'Earned', value: `${fmtHours(burn.totalEarned)} h`, tone: 'blue' },
    { label: 'Built', value: `${fmtHours(burn.totalBuilt)} h`, tone: 'red' },
    {
      label: 'Variance',
      value: burn.totalBuilt ? `${project.cumEarned - project.cumBuilt >= 0 ? '+' : ''}${fmtHours(project.cumEarned - project.cumBuilt)} h` : '—',
      tone: burn.totalBuilt ? (project.cumEarned >= project.cumBuilt ? 'good' : 'red') : 'muted',
    },
    { label: 'Factor', value: project.factor === null ? '—' : project.factor.toFixed(2), tone: project.factor === null ? 'muted' : project.factor >= 1 ? 'good' : 'amber' },
  ];

  const chart = useMemo(
    () => burn.months.map((m) => ({
      month: monthLabel(m.month),
      earned: Math.round(m.earned),
      built: Math.round(m.built),
      cumEarned: Math.round(m.cumEarned),
      cumBuilt: Math.round(m.cumBuilt),
    })),
    [burn.months],
  );

  // --- keying and importing -------------------------------------------------
  const commit = (rows: { month: string; subsystem: string; person?: string; hours: number }[]) => {
    actions.update('teamActuals', (list) => {
      const next = [...list];
      for (const r of rows) {
        // Same month, same group, same person is the same fact restated: replace it
        // rather than adding the hours twice when a sheet is pasted again.
        const i = next.findIndex(
          (x) => x.month === r.month && normKey(x.subsystem) === normKey(r.subsystem) && normKey(x.person ?? '') === normKey(r.person ?? ''),
        );
        const row: TeamActual = {
          id: i >= 0 ? next[i].id : `${r.month}-${r.subsystem}-${r.person ?? ''}-${Math.random().toString(36).slice(2, 8)}`,
          month: r.month,
          subsystem: r.subsystem,
          hours: r.hours,
        };
        if (r.person) row.person = r.person;
        if (i >= 0) next[i] = row;
        else next.push(row);
      }
      return next;
    });
  };

  const applyPending = () => {
    if (!pending) return;
    const rows = pending.rows.map((r) => ({
      month: r.month,
      subsystem: labelsAre === 'subsystem' ? r.label.trim() : pendingSubsystem.trim(),
      person: labelsAre === 'person' ? r.label.trim() : undefined,
      hours: r.hours,
    }));
    commit(rows);
    actions.notify('ok', `${rows.length} rows read across ${pending.months.length} months. Check them below, then Save.`);
    setPending(null);
    setPaste('');
  };

  const loadPaste = () => {
    const out = parseTeamHours(parseDelimitedText(paste));
    if (out.layout === 'none') {
      actions.notify('error', 'Could not find months and hours in that. Paste a block with months across the top, or a column of months next to a column of hours.');
      return;
    }
    setLabelsAre(/person|name|engineer|staff|who/i.test(out.labelHeader) ? 'person' : 'subsystem');
    setPending(out);
  };

  /**
   * A team build sheet has no agreed sheet name, so every sheet in the workbook is
   * tried and the one that yields the most rows wins. Guessing beats asking.
   */
  const loadFile = async (file: File) => {
    try {
      let best: TeamPaste | null = null;
      if (/\.xlsx?$|\.xlsm$|\.xlsb$/i.test(file.name)) {
        const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()));
        for (const name of wb.SheetNames) {
          const out = parseTeamHours(workbookGrid(wb, name, 60));
          if (out.layout !== 'none' && (!best || out.rows.length > best.rows.length)) {
            best = { ...out, note: `${out.note} Read from sheet "${name}".` };
          }
        }
      } else {
        const out = parseTeamHours(parseDelimitedText(await file.text()));
        if (out.layout !== 'none') best = out;
      }
      if (!best) {
        actions.notify('error', `No months and hours found in ${file.name}. Expected months across the top, or a column of months beside a column of hours.`);
        return;
      }
      setLabelsAre(/person|name|engineer|staff|who/i.test(best.labelHeader) ? 'person' : 'subsystem');
      setPending(best);
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  const removeRow = (id: string) => actions.update('teamActuals', (list) => list.filter((x) => x.id !== id));
  const editRow = (id: string, patch: Partial<TeamActual>) =>
    actions.update('teamActuals', (list) => list.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  // --- tables ---------------------------------------------------------------
  const monthColumns: Column<BurnRow>[] = [
    { key: 'month', label: 'Month', value: (r) => r.month, render: (r) => <span className="mono">{monthLabel(r.month)}</span> },
    { key: 'earned', label: 'Earned h', value: (r) => r.earned, num: true, render: (r) => fmtHours(r.earned) },
    { key: 'built', label: 'Built h', value: (r) => r.built, num: true, render: (r) => fmtHours(r.built) },
    {
      key: 'variance',
      label: 'Variance',
      value: (r) => r.variance,
      num: true,
      render: (r) => (
        <span className={`tone-${varianceTone(r.variance)} font-semibold`}>
          {r.variance >= 0 ? '+' : ''}
          {fmtHours(r.variance)}
        </span>
      ),
    },
    { key: 'factor', label: 'Factor', value: (r) => r.factor ?? null, num: true, render: (r) => (r.factor === null ? <span className="text-[var(--text-subtle)]">—</span> : r.factor.toFixed(2)) },
    { key: 'cumEarned', label: 'Cum earned', value: (r) => r.cumEarned, num: true, render: (r) => fmtHours(r.cumEarned) },
    { key: 'cumBuilt', label: 'Cum built', value: (r) => r.cumBuilt, num: true, render: (r) => fmtHours(r.cumBuilt) },
    {
      key: 'cumVariance',
      label: 'Cum variance',
      value: (r) => r.cumVariance,
      num: true,
      render: (r) => (
        <span className={`tone-${varianceTone(r.cumVariance)} font-semibold`}>
          {r.cumVariance >= 0 ? '+' : ''}
          {fmtHours(r.cumVariance)}
        </span>
      ),
    },
    {
      key: 'by',
      label: '',
      value: () => '',
      hint: '',
      render: (r) => (
        <button className="btn-link text-[11px] font-normal" onClick={() => setOpen(open === r.month ? null : r.month)}>
          {open === r.month ? 'hide' : 'by group'}
        </button>
      ),
    },
  ];

  const forecastColumns: Column<Reforecast>[] = [
    { key: 'label', label: 'Subsystem', value: (r) => r.label, render: (r) => <span className="mono">{r.code || 'Unassigned'}</span> },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    { key: 'earned', label: 'Earned h', value: (r) => r.cumEarned, num: true, render: (r) => fmtHours(r.cumEarned) },
    { key: 'built', label: 'Built h', value: (r) => r.cumBuilt, num: true, render: (r) => fmtHours(r.cumBuilt) },
    { key: 'factor', label: 'Factor', value: (r) => r.factor ?? null, num: true, render: (r) => (r.factor === null ? <span className="text-[var(--text-subtle)]">—</span> : <span className={r.factor >= 1 ? 'tone-good font-semibold' : 'tone-bad font-semibold'}>{r.factor.toFixed(2)}</span>) },
    { key: 'toGo', label: 'To complete', value: (r) => r.hoursToComplete ?? null, num: true, render: (r) => (r.hoursToComplete === null ? <span className="text-[var(--text-subtle)]">—</span> : fmtHours(r.hoursToComplete)) },
    { key: 'forecast', label: 'Forecast', value: (r) => r.forecastTotalHours ?? null, num: true, render: (r) => (r.forecastTotalHours === null ? <span className="text-[var(--text-subtle)]">—</span> : fmtHours(r.forecastTotalHours)) },
    {
      key: 'vac',
      label: 'At completion',
      value: (r) => r.varianceAtCompletion ?? null,
      num: true,
      render: (r) =>
        r.varianceAtCompletion === null ? (
          <span className="text-[var(--text-subtle)]">—</span>
        ) : (
          <span className={`tone-${varianceTone(r.varianceAtCompletion)} font-semibold`}>
            {r.varianceAtCompletion >= 0 ? '+' : ''}
            {fmtHours(r.varianceAtCompletion)}
          </span>
        ),
    },
  ];

  const keyedColumns: Column<TeamActual>[] = [
    { key: 'month', label: 'Month', value: (r) => r.month, render: (r) => <CellInput value={r.month} placeholder="2026-08" onCommit={(v) => editRow(r.id, { month: v.trim() })} /> },
    {
      key: 'subsystem',
      label: 'Subsystem',
      value: (r) => r.subsystem,
      render: (r) => <CellInput value={r.subsystem} list="team-subsystems" placeholder="Unassigned" onCommit={(v) => editRow(r.id, { subsystem: v.trim() })} />,
    },
    { key: 'person', label: 'Person', value: (r) => r.person ?? '', render: (r) => <CellInput value={r.person ?? ''} onCommit={(v) => editRow(r.id, { person: v.trim() || undefined })} /> },
    { key: 'hours', label: 'Built h', value: (r) => r.hours, num: true, render: (r) => <CellInput type="number" value={String(r.hours)} onCommit={(v) => editRow(r.id, { hours: Number(v) || 0 })} /> },
    { key: 'act', label: '', value: () => '', hint: '', render: (r) => <button className="btn-link text-[11px] font-normal" onClick={() => removeRow(r.id)}>remove</button> },
  ];

  const openedMonth = open === null ? null : (burn.months.find((m) => m.month === open) ?? null);

  /*
   * A long programme has stretches where nothing was earned and nothing was built.
   * Those months are real and the engine reports them, but forty rows of zeros
   * carrying the same cumulative figure bury the months that matter. They are
   * hidden by default and counted, never dropped.
   */
  const shownMonths = hideQuiet ? burn.months.filter((m) => m.earned !== 0 || m.built !== 0) : burn.months;
  const quiet = burn.months.length - shownMonths.length;
  const keyed = state.data.teamActuals;

  return (
    <Page
      eyebrow="Progress"
      title="Earned vs Built"
      subtitle="What the completed work was worth, against what it cost. Earned comes from the budget and the percent complete; built comes from your timesheets. The gap between them is the whole question."
      stats={heroStats}
      toolbar={
        <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f); }} />
          <button className="btn" onClick={() => fileRef.current?.click()}>Import a sheet…</button>
          <a className="btn" href={href('subsystems')}>Subsystems</a>
        </>
      }
    >
      <datalist id="team-subsystems">{knownSubsystems.map((c) => <option key={c} value={c} />)}</datalist>

      {burn.totalBuilt === 0 && (
        <Notice tone="info">
          No built hours keyed yet, so there is nothing to compare the budget against. Paste your team’s monthly hours below — months across the top or one row per month,
          either reads — and this screen fills in.
        </Notice>
      )}
      {burn.unphasedEarned > 0.5 && (
        <Notice tone="warn">
          {fmtHours(burn.unphasedEarned)} earned hours belong to no month, because those activities have no usable dates. The monthly rows below are that much short of the
          {' '}{fmtHours(burn.totalEarned)} h total, though the forecast underneath uses the full figure.
        </Notice>
      )}
      {burn.builtWithNoBudget.length > 0 && (
        <Notice tone="warn">
          Hours were built against <b>{burn.builtWithNoBudget.map((c) => c || 'Unassigned').join(', ')}</b>, which hold no budget. Nothing can ever be earned there, so
          those hours are pure loss unless the crews in the <a href={href('library')}>Activity Library</a> are missing a group.
        </Notice>
      )}

      {/* --- the answer, before the detail --- */}
      {project.factor !== null && (
        <Panel className="mb-3" title="Where this lands if nothing changes">
          <div className="grid gap-3 md:grid-cols-4">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]"><Term text="Factor" /></div>
              <div className={`text-[26px] font-semibold ${project.factor >= 1 ? 'tone-good' : 'tone-bad'}`}>{project.factor.toFixed(2)}</div>
              <div className="text-[12px] text-[var(--text-muted)]">
                {project.factor >= 1
                  ? `Every hour built earns ${project.factor.toFixed(2)}. The team is ahead of the budget.`
                  : `Every hour built earns only ${project.factor.toFixed(2)}. ${fmtPct(1 - project.factor, 0)} of every hour is going in unrecovered.`}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]"><Term text="To complete" /></div>
              <div className="text-[26px] font-semibold">{fmtHours(project.hoursToComplete)} h</div>
              <div className="text-[12px] text-[var(--text-muted)]">{fmtHours(project.remainingHours)} h of budget left, at the rate achieved so far.</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]"><Term text="Forecast" /></div>
              <div className="text-[26px] font-semibold">{fmtHours(project.forecastTotalHours)} h</div>
              <div className="text-[12px] text-[var(--text-muted)]">Against a budget of {fmtHours(project.budgetHours)} h.</div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]"><Term text="At completion" /></div>
              <div className={`text-[26px] font-semibold tone-${varianceTone(project.varianceAtCompletion ?? 0)}`}>
                {(project.varianceAtCompletion ?? 0) >= 0 ? '+' : ''}
                {fmtHours(project.varianceAtCompletion)} h
              </div>
              <div className="text-[12px] text-[var(--text-muted)]">
                {(project.varianceAtCompletion ?? 0) >= 0 ? 'Forecast to come in under budget.' : 'The overrun if the current rate holds. Re-forecast.'}
              </div>
            </div>
          </div>
        </Panel>
      )}

      {chart.length > 0 && (
        <Panel title="Month by month" meta="Bars are the month; lines are cumulative. Where the red line sits above the blue one, the job has spent more than it has earned." className="mb-3">
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chart} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={60} />
                <ReferenceLine y={0} stroke={GRID} />
                <Tooltip
                  cursor={{ fill: 'rgba(15,17,21,0.04)' }}
                  content={({ active: on, payload, label }) => {
                    if (!on || !payload?.length) return null;
                    const d = payload[0].payload as { earned: number; built: number; cumEarned: number; cumBuilt: number };
                    const v = d.earned - d.built;
                    return (
                      <div style={{ background: '#fff', border: `1px solid ${GRID}`, borderRadius: 8, padding: '8px 11px', fontSize: 12, boxShadow: '0 6px 16px -8px rgba(15,17,21,0.2)' }}>
                        <div style={{ fontWeight: 600 }}>{String(label)}</div>
                        <div>Earned {fmtHours(d.earned)} h</div>
                        <div>Built {fmtHours(d.built)} h</div>
                        <div style={{ color: v >= 0 ? '#0d7a4f' : '#e60012', fontWeight: 600 }}>
                          {v >= 0 ? '+' : ''}{fmtHours(v)} h this month
                        </div>
                        <div style={{ color: AXIS, marginTop: 3 }}>
                          Cumulative {fmtHours(d.cumEarned)} earned / {fmtHours(d.cumBuilt)} built
                        </div>
                      </div>
                    );
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="earned" name="Earned" fill={EARNED} radius={[3, 3, 0, 0]} legendType="square" />
                <Bar dataKey="built" name="Built" fill={BUILT} radius={[3, 3, 0, 0]} legendType="square" />
                <Line dataKey="cumEarned" name="Cumulative earned" stroke={EARNED} strokeWidth={2} dot={false} legendType="plainline" />
                <Line dataKey="cumBuilt" name="Cumulative built" stroke={BUILT} strokeWidth={2} strokeDasharray="5 3" dot={false} legendType="plainline" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {burn.months.length > 0 && (
        <Panel
          title="Every month"
          meta={
            quiet > 0 || hideQuiet ? (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={hideQuiet} onChange={(e) => setHideQuiet(e.target.checked)} />
                Hide the {quiet > 0 ? quiet : ''} months with nothing earned and nothing built
              </label>
            ) : undefined
          }
          className="mb-3"
        >
          <SortableTable rows={shownMonths} columns={monthColumns} rowKey={(r) => r.month} defaultSort={{ key: 'month', dir: 'asc' }} maxHeight="340px" />
        </Panel>
      )}

      {openedMonth && (
        <Panel title={`${monthLabel(openedMonth.month)} by subsystem`} className="mb-3">
          <SortableTable
            rows={openedMonth.bySubsystem}
            columns={[
              { key: 'code', label: 'Subsystem', value: (c) => c.label, render: (c) => <span className="mono">{c.code || 'Unassigned'}</span> },
              { key: 'earned', label: 'Earned h', value: (c) => c.earned, num: true, render: (c) => fmtHours(c.earned) },
              { key: 'built', label: 'Built h', value: (c) => c.built, num: true, render: (c) => fmtHours(c.built) },
              { key: 'variance', label: 'Variance', value: (c) => c.variance, num: true, render: (c) => <span className={`tone-${varianceTone(c.variance)} font-semibold`}>{c.variance >= 0 ? '+' : ''}{fmtHours(c.variance)}</span> },
              { key: 'factor', label: 'Factor', value: (c) => c.factor ?? null, num: true, render: (c) => (c.factor === null ? <span className="text-[var(--text-subtle)]">—</span> : c.factor.toFixed(2)) },
            ]}
            rowKey={(c) => c.code || '(unassigned)'}
            defaultSort={{ key: 'built', dir: 'desc' }}
            maxHeight="260px"
          />
        </Panel>
      )}

      {burn.totalBuilt > 0 && (
        <Panel title="Forecast by subsystem" meta="Each group at its own rate, so the one in trouble is not hidden by the ones that are fine." className="mb-3">
          <SortableTable rows={burn.bySubsystem} columns={forecastColumns} rowKey={(r) => r.code || '(unassigned)'} defaultSort={{ key: 'budget', dir: 'desc' }} maxHeight="320px" />
        </Panel>
      )}

      {/* --- getting the data in --- */}
      <Panel title="Add the hours your team built" className="mb-3">
        {pending ? (
          <div className="space-y-2">
            <Notice tone="info">{pending.note} {pending.rows.length} rows, {pending.months.length} months{pending.skipped ? `, ${pending.skipped} cells skipped` : ''}.</Notice>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span>The <b>{pending.labelHeader || 'first'}</b> column is a</span>
              <select className="input" value={labelsAre} onChange={(e) => setLabelsAre(e.target.value as 'subsystem' | 'person')}>
                <option value="subsystem">subsystem</option>
                <option value="person">person</option>
              </select>
              {labelsAre === 'person' && (
                <>
                  <span>working under</span>
                  <input className="input w-40" list="team-subsystems" placeholder="leave blank for Unassigned" value={pendingSubsystem} onChange={(e) => setPendingSubsystem(e.target.value)} />
                </>
              )}
            </div>
            <div className="table-wrap" style={{ maxHeight: 200 }}>
              <table className="tbl">
                <thead><tr><th>Month</th><th>{labelsAre === 'subsystem' ? 'Subsystem' : 'Person'}</th><th className="text-right">Built h</th></tr></thead>
                <tbody>
                  {pending.rows.slice(0, 40).map((r, i) => (
                    <tr key={i}><td className="mono">{r.month}</td><td>{r.label || <span className="text-[var(--text-subtle)]">(blank)</span>}</td><td className="text-right">{fmtHours(r.hours)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pending.rows.length > 40 && <div className="text-[11px] text-[var(--text-muted)]">Showing the first 40 of {pending.rows.length}.</div>}
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={applyPending}>Add {pending.rows.length} rows</button>
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-[var(--text-muted)]">
              Paste straight from your team build sheet. Months across the top with people or groups down the side reads fine, and so does one row per month. The month can
              be written any way you like — <span className="mono">Aug-26</span>, <span className="mono">2026-08</span>, <span className="mono">August 2026</span>.
              Pasting the same month twice replaces it rather than doubling it.
            </p>
            <textarea
              className="input mt-2 h-28 w-full font-mono text-[11px]"
              placeholder={'Resource group\tJun-26\tJul-26\tAug-26\nATS\t420\t500\t610\nIXL\t300\t310\t280'}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="mt-2 flex flex-wrap gap-2">
              <button className="btn" disabled={!paste.trim()} onClick={loadPaste}>Read pasted hours</button>
              <button className="btn" onClick={() => commit([{ month: new Date().toISOString().slice(0, 7), subsystem: knownSubsystems[0] ?? '', hours: 0 }])}>
                Add a row by hand
              </button>
            </div>
          </>
        )}
      </Panel>

      {keyed.length > 0 && (
        <Panel title="Hours keyed" meta={`${keyed.length} rows, ${fmtHours(burn.totalBuilt)} h`}>
          <SortableTable rows={keyed} columns={keyedColumns} rowKey={(r) => r.id} defaultSort={{ key: 'month', dir: 'desc' }} maxHeight="360px" />
        </Panel>
      )}
    </Page>
  );
}

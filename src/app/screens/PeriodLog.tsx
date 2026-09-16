import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useApp } from '../state';
import { Page, SortableTable, Panel, Notice, Badge, type Column, type HeroStat } from '../components/ui';
import { periodLog, addDays, OUTCOMES, type PeriodActivity, type PeriodOutcome } from '../../engine/period';
import { fmtHours, fmtPct, fmtDate, todayISO } from '../format';
import { isValidISO } from '../../engine/dates';
import { href } from '../router';

/*
 * Planned against achieved, in the two colours the S-curve already uses for the
 * same two ideas: green is earned everywhere in this app, and violet is the
 * planned reference. The pair was checked for colour-vision separation rather than
 * picked by eye — blue and green, the obvious choice, are almost identical under
 * tritanopia.
 */
const PLANNED = '#6d28d9';
const ACHIEVED = '#00875a';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

/** How each outcome reads: its tone, and a word that does not rely on the colour. */
const OUTCOME_META: Record<PeriodOutcome, { tone: 'good' | 'info' | 'warn' | 'bad' | 'muted'; blurb: string }> = {
  COMPLETED: { tone: 'good', blurb: 'Reached 100% inside the period.' },
  STARTED: { tone: 'info', blurb: 'Began inside the period and is still running.' },
  CONTINUED: { tone: 'info', blurb: 'Began earlier, still running, and earned hours in the period.' },
  MISSED: { tone: 'bad', blurb: 'The baseline had these finishing inside the period. They did not finish.' },
  'NOT STARTED': { tone: 'muted', blurb: 'The baseline had these starting inside the period. They never started.' },
};

/** The chart's legend, in the same order as the key beside it. */
function ChartKey() {
  return (
    <div className="flex justify-center gap-4 pt-1 text-[11px] text-[var(--text-muted)]">
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: PLANNED }} /> Planned
      </span>
      <span className="flex items-center gap-1.5">
        <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: ACHIEVED }} /> Achieved
      </span>
    </div>
  );
}

/** A fortnight ending on the data date is the review everybody actually holds. */
function defaultEnd(dataDate: string): string {
  return isValidISO(dataDate) ? dataDate : todayISO();
}

export function PeriodLog() {
  const { state, model, actions } = useApp();
  const [end, setEnd] = useState(() => defaultEnd(state.data.settings.dataDate));
  const [span, setSpan] = useState(14);
  const [outcome, setOutcome] = useState<PeriodOutcome | ''>('');

  const from = addDays(end, -(span - 1));
  const log = useMemo(() => periodLog(model.rows, from, end), [model.rows, from, end]);

  const shown = useMemo(
    () => (outcome ? log.activities.filter((a) => a.outcome === outcome) : log.activities),
    [log.activities, outcome],
  );

  const chart = log.slices.map((s) => ({
    label: s.label,
    range: `${fmtDate(s.from)} – ${fmtDate(s.to)}`,
    planned: Math.round(s.planned),
    achieved: Math.round(s.earned),
  }));

  const variance = log.earnedHours - log.plannedHours;
  const heroStats: HeroStat[] = [
    { label: 'Planned', value: `${fmtHours(log.plannedHours)} h`, tone: 'muted' },
    { label: 'Achieved', value: `${fmtHours(log.earnedHours)} h`, tone: 'good' },
    {
      label: 'Of plan',
      value: log.achievement === null ? '—' : fmtPct(log.achievement, 0),
      tone: log.achievement === null ? 'muted' : log.achievement >= 1 ? 'good' : log.achievement >= 0.8 ? 'amber' : 'red',
    },
    { label: 'Project', value: fmtPct(log.pctAtEnd, 1), tone: 'blue' },
  ];

  /**
   * The log as text, for the person who has to paste this into an email on Friday.
   * Everything on screen, nothing that needs the screen to make sense of it.
   */
  const asText = () => {
    const lines = [
      `T&C two-week log: ${fmtDate(log.from)} to ${fmtDate(log.to)} (${log.days} days)`,
      '',
      `Planned    ${fmtHours(log.plannedHours)} h`,
      `Achieved   ${fmtHours(log.earnedHours)} h  (${log.achievement === null ? 'nothing was planned' : `${fmtPct(log.achievement, 0)} of plan`})`,
      `Variance   ${variance >= 0 ? '+' : ''}${fmtHours(variance)} h`,
      `Project    ${fmtPct(log.pctAtStart, 1)} -> ${fmtPct(log.pctAtEnd, 1)} complete`,
      `Due to finish in the period: ${log.dueToFinish}; actually finished: ${log.finishedOnTime}`,
      '',
    ];
    for (const o of OUTCOMES) {
      const list = log.activities.filter((a) => a.outcome === o);
      if (!list.length) continue;
      lines.push(`${o} (${list.length})`);
      for (const a of list) {
        lines.push(`  ${a.activityId}  ${a.activityName}  ${fmtPct(a.pctComplete, 0)}  ${fmtHours(a.earnedHours, 1)} h earned`);
      }
      lines.push('');
    }
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text).then(
      () => actions.notify('ok', 'Two-week log copied. Paste it into your report.'),
      () => actions.notify('error', 'The browser would not give access to the clipboard.'),
    );
  };

  const columns: Column<PeriodActivity>[] = [
    {
      key: 'id',
      label: 'Activity',
      locked: true,
      value: (a) => a.activityId,
      render: (a) => (
        <div className="min-w-0">
          <div className="mono text-[var(--text-muted)]">{a.activityId}</div>
          <div className="max-w-[24rem] truncate font-semibold" title={a.activityName}>{a.activityName}</div>
        </div>
      ),
    },
    {
      key: 'outcome',
      label: 'Outcome',
      value: (a) => OUTCOMES.indexOf(a.outcome),
      hint: 'What became of this activity inside the period, judged against the baseline dates.',
      render: (a) => <Badge tone={OUTCOME_META[a.outcome].tone}>{a.outcome}</Badge>,
    },
    { key: 'phase', label: 'Phase', value: (a) => a.phaseName, optional: true },
    { key: 'loc', label: 'Loc', value: (a) => a.location },
    {
      key: 'planned',
      label: 'Planned h',
      value: (a) => a.plannedHours,
      num: true,
      hint: 'Budget hours the baseline expected this activity to accrue inside the period.',
      render: (a) => <span className="text-[var(--text-muted)]">{fmtHours(a.plannedHours, 1)}</span>,
    },
    {
      key: 'earned',
      label: 'Achieved h',
      value: (a) => a.earnedHours,
      num: true,
      hint: 'Budget hours actually earned inside the period.',
      render: (a) => <b>{fmtHours(a.earnedHours, 1)}</b>,
    },
    {
      key: 'pct',
      label: '% complete',
      value: (a) => a.pctComplete,
      num: true,
      width: '150px',
      render: (a) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-9 text-right tabular-nums font-semibold">{fmtPct(a.pctComplete, 0)}</span>
          <div className="bar" style={{ width: 60 }} title={`${fmtPct(a.pctComplete, 1)} of ${fmtHours(a.budgetHours)} h`}>
            <span style={{ width: `${Math.min(100, Math.round(a.pctComplete * 100))}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'budget', label: 'Budget h', value: (a) => a.budgetHours, num: true, optional: true, render: (a) => fmtHours(a.budgetHours) },
    { key: 'bls', label: 'BL start', value: (a) => a.baselineStart, optional: true, render: (a) => fmtDate(a.baselineStart) },
    { key: 'blf', label: 'BL finish', value: (a) => a.baselineFinish, render: (a) => fmtDate(a.baselineFinish) },
    { key: 'as', label: 'Actual start', value: (a) => a.actualStart, render: (a) => fmtDate(a.actualStart) },
    { key: 'af', label: 'Actual finish', value: (a) => a.actualFinish, render: (a) => fmtDate(a.actualFinish) },
    {
      key: 'var',
      label: 'Days late',
      value: (a) => a.finishVarianceDays,
      num: true,
      hint: 'Actual finish minus baseline finish, in calendar days. Negative is early. Blank until it finishes.',
      render: (a) =>
        a.finishVarianceDays === null ? (
          <span className="text-[var(--text-subtle)]">—</span>
        ) : (
          <span className={`font-semibold tone-${a.finishVarianceDays > 0 ? 'bad' : a.finishVarianceDays < 0 ? 'good' : 'muted'}`}>
            {a.finishVarianceDays > 0 ? '+' : ''}{a.finishVarianceDays}
          </span>
        ),
    },
    {
      key: 'tests',
      label: 'Tests',
      value: (a) => a.testsTotal,
      num: true,
      optional: true,
      render: (a) => (a.testsTotal ? `${a.testsComplete ?? 0}/${a.testsTotal}` : <span className="text-[var(--text-subtle)]">—</span>),
    },
  ];

  const step = (n: number) => setEnd((e) => addDays(e, n * span));
  const achievedPctWidth = log.achievement === null ? 0 : Math.min(100, Math.round(log.achievement * 100));

  return (
    <Page
      eyebrow="Progress"
      title="Two-Week Log"
      subtitle={`${fmtDate(log.from)} to ${fmtDate(log.to)}. What the baseline said would happen in this window, what actually happened, and which activities are behind it. Hours are measured exactly as the S-curve measures them, so every window adds back to the same total.`}
      stats={heroStats}
      actions={
        <>
          <button className="btn btn-mini" onClick={asText}>Copy as text</button>
          <a className="btn btn-mini" href={href('budget')}>Budget Master</a>
        </>
      }
      toolbar={
        <>
          <button className="btn btn-mini" onClick={() => step(-1)} title="The period before this one">← Previous</button>
          <label className="flex items-center gap-1.5 text-[12px]">
            <span className="text-[var(--text-muted)]">Ending</span>
            <input className="input" type="date" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </label>
          <button className="btn btn-mini" onClick={() => step(1)} title="The period after this one">Next →</button>
          <select className="input" value={span} onChange={(e) => setSpan(Number(e.target.value))}>
            <option value={7}>1 week</option>
            <option value={14}>2 weeks</option>
            <option value={28}>4 weeks</option>
          </select>
          {isValidISO(state.data.settings.dataDate) && end !== state.data.settings.dataDate && (
            <button className="btn btn-mini" onClick={() => setEnd(state.data.settings.dataDate)}>Back to the data date</button>
          )}
          <select className="input" value={outcome} onChange={(e) => setOutcome(e.target.value as PeriodOutcome | '')}>
            <option value="">All outcomes</option>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>{o} ({log.counts[o]})</option>
            ))}
          </select>
          <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">{shown.length} of {log.activities.length} activities</span>
        </>
      }
    >
      {!isValidISO(state.data.settings.dataDate) && (
        <div className="mb-3">
          <Notice tone="warn">
            No data date is set in <a href={href('settings')}>Settings</a>, so an activity that has started but not finished cannot earn and this log will read low. Set it
            to the date the current schedule was run.
          </Notice>
        </div>
      )}

      {end > (state.data.settings.dataDate || '') && isValidISO(state.data.settings.dataDate) && (
        <div className="mb-3">
          <Notice tone="info">
            This period runs past the data date ({fmtDate(state.data.settings.dataDate)}). Nothing can be earned after that date, so the achieved figure covers only the
            part of the window that has actually happened.
          </Notice>
        </div>
      )}

      {/* --- the answer, before the detail --- */}
      <Panel className="mb-3" title="Planned against achieved" meta={`${log.days} days`}>
        <div className="grid gap-4 lg:grid-cols-[1fr_340px] lg:gap-8">
          <div>
            <div className="plan-bar">
              <div className="plan-bar-row">
                <span className="plan-bar-key"><i style={{ background: PLANNED }} /> Planned</span>
                <div className="plan-bar-track">
                  <span style={{ width: '100%', background: PLANNED }} />
                </div>
                <span className="plan-bar-val">{fmtHours(log.plannedHours)} h</span>
              </div>
              <div className="plan-bar-row">
                <span className="plan-bar-key"><i style={{ background: ACHIEVED }} /> Achieved</span>
                <div className="plan-bar-track">
                  <span style={{ width: `${achievedPctWidth}%`, background: ACHIEVED }} />
                </div>
                <span className="plan-bar-val">{fmtHours(log.earnedHours)} h</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
              <span>
                <b className={`text-[20px] ${variance >= 0 ? 'tone-good' : 'tone-bad'}`}>
                  {variance >= 0 ? '+' : ''}{fmtHours(variance)} h
                </b>
                <span className="ml-1.5 text-[var(--text-muted)]">against plan</span>
              </span>
              <span className="text-[var(--text-muted)]">
                Project moved <b className="text-[var(--text)]">{fmtPct(log.pctAtStart, 1)}</b> → <b className="text-[var(--text)]">{fmtPct(log.pctAtEnd, 1)}</b>
                {' '}(<b className="text-[var(--text)]">{fmtPct(log.pctAtEnd - log.pctAtStart, 2)}</b> of the whole job in this window)
              </span>
              <span className="text-[var(--text-muted)]">
                Due to finish <b className="text-[var(--text)]">{log.dueToFinish}</b>, finished <b className="text-[var(--text)]">{log.finishedOnTime}</b>
                {log.dueToFinish > 0 && <> (<b className="text-[var(--text)]">{fmtPct(log.finishedOnTime / log.dueToFinish, 0)}</b>)</>}
              </span>
            </div>
          </div>

          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={44} />
                <Tooltip
                  cursor={{ fill: 'rgba(15,17,21,0.04)' }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const d = payload[0].payload as (typeof chart)[number];
                    const v = d.achieved - d.planned;
                    return (
                      <div style={{ background: '#fff', border: `1px solid ${GRID}`, borderRadius: 8, padding: '8px 11px', fontSize: 12, boxShadow: '0 6px 16px -8px rgba(15,17,21,0.2)' }}>
                        <div style={{ fontWeight: 600 }}>{d.label}</div>
                        <div style={{ color: AXIS }}>{d.range}</div>
                        <div style={{ marginTop: 3 }}>Planned {fmtHours(d.planned)} h</div>
                        <div>Achieved {fmtHours(d.achieved)} h</div>
                        <div style={{ fontWeight: 600, color: v >= 0 ? ACHIEVED : '#c01017' }}>{v >= 0 ? '+' : ''}{fmtHours(v)} h</div>
                      </div>
                    );
                  }}
                />
                {/* Its own markup, because Recharts does not guarantee the legend
                    order matches the bars, and reading Achieved-then-Planned here
                    while the key to the left reads the other way is a needless
                    stumble over the same two series. */}
                <Legend content={() => <ChartKey />} />
                <Bar dataKey="planned" name="Planned" fill={PLANNED} radius={[4, 4, 0, 0]} legendType="square" />
                <Bar dataKey="achieved" name="Achieved" fill={ACHIEVED} radius={[4, 4, 0, 0]} legendType="square" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </Panel>

      {/* --- outcome tiles: clickable filters, never colour alone --- */}
      <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {OUTCOMES.map((o) => (
          <button
            key={o}
            className={`outcome-tile tone-${OUTCOME_META[o].tone}${outcome === o ? ' is-on' : ''}`}
            title={OUTCOME_META[o].blurb}
            onClick={() => setOutcome(outcome === o ? '' : o)}
          >
            <span className="outcome-tile-n">{log.counts[o]}</span>
            <span className="outcome-tile-l">{o}</span>
          </button>
        ))}
      </div>

      {log.activities.length === 0 ? (
        <Notice tone="info">
          Nothing was planned and nothing happened between {fmtDate(log.from)} and {fmtDate(log.to)}. Step back with <b>← Previous</b>, or widen the period.
        </Notice>
      ) : (
        <SortableTable
          tableId="period-log"
          rows={shown}
          columns={columns}
          rowKey={(a) => a.activityId}
          defaultSort={{ key: 'outcome', dir: 'asc' }}
          maxHeight="calc(100vh - 560px)"
          rowClass={(a) => (a.outcome === 'MISSED' ? 'row-bad' : a.outcome === 'NOT STARTED' ? 'row-muted' : '')}
        />
      )}

      <Panel title="How this log is worked out" className="mt-3">
        <p className="text-[12px] text-[var(--text-muted)]">
          <b>Planned</b> is what the baseline said would accrue between these dates; <b>achieved</b> is what actually earned in them. Both spread an activity's hours
          evenly across its window by calendar day, exactly as the S-curve does, so every two-week window adds back to the same totals the curve draws — this screen can
          never disagree with the Dashboard.
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          An activity appears here if it did something in the window <i>or was supposed to</i>. That is what makes <b>NOT STARTED</b> and <b>MISSED</b> meaningful: they
          are the activities the plan was counting on. <b>MISSED</b> beats <b>STARTED</b> and <b>CONTINUED</b> deliberately — an activity that was due to finish here and
          did not is late, whatever else it also did. Activities with progress but no usable dates earn hours that belong to no window at all; the{' '}
          <a href={href('team')}>Earned vs Built</a> screen reports that figure.
        </p>
      </Panel>
    </Page>
  );
}

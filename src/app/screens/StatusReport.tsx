import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Page, Panel, Notice } from '../components/ui';
import { CurveChart } from '../components/CurveChart';
import { buildCurve, rowTotals } from '../../engine/compute';
import { periodLog, addDays, OUTCOMES, type PeriodOutcome } from '../../engine/period';
import { trendFrom } from '../../engine/trend';
import { effectiveReasonFor } from '../missedReasons';
import { fmtHours, fmtPct, fmtDate, todayISO } from '../format';
import { isValidISO } from '../../engine/dates';
import { useUnit } from '../units';
import type { GroupStat } from '../../engine/types';

/** Phase codes sort numerically, as they do on the dashboard. */
function phaseOrder(key: string): number {
  const m = /^P(\d+)$/i.exec(key.trim());
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

const OUTCOME_TONE: Record<PeriodOutcome, string> = {
  COMPLETED: 'tone-good',
  'COMPLETED EARLY': 'tone-good',
  STARTED: '',
  CONTINUED: '',
  MISSED: 'tone-bad',
  'NOT STARTED': 'tone-muted',
};

/** A figure and its label, as the report prints them. */
function Fig({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rep-fig">
      <div className="rep-fig-label">{label}</div>
      <div className={`rep-fig-value ${tone ?? ''}`}>{value}</div>
    </div>
  );
}

/**
 * The status report.
 *
 * One page to hand to somebody who was not at the review. What goes on it is a
 * choice rather than a fixed layout, because the audience changes: a phase lead
 * wants their own curve and the fortnight's misses, a programme meeting wants the
 * whole job and nothing else.
 *
 * The report deliberately carries almost no prose. Everything in the application
 * explains itself as you work; a printed page has to be read at a glance by someone
 * who will not hover anything, so it states figures and names, and leaves the
 * explaining to whoever is presenting it.
 */
export function StatusReport() {
  const { state, model } = useApp();
  const { percent } = useUnit();
  const reportRef = useRef<HTMLDivElement>(null);

  const dataDate = state.data.settings.dataDate || null;
  const cadence = state.data.settings.curveCadence ?? 'month';

  const phases: GroupStat[] = useMemo(
    () =>
      [...model.groups.phase]
        .filter((g) => g.inBudget > 0)
        .sort((a, b) => phaseOrder(a.key) - phaseOrder(b.key) || a.label.localeCompare(b.label)),
    [model.groups.phase],
  );

  // --- what goes on the page -------------------------------------------------
  /** '' is the whole project; otherwise a phase key. Order is the print order. */
  const [charts, setCharts] = useState<string[]>(['']);
  const [showPhaseTable, setShowPhaseTable] = useState(true);
  const [showLog, setShowLog] = useState(true);
  const [showLogActivities, setShowLogActivities] = useState(true);
  const [logOutcomes, setLogOutcomes] = useState<PeriodOutcome[]>(['MISSED', 'COMPLETED']);
  const [showReasons, setShowReasons] = useState(true);
  const [showTrend, setShowTrend] = useState(true);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const [end, setEnd] = useState(isValidISO(dataDate ?? '') ? (dataDate as string) : todayISO());
  const [span, setSpan] = useState(14);

  const toggleChart = (key: string) =>
    setCharts((cs) => (cs.includes(key) ? cs.filter((c) => c !== key) : [...cs, key]));
  const toggleOutcome = (o: PeriodOutcome) =>
    setLogOutcomes((os) => (os.includes(o) ? os.filter((x) => x !== o) : [...os, o]));

  // --- the figures -----------------------------------------------------------
  const totals = useMemo(() => rowTotals(model.rows), [model.rows]);
  const trend = useMemo(() => trendFrom(model.burn.months, model.burn.project.budgetHours), [model.burn]);

  const from = addDays(end, -(span - 1));
  const log = useMemo(() => periodLog(model.rows, from, end), [model.rows, from, end]);

  /** One curve per chosen selection, in the order they were chosen. */
  const curves = useMemo(
    () =>
      charts.map((key) => {
        const rows = key === '' ? model.rows : model.rows.filter((r) => r.phase === key);
        const label = key === '' ? 'Whole project' : (phases.find((p) => p.key === key)?.label ?? key);
        return { key, label, curve: buildCurve(rows, dataDate, cadence).curve, totals: rowTotals(rows) };
      }),
    [charts, model.rows, phases, dataDate, cadence],
  );

  const logRows = useMemo(
    () => log.activities.filter((a) => logOutcomes.includes(a.outcome)),
    [log.activities, logOutcomes],
  );

  const reasons = useMemo(() => {
    const missed = log.activities.filter((a) => a.outcome === 'MISSED');
    const tally = new Map<string, number>();
    for (const a of missed) {
      const r = effectiveReasonFor(state.data.missedReasons, a.activityId, end)?.entry.reason ?? 'No reason given';
      tally.set(r, (tally.get(r) ?? 0) + 1);
    }
    return [...tally.entries()].sort((a, b) => b[1] - a[1]);
  }, [log.activities, state.data.missedReasons, end]);

  const heading = title.trim() || 'Testing and Commissioning — Status Report';

  return (
    <Page
      eyebrow="Progress"
      title="Status Report"
      subtitle="One page to hand over. Choose what goes on it, then print or save as PDF."
      actions={
        <button className="btn btn-primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
      }
    >
      {/* ---------- the builder. Never printed. ---------- */}
      <Panel title="What goes on the page" className="mb-4 no-print">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Curves</div>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <button className={`btn btn-mini${charts.includes('') ? ' btn-primary' : ''}`} onClick={() => toggleChart('')}>
                Whole project
              </button>
              {phases.map((p) => (
                <button key={p.key} className={`btn btn-mini${charts.includes(p.key) ? ' btn-primary' : ''}`} onClick={() => toggleChart(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-1.5 text-[11.5px] text-[var(--text-subtle)]">
              {charts.length === 0 ? 'No curve on the page.' : `${charts.length} ${charts.length === 1 ? 'curve' : 'curves'}, in the order picked.`}
              {' '}Reported in {percent ? 'percent' : 'man hours'} — switch on the Dashboard.
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Two-Week Log</div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showLog} onChange={(e) => setShowLog(e.target.checked)} /> Include
              </label>
              <span className="text-[var(--text-muted)]">ending</span>
              <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!showLog} />
              <select className="input" value={span} onChange={(e) => setSpan(Number(e.target.value))} disabled={!showLog}>
                <option value={7}>1 week</option>
                <option value={14}>2 weeks</option>
                <option value={28}>4 weeks</option>
              </select>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showLogActivities} onChange={(e) => setShowLogActivities(e.target.checked)} disabled={!showLog} /> Activities
              </label>
              {OUTCOMES.map((o) => (
                <button
                  key={o}
                  className={`btn btn-mini${logOutcomes.includes(o) ? ' btn-primary' : ''}`}
                  disabled={!showLog || !showLogActivities}
                  onClick={() => toggleOutcome(o)}
                >
                  {o}
                </button>
              ))}
            </div>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showReasons} onChange={(e) => setShowReasons(e.target.checked)} disabled={!showLog} /> Why activities were missed
              </label>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Also include</div>
            <div className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showPhaseTable} onChange={(e) => setShowPhaseTable(e.target.checked)} /> Progress by phase
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showTrend} onChange={(e) => setShowTrend(e.target.checked)} /> Direction of travel
              </label>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Heading</div>
            <input className="input mt-1.5 w-full" placeholder="Testing and Commissioning — Status Report" value={title} onChange={(e) => setTitle(e.target.value)} />
            <input className="input mt-1.5 w-full" placeholder="A line under the heading, if one is needed" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
      </Panel>

      {!state.data.current && (
        <div className="no-print">
          <Notice tone="info">No schedule is imported, so there is nothing to report.</Notice>
        </div>
      )}

      {/* ---------- the page itself ---------- */}
      <div className="report" ref={reportRef}>
        <header className="rep-head">
          <div>
            <h1 className="rep-title">{heading}</h1>
            {note.trim() && <div className="rep-sub">{note.trim()}</div>}
          </div>
          <div className="rep-meta">
            <div>Data date {dataDate ? fmtDate(dataDate) : 'not set'}</div>
            <div>Issued {fmtDate(todayISO())}</div>
          </div>
        </header>

        <section className="rep-figs">
          <Fig label="Complete" value={fmtPct(totals.pctComplete, 1)} />
          {!percent && <Fig label="Budget" value={`${fmtHours(totals.budgetHours)} h`} />}
          {!percent && <Fig label="Earned" value={`${fmtHours(totals.earnedHours)} h`} />}
          {!percent && <Fig label="Remaining" value={`${fmtHours(totals.remainingHours)} h`} />}
          <Fig label="Activities finished" value={`${totals.finished}/${totals.inBudget}`} />
          {model.burn.project.factor !== null && (
            <Fig
              label="Earned per hour spent"
              value={model.burn.project.factor.toFixed(2)}
              tone={model.burn.project.factor >= 1 ? 'tone-good' : 'tone-bad'}
            />
          )}
        </section>

        {showTrend && trend.points.length >= 2 && (
          <section className="rep-figs rep-figs-tight">
            <Fig label="Factor, last 3 months" value={trend.recentFactor === null ? '—' : trend.recentFactor.toFixed(2)} />
            <Fig label="Previous 3" value={trend.priorFactor === null ? '—' : trend.priorFactor.toFixed(2)} />
            <Fig label="Progress a month" value={trend.recentPctPerMonth === null ? '—' : fmtPct(trend.recentPctPerMonth, 2)} />
            <Fig label="At this pace" value={trend.monthsToFinish === null ? '—' : `${Math.ceil(trend.monthsToFinish)} months`} />
          </section>
        )}

        {curves.map((c) => (
          <section key={c.key} className="rep-block">
            <h2 className="rep-h2">
              {c.label}
              <span className="rep-h2-note">
                {fmtPct(c.totals.pctComplete, 1)} complete
                {!percent && <> · {fmtHours(c.totals.earnedHours)} of {fmtHours(c.totals.budgetHours)} h</>}
              </span>
            </h2>
            {c.curve.length ? (
              <CurveChart curve={c.curve} dataDate={dataDate} percent={percent} total={c.totals.budgetHours} monthly={cadence === 'month'} height={230} />
            ) : (
              <div className="rep-empty">No dated activities to plot.</div>
            )}
          </section>
        ))}

        {showPhaseTable && phases.length > 0 && (
          <section className="rep-block">
            <h2 className="rep-h2">Progress by phase</h2>
            <table className="rep-table">
              <thead>
                <tr>
                  <th>Phase</th>
                  {!percent && <th className="num">Earned</th>}
                  {!percent && <th className="num">Budget</th>}
                  <th className="num">Complete</th>
                  <th className="num">Finished</th>
                  <th className="num">Running</th>
                  <th className="num">Not started</th>
                </tr>
              </thead>
              <tbody>
                {phases.map((p) => (
                  <tr key={p.key}>
                    <td>{p.label}</td>
                    {!percent && <td className="num">{fmtHours(p.earnedHours)}</td>}
                    {!percent && <td className="num">{fmtHours(p.budgetHours)}</td>}
                    <td className="num">{fmtPct(p.pctComplete, 1)}</td>
                    <td className="num">{p.finished}</td>
                    <td className="num">{p.inProgress}</td>
                    <td className="num">{p.notStarted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {showLog && (
          <section className="rep-block">
            <h2 className="rep-h2">
              Period {fmtDate(from)} to {fmtDate(end)}
              <span className="rep-h2-note">
                {log.achievement === null ? 'nothing was planned' : `${fmtPct(log.achievement, 0)} of plan`}
                {!percent && <> · {fmtHours(log.earnedHours)} of {fmtHours(log.plannedHours)} h</>}
                {' · '}
                {fmtPct(log.pctAtStart, 1)} → {fmtPct(log.pctAtEnd, 1)}
              </span>
            </h2>

            <div className="rep-counts">
              {OUTCOMES.filter((o) => log.counts[o] > 0).map((o) => (
                <span key={o} className="rep-count">
                  <b className={OUTCOME_TONE[o]}>{log.counts[o]}</b> {o.toLowerCase()}
                </span>
              ))}
              <span className="rep-count">
                <b>{log.finishedOnTime}</b> of <b>{log.dueToFinish}</b> due finishes made
              </span>
            </div>

            {showReasons && reasons.length > 0 && (
              <table className="rep-table rep-table-tight">
                <thead>
                  <tr><th>Why activities were missed</th><th className="num">Activities</th></tr>
                </thead>
                <tbody>
                  {reasons.map(([r, n]) => (
                    <tr key={r}><td>{r}</td><td className="num">{n}</td></tr>
                  ))}
                </tbody>
              </table>
            )}

            {showLogActivities && (
              logRows.length === 0 ? (
                <div className="rep-empty">No activities in the chosen outcomes.</div>
              ) : (
                <table className="rep-table">
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Phase</th>
                      <th>Outcome</th>
                      {!percent && <th className="num">Earned</th>}
                      <th className="num">Complete</th>
                      <th>Baseline finish</th>
                      <th>Actual finish</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logRows.map((a) => (
                      <tr key={a.activityId}>
                        <td>
                          <span className="rep-id">{a.activityId}</span>
                          <span className="rep-name">{a.activityName}</span>
                        </td>
                        <td>{a.phaseName}</td>
                        <td className={OUTCOME_TONE[a.outcome]}>{a.outcome}</td>
                        {!percent && <td className="num">{fmtHours(a.earnedHours)}</td>}
                        <td className="num">{fmtPct(a.pctComplete, 0)}</td>
                        <td className="num">{fmtDate(a.baselineFinish)}</td>
                        <td className="num">{fmtDate(a.actualFinish)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </section>
        )}
      </div>
    </Page>
  );
}

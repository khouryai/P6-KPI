import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Page, Stat, Notice, Panel, type HeroStat } from '../components/ui';
import { CurveChart } from '../components/CurveChart';
import { fmtHours, fmtPct, fmtDate } from '../format';
import type { GroupStat } from '../../engine/types';
import { buildCurve, rowTotals } from '../../engine/compute';
import { href } from '../router';
import { svgToPng, curveCsv, downloadBytes, stamp } from '../export';

/** Filenames have to survive a Windows folder, so anything but letters and digits goes. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function Dashboard() {
  const { state, model, actions } = useApp();
  const s = model.summary;
  const chartRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const dataDate = state.data.settings.dataDate || null;

  const phaseGroups: GroupStat[] = model.groups.phase.filter((g) => g.inBudget > 0);

  /**
   * Which phase the screen is showing. The whole project is the default, because the
   * first question is always "where is the job", not "where is Phase 2". A phase that
   * disappears on the next import falls back to the project rather than showing an
   * empty chart.
   */
  const [phase, setPhase] = useState<string | null>(null);
  const selected = phase !== null && phaseGroups.some((g) => g.key === phase) ? phase : null;
  const selectedLabel = selected === null ? null : (phaseGroups.find((g) => g.key === selected)?.label ?? selected);

  const rows = useMemo(() => (selected === null ? model.rows : model.rows.filter((r) => r.phase === selected)), [model.rows, selected]);
  const totals = useMemo(() => rowTotals(rows), [rows]);
  const curve = useMemo(
    () => (selected === null ? model.curve : buildCurve(rows, state.data.snapshots, dataDate).curve),
    [selected, model.curve, rows, state.data.snapshots, dataDate],
  );

  const exportPng = async () => {
    const chart = chartRef.current;
    if (!chart) return;
    setBusy(true);
    try {
      const bytes = await svgToPng(chart, {
        title: selectedLabel ? `Planned, forecast and earned man hours — ${selectedLabel}` : 'Planned, forecast and earned man hours',
        subtitle: `${fmtHours(totals.budgetHours)} h budget, ${fmtHours(totals.earnedHours)} h earned (${fmtPct(totals.pctComplete, 1)}).${dataDate ? ` Data date ${fmtDate(dataDate)}.` : ''}`,
      });
      const name = `s-curve-${selected === null ? 'project' : slug(selectedLabel!)}-${stamp()}.png`;
      if (state.adapterKind === 'filesystem') actions.notify('ok', `Chart written to ${await actions.writeExport(name, bytes)}`);
      else downloadBytes(name, bytes, 'image/png');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = async () => {
    const bytes = new TextEncoder().encode(curveCsv(curve));
    const name = `s-curve-${selected === null ? 'project' : slug(selectedLabel!)}-${stamp()}.csv`;
    try {
      if (state.adapterKind === 'filesystem') actions.notify('ok', `Curve data written to ${await actions.writeExport(name, bytes)}`);
      else downloadBytes(name, bytes, 'text/csv');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  const quality: { label: string; count: number; to: string; note: string }[] = [
    { label: 'Activities needing REVIEW', count: s.review, to: href('budget', { flag: 'review' }), note: 'No library key matched, so they budget zero hours. Price the type, or hide the activity.' },
    { label: 'Library types still on defaults', count: s.typesOnDefaults, to: href('library', { flag: 'default' }), note: 'Priced with Settings defaults until you set a rate.' },
    { label: 'RATE types missing a shift count', count: s.typesNeedingShifts, to: href('library', { flag: 'shifts' }), note: 'These silently budget zero hours.' },
    { label: 'Activities with no dates at all', count: s.noDates, to: href('budget', { flag: 'nodates' }), note: 'Hours count in the total but appear on no curve.' },
    { label: 'In-budget activities on no curve', count: s.onNoCurve, to: href('budget', { flag: 'nocurve' }), note: 'A start or finish is missing or unparseable on both schedules.' },
    { label: 'Baseline missing, using current dates', count: s.baselineFallback, to: href('budget', { flag: 'blcurrent' }), note: 'Plan equals forecast for these by default, not by agreement.' },
    { label: 'Percent complete still from P6 duration', count: s.pctFromP6, to: href('budget', { flag: 'pctp6' }), note: 'Add test case counts to move these to earned tests.' },
    { label: 'Test progress rows not matching an activity', count: s.testProgressNotMatching, to: href('progress', { flag: 'unmatched' }), note: 'Open the list: it says what each one is and whether losing it costs anything.' },
    { label: 'Your edits pointing at an activity that is gone', count: s.staleOverrides, to: href('budget'), note: 'Kept in case the Activity ID comes back. Doing nothing until it does.' },
  ];
  const attention = quality.reduce((n, q) => n + (q.count > 0 ? 1 : 0), 0);

  // What to do next, in the order it has to happen. Each step links to the screen
  // that resolves it, so the app tells you where to go rather than leaving you to
  // guess the order.
  const budgeted = model.rows.filter((r) => r.status === 'IN BUDGET');
  const covered = budgeted.filter((r) => r.hasTestCounts || r.pctSource === 'OVERRIDE').length;
  const steps: { title: string; note: string; done: boolean; optional?: boolean; to: string }[] = [
    {
      title: 'Import the current P6 schedule',
      note: state.data.current ? `${state.data.current.rowCount} rows from ${state.data.current.sourceFilename}` : 'Everything else derives from it',
      done: !!state.data.current,
      to: href('import'),
    },
    {
      title: 'Import the baseline schedule',
      note: state.data.baseline ? `${state.data.baseline.rowCount} rows` : 'Without it the planned curve just mirrors the forecast',
      done: !!state.data.baseline,
      to: href('import'),
    },
    {
      title: 'Set the data date',
      note: state.data.settings.dataDate ? fmtDate(state.data.settings.dataDate) : 'In-progress work cannot earn until this is set',
      done: !!state.data.settings.dataDate,
      to: href('settings'),
    },
    {
      title: 'Price the activity library',
      note:
        s.activityTypes === 0
          ? 'The types appear here once a schedule is imported'
          : s.typesNeedingShifts > 0
            ? `${s.typesNeedingShifts} RATE types budget zero hours until you set a shift count`
            : s.typesOnDefaults > 0
              ? `${s.typesOnDefaults} of ${s.activityTypes} types are still on Settings defaults`
              : `All ${s.activityTypes} types priced`,
      // An empty library is not a priced library.
      done: s.activityTypes > 0 && s.typesOnDefaults === 0 && s.typesNeedingShifts === 0,
      to: href('library', { flag: s.typesNeedingShifts > 0 ? 'shifts' : 'default' }),
    },
    {
      title: 'Key the test case counts',
      note:
        budgeted.length === 0
          ? 'Nothing budgeted yet'
          : covered === budgeted.length
            ? `All ${budgeted.length} budgeted activities covered`
            : `${covered} of ${budgeted.length} covered. The rest fall back to P6 duration`,
      done: budgeted.length > 0 && covered === budgeted.length,
      optional: true,
      to: href('progress', { flag: 'missing' }),
    },
    {
      title: 'Take a snapshot',
      note: s.latestStatusDate ? `Last taken for ${fmtDate(s.latestStatusDate)}` : 'Records percent complete for the audit trail',
      done: !!s.latestStatusDate,
      optional: true,
      to: href('snapshots'),
    },
  ];
  const outstanding = steps.filter((x) => !x.done);

  const heroStats: HeroStat[] = [
    { label: 'Activities', value: totals.inBudget, tone: 'muted' },
    { label: 'Locations', value: s.locations, tone: 'muted' },
    { label: 'Needs attention', value: attention, tone: attention > 0 ? 'amber' : 'good' },
  ];

  const summaryRows: [string, React.ReactNode][] = [
    ['Extract rows', s.extractRows],
    ['WBS summary rows (auto-excluded)', s.wbsRows],
    ['Real activities', s.activities],
    ['Locations discovered', s.locations],
    ['Activity types discovered', s.activityTypes],
    ['Activities in budget', s.inBudget],
    ['Excluded by library', s.excluded],
    ['Deleted or cancelled', s.deletedOrCancelled],
    ['Needing REVIEW', s.review],
    ['Hidden by you (in none of the above)', s.hidden],
    ['Renamed by you', s.renamed],
    ['Forced into the budget by you', s.forcedIn],
    ['Dates from baseline import', s.baselineMatched],
    ['Activities started, not finished', s.inProgress],
    ['Activities with P6 actual dates', s.p6Actual],
    ['Activities on a test window', s.testWindow],
    ['Activities not started', s.notStarted],
    ['Latest snapshot status date', s.latestStatusDate ? fmtDate(s.latestStatusDate) : 'none yet'],
  ];

  return (
    <Page
      eyebrow="Testing and Commissioning"
      title="Dashboard"
      subtitle={
        state.data.current
          ? `Current schedule imported ${fmtDate(state.data.current.importedAt.slice(0, 10))} from ${state.data.current.sourceFilename}. Data date ${dataDate ? fmtDate(dataDate) : 'not set'}.`
          : 'No schedule imported yet.'
      }
      stats={heroStats}
      actions={
        <>
          <button className="btn btn-mini" onClick={() => void exportCsv()} disabled={!curve.length}>
            Export curve CSV
          </button>
          <button className="btn btn-mini" onClick={() => void exportPng()} disabled={busy || !curve.length}>
            Export chart PNG
          </button>
        </>
      }
      toolbar={
        phaseGroups.length > 1 || selected !== null ? (
          <>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Show</span>
            <button className={`btn btn-mini${selected === null ? ' btn-primary' : ''}`} onClick={() => setPhase(null)}>
              Whole project
            </button>
            {phaseGroups.map((g) => (
              <button
                key={g.key}
                className={`btn btn-mini${selected === g.key ? ' btn-primary' : ''}`}
                title={`${fmtHours(g.budgetHours)} h budget across ${g.inBudget} activities`}
                onClick={() => setPhase(g.key)}
              >
                {g.label}
              </button>
            ))}
            {selected !== null && (
              <span className="text-[11.5px] text-[var(--text-muted)]">
                The cards and the curve below cover {selectedLabel} only. Data quality and the summary still count the whole project.
              </span>
            )}
          </>
        ) : undefined
      }
    >
      {outstanding.length > 0 && (
        <div className="mb-4">
          <Panel
            title="Next steps"
            meta={`${steps.length - outstanding.length} of ${steps.length} done`}
          >
            <div className="grid gap-x-8 md:grid-cols-2">
              {steps.map((x) => (
                <a key={x.title} href={x.to} className={`step ${x.done ? 'step-done' : x.optional ? 'step-opt' : 'step-todo'}`}>
                  <span className="step-mark">{x.done ? '✓' : x.optional ? '·' : '!'}</span>
                  <span className="min-w-0">
                    <span className="step-title">{x.title}</span>
                    <span className="step-note block">{x.note}</span>
                  </span>
                </a>
              ))}
            </div>
          </Panel>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label={selected === null ? 'Total budget' : `${selectedLabel} budget`} value={`${fmtHours(totals.budgetHours)} h`} sub={`${totals.inBudget} activities in budget`} primary />
        <Stat label="Earned" value={`${fmtHours(totals.earnedHours)} h`} tone="good" sub={`${totals.pctFromTests} from tests, ${totals.pctFromP6} from P6 duration`} />
        <Stat label="Remaining" value={`${fmtHours(totals.remainingHours)} h`} sub={`${totals.notStarted} activities not started`} />
        <Stat label="Percent complete" value={fmtPct(totals.pctComplete)} sub={`${totals.inProgress} in progress, ${totals.finished} finished`} />
      </div>

      <div className="mt-4">
        <Panel
          title={selected === null ? 'Planned, forecast and earned man hours' : `Planned, forecast and earned man hours — ${selectedLabel}`}
          meta={`Calendar-linear spread, ignores the P6 work calendar. Earned stops at the data date. Diamonds are snapshots.${
            selected === null ? '' : ` Percentages are of ${selectedLabel}'s own budget.`
          }`}
        >
          {curve.length ? (
            <CurveChart ref={chartRef} curve={curve} dataDate={dataDate} />
          ) : (
            <div className="py-14 text-center text-[var(--text-subtle)]">No dated activities to plot.</div>
          )}
        </Panel>
      </div>

      {phaseGroups.length > 0 && (
        <div className="mt-4">
          <Panel
            title="Progress by phase"
            meta={
              <span className="flex items-baseline gap-3">
                <span>Click a phase to show it on its own.</span>
                <a className="btn-link" href={href('rollup')}>By phase and location →</a>
              </span>
            }
          >
            <div className="grid gap-x-8 gap-y-3 md:grid-cols-2 xl:grid-cols-3">
              {phaseGroups.map((g) => (
                <button
                  key={g.key}
                  type="button"
                  className={`block w-full cursor-pointer text-left${selected === g.key ? ' phase-picked' : ''}`}
                  title={selected === g.key ? 'Showing this phase. Click again for the whole project.' : `Show the curve and the cards for ${g.label} only`}
                  onClick={() => setPhase(selected === g.key ? null : g.key)}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[12.5px] font-semibold">{g.label}</span>
                    <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
                      {fmtHours(g.earnedHours)} / {fmtHours(g.budgetHours)} h
                    </span>
                    <span className="w-10 text-right text-[13px] font-bold tabular-nums">{fmtPct(g.pctComplete, 0)}</span>
                  </div>
                  <div className="bar bar-lg mt-1.5">
                    <span
                      style={{
                        width: `${Math.min(100, Math.round(g.pctComplete * 100))}%`,
                        background: g.pctComplete >= 0.995 ? 'var(--good)' : g.pctComplete >= 0.5 ? 'var(--warn-dot)' : 'var(--gray-400)',
                      }}
                    />
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--text-subtle)]">
                    {g.inBudget} activities · {g.finished} finished · {g.inProgress} running · {g.notStarted} not started
                  </div>
                </button>
              ))}
            </div>
          </Panel>
        </div>
      )}

      {model.notes.length > 0 && (
        <div className="mt-4 space-y-2">
          {model.notes.map((n) => (
            <Notice key={n} tone="warn">
              {n}
            </Notice>
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Data quality" meta={`${attention} of ${quality.length} need attention`}>
          <table className="w-full text-[12px]">
            <tbody>
              {quality.map((q) => (
                <tr key={q.label} className="border-b border-[var(--gray-100)] last:border-0">
                  <td className="py-2 pr-3">
                    <a href={q.to} className={q.count ? 'btn-link' : 'font-medium text-[var(--text-muted)]'}>
                      {q.label}
                    </a>
                    <div className="mt-0.5 text-[11.5px] text-[var(--text-subtle)]">{q.note}</div>
                  </td>
                  <td className="num py-2 align-top">
                    <span className={`ph-stat ${q.count ? 'tone-amber' : 'tone-muted'}`}>
                      <span className="ph-stat-val">{q.count}</span>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="Summary">
          <table className="w-full text-[12px]">
            <tbody>
              {summaryRows.map(([k, v]) => (
                <tr key={String(k)} className="border-b border-[var(--gray-100)] last:border-0">
                  <td className="py-1.5 text-[var(--text-muted)]">{k}</td>
                  <td className="num py-1.5 font-semibold">{v}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </Page>
  );
}

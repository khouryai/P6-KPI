import { useMemo, useRef, useState } from 'react';
import { useApp } from '../state';
import { Page, Panel, Notice, Badge, SortableTable, type Column, type HeroStat } from '../components/ui';
import { CurveChart } from '../components/CurveChart';
import { buildCurve, rowTotals } from '../../engine/compute';
import { periodLog, addDays, OUTCOMES, type PeriodActivity, type PeriodOutcome } from '../../engine/period';
import { trendFrom } from '../../engine/trend';
import { effectiveReasonFor, tallyReasons } from '../missedReasons';
import { downloadBytes, stamp } from '../export';
import { paintReport, paintTableFromDom, PAINT_TARGETS, paintChartWidth, type PaintBlock, type PaintTone } from '../reportPaint';
import { fmtHours, fmtPct, fmtDate, todayISO } from '../format';
import { isValidISO } from '../../engine/dates';
import { useUnit } from '../units';
import type { GroupStat } from '../../engine/types';

/** Phase codes sort numerically, as they do on the dashboard. */
function phaseOrder(key: string): number {
  const m = /^P(\d+)$/i.exec(key.trim());
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/** The same tones the Two-Week Log gives each outcome, so the two screens read alike. */
const OUTCOME_TONE: Record<PeriodOutcome, 'good' | 'info' | 'warn' | 'bad' | 'muted'> = {
  COMPLETED: 'good',
  'COMPLETED EARLY': 'good',
  STARTED: 'info',
  CONTINUED: 'info',
  MISSED: 'bad',
  'NOT STARTED': 'muted',
};

/**
 * A KPI card, drawn exactly as the Two-Week Log's outcome tiles are drawn — the
 * same box, the same mono label, the same tabular figure. It is not a button here,
 * because on a report nothing is a filter.
 */
function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'info' | 'warn' | 'bad' | 'muted' }) {
  return (
    <div className={`stat-tile${tone ? ` tone-${tone}` : ''}`}>
      <span className="stat-tile-n">{value}</span>
      <span className="stat-tile-l">{label}</span>
      {sub && <span className="stat-tile-s">{sub}</span>}
    </div>
  );
}

function Tiles({ items }: { items: { label: string; value: string; sub?: string; tone?: PaintTone }[] }) {
  return (
    <div className="stat-row">
      {items.map((i) => (
        <Stat key={i.label} {...i} />
      ))}
    </div>
  );
}

/** How an achievement figure reads: at or over plan, near it, or short of it. */
function achievedTone(a: number | null): 'good' | 'warn' | 'bad' | 'muted' {
  if (a === null) return 'muted';
  return a >= 1 ? 'good' : a >= 0.8 ? 'warn' : 'bad';
}

const PLANNED = '#6d28d9';
const ACHIEVED = '#00875a';

/**
 * The status report.
 *
 * One page to hand to somebody who was not at the review. What goes on it is a
 * choice rather than a fixed layout, because the audience changes: a phase lead
 * wants their own curve and the fortnight's misses, a programme meeting wants the
 * whole job and nothing else.
 *
 * It deliberately reads as the Two-Week Log reads — the same KPI cards, the same
 * tables, the same outcome tiles — because that screen is where the review actually
 * happens, and a report that looked like a different application would have to be
 * re-learned by everybody who has to check it before it goes out. The whole-project
 * position is off by default: a report is written for a phase and a fortnight, and
 * the job's headline figure is available on the Dashboard to anybody who wants it.
 */
export function StatusReport() {
  const { state, model, actions } = useApp();
  const { percent } = useUnit();
  /** The chart element of each curve on the page, for the picture. */
  const charts = useRef(new Map<string, HTMLDivElement>());
  /** The report on screen. Its tables are what the picture is painted from. */
  const reportRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);

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
  const [curveKeys, setCurveKeys] = useState<string[]>([]);
  const [chartHeight, setChartHeight] = useState(360);
  const [showProject, setShowProject] = useState(false);
  const [showPhaseTable, setShowPhaseTable] = useState(true);
  const [showLog, setShowLog] = useState(true);
  const [showLogActivities, setShowLogActivities] = useState(true);
  const [logOutcomes, setLogOutcomes] = useState<PeriodOutcome[]>(['MISSED', 'COMPLETED']);
  const [showTrend, setShowTrend] = useState(false);
  /** What the picture is meant to be dropped into, which sets how big its type comes out. */
  const [pngTarget, setPngTarget] = useState<keyof typeof PAINT_TARGETS>('landscape');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');

  const [end, setEnd] = useState(isValidISO(dataDate ?? '') ? (dataDate as string) : todayISO());
  const [span, setSpan] = useState(14);

  const toggleCurve = (key: string) =>
    setCurveKeys((cs) => (cs.includes(key) ? cs.filter((c) => c !== key) : [...cs, key]));
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
      curveKeys.map((key) => {
        const rows = key === '' ? model.rows : model.rows.filter((r) => r.phase === key);
        const label = key === '' ? 'Whole project' : (phases.find((p) => p.key === key)?.label ?? key);
        return { key, label, curve: buildCurve(rows, dataDate, cadence).curve, totals: rowTotals(rows) };
      }),
    [curveKeys, model.rows, phases, dataDate, cadence],
  );

  const logRows = useMemo(
    () => log.activities.filter((a) => logOutcomes.includes(a.outcome)),
    [log.activities, logOutcomes],
  );

  /** Only the phases with something to say this window, as the Two-Week Log reads them. */
  const activePhases = useMemo(
    () => log.phases.filter((p) => p.plannedHours > 1e-9 || p.earnedHours > 1e-9 || Object.values(p.counts).some((n) => n > 0)),
    [log.phases],
  );

  const missed = useMemo(() => log.activities.filter((a) => a.outcome === 'MISSED'), [log.activities]);
  const reasonTally = useMemo(
    () => tallyReasons(state.data.missedReasons, missed.map((a) => a.activityId), end),
    [state.data.missedReasons, missed, end],
  );
  const reasonFor = (id: string) => effectiveReasonFor(state.data.missedReasons, id, end);

  /**
   * Hours, or the same hours as a share of the whole job. Every figure on the page
   * goes through this, exactly as it does on the Two-Week Log, so percent mode
   * cannot leave one stray hours value behind — which on a client pack is the only
   * kind of mistake that matters.
   */
  const budget = log.projectBudgetHours;
  const val = (hours: number, digits = 0) => (percent ? fmtPct(budget ? hours / budget : 0, 2) : `${fmtHours(hours, digits)} h`);
  const variance = log.earnedHours - log.plannedHours;
  const achievedWidth = log.achievement === null ? 0 : Math.min(100, Math.round(log.achievement * 100));

  const heading = title.trim() || 'Testing and Commissioning — Status Report';

  const heroStats: HeroStat[] = showLog
    ? [
        { label: 'Planned', value: val(log.plannedHours), tone: 'muted' },
        { label: 'Achieved', value: val(log.earnedHours), tone: 'good' },
        {
          label: 'Of plan',
          value: log.achievement === null ? '—' : fmtPct(log.achievement, 0),
          tone: log.achievement === null ? 'muted' : log.achievement >= 1 ? 'good' : log.achievement >= 0.8 ? 'amber' : 'red',
        },
        { label: 'Curves', value: String(curves.length), tone: 'blue' },
      ]
    : [{ label: 'Curves', value: String(curves.length), tone: 'blue' }];
  if (showLog && missed.length > 0) {
    heroStats.splice(3, 0, {
      label: 'Missed explained',
      value: `${missed.length - reasonTally.unexplained}/${missed.length}`,
      tone: reasonTally.unexplained === 0 ? 'good' : 'amber',
    });
  }

  /**
   * The whole report as one picture, for pasting into a document.
   *
   * Everything on the page, not just the curves: somebody opening a Word file has
   * to be able to read the fortnight's figures and the activities behind them
   * without being sent back to the application for the half that did not come.
   */
  /**
   * Lay the curves out at the width they will occupy in the picture.
   *
   * A chart captured at screen width and scaled down takes its axis labels with it,
   * and they end up a third the size of everything else on the page. Recharts sizes
   * itself from its container, so the container is set to the target width for as
   * long as the capture takes and then handed back.
   */
  const layOutChartsAt = async (px: number | null) => {
    for (const el of charts.current.values()) {
      if (px === null) el.style.removeProperty('width');
      else el.style.width = `${px}px`;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 140))));
  };

  const exportPng = async () => {
    const target = PAINT_TARGETS[pngTarget];
    setBusy(true);
    try {
      await layOutChartsAt(paintChartWidth(target));
      const pages = await paintReport(blocks(), { target });
      const at = stamp();
      const written: string[] = [];
      for (let i = 0; i < pages.length; i++) {
        const name = pages.length === 1 ? `status-report-${at}.png` : `status-report-${at}-${i + 1}of${pages.length}.png`;
        if (state.adapterKind === 'filesystem') written.push(await actions.writeExport(name, pages[i]));
        else downloadBytes(name, pages[i], 'image/png');
      }
      if (written.length) actions.notify('ok', `Written to ${written[0]}${written.length > 1 ? ` and ${written.length - 1} more` : ''}`);
      else if (pages.length > 1) actions.notify('ok', `${pages.length} pages saved, each sized to fit the page you chose.`);
    } catch (err) {
      actions.notify('error', (err as Error).message);
    } finally {
      await layOutChartsAt(null);
      setBusy(false);
    }
  };

  // --- the activity table, read as the Two-Week Log reads it ------------------
  const columns: Column<PeriodActivity>[] = [
    {
      key: 'id',
      label: 'Activity',
      locked: true,
      value: (a) => a.activityId,
      render: (a) => (
        <div className="min-w-0">
          <div className="mono text-[var(--text-muted)]">{a.activityId}</div>
          <div className="cell-text font-semibold" title={a.activityName}>{a.activityName}</div>
        </div>
      ),
    },
    {
      key: 'outcome',
      label: 'Outcome',
      value: (a) => OUTCOMES.indexOf(a.outcome),
      exportValue: (a) => a.outcome,
      render: (a) => <Badge tone={OUTCOME_TONE[a.outcome]}>{a.outcome}</Badge>,
    },
    /*
     * The reason, on the row it belongs to.
     *
     * It used to be a tally under the period heading — "3 access, 2 design" — which
     * on a handed-over page is unanswerable: the reader is looking at the activity
     * that slipped and has to hunt a separate table that never says which is which.
     * The Two-Week Log puts the answer in the row, and so does this.
     */
    {
      key: 'reason',
      label: 'Why missed',
      value: (a) => reasonFor(a.activityId)?.entry.reason ?? '',
      render: (a) => {
        if (a.outcome !== 'MISSED') return <span className="text-[var(--text-subtle)]">—</span>;
        const eff = reasonFor(a.activityId);
        if (!eff) return <span className="tone-bad text-[12px]">no reason given yet</span>;
        return (
          <span
            className="cell-text"
            title={eff.carried ? `Carried from the period ending ${fmtDate(eff.entry.periodEnd)}.` : eff.entry.reason}
          >
            {eff.entry.reason}
            {eff.carried && <span className="ml-1 text-[var(--text-subtle)]">(carried)</span>}
          </span>
        );
      },
    },
    { key: 'phase', label: 'Phase', value: (a) => a.phaseName },
    {
      key: 'planned',
      label: percent ? 'Planned' : 'Planned h',
      value: (a) => a.plannedHours,
      num: true,
      optional: true,
      render: (a) => <span className="text-[var(--text-muted)]">{val(a.plannedHours, 1)}</span>,
    },
    {
      key: 'earned',
      label: percent ? 'Project achieved' : 'Project achieved h',
      value: (a) => a.earnedHours,
      num: true,
      render: (a) => (
        <b className={a.spreadToDataDate ? 'tone-muted' : undefined} title={a.spreadToDataDate ? 'Spread from the actual start to the data date, because nothing says when the progress happened.' : undefined}>
          {val(a.earnedHours, 1)}{a.spreadToDataDate ? ' ~' : ''}
        </b>
      ),
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
          <div className="bar" style={{ width: 60 }} title={percent ? fmtPct(a.pctComplete, 1) : `${fmtPct(a.pctComplete, 1)} of ${fmtHours(a.budgetHours)} h`}>
            <span style={{ width: `${Math.min(100, Math.round(a.pctComplete * 100))}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'blf', label: 'BL finish', value: (a) => a.baselineFinish, render: (a) => fmtDate(a.baselineFinish) },

    { key: 'af', label: 'Actual finish', value: (a) => a.actualFinish, render: (a) => fmtDate(a.actualFinish) },
    {
      key: 'var',
      label: 'Days late',
      value: (a) => a.finishVarianceDays,
      num: true,
      optional: true,
      render: (a) =>
        a.finishVarianceDays === null ? (
          <span className="text-[var(--text-subtle)]">—</span>
        ) : (
          <span className={`font-semibold tone-${a.finishVarianceDays > 0 ? 'bad' : a.finishVarianceDays < 0 ? 'good' : 'muted'}`}>
            {a.finishVarianceDays > 0 ? '+' : ''}{a.finishVarianceDays}
          </span>
        ),
    },
    { key: 'loc', label: 'Loc', value: (a) => a.location, optional: true },
    { key: 'bls', label: 'BL start', value: (a) => a.baselineStart, optional: true, render: (a) => fmtDate(a.baselineStart) },
    { key: 'as', label: 'Actual start', value: (a) => a.actualStart, optional: true, render: (a) => fmtDate(a.actualStart) },
  ];

  const phaseColumns: Column<GroupStat>[] = [
    { key: 'phase', label: 'Phase', locked: true, value: (p) => p.label },
    ...(percent ? [] : [
      { key: 'earned', label: 'Earned h', value: (p: GroupStat) => p.earnedHours, num: true, render: (p: GroupStat) => fmtHours(p.earnedHours) },
      { key: 'budget', label: 'Budget h', value: (p: GroupStat) => p.budgetHours, num: true, render: (p: GroupStat) => fmtHours(p.budgetHours) },
    ]),
    {
      key: 'pct',
      label: '% complete',
      value: (p) => p.pctComplete,
      num: true,
      width: '150px',
      render: (p) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-11 text-right tabular-nums font-semibold">{fmtPct(p.pctComplete, 1)}</span>
          <div className="bar" style={{ width: 60 }}>
            <span style={{ width: `${Math.min(100, Math.round(p.pctComplete * 100))}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'fin', label: 'Finished', value: (p) => p.finished, num: true },
    { key: 'run', label: 'Running', value: (p) => p.inProgress, num: true },
    { key: 'ns', label: 'Not started', value: (p) => p.notStarted, num: true },
  ];

  /** The tiles, defined once: the screen maps over these and so does the picture. */
  type Tile = { label: string; value: string; sub?: string; tone?: PaintTone };

  const periodStats: Tile[] = [
    { label: 'Planned', value: val(log.plannedHours), tone: 'muted' },
    { label: 'Achieved', value: val(log.earnedHours), tone: 'good' },
    { label: 'Of plan', value: log.achievement === null ? '—' : fmtPct(log.achievement, 0), tone: achievedTone(log.achievement) },
    { label: 'Against plan', value: `${variance >= 0 ? '+' : ''}${val(variance)}`, tone: variance >= 0 ? 'good' : 'bad' },
    { label: 'Project complete', value: fmtPct(log.pctAtEnd, 1), sub: `from ${fmtPct(log.pctAtStart, 1)}`, tone: 'info' },
    {
      label: 'Due finishes made',
      value: `${log.finishedOnTime}/${log.dueToFinish}`,
      tone: log.dueToFinish === 0 ? 'muted' : log.finishedOnTime === log.dueToFinish ? 'good' : 'bad',
    },
  ];

  const projectStats: Tile[] = [
    { label: 'Complete', value: fmtPct(totals.pctComplete, 1), tone: 'info' },
    ...(percent
      ? []
      : ([
          { label: 'Budget h', value: fmtHours(totals.budgetHours) },
          { label: 'Earned h', value: fmtHours(totals.earnedHours), tone: 'good' },
          { label: 'Remaining h', value: fmtHours(totals.remainingHours) },
        ] as Tile[])),
    { label: 'Finished', value: `${totals.finished}/${totals.inBudget}` },
    ...(model.burn.project.factor === null
      ? []
      : ([
          {
            label: 'Earned per hour',
            value: model.burn.project.factor.toFixed(2),
            tone: model.burn.project.factor >= 1 ? 'good' : 'bad',
          },
        ] as Tile[])),
  ];

  const trendStats: Tile[] = [
    {
      label: 'Factor now',
      value: trend.recentFactor === null ? '—' : trend.recentFactor.toFixed(2),
      tone: trend.recentFactor !== null && trend.recentFactor >= 1 ? 'good' : 'bad',
    },
    { label: 'Factor before', value: trend.priorFactor === null ? '—' : trend.priorFactor.toFixed(2), tone: 'muted' },
    { label: 'Progress a month', value: trend.recentPctPerMonth === null ? '—' : fmtPct(trend.recentPctPerMonth, 2) },
    {
      label: 'At this pace',
      value: trend.monthsToFinish === null ? '—' : `${Math.ceil(trend.monthsToFinish)}`,
      sub: 'months to finish',
    },
  ];

  /**
   * The page, as the painter wants it: the same figures, the same order, and the
   * tables taken from the same `Column` definitions the screen renders.
   */
  const blocks = (): PaintBlock[] => {
    const out: PaintBlock[] = [
      {
        kind: 'title',
        text: heading,
        sub: note.trim() || undefined,
        right: [`Data date ${dataDate ? fmtDate(dataDate) : 'not set'}`, `Issued ${fmtDate(todayISO())}`],
      },
    ];
    if (showLog) {
      out.push({ kind: 'section', text: `Period ${fmtDate(from)} to ${fmtDate(end)}`, meta: `${log.days} days` });
      out.push({ kind: 'stats', items: periodStats });
      out.push({
        kind: 'bars',
        rows: [
          { label: 'Planned', value: val(log.plannedHours), pct: 1, color: PLANNED },
          { label: 'Achieved', value: val(log.earnedHours), pct: achievedWidth / 100, color: ACHIEVED },
        ],
      });
      if (activePhases.length > 0) {
        out.push({
          kind: 'lines',
          items: activePhases.map(
            (p) =>
              `${p.label} — ${p.achievement === null ? 'nothing planned' : `${fmtPct(p.achievement, 0)} of plan`}, ` +
              `moved ${fmtPct(p.pctAtStart, 1)} → ${fmtPct(p.pctAtEnd, 1)}`,
          ),
        });
      }
      if (showLogActivities) {
        out.push({ kind: 'stats', items: OUTCOMES.map((o) => ({ label: o, value: String(log.counts[o]), tone: OUTCOME_TONE[o] })) });
        const t = paintTableFromDom(reportRef.current?.querySelector('[data-paint="activities"] table.tbl') ?? null);
        if (t) {
          out.push(t);
        } else {
          out.push({ kind: 'note', text: `No activities in the chosen outcomes between ${fmtDate(from)} and ${fmtDate(end)}.` });
        }
      }
    }
    for (const c of curves) {
      const el = charts.current.get(c.key);
      out.push({
        kind: 'section',
        text: c.label,
        meta:
          `${fmtPct(c.totals.pctComplete, 1)} complete` +
          (percent ? '' : ` · ${fmtHours(c.totals.earnedHours)} of ${fmtHours(c.totals.budgetHours)} h`),
      });
      if (el) out.push({ kind: 'chart', el });
      else out.push({ kind: 'note', text: 'No dated activities to plot.' });
    }
    if (showProject) {
      out.push({ kind: 'section', text: 'Where the job stands', meta: `${totals.inBudget} activities in budget` });
      out.push({ kind: 'stats', items: projectStats });
    }
    if (showTrend && trend.points.length >= 2) {
      out.push({ kind: 'section', text: 'Direction of travel', meta: `last ${trend.window} active months against the ${trend.window} before` });
      out.push({ kind: 'stats', items: trendStats });
    }
    if (showPhaseTable && phases.length > 0) {
      const t = paintTableFromDom(reportRef.current?.querySelector('[data-paint="phases"] table.tbl') ?? null);
      out.push({ kind: 'section', text: 'Progress by phase' });
      if (t) out.push(t);
    }
    return out;
  };

  return (
    <Page
      eyebrow="Progress"
      title="Status Report"
      subtitle="One page to hand over. Choose what goes on it, then print it, save it as a PDF, or save the whole thing as a PNG to paste into a document."
      stats={heroStats}
      actions={
        <>
          <button className="btn btn-mini" disabled={busy} onClick={() => void exportPng()}>
            {busy ? 'Saving…' : 'Save as PNG'}
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / save as PDF
          </button>
        </>
      }
    >
      {/* ---------- the builder. Never printed. ---------- */}
      <Panel title="What goes on the page" className="mb-4 no-print">
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <div className="eyebrow mb-1.5">Curves</div>
            <div className="flex flex-wrap gap-2">
              <button className={`btn btn-mini${curveKeys.includes('') ? ' btn-primary' : ''}`} onClick={() => toggleCurve('')}>
                Whole project
              </button>
              {phases.map((p) => (
                <button key={p.key} className={`btn btn-mini${curveKeys.includes(p.key) ? ' btn-primary' : ''}`} onClick={() => toggleCurve(p.key)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-[var(--text-muted)]">Size</span>
              <select className="input" value={chartHeight} onChange={(e) => setChartHeight(Number(e.target.value))}>
                <option value={300}>Standard</option>
                <option value={360}>Large</option>
                <option value={460}>Full page</option>
              </select>
              <span className="text-[var(--text-subtle)]">
                {curveKeys.length === 0
                  ? 'No curve on the page yet — pick one or more above.'
                  : `${curveKeys.length} ${curveKeys.length === 1 ? 'curve' : 'curves'}, in the order picked.`}
                {' '}In {percent ? 'percent' : 'man hours'} — switch on the Dashboard.
              </span>
            </div>
          </div>

          <div>
            <div className="eyebrow mb-1.5">Two-Week Log</div>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showLog} onChange={(e) => setShowLog(e.target.checked)} /> Include
              </label>
              <span className="text-[var(--text-muted)]">ending</span>
              <input className="input" type="date" value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} disabled={!showLog} />
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
            <div className="mt-1.5 text-[11.5px] text-[var(--text-subtle)]">
              Why each activity was missed sits in its own row, the way the Two-Week Log shows it.
            </div>
          </div>

          <div>
            <div className="eyebrow mb-1.5">Also include</div>
            <div className="flex flex-wrap gap-3 text-[12px]">
              <label className="flex cursor-pointer items-center gap-1.5" title="The job's headline position: budget, earned, remaining and the rate it is converting at. Off by default — a report is usually written about a phase and a fortnight.">
                <input type="checkbox" checked={showProject} onChange={(e) => setShowProject(e.target.checked)} /> Whole-project position
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showPhaseTable} onChange={(e) => setShowPhaseTable(e.target.checked)} /> Progress by phase
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input type="checkbox" checked={showTrend} onChange={(e) => setShowTrend(e.target.checked)} /> Direction of travel
              </label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px]">
              <span className="text-[var(--text-muted)]">Picture for</span>
              <select
                className="input"
                value={pngTarget}
                onChange={(e) => setPngTarget(e.target.value as keyof typeof PAINT_TARGETS)}
                title="How wide the PNG is meant to sit once it is on a page. A narrower target lays the same report out narrower, which makes every figure on it proportionally bigger."
              >
                {Object.entries(PAINT_TARGETS).map(([k, t]) => (
                  <option key={k} value={k}>{t.label}</option>
                ))}
              </select>
            </div>
            <div className="mt-1.5 text-[11.5px] text-[var(--text-subtle)]">
              The picture comes out one image per page, sized and stamped so Word places it at that width without shrinking it. It carries the columns the tables
              below are showing, in that order — hiding columns with <b>Columns</b> makes what is left bigger on the page.
            </div>
          </div>

          <div>
            <div className="eyebrow mb-1.5">Heading</div>
            <input className="input w-full" placeholder="Testing and Commissioning — Status Report" value={title} onChange={(e) => setTitle(e.target.value)} />
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

        {/* ---------- the fortnight, whole and together: this is the review ---------- */}
        {showLog && (
          <Panel
            className="mt-3"
            title={`Period ${fmtDate(from)} to ${fmtDate(end)}`}
            meta={`${log.days} days`}
          >
            <Tiles items={periodStats} />

            <div className="plan-bar mt-4">
              <div className="plan-bar-row">
                <span className="plan-bar-key"><i style={{ background: PLANNED }} /> Planned</span>
                <div className="plan-bar-track"><span style={{ width: '100%', background: PLANNED }} /></div>
                <span className="plan-bar-val">{val(log.plannedHours)}</span>
              </div>
              <div className="plan-bar-row">
                <span className="plan-bar-key"><i style={{ background: ACHIEVED }} /> Achieved</span>
                <div className="plan-bar-track"><span style={{ width: `${achievedWidth}%`, background: ACHIEVED }} /></div>
                <span className="plan-bar-val">{val(log.earnedHours)}</span>
              </div>
            </div>

            {activePhases.length > 0 && (
              <div className="mt-3 border-t border-[var(--line-soft)] pt-3">
                <div className="eyebrow mb-1.5">By phase</div>
                <div className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                  {activePhases.map((p) => (
                    <div key={p.key || '#'} className="flex flex-wrap items-baseline gap-x-2">
                      <b className="text-[var(--text)]">{p.label}</b>
                      <span className={`font-semibold tone-${achievedTone(p.achievement)}`}>
                        {p.achievement === null ? 'nothing planned' : `${fmtPct(p.achievement, 0)} of plan`}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        moved <b className="text-[var(--text)]">{fmtPct(p.pctAtStart, 1)}</b> → <b className="text-[var(--text)]">{fmtPct(p.pctAtEnd, 1)}</b>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Panel>
        )}

        {showLog && showLogActivities && (
          <div className="mt-3" data-paint="activities">
            <div className="mb-3">
              <Tiles items={OUTCOMES.map((o) => ({ label: o, value: String(log.counts[o]), tone: OUTCOME_TONE[o] }))} />
            </div>
            {logRows.length === 0 ? (
              <Notice tone="info">No activities in the chosen outcomes between {fmtDate(from)} and {fmtDate(end)}.</Notice>
            ) : (
              <SortableTable
                tableId="status-activities"
                exportName="status-report-activities"
                rows={logRows}
                columns={columns}
                rowKey={(a) => a.activityId}
                defaultSort={{ key: 'outcome', dir: 'asc' }}
                maxHeight="none"
                rowClass={(a) => (a.outcome === 'MISSED' ? 'row-bad' : a.outcome === 'NOT STARTED' ? 'row-muted' : '')}
              />
            )}
          </div>
        )}

        {/* ---------- then the curves, one per row and big enough to read ---------- */}
        {curves.map((c) => (
          <Panel
            key={c.key}
            className="mt-3"
            title={c.label}
            meta={
              <>
                {fmtPct(c.totals.pctComplete, 1)} complete
                {!percent && <> · {fmtHours(c.totals.earnedHours)} of {fmtHours(c.totals.budgetHours)} h</>}
              </>
            }
          >
            {c.curve.length ? (
              <CurveChart
                ref={(el) => {
                  if (el) charts.current.set(c.key, el);
                  else charts.current.delete(c.key);
                }}
                curve={c.curve}
                dataDate={dataDate}
                percent={percent}
                total={c.totals.budgetHours}
                monthly={cadence === 'month'}
                height={chartHeight}
              />
            ) : (
              <div className="rep-empty">No dated activities to plot.</div>
            )}
          </Panel>
        ))}

        {showProject && (
          <Panel className="mt-3" title="Where the job stands" meta={`${totals.inBudget} activities in budget`}>
            <Tiles items={projectStats} />
          </Panel>
        )}

        {showTrend && trend.points.length >= 2 && (
          <Panel className="mt-3" title="Direction of travel" meta={`last ${trend.window} active months against the ${trend.window} before`}>
            <Tiles items={trendStats} />
          </Panel>
        )}

        {/* ---------- and the phases last, as the closing position ---------- */}
        {showPhaseTable && phases.length > 0 && (
          <Panel className="mt-3" title="Progress by phase">
            <div data-paint="phases">
            <SortableTable
              tableId="status-phases"
              exportName="status-report-phases"
              rows={phases}
              columns={phaseColumns}
              rowKey={(p) => p.key || '#'}
              maxHeight="none"
            />
            </div>
          </Panel>
        )}

      </div>
    </Page>
  );
}

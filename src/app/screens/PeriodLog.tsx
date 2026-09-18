import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Panel, Notice, Badge, type Column, type HeroStat } from '../components/ui';
import { periodLog, addDays, OUTCOMES, type PeriodActivity, type PeriodOutcome } from '../../engine/period';
import { fmtHours, fmtPct, fmtDate, todayISO, num } from '../format';
import { isValidISO } from '../../engine/dates';
import { normKey } from '../../engine/keys';
import { href } from '../router';
import { useUnit } from '../units';
import { TERMS } from '../../engine/vocab';
import { setTestProgress, asFraction } from '../testProgress';
import { reasonCatalogue, effectiveReasonFor, setMissedReason, addReasonToCatalogue, removeReasonFromCatalogue, reasonUsage, tallyReasons } from '../missedReasons';

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
  COMPLETED: { tone: 'good', blurb: 'Finished. Either inside the period, or before it while the baseline still had it running.' },
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

/** The option that opens the box for a reason the list does not have yet. */
const ADD_REASON = '__add-a-reason__';

/** What Test Progress holds for one activity, as this screen reads and writes it. */
type TestProgressEntry = { testsTotal?: number; testsComplete?: number; pctOverride?: number; note?: string };

/**
 * The reason one activity was missed, and the way a new reason gets onto the list.
 *
 * The dropdown carries the catalogue plus one last entry that asks for a new one:
 * the person in a review who needs a category that does not exist yet is holding
 * the reason in their head right then, and sending them to a settings screen to
 * define it first is how it ends up recorded as "other".
 */
function MissedReasonCell({
  value,
  options,
  carriedFrom,
  onChange,
  onAdd,
}: {
  value: string;
  options: string[];
  /** The period this answer was written against, when it was not this one. */
  carriedFrom?: string;
  onChange: (reason: string) => void;
  onAdd: (reason: string) => void;
}) {
  return (
    <select
      className={`cell-input${carriedFrom ? ' is-carried' : ''}`}
      value={value}
      title={
        carriedFrom
          ? `${value}\n\nCarried from the period ending ${fmtDate(carriedFrom)}. It stays with the activity until somebody gives this period its own answer; picking one here records it against this period.`
          : value || 'Say why this activity did not finish. Pick a reason, or add one of your own.'
      }
      onChange={(e) => {
        if (e.target.value !== ADD_REASON) return onChange(e.target.value);
        const typed = prompt('A reason activities get missed for. It joins the list and is offered on every activity from now on.', '');
        const reason = typed?.trim();
        if (!reason) return;
        onAdd(reason);
        onChange(reason);
      }}
    >
      <option value="">— why? —</option>
      {options.map((o) => (
        <option key={o} value={o}>{o}</option>
      ))}
      <option value={ADD_REASON}>＋ Add a reason…</option>
    </select>
  );
}

/** How an achievement figure reads: at or over plan, near it, or short of it. */
function achievedTone(achievement: number | null): string {
  if (achievement === null) return 'tone-muted';
  return achievement >= 1 ? 'tone-good' : achievement >= 0.8 ? 'tone-warn' : 'tone-bad';
}

/** A fortnight ending on the data date is the review everybody actually holds. */
function defaultEnd(dataDate: string): string {
  return isValidISO(dataDate) ? dataDate : todayISO();
}

export function PeriodLog() {
  const { state, model, actions } = useApp();
  const { percent, setUnit } = useUnit();
  const [end, setEnd] = useState(() => defaultEnd(state.data.settings.dataDate));
  const [span, setSpan] = useState(14);
  const [outcome, setOutcome] = useState<PeriodOutcome | ''>('');

  const from = addDays(end, -(span - 1));
  const log = useMemo(() => periodLog(model.rows, from, end), [model.rows, from, end]);

  const shown = useMemo(
    () => (outcome ? log.activities.filter((a) => a.outcome === outcome) : log.activities),
    [log.activities, outcome],
  );

  /** The phase figures, by phase key, so a row can report its own phase's window. */
  const phaseBy = useMemo(() => new Map(log.phases.map((p) => [p.key, p])), [log.phases]);
  /** Only the phases with something to say this window, for the line under the chart. */
  const activePhases = useMemo(
    () => log.phases.filter((p) => p.plannedHours > 1e-9 || p.earnedHours > 1e-9 || Object.values(p.counts).some((n) => n > 0)),
    [log.phases],
  );

  const missedReasons = state.data.missedReasons;
  const catalogue = useMemo(() => reasonCatalogue(missedReasons), [missedReasons]);
  /** How many activities each reason has been given for, across every period. */
  const usage = useMemo(() => reasonUsage(missedReasons), [missedReasons]);
  const [editingReasons, setEditingReasons] = useState(false);
  /** Every activity the period counts as missed, whatever the table is filtered to. */
  const missed = useMemo(() => log.activities.filter((a) => a.outcome === 'MISSED'), [log.activities]);
  const reasonTally = useMemo(() => tallyReasons(missedReasons, missed.map((a) => a.activityId), log.to), [missedReasons, missed, log.to]);

  /** What is keyed against each activity right now, for the editable columns. */
  const testEntries = useMemo(() => {
    const m = new Map<string, TestProgressEntry>();
    for (const t of state.data.testProgress) if (!m.has(normKey(t.activityId))) m.set(normKey(t.activityId), t);
    return m;
  }, [state.data.testProgress]);
  const keyed = (id: string) => testEntries.get(normKey(id));

  /**
   * Hours, or the same hours as a share of the whole job. Every figure on the
   * screen goes through this, so percent mode cannot leave one stray hours value
   * behind — which on a client pack is the only kind of mistake that matters here.
   */
  const total = log.projectBudgetHours;
  const val = (hours: number, digits = 0) => (percent ? fmtPct(total ? hours / total : 0, 2) : `${fmtHours(hours, digits)} h`);
  const scale = (hours: number) => (percent && total ? (hours / total) * 100 : hours);

  const chart = log.slices.map((s) => ({
    label: s.label,
    range: `${fmtDate(s.from)} – ${fmtDate(s.to)}`,
    planned: percent ? Math.round(scale(s.planned) * 100) / 100 : Math.round(s.planned),
    achieved: percent ? Math.round(scale(s.earned) * 100) / 100 : Math.round(s.earned),
  }));

  const variance = log.earnedHours - log.plannedHours;
  const heroStats: HeroStat[] = [
    { label: 'Planned', value: val(log.plannedHours), tone: 'muted' },
    { label: 'Achieved', value: val(log.earnedHours), tone: 'good' },
    {
      label: 'Of plan',
      value: log.achievement === null ? '—' : fmtPct(log.achievement, 0),
      tone: log.achievement === null ? 'muted' : log.achievement >= 1 ? 'good' : log.achievement >= 0.8 ? 'amber' : 'red',
    },
    { label: 'Project', value: fmtPct(log.pctAtEnd, 1), tone: 'blue' },
  ];
  // Only worth a chip when there is something to explain, and it reports the half
  // that is missing rather than the half that is done: an unexplained miss is the
  // one thing on this screen that a person can still fix before the report goes out.
  if (missed.length > 0) {
    heroStats.push({
      label: 'Missed explained',
      value: `${missed.length - reasonTally.unexplained}/${missed.length}`,
      tone: reasonTally.unexplained === 0 ? 'good' : 'amber',
    });
  }

  /**
   * The log as text, for the person who has to paste this into an email on Friday.
   * Everything on screen, nothing that needs the screen to make sense of it.
   */
  const asText = () => {
    const lines = [
      `T&C two-week log: ${fmtDate(log.from)} to ${fmtDate(log.to)} (${log.days} days)`,
      '',
      `Planned    ${val(log.plannedHours)}`,
      `Achieved   ${val(log.earnedHours)}  (${log.achievement === null ? 'nothing was planned' : `${fmtPct(log.achievement, 0)} of plan`})`,
      `Variance   ${variance >= 0 ? '+' : ''}${val(variance)}`,
      `Project    ${fmtPct(log.pctAtStart, 1)} -> ${fmtPct(log.pctAtEnd, 1)} complete`,
      `Due to finish in the period: ${log.dueToFinish}; actually finished: ${log.finishedOnTime}`,
      '',
    ];
    if (activePhases.length) {
      lines.push('By phase');
      for (const p of activePhases) {
        lines.push(
          `  ${p.label.padEnd(10)} ${p.achievement === null ? 'nothing planned'.padEnd(16) : `${fmtPct(p.achievement, 0)} of plan`.padEnd(16)}` +
            ` ${fmtPct(p.pctAtStart, 1)} -> ${fmtPct(p.pctAtEnd, 1)} complete`,
        );
      }
      lines.push('');
    }
    if (missed.length) {
      lines.push(`Why ${missed.length} missed`);
      for (const t of reasonTally.given) lines.push(`  ${String(t.count).padStart(3)}  ${t.reason}`);
      if (reasonTally.unexplained) lines.push(`  ${String(reasonTally.unexplained).padStart(3)}  no reason given yet`);
      if (reasonTally.carried) lines.push(`  (${reasonTally.carried} of these answers carried over from an earlier review)`);
      lines.push('');
    }
    for (const o of OUTCOMES) {
      const list = log.activities.filter((a) => a.outcome === o);
      if (!list.length) continue;
      lines.push(`${o} (${list.length})`);
      for (const a of list) {
        const why = o === 'MISSED' ? effectiveReasonFor(missedReasons, a.activityId, log.to)?.entry.reason : undefined;
        const note = keyed(a.activityId)?.note;
        lines.push(
          `  ${a.activityId}  ${a.activityName}  ${fmtPct(a.pctComplete, 0)} complete${percent ? '' : `  ${fmtHours(a.earnedHours, 1)} h earned`}${why ? `  [${why}]` : ''}${note ? `  — ${note}` : ''}`,
        );
      }
      lines.push('');
    }
    const text = lines.join('\n');
    navigator.clipboard?.writeText(text).then(
      () => actions.notify('ok', 'Two-week log copied. Paste it into your report.'),
      () => actions.notify('error', 'The browser would not give access to the clipboard.'),
    );
  };

  /** Put a reason on the list from the manage panel, without attaching it to a row. */
  const addReason = () => {
    const typed = prompt('A reason activities get missed for. It joins the list and is offered on every missed activity.', '');
    if (typed?.trim()) addReasonToCatalogue(actions.update, typed);
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
          <div className="cell-text font-semibold" title={a.activityName}>{a.activityName}</div>
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
    {
      key: 'reason',
      label: 'Why missed',
      value: (a) => effectiveReasonFor(missedReasons, a.activityId, log.to)?.entry.reason ?? '',
      hint: 'Why this activity did not finish when the baseline said it would. It sticks with the Activity ID, so nudging the end date by a day does not lose it; each answer is still stamped with the period it was given for, and a shown answer from another period is marked as carried.',
      render: (a) => {
        if (a.outcome !== 'MISSED') return <span className="text-[var(--text-subtle)]">—</span>;
        const eff = effectiveReasonFor(missedReasons, a.activityId, log.to);
        return (
          <MissedReasonCell
            value={eff?.entry.reason ?? ''}
            options={catalogue}
            carriedFrom={eff?.carried ? eff.entry.periodEnd : undefined}
            onChange={(reason) => setMissedReason(actions.update, a.activityId, log.to, reason)}
            onAdd={(reason) => addReasonToCatalogue(actions.update, reason)}
          />
        );
      },
    },
    /*
     * The reviewer's own words on the row, keyed here and stored on Test Progress.
     *
     * One field, not a copy on each screen — the same upsert the test counts go
     * through — so a note written at a review is the note Test Progress shows, and
     * there is nothing to reconcile afterwards. It is deliberately not the Budget
     * Master note, which explains a pricing or visibility decision: "waiting on the
     * CTC cutover" and "re-priced, agreed with the client" are different sentences
     * and neither should overwrite the other.
     */
    {
      key: 'note',
      label: 'Progress note',
      value: (a) => keyed(a.activityId)?.note ?? '',
      hint: 'Anything about this activity worth saying at the review. Kept against the Activity ID, and the same field Test Progress shows — write it in either place.',
      render: (a) => (
        <CellInput
          className="cell-input"
          value={keyed(a.activityId)?.note ?? ''}
          placeholder="—"
          title={keyed(a.activityId)?.note || 'Your own words on this activity. Writes straight to Test Progress, where the same note can be edited.'}
          onCommit={(v) => setTestProgress(actions.update, a.activityId, { note: v })}
        />
      ),
    },
    { key: 'phase', label: 'Phase', value: (a) => a.phaseName },
    /*
     * What this row put into its own phase, not how the phase did.
     *
     * This column used to repeat the phase's achieved-against-planned figure on
     * every row of the phase, which made it a heading pretending to be data: sorting
     * by it sorted nothing, and a row could not say what it had personally
     * contributed. It now reads exactly as Project achieved does one column over —
     * the row's own earned hours as a share of a budget — with the phase's budget as
     * the denominator instead of the whole job's. The rows of a phase therefore add
     * up to how far that phase moved in the window, which is the figure the phase
     * line above the table already reports.
     */
    {
      key: 'phasepct',
      label: 'Phase achieved',
      value: (a) => a.phaseContribution,
      num: true,
      width: '130px',
      hint: 'What this one activity put into its own phase in this window: its achieved hours as a share of the phase’s whole budget. The rows of a phase add up to how far that phase moved.',
      render: (a) => {
        const p = phaseBy.get(a.phase);
        if (a.phaseContribution === null) return <span className="text-[var(--text-subtle)]">—</span>;
        return (
          <span
            className="font-semibold tabular-nums"
            title={
              `${fmtHours(a.earnedHours, 1)} h of ${p?.label ?? 'this phase'}’s ${fmtHours(a.phaseBudgetHours)} h budget.` +
              (p ? ` The phase itself moved ${fmtPct(p.pctAtStart, 1)} → ${fmtPct(p.pctAtEnd, 1)} in this window, and this row is part of that.` : '')
            }
          >
            {fmtPct(a.phaseContribution, 2)}
          </span>
        );
      },
    },
    {
      key: 'phaseplan',
      label: 'Phase of plan',
      value: (a) => phaseBy.get(a.phase)?.achievement ?? null,
      num: true,
      optional: true,
      hint: 'How this activity’s whole phase did in this window: the phase’s achieved hours over its planned hours. The same figure for every activity of the phase — it judges the phase, not the row.',
      render: (a) => {
        const p = phaseBy.get(a.phase);
        if (!p || p.achievement === null) return <span className="text-[var(--text-subtle)]">—</span>;
        return (
          <span
            className={`font-semibold ${achievedTone(p.achievement)}`}
            title={`${p.label}: ${val(p.earnedHours, 1)} achieved against ${val(p.plannedHours, 1)} planned in this window. The phase itself moved ${fmtPct(p.pctAtStart, 1)} → ${fmtPct(p.pctAtEnd, 1)}.`}
          >
            {fmtPct(p.achievement, 0)}
          </span>
        );
      },
    },
    {
      key: 'phasemoved',
      label: 'Phase complete',
      value: (a) => phaseBy.get(a.phase)?.pctAtEnd ?? null,
      num: true,
      optional: true,
      hint: 'How complete this activity’s phase is at the end of the window, against that phase’s own budget.',
      render: (a) => {
        const p = phaseBy.get(a.phase);
        return p ? <span title={`${p.label} moved ${fmtPct(p.pctAtStart, 1)} → ${fmtPct(p.pctAtEnd, 1)} in this window`}>{fmtPct(p.pctAtEnd, 1)}</span> : <span className="text-[var(--text-subtle)]">—</span>;
      },
    },
    { key: 'loc', label: 'Loc', value: (a) => a.location },
    {
      key: 'planned',
      label: percent ? 'Planned' : 'Planned h',
      value: (a) => a.plannedHours,
      num: true,
      hint: 'What the baseline expected this activity to get through inside the period.',
      render: (a) => <span className="text-[var(--text-muted)]">{val(a.plannedHours, 1)}</span>,
    },
    {
      key: 'earned',
      label: percent ? 'Project achieved' : 'Project achieved h',
      value: (a) => a.earnedHours,
      num: true,
      hint: 'What this activity actually got through inside the period, against the whole job: hours, or the share of the project budget they are. Phase achieved is the same figure taken against its phase.',
      render: (a) => <b>{val(a.earnedHours, 1)}</b>,
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
    { key: 'budget', label: 'Budget h', value: (a) => a.budgetHours, num: true, optional: true, render: (a) => (percent ? '' : fmtHours(a.budgetHours)) },
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
    /*
     * Test progress, keyed here rather than on the screen that owns it.
     *
     * These write to `test-progress.json` through exactly the path the Test Progress
     * screen writes through, so a count keyed during a review IS the count on that
     * screen — the percent complete, the earned hours, the curve and this very log
     * all move on the next render. There is no copy of this data and nothing to
     * reconcile afterwards.
     */
    {
      key: 'ttot',
      label: 'Tests',
      value: (a) => a.testsTotal,
      num: true,
      hint: 'Test cases in this activity’s pack. Keyed here, stored on Test Progress: this is the same field, not a copy of it.',
      render: (a) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={keyed(a.activityId)?.testsTotal?.toString() ?? ''}
          placeholder="—"
          title="Test cases in the pack. Writes straight to Test Progress."
          onCommit={(v) => setTestProgress(actions.update, a.activityId, { testsTotal: num(v) })}
        />
      ),
    },
    {
      key: 'tdone',
      label: 'Done',
      value: (a) => a.testsComplete,
      num: true,
      hint: 'Test cases passed. With a total keyed, this is what the activity’s percent complete is worked out from.',
      render: (a) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={keyed(a.activityId)?.testsComplete?.toString() ?? ''}
          placeholder="—"
          title="Test cases passed. Writes straight to Test Progress."
          onCommit={(v) => setTestProgress(actions.update, a.activityId, { testsComplete: num(v) })}
        />
      ),
    },
    {
      key: 'tov',
      label: '% override',
      value: (a) => keyed(a.activityId)?.pctOverride ?? null,
      num: true,
      optional: true,
      hint: 'A percent complete keyed by hand. It beats the test counts. 0 to 1, or a percentage.',
      render: (a) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={keyed(a.activityId)?.pctOverride?.toString() ?? ''}
          placeholder="—"
          title="Beats the test counts. 0 to 1, or a percentage. Writes straight to Test Progress."
          onCommit={(v) => setTestProgress(actions.update, a.activityId, { pctOverride: asFraction(num(v)) })}
        />
      ),
    },
  ];

  const step = (n: number) => setEnd((e) => addDays(e, n * span));
  const achievedPctWidth = log.achievement === null ? 0 : Math.min(100, Math.round(log.achievement * 100));

  return (
    <Page
      eyebrow="Progress"
      title="Two-Week Log"
      subtitle={
        percent
          ? `${fmtDate(log.from)} to ${fmtDate(log.to)}. What the baseline said would happen in this window and what actually happened, as a share of the whole job. No hours anywhere on this screen.`
          : `${fmtDate(log.from)} to ${fmtDate(log.to)}. What the baseline said would happen in this window, what actually happened, and which activities are behind it. Hours are measured exactly as the S-curve measures them, so every window adds back to the same total.`
      }
      stats={heroStats}
      actions={
        <>
          <button className={`btn btn-mini${editingReasons ? ' btn-primary' : ''}`} onClick={() => setEditingReasons((v) => !v)} title="Add reasons to the Why missed list, or take off ones you never use">
            Reasons ({catalogue.length})
          </button>
          <button className="btn btn-mini" onClick={asText}>Copy as text</button>
          <a className="btn btn-mini" href={href('budget')}>Budget Master</a>
        </>
      }
      toolbar={
        <>
          <span className="seg">
            <button className={`seg-btn${percent ? '' : ' is-on'}`} onClick={() => setUnit('hours')}>Man hours</button>
            <button className={`seg-btn${percent ? ' is-on' : ''}`} onClick={() => setUnit('percent')} title="Report progress only, with no hours anywhere. For sharing with the client.">
              % complete
            </button>
          </span>
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

      {editingReasons && (
        <Panel
          className="mb-3"
          title="The Why missed list"
          meta={
            <span className="flex items-center gap-3">
              <button className="btn-link" onClick={addReason}>add a reason</button>
              <button className="btn-link" onClick={() => setEditingReasons(false)}>done</button>
            </span>
          }
        >
          <p className="mb-2 text-[12px] text-[var(--text-muted)]">
            What the dropdown offers on every missed activity. A reason nobody has used yet can be taken off — including the ones this app starts with, so a list you
            never picked can be cut down to the handful this job actually argues about. A reason somebody has already given stays, because deleting it would leave
            their answer with nothing to say it; the count beside it is how many activities carry it, across every period.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {catalogue.map((r) => {
              const used = usage.get(normKey(r)) ?? 0;
              return (
                <span key={r} className={`reason-chip${used ? ' is-used' : ''}`}>
                  <span>{r}</span>
                  {used > 0 ? (
                    <b className="reason-chip-n" title={`Given for ${used} ${used === 1 ? 'activity' : 'activities'}. In use, so it cannot be taken off the list.`}>{used}</b>
                  ) : (
                    <button
                      className="reason-chip-x"
                      title="Nobody has used this one. Take it off the list."
                      onClick={() => removeReasonFromCatalogue(actions.update, r)}
                    >
                      ×
                    </button>
                  )}
                </span>
              );
            })}
            {catalogue.length === 0 && <span className="text-[12px] text-[var(--text-muted)]">The list is empty. Add the reasons this job actually uses.</span>}
          </div>
        </Panel>
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
                <span className="plan-bar-val">{val(log.plannedHours)}</span>
              </div>
              <div className="plan-bar-row">
                <span className="plan-bar-key"><i style={{ background: ACHIEVED }} /> Achieved</span>
                <div className="plan-bar-track">
                  <span style={{ width: `${achievedPctWidth}%`, background: ACHIEVED }} />
                </div>
                <span className="plan-bar-val">{val(log.earnedHours)}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[12px]">
              <span>
                <b className={`text-[20px] ${variance >= 0 ? 'tone-good' : 'tone-bad'}`}>
                  {variance >= 0 ? '+' : ''}{val(variance)}
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

            {/*
              * The same two answers per phase. A program at 97% of plan routinely
              * hides one phase stalling behind another finishing early, and the
              * phase is what the person reading this actually runs — so it gets
              * the whole sentence the project gets, not a share of the project's.
              */}
            {activePhases.length > 0 && (
              <div className="mt-3 border-t border-[var(--line-soft)] pt-3">
                <div className="eyebrow mb-1.5">By phase</div>
                <div className="grid gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
                  {activePhases.map((p) => (
                    <div key={p.key || '#'} className="flex flex-wrap items-baseline gap-x-2">
                      <b className="text-[var(--text)]">{p.label}</b>
                      <span className={`font-semibold ${achievedTone(p.achievement)}`} title={`${val(p.earnedHours, 1)} achieved against ${val(p.plannedHours, 1)} planned in this window`}>
                        {p.achievement === null ? 'nothing planned' : `${fmtPct(p.achievement, 0)} of plan`}
                      </span>
                      <span className="text-[var(--text-muted)]">
                        moved <b className="text-[var(--text)]">{fmtPct(p.pctAtStart, 1)}</b> → <b className="text-[var(--text)]">{fmtPct(p.pctAtEnd, 1)}</b>
                        {' '}(<b className="text-[var(--text)]">{fmtPct(p.pctAtEnd - p.pctAtStart, 2)}</b> of the phase)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Why the missed ones were missed. The count nobody has answered for is
                the one that says whether the review actually happened, so it is
                stated rather than left as the gap between two other numbers. */}
            {missed.length > 0 && (
              <div className="mt-3 border-t border-[var(--line-soft)] pt-3">
                <div className="eyebrow mb-1.5">Why {missed.length} {missed.length === 1 ? 'activity was' : 'activities were'} missed</div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                  {reasonTally.given.map((t) => (
                    <span key={t.reason}>
                      <b className="text-[var(--text)]">{t.count}</b>
                      <span className="ml-1.5 text-[var(--text-muted)]">{t.reason}</span>
                    </span>
                  ))}
                  {reasonTally.unexplained > 0 && (
                    <span title="Set the Why missed column on each of these. It is remembered against this period.">
                      <b className="tone-bad">{reasonTally.unexplained}</b>
                      <span className="ml-1.5 text-[var(--text-muted)]">no reason given yet</span>
                      {outcome !== 'MISSED' && (
                        <button className="btn-link ml-2" onClick={() => setOutcome('MISSED')}>show them</button>
                      )}
                    </span>
                  )}
                  {reasonTally.carried > 0 && (
                    <span className="text-[var(--text-muted)]" title="These answers were given for another period and stay with the activity until this one gets its own. Pick a reason on the row to record it against this period.">
                      {reasonTally.carried} carried from an earlier review
                    </span>
                  )}
                  {reasonTally.given.length === 0 && reasonTally.unexplained === 0 && <span className="text-[var(--text-muted)]">—</span>}
                </div>
              </div>
            )}
          </div>

          <div style={{ height: 150 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chart} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={2}>
                <CartesianGrid stroke={GRID} vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} />
                <YAxis
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                  width={percent ? 52 : 44}
                  tickFormatter={(v: number) => (percent ? `${v}%` : fmtHours(v))}
                />
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
                        <div style={{ marginTop: 3 }}>Planned {percent ? `${d.planned}%` : `${fmtHours(d.planned)} h`}</div>
                        <div>Achieved {percent ? `${d.achieved}%` : `${fmtHours(d.achieved)} h`}</div>
                        <div style={{ fontWeight: 600, color: v >= 0 ? ACHIEVED : '#c01017' }}>
                          {v >= 0 ? '+' : ''}{percent ? `${Math.round(v * 100) / 100}%` : `${fmtHours(v)} h`}
                        </div>
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
          exportName="two-week-log"
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
          <b>Planned</b> is what the baseline said would get done between these dates; <b>achieved</b> is what actually did.{' '}
          {percent ? 'Both are shown as a share of the whole job.' : 'Both are in budget hours.'} Both spread an activity's hours
          evenly across its window by calendar day, exactly as the S-curve does, so every two-week window adds back to the same totals the curve draws — this screen can
          never disagree with the Dashboard.
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          An activity appears here if it did something in the window <i>or was supposed to</i>. That is what makes <b>NOT STARTED</b> and <b>MISSED</b> meaningful: they
          are the activities the plan was counting on. <b>MISSED</b> beats <b>STARTED</b> and <b>CONTINUED</b> deliberately — an activity that was due to finish here and
          did not is late, whatever else it also did. Activities with progress but no usable dates earn hours that belong to no window at all; the{' '}
          <a href={href('team')}>Earned vs {TERMS.built}</a> screen reports that figure.
        </p>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          <b>COMPLETED</b> is read off the actual dates — your test window where you keyed one, otherwise P6's actual dates — and never off a planned date. So an activity
          that beat its baseline reads <b>COMPLETED</b> in the fortnight it finished <i>and</i> in the next one, where its baseline hours still accrue: it is finished, and
          it stays finished. <b>Phase achieved</b> is this row's own contribution to its phase, the same way <b>{percent ? 'Project achieved' : 'Project achieved h'}</b> is
          its contribution to the job, so the rows of a phase add up to how far that phase moved. <b>Why missed</b> and <b>Progress note</b> stay with the Activity ID: the
          note is the same field <a href={href('progress')}>Test Progress</a> shows, and a reason keyed for a neighbouring period is carried rather than lost when the end date
          moves.
        </p>
      </Panel>
    </Page>
  );
}

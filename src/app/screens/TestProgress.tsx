import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, ActualDateCell, Badge, statusTone, Notice, Panel, type Column, type HeroStat } from '../components/ui';
import type { TestProgress as TP, BudgetRow, TestProgressCheck } from '../../engine/types';
import { fmtPct, fmtHours, fmtDate, num } from '../format';
import { normKey } from '../../engine/keys';
import { parseDelimitedText } from '../../engine/parse';
import { readWorkbook, pickSheet, workbookGrid } from '../../engine/workbook';
import { parseP6Date, isValidISO } from '../../engine/dates';
import { href, type Route } from '../router';
import { setTestProgress, clearTestProgress, tidyTestProgress as tidy, asFraction } from '../testProgress';

/** What the user is looking for when they open this screen. */
type StateFilter = 'all' | 'missing' | 'keyed' | 'started' | 'done' | 'nowindow';

const STATE_LABEL: Record<StateFilter, string> = {
  all: 'All budgeted activities',
  missing: 'No counts keyed yet',
  keyed: 'Counts keyed',
  started: 'Started, not finished',
  done: 'Complete',
  nowindow: 'Earning, but in no month',
};

type Row = BudgetRow & { entry: TP | undefined };

export function TestProgress({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const [phase, setPhase] = useState('');
  const [loc, setLoc] = useState('');
  const [stateFilter, setStateFilter] = useState<StateFilter>(route.params.get('flag') === 'missing' ? 'missing' : 'all');
  const [text, setText] = useState('');
  const [paste, setPaste] = useState('');
  const [bulkTotal, setBulkTotal] = useState('');
  const [showOrphans, setShowOrphans] = useState(false);
  /** Bulk tools are the exception, not the routine, so they stay folded away. */
  const [showBulk, setShowBulk] = useState(false);

  const entries = useMemo(() => {
    const m = new Map<string, TP>();
    for (const t of state.data.testProgress) {
      const k = normKey(t.activityId);
      if (!m.has(k)) m.set(k, t);
    }
    return m;
  }, [state.data.testProgress]);

  /**
   * The worksheet is the budgeted schedule itself. There is no list to build: every
   * activity that carries hours gets a row, whether or not anything has been keyed
   * against it yet.
   */
  const budgeted = useMemo(() => model.rows.filter((r) => r.status === 'IN BUDGET'), [model.rows]);

  const rows = useMemo<Row[]>(() => {
    let out: Row[] = budgeted.map((r) => ({ ...r, entry: entries.get(normKey(r.activityId)) }));
    if (phase) out = out.filter((r) => r.phase === phase);
    if (loc) out = out.filter((r) => r.location === loc);
    if (stateFilter === 'missing') out = out.filter((r) => !r.entry);
    if (stateFilter === 'keyed') out = out.filter((r) => !!r.entry);
    if (stateFilter === 'started') out = out.filter((r) => r.pctComplete > 0 && r.pctComplete < 1);
    if (stateFilter === 'done') out = out.filter((r) => r.pctComplete >= 1);
    if (stateFilter === 'nowindow') out = out.filter((r) => r.pctComplete > 0 && !r.earnStart);
    if (text.trim()) {
      const f = text.toLowerCase();
      out = out.filter((r) => r.activityId.toLowerCase().includes(f) || r.activityName.toLowerCase().includes(f));
    }
    return out;
  }, [budgeted, entries, phase, loc, stateFilter, text]);

  /**
   * Keyed rows that are doing nothing, with the detail needed to decide about them.
   *
   * The engine works these out, because deciding whether a keyed row is junk needs
   * the whole schedule and the library, not just the list of budgeted IDs. What
   * comes back carries the name, where it sat, what was keyed, and a sentence
   * saying why it matches nothing — a bare Activity ID never told anybody whether
   * deleting it would lose something.
   */
  const orphans = useMemo(() => model.testProgressChecks.filter((c) => !c.inBudget), [model.testProgressChecks]);

  /** The ones that are certainly junk: WBS headers and IDs in no schedule at all. */
  const removable = useMemo(() => orphans.filter((c) => c.status === 'not in extract' || c.rowType === 'WBS'), [orphans]);

  /**
   * Activities that have earned hours but sit in no month.
   *
   * Progress and dates are two separate facts here. Keying a percent says HOW MUCH
   * was done; it says nothing about WHEN, and the when is what puts hours on the
   * S-curve and into an Earned-vs-Built month. An activity at 100% that P6 has
   * never actually started, and that carries no test window, earns its hours into
   * the project total and into no month at all. That is not a rounding difference,
   * it is the gap the Earned vs Actual screen reports as unphased.
   */
  const noWindow = useMemo(() => budgeted.filter((r) => r.pctComplete > 0 && !r.earnStart), [budgeted]);

  const now = () => new Date().toISOString();

  /*
   * Both of these go through `src/app/testProgress.ts`, which is also what the
   * Two-Week Log writes with. One upsert path, so a count keyed in a review and a
   * count keyed here are the same act on the same file.
   */
  const setField = (activityId: string, patch: Partial<TP>) => setTestProgress(actions.update, activityId, patch);

  const clearRow = (activityId: string) => clearTestProgress(actions.update, activityId);

  const markComplete = (r: Row) => {
    if (r.testsTotal && r.testsTotal > 0) setField(r.activityId, { testsComplete: r.testsTotal });
    else setField(r.activityId, { pctOverride: 1 });
  };

  const applyBulkTotal = () => {
    const n = num(bulkTotal);
    if (n === undefined || n <= 0) return;
    const ids = rows.map((r) => r.activityId);
    actions.update('testProgress', (tps) => {
      const next = [...tps];
      for (const id of ids) {
        const i = next.findIndex((t) => normKey(t.activityId) === normKey(id));
        if (i >= 0) next[i] = tidy({ ...next[i], testsTotal: n, updatedAt: now() });
        else next.push(tidy({ activityId: id, testsTotal: n, updatedAt: now() }));
      }
      return next;
    });
    setBulkTotal('');
    actions.notify('ok', `Set tests total to ${n} on ${ids.length} activities. Save to write.`);
  };

  /** Bulk load: Activity ID, total, complete, then optional % override and window dates. */
  const applyGrid = (grid: unknown[][], sourceLabel: string) => {
    let added = 0;
    let updated = 0;
    let unknown = 0;
    const budgetedIds = new Set(budgeted.map((r) => normKey(r.activityId)));
    const next = [...state.data.testProgress];
    for (const cells of grid) {
      const id = String(cells[0] ?? '').trim();
      if (!id || /^(p6_)?activity[ _]?id$/i.test(id)) continue;
      const tot = num(String(cells[1] ?? ''));
      const comp = num(String(cells[2] ?? ''));
      const pct = asFraction(num(String(cells[3] ?? '')));
      const ts = parseP6Date(cells[4] ?? '').iso ?? undefined;
      const te = parseP6Date(cells[5] ?? '').iso ?? undefined;
      const note = String(cells[6] ?? '').trim() || undefined;
      const asOf = parseP6Date(cells[7] ?? '').iso ?? undefined;
      if (!budgetedIds.has(normKey(id))) unknown += 1;
      const patch = tidy({ activityId: id, testsTotal: tot, testsComplete: comp, pctOverride: pct, testStartOverride: ts, testEndOverride: te, note, progressAsOf: asOf, updatedAt: now() });
      const i = next.findIndex((t) => normKey(t.activityId) === normKey(id));
      if (i >= 0) {
        next[i] = { ...next[i], ...patch };
        updated++;
      } else {
        next.push(patch);
        added++;
      }
    }
    actions.update('testProgress', () => next);
    setPaste('');
    if (added === 0 && updated === 0) actions.notify('error', `No usable rows found in ${sourceLabel}. Expected Activity ID, tests total, tests complete.`);
    else actions.notify(unknown ? 'info' : 'ok', `${sourceLabel}: ${added} added, ${updated} updated${unknown ? `, ${unknown} not a budgeted activity` : ''}. Save to write.`);
  };

  const applyFile = async (file: File) => {
    try {
      if (/\.xlsx?$|\.xlsm$/i.test(file.name)) {
        const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()));
        applyGrid(workbookGrid(wb, pickSheet(wb)), file.name);
      } else {
        applyGrid(parseDelimitedText(await file.text()), file.name);
      }
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  /** Delete a set of keyed rows, naming what is going so the confirm is informed. */
  const removeChecks = (list: TestProgressCheck[], what: string) => {
    if (list.length === 0) return;
    if (!confirm(`Delete the test counts keyed against ${list.length} ${what} ${list.length === 1 ? 'activity' : 'activities'}? The keying cannot be recovered.`)) return;
    const ids = new Set(list.map((c) => normKey(c.activityId)));
    actions.update('testProgress', (tps) => tps.filter((t) => !ids.has(normKey(t.activityId))));
    actions.notify('ok', `Removed ${list.length} keyed ${list.length === 1 ? 'row' : 'rows'}. Save to write.`);
  };

  /** What a keyed row that earns nothing needs to say for itself. */
  const orphanColumns: Column<TestProgressCheck>[] = [
    {
      key: 'id',
      label: 'Activity',
      value: (c) => c.activityId,
      hint: 'The Activity ID as it was keyed, and the name of the activity it points at when there is one.',
      render: (c) => (
        <div className="min-w-0">
          <div className="mono text-[var(--text-muted)]">{c.activityId}</div>
          <div className="cell-text font-semibold" title={c.p6Name ? `Renamed by you. P6 calls this:\n${c.p6Name}` : (c.activityName ?? '')}>
            {c.activityName ?? <span className="font-normal text-[var(--text-subtle)]">no activity with this ID</span>}
          </div>
        </div>
      ),
    },
    { key: 'status', label: 'What it is', value: (c) => c.status, render: (c) => <Badge tone={statusTone(c.status === 'not in extract' || c.status === 'not budgeted' ? 'NONE' : c.status === 'hidden' ? 'EXCLUDED' : c.status)}>{c.status}</Badge> },
    { key: 'phase', label: 'Phase', value: (c) => c.phaseName },
    { key: 'loc', label: 'Loc', value: (c) => c.location },
    {
      key: 'type',
      label: 'Type',
      value: (c) => c.activityType,
      render: (c) => <span className="cell-text" title={c.activityType}>{c.activityType || <span className="text-[var(--text-subtle)]">—</span>}</span>,
    },
    { key: 'budget', label: 'Budget h', value: (c) => c.budgetHours, num: true, render: (c) => (c.budgetHours === null ? <span className="text-[var(--text-subtle)]">—</span> : fmtHours(c.budgetHours)) },
    {
      key: 'keyed',
      label: 'Keyed',
      value: (c) => c.testsTotal ?? c.pctOverride ?? 0,
      hint: 'What you would lose by deleting this row: the test counts, the percent override, the window dates and the progress note keyed against it.',
      render: (c) => (
        <span className="text-[12px]">
          {c.testsTotal !== null && <>{c.testsComplete ?? 0}/{c.testsTotal} tests</>}
          {c.pctOverride !== null && <>{c.testsTotal !== null ? ', ' : ''}{fmtPct(c.pctOverride, 0)} override</>}
          {c.testStartOverride && <>, from {c.testStartOverride}</>}
          {c.testEndOverride && <> to {c.testEndOverride}</>}
          {c.progressAsOf && <>, progress as at {c.progressAsOf}</>}
          {c.note && <>, a note: <span title={c.note}>“{c.note.length > 40 ? `${c.note.slice(0, 40)}…` : c.note}”</span></>}
          {c.testsTotal === null && c.pctOverride === null && !c.testStartOverride && !c.testEndOverride && !c.progressAsOf && !c.note && (
            <span className="text-[var(--text-subtle)]">nothing</span>
          )}
        </span>
      ),
    },
    {
      key: 'reason',
      label: 'Why it earns nothing, and what to do',
      value: (c) => c.reason,
      hint: '',
      // `.tbl td` sets nowrap and outranks a utility class on specificity, so the
      // sentence has to be told inline that it may wrap or it runs off the table.
      render: (c) => <span className="block text-[12px] text-[var(--text-muted)]" style={{ maxWidth: '34rem', whiteSpace: 'normal' }}>{c.reason}</span>,
    },
    {
      key: 'act',
      label: '',
      value: () => '',
      hint: '',
      render: (c) => (
        <button className="btn-link danger text-[11px]" title="Delete the counts keyed against this Activity ID" onClick={() => clearRow(c.activityId)}>
          remove
        </button>
      ),
    },
  ];

  const covered = budgeted.filter((r) => r.hasTestCounts || r.pctSource === 'OVERRIDE').length;
  const testsTotal = budgeted.reduce((s, r) => s + (r.testsTotal ?? 0), 0);
  const testsDone = budgeted.reduce((s, r) => s + (r.testsComplete ?? 0), 0);
  const heroStats: HeroStat[] = [
    { label: 'Coverage', value: `${covered}/${budgeted.length}`, tone: covered === budgeted.length ? 'good' : 'amber' },
    { label: 'Test cases', value: `${testsDone}/${testsTotal}`, tone: 'muted' },
    { label: 'Earned', value: fmtPct(model.summary.pctComplete, 0), tone: 'blue' },
  ];

  const opts = (vals: string[], allLabel: string) => [
    { value: '', label: allLabel },
    ...[...new Set(vals)].filter(Boolean).sort().map((v) => ({ value: v, label: v })),
  ];

  const columns: Column<Row>[] = [
    {
      key: 'id',
      label: 'Activity',
      locked: true,
      value: (r) => r.activityId,
      render: (r) => (
        <div className="min-w-0">
          <div className="mono text-[var(--text-muted)]">{r.activityId}</div>
          <div className="cell-text font-semibold" title={r.renamed ? `Renamed by you. P6 calls this:\n${r.activity.activityName}` : r.activityName}>
            {r.activityName}
          </div>
        </div>
      ),
    },
    { key: 'phase', label: 'Phase', value: (r) => r.phaseName },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    /*
     * The P6 dates, read-only, so the window you are keying against is on the same
     * row as the keying. An "A" is P6 saying that date is actual rather than
     * planned, and it is what decides whether the activity earns to its own finish
     * or only as far as the data date.
     */
    {
      key: 'p6s',
      label: 'P6 start',
      value: (r) => r.currentStart,
      hint: 'Start from the current P6 schedule. "A" means P6 records it as an actual start, not a plan. Read-only: it changes on the next import.',
      render: (r) => <P6Date iso={r.currentStart} raw={r.activity.startRaw} actual={r.activity.actualStart} />,
    },
    {
      key: 'p6f',
      label: 'P6 finish',
      value: (r) => r.currentFinish,
      hint: 'Finish from the current P6 schedule. "A" means P6 records it as an actual finish, which is what closes the earn window.',
      render: (r) => <P6Date iso={r.currentFinish} raw={r.activity.finishRaw} actual={r.activity.actualFinish} />,
    },
    {
      key: 'bls',
      label: 'BL start',
      value: (r) => r.baselineStart,
      optional: true,
      render: (r) => <span className="text-[var(--text-muted)]">{fmtDate(r.baselineStart)}</span>,
    },
    {
      key: 'blf',
      label: 'BL finish',
      value: (r) => r.baselineFinish,
      optional: true,
      render: (r) => <span className="text-[var(--text-muted)]">{fmtDate(r.baselineFinish)}</span>,
    },
    { key: 'od', label: 'OD', value: (r) => r.activity.originalDuration, num: true, optional: true },
    {
      key: 'total',
      label: 'Tests total',
      value: (r) => r.testsTotal,
      num: true,
      render: (r) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={r.entry?.testsTotal?.toString() ?? ''}
          placeholder="—"
          onCommit={(v) => setField(r.activityId, { testsTotal: num(v) })}
        />
      ),
    },
    {
      key: 'done',
      label: 'Complete',
      value: (r) => r.testsComplete,
      num: true,
      render: (r) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={r.entry?.testsComplete?.toString() ?? ''}
          placeholder="—"
          onCommit={(v) => setField(r.activityId, { testsComplete: num(v) })}
        />
      ),
    },
    {
      key: 'pct',
      label: '% complete',
      value: (r) => r.pctComplete,
      num: true,
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="tabular-nums">{fmtPct(r.pctComplete, 0)}</span>
          <div className={`bar ${r.pctComplete >= 1 ? '' : r.pctSource === 'P6' ? 'is-muted' : 'is-warn'}`} style={{ width: 54 }}>
            <span style={{ width: `${Math.round(r.pctComplete * 100)}%` }} />
          </div>
        </div>
      ),
    },
    { key: 'src', label: 'Source', value: (r) => r.pctSource, render: (r) => <Badge tone={statusTone(r.pctSource)}>{r.pctSource}</Badge> },
    {
      key: 'ov',
      label: '% override',
      value: (r) => r.entry?.pctOverride ?? null,
      num: true,
      render: (r) => (
        <CellInput
          type="number"
          className="cell-input text-right"
          value={r.entry?.pctOverride?.toString() ?? ''}
          placeholder="—"
          title="Beats the test counts. 0 to 1, or a percentage."
          onCommit={(v) => setField(r.activityId, { pctOverride: asFraction(num(v)) })}
        />
      ),
    },
    /*
     * The actual dates, keyed here or on the Two-Week Log.
     *
     * These boxes used to show ONLY what had been keyed, so an activity P6 had
     * dated sat here blank while the log two screens over showed its actual dates
     * — the same fact, one screen admitting it and one not. They now show the
     * effective date with a marker saying where it came from, and typing still
     * writes the override that beats P6. Clearing hands the date back to P6, and
     * typing P6's own date back in is read as that rather than stored as an
     * override shadowing it.
     */
    {
      key: 'ts',
      label: 'Actual start',
      value: (r) => r.actualStart ?? '',
      hint: 'When the activity really began: your keyed date, or P6’s actual start. Type to override P6, clear to hand it back. The Two-Week Log edits the same field.',
      render: (r) => (
        <ActualDateCell
          shown={r.actualStart}
          keyed={r.entry?.testStartOverride}
          p6={r.activity.actualStart ? r.activity.startDate : null}
          what="start"
          onCommit={(iso) => setField(r.activityId, { testStartOverride: iso })}
        />
      ),
    },
    {
      key: 'te',
      label: 'Actual finish',
      value: (r) => r.actualFinish ?? '',
      hint: 'When the activity really finished: your keyed date, or P6’s actual finish. Blank means nothing has dated it yet, so it earns only as far as the data date.',
      render: (r) => (
        <ActualDateCell
          shown={r.actualFinish}
          keyed={r.entry?.testEndOverride}
          p6={r.activity.actualFinish ? r.activity.finishDate : null}
          what="finish"
          onCommit={(iso) => setField(r.activityId, { testEndOverride: iso })}
        />
      ),
    },
    /*
     * The same note the Two-Week Log keys, not a copy of it. Both screens write
     * through `setTestProgress`, so whichever one a person happens to be on when
     * they have the answer in their head is the right one to write it on.
     */
    {
      key: 'note',
      label: 'Progress note',
      value: (r) => r.entry?.note ?? '',
      hint: 'Anything about this activity worth saying at a review. The same field the Two-Week Log shows — write it in either place. Not the Budget Master note, which explains a pricing or visibility decision.',
      render: (r) => (
        <CellInput
          className="cell-input cell-wide"
          value={r.entry?.note ?? ''}
          placeholder="—"
          title={r.entry?.note || 'Your own words on this activity. The Two-Week Log shows and edits the same note.'}
          onCommit={(v) => setField(r.activityId, { note: v })}
        />
      ),
    },
    /*
     * When the progress happened, for an activity that has not finished.
     *
     * Without it the earn window runs to the data date, on the assumption the work
     * is still going on — so a stale half-done activity keeps dribbling hours into
     * every month and every fortnightly review. This closes the window where the
     * work really stopped. It is not a finish: the activity is still open.
     */
    {
      key: 'pasof',
      label: 'Progress as at',
      value: (r) => r.progressAsOf ?? '',
      hint: 'The date this percent complete was true as at. Until it is set, an unfinished activity’s hours spread all the way to the data date, so it shows movement in every month and every two-week log since it started.',
      render: (r) =>
        r.actualFinish ? (
          <span className="text-[var(--text-subtle)]" title="It has an actual finish, so the window ends there.">—</span>
        ) : (
          <CellInput
            type="date"
            value={r.entry?.progressAsOf ?? ''}
            title={
              r.progressAsOf
                ? `Its hours accrue up to ${fmtDate(r.progressAsOf)} and no further.`
                : 'Nothing says when this progress happened, so its hours spread evenly to the data date. Type the date the work actually reached this percent.'
            }
            onCommit={(v) => setField(r.activityId, { progressAsOf: isValidISO(v) ? v : undefined })}
          />
        ),
    },
    { key: 'es', label: 'Earn start', value: (r) => r.earnStart, optional: true, render: (r) => fmtDate(r.earnStart) },
    { key: 'ee', label: 'Earn end', value: (r) => r.earnEnd, optional: true, render: (r) => fmtDate(r.earnEnd) },
    { key: 'win', label: 'Window', value: (r) => r.earnWindowSource, render: (r) => <Badge tone={statusTone(r.earnWindowSource)}>{r.earnWindowSource}</Badge> },
    {
      key: 'act',
      label: '',
      value: () => '',
      render: (r) => (
        <span className="flex gap-2">
          {r.pctComplete < 1 && (
            <button className="btn-link text-[11px]" title="Set complete to the total, or 100% when there is no total" onClick={() => markComplete(r)}>
              done
            </button>
          )}
          {r.entry && (
            <button className="btn-link danger text-[11px]" title="Remove everything keyed against this activity" onClick={() => clearRow(r.activityId)}>
              clear
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <Page
      eyebrow="Progress"
      title="Test Progress"
      subtitle="Every budgeted activity is already listed. Key the test case counts against the ones you track; anything left blank falls back to P6 duration."
      stats={heroStats}
      toolbar={
        <>
          <input className="input" placeholder="Search ID or name" value={text} onChange={(e) => setText(e.target.value)} />
          <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>
            {opts(budgeted.map((r) => r.phase), 'All phases').map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === '' ? o.label : model.groups.phase.find((g) => g.key === o.value)?.label ?? o.label}
              </option>
            ))}
          </select>
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>
            {opts(budgeted.map((r) => r.location), 'All locations').map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <select className="input" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as StateFilter)}>
            {(Object.keys(STATE_LABEL) as StateFilter[]).map((k) => (
              <option key={k} value={k}>{STATE_LABEL[k]}</option>
            ))}
          </select>
          <button className={`btn btn-mini ${showBulk ? 'btn-primary' : ''}`} onClick={() => setShowBulk((v) => !v)}>
            Bulk tools
          </button>
          <span className="ml-auto text-[11.5px] text-[var(--text-muted)]">
            {rows.length} of {budgeted.length} shown
          </span>
        </>
      }
    >
      <details className="card mb-4">
        <summary className="cursor-pointer card-title">
          Which dates decide when an activity earns — and what the monthly P6 import changes
        </summary>
        <div className="mt-3 grid gap-3 text-[12px] text-[var(--text-muted)] lg:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">Two separate facts</div>
            <p className="mt-1">
              <b>How much</b> is done comes from this screen: the test counts, or a % override. <b>When</b> it was done comes from the actual dates, which are P6's until
              you type over them in Actual start and Actual finish — here or on the <a href={href('period')}>Two-Week Log</a>, which edits the same field. Marking a row
              <b> done</b> sets the count, not a date. It stamps nothing, and the date you clicked it is recorded for the audit trail only — no curve, no month and no
              snapshot ever reads it.
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">Where the window comes from</div>
            <p className="mt-1">The earn window is picked in this order, and the Window column says which one won:</p>
            <ul className="mt-1 list-disc pl-4">
              <li><b>TEST WINDOW</b> — a date you keyed at either end. Yours beats P6, end for end.</li>
              <li><b>P6 ACTUAL</b> — P6's actual start to its actual finish. Both must be actual dates (the <span className="mono">A</span> flag), not planned ones.</li>
              <li><b>PROGRESS AS AT</b> — started, not finished, and you have said when the progress got to where it is. The window ends there, so nothing accrues after it.</li>
              <li><b>IN PROGRESS</b> — an actual start, no actual finish and no progress date, so the window runs from that start to the <b>data date</b> in Settings and the hours spread across every month in between.</li>
              <li><b>NOT STARTED</b> — no actual start and no test start. There is no window, so the hours belong to no month.</li>
            </ul>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">How hours land in a month</div>
            <p className="mt-1">
              The hours spread evenly across the window by calendar day, and each month gets what accrued inside it. An activity running 10 Aug to 10 Sep puts roughly two
              thirds of its earned hours in August and a third in September; it is not credited in a lump at either end. The P6 work calendar is ignored, so a window
              spanning a shutdown still accrues straight through it. A green <b>✎</b> beside a date means you keyed it; a grey <b>A</b> means it is P6's own actual date.
            </p>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">What the monthly import changes</div>
            <p className="mt-1">
              A current-schedule import rewrites P6's dates and durations, and nothing else. An activity that read IN PROGRESS against the data date last month, and comes
              back carrying a real actual finish, becomes P6 ACTUAL — so its window ends on the day it really finished and its hours <b>re-spread across the months
              retrospectively</b>. The S-curve and the Earned vs Actual rows for earlier months can therefore move on an import. Anything you keyed here — counts, %
              override, test window — is untouched and keeps overriding P6.
            </p>
            <p className="mt-1">
              Snapshots are the exception, and the reason to take one: a snapshot is frozen on the day it is written and is the only record of what the numbers said at the
              time.
            </p>
          </div>
          <div className="lg:col-span-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text)]">Reading a month, e.g. August</div>
            <p className="mt-1">
              <b>Finished in August</b> is Earn end in August; <b>started in August</b> is Earn start in August; <b>worked on during August</b> is any window that overlaps
              it, which is what the August row on Earned vs Actual adds up. All three columns — Earn start, Earn end and Window — are on <a href={href('budget')}>Budget
              Master</a>, where they can be sorted and filtered. If P6 is the only thing dating an activity, then August is only right once the August import has landed
              with the actual dates in it; where you know better than P6, type over Actual start and Actual finish — here or on the Two-Week Log — and yours win permanently.
            </p>
          </div>
        </div>
      </details>

      {noWindow.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            <b>{noWindow.length} {noWindow.length === 1 ? 'activity has' : 'activities have'} progress but no date to hang it on.</b> They have a percent complete, so their
            hours count in the project total, but P6 has never actually started them and no test window is keyed — so those hours land in no month, appear on no point of
            the S-curve, and are what Earned vs Actual reports as unphased. Give each one a <b>Test start</b> and <b>Test end</b>, or wait for the P6 import that carries its
            actual dates.{' '}
            <button className="btn-link" onClick={() => setStateFilter('nowindow')}>show them</button>
          </Notice>
        </div>
      )}

      {budgeted.length === 0 && (
        <div className="mb-4">
          <Notice tone="info">
            Nothing is budgeted yet, so there is nothing to track. Import a schedule and price the activity library first.
          </Notice>
        </div>
      )}

      {showBulk && (
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Panel title="Set a test count across the filter">
          <p className="mb-2 text-[11.5px] text-[var(--text-subtle)]">
            Applies to the {rows.length} activities currently shown. Use it when a whole location or phase runs the same test pack.
          </p>
          <div className="flex gap-2">
            <input className="input w-28" type="number" placeholder="Tests total" value={bulkTotal} onChange={(e) => setBulkTotal(e.target.value)} />
            <button className="btn" disabled={!num(bulkTotal) || rows.length === 0} onClick={applyBulkTotal}>
              Apply to {rows.length}
            </button>
          </div>
        </Panel>

        <Panel title="Load counts from a file or a paste" className="lg:col-span-2">
          <div
            className="dropzone p-3"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) void applyFile(f);
            }}
          >
            <p className="text-[11.5px] text-[var(--text-subtle)]">
              Columns: Activity ID, tests total, tests complete, then optional % override, actual start, actual finish, progress note, progress as at. Drop an .xlsx or .csv here, or paste below.
            </p>
            <input className="mt-2 block text-[12px]" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void applyFile(f); }} />
            <textarea
              className="input mt-2 h-14 w-full font-mono text-[11px]"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={'0-P2-TC-W40-FA-0100\t120\t46'}
            />
            <button className="btn btn-mini mt-2" disabled={!paste.trim()} onClick={() => applyGrid(parseDelimitedText(paste), 'Pasted block')}>
              Apply pasted block
            </button>
          </div>
        </Panel>
      </div>
      )}

      {orphans.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            <b>{orphans.length} keyed {orphans.length === 1 ? 'row is' : 'rows are'} doing nothing.</b> The counts are stored but the activity they name carries no budget
            hours, so nothing can be earned from them. They are not all the same problem, and the ones worth keeping are not the ones worth deleting — open the list to see
            what each one actually is.{' '}
            <button className="btn-link" onClick={() => setShowOrphans((v) => !v)}>
              {showOrphans ? 'hide the detail' : `show all ${orphans.length}`}
            </button>
          </Notice>
        </div>
      )}

      {orphans.length > 0 && showOrphans && (
        <Panel
          title={`${orphans.length} keyed rows that are earning nothing`}
          meta={
            <span className="flex flex-wrap items-center gap-2">
              {removable.length > 0 && (
                <button
                  className="btn btn-mini"
                  title="WBS summary headers and Activity IDs that are in no schedule. These can never carry hours."
                  onClick={() => removeChecks(removable, 'certainly dead')}
                >
                  Remove the {removable.length} that {removable.length === 1 ? 'is' : 'are'} certainly dead
                </button>
              )}
              <button className="btn btn-mini danger" onClick={() => removeChecks(orphans, 'unmatched')}>
                Remove all {orphans.length}
              </button>
            </span>
          }
          className="mb-4"
        >
          <SortableTable
            rows={orphans}
            columns={orphanColumns}
            rowKey={(c) => c.activityId}
            defaultSort={{ key: 'status', dir: 'asc' }}
            maxHeight="340px"
            rowClass={(c) => (c.status === 'REVIEW' || c.status === 'IN BUDGET' ? 'row-warn' : '')}
          />
          <p className="mt-2 text-[11.5px] text-[var(--text-muted)]">
            <b>Not in extract</b> and <b>WBS</b> rows are safe to delete: no activity can ever claim them. A <b>REVIEW</b> or <b>EXCLUDED</b> row is the opposite — the
            activity is really there and your counts are real, and it is the Activity Library or the Show column that is stopping it earning. Fix that and the counts start
            working; delete the row and you lose the keying.
          </p>
        </Panel>
      )}

      <SortableTable
        tableId="test-progress"
        exportName="test-progress"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.activityId}
        maxHeight={showBulk ? 'calc(100vh - 430px)' : 'calc(100vh - 250px)'}
        rowClass={(r) => (r.pctComplete >= 1 ? '' : r.entry ? '' : 'row-muted')}
      />
    </Page>
  );
}

/**
 * A P6 date as the schedule states it: the date, an "A" when P6 marks it actual,
 * and the raw cell in red when it could not be parsed at all — because a date the
 * app silently dropped is the kind of thing that makes a curve wrong quietly.
 */
function P6Date({ iso, raw, actual }: { iso: string | null; raw: string; actual: boolean }) {
  if (!iso && raw) return <span className="text-[var(--bad)]" title="P6 sent a date this app could not read">{raw}</span>;
  if (!iso) return <span className="text-[var(--text-subtle)]">—</span>;
  return (
    <span className="tabular-nums">
      {fmtDate(iso)}
      {actual && <b className="ml-1 text-[var(--good)]" title="P6 records this as an actual date">A</b>}
    </span>
  );
}

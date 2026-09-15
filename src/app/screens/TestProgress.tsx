import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Badge, statusTone, Notice, Panel, type Column, type HeroStat } from '../components/ui';
import type { TestProgress as TP, BudgetRow } from '../../engine/types';
import { fmtPct, fmtHours, num } from '../format';
import { normKey } from '../../engine/keys';
import { parseDelimitedText } from '../../engine/parse';
import { readWorkbook, pickSheet, workbookGrid } from '../../engine/workbook';
import { parseP6Date, isValidISO } from '../../engine/dates';
import type { Route } from '../router';

/** What the user is looking for when they open this screen. */
type StateFilter = 'all' | 'missing' | 'keyed' | 'started' | 'done';

const STATE_LABEL: Record<StateFilter, string> = {
  all: 'All budgeted activities',
  missing: 'No counts keyed yet',
  keyed: 'Counts keyed',
  started: 'Started, not finished',
  done: 'Complete',
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
    if (text.trim()) {
      const f = text.toLowerCase();
      out = out.filter((r) => r.activityId.toLowerCase().includes(f) || r.activity.activityName.toLowerCase().includes(f));
    }
    return out;
  }, [budgeted, entries, phase, loc, stateFilter, text]);

  /** Stored rows whose Activity ID is not a budgeted activity any more. */
  const orphans = useMemo(() => {
    const budgetedIds = new Set(budgeted.map((r) => normKey(r.activityId)));
    return state.data.testProgress.filter((t) => !budgetedIds.has(normKey(t.activityId)));
  }, [state.data.testProgress, budgeted]);

  const now = () => new Date().toISOString();

  /**
   * One upsert path for every edit. An entry is created when the first field is
   * filled and removed again when the last one is cleared, so the stored file only
   * ever holds activities someone actually keyed something against.
   */
  const setField = (activityId: string, patch: Partial<TP>) => {
    actions.update('testProgress', (tps) => {
      const i = tps.findIndex((t) => normKey(t.activityId) === normKey(activityId));
      const base: TP = i >= 0 ? tps[i] : { activityId, updatedAt: now() };
      const next = tidy({ ...base, ...patch, updatedAt: now() });
      const empty =
        next.testsTotal === undefined &&
        next.testsComplete === undefined &&
        next.pctOverride === undefined &&
        next.testStartOverride === undefined &&
        next.testEndOverride === undefined;
      if (empty) return i >= 0 ? tps.filter((_, j) => j !== i) : tps;
      if (i >= 0) return tps.map((t, j) => (j === i ? next : t));
      return [...tps, next];
    });
  };

  const clearRow = (activityId: string) =>
    actions.update('testProgress', (tps) => tps.filter((t) => normKey(t.activityId) !== normKey(activityId)));

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
      let pct = num(String(cells[3] ?? ''));
      if (pct !== undefined && pct > 1) pct = pct / 100;
      const ts = parseP6Date(cells[4] ?? '').iso ?? undefined;
      const te = parseP6Date(cells[5] ?? '').iso ?? undefined;
      if (!budgetedIds.has(normKey(id))) unknown += 1;
      const patch = tidy({ activityId: id, testsTotal: tot, testsComplete: comp, pctOverride: pct, testStartOverride: ts, testEndOverride: te, updatedAt: now() });
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
      value: (r) => r.activityId,
      render: (r) => (
        <div className="min-w-0">
          <div className="mono text-[var(--text-muted)]">{r.activityId}</div>
          <div className="max-w-[26rem] truncate font-semibold" title={r.activity.activityName}>
            {r.activity.activityName}
          </div>
        </div>
      ),
    },
    { key: 'phase', label: 'Phase', value: (r) => r.phaseName },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
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
          onCommit={(v) => {
            let n = num(v);
            if (n !== undefined && n > 1) n = n / 100;
            setField(r.activityId, { pctOverride: n });
          }}
        />
      ),
    },
    {
      key: 'ts',
      label: 'Test start',
      value: (r) => r.entry?.testStartOverride ?? '',
      render: (r) => (
        <CellInput
          type="date"
          value={r.entry?.testStartOverride ?? ''}
          onCommit={(v) => setField(r.activityId, { testStartOverride: isValidISO(v) ? v : undefined })}
        />
      ),
    },
    {
      key: 'te',
      label: 'Test end',
      value: (r) => r.entry?.testEndOverride ?? '',
      render: (r) => (
        <CellInput type="date" value={r.entry?.testEndOverride ?? ''} onCommit={(v) => setField(r.activityId, { testEndOverride: isValidISO(v) ? v : undefined })} />
      ),
    },
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
              Columns: Activity ID, tests total, tests complete, then optional % override, test start, test end. Drop an .xlsx or .csv here, or paste below.
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
            <b>{orphans.length} keyed {orphans.length === 1 ? 'row does' : 'rows do'} not match a budgeted activity.</b> Usually WBS rows pasted in by mistake, or activities
            that left the schedule. They contribute nothing and hide real errors.{' '}
            <button className="btn-link" onClick={() => setShowOrphans((v) => !v)}>
              {showOrphans ? 'hide' : 'show them'}
            </button>
            {showOrphans && (
              <>
                <ul className="mt-2 max-h-40 overflow-auto">
                  {orphans.map((o) => (
                    <li key={o.activityId} className="flex items-center gap-2 py-0.5">
                      <code className="mono">{o.activityId}</code>
                      <button className="btn-link danger text-[11px]" onClick={() => clearRow(o.activityId)}>
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
                <button
                  className="btn btn-mini mt-2"
                  onClick={() => {
                    const ids = new Set(orphans.map((o) => normKey(o.activityId)));
                    actions.update('testProgress', (tps) => tps.filter((t) => !ids.has(normKey(t.activityId))));
                    actions.notify('ok', `Removed ${orphans.length} unmatched rows. Save to write.`);
                  }}
                >
                  Remove all {orphans.length}
                </button>
              </>
            )}
          </Notice>
        </div>
      )}

      <SortableTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.activityId}
        maxHeight={showBulk ? 'calc(100vh - 430px)' : 'calc(100vh - 250px)'}
        rowClass={(r) => (r.pctComplete >= 1 ? '' : r.entry ? '' : 'row-muted')}
      />
    </Page>
  );
}

/** Drop undefined and empty fields so the stored JSON stays tidy. */
function tidy(t: TP): TP {
  const out: TP = { activityId: t.activityId.trim(), updatedAt: t.updatedAt };
  for (const k of ['testsTotal', 'testsComplete', 'pctOverride', 'testStartOverride', 'testEndOverride'] as const) {
    const v = t[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

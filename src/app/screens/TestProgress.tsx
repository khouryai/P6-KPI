import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Badge, statusTone, Notice, type Column } from '../components/ui';
import type { TestProgress as TP } from '../../engine/types';
import { fmtPct, num } from '../format';
import { normKey } from '../../engine/keys';
import { parseDelimitedText } from '../../engine/parse';
import { readWorkbook, pickSheet, workbookGrid } from '../../engine/workbook';
import { parseP6Date, isValidISO } from '../../engine/dates';
import type { Route } from '../router';

type Row = TP & { check: { matched: boolean; status: string; activityName: string | null; pctEffective: number | null } };

export function TestProgress({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [paste, setPaste] = useState('');
  const [newId, setNewId] = useState('');
  const [text, setText] = useState('');

  const checks = useMemo(() => new Map(model.testProgressChecks.map((c) => [normKey(c.activityId), c])), [model.testProgressChecks]);
  const rows = useMemo<Row[]>(() => {
    let r = state.data.testProgress.map((t) => ({ ...t, check: checks.get(normKey(t.activityId)) ?? { matched: false, status: 'not in extract', activityName: null, pctEffective: null } }));
    if (flag === 'unmatched') r = r.filter((x) => !x.check.matched);
    if (text.trim()) {
      const f = text.toLowerCase();
      r = r.filter((x) => x.activityId.toLowerCase().includes(f) || (x.check.activityName ?? '').toLowerCase().includes(f));
    }
    return r;
  }, [state.data.testProgress, checks, flag, text]);

  const now = () => new Date().toISOString();
  const edit = (id: string, patch: Partial<TP>) =>
    actions.update('testProgress', (tps) => tps.map((t) => (normKey(t.activityId) === normKey(id) ? tidy({ ...t, ...patch, updatedAt: now() }) : t)));
  const remove = (id: string) => actions.update('testProgress', (tps) => tps.filter((t) => normKey(t.activityId) !== normKey(id)));
  const add = (id: string) => {
    const k = id.trim();
    if (!k) return;
    if (state.data.testProgress.some((t) => normKey(t.activityId) === normKey(k))) return actions.notify('info', `${k} is already listed.`);
    actions.update('testProgress', (tps) => [...tps, { activityId: k, updatedAt: now() }]);
    setNewId('');
  };

  /** Apply a block: Activity ID, Tests Total, Tests Complete, [Pct Override], [Test Start], [Test End]. Header optional. */
  const applyGrid = (grid: unknown[][], sourceLabel: string) => {
    let added = 0;
    let updated = 0;
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
    else actions.notify('ok', `${sourceLabel}: ${added} added, ${updated} updated. Save to write.`);
  };

  const applyPaste = () => applyGrid(parseDelimitedText(paste), 'Pasted block');

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

  const columns: Column<Row>[] = [
    { key: 'id', label: 'Activity ID', value: (r) => r.activityId, render: (r) => <span className="font-mono text-[11px]">{r.activityId}</span> },
    { key: 'name', label: 'Activity', value: (r) => r.check.activityName ?? '', render: (r) => (r.check.activityName ? <span className="block max-w-xs truncate" title={r.check.activityName}>{r.check.activityName}</span> : <span className="text-[var(--bad)]">ID not in extract</span>) },
    { key: 'st', label: 'Budget status', value: (r) => r.check.status, render: (r) => <Badge tone={r.check.matched ? statusTone(r.check.status) : 'bad'}>{r.check.status}</Badge> },
    { key: 'tot', label: 'Tests total', value: (r) => r.testsTotal ?? null, num: true, render: (r) => <CellInput type="number" className="cell-input text-right" value={r.testsTotal?.toString() ?? ''} onCommit={(v) => edit(r.activityId, { testsTotal: num(v) })} /> },
    { key: 'comp', label: 'Tests complete', value: (r) => r.testsComplete ?? null, num: true, render: (r) => <CellInput type="number" className="cell-input text-right" value={r.testsComplete?.toString() ?? ''} onCommit={(v) => edit(r.activityId, { testsComplete: num(v) })} /> },
    { key: 'ov', label: '% override (0..1)', value: (r) => r.pctOverride ?? null, num: true, render: (r) => <CellInput type="number" className="cell-input text-right" value={r.pctOverride?.toString() ?? ''} placeholder="—" title="Beats the test counts. 0 to 1." onCommit={(v) => { let n = num(v); if (n !== undefined && n > 1) n = n / 100; edit(r.activityId, { pctOverride: n }); }} /> },
    { key: 'eff', label: 'Effective %', value: (r) => r.check.pctEffective, num: true, render: (r) => (r.check.pctEffective === null ? <span className="text-[var(--text-subtle)]">P6 fallback</span> : fmtPct(r.check.pctEffective, 0)) },
    { key: 'ts', label: 'Test start', value: (r) => r.testStartOverride ?? '', render: (r) => <CellInput type="date" value={r.testStartOverride ?? ''} onCommit={(v) => edit(r.activityId, { testStartOverride: isValidISO(v) ? v : undefined })} /> },
    { key: 'te', label: 'Test end', value: (r) => r.testEndOverride ?? '', render: (r) => <CellInput type="date" value={r.testEndOverride ?? ''} onCommit={(v) => edit(r.activityId, { testEndOverride: isValidISO(v) ? v : undefined })} /> },
    { key: 'upd', label: 'Updated', value: (r) => r.updatedAt, render: (r) => r.updatedAt.slice(0, 10) },
    { key: 'x', label: '', value: () => '', render: (r) => <button className="btn-link danger text-[11px]" onClick={() => remove(r.activityId)}>remove</button> },
  ];

  const unmatched = model.summary.testProgressNotMatching;
  return (
    <Page eyebrow="Progress"
      title="Test Progress"
      subtitle={`${state.data.testProgress.length} rows keyed. Tests complete / tests total drives percent complete; a direct override beats it; P6 duration is the fallback. Test window dates override the P6 actual dates for the earned curve.`}
      toolbar={
        <>
          <input className="input" placeholder="Filter" value={text} onChange={(e) => setText(e.target.value)} />
          {flag && <a className="btn" href="#/progress">Clear filter</a>}
        </>
      }
    >
      {unmatched > 0 && (
        <div className="mb-3">
          <Notice tone="warn">{unmatched} keyed Activity ID{unmatched === 1 ? ' does' : 's do'} not match a budgeted activity. They do nothing but hide real errors. <a className="underline" href="#/progress?flag=unmatched">Show them</a>.</Notice>
        </div>
      )}
      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="card">
          <h2 className="card-title">Add an activity</h2>
          <div className="mt-2 flex gap-2">
            <input className="input flex-1 font-mono" list="budgeted-ids" placeholder="0-P2-TC-W40-FA-0100" value={newId} onChange={(e) => setNewId(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add(newId)} />
            <button className="btn" onClick={() => add(newId)}>Add</button>
          </div>
          <datalist id="budgeted-ids">{model.rows.filter((r) => r.status === 'IN BUDGET').map((r) => <option key={r.activityId} value={r.activityId}>{r.activity.activityName}</option>)}</datalist>
        </div>
        <div
          className="card"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void applyFile(f); }}
        >
          <h2 className="card-title">Load counts from a file or a paste</h2>
          <p className="text-[12px] text-[var(--text-muted)]">Columns: Activity ID, Tests total, Tests complete, then optional % override, test start, test end. Existing rows are updated, new IDs added. Drop an .xlsx or .csv here, or paste below.</p>
          <input className="mt-1 block text-[12px]" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" onChange={(e) => e.target.files?.[0] && void applyFile(e.target.files[0])} />
          <textarea className="input mt-1 h-16 w-full font-mono text-[11px]" value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'0-P2-TC-W40-FA-0100\t120\t46'} />
          <button className="btn mt-1" disabled={!paste.trim()} onClick={applyPaste}>Apply pasted block</button>
        </div>
      </div>
      <SortableTable rows={rows} columns={columns} rowKey={(r) => r.activityId} maxHeight="calc(100vh - 330px)" rowClass={(r) => (r.check.matched ? '' : 'row-bad')} />
    </Page>
  );
}

function tidy(t: TP): TP {
  const out: TP = { activityId: t.activityId, updatedAt: t.updatedAt };
  for (const k of ['testsTotal', 'testsComplete', 'pctOverride', 'testStartOverride', 'testEndOverride'] as const) {
    const v = t[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

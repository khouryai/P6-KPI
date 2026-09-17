import { useMemo, useState, useCallback } from 'react';
import type { WorkBook } from 'xlsx';
import { useApp } from '../state';
import { Page, Notice, Badge } from '../components/ui';
import { parseTable, parseDelimitedText, type ParsedTable } from '../../engine/parse';
import { detectLayout, columnCount, columnLabel, FIELD_ORDER, FIELD_LABELS, type ColumnMap, type Layout } from '../../engine/columns';
import { readWorkbook, pickSheet, workbookGrid } from '../../engine/workbook';
import { parseXer, isXer, xerToActivities, type XerTable } from '../../engine/xer';
import { distinctActivityTypes, distinctLocations } from '../../engine/discover';
import { normKey } from '../../engine/keys';
import type { ImportKind, ImportIndexEntry, ScheduleImport, P6Activity } from '../../engine/types';
import { fmtDateTime, fmtDate } from '../format';

type Pending =
  | { type: 'grid'; name: string; grid: unknown[][] }
  | { type: 'workbook'; name: string; wb: WorkBook; sheet: string }
  | { type: 'xer'; name: string; tables: Map<string, XerTable> };

export function Import() {
  const { state, actions } = useApp();
  const [kind, setKind] = useState<ImportKind>('current');
  const [pending, setPending] = useState<Pending | null>(null);
  const [mapOverride, setMapOverride] = useState<Partial<ColumnMap> | null>(null);
  const [hoursPerDay, setHoursPerDay] = useState(8);
  const [project, setProject] = useState('');
  const [paste, setPaste] = useState('');
  const [folderFiles, setFolderFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ entry: ImportIndexEntry; imp: ScheduleImport } | null>(null);

  const fail = (e: unknown) => setError((e as Error).message);
  const reset = () => {
    setPending(null);
    setMapOverride(null);
    setProject('');
  };

  const loadBytes = useCallback((name: string, bytes: Uint8Array, text: string | null) => {
    setMapOverride(null);
    setProject('');
    if (text !== null && isXer(text)) {
      setPending({ type: 'xer', name, tables: parseXer(text) });
      return;
    }
    if (/\.xlsx?$|\.xlsm$|\.xlsb$/i.test(name)) {
      const wb = readWorkbook(bytes);
      setPending({ type: 'workbook', name, wb, sheet: pickSheet(wb, kind === 'baseline' ? 'Baseline_Extract' : 'P6_Extract') });
      return;
    }
    setPending({ type: 'grid', name, grid: parseDelimitedText(text ?? new TextDecoder().decode(bytes)) });
  }, [kind]);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // An .xer is text; a workbook is not. Sniff before deciding.
      const isBinary = /\.xlsx?$|\.xlsm$|\.xlsb$/i.test(file.name);
      loadBytes(file.name, bytes, isBinary ? null : await file.text());
    } catch (e) {
      fail(e);
    }
  }, [loadBytes]);

  const loadPaste = () => {
    setError(null);
    setMapOverride(null);
    try {
      if (isXer(paste)) setPending({ type: 'xer', name: 'clipboard paste', tables: parseXer(paste) });
      else setPending({ type: 'grid', name: 'clipboard paste', grid: parseDelimitedText(paste) });
    } catch (e) {
      fail(e);
    }
  };

  const loadFolderFile = async (path: string) => {
    setError(null);
    try {
      const binary = /\.xlsx?$|\.xlsm$|\.xlsb$/i.test(path);
      if (binary) {
        const bytes = await actions.readFolderBinary(path);
        if (!bytes) throw new Error(`${path} could not be read`);
        loadBytes(path, bytes, null);
      } else {
        const text = await actions.readFolderFile(path);
        if (text === null) throw new Error(`${path} could not be read`);
        loadBytes(path, new Uint8Array(), text);
      }
    } catch (e) {
      fail(e);
    }
  };

  // ---- derive the parse from the pending source and the user's corrections ----
  const grid = useMemo<unknown[][] | null>(() => {
    if (!pending) return null;
    if (pending.type === 'grid') return pending.grid;
    if (pending.type === 'workbook') return workbookGrid(pending.wb, pending.sheet);
    return null;
  }, [pending]);

  const detected = useMemo(() => (grid ? detectLayout(grid) : null), [grid]);
  const layout = useMemo<Layout | null>(() => {
    if (!detected) return null;
    return mapOverride ? { ...detected, map: { ...detected.map, ...mapOverride } } : detected;
  }, [detected, mapOverride]);

  const xer = useMemo(() => {
    if (pending?.type !== 'xer') return null;
    return xerToActivities(pending.tables, { hoursPerDay, projectShortName: project || undefined });
  }, [pending, hoursPerDay, project]);

  const parsed = useMemo<ParsedTable | null>(() => {
    if (xer) {
      return { activities: xer.activities, headerSkipped: false, layout: detectLayout([]), warnings: [], unparseableDates: 0, duplicateIds: [], skippedBlank: 0, skippedBeforeHeader: 0 };
    }
    if (!grid || !layout) return null;
    return parseTable(grid, layout);
  }, [grid, layout, xer]);

  const preview = useMemo(() => {
    if (!parsed) return null;
    const acts = parsed.activities;
    const real = acts.filter((a) => a.rowType === 'ACTIVITY');
    const locs = distinctLocations(acts);
    const types = distinctActivityTypes(acts);
    const known = new Set(state.data.library.map((e) => normKey(e.matchKey)));
    const newTypes = types.filter((t) => !known.has(normKey(t)));
    const knownLocs = new Set(state.data.locations.map((l) => normKey(l.code)));
    const newLocs = locs.filter((l) => !knownLocs.has(normKey(l)));
    const other = kind === 'current' ? state.data.baseline : state.data.current;
    const otherIds = new Set((other?.activities ?? []).filter((a) => a.rowType === 'ACTIVITY').map((a) => normKey(a.activityId)));
    const missingInOther = other ? real.filter((a) => !otherIds.has(normKey(a.activityId))).length : null;
    const noId = real.filter((a) => a.location === '').length;
    /*
     * What your own edits do when this import lands.
     *
     * A current-schedule import replaces every P6 row and touches nothing else, so
     * renames, hidden flags, hours overrides and test counts survive it — they are
     * keyed on the Activity ID and on nothing else. That is easy to say and hard to
     * believe, so it is counted here against the file actually being imported, row
     * by row, before anybody commits to it.
     */
    const incoming = new Set(real.map((a) => normKey(a.activityId)));
    const edits = state.data.overrides.filter((o) => o.activityId.trim() !== '');
    const keyed = state.data.testProgress.filter((t) => t.activityId.trim() !== '');
    const carriedEdits = edits.filter((o) => incoming.has(normKey(o.activityId))).length;
    const carriedTests = keyed.filter((t) => incoming.has(normKey(t.activityId))).length;
    return {
      acts,
      real,
      locs,
      types,
      newTypes,
      newLocs,
      missingInOther,
      noId,
      edits: edits.length,
      keyed: keyed.length,
      carriedEdits,
      carriedTests,
      strandedEdits: edits.length - carriedEdits,
      strandedTests: keyed.length - carriedTests,
    };
  }, [parsed, state.data, kind]);

  const commit = async () => {
    if (!pending || !parsed) return;
    setBusy(true);
    try {
      await actions.commitImport(kind, parsed.activities, pending.name);
      reset();
      setPaste('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const history = [...state.data.importsIndex].sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const headerCells = grid && layout?.headerRow !== null && layout ? (grid[layout.headerRow as number] ?? null) : null;
  const cols = grid ? columnCount(grid) : 0;

  return (
    <Page eyebrow="Schedule" title="Import" subtitle="Drop the P6 export straight in. Excel is never needed: .xlsx, .csv and P6's own .xer are all read directly. Two independent targets, the current (live) schedule and the baseline.">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-[var(--text-muted)]">Import target:</span>
        {(['current', 'baseline'] as ImportKind[]).map((k) => (
          <button key={k} className={`btn ${kind === k ? 'btn-primary' : ''}`} onClick={() => { setKind(k); reset(); }}>
            {k === 'current' ? 'Current schedule' : 'Baseline schedule'}
          </button>
        ))}
        <span className="ml-3 text-[12px] text-[var(--text-muted)]">
          {kind === 'current'
            ? state.data.current ? `Latest: ${state.data.current.sourceFilename}, ${fmtDateTime(state.data.current.importedAt)}` : 'Nothing imported yet'
            : state.data.baseline ? `Latest: ${state.data.baseline.sourceFilename}, ${fmtDateTime(state.data.baseline.importedAt)}` : 'Nothing imported yet. The planned curve mirrors the forecast until a baseline exists.'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div
          className="card dropzone"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void loadFile(f);
          }}
        >
          <h2 className="card-title">1. Drop the P6 export</h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">
            Drag the file here, or pick it. Accepts <b>.xer</b> (P6's own export, no Excel involved), <b>.xlsx</b> and <b>.csv</b>. Nothing is imported until you confirm the preview.
          </p>
          <input className="mt-3 block text-[12px]" type="file" accept=".xer,.xlsx,.xlsm,.xls,.csv,.tsv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void loadFile(f); }} />
        </div>
        <div className="card">
          <h2 className="card-title">2. Paste rows</h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">If you already have the export open somewhere, select the columns, copy, and paste here.</p>
          <textarea className="input mt-2 h-28 w-full font-mono text-[11px]" placeholder={'Activity ID\tActivity Name\tOriginal Duration\tRemaining Duration\tStart\tFinish'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn mt-2" disabled={!paste.trim()} onClick={loadPaste}>
            Parse pasted rows
          </button>
        </div>
        <div className="card">
          <h2 className="card-title">3. A file already in the folder</h2>
          <p className="mt-1 text-[12px] text-[var(--text-muted)]">Exports saved into the storage folder or its exports sub-folder.</p>
          <button className="btn mt-2" disabled={state.adapterKind !== 'filesystem'} onClick={() => void actions.listFolderFiles().then(setFolderFiles).catch(fail)}>
            List files
          </button>
          {folderFiles && (
            <ul className="mt-2 max-h-28 overflow-auto text-[12px]">
              {folderFiles.length === 0 && <li className="text-[var(--text-subtle)]">No schedule files found in the folder.</li>}
              {folderFiles.map((f) => (
                <li key={f}>
                  <button className="btn-link" onClick={() => void loadFolderFile(f)}>{f}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <div className="mt-3"><Notice tone="error">{error}</Notice></div>}

      {pending && preview && parsed && (
        <div className="card mt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="card-title">
                Preview: {pending.name} {pending.type === 'xer' && <Badge tone="purple">P6 native .xer</Badge>}
              </h2>
              <div className="text-[12px] text-[var(--text-muted)]">Importing as the {kind} schedule. Check the mapping and the counts, then confirm.</div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={reset}>Discard</button>
              <button className="btn btn-primary" disabled={busy || preview.real.length === 0} onClick={() => void commit()}>
                {busy ? 'Importing…' : `Confirm import (${preview.acts.length} rows)`}
              </button>
            </div>
          </div>

          {pending.type === 'workbook' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded bg-[var(--surface-2)] px-3 py-2 text-[12px]">
              <span className="font-semibold">Sheet</span>
              <select className="input" value={pending.sheet} onChange={(e) => { setPending({ ...pending, sheet: e.target.value }); setMapOverride(null); }}>
                {pending.wb.SheetNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <span className="text-[var(--text-muted)]">{pending.wb.SheetNames.length} sheets in this workbook.</span>
            </div>
          )}

          {pending.type === 'xer' && xer && (
            <div className="mt-3 flex flex-wrap items-end gap-3 rounded bg-[var(--surface-2)] px-3 py-2 text-[12px]">
              {xer.projects.length > 1 && (
                <label>
                  <div className="font-semibold">Project</div>
                  <select className="input mt-1" value={project} onChange={(e) => setProject(e.target.value)}>
                    <option value="">All projects ({xer.projects.reduce((s, p) => s + p.taskCount, 0)} activities)</option>
                    {xer.projects.map((p) => <option key={p.id} value={p.shortName}>{p.shortName} ({p.taskCount})</option>)}
                  </select>
                </label>
              )}
              <label>
                <div className="font-semibold">Hours per day</div>
                <input className="input mt-1 w-24" type="number" step="0.5" value={hoursPerDay} onChange={(e) => setHoursPerDay(Number(e.target.value) || 8)} />
              </label>
              <div className="text-[var(--text-muted)]">
                XER holds durations in hours. {xer.calendarHours.length > 0
                  ? <>Converted using each activity's own calendar: {xer.calendarHours.map((c) => `${c.name} at ${c.hoursPerDay} h`).join(', ')}.</>
                  : <>No calendar was found in the file, so the value above is used for every activity.</>}
              </div>
            </div>
          )}

          {pending.type !== 'xer' && layout && grid && (
            <div className="mt-3 rounded bg-[var(--surface-2)] px-3 py-2">
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="font-semibold">Column mapping</span>
                {layout.fromHeader
                  ? <span className="text-[var(--text-muted)]">Matched from the header in row {(layout.headerRow ?? 0) + 1}. Change any that are wrong.</span>
                  : <span className="text-[var(--warn)]">No header row recognised, so columns are read by position. Check these carefully.</span>}
                {mapOverride && <button className="btn-link" onClick={() => setMapOverride(null)}>reset to detected</button>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-6">
                {FIELD_ORDER.map((f) => (
                  <label key={f} className="text-[11px]">
                    <div className="font-semibold text-[var(--text-muted)]">{FIELD_LABELS[f]}</div>
                    <select
                      className="input mt-0.5 w-full"
                      value={layout.map[f] === null ? '' : String(layout.map[f])}
                      onChange={(e) => setMapOverride({ ...(mapOverride ?? {}), [f]: e.target.value === '' ? null : Number(e.target.value) })}
                    >
                      <option value="">(not in this export)</option>
                      {Array.from({ length: cols }, (_, i) => <option key={i} value={i}>{columnLabel(i, headerCells)}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            {[
              ['Rows', preview.acts.length],
              ['WBS rows (never budgeted)', preview.acts.length - preview.real.length],
              ['Activities', preview.real.length],
              ['Title rows skipped', parsed.skippedBeforeHeader],
              ['Locations found', preview.locs.length],
              ['New locations', preview.newLocs.length],
              ['Activity types found', preview.types.length],
              ['New to the library', preview.newTypes.length],
              ['Unparseable dates', parsed.unparseableDates],
              ['Duplicate Activity IDs', parsed.duplicateIds.length],
              ['IDs with no location segment', preview.noId],
              [kind === 'current' ? 'Not in the baseline' : 'Not in the current schedule', preview.missingInOther ?? 'n/a'],
            ].map(([k, v]) => (
              <div key={String(k)} className="factlet">
                <div className="factlet-label">{k}</div>
                <div className="factlet-value">{v}</div>
              </div>
            ))}
          </div>

          {kind === 'current' && (preview.edits > 0 || preview.keyed > 0) && (
            <div className="mt-2">
              <Notice tone={preview.strandedEdits + preview.strandedTests > 0 ? 'warn' : 'ok'}>
                <b>Your edits are matched on the Activity ID, and nothing else.</b> This import brings in the P6 names, durations and dates and overwrites those only.{' '}
                {preview.carriedEdits} of {preview.edits} activity {preview.edits === 1 ? 'edit' : 'edits'} (renames, hidden and excluded flags, hours overrides, notes) and{' '}
                {preview.carriedTests} of {preview.keyed} keyed test {preview.keyed === 1 ? 'row' : 'rows'} land on an activity in this file and carry over unchanged.
                {preview.strandedEdits + preview.strandedTests > 0 && (
                  <>
                    {' '}The other {preview.strandedEdits + preview.strandedTests} name an Activity ID this file does not contain, so they will sit idle rather than being
                    deleted — renumbered in P6, or removed from the schedule. Budget Master and Test Progress both list them afterwards.
                  </>
                )}
              </Notice>
            </div>
          )}
          {preview.real.length === 0 && (
            <div className="mt-2"><Notice tone="error">No activity rows were found. Check the column mapping above: the Activity Name column decides what is an activity and what is a WBS summary row.</Notice></div>
          )}
          {kind === 'current' && (preview.newTypes.length > 0 || preview.newLocs.length > 0) && (
            <div className="mt-2 text-[12px] text-[var(--text-muted)]">
              Confirming will also write {preview.newLocs.length ? `${preview.newLocs.length} new location${preview.newLocs.length === 1 ? '' : 's'} (${preview.newLocs.join(', ')})` : 'no new locations'} and{' '}
              {preview.newTypes.length ? `${preview.newTypes.length} new library type${preview.newTypes.length === 1 ? '' : 's'} on default rates` : 'no new library types'}. Existing entries keep their rates.
            </div>
          )}
          {xer?.warnings.map((w) => <div key={w} className="mt-2"><Notice tone="warn">{w}</Notice></div>)}
          {parsed.duplicateIds.length > 0 && (
            <div className="mt-2"><Notice tone="warn">Duplicate Activity IDs (the first occurrence wins for baseline and test progress matching): {parsed.duplicateIds.join(', ')}</Notice></div>
          )}
          {parsed.warnings.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-[var(--warn)]">{parsed.warnings.length} row warnings</summary>
              <ul className="mt-1 max-h-40 overflow-auto">
                {parsed.warnings.map((w, i) => <li key={i}>Row {w.row}: {w.message}</li>)}
              </ul>
            </details>
          )}
          {preview.newTypes.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer">New activity types</summary>
              <ul className="mt-1 max-h-40 overflow-auto">{preview.newTypes.map((t) => <li key={t}>{t}</li>)}</ul>
            </details>
          )}
          <details className="mt-2 text-[12px]" open>
            <summary className="cursor-pointer">First 15 parsed rows</summary>
            <div className="mt-1 overflow-auto">
              <table className="tbl">
                <thead><tr><th>Activity ID</th><th>Type</th><th>Name</th><th className="num">OD</th><th className="num">RD</th><th>Start</th><th>Finish</th><th>Location</th><th>Activity type</th></tr></thead>
                <tbody>
                  {preview.acts.slice(0, 15).map((a: P6Activity) => (
                    <tr key={a.sortOrder}>
                      <td><pre className="m-0 font-mono text-[11px]">{a.rawActivityId}</pre></td>
                      <td><Badge tone={a.rowType === 'WBS' ? 'muted' : 'good'}>{a.rowType}</Badge></td>
                      <td className="cell-text" title={a.activityName}>{a.activityName}</td>
                      <td className="num">{a.originalDuration ?? ''}</td>
                      <td className="num">{a.remainingDuration ?? ''}</td>
                      <td>{fmtDate(a.startDate)}{a.actualStart ? ' A' : ''}{!a.startDate && a.startRaw ? <span className="text-[var(--bad)]"> ({a.startRaw})</span> : ''}</td>
                      <td>{fmtDate(a.finishDate)}{a.actualFinish ? ' A' : ''}{!a.finishDate && a.finishRaw ? <span className="text-[var(--bad)]"> ({a.finishRaw})</span> : ''}</td>
                      <td>{a.location}</td>
                      <td>{a.activityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}

      <div className="card mt-4">
        <h2 className="card-title">Import history</h2>
        <p className="text-[12px] text-[var(--text-muted)]">Imports are append only. The most recent of each kind is in use. Restoring writes a new import with the old rows, so nothing is ever overwritten.</p>
        <table className="tbl mt-2">
          <thead><tr><th>Imported</th><th>Kind</th><th>Source</th><th className="num">Rows</th><th>File</th><th></th></tr></thead>
          <tbody>
            {history.map((h) => {
              const inUse = (h.kind === 'current' ? state.data.current?.id : state.data.baseline?.id) === h.id;
              return (
                <tr key={h.file}>
                  <td>{fmtDateTime(h.importedAt)}</td>
                  <td><Badge tone={h.kind === 'current' ? 'info' : 'purple'}>{h.kind}</Badge> {inUse && <Badge tone="good">in use</Badge>}</td>
                  <td>{h.sourceFilename}</td>
                  <td className="num">{h.rowCount}</td>
                  <td className="text-[var(--text-muted)]">{h.file}</td>
                  <td>
                    <button className="btn-link" onClick={() => void actions.readImport(h).then((imp) => imp && setViewing({ entry: h, imp })).catch(fail)}>view</button>
                    {!inUse && (
                      <button className="btn-link ml-2" onClick={() => { if (confirm(`Restore ${h.file} as the ${h.kind} schedule?`)) void actions.restoreImport(h).catch(fail); }}>restore</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-[var(--text-subtle)]">No imports yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div className="card mt-4">
          <div className="flex items-center justify-between">
            <h2 className="card-title">{viewing.entry.file} ({viewing.imp.activities.length} rows)</h2>
            <button className="btn" onClick={() => setViewing(null)}>Close</button>
          </div>
          <div className="mt-2 max-h-96 overflow-auto">
            <table className="tbl">
              <thead><tr><th>Raw ID</th><th>Name</th><th className="num">OD</th><th className="num">RD</th><th>Start</th><th>Finish</th></tr></thead>
              <tbody>
                {viewing.imp.activities.map((a) => (
                  <tr key={a.sortOrder}>
                    <td><pre className="m-0 font-mono text-[11px]">{a.rawActivityId}</pre></td>
                    <td>{a.activityName}</td>
                    <td className="num">{a.originalDuration ?? ''}</td>
                    <td className="num">{a.remainingDuration ?? ''}</td>
                    <td>{a.startRaw}</td>
                    <td>{a.finishRaw}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Page>
  );
}

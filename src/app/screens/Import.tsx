import { useMemo, useState, useCallback } from 'react';
import { useApp } from '../state';
import { Page, Notice, Badge } from '../components/ui';
import { parseTable, parseDelimitedText, type ParsedTable } from '../../engine/parse';
import { readWorkbook, pickSheet, parseWorkbookSheet } from '../../engine/workbook';
import { distinctActivityTypes, distinctLocations } from '../../engine/discover';
import { normKey } from '../../engine/keys';
import type { ImportKind, ImportIndexEntry, ScheduleImport } from '../../engine/types';
import { fmtDateTime, fmtDate } from '../format';

type Source = { name: string; parsed: ParsedTable };

export function Import() {
  const { state, actions } = useApp();
  const [kind, setKind] = useState<ImportKind>('current');
  const [source, setSource] = useState<Source | null>(null);
  const [paste, setPaste] = useState('');
  const [folderFiles, setFolderFiles] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<{ entry: ImportIndexEntry; imp: ScheduleImport } | null>(null);

  const fail = (e: unknown) => setError((e as Error).message);

  const loadFile = useCallback(async (file: File) => {
    setError(null);
    try {
      if (/\.xlsx?$|\.xlsm$/i.test(file.name)) {
        const wb = readWorkbook(new Uint8Array(await file.arrayBuffer()));
        const sheet = pickSheet(wb, kind === 'baseline' ? 'Baseline_Extract' : 'P6_Extract');
        setSource({ name: `${file.name} [${sheet}]`, parsed: parseWorkbookSheet(wb, sheet) });
      } else {
        setSource({ name: file.name, parsed: parseTable(parseDelimitedText(await file.text())) });
      }
    } catch (e) {
      fail(e);
    }
  }, [kind]);

  const loadPaste = () => {
    setError(null);
    try {
      setSource({ name: 'clipboard paste', parsed: parseTable(parseDelimitedText(paste)) });
    } catch (e) {
      fail(e);
    }
  };

  const loadFolderFile = async (path: string) => {
    setError(null);
    try {
      if (/\.xlsx?$|\.xlsm$/i.test(path)) {
        const bytes = await actions.readFolderBinary(path);
        if (!bytes) throw new Error(`${path} could not be read`);
        const wb = readWorkbook(bytes);
        const sheet = pickSheet(wb, kind === 'baseline' ? 'Baseline_Extract' : 'P6_Extract');
        setSource({ name: `${path} [${sheet}]`, parsed: parseWorkbookSheet(wb, sheet) });
        return;
      }
      const text = await actions.readFolderFile(path);
      if (text === null) throw new Error(`${path} could not be read`);
      setSource({ name: path, parsed: parseTable(parseDelimitedText(text)) });
    } catch (e) {
      fail(e);
    }
  };

  const preview = useMemo(() => {
    if (!source) return null;
    const acts = source.parsed.activities;
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
    return { acts, real, locs, types, newTypes, newLocs, missingInOther };
  }, [source, state.data, kind]);

  const commit = async () => {
    if (!source) return;
    setBusy(true);
    try {
      await actions.commitImport(kind, source.parsed.activities, source.name);
      setSource(null);
      setPaste('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const history = [...state.data.importsIndex].sort((a, b) => b.importedAt.localeCompare(a.importedAt));

  return (
    <Page title="Import" subtitle="Two independent targets: the current (live) schedule and the baseline. Columns in order: Activity ID, Activity Name, Original Duration, Remaining Duration, Start, Finish. Extra columns are ignored.">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-slate-600">Import target:</span>
        {(['current', 'baseline'] as ImportKind[]).map((k) => (
          <button key={k} className={`btn ${kind === k ? 'btn-primary' : ''}`} onClick={() => { setKind(k); setSource(null); }}>
            {k === 'current' ? 'Current schedule' : 'Baseline schedule'}
          </button>
        ))}
        <span className="ml-3 text-[12px] text-slate-500">
          {kind === 'current'
            ? state.data.current ? `Latest: ${state.data.current.sourceFilename}, ${fmtDateTime(state.data.current.importedAt)}` : 'Nothing imported yet'
            : state.data.baseline ? `Latest: ${state.data.baseline.sourceFilename}, ${fmtDateTime(state.data.baseline.importedAt)}` : 'Nothing imported yet. The planned curve mirrors the forecast until a baseline exists.'}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div
          className="card border-dashed"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) void loadFile(f);
          }}
        >
          <h2 className="font-semibold">1. File</h2>
          <p className="mt-1 text-[12px] text-slate-500">Drop an .xlsx or .csv here, or pick one. Nothing is imported until you confirm the preview.</p>
          <input className="mt-3 block text-[12px]" type="file" accept=".xlsx,.xlsm,.xls,.csv,.tsv,.txt" onChange={(e) => e.target.files?.[0] && void loadFile(e.target.files[0])} />
        </div>
        <div className="card">
          <h2 className="font-semibold">2. Paste from Excel</h2>
          <p className="mt-1 text-[12px] text-slate-500">Open the P6 export in Excel, select the six columns (header row optional), copy, and paste here.</p>
          <textarea className="input mt-2 h-28 w-full font-mono text-[11px]" placeholder={'Activity ID\tActivity Name\tOriginal Duration\tRemaining Duration\tStart\tFinish'} value={paste} onChange={(e) => setPaste(e.target.value)} />
          <button className="btn mt-2" disabled={!paste.trim()} onClick={loadPaste}>
            Parse pasted rows
          </button>
        </div>
        <div className="card">
          <h2 className="font-semibold">3. File already in the folder</h2>
          <p className="mt-1 text-[12px] text-slate-500">Workbooks, CSV or TSV files sitting in the storage folder or its exports sub-folder.</p>
          <button className="btn mt-2" disabled={state.adapterKind !== 'filesystem'} onClick={() => void actions.listFolderFiles().then(setFolderFiles).catch(fail)}>
            List files
          </button>
          {folderFiles && (
            <ul className="mt-2 max-h-28 overflow-auto text-[12px]">
              {folderFiles.length === 0 && <li className="text-slate-400">No workbook, .csv or .tsv files found.</li>}
              {folderFiles.map((f) => (
                <li key={f}>
                  <button className="text-blue-700 underline" onClick={() => void loadFolderFile(f)}>
                    {f}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-3">
          <Notice tone="error">{error}</Notice>
        </div>
      )}

      {source && preview && (
        <div className="card mt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Preview: {source.name}</h2>
              <div className="text-[12px] text-slate-500">Importing as the {kind} schedule. Review the counts, then confirm.</div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => setSource(null)}>
                Discard
              </button>
              <button className="btn btn-primary" disabled={busy || preview.real.length === 0} onClick={() => void commit()}>
                {busy ? 'Importing…' : `Confirm import (${preview.acts.length} rows)`}
              </button>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px] md:grid-cols-4">
            {[
              ['Rows', preview.acts.length],
              ['WBS rows (never budgeted)', preview.acts.length - preview.real.length],
              ['Activities', preview.real.length],
              ['Header row skipped', source.parsed.headerSkipped ? 'yes' : 'no'],
              ['Locations found', preview.locs.length],
              ['New locations', preview.newLocs.length],
              ['Activity types found', preview.types.length],
              ['New to the library', preview.newTypes.length],
              ['Unparseable dates', source.parsed.unparseableDates],
              ['Duplicate Activity IDs', source.parsed.duplicateIds.length],
              ['Blank rows skipped', source.parsed.skippedBlank],
              [kind === 'current' ? 'Not in the baseline' : 'Not in the current schedule', preview.missingInOther ?? 'n/a'],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded bg-slate-50 px-2 py-1">
                <div className="text-slate-500">{k}</div>
                <div className="font-semibold">{v}</div>
              </div>
            ))}
          </div>
          {kind === 'current' && (preview.newTypes.length > 0 || preview.newLocs.length > 0) && (
            <div className="mt-2 text-[12px] text-slate-600">
              Confirming will also write {preview.newLocs.length ? `${preview.newLocs.length} new location${preview.newLocs.length === 1 ? '' : 's'} (${preview.newLocs.join(', ')})` : 'no new locations'} and{' '}
              {preview.newTypes.length ? `${preview.newTypes.length} new library type${preview.newTypes.length === 1 ? '' : 's'} on default rates` : 'no new library types'}. Existing entries keep their rates.
            </div>
          )}
          {source.parsed.duplicateIds.length > 0 && (
            <div className="mt-2">
              <Notice tone="warn">Duplicate Activity IDs (the first occurrence wins for baseline and test progress matching): {source.parsed.duplicateIds.join(', ')}</Notice>
            </div>
          )}
          {source.parsed.warnings.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer text-amber-800">{source.parsed.warnings.length} row warnings</summary>
              <ul className="mt-1 max-h-40 overflow-auto">
                {source.parsed.warnings.map((w, i) => (
                  <li key={i}>
                    Row {w.row}: {w.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
          {preview.newTypes.length > 0 && (
            <details className="mt-2 text-[12px]">
              <summary className="cursor-pointer">New activity types</summary>
              <ul className="mt-1 max-h-40 overflow-auto">{preview.newTypes.map((t) => <li key={t}>{t}</li>)}</ul>
            </details>
          )}
          <details className="mt-2 text-[12px]">
            <summary className="cursor-pointer">First 15 parsed rows</summary>
            <div className="mt-1 overflow-auto">
              <table className="tbl">
                <thead><tr><th>Raw ID</th><th>Type</th><th>Name</th><th>OD</th><th>RD</th><th>Start</th><th>Finish</th><th>Location</th><th>Activity type</th></tr></thead>
                <tbody>
                  {preview.acts.slice(0, 15).map((a) => (
                    <tr key={a.sortOrder}>
                      <td><pre className="m-0 font-mono text-[11px]">{a.rawActivityId}</pre></td>
                      <td><Badge tone={a.rowType === 'WBS' ? 'slate' : 'green'}>{a.rowType}</Badge></td>
                      <td className="max-w-md truncate" title={a.activityName}>{a.activityName}</td>
                      <td className="num">{a.originalDuration ?? ''}</td>
                      <td className="num">{a.remainingDuration ?? ''}</td>
                      <td>{fmtDate(a.startDate)}{a.actualStart ? ' A' : ''}{!a.startDate && a.startRaw ? <span className="text-red-600"> ({a.startRaw})</span> : ''}</td>
                      <td>{fmtDate(a.finishDate)}{a.actualFinish ? ' A' : ''}{!a.finishDate && a.finishRaw ? <span className="text-red-600"> ({a.finishRaw})</span> : ''}</td>
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
        <h2 className="font-semibold">Import history</h2>
        <p className="text-[12px] text-slate-500">Imports are append only. The most recent of each kind is in use. Restoring writes a new import with the old rows, so nothing is ever overwritten.</p>
        <table className="tbl mt-2">
          <thead><tr><th>Imported</th><th>Kind</th><th>Source</th><th className="text-right">Rows</th><th>File</th><th></th></tr></thead>
          <tbody>
            {history.map((h) => {
              const inUse = (h.kind === 'current' ? state.data.current?.id : state.data.baseline?.id) === h.id;
              return (
                <tr key={h.file}>
                  <td>{fmtDateTime(h.importedAt)}</td>
                  <td><Badge tone={h.kind === 'current' ? 'blue' : 'purple'}>{h.kind}</Badge> {inUse && <Badge tone="green">in use</Badge>}</td>
                  <td>{h.sourceFilename}</td>
                  <td className="num">{h.rowCount}</td>
                  <td className="text-slate-500">{h.file}</td>
                  <td>
                    <button className="text-blue-700 underline" onClick={() => void actions.readImport(h).then((imp) => imp && setViewing({ entry: h, imp })).catch(fail)}>view</button>
                    {!inUse && (
                      <button className="ml-2 text-blue-700 underline" onClick={() => { if (confirm(`Restore ${h.file} as the ${h.kind} schedule?`)) void actions.restoreImport(h).catch(fail); }}>restore</button>
                    )}
                  </td>
                </tr>
              );
            })}
            {history.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-slate-400">No imports yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {viewing && (
        <div className="card mt-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{viewing.entry.file} ({viewing.imp.activities.length} rows)</h2>
            <button className="btn" onClick={() => setViewing(null)}>Close</button>
          </div>
          <div className="mt-2 max-h-96 overflow-auto">
            <table className="tbl">
              <thead><tr><th>Raw ID</th><th>Name</th><th>OD</th><th>RD</th><th>Start</th><th>Finish</th></tr></thead>
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

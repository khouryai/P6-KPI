import { useState } from 'react';
import { useApp } from '../state';
import { Page, Notice } from '../components/ui';
import type { Settings as S } from '../../engine/types';
import { downloadBytes, stamp } from '../export';
import type { Bundle } from '../state';
import { num, fmtDateTime } from '../format';
import { BUILD_COMMIT, BUILD_TIME, IS_STANDALONE, runningFrom } from '../build';
import { applyUpdate, canSelfUpdate, useUpdateReady } from '../update';

export function Settings() {
  const { state, model, actions } = useApp();
  const s = state.data.settings;
  const set = (patch: Partial<S>) => actions.update('settings', (prev) => ({ ...prev, ...patch }));
  const [busy, setBusy] = useState(false);
  const updateReady = useUpdateReady();

  const exportXlsx = async () => {
    setBusy(true);
    try {
      // Loaded here rather than imported: the spreadsheet library is a third of
      // the bundle and nothing before this click needs it.
      const { buildWorkbook, workbookBytes } = await import('../workbookExport');
      const wb = buildWorkbook(model, s, state.data.current?.activities ?? [], state.data.baseline?.activities ?? [], state.data.testProgress, state.data.missedReasons);
      const bytes = workbookBytes(wb);
      const name = `TC_Budget_${stamp()}.xlsx`;
      if (state.adapterKind === 'filesystem') actions.notify('ok', `Workbook written to ${await actions.writeExport(name, bytes)}`);
      else downloadBytes(name, bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(actions.exportBundle(), null, 2));
    const name = `TC-Budget-backup-${stamp()}.json`;
    try {
      if (state.adapterKind === 'filesystem') actions.notify('ok', `Backup written to ${await actions.writeExport(name, bytes)}`);
      else downloadBytes(name, bytes, 'application/json');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  const restore = async (file: File) => {
    if (!confirm(`Restore from ${file.name}? Settings, library, locations, overrides and progress are replaced. Schedules in the backup are added alongside what you already have.`)) return;
    try {
      const bundle = JSON.parse(await file.text()) as Bundle;
      await actions.restoreBundle(bundle);
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block text-[12px]">
      <div className="font-semibold text-[var(--text)]">{label}</div>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-[var(--text-muted)]">{hint}</div>}
    </label>
  );

  return (
    <Page eyebrow="Setup" title="Settings" subtitle="Defaults apply wherever a library entry or location leaves a value blank. Changes take effect immediately in the model and are written on Save.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="card-title">Dates</h2>
          <Field label="Data date" hint="The as-of date of the current P6 export. In-progress work earns from its actual start up to this date, and the earned curve stops here. Changing it moves the end of the earned curve.">
            <input className="input" type="date" value={s.dataDate} onChange={(e) => set({ dataDate: e.target.value })} />
          </Field>
          <Field
            label="S-curve reports"
            hint="How often the curve plots a point. Every two weeks and weekly are anchored on the data date, so one period always lands exactly on it and the earned line runs to the day you measured rather than to the month end after it."
          >
            <select className="input" value={s.curveCadence ?? 'month'} onChange={(e) => set({ curveCadence: e.target.value as S['curveCadence'] })}>
              <option value="month">At each month end</option>
              <option value="fortnight">Every two weeks, from the data date</option>
              <option value="week">Every week, from the data date</option>
            </select>
          </Field>
        </div>
        <div className="card space-y-3">
          <h2 className="card-title">Budget defaults</h2>
          <Field label="Default basis" hint="Used when a library entry has no basis. RATE: crew x shift hours x duration shifts. DUR: crew x shift hours x P6 original duration.">
            <select className="input" value={s.defaultBasis} onChange={(e) => set({ defaultBasis: e.target.value as S['defaultBasis'] })}>
              <option value="DUR">DUR</option>
              <option value="RATE">RATE</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default crew size"><input className="input w-full" type="number" step="any" value={s.defaultCrew} onChange={(e) => set({ defaultCrew: num(e.target.value) ?? 0 })} /></Field>
            <Field label="Default shift hours"><input className="input w-full" type="number" step="any" value={s.defaultShiftHours} onChange={(e) => set({ defaultShiftHours: num(e.target.value) ?? 0 })} /></Field>
            <Field
              label="Fiscal year starts in"
              hint="Used by the fiscal year rollup on Earned vs Actual. A year is named for the calendar year it ends in, so a July start makes Jul-26 to Jun-27 read as FY27."
            >
              <select
                className="input w-full"
                value={String(s.fiscalYearStartMonth ?? 7)}
                onChange={(e) => set({ fiscalYearStartMonth: Number(e.target.value) })}
              >
                {['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                    {i === 0 ? ' (fiscal year = calendar year)' : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Default complexity" hint="Used when a location has no factor."><input className="input w-full" type="number" step="0.05" value={s.defaultComplexity} onChange={(e) => set({ defaultComplexity: num(e.target.value) ?? 1 })} /></Field>
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="card-title">Storage</h2>
          <div className="text-[12px]">
            {state.adapterKind === 'filesystem' && (
              <>Data lives in the OneDrive folder <b>{state.folderName}</b> as plain JSON. Version history in OneDrive gives point in time recovery of every file.</>
            )}
            {state.adapterKind === 'indexeddb' && (
              <Notice tone="warn">Saving in this browser profile, not in OneDrive. It survives restarts, but clearing browsing data erases it and nothing is backed up. Take backups below, or switch to a folder.</Notice>
            )}
            {state.adapterKind === 'memory' && <Notice tone="error">Nothing is being saved. Choose a folder or browser storage below.</Notice>}
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-[12px]">
            <input type="checkbox" className="mt-0.5" checked={state.autoSave} onChange={(e) => actions.setAutoSave(e.target.checked)} />
            <span>
              <span className="font-semibold">Save automatically</span>
              <span className="block text-[var(--text-muted)]">
                Changes are written a second or so after you stop editing, so there is nothing to remember. Save now stays on the bar for when you want to be sure. Turn
                this off and nothing is written until you press it.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => void actions.chooseFolder()}>{state.adapterKind === 'filesystem' ? 'Choose a different folder…' : 'Use a OneDrive folder…'}</button>
            {state.adapterKind !== 'indexeddb' && <button className="btn" onClick={() => void actions.useBrowserStorage()}>Save in this browser instead</button>}
            <button className="btn" onClick={() => void actions.reload()} disabled={state.dirty.size > 0} title={state.dirty.size ? 'Save or discard changes first' : 'Re-read everything from storage'}>Reload</button>
            {state.adapterKind === 'filesystem' && (
              <button className="btn" onClick={() => { if (confirm('Forget the folder? Files stay on disk; the app will ask for a folder again.')) void actions.forgetFolder(); }}>Forget folder</button>
            )}
          </div>
          <Notice tone="info">
            OneDrive is sync, not concurrency control. Two machines editing at once produce a conflict copy, which this app detects on load but cannot merge. Mark the folder "Always keep on this device" so no file is a cloud-only placeholder.
          </Notice>
        </div>
        <div className="card space-y-3">
          <h2 className="card-title">Backup and restore</h2>
          <p className="text-[12px] text-[var(--text-muted)]">
            One JSON file holding everything: settings, locations, the rate library, overrides, progress and both schedules. Use it to move to another machine, or as a safety net when saving in the browser.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => void backup()}>Download a backup</button>
            <label className="btn cursor-pointer">
              Restore from a backup…
              <input type="file" accept=".json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f); }} />
            </label>
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="card-title">Export</h2>
          <p className="text-[12px] text-[var(--text-muted)]">Writes an .xlsx with the same sheet names and column layouts as the original workbook (values, no formulas) into the folder's <code>exports</code> sub-folder, so project controls can still be handed a spreadsheet. Curve CSV and chart PNG are on the Dashboard.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void exportXlsx()}>{busy ? 'Building…' : 'Export workbook (.xlsx)'}</button>
        </div>
        <div className="card space-y-3">
          <h2 className="card-title">Version</h2>
          <div className="flex flex-wrap gap-2">
            <div className="factlet">
              <div className="mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Built from</div>
              <div className="mono text-[12px]" title="The commit this build was compiled from">{BUILD_COMMIT}</div>
            </div>
            <div className="factlet">
              <div className="mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Built</div>
              <div className="text-[12px]">{BUILD_TIME ? fmtDateTime(BUILD_TIME) : 'unknown'}</div>
            </div>
            <div className="factlet">
              <div className="mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Running as</div>
              <div className="text-[12px]">{IS_STANDALONE ? 'Single file' : 'Served from dist'}</div>
            </div>
            <div className="factlet">
              <div className="mono text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Loaded from</div>
              <div className="text-[12px] break-all" title={IS_STANDALONE ? 'The application folder this window was opened from' : 'The address this window was served from'}>
                {runningFrom()}
              </div>
            </div>
          </div>
          {IS_STANDALONE && (
            <Notice tone="info">
              A desktop shortcut keeps pointing at the copy of the folder it was made from. If Update.cmd says it updated a <i>different</i> folder from the one above,
              that is why this window still shows the old build: run <code>Update.cmd</code> in the folder above, or <code>Create Desktop App.cmd</code> in the updated
              one to repoint the icon.
            </Notice>
          )}
          <p className="text-[12px] text-[var(--text-muted)]">
            To pick up newer application code, run <code>Update.cmd</code> in the app folder. It replaces the program files and leaves your data alone: your data lives in
            your storage folder or this browser, never inside the application. The app itself makes no call to the internet; updating is always something you start.
          </p>
          {canSelfUpdate() ? (
            updateReady ? (
              <div className="flex items-center gap-2">
                <button className="btn btn-primary" disabled={state.dirty.size > 0} onClick={applyUpdate}>
                  Reload into the new build
                </button>
                {state.dirty.size > 0 && <span className="text-[12px] text-[var(--text-muted)]">Save your changes first.</span>}
              </div>
            ) : (
              <Notice tone="info">This window checks the local server for a newer build when you come back to it. You are on the newest one it has seen.</Notice>
            )
          ) : (
            <Notice tone="info">
              This is the single-file version: there is no server and no cache to clear, so closing this window and opening it again after <code>Update.cmd</code> is all
              it takes. If it still shows the same build stamp afterwards, check the folder in "Loaded from" is the folder that was updated.
            </Notice>
          )}
        </div>
        <div className="card lg:col-span-2">
          <h2 className="card-title">Known limitations, by design</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-[var(--text-muted)]">
            <li>The curve spread is calendar-linear and ignores the P6 work calendar. An activity spanning a holiday shutdown accrues straight through it.</li>
            <li>Under RATE basis the budget is independent of P6 duration. A schedule change moves the curves but not the total.</li>
            <li>Percent complete from P6 duration is a weak proxy for progress and is only the fallback.</li>
            <li>Same-day activities credit in full on that day, unlike the source workbook which credited them from the following period.</li>
            <li>A date carrying a P6 constraint star (for example 01-Oct-26*) is treated as no date, as in the workbook, and is flagged on import.</li>
          </ul>
        </div>
      </div>
    </Page>
  );
}

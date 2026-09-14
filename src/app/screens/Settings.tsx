import { useState } from 'react';
import { useApp } from '../state';
import { Page, Notice } from '../components/ui';
import type { Settings as S } from '../../engine/types';
import { buildWorkbook, workbookBytes, downloadBytes, stamp } from '../export';
import type { Bundle } from '../state';
import { num } from '../format';

export function Settings() {
  const { state, model, actions } = useApp();
  const s = state.data.settings;
  const set = (patch: Partial<S>) => actions.update('settings', (prev) => ({ ...prev, ...patch }));
  const [busy, setBusy] = useState(false);

  const exportXlsx = async () => {
    setBusy(true);
    try {
      const wb = buildWorkbook(model, s, state.data.current?.activities ?? [], state.data.baseline?.activities ?? [], state.data.testProgress, state.data.snapshots);
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
    if (!confirm(`Restore from ${file.name}? Settings, library, locations, overrides and test progress are replaced. Schedules and snapshots in the backup are added alongside what you already have.`)) return;
    try {
      const bundle = JSON.parse(await file.text()) as Bundle;
      await actions.restoreBundle(bundle);
    } catch (err) {
      actions.notify('error', (err as Error).message);
    }
  };

  const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
    <label className="block text-[12px]">
      <div className="font-semibold text-slate-700">{label}</div>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-0.5 text-slate-500">{hint}</div>}
    </label>
  );

  return (
    <Page title="Settings" subtitle="Defaults apply wherever a library entry or location leaves a value blank. Changes take effect immediately in the model and are written on Save.">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          <h2 className="font-semibold">Dates</h2>
          <Field label="Data date" hint="The as-of date of the current P6 export. In-progress work earns from its actual start up to this date, and the earned curve stops here. Changing it moves the end of the earned curve.">
            <input className="input" type="date" value={s.dataDate} onChange={(e) => set({ dataDate: e.target.value })} />
          </Field>
          <Field label="Status date" hint="Proposed date for the next snapshot.">
            <input className="input" type="date" value={s.statusDate} onChange={(e) => set({ statusDate: e.target.value })} />
          </Field>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">Budget defaults</h2>
          <Field label="Default basis" hint="Used when a library entry has no basis. RATE: crew x shift hours x duration shifts. DUR: crew x shift hours x P6 original duration.">
            <select className="input" value={s.defaultBasis} onChange={(e) => set({ defaultBasis: e.target.value as S['defaultBasis'] })}>
              <option value="DUR">DUR</option>
              <option value="RATE">RATE</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default crew size"><input className="input w-full" type="number" step="any" value={s.defaultCrew} onChange={(e) => set({ defaultCrew: num(e.target.value) ?? 0 })} /></Field>
            <Field label="Default shift hours"><input className="input w-full" type="number" step="any" value={s.defaultShiftHours} onChange={(e) => set({ defaultShiftHours: num(e.target.value) ?? 0 })} /></Field>
            <Field label="Default complexity" hint="Used when a location has no factor."><input className="input w-full" type="number" step="0.05" value={s.defaultComplexity} onChange={(e) => set({ defaultComplexity: num(e.target.value) ?? 1 })} /></Field>
            <Field label="LOE duration days" hint="A DUR activity longer than this is flagged. Long P6 durations are usually hammocks, not effort."><input className="input w-full" type="number" value={s.loeDurationDays} onChange={(e) => set({ loeDurationDays: num(e.target.value) ?? 60 })} /></Field>
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">Storage</h2>
          <div className="text-[12px]">
            {state.adapterKind === 'filesystem' && (
              <>Data lives in the OneDrive folder <b>{state.folderName}</b> as plain JSON. Version history in OneDrive gives point in time recovery of every file.</>
            )}
            {state.adapterKind === 'indexeddb' && (
              <Notice tone="warn">Saving in this browser profile, not in OneDrive. It survives restarts, but clearing browsing data erases it and nothing is backed up. Take backups below, or switch to a folder.</Notice>
            )}
            {state.adapterKind === 'memory' && <Notice tone="error">Nothing is being saved. Choose a folder or browser storage below.</Notice>}
          </div>
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
          <h2 className="font-semibold">Backup and restore</h2>
          <p className="text-[12px] text-slate-600">
            One JSON file holding everything: settings, locations, the rate library, overrides, test progress, both schedules and every snapshot. Use it to move to another machine, or as a safety net when saving in the browser.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => void backup()}>Download a backup</button>
            <label className="btn cursor-pointer">
              Restore from a backup…
              <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && void restore(e.target.files[0])} />
            </label>
          </div>
        </div>
        <div className="card space-y-3">
          <h2 className="font-semibold">Export</h2>
          <p className="text-[12px] text-slate-600">Writes an .xlsx with the same sheet names and column layouts as the original workbook (values, no formulas) into the folder's <code>exports</code> sub-folder, so project controls can still be handed a spreadsheet. Curve CSV and chart PNG are on the Dashboard.</p>
          <button className="btn btn-primary" disabled={busy} onClick={() => void exportXlsx()}>{busy ? 'Building…' : 'Export workbook (.xlsx)'}</button>
        </div>
        <div className="card lg:col-span-2">
          <h2 className="font-semibold">Known limitations, by design</h2>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-slate-600">
            <li>The curve spread is calendar-linear and ignores the P6 work calendar. An activity spanning a holiday shutdown accrues straight through it.</li>
            <li>Under RATE basis the budget is independent of P6 duration. A schedule change moves the curves but not the total.</li>
            <li>Percent complete from P6 duration is a weak proxy for progress and is only the fallback.</li>
            <li>Tier 2 match resolution can over-consolidate if a library key is shortened too far. Budget Master shows which activities resolved through tier 2.</li>
            <li>Same-day activities credit in full on that day, unlike the source workbook which credited them from the following period.</li>
            <li>A date carrying a P6 constraint star (for example 01-Oct-26*) is treated as no date, as in the workbook, and is flagged on import.</li>
          </ul>
        </div>
      </div>
    </Page>
  );
}

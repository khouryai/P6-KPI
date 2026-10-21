/**
 * The scheduled Excel export: the runner, the strip that asks for the folder back,
 * and the Settings card that sets it up.
 *
 * The schedule and the chosen folder belong to this machine, not to the shared data
 * folder: they live in this browser's IndexedDB beside the storage folder's own
 * handle. Writing them into settings.json would make every colleague's laptop
 * export to a folder only one of them can see.
 *
 * The application is a page, so it exports while it is open. A run missed because
 * the app was shut happens the moment it is next opened (see `isDue`).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useApp } from './state';
import { Notice } from './components/ui';
import { IndexedDbAdapter } from '../storage/indexedDbAdapter';
import { fsaSupported, queryPermission, requestPermission } from './folder';
import { fmtDateTime } from './format';
import {
  DEFAULT_SCHEDULE,
  FREQUENCY_LABEL,
  WEEKDAYS,
  describeSchedule,
  exportFileNames,
  fortnightAnchor,
  isDue,
  nextScheduled,
  type ExportFiles,
  type ExportFrequency,
  type ExportSchedule,
} from './exportSchedule';
import type { Model } from '../engine/types';
import type { StoreData } from '../storage/store';
import type { StorageAdapter } from '../storage/adapter';

const SCHEDULE_KEY = 'exportSchedule';
const FOLDER_KEY = 'exportFolderHandle';
/** How often the open app looks at the clock. */
const CHECK_MS = 30_000;

type RunnerState = {
  loaded: boolean;
  schedule: ExportSchedule;
  folder: FileSystemDirectoryHandle | null;
  running: boolean;
  /** The folder's permission lapsed and only a click can bring it back. */
  needsPermission: boolean;
};

let current: RunnerState = { loaded: false, schedule: DEFAULT_SCHEDULE, folder: null, running: false, needsPermission: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<RunnerState>) => {
  current = { ...current, ...patch };
  for (const l of listeners) l();
};
let idb: IndexedDbAdapter | null = null;
const meta = () => (idb ??= new IndexedDbAdapter());

async function load(): Promise<void> {
  try {
    const [schedule, folder] = await Promise.all([meta().getMeta<ExportSchedule>(SCHEDULE_KEY), meta().getMeta<FileSystemDirectoryHandle>(FOLDER_KEY)]);
    set({ loaded: true, schedule: { ...DEFAULT_SCHEDULE, ...(schedule ?? {}) }, folder: folder ?? null });
  } catch {
    // No IndexedDB (a locked-down profile): the export can still be run by hand.
    set({ loaded: true });
  }
}

async function persist(schedule: ExportSchedule): Promise<void> {
  set({ schedule });
  try {
    await meta().setMeta(SCHEDULE_KEY, schedule);
  } catch {
    /* kept in memory for this session */
  }
}

export function useAutoExport(): RunnerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

/**
 * Change the schedule. A change to WHEN it runs restarts the clock, so a time set to
 * one already gone today does not fire on the spot.
 */
export async function updateSchedule(patch: Partial<ExportSchedule>): Promise<void> {
  const prev = current.schedule;
  const next: ExportSchedule = { ...prev, ...patch };
  const timing = (['enabled', 'frequency', 'time', 'weekday', 'monthDay'] as const).some((k) => k in patch && patch[k] !== prev[k]);
  if (timing) next.since = new Date().toISOString();
  if (next.frequency === 'fortnightly' && (timing || !next.anchor)) next.anchor = fortnightAnchor(next.weekday, new Date());
  await persist(next);
}

/** Ask for the folder to export into. Must run from a click. */
export async function chooseExportFolder(): Promise<string | null> {
  if (!fsaSupported()) throw new Error('This browser cannot open folders. Use Edge or Chrome.');
  const handle = await window.showDirectoryPicker!({ id: 'tc-budget-export', mode: 'readwrite' });
  await meta().setMeta(FOLDER_KEY, handle);
  set({ folder: handle, needsPermission: false });
  await updateSchedule({ destination: 'folder' });
  return handle.name;
}

/** What a run needs from the application. */
export type ExportContext = {
  model: Model;
  data: StoreData;
  adapterKind: StorageAdapter['kind'] | null;
  writeExport: (name: string, bytes: Uint8Array) => Promise<string>;
};

async function writeToFolder(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<string> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await (fh as FileSystemFileHandle & { createWritable: (o?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: false });
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return `${dir.name}\\${name}`;
}

/** Holds one run at a time across every window of the app on this machine. */
async function exclusively(fn: () => Promise<void>): Promise<void> {
  const locks = (navigator as Navigator & { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void>) => Promise<void> } }).locks;
  if (!locks) return fn();
  await locks.request('tc-budget-export', { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

/**
 * Build the extract and write it where the schedule says.
 *
 * `fromClick` is true when a person pressed a button, which is the only time a
 * lapsed folder permission can be asked for again. A scheduled run that finds the
 * permission gone stops and raises the strip instead of failing quietly, and stays
 * due, so the click that grants it also makes the export.
 */
export async function runExport(trigger: 'manual' | 'scheduled', ctx: ExportContext, fromClick: boolean): Promise<{ ok: boolean; message: string }> {
  let outcome = { ok: false, message: 'Another window is already exporting.' };
  await exclusively(async () => {
    if (current.running) return;
    // Another window may have just run it: read the schedule fresh before deciding.
    await load();
    const s = current.schedule;
    if (trigger === 'scheduled' && !fromClick && !isDue(s, new Date())) {
      outcome = { ok: true, message: 'Not due.' };
      return;
    }
    set({ running: true });
    const when = new Date();
    try {
      let write: (name: string, bytes: Uint8Array) => Promise<string>;
      if (s.destination === 'data-folder') {
        if (ctx.adapterKind !== 'filesystem') throw new Error('The data is not in a folder on this machine, so there is no exports folder to write to. Choose a folder for the export instead.');
        write = ctx.writeExport;
      } else {
        const dir = current.folder;
        if (!dir) throw new Error('No export folder has been chosen. Choose one under Settings → Scheduled Excel export.');
        let perm = await queryPermission(dir);
        if (perm !== 'granted') perm = await requestPermission(dir);
        if (perm !== 'granted') {
          set({ needsPermission: true });
          outcome = { ok: false, message: `Access to the folder ${dir.name} needs to be allowed again.` };
          return;
        }
        write = (name, bytes) => writeToFolder(dir, name, bytes);
      }
      const { dataExtractBytes } = await import('./dataExtract');
      const bytes = dataExtractBytes(ctx.model, ctx.data, { generatedAt: when, trigger });
      const written: string[] = [];
      const failed: string[] = [];
      for (const name of exportFileNames(s.files, when)) {
        try {
          written.push(await write(name, bytes));
        } catch (err) {
          const why = (err as Error).message || String(err);
          failed.push(`${name}: ${/lock|in use|NoModification|InvalidState/i.test(why) ? 'the file is open, probably in Excel — close it and the next run will replace it' : why}`);
        }
      }
      const ok = failed.length === 0;
      const error = failed.length ? failed.join('; ') : undefined;
      await persist({ ...current.schedule, lastRunAt: when.toISOString(), lastResult: { ok, at: when.toISOString(), files: written, error, trigger } });
      set({ needsPermission: false });
      outcome = ok ? { ok, message: `Excel export written to ${written.join(' and ')}.` } : { ok, message: `Export ${written.length ? `written to ${written.join(', ')}, but ` : ''}not written: ${error}` };
    } catch (err) {
      const error = (err as Error).message || String(err);
      // Recorded as a run, so a schedule that cannot write does not retry every 30 seconds.
      await persist({ ...current.schedule, lastRunAt: when.toISOString(), lastResult: { ok: false, at: when.toISOString(), files: [], error, trigger } });
      outcome = { ok: false, message: error };
    } finally {
      set({ running: false });
    }
  });
  return outcome;
}

function useContextRef(): React.RefObject<ExportContext> {
  const { state, model, actions } = useApp();
  const ref = useRef<ExportContext>({ model, data: state.data, adapterKind: state.adapterKind, writeExport: actions.writeExport });
  ref.current = { model, data: state.data, adapterKind: state.adapterKind, writeExport: actions.writeExport };
  return ref;
}

/**
 * Watches the clock while the app is open, and says when the export is waiting on
 * a click. Rendered once, in the layout.
 */
export function AutoExportStrip() {
  const { actions } = useApp();
  const r = useAutoExport();
  const ctx = useContextRef();

  useEffect(() => {
    if (!current.loaded) void load();
  }, []);

  useEffect(() => {
    if (!r.loaded || !r.schedule.enabled || r.needsPermission) return;
    const tick = () => {
      if (current.running || !isDue(current.schedule, new Date())) return;
      void runExport('scheduled', ctx.current, false).then((o) => {
        if (o.message !== 'Not due.' && !current.needsPermission) actions.notify(o.ok ? 'ok' : 'error', `Scheduled export: ${o.message}`);
      });
    };
    tick();
    const id = window.setInterval(tick, CHECK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [r.loaded, r.schedule.enabled, r.needsPermission, ctx, actions]);

  if (!r.needsPermission) return null;
  return (
    <div className="strip strip-warn flex items-center justify-between gap-3">
      <div className="min-w-0">
        <span className="font-semibold">The scheduled Excel export is due.</span> The browser needs you to allow writing to <b>{r.folder?.name ?? 'the export folder'}</b> again
        before it can save it there.
      </div>
      <button
        className="btn btn-mini btn-primary shrink-0"
        disabled={r.running}
        onClick={() => void runExport('scheduled', ctx.current, true).then((o) => actions.notify(o.ok ? 'ok' : 'error', o.message))}
      >
        {r.running ? 'Exporting…' : 'Allow and export now'}
      </button>
    </div>
  );
}

/** The Settings card. */
export function ScheduledExportCard() {
  const { state, actions } = useApp();
  const r = useAutoExport();
  const ctx = useContextRef();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!current.loaded) void load();
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const s = r.schedule;
  const inFolder = state.adapterKind === 'filesystem';
  const canPick = fsaSupported();
  const next = s.enabled ? nextScheduled(s, now) : null;
  const due = isDue(s, now);
  const where = s.destination === 'data-folder' ? (inFolder ? `the exports folder inside ${state.folderName ?? 'the data folder'}` : 'nowhere yet') : r.folder ? `the folder ${r.folder.name}` : 'nowhere yet';
  const ready = s.destination === 'data-folder' ? inFolder : !!r.folder;

  const pick = async () => {
    try {
      const name = await chooseExportFolder();
      if (name) actions.notify('ok', `Exports will be saved in ${name}.`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') actions.notify('error', (err as Error).message);
    }
  };
  const runNow = async () => {
    const o = await runExport('manual', ctx.current, true);
    actions.notify(o.ok ? 'ok' : 'error', o.message);
  };

  const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</div>;

  return (
    <div className="card space-y-3 lg:col-span-2">
      <h2 className="card-title">Scheduled Excel export</h2>
      <p className="text-[12px] text-[var(--text-muted)]">
        Saves the full data extract — every activity with its status, location name, split, dates, progress and notes, every rollup, review, headcount and rule, with a
        Data_Dictionary that defines every column and a Status_Codes sheet that explains every status — to a folder of your choosing, on a schedule. The schedule and the
        folder are kept on this machine only.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label>Save to</Label>
          <select
            className="input w-full"
            value={s.destination}
            onChange={(e) => void updateSchedule({ destination: e.target.value as ExportSchedule['destination'] })}
          >
            <option value="folder">A folder I choose</option>
            <option value="data-folder" disabled={!inFolder}>
              The data folder’s exports folder{inFolder ? '' : ' (data is not in a folder)'}
            </option>
          </select>
          {s.destination === 'folder' && (
            <div className="flex items-center gap-2">
              <button className="btn btn-mini" disabled={!canPick} onClick={() => void pick()}>
                {r.folder ? 'Change folder…' : 'Choose folder…'}
              </button>
              <span className="truncate text-[12px]" title={r.folder?.name}>
                {r.folder ? <b>{r.folder.name}</b> : <span className="text-[var(--text-subtle)]">none chosen</span>}
              </span>
            </div>
          )}
          {!canPick && s.destination === 'folder' && <div className="text-[11.5px] text-[var(--bad)]">This browser cannot open folders. Use Edge or Chrome.</div>}
        </div>

        <div className="space-y-1">
          <Label>How often</Label>
          <div className="flex flex-wrap gap-2">
            <select className="input" value={s.frequency} onChange={(e) => void updateSchedule({ frequency: e.target.value as ExportFrequency })}>
              {(Object.keys(FREQUENCY_LABEL) as ExportFrequency[]).map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
              ))}
            </select>
            {(s.frequency === 'weekly' || s.frequency === 'fortnightly') && (
              <select className="input" aria-label="Day of the week" value={s.weekday} onChange={(e) => void updateSchedule({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            )}
            {s.frequency === 'monthly' && (
              <select className="input" aria-label="Day of the month" value={s.monthDay} onChange={(e) => void updateSchedule({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d === 31 ? 'Last day' : `Day ${d}`}</option>
                ))}
              </select>
            )}
            <input className="input" type="time" aria-label="Time of day" value={s.time} onChange={(e) => e.target.value && void updateSchedule({ time: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Files</Label>
          <select className="input w-full" value={s.files} onChange={(e) => void updateSchedule({ files: e.target.value as ExportFiles })}>
            <option value="dated">A new dated file each time</option>
            <option value="latest">One file, replaced each time (TC_Budget_Data_latest.xlsx)</option>
            <option value="both">Both: a dated file and the latest</option>
          </select>
          <div className="text-[11.5px] text-[var(--text-subtle)]">A file that is open in Excel cannot be replaced; the run says so and the next one tries again.</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] font-semibold">
          <input type="checkbox" checked={s.enabled} disabled={!ready && !s.enabled} onChange={(e) => void updateSchedule({ enabled: e.target.checked })} />
          Export automatically
        </label>
        <button className="btn" disabled={!ready || r.running} onClick={() => void runNow()}>
          {r.running ? 'Exporting…' : 'Export now to this folder'}
        </button>
        {!ready && <span className="text-[12px] text-[var(--text-muted)]">Choose where to save it first.</span>}
      </div>

      <div className="text-[12px] text-[var(--text-muted)]">
        {s.enabled ? (
          <>
            Exports <b>{describeSchedule(s)}</b> to {where}.{' '}
            {due ? <b>An export is due now.</b> : next ? <>Next: <b>{fmtDateTime(next.toISOString())}</b>.</> : null}
          </>
        ) : (
          <>Not scheduled. Tick <b>Export automatically</b> to start.</>
        )}{' '}
        {s.lastResult && (
          <span className={s.lastResult.ok ? '' : 'text-[var(--bad)]'}>
            Last export {fmtDateTime(s.lastResult.at)}
            {s.lastResult.trigger === 'manual' ? ' (by hand)' : ''}: {s.lastResult.ok ? s.lastResult.files.join(', ') : s.lastResult.error}
          </span>
        )}
      </div>

      <Notice tone="info">
        The app has to be open to export — it is a page in Edge, not a background service. If it is closed at the scheduled time, the export runs as soon as you next
        open it, once, however many times were missed. Leave the window open (minimised is fine) to have it run on time.
      </Notice>
    </div>
  );
}

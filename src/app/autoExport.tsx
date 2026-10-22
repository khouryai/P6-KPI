/**
 * The scheduled exports — the Excel data extract, and the S-curve picture — with the
 * runner, the strip that asks for a folder back, and the Settings cards that set
 * them up.
 *
 * Each export is a job with its own schedule, folder and last result, run by the
 * same clock. The schedules and folders belong to this machine, not to the shared
 * data folder: they live in this browser's IndexedDB beside the storage folder's own
 * handle. Writing them into settings.json would make every colleague's laptop export
 * to a folder only one of them can see.
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
import { downloadBytes } from './export';
import { scurveChoices, WHOLE_PROJECT } from './scurve';
import {
  DEFAULT_SCHEDULE,
  EXCEL_FILES,
  FREQUENCY_LABEL,
  SCURVE_FILES,
  WEEKDAYS,
  describeSchedule,
  exportFileNames,
  fortnightAnchor,
  isDue,
  nextScheduled,
  type ExportFileNaming,
  type ExportFiles,
  type ExportFrequency,
  type ExportSchedule,
} from './exportSchedule';
import type { Model } from '../engine/types';
import type { StoreData } from '../storage/store';
import type { StorageAdapter } from '../storage/adapter';

/** How often the open app looks at the clock. */
const CHECK_MS = 30_000;

export type JobId = 'excel' | 'scurve';

/** What a run needs from the application. */
export type ExportContext = {
  model: Model;
  data: StoreData;
  adapterKind: StorageAdapter['kind'] | null;
  writeExport: (name: string, bytes: Uint8Array) => Promise<string>;
};

type Job = {
  id: JobId;
  /** "Excel export", "S-curve export": how messages name it. */
  noun: string;
  /** IndexedDB keys. The Excel job keeps the keys it had before there were two jobs. */
  scheduleKey: string;
  folderKey: string;
  naming: ExportFileNaming;
  defaults: Partial<ExportSchedule>;
  /** What a file still open somewhere is most likely open in. */
  openIn: string;
  build: (ctx: ExportContext, when: Date, trigger: 'manual' | 'scheduled', s: ExportSchedule) => Promise<Uint8Array>;
};

const JOBS: Record<JobId, Job> = {
  excel: {
    id: 'excel',
    noun: 'Excel export',
    scheduleKey: 'exportSchedule',
    folderKey: 'exportFolderHandle',
    naming: EXCEL_FILES,
    defaults: {},
    openIn: 'Excel',
    build: async (ctx, when, trigger) => {
      const { dataExtractBytes } = await import('./dataExtract');
      return dataExtractBytes(ctx.model, ctx.data, { generatedAt: when, trigger });
    },
  },
  scurve: {
    id: 'scurve',
    noun: 'S-curve export',
    scheduleKey: 'scurveSchedule',
    folderKey: 'scurveFolderHandle',
    naming: SCURVE_FILES,
    defaults: { files: 'latest', phases: [WHOLE_PROJECT], unit: 'percent', destination: 'excel-folder' },
    openIn: 'another program',
    build: async (ctx, when, _trigger, s) => {
      const { renderSCurvePng } = await import('./scurvePng');
      return renderSCurvePng(ctx.model, ctx.data.settings, { phases: s.phases ?? [WHOLE_PROJECT], unit: s.unit ?? 'percent', when });
    },
  },
};

type RunnerState = {
  loaded: boolean;
  schedule: ExportSchedule;
  folder: FileSystemDirectoryHandle | null;
  running: boolean;
  /** The folder's permission lapsed and only a click can bring it back. */
  needsPermission: boolean;
};

const blank = (job: Job): RunnerState => ({ loaded: false, schedule: { ...DEFAULT_SCHEDULE, ...job.defaults }, folder: null, running: false, needsPermission: false });
let states: Record<JobId, RunnerState> = { excel: blank(JOBS.excel), scurve: blank(JOBS.scurve) };
const listeners = new Set<() => void>();
const set = (job: JobId, patch: Partial<RunnerState>) => {
  states = { ...states, [job]: { ...states[job], ...patch } };
  for (const l of listeners) l();
};
let idb: IndexedDbAdapter | null = null;
const meta = () => (idb ??= new IndexedDbAdapter());

async function load(job: JobId): Promise<void> {
  const j = JOBS[job];
  try {
    const [schedule, folder] = await Promise.all([meta().getMeta<ExportSchedule>(j.scheduleKey), meta().getMeta<FileSystemDirectoryHandle>(j.folderKey)]);
    set(job, { loaded: true, schedule: { ...DEFAULT_SCHEDULE, ...j.defaults, ...(schedule ?? {}) }, folder: folder ?? null });
  } catch {
    // No IndexedDB (a locked-down profile): the export can still be run by hand.
    set(job, { loaded: true });
  }
}
const loadAll = () => Promise.all((Object.keys(JOBS) as JobId[]).map(load));

async function persist(job: JobId, schedule: ExportSchedule): Promise<void> {
  set(job, { schedule });
  try {
    await meta().setMeta(JOBS[job].scheduleKey, schedule);
  } catch {
    /* kept in memory for this session */
  }
}

export function useAutoExport(job: JobId): RunnerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => states[job],
  );
}

/**
 * Change a schedule. A change to WHEN it runs restarts the clock, so a time set to
 * one already gone today does not fire on the spot.
 */
export async function updateSchedule(job: JobId, patch: Partial<ExportSchedule>): Promise<void> {
  const prev = states[job].schedule;
  const next: ExportSchedule = { ...prev, ...patch };
  const timing = (['enabled', 'frequency', 'time', 'weekday', 'monthDay'] as const).some((k) => k in patch && patch[k] !== prev[k]);
  if (timing) next.since = new Date().toISOString();
  if (next.frequency === 'fortnightly' && (timing || !next.anchor)) next.anchor = fortnightAnchor(next.weekday, new Date());
  await persist(job, next);
}

/** Ask for the folder an export goes into. Must run from a click. */
export async function chooseExportFolder(job: JobId): Promise<string | null> {
  if (!fsaSupported()) throw new Error('This browser cannot open folders. Use Edge or Chrome.');
  const handle = await window.showDirectoryPicker!({ id: 'tc-budget-export', mode: 'readwrite' });
  await meta().setMeta(JOBS[job].folderKey, handle);
  set(job, { folder: handle, needsPermission: false });
  await updateSchedule(job, { destination: 'folder' });
  return handle.name;
}

/**
 * Where a job writes: the data folder's exports, or a folder handle. The S-curve
 * can follow the Excel export, wherever that has been pointed.
 */
function destinationOf(job: JobId): { kind: 'data-folder' } | { kind: 'folder'; dir: FileSystemDirectoryHandle | null } {
  const s = states[job].schedule;
  if (s.destination === 'excel-folder' && job !== 'excel') {
    const ex = states.excel.schedule;
    return ex.destination === 'data-folder' ? { kind: 'data-folder' } : { kind: 'folder', dir: states.excel.folder };
  }
  return s.destination === 'data-folder' ? { kind: 'data-folder' } : { kind: 'folder', dir: states[job].folder };
}

async function writeToFolder(dir: FileSystemDirectoryHandle, name: string, bytes: Uint8Array): Promise<string> {
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await (fh as FileSystemFileHandle & { createWritable: (o?: { keepExistingData?: boolean }) => Promise<FileSystemWritableFileStream> }).createWritable({ keepExistingData: false });
  await w.write(bytes as unknown as BufferSource);
  await w.close();
  return `${dir.name}\\${name}`;
}

/** Holds one run of a job at a time across every window of the app on this machine. */
async function exclusively(job: JobId, fn: () => Promise<void>): Promise<void> {
  const locks = (navigator as Navigator & { locks?: { request: (n: string, o: { ifAvailable: boolean }, cb: (l: unknown) => Promise<void>) => Promise<void> } }).locks;
  if (!locks) return fn();
  // The Excel job keeps its original lock name, so a window on the older build still respects it.
  await locks.request(job === 'excel' ? 'tc-budget-export' : `tc-budget-export-${job}`, { ifAvailable: true }, async (lock) => {
    if (lock) await fn();
  });
}

/**
 * Build one export and write it where its schedule says.
 *
 * `fromClick` is true when a person pressed a button, which is the only time a
 * lapsed folder permission can be asked for again. A scheduled run that finds the
 * permission gone stops and raises the strip instead of failing quietly, and stays
 * due, so the click that grants it also makes the export.
 */
export async function runExport(job: JobId, trigger: 'manual' | 'scheduled', ctx: ExportContext, fromClick: boolean): Promise<{ ok: boolean; message: string }> {
  const j = JOBS[job];
  let outcome = { ok: false, message: 'Another window is already exporting.' };
  await exclusively(job, async () => {
    if (states[job].running) return;
    // Another window may have just run it: read the schedules fresh before deciding.
    await loadAll();
    const s = states[job].schedule;
    if (trigger === 'scheduled' && !fromClick && !isDue(s, new Date())) {
      outcome = { ok: true, message: 'Not due.' };
      return;
    }
    set(job, { running: true });
    const when = new Date();
    try {
      let write: (name: string, bytes: Uint8Array) => Promise<string>;
      const dest = destinationOf(job);
      if (dest.kind === 'data-folder') {
        if (ctx.adapterKind !== 'filesystem') throw new Error('The data is not in a folder on this machine, so there is no exports folder to write to. Choose a folder for the export instead.');
        write = ctx.writeExport;
      } else {
        const dir = dest.dir;
        if (!dir) throw new Error(`No folder has been chosen for the ${j.noun}. Choose one in Settings.`);
        let perm = await queryPermission(dir);
        if (perm !== 'granted') perm = await requestPermission(dir);
        if (perm !== 'granted') {
          set(job, { needsPermission: true });
          outcome = { ok: false, message: `Access to the folder ${dir.name} needs to be allowed again.` };
          return;
        }
        write = (name, bytes) => writeToFolder(dir, name, bytes);
      }
      const bytes = await j.build(ctx, when, trigger, s);
      const written: string[] = [];
      const failed: string[] = [];
      for (const name of exportFileNames(s.files, when, j.naming)) {
        try {
          written.push(await write(name, bytes));
        } catch (err) {
          const why = (err as Error).message || String(err);
          failed.push(`${name}: ${/lock|in use|NoModification|InvalidState/i.test(why) ? `the file is open, probably in ${j.openIn} — close it and the next run will replace it` : why}`);
        }
      }
      const ok = failed.length === 0;
      const error = failed.length ? failed.join('; ') : undefined;
      await persist(job, { ...states[job].schedule, lastRunAt: when.toISOString(), lastResult: { ok, at: when.toISOString(), files: written, error, trigger } });
      set(job, { needsPermission: false });
      outcome = ok
        ? { ok, message: `${j.noun} written to ${written.join(' and ')}.` }
        : { ok, message: `${j.noun} ${written.length ? `written to ${written.join(', ')}, but ` : ''}not written: ${error}` };
    } catch (err) {
      const error = (err as Error).message || String(err);
      // Recorded as a run, so a schedule that cannot write does not retry every 30 seconds.
      await persist(job, { ...states[job].schedule, lastRunAt: when.toISOString(), lastResult: { ok: false, at: when.toISOString(), files: [], error, trigger } });
      outcome = { ok: false, message: error };
    } finally {
      set(job, { running: false });
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
 * Watches the clock for every export while the app is open, and says when one is
 * waiting on a click. Rendered once, in the layout.
 */
export function AutoExportStrip() {
  const { actions } = useApp();
  const excel = useAutoExport('excel');
  const scurve = useAutoExport('scurve');
  const ctx = useContextRef();

  useEffect(() => {
    if (!states.excel.loaded || !states.scurve.loaded) void loadAll();
  }, []);

  const watching = (r: RunnerState) => r.loaded && r.schedule.enabled && !r.needsPermission;
  const watchExcel = watching(excel);
  const watchSCurve = watching(scurve);
  useEffect(() => {
    const jobs = (['excel', 'scurve'] as JobId[]).filter((j) => (j === 'excel' ? watchExcel : watchSCurve));
    if (jobs.length === 0) return;
    const tick = () => {
      for (const job of jobs) {
        const r = states[job];
        if (r.running || r.needsPermission || !isDue(r.schedule, new Date())) continue;
        void runExport(job, 'scheduled', ctx.current, false).then((o) => {
          if (o.message !== 'Not due.' && !states[job].needsPermission) actions.notify(o.ok ? 'ok' : 'error', `Scheduled ${JOBS[job].noun.replace(' export', '')} export: ${o.message}`);
        });
      }
    };
    tick();
    const id = window.setInterval(tick, CHECK_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [watchExcel, watchSCurve, ctx, actions]);

  const waiting = (['excel', 'scurve'] as JobId[]).filter((j) => (j === 'excel' ? excel : scurve).needsPermission);
  if (waiting.length === 0) return null;
  return (
    <>
      {waiting.map((job) => {
        const r = job === 'excel' ? excel : scurve;
        const dest = destinationOf(job);
        const name = dest.kind === 'folder' ? dest.dir?.name : undefined;
        return (
          <div key={job} className="strip strip-warn flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="font-semibold">The scheduled {JOBS[job].noun} is due.</span> The browser needs you to allow writing to <b>{name ?? 'the export folder'}</b> again
              before it can save it there.
            </div>
            <button
              className="btn btn-mini btn-primary shrink-0"
              disabled={r.running}
              onClick={() => void runExport(job, 'scheduled', ctx.current, true).then((o) => actions.notify(o.ok ? 'ok' : 'error', o.message))}
            >
              {r.running ? 'Exporting…' : 'Allow and export now'}
            </button>
          </div>
        );
      })}
    </>
  );
}

const Label = ({ children }: { children: React.ReactNode }) => <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{children}</div>;

/** The Settings card for one export. */
export function ScheduledExportCard({ job }: { job: JobId }) {
  const { state, model, actions } = useApp();
  const r = useAutoExport(job);
  const excel = useAutoExport('excel');
  const ctx = useContextRef();
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!states.excel.loaded || !states.scurve.loaded) void loadAll();
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const j = JOBS[job];
  const s = r.schedule;
  const update = (patch: Partial<ExportSchedule>) => void updateSchedule(job, patch);
  const inFolder = state.adapterKind === 'filesystem';
  const canPick = fsaSupported();
  const next = s.enabled ? nextScheduled(s, now) : null;
  const due = isDue(s, now);

  // Where the S-curve would go if it followed the Excel export.
  const excelWhere = excel.schedule.destination === 'data-folder' ? (inFolder ? 'the data folder’s exports' : null) : excel.folder ? excel.folder.name : null;
  const dest = destinationOf(job);
  const where =
    dest.kind === 'data-folder' ? (inFolder ? `the exports folder inside ${state.folderName ?? 'the data folder'}` : null) : dest.dir ? `the folder ${dest.dir.name}` : null;
  const choices = job === 'scurve' ? scurveChoices(model) : [];
  const picked = new Set(s.phases ?? []);
  const curvesChosen = job !== 'scurve' || choices.some((c) => picked.has(c.key));
  const ready = !!where && curvesChosen;

  const pick = async () => {
    try {
      const name = await chooseExportFolder(job);
      if (name) actions.notify('ok', `${j.noun.replace(/^./, (c) => c.toUpperCase())}s will be saved in ${name}.`);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') actions.notify('error', (err as Error).message);
    }
  };
  const runNow = async () => {
    const o = await runExport(job, 'manual', ctx.current, true);
    actions.notify(o.ok ? 'ok' : 'error', o.message);
  };
  const download = async () => {
    setBusy(true);
    try {
      const bytes = await j.build(ctx.current, new Date(), 'manual', s);
      downloadBytes(`${j.naming.latest}.${j.naming.ext}`, bytes, job === 'scurve' ? 'image/png' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const togglePhase = (key: string, on: boolean) => {
    const nextSet = new Set(picked);
    if (on) nextSet.add(key);
    else nextSet.delete(key);
    update({ phases: choices.map((c) => c.key).filter((k) => nextSet.has(k)) });
  };

  return (
    <div className="card space-y-3 lg:col-span-2">
      <h2 className="card-title">{job === 'excel' ? 'Scheduled Excel export' : 'Scheduled S-curve export'}</h2>
      <p className="text-[12px] text-[var(--text-muted)]">
        {job === 'excel' ? (
          <>
            Saves the full data extract — every activity with its status, location name, split, dates, progress and notes, every rollup, review, headcount and rule, with a
            Data_Dictionary that defines every column and a Status_Codes sheet that explains every status — to a folder of your choosing, on a schedule.
          </>
        ) : (
          <>
            Saves the S-curve as a picture, <b>SCurve_Latest.png</b>: one curve for each phase ticked below, stacked one above the other, each with its DATA DATE and TODAY
            lines and its percent complete against the percent the baseline expected. Planned is the baseline, forecast the current schedule, earned is on actual dates.
          </>
        )}{' '}
        The schedule and the folder are kept on this machine only.
      </p>

      {job === 'scurve' && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1 md:col-span-2">
            <Label>Curves, top to bottom</Label>
            {choices.length <= 1 && model.rows.length === 0 ? (
              <div className="text-[12px] text-[var(--text-subtle)]">Import a schedule to choose phases.</div>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {choices.map((c) => (
                  <label key={c.key} className="flex items-center gap-1.5 text-[12.5px]">
                    <input type="checkbox" checked={picked.has(c.key)} onChange={(e) => togglePhase(c.key, e.target.checked)} />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
            {!curvesChosen && choices.length > 0 && <div className="text-[11.5px] text-[var(--bad)]">Tick at least one curve.</div>}
          </div>
          <div className="space-y-1">
            <Label>Measure in</Label>
            <select className="input w-full" value={s.unit ?? 'percent'} onChange={(e) => update({ unit: e.target.value as 'percent' | 'hours' })}>
              <option value="percent">% complete</option>
              <option value="hours">Man hours</option>
            </select>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-1">
          <Label>Save to</Label>
          <select className="input w-full" value={s.destination} onChange={(e) => update({ destination: e.target.value as ExportSchedule['destination'] })}>
            {job !== 'excel' && (
              <option value="excel-folder" disabled={!excelWhere}>
                The same folder as the Excel export{excelWhere ? ` (${excelWhere})` : ' (none chosen yet)'}
              </option>
            )}
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
            <select className="input" aria-label="How often" value={s.frequency} onChange={(e) => update({ frequency: e.target.value as ExportFrequency })}>
              {(Object.keys(FREQUENCY_LABEL) as ExportFrequency[]).map((f) => (
                <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>
              ))}
            </select>
            {(s.frequency === 'weekly' || s.frequency === 'fortnightly') && (
              <select className="input" aria-label="Day of the week" value={s.weekday} onChange={(e) => update({ weekday: Number(e.target.value) })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            )}
            {s.frequency === 'monthly' && (
              <select className="input" aria-label="Day of the month" value={s.monthDay} onChange={(e) => update({ monthDay: Number(e.target.value) })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d === 31 ? 'Last day' : `Day ${d}`}</option>
                ))}
              </select>
            )}
            <input className="input" type="time" aria-label="Time of day" value={s.time} onChange={(e) => e.target.value && update({ time: e.target.value })} />
          </div>
        </div>

        <div className="space-y-1">
          <Label>Files</Label>
          <select className="input w-full" aria-label="Files" value={s.files} onChange={(e) => update({ files: e.target.value as ExportFiles })}>
            <option value="latest">One file, replaced each time ({j.naming.latest}.{j.naming.ext})</option>
            <option value="dated">A new dated file each time</option>
            <option value="both">Both: a dated file and the latest</option>
          </select>
          <div className="text-[11.5px] text-[var(--text-subtle)]">A file that is open in {j.openIn} cannot be replaced; the run says so and the next one tries again.</div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[12.5px] font-semibold">
          <input type="checkbox" checked={s.enabled} disabled={!ready && !s.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
          Export automatically
        </label>
        <button className="btn" disabled={!ready || r.running} onClick={() => void runNow()}>
          {r.running ? 'Exporting…' : 'Export now to this folder'}
        </button>
        {job === 'scurve' && (
          <button className="btn" disabled={!curvesChosen || busy} onClick={() => void download()} title="Make the picture now and download it, without writing to the folder">
            {busy ? 'Drawing…' : 'Download a copy'}
          </button>
        )}
        {!where && <span className="text-[12px] text-[var(--text-muted)]">Choose where to save it first.</span>}
      </div>

      <div className="text-[12px] text-[var(--text-muted)]">
        {s.enabled ? (
          <>
            Exports <b>{describeSchedule(s)}</b> to {where ?? 'nowhere yet'}.{' '}
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

      {job === 'excel' && (
        <Notice tone="info">
          The app has to be open to export — it is a page in Edge, not a background service. If it is closed at the scheduled time, the export runs as soon as you next
          open it, once, however many times were missed. Leave the window open (minimised is fine) to have it run on time. The same goes for the S-curve export below.
        </Notice>
      )}
    </div>
  );
}

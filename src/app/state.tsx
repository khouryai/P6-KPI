import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Model, ModelBase, ScheduleImport, ImportKind, ImportIndexEntry, P6Activity } from '../engine/types';
import { attachBurn, computeBase } from '../engine/compute';
import { discoverLibrary, discoverLocations } from '../engine/discover';
import type { StorageAdapter } from '../storage/adapter';
import { FileSystemAdapter } from '../storage/fileSystemAdapter';
import { FsaDirectory } from '../storage/fsaDirectory';
import { IndexedDbAdapter } from '../storage/indexedDbAdapter';
import { MemoryAdapter } from '../storage/memoryAdapter';
import { Store, emptyStoreData, importStamp, FILES, type StoreData, type StoreFileKey, type ConflictCopy, type LockStatus } from '../storage/store';
import { fsaSupported, loadFolderHandle, saveFolderHandle, forgetFolderHandle, pickFolder, queryPermission, requestPermission, ownerIdentity } from './folder';

const MODE_KEY = 'tc-storage-mode';
function readMode(): string | null {
  try { return localStorage.getItem(MODE_KEY); } catch { return null; }
}
function writeMode(v: string | null): void {
  try { if (v === null) localStorage.removeItem(MODE_KEY); else localStorage.setItem(MODE_KEY, v); } catch { /* private window */ }
}

/**
 * Auto-save is on unless it was turned off, and the preference lives in the browser
 * rather than in the store: it is about this machine, and writing it into a data file
 * would make the setting itself something you had to save.
 */
const AUTOSAVE_KEY = 'tc-autosave';
/** How long after the last edit the write goes out. Long enough to coalesce typing. */
const AUTOSAVE_DELAY = 1200;
function readAutoSave(): boolean {
  try { return localStorage.getItem(AUTOSAVE_KEY) !== 'off'; } catch { return true; }
}
function writeAutoSave(on: boolean): void {
  try { localStorage.setItem(AUTOSAVE_KEY, on ? 'on' : 'off'); } catch { /* private window */ }
}

/** Everything in the store as one file, for backup, restore and moving between machines. */
export type Bundle = {
  kind: 'tc-budget-backup';
  version: 1;
  createdAt: string;
  data: StoreData;
};

export type AppStatus = 'booting' | 'no-folder' | 'needs-permission' | 'loading' | 'ready' | 'error';

export type AppState = {
  status: AppStatus;
  error: string | null;
  data: StoreData;
  dirty: Set<StoreFileKey>;
  problems: string[];
  conflicts: ConflictCopy[];
  lock: LockStatus | null;
  storageLabel: string;
  adapterKind: StorageAdapter['kind'] | null;
  folderName: string | null;
  saving: boolean;
  lastSavedAt: string | null;
  /** Writing changes out on its own, shortly after each edit. */
  autoSave: boolean;
  toast: { kind: 'ok' | 'error' | 'info'; text: string } | null;
};

export type DataUpdater = <K extends StoreFileKey>(key: K, fn: (prev: StoreData[K]) => StoreData[K]) => void;

export type AppActions = {
  chooseFolder(): Promise<void>;
  useBrowserStorage(): Promise<void>;
  exportBundle(): Bundle;
  restoreBundle(bundle: Bundle): Promise<void>;
  grantPermission(): Promise<void>;
  useMemoryOnly(): void;
  forgetFolder(): Promise<void>;
  reload(): Promise<void>;
  save(opts?: { silent?: boolean }): Promise<void>;
  setAutoSave(on: boolean): void;
  update: DataUpdater;
  commitImport(kind: ImportKind, activities: P6Activity[], sourceFilename: string): Promise<void>;
  restoreImport(entry: ImportIndexEntry): Promise<void>;
  readImport(entry: ImportIndexEntry): Promise<ScheduleImport | null>;
  /** Delete one schedule import. Nothing you keyed is touched; see the action. */
  removeImport(entry: ImportIndexEntry): Promise<void>;
  writeExport(name: string, bytes: Uint8Array): Promise<string>;
  listFolderFiles(): Promise<string[]>;
  readFolderFile(path: string): Promise<string | null>;
  readFolderBinary(path: string): Promise<Uint8Array | null>;
  notify(kind: 'ok' | 'error' | 'info', text: string): void;
};

type Ctx = { state: AppState; model: Model; actions: AppActions };
const AppContext = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp outside provider');
  return c;
}

const initial: AppState = {
  status: 'booting',
  error: null,
  data: emptyStoreData(),
  dirty: new Set(),
  problems: [],
  conflicts: [],
  lock: null,
  storageLabel: '',
  adapterKind: null,
  folderName: null,
  saving: false,
  lastSavedAt: null,
  autoSave: readAutoSave(),
  toast: null,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initial);
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;
  const storeRef = useRef<Store | null>(null);
  const idbRef = useRef<IndexedDbAdapter | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
  /** Set when a save fails, so auto-save waits for the next edit rather than looping. */
  const autoSaveFailedRef = useRef(false);
  /** True while a folder reconnect is in flight, so two never overlap. */
  const reconnectingRef = useRef(false);
  const identity = useMemo(() => ownerIdentity(), []);

  const idb = useCallback(() => {
    if (!idbRef.current) idbRef.current = new IndexedDbAdapter();
    return idbRef.current;
  }, []);

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  }, []);

  const notify = useCallback(
    (kind: 'ok' | 'error' | 'info', text: string) => {
      patch({ toast: { kind, text } });
      window.setTimeout(() => patch((s) => (s.toast?.text === text ? { toast: null } : {})), kind === 'error' ? 12000 : 5000);
    },
    [patch],
  );

  /** Mirror a file to the IndexedDB cache, best effort. */
  const mirror = useCallback(
    async (path: string, text: string) => {
      try {
        if (storeRef.current?.adapter.kind === 'filesystem') await idb().write(path, text);
      } catch {
        /* the mirror is a convenience only */
      }
    },
    [idb],
  );

  const openStore = useCallback(
    async (adapter: StorageAdapter, folderName: string | null) => {
      const store = new Store(adapter, identity);
      storeRef.current = store;
      patch({ status: 'loading', error: null, adapterKind: adapter.kind, storageLabel: adapter.describe(), folderName });
      try {
        const { data, problems } = await store.loadAll();
        const conflicts = adapter.kind === 'filesystem' ? await store.scanConflicts() : [];
        const lock = adapter.kind === 'filesystem' ? await store.acquireLock() : null;
        patch({ status: 'ready', data, problems, conflicts, lock, dirty: new Set() });
        if (adapter.kind === 'filesystem') {
          // Warm the cold start cache with what was just read.
          for (const key of Object.keys(FILES) as StoreFileKey[]) {
            const text = await adapter.read(FILES[key]);
            if (text !== null) await mirror(FILES[key], text);
          }
        }
      } catch (err) {
        patch({ status: 'error', error: (err as Error).message });
      }
    },
    [identity, patch, mirror],
  );

  const openHandle = useCallback(
    async (handle: FileSystemDirectoryHandle) => {
      handleRef.current = handle;
      await openStore(new FileSystemAdapter(new FsaDirectory(handle), `OneDrive folder "${handle.name}"`), handle.name);
    },
    [openStore],
  );

  // Boot: reconnect to the folder chosen last time.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (readMode() === 'browser') {
        await openStore(idb(), null);
        return;
      }
      if (!fsaSupported()) {
        patch({ status: 'no-folder', error: 'This browser cannot open folders, so the OneDrive folder is not available here. Use Edge or Chrome, and open the app through the local server rather than by double-clicking the HTML file.' });
        return;
      }
      try {
        const handle = await loadFolderHandle(idb());
        if (cancelled) return;
        if (!handle) {
          patch({ status: 'no-folder' });
          return;
        }
        handleRef.current = handle;
        let perm = await queryPermission(handle);
        /*
         * The folder was chosen once and is remembered; being asked to confirm it on
         * every launch is the browser's permission grant lapsing, not the app
         * forgetting. Where the person answered "Allow on every visit" the grant is
         * merely dormant, and asking for it back here revives it with no prompt at
         * all, so the app opens on the dashboard. Where it does not, this costs
         * nothing: requestPermission never throws, and the first click anywhere in
         * the window tries again (see the effect below).
         */
        if (perm !== 'granted') perm = await requestPermission(handle);
        if (cancelled) return;
        if (perm === 'granted') await openHandle(handle);
        else patch({ status: 'needs-permission', folderName: handle.name });
      } catch (err) {
        patch({ status: 'no-folder', error: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idb, openHandle, patch]);

  /*
   * Reconnect on the first thing the person does.
   *
   * Chromium will only hand the folder back inside a user gesture, and there is no
   * way around that from the page. What there is a way around is making them hunt
   * for a button first: any click or keypress in the window is a gesture, so the
   * reconnect rides on whatever they were going to do anyway. It runs once.
   */
  const grantRef = useRef<() => Promise<void>>(async () => undefined);
  useEffect(() => {
    if (state.status !== 'needs-permission' || !handleRef.current) return;
    const tryReconnect = () => void grantRef.current();
    const opts = { capture: true } as const;
    window.addEventListener('pointerdown', tryReconnect, opts);
    window.addEventListener('keydown', tryReconnect, opts);
    return () => {
      window.removeEventListener('pointerdown', tryReconnect, opts);
      window.removeEventListener('keydown', tryReconnect, opts);
    };
  }, [state.status]);

  // Refresh the advisory lock every minute while a folder is open.
  useEffect(() => {
    if (state.status !== 'ready' || state.adapterKind !== 'filesystem') return;
    const t = window.setInterval(() => storeRef.current?.refreshLock().catch(() => undefined), 60_000);
    const release = () => storeRef.current?.releaseLock().catch(() => undefined);
    window.addEventListener('pagehide', release);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('pagehide', release);
    };
  }, [state.status, state.adapterKind]);

  // Warn before closing with unsaved changes.
  useEffect(() => {
    if (state.dirty.size === 0) return;
    const on = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [state.dirty]);

  const chooseFolder = useCallback(async () => {
    try {
      const handle = await pickFolder();
      await saveFolderHandle(idb(), handle);
      writeMode(null);
      await openHandle(handle);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      patch({ error: (err as Error).message });
    }
  }, [idb, openHandle, patch]);

  /**
   * Ask for the folder back. The button and the first-gesture listener both land
   * here, and they can fire off the same click, so it is guarded: two overlapping
   * requests would mean two permission prompts and two opens of the same store.
   *
   * A refusal leaves the app where it is rather than dropping to the first-run
   * screen. The folder is still chosen and still remembered; only this attempt
   * failed, and offering "choose a folder" as the answer to that would invite
   * someone to re-link a folder they never unlinked.
   */
  const grantPermission = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return patch({ status: 'no-folder' });
    if (reconnectingRef.current) return;
    reconnectingRef.current = true;
    try {
      const perm = await requestPermission(handle);
      if (perm === 'granted') await openHandle(handle);
      else patch({ status: 'needs-permission', folderName: handle.name, error: 'The folder was not reopened. Click “Open” and choose Allow when the browser asks.' });
    } finally {
      reconnectingRef.current = false;
    }
  }, [openHandle, patch]);
  // The first-gesture listener is armed before this exists, so it reads it from a ref.
  grantRef.current = grantPermission;

  const useMemoryOnly = useCallback(() => {
    void openStore(new MemoryAdapter(), null);
  }, [openStore]);

  /**
   * Keep the data in this browser profile instead of a folder. Real persistence, but it
   * lives only on this machine and in this browser, so backups matter. Used when the
   * folder API is unavailable or the user declines it.
   */
  const useBrowserStorage = useCallback(async () => {
    writeMode('browser');
    await openStore(idb(), null);
  }, [idb, openStore]);

  const forgetFolder = useCallback(async () => {
    await storeRef.current?.releaseLock().catch(() => undefined);
    writeMode(null);
    await forgetFolderHandle(idb());
    handleRef.current = null;
    storeRef.current = null;
    patch({ ...initial, status: 'no-folder' });
  }, [idb, patch]);

  const reload = useCallback(async () => {
    if (handleRef.current) await openHandle(handleRef.current);
    else if (storeRef.current) await openStore(storeRef.current.adapter, null);
  }, [openHandle, openStore]);

  const update: DataUpdater = useCallback(
    (key, fn) => {
      // A fresh edit is a fresh chance for auto-save, even if the last write failed.
      autoSaveFailedRef.current = false;
      setState((s) => {
        const dirty = new Set(s.dirty);
        dirty.add(key);
        return { ...s, data: { ...s.data, [key]: fn(s.data[key]) }, dirty };
      });
    },
    [],
  );

  const save = useCallback(async (opts?: { silent?: boolean }) => {
    const store = storeRef.current;
    if (!store) return;
    autoSaveFailedRef.current = false;
    patch({ saving: true });
    const failed: string[] = [];
    const snapshot: StoreData = stateRef.current.data;
    const dirtyKeys: StoreFileKey[] = [...stateRef.current.dirty];
    for (const key of dirtyKeys) {
      try {
        await store.saveFile(key, snapshot[key]);
        await mirror(FILES[key], JSON.stringify(snapshot[key], null, 2));
        setState((s) => {
          const dirty = new Set(s.dirty);
          dirty.delete(key);
          return { ...s, dirty };
        });
      } catch (err) {
        failed.push(`${FILES[key]}: ${(err as Error).message}`);
      }
    }
    patch({ saving: false, lastSavedAt: failed.length ? null : new Date().toISOString() });
    if (failed.length) {
      // Stop auto-save retrying a write that just failed, or a folder that has gone
      // offline turns into an error toast every second until it comes back. The next
      // edit clears the flag and the attempt is made again.
      autoSaveFailedRef.current = true;
      notify('error', `Save failed. ${failed.join(' ')}`);
    } else if (dirtyKeys.length && !opts?.silent) {
      notify('ok', `Saved ${dirtyKeys.length} file${dirtyKeys.length === 1 ? '' : 's'} to ${store.adapter.describe()}.`);
    }
  }, [mirror, notify, patch]);

  const setAutoSave = useCallback((on: boolean) => {
    writeAutoSave(on);
    autoSaveFailedRef.current = false;
    patch({ autoSave: on });
  }, [patch]);

  // Auto-save: write out shortly after the edits stop. Memory-only storage has nowhere
  // to write, and a folder another machine holds is left to the person to resolve.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    if (!state.autoSave || state.status !== 'ready' || state.saving) return;
    if (state.dirty.size === 0 || autoSaveFailedRef.current) return;
    if (state.adapterKind === null || state.adapterKind === 'memory') return;
    const t = window.setTimeout(() => void saveRef.current({ silent: true }), AUTOSAVE_DELAY);
    return () => window.clearTimeout(t);
  }, [state.autoSave, state.status, state.saving, state.dirty, state.adapterKind]);

  const commitImport = useCallback(
    async (kind: ImportKind, activities: P6Activity[], sourceFilename: string) => {
      const store = storeRef.current;
      if (!store) throw new Error('No storage open');
      const imp: ScheduleImport = {
        id: importStamp(),
        kind,
        importedAt: new Date().toISOString(),
        sourceFilename,
        rowCount: activities.length,
        activities,
      };
      const cur = stateRef.current.data;
      const { index } = await store.appendImport(imp, cur.importsIndex);
      await mirror(FILES.importsIndex, JSON.stringify(index, null, 2));
      let locations = cur.locations;
      let library = cur.library;
      if (kind === 'current') {
        locations = discoverLocations(activities, cur.locations);
        library = discoverLibrary(activities, cur.library);
        if (locations !== cur.locations) {
          await store.saveFile('locations', locations);
          await mirror(FILES.locations, JSON.stringify(locations, null, 2));
        }
        await store.saveFile('library', library);
        await mirror(FILES.library, JSON.stringify(library, null, 2));
      }
      setState((s) => {
        const dirty = new Set(s.dirty);
        dirty.delete('importsIndex');
        if (kind === 'current') {
          dirty.delete('locations');
          dirty.delete('library');
        }
        return { ...s, dirty, data: { ...s.data, importsIndex: index, locations, library, [kind]: imp } };
      });
      notify('ok', `${kind === 'current' ? 'Current' : 'Baseline'} schedule imported: ${activities.length} rows.`);
    },
    [mirror, notify],
  );

  const readImport = useCallback(async (entry: ImportIndexEntry) => storeRef.current?.readImport(entry.file) ?? null, []);

  /**
   * Take a schedule import back out.
   *
   * The file goes, its index row goes, and whichever import of that kind is newest
   * among the survivors becomes the one in use — so removing a bad import returns
   * the app to the previous one rather than to nothing, and removing the last of a
   * kind clears it properly (no baseline is a valid state; the planned curve then
   * mirrors the forecast and the app says so).
   *
   * Everything the user keyed is out of reach by construction. Overrides, progress,
   * missed reasons, the activity library, locations, subsystems and team actuals
   * each live in their own file keyed on the Activity ID, and none of them is read
   * or written here. An edit whose activity is no longer in any schedule is not
   * deleted either — it sits idle and is listed as a stale override, exactly as it
   * would be if P6 had renumbered the activity.
   */
  const removeImport = useCallback(
    async (entry: ImportIndexEntry) => {
      const store = storeRef.current;
      if (!store) throw new Error('No storage open');
      const index = await store.removeImport(entry.file, stateRef.current.data.importsIndex);
      await mirror(FILES.importsIndex, JSON.stringify(index, null, 2));

      // Whichever of that kind is newest now takes over. Read it here rather than
      // reloading the whole folder, so unsaved edits on other screens survive.
      const latest = [...index]
        .filter((i) => i.kind === entry.kind)
        .sort((x, y) => x.importedAt.localeCompare(y.importedAt))
        .pop();
      const replacement = latest ? await store.readImport(latest.file) : null;

      setState((s) => {
        const dirty = new Set(s.dirty);
        dirty.delete('importsIndex');
        return { ...s, dirty, data: { ...s.data, importsIndex: index, [entry.kind]: replacement } };
      });
      notify(
        'ok',
        replacement
          ? `${entry.file} removed. The ${entry.kind} schedule is now ${replacement.sourceFilename}.`
          : `${entry.file} removed. There is no ${entry.kind} schedule now. Nothing you keyed was touched.`,
      );
    },
    [mirror, notify],
  );

  const exportBundle = useCallback((): Bundle => ({ kind: 'tc-budget-backup', version: 1, createdAt: new Date().toISOString(), data: stateRef.current.data }), []);

  /**
   * Restore a backup over the current store. Settings, library, locations, overrides and
   * progress are replaced; the schedules in the backup are appended as new imports, so
   * the append-only import history is never rewritten.
   */
  const restoreBundle = useCallback(async (bundle: Bundle) => {
    const store = storeRef.current;
    if (!store) throw new Error('No storage open');
    if (bundle?.kind !== 'tc-budget-backup') throw new Error('That file is not a T&C Budget backup.');
    const b = bundle.data;
    // A backup taken before subsystems existed has neither key. Default them so a
    // restore from an old file does not write "undefined" over a newer store.
    for (const key of ['settings', 'locations', 'library', 'overrides', 'testProgress', 'subsystems', 'teamActuals', 'idRules'] as const) {
      await store.saveFile(key, b[key] ?? (key === 'settings' ? b.settings : []));
    }
    // Its own line: unlike every other file this one is an object, so the empty
    // fallback above would write a bare array over it for a backup taken before
    // missed reasons existed.
    await store.saveFile('missedReasons', b.missedReasons ?? { reasons: [], entries: [] });
    let index = stateRef.current.data.importsIndex;
    for (const kind of ['current', 'baseline'] as const) {
      const imp = b[kind];
      if (!imp) continue;
      const res = await store.appendImport({ ...imp, id: importStamp(), importedAt: new Date().toISOString(), sourceFilename: `restored from backup (${imp.sourceFilename})` }, index);
      index = res.index;
    }
    await reload();
    notify('ok', 'Backup restored.');
  }, [notify, reload]);

  const restoreImport = useCallback(
    async (entry: ImportIndexEntry) => {
      const imp = await readImport(entry);
      if (!imp) throw new Error(`Import file ${entry.file} could not be read`);
      await commitImport(entry.kind, imp.activities, `restored from ${entry.file}`);
    },
    [commitImport, readImport],
  );

  /*
   * The model in two stages, because its halves change at different times.
   *
   * `computeBase` is the schedule: a thousand rows priced, dated, rolled up and
   * plotted. `attachBurn` is the timesheets laid against it. Keying a month of team
   * hours cannot move an activity or bend a curve, and the screen where people
   * paste team hours is the one that would otherwise pay for a full rebuild on
   * every paste. Each stage depends on exactly the store files it reads, so an edit
   * to one leaves the other's work alone.
   */
  const d = state.data;
  const base = useMemo<ModelBase>(
    () =>
      computeBase({
        settings: d.settings,
        locations: d.locations,
        library: d.library,
        overrides: d.overrides,
        testProgress: d.testProgress,
        subsystems: d.subsystems,
        idRules: d.idRules,
        current: d.current?.activities ?? [],
        baseline: d.baseline?.activities ?? null,
      }),
    [d.settings, d.locations, d.library, d.overrides, d.testProgress, d.subsystems, d.idRules, d.current, d.baseline],
  );
  const model = useMemo<Model>(() => attachBurn(base, d.teamActuals), [base, d.teamActuals]);

  const writeExport = useCallback(async (name: string, bytes: Uint8Array) => {
    const store = storeRef.current;
    if (!store) throw new Error('No storage open');
    return store.writeExport(name, bytes);
  }, []);

  const listFolderFiles = useCallback(async () => {
    const a = storeRef.current?.adapter;
    if (!a) return [];
    const root = await a.list('');
    const exports = await a.list('exports').catch(() => [] as string[]);
    return [...root, ...exports].filter((p) => /\.(xer|xlsx|xlsm|xls|csv|tsv|txt)$/i.test(p));
  }, []);

  const readFolderFile = useCallback(async (path: string) => storeRef.current?.adapter.read(path) ?? null, []);
  const readFolderBinary = useCallback(async (path: string) => storeRef.current?.adapter.readBinary(path) ?? null, []);

  const actions = useMemo<AppActions>(
    () => ({ chooseFolder, useBrowserStorage, exportBundle, restoreBundle, grantPermission, useMemoryOnly, forgetFolder, reload, save, setAutoSave, update, commitImport, restoreImport, readImport, removeImport, writeExport, listFolderFiles, readFolderFile, readFolderBinary, notify }),
    [chooseFolder, useBrowserStorage, exportBundle, restoreBundle, grantPermission, useMemoryOnly, forgetFolder, reload, save, setAutoSave, update, commitImport, restoreImport, readImport, removeImport, writeExport, listFolderFiles, readFolderFile, readFolderBinary, notify],
  );

  return <AppContext.Provider value={{ state, model, actions }}>{children}</AppContext.Provider>;
}

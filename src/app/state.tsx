import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Model, ModelInput, ScheduleImport, ImportKind, ImportIndexEntry, Snapshot, P6Activity } from '../engine/types';
import { computeModel, buildSnapshot } from '../engine/compute';
import { discoverLibrary, discoverLocations } from '../engine/discover';
import type { StorageAdapter } from '../storage/adapter';
import { FileSystemAdapter } from '../storage/fileSystemAdapter';
import { FsaDirectory } from '../storage/fsaDirectory';
import { IndexedDbAdapter } from '../storage/indexedDbAdapter';
import { MemoryAdapter } from '../storage/memoryAdapter';
import { Store, emptyStoreData, importStamp, FILES, type StoreData, type StoreFileKey, type ConflictCopy, type LockStatus } from '../storage/store';
import { fsaSupported, loadFolderHandle, saveFolderHandle, forgetFolderHandle, pickFolder, queryPermission, requestPermission, ownerIdentity } from './folder';

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
  toast: { kind: 'ok' | 'error' | 'info'; text: string } | null;
};

export type DataUpdater = <K extends StoreFileKey>(key: K, fn: (prev: StoreData[K]) => StoreData[K]) => void;

export type AppActions = {
  chooseFolder(): Promise<void>;
  grantPermission(): Promise<void>;
  useMemoryOnly(): void;
  forgetFolder(): Promise<void>;
  reload(): Promise<void>;
  save(): Promise<void>;
  update: DataUpdater;
  commitImport(kind: ImportKind, activities: P6Activity[], sourceFilename: string): Promise<void>;
  restoreImport(entry: ImportIndexEntry): Promise<void>;
  readImport(entry: ImportIndexEntry): Promise<ScheduleImport | null>;
  takeSnapshot(statusDate: string, note?: string): Promise<void>;
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
  toast: null,
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(initial);
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;
  const storeRef = useRef<Store | null>(null);
  const idbRef = useRef<IndexedDbAdapter | null>(null);
  const handleRef = useRef<FileSystemDirectoryHandle | null>(null);
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
      if (!fsaSupported()) {
        patch({ status: 'no-folder', error: 'This browser does not support opening folders. Use Edge or Chrome at http://localhost.' });
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
        const perm = await queryPermission(handle);
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
      await openHandle(handle);
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return;
      patch({ error: (err as Error).message });
    }
  }, [idb, openHandle, patch]);

  const grantPermission = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return patch({ status: 'no-folder' });
    const perm = await requestPermission(handle);
    if (perm === 'granted') await openHandle(handle);
    else patch({ status: 'no-folder', error: 'Permission to the folder was refused.' });
  }, [openHandle, patch]);

  const useMemoryOnly = useCallback(() => {
    void openStore(new MemoryAdapter(), null);
  }, [openStore]);

  const forgetFolder = useCallback(async () => {
    await storeRef.current?.releaseLock().catch(() => undefined);
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
      setState((s) => {
        const dirty = new Set(s.dirty);
        dirty.add(key);
        return { ...s, data: { ...s.data, [key]: fn(s.data[key]) }, dirty };
      });
    },
    [],
  );

  const save = useCallback(async () => {
    const store = storeRef.current;
    if (!store) return;
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
    if (failed.length) notify('error', `Save failed. ${failed.join(' ')}`);
    else if (dirtyKeys.length) notify('ok', `Saved ${dirtyKeys.length} file${dirtyKeys.length === 1 ? '' : 's'} to ${store.adapter.describe()}.`);
  }, [mirror, notify, patch]);

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

  const restoreImport = useCallback(
    async (entry: ImportIndexEntry) => {
      const imp = await readImport(entry);
      if (!imp) throw new Error(`Import file ${entry.file} could not be read`);
      await commitImport(entry.kind, imp.activities, `restored from ${entry.file}`);
    },
    [commitImport, readImport],
  );

  const model = useMemo<Model>(() => {
    const d = state.data;
    const input: ModelInput = {
      settings: d.settings,
      locations: d.locations,
      library: d.library,
      overrides: d.overrides,
      testProgress: d.testProgress,
      current: d.current?.activities ?? [],
      baseline: d.baseline?.activities ?? null,
      snapshots: d.snapshots,
    };
    return computeModel(input);
  }, [state.data]);

  const takeSnapshot = useCallback(
    async (statusDate: string, note?: string) => {
      const store = storeRef.current;
      if (!store) throw new Error('No storage open');
      const snap: Snapshot = buildSnapshot(model, statusDate, note);
      await store.appendSnapshot(snap);
      setState((s) => ({ ...s, data: { ...s.data, snapshots: [...s.data.snapshots, snap] } }));
      notify('ok', `Snapshot for ${statusDate} written (${snap.lines.length} lines).`);
    },
    [model, notify],
  );

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
    return [...root, ...exports].filter((p) => /\.(xlsx|csv|tsv|txt)$/i.test(p));
  }, []);

  const readFolderFile = useCallback(async (path: string) => storeRef.current?.adapter.read(path) ?? null, []);
  const readFolderBinary = useCallback(async (path: string) => storeRef.current?.adapter.readBinary(path) ?? null, []);

  const actions = useMemo<AppActions>(
    () => ({ chooseFolder, grantPermission, useMemoryOnly, forgetFolder, reload, save, update, commitImport, restoreImport, readImport, takeSnapshot, writeExport, listFolderFiles, readFolderFile, readFolderBinary, notify }),
    [chooseFolder, grantPermission, useMemoryOnly, forgetFolder, reload, save, update, commitImport, restoreImport, readImport, takeSnapshot, writeExport, listFolderFiles, readFolderFile, readFolderBinary, notify],
  );

  return <AppContext.Provider value={{ state, model, actions }}>{children}</AppContext.Provider>;
}

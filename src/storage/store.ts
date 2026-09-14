import type {
  ActivityOverride,
  ImportIndexEntry,
  LibraryEntry,
  Location,
  ScheduleImport,
  Settings,
  Snapshot,
  TestProgress,
} from '../engine/types';
import { DEFAULT_SETTINGS } from '../engine/types';
import type { StorageAdapter } from './adapter';
import { StorageError } from './adapter';

/** The JSON files in the store, by logical name. */
export const FILES = {
  settings: 'settings.json',
  locations: 'locations.json',
  library: 'activity-library.json',
  overrides: 'activity-overrides.json',
  testProgress: 'test-progress.json',
  importsIndex: 'imports/index.json',
} as const;

export type StoreFileKey = keyof typeof FILES;
export const SNAPSHOT_DIR = 'snapshots';
export const IMPORT_DIR = 'imports';
export const EXPORT_DIR = 'exports';
export const LOCK_FILE = '.lock';
export const LOCK_STALE_MS = 5 * 60 * 1000;

export type StoreData = {
  settings: Settings;
  locations: Location[];
  library: LibraryEntry[];
  overrides: ActivityOverride[];
  testProgress: TestProgress[];
  importsIndex: ImportIndexEntry[];
  snapshots: Snapshot[];
  current: ScheduleImport | null;
  baseline: ScheduleImport | null;
};

export type ConflictCopy = { path: string; of: string };
export type LockInfo = { owner: string; label: string; takenAt: string; refreshedAt: string };
export type LockStatus = { held: boolean; foreign: LockInfo | null };

export function emptyStoreData(): StoreData {
  return {
    settings: { ...DEFAULT_SETTINGS },
    locations: [],
    library: [],
    overrides: [],
    testProgress: [],
    importsIndex: [],
    snapshots: [],
    current: null,
    baseline: null,
  };
}

function parseJson<T>(text: string | null, fallback: T, path: string, problems: string[]): T {
  if (text === null || text.trim() === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    problems.push(`${path} is not valid JSON and was ignored (${(err as Error).message}). Restore it from OneDrive version history.`);
    return fallback;
  }
}

/** Timestamp for import file names: 2026-09-14T0930. */
export function importStamp(d = new Date()): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const CANONICAL: RegExp[] = [
  /^settings\.json$/,
  /^locations\.json$/,
  /^activity-library\.json$/,
  /^activity-overrides\.json$/,
  /^test-progress\.json$/,
  /^\.lock$/,
];
const STEMS = ['settings', 'locations', 'activity-library', 'activity-overrides', 'test-progress'];
const CANONICAL_IMPORT = /^(index|\d{4}-\d{2}-\d{2}T\d{4,6}-(current|baseline))\.json$/;
const CANONICAL_SNAPSHOT = /^\d{4}-\d{2}-\d{2}(-\d+)?\.json$/;

/**
 * A OneDrive conflict copy is "name-MACHINE.json", "name-MACHINE-1.json" or "name (1).json".
 * Anything in the store that is not a canonical file name, a temp file, or an export
 * is reported. Nothing is ever merged automatically.
 */
export function classifyConflict(path: string): ConflictCopy | null {
  const parts = path.split('/');
  const name = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join('/');
  if (name.endsWith('.tmp')) return null;
  if (!name.toLowerCase().endsWith('.json') && name !== LOCK_FILE) return null;
  if (dir === '') {
    if (CANONICAL.some((r) => r.test(name))) return null;
    const stem = STEMS.filter((s) => name.toLowerCase().startsWith(s)).sort((a, b) => b.length - a.length)[0];
    const base = stem ? `${stem}.json` : name.replace(/(-[^-.]+(-\d+)?| \(\d+\))\.json$/i, '.json');
    return { path, of: base };
  }
  if (dir === IMPORT_DIR) {
    if (CANONICAL_IMPORT.test(name)) return null;
    return { path, of: `${IMPORT_DIR}/${name.replace(/(-[^-.]+(-\d+)?| \(\d+\))\.json$/i, '.json')}` };
  }
  if (dir === SNAPSHOT_DIR) {
    if (CANONICAL_SNAPSHOT.test(name)) return null;
    return { path, of: `${SNAPSHOT_DIR}/${name.replace(/(-[^-.]+(-\d+)?| \(\d+\))\.json$/i, '.json')}` };
  }
  return null;
}

/**
 * Domain-level store: knows the file layout, reads everything into memory once, writes
 * on explicit save, appends imports, scans for conflict copies, and manages the
 * advisory lock file.
 */
export class Store {
  constructor(
    public readonly adapter: StorageAdapter,
    private readonly owner: { id: string; label: string },
  ) {}

  /** Read every file. A missing or empty folder initialises cleanly with defaults. */
  async loadAll(): Promise<{ data: StoreData; problems: string[] }> {
    const problems: string[] = [];
    const a = this.adapter;
    const data = emptyStoreData();
    const settings = parseJson<Partial<Settings>>(await a.read(FILES.settings), {}, FILES.settings, problems);
    data.settings = { ...DEFAULT_SETTINGS, ...settings };
    data.locations = parseJson<Location[]>(await a.read(FILES.locations), [], FILES.locations, problems);
    data.library = parseJson<LibraryEntry[]>(await a.read(FILES.library), [], FILES.library, problems);
    data.overrides = parseJson<ActivityOverride[]>(await a.read(FILES.overrides), [], FILES.overrides, problems);
    data.testProgress = parseJson<TestProgress[]>(await a.read(FILES.testProgress), [], FILES.testProgress, problems);
    data.importsIndex = parseJson<ImportIndexEntry[]>(await a.read(FILES.importsIndex), [], FILES.importsIndex, problems);
    for (const kind of ['current', 'baseline'] as const) {
      const latest = [...data.importsIndex].filter((i) => i.kind === kind).sort((x, y) => x.importedAt.localeCompare(y.importedAt)).pop();
      if (!latest) continue;
      const imp = parseJson<ScheduleImport | null>(await a.read(latest.file), null, latest.file, problems);
      if (imp) data[kind] = imp;
      else problems.push(`The latest ${kind} import (${latest.file}) is missing. Re-import or restore it from OneDrive.`);
    }
    const snapFiles = (await a.list(SNAPSHOT_DIR)).filter((p) => classifyConflict(p) === null && p.endsWith('.json'));
    for (const f of snapFiles.sort()) {
      const s = parseJson<Snapshot | null>(await a.read(f), null, f, problems);
      if (s) data.snapshots.push(s);
    }
    data.snapshots.sort((x, y) => x.statusDate.localeCompare(y.statusDate) || x.takenAt.localeCompare(y.takenAt));
    return { data, problems };
  }

  async saveFile(key: StoreFileKey, value: unknown): Promise<void> {
    await this.adapter.write(FILES[key], JSON.stringify(value, null, 2));
  }

  /** Imports are append only: a new timestamped file plus a row in the index. */
  async appendImport(imp: ScheduleImport, index: ImportIndexEntry[]): Promise<{ entry: ImportIndexEntry; index: ImportIndexEntry[] }> {
    let file = `${IMPORT_DIR}/${imp.id}-${imp.kind}.json`;
    let n = 1;
    while (await this.adapter.exists(file)) file = `${IMPORT_DIR}/${imp.id}-${n++}-${imp.kind}.json`;
    await this.adapter.write(file, JSON.stringify(imp));
    const { activities: _drop, ...meta } = imp;
    void _drop;
    const entry: ImportIndexEntry = { ...meta, file };
    const next = [...index, entry];
    await this.saveFile('importsIndex', next);
    return { entry, index: next };
  }

  async readImport(file: string): Promise<ScheduleImport | null> {
    const text = await this.adapter.read(file);
    return text ? (JSON.parse(text) as ScheduleImport) : null;
  }

  /** Snapshots are insert only. */
  async appendSnapshot(snap: Snapshot): Promise<string> {
    let file = `${SNAPSHOT_DIR}/${snap.statusDate}.json`;
    let n = 1;
    while (await this.adapter.exists(file)) file = `${SNAPSHOT_DIR}/${snap.statusDate}-${n++}.json`;
    await this.adapter.write(file, JSON.stringify(snap, null, 2));
    return file;
  }

  async writeExport(name: string, bytes: Uint8Array): Promise<string> {
    const path = `${EXPORT_DIR}/${name}`;
    await this.adapter.writeBinary(path, bytes);
    return path;
  }

  async scanConflicts(): Promise<ConflictCopy[]> {
    const out: ConflictCopy[] = [];
    for (const dir of ['', IMPORT_DIR, SNAPSHOT_DIR]) {
      for (const p of await this.adapter.list(dir)) {
        const c = classifyConflict(p);
        if (c) out.push(c);
      }
    }
    return out;
  }

  // Advisory single-writer lock. Never enforced, only warned about.
  async readLock(): Promise<LockInfo | null> {
    const text = await this.adapter.read(LOCK_FILE);
    if (!text) return null;
    try {
      return JSON.parse(text) as LockInfo;
    } catch {
      return null;
    }
  }

  async acquireLock(now = new Date()): Promise<LockStatus> {
    const existing = await this.readLock();
    let foreign: LockInfo | null = null;
    if (existing && existing.owner !== this.owner.id) {
      const age = now.getTime() - Date.parse(existing.refreshedAt || existing.takenAt);
      if (Number.isFinite(age) && age < LOCK_STALE_MS) foreign = existing;
    }
    const info: LockInfo = {
      owner: this.owner.id,
      label: this.owner.label,
      takenAt: existing && existing.owner === this.owner.id ? existing.takenAt : now.toISOString(),
      refreshedAt: now.toISOString(),
    };
    try {
      await this.adapter.write(LOCK_FILE, JSON.stringify(info, null, 2));
    } catch (err) {
      // A lock we cannot write is not worth blocking on.
      if (!(err instanceof StorageError)) throw err;
    }
    return { held: true, foreign };
  }

  async refreshLock(now = new Date()): Promise<void> {
    const existing = await this.readLock();
    if (existing && existing.owner !== this.owner.id) return; // someone else took over; do not clobber
    await this.adapter.write(
      LOCK_FILE,
      JSON.stringify({ owner: this.owner.id, label: this.owner.label, takenAt: existing?.takenAt ?? now.toISOString(), refreshedAt: now.toISOString() }, null, 2),
    );
  }

  async releaseLock(): Promise<void> {
    const existing = await this.readLock();
    if (existing && existing.owner === this.owner.id) await this.adapter.remove(LOCK_FILE);
  }
}

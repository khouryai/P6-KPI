import type { StorageAdapter } from './adapter';

const DB_NAME = 'tc-budget';
const DB_VERSION = 1;
const FILES = 'files';
const META = 'meta';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * In-browser mirror and cold start cache. Every successful save to the folder is also
 * written here, so the app can open instantly and show the last known state while the
 * OneDrive folder is being read (or is unavailable).
 */
export class IndexedDbAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  private dbp: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) this.dbp = openDb();
    return this.dbp;
  }

  describe(): string {
    return 'browser cache (IndexedDB)';
  }

  async list(prefix = ''): Promise<string[]> {
    const db = await this.db();
    const keys = (await tx(db, FILES, 'readonly', (s) => s.getAllKeys())) as string[];
    const p = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
    return keys.filter((k) => k.startsWith(p) && !k.slice(p.length).includes('/'));
  }

  async read(path: string): Promise<string | null> {
    const db = await this.db();
    const v = (await tx(db, FILES, 'readonly', (s) => s.get(path))) as string | Uint8Array | undefined;
    if (v === undefined) return null;
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    const db = await this.db();
    const v = (await tx(db, FILES, 'readonly', (s) => s.get(path))) as string | Uint8Array | undefined;
    if (v === undefined) return null;
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  }

  async write(path: string, text: string): Promise<void> {
    const db = await this.db();
    await tx(db, FILES, 'readwrite', (s) => s.put(text, path));
  }

  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    const db = await this.db();
    await tx(db, FILES, 'readwrite', (s) => s.put(bytes, path));
  }

  async remove(path: string): Promise<void> {
    const db = await this.db();
    await tx(db, FILES, 'readwrite', (s) => s.delete(path));
  }

  async exists(path: string): Promise<boolean> {
    return (await this.read(path)) !== null;
  }

  async clear(): Promise<void> {
    const db = await this.db();
    await tx(db, FILES, 'readwrite', (s) => s.clear());
  }

  // Metadata (the folder handle, which structured-clones into IndexedDB).
  async getMeta<T>(key: string): Promise<T | undefined> {
    const db = await this.db();
    return (await tx(db, META, 'readonly', (s) => s.get(key))) as T | undefined;
  }

  async setMeta(key: string, value: unknown): Promise<void> {
    const db = await this.db();
    await tx(db, META, 'readwrite', (s) => s.put(value, key));
  }

  async deleteMeta(key: string): Promise<void> {
    const db = await this.db();
    await tx(db, META, 'readwrite', (s) => s.delete(key));
  }
}

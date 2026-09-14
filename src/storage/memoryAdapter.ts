import type { StorageAdapter } from './adapter';

/** In-memory adapter for tests and for the app before a folder is chosen. */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  readonly files = new Map<string, string | Uint8Array>();

  describe(): string {
    return 'memory (nothing is saved to disk)';
  }

  async list(prefix = ''): Promise<string[]> {
    const p = prefix ? `${prefix.replace(/\/$/, '')}/` : '';
    return [...this.files.keys()].filter((k) => k.startsWith(p) && !k.slice(p.length).includes('/'));
  }

  async read(path: string): Promise<string | null> {
    const v = this.files.get(path);
    if (v === undefined) return null;
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }

  async readBinary(path: string): Promise<Uint8Array | null> {
    const v = this.files.get(path);
    if (v === undefined) return null;
    return typeof v === 'string' ? new TextEncoder().encode(v) : v;
  }

  async write(path: string, text: string): Promise<void> {
    this.files.set(path, text);
  }

  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }
}

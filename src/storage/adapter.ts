/**
 * All persistence goes through this interface. Paths are relative to the store root,
 * forward-slash separated ("imports/2026-09-14T0930-current.json").
 *
 * Adapters store text (JSON) and bytes (exports). Every write must be atomic from the
 * reader's point of view: either the previous content or the new content is visible,
 * never a partial file.
 */
export type AdapterKind = 'filesystem' | 'indexeddb' | 'memory';

export interface StorageAdapter {
  readonly kind: AdapterKind;
  /** A human readable description of where the data lives. */
  describe(): string;
  /** List file paths under a prefix (directory), non-recursive. */
  list(prefix?: string): Promise<string[]>;
  /** Read a text file. Returns null when it does not exist. */
  read(path: string): Promise<string | null>;
  /** Write a text file atomically, creating directories as needed. */
  write(path: string, text: string): Promise<void>;
  /** Write a binary file (exports). */
  writeBinary(path: string, bytes: Uint8Array): Promise<void>;
  /** Remove a file. Missing files are not an error. */
  remove(path: string): Promise<void>;
  /** True when the file exists. */
  exists(path: string): Promise<boolean>;
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: 'LOCKED' | 'OFFLINE' | 'PERMISSION' | 'NOT_FOUND' | 'IO',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export function splitPath(path: string): { dir: string[]; name: string } {
  const parts = path.split('/').filter((p) => p !== '');
  const name = parts.pop() ?? '';
  return { dir: parts, name };
}

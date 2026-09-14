import type { StorageAdapter } from './adapter';
import { StorageError } from './adapter';
import type { Directory } from './directory';

export type RetryOptions = { attempts: number; baseDelayMs: number; sleep?: (ms: number) => Promise<void> };

const DEFAULT_RETRY: RetryOptions = { attempts: 5, baseDelayMs: 200 };

/**
 * Primary adapter. Works over any Directory (File System Access in the browser, Node in
 * tests) and adds the rules a OneDrive folder needs:
 *
 * - Atomic writes: write `name.tmp` beside the target, then rename over it. A crash or
 *   sync mid-write leaves the previous file intact.
 * - Retry with backoff: OneDrive briefly locks files while uploading. Each step is
 *   retried; if it keeps failing the error is surfaced rather than the edit lost.
 */
export class FileSystemAdapter implements StorageAdapter {
  readonly kind = 'filesystem' as const;
  private readonly retry: RetryOptions;

  constructor(
    private readonly dir: Directory,
    private readonly label = 'storage folder',
    retry: Partial<RetryOptions> = {},
  ) {
    this.retry = { ...DEFAULT_RETRY, ...retry };
  }

  describe(): string {
    return this.label;
  }

  private async withRetry<T>(what: string, fn: () => Promise<T>): Promise<T> {
    const sleep = this.retry.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    let last: unknown;
    for (let i = 0; i < this.retry.attempts; i++) {
      try {
        return await fn();
      } catch (err) {
        last = err;
        if (err instanceof StorageError && (err.code === 'PERMISSION' || err.code === 'NOT_FOUND')) throw err;
        if (i < this.retry.attempts - 1) await sleep(this.retry.baseDelayMs * 2 ** i);
      }
    }
    const msg = last instanceof Error ? last.message : String(last);
    throw new StorageError(
      `Could not ${what} after ${this.retry.attempts} attempts. OneDrive may be holding the file. Your changes are still in the application; try Save again in a moment. (${msg})`,
      last instanceof StorageError ? last.code : 'IO',
      last,
    );
  }

  async list(prefix = ''): Promise<string[]> {
    const entries = await this.withRetry(`list ${prefix || 'folder'}`, () => this.dir.list(prefix));
    return entries.filter((e) => e.kind === 'file').map((e) => (prefix ? `${prefix}/${e.name}` : e.name));
  }

  read(path: string): Promise<string | null> {
    return this.withRetry(`read ${path}`, () => this.dir.readText(path));
  }

  async write(path: string, text: string): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.withRetry(`write ${path}`, async () => {
      await this.dir.writeText(tmp, text);
      // Verify the temp file is complete before it replaces the target.
      const check = await this.dir.readText(tmp);
      if (check !== text) throw new StorageError(`Temp file for ${path} was not written completely`, 'IO');
      await this.dir.rename(tmp, path);
    });
  }

  async writeBinary(path: string, bytes: Uint8Array): Promise<void> {
    const tmp = `${path}.tmp`;
    await this.withRetry(`write ${path}`, async () => {
      await this.dir.writeBytes(tmp, bytes);
      await this.dir.rename(tmp, path);
    });
  }

  remove(path: string): Promise<void> {
    return this.withRetry(`remove ${path}`, () => this.dir.remove(path));
  }

  exists(path: string): Promise<boolean> {
    return this.dir.exists(path);
  }
}

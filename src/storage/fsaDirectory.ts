import type { Directory, DirEntry } from './directory';
import { StorageError, splitPath } from './adapter';

type HandleWithMove = FileSystemFileHandle & { move?: (name: string) => Promise<void> };

/**
 * File System Access API implementation of Directory over a directory handle the user
 * granted once. Requires a secure context, which localhost satisfies and file:// does not.
 *
 * OneDrive Files On-Demand: a file may be a cloud placeholder that is not downloaded
 * yet. Reading it can be slow or fail offline. Errors are wrapped with a message that
 * tells the user to mark the folder "Always keep on this device".
 */
export class FsaDirectory implements Directory {
  constructor(public readonly root: FileSystemDirectoryHandle) {}

  private async dirHandle(parts: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let h = this.root;
    for (const p of parts) h = await h.getDirectoryHandle(p, { create });
    return h;
  }

  async list(dir = ''): Promise<DirEntry[]> {
    const parts = dir.split('/').filter(Boolean);
    let h: FileSystemDirectoryHandle;
    try {
      h = await this.dirHandle(parts, false);
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return [];
      throw wrap(err, `list ${dir || '/'}`);
    }
    const out: DirEntry[] = [];
    // `entries()` is on the async-iterable directory handle in Chromium.
    const iter = (h as unknown as { entries: () => AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const [name, handle] of iter) out.push({ name, kind: handle.kind });
    return out;
  }

  async readText(path: string): Promise<string | null> {
    const { dir, name } = splitPath(path);
    try {
      const d = await this.dirHandle(dir, false);
      const fh = await d.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return await file.text();
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return null;
      throw wrap(err, `read ${path}`);
    }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    const { dir, name } = splitPath(path);
    try {
      const d = await this.dirHandle(dir, false);
      const fh = await d.getFileHandle(name, { create: false });
      const file = await fh.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return null;
      throw wrap(err, `read ${path}`);
    }
  }

  private async writeAny(path: string, data: string | Uint8Array): Promise<void> {
    const { dir, name } = splitPath(path);
    try {
      const d = await this.dirHandle(dir, true);
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable({ keepExistingData: false });
      await w.write(data as unknown as BufferSource);
      await w.close();
    } catch (err) {
      throw wrap(err, `write ${path}`);
    }
  }

  writeText(path: string, text: string): Promise<void> {
    return this.writeAny(path, text);
  }

  writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    return this.writeAny(path, bytes);
  }

  /**
   * Rename within one directory. Chromium exposes FileSystemFileHandle.move(); where it is
   * missing the fallback copies the temp file over the target and removes the temp, which
   * is not atomic but is the best the platform offers.
   */
  async rename(from: string, to: string): Promise<void> {
    const a = splitPath(from);
    const b = splitPath(to);
    try {
      const d = await this.dirHandle(a.dir, false);
      const fh = (await d.getFileHandle(a.name, { create: false })) as HandleWithMove;
      if (typeof fh.move === 'function') {
        // move() refuses to overwrite in some builds; remove the target first. The temp
        // file already holds the full new content, so the window with no target is tiny
        // and recoverable (the .tmp is complete).
        await d.removeEntry(b.name).catch(() => undefined);
        await fh.move(b.name);
        return;
      }
      const file = await fh.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      await this.writeAny(to, bytes);
      await d.removeEntry(a.name).catch(() => undefined);
    } catch (err) {
      throw wrap(err, `rename ${from} -> ${to}`);
    }
  }

  async remove(path: string): Promise<void> {
    const { dir, name } = splitPath(path);
    try {
      const d = await this.dirHandle(dir, false);
      await d.removeEntry(name);
    } catch (err) {
      if ((err as DOMException).name === 'NotFoundError') return;
      throw wrap(err, `remove ${path}`);
    }
  }

  async exists(path: string): Promise<boolean> {
    const { dir, name } = splitPath(path);
    try {
      const d = await this.dirHandle(dir, false);
      await d.getFileHandle(name, { create: false });
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dir: string): Promise<void> {
    await this.dirHandle(dir.split('/').filter(Boolean), true);
  }
}

function wrap(err: unknown, what: string): StorageError {
  const name = (err as DOMException)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return new StorageError(`Permission to the storage folder was not granted (${what}). Re-select the folder in Settings.`, 'PERMISSION', err);
  }
  if (name === 'NotReadableError' || name === 'NetworkError') {
    return new StorageError(
      `Could not ${what}. The file may be a OneDrive cloud placeholder that is not downloaded. Right-click the TC-Budget folder in Explorer and choose "Always keep on this device", then retry.`,
      'OFFLINE',
      err,
    );
  }
  if (name === 'NoModificationAllowedError' || name === 'InvalidStateError') {
    return new StorageError(`The file is locked, probably by OneDrive while it uploads (${what}).`, 'LOCKED', err);
  }
  return new StorageError(`Could not ${what}: ${(err as Error)?.message ?? String(err)}`, 'IO', err);
}

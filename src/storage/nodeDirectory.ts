import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import type { Directory, DirEntry } from './directory';

/** Node implementation of Directory, for tests and command line scripts. */
export class NodeDirectory implements Directory {
  constructor(public readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, ...path.split('/').filter(Boolean));
  }

  async list(dir = ''): Promise<DirEntry[]> {
    try {
      const entries = await fs.readdir(this.abs(dir), { withFileTypes: true });
      return entries.map((e) => ({ name: e.name, kind: e.isDirectory() ? 'directory' : 'file' }));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await fs.readFile(this.abs(path), 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async readBytes(path: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await fs.readFile(this.abs(path)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await fs.mkdir(dirname(this.abs(path)), { recursive: true });
    await fs.writeFile(this.abs(path), text, 'utf8');
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await fs.mkdir(dirname(this.abs(path)), { recursive: true });
    await fs.writeFile(this.abs(path), bytes);
  }

  async rename(from: string, to: string): Promise<void> {
    await fs.rename(this.abs(from), this.abs(to));
  }

  async remove(path: string): Promise<void> {
    await fs.rm(this.abs(path), { force: true });
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(this.abs(path));
      return true;
    } catch {
      return false;
    }
  }

  async mkdir(dir: string): Promise<void> {
    await fs.mkdir(this.abs(dir), { recursive: true });
  }
}

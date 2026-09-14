/**
 * Minimal directory primitive the FileSystemAdapter is built on. Two implementations:
 * FsaDirectory (browser, File System Access API) and NodeDirectory (tests and scripts).
 * Paths are relative to the root and may contain "/" for one level of sub-directory.
 */
export type DirEntry = { name: string; kind: 'file' | 'directory' };

export interface Directory {
  list(dir?: string): Promise<DirEntry[]>;
  readText(path: string): Promise<string | null>;
  writeText(path: string, text: string): Promise<void>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Rename within the same directory, replacing the target if it exists. */
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(dir: string): Promise<void>;
}

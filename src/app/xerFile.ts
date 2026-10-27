/**
 * The whole XER, kept beside the import it produced, and read back for the Schedule
 * screen.
 *
 * The budget only ever needs the T&C slice of a project, which goes into the import's
 * JSON as it always has. The Schedule screen needs the whole project, so the file
 * itself is kept too — gzip-compressed, because an XER is repetitive text and comes
 * down to a tenth of its size or less, which matters in a OneDrive folder that keeps
 * every fortnightly update.
 *
 * Reading a big project takes a moment, so a read is cached: switching screens and
 * coming back does not read the file again. Only the last few are held, since each
 * is a whole project in memory.
 */
import { decodeXer, type XerEncoding } from '../engine/xerText';
import { readProjectAsync, type P6Project } from '../engine/xerProject';

const GZIP_MAGIC_0 = 0x1f;
const GZIP_MAGIC_1 = 0x8b;

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === GZIP_MAGIC_0 && bytes[1] === GZIP_MAGIC_1;
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

/** Compress for storage, or null where this browser cannot. The file is then kept as it is. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    return await pipe(bytes, new CompressionStream('gzip'));
  } catch {
    return null;
  }
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (!isGzip(bytes)) return bytes;
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot read the compressed copy of the P6 file. Use Edge or Chrome.');
  return pipe(bytes, new DecompressionStream('gzip'));
}

export type LoadedProject = { model: P6Project; encoding: XerEncoding; bytes: number };

const cache = new Map<string, Promise<LoadedProject>>();
const KEEP = 3;

/**
 * Read an XER's bytes into a project, reporting progress. The bytes may be the
 * stored compressed copy or the file as exported; either works.
 */
export async function readXerBytes(raw: Uint8Array, onProgress?: (p: number) => void): Promise<LoadedProject> {
  const bytes = await gunzip(raw);
  const { text, encoding } = decodeXer(bytes);
  const model = await readProjectAsync(text, {}, onProgress);
  return { model, encoding, bytes: bytes.length };
}

/**
 * The project in a stored file, read once and then served from memory. `read` fetches
 * the bytes; it is only called when the file is not already in the cache.
 */
export function loadStoredProject(path: string, read: () => Promise<Uint8Array | null>, onProgress?: (p: number) => void): Promise<LoadedProject> {
  const hit = cache.get(path);
  if (hit) {
    // Most recently used goes to the back of the queue.
    cache.delete(path);
    cache.set(path, hit);
    return hit;
  }
  const p = (async () => {
    const bytes = await read();
    if (!bytes) throw new Error(`The stored copy of the P6 file (${path}) is not in the folder any more. Import the .xer again to view it.`);
    return readXerBytes(bytes, onProgress);
  })();
  cache.set(path, p);
  p.catch(() => cache.delete(path));
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string);
  return p;
}

/** Put a project already read (at import) in the cache, so the Schedule screen opens it instantly. */
export function rememberProject(path: string, loaded: LoadedProject): void {
  cache.set(path, Promise.resolve(loaded));
  while (cache.size > KEEP) cache.delete(cache.keys().next().value as string);
}

/** True when the bytes look like an XER: P6 starts every one with its ERMHDR line. */
export function looksLikeXer(name: string, bytes: Uint8Array): boolean {
  if (/\.xer(\.gz)?$/i.test(name)) return true;
  if (isGzip(bytes)) return false;
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  return head === 'ERMHDR';
}

/** A size for people: 1.4 MB. */
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

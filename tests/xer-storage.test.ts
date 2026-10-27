/**
 * The whole XER kept beside its import: compressed on the way in, read back the
 * same, cached once read, and removed with the import that kept it — never with
 * anything else.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MemoryAdapter } from '../src/storage/memoryAdapter';
import { Store, isStoredXerFile, storedXerPath, emptyStoreData } from '../src/storage/store';
import { gzip, gunzip, isGzip, readXerBytes, loadStoredProject, looksLikeXer, fmtBytes } from '../src/app/xerFile';
import { makeScale, ticksFor, fmtMs } from '../src/app/schedule/timeline';
import type { ScheduleImport } from '../src/engine/types';
import { FIXTURE_DIR } from './helpers';

const raw = new Uint8Array(readFileSync(resolve(FIXTURE_DIR, 'full-project.xer')));
const owner = { id: 'me', label: 'test' };

describe('keeping the file', () => {
  it('compresses an XER to a fraction of its size and gives back the same bytes', async () => {
    const packed = await gzip(raw);
    expect(packed).not.toBeNull();
    expect(isGzip(packed!)).toBe(true);
    expect(packed!.length).toBeLessThan(raw.length / 2);
    expect(await gunzip(packed!)).toEqual(raw);
    // Bytes that were never compressed pass straight through.
    expect(await gunzip(raw)).toBe(raw);
  });

  it('reads a project from the stored copy exactly as from the file', async () => {
    const fromFile = await readXerBytes(raw);
    const fromStore = await readXerBytes((await gzip(raw))!);
    expect(fromStore.encoding).toBe('windows-1252');
    expect(fromStore.bytes).toBe(raw.length);
    expect(fromStore.model.tasks.map((t) => t.code)).toEqual(fromFile.model.tasks.map((t) => t.code));
  });

  it('reads a stored file once, then serves it from memory', async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return raw;
    };
    const a = await loadStoredProject('imports/2026-10-01T090000-current.xer', read);
    const b = await loadStoredProject('imports/2026-10-01T090000-current.xer', read);
    expect(reads).toBe(1);
    expect(b).toBe(a);
    await expect(loadStoredProject('imports/gone-current.xer', async () => null)).rejects.toThrow(/not in the folder/);
  });

  it('knows an XER by its name or its first line', () => {
    expect(looksLikeXer('update.XER', new Uint8Array())).toBe(true);
    expect(looksLikeXer('paste.txt', raw)).toBe(true);
    expect(looksLikeXer('rows.csv', new TextEncoder().encode('Activity ID,Name'))).toBe(false);
    expect(fmtBytes(1536)).toBe('2 KB');
    expect(fmtBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('the store', () => {
  const imp = (id: string, kind: 'current' | 'baseline', file?: string): ScheduleImport => ({
    id,
    kind,
    importedAt: `2026-10-0${id.slice(-1)}T09:00:00Z`,
    sourceFilename: 'project.xer',
    rowCount: 0,
    activities: [],
    p6: { format: 'xer', project: 'P', projectName: 'P', dataDate: null, totalActivities: 0, scope: { segment: 3, values: ['TC'] }, ...(file ? { file } : {}) },
  });

  it('only ever writes, reads or deletes a stored XER where one belongs', async () => {
    expect(isStoredXerFile(storedXerPath('2026-10-01T090000', 'current', true))).toBe(true);
    expect(isStoredXerFile('imports/2026-10-01T090000-current.xer')).toBe(true);
    expect(isStoredXerFile('imports/index.json')).toBe(false);
    expect(isStoredXerFile('settings.json')).toBe(false);
    expect(isStoredXerFile('imports/../settings.xer')).toBe(false);
    const store = new Store(new MemoryAdapter(), owner);
    await expect(store.writeStoredXer('settings.json', raw)).rejects.toThrow();
    expect(await store.readStoredXer('settings.json')).toBeNull();
  });

  it('removes the kept file with its import, and nothing else', async () => {
    const adapter = new MemoryAdapter();
    const store = new Store(adapter, owner);
    const fileA = storedXerPath('2026-10-01T090001', 'current', true);
    const fileB = storedXerPath('2026-10-02T090002', 'current', true);
    await store.writeStoredXer(fileA, raw);
    await store.writeStoredXer(fileB, raw);
    let index = emptyStoreData().importsIndex;
    index = (await store.appendImport(imp('2026-10-01T090001', 'current', fileA), index)).index;
    index = (await store.appendImport(imp('2026-10-02T090002', 'current', fileB), index)).index;
    const first = index[0];
    index = await store.removeImport(first.file, index);
    expect(await adapter.exists(fileA)).toBe(false);
    expect(await adapter.exists(fileB)).toBe(true);
    expect(index).toHaveLength(1);
  });

  it('keeps a file another import still points at', async () => {
    const adapter = new MemoryAdapter();
    const store = new Store(adapter, owner);
    const file = storedXerPath('2026-10-01T090001', 'current', true);
    await store.writeStoredXer(file, raw);
    let index = emptyStoreData().importsIndex;
    index = (await store.appendImport(imp('2026-10-01T090001', 'current', file), index)).index;
    index = (await store.appendImport(imp('2026-10-02T090002', 'baseline', file), index)).index;
    index = await store.removeImport(index[0].file, index);
    expect(await adapter.exists(file)).toBe(true);
  });
});

describe('the Gantt time axis', () => {
  it('pads and snaps the range to whole months', () => {
    const s = makeScale(Date.UTC(2026, 8, 14), Date.UTC(2026, 11, 20), 'month');
    expect(new Date(s.from).toISOString().slice(0, 10)).toBe('2026-08-01');
    expect(new Date(s.to).toISOString().slice(0, 10)).toBe('2027-03-01');
    expect(s.x(s.from)).toBe(0);
    expect(s.at(s.x(Date.UTC(2026, 9, 1)))).toBe(Date.UTC(2026, 9, 1));
  });

  it('labels only the stretch in view, in two tiers', () => {
    const s = makeScale(Date.UTC(2020, 0, 1), Date.UTC(2030, 0, 1), 'week');
    const t = ticksFor(s, 'week', Date.UTC(2026, 0, 1), Date.UTC(2026, 2, 1));
    expect(t.top.length).toBeLessThan(10);
    expect(t.bottom.length).toBeLessThan(20);
    // Weeks start on Mondays.
    expect(t.bottom.every((b) => new Date(s.at(b.x)).getUTCDay() === 1)).toBe(true);
    expect(ticksFor(s, 'year', s.from, s.to).bottom.map((b) => b.label).slice(0, 2)).toEqual(['2019', '2020']);
    expect(fmtMs(Date.UTC(2026, 8, 14, 8))).toBe('14-Sep-26');
  });
});

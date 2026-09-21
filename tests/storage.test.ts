import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeDirectory } from '../src/storage/nodeDirectory';
import { FileSystemAdapter } from '../src/storage/fileSystemAdapter';
import { MemoryAdapter } from '../src/storage/memoryAdapter';
import { migrateTestCounts, Store, classifyConflict, FILES, importStamp } from '../src/storage/store';
import { StorageError } from '../src/storage/adapter';
import { DEFAULT_SETTINGS } from '../src/engine/types';

let root: string;
const noSleep = async () => undefined;
const owner = { id: 'test-owner', label: 'TEST-LAPTOP' };

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tc-store-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FileSystemAdapter over a temp directory', () => {
  it('writes atomically through a temp file and rename', async () => {
    const a = new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep });
    await a.write('settings.json', '{"a":1}');
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{"a":1}');
    expect(existsSync(join(root, 'settings.json.tmp'))).toBe(false);
    await a.write('imports/2026-09-14T0930-current.json', '[]');
    expect(await a.list('imports')).toEqual(['imports/2026-09-14T0930-current.json']);
  });

  it('an interrupted write leaves the previous file intact', async () => {
    class Flaky extends NodeDirectory {
      async writeText(path: string, text: string): Promise<void> {
        if (path.endsWith('.tmp')) {
          await super.writeText(path, text.slice(0, 5)); // half written, then the process "dies"
          throw new Error('EIO: disk unplugged');
        }
        return super.writeText(path, text);
      }
    }
    const good = new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep });
    await good.write('settings.json', '{"version":"previous"}');
    const bad = new FileSystemAdapter(new Flaky(root), 'tmp', { attempts: 2, sleep: noSleep });
    await expect(bad.write('settings.json', '{"version":"next-and-much-longer"}')).rejects.toBeInstanceOf(StorageError);
    expect(readFileSync(join(root, 'settings.json'), 'utf8')).toBe('{"version":"previous"}');
  });

  it('retries a transiently locked file with backoff and then succeeds', async () => {
    let failures = 2;
    const delays: number[] = [];
    class Busy extends NodeDirectory {
      async rename(from: string, to: string): Promise<void> {
        if (failures-- > 0) throw Object.assign(new Error('EBUSY: resource busy'), { code: 'EBUSY' });
        return super.rename(from, to);
      }
    }
    const a = new FileSystemAdapter(new Busy(root), 'tmp', { attempts: 5, baseDelayMs: 10, sleep: async (ms) => void delays.push(ms) });
    await a.write('locations.json', '[]');
    expect(readFileSync(join(root, 'locations.json'), 'utf8')).toBe('[]');
    expect(delays).toEqual([10, 20]);
  });

  it('surfaces a clear error when the file stays locked', async () => {
    class Stuck extends NodeDirectory {
      async rename(): Promise<void> {
        throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      }
    }
    const a = new FileSystemAdapter(new Stuck(root), 'tmp', { attempts: 3, sleep: noSleep });
    await expect(a.write('x.json', '1')).rejects.toThrow(/after 3 attempts.*OneDrive/);
  });
});

describe('Store', () => {
  it('initialises cleanly from a missing or empty folder', async () => {
    const store = new Store(new FileSystemAdapter(new NodeDirectory(join(root, 'does-not-exist')), 'tmp', { sleep: noSleep }), owner);
    const { data, problems } = await store.loadAll();
    expect(problems).toEqual([]);
    expect(data.settings).toEqual(DEFAULT_SETTINGS);
    expect(data.library).toEqual([]);
    expect(data.current).toBeNull();
    expect(await store.scanConflicts()).toEqual([]);
  });

  it('round-trips every file and reads the latest import of each kind', async () => {
    const store = new Store(new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep }), owner);
    await store.saveFile('settings', { ...DEFAULT_SETTINGS, dataDate: '2026-08-31' });
    await store.saveFile('library', [{ matchKey: 'X', crewSize: 3 }]);
    const imp = (id: string, kind: 'current' | 'baseline', at: string) => ({ id, kind, importedAt: at, sourceFilename: 'a.xlsx', rowCount: 0, activities: [] });
    let idx = (await store.appendImport(imp('2026-09-01T0900', 'current', '2026-09-01T09:00:00Z'), [])).index;
    idx = (await store.appendImport(imp('2026-09-14T0930', 'current', '2026-09-14T09:30:00Z'), idx)).index;
    idx = (await store.appendImport(imp('2026-09-14T0931', 'baseline', '2026-09-14T09:31:00Z'), idx)).index;
    const { data, problems } = await store.loadAll();
    expect(problems).toEqual([]);
    expect(data.settings.dataDate).toBe('2026-08-31');
    expect(data.library[0].crewSize).toBe(3);
    expect(data.importsIndex.length).toBe(3);
    expect(data.current?.id).toBe('2026-09-14T0930');
    expect(data.baseline?.id).toBe('2026-09-14T0931');
    // Imports are never overwritten: the first file is still there.
    expect(existsSync(join(root, 'imports', '2026-09-01T0900-current.json'))).toBe(true);
  });

  it('reads a folder written before missed reasons existed without inventing a problem', async () => {
    // Every store in the field predates this file. An empty catalogue is the right
    // reading of "nobody has been asked yet", so a missing file is not a fault to
    // report — and the shape has to come back whole, since it is an object rather
    // than the list every other file holds.
    const store = new Store(new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep }), owner);
    await store.saveFile('settings', { ...DEFAULT_SETTINGS });
    const { data, problems } = await store.loadAll();
    expect(problems).toEqual([]);
    expect(data.missedReasons).toEqual({ reasons: [], entries: [], removed: [] });
  });

  it('round-trips the reasons an activity was missed for', async () => {
    const store = new Store(new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep }), owner);
    await store.saveFile('missedReasons', {
      reasons: ['Cable pull late'],
      entries: [{ activityId: 'A-1', periodEnd: '2026-08-31', reason: 'Cable pull late', updatedAt: '2026-09-01T00:00:00Z' }],
    });
    const { data } = await store.loadAll();
    expect(data.missedReasons.reasons).toEqual(['Cable pull late']);
    expect(data.missedReasons.entries[0].activityId).toBe('A-1');
    expect(existsSync(join(root, 'missed-reasons.json'))).toBe(true);
  });

  it('detects OneDrive conflict copies and reports them without merging', async () => {
    const store = new Store(new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep }), owner);
    await store.saveFile('settings', { ...DEFAULT_SETTINGS, defaultCrew: 2 });
    writeFileSync(join(root, 'settings-LAPTOP-9F3.json'), JSON.stringify({ ...DEFAULT_SETTINGS, defaultCrew: 99 }));
    writeFileSync(join(root, 'activity-library (1).json'), '[]');
    mkdirSync(join(root, 'imports'), { recursive: true });
    writeFileSync(join(root, 'imports', '2026-09-14T0930-current-LAPTOP.json'), '{}');
    writeFileSync(join(root, 'imports', 'index.json'), '[]');
    const conflicts = await store.scanConflicts();
    expect(conflicts.map((c) => c.path).sort()).toEqual(['activity-library (1).json', 'imports/2026-09-14T0930-current-LAPTOP.json', 'settings-LAPTOP-9F3.json']);
    expect(conflicts.find((c) => c.path === 'settings-LAPTOP-9F3.json')?.of).toBe('settings.json');
    const { data } = await store.loadAll();
    expect(data.settings.defaultCrew).toBe(2); // the conflict copy was not merged
  });

  it('classifies canonical names as not conflicts', () => {
    for (const p of ['settings.json', 'imports/index.json', 'imports/2026-09-14T093000-baseline.json', 'snapshots/2026-08-31.json', 'snapshots/2026-08-31-1.json', 'settings.json.tmp', 'exports/x.xlsx']) {
      expect(classifyConflict(p), p).toBeNull();
    }
  });

  it('ignores corrupt JSON with a warning instead of failing to open', async () => {
    writeFileSync(join(root, FILES.locations), '{not json');
    const store = new Store(new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep }), owner);
    const { data, problems } = await store.loadAll();
    expect(data.locations).toEqual([]);
    expect(problems[0]).toMatch(/locations\.json is not valid JSON/);
  });

  it('advisory lock: warns on a recent foreign lock, ignores a stale one, never blocks', async () => {
    const adapter = new FileSystemAdapter(new NodeDirectory(root), 'tmp', { sleep: noSleep });
    const other = new Store(adapter, { id: 'other', label: 'OTHER-PC' });
    const mine = new Store(adapter, owner);
    const t0 = new Date('2026-09-14T09:00:00Z');
    await other.acquireLock(t0);
    const recent = await mine.acquireLock(new Date(t0.getTime() + 60_000));
    expect(recent.held).toBe(true);
    expect(recent.foreign?.label).toBe('OTHER-PC');
    await other.acquireLock(t0);
    const stale = await mine.acquireLock(new Date(t0.getTime() + 10 * 60_000));
    expect(stale.foreign).toBeNull();
    await mine.refreshLock();
    expect((await mine.readLock())?.owner).toBe('test-owner');
    await mine.releaseLock();
    expect(await adapter.exists('.lock')).toBe(false);
  });

  it('works identically over the memory adapter', async () => {
    const store = new Store(new MemoryAdapter(), owner);
    await store.saveFile('overrides', [{ activityId: 'A', overrideHours: 5 }]);
    const { data } = await store.loadAll();
    expect(data.overrides[0].overrideHours).toBe(5);
    expect(importStamp(new Date(2026, 8, 14, 9, 30, 5))).toBe('2026-09-14T093005');
  });
});

/**
 * Every store in the field was written when percent complete could come from a
 * count of test cases. Reading those rows as "nothing keyed" would hand the
 * activity back to P6's durations and move the earned curve without telling
 * anybody, so the counts are converted to the percentage they stood for.
 */
describe('a store written when test case counts existed', () => {
  it('reads the counts as the percent complete they always meant', () => {
    const [row] = migrateTestCounts([{ activityId: 'A', testsTotal: 40, testsComplete: 10, updatedAt: 'x' }]);
    expect(row.pctOverride).toBe(0.25);
    expect(row).not.toHaveProperty('testsTotal');
    expect(row).not.toHaveProperty('testsComplete');
  });

  it('leaves a percent somebody keyed alone, counts or no counts', () => {
    const [row] = migrateTestCounts([{ activityId: 'A', testsTotal: 40, testsComplete: 10, pctOverride: 0.9, updatedAt: 'x' }]);
    expect(row.pctOverride).toBe(0.9);
  });

  it('keeps a keyed zero, which is a statement and not an absence', () => {
    const [row] = migrateTestCounts([{ activityId: 'A', testsTotal: 40, testsComplete: 10, pctOverride: 0, updatedAt: 'x' }]);
    expect(row.pctOverride).toBe(0);
  });

  it('invents nothing from a total of zero, which says how many tests there are and not how far along', () => {
    const [row] = migrateTestCounts([{ activityId: 'A', testsTotal: 0, testsComplete: 0, note: 'no pack yet', updatedAt: 'x' }]);
    expect(row.pctOverride).toBeUndefined();
    expect(row.note).toBe('no pack yet');
  });

  it('carries the dates and the note through untouched', () => {
    const [row] = migrateTestCounts([
      { activityId: 'A', testsTotal: 2, testsComplete: 2, testStartOverride: '2026-01-01', testEndOverride: '2026-02-01', progressAsOf: '2026-02-01', note: 'done', updatedAt: 'x' },
    ]);
    expect(row).toMatchObject({ pctOverride: 1, testStartOverride: '2026-01-01', testEndOverride: '2026-02-01', progressAsOf: '2026-02-01', note: 'done' });
  });

  it('clamps a count sheet that says more passed than exist', () => {
    expect(migrateTestCounts([{ activityId: 'A', testsTotal: 4, testsComplete: 9, updatedAt: 'x' }])[0].pctOverride).toBe(1);
  });
});

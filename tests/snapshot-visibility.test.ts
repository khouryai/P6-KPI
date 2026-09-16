/**
 * Hiding and deleting a snapshot.
 *
 * Snapshots are the audit trail, so the two operations that can damage one are held
 * to different promises and the tests say which is which. Hiding takes a snapshot off
 * the curve and changes not one line of the record. Deleting removes the file, and
 * there is no other copy — so it is guarded on the path, and a path that is not a
 * snapshot file is refused rather than obeyed.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { Store, isSnapshotFile, SNAPSHOT_DIR } from '../src/storage/store';
import { MemoryAdapter } from '../src/storage/memoryAdapter';
import { fixtureModelInput } from './helpers';
import type { Snapshot } from '../src/engine/types';

const snap = (statusDate: string, earned: number, hidden?: boolean): Snapshot => ({
  statusDate,
  takenAt: `${statusDate}T09:00:00Z`,
  lines: [{ activityId: '0-P2-TC-B20-FA-0010', pctComplete: 1, budgetHours: earned, earnedHours: earned }],
  ...(hidden ? { hidden: true } : {}),
});

describe('a hidden snapshot is off the curve', () => {
  it('plots no marker', () => {
    const shown = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210)] }));
    const hidden = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210, true)] }));
    expect(shown.snapshotMarkers).toHaveLength(1);
    expect(hidden.snapshotMarkers).toEqual([]);
  });

  it('leaves the curve point with no reported figure at that date', () => {
    const shown = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210)] }));
    const hidden = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210, true)] }));
    expect(shown.curve.find((c) => c.periodEnd === '2026-07-31')!.snapshot).toBe(210);
    expect(hidden.curve.find((c) => c.periodEnd === '2026-07-31')!.snapshot).toBeNull();
  });

  it('cannot stretch the curve to a month nothing else reaches', () => {
    const base = computeModel(fixtureModelInput({ snapshots: [] }));
    const far = computeModel(fixtureModelInput({ snapshots: [snap('2031-12-31', 10)] }));
    const farHidden = computeModel(fixtureModelInput({ snapshots: [snap('2031-12-31', 10, true)] }));
    expect(far.curve.length).toBeGreaterThan(base.curve.length);
    expect(farHidden.curve.length).toBe(base.curve.length);
  });

  it('changes nothing about the budget, the earned hours or the curve itself', () => {
    const shown = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210)] }));
    const hidden = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210, true)] }));
    expect(hidden.summary.totalBudgetHours).toBe(shown.summary.totalBudgetHours);
    expect(hidden.summary.earnedHours).toBe(shown.summary.earnedHours);
    expect(hidden.curve.map((c) => c.earned)).toEqual(shown.curve.map((c) => c.earned));
  });

  it('a hidden snapshot alongside a plotted one leaves the plotted one alone', () => {
    const m = computeModel(fixtureModelInput({ snapshots: [snap('2026-07-31', 210), snap('2026-08-31', 999, true)] }));
    expect(m.snapshotMarkers.map((s) => s.statusDate)).toEqual(['2026-07-31']);
  });
});

describe('the store', () => {
  const owner = { id: 'test', label: 'test' };

  it('tells each snapshot which file it came from, so two on one date stay distinct', async () => {
    const store = new Store(new MemoryAdapter(), owner);
    const a = await store.appendSnapshot(snap('2026-07-31', 100));
    const b = await store.appendSnapshot(snap('2026-07-31', 200));
    expect(a).not.toBe(b);
    const { data } = await store.loadAll();
    // Order between two snapshots sharing a status date AND a taken-at is not defined;
    // that both are present and separately addressable is the point.
    expect(new Set(data.snapshots.map((s) => s.file))).toEqual(new Set([a, b]));
    expect(data.snapshots).toHaveLength(2);
  });

  it('hides one without touching its lines, and can put it back', async () => {
    const store = new Store(new MemoryAdapter(), owner);
    const file = await store.appendSnapshot(snap('2026-07-31', 210));
    const before = (await store.loadAll()).data.snapshots[0];

    await store.writeSnapshot(file, { ...before, hidden: true });
    const hidden = (await store.loadAll()).data.snapshots[0];
    expect(hidden.hidden).toBe(true);
    expect(hidden.lines).toEqual(before.lines);
    expect(hidden.takenAt).toBe(before.takenAt);

    await store.writeSnapshot(file, { ...hidden, hidden: undefined });
    const shown = (await store.loadAll()).data.snapshots[0];
    expect(shown.hidden).toBeUndefined();
    expect(shown.lines).toEqual(before.lines);
  });

  it('never writes the file path into the record it describes', async () => {
    const adapter = new MemoryAdapter();
    const store = new Store(adapter, owner);
    const file = await store.appendSnapshot(snap('2026-07-31', 210));
    await store.writeSnapshot(file, { ...snap('2026-07-31', 210), file });
    expect(JSON.parse((await adapter.read(file))!)).not.toHaveProperty('file');
  });

  it('deletes only the snapshot asked for', async () => {
    const store = new Store(new MemoryAdapter(), owner);
    const a = await store.appendSnapshot(snap('2026-07-31', 100));
    await store.appendSnapshot(snap('2026-08-31', 200));
    await store.deleteSnapshot(a);
    const { data } = await store.loadAll();
    expect(data.snapshots.map((s) => s.statusDate)).toEqual(['2026-08-31']);
  });

  it('refuses a path that is not a snapshot file, rather than deleting it', async () => {
    const store = new Store(new MemoryAdapter(), owner);
    await expect(store.deleteSnapshot('settings.json')).rejects.toThrow(/not a snapshot file/);
    await expect(store.deleteSnapshot('../settings.json')).rejects.toThrow(/not a snapshot file/);
    await expect(store.writeSnapshot('activity-library.json', snap('2026-07-31', 1))).rejects.toThrow(/not a snapshot file/);
  });

  it('recognises the file names it writes, and nothing else', () => {
    expect(isSnapshotFile(`${SNAPSHOT_DIR}/2026-07-31.json`)).toBe(true);
    expect(isSnapshotFile(`${SNAPSHOT_DIR}/2026-07-31-1.json`)).toBe(true);
    expect(isSnapshotFile('2026-07-31.json')).toBe(false);
    expect(isSnapshotFile(`${SNAPSHOT_DIR}/notes.json`)).toBe(false);
    expect(isSnapshotFile(`imports/2026-07-31.json`)).toBe(false);
  });
});

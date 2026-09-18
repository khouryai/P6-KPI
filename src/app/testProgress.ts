/**
 * Keying test progress against an activity, from wherever the person happens to be.
 *
 * The Test Progress screen is the home of this data, but it is not the only place a
 * person is holding the answer: at a fortnightly review the counts are being read
 * out activity by activity, and making somebody leave the log, find the row again
 * on another screen and key it there is how a review ends with nothing keyed at
 * all. So the upsert lives here rather than inside one screen, and both write
 * through it — one file, one shape, one set of rules about when a row is created
 * and when it is dropped.
 */
import type { TestProgress } from '../engine/types';
import { normKey } from '../engine/keys';
import type { DataUpdater } from './state';

/** Drop undefined and empty fields so the stored JSON stays tidy. */
export function tidyTestProgress(t: TestProgress): TestProgress {
  const out: TestProgress = { activityId: t.activityId.trim(), updatedAt: t.updatedAt };
  for (const k of ['testsTotal', 'testsComplete', 'pctOverride', 'testStartOverride', 'testEndOverride', 'progressAsOf', 'note'] as const) {
    const v = typeof t[k] === 'string' ? (t[k] as string).trim() : t[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

/** True when nothing is keyed against this activity any more. */
function isEmpty(t: TestProgress): boolean {
  return (
    t.testsTotal === undefined &&
    t.testsComplete === undefined &&
    t.pctOverride === undefined &&
    t.testStartOverride === undefined &&
    t.testEndOverride === undefined &&
    t.progressAsOf === undefined &&
    t.note === undefined
  );
}

/**
 * Set fields on one activity's test progress.
 *
 * An entry is created when the first field is filled and removed again when the
 * last one is cleared, so `test-progress.json` only ever holds activities somebody
 * actually keyed something against.
 */
export function setTestProgress(update: DataUpdater, activityId: string, patch: Partial<TestProgress>): void {
  const now = new Date().toISOString();
  update('testProgress', (tps) => {
    const i = tps.findIndex((t) => normKey(t.activityId) === normKey(activityId));
    const base: TestProgress = i >= 0 ? tps[i] : { activityId, updatedAt: now };
    const next = tidyTestProgress({ ...base, ...patch, updatedAt: now });
    if (isEmpty(next)) return i >= 0 ? tps.filter((_, j) => j !== i) : tps;
    if (i >= 0) return tps.map((t, j) => (j === i ? next : t));
    return [...tps, next];
  });
}

/** Everything keyed against one activity, gone. */
export function clearTestProgress(update: DataUpdater, activityId: string): void {
  update('testProgress', (tps) => tps.filter((t) => normKey(t.activityId) !== normKey(activityId)));
}

/**
 * A percentage as it is meant, from what was typed. People key "40" as often as
 * "0.4" and mean the same thing both times.
 */
export function asFraction(n: number | undefined): number | undefined {
  return n !== undefined && n > 1 ? n / 100 : n;
}

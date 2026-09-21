/**
 * The note a reviewer writes on a row.
 *
 * There is exactly one of these per activity and both screens that show it write
 * through the same upsert, because the alternative — a copy on the Two-Week Log and
 * a copy on Test Progress — is two answers to one question and somebody having to
 * work out which is current. The other thing worth pinning is that it is NOT the
 * Budget Master note: that one says why an activity was renamed, hidden or
 * re-priced, and a progress note overwriting a pricing justification would lose the
 * only record of a decision.
 */
import { describe, it, expect } from 'vitest';
import type { ActivityOverride, TestProgress } from '../src/engine/types';
import { setTestProgress, tidyTestProgress } from '../src/app/testProgress';
import { normKey } from '../src/engine/keys';
import type { DataUpdater } from '../src/app/state';

/** The store, as the screens hand it to the helpers. */
function harness(initial: TestProgress[] = [], overrides: ActivityOverride[] = []) {
  const box = { testProgress: initial, overrides };
  const update = ((key: string, fn: (prev: unknown) => unknown) => {
    if (key === 'testProgress') box.testProgress = fn(box.testProgress) as TestProgress[];
    else if (key === 'overrides') box.overrides = fn(box.overrides) as ActivityOverride[];
    else throw new Error(`unexpected key ${key}`);
  }) as unknown as DataUpdater;
  return { box, update };
}

const noteOf = (box: { testProgress: TestProgress[] }, id: string) =>
  box.testProgress.find((t) => normKey(t.activityId) === normKey(id))?.note;

describe('the progress note', () => {
  it('is written from wherever the reviewer happens to be, into one field', () => {
    const { box, update } = harness();
    // The Two-Week Log writes it ...
    setTestProgress(update, 'A-1', { note: 'Waiting on the CTC cutover' });
    expect(noteOf(box, 'A-1')).toBe('Waiting on the CTC cutover');
    // ... and the Progress screen edits that same one, rather than adding a second row.
    setTestProgress(update, 'A-1', { note: 'Cutover done, retest booked' });
    expect(box.testProgress).toHaveLength(1);
    expect(noteOf(box, 'A-1')).toBe('Cutover done, retest booked');
  });

  it('sits beside the percent complete without disturbing it', () => {
    const { box, update } = harness();
    setTestProgress(update, 'A-1', { pctOverride: 0.3 });
    setTestProgress(update, 'A-1', { note: 'Four cases blocked by access' });
    expect(box.testProgress[0]).toMatchObject({ pctOverride: 0.3, note: 'Four cases blocked by access' });
  });

  it('is cleared by emptying it, and takes the row with it when nothing else is keyed', () => {
    const { box, update } = harness();
    setTestProgress(update, 'A-1', { note: 'Worth a look' });
    setTestProgress(update, 'A-1', { note: '   ' });
    expect(box.testProgress).toEqual([]);
  });

  it('keeps the row when the note goes but the percent stays', () => {
    const { box, update } = harness();
    setTestProgress(update, 'A-1', { pctOverride: 0.6, note: 'Worth a look' });
    setTestProgress(update, 'A-1', { note: '' });
    expect(box.testProgress).toHaveLength(1);
    expect(noteOf(box, 'A-1')).toBeUndefined();
    expect(box.testProgress[0].pctOverride).toBe(0.6);
  });

  it('is trimmed on the way in, so a stray space is not a note', () => {
    expect(tidyTestProgress({ activityId: 'A-1', note: '  Access booked  ', updatedAt: 'x' }).note).toBe('Access booked');
    expect(tidyTestProgress({ activityId: 'A-1', note: '   ', updatedAt: 'x' }).note).toBeUndefined();
  });

  it('is not the Budget Master note, and neither one touches the other', () => {
    const { box, update } = harness([], [{ activityId: 'A-1', note: 'Re-priced: two crews, agreed with the client' }]);
    setTestProgress(update, 'A-1', { note: 'Waiting on the CTC cutover' });
    expect(box.overrides[0].note).toBe('Re-priced: two crews, agreed with the client');
    expect(noteOf(box, 'A-1')).toBe('Waiting on the CTC cutover');
  });
});

describe('the progress-as-at date', () => {
  it('is kept and tidied like any other keyed field', () => {
    const { box, update } = harness();
    setTestProgress(update, 'A-1', { progressAsOf: ' 2026-08-02 ' });
    expect(box.testProgress[0].progressAsOf).toBe('2026-08-02');
    // The bug this guards: a field missing from the tidy list is silently dropped
    // on the next write, so the date would vanish the moment a note was typed.
    setTestProgress(update, 'A-1', { note: 'Held for access' });
    expect(box.testProgress[0].progressAsOf).toBe('2026-08-02');
    expect(box.testProgress[0].note).toBe('Held for access');
  });

  it('is cleared on its own, and takes the row with it when it was all there was', () => {
    const { box, update } = harness();
    setTestProgress(update, 'A-1', { progressAsOf: '2026-08-02' });
    setTestProgress(update, 'A-1', { progressAsOf: undefined });
    expect(box.testProgress).toEqual([]);
  });
});

/**
 * Why an activity was missed.
 *
 * Two decisions are worth defending here, because both are the kind that look
 * arbitrary until the second fortnight:
 *
 * - A reason belongs to an ACTIVITY first and to a period second. The same activity
 *   missed three fortnights running usually has three different stories, so each
 *   answer is stamped with the period it was given for and the third never
 *   overwrites the first. But it is still the activity's answer: moving the window's
 *   end date by a day is the same activity with the same story, so the nearest
 *   answer it has is what shows, marked as carried.
 * - The catalogue is kept, not derived. A reason typed once stays on offer after
 *   the last activity carrying it is re-dated or finished, or the list would shrink
 *   every time somebody fixed something.
 */
import { describe, it, expect } from 'vitest';
import type { MissedReasonLog } from '../src/engine/types';
import { DEFAULT_MISSED_REASONS } from '../src/engine/types';
import { addReasonToCatalogue, effectiveReasonFor, isReasonUnused, reasonCatalogue, reasonFor, reasonUsage, removeReasonFromCatalogue, setMissedReason, tallyReasons } from '../src/app/missedReasons';
import { normKey } from '../src/engine/keys';
import type { DataUpdater } from '../src/app/state';

/**
 * A stand-in for the app's store: the helpers take the same updater the screens
 * hand them, so what is tested here is exactly what a click does.
 */
function harness(initial: MissedReasonLog = { reasons: [], entries: [] }) {
  const box = { log: initial };
  const update = ((key: string, fn: (prev: unknown) => unknown) => {
    expect(key).toBe('missedReasons');
    box.log = fn(box.log) as MissedReasonLog;
  }) as unknown as DataUpdater;
  return { box, update };
}

describe('the catalogue', () => {
  it('starts with the reasons every job argues about, and keeps their order', () => {
    expect(reasonCatalogue({ reasons: [], entries: [] })).toEqual(DEFAULT_MISSED_REASONS);
  });

  it('takes a new reason from the dropdown and offers it afterwards', () => {
    const { box, update } = harness();
    addReasonToCatalogue(update, 'Signalling possession cancelled');
    expect(reasonCatalogue(box.log)).toContain('Signalling possession cancelled');
  });

  it('will not add the same reason twice, whatever the case', () => {
    const { box, update } = harness();
    addReasonToCatalogue(update, 'Weather');
    addReasonToCatalogue(update, 'weather');
    addReasonToCatalogue(update, 'Cable pull late');
    addReasonToCatalogue(update, '  cable pull LATE ');
    expect(box.log.reasons).toEqual(['Cable pull late']);
  });

  it('ignores an empty reason', () => {
    const { box, update } = harness();
    addReasonToCatalogue(update, '   ');
    expect(box.log.reasons).toEqual([]);
  });

  it('keeps a reason on the list after the activity using it moves on', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Cable pull late');
    setMissedReason(update, 'A-1', '2026-08-31', '');
    expect(box.log.entries).toEqual([]);
    expect(reasonCatalogue(box.log)).toContain('Cable pull late');
  });

  it('offers a reason found on an entry but missing from the list', () => {
    // A file edited by hand. Better to offer it than to show a row whose own
    // answer is not in its own dropdown.
    const log: MissedReasonLog = { reasons: [], entries: [{ activityId: 'A-1', periodEnd: '2026-08-31', reason: 'Typed in by hand', updatedAt: '' }] };
    expect(reasonCatalogue(log)).toContain('Typed in by hand');
  });

  it('drops a reason from the list without touching what was recorded against it', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Cable pull late');
    removeReasonFromCatalogue(update, 'cable pull late');
    expect(box.log.reasons).toEqual([]);
    expect(box.log.entries[0].reason).toBe('Cable pull late');
  });

  it('still offers a reason somebody has already answered with, removed or not', () => {
    // The screen only lets an UNUSED reason be taken off, so this is the file
    // edited by hand. A row whose own answer is missing from its own dropdown is
    // worse than a list with one entry too many on it.
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Cable pull late');
    removeReasonFromCatalogue(update, 'Cable pull late');
    expect(reasonCatalogue(box.log)).toContain('Cable pull late');
  });

  it('takes a built-in reason off the list and keeps it off', () => {
    // The built-in list lives in the code, so "removed" has to be remembered or
    // the reason would be back on the next render.
    const { box, update } = harness();
    removeReasonFromCatalogue(update, 'Weather');
    expect(reasonCatalogue(box.log)).not.toContain('Weather');
    expect(reasonCatalogue(box.log)).toContain('Access not available');
  });

  it('puts a removed reason back when it is typed in again', () => {
    const { box, update } = harness();
    removeReasonFromCatalogue(update, 'Weather');
    addReasonToCatalogue(update, 'weather');
    expect(reasonCatalogue(box.log).filter((r) => r.toLowerCase() === 'weather')).toHaveLength(1);
  });

  it('puts a removed reason back when somebody answers with it', () => {
    const { box, update } = harness();
    removeReasonFromCatalogue(update, 'Weather');
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    expect(reasonCatalogue(box.log)).toContain('Weather');
  });

  it('counts what each reason is in use for, so the screen knows what it may remove', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    setMissedReason(update, 'A-2', '2026-08-31', 'weather');
    setMissedReason(update, 'A-3', '2026-09-14', 'Access not available');
    expect(reasonUsage(box.log).get(normKey('Weather'))).toBe(2);
    expect(isReasonUnused(box.log, 'Weather')).toBe(false);
    expect(isReasonUnused(box.log, 'Re-sequenced by the plan')).toBe(true);
  });
});

describe('recording a reason', () => {
  it('keeps one answer per activity per period', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Access not available');
    setMissedReason(update, 'A-1', '2026-09-14', 'Testing failed, retest required');
    expect(box.log.entries).toHaveLength(2);
    expect(reasonFor(box.log, 'A-1', '2026-08-31')?.reason).toBe('Access not available');
    expect(reasonFor(box.log, 'A-1', '2026-09-14')?.reason).toBe('Testing failed, retest required');
  });

  it('changes its mind in place rather than stacking answers', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    setMissedReason(update, 'A-1', '2026-08-31', 'Access not available');
    expect(box.log.entries).toHaveLength(1);
    expect(reasonFor(box.log, 'A-1', '2026-08-31')?.reason).toBe('Access not available');
  });

  it('clears the record when the reason is cleared, leaving no half-answer', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    setMissedReason(update, 'A-1', '2026-08-31', '  ');
    expect(box.log.entries).toEqual([]);
  });

  it('matches the Activity ID the way every other file does', () => {
    const { box, update } = harness();
    setMissedReason(update, ' a-1 ', '2026-08-31', 'Weather');
    expect(reasonFor(box.log, 'A-1', '2026-08-31')?.reason).toBe('Weather');
  });

  it('keeps a note beside the reason, and drops an empty one', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather', 'Storm closed the yard for four days');
    expect(box.log.entries[0].note).toBe('Storm closed the yard for four days');
    setMissedReason(update, 'A-2', '2026-08-31', 'Weather', '   ');
    expect(box.log.entries[1].note).toBeUndefined();
  });
});

describe('the period KPI', () => {
  it('counts the reasons given, biggest first, and says how many are unanswered', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Access not available');
    setMissedReason(update, 'A-2', '2026-08-31', 'Access not available');
    setMissedReason(update, 'A-3', '2026-08-31', 'Weather');
    const t = tallyReasons(box.log, ['A-1', 'A-2', 'A-3', 'A-4', 'A-5'], '2026-08-31');
    expect(t.given).toEqual([{ reason: 'Access not available', count: 2 }, { reason: 'Weather', count: 1 }]);
    expect(t.unexplained).toBe(2);
  });

  it('carries an answer from a neighbouring period, and says it did', () => {
    // The reason belongs to the activity. It stays its answer until somebody gives
    // this period a different one, and the tally says how many are second-hand so a
    // review can still tell a fresh story from a repeated one.
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    const t = tallyReasons(box.log, ['A-1'], '2026-09-14');
    expect(t.given).toEqual([{ reason: 'Weather', count: 1 }]);
    expect(t.unexplained).toBe(0);
    expect(t.carried).toBe(1);
  });

  it('counts an answer written for this period as this period\u2019s own', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-09-14', 'Weather');
    const t = tallyReasons(box.log, ['A-1'], '2026-09-14');
    expect(t.carried).toBe(0);
  });
});

describe('the answer follows the activity', () => {
  it('survives the window end moving by a day, in either direction', () => {
    // The bug this exists for: the log keyed a fortnight ending on the 9th, somebody
    // nudged the end date, and every reason on the screen blanked.
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-09-09', 'Access not available');
    for (const end of ['2026-09-08', '2026-09-10', '2026-09-09']) {
      const eff = effectiveReasonFor(box.log, 'A-1', end);
      expect(eff?.entry.reason, `end ${end}`).toBe('Access not available');
      expect(eff?.carried).toBe(end !== '2026-09-09');
    }
  });

  it('prefers this period\u2019s own answer over one kept from another', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    setMissedReason(update, 'A-1', '2026-09-14', 'Access not available');
    expect(effectiveReasonFor(box.log, 'A-1', '2026-09-14')).toEqual({
      entry: expect.objectContaining({ reason: 'Access not available' }),
      carried: false,
    });
    // And each review still keeps its own: the older answer is not overwritten.
    expect(effectiveReasonFor(box.log, 'A-1', '2026-08-31')?.entry.reason).toBe('Weather');
  });

  it('takes the nearest period, and the later one when two are equally far off', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    setMissedReason(update, 'A-1', '2026-09-28', 'Access not available');
    expect(effectiveReasonFor(box.log, 'A-1', '2026-09-20')?.entry.reason).toBe('Access not available');
    expect(effectiveReasonFor(box.log, 'A-1', '2026-09-05')?.entry.reason).toBe('Weather');
    // Equidistant: 14 days either side of 14 Sep.
    expect(effectiveReasonFor(box.log, 'A-1', '2026-09-14')?.entry.reason).toBe('Access not available');
  });

  it('says nothing about an activity nobody has answered for', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    expect(effectiveReasonFor(box.log, 'A-2', '2026-08-31')).toBeUndefined();
  });

  it('matches the Activity ID the way every other file does', () => {
    const { box, update } = harness();
    setMissedReason(update, ' a-1 ', '2026-08-31', 'Weather');
    expect(effectiveReasonFor(box.log, 'A-1', '2026-09-14')?.entry.reason).toBe('Weather');
  });
});

/**
 * Why an activity was missed.
 *
 * Two decisions are worth defending here, because both are the kind that look
 * arbitrary until the second fortnight:
 *
 * - A reason belongs to a PERIOD as well as an activity. The same activity missed
 *   three fortnights running usually has three different stories, and the third
 *   overwriting the first would leave the first review unable to explain itself.
 * - The catalogue is kept, not derived. A reason typed once stays on offer after
 *   the last activity carrying it is re-dated or finished, or the list would shrink
 *   every time somebody fixed something.
 */
import { describe, it, expect } from 'vitest';
import type { MissedReasonLog } from '../src/engine/types';
import { DEFAULT_MISSED_REASONS } from '../src/engine/types';
import { addReasonToCatalogue, reasonCatalogue, reasonFor, removeReasonFromCatalogue, setMissedReason, tallyReasons } from '../src/app/missedReasons';
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

  it('does not count last fortnight\u2019s answer as this one\u2019s', () => {
    const { box, update } = harness();
    setMissedReason(update, 'A-1', '2026-08-31', 'Weather');
    const t = tallyReasons(box.log, ['A-1'], '2026-09-14');
    expect(t.given).toEqual([]);
    expect(t.unexplained).toBe(1);
  });
});

/**
 * The percent complete P6's durations imply, and the two ways that arithmetic lies.
 *
 * Both were found the same way: a real import of 675 activities came back reading
 * 99.9% complete with 0 running, 140 not started, and an earned curve that stopped
 * at 40% — because the hours those rows "earned" had no dates to spread over. A
 * number that wrong should not have been quotable, so these pin the refusals.
 */
import { describe, it, expect } from 'vitest';
import { computeModel, p6PctComplete, marksActuals } from '../src/engine/compute';
import { DEFAULT_SETTINGS, type LibraryEntry } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31' };
const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 }];
const base = { settings: S, locations: [], library: lib, overrides: [], testProgress: [], baseline: null };

describe('a missing remaining duration is not zero remaining', () => {
  it('reads nothing rather than everything when the column is absent', () => {
    // (OD - 0) / OD = 1. This is the bug: an export with no Remaining Duration
    // column reported every activity in the file as complete.
    expect(p6PctComplete(makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: null }))).toBe(0);
  });

  it('still does the arithmetic when the duration is really there', () => {
    expect(p6PctComplete(makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 2 }))).toBeCloseTo(0.8, 9);
  });

  it('reads a genuine zero remaining as complete', () => {
    expect(p6PctComplete(makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 0 }))).toBe(1);
  });

  it('keeps an actual finish complete however the durations read', () => {
    const done = makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: null, actualFinish: true, finishDate: '2026-01-31' });
    expect(p6PctComplete(done)).toBe(1);
  });

  it('does not let a whole schedule read as finished when nothing has started', () => {
    const acts = Array.from({ length: 5 }, (_, i) =>
      makeActivity({ activityId: `0-P2-TC-A10-FA-00${i}0`, originalDuration: 10, remainingDuration: null, startDate: '2027-01-04', finishDate: '2027-01-15' }),
    );
    const m = computeModel({ ...base, current: acts });
    expect(m.summary.pctComplete).toBe(0);
    expect(m.summary.earnedHours).toBe(0);
    // And it says why, rather than leaving a plausible-looking zero.
    expect(m.summary.noRemainingDuration).toBe(5);
    expect(m.notes.some((n) => /Remaining Duration/.test(n))).toBe(true);
  });
});

describe('an activity P6 has not started has not progressed', () => {
  it('trusts the actual-date flags in a file that uses them', () => {
    // RD contradicts the flags: no actual start, yet only 2 days left of 10. In a
    // file that marks actuals, the flag is the better witness.
    const notStarted = makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 2 });
    expect(p6PctComplete(notStarted, { marksActuals: true })).toBe(0);
  });

  it('still credits an activity that did start', () => {
    const running = makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 2, actualStart: true, startDate: '2026-08-01' });
    expect(p6PctComplete(running, { marksActuals: true })).toBeCloseTo(0.8, 9);
  });

  it('does not apply the check to a file that marks no actuals at all', () => {
    // Otherwise an export that simply dropped the "A" suffix would read as a job
    // where nothing has ever happened — the same mistake in the other direction.
    const notStarted = makeActivity({ activityId: 'A', originalDuration: 10, remainingDuration: 2 });
    expect(p6PctComplete(notStarted, { marksActuals: false })).toBeCloseTo(0.8, 9);
  });

  it('asks the file once, and answers for the file as a whole', () => {
    const plain = [makeActivity({ activityId: 'A' }), makeActivity({ activityId: 'B' })];
    expect(marksActuals(plain)).toBe(false);
    expect(marksActuals([...plain, makeActivity({ activityId: 'C', actualFinish: true, finishDate: '2026-01-01' })])).toBe(true);
  });
});

describe('what the cards say and what the curve draws', () => {
  it('agrees, once an unstarted activity stops claiming to be finished', () => {
    /*
     * The visible symptom of the bug: earned hours counted in the total but landed
     * on no curve point, because a row with no actual start has no earn window. The
     * card read 99.9% and the curve read 40%.
     */
    const acts = [
      makeActivity({ activityId: '0-P2-TC-A10-FA-0010', originalDuration: 10, remainingDuration: 0, actualStart: true, startDate: '2026-01-05', actualFinish: true, finishDate: '2026-01-16' }),
      makeActivity({ activityId: '0-P2-TC-A10-FA-0020', originalDuration: 10, remainingDuration: null, startDate: '2027-03-01', finishDate: '2027-03-12' }),
    ];
    const m = computeModel({ ...base, current: acts });
    const lastEarned = [...m.curve].reverse().find((c) => c.earned !== null);
    expect(lastEarned).toBeDefined();
    expect(lastEarned!.earned).toBeCloseTo(m.summary.earnedHours, 6);
    expect(m.burn.unphasedEarned).toBeCloseTo(0, 6);
  });
});

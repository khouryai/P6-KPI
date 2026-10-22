/**
 * Saying why an activity is out of the budget, and what the percent complete counts.
 *
 * REVIEW used to be a bare word: the activity was in Budget Master and nowhere else,
 * with nothing to say what it needed. Every status but IN BUDGET now carries a
 * sentence naming the cause and the answer, and REVIEW says what answering it would
 * add. The percent complete is taken over the activities in the budget, so nothing
 * excluded, hidden or unpriced can move it.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { makeActivity } from './helpers';
import type { ActivityOverride, LibraryEntry, ModelInput } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const settings = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', defaultCrew: 2, defaultShiftHours: 8, defaultComplexity: 1 };
const ID = (n: number) => `A-P2-TC-X10-FA-00${n}0`;

function scenario(overrides: ActivityOverride[] = [], library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8 }]): ModelInput {
  return {
    settings,
    locations: [{ code: 'X10', complexityFactor: 1.5 }],
    library,
    overrides,
    testProgress: [
      { activityId: ID(1), pctOverride: 0.5, testStartOverride: '2026-08-01', updatedAt: 'x' },
      { activityId: ID(2), pctOverride: 1, testStartOverride: '2026-08-01', testEndOverride: '2026-08-10', updatedAt: 'x' },
    ],
    current: [
      makeActivity({ activityId: ID(1), sortOrder: 0 }),
      makeActivity({ activityId: ID(2), sortOrder: 1 }),
      makeActivity({ activityId: ID(3), activityName: '[T&C] X10 (Ph2) - Unpriced Type', activityType: 'Unpriced Type', sortOrder: 2 }),
      makeActivity({ activityId: ID(4), activityName: '[T&C] X10 (Ph2) - Old Type', activityType: 'Old Type', sortOrder: 3 }),
    ],
    baseline: null,
  };
}

const withRetired: LibraryEntry[] = [
  { matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8 },
  { matchKey: 'Old Type', basis: 'DUR', retired: true },
];
const row = (m: ReturnType<typeof computeModel>, id: string) => m.rows.find((r) => r.activityId === id)!;

describe('why an activity is in REVIEW', () => {
  it('names a type that was never added to the library, and what pricing it would add', () => {
    const r = row(computeModel(scenario()), ID(3));
    expect(r.status).toBe('REVIEW');
    expect(r.reviewCause).toBe('NO KEY');
    // Default crew 2 x shift 8 x 10 days x the location's 1.5.
    expect(r.hoursIfPriced).toBe(240);
    expect(r.statusReason).toContain('"Unpriced Type" is not in the Activity Library');
    expect(r.statusReason).toContain('about 240 h');
  });

  it('names a key that was retired', () => {
    const r = row(computeModel(scenario([], withRetired)), ID(4));
    expect(r.reviewCause).toBe('RETIRED KEY');
    expect(r.statusReason).toContain('retired');
  });

  it('says nothing for an activity in the budget carrying hours', () => {
    const r = row(computeModel(scenario()), ID(1));
    expect(r.reviewCause).toBeNull();
    expect(r.hoursIfPriced).toBeNull();
    expect(r.statusReason).toBe('');
  });

  it('says whether an exclusion was yours or the library’s', () => {
    const mine = row(computeModel(scenario([{ activityId: ID(1), visibility: 'EXCLUDED' }])), ID(1));
    expect(mine.statusReason).toContain('You set it to Exclude');
    const lib = row(computeModel(scenario([], [{ matchKey: 'Test Type', includeOverride: 'N' }])), ID(1));
    expect(lib.status).toBe('EXCLUDED');
    expect(lib.statusReason).toContain('"Test Type" is set not to include');
  });
});

describe('the percent complete', () => {
  it('is earned over budget across the activities in the budget, and nothing else', () => {
    const m = computeModel(scenario());
    // Two priced activities of 240 h each, at 50% and 100%; the two in REVIEW carry nothing.
    expect(m.summary.totalBudgetHours).toBe(480);
    expect(m.summary.pctComplete).toBeCloseTo(0.75, 10);
  });

  it('leaves out an activity you exclude, and one you hide', () => {
    const excluded = computeModel(scenario([{ activityId: ID(1), visibility: 'EXCLUDED' }]));
    expect(excluded.summary.totalBudgetHours).toBe(240);
    expect(excluded.summary.pctComplete).toBeCloseTo(1, 10);
    const hidden = computeModel(scenario([{ activityId: ID(2), visibility: 'HIDDEN' }]));
    expect(hidden.summary.totalBudgetHours).toBe(240);
    expect(hidden.summary.pctComplete).toBeCloseTo(0.5, 10);
  });

  it('is not moved by pricing nothing: REVIEW activities carry no hours either way', () => {
    const m = computeModel(scenario([{ activityId: ID(3), visibility: 'HIDDEN' }]));
    expect(m.summary.pctComplete).toBeCloseTo(computeModel(scenario()).summary.pctComplete, 10);
  });
});

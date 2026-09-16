/**
 * Per-activity edits: the name, the discipline, and whether the activity takes part
 * in the program at all.
 *
 * The contract these tests exist to hold is narrow and important. P6 owns the
 * Activity ID, the durations and the dates. The user owns everything else, keyed on
 * the Activity ID alone, and a fresh import must be unable to undo any of it. A
 * hidden activity has to be gone from every total, not merely flagged, or the
 * hiding is a lie the moment somebody reads a different screen.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { fixtureModelInput, makeActivity } from './helpers';
import type { ActivityOverride, LibraryEntry, ModelInput, P6Activity, Settings, TestProgress } from '../src/engine/types';
import { DEFAULT_SETTINGS } from '../src/engine/types';

const settings: Settings = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31', defaultCrew: 2, defaultShiftHours: 8, defaultComplexity: 1 };

/** Two priced activities and one whose type nobody has priced, so it reads REVIEW. */
function scenario(overrides: ActivityOverride[] = [], testProgress: TestProgress[] = [], extra: Partial<ModelInput> = {}): ModelInput {
  const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8 }];
  const current: P6Activity[] = [
    makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', activityName: '[T&C] X10 (Ph2) - Test Type', sortOrder: 0 }),
    makeActivity({ activityId: 'A-P2-TC-X10-FA-0020', activityName: '[T&C] X10 (Ph2) - Test Type', sortOrder: 1 }),
    makeActivity({ activityId: 'A-P2-TC-X10-FA-0030', activityName: '[T&C] X10 (Ph2) - Unpriced Type', activityType: 'Unpriced Type', sortOrder: 2 }),
  ];
  return {
    settings,
    locations: [{ code: 'X10' }],
    library,
    overrides,
    testProgress,
    current,
    baseline: null,
    snapshots: [],
    ...extra,
  };
}

describe('hiding an activity', () => {
  it('takes it out of the rows, the budget and the activity count', () => {
    const before = computeModel(scenario());
    const after = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'HIDDEN' }]));

    expect(before.summary.inBudget).toBe(2);
    expect(after.summary.inBudget).toBe(1);
    expect(after.rows.map((r) => r.activityId)).not.toContain('A-P2-TC-X10-FA-0010');
    expect(after.summary.totalBudgetHours).toBe(before.summary.totalBudgetHours / 2);
    expect(after.summary.activities).toBe(before.summary.activities - 1);
    expect(after.summary.hidden).toBe(1);
  });

  it('keeps it priced on hiddenRows, so the cost of bringing it back is visible', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'HIDDEN' }]));
    expect(m.hiddenRows).toHaveLength(1);
    expect(m.hiddenRows[0].hidden).toBe(true);
    expect(m.hiddenRows[0].budgetHours).toBe(160);
  });

  it('removes it from the library count as well, so no screen disagrees with another', () => {
    const before = computeModel(scenario());
    const after = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'HIDDEN' }]));
    const key = (m: ReturnType<typeof computeModel>) => m.library.find((l) => l.matchKey === 'Test Type')!;
    expect(key(before).count).toBe(2);
    expect(key(after).count).toBe(1);
    expect(key(after).budgetHours).toBe(key(before).budgetHours / 2);
  });

  it('clears the REVIEW that has no answer, which is the point of hiding one', () => {
    expect(computeModel(scenario()).summary.review).toBe(1);
    expect(computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0030', visibility: 'HIDDEN' }])).summary.review).toBe(0);
  });
});

describe('forcing an activity in or out', () => {
  it('EXCLUDED leaves it listed but carrying nothing', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'EXCLUDED' }]));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.status).toBe('EXCLUDED');
    expect(r.budgetHours).toBe(0);
    expect(m.summary.inBudget).toBe(1);
    expect(m.summary.forcedOut).toBe(1);
  });

  it('INCLUDED overrides a library exclusion', () => {
    const excluded: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8, includeOverride: 'N' }];
    const plain = computeModel(scenario([], [], { library: excluded }));
    expect(plain.summary.inBudget).toBe(0);

    const forced = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { library: excluded }));
    expect(forced.summary.inBudget).toBe(1);
    expect(forced.summary.forcedIn).toBe(1);
    expect(forced.rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0010')!.budgetHours).toBe(160);
  });

  it('INCLUDED overrides P6 marking the name (Deleted)', () => {
    const current = scenario().current.map((a) =>
      a.activityId === 'A-P2-TC-X10-FA-0010' ? { ...a, excludeReason: 'DELETED' as const } : a,
    );
    expect(computeModel(scenario([], [], { current })).rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0010')!.status).toBe('DELETED');
    const forced = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current }));
    expect(forced.rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0010')!.status).toBe('IN BUDGET');
  });

  it('cannot conjure a rate: forcing in an unpriced type stays REVIEW rather than budgeting zero silently', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0030', visibility: 'INCLUDED' }]));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0030')!;
    expect(r.status).toBe('REVIEW');
    expect(r.budgetHours).toBe(0);
  });

  /*
   * The reported bug: force in an activity and it appears in neither the Activity
   * Library nor Test Progress.
   *
   * Both screens list priced things. A P6 "(Deleted)" activity's type is skipped by
   * import on purpose, so it has no library key, and forcing it in moved it from
   * DELETED to REVIEW and stopped — no rate could reach it, it carried no hours, and
   * it showed up nowhere. Budget Master now creates the key in the same action; these
   * hold both halves of that.
   */
  it('a forced-in activity whose type has no key is still unpriceable, which is what made it invisible', () => {
    const deleted = scenario().current.map((a) =>
      a.activityId === 'A-P2-TC-X10-FA-0010' ? { ...a, activityType: 'Legacy Switch Test (Deleted)', excludeReason: 'DELETED' as const } : a,
    );
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current: deleted }));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.status).toBe('REVIEW');
    // Neither screen can show it: Test Progress lists IN BUDGET rows, the Library lists keys.
    expect(m.rows.filter((x) => x.status === 'IN BUDGET').map((x) => x.activityId)).not.toContain('A-P2-TC-X10-FA-0010');
    expect(m.library.some((l) => l.matchKey === 'Legacy Switch Test (Deleted)')).toBe(false);
  });

  it('with the key created, it is in the budget, in the library and in Test Progress', () => {
    const deleted = scenario().current.map((a) =>
      a.activityId === 'A-P2-TC-X10-FA-0010' ? { ...a, activityType: 'Legacy Switch Test (Deleted)', excludeReason: 'DELETED' as const } : a,
    );
    // Exactly what Budget Master now writes alongside the override.
    const library: LibraryEntry[] = [...scenario().library, { matchKey: 'Legacy Switch Test (Deleted)' }];
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current: deleted, library }));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;

    expect(r.status).toBe('IN BUDGET');
    expect(r.budgetHours).toBeGreaterThan(0);
    expect(m.rows.filter((x) => x.status === 'IN BUDGET').map((x) => x.activityId)).toContain('A-P2-TC-X10-FA-0010');
    expect(m.library.some((l) => l.matchKey === 'Legacy Switch Test (Deleted)')).toBe(true);
  });

  it('does not drag the other activities of that type in with it', () => {
    const deleted = scenario().current.map((a) =>
      a.activityId === 'A-P2-TC-X10-FA-0010' || a.activityId === 'A-P2-TC-X10-FA-0020'
        ? { ...a, activityType: 'Legacy Switch Test (Deleted)', excludeReason: 'DELETED' as const }
        : a,
    );
    const library: LibraryEntry[] = [...scenario().library, { matchKey: 'Legacy Switch Test (Deleted)' }];
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current: deleted, library }));

    expect(m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!.status).toBe('IN BUDGET');
    // Same type, same (Deleted) marker, not forced: P6's marker still keeps it out.
    const sibling = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0020')!;
    expect(sibling.status).toBe('DELETED');
    expect(sibling.budgetHours).toBe(0);
  });

  it('reports the rate it actually has, not EXCLUDED, once it is in the budget', () => {
    // The key contains "(Deleted)", which effectiveInclude reads as exclude. Saying
    // EXCLUDED on a row that IS in the budget answers a question nobody asked; what
    // the reader needs is whether the rate behind those hours is any good.
    const deleted = scenario().current.map((a) =>
      a.activityId === 'A-P2-TC-X10-FA-0010' ? { ...a, activityType: 'Legacy Switch Test (Deleted)', excludeReason: 'DELETED' as const } : a,
    );
    const library: LibraryEntry[] = [...scenario().library, { matchKey: 'Legacy Switch Test (Deleted)' }];
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current: deleted, library }));
    expect(m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!.rateStatus).toBe('DEFAULT');
  });

  it('a retired key still prices nothing, and the row says so by staying REVIEW', () => {
    const library: LibraryEntry[] = [{ ...scenario().library[0], retired: true }];
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { library }));
    expect(m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!.status).toBe('REVIEW');
  });
});

describe('renaming an activity', () => {
  it('replaces the displayed name and leaves the P6 name alone', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', nameOverride: 'Signalling proving run' }]));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.activityName).toBe('Signalling proving run');
    expect(r.renamed).toBe(true);
    expect(r.activity.activityName).toBe('[T&C] X10 (Ph2) - Test Type');
    expect(m.summary.renamed).toBe(1);
  });

  it('cannot re-price the activity, because the match key still comes from P6', () => {
    const plain = computeModel(scenario());
    const renamed = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', nameOverride: 'Something else entirely' }]));
    const r = renamed.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;
    expect(r.matchKey).toBe('Test Type');
    expect(r.budgetHours).toBe(plain.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!.budgetHours);
    expect(renamed.summary.totalBudgetHours).toBe(plain.summary.totalBudgetHours);
  });

  it('a discipline set on the activity beats the one on its library entry', () => {
    const library: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8, discipline: 'Signalling' }];
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', discipline: 'Comms' }], [], { library }));
    expect(m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!.discipline).toBe('Comms');
    expect(m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0020')!.discipline).toBe('Signalling');
  });
});

describe('edits survive a re-import', () => {
  /*
   * The whole promise of the feature. The schedule is replaced by a new export in
   * which the names, durations and dates have all moved on; the edits are keyed on
   * the Activity ID and are expected to come through untouched.
   */
  it('keeps the rename, the hidden flag and the hours override when P6 sends everything else back different', () => {
    const edits: ActivityOverride[] = [
      { activityId: 'A-P2-TC-X10-FA-0010', nameOverride: 'Signalling proving run', overrideHours: 400, note: 'agreed with the client' },
      { activityId: 'A-P2-TC-X10-FA-0030', visibility: 'HIDDEN' },
    ];
    const reimported: P6Activity[] = [
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', activityName: '[T&C] X10 (Ph2) - Test Type', originalDuration: 25, startDate: '2026-08-01', actualStart: true, sortOrder: 0 }),
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0020', activityName: '[T&C] X10 (Ph2) - Test Type', originalDuration: 30, sortOrder: 1 }),
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0030', activityName: '[T&C] X10 (Ph2) - Unpriced Type', activityType: 'Unpriced Type', originalDuration: 99, sortOrder: 2 }),
    ];
    const m = computeModel(scenario(edits, [], { current: reimported }));
    const r = m.rows.find((x) => x.activityId === 'A-P2-TC-X10-FA-0010')!;

    expect(r.activityName).toBe('Signalling proving run');
    expect(r.overrideHours).toBe(400);
    expect(r.budgetHours).toBe(400);
    // P6 still owns the duration and the dates, which is what makes the import worth doing.
    expect(r.activity.originalDuration).toBe(25);
    expect(r.earnStart).toBe('2026-08-01');
    expect(m.summary.hidden).toBe(1);
    expect(m.summary.review).toBe(0);
  });

  it('reports an edit whose Activity ID left the schedule instead of dropping it', () => {
    const m = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-9999', nameOverride: 'gone', note: 'renumbered' }]));
    expect(m.staleOverrides).toHaveLength(1);
    expect(m.staleOverrides[0]).toMatchObject({ activityId: 'A-P2-TC-X10-FA-9999', renamed: true, hasHours: false, note: 'renumbered' });
    expect(m.summary.staleOverrides).toBe(1);
  });
});

describe('test progress checks say what a keyed row actually is', () => {
  const keyed = (activityId: string): TestProgress => ({ activityId, testsTotal: 10, testsComplete: 4, updatedAt: '2026-08-01T00:00:00Z' });

  it('an ID in no schedule is named as such and carries what would be lost', () => {
    const c = computeModel(scenario([], [keyed('A-P2-TC-X10-FA-9999')])).testProgressChecks[0];
    expect(c.status).toBe('not in extract');
    expect(c.inBudget).toBe(false);
    expect(c.activityName).toBeNull();
    expect(c.testsTotal).toBe(10);
    expect(c.testsComplete).toBe(4);
    expect(c.reason).toMatch(/No activity with this ID is in the current schedule/i);
  });

  it('an unpriced activity is reported as a library problem, not as junk to delete', () => {
    const c = computeModel(scenario([], [keyed('A-P2-TC-X10-FA-0030')])).testProgressChecks[0];
    expect(c.status).toBe('REVIEW');
    expect(c.activityName).toBe('[T&C] X10 (Ph2) - Unpriced Type');
    expect(c.activityType).toBe('Unpriced Type');
    expect(c.location).toBe('X10');
    expect(c.reason).toMatch(/Do not remove it/);
  });

  it('a hidden activity says so, rather than looking like a mistyped ID', () => {
    const c = computeModel(scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'HIDDEN' }], [keyed('A-P2-TC-X10-FA-0010')])).testProgressChecks[0];
    expect(c.status).toBe('hidden');
    expect(c.activityName).toBe('[T&C] X10 (Ph2) - Test Type');
    expect(c.reason).toMatch(/You hid this activity/);
  });

  it('a budgeted activity is not a finding at all', () => {
    const c = computeModel(scenario([], [keyed('A-P2-TC-X10-FA-0010')])).testProgressChecks[0];
    expect(c.inBudget).toBe(true);
    expect(c.budgetHours).toBe(160);
    expect(c.reason).toBe('');
  });

  it('carries the renamed name, and the P6 one it replaced', () => {
    const c = computeModel(
      scenario([{ activityId: 'A-P2-TC-X10-FA-0010', nameOverride: 'Signalling proving run' }], [keyed('A-P2-TC-X10-FA-0010')]),
    ).testProgressChecks[0];
    expect(c.activityName).toBe('Signalling proving run');
    expect(c.p6Name).toBe('[T&C] X10 (Ph2) - Test Type');
  });
});

describe('the fixture model is unchanged by the feature existing', () => {
  it('still computes with no overrides of the new kind', () => {
    const m = computeModel(fixtureModelInput());
    expect(m.hiddenRows).toEqual([]);
    expect(m.summary.hidden).toBe(0);
    expect(m.rows.every((r) => r.visibility === null && !r.renamed)).toBe(true);
    // The display name falls back to P6's, so every screen reading it is safe.
    expect(m.rows.every((r) => r.activityName === r.activity.activityName)).toBe(true);
  });
});

describe('no key ever widens itself', () => {
  /*
   * The removed tier 2. It dropped an activity type's last bracketed phrase and
   * retried, so one key could price variants nobody had looked at. These hold the
   * removal: a near-miss prices nothing, and says so as REVIEW rather than quietly
   * borrowing a rate from a shorter key.
   */
  const priced: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'DUR', crewSize: 2, shiftHours: 8 }];

  it('a type that only differs by a trailing bracket is REVIEW, not priced', () => {
    const current: P6Activity[] = [
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', activityName: '[T&C] X10 (Ph2) - Test Type', sortOrder: 0 }),
      makeActivity({
        activityId: 'A-P2-TC-X10-FA-0020',
        activityName: '[T&C] X10 (Ph2) - Test Type (DF: X10 → Y20)',
        activityType: 'Test Type (DF: X10 → Y20)',
        sortOrder: 1,
      }),
    ];
    const m = computeModel(scenario([], [], { library: priced, current }));
    const exact = m.rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0010')!;
    const variant = m.rows.find((r) => r.activityId === 'A-P2-TC-X10-FA-0020')!;

    expect(exact.status).toBe('IN BUDGET');
    expect(exact.budgetHours).toBe(160);
    expect(variant.status).toBe('REVIEW');
    expect(variant.budgetHours).toBe(0);
    // It keeps its own spelling, so the REVIEW row names the type that needs pricing.
    expect(variant.matchKey).toBe('Test Type (DF: X10 → Y20)');
  });

  it('pricing the variant in its own right is what fixes it', () => {
    const current: P6Activity[] = [
      makeActivity({
        activityId: 'A-P2-TC-X10-FA-0020',
        activityName: '[T&C] X10 (Ph2) - Test Type (DF: X10 → Y20)',
        activityType: 'Test Type (DF: X10 → Y20)',
        sortOrder: 0,
      }),
    ];
    const library: LibraryEntry[] = [...priced, { matchKey: 'Test Type (DF: X10 → Y20)', basis: 'DUR', crewSize: 2, shiftHours: 8 }];
    const m = computeModel(scenario([], [], { library, current }));
    expect(m.rows[0].status).toBe('IN BUDGET');
    expect(m.rows[0].budgetHours).toBe(160);
  });

  it('a retired key prices nothing at all, rather than falling back to a shorter one', () => {
    const current: P6Activity[] = [
      makeActivity({ activityId: 'A-P2-TC-X10-FA-0010', activityName: '[T&C] X10 (Ph2) - Test Type', sortOrder: 0 }),
    ];
    const library: LibraryEntry[] = [{ ...priced[0], retired: true }];
    const m = computeModel(scenario([], [], { library, current }));
    expect(m.rows[0].status).toBe('REVIEW');
    expect(m.rows[0].budgetHours).toBe(0);
  });
});

describe('a forced-in activity has to end up with hours', () => {
  /*
   * "Forced in" that allocates nothing is the failure that looks like success: the
   * row says IN BUDGET, it appears on Test Progress, and it contributes zero to
   * every total. Three things cause it, and none is visible from the row.
   */
  const deletedType = 'Dead Type (Deleted)';
  const forced = (settings: Partial<Settings>, od: number | null, library: LibraryEntry[]) => {
    const current: P6Activity[] = [
      makeActivity({
        activityId: 'A-P2-TC-X10-FA-0010',
        activityName: `[T&C] X10 (Ph2) - ${deletedType}`,
        activityType: deletedType,
        excludeReason: 'DELETED',
        originalDuration: od,
        remainingDuration: od,
        sortOrder: 0,
      }),
    ];
    return computeModel({
      ...scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED' }], [], { current, library }),
      settings: { ...settings, ...scenarioSettings, ...settings },
    });
  };
  const scenarioSettings = { ...settings };

  it('a bare key under a RATE default prices it at zero, which is why the key names its basis', () => {
    const rate: Partial<Settings> = { defaultBasis: 'RATE' };
    // What a bare `{ matchKey }` would have done.
    const bare = forced(rate, 10, [{ matchKey: deletedType }]);
    expect(bare.rows[0].status).toBe('IN BUDGET');
    expect(bare.rows[0].budgetHours).toBe(0);

    // What Budget Master actually writes now.
    const withBasis = forced(rate, 10, [{ matchKey: deletedType, basis: 'DUR' }]);
    expect(withBasis.rows[0].budgetHours).toBeGreaterThan(0);
  });

  it('says NEEDS SHIFTS rather than DEFAULT for a RATE entry that has none', () => {
    // DEFAULT is a reassuring word for an entry that prices every activity at zero.
    const m = forced({ defaultBasis: 'RATE' }, 10, [{ matchKey: deletedType }]);
    expect(m.rows[0].rateStatus).toBe('NEEDS SHIFTS');
  });

  it('a zero P6 duration still prices at zero, and is counted so it can be found', () => {
    const m = forced({ defaultBasis: 'DUR' }, 0, [{ matchKey: deletedType, basis: 'DUR' }]);
    expect(m.rows[0].status).toBe('IN BUDGET');
    expect(m.rows[0].budgetHours).toBe(0);
    expect(m.summary.forcedInUnpriced).toBe(1);
  });

  it('an hours override prices it whatever the library can or cannot do', () => {
    const current: P6Activity[] = [
      makeActivity({
        activityId: 'A-P2-TC-X10-FA-0010',
        activityName: `[T&C] X10 (Ph2) - ${deletedType}`,
        activityType: deletedType,
        excludeReason: 'DELETED',
        originalDuration: 0,
        sortOrder: 0,
      }),
    ];
    const m = computeModel(
      scenario([{ activityId: 'A-P2-TC-X10-FA-0010', visibility: 'INCLUDED', overrideHours: 24 }], [], {
        current,
        library: [{ matchKey: deletedType, basis: 'DUR' }],
      }),
    );
    expect(m.rows[0].budgetHours).toBe(24);
    expect(m.summary.forcedInUnpriced).toBe(0);
  });

  it('counts nothing when the forced-in activity is properly priced', () => {
    const m = forced({ defaultBasis: 'DUR' }, 10, [{ matchKey: deletedType, basis: 'DUR' }]);
    expect(m.summary.forcedInUnpriced).toBe(0);
    expect(m.rows[0].budgetHours).toBeGreaterThan(0);
  });
});

describe('a location with no activities is not a location anybody needs to see', () => {
  /*
   * Import discovers a location the moment one Activity ID mentions it and never
   * removes it, so a code can outlive every activity that used it. Keeping it in
   * the file is right; listing it is not.
   */
  const withLocations = (locations: { code: string }[]) =>
    computeModel(scenario([], [], { locations }));

  it('leaves an unused code out of the list and out of the count', () => {
    const m = withLocations([{ code: 'X10' }, { code: 'GHOST' }]);
    expect(m.locations.map((l) => l.code)).toEqual(['X10']);
    expect(m.summary.locations).toBe(1);
  });

  it('still says it exists, rather than appearing to have lost it', () => {
    const m = withLocations([{ code: 'X10' }, { code: 'GHOST' }]);
    expect(m.unusedLocations.map((l) => l.code)).toEqual(['GHOST']);
    expect(m.unusedLocations[0].count).toBe(0);
  });

  it('drops a code whose only activities were hidden', () => {
    const hidden = computeModel(
      scenario(
        [
          { activityId: 'A-P2-TC-X10-FA-0010', visibility: 'HIDDEN' },
          { activityId: 'A-P2-TC-X10-FA-0020', visibility: 'HIDDEN' },
          { activityId: 'A-P2-TC-X10-FA-0030', visibility: 'HIDDEN' },
        ],
        [],
        { locations: [{ code: 'X10' }] },
      ),
    );
    expect(hidden.locations).toEqual([]);
    expect(hidden.unusedLocations.map((l) => l.code)).toEqual(['X10']);
    expect(hidden.summary.locations).toBe(0);
  });

  it('keeps a used one whatever else is in the file', () => {
    const m = withLocations([{ code: 'GHOST' }, { code: 'X10' }, { code: 'ALSO-GONE' }]);
    expect(m.locations).toHaveLength(1);
    expect(m.locations[0].count).toBeGreaterThan(0);
  });
});

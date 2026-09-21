/**
 * Exceptions to how an Activity ID is read.
 *
 * The ID is parsed positionally, and a schedule that does not follow the convention
 * used to leave two options: mis-report it forever, or hard-code the exception in
 * the parser. These pin the third — the exception as data, applied as a lens over
 * an import that is never rewritten.
 */
import { describe, it, expect } from 'vitest';
import { computeModel } from '../src/engine/compute';
import { matchIdRule, normalisePhaseValue, locationOf, phaseOf } from '../src/engine/parse';
import { DEFAULT_SETTINGS, type IdRule, type LibraryEntry } from '../src/engine/types';
import { makeActivity } from './helpers';

const S = { ...DEFAULT_SETTINGS, dataDate: '2026-08-31' };
const lib: LibraryEntry[] = [{ matchKey: 'Test Type', basis: 'RATE', crewSize: 2, shiftHours: 10, durationShifts: 4 }];
const rule = (r: Partial<IdRule> & Pick<IdRule, 'match' | 'field' | 'value'>): IdRule => ({ id: r.match + r.field, ...r });

const build = (ids: string[], idRules: IdRule[] = [], locations: { code: string; complexityFactor?: number }[] = []) =>
  computeModel({
    settings: S,
    locations,
    library: lib,
    overrides: [],
    testProgress: [],
    idRules,
    // `location` is derived from the ID at parse time, so the fixture has to do the
    // same or the rules would be tested against a location nothing spelled.
    current: ids.map((activityId, i) =>
      makeActivity({ activityId, sortOrder: i, originalDuration: 10, remainingDuration: 10, location: locationOf(activityId) }),
    ),
    baseline: null,
  });

describe('matching an ID against the rules', () => {
  const rules = [rule({ match: 'HTT', field: 'location', value: 'HTT' }), rule({ match: 'LMA', field: 'phase', value: '1' })];

  it('finds the text anywhere in the ID, whatever its case', () => {
    expect(matchIdRule('0-P2-TC-htt-FA-0010', 'location', rules)?.value).toBe('HTT');
    expect(matchIdRule('X-LMA-99', 'phase', rules)?.value).toBe('1');
  });

  it('answers only for the field it was asked about', () => {
    expect(matchIdRule('0-P2-TC-HTT-FA-0010', 'phase', rules)).toBeNull();
  });

  it('lets the first rule win, so a specific one can sit above a general one', () => {
    const ordered = [
      rule({ match: 'HTT-N', field: 'location', value: 'HTT NORTH' }),
      rule({ match: 'HTT', field: 'location', value: 'HTT' }),
    ];
    expect(matchIdRule('0-P2-TC-HTT-N-FA-0010', 'location', ordered)?.value).toBe('HTT NORTH');
    expect(matchIdRule('0-P2-TC-HTT-S-FA-0010', 'location', ordered)?.value).toBe('HTT');
  });

  it('ignores a rule that has been switched off', () => {
    expect(matchIdRule('0-P2-TC-HTT-FA-0010', 'location', [rule({ match: 'HTT', field: 'location', value: 'HTT', disabled: true })])).toBeNull();
  });

  it('ignores a rule with nothing to match on, rather than matching everything', () => {
    // '' is a substring of every string. A blank rule catching the whole schedule
    // is the worst thing a half-typed row could do.
    expect(matchIdRule('0-P2-TC-A10-FA-0010', 'location', [rule({ match: '  ', field: 'location', value: 'X' })])).toBeNull();
  });

  it('reads a phase typed as a bare number the way it was meant', () => {
    expect(normalisePhaseValue('1')).toBe('P1');
    expect(normalisePhaseValue('P1')).toBe('P1');
    expect(normalisePhaseValue(' Commissioning ')).toBe('Commissioning');
  });
});

describe('what a rule changes about the model', () => {
  it('puts every ID containing HTT at the HTT location', () => {
    const ids = ['0-P2-TC-A10-FA-0010', '0-P2-TC-HTT-FA-0020', '0-P2-HTT-B20-FA-0030'];
    const m = build(ids, [rule({ match: 'HTT', field: 'location', value: 'HTT' })]);
    expect(m.rows.map((r) => r.location)).toEqual(['A10', 'HTT', 'HTT']);
    expect(m.rows.map((r) => r.locationFromRule)).toEqual([false, true, true]);
  });

  it('puts every ID containing LMA in Phase 1', () => {
    const m = build(['0-P2-TC-A10-FA-0010', '0-P9-TC-LMA-FA-0020'], [rule({ match: 'LMA', field: 'phase', value: '1' })]);
    expect(m.rows.map((r) => r.phase)).toEqual(['P2', 'P1']);
    expect(m.rows.map((r) => r.phaseName)).toEqual(['Phase 2', 'Phase 1']);
    expect(m.rows[1].phaseFromRule).toBe(true);
  });

  it('rolls the activity up where the rule put it, not where the ID says', () => {
    const m = build(['0-P2-TC-A10-FA-0010', '0-P2-TC-B20-FA-0020'], [rule({ match: 'B20', field: 'location', value: 'HTT' })]);
    const byLoc = Object.fromEntries(m.groups.location.map((g) => [g.key, g.budgetHours]));
    expect(Object.keys(byLoc).sort()).toEqual(['A10', 'HTT']);
    expect(m.groups.location.reduce((s, g) => s + g.budgetHours, 0)).toBe(m.summary.totalBudgetHours);
  });

  it('lists a location the rule invented, so it can be named and priced', () => {
    // locations.json only ever learns codes discovery found. A code rows group
    // under but that appears in no list would be missing from the Locations screen.
    const m = build(['0-P2-TC-A10-FA-0010', '0-P2-TC-XYZ-FA-0020'], [rule({ match: 'XYZ', field: 'location', value: 'HTT' })], [{ code: 'A10' }]);
    expect(m.locations.map((l) => l.code).sort()).toEqual(['A10', 'HTT']);
    expect(m.locations.find((l) => l.code === 'HTT')!.count).toBe(1);
  });

  it('prices the activity at the complexity of the location it was moved to', () => {
    // The factor is looked up by location, so the rule has to land before the rate
    // is picked rather than after it.
    const rules = [rule({ match: 'B20', field: 'location', value: 'C30' })];
    const locs = [{ code: 'A10' }, { code: 'C30', complexityFactor: 2 }];
    const m = build(['0-P2-TC-A10-FA-0010', '0-P2-TC-B20-FA-0020'], rules, locs);
    const moved = m.rows.find((r) => r.activityId === '0-P2-TC-B20-FA-0020')!;
    const plain = m.rows.find((r) => r.activityId === '0-P2-TC-A10-FA-0010')!;
    expect(moved.complexity).toBe(2);
    expect(moved.budgetHours).toBe(plain.budgetHours * 2);
  });

  it('leaves the import exactly as P6 wrote it', () => {
    const m = build(['0-P2-TC-B20-FA-0020'], [rule({ match: 'B20', field: 'location', value: 'HTT' })]);
    const row = m.rows[0];
    expect(row.location).toBe('HTT');
    // The activity underneath still says what the schedule said. A rule is a lens,
    // not an edit: removing it puts everything back with no re-import.
    expect(row.activity.location).toBe('B20');
    expect(locationOf(row.activity.activityId)).toBe('B20');
    expect(phaseOf(row.activity.activityId)).toBe('P2');
  });

  it('changes nothing at all when there are no rules', () => {
    const ids = ['0-P2-TC-A10-FA-0010', '0-P7-TC-B20-FA-0020'];
    const withNone = build(ids);
    const withOff = build(ids, [rule({ match: 'A10', field: 'location', value: 'ZZZ', disabled: true })]);
    expect(withOff.rows.map((r) => r.location)).toEqual(withNone.rows.map((r) => r.location));
    expect(withOff.rows.every((r) => !r.locationFromRule && !r.phaseFromRule)).toBe(true);
  });
});

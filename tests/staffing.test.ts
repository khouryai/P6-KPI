/**
 * When does the work finish, with this many people?
 *
 * The figures here are easy to check by hand: one person gives 40 h a week to one
 * activity at most (160 × 12 / 52 ≈ 36.9 h gross, so the tests key 173.33 h a month
 * to make it exactly 40), and utilisation 1 so the pool and the pace agree.
 */
import { describe, it, expect } from 'vitest';
import type { BudgetRow } from '../src/engine/types';
import { FULL_SCOPE, groupByType, outOfScope, peopleNeeded, peopleOn, plannedRemaining, simulate, staffingTasks, type StaffScenario, type StaffingOptions } from '../src/engine/staffing';

const HPM = (40 * 52) / 12; // 173.33 h a month = 40 h a week
const opts: StaffingOptions = { group: 'IXL', dataDate: '2026-10-01', efficiency: 1, hoursPerPersonPerMonth: HPM, utilisation: 1 };

function row(id: string, hours: number, start: string, finish: string, extra: Partial<BudgetRow> = {}): BudgetRow {
  const pct = extra.pctComplete ?? 0;
  return {
    activityId: id,
    activityName: id,
    matchKey: 'Test',
    activityType: 'Test',
    phase: 'P1',
    phaseName: 'Phase 1',
    workType: 'TC',
    location: 'X',
    disciplines: ['IXL'],
    status: 'IN BUDGET',
    actualStart: null,
    actualFinish: null,
    pctComplete: pct,
    currentStart: start,
    currentFinish: finish,
    baselineStart: null,
    baselineFinish: null,
    subsystemHours: { IXL: hours },
    subsystemEarned: { IXL: hours * pct },
    resources: [{ code: 'IXL', label: 'IXL', count: 1, shiftHours: 8, budgetHours: hours, earnedHours: hours * pct }],
    ...extra,
  } as BudgetRow;
}

const team = (people: number, changes: StaffScenario['changes'] = []): StaffScenario => ({ id: String(people), name: `${people}`, people, changes });

describe('the work to model', () => {
  it('takes only this group’s share, and only what is left of it', () => {
    const r = row('A', 100, '2026-10-01', '2026-12-01', {
      pctComplete: 0.25,
      subsystemHours: { IXL: 60, ATS: 40 },
      subsystemEarned: { IXL: 15, ATS: 10 },
    });
    const [t] = staffingTasks([r], opts);
    expect(t.remainingBudget).toBe(45);
  });

  it('scales effort by the efficiency factor', () => {
    const [t] = staffingTasks([row('A', 80, '2026-10-01', '2026-12-01')], { ...opts, efficiency: 0.8 });
    expect(t.effortHours).toBeCloseTo(100);
  });

  it('calls work backlog when its planned finish is before the data date, and puts it first', () => {
    const ts = staffingTasks(
      [row('LATER', 40, '2026-10-05', '2026-10-20'), row('OLD', 40, '2026-08-01', '2026-09-01'), row('OLDER', 40, '2026-07-01', '2026-08-01')],
      opts,
    );
    expect(ts.map((t) => [t.activityId, t.backlog])).toEqual([
      ['OLDER', true],
      ['OLD', true],
      ['LATER', false],
    ]);
  });

  it('leaves out finished, excluded and other groups’ work', () => {
    const ts = staffingTasks(
      [
        row('DONE', 40, '2026-08-01', '2026-09-01', { actualFinish: '2026-09-01' }),
        row('OUT', 40, '2026-08-01', '2026-09-01', { status: 'EXCLUDED' }),
        row('ATS', 40, '2026-08-01', '2026-09-01', { subsystemHours: { ATS: 40 }, subsystemEarned: {} }),
      ],
      opts,
    );
    expect(ts).toHaveLength(0);
  });
});

describe('headcount over time', () => {
  it('adds dated changes to the starting figure, and never goes below nobody', () => {
    const s = team(4, [
      { id: 'a', from: '2027-03-01', delta: 2 },
      { id: 'b', from: '2027-06-01', delta: -10 },
    ]);
    expect(peopleOn('2027-02-28', s)).toBe(4);
    expect(peopleOn('2027-03-01', s)).toBe(6);
    expect(peopleOn('2027-06-01', s)).toBe(0);
  });
});

describe('laying the work against the people', () => {
  // Eight one-person backlog activities of 80 h: 640 h, two weeks of work each.
  const backlog = Array.from({ length: 8 }, (_, i) => row(`B${i}`, 80, '2026-08-01', '2026-09-15'));

  it('clears backlog twice as fast with twice the people', () => {
    const tasks = staffingTasks(backlog, opts);
    const eight = simulate(tasks, team(8), opts);
    const four = simulate(tasks, team(4), opts);
    // 640 h at 320 h a week is 14 days; at 160 h a week, 28.
    expect(eight.backlogClear).toBe('2026-10-14');
    expect(four.backlogClear).toBe('2026-10-28');
  });

  it('does not let a crowd finish a one-person activity faster than one person can', () => {
    const tasks = staffingTasks([row('A', 80, '2026-10-01', '2026-10-14')], opts);
    expect(simulate(tasks, team(8), opts).finish).toBe('2026-10-14');
  });

  it('finishes on its planned date with people to spare, whatever the hours a person gives', () => {
    // 10 working days of a 2-person crew at 8 h: 160 h over a 14-day window. A
    // month of 160 h at 80% is far less than 40 h a week, and still it must not slip.
    const r2 = row('P', 160, '2026-10-01', '2026-10-14', { resources: [{ code: 'IXL', label: 'IXL', count: 2, shiftHours: 8, budgetHours: 160, earnedHours: 0 }] });
    const o = { ...opts, hoursPerPersonPerMonth: 160, utilisation: 0.8 };
    const r = simulate(staffingTasks([r2], o), team(8), o);
    expect(r.finish).toBe('2026-10-14');
  });

  it('runs late at an efficiency below 1.0 however many people there are', () => {
    const o = { ...opts, efficiency: 0.5 };
    const r = simulate(staffingTasks([row('A', 80, '2026-10-01', '2026-10-14')], o), team(8), o);
    expect(r.finish).toBe('2026-10-28');
  });

  it('does not start future work before its planned start', () => {
    const tasks = staffingTasks([row('F', 40, '2026-11-01', '2026-11-07')], opts);
    const r = simulate(tasks, team(8), opts);
    expect(r.finish).toBe('2026-11-07');
    expect(r.slipDays).toBe(0);
  });

  it('brings the finish in when support is added later', () => {
    const tasks = staffingTasks(backlog, opts);
    const four = simulate(tasks, team(4), opts);
    const boosted = simulate(tasks, team(4, [{ id: 'x', from: '2026-10-08', delta: 4 }]), opts);
    expect(boosted.finish! < four.finish!).toBe(true);
    // Four are half done after the first week. The other four are one-person jobs of
    // 80 h, so even with eight people they take two more weeks: 21 Oct, not 28.
    expect(boosted.finish).toBe('2026-10-21');
  });

  it('says never when nobody is left to do the work', () => {
    const tasks = staffingTasks(backlog, opts);
    const r = simulate(tasks, team(0), opts);
    expect(r.finish).toBeNull();
    expect(r.backlogClear).toBeNull();
  });

  it('reports how late each activity runs against its own planned finish', () => {
    const tasks = staffingTasks([row('A', 80, '2026-10-01', '2026-10-07'), row('B', 40, '2026-10-01', '2026-10-31')], opts);
    const r = simulate(tasks, team(1), opts);
    const a = r.tasks.find((t) => t.activityId === 'A')!;
    expect(a.forecastFinish).toBe('2026-10-14');
    expect(a.slipDays).toBe(7);
    expect(r.lateTasks).toBe(1);
  });
});

describe('people needed to hold the planned finish', () => {
  it('finds the smallest headcount that finishes on time', () => {
    // 1,280 h of future work over four weeks needs 8 people at 40 h a week.
    const rows = Array.from({ length: 16 }, (_, i) => row(`W${i}`, 80, '2026-10-01', '2026-10-28'));
    const tasks = staffingTasks(rows, opts);
    expect(peopleNeeded(tasks, opts, '2026-10-28')).toBe(8);
  });

  it('says none can when the date has already gone', () => {
    const tasks = staffingTasks([row('B', 80, '2026-08-01', '2026-09-01')], opts);
    expect(peopleNeeded(tasks, opts, '2026-09-01')).toBeNull();
  });
});

describe('what the schedule expects to be left', () => {
  it('spreads each activity over its window and counts backlog as already due', () => {
    const tasks = staffingTasks([row('F', 100, '2026-10-01', '2026-10-11'), row('B', 50, '2026-08-01', '2026-09-01')], opts);
    const [now, mid, end] = plannedRemaining(tasks, ['2026-10-01', '2026-10-06', '2026-10-11'], opts.dataDate);
    expect(now.remaining).toBe(100);
    expect(mid.remaining).toBe(50);
    expect(end.remaining).toBe(0);
  });
});

describe('what is in the analysis', () => {
  const ats = (id: string, loc = 'X') =>
    row(id, 100, '2026-10-01', '2026-12-01', {
      location: loc,
      matchKey: 'ATS Test',
      disciplines: ['ATS'],
      subsystemHours: { ATS: 60, IXL: 40 },
      subsystemEarned: {},
      resources: [
        { code: 'ATS', label: 'ATS', count: 3, shiftHours: 8, budgetHours: 60, earnedHours: 0 },
        { code: 'IXL', label: 'IXL', count: 2, shiftHours: 8, budgetHours: 40, earnedHours: 0 },
      ],
    });

  it('calls an activity this group’s own when its Subsystem names it, and support when it names another', () => {
    const ts = staffingTasks([row('MINE', 80, '2026-10-01', '2026-10-14'), ats('THEIRS')], opts);
    expect(ts.map((t) => [t.activityId, t.role, t.remainingBudget])).toEqual([
      ['MINE', 'own', 80],
      ['THEIRS', 'support', 40],
    ]);
  });

  it('treats an activity with no Subsystem as own when this group is its whole crew', () => {
    const [t] = staffingTasks([row('A', 80, '2026-10-01', '2026-10-14', { disciplines: [] })], opts);
    expect(t.role).toBe('own');
  });

  it('leaves support out when asked, and filters by phase, work type, location and type', () => {
    const ts = staffingTasks([row('MINE', 80, '2026-10-01', '2026-10-14'), ats('THEIRS')], opts);
    const [mine, theirs] = ts;
    expect(outOfScope(theirs, { ...FULL_SCOPE, includeSupport: false })).toBe('support');
    expect(outOfScope(mine, { ...FULL_SCOPE, includeSupport: false })).toBeNull();
    expect(outOfScope(mine, { ...FULL_SCOPE, workType: 'AC' })).toBe('work type');
    expect(outOfScope(mine, { ...FULL_SCOPE, phase: 'P2' })).toBe('phase');
    expect(outOfScope(mine, { ...FULL_SCOPE, location: 'Y' })).toBe('location');
    expect(outOfScope(mine, { ...FULL_SCOPE, excludedTypes: ['test'] })).toBe('type');
  });

  it('keeps only work due by the end date, and backlog always', () => {
    const ts = staffingTasks(
      [row('EARLY', 40, '2026-10-01', '2026-10-20'), row('LATE', 40, '2027-03-01', '2027-04-01'), row('OLD', 40, '2026-08-01', '2026-09-01')],
      opts,
    );
    const scope = { ...FULL_SCOPE, finishBy: '2026-12-31' };
    expect(ts.filter((t) => !outOfScope(t, scope)).map((t) => t.activityId).sort()).toEqual(['EARLY', 'OLD']);
  });

  it('judges slip against the end date when one is set', () => {
    const tasks = staffingTasks([row('A', 80, '2026-10-01', '2026-10-14')], opts);
    const r = simulate(tasks, team(1), { ...opts, finishBy: '2026-10-31' });
    expect(r.plannedFinish).toBe('2026-10-31');
    expect(r.slipDays).toBe(-17);
  });

  it('groups an activity type repeated across locations into one line', () => {
    const groups = groupByType(staffingTasks([ats('T1', 'A10'), ats('T2', 'B20'), row('MINE', 80, '2026-10-01', '2026-10-14')], opts));
    const g = groups.find((x) => x.activityType === 'ATS Test')!;
    expect(g.tasks).toHaveLength(2);
    expect(g.locations).toEqual(['A10', 'B20']);
    expect(g.effortHours).toBe(80);
    expect(g.role).toBe('support');
    expect(g.owner).toBe('ATS');
  });
});

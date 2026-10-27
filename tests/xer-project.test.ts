/**
 * The whole P6 project out of an XER: the file read right, the model built right,
 * and the T&C slice of it exactly what the budget has always read.
 *
 * fixtures/full-project.xer is a whole programme in miniature — construction,
 * installation, T&C and milestones with the logic between them, a calendar with a
 * lunch break and holidays, resources, codes, user fields, a notebook and a
 * baseline project — written in Windows-1252 the way P6 writes it on a desktop.
 * It is rebuilt with `node scripts/build-p6-fixture.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeXer, memoText, parseXerDate, scanXerSync, msToDate } from '../src/engine/xerText';
import {
  readProject,
  readProjectAsync,
  wbsPathName,
  wbsCode,
  codeTypesInUse,
  udfTypesInUse,
  totalFloatDays,
  isCritical,
  p6Percent,
  assignmentLines,
  tasksOf,
  type P6Project,
  type P6Task,
} from '../src/engine/xerProject';
import { makeCalendar, parseCalendarData, workMinutes, workDays, weekHours, holidaysBetween } from '../src/engine/xerCalendar';
import { linkState, predecessorsOf, openPredecessors, trace, readiness, scheduleChecks, resourceSummaries, monthlyLoading } from '../src/engine/xerLogic';
import {
  DEFAULT_SCOPE,
  compareScope,
  describeScope,
  normalizeScope,
  ownerOf,
  projectRoles,
  proposeScope,
  scopeTest,
  scopedActivities,
  segmentCounts,
  segmentOf,
} from '../src/engine/xerScope';
import { buildOutline, makeTaskFilter, type OutlineGroup } from '../src/engine/xerOutline';
import { parseXer, xerToActivities } from '../src/engine/xer';
import { diffSchedules } from '../src/engine/scheduleDiff';
import { computeModel } from '../src/engine/compute';
import { FIXTURE_DIR, fixtureModelInput, loadFixtureWorkbook } from './helpers';

const bytes = new Uint8Array(readFileSync(resolve(FIXTURE_DIR, 'full-project.xer')));
const { text, encoding } = decodeXer(bytes);
const model = readProject(text);
const main = model.projects.find((p) => p.shortName === 'CBTC-PH2')!;
const byCode = (code: string, proj = main.uid): P6Task => model.tasks.find((t) => t.code === code && t.projUid === proj)!;
const DAY = 86_400_000;

describe('reading the file', () => {
  it('reads Windows-1252 as Windows-1252, so dashes survive', () => {
    expect(encoding).toBe('windows-1252');
    expect(byCode('0-P2-CN-A10-FA-0010').name).toBe('A10 – Cable trough install');
    expect(model.calendars.get('1')!.name).toBe('Standard 5 Day (lunch 12–13)');
  });

  it('reads UTF-8 as UTF-8, with or without a byte order mark', () => {
    const utf = new TextEncoder().encode('ERMHDR\t19.12\n%T\tTASK\n%F\ttask_id\ttask_name\n%R\t1\tA10 – Café\n%E\n');
    expect(decodeXer(utf)).toMatchObject({ encoding: 'utf-8' });
    expect(decodeXer(utf).text).toContain('A10 – Café');
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf]);
    expect(decodeXer(bom).text.startsWith('ERMHDR')).toBe(true);
  });

  it('reads the header and counts every table, read or not', () => {
    expect(model.header).toMatchObject({ version: '19.12', exportDate: '2026-09-14', user: 'Sample Scheduler', login: 'admin', currency: 'USD' });
    const rows = Object.fromEntries(model.tableRows.map((t) => [t.name, t.rows]));
    expect(rows).toMatchObject({ CURRTYPE: 1, CALENDAR: 2, PROJECT: 2, TASK: 25, TASKPRED: 19, TASKRSRC: 9, TASKMEMO: 1 });
  });

  it('joins a row whose text carried a real line break back into one row', () => {
    const t = ['%T\tTASKMEMO', '%F\ttask_id\tmemo_type_id\ttask_memo', '%R\t1\t9\t<p>first line', 'second line</p>', '%R\t2\t9\tthird', '%E'].join('\r\n');
    const seen: string[][] = [];
    scanXerSync(t, { TASKMEMO: () => (r) => seen.push(r) });
    expect(seen).toEqual([
      ['1', '9', '<p>first line\nsecond line</p>'],
      ['2', '9', 'third'],
    ]);
  });

  it('reads the same project in steps as in one go', async () => {
    let calls = 0;
    const stepped = await readProjectAsync(text, {}, () => calls++);
    expect(calls).toBeGreaterThan(0);
    expect(stepped.tasks.map((t) => [t.code, t.start, t.finish, t.tfHrs])).toEqual(model.tasks.map((t) => [t.code, t.start, t.finish, t.tfHrs]));
    expect(stepped.rels.length).toBe(model.rels.length);
  });

  it('reads P6 date-times without letting a time zone move them', () => {
    expect(parseXerDate('2026-09-14 08:00')).toBe(Date.UTC(2026, 8, 14, 8, 0));
    expect(parseXerDate('2026-09-14')).toBe(Date.UTC(2026, 8, 14));
    expect(parseXerDate('')).toBeNull();
    expect(parseXerDate('garbage')).toBeNull();
    expect(msToDate(Date.UTC(2026, 8, 14, 23, 59))).toBe('2026-09-14');
  });

  it('turns a notebook into plain text, and never keeps a script', () => {
    const memo = model.taskMemos.get('3024')!;
    expect(memo).toHaveLength(1);
    expect(memo[0].type).toBe('Scope');
    expect(memo[0].text).toBe('Core network test for B20 – needs 2 nights.\n\n• Zone controller installed first\n• Access: nights & weekends only');
    expect(memoText('<b>a</b>&lt;b&gt;&#39;x&#39;<script>alert(1)</script><style>p{}</style>')).toBe("a<b>'x'");
  });
});

describe('the project model', () => {
  it('names the projects from their WBS, with the data date P6 last scheduled to', () => {
    expect(main.name).toBe('CBTC Phase 2 (sample)');
    expect(main.dataDate).toBe(Date.UTC(2026, 8, 14, 8, 0));
    expect(main.taskCount).toBe(20);
    expect(main.criticalBy).toBe('FLOAT');
    const bl = model.projects.find((p) => p.shortName === 'CBTC-PH2-BL1')!;
    expect(bl.name).toBe('CBTC Phase 2 – Baseline 1');
    expect(bl.origProjUid).toBe(main.uid);
  });

  it('builds the WBS as a tree with codes and paths', () => {
    const t = byCode('0-P2-TC-B20-FA-0010');
    expect(wbsCode(model, t.wbsUid)).toBe('CBTC-PH2.TC.B20');
    expect(wbsPathName(model, t.wbsUid)).toBe('Testing & Commissioning › B20 – Bravo Yard');
    expect(model.wbs.get('1003')!.children).toEqual(['1004', '1005', '1007']);
  });

  it('reads activity status, type, durations in hours and the calendar they convert by', () => {
    const t = byCode('0-P2-TC-C30-FA-0010');
    expect(t.status).toBe('NOT STARTED');
    expect(t.hpd).toBe(10);
    expect(t.odHrs).toBe(40);
    expect(byCode('0-P2-MS-0010').type).toBe('FINISH_MS');
    expect(byCode('0-P2-TC-B20-FA-0040').type).toBe('LOE');
    expect(byCode('0-P2-TC-A10-FA-0030').status).toBe('IN PROGRESS');
    expect(byCode('0-P2-TC-A10-FA-0010').status).toBe('COMPLETE');
  });

  it('reads float in days on each activity’s own calendar, and none once complete', () => {
    expect(totalFloatDays(byCode('0-P2-IN-C30-FA-0010'))).toBe(-5);
    // The same 40 hours of negative float is four days on a ten-hour calendar.
    expect(totalFloatDays(byCode('0-P2-TC-C30-FA-0010'))).toBe(-4);
    expect(totalFloatDays(byCode('0-P2-TC-A10-FA-0010'))).toBeNull();
  });

  it('says critical the way the project defines it', () => {
    expect(isCritical(byCode('0-P2-TC-B20-FA-0010'), main)).toBe(true);
    expect(isCritical(byCode('0-P2-TC-B20-FA-0020'), main)).toBe(false);
    expect(isCritical(byCode('0-P2-TC-A10-FA-0010'), main)).toBe(false);
    const longest = { ...main, criticalBy: 'LONGEST_PATH' as const };
    expect(isCritical(byCode('0-P2-TC-B20-FA-0010'), longest)).toBe(true);
    expect(isCritical(byCode('0-P2-IN-C30-FA-0010'), longest)).toBe(false);
  });

  it('gives P6’s percent complete for each percent type', () => {
    expect(p6Percent(byCode('0-P2-TC-A10-FA-0010'))).toBe(1);
    expect(p6Percent(byCode('0-P2-TC-A10-FA-0030'))).toBeCloseTo(0.6);
    expect(p6Percent(byCode('0-P2-TC-B20-FA-0010'))).toBe(0);
  });

  it('keeps a link to a project not in the file off both lists, and says so', () => {
    expect(model.rels).toHaveLength(18);
    expect(model.warnings.some((w) => w.startsWith('1 relationship links'))).toBe(true);
    expect(model.predsOf.get('3025')!.map((r) => r.predUid)).toEqual(['3024']);
  });

  it('reads resources, roles and what is assigned where', () => {
    const lines = assignmentLines(model, '3023');
    expect(lines.map((l) => [l.resource, l.budget, l.remaining])).toEqual([
      ['ATS Test Engineer', 80, 80],
      ['IXL Test Engineer', 40, 40],
    ]);
    expect(assignmentLines(model, '3030')[0]).toMatchObject({ resource: '(role) T&C Lead', role: 'T&C Lead' });
  });

  it('lists only the codes and user fields the project uses, with their values', () => {
    expect(codeTypesInUse(model, main.uid).map((c) => c.name)).toEqual(['Responsible', 'Area']);
    expect(udfTypesInUse(model, main.uid).map((u) => u.label)).toEqual(['Readiness date', 'Test cases', 'Test procedure']);
    expect(Object.fromEntries(model.taskUdfs.get('3024')!)).toEqual({ '800': 'TP-B20-001 rev C', '801': '2026-10-30', '803': 42 });
    // A WBS-level field is not an activity's.
    expect([...model.taskUdfs.keys()]).toEqual(['3024']);
  });
});

describe('calendars', () => {
  const std = model.calendars.get('1')!;

  it('reads the working week, the lunch break and the exceptions', () => {
    expect(std.patternRead).toBe(true);
    expect(weekHours(std)).toEqual([0, 8, 8, 8, 8, 8, 0]);
    expect(std.week[1]).toEqual([
      [480, 720],
      [780, 1020],
    ]);
    expect(holidaysBetween(std, Date.UTC(2026, 10, 1), Date.UTC(2026, 11, 31)).map((d) => new Date(d).toISOString().slice(0, 10))).toEqual(['2026-11-26', '2026-12-25']);
    // Christmas Eve is a half day, not a day off.
    expect(std.exceptions.get(Date.UTC(2026, 11, 24) / DAY)).toEqual([[480, 720]]);
  });

  it('counts working time across the lunch break, a weekend and a holiday', () => {
    expect(workMinutes(std, Date.UTC(2026, 8, 14, 8), Date.UTC(2026, 8, 14, 17))).toBe(480);
    // Friday 17:00 to Monday 08:00 is no working time at all.
    expect(workMinutes(std, Date.UTC(2026, 8, 18, 17), Date.UTC(2026, 8, 21, 8))).toBe(0);
    // Thanksgiving week: Monday to Friday is four days, not five.
    expect(workDays(std, Date.UTC(2026, 10, 23, 8), Date.UTC(2026, 10, 27, 17))).toBe(4);
    expect(workMinutes(std, Date.UTC(2026, 8, 14, 17), Date.UTC(2026, 8, 14, 8))).toBe(-480);
  });

  it('falls back to a plain working week when the pattern is missing or unreadable', () => {
    expect(parseCalendarData('')).toBeNull();
    expect(parseCalendarData('(0||CalendarData()(not brackets')).toBeNull();
    const c = makeCalendar({ uid: 'x', name: 'x', type: 'CA_Base', projUid: '', hoursPerDay: 10, data: '', isDefault: false });
    expect(c.patternRead).toBe(false);
    expect(weekHours(c)).toEqual([0, 10, 10, 10, 10, 10, 0]);
  });
});

describe('the logic', () => {
  const state = (pred: string, succ: string) => {
    const rel = model.rels.find((r) => r.predUid === byCode(pred).uid && r.succUid === byCode(succ).uid)!;
    return linkState(model, rel)!;
  };

  it('calls a link driving when no working time separates the two, weekend or not', () => {
    expect(state('0-P2-IN-B20-FA-0010', '0-P2-TC-B20-FA-0010')).toMatchObject({ state: 'DRIVING', gapDays: 0 });
    expect(state('0-P2-TC-A10-FA-0030', '0-P2-TC-A10-FA-0040').state).toBe('DRIVING');
  });

  it('measures the slack on a link that is not driving', () => {
    const v = state('0-P2-TC-B20-FA-0010', '0-P2-TC-B20-FA-0020');
    expect(v.state).toBe('NOT DRIVING');
    expect(v.gapDays).toBeGreaterThan(40);
  });

  it('flags a successor that went ahead of its predecessor, and a constraint that breaks the logic', () => {
    expect(state('0-P2-TC-A10-FA-0040', '0-P2-TC-A10-FA-0050').state).toBe('OUT OF SEQUENCE');
    // Held to a Start On date three weeks before its predecessor can finish.
    expect(state('0-P2-CN-B20-FA-0010', '0-P2-IN-C30-FA-0010').state).toBe('VIOLATED');
  });

  it('counts a finished predecessor, or a started one on a start link, as done', () => {
    expect(state('0-P2-TC-A10-FA-0020', '0-P2-TC-A10-FA-0030').state).toBe('DONE');
    expect(state('0-P2-CN-B20-FA-0010', '0-P2-CN-B20-FA-0020').state).toBe('DONE');
    expect(predecessorsOf(model, '3030').find((v) => v.rel.type === 'SS')!.lagDays).toBe(-2);
  });

  it('lists what is still open on an activity, the one holding it first', () => {
    expect(openPredecessors(model, '3030').map((v) => [v.pred.code, v.state])).toEqual([
      ['0-P2-IN-C30-FA-0010', 'DRIVING'],
      ['0-P2-CN-B20-FA-0020', 'NOT DRIVING'],
    ]);
  });

  it('traces the driving path back to where the date comes from', () => {
    const steps = trace(model, byCode('0-P2-TC-B20-FA-0010').uid, 'up', { drivingOnly: true });
    expect(steps.map((s) => [s.task.code, s.level])).toEqual([
      ['0-P2-IN-B20-FA-0010', 1],
      ['0-P2-CN-B20-FA-0010', 2],
    ]);
    const all = trace(model, byCode('0-P2-TC-B20-FA-0010').uid, 'down');
    expect(all.map((s) => s.task.code).sort()).toEqual(['0-P2-MS-0010', '0-P2-TC-B20-FA-0020', '0-P2-TC-B20-FA-0030', '0-P2-TC-B20-FA-0040']);
  });

  it('says which T&C work in the lookahead is ready, and what the rest waits on', () => {
    const test = scopeTest(DEFAULT_SCOPE);
    const tasks = tasksOf(model, main.uid);
    const six = readiness(model, main, tasks, (t) => test(t.code), main.dataDate!, 42);
    expect(six.map((r) => [r.task.code, r.readiness])).toEqual([
      ['0-P2-TC-B20-FA-0050', 'READY'],
      ['0-P2-TC-A10-FA-0040', 'WAITING ON SCOPE'],
      ['0-P2-TC-C30-FA-0010', 'WAITING ON OTHERS'],
    ]);
    expect(six[2].others.map((v) => ownerOf(model, v.pred))).toEqual(['IN', 'CN']);
    const eight = readiness(model, main, tasks, (t) => test(t.code), main.dataDate!, 56);
    expect(eight.find((r) => r.task.code === '0-P2-TC-B20-FA-0010')).toMatchObject({ readiness: 'WAITING ON OTHERS', marginDays: 0, critical: true });
  });

  it('runs the schedule checks', () => {
    const c = scheduleChecks(model, main, tasksOf(model, main.uid));
    const codes = (k: keyof typeof c) => c[k].map((t) => t.code).sort();
    expect(codes('negativeFloat')).toEqual(['0-P2-IN-C30-FA-0010', '0-P2-TC-C30-FA-0010']);
    expect(codes('outOfSequence')).toEqual(['0-P2-TC-A10-FA-0050']);
    expect(codes('violated')).toEqual(['0-P2-IN-C30-FA-0010']);
    expect(codes('hardConstraint')).toEqual(['0-P2-IN-C30-FA-0010']);
    expect(codes('forecastInPast')).toEqual(['0-P2-IN-B20-FA-0020']);
    expect(codes('leads')).toEqual(['0-P2-TC-C30-FA-0010']);
    expect(codes('startToFinish')).toEqual(['0-P2-MS-0010']);
    expect(codes('openStart')).toContain('0-P2-TC-B20-FA-0050');
    expect(codes('openStart')).not.toContain('0-P2-MS-0005');
    expect(codes('highFloat')).toEqual(['0-P2-TC-A10-FA-0050', '0-P2-TC-B20-FA-0050']);
    expect(codes('longDuration')).toEqual(['0-P2-CN-B20-FA-0010']);
  });

  it('sums each resource’s hours, and spreads them by month without losing any', () => {
    const test = scopeTest(DEFAULT_SCOPE);
    const tasks = tasksOf(model, main.uid);
    const s = resourceSummaries(model, tasks, (t) => test(t.code));
    const ats = s.find((r) => r.code === 'ATS-ENG')!;
    expect([ats.activities, ats.budget, ats.remaining, ats.scopeBudget]).toEqual([3, 432, 304, 432]);
    expect(s.find((r) => r.code === 'ELEC')!.scopeBudget).toBe(0);
    const months = monthlyLoading(model, new Set(tasks.map((t) => t.uid)), '500');
    expect(months.reduce((n, b) => n + b.budget, 0)).toBeCloseTo(432, 6);
    expect(months.reduce((n, b) => n + b.remaining, 0)).toBeCloseTo(304 - 32 + 32, 6);
    // Equipment is not labour, so the crane never reaches a labour histogram.
    expect(monthlyLoading(model, new Set(tasks.map((t) => t.uid)), '503')).toEqual([]);
  });
});

describe('the T&C scope', () => {
  it('reads one part of the Activity ID', () => {
    expect(segmentOf('0-P2-TC-B20-FA-0010', 3)).toBe('TC');
    expect(segmentOf('0-P2-MS-0010', 4)).toBe('0010');
    expect(segmentOf('A1000', 3)).toBe('');
    expect(segmentCounts(['0-P2-TC-A', '0-P2-TC-B', '0-P2-MS-1', 'X'], 3)).toEqual([
      { value: 'TC', count: 2 },
      { value: '', count: 1 },
      { value: 'MS', count: 1 },
    ]);
  });

  it('takes a segment value, plus or minus single IDs, whatever the case', () => {
    const t = scopeTest({ segment: 3, values: ['tc'], ids: ['0-P2-MS-0010'], excludeIds: ['0-P2-TC-B20-FA-0040'] });
    expect(t('0-P2-TC-B20-FA-0010')).toBe(true);
    expect(t(' 0-p2-tc-b20-fa-0020 ')).toBe(true);
    expect(t('0-P2-MS-0010')).toBe(true);
    expect(t('0-P2-TC-B20-FA-0040')).toBe(false);
    expect(t('0-P2-IN-B20-FA-0010')).toBe(false);
    expect(normalizeScope({ segment: 99, values: [' tc ', 'TC', ''] })).toEqual({ segment: 3, values: ['TC'] });
    expect(describeScope({ segment: 3, values: ['TC', 'MS'], ids: ['a'] })).toBe('work type (3rd part of the Activity ID) is TC or MS, plus 1 activity named by ID');
  });

  it('proposes the rule that reproduces the schedule already in use', () => {
    // The Excel export was T&C work and one programme milestone.
    const current = loadFixtureWorkbook().current.activities;
    expect(proposeScope(current)).toEqual({ segment: 3, values: ['TC'], ids: ['0-P2-MS-0010'] });
    expect(proposeScope(null)).toEqual(DEFAULT_SCOPE);
  });

  it('tells the schedule from its baseline in the same file', () => {
    const roles = projectRoles(model);
    expect(roles.mains.map((p) => p.shortName)).toEqual(['CBTC-PH2']);
    expect(roles.baselinesOf.get(main.uid)!.map((p) => p.shortName)).toEqual(['CBTC-PH2-BL1']);
  });

  it('gives the budget exactly what the T&C XER import always gave it', () => {
    // tc-fixture.xer is the T&C slice the budget used to be handed. Read through the
    // whole-project path with a scope that takes all of it, nothing may differ.
    const sliceText = readFileSync(resolve(FIXTURE_DIR, 'tc-fixture.xer'), 'utf8');
    const old = xerToActivities(parseXer(sliceText), { hoursPerDay: 8 }).activities;
    const whole = readProject(sliceText);
    const fresh = scopedActivities(whole, whole.projects[0].uid, { segment: 3, values: ['TC', 'MS'] }, { hoursPerDay: 8 }).activities;
    expect(fresh).toEqual(old);
  });

  it('keeps the T&C activities and attaches what only the XER knows', () => {
    const { activities, total } = scopedActivities(model, main.uid, DEFAULT_SCOPE, { hoursPerDay: 8, extras: true });
    expect(total).toBe(20);
    expect(activities.map((a) => a.activityId)).toEqual(tasksOf(model, main.uid).filter((t) => t.code.includes('-TC-')).map((t) => t.code));
    const b20 = activities.find((a) => a.activityId === '0-P2-TC-B20-FA-0010')!;
    expect(b20).toMatchObject({ originalDuration: 12, startDate: '2026-11-02', finishDate: '2026-11-17', location: 'B20', activityType: 'Core Network Test' });
    expect(b20.p6).toMatchObject({ status: 'NOT STARTED', totalFloat: 0, critical: true, preds: 1, succs: 2, waitingOnCount: 1, wbs: 'Testing & Commissioning › B20 – Bravo Yard' });
    expect(b20.p6!.waitingOn[0]).toMatchObject({ id: '0-P2-IN-B20-FA-0010', inScope: false, group: 'IN', driving: true, finish: '2026-10-30' });
    expect(b20.p6!.resources).toEqual([{ name: 'ATS Test Engineer', budget: 192, remaining: 192 }]);
    const cutover = activities.find((a) => a.activityId === '0-P2-TC-B20-FA-0030')!;
    expect(cutover.p6).toMatchObject({ constraint: 'Start On or After', constraintDate: '2027-03-01', hardConstraint: false });
    // A baseline needs none of it, and does not carry it.
    expect(scopedActivities(model, main.uid, DEFAULT_SCOPE, { hoursPerDay: 8 }).activities.every((a) => a.p6 === undefined)).toBe(true);
  });

  it('checks the scope against the schedule in use before anything is imported', () => {
    const current = loadFixtureWorkbook().current.activities;
    const cmp = compareScope(model, main.uid, DEFAULT_SCOPE, current)!;
    // Every T&C activity in this sample is one the Excel export had. The milestone
    // is in the file but outside a TC-only rule; the rest of the export's
    // activities are not in this smaller sample project at all.
    expect(cmp.matched).toBe(11);
    expect(cmp.added).toEqual([]);
    expect(cmp.outside.map((o) => o.activityId)).toEqual(['0-P2-MS-0010']);
    expect(cmp.gone.map((o) => o.activityId)).toContain('0-P2-TC-D40-FA-0010');
    // Add the milestone by ID and the two agree on everything in the file.
    const fixed = compareScope(model, main.uid, proposeScope(current), current)!;
    expect([fixed.matched, fixed.outside.length]).toEqual([12, 0]);
    expect(compareScope(model, main.uid, DEFAULT_SCOPE, [])).toBeNull();
  });

  it('prices an XER-fed schedule exactly as it prices the same rows without the extras', () => {
    const input = fixtureModelInput();
    const { activities } = scopedActivities(model, main.uid, DEFAULT_SCOPE, { hoursPerDay: 8, extras: true });
    const withExtras = computeModel({ ...input, current: activities, baseline: null });
    const without = computeModel({ ...input, current: activities.map(({ p6: _p6, ...a }) => (void _p6, a)), baseline: null });
    expect(withExtras.summary).toEqual(without.summary);
    expect(withExtras.rows.map((r) => r.budgetHours)).toEqual(without.rows.map((r) => r.budgetHours));
  });
});

describe('the activity outline', () => {
  const tasks = tasksOf(model, main.uid);
  const byStart = (a: P6Task, b: P6Task) => (a.start ?? 0) - (b.start ?? 0) || a.code.localeCompare(b.code);

  it('groups by WBS, leaving out branches nothing passed through', () => {
    const test = scopeTest(DEFAULT_SCOPE);
    const f = makeTaskFilter(main, { scope: 'in' }, (t) => test(t.code));
    const rows = buildOutline(model, main, tasks.filter(f), { kind: 'wbs' }, new Set(), byStart);
    const groups = rows.filter((r) => r.kind === 'group').map((r) => (r.kind === 'group' ? `${r.depth}:${r.label}:${r.count}` : ''));
    expect(groups).toEqual(['0:Testing & Commissioning:11', '1:A10 – Alpha Station:5', '1:B20 – Bravo Yard:5', '1:C30 – Charlie Junction:1']);
  });

  it('collapses a band and keeps its dates and counts', () => {
    const rows = buildOutline(model, main, tasks, { kind: 'wbs' }, new Set(['wbs:1003']), byStart);
    const tc = rows.find((r): r is OutlineGroup => r.kind === 'group' && r.key === 'wbs:1003')!;
    expect(tc).toMatchObject({ collapsed: true, count: 11, critical: 3 });
    expect(rows.some((r) => r.kind === 'group' && r.key === 'wbs:1004')).toBe(false);
    expect(msToDate(tc.start)).toBe('2025-03-03');
  });

  it('groups by any field, blanks last', () => {
    // Location is the 4th part, and only IDs with five or more parts have one.
    const loc = (t: P6Task) => (t.code.split('-').length >= 5 ? segmentOf(t.code, 4) : '');
    const rows = buildOutline(model, main, tasks, { kind: 'field', keyOf: loc }, new Set(), byStart);
    const labels = rows.filter((r) => r.kind === 'group').map((r) => (r.kind === 'group' ? `${r.label}:${r.count}` : ''));
    expect(labels).toEqual(['A10:7', 'B20:9', 'C30:2', '(none):2']);
  });

  it('filters by status, float, text, dates and a list', () => {
    const count = (f: Parameters<typeof makeTaskFilter>[1]) => tasks.filter(makeTaskFilter(main, f, () => true)).length;
    expect(count({ status: 'complete' })).toBe(5);
    expect(count({ float: 'negative' })).toBe(2);
    expect(count({ float: 'critical' })).toBe(6);
    expect(count({ text: 'b20 core' })).toBe(1);
    expect(count({ window: { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 9, 3) } })).toBeGreaterThan(3);
    expect(count({ only: new Set(['3024', '3025']) })).toBe(2);
  });
});

describe('the change report, when both schedules came from an XER', () => {
  it('lists float lost and activities gone critical, and stays silent for Excel', () => {
    const { activities } = scopedActivities(model, main.uid, DEFAULT_SCOPE, { hoursPerDay: 8, extras: true });
    const before = activities.map((a) => (a.activityId === '0-P2-TC-B20-FA-0010' ? { ...a, p6: { ...a.p6!, totalFloat: 12, critical: false } } : a));
    const d = diffSchedules(before, activities);
    expect(d.floatEroded.map((c) => [c.activityId, c.floatMovedDays])).toEqual([['0-P2-TC-B20-FA-0010', -12]]);
    expect(d.becameCritical.map((c) => c.activityId)).toEqual(['0-P2-TC-B20-FA-0010']);
    const plain = activities.map(({ p6: _p6, ...a }) => (void _p6, a));
    const e = diffSchedules(plain, activities);
    expect(e.floatEroded).toEqual([]);
    expect(e.changed).toEqual([]);
  });
});

/** A project of any size can be built here without a fixture file. */
export function tinyProject(): P6Project {
  return readProject(['%T\tPROJECT', '%F\tproj_id\tproj_short_name', '%R\t1\tP', '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name', '%R\t1\t1\tA\tAlpha', '%E'].join('\n'));
}

describe('a file with less in it', () => {
  it('copes with a project that has no WBS, calendars or logic', () => {
    const m = tinyProject();
    expect(m.tasks).toHaveLength(1);
    expect(m.tasks[0].hpd).toBe(8);
    expect(m.warnings[0]).toMatch(/no calendar/);
    expect(buildOutline(m, m.projects[0], m.tasks, { kind: 'wbs' }, new Set(), () => 0).map((r) => r.kind)).toEqual(['task']);
  });

  it('says so when the text is not an XER at all', () => {
    const m = readProject('Activity ID\tActivity Name\n1\tA');
    expect(m.tasks).toHaveLength(0);
    expect(m.warnings[0]).toMatch(/no XER tables/);
  });
});

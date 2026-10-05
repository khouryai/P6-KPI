/**
 * When does the work actually finish, with this many people?
 *
 * Capacity answers "is IXL short in FY27?". It cannot answer the question that
 * follows it: if IXL drops from eight people to four, what date does the job move
 * to, and how long does the overdue work take to clear? That needs the work laid
 * out against the people, day by day, in the order it would really be picked up.
 *
 * The rules, kept few so the answer can be explained in a meeting:
 *
 * - Only one resource group is modelled at a time, and only its own share of each
 *   activity's remaining budget (the same split every rollup by group uses).
 * - Effort is remaining budget divided by an efficiency factor the user keys. 1.0
 *   is "performs to budget"; 0.8 means every budget hour takes 1.25 hours.
 * - BACKLOG is anything the current schedule says should already have finished and
 *   has not. It is worked first, oldest planned finish first.
 * - Everything else is picked up no earlier than its planned start, in planned
 *   start order. The crew does not pull future work forward.
 * - An activity cannot go faster than its own crew. Eight people on a two-person
 *   test do not finish it in a quarter of the time. The pace it may go at is the
 *   one its planned dates imply (the budget is crew × shift × P6 days, so that pace
 *   IS the crew working its shifts), or its crew working full weeks if that is
 *   faster. With people enough and an efficiency of 1.0 it finishes on its planned
 *   date; below 1.0 it takes longer however many people stand behind it.
 *   Utilisation thins the pool of hours the group has; it does not slow one test.
 * - Headcount is a starting figure plus dated changes, so "four now, two more from
 *   March" is one scenario.
 *
 * Days are calendar days with the weekly hours spread evenly across them, so a
 * finish date is never stranded on a weekend boundary by the arithmetic.
 */
import type { BudgetRow } from './types';
import { normKey } from './keys';
import { addDaysISO, isValidISO, isoToMs } from './dates';

/** A dated change to a scenario's headcount: "+2 from 1 Mar", or "-1 from 1 Jun". */
/**
 * A dated change to a scenario's headcount: "+2 from 1 Mar", or "-1 from 1 Jun".
 * `until` is the last day it applies, for a temporary assignment; absent, it is
 * permanent.
 */
export type StaffChange = { id: string; from: string; delta: number; until?: string; note?: string };

export type StaffScenario = {
  id: string;
  name: string;
  /** People in the group from the data date. */
  people: number;
  changes: StaffChange[];
};

export type StaffingOptions = {
  /** The resource group, matched without regard to case. */
  group: string;
  dataDate: string;
  /** Budget hours earned per hour worked. 1.0 is to budget. */
  efficiency: number;
  hoursPerPersonPerMonth: number;
  /** Share of a person's hours that reaches this project, 0 to 1. */
  utilisation: number;
  /**
   * The date the analysis is measured against, when it is not the whole schedule.
   * Slip, "on track" and the people needed are all judged against it.
   */
  finishBy?: string | null;
};

/**
 * Which of the group's work is in the analysis.
 *
 * A group's work is of two kinds. Its OWN activities are the ones its Activity
 * Library Subsystem names — IXL's test activities. SUPPORT is the hours it puts
 * into another group's activities because it is on their crew — the IXL engineer
 * on an ATS test. Both are real demand on the same people, but whether the second
 * belongs in "how long will IXL's work take" is a choice, so it is a switch.
 */
export type StaffingScope = {
  includeSupport: boolean;
  /** Raw phase code ('' for all). */
  phase: string;
  workType: string;
  location: string;
  /** Activity types taken out by hand. */
  excludedTypes: string[];
  /** Only work planned to finish on or before this date. Backlog is always due. */
  finishBy: string | null;
};

export const FULL_SCOPE: StaffingScope = { includeSupport: true, phase: '', workType: '', location: '', excludedTypes: [], finishBy: null };

export type StaffingTask = {
  activityId: string;
  activityName: string;
  /** The activity type, as the Activity Library keys it. Repeats across locations. */
  activityType: string;
  phase: string;
  phaseName: string;
  workType: string;
  location: string;
  /** The Subsystem the Activity Library gives the type: whose activity it is. */
  owner: string;
  /** OWN: this group's activity. SUPPORT: another group's, with this group on its crew. */
  role: 'own' | 'support';
  plannedStart: string | null;
  plannedFinish: string | null;
  /** The group's share of the remaining budget. */
  remainingBudget: number;
  /** Hours it will take: remaining budget over the efficiency factor. */
  effortHours: number;
  /** Heads of this group the activity is crewed with. At least 1. */
  crew: number;
  /** Should already have finished on the current schedule, and has not. */
  backlog: boolean;
  inProgress: boolean;
  /** The first day the crew may work on it. */
  availableFrom: string;
  /**
   * The crew-hours a day its planned dates allow: remaining budget over what is
   * left of its window. 0 when it has no usable window.
   */
  plannedPace: number;
};

export type TaskForecast = StaffingTask & {
  /** The day its last hour is worked. null when it is not reached in the horizon. */
  forecastFinish: string | null;
  /** Forecast finish minus planned finish, in days. Positive is late. */
  slipDays: number | null;
};

export type StaffingPoint = { date: string; remaining: number };

export type ScenarioResult = {
  scenario: StaffScenario;
  /** When the last hour is worked. null when the horizon runs out first. */
  finish: string | null;
  /** When the last backlog hour is worked. Equal to the data date when there is none. */
  backlogClear: string | null;
  /** The latest planned finish of the work, which is the date to beat. */
  plannedFinish: string | null;
  slipDays: number | null;
  tasks: TaskForecast[];
  /** Remaining effort at each week end, for the chart. */
  series: StaffingPoint[];
  lateTasks: number;
  /**
   * Where the people's hours went, from the data date to the finish (or to the end
   * of the horizon when it never finishes). After the finish the team is taken to
   * be released, so it burns nothing.
   */
  burn: {
    /** Hours the scenario's people gave the project. */
    supplied: number;
    /** Hours spent working on the activities. */
    worked: number;
    /**
     * Hours paid for with nothing to work on: no backlog left, the next activity's
     * planned start not reached, or every open activity already at its crew's pace.
     * This is what over-staffing costs.
     */
    idle: number;
    /**
     * Hours worked that earned nothing, because an efficiency below 1.0 makes every
     * budget hour take longer. Negative when the efficiency is above 1.0.
     */
    lostToEfficiency: number;
    /** Weeks in which at least a quarter of the hours supplied stood idle. */
    idleWeeks: number;
  };
};

/** About fifteen years. Anything that has not finished by then is reported as never. */
const HORIZON_DAYS = 5475;
const EPS = 1e-6;

const daysBetween = (a: string, b: string) => Math.round((isoToMs(b) - isoToMs(a)) / 86_400_000);

/** Hours one person gives the project in a week, and works on one activity in a week. */
export function weeklyHours(opts: Pick<StaffingOptions, 'hoursPerPersonPerMonth' | 'utilisation'>): { net: number; gross: number } {
  const gross = (Math.max(0, opts.hoursPerPersonPerMonth) * 12) / 52;
  return { gross, net: gross * Math.max(0, Math.min(1, opts.utilisation)) };
}

/** Headcount in force on a day: the starting figure plus every change on or before it. */
export function peopleOn(day: string, s: StaffScenario): number {
  let n = s.people;
  for (const c of s.changes) {
    if (!isValidISO(c.from) || c.from > day) continue;
    if (c.until && isValidISO(c.until) && day > c.until) continue;
    n += c.delta;
  }
  return Math.max(0, n);
}

/** The group's outstanding work, as tasks in the order the crew would pick them up. */
export function staffingTasks(rows: BudgetRow[], opts: StaffingOptions): StaffingTask[] {
  const want = normKey(opts.group);
  const eff = opts.efficiency > 0 ? opts.efficiency : 1;
  const out: StaffingTask[] = [];
  for (const r of rows) {
    if (r.status !== 'IN BUDGET' || r.actualFinish || r.pctComplete >= 1 - EPS) continue;
    let budget = 0;
    let earned = 0;
    for (const [code, h] of Object.entries(r.subsystemHours)) if (normKey(code) === want) budget += h;
    for (const [code, h] of Object.entries(r.subsystemEarned)) if (normKey(code) === want) earned += h;
    const remainingBudget = budget - earned;
    if (remainingBudget <= EPS) continue;

    const crew = Math.max(
      1,
      r.resources.filter((x) => normKey(x.code) === want).reduce((s, x) => s + x.count, 0),
    );
    const plannedStart = isValidISO(r.currentStart) ? r.currentStart : isValidISO(r.baselineStart) ? r.baselineStart : null;
    const plannedFinish = isValidISO(r.currentFinish) ? r.currentFinish : isValidISO(r.baselineFinish) ? r.baselineFinish : null;
    const backlog = plannedFinish !== null && plannedFinish < opts.dataDate;
    const inProgress = !!r.actualStart || r.pctComplete > EPS;
    const availableFrom = backlog || inProgress || !plannedStart || plannedStart < opts.dataDate ? opts.dataDate : plannedStart;
    // Backlog's window has gone, so it keeps the pace of its whole original window.
    const windowFrom = backlog ? plannedStart : availableFrom;
    const windowDays = plannedFinish && windowFrom && plannedFinish >= windowFrom ? daysBetween(windowFrom, plannedFinish) + 1 : 0;
    const plannedPace = windowDays > 0 ? remainingBudget / windowDays : 0;

    // Owned when the Subsystem names this group, or names nobody and this group is
    // the whole crew. Anything else has this group on it to help somebody else.
    const crewCodes = Object.entries(r.subsystemHours).filter(([c, h]) => c && h > EPS).map(([c]) => normKey(c));
    const own = r.disciplines.length
      ? r.disciplines.some((d) => normKey(d) === want)
      : crewCodes.every((c) => c === want);

    out.push({
      activityId: r.activityId,
      activityName: r.activityName,
      activityType: r.matchKey || r.activityType,
      phase: r.phase,
      phaseName: r.phaseName,
      workType: r.workType,
      location: r.location,
      owner: r.disciplines.join(', '),
      role: own ? 'own' : 'support',
      plannedStart,
      plannedFinish,
      remainingBudget,
      effortHours: remainingBudget / eff,
      crew,
      backlog,
      inProgress,
      availableFrom,
      plannedPace,
    });
  }
  // Backlog first, oldest due first; then the schedule's own order. Undated work
  // goes last, because nothing says when it is wanted.
  const far = '9999-12-31';
  return out.sort(
    (a, b) =>
      Number(b.backlog) - Number(a.backlog) ||
      (a.backlog ? (a.plannedFinish ?? far).localeCompare(b.plannedFinish ?? far) : 0) ||
      (a.availableFrom).localeCompare(b.availableFrom) ||
      (a.plannedStart ?? far).localeCompare(b.plannedStart ?? far) ||
      (a.plannedFinish ?? far).localeCompare(b.plannedFinish ?? far) ||
      a.activityId.localeCompare(b.activityId),
  );
}

/** Lay the tasks against one scenario's people, a day at a time. */
export function simulate(tasks: StaffingTask[], scenario: StaffScenario, opts: StaffingOptions): ScenarioResult {
  const { net, gross } = weeklyHours(opts);
  const dayNet = net / 7;
  const dayGross = gross / 7;
  const left = tasks.map((t) => t.effortHours);
  const done: (string | null)[] = tasks.map(() => null);
  const backlogIdx = tasks.map((t, i) => (t.backlog ? i : -1)).filter((i) => i >= 0);
  // The last day the headcount can still change: a start, or the day after an end.
  const lastChange = scenario.changes
    .flatMap((c) => [c.from, c.until && isValidISO(c.until) ? addDaysISO(c.until, 1) : ''])
    .filter((x) => isValidISO(x))
    .reduce((m, x) => (x > m ? x : m), opts.dataDate);
  let supplied = 0;
  let worked = 0;
  let weekSupplied = 0;
  let weekIdle = 0;
  let idleWeeks = 0;

  let remaining = left.reduce((s, h) => s + h, 0);
  let open = tasks.length;
  let backlogClear: string | null = backlogIdx.length ? null : opts.dataDate;
  const series: StaffingPoint[] = [{ date: opts.dataDate, remaining }];
  let first = 0;

  let d = 0;
  for (; d < HORIZON_DAYS && open > 0; d++) {
    const day = addDaysISO(opts.dataDate, d);
    let cap = peopleOn(day, scenario) * dayNet;
    // Nobody left and nobody coming: the rest never finishes.
    if (cap <= EPS && day >= lastChange) break;
    const capToday = cap;
    for (let i = first; i < tasks.length && cap > EPS; i++) {
      if (left[i] <= EPS || tasks[i].availableFrom > day) continue;
      const take = Math.min(left[i], cap, Math.max(tasks[i].crew * dayGross, tasks[i].plannedPace));
      left[i] -= take;
      cap -= take;
      remaining -= take;
      if (left[i] <= EPS) {
        left[i] = 0;
        done[i] = day;
        open--;
      }
    }
    supplied += capToday;
    worked += capToday - cap;
    weekSupplied += capToday;
    weekIdle += cap;
    while (first < tasks.length && left[first] <= EPS) first++;
    if (backlogClear === null && backlogIdx.every((i) => left[i] <= EPS)) backlogClear = day;
    if ((d + 1) % 7 === 0 || open === 0) {
      if (weekSupplied > EPS && weekIdle / weekSupplied >= 0.25) idleWeeks++;
      weekSupplied = 0;
      weekIdle = 0;
    }
    if ((d + 1) % 7 === 0) series.push({ date: addDaysISO(opts.dataDate, d + 1), remaining: Math.max(0, remaining) });
  }
  if (open === 0 && series[series.length - 1].remaining > EPS) series.push({ date: addDaysISO(opts.dataDate, d), remaining: 0 });

  const forecasts: TaskForecast[] = tasks.map((t, i) => ({
    ...t,
    forecastFinish: done[i],
    slipDays: done[i] && t.plannedFinish ? daysBetween(t.plannedFinish, done[i]!) : null,
  }));
  const finish = open === 0 ? (done.reduce<string | null>((m, x) => (x && (!m || x > m) ? x : m), null) ?? opts.dataDate) : null;
  const plannedFinish = targetDate(tasks, opts);

  return {
    scenario,
    finish,
    backlogClear,
    plannedFinish,
    slipDays: finish && plannedFinish ? daysBetween(plannedFinish, finish) : null,
    tasks: forecasts,
    series,
    lateTasks: forecasts.filter((t) => t.slipDays === null ? t.forecastFinish === null : t.slipDays > 0).length,
    burn: {
      supplied,
      worked,
      idle: Math.max(0, supplied - worked),
      lostToEfficiency: worked * (1 - (opts.efficiency > 0 ? opts.efficiency : 1)),
      idleWeeks,
    },
  };
}

/** The date to beat: the one the user set, or else the latest planned finish. */
export function targetDate(tasks: StaffingTask[], opts: Pick<StaffingOptions, 'finishBy'>): string | null {
  if (opts.finishBy && isValidISO(opts.finishBy)) return opts.finishBy;
  return tasks.reduce<string | null>((m, t) => (t.plannedFinish && (!m || t.plannedFinish > m) ? t.plannedFinish : m), null);
}

/** Why a task is left out of the analysis, or null when it is in. */
export function outOfScope(t: StaffingTask, scope: StaffingScope): string | null {
  if (t.role === 'support' && !scope.includeSupport) return 'support';
  if (scope.phase && t.phase !== scope.phase) return 'phase';
  if (scope.workType && t.workType !== scope.workType) return 'work type';
  if (scope.location && t.location !== scope.location) return 'location';
  if (scope.excludedTypes.some((x) => normKey(x) === normKey(t.activityType))) return 'type';
  if (scope.finishBy && isValidISO(scope.finishBy) && !t.backlog && (!t.plannedFinish || t.plannedFinish > scope.finishBy)) return 'after end date';
  return null;
}

/** One activity type and every location it repeats at. */
export type TypeGroup = {
  activityType: string;
  /** 'mixed' when some of its activities are this group's and some another's. */
  role: 'own' | 'support' | 'mixed';
  owner: string;
  tasks: StaffingTask[];
  locations: string[];
  effortHours: number;
  backlog: number;
  firstStart: string | null;
  lastFinish: string | null;
};

export function groupByType(tasks: StaffingTask[]): TypeGroup[] {
  const map = new Map<string, StaffingTask[]>();
  for (const t of tasks) {
    const k = normKey(t.activityType);
    const list = map.get(k);
    if (list) list.push(t);
    else map.set(k, [t]);
  }
  return [...map.values()]
    .map((list) => {
      const roles = new Set(list.map((t) => t.role));
      const starts = list.map((t) => t.plannedStart).filter((x): x is string => !!x).sort();
      const finishes = list.map((t) => t.plannedFinish).filter((x): x is string => !!x).sort();
      return {
        activityType: list[0].activityType,
        role: roles.size > 1 ? 'mixed' : list[0].role,
        owner: [...new Set(list.map((t) => t.owner).filter(Boolean))].join(' / '),
        tasks: list,
        locations: [...new Set(list.map((t) => t.location).filter(Boolean))].sort(),
        effortHours: list.reduce((s, t) => s + t.effortHours, 0),
        backlog: list.filter((t) => t.backlog).length,
        firstStart: starts[0] ?? null,
        lastFinish: finishes[finishes.length - 1] ?? null,
      } as TypeGroup;
    })
    .sort((a, b) => b.effortHours - a.effortHours || a.activityType.localeCompare(b.activityType));
}

/**
 * What the schedule itself expects to be left on each date: every activity's effort
 * spread evenly over its planned window. Backlog is already due, so it is nothing.
 * The line the scenarios have to stay under to be on track.
 */
export function plannedRemaining(tasks: StaffingTask[], dates: string[], dataDate: string): StaffingPoint[] {
  return dates.map((date) => {
    let rem = 0;
    for (const t of tasks) {
      if (t.backlog || !t.plannedFinish) continue;
      // What is left is spread over what is left of its window: from its start, or
      // from the data date if it was meant to have begun already.
      const from = t.plannedStart && t.plannedStart > dataDate ? t.plannedStart : dataDate;
      if (date >= t.plannedFinish) continue;
      if (date <= from) {
        rem += t.effortHours;
        continue;
      }
      const span = Math.max(1, daysBetween(from, t.plannedFinish));
      rem += t.effortHours * (daysBetween(date, t.plannedFinish) / span);
    }
    return { date, remaining: rem };
  });
}

/**
 * The fewest people, held constant from the data date, that finish everything by
 * the planned finish. null when no headcount can, because the crews on the last
 * activities cannot go fast enough however many people stand behind them, or
 * because the planned finish has already passed.
 */
export function peopleNeeded(tasks: StaffingTask[], opts: StaffingOptions, by: string | null): number | null {
  if (!tasks.length) return 0;
  if (!by || by < opts.dataDate) return null;
  const fits = (n: number) => {
    const r = simulate(tasks, { id: 'probe', name: '', people: n, changes: [] }, opts);
    return r.finish !== null && r.finish <= by;
  };
  let hi = 1;
  while (!fits(hi)) {
    hi *= 2;
    if (hi > 1024) return null;
  }
  // Half a person is the finest step worth reporting.
  let lo = 0;
  while (hi - lo > 0.5) {
    const mid = Math.round(((lo + hi) / 2) * 2) / 2;
    if (mid === lo || mid === hi) break;
    if (fits(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

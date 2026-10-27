/**
 * The logic between activities: which relationship holds a date, what an activity
 * is waiting on, and what a schedule review would flag.
 *
 * P6 does not write "driving" into an XER — it works it out on screen. It is worked
 * out here the same way: a relationship drives when there is no working time
 * between the predecessor's date and the successor's, after the lag. That is the
 * difference between "this test has twelve predecessors" and "this test is waiting
 * on the cable pull in W40, and nothing else".
 */
import { defaultWeek, workMinutes, type P6Calendar } from './xerCalendar';
import { HARD_CONSTRAINTS, isCritical, totalFloatDays, type P6Project, type P6ProjectInfo, type P6Rel, type P6Task } from './xerProject';

const DAY_MS = 86_400_000;

/** How a relationship stands today. */
export type LinkState =
  /** The predecessor has done what the link needs: finished, or for a start link, started. */
  | 'DONE'
  /** No working time between the two after the lag: this is what sets the successor's date. */
  | 'DRIVING'
  /** There is slack between them. */
  | 'NOT DRIVING'
  /** The successor has gone ahead of a predecessor that has not done its part. */
  | 'OUT OF SEQUENCE'
  /** The successor is scheduled before the logic allows: a hard constraint, or a schedule not re-run. */
  | 'VIOLATED'
  | 'UNKNOWN';

export type LinkView = {
  rel: P6Rel;
  pred: P6Task;
  succ: P6Task;
  state: LinkState;
  /** Working days of slack between the two, after the lag. Null where it does not apply. */
  gapDays: number | null;
  lagDays: number;
};

const FALLBACK_CAL = (hpd: number): P6Calendar => ({
  uid: '',
  name: '',
  type: '',
  projUid: '',
  hoursPerDay: hpd,
  week: defaultWeek(hpd),
  exceptions: new Map(),
  patternRead: false,
  isDefault: false,
});

/** The calendar an activity is on, or a plain working week of its hours when the file lacks it. */
export function calendarOf(model: P6Project, t: P6Task): P6Calendar {
  return model.calendars.get(t.calUid) ?? FALLBACK_CAL(t.hpd || 8);
}

/** The start a link's arithmetic uses: actual, else remaining early, else early. */
function startSide(t: P6Task): number | null {
  return t.actStart ?? t.remStart ?? t.earlyStart ?? t.start;
}

function finishSide(t: P6Task): number | null {
  return t.actFinish ?? t.earlyFinish ?? t.remFinish ?? t.finish;
}

/**
 * How one relationship stands.
 *
 * Lag is measured on the predecessor's calendar, which is P6's default. The answer
 * is to the working minute, so a predecessor finishing at 17:00 on a Friday drives
 * a successor starting at 08:00 on the Monday — there is no working time between.
 */
export function linkState(model: P6Project, rel: P6Rel): LinkView | null {
  const pred = model.taskByUid.get(rel.predUid);
  const succ = model.taskByUid.get(rel.succUid);
  if (!pred || !succ) return null;
  const cal = calendarOf(model, pred);
  const hpd = cal.hoursPerDay > 0 ? cal.hoursPerDay : pred.hpd || 8;
  const lagDays = Math.round((rel.lagHrs / hpd) * 100) / 100;
  const out = (state: LinkState, gapDays: number | null = null): LinkView => ({ rel, pred, succ, state, gapDays, lagDays });

  const predSide = rel.type === 'FS' || rel.type === 'FF' ? 'finish' : 'start';
  const succSide = rel.type === 'FS' || rel.type === 'SS' ? 'start' : 'finish';
  const predDone = predSide === 'finish' ? pred.status === 'COMPLETE' : pred.status !== 'NOT STARTED';
  const succDone = succSide === 'start' ? succ.status !== 'NOT STARTED' : succ.status === 'COMPLETE';

  if (predDone) return out('DONE');
  if (succDone) return out('OUT OF SEQUENCE');

  const from = predSide === 'finish' ? finishSide(pred) : startSide(pred);
  const to = succSide === 'start' ? startSide(succ) : finishSide(succ);
  if (from === null || to === null) return out('UNKNOWN');
  const gapMins = workMinutes(cal, from, to) - rel.lagHrs * 60;
  const gapDays = Math.round((gapMins / (hpd * 60)) * 100) / 100;
  if (gapMins < -1) return out('VIOLATED', gapDays);
  if (gapMins <= 1) return out('DRIVING', 0);
  return out('NOT DRIVING', gapDays);
}

/** Every predecessor of an activity, with how each stands. */
export function predecessorsOf(model: P6Project, taskUid: string): LinkView[] {
  return (model.predsOf.get(taskUid) ?? []).map((r) => linkState(model, r)).filter((v): v is LinkView => v !== null);
}

export function successorsOf(model: P6Project, taskUid: string): LinkView[] {
  return (model.succsOf.get(taskUid) ?? []).map((r) => linkState(model, r)).filter((v): v is LinkView => v !== null);
}

/** Predecessors that still owe this activity something, the ones holding its date first. */
export function openPredecessors(model: P6Project, taskUid: string): LinkView[] {
  const rank = (s: LinkState) => (s === 'VIOLATED' ? 0 : s === 'DRIVING' ? 1 : s === 'OUT OF SEQUENCE' ? 2 : 3);
  return predecessorsOf(model, taskUid)
    .filter((v) => v.state !== 'DONE')
    .sort((a, b) => rank(a.state) - rank(b.state) || (finishSide(b.pred) ?? 0) - (finishSide(a.pred) ?? 0));
}

export type TraceStep = { task: P6Task; level: number; via: P6Rel | null; driving: boolean };

/**
 * Everything upstream (or downstream) of an activity, nearest first.
 *
 * `drivingOnly` follows only the links that hold the date — the driving path — so a
 * question like "why does this test start in March?" has a chain for an answer
 * rather than a family tree. Finished work ends a driving trace: it cannot be
 * holding anything any more.
 */
export function trace(
  model: P6Project,
  fromUid: string,
  direction: 'up' | 'down',
  opts: { drivingOnly?: boolean; maxLevels?: number; maxTasks?: number } = {},
): TraceStep[] {
  const maxLevels = opts.maxLevels ?? 1000;
  const maxTasks = opts.maxTasks ?? 5000;
  const seen = new Set<string>([fromUid]);
  const out: TraceStep[] = [];
  let frontier = [fromUid];
  for (let level = 1; level <= maxLevels && frontier.length > 0 && out.length < maxTasks; level++) {
    const next: string[] = [];
    for (const uid of frontier) {
      const links = direction === 'up' ? model.predsOf.get(uid) ?? [] : model.succsOf.get(uid) ?? [];
      for (const rel of links) {
        const other = direction === 'up' ? rel.predUid : rel.succUid;
        if (seen.has(other)) continue;
        const v = linkState(model, rel);
        const driving = v?.state === 'DRIVING' || v?.state === 'VIOLATED';
        if (opts.drivingOnly && !driving) continue;
        const task = model.taskByUid.get(other);
        if (!task) continue;
        seen.add(other);
        out.push({ task, level, via: rel, driving });
        next.push(other);
        if (out.length >= maxTasks) break;
      }
      if (out.length >= maxTasks) break;
    }
    frontier = next;
  }
  return out;
}

// ---- readiness ----------------------------------------------------------------

export type Readiness = 'READY' | 'WAITING ON SCOPE' | 'WAITING ON OTHERS';

export type ReadinessRow = {
  task: P6Task;
  readiness: Readiness;
  /** Predecessors still open, holding ones first. */
  open: LinkView[];
  /** Of those, the ones outside the scope. */
  others: LinkView[];
  /** Working days between the latest open predecessor's date and this activity's start. 0 when one is driving it. */
  marginDays: number | null;
  totalFloatDays: number | null;
  critical: boolean;
};

/**
 * What is due to start in the next few weeks, and whether it can.
 *
 * Every in-scope activity not yet started whose start falls between the data date
 * and the end of the window, with the predecessors still open on it. Waiting on
 * work inside the scope is the team's own sequencing; waiting on work outside it —
 * an installation, an access, another contractor — is the conversation to have
 * before the date arrives rather than in the review after it.
 */
export function readiness(
  model: P6Project,
  project: P6ProjectInfo | undefined,
  tasks: P6Task[],
  isInScope: (t: P6Task) => boolean,
  fromMs: number,
  windowDays: number,
): ReadinessRow[] {
  const to = fromMs + windowDays * DAY_MS;
  const rows: ReadinessRow[] = [];
  for (const t of tasks) {
    if (t.status !== 'NOT STARTED' || !isInScope(t)) continue;
    const s = t.start;
    if (s === null || s > to) continue;
    const open = openPredecessors(model, t.uid);
    const others = open.filter((v) => !isInScope(v.pred));
    let marginDays: number | null = null;
    for (const v of open) {
      if (v.gapDays === null) continue;
      marginDays = marginDays === null ? v.gapDays : Math.min(marginDays, v.gapDays);
    }
    rows.push({
      task: t,
      readiness: open.length === 0 ? 'READY' : others.length > 0 ? 'WAITING ON OTHERS' : 'WAITING ON SCOPE',
      open,
      others,
      marginDays,
      totalFloatDays: totalFloatDays(t),
      critical: isCritical(t, project),
    });
  }
  return rows.sort((a, b) => (a.task.start ?? 0) - (b.task.start ?? 0) || a.task.code.localeCompare(b.task.code));
}

// ---- schedule checks ----------------------------------------------------------

export type CheckKey =
  | 'openStart'
  | 'openFinish'
  | 'outOfSequence'
  | 'violated'
  | 'hardConstraint'
  | 'negativeFloat'
  | 'highFloat'
  | 'longDuration'
  | 'leads'
  | 'lags'
  | 'startToFinish'
  | 'forecastInPast'
  | 'actualAfterDataDate';

export type CheckDef = { key: CheckKey; label: string; explain: string; severity: 'bad' | 'warn' | 'info' };

export const CHECKS: CheckDef[] = [
  { key: 'negativeFloat', label: 'Negative float', severity: 'bad', explain: 'Total float below zero: the activity cannot finish in time for a date somewhere downstream of it. The schedule is already late here.' },
  { key: 'outOfSequence', label: 'Out of sequence', severity: 'bad', explain: 'The activity started (or finished) before a predecessor did its part. Progress has overtaken the logic, and the remaining dates may be wrong.' },
  { key: 'violated', label: 'Logic not honoured', severity: 'bad', explain: 'Scheduled earlier than its predecessor and lag allow. Usually a hard constraint holding it, or the schedule not re-run since the predecessor moved.' },
  { key: 'openStart', label: 'No predecessor', severity: 'warn', explain: 'Nothing drives the start, so a slip upstream cannot move it. Every activity but the first should have a predecessor.' },
  { key: 'openFinish', label: 'No successor', severity: 'warn', explain: 'Nothing follows it, so it can slip without moving anything else — and its float means nothing. Every activity but the last should have a successor.' },
  { key: 'hardConstraint', label: 'Hard constraint', severity: 'warn', explain: 'A Mandatory, Start On, Finish On or On-or-Before constraint pins the date regardless of the logic, which can hide a slip.' },
  { key: 'forecastInPast', label: 'Forecast before data date', severity: 'warn', explain: 'Not started, yet forecast to start before the data date. The schedule has not been re-run since it was updated.' },
  { key: 'actualAfterDataDate', label: 'Actual after data date', severity: 'bad', explain: 'An actual start or finish later than the data date: progress recorded in the future.' },
  { key: 'leads', label: 'Leads (negative lag)', severity: 'warn', explain: 'A relationship with a negative lag lets a successor start before its predecessor allows. Better written as a different relationship type.' },
  { key: 'highFloat', label: 'High float (> 44 d)', severity: 'info', explain: 'More than 44 working days of total float, which usually means missing logic rather than real freedom.' },
  { key: 'longDuration', label: 'Long duration (> 44 d)', severity: 'info', explain: 'Longer than 44 working days. Long activities are hard to progress honestly; consider breaking them down.' },
  { key: 'lags', label: 'Positive lags', severity: 'info', explain: 'A relationship carries a waiting time. Fine when it is a cure or a notice period; a lag standing in for work hides that work.' },
  { key: 'startToFinish', label: 'Start-to-finish links', severity: 'info', explain: 'SF relationships are rarely what was meant and are hard to read; most schedules have none.' },
];

/**
 * A schedule review over a set of activities: the usual DCMA-style tests, each as the
 * list of activities that fail it. A relationship test counts the successor.
 */
export function scheduleChecks(model: P6Project, project: P6ProjectInfo | undefined, tasks: P6Task[]): Record<CheckKey, P6Task[]> {
  const out = Object.fromEntries(CHECKS.map((c) => [c.key, [] as P6Task[]])) as Record<CheckKey, P6Task[]>;
  const dataDate = project?.dataDate ?? null;
  const inSet = new Set(tasks.map((t) => t.uid));
  const relFlag = (key: CheckKey, t: P6Task, seen: Set<string>) => {
    if (!seen.has(t.uid)) {
      seen.add(t.uid);
      out[key].push(t);
    }
  };
  const seenOOS = new Set<string>();
  const seenViol = new Set<string>();
  const seenLead = new Set<string>();
  const seenLag = new Set<string>();
  const seenSF = new Set<string>();
  for (const t of tasks) {
    const open = t.status !== 'COMPLETE';
    const isMs = t.type === 'START_MS' || t.type === 'FINISH_MS';
    const isSummary = t.type === 'LOE' || t.type === 'WBS_SUMMARY';
    const preds = model.predsOf.get(t.uid) ?? [];
    const succs = model.succsOf.get(t.uid) ?? [];
    if (open && preds.length === 0 && t.type !== 'START_MS' && !isSummary) out.openStart.push(t);
    if (open && succs.length === 0 && t.type !== 'FINISH_MS' && !isSummary) out.openFinish.push(t);
    if (open && (HARD_CONSTRAINTS.has(t.cstrType) || HARD_CONSTRAINTS.has(t.cstrType2))) out.hardConstraint.push(t);
    if (open && t.tfHrs !== null && t.tfHrs < -1e-9) out.negativeFloat.push(t);
    const tf = totalFloatDays(t);
    if (open && tf !== null && tf > 44) out.highFloat.push(t);
    const od = t.odHrs !== null ? t.odHrs / (t.hpd || 8) : null;
    if (!isMs && !isSummary && od !== null && od > 44) out.longDuration.push(t);
    if (dataDate !== null) {
      const dd = Math.floor(dataDate / DAY_MS);
      if (t.status === 'NOT STARTED' && t.start !== null && Math.floor(t.start / DAY_MS) < dd) out.forecastInPast.push(t);
      if ((t.actStart !== null && Math.floor(t.actStart / DAY_MS) > dd) || (t.actFinish !== null && Math.floor(t.actFinish / DAY_MS) > dd)) out.actualAfterDataDate.push(t);
    }
    for (const rel of preds) {
      if (!inSet.has(rel.succUid)) continue;
      if (rel.lagHrs < 0) relFlag('leads', t, seenLead);
      else if (rel.lagHrs > 0) relFlag('lags', t, seenLag);
      if (rel.type === 'SF') relFlag('startToFinish', t, seenSF);
      const v = linkState(model, rel);
      if (v?.state === 'OUT OF SEQUENCE' && open) relFlag('outOfSequence', t, seenOOS);
      if (v?.state === 'VIOLATED') relFlag('violated', t, seenViol);
    }
  }
  return out;
}

// ---- resource loading -----------------------------------------------------------

export type LoadBucket = { start: number; label: string; budget: number; remaining: number };

/**
 * Hours a resource carries per month, spread evenly over each assignment's dates.
 *
 * The budget is spread over the planned dates and the remaining over the remaining
 * dates, which is P6's uniform curve. Spread by calendar day: the month totals are
 * right to well within a day's work, and that is the resolution anybody reads a
 * monthly histogram at.
 */
export function monthlyLoading(model: P6Project, taskUids: Set<string>, rsrcUid: string | null): LoadBucket[] {
  const buckets = new Map<string, LoadBucket>();
  const keyOf = (ms: number) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const bucketAt = (ms: number): LoadBucket => {
    const k = keyOf(ms);
    let b = buckets.get(k);
    if (!b) {
      const d = new Date(ms);
      b = { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), label: k, budget: 0, remaining: 0 };
      buckets.set(k, b);
    }
    return b;
  };
  // Month by month rather than day by day: a level-of-effort line can run for years.
  const add = (from: number | null, to: number | null, qty: number, which: 'budget' | 'remaining') => {
    if (!qty || from === null) return;
    if (to === null || to <= from) {
      bucketAt(from)[which] += qty;
      return;
    }
    const span = to - from;
    let cursor = from;
    while (cursor < to) {
      const d = new Date(cursor);
      const nextMonth = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      const end = Math.min(to, nextMonth);
      bucketAt(cursor)[which] += (qty * (end - cursor)) / span;
      cursor = end;
    }
  };
  for (const a of model.assignments) {
    if (!taskUids.has(a.taskUid)) continue;
    if (rsrcUid !== null && a.rsrcUid !== rsrcUid) continue;
    const t = model.taskByUid.get(a.taskUid);
    if (!t) continue;
    const r = model.resources.get(a.rsrcUid);
    if ((a.rsrcType || r?.type) && (a.rsrcType || r?.type) !== 'Labor') continue;
    add(a.start ?? t.plannedStart ?? t.start, a.finish ?? t.plannedFinish ?? t.finish, a.budgetQty, 'budget');
    if (t.status !== 'COMPLETE') add(a.remStart ?? t.remStart ?? t.start, a.remFinish ?? t.remFinish ?? t.finish, a.remainQty, 'remaining');
  }
  return [...buckets.values()].sort((a, b) => a.start - b.start);
}

export type ResourceSummary = {
  uid: string;
  code: string;
  name: string;
  type: string;
  activities: number;
  budget: number;
  remaining: number;
  actual: number;
  /** Of those, the hours on activities in the scope. */
  scopeBudget: number;
  scopeRemaining: number;
  firstStart: number | null;
  lastFinish: number | null;
};

/** Every resource with work in the project, its hours whole and inside the scope. */
export function resourceSummaries(model: P6Project, tasks: P6Task[], isInScope: (t: P6Task) => boolean): ResourceSummary[] {
  const inProject = new Map(tasks.map((t) => [t.uid, t]));
  const out = new Map<string, ResourceSummary>();
  for (const a of model.assignments) {
    const t = inProject.get(a.taskUid);
    if (!t) continue;
    const key = a.rsrcUid || `role:${a.roleUid}`;
    const r = model.resources.get(a.rsrcUid);
    const role = model.roles.get(a.roleUid);
    let s = out.get(key);
    if (!s) {
      s = {
        uid: a.rsrcUid,
        code: r?.code ?? role?.code ?? '',
        name: r?.name ?? (role ? `${role.name} (role)` : 'Unassigned'),
        type: a.rsrcType || r?.type || '',
        activities: 0,
        budget: 0,
        remaining: 0,
        actual: 0,
        scopeBudget: 0,
        scopeRemaining: 0,
        firstStart: null,
        lastFinish: null,
      };
      out.set(key, s);
    }
    s.activities += 1;
    s.budget += a.budgetQty;
    s.remaining += a.remainQty;
    s.actual += a.actualQty;
    if (isInScope(t)) {
      s.scopeBudget += a.budgetQty;
      s.scopeRemaining += a.remainQty;
    }
    const st = a.start ?? t.start;
    const fi = a.finish ?? t.finish;
    if (st !== null && (s.firstStart === null || st < s.firstStart)) s.firstStart = st;
    if (fi !== null && (s.lastFinish === null || fi > s.lastFinish)) s.lastFinish = fi;
  }
  return [...out.values()].sort((a, b) => b.budget - a.budget || a.name.localeCompare(b.name));
}

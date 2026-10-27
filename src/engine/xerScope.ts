/**
 * From a whole P6 project to the T&C budget's activities.
 *
 * The Excel export arrived already filtered to the T&C work. An XER is everything,
 * so the filter is applied here instead — once, by a rule kept with the job's
 * settings — and what comes out is exactly the `P6Activity[]` the Excel path
 * produced, so no budget figure can tell which file it came from. The same pass
 * attaches what only the XER knows (float, logic, constraint, resources) to each
 * activity, where any screen can read it.
 */
import type { P6Activity, P6Extras, P6Link, ScopeRule } from './types';
import { parseP6Row } from './parse';
import { normKey } from './keys';
import { msToDate } from './xerText';
import {
  CONSTRAINT_LABEL,
  HARD_CONSTRAINTS,
  TASK_TYPE_LABEL,
  assignmentLines,
  isCritical,
  p6Percent,
  totalFloatDays,
  freeFloatDays,
  wbsChain,
  wbsPathName,
  type P6Project,
  type P6ProjectInfo,
  type P6Task,
} from './xerProject';
import { openPredecessors } from './xerLogic';

export const DEFAULT_SCOPE: ScopeRule = { segment: 3, values: ['TC'] };

/** One dash-delimited segment of an Activity ID, 1-based. '' when the ID is shorter. */
export function segmentOf(activityId: string, segment: number): string {
  const parts = activityId.trim().split('-');
  return segment >= 1 && parts.length >= segment ? parts[segment - 1].trim() : '';
}

/** A rule with its lists tidied: trimmed, de-duplicated, upper-cased values. */
export function normalizeScope(rule: ScopeRule | undefined | null): ScopeRule {
  const r = rule ?? DEFAULT_SCOPE;
  const uniq = (xs: string[] | undefined, up = false) => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const x of xs ?? []) {
      const t = up ? x.trim().toUpperCase() : x.trim();
      if (t && !seen.has(normKey(t))) {
        seen.add(normKey(t));
        out.push(t);
      }
    }
    return out;
  };
  const segment = Number.isInteger(r.segment) && r.segment >= 1 && r.segment <= 12 ? r.segment : 3;
  const out: ScopeRule = { segment, values: uniq(r.values, true) };
  const ids = uniq(r.ids);
  const excl = uniq(r.excludeIds);
  if (ids.length) out.ids = ids;
  if (excl.length) out.excludeIds = excl;
  return out;
}

/** A test for one Activity ID, built once for a rule. */
export function scopeTest(rule: ScopeRule): (activityId: string) => boolean {
  const r = normalizeScope(rule);
  const values = new Set(r.values.map(normKey));
  const ids = new Set((r.ids ?? []).map(normKey));
  const excl = new Set((r.excludeIds ?? []).map(normKey));
  return (id: string) => {
    const k = normKey(id);
    if (excl.has(k)) return false;
    if (ids.has(k)) return true;
    return values.has(normKey(segmentOf(id, r.segment)));
  };
}

/** The rule in a sentence, for the screens that show it. */
export function describeScope(rule: ScopeRule): string {
  const r = normalizeScope(rule);
  const seg = r.segment === 3 ? 'work type (3rd part of the Activity ID)' : `part ${r.segment} of the Activity ID`;
  const vals = r.values.length ? r.values.join(' or ') : 'nothing';
  const extra = [
    r.ids?.length ? `plus ${r.ids.length} activit${r.ids.length === 1 ? 'y' : 'ies'} named by ID` : '',
    r.excludeIds?.length ? `less ${r.excludeIds.length} named by ID` : '',
  ].filter(Boolean);
  return `${seg} is ${vals}${extra.length ? `, ${extra.join(', ')}` : ''}`;
}

/** How many activities carry each value of a segment, most common first. */
export function segmentCounts(codes: string[], segment: number): { value: string; count: number }[] {
  const m = new Map<string, { value: string; count: number }>();
  for (const c of codes) {
    const v = segmentOf(c, segment).toUpperCase();
    const k = v || '(none)';
    const hit = m.get(k);
    if (hit) hit.count += 1;
    else m.set(k, { value: v, count: 1 });
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/**
 * The rule to start from, when the job has none yet.
 *
 * With a schedule already in use — the filtered Excel export — the answer is
 * whatever reproduces it: the work types that make up most of it, plus any odd
 * activity outside those (a programme milestone the filter happened to include)
 * named by its ID. Then the first XER import reads exactly what the last Excel
 * import did, and anything new is new in P6, not an artefact of switching files.
 * With nothing in use, it is the T&C work type.
 */
export function proposeScope(current: P6Activity[] | null | undefined, segment = 3): ScopeRule {
  const acts = (current ?? []).filter((a) => a.rowType === 'ACTIVITY' && a.activityId.trim() !== '');
  if (acts.length === 0) return { ...DEFAULT_SCOPE, segment };
  const counts = segmentCounts(acts.map((a) => a.activityId), segment);
  // A value is a family when it carries a real share of the schedule; anything
  // rarer is an exception better named one by one than swept in wholesale.
  const big = counts.filter((c) => c.value !== '' && (c.count >= 5 || c.count / acts.length >= 0.05)).map((c) => c.value);
  const values = big.length ? big : segment === 3 ? ['TC'] : [];
  const test = scopeTest({ segment, values });
  const ids = acts.filter((a) => !test(a.activityId)).map((a) => a.activityId.trim());
  return normalizeScope({ segment, values, ids });
}

// ---- projects in the file -----------------------------------------------------------

export type ProjectRoles = {
  /** Projects that are not a baseline of another project in the file, largest first. */
  mains: P6ProjectInfo[];
  /** For each main project, the baselines of it that the file also carries. */
  baselinesOf: Map<string, P6ProjectInfo[]>;
};

/**
 * Which project in the file is the schedule, and which are its baselines.
 *
 * P6 can export a project with its baselines; each baseline is a copy whose
 * `orig_proj_id` names the project it was taken from, and the project names its
 * own baseline in `sum_base_proj_id`. Either link is enough to tell them apart.
 */
export function projectRoles(model: P6Project): ProjectRoles {
  const byUid = new Map(model.projects.map((p) => [p.uid, p]));
  const baselineOf = new Map<string, string>();
  for (const p of model.projects) {
    if (p.origProjUid && p.origProjUid !== p.uid && byUid.has(p.origProjUid)) baselineOf.set(p.uid, p.origProjUid);
  }
  for (const p of model.projects) {
    if (p.baselineProjUid && p.baselineProjUid !== p.uid && byUid.has(p.baselineProjUid) && !baselineOf.has(p.uid)) baselineOf.set(p.baselineProjUid, p.uid);
  }
  const mains = model.projects.filter((p) => !baselineOf.has(p.uid) && p.taskCount > 0).sort((a, b) => b.taskCount - a.taskCount || a.shortName.localeCompare(b.shortName));
  const baselinesOf = new Map<string, P6ProjectInfo[]>();
  for (const [bl, main] of baselineOf) {
    const p = byUid.get(bl);
    if (!p || p.taskCount === 0) continue;
    const list = baselinesOf.get(main) ?? [];
    list.push(p);
    baselinesOf.set(main, list);
  }
  // The project's own nominated baseline first.
  for (const [main, list] of baselinesOf) {
    const own = byUid.get(main)?.baselineProjUid;
    list.sort((a, b) => (a.uid === own ? -1 : b.uid === own ? 1 : 0) || b.taskCount - a.taskCount);
  }
  return { mains: mains.length ? mains : [...model.projects].filter((p) => p.taskCount > 0), baselinesOf };
}

// ---- into the budget's shape --------------------------------------------------------

export type ToActivitiesOptions = {
  /** Hours per day for an activity whose calendar is not in the file. */
  hoursPerDay: number;
  /** Attach the float, logic and resources only an XER has. On for a current schedule. */
  extras?: boolean;
};

const MAX_LINKS = 8;

function hpdFor(model: P6Project, t: P6Task, fallback: number): number {
  const cal = model.calendars.get(t.calUid);
  return cal && cal.hoursPerDay > 0 ? cal.hoursPerDay : fallback;
}

/** Hours to days the way the budget import has always done it: two decimals, as text. */
function daysText(hours: number | null, hpd: number): string {
  if (hours === null || !Number.isFinite(hours)) return '';
  return String(Math.round((hours / hpd) * 100) / 100);
}

/**
 * The one activity, exactly as the Excel path would have produced it from the
 * same project. An actual date carries the " A" P6 itself prints, so the one row
 * parser reads both formats and the actual flags land in the same place.
 */
export function taskToActivity(model: P6Project, t: P6Task, order: number, fallbackHpd: number): P6Activity {
  const hpd = hpdFor(model, t, fallbackHpd);
  const start = msToDate(t.start);
  const finish = msToDate(t.finish);
  return parseP6Row(
    {
      activityId: t.code,
      activityName: t.name,
      originalDuration: daysText(t.odHrs, hpd),
      remainingDuration: daysText(t.rdHrs, hpd),
      start: start === null ? '' : t.actStart !== null ? `${start} A` : start,
      finish: finish === null ? '' : t.actFinish !== null ? `${finish} A` : finish,
    },
    order,
  );
}

/** Whose work an activity is, as near as the file says: its work type, else its WBS. */
export function ownerOf(model: P6Project, t: P6Task): string {
  const wt = segmentOf(t.code, 3);
  if (wt && t.code.split('-').length >= 4) return wt.toUpperCase();
  const chain = wbsChain(model, t.wbsUid).filter((w) => !w.isProjectNode);
  return chain.length ? chain[chain.length - 1].name || chain[chain.length - 1].code : '';
}

/** What only the XER knows about an activity, in the form the budget's screens keep. */
export function extrasFor(model: P6Project, project: P6ProjectInfo | undefined, t: P6Task, inScope: (id: string) => boolean): P6Extras {
  const open = t.status === 'COMPLETE' ? [] : openPredecessors(model, t.uid);
  const links: P6Link[] = open.slice(0, MAX_LINKS).map((v) => ({
    id: v.pred.code,
    name: v.pred.name,
    rel: v.rel.type,
    lagDays: v.lagDays,
    status: v.pred.status,
    start: msToDate(v.pred.start),
    finish: msToDate(v.pred.finish),
    inScope: inScope(v.pred.code),
    group: ownerOf(model, v.pred),
    wbs: wbsPathName(model, v.pred.wbsUid),
    driving: v.state === 'DRIVING' || v.state === 'VIOLATED',
  }));
  const cal = model.calendars.get(t.calUid);
  const resources = assignmentLines(model, t.uid)
    .filter((l) => l.type === '' || l.type === 'Labor')
    .map((l) => ({ name: l.resource, budget: Math.round(l.budget * 100) / 100, remaining: Math.round(l.remaining * 100) / 100 }));
  const extras: P6Extras = {
    status: t.status,
    wbs: wbsPathName(model, t.wbsUid),
    totalFloat: totalFloatDays(t),
    freeFloat: freeFloatDays(t),
    critical: isCritical(t, project),
    lateStart: msToDate(t.lateStart),
    lateFinish: msToDate(t.lateFinish),
    p6Pct: Math.round(p6Percent(t) * 10000) / 10000,
    pctType: t.pctType,
    taskType: TASK_TYPE_LABEL[t.type],
    calendar: cal?.name ?? '',
    preds: model.predsOf.get(t.uid)?.length ?? 0,
    succs: model.succsOf.get(t.uid)?.length ?? 0,
    waitingOn: links,
    waitingOnCount: open.length,
    resources,
  };
  if (t.cstrType) {
    extras.constraint = CONSTRAINT_LABEL[t.cstrType] ?? t.cstrType;
    extras.constraintDate = msToDate(t.cstrDate);
    extras.hardConstraint = HARD_CONSTRAINTS.has(t.cstrType);
  }
  return extras;
}

export type ScopedImport = {
  activities: P6Activity[];
  /** Activities in the project in all, before the scope. */
  total: number;
};

/**
 * The project's in-scope activities as the budget reads them, in P6's file order.
 * With `extras`, each carries what only the XER knows.
 */
export function scopedActivities(model: P6Project, projUid: string, rule: ScopeRule, opts: ToActivitiesOptions): ScopedImport {
  const test = scopeTest(rule);
  const project = model.projects.find((p) => p.uid === projUid);
  const activities: P6Activity[] = [];
  let total = 0;
  let order = 0;
  for (const t of model.tasks) {
    if (t.projUid !== projUid) continue;
    total += 1;
    if (!test(t.code)) continue;
    const a = taskToActivity(model, t, order++, opts.hoursPerDay);
    if (opts.extras) a.p6 = extrasFor(model, project, t, test);
    activities.push(a);
  }
  return { activities, total };
}

export type ScopeComparison = {
  /** In both the schedule in use and this scope. */
  matched: number;
  /** In the scope, not in the schedule in use: new in P6, or outside the old filter. */
  added: P6Task[];
  /** In the schedule in use and in this file, but outside the scope. */
  outside: { activityId: string; activityName: string; segment: string }[];
  /** In the schedule in use and nowhere in this file. */
  gone: { activityId: string; activityName: string }[];
};

/**
 * The scope against the schedule in use, before anything is imported.
 *
 * This is what makes changing from the Excel export to the XER safe to do on an
 * ordinary update: the screen can say "every activity you had is still here" — or
 * name the ones that are not, and why — before a single figure moves.
 */
export function compareScope(model: P6Project, projUid: string, rule: ScopeRule, current: P6Activity[] | null | undefined): ScopeComparison | null {
  const acts = (current ?? []).filter((a) => a.rowType === 'ACTIVITY' && a.activityId.trim() !== '');
  if (acts.length === 0) return null;
  const test = scopeTest(rule);
  const r = normalizeScope(rule);
  const inFile = new Map<string, P6Task>();
  for (const t of model.tasks) if (t.projUid === projUid && !inFile.has(normKey(t.code))) inFile.set(normKey(t.code), t);
  const have = new Set(acts.map((a) => normKey(a.activityId)));
  let matched = 0;
  const outside: ScopeComparison['outside'] = [];
  const gone: ScopeComparison['gone'] = [];
  for (const a of acts) {
    const t = inFile.get(normKey(a.activityId));
    if (!t) gone.push({ activityId: a.activityId, activityName: a.activityName });
    else if (test(t.code)) matched += 1;
    else outside.push({ activityId: a.activityId, activityName: a.activityName, segment: segmentOf(a.activityId, r.segment) });
  }
  const added = [...inFile.values()].filter((t) => test(t.code) && !have.has(normKey(t.code)));
  return { matched, added, outside, gone };
}

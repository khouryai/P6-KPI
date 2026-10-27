/**
 * The activity list as the Schedule screen lays it out: filtered, grouped into
 * bands, sorted inside each band, and flattened into the rows actually drawn.
 *
 * Kept apart from the screen so the rules — which bands show, what a collapsed band
 * hides, what a band's dates are — are tested here rather than by clicking.
 */
import { isCritical, totalFloatDays, wbsCode, type P6Project, type P6ProjectInfo, type P6Task } from './xerProject';

export type OutlineGroup = {
  kind: 'group';
  /** Unique across the outline: `wbs:<uid>` or `v:<value>`. */
  key: string;
  depth: number;
  label: string;
  /** The WBS code, for a WBS band. */
  code: string;
  /** Activities beneath it that pass the filter, at any depth. */
  count: number;
  /** Of those, the ones that are critical. */
  critical: number;
  start: number | null;
  finish: number | null;
  collapsed: boolean;
};

export type OutlineTask = { kind: 'task'; key: string; depth: number; task: P6Task };

export type OutlineRow = OutlineGroup | OutlineTask;

export type GroupSpec =
  | { kind: 'none' }
  | { kind: 'wbs' }
  | {
      kind: 'field';
      /** The band an activity goes in. '' is its own band, shown last. */
      keyOf: (t: P6Task) => string;
      labelOf?: (key: string) => string;
      /** Band order. Defaults to the label, numbers in number order. */
      order?: (a: string, b: string) => number;
    };

type Acc = { count: number; critical: number; start: number | null; finish: number | null };

const blankAcc = (): Acc => ({ count: 0, critical: 0, start: null, finish: null });

function addTask(acc: Acc, t: P6Task, critical: boolean): void {
  acc.count += 1;
  if (critical) acc.critical += 1;
  if (t.start !== null && (acc.start === null || t.start < acc.start)) acc.start = t.start;
  if (t.finish !== null && (acc.finish === null || t.finish > acc.finish)) acc.finish = t.finish;
}

function addAcc(into: Acc, from: Acc): void {
  into.count += from.count;
  into.critical += from.critical;
  if (from.start !== null && (into.start === null || from.start < into.start)) into.start = from.start;
  if (from.finish !== null && (into.finish === null || from.finish > into.finish)) into.finish = from.finish;
}

/**
 * Lay the activities out.
 *
 * `tasks` are the ones that passed the filter, in any order; `compare` orders them
 * inside each band. A band nothing passed through is not shown at all, so filtering
 * to "critical" leaves only the WBS branches that have critical work in them.
 */
export function buildOutline(
  model: P6Project,
  project: P6ProjectInfo | undefined,
  tasks: P6Task[],
  group: GroupSpec,
  collapsed: Set<string>,
  compare: (a: P6Task, b: P6Task) => number,
): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const crit = (t: P6Task) => isCritical(t, project);

  if (group.kind === 'none') {
    for (const t of [...tasks].sort(compare)) rows.push({ kind: 'task', key: t.uid, depth: 0, task: t });
    return rows;
  }

  if (group.kind === 'field') {
    const bands = new Map<string, P6Task[]>();
    for (const t of tasks) {
      const k = group.keyOf(t);
      const list = bands.get(k);
      if (list) list.push(t);
      else bands.set(k, [t]);
    }
    const label = (k: string) => (k === '' ? '(none)' : group.labelOf ? group.labelOf(k) : k);
    const order = group.order ?? ((a: string, b: string) => label(a).localeCompare(label(b), undefined, { numeric: true }));
    const keys = [...bands.keys()].sort((a, b) => (a === '' ? 1 : b === '' ? -1 : order(a, b)));
    for (const k of keys) {
      const list = bands.get(k)!.sort(compare);
      const acc = blankAcc();
      for (const t of list) addTask(acc, t, crit(t));
      const key = `v:${k}`;
      const isCollapsed = collapsed.has(key);
      rows.push({ kind: 'group', key, depth: 0, label: label(k), code: '', ...acc, collapsed: isCollapsed });
      if (!isCollapsed) for (const t of list) rows.push({ kind: 'task', key: t.uid, depth: 1, task: t });
    }
    return rows;
  }

  // By WBS: the tree, pruned to the branches that hold something.
  const direct = new Map<string, P6Task[]>();
  for (const t of tasks) {
    const list = direct.get(t.wbsUid);
    if (list) list.push(t);
    else direct.set(t.wbsUid, [t]);
  }
  const totals = new Map<string, Acc>();
  const visiting = new Set<string>();
  const total = (uid: string): Acc => {
    const hit = totals.get(uid);
    if (hit) return hit;
    const acc = blankAcc();
    if (visiting.has(uid)) return acc;
    visiting.add(uid);
    for (const t of direct.get(uid) ?? []) addTask(acc, t, crit(t));
    for (const c of model.wbs.get(uid)?.children ?? []) addAcc(acc, total(c));
    visiting.delete(uid);
    totals.set(uid, acc);
    return acc;
  };

  const projUids = new Set(tasks.map((t) => t.projUid));
  const roots: string[] = [];
  const topTasks: P6Task[] = [];
  for (const w of model.wbs.values()) {
    if (!projUids.has(w.projUid)) continue;
    if (w.isProjectNode) {
      for (const c of w.children) roots.push(c);
      topTasks.push(...(direct.get(w.uid) ?? []));
    } else if (!model.wbs.has(w.parentUid)) roots.push(w.uid);
  }
  // Activities whose WBS is not in the file at all still have to appear somewhere.
  for (const [uid, list] of direct) if (!model.wbs.has(uid)) topTasks.push(...list);
  const seqOf = (uid: string) => model.wbs.get(uid)?.seq ?? 0;
  roots.sort((a, b) => seqOf(a) - seqOf(b) || (model.wbs.get(a)?.code ?? '').localeCompare(model.wbs.get(b)?.code ?? '', undefined, { numeric: true }));

  for (const t of topTasks.sort(compare)) rows.push({ kind: 'task', key: t.uid, depth: 0, task: t });
  const seen = new Set<string>();
  const emit = (uid: string, depth: number) => {
    if (seen.has(uid)) return;
    seen.add(uid);
    const w = model.wbs.get(uid);
    if (!w) return;
    const acc = total(uid);
    if (acc.count === 0) return;
    const key = `wbs:${uid}`;
    const isCollapsed = collapsed.has(key);
    rows.push({ kind: 'group', key, depth, label: w.name || w.code, code: wbsCode(model, uid), ...acc, collapsed: isCollapsed });
    if (isCollapsed) return;
    for (const t of (direct.get(uid) ?? []).sort(compare)) rows.push({ kind: 'task', key: t.uid, depth: depth + 1, task: t });
    for (const c of w.children) emit(c, depth + 1);
  };
  for (const r of roots) emit(r, 0);
  return rows;
}

/** Every band the outline would have with nothing collapsed, for expand and collapse all. */
export function groupKeys(rows: OutlineRow[]): { key: string; depth: number }[] {
  return rows.filter((r): r is OutlineGroup => r.kind === 'group').map((r) => ({ key: r.key, depth: r.depth }));
}

// ---- the filter ---------------------------------------------------------------------

export type StatusFilter = 'all' | 'open' | 'not-started' | 'in-progress' | 'complete';
export type FloatFilter = 'any' | 'critical' | 'near' | 'negative';
export type ScopeFilter = 'all' | 'in' | 'out';

export type TaskFilter = {
  /** Every word must appear in the Activity ID or the name. */
  text?: string;
  scope?: ScopeFilter;
  status?: StatusFilter;
  float?: FloatFilter;
  /** "Near critical" is total float at or under this many working days. */
  nearDays?: number;
  /** Only activities whose dates overlap this window. */
  window?: { from: number; to: number } | null;
  /** Only these activities, by uid: a trace, or a list from another tab. */
  only?: Set<string> | null;
};

export function makeTaskFilter(project: P6ProjectInfo | undefined, f: TaskFilter, inScope: (t: P6Task) => boolean): (t: P6Task) => boolean {
  const words = (f.text ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const near = f.nearDays ?? 10;
  return (t) => {
    if (f.only && !f.only.has(t.uid)) return false;
    if (f.scope === 'in' && !inScope(t)) return false;
    if (f.scope === 'out' && inScope(t)) return false;
    switch (f.status) {
      case 'open':
        if (t.status === 'COMPLETE') return false;
        break;
      case 'not-started':
        if (t.status !== 'NOT STARTED') return false;
        break;
      case 'in-progress':
        if (t.status !== 'IN PROGRESS') return false;
        break;
      case 'complete':
        if (t.status !== 'COMPLETE') return false;
        break;
      default:
        break;
    }
    if (f.float && f.float !== 'any') {
      if (f.float === 'critical' && !isCritical(t, project)) return false;
      const tf = totalFloatDays(t);
      if (f.float === 'near' && (tf === null || tf > near)) return false;
      if (f.float === 'negative' && (tf === null || tf >= 0)) return false;
    }
    if (f.window) {
      if (t.start === null && t.finish === null) return false;
      const s = t.start ?? t.finish!;
      const e = t.finish ?? t.start!;
      if (e < f.window.from || s > f.window.to) return false;
    }
    if (words.length) {
      const hay = `${t.code} ${t.name}`.toLowerCase();
      for (const w of words) if (!hay.includes(w)) return false;
    }
    return true;
  };
}

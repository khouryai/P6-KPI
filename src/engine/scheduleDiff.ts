/**
 * What changed between two schedules.
 *
 * The monthly import used to answer this with counts: 1,000 rows in, 12 not in the
 * baseline. The question anybody actually has is which activities moved and by how
 * much — and it has to be answerable *before* confirming an import, because that is
 * when it is still a decision rather than a fact.
 *
 * Everything here compares on the trimmed Activity ID, the same join the rest of
 * the application uses, and reports only what P6 owns: dates, durations, the name
 * and whether a date became actual. Nothing the user keyed is involved; an import
 * cannot touch it.
 */
import type { P6Activity } from './types';
import { normKey } from './keys';
import { isoToMs } from './dates';

/** How an activity differs, or that it is new or gone. */
export type ChangeKind = 'added' | 'removed' | 'changed' | 'unchanged';

/** One field that moved, named the way the import screen shows it. */
export type FieldChange = { field: string; from: string; to: string; days?: number };

export type ActivityChange = {
  activityId: string;
  /** The name in whichever schedule has it: the incoming one for preference. */
  activityName: string;
  kind: ChangeKind;
  /** Calendar days the finish moved. Positive is later, negative is earlier. */
  finishMovedDays: number | null;
  /** Calendar days the start moved. */
  startMovedDays: number | null;
  /** The activity newly carries an actual finish, so it completed since. */
  newlyFinished: boolean;
  /** The activity newly carries an actual start. */
  newlyStarted: boolean;
  /** Every field that differs, for the row to explain itself. */
  fields: FieldChange[];
};

export type ScheduleDiff = {
  added: ActivityChange[];
  removed: ActivityChange[];
  changed: ActivityChange[];
  unchanged: number;
  /** Activities whose finish moved later, worst first. The slip list. */
  slipped: ActivityChange[];
  /** Activities whose finish moved earlier. */
  pulledIn: ActivityChange[];
  /** Newly carrying an actual finish: what completed between the two schedules. */
  finished: ActivityChange[];
  /** Newly carrying an actual start. */
  started: ActivityChange[];
};

const days = (from: string | null, to: string | null): number | null =>
  from && to ? Math.round((isoToMs(to) - isoToMs(from)) / 86_400_000) : null;

/** A date as the diff prints it: the ISO date, or a dash where there was none. */
const shown = (iso: string | null, actual: boolean): string => (iso ? `${iso}${actual ? ' A' : ''}` : '—');

const num = (n: number | null): string => (n === null ? '—' : String(n));

function compare(before: P6Activity, after: P6Activity): ActivityChange {
  const fields: FieldChange[] = [];

  const startMovedDays = days(before.startDate, after.startDate);
  const finishMovedDays = days(before.finishDate, after.finishDate);

  const startBefore = shown(before.startDate, before.actualStart);
  const startAfter = shown(after.startDate, after.actualStart);
  if (startBefore !== startAfter) fields.push({ field: 'Start', from: startBefore, to: startAfter, days: startMovedDays ?? undefined });

  const finishBefore = shown(before.finishDate, before.actualFinish);
  const finishAfter = shown(after.finishDate, after.actualFinish);
  if (finishBefore !== finishAfter) fields.push({ field: 'Finish', from: finishBefore, to: finishAfter, days: finishMovedDays ?? undefined });

  if (before.originalDuration !== after.originalDuration) {
    fields.push({ field: 'Original duration', from: num(before.originalDuration), to: num(after.originalDuration) });
  }
  if (before.remainingDuration !== after.remainingDuration) {
    fields.push({ field: 'Remaining duration', from: num(before.remainingDuration), to: num(after.remainingDuration) });
  }
  if (before.activityName !== after.activityName) {
    fields.push({ field: 'Name', from: before.activityName, to: after.activityName });
  }

  return {
    activityId: after.activityId,
    activityName: after.activityName,
    kind: fields.length ? 'changed' : 'unchanged',
    startMovedDays: startMovedDays === 0 ? null : startMovedDays,
    finishMovedDays: finishMovedDays === 0 ? null : finishMovedDays,
    newlyFinished: after.actualFinish && !before.actualFinish,
    newlyStarted: after.actualStart && !before.actualStart,
    fields,
  };
}

const blank = (a: P6Activity, kind: 'added' | 'removed'): ActivityChange => ({
  activityId: a.activityId,
  activityName: a.activityName,
  kind,
  startMovedDays: null,
  finishMovedDays: null,
  newlyFinished: kind === 'added' && a.actualFinish,
  newlyStarted: kind === 'added' && a.actualStart,
  fields: [],
});

/**
 * Compare an incoming schedule against the one in use.
 *
 * WBS rows are left out: they carry rolled-up durations that move whenever anything
 * underneath them does, so including them would bury every real change under a
 * hundred summary rows that say nothing on their own.
 */
export function diffSchedules(before: P6Activity[], after: P6Activity[]): ScheduleDiff {
  const acts = (list: P6Activity[]) => list.filter((a) => a.rowType === 'ACTIVITY' && a.activityId.trim() !== '');
  const beforeIdx = new Map<string, P6Activity>();
  for (const a of acts(before)) if (!beforeIdx.has(normKey(a.activityId))) beforeIdx.set(normKey(a.activityId), a);

  const added: ActivityChange[] = [];
  const changed: ActivityChange[] = [];
  const seen = new Set<string>();
  let unchanged = 0;

  for (const a of acts(after)) {
    const k = normKey(a.activityId);
    if (seen.has(k)) continue;
    seen.add(k);
    const prev = beforeIdx.get(k);
    if (!prev) {
      added.push(blank(a, 'added'));
      continue;
    }
    const c = compare(prev, a);
    if (c.kind === 'changed') changed.push(c);
    else unchanged += 1;
  }

  const removed = acts(before)
    .filter((a) => !seen.has(normKey(a.activityId)))
    .map((a) => blank(a, 'removed'));

  // Worst slip first: that is the order anybody reading a change report wants.
  const byFinish = (dir: 1 | -1) => (x: ActivityChange, y: ActivityChange) =>
    dir * ((y.finishMovedDays ?? 0) - (x.finishMovedDays ?? 0));

  return {
    added,
    removed,
    changed,
    unchanged,
    slipped: changed.filter((c) => (c.finishMovedDays ?? 0) > 0).sort(byFinish(1)),
    pulledIn: changed.filter((c) => (c.finishMovedDays ?? 0) < 0).sort(byFinish(-1)),
    finished: changed.filter((c) => c.newlyFinished),
    started: changed.filter((c) => c.newlyStarted && !c.newlyFinished),
  };
}

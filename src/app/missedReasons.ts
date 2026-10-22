/**
 * Why an activity that was due to finish did not.
 *
 * The log can already say WHAT slipped, to the hour. It could never say WHY, which
 * is the only half anybody acts on: "eleven activities missed" is a number, and
 * "seven of them waiting on access" is a decision. So each missed activity carries
 * a reason, picked from a list the person extends as the job teaches them new ones.
 *
 * Two rules hold the shape of this:
 *
 * - The catalogue is never fixed. Every project argues about its own categories and
 *   a taxonomy shipped in the code would be wrong everywhere. It starts with a few
 *   obvious ones, and anything typed into the dropdown joins it permanently — kept
 *   explicitly rather than derived from the reasons in use, so a reason stays on
 *   offer after the last activity carrying it is re-dated or finished.
 * - A reason belongs to the activity, not to a reporting date. Whatever date the log
 *   is set to, an activity shows one answer — the last one anybody gave it — and it
 *   can be changed or cleared from there, whatever date it was first given at. An
 *   earlier version tied each answer to the period it was written in and showed a
 *   neighbouring period's answer greyed out as "carried", which read as locked: it
 *   could be overridden but not cleared, and two reviews' answers showed or hid
 *   depending on the end date picked. Each answer is still stamped with the review
 *   it was given at, and a later answer given at a different review is added beside
 *   the earlier one rather than over it, so the history of what was said when
 *   survives for the export; it just never decides what the screen shows.
 */
import type { MissedReason, MissedReasonLog } from '../engine/types';
import { DEFAULT_MISSED_REASONS, DEFAULT_OUTSIDE_CONTROL } from '../engine/types';
import { normKey } from '../engine/keys';
import { periodBridge, type PeriodActivity, type PeriodBridge } from '../engine/period';
import type { DataUpdater } from './state';

/**
 * The reasons on offer: the built-in ones, then everything this job has added,
 * minus anything taken off the list.
 *
 * A reason recorded against an activity is always offered, whatever the removed
 * list says. The list is only removable where nothing uses it, so this is the
 * defensive case — a file edited by hand — and a row whose own answer is missing
 * from its own dropdown is worse than a list with one entry too many on it.
 */
export function reasonCatalogue(log: MissedReasonLog): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const gone = new Set((log.removed ?? []).map(normKey));
  const add = (r: string, force = false) => {
    const t = r.trim();
    if (!t || seen.has(normKey(t))) return;
    if (!force && gone.has(normKey(t))) return;
    seen.add(normKey(t));
    out.push(t);
  };
  DEFAULT_MISSED_REASONS.forEach((r) => add(r));
  log.reasons.forEach((r) => add(r));
  log.entries.forEach((e) => add(e.reason, true));
  return out;
}

/**
 * How many activities each reason is recorded against, across every period. This is
 * what says whether a reason can be taken off the list: one nobody has used is
 * clutter, and one in use is somebody's answer.
 */
export function reasonUsage(log: MissedReasonLog): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of log.entries) {
    const k = normKey(e.reason);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** True when nothing anywhere has been recorded against this reason. */
export function isReasonUnused(log: MissedReasonLog, reason: string): boolean {
  return !reasonUsage(log).get(normKey(reason));
}

/** What was said about this activity, for exactly this period and no other. */
export function reasonFor(log: MissedReasonLog, activityId: string, periodEnd: string): MissedReason | undefined {
  return log.entries.find((e) => normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd);
}

/**
 * The answer that stands for this activity, whatever period the log is showing: the
 * last one given, at any review. `carried` says only that it was given at a review
 * ending on a different date — for the tooltip and the export, never to lock it.
 */
export type EffectiveReason = { entry: MissedReason; carried: boolean };

export function effectiveReasonFor(log: MissedReasonLog, activityId: string, periodEnd: string): EffectiveReason | undefined {
  const entry = currentReason(log, activityId);
  return entry ? { entry, carried: entry.periodEnd !== periodEnd } : undefined;
}

/**
 * The activity's current answer: the most recently given, at whichever review.
 * Ties on the timestamp — two answers written in the same instant, or a file with
 * none — go to the one later in the file, which is the one written last.
 */
export function currentReason(log: MissedReasonLog, activityId: string): MissedReason | undefined {
  let best: { e: MissedReason; at: number; i: number } | undefined;
  log.entries.forEach((e, i) => {
    if (normKey(e.activityId) !== normKey(activityId) || !e.reason.trim()) return;
    const at = Date.parse(e.updatedAt) || 0;
    if (!best || at > best.at || (at === best.at && i > best.i)) best = { e, at, i };
  });
  return best?.e;
}

/**
 * Whether this answer is the one its activity currently stands on, rather than one
 * an earlier review gave and a later one replaced.
 */
export function isCurrentReason(log: MissedReasonLog, entry: MissedReason): boolean {
  return currentReason(log, entry.activityId) === entry;
}

/**
 * Give one activity its reason, from the log showing the period ending `periodEnd`.
 *
 * It becomes the activity's answer in every period. It is recorded against the
 * period on screen — replacing what was said at that same review, and kept beside
 * what earlier reviews said, as the history. An empty reason clears the activity's
 * answer altogether, at every review, so a cleared row stays cleared whatever date
 * is picked next.
 */
export function setMissedReason(update: DataUpdater, activityId: string, periodEnd: string, reason: string, note?: string): void {
  const text = reason.trim();
  update('missedReasons', (log) => {
    if (!text) return { ...log, entries: log.entries.filter((e) => normKey(e.activityId) !== normKey(activityId)) };
    const same = log.entries.find((e) => normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd);
    // A note written with this review's answer survives the answer being changed.
    const keptNote = note === undefined ? same?.note : note.trim();
    const entry: MissedReason = {
      activityId: activityId.trim(),
      periodEnd,
      reason: text,
      ...(keptNote ? { note: keptNote } : {}),
      updatedAt: new Date().toISOString(),
    };
    // Written last in the file as well as stamped now, so it is the current answer
    // even when two edits land within the same millisecond.
    const entries = [...log.entries.filter((e) => !(normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd)), entry];
    // A reason used is a reason kept: it joins the catalogue here rather than only
    // when it was typed, so one imported or pasted in is offered like any other —
    // and using one that had been taken off the list puts it back, since a reason
    // somebody is answering with is plainly not one they meant to be rid of.
    const known = new Set([...DEFAULT_MISSED_REASONS, ...log.reasons].map(normKey));
    return {
      ...log,
      removed: (log.removed ?? []).filter((r) => normKey(r) !== normKey(text)),
      reasons: known.has(normKey(text)) ? log.reasons : [...log.reasons, text],
      entries,
    };
  });
}

/**
 * Put a reason on the list without attaching it to anything yet. Typing back one
 * that was removed — a built-in included — simply un-removes it.
 */
export function addReasonToCatalogue(update: DataUpdater, reason: string): void {
  const text = reason.trim();
  if (!text) return;
  update('missedReasons', (log) => {
    const removed = (log.removed ?? []).filter((r) => normKey(r) !== normKey(text));
    const known = new Set([...DEFAULT_MISSED_REASONS, ...log.reasons].map(normKey));
    return { ...log, removed, reasons: known.has(normKey(text)) ? log.reasons : [...log.reasons, text] };
  });
}

/**
 * Take a reason off the list.
 *
 * Nothing recorded against it is touched — this is the list, not the answers — but
 * the caller is expected to have checked `isReasonUnused` first, because a reason
 * in use disappearing from the dropdown would leave rows nobody could re-answer.
 * A built-in reason is remembered as removed, or it would come back on the next
 * render: the built-in list lives in the code, not in the file.
 */
export function removeReasonFromCatalogue(update: DataUpdater, reason: string): void {
  const text = reason.trim();
  if (!text) return;
  update('missedReasons', (log) => {
    const removed = new Set((log.removed ?? []).map((r) => r.trim()).filter(Boolean));
    if (DEFAULT_MISSED_REASONS.some((d) => normKey(d) === normKey(text))) removed.add(text);
    return { ...log, reasons: log.reasons.filter((r) => normKey(r) !== normKey(text)), removed: [...removed] };
  });
}

export type ReasonTally = { reason: string; count: number };

/**
 * How the missed activities of one period break down by reason, biggest first,
 * with the ones nobody has answered for counted last under a name of their own.
 * That last figure is the one that says whether the review actually happened.
 */
export function tallyReasons(log: MissedReasonLog, activityIds: string[], periodEnd: string): { given: ReasonTally[]; unexplained: number; carried: number } {
  const counts = new Map<string, number>();
  let unexplained = 0;
  let carried = 0;
  for (const id of activityIds) {
    const eff = effectiveReasonFor(log, id, periodEnd);
    if (!eff) unexplained += 1;
    else {
      counts.set(eff.entry.reason, (counts.get(eff.entry.reason) ?? 0) + 1);
      if (eff.carried) carried += 1;
    }
  }
  const given = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { given, unexplained, carried };
}

/**
 * Whether a reason is outside the team's control: a predecessor, access, readiness.
 *
 * What a person set wins; otherwise the built-in answer; otherwise it is the team's
 * own. That last default is deliberate. A reason typed in a hurry should never quietly
 * shrink the plan the team is judged against — somebody has to say it does.
 */
export function isOutsideControl(log: MissedReasonLog, reason: string): boolean {
  const k = normKey(reason);
  const set = log.outsideControl?.[k];
  if (typeof set === 'boolean') return set;
  return DEFAULT_OUTSIDE_CONTROL.some((d) => normKey(d) === k);
}

/** Say whether a reason is outside the team's control. Kept against the reason, for every period. */
export function setOutsideControl(update: DataUpdater, reason: string, outside: boolean): void {
  const text = reason.trim();
  if (!text) return;
  update('missedReasons', (log) => ({ ...log, outsideControl: { ...(log.outsideControl ?? {}), [normKey(text)]: outside } }));
}

/**
 * The fortnight's bridge from planned to achieved, with each row's reason read from
 * the log the way the screens show it — the activity's current answer — and classed
 * by whether it is outside the team's control.
 */
export function bridgeFor(log: MissedReasonLog, activities: PeriodActivity[], periodEnd: string): PeriodBridge {
  return periodBridge(activities, (a) => {
    const eff = effectiveReasonFor(log, a.activityId, periodEnd);
    return eff ? { reason: eff.entry.reason, outsideControl: isOutsideControl(log, eff.entry.reason) } : null;
  });
}

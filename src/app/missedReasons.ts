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
 * - A reason belongs to a period as well as an activity. An activity missed in
 *   three consecutive fortnights usually has three different stories, and the
 *   second review overwriting the first would leave the first unable to explain
 *   itself.
 */
import type { MissedReason, MissedReasonLog } from '../engine/types';
import { DEFAULT_MISSED_REASONS } from '../engine/types';
import { normKey } from '../engine/keys';
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

/** What was said about this activity, for this period. */
export function reasonFor(log: MissedReasonLog, activityId: string, periodEnd: string): MissedReason | undefined {
  return log.entries.find((e) => normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd);
}

/**
 * Record why one activity was missed in one period. An empty reason removes the
 * record, so clearing a row leaves no trace of an answer nobody gave.
 */
export function setMissedReason(update: DataUpdater, activityId: string, periodEnd: string, reason: string, note?: string): void {
  const text = reason.trim();
  update('missedReasons', (log) => {
    const i = log.entries.findIndex((e) => normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd);
    if (!text) return i >= 0 ? { ...log, entries: log.entries.filter((_, j) => j !== i) } : log;
    const entry: MissedReason = {
      activityId: activityId.trim(),
      periodEnd,
      reason: text,
      ...(note?.trim() ? { note: note.trim() } : {}),
      updatedAt: new Date().toISOString(),
    };
    const entries = i >= 0 ? log.entries.map((e, j) => (j === i ? { ...e, ...entry } : e)) : [...log.entries, entry];
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
export function tallyReasons(log: MissedReasonLog, activityIds: string[], periodEnd: string): { given: ReasonTally[]; unexplained: number } {
  const counts = new Map<string, number>();
  let unexplained = 0;
  for (const id of activityIds) {
    const r = reasonFor(log, id, periodEnd)?.reason;
    if (!r) unexplained += 1;
    else counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const given = [...counts].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
  return { given, unexplained };
}

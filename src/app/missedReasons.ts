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

/** The reasons on offer: the built-in ones, then everything this job has added. */
export function reasonCatalogue(log: MissedReasonLog): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (r: string) => {
    const t = r.trim();
    if (!t || seen.has(normKey(t))) return;
    seen.add(normKey(t));
    out.push(t);
  };
  DEFAULT_MISSED_REASONS.forEach(add);
  log.reasons.forEach(add);
  // A reason on an entry but not in the catalogue can only come from a file edited
  // by hand or written by a version that kept the list differently. Offering it is
  // better than showing a row whose own answer is not in its own dropdown.
  log.entries.forEach((e) => add(e.reason));
  return out;
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
    // when it was typed, so one imported or pasted in is offered like any other.
    const known = new Set([...DEFAULT_MISSED_REASONS, ...log.reasons].map(normKey));
    return { reasons: known.has(normKey(text)) ? log.reasons : [...log.reasons, text], entries };
  });
}

/** Put a reason on the list without attaching it to anything yet. */
export function addReasonToCatalogue(update: DataUpdater, reason: string): void {
  const text = reason.trim();
  if (!text) return;
  update('missedReasons', (log) => {
    const known = new Set([...DEFAULT_MISSED_REASONS, ...log.reasons].map(normKey));
    return known.has(normKey(text)) ? log : { ...log, reasons: [...log.reasons, text] };
  });
}

/** Drop a reason from the list. Anything already recorded against it is untouched. */
export function removeReasonFromCatalogue(update: DataUpdater, reason: string): void {
  update('missedReasons', (log) => ({ ...log, reasons: log.reasons.filter((r) => normKey(r) !== normKey(reason)) }));
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

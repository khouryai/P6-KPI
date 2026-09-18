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
 * - A reason belongs to an activity first and to a period second. An activity
 *   missed in three consecutive fortnights usually has three different stories, so
 *   each answer is stamped with the period it was given for and the second review
 *   never overwrites the first. But the answer is still the ACTIVITY's: shifting the
 *   window's end date by a day is the same activity with the same story, so the
 *   nearest answer it has is what shows, marked as carried when it came from another
 *   period. Writing one always stamps the period on screen.
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

/** What was said about this activity, for exactly this period and no other. */
export function reasonFor(log: MissedReasonLog, activityId: string, periodEnd: string): MissedReason | undefined {
  return log.entries.find((e) => normKey(e.activityId) === normKey(activityId) && e.periodEnd === periodEnd);
}

/** Whole days between two ISO dates, however they are ordered. */
function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/**
 * The answer that stands for this activity when the log is showing this period.
 *
 * The reason belongs to the ACTIVITY first and to the period second. A reason keyed
 * against the fortnight to 9 Sep is still the reason that activity is late when the
 * window is nudged to the 8th or the 10th — the same activity, the same story, one
 * day of arithmetic apart — and the first version of this looked for an exact
 * periodEnd and so blanked every answer the moment somebody moved the end date by a
 * day. Answers still live per period, and writing one always stamps the period on
 * screen, so a fortnight that gets its own story keeps it and every earlier review
 * stays able to explain itself. What changed is only the reading: the nearest answer
 * that activity has wins, and `carried` says when it came from another period, so a
 * story being reused is visible rather than silently presented as this week's.
 */
export type EffectiveReason = { entry: MissedReason; carried: boolean };

export function effectiveReasonFor(log: MissedReasonLog, activityId: string, periodEnd: string): EffectiveReason | undefined {
  const mine = log.entries.filter((e) => normKey(e.activityId) === normKey(activityId));
  if (mine.length === 0) return undefined;
  const exact = mine.find((e) => e.periodEnd === periodEnd);
  if (exact) return { entry: exact, carried: false };
  // The nearest period, and the later one when two sit equally far off: of two
  // stories the same distance away, the more recent is the likelier to still hold.
  const best = mine.reduce((a, b) => {
    const da = daysApart(a.periodEnd, periodEnd);
    const db = daysApart(b.periodEnd, periodEnd);
    return db < da || (db === da && b.periodEnd > a.periodEnd) ? b : a;
  });
  return { entry: best, carried: true };
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

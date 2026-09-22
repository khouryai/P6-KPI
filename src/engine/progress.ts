/**
 * How far along an activity is, and why a keyed row might be earning nothing.
 *
 * Percent complete is keyed by hand; P6's durations are the fallback, with two
 * refusals in front of them. `checkReason` writes the sentence a person reads when
 * a keyed row does nothing, and lives here so the wording is in one place.
 */
import type { BudgetRow, P6Activity, PctSource, TestProgress, TestProgressCheck } from './types';


/**
 * The percent complete somebody keyed against an activity, or null when nobody has.
 *
 * One source, typed by hand. Anything not keyed falls back to P6's durations, and
 * the row says which of the two it used rather than leaving it to be guessed.
 */
export function testPctEffective(tp: TestProgress | undefined): { pct: number; source: PctSource } | null {
  if (!tp) return null;
  if (tp.pctOverride !== undefined && tp.pctOverride !== null && Number.isFinite(tp.pctOverride)) {
    return { pct: Math.max(0, Math.min(1, tp.pctOverride)), source: 'OVERRIDE' };
  }
  return null;
}

/**
 * Does this schedule mark its actual dates at all?
 *
 * P6 writes a trailing "A" on a date that really happened, and the whole app leans
 * on it. But whether it survives the trip out of P6 depends on how the export was
 * taken, and a file that carries none cannot be read the same way as one that does.
 * Asking the file once, rather than assuming, is what lets `p6PctComplete` use the
 * strongest signal available without inventing one that is not there.
 */
export function marksActuals(activities: P6Activity[]): boolean {
  return activities.some((a) => a.actualStart || a.actualFinish);
}

/**
 * Percent complete as P6's durations imply it, for an activity nobody has keyed.
 *
 * `(OD − RD) / OD`, with two refusals in front of it, both of which exist because
 * the arithmetic quietly reports 100% for work nobody has touched:
 *
 * A **missing remaining duration** is not zero remaining. An export without the
 * column, or with it blank, used to divide `(OD − 0) / OD` and call every activity
 * in the file complete — a schedule of 675 activities reporting 99.9% done with 0
 * running and 140 not started, and an earned curve that stopped at 40% because
 * those same rows had no dates to spread over. P6 has said nothing about progress
 * here, so the answer is nothing, not everything.
 *
 * An activity **P6 has not started** cannot have progressed, whatever its durations
 * say. That check is only applied where the file marks actual dates at all
 * (`marksActuals`), because in a file that marks none, "no actual start" means the
 * export dropped the flag rather than that the work has not begun — and zeroing
 * every row on the strength of a flag that was never written would be the same
 * class of mistake in the other direction.
 */
export function p6PctComplete(a: P6Activity, opts: { marksActuals?: boolean } = {}): number {
  if (a.actualFinish) return 1;
  if (opts.marksActuals && !a.actualStart) return 0;
  const od = a.originalDuration;
  if (od === null || !Number.isFinite(od) || od === 0) return 0;
  const rd = a.remainingDuration;
  if (rd === null || !Number.isFinite(rd)) return 0;
  return Math.max(0, Math.min(1, (od - rd) / od));
}

/**
 * Why a keyed Test Progress row matches nothing, in the words a person would use.
 *
 * "0-P2-TC-W40-FA-0100 does not match" tells nobody whether deleting it loses
 * anything. What they need is which of the five quite different things happened, so
 * they can decide in one read: a WBS header pasted in by mistake is junk, an
 * activity that left the schedule may be worth keeping, and an activity that is
 * there but priced at zero is a library problem, not a test-progress problem.
 */
export function checkReason(
  status: TestProgressCheck['status'],
  a: P6Activity | undefined,
  row: BudgetRow | null,
  inBudget: boolean,
): string {
  if (inBudget) return '';
  switch (status) {
    case 'not in extract':
      return 'No activity with this ID is in the current schedule. Either it was renumbered or removed in P6, or the ID was mistyped. Keeping it costs nothing and it starts counting again if the activity comes back.';
    case 'hidden':
      return 'You hid this activity, so it is out of the budget and what you keyed does nothing. Unhide it on Budget Master to put it back to work, or clear the row.';
    case 'not budgeted':
      return a?.rowType === 'WBS'
        ? 'This is a WBS summary header, not an activity. It can never carry hours or a percent complete. Safe to remove.'
        : 'This ID is in the schedule but produced no budget row, which should not happen. Worth reporting.';
    case 'REVIEW':
      return `Its activity type "${row?.activityType ?? ''}" is not priced in the Activity Library, so it budgets zero hours and nothing can be earned. Price the type and what you keyed starts working. Do not remove it.`;
    case 'EXCLUDED':
      return row?.visibility === 'EXCLUDED'
        ? 'You marked this activity excluded, so it carries no hours. What you keyed is kept and does nothing until you put it back in the budget.'
        : 'Its activity type is set to exclude in the Activity Library, so it carries no hours. Include the type, or force this one activity in from Budget Master.';
    case 'DELETED':
    case 'CANCELLED':
      return `P6 marks this activity ${status.toLowerCase()} in its name, so it is out of the budget. If it is really live work, force it in from Budget Master.`;
    case 'IN BUDGET':
      return 'This activity is in the budget but carries zero hours, so the percent changes nothing. Check its rate in the Activity Library.';
    default:
      return '';
  }
}

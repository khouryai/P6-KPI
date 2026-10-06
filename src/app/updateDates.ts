/**
 * Which plan a fortnight is measured against, and how each schedule update knows
 * its own data date.
 *
 * The Two-Week Log measures a window against the schedule update the team was
 * working to when the window began: the latest current-schedule import whose data
 * date is on or before the window's first day (see `PeriodPlan` in the engine for
 * why neither the baseline nor today's current schedule fits). That needs every
 * update to carry its data date, and an import has only ever recorded when the file
 * was imported, which can be days after the update was run.
 *
 * So:
 * - The current schedule in use takes Settings' data date. That is what the setting
 *   means, and it moves when the person moves it.
 * - When a new current schedule is imported, the one it replaces becomes history and
 *   is stamped with its data date then, because that is the last moment it is known.
 *   Whether Settings still describes the outgoing schedule or has already been moved
 *   for the incoming one is read off the files' own actual dates (`outgoingDataDate`).
 * - Any stamp can be corrected on the Import screen. An entry with none falls back
 *   to the day it was imported, marked as a guess.
 */
import type { ImportIndexEntry, P6Activity } from '../engine/types';
import { isValidISO } from '../engine/dates';

/** The latest date the file itself says work actually happened on. No data date can be before it. */
export function latestActualDate(activities: P6Activity[]): string | null {
  let out: string | null = null;
  for (const a of activities) {
    if (a.actualStart && isValidISO(a.startDate) && (!out || a.startDate > out)) out = a.startDate;
    if (a.actualFinish && isValidISO(a.finishDate) && (!out || a.finishDate > out)) out = a.finishDate;
  }
  return out;
}

/**
 * The data date to stamp on a current schedule as a new one replaces it.
 *
 * Settings' data date is the outgoing schedule's unless it has already been moved
 * for the incoming one. The files say which: an incoming schedule with actual dates
 * later than Settings means Settings is still the old date; one whose newest actual
 * is no later than Settings, but later than anything in the outgoing file, means
 * Settings has already moved on — and then the outgoing file's own newest actual is
 * the best estimate there is, flagged so it gets checked.
 */
export function outgoingDataDate(
  outgoing: P6Activity[],
  incoming: P6Activity[],
  settingsDate: string | null | undefined,
): { dataDate: string; estimated: boolean } | null {
  const settings = isValidISO(settingsDate ?? '') ? (settingsDate as string) : null;
  const outLatest = latestActualDate(outgoing);
  const inLatest = latestActualDate(incoming);
  if (!settings) return outLatest ? { dataDate: outLatest, estimated: true } : null;
  if (inLatest && settings < inLatest) return { dataDate: settings, estimated: false };
  if (inLatest && outLatest && inLatest > outLatest) return { dataDate: outLatest, estimated: true };
  return { dataDate: settings, estimated: false };
}

/** An import's data date, and how sure of it the app is. */
export type UpdateDate = { date: string; source: 'settings' | 'stamped' | 'estimated' | 'imported' };

export function updateDataDate(entry: ImportIndexEntry, currentId: string | null, settingsDate: string | null | undefined): UpdateDate {
  if (entry.id === currentId && isValidISO(settingsDate ?? '')) return { date: settingsDate as string, source: 'settings' };
  if (entry.dataDate && isValidISO(entry.dataDate)) return { date: entry.dataDate, source: entry.dataDateEstimated ? 'estimated' : 'stamped' };
  return { date: entry.importedAt.slice(0, 10), source: 'imported' };
}

/**
 * The update in force when a window begins: the latest current-schedule import whose
 * data date is on or before `from`. Two imports on the same data date — a re-import
 * of a corrected file — resolve to the later import.
 */
export function updateFor(
  index: ImportIndexEntry[],
  currentId: string | null,
  settingsDate: string | null | undefined,
  from: string,
): { entry: ImportIndexEntry; date: UpdateDate } | null {
  let best: { entry: ImportIndexEntry; date: UpdateDate } | null = null;
  for (const entry of index) {
    if (entry.kind !== 'current') continue;
    const date = updateDataDate(entry, currentId, settingsDate);
    if (date.date > from) continue;
    if (!best || date.date > best.date.date || (date.date === best.date.date && entry.importedAt > best.entry.importedAt)) best = { entry, date };
  }
  return best;
}


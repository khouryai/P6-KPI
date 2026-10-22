/**
 * Writing per-activity edits: the one way every screen adds to, changes or clears
 * an entry in activity-overrides.json.
 *
 * An entry is created when its first field is filled and removed again when its
 * last one is cleared, so the file only ever holds activities somebody actually
 * decided something about. The Activity ID is the key and is never written by an
 * edit: it is the one thing tying the file to the next import.
 */
import type { ActivityOverride } from '../engine/types';
import { normKey } from '../engine/keys';
import { isValidISO } from '../engine/dates';

/** Drop blank and undefined fields so activity-overrides.json stays readable. */
export function tidyOverride(o: ActivityOverride): ActivityOverride {
  const out: ActivityOverride = { activityId: o.activityId.trim() };
  if (o.overrideHours !== undefined && o.overrideHours !== null && Number.isFinite(o.overrideHours)) out.overrideHours = o.overrideHours;
  if (o.nameOverride?.trim()) out.nameOverride = o.nameOverride.trim();
  if (o.discipline?.trim()) out.discipline = o.discipline.trim();
  if (o.visibility) out.visibility = o.visibility;
  if (o.phase?.trim()) out.phase = o.phase.trim();
  if (o.location?.trim()) out.location = o.location.trim();
  const split = (o.locationSplit ?? []).filter((x) => x.location?.trim() && x.share > 0).map((x) => ({ location: x.location.trim(), share: x.share }));
  if (split.length) out.locationSplit = split;
  if (o.startDate && isValidISO(o.startDate)) out.startDate = o.startDate;
  if (o.finishDate && isValidISO(o.finishDate)) out.finishDate = o.finishDate;
  if (o.dateNote?.trim()) out.dateNote = o.dateNote.trim();
  if (o.note?.trim()) out.note = o.note.trim();
  if (o.updatedAt) out.updatedAt = o.updatedAt;
  return out;
}

/** An entry with nothing left in it but its key and its timestamp. */
export function isEmptyOverride(o: ActivityOverride): boolean {
  return Object.keys(o).every((k) => k === 'activityId' || k === 'updatedAt');
}

/** The same edit applied to every one of these activities, as a new list. */
export function upsertOverrides(ovs: ActivityOverride[], ids: string[], patch: Partial<Omit<ActivityOverride, 'activityId'>>, stamp = new Date().toISOString()): ActivityOverride[] {
  const next = [...ovs];
  for (const id of ids) {
    const i = next.findIndex((o) => normKey(o.activityId) === normKey(id));
    const base: ActivityOverride = i >= 0 ? next[i] : { activityId: id };
    const merged = tidyOverride({ ...base, ...patch, activityId: base.activityId, updatedAt: stamp });
    if (isEmptyOverride(merged)) {
      if (i >= 0) next.splice(i, 1);
    } else if (i >= 0) next[i] = merged;
    else next.push(merged);
  }
  return next;
}

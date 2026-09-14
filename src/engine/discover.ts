import type { LibraryEntry, Location, P6Activity } from './types';
import { normKey } from './keys';

/**
 * Locations: distinct non-empty location across ACTIVITY rows, first appearance order.
 * Existing entries keep their names and factors; new codes are appended with no factor.
 * Nothing is ever deleted.
 */
export function discoverLocations(activities: P6Activity[], existing: Location[]): Location[] {
  const out = [...existing];
  const known = new Set(existing.map((l) => normKey(l.code)));
  for (const a of activities) {
    if (a.rowType !== 'ACTIVITY' || !a.location) continue;
    const k = normKey(a.location);
    if (known.has(k)) continue;
    known.add(k);
    out.push({ code: a.location });
  }
  return out;
}

/**
 * Activity types: distinct non-empty activity type across ACTIVITY rows with no exclude
 * reason, first appearance order. Existing entries keep their rates. Nothing is deleted
 * on import because the type may return in a later schedule revision.
 */
export function discoverLibrary(activities: P6Activity[], existing: LibraryEntry[]): LibraryEntry[] {
  const out = [...existing];
  const known = new Set(existing.map((e) => normKey(e.matchKey)));
  for (const a of activities) {
    if (a.rowType !== 'ACTIVITY' || a.excludeReason || !a.activityType) continue;
    const k = normKey(a.activityType);
    if (known.has(k)) continue;
    known.add(k);
    out.push({ matchKey: a.activityType });
  }
  return out;
}

/** Distinct locations in a set of activities, first appearance order, case-insensitive. */
export function distinctLocations(activities: P6Activity[]): string[] {
  return discoverLocations(activities, []).map((l) => l.code);
}

/** Distinct activity types (excluding deleted or cancelled), first appearance order. */
export function distinctActivityTypes(activities: P6Activity[]): string[] {
  return discoverLibrary(activities, []).map((e) => e.matchKey);
}

import type { LibraryEntry } from './types';
import { normKey } from './keys';

export type LibraryIndex = Map<string, LibraryEntry>;

export function indexLibrary(library: LibraryEntry[]): LibraryIndex {
  const idx: LibraryIndex = new Map();
  for (const e of library) {
    if (e.retired) continue;
    const k = normKey(e.matchKey);
    if (!idx.has(k)) idx.set(k, e); // first entry wins, like Excel MATCH
  }
  return idx;
}

export type MatchResult = { matchKey: string; entry: LibraryEntry | null };

/**
 * One rule: an exact, case-insensitive match on the activity type.
 *
 * There used to be a second tier that dropped the last bracketed phrase and tried
 * again, so that "X (Adjacent Location) (DF: W40 -> Y10)" could be priced by an
 * entry called "X (Adjacent Location)". It is gone deliberately. A key that
 * silently widens to cover types nobody looked at prices work by guesswork, and the
 * guess is invisible in every total it feeds. An activity type that is not in the
 * library is now simply unmatched: it shows as REVIEW, and the answer is to price
 * that type or to hide the activity — both of which are explicit and both of which
 * are visible afterwards.
 */
export function resolveMatchKey(activityType: string, idx: LibraryIndex): MatchResult {
  const hit = idx.get(normKey(activityType));
  return hit ? { matchKey: hit.matchKey, entry: hit } : { matchKey: activityType, entry: null };
}

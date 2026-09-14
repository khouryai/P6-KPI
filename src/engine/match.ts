import type { LibraryEntry, MatchTier } from './types';
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

/** Drop the last parenthetical group: "A (B) (C)" -> "A (B)". Unchanged when there is no "(". */
export function dropLastParenthetical(type: string): string {
  const i = type.lastIndexOf('(');
  return i >= 0 ? type.slice(0, i).trim() : type;
}

export type MatchResult = { matchKey: string; entry: LibraryEntry | null; tier: MatchTier };

/**
 * Two tier resolution. Tier 1 is an exact (case-insensitive) match on the activity type.
 * Tier 2 drops the last parenthetical group and retries. Otherwise unresolved: the
 * caller marks the activity REVIEW and it budgets zero.
 */
export function resolveMatchKey(activityType: string, idx: LibraryIndex): MatchResult {
  const t1 = idx.get(normKey(activityType));
  if (t1) return { matchKey: t1.matchKey, entry: t1, tier: 1 };
  const shorter = dropLastParenthetical(activityType);
  if (shorter !== activityType) {
    const t2 = idx.get(normKey(shorter));
    if (t2) return { matchKey: t2.matchKey, entry: t2, tier: 2 };
    return { matchKey: shorter, entry: null, tier: null };
  }
  return { matchKey: activityType, entry: null, tier: null };
}

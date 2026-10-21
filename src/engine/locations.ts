/**
 * Where an activity is, when the answer is more than one place.
 *
 * The Activity ID names one location, and so does a rule or a move made by hand.
 * Some work genuinely serves two — a test run from one station that commissions
 * another — and reporting all of it under the one the ID happens to carry puts half
 * the hours in the wrong place. A split says how the activity's budget divides
 * between locations, and every rollup by location reads it.
 *
 * The shares always sum to 1, so the hours by location still add back to the
 * budget exactly, which is the invariant every rollup keeps.
 */
import type { Location, LocationShare } from './types';
import { normKey } from './keys';

/** One location's part of one activity, resolved: code, display name and share. */
export type ResolvedShare = { code: string; name: string; share: number };

/**
 * The name to report a location by: its friendly name where one was given on the
 * Locations screen, otherwise its code. The code is still what everything joins on.
 */
export function locationLabel(code: string, locations: Map<string, Location> | Location[]): string {
  const c = code.trim();
  if (c === '') return 'No location in the ID';
  const loc = Array.isArray(locations) ? locations.find((l) => normKey(l.code) === normKey(c)) : locations.get(normKey(c));
  return loc?.name?.trim() || c;
}

/**
 * Read what was typed into a Split cell: `W40 50, 2W 50`, `W40 50%; 2W 50%`, or
 * just `W40, 2W` for an even split. A location named without a percentage takes an
 * even part of whatever the named percentages leave.
 *
 * Returns the shares as typed and resolved to fractions, or an error saying what
 * could not be read. Blank text is no split at all.
 */
export function parseLocationSplit(text: string): { split: LocationShare[] } | { error: string } {
  const parts = text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return { split: [] };
  const read: { location: string; pct: number | null }[] = [];
  for (const p of parts) {
    /*
     * The percentage is the last token, set off by a space or a colon. The
     * separator is required: location codes end in digits (W40), and without it
     * "W40" would read as location W at 40%.
     */
    const m = /^(.*?\S)(?:\s*[:=]\s*|\s+)(\d+(?:\.\d+)?)\s*%?$/.exec(p);
    const location = (m ? m[1] : p).trim();
    const pct = m ? Number(m[2]) : null;
    if (!location || /^\d+(?:\.\d+)?\s*%?$/.test(location)) return { error: `"${p}" names no location.` };
    read.push({ location, pct });
  }
  const given = read.reduce((s, r) => s + (r.pct ?? 0), 0);
  if (given > 100.0001) return { error: `The percentages add up to ${round(given)}%, more than 100%.` };
  const open = read.filter((r) => r.pct === null).length;
  const each = open ? Math.max(0, 100 - given) / open : 0;
  return { split: read.map((r) => ({ location: r.location, share: (r.pct ?? each) / 100 })) };
}

/** The split as it would be typed back: `W40 50%, 2W 50%`. */
export function formatLocationSplit(split: { location?: string; code?: string; share: number }[]): string {
  return split.map((s) => `${(s.location ?? s.code ?? '').trim() || '(none)'} ${round(s.share * 100)}%`).join(', ');
}

/**
 * The activity's locations and the share of it each one carries.
 *
 * `base` is where the Activity ID, a rule or a move puts the activity. Whatever the
 * split does not hand out stays there, so "W40 50%" on an activity at 2W means half
 * at each without anybody having to type 2W. The same location named twice is one
 * share. Shares that would add past 1 — only possible in a hand-edited file, since
 * the Split cell refuses them — are scaled back so the hours still add up.
 */
export function resolveLocationShares(base: string, split: LocationShare[] | undefined, locations: Map<string, Location>): ResolvedShare[] {
  const merged = new Map<string, { code: string; share: number }>();
  const add = (code: string, share: number) => {
    if (!(share > 0)) return;
    const k = normKey(code);
    const cur = merged.get(k);
    if (cur) cur.share += share;
    else merged.set(k, { code: code.trim(), share });
  };
  for (const s of split ?? []) if (s && typeof s.location === 'string' && s.location.trim()) add(s.location, Number(s.share));
  const given = [...merged.values()].reduce((s, x) => s + x.share, 0);
  if (given < 1 - 1e-9) add(base, 1 - given);
  const total = [...merged.values()].reduce((s, x) => s + x.share, 0);
  // Nothing usable in the split, or a split naming only the base: one location, whole.
  if (merged.size === 0 || total <= 0) return [{ code: base, name: locationLabel(base, locations), share: 1 }];
  return [...merged.values()].map((x) => ({ code: x.code, name: locationLabel(x.code, locations), share: x.share / total }));
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * What an activity is worth: the library entry, the crew behind it, and the split
 * of its hours between the groups that do the work.
 *
 * Everything here is a pure function of a library entry and the settings. Nothing
 * in this file knows about a schedule, a date or a percent complete, which is what
 * lets the budget be reasoned about on its own.
 */
import type { Basis, CrewLine, LibraryEntry, RateStatus, ResourceAllocation, Settings } from './types';
import { normKey, containsCI } from './keys';


export function effectiveInclude(entry: LibraryEntry): 'Y' | 'N' {
  if (entry.includeOverride) return entry.includeOverride;
  const k = entry.matchKey;
  if (containsCI(k, '(by BART)') || containsCI(k, '(by Others)') || containsCI(k, '(Deleted)')) return 'N';
  return 'Y';
}

export function effectiveBasis(entry: LibraryEntry, settings: Settings): Basis {
  return entry.basis ?? settings.defaultBasis;
}

/** The code used for hours that were never attributed to a subsystem. */
export const UNASSIGNED = '';

/**
 * The crew breakdown in effect, with blank and non-positive lines dropped and
 * repeated subsystems merged. Empty when the entry is priced as a plain headcount.
 */
export function crewLines(entry: LibraryEntry): CrewLine[] {
  if (!entry.crew || !entry.crew.length) return [];
  const merged = new Map<string, CrewLine>();
  for (const line of entry.crew) {
    const count = Number(line?.count);
    if (!Number.isFinite(count) || count <= 0) continue;
    const code = (line.subsystem ?? '').trim();
    // Lines for the same subsystem at different shift lengths stay separate, since
    // merging them would lose the shift length.
    const k = `${normKey(code)}|${line.shiftHours ?? ''}`;
    const prev = merged.get(k);
    if (prev) prev.count += count;
    else merged.set(k, { subsystem: code, count, shiftHours: line.shiftHours });
  }
  return [...merged.values()];
}

export function effectiveCrew(entry: LibraryEntry, settings: Settings): number {
  const lines = crewLines(entry);
  if (lines.length) return lines.reduce((s, l) => s + l.count, 0);
  return entry.crewSize ?? settings.defaultCrew;
}

export function effectiveShiftHours(entry: LibraryEntry, settings: Settings): number {
  return entry.shiftHours ?? settings.defaultShiftHours;
}

export function isOnDefaults(entry: LibraryEntry): boolean {
  return (
    entry.basis === undefined &&
    (entry.crew === undefined || crewLines(entry).length === 0) &&
    entry.crewSize === undefined &&
    entry.shiftHours === undefined &&
    entry.durationShifts === undefined
  );
}

/**
 * How well priced a library entry is.
 *
 * `forcedIn` is for a row the user pulled into the budget against the library's
 * advice. Reporting EXCLUDED there would be answering a question nobody asked: the
 * row IS in the budget, and what its reader needs to know is whether the rate
 * behind it is any good. So the include flag is skipped and the rate is judged on
 * its own.
 */
export function libraryRateStatus(entry: LibraryEntry, settings: Settings, forcedIn = false): RateStatus {
  if (!forcedIn && effectiveInclude(entry) === 'N') return 'EXCLUDED';
  /*
   * Missing shifts is checked BEFORE "on defaults", and the order is the whole
   * point. An entry with nothing set at all reads as DEFAULT, which sounds
   * harmless — but when Settings makes RATE the default basis, that same entry
   * prices every one of its activities at zero, because RATE hours are
   * crew x shift x durationShifts and durationShifts is undefined. Reporting
   * DEFAULT there hid a silent zero behind a reassuring word.
   */
  if (effectiveBasis(entry, settings) === 'RATE' && entry.durationShifts === undefined) return 'NEEDS SHIFTS';
  if (isOnDefaults(entry)) return 'DEFAULT';
  return 'SET';
}

/**
 * Hours per person-unit for each crew line: count times that line's shift length.
 * This is both the per-shift cost of the crew and the weight used to split the
 * budget between subsystems, so the two can never drift apart.
 */
export function crewWeights(entry: LibraryEntry, settings: Settings): { key: string; weight: number }[] {
  const shift = effectiveShiftHours(entry, settings);
  const lines = crewLines(entry);
  if (!lines.length) return [{ key: UNASSIGNED, weight: (entry.crewSize ?? settings.defaultCrew) * shift }];
  const byCode = new Map<string, number>();
  for (const l of lines) {
    const code = l.subsystem.trim();
    byCode.set(code, (byCode.get(code) ?? 0) + l.count * (l.shiftHours ?? shift));
  }
  return [...byCode].map(([key, weight]) => ({ key, weight }));
}

/**
 * The Subsystem field read as a list.
 *
 * It is one free-text box on an Activity Library key, and people use it to name
 * more than one group: "ATS, IXL" or "ATS / COMMS" is an activity two groups both
 * work. Rolling that up as a single string invents a group called "ATS, IXL" that
 * is neither of them, and leaves both real groups looking smaller than they are.
 * So the text is split, and a rollup by subsystem shares the activity's hours out
 * between the names — evenly, because the box says who, not how much.
 *
 * Splitting on separators only — comma, semicolon, slash, pipe, plus. A name with
 * a space in it survives whole, and "&" and "and" are deliberately not separators:
 * "Test & Commissioning" is one group with an ampersand in its name, and cutting it
 * in half would be the app overruling what somebody typed. A name that repeats
 * itself is merged, so "ATS, ats" is one group and not a half-share each.
 */
export function splitDisciplines(text: string | undefined | null): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[,;/|+]/)) {
    const t = part.trim();
    if (!t || seen.has(normKey(t))) continue;
    seen.add(normKey(t));
    out.push(t);
  }
  return out;
}

/**
 * What one activity is crewed with: the resource groups, their headcounts, and the
 * hours each one carries.
 *
 * The counts come from the library entry and the hours from the split that was
 * already made of THIS activity's budget, so the two can never drift: read the
 * hours off `subsystemHours` rather than recomputing them and an override or a
 * rounding residue lands on the resource lines exactly as it landed on the split.
 * An entry priced as a plain headcount yields one unnamed line, which is the
 * truthful answer — that many people, nobody has said who.
 */
export function resourceLines(
  entry: LibraryEntry,
  settings: Settings,
  budgetBy: Record<string, number>,
  pctComplete: number,
): ResourceAllocation[] {
  const shift = effectiveShiftHours(entry, settings);
  const lines = crewLines(entry);
  const byCode = new Map<string, { count: number; shiftHours: number }>();
  if (lines.length) {
    for (const l of lines) {
      const code = l.subsystem.trim();
      const prev = byCode.get(code);
      if (prev) prev.count += l.count;
      else byCode.set(code, { count: l.count, shiftHours: l.shiftHours ?? shift });
    }
  } else {
    byCode.set(UNASSIGNED, { count: entry.crewSize ?? settings.defaultCrew, shiftHours: shift });
  }
  return [...byCode].map(([code, l]) => {
    const budgetHours = budgetBy[code] ?? 0;
    return {
      code,
      label: code || 'Unassigned',
      count: l.count,
      shiftHours: l.shiftHours,
      budgetHours,
      earnedHours: budgetHours * pctComplete,
    };
  });
}

/**
 * Put an entry's crew under one subsystem, the way the Activity Library's table does.
 *
 * Nearly every activity type is one group's work, so naming that group has to be as
 * cheap as typing it. The headcount is carried across unchanged, which is what keeps
 * the budget still: a crew of two under "ATS" prices exactly as a crew of two did.
 * An empty code puts the entry back to a plain headcount.
 */
export function assignSubsystem(entry: LibraryEntry, raw: string, defaultCrew: number): Partial<LibraryEntry> {
  const code = raw.trim();
  const line = crewLines(entry)[0];
  if (!code) {
    // The number is kept only when it was said out loud, so clearing the group does
    // not quietly pin the Settings default onto the entry and make it read as priced.
    const pinned = line ? (entry.crewSize ?? (line.count === defaultCrew ? undefined : line.count)) : entry.crewSize;
    return { crew: undefined, crewSize: pinned };
  }
  const count = line?.count ?? entry.crewSize ?? defaultCrew;
  return { crew: [{ ...(line ?? {}), subsystem: code, count }], crewSize: undefined };
}

/**
 * Edit the headcount in place, whether the entry is a plain crew size or a single crew
 * line. Clearing the number on a named group falls back to the default rather than
 * dropping the group, since a line with no number is not a line.
 */
export function setCrewCount(entry: LibraryEntry, n: number | undefined, defaultCrew: number): Partial<LibraryEntry> {
  const lines = crewLines(entry);
  if (lines.length !== 1) return { crewSize: n };
  return { crew: [{ ...lines[0], count: n !== undefined && n > 0 ? n : defaultCrew }] };
}

/** Standard hours for one instance of an activity under a library entry. */
export function stdHoursFor(entry: LibraryEntry, settings: Settings, originalDuration: number | null): number {
  const units =
    effectiveBasis(entry, settings) === 'RATE' ? (entry.durationShifts ?? 0) : Math.max(0, originalDuration ?? 0);
  // Summing the crew lines rather than crew x shift lets one group work a shorter
  // shift than the rest. With no breakdown the two are identical.
  return crewWeights(entry, settings).reduce((s, w) => s + w.weight, 0) * units;
}

/**
 * Split a total across weighted buckets so the parts sum to the total EXACTLY.
 *
 * An integer total is split into integers by largest remainder, so a budget of 24
 * hours across three equal groups reads 8/8/8 and not 8.0000001. Anything else is
 * split proportionally with the rounding residue landing on the largest bucket.
 * Either way no rollup by subsystem can disagree with the budget it came from.
 */
export function allocate(total: number, weights: { key: string; weight: number }[]): Record<string, number> {
  const usable = weights.filter((w) => Number.isFinite(w.weight) && w.weight > 0);
  if (!usable.length || !Number.isFinite(total)) return { [UNASSIGNED]: Number.isFinite(total) ? total : 0 };
  if (usable.length === 1) return { [usable[0].key]: total };
  const sum = usable.reduce((s, w) => s + w.weight, 0);
  const out: Record<string, number> = {};

  if (Number.isInteger(total)) {
    const exact = usable.map((w) => ({ key: w.key, want: (total * w.weight) / sum }));
    const floors = exact.map((e) => ({ key: e.key, base: Math.floor(e.want), rem: e.want - Math.floor(e.want) }));
    let left = total - floors.reduce((s, f) => s + f.base, 0);
    // Biggest fractional part first, so the spare hours go where they are most owed.
    const order = [...floors].sort((a, b) => b.rem - a.rem);
    for (const f of floors) out[f.key] = f.base;
    for (const f of order) {
      if (left <= 0) break;
      out[f.key] += 1;
      left -= 1;
    }
    return out;
  }

  let running = 0;
  usable.forEach((w, i) => {
    const v = i === usable.length - 1 ? total - running : (total * w.weight) / sum;
    out[w.key] = v;
    running += v;
  });
  return out;
}

/** Excel ROUND(x, 0): half away from zero. */
export function excelRound(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

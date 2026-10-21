/**
 * When the scheduled Excel export runs.
 *
 * Pure date arithmetic, kept apart from the runner so it can be tested without a
 * browser. Everything is in local time: "every weekday at 07:00" means seven in the
 * morning where the laptop is.
 *
 * The application is a page, not a service, so it can only export while it is open.
 * The rule that makes that workable is catch-up: an export is due whenever a
 * scheduled moment has passed since the last one ran, so a laptop that was shut at
 * seven exports the moment the app is next opened, once, rather than never.
 */

export type ExportFrequency = 'daily' | 'weekdays' | 'weekly' | 'fortnightly' | 'monthly';

/** Which files each run writes. */
export type ExportFiles = 'dated' | 'latest' | 'both';

export type ExportSchedule = {
  enabled: boolean;
  frequency: ExportFrequency;
  /** Local time of day, HH:MM. */
  time: string;
  /** 0 Sunday to 6 Saturday, for weekly and fortnightly. */
  weekday: number;
  /** 1 to 31, for monthly. A day the month does not have means its last day. */
  monthDay: number;
  /**
   * The ISO date a fortnightly schedule counts from: it runs on this date and every
   * fourteen days either side. Set to the next matching weekday when the schedule
   * is saved, so "every other Monday" has a definite first Monday.
   */
  anchor?: string;
  /** A folder chosen for the export, or the data folder's exports sub-folder. */
  destination: 'folder' | 'data-folder';
  files: ExportFiles;
  /**
   * When the schedule was last set. A moment before this is not owed: changing the
   * time to one already gone today must not export on the spot.
   */
  since: string;
  /** ISO datetime of the last export that ran, scheduled or by hand. */
  lastRunAt?: string;
  lastResult?: { ok: boolean; at: string; files: string[]; error?: string; trigger: 'manual' | 'scheduled' };
};

export const DEFAULT_SCHEDULE: ExportSchedule = {
  enabled: false,
  frequency: 'weekdays',
  time: '07:00',
  weekday: 1,
  monthDay: 1,
  destination: 'folder',
  files: 'dated',
  since: new Date(0).toISOString(),
};

export const FREQUENCY_LABEL: Record<ExportFrequency, string> = {
  daily: 'Every day',
  weekdays: 'Every weekday (Mon–Fri)',
  weekly: 'Every week',
  fortnightly: 'Every two weeks',
  monthly: 'Every month',
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** How far either way to look for a scheduled day. Two months covers every rule. */
const SEARCH_DAYS = 70;

function parseTime(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  const h = m ? Math.min(23, Number(m[1])) : 7;
  const min = m ? Math.min(59, Number(m[2])) : 0;
  return { h, m: min };
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const dayNumber = (isoDate: string) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

/** Does the schedule run on this calendar day? */
function runsOn(s: ExportSchedule, day: Date): boolean {
  const wd = day.getDay();
  switch (s.frequency) {
    case 'daily':
      return true;
    case 'weekdays':
      return wd >= 1 && wd <= 5;
    case 'weekly':
      return wd === s.weekday;
    case 'fortnightly': {
      if (wd !== s.weekday) return false;
      if (!s.anchor) return true;
      return (((dayNumber(iso(day)) - dayNumber(s.anchor)) % 14) + 14) % 14 === 0;
    }
    case 'monthly': {
      const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
      return day.getDate() === Math.min(Math.max(1, s.monthDay), last);
    }
  }
}

/** The scheduled moment on a day, in local time. */
function at(s: ExportSchedule, day: Date): Date {
  const { h, m } = parseTime(s.time);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/** The latest scheduled moment at or before `now`, or null when there is none in reach. */
export function lastScheduled(s: ExportSchedule, now: Date): Date | null {
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (!runsOn(s, day)) continue;
    const t = at(s, day);
    if (t.getTime() <= now.getTime()) return t;
  }
  return null;
}

/** The first scheduled moment after `now`. */
export function nextScheduled(s: ExportSchedule, now: Date): Date | null {
  for (let i = 0; i <= SEARCH_DAYS; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (!runsOn(s, day)) continue;
    const t = at(s, day);
    if (t.getTime() > now.getTime()) return t;
  }
  return null;
}

/**
 * Whether an export is owed now: a scheduled moment has passed that came after both
 * the last run and the moment the schedule was set. However many were missed while
 * the app was closed, one export covers them — it is a snapshot, and five copies of
 * the same data taken a second apart would be no use to anybody.
 */
export function isDue(s: ExportSchedule, now: Date): boolean {
  if (!s.enabled) return false;
  const last = lastScheduled(s, now);
  if (!last) return false;
  const floor = Math.max(Date.parse(s.since) || 0, s.lastRunAt ? Date.parse(s.lastRunAt) || 0 : 0);
  return last.getTime() > floor;
}

/** The fortnight's first day: the next matching weekday on or after `from`. */
export function fortnightAnchor(weekday: number, from: Date): string {
  for (let i = 0; i < 7; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (day.getDay() === weekday) return iso(day);
  }
  return iso(from);
}

/** The file names one run writes. The dated name sorts in time order in a folder listing. */
export function exportFileNames(files: ExportFiles, when: Date): string[] {
  const p = (n: number) => String(n).padStart(2, '0');
  const dated = `TC_Budget_Data_${when.getFullYear()}-${p(when.getMonth() + 1)}-${p(when.getDate())}_${p(when.getHours())}${p(when.getMinutes())}.xlsx`;
  const latest = 'TC_Budget_Data_latest.xlsx';
  return files === 'dated' ? [dated] : files === 'latest' ? [latest] : [dated, latest];
}

/** The schedule in words, for the Settings card. */
export function describeSchedule(s: ExportSchedule): string {
  const t = s.time;
  switch (s.frequency) {
    case 'daily':
      return `every day at ${t}`;
    case 'weekdays':
      return `every weekday at ${t}`;
    case 'weekly':
      return `every ${WEEKDAYS[s.weekday]} at ${t}`;
    case 'fortnightly':
      return `every other ${WEEKDAYS[s.weekday]} at ${t}${s.anchor ? `, starting ${s.anchor}` : ''}`;
    case 'monthly':
      return `on day ${s.monthDay} of every month at ${t}${s.monthDay > 28 ? ' (the last day, in shorter months)' : ''}`;
  }
}

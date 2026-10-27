/**
 * P6 calendars: which hours of which days are working time.
 *
 * Float and duration need none of this — P6 writes them in hours and a calendar's
 * hours per day turns them into days. What does need it is any arithmetic P6 did
 * not do for us: how many working days lie between a predecessor's finish and its
 * successor's start, which is what decides whether a relationship is the one
 * driving the date.
 *
 * The working pattern is in `clndr_data`, a nested bracket format:
 *
 *   (0||CalendarData()(
 *     (0||DaysOfWeek()(
 *       (0||1()())                                  Sunday, no work
 *       (0||2()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))   Monday
 *       ...
 *     (0||Exceptions()(
 *       (0||0(d|46022)())                           a holiday
 *       (0||1(d|46030)((0||0(s|08:00|f|12:00)())))  a short day
 *
 * Days of the week run 1 (Sunday) to 7 (Saturday). An exception's `d` is a day
 * number counted from 30 December 1899, the same epoch as an Excel serial.
 * A calendar without the blob, or with one this cannot read, falls back to a
 * Monday-to-Friday week of its hours per day, and says so.
 */

/** Minutes from midnight: [start, end). */
export type WorkInterval = [number, number];

export type P6Calendar = {
  uid: string;
  name: string;
  /** Global, project or resource calendar, as P6 classes it. */
  type: 'GLOBAL' | 'PROJECT' | 'RESOURCE' | '';
  projUid: string;
  /** Working hours in a day, P6's own figure. Turns hours into days everywhere. */
  hoursPerDay: number;
  /** Index 0 is Sunday. */
  week: WorkInterval[][];
  /** Day number (days since 1 January 1970) to its working time; empty is a day off. */
  exceptions: Map<number, WorkInterval[]>;
  /** False when the working pattern was not in the file and the default week stands in. */
  patternRead: boolean;
  isDefault: boolean;
};

const DAY_MS = 86_400_000;
/** 30 December 1899 is day -25569 counted from 1 January 1970. */
const SERIAL_TO_EPOCH_DAYS = 25569;

type Node = { name: string; attrs: string; children: Node[] };

/**
 * Parse the bracket format into a tree. Whitespace and the 0x7F line-break marker
 * can appear anywhere between tokens, depending on the P6 version that wrote it.
 */
function parseTree(src: string): Node | null {
  const s = src.replace(/[\x7f\r\n\t ]+/g, '');
  let i = 0;
  const node = (): Node | null => {
    if (s[i] !== '(') return null;
    i++;
    const bar = s.indexOf('||', i);
    if (bar < 0) return null;
    i = bar + 2;
    const open = s.indexOf('(', i);
    if (open < 0) return null;
    const name = s.slice(i, open);
    i = open + 1;
    const close = s.indexOf(')', i);
    if (close < 0) return null;
    const attrs = s.slice(i, close);
    i = close + 1;
    const children: Node[] = [];
    if (s[i] === '(') {
      i++;
      while (s[i] === '(') {
        const c = node();
        if (!c) return null;
        children.push(c);
      }
      if (s[i] !== ')') return null;
      i++;
    }
    if (s[i] !== ')') return null;
    i++;
    return { name, attrs, children };
  };
  return node();
}

function hhmm(t: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** `s|08:00|f|17:00` as an interval. The order of s and f is not guaranteed. */
function intervalOf(attrs: string): WorkInterval | null {
  const parts = attrs.split('|');
  let s: number | null = null;
  let f: number | null = null;
  for (let k = 0; k + 1 < parts.length; k += 2) {
    if (parts[k] === 's') s = hhmm(parts[k + 1]);
    else if (parts[k] === 'f') f = hhmm(parts[k + 1]);
  }
  if (s === null || f === null) return null;
  // A finish of 00:00 on a working period means midnight at the end of the day.
  if (f === 0 && s > 0) f = 24 * 60;
  return f > s ? [s, f] : null;
}

function intervalsOf(n: Node): WorkInterval[] {
  const out: WorkInterval[] = [];
  for (const c of n.children) {
    const iv = intervalOf(c.attrs);
    if (iv) out.push(iv);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** Monday to Friday, `hoursPerDay` from 08:00. What a calendar is taken to be when its pattern cannot be read. */
export function defaultWeek(hoursPerDay: number): WorkInterval[][] {
  const h = hoursPerDay > 0 ? hoursPerDay : 8;
  const day: WorkInterval[] = [[8 * 60, Math.min(24 * 60, 8 * 60 + Math.round(h * 60))]];
  return [[], day, day, day, day, day, []];
}

/** Read `clndr_data`. Null when it is absent or not in a form this understands. */
export function parseCalendarData(data: string): { week: WorkInterval[][]; exceptions: Map<number, WorkInterval[]> } | null {
  if (!data || !data.includes('DaysOfWeek')) return null;
  const root = parseTree(data);
  if (!root) return null;
  const find = (n: Node, name: string): Node | null => {
    if (n.name === name) return n;
    for (const c of n.children) {
      const hit = find(c, name);
      if (hit) return hit;
    }
    return null;
  };
  const dow = find(root, 'DaysOfWeek');
  if (!dow) return null;
  const week: WorkInterval[][] = [[], [], [], [], [], [], []];
  for (const d of dow.children) {
    const n = Number(d.name);
    if (n >= 1 && n <= 7) week[n - 1] = intervalsOf(d);
  }
  const exceptions = new Map<number, WorkInterval[]>();
  const exc = find(root, 'Exceptions');
  if (exc) {
    for (const e of exc.children) {
      const m = /d\|(\d+)/.exec(e.attrs);
      if (!m) continue;
      exceptions.set(Number(m[1]) - SERIAL_TO_EPOCH_DAYS, intervalsOf(e));
    }
  }
  return { week, exceptions };
}

export function makeCalendar(p: {
  uid: string;
  name: string;
  type: string;
  projUid: string;
  hoursPerDay: number | null;
  data: string;
  isDefault: boolean;
}): P6Calendar {
  const parsed = parseCalendarData(p.data);
  const hpdFromPattern = parsed ? typicalHours(parsed.week) : 0;
  const hoursPerDay = p.hoursPerDay && p.hoursPerDay > 0 ? p.hoursPerDay : hpdFromPattern > 0 ? hpdFromPattern : 0;
  const type = p.type === 'CA_Base' ? 'GLOBAL' : p.type === 'CA_Project' ? 'PROJECT' : p.type === 'CA_Rsrc' ? 'RESOURCE' : '';
  return {
    uid: p.uid,
    name: p.name || p.uid,
    type,
    projUid: p.projUid,
    hoursPerDay,
    week: parsed?.week ?? defaultWeek(hoursPerDay || 8),
    exceptions: parsed?.exceptions ?? new Map(),
    patternRead: !!parsed,
    isDefault: p.isDefault,
  };
}

/** The most common working-day length in a week, in hours. */
function typicalHours(week: WorkInterval[][]): number {
  const counts = new Map<number, number>();
  for (const d of week) {
    const mins = d.reduce((s, [a, b]) => s + (b - a), 0);
    if (mins > 0) counts.set(mins, (counts.get(mins) ?? 0) + 1);
  }
  let best = 0;
  let n = 0;
  for (const [mins, c] of counts) if (c > n) [best, n] = [mins, c];
  return best / 60;
}

/** The working time on one day. 1 January 1970 was a Thursday. */
export function workOn(cal: P6Calendar, day: number): WorkInterval[] {
  const exc = cal.exceptions.get(day);
  if (exc) return exc;
  return cal.week[(((day + 4) % 7) + 7) % 7];
}

export function isWorkDay(cal: P6Calendar, day: number): boolean {
  return workOn(cal, day).length > 0;
}

/**
 * Working minutes from `fromMs` to `toMs` on this calendar. Negative when `toMs` is
 * the earlier of the two. Ranges longer than ten years are worked out at the
 * calendar's average rate rather than day by day, since nothing that far apart is
 * close to driving anything.
 */
export function workMinutes(cal: P6Calendar, fromMs: number, toMs: number): number {
  if (toMs === fromMs) return 0;
  if (toMs < fromMs) return -workMinutes(cal, toMs, fromMs);
  const first = Math.floor(fromMs / DAY_MS);
  const last = Math.floor(toMs / DAY_MS);
  if (last - first > 3660) {
    const weekMins = cal.week.reduce((s, d) => s + d.reduce((x, [a, b]) => x + (b - a), 0), 0);
    return ((toMs - fromMs) / (7 * DAY_MS)) * weekMins;
  }
  let total = 0;
  for (let day = first; day <= last; day++) {
    const base = day * DAY_MS;
    for (const [s, e] of workOn(cal, day)) {
      const a = Math.max(fromMs, base + s * 60_000);
      const b = Math.min(toMs, base + e * 60_000);
      if (b > a) total += (b - a) / 60_000;
    }
  }
  return total;
}

/** Working days between two instants, at the calendar's hours per day. */
export function workDays(cal: P6Calendar, fromMs: number, toMs: number): number {
  const hpd = cal.hoursPerDay > 0 ? cal.hoursPerDay : 8;
  return workMinutes(cal, fromMs, toMs) / (hpd * 60);
}

/** Holidays and other non-working exceptions between two days, for the calendar panel. */
export function holidaysBetween(cal: P6Calendar, fromMs: number, toMs: number): number[] {
  const out: number[] = [];
  const first = Math.floor(fromMs / DAY_MS);
  const last = Math.floor(toMs / DAY_MS);
  for (const [day, iv] of cal.exceptions) if (day >= first && day <= last && iv.length === 0) out.push(day * DAY_MS);
  return out.sort((a, b) => a - b);
}

/** Hours of work in each day of the week, Sunday first, for describing a calendar. */
export function weekHours(cal: P6Calendar): number[] {
  return cal.week.map((d) => d.reduce((s, [a, b]) => s + (b - a), 0) / 60);
}

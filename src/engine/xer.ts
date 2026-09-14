/**
 * Primavera P6 XER import.
 *
 * XER is P6's own export format, so importing it removes Excel from the loop entirely.
 * It is a tab delimited text file of tables:
 *
 *   ERMHDR  <version> <date> ...
 *   %T  TASK
 *   %F  task_id  proj_id  task_code  task_name  target_drtn_hr_cnt  ...
 *   %R  1234     1        A1010      Do a thing 80                  ...
 *
 * Two things differ from the Excel export and are surfaced to the user rather than
 * hidden:
 *
 * 1. Durations are held in HOURS, not days. They are divided by the hours per day of the
 *    activity's own calendar when the CALENDAR table is present, and by a value the user
 *    sets (default 8) when it is not.
 * 2. The TASK table holds activities only. There are no WBS summary rows to exclude,
 *    so the WBS count of an XER import is always zero. Since WBS rows never contributed
 *    hours, no figure changes because of this.
 */
import type { P6Activity } from './types';
import { parseP6Row } from './parse';

export type XerTable = { name: string; fields: string[]; rows: string[][] };

/** Split an XER file into its tables. Unknown tables are kept; the caller picks. */
export function parseXer(text: string): Map<string, XerTable> {
  const tables = new Map<string, XerTable>();
  let current: XerTable | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line === '') continue;
    const cells = line.split('\t');
    const tag = cells[0];
    if (tag === '%T') {
      current = { name: (cells[1] ?? '').trim(), fields: [], rows: [] };
      tables.set(current.name, current);
    } else if (tag === '%F' && current) {
      current.fields = cells.slice(1).map((f) => f.trim());
    } else if (tag === '%R' && current) {
      current.rows.push(cells.slice(1));
    }
    // ERMHDR and %E (end) need no handling.
  }
  return tables;
}

export function isXer(text: string): boolean {
  const head = text.slice(0, 2000);
  return head.startsWith('ERMHDR') || /(^|\n)%T\tTASK(\t|\n|$)/.test(head);
}

function rowReader(table: XerTable) {
  const index = new Map<string, number>();
  table.fields.forEach((f, i) => index.set(f.toLowerCase(), i));
  return (row: string[], field: string): string => {
    const i = index.get(field.toLowerCase());
    if (i === undefined) return '';
    return (row[i] ?? '').trim();
  };
}

function firstNonEmpty(...vals: string[]): string {
  for (const v of vals) if (v !== '') return v;
  return '';
}

export type XerImportOptions = {
  /** Fallback when a calendar cannot be resolved. P6's own default is 8. */
  hoursPerDay: number;
  /** Restrict to one project's short name, when the file holds several. */
  projectShortName?: string;
};

export type XerImportResult = {
  activities: P6Activity[];
  warnings: string[];
  /** Projects found in the file, for the picker. */
  projects: { id: string; shortName: string; name: string; taskCount: number }[];
  /** Hours per day actually used, per calendar, for display. */
  calendarHours: { id: string; name: string; hoursPerDay: number }[];
  usedFallbackHours: number;
};

/** Read day_hr_cnt out of a CALENDAR row. P6 stores it inside the clndr_data blob too, but the column is authoritative when present. */
function calendarHoursPerDay(tables: Map<string, XerTable>): Map<string, { name: string; hoursPerDay: number }> {
  const out = new Map<string, { name: string; hoursPerDay: number }>();
  const cal = tables.get('CALENDAR');
  if (!cal) return out;
  const get = rowReader(cal);
  for (const row of cal.rows) {
    const id = get(row, 'clndr_id');
    if (!id) continue;
    const raw = get(row, 'day_hr_cnt');
    const n = Number(raw);
    out.set(id, { name: get(row, 'clndr_name') || id, hoursPerDay: Number.isFinite(n) && n > 0 ? n : 0 });
  }
  return out;
}

/**
 * Convert the TASK table into the same P6Activity shape the Excel path produces, so
 * everything downstream is identical.
 */
export function xerToActivities(tables: Map<string, XerTable>, opts: XerImportOptions): XerImportResult {
  const warnings: string[] = [];
  const task = tables.get('TASK');
  const projects: XerImportResult['projects'] = [];
  const cals = calendarHoursPerDay(tables);

  const proj = tables.get('PROJECT');
  const projName = new Map<string, { shortName: string; name: string }>();
  if (proj) {
    const get = rowReader(proj);
    for (const row of proj.rows) {
      const id = get(row, 'proj_id');
      if (!id) continue;
      projName.set(id, { shortName: get(row, 'proj_short_name') || id, name: get(row, 'proj_short_name') || id });
    }
  }

  if (!task || task.rows.length === 0) {
    return { activities: [], warnings: ['The file has no TASK table, so it holds no activities.'], projects: [], calendarHours: [], usedFallbackHours: 0 };
  }

  const get = rowReader(task);
  const counts = new Map<string, number>();
  for (const row of task.rows) counts.set(get(row, 'proj_id'), (counts.get(get(row, 'proj_id')) ?? 0) + 1);
  for (const [id, n] of counts) {
    const p = projName.get(id);
    projects.push({ id, shortName: p?.shortName ?? id, name: p?.name ?? id, taskCount: n });
  }

  let wanted: string | null = null;
  if (opts.projectShortName) {
    const hit = projects.find((p) => p.shortName === opts.projectShortName);
    if (hit) wanted = hit.id;
  }

  const usedCalendars = new Set<string>();
  let usedFallbackHours = 0;
  const activities: P6Activity[] = [];
  let order = 0;

  for (const row of task.rows) {
    if (wanted !== null && get(row, 'proj_id') !== wanted) continue;
    const code = get(row, 'task_code');
    if (!code) continue;

    const clndrId = get(row, 'clndr_id');
    const cal = cals.get(clndrId);
    let hpd = cal && cal.hoursPerDay > 0 ? cal.hoursPerDay : 0;
    if (hpd > 0) usedCalendars.add(clndrId);
    else {
      hpd = opts.hoursPerDay;
      usedFallbackHours += 1;
    }

    const toDays = (hours: string): string => {
      if (hours === '') return '';
      const n = Number(hours);
      if (!Number.isFinite(n)) return '';
      // Round to two decimals so a 7.5 hour calendar does not produce noise.
      return String(Math.round((n / hpd) * 100) / 100);
    };

    const actStart = get(row, 'act_start_date');
    const actEnd = get(row, 'act_end_date');
    const start = firstNonEmpty(actStart, get(row, 'early_start_date'), get(row, 'target_start_date'), get(row, 'restart_date'));
    const finish = firstNonEmpty(actEnd, get(row, 'early_end_date'), get(row, 'target_end_date'), get(row, 'reend_date'));

    // The Excel path marks an actual date with a trailing " A"; reuse that so one parser
    // serves both and the actual flags land in the same place.
    const startCell = start === '' ? '' : actStart !== '' ? `${start.slice(0, 10)} A` : start.slice(0, 10);
    const finishCell = finish === '' ? '' : actEnd !== '' ? `${finish.slice(0, 10)} A` : finish.slice(0, 10);

    activities.push(
      parseP6Row(
        {
          activityId: code,
          activityName: get(row, 'task_name'),
          originalDuration: toDays(firstNonEmpty(get(row, 'target_drtn_hr_cnt'), get(row, 'orig_drtn_hr_cnt'))),
          remainingDuration: toDays(get(row, 'remain_drtn_hr_cnt')),
          start: startCell,
          finish: finishCell,
        },
        order++,
      ),
    );
  }

  if (usedFallbackHours > 0) {
    warnings.push(
      `${usedFallbackHours} activities had no calendar in the file, so durations were converted at ${opts.hoursPerDay} hours per day. Check that matches the schedule.`,
    );
  }
  if (projects.length > 1 && wanted === null) {
    warnings.push(`The file holds ${projects.length} projects and all of them were imported. Pick one above if that is not what you want.`);
  }
  const calendarHours = [...usedCalendars].map((id) => ({ id, name: cals.get(id)?.name ?? id, hoursPerDay: cals.get(id)?.hoursPerDay ?? 0 }));
  return { activities, warnings, projects, calendarHours, usedFallbackHours };
}

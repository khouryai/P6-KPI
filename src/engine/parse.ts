import type { P6Activity, ExcludeReason, RowType } from './types';
import { parseP6Date } from './dates';

/** One raw row from a P6 export, in the expected column order. Cells are untyped. */
export type RawRow = {
  activityId: unknown;
  activityName: unknown;
  originalDuration: unknown;
  remainingDuration: unknown;
  start: unknown;
  finish: unknown;
};

function cellText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

function cellNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = String(v).trim().replace(/,/g, '');
  if (t === '') return null;
  // P6 exports durations like "12d" or "12.0d" in some layouts.
  const m = /^(-?\d+(?:\.\d+)?)\s*d?$/i.exec(t);
  if (!m) return null;
  return Number(m[1]);
}

/** Activity type: everything after the first " - " in the name, or the whole trimmed name. */
export function activityTypeOf(name: string): string {
  const t = name.trim();
  const i = t.indexOf(' - ');
  return i >= 0 ? t.slice(i + 3).trim() : t;
}

export function excludeReasonOf(name: string): ExcludeReason {
  const n = name.toLowerCase();
  if (n.includes('(deleted)')) return 'DELETED';
  if (n.includes('(cancelled)')) return 'CANCELLED';
  return null;
}

/** Location is the 4th dash-delimited segment of the trimmed Activity ID; blank if fewer than 5 segments. */
export function locationOf(activityId: string): string {
  const parts = activityId.trim().split('-');
  return parts.length >= 5 ? parts[3].trim() : '';
}

/** Seq code is segments 5 and 6 joined with a dash. Informational only. */
export function seqCodeOf(activityId: string): string {
  const parts = activityId.trim().split('-');
  return `${(parts[4] ?? '').trim()}-${(parts[5] ?? '').trim()}`;
}

/** Parse one export row. Row type: blank Activity Name means WBS. */
export function parseP6Row(row: RawRow, sortOrder: number): P6Activity {
  const rawActivityId = cellText(row.activityId);
  const activityId = rawActivityId.trim();
  const activityName = cellText(row.activityName).trim();
  const rowType: RowType = activityName === '' ? 'WBS' : 'ACTIVITY';
  const start = parseP6Date(row.start);
  const finish = parseP6Date(row.finish);
  const isAct = rowType === 'ACTIVITY';
  return {
    rawActivityId,
    activityId,
    activityName,
    originalDuration: cellNumber(row.originalDuration),
    remainingDuration: cellNumber(row.remainingDuration),
    startRaw: start.raw,
    finishRaw: finish.raw,
    startDate: start.iso,
    finishDate: finish.iso,
    actualStart: start.actual,
    actualFinish: finish.actual,
    rowType,
    location: isAct ? locationOf(activityId) : '',
    seqCode: isAct ? seqCodeOf(activityId) : '',
    activityType: isAct ? activityTypeOf(activityName) : '',
    excludeReason: isAct ? excludeReasonOf(activityName) : null,
    sortOrder,
  };
}

export type ParseWarning = { row: number; message: string };

export type ParsedTable = {
  activities: P6Activity[];
  headerSkipped: boolean;
  warnings: ParseWarning[];
  unparseableDates: number;
  duplicateIds: string[];
  skippedBlank: number;
};

const HEADER_WORDS = ['activity id', 'activity_id', 'activityid', 'id'];

/** Detect a header row: first cell reads like "Activity ID" and durations are not numeric. */
export function looksLikeHeader(cells: unknown[]): boolean {
  const first = cellText(cells[0]).trim().toLowerCase();
  const second = cellText(cells[1]).trim().toLowerCase();
  if (HEADER_WORDS.includes(first) || first.startsWith('activity id')) return true;
  return second === 'activity name' || second === 'activity_name';
}

/**
 * Parse a grid of cells (from a paste, CSV, or worksheet) into activities.
 * Expected columns: Activity ID, Activity Name, Original Duration, Remaining Duration, Start, Finish.
 * Extra trailing columns are ignored. A header row is detected and skipped. Blank rows are skipped.
 */
export function parseTable(grid: unknown[][]): ParsedTable {
  const warnings: ParseWarning[] = [];
  const activities: P6Activity[] = [];
  let headerSkipped = false;
  let unparseableDates = 0;
  let skippedBlank = 0;
  const seen = new Map<string, number>();
  const duplicateIds: string[] = [];
  let order = 0;
  grid.forEach((cells, idx) => {
    const rowNo = idx + 1;
    const nonEmpty = cells.some((c) => cellText(c).trim() !== '');
    if (!nonEmpty) {
      skippedBlank += 1;
      return;
    }
    if (!headerSkipped && activities.length === 0 && looksLikeHeader(cells)) {
      headerSkipped = true;
      return;
    }
    if (cellText(cells[0]).trim() === '') {
      // Excel leaves the ID blank on nothing real; treat as blank but tell the user.
      warnings.push({ row: rowNo, message: 'Row has no Activity ID and was skipped' });
      skippedBlank += 1;
      return;
    }
    const a = parseP6Row(
      {
        activityId: cells[0],
        activityName: cells[1],
        originalDuration: cells[2],
        remainingDuration: cells[3],
        start: cells[4],
        finish: cells[5],
      },
      order++,
    );
    const s = parseP6Date(cells[4]);
    const f = parseP6Date(cells[5]);
    if (s.unparseable) {
      unparseableDates += 1;
      warnings.push({ row: rowNo, message: `Start "${s.raw}" could not be parsed and is treated as no date` });
    }
    if (f.unparseable) {
      unparseableDates += 1;
      warnings.push({ row: rowNo, message: `Finish "${f.raw}" could not be parsed and is treated as no date` });
    }
    if (a.rowType === 'ACTIVITY') {
      const key = a.activityId.toLowerCase();
      const n = (seen.get(key) ?? 0) + 1;
      seen.set(key, n);
      if (n === 2) duplicateIds.push(a.activityId);
    }
    activities.push(a);
  });
  return { activities, headerSkipped, warnings, unparseableDates, duplicateIds, skippedBlank };
}

/** Split tab separated text (a clipboard paste from Excel) into a grid. Cells stay as strings. */
export function parseTsv(text: string): string[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  // Excel appends a trailing newline to a copied block.
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((l) => l.split('\t'));
}

/** Minimal RFC 4180 CSV parser, handles quoted fields with embedded commas and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  const src = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Choose between TSV and CSV for pasted text: tabs win, since Excel copies as TSV. */
export function parseDelimitedText(text: string): string[][] {
  return text.includes('\t') ? parseTsv(text) : parseCsv(text);
}

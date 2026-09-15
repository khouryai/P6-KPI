/**
 * Reading the hours a team actually built out of whatever shape the spreadsheet
 * happens to be in.
 *
 * Nobody keeps this data in the format an app would like. It arrives either as a
 * list (one row per person per month) or as a grid (people down the side, months
 * across the top), with the month written half a dozen different ways. Both shapes
 * are read here rather than asking anyone to reformat a working spreadsheet.
 */
import { parseP6Date } from './dates';
import { pad2 } from './dates';

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8,
  september: 9, sept: 9, october: 10, november: 11, december: 12,
};

/** Two digit years pivot the same way P6 dates do: below 50 means this century. */
function fullYear(y: number): number {
  if (y >= 1000) return y;
  return y < 50 ? 2000 + y : 1900 + y;
}

/**
 * A month, however it was written: 2026-08, Aug-26, August 2026, 8/2026, an Excel
 * serial, or a full date (which is taken as the month it falls in).
 */
export function parseMonth(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date && !Number.isNaN(cell.getTime())) {
    return `${cell.getFullYear()}-${pad2(cell.getMonth() + 1)}`;
  }
  const text = String(cell).trim();
  if (!text) return null;

  let m = /^(\d{4})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const mm = Number(m[2]);
    return mm >= 1 && mm <= 12 ? `${m[1]}-${pad2(mm)}` : null;
  }
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (m) {
    const mm = Number(m[2]);
    return mm >= 1 && mm <= 12 ? `${m[1]}-${pad2(mm)}` : null;
  }
  // Aug-26, Aug 2026, August-26, Aug26
  m = /^([A-Za-z]{3,9})[\s\-/]*(\d{2,4})$/.exec(text);
  if (m) {
    const mm = MONTHS[m[1].toLowerCase()];
    if (mm) return `${fullYear(Number(m[2]))}-${pad2(mm)}`;
  }
  // 08/2026, 8-2026
  m = /^(\d{1,2})[-/](\d{4})$/.exec(text);
  if (m) {
    const mm = Number(m[1]);
    return mm >= 1 && mm <= 12 ? `${m[2]}-${pad2(mm)}` : null;
  }
  // A bare Excel serial, or anything P6 would recognise as a date.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    // A number small enough to be a year or a count is not a date.
    if (n < 10000) return null;
    const iso = parseP6Date(n).iso;
    return iso ? iso.slice(0, 7) : null;
  }
  const iso = parseP6Date(text).iso;
  return iso ? iso.slice(0, 7) : null;
}

/** "1,234.5", " 40 h ", "(12)" as negative. Blank and non-numeric give null. */
export function parseHours(cell: unknown): number | null {
  if (cell === null || cell === undefined) return null;
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null;
  let text = String(cell).trim();
  if (!text) return null;
  let sign = 1;
  if (/^\(.*\)$/.test(text)) {
    sign = -1;
    text = text.slice(1, -1);
  }
  text = text.replace(/,/g, '').replace(/\s*(h|hr|hrs|hours)\s*$/i, '').trim();
  if (!/^-?\d*\.?\d+$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n * sign : null;
}

export type TeamPasteRow = {
  month: string;
  /** Whatever the row was keyed by: a subsystem, a person, or a team. */
  label: string;
  hours: number;
};

export type TeamPaste = {
  layout: 'long' | 'wide' | 'none';
  rows: TeamPasteRow[];
  /** Header text of the column the labels came from, so the UI can say what it read. */
  labelHeader: string;
  months: string[];
  skipped: number;
  note: string;
};

const LABELISH = /(subsystem|group|resource|discipline|team|name|person|engineer|staff|who)/i;
const HOURSISH = /(hour|hrs|^h$|actual|spent|burn|built|charged)/i;
const MONTHISH = /(month|period|date|week.?ending)/i;

function cell(grid: unknown[][], r: number, c: number): string {
  const v = grid[r]?.[c];
  return v === null || v === undefined ? '' : String(v).trim();
}

/**
 * Read a pasted block of team hours.
 *
 * Wide is tried first: a header row with two or more month columns is unambiguous,
 * whereas a long layout has to be inferred from column names and could misread a
 * wide sheet whose first month column happens to be called something month-like.
 */
export function parseTeamHours(grid: unknown[][]): TeamPaste {
  const empty: TeamPaste = { layout: 'none', rows: [], labelHeader: '', months: [], skipped: 0, note: '' };
  if (!grid.length) return empty;

  const maxCols = Math.max(...grid.map((r) => r.length));

  // --- wide: months across the top ----------------------------------------
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const monthCols: { col: number; month: string }[] = [];
    for (let c = 0; c < maxCols; c++) {
      const m = parseMonth(cell(grid, r, c));
      if (m) monthCols.push({ col: c, month: m });
    }
    if (monthCols.length < 2) continue;
    const labelCol = [...Array(maxCols).keys()].find((c) => !monthCols.some((m) => m.col === c) && cell(grid, r, c) !== '');
    const useLabelCol = labelCol ?? 0;
    const rows: TeamPasteRow[] = [];
    let skipped = 0;
    for (let rr = r + 1; rr < grid.length; rr++) {
      const label = cell(grid, rr, useLabelCol);
      // A totals row would double every figure it touches.
      if (/^(total|grand total|sum|subtotal)\b/i.test(label)) continue;
      if (!label && grid[rr]?.every((v) => String(v ?? '').trim() === '')) continue;
      for (const mc of monthCols) {
        const h = parseHours(cell(grid, rr, mc.col));
        if (h === null) {
          if (cell(grid, rr, mc.col) !== '') skipped++;
          continue;
        }
        if (h === 0) continue;
        rows.push({ month: mc.month, label, hours: h });
      }
    }
    if (rows.length) {
      return {
        layout: 'wide',
        rows,
        labelHeader: cell(grid, r, useLabelCol),
        months: [...new Set(monthCols.map((m) => m.month))].sort(),
        skipped,
        note: `Months across the top: ${monthCols.length} columns, keyed by "${cell(grid, r, useLabelCol) || 'the first column'}".`,
      };
    }
  }

  // --- long: one row per month ---------------------------------------------
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const headers = [...Array(maxCols).keys()].map((c) => cell(grid, r, c));
    const hoursCol = headers.findIndex((h) => HOURSISH.test(h));
    if (hoursCol < 0) continue;
    let monthCol = headers.findIndex((h) => MONTHISH.test(h));
    if (monthCol < 0) {
      // No obvious header: use whichever column actually parses as months.
      monthCol = [...Array(maxCols).keys()].find((c) =>
        grid.slice(r + 1, r + 6).some((row) => parseMonth(String(row?.[c] ?? '')) !== null),
      ) ?? -1;
    }
    if (monthCol < 0) continue;
    const labelCol = headers.findIndex((h, i) => i !== hoursCol && i !== monthCol && LABELISH.test(h));
    const rows: TeamPasteRow[] = [];
    let skipped = 0;
    for (let rr = r + 1; rr < grid.length; rr++) {
      const label = labelCol >= 0 ? cell(grid, rr, labelCol) : '';
      if (/^(total|grand total|sum|subtotal)\b/i.test(label)) continue;
      const month = parseMonth(cell(grid, rr, monthCol));
      const hours = parseHours(cell(grid, rr, hoursCol));
      if (!month || hours === null) {
        if (cell(grid, rr, monthCol) || cell(grid, rr, hoursCol)) skipped++;
        continue;
      }
      if (hours === 0) continue;
      rows.push({ month, label, hours });
    }
    if (rows.length) {
      return {
        layout: 'long',
        rows,
        labelHeader: labelCol >= 0 ? headers[labelCol] : '',
        months: [...new Set(rows.map((x) => x.month))].sort(),
        skipped,
        note: `One row per month, hours from "${headers[hoursCol]}"${labelCol >= 0 ? `, keyed by "${headers[labelCol]}"` : ''}.`,
      };
    }
  }

  return empty;
}

/**
 * P6 date handling.
 *
 * P6 exports dates as dd-mmm-yy, with a trailing " A" on actual dates. When the
 * export is pasted into Excel, planned dates become real date values while the
 * actual dates stay as text, so one column carries both. A cell may also be a
 * numeric Excel serial. All three cases are handled here.
 *
 * Century pivot: the schedule runs to 2030, so 26-Aug-30 must be 2030. Two digit
 * years are parsed as 19yy and then, if the year is before 1950, 100 years are
 * added. This matches the workbook's formula exactly.
 */

export type ParsedDate = {
  iso: string | null; // YYYY-MM-DD
  actual: boolean;
  raw: string; // text form of the input, for display
  unparseable: boolean; // non-empty input that could not be parsed
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/** Excel serial number (1900 date system) to ISO date. */
export function excelSerialToISO(serial: number): string {
  const ms = EXCEL_EPOCH_MS + Math.floor(serial) * DAY_MS;
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/** ISO date to Excel serial (1900 date system). */
export function isoToExcelSerial(iso: string): number {
  return Math.round((isoToMs(iso) - EXCEL_EPOCH_MS) / DAY_MS);
}

/** ISO date to a UTC millisecond timestamp. */
export function isoToMs(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function msToISO(ms: number): string {
  const dt = new Date(ms);
  return toISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function isValidISO(iso: string | null | undefined): iso is string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}

/** Parse dd-mmm-yy or dd-mmm-yyyy. Returns null when the text is not that shape. */
export function parseDdMmmYy(text: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/.exec(text.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  let year = Number(m[3]);
  if (m[3].length === 2) year += 1900;
  if (year < 1950) year += 100; // century pivot, see file header
  const iso = toISO(year, month, day);
  return isValidISO(iso) ? iso : null;
}

/** Parse an ISO date or a yyyy-mm-dd-like string that a spreadsheet may hand us. */
function parseIsoLike(text: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(text.trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}`;
  return isValidISO(iso) ? iso : null;
}

/**
 * Parse a P6 date cell. Accepts a JS Date, a numeric Excel serial, or text.
 * Text ending in " A" is an actual date.
 */
export function parseP6Date(cell: unknown): ParsedDate {
  if (cell === null || cell === undefined || cell === '') {
    return { iso: null, actual: false, raw: '', unparseable: false };
  }
  if (cell instanceof Date) {
    if (Number.isNaN(cell.getTime())) return { iso: null, actual: false, raw: String(cell), unparseable: true };
    // SheetJS and Excel produce local-midnight dates; read the calendar fields so the
    // day is preserved regardless of the machine's time zone.
    const iso = toISO(cell.getFullYear(), cell.getMonth() + 1, cell.getDate());
    return { iso, actual: false, raw: iso, unparseable: false };
  }
  if (typeof cell === 'number') {
    if (!Number.isFinite(cell) || cell <= 0) return { iso: null, actual: false, raw: String(cell), unparseable: true };
    return { iso: excelSerialToISO(cell), actual: false, raw: String(cell), unparseable: false };
  }
  const raw = String(cell);
  let text = raw.trim();
  let actual = false;
  if (text.endsWith(' A')) {
    text = text.slice(0, -2).trim();
    actual = true;
  }
  if (text === '') return { iso: null, actual, raw, unparseable: false };
  // A pure number as text is an Excel serial that lost its format.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    return { iso: n > 0 ? excelSerialToISO(n) : null, actual, raw, unparseable: !(n > 0) };
  }
  const iso = parseDdMmmYy(text) ?? parseIsoLike(text) ?? parseFallback(text);
  return { iso, actual, raw, unparseable: iso === null };
}

/** Last resort: let the JS Date parser try (e.g. "8/26/2030"). */
function parseFallback(text: string): string | null {
  if (!/^[\d/.-]+$/.test(text)) return null;
  const t = Date.parse(text);
  if (Number.isNaN(t)) return null;
  const dt = new Date(t);
  return toISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Last day of the month containing the given ISO date. */
export function monthEnd(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return toISO(y, m, last);
}

/** All month ends from the month of `fromIso` to the month of `toIso` inclusive. */
export function monthEndsBetween(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let [y, m] = fromIso.split('-').map(Number);
  const [ty, tm] = toIso.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(monthEnd(toISO(y, m, 1)));
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function maxISO(a: string, b: string): string {
  return a >= b ? a : b;
}

export function minISO(a: string, b: string): string {
  return a <= b ? a : b;
}

/** Format an ISO date as dd-mmm-yy, the P6 convention, for display and export. */
export function formatDdMmmYy(iso: string | null | undefined): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad2(d)}-${names[m - 1]}-${pad2(y % 100)}`;
}

import * as XLSX from 'xlsx';
import { parseTable, type ParsedTable } from './parse';

/**
 * Read the first six columns of a worksheet into an untyped grid. Dates come back as
 * JS Date objects (cellDates), numbers as numbers, everything else as text, so the
 * mixed text / serial date columns of a pasted P6 export survive intact.
 */
export function sheetToGrid(ws: XLSX.WorkSheet, maxCols = 6): unknown[][] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  return rows.map((r) => r.slice(0, maxCols));
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: data instanceof Uint8Array ? 'array' : 'array', cellDates: true });
}

/** Sheet names in preference order for a P6 extract inside a workbook. */
const PREFERRED = ['P6_Extract', 'Baseline_Extract', 'Sheet1', 'TASK'];

export function pickSheet(wb: XLSX.WorkBook, preferred?: string): string {
  if (preferred && wb.SheetNames.includes(preferred)) return preferred;
  for (const n of PREFERRED) if (wb.SheetNames.includes(n)) return n;
  return wb.SheetNames[0];
}

/** Parse a worksheet of a P6 export into activities. */
export function parseWorkbookSheet(wb: XLSX.WorkBook, sheetName: string): ParsedTable {
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found`);
  return parseTable(sheetToGrid(ws));
}

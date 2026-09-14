/**
 * Column detection for a P6 export.
 *
 * A P6 "export to Excel" does not always put the six columns in the same order, and
 * often carries a title row or two above the header. Rather than assume positions, the
 * header row is located by name and the mapping is handed to the UI so the user can
 * correct it before importing. Positional order is the fallback when no header is found.
 */

export type FieldKey = 'activityId' | 'activityName' | 'originalDuration' | 'remainingDuration' | 'start' | 'finish';

export const FIELD_LABELS: Record<FieldKey, string> = {
  activityId: 'Activity ID',
  activityName: 'Activity Name',
  originalDuration: 'Original Duration',
  remainingDuration: 'Remaining Duration',
  start: 'Start',
  finish: 'Finish',
};

export const FIELD_ORDER: FieldKey[] = ['activityId', 'activityName', 'originalDuration', 'remainingDuration', 'start', 'finish'];

/** Column mapping: field to zero-based column index, or null when the export has no such column. */
export type ColumnMap = Record<FieldKey, number | null>;

export const DEFAULT_MAP: ColumnMap = { activityId: 0, activityName: 1, originalDuration: 2, remainingDuration: 3, start: 4, finish: 5 };

/**
 * Header names accepted per field, most specific first. Matching is case-insensitive on
 * the header text with punctuation and whitespace squeezed out, so "Activity_ID",
 * "Activity ID" and "activityid" all match.
 */
const SYNONYMS: Record<FieldKey, string[]> = {
  activityId: ['activityid', 'taskcode', 'activitycode', 'actid', 'id'],
  activityName: ['activityname', 'taskname', 'activitydescription', 'description', 'name'],
  originalDuration: ['originalduration', 'origduration', 'originaldur', 'plannedduration', 'atcompletionduration', 'budgetedduration', 'duration', 'od'],
  remainingDuration: ['remainingduration', 'remainingdur', 'remdur', 'remaining', 'rd'],
  start: ['start', 'startdate', 'actualstart', 'earlystart', 'plannedstart', 'begin'],
  finish: ['finish', 'finishdate', 'actualfinish', 'earlyfinish', 'plannedfinish', 'end', 'enddate'],
};

function squeeze(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Score how strongly one cell matches a field name. 3 exact, 2 prefix, 0 no match. */
function scoreCell(cell: unknown, field: FieldKey): number {
  const s = squeeze(cell);
  if (!s) return 0;
  const syns = SYNONYMS[field];
  for (let i = 0; i < syns.length; i++) {
    if (s === syns[i]) return 3;
  }
  for (let i = 0; i < syns.length; i++) {
    // "startdate(early)" or "originalduration(days)" still count, but only as a prefix hit.
    if (s.startsWith(syns[i]) && syns[i].length >= 3) return 2;
  }
  return 0;
}

export type Layout = {
  /** Index of the header row in the grid, or null when no header was recognised. */
  headerRow: number | null;
  /** Index of the first data row. */
  firstDataRow: number;
  map: ColumnMap;
  /** True when the mapping came from a recognised header rather than column position. */
  fromHeader: boolean;
  /** Header cell text per field, for showing the user what was matched. */
  matchedNames: Partial<Record<FieldKey, string>>;
};

/**
 * Find the header row and the column mapping. Scans the first `scanRows` rows and picks
 * the one that best matches the known field names; a title row above the header is
 * therefore skipped rather than parsed as data.
 */
export function detectLayout(grid: unknown[][], scanRows = 12): Layout {
  let best = { row: -1, score: 0, map: { ...DEFAULT_MAP }, names: {} as Partial<Record<FieldKey, string>> };
  const limit = Math.min(scanRows, grid.length);
  for (let r = 0; r < limit; r++) {
    const cells = grid[r] ?? [];
    if (!cells.some((c) => squeeze(c) !== '')) continue;
    const map: ColumnMap = { activityId: null, activityName: null, originalDuration: null, remainingDuration: null, start: null, finish: null };
    const names: Partial<Record<FieldKey, string>> = {};
    let total = 0;
    // Each field takes its best-scoring unclaimed column.
    for (const field of FIELD_ORDER) {
      let bestCol = -1;
      let bestScore = 0;
      for (let c = 0; c < cells.length; c++) {
        if (Object.values(map).includes(c)) continue;
        const s = scoreCell(cells[c], field);
        if (s > bestScore) {
          bestScore = s;
          bestCol = c;
        }
      }
      if (bestCol >= 0 && bestScore > 0) {
        map[field] = bestCol;
        names[field] = String(cells[bestCol] ?? '').trim();
        total += bestScore;
      }
    }
    if (total > best.score) best = { row: r, score: total, map, names };
  }
  // Require the two columns that actually matter plus one more, so a data row cannot
  // masquerade as a header.
  const strong = best.score >= 7 && best.map.activityId !== null && best.map.activityName !== null;
  if (!strong) {
    return { headerRow: null, firstDataRow: 0, map: { ...DEFAULT_MAP }, fromHeader: false, matchedNames: {} };
  }
  // Any field the header did not name falls back to its usual position when that column
  // is not already spoken for.
  const map = { ...best.map };
  for (const field of FIELD_ORDER) {
    if (map[field] !== null) continue;
    const fallback = DEFAULT_MAP[field];
    if (fallback !== null && !Object.values(map).includes(fallback)) map[field] = fallback;
  }
  return { headerRow: best.row, firstDataRow: best.row + 1, map, fromHeader: true, matchedNames: best.names };
}

/** Widest row in the grid, so the mapping UI can offer every column. */
export function columnCount(grid: unknown[][]): number {
  return grid.reduce((n, r) => Math.max(n, r.length), 0);
}

/** A short label for a column in the mapping UI: "C: Original Duration" or just "C". */
export function columnLabel(index: number, header: unknown[] | null): string {
  let n = index;
  let letters = '';
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  const text = header ? String(header[index] ?? '').trim() : '';
  return text ? `${letters}: ${text}` : letters;
}

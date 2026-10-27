/**
 * Reading a whole P6 project out of an XER file, quickly and in pieces.
 *
 * `xer.ts` reads the three tables the budget needs. A full project file carries
 * forty-odd, and the ones a schedule viewer needs — relationships, resource
 * assignments, codes — are the big ones: a programme of twenty thousand activities
 * has more relationship rows than activities, and a file of thirty or forty
 * megabytes. Two things follow from that.
 *
 * - Rows are handed to a per-table visitor as they are read and then dropped,
 *   rather than every table being split into arrays of strings first. Splitting the
 *   whole file up front holds several times its size in memory at once, which is
 *   the difference between a laptop coping and a tab crashing.
 * - The scan runs in steps of a few megabytes, so the screen can say how far it has
 *   got and stay responsive between them. Nothing here touches the DOM; the caller
 *   decides whether to yield between steps (the app) or not (the tests).
 *
 * The format is tab-delimited and line-based: `%T` names a table, `%F` its fields,
 * `%R` a row, `%E` ends the file. P6 writes the line breaks inside a notebook as a
 * pair of 0x7F characters, so a row is one line; a line that starts with none of the
 * tags is nevertheless taken as a continuation of the row before it, because a file
 * that has been through another tool sometimes has real line breaks in its text.
 */

/** Which character set the bytes were read as. */
export type XerEncoding = 'utf-8' | 'windows-1252';

/**
 * Bytes to text.
 *
 * P6 writes an XER in the code page of the machine that exported it, and on a
 * Windows desktop that is Windows-1252, not UTF-8. Read as UTF-8, every en dash,
 * degree sign and accented name in it turns into a replacement character. So UTF-8
 * is tried strictly first — a file that really is UTF-8 decodes cleanly — and
 * anything that is not valid UTF-8 is read as Windows-1252, which can decode any
 * byte at all.
 */
export function decodeXer(bytes: Uint8Array): { text: string; encoding: XerEncoding } {
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bom ? bytes.subarray(3) : bytes), encoding: 'utf-8' };
  } catch {
    return { text: fixC1(new TextDecoder('windows-1252').decode(bytes)), encoding: 'windows-1252' };
  }
}

/**
 * Windows-1252 puts printable characters — the en dash, curly quotes, the euro sign
 * — where ISO-8859-1 has invisible control codes, at 0x80 to 0x9F. Browsers decode
 * "windows-1252" properly; some runtimes treat it as ISO-8859-1 and leave the
 * control codes in. Mapping that range explicitly makes the answer the same
 * everywhere, and is a no-op on text that was decoded right in the first place.
 */
const CP1252_C1 = [
  0x20ac, 0x81, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8d, 0x017d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x9d, 0x017e, 0x0178,
];
function fixC1(text: string): string {
  return /[\x80-\x9f]/.test(text) ? text.replace(/[\x80-\x9f]/g, (c) => String.fromCharCode(CP1252_C1[c.charCodeAt(0) - 0x80])) : text;
}

/**
 * Called once per table, with its field names, when the `%F` line is read. Return a
 * function to receive each row of that table, or null to skip the table.
 *
 * Splitting the two lets a table look its column positions up once rather than once
 * per row, which over a hundred thousand rows is most of the cost of reading them.
 */
export type XerTableReader = (fields: string[]) => ((row: string[]) => void) | null;

export type XerReaders = Record<string, XerTableReader>;

/** The ERMHDR line: the P6 version, the export date, who exported it, and so on. */
export type XerHeader = {
  version: string;
  exportDate: string;
  /** Whoever exported it: their name where P6 wrote one, else their login. */
  user: string;
  /** Their P6 login. */
  login: string;
  database: string;
  currency: string;
};

/** ERMHDR, version, date, export type, login, user name, database, module, currency. */
function readHeader(line: string): XerHeader {
  const c = line.split('\t').map((x) => x.trim());
  return { version: c[1] ?? '', exportDate: c[2] ?? '', user: c[5] || c[4] || '', login: c[4] ?? '', database: c[6] ?? '', currency: c[8] ?? '' };
}

/**
 * A scan of one XER text, advanced a step at a time.
 *
 * `step` reads up to a budget of characters and stops at the end of a line, so the
 * caller can report `progress` and give the browser a frame between steps.
 */
export class XerScanner {
  private pos = 0;
  private reader: ((row: string[]) => void) | null = null;
  private tableReader: XerTableReader | null = null;
  private table = '';
  /** The `%R` line still being read, when the next line might continue it. */
  private pending: string | null = null;
  /** Rows per table, for every table in the file, read or not. */
  readonly rowCounts = new Map<string, number>();
  /** Tables in the order the file has them. */
  readonly tables: string[] = [];
  header: XerHeader | null = null;
  /** True once a `%T` line has been seen: a file with none is not an XER. */
  sawTable = false;

  constructor(
    private readonly text: string,
    private readonly readers: XerReaders,
  ) {}

  /** How far through the text the scan is, 0 to 1. */
  get progress(): number {
    return this.text.length ? Math.min(1, this.pos / this.text.length) : 1;
  }

  get done(): boolean {
    return this.pos >= this.text.length && this.pending === null;
  }

  private flush(): void {
    const line = this.pending;
    this.pending = null;
    if (line === null || !this.reader) return;
    const cells = line.split('\t');
    cells.shift();
    this.reader(cells);
  }

  /** Read up to `budget` characters. Returns true when the whole text has been read. */
  step(budget = 4_000_000): boolean {
    const text = this.text;
    const stop = Math.min(text.length, this.pos + budget);
    while (this.pos < stop) {
      let nl = text.indexOf('\n', this.pos);
      if (nl < 0) nl = text.length;
      let end = nl;
      if (end > this.pos && text.charCodeAt(end - 1) === 13) end -= 1;
      const line = text.slice(this.pos, end);
      this.pos = nl + 1;
      this.line(line);
    }
    if (this.pos >= text.length) {
      this.flush();
      return true;
    }
    return false;
  }

  private line(line: string): void {
    if (line.length === 0) return;
    const c0 = line.charCodeAt(0);
    // '%'
    if (c0 === 37 && line.length >= 2) {
      const tag = line.charCodeAt(1);
      if (tag === 82 /* R */ && (line.length === 2 || line.charCodeAt(2) === 9)) {
        this.flush();
        this.rowCounts.set(this.table, (this.rowCounts.get(this.table) ?? 0) + 1);
        if (this.reader) this.pending = line;
        return;
      }
      if (tag === 84 /* T */ && (line.length === 2 || line.charCodeAt(2) === 9)) {
        this.flush();
        this.sawTable = true;
        this.table = line.slice(3).trim();
        this.tables.push(this.table);
        this.rowCounts.set(this.table, 0);
        this.tableReader = this.readers[this.table] ?? null;
        this.reader = null;
        return;
      }
      if (tag === 70 /* F */ && (line.length === 2 || line.charCodeAt(2) === 9)) {
        this.flush();
        const fields = line.split('\t').slice(1).map((f) => f.trim().toLowerCase());
        this.reader = this.tableReader ? this.tableReader(fields) : null;
        return;
      }
      if (tag === 69 /* E */ && (line.length === 2 || line.charCodeAt(2) === 9 || line.trim() === '%E')) {
        this.flush();
        this.reader = null;
        this.tableReader = null;
        return;
      }
    }
    if (line.startsWith('ERMHDR')) {
      this.header = readHeader(line);
      return;
    }
    // Not a tag: the text of the row above carried a real line break.
    if (this.pending !== null) this.pending += `\n${line}`;
  }
}

/** Read the whole text in one go. For tests, and for files small enough not to need yielding. */
export function scanXerSync(text: string, readers: XerReaders): XerScanner {
  const s = new XerScanner(text, readers);
  while (!s.step(Number.MAX_SAFE_INTEGER)) {
    /* one step reads it all */
  }
  return s;
}

/** Give the browser a frame. A resolved promise would not: it runs before rendering. */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Read the whole text, yielding between steps so a progress bar can move. `onProgress`
 * is called with 0 to 1 after every step.
 */
export async function scanXerAsync(text: string, readers: XerReaders, onProgress?: (p: number) => void): Promise<XerScanner> {
  const s = new XerScanner(text, readers);
  while (!s.step()) {
    onProgress?.(s.progress);
    await nextTask();
  }
  onProgress?.(1);
  return s;
}

/** Column positions of a table, looked up once. -1 for a field the table does not have. */
export function columns<K extends string>(fields: string[], names: readonly K[]): Record<K, number> {
  const out = {} as Record<K, number>;
  for (const n of names) out[n] = fields.indexOf(n);
  return out;
}

/** One cell, trimmed, or '' when the table has no such column. */
export function cell(row: string[], i: number): string {
  if (i < 0) return '';
  const v = row[i];
  return v === undefined ? '' : v.trim();
}

/** A number cell, or null when blank or not a number. */
export function numCell(row: string[], i: number): number | null {
  const v = cell(row, i);
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * A P6 date-time, "2026-09-14 08:00", as a millisecond timestamp.
 *
 * The times in an XER carry no zone: they are the schedule's own wall-clock times.
 * They are read as UTC so that no machine's time zone or daylight saving can move a
 * finish to the day before, which is what reading them as local time does to a
 * 00:00 date somewhere west of Greenwich.
 */
export function dateCell(row: string[], i: number): number | null {
  return parseXerDate(cell(row, i));
}

export function parseXerDate(v: string): number | null {
  if (v.length < 10) return null;
  const y = Number(v.slice(0, 4));
  const m = Number(v.slice(5, 7));
  const d = Number(v.slice(8, 10));
  if (!(y > 1900 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const hh = v.length >= 13 ? Number(v.slice(11, 13)) : 0;
  const mm = v.length >= 16 ? Number(v.slice(14, 16)) : 0;
  const ms = Date.UTC(y, m - 1, d, Number.isFinite(hh) ? hh : 0, Number.isFinite(mm) ? mm : 0);
  return Number.isFinite(ms) ? ms : null;
}

/** A timestamp back to the ISO calendar date the rest of the application works in. */
export function msToDate(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms)) return null;
  const d = new Date(ms);
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * A notebook entry as plain text.
 *
 * P6 stores notebooks as HTML, with its own line breaks written as 0x7F pairs. The
 * viewer shows them as text — never as markup, since a file is something somebody
 * sent and its HTML is not something to run — so tags become line breaks or nothing
 * and the common entities are decoded.
 */
export function memoText(html: string): string {
  let t = html.replace(/\x7f\x7f/g, '\n').replace(/\x7f/g, '');
  t = t.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  t = t.replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6])\s*>/gi, '\n').replace(/<li[^>]*>/gi, '• ');
  t = t.replace(/<[^>]*>/g, '');
  t = t
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/gi, '&');
  return t
    .split('\n')
    .map((l) => l.replace(/\s+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * The status report, painted onto a canvas.
 *
 * This exists because the obvious route does not work. Cloning the live DOM into
 * an SVG `<foreignObject>` and rasterising it renders perfectly and then taints the
 * canvas — Chromium taints unconditionally for any SVG image carrying a
 * foreignObject — so the pixels can never be read back out as a PNG. Every
 * DOM-to-image library is built on that trick and hits the same wall.
 *
 * What stops this from becoming a second, drifting layout of the same figures is
 * where it gets its content: a table block is painted from the very `Column`
 * definitions the table on screen is built from, through the same `value()` the
 * screen sorts and exports by. A column added to the screen appears here; a column
 * renamed is renamed here. Only the drawing is separate, and drawing is the part
 * that has to be separate.
 */
import { prepareChart, withDpi, type Prepared } from './export';

export type PaintTone = 'good' | 'info' | 'warn' | 'bad' | 'muted';

export type PaintBlock =
  | { kind: 'title'; text: string; sub?: string; right?: string[] }
  | { kind: 'section'; text: string; meta?: string }
  | { kind: 'stats'; items: { label: string; value: string; sub?: string; tone?: PaintTone }[] }
  | { kind: 'bars'; rows: { label: string; value: string; pct: number; color: string }[] }
  | { kind: 'lines'; items: string[] }
  | { kind: 'table'; head: string[]; num: boolean[]; rows: string[][]; tone?: (PaintTone | null)[] }
  | { kind: 'chart'; el: HTMLElement }
  | { kind: 'note'; text: string };

/** The application's own tokens, literal, so the picture does not depend on CSS. */
const C = {
  ink: '#1a1a1a',
  muted: '#6e7179',
  subtle: '#697280',
  line: '#e4e7ec',
  lineFaint: '#f4f4f6',
  strong: '#d8d8d8',
  surface: '#f9fafb',
  good: '#0d7a4f',
  warn: '#a8550a',
  bad: '#c01017',
  info: '#1d4eaf',
  grey: '#74777f',
  white: '#ffffff',
};
const toneColor = (t?: PaintTone | null) =>
  t === 'good' ? C.good : t === 'bad' ? C.bad : t === 'warn' ? C.warn : t === 'info' ? C.info : t === 'muted' ? C.grey : C.strong;

const SANS = 'system-ui, Segoe UI, Arial, sans-serif';
const MONO = 'ui-monospace, Consolas, monospace';

const PAD = 24;
const GAP = 18;
const TILE_H = 54;
const TILE_MIN = 132;
const ROW_H = 22;
const HEAD_H = 24;
/** The most lines any one cell may take before it is cut after all. */
const MAX_LINES = 3;
const LINE_H = 14;

type TableBlock = Extract<PaintBlock, { kind: 'table' }>;
type CellLine = { text: string; mono: boolean; bold: boolean };

/**
 * A cell as it will be drawn: its lines, wrapped to the width it has been given.
 *
 * An Activity cell arrives as an ID over a name, and at the width a page can spare
 * the name does not fit on one line. Cutting it is what a screen does, because the
 * whole text is a hover away; on paper there is no hover, so it wraps and the row
 * grows to hold it.
 */
function cellLines(ctx: CanvasRenderingContext2D, cell: string, width: number): CellLine[] {
  const parts = String(cell ?? '').split('\n').map((t) => t.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const out: CellLine[] = [];
  const two = parts.length > 1;
  parts.forEach((part, i) => {
    const mono = two && i === 0;
    const bold = two && i > 0;
    ctx.font = mono ? `9.5px ${MONO}` : bold ? `600 11.5px ${SANS}` : `11.5px ${SANS}`;
    for (const line of wrap(ctx, part, width)) out.push({ text: line, mono, bold });
  });
  return out.slice(0, MAX_LINES);
}

/** Column widths and row height for one table, worked out once per width. */
const metrics = new WeakMap<TableBlock, { at: number; widths: number[]; rowH: number; headH: number; head: string[][] }>();

function tableMetrics(ctx: CanvasRenderingContext2D, b: TableBlock, width: number) {
  const hit = metrics.get(b);
  if (hit && hit.at === width) return hit;
  const widths = tableWidths(ctx, b, width);
  let lines = 1;
  for (const r of b.rows) r.forEach((cell, i) => {
    lines = Math.max(lines, cellLines(ctx, cell, widths[i] - 16).length);
  });
  // A heading wraps rather than being cut: "PROJECT ACHI…" names nothing, and the
  // column it sits over is the one nobody can then read.
  ctx.font = `600 9.5px ${MONO}`;
  const head = b.head.map((label, i) => wrap(ctx, label.toUpperCase(), widths[i] - 16).slice(0, 2));
  const out = {
    at: width,
    widths,
    rowH: Math.max(ROW_H, 8 + lines * LINE_H),
    headH: HEAD_H + (Math.max(...head.map((h) => h.length)) - 1) * 12,
    head,
  };
  metrics.set(b, out);
  return out;
}

/** Cut a string to fit a width, with an ellipsis, measuring in the given font. */
function clip(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}

/** Wrap a string onto as many lines as it takes, within a width. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > max && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** How many tiles fit across, and how wide each is. */
function tileGrid(width: number, n: number): { cols: number; w: number } {
  const cols = Math.max(1, Math.min(n, Math.floor((width + 8) / (TILE_MIN + 8))));
  return { cols, w: (width - 8 * (cols - 1)) / cols };
}

/** Column widths for a table: the content, capped, then shrunk to fit. */
function tableWidths(ctx: CanvasRenderingContext2D, b: Extract<PaintBlock, { kind: 'table' }>, width: number): number[] {
  ctx.font = `600 10px ${MONO}`;
  const want = b.head.map((h) => ctx.measureText(h.toUpperCase()).width + 18);
  ctx.font = `11.5px ${SANS}`;
  for (const r of b.rows.slice(0, 500)) {
    r.forEach((cell, i) => {
      for (const line of String(cell ?? '').split('\n')) want[i] = Math.max(want[i] ?? 0, ctx.measureText(line).width + 18);
    });
  }
  const capped = want.map((w) => Math.min(w, 300));
  const total = capped.reduce((s, w) => s + w, 0);
  // Proportional either way: dumping the slack on one column leaves a gap in the
  // middle of the table, and squeezing one column is how a name gets cut off while
  // a date column keeps room it never needed.
  return capped.map((w) => (w / total) * width);
}

/** How tall a block will be, given the width it gets. */
function heightOf(ctx: CanvasRenderingContext2D, b: PaintBlock, width: number, charts: Map<HTMLElement, Prepared>): number {
  switch (b.kind) {
    case 'title':
      return 34 + (b.sub ? 17 : 0) + 10;
    case 'section':
      return 26;
    case 'stats': {
      const { cols, w } = tileGrid(width, b.items.length);
      ctx.font = `11px ${SANS}`;
      const tall = b.items.some((i) => i.sub && ctx.measureText(i.sub).width <= w);
      return Math.ceil(b.items.length / cols) * ((tall ? TILE_H + 14 : TILE_H) + 8) - 8;
    }
    case 'bars':
      return b.rows.length * 26;
    case 'lines': {
      ctx.font = `11.5px ${SANS}`;
      return b.items.reduce((s, t) => s + wrap(ctx, t, width).length * 16, 0);
    }
    case 'table': {
      const m = tableMetrics(ctx, b, width);
      return m.headH + b.rows.length * m.rowH;
    }
    case 'chart': {
      const p = charts.get(b.el);
      return p ? Math.round((p.h * Math.min(1, width / p.w)) + 4) : 0;
    }
    case 'note': {
      ctx.font = `11px ${SANS}`;
      return wrap(ctx, b.text, width).length * 15;
    }
  }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  item: { label: string; value: string; sub?: string; tone?: PaintTone },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  ctx.fillStyle = C.white;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 8);
  ctx.fill();
  ctx.stroke();
  // The 3px tone edge the tiles on screen carry, which is the only thing saying
  // which figure is which once the picture is in black and white.
  ctx.fillStyle = toneColor(item.tone);
  ctx.beginPath();
  ctx.roundRect(x + 0.5, y + 0.5, 3, h - 1, [8, 0, 0, 8]);
  ctx.fill();

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = item.tone === 'good' ? C.good : item.tone === 'bad' ? C.bad : item.tone === 'warn' ? C.warn : C.ink;
  ctx.font = `600 19px ${SANS}`;
  ctx.fillText(clip(ctx, item.value, w - 24), x + 13, y + 27);
  ctx.fillStyle = C.muted;
  ctx.font = `600 9.5px ${MONO}`;
  ctx.fillText(clip(ctx, item.label.toUpperCase(), w - 24), x + 13, y + 42);
  if (item.sub) {
    ctx.fillStyle = C.subtle;
    ctx.font = `10.5px ${SANS}`;
    const s = clip(ctx, item.sub, w - 24);
    if (s !== '…') ctx.fillText(s, x + 13, y + 56);
  }
}

/** Draw one block at `y`, and return the height it took. */
function draw(ctx: CanvasRenderingContext2D, b: PaintBlock, x: number, y: number, width: number, charts: Map<HTMLElement, Prepared>): number {
  const h = heightOf(ctx, b, width, charts);
  ctx.textBaseline = 'alphabetic';
  switch (b.kind) {
    case 'title': {
      ctx.fillStyle = C.ink;
      ctx.font = `700 19px ${SANS}`;
      ctx.fillText(b.text, x, y + 18);
      if (b.sub) {
        ctx.fillStyle = C.muted;
        ctx.font = `12.5px ${SANS}`;
        ctx.fillText(b.sub, x, y + 35);
      }
      if (b.right) {
        ctx.font = `10.5px ${MONO}`;
        ctx.fillStyle = C.muted;
        ctx.textAlign = 'right';
        b.right.forEach((t, i) => ctx.fillText(t, x + width, y + 12 + i * 14));
        ctx.textAlign = 'left';
      }
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, y + h - 6);
      ctx.lineTo(x + width, y + h - 6);
      ctx.stroke();
      return h;
    }
    case 'section': {
      ctx.fillStyle = C.ink;
      ctx.font = `700 13px ${SANS}`;
      ctx.fillText(b.text, x, y + 13);
      if (b.meta) {
        ctx.fillStyle = C.muted;
        ctx.font = `11.5px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(b.meta, x + width, y + 13);
        ctx.textAlign = 'left';
      }
      ctx.strokeStyle = C.line;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y + 19.5);
      ctx.lineTo(x + width, y + 19.5);
      ctx.stroke();
      return h;
    }
    case 'stats': {
      const { cols, w } = tileGrid(width, b.items.length);
      ctx.font = `11px ${SANS}`;
      const tall = b.items.some((i) => i.sub && ctx.measureText(i.sub).width <= w);
      const th = tall ? TILE_H + 14 : TILE_H;
      b.items.forEach((item, i) => {
        drawTile(ctx, item, x + (i % cols) * (w + 8), y + Math.floor(i / cols) * (th + 8), w, th);
      });
      return h;
    }
    case 'bars': {
      b.rows.forEach((r, i) => {
        const top = y + i * 26;
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.roundRect(x, top + 6, 10, 10, 3);
        ctx.fill();
        ctx.fillStyle = C.muted;
        ctx.font = `11.5px ${SANS}`;
        ctx.fillText(r.label, x + 18, top + 15);
        const trackX = x + 92;
        const trackW = width - 92 - 92;
        ctx.fillStyle = '#eef0f3';
        ctx.beginPath();
        ctx.roundRect(trackX, top + 3, trackW, 16, 5);
        ctx.fill();
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.roundRect(trackX, top + 3, Math.max(0, Math.min(1, r.pct)) * trackW, 16, 5);
        ctx.fill();
        ctx.fillStyle = C.ink;
        ctx.font = `600 12.5px ${SANS}`;
        ctx.textAlign = 'right';
        ctx.fillText(r.value, x + width, top + 15);
        ctx.textAlign = 'left';
      });
      return h;
    }
    case 'lines': {
      ctx.font = `11.5px ${SANS}`;
      let top = y;
      for (const t of b.items) {
        for (const line of wrap(ctx, t, width)) {
          ctx.fillStyle = C.ink;
          ctx.fillText(line, x, top + 11);
          top += 16;
        }
      }
      return h;
    }
    case 'table': {
      const { widths, rowH, headH, head } = tableMetrics(ctx, b, width);
      const at = (i: number) => x + widths.slice(0, i).reduce((s, w) => s + w, 0);
      const put = (text: string, i: number, top: number, dy: number) => {
        if (b.num[i]) {
          ctx.textAlign = 'right';
          ctx.fillText(text, at(i) + widths[i] - 8, top + dy);
          ctx.textAlign = 'left';
        } else ctx.fillText(text, at(i) + 8, top + dy);
      };

      ctx.fillStyle = C.surface;
      ctx.fillRect(x, y, width, headH);
      ctx.font = `600 9.5px ${MONO}`;
      ctx.fillStyle = C.muted;
      head.forEach((label, i) => label.forEach((line, n) => put(line, i, y, headH - 8 - (label.length - 1 - n) * 12)));
      ctx.strokeStyle = C.strong;
      ctx.beginPath();
      ctx.moveTo(x, y + headH - 0.5);
      ctx.lineTo(x + width, y + headH - 0.5);
      ctx.stroke();

      b.rows.forEach((row, r) => {
        const top = y + headH + r * rowH;
        const tone = b.tone?.[r];
        if (tone === 'bad') {
          ctx.fillStyle = '#fdf4f4';
          ctx.fillRect(x, top, width, rowH);
        } else if (tone === 'muted') {
          ctx.fillStyle = '#fbfbfc';
          ctx.fillRect(x, top, width, rowH);
        }
        row.forEach((cell, i) => {
          cellLines(ctx, cell, widths[i] - 16).forEach((line, n) => {
            ctx.font = line.mono ? `9.5px ${MONO}` : line.bold ? `600 11.5px ${SANS}` : `11.5px ${SANS}`;
            ctx.fillStyle = line.mono ? C.muted : C.ink;
            put(line.text, i, top, 13 + n * LINE_H);
          });
        });
        ctx.strokeStyle = C.lineFaint;
        ctx.beginPath();
        ctx.moveTo(x, top + rowH - 0.5);
        ctx.lineTo(x + width, top + rowH - 0.5);
        ctx.stroke();
      });
      return h;
    }
    case 'chart': {
      const p = charts.get(b.el);
      if (!p) return 0;
      const k = Math.min(1, width / p.w);
      ctx.drawImage(p.img, x, y, p.w * k, p.h * k);
      for (const l of p.legend) {
        // Scaled with the chart: at a fixed size the labels of a shrunk chart run
        // into each other, because their positions moved and their widths did not.
        ctx.fillStyle = l.color;
        ctx.beginPath();
        ctx.arc(x + (l.x + 4) * k, y + l.y * k, 4 * k, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4a4d55';
        ctx.font = `${(11.5 * k).toFixed(1)}px ${SANS}`;
        ctx.textBaseline = 'middle';
        ctx.fillText(l.text, x + (l.x + 13) * k, y + l.y * k + 0.5);
        ctx.textBaseline = 'alphabetic';
      }
      return h;
    }
    case 'note': {
      ctx.font = `11px ${SANS}`;
      ctx.fillStyle = C.muted;
      let top = y;
      for (const line of wrap(ctx, b.text, width)) {
        ctx.fillText(line, x, top + 11);
        top += 15;
      }
      return h;
    }
  }
}

/**
 * A table block read off the table the screen is already showing.
 *
 * Not from the column definitions, and emphatically not from `value()`: that is
 * the raw figure the table sorts and exports by — `91.42857142857142`, `0.375`,
 * `2026-10-20` — and a picture of the report has to read the way the report reads.
 * Taking the rendered text also means the picture carries the columns somebody
 * chose, in the order they put them, sorted the way they left it, for free.
 */
export function paintTableFromDom(table: HTMLTableElement | null): Extract<PaintBlock, { kind: 'table' }> | null {
  if (!table) return null;
  const head: string[] = [];
  const num: boolean[] = [];
  for (const th of Array.from(table.querySelectorAll('thead th'))) {
    head.push((th as HTMLElement).innerText.replace(/[▲▼]/g, '').trim());
    num.push(th.classList.contains('num'));
  }
  const rows: string[][] = [];
  const tone: (PaintTone | null)[] = [];
  for (const tr of Array.from(table.querySelectorAll('tbody tr'))) {
    const cells = Array.from(tr.querySelectorAll('td'));
    if (cells.length !== head.length) continue;
    rows.push(cells.map((td) => (td as HTMLElement).innerText.trim()));
    tone.push(tr.classList.contains('row-bad') ? 'bad' : tr.classList.contains('row-muted') ? 'muted' : null);
  }
  return rows.length ? { kind: 'table', head, num, rows, tone } : null;
}

/**
 * How wide the picture is meant to be once it is on a page, and therefore how big
 * its type comes out. This is the whole of the quality problem: laid out at screen
 * width and dropped into a Word column, every figure lands about three pixels tall
 * and no amount of resolution rescues it. Laying the same report out narrower makes
 * the type proportionally bigger, and the density stamped into the file stops Word
 * guessing at 96 dpi and shrinking it a second time.
 */
export type PaintTarget = {
  label: string;
  /** How wide the picture is meant to be on the page. */
  inches: number;
  /** The layout width, in the units every size in this file is written in. */
  width: number;
  /**
   * How tall one page of that document is, inside its margins. Given one, the
   * report comes out as several pictures rather than one tall one — because Word
   * shrinks an inline image that will not fit the page, and a whole report is
   * always taller than a page. Left out, it is one picture however tall.
   */
  pageInches?: number;
};

/**
 * The width a chart should be laid out at for a given target.
 *
 * A chart captured at screen width and then scaled down takes its axis labels with
 * it: 10.5px type in a 1,200px chart becomes 4pt on a 6.5 inch page. Laid out at
 * the width it will occupy, its type is the size the rest of the page's type is.
 */
export const paintChartWidth = (t: PaintTarget) => t.width - PAD * 2;

export const PAINT_TARGETS: Record<string, PaintTarget> = {
  portrait: { label: 'Word page, portrait', inches: 6.5, width: 700, pageInches: 9 },
  landscape: { label: 'Word page, landscape', inches: 9.5, width: 1010, pageInches: 6.5 },
  screen: { label: 'One tall picture', inches: 12.5, width: 1330 },
};

/** A section heading sits against the block under it, not floating between two. */
const gapBefore = (b: PaintBlock, prev: PaintBlock | undefined, gap: number) =>
  prev === undefined ? 0 : prev.kind === 'section' ? 8 : b.kind === 'section' ? gap + 4 : gap;

/**
 * Paint the report and hand back one PNG per page.
 *
 * Measured first and drawn second, because nothing's height is known until every
 * chart has been rasterised and every table's columns measured.
 */
export async function paintReport(
  blocks: PaintBlock[],
  opts: { target?: PaintTarget; width?: number; scale?: number; gap?: number } = {},
): Promise<Uint8Array[]> {
  const target = opts.target ?? PAINT_TARGETS.landscape;
  const width = opts.width ?? target.width;
  // Enough device pixels that the picture survives being scaled up a little,
  // without making a file nobody can mail.
  const scale = opts.scale ?? Math.max(2, Math.min(4, Math.round((260 * target.inches) / width)));
  const gap = opts.gap ?? GAP;
  const inner = width - PAD * 2;
  if (blocks.length === 0) throw new Error('There is nothing on the page to save yet.');

  const charts = new Map<HTMLElement, Prepared>();
  try {
    // Rasterised at the density the canvas will draw them, not at screen size:
    // the curves are vectors, so there is no reason for them to be the one blurry
    // thing on the page.
    for (const b of blocks) {
      if (b.kind === 'chart' && !charts.has(b.el)) charts.set(b.el, await prepareChart({ chart: b.el }, scale));
    }
    const scratch = document.createElement('canvas').getContext('2d')!;
    const pageHeight = target.pageInches ? (target.pageInches * width) / target.inches : Infinity;
    const pages = paginate(scratch, blocks, inner, gap, pageHeight - PAD * 2, charts);
    const out: Uint8Array[] = [];
    for (let i = 0; i < pages.length; i++) {
      out.push(await drawPage(pages[i], { width, inner, scale, gap, target, charts, page: i + 1, of: pages.length }));
    }
    return out;
  } finally {
    for (const p of charts.values()) URL.revokeObjectURL(p.url);
  }
}

/**
 * Break the report into page-sized runs.
 *
 * Blocks stay whole where they can. A table that will not fit is split by rows and
 * its heading repeated, because the alternative — pushing a forty-row table whole
 * onto the next page — leaves most of a page blank and still does not fit. A
 * heading is never left at the foot of a page with nothing under it.
 */
function paginate(
  ctx: CanvasRenderingContext2D,
  blocks: PaintBlock[],
  inner: number,
  gap: number,
  limit: number,
  charts: Map<HTMLElement, Prepared>,
): PaintBlock[][] {
  if (!Number.isFinite(limit)) return [blocks];
  const pages: PaintBlock[][] = [];
  let page: PaintBlock[] = [];
  let used = 0;

  const push = (b: PaintBlock, h: number) => {
    used += gapBefore(b, page[page.length - 1], gap) + h;
    page.push(b);
  };
  const turn = () => {
    const orphan = page.length && page[page.length - 1].kind === 'section' ? page.pop()! : null;
    if (page.length) pages.push(page);
    page = orphan ? [orphan] : [];
    used = orphan ? heightOf(ctx, orphan, inner, charts) : 0;
  };

  /** The heading a split table sits under, so its continuation can say so. */
  let section: string | null = null;

  for (const b of blocks) {
    if (b.kind === 'section') section = b.text;
    const h = heightOf(ctx, b, inner, charts);
    if (page.length === 0 || used + gapBefore(b, page[page.length - 1], gap) + h <= limit) {
      push(b, h);
      continue;
    }
    if (b.kind === 'table') {
      const { rowH: rh, headH } = tableMetrics(ctx, b, inner);
      // Fill what is left of this page, then carry the rest over.
      const room = Math.floor((limit - used - gapBefore(b, page[page.length - 1], gap) - headH) / rh);
      let rest = b;
      if (room >= 3) {
        push({ ...b, rows: b.rows.slice(0, room), tone: b.tone?.slice(0, room) }, headH + room * rh);
        rest = { ...b, rows: b.rows.slice(room), tone: b.tone?.slice(room) };
      }
      turn();
      const carried: PaintBlock | null = section ? { kind: 'section', text: `${section} (continued)` } : null;
      const perPage = Math.max(1, Math.floor((limit - headH - (carried ? 26 : 0)) / rh));
      for (let i = 0; i < rest.rows.length; i += perPage) {
        const slice = { ...rest, rows: rest.rows.slice(i, i + perPage), tone: rest.tone?.slice(i, i + perPage) };
        if (page.length && used + gap + headH + slice.rows.length * rh > limit) turn();
        if (page.length === 0 && carried) push(carried, heightOf(ctx, carried, inner, charts));
        push(slice, headH + slice.rows.length * rh);
      }
      continue;
    }
    turn();
    push(b, h);
  }
  if (page.length) pages.push(page);
  return pages.filter((p) => p.length > 0);
}

async function drawPage(
  blocks: PaintBlock[],
  o: {
    width: number;
    inner: number;
    scale: number;
    gap: number;
    target: PaintTarget;
    charts: Map<HTMLElement, Prepared>;
    page: number;
    of: number;
  },
): Promise<Uint8Array> {
  const { width, inner, scale, gap, target, charts } = o;
  const scratch = document.createElement('canvas').getContext('2d')!;
  let total = PAD;
  blocks.forEach((b, i) => {
    total += gapBefore(b, blocks[i - 1], gap) + heightOf(scratch, b, inner, charts);
  });
  total += (o.of > 1 ? 18 : 0) + PAD;
  // Every page the same height, so a run of them sits evenly in a document.
  if (target.pageInches) total = Math.max(total, (target.pageInches * width) / target.inches);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(total * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = C.white;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);

  let y = PAD;
  blocks.forEach((b, i) => {
    y += gapBefore(b, blocks[i - 1], gap);
    y += draw(ctx, b, PAD, y, inner, charts);
  });
  if (o.of > 1) {
    ctx.fillStyle = C.subtle;
    ctx.font = `9.5px ${MONO}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(`${o.page} of ${o.of}`, PAD + inner, total - PAD + 4);
    ctx.textAlign = 'left';
  }

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  // Without this Word has no idea how big the picture is and assumes 96 dpi.
  return withDpi(new Uint8Array(await blob.arrayBuffer()), (width * scale) / target.inches);
}

/**
 * Getting things out of the application: a curve as CSV, a chart as a PNG, and the
 * plumbing to hand either to the user.
 *
 * The workbook lives in `workbookExport.ts` and is loaded on demand — it is the one
 * thing here that needs the spreadsheet library.
 */
import type { CurvePoint } from '../engine/types';
import { fmtHours } from './format';

export function curveCsv(curve: CurvePoint[]): string {
  const lines = ['Period_End,Planned_Cum_Hours,Forecast_Cum_Hours,Earned_Cum_Hours,Planned_Pct,Earned_Pct'];
  for (const c of curve) {
    lines.push([c.periodEnd, c.planned.toFixed(2), c.forecast.toFixed(2), c.earned === null ? '' : c.earned.toFixed(2), c.plannedPct.toFixed(4), c.earnedPct === null ? '' : c.earnedPct.toFixed(4)].join(','));
  }
  return lines.join('\r\n') + '\r\n';
}

export type ChartPngOptions = {
  title?: string;
  subtitle?: string;
  scale?: number;
};

const SANS = 'system-ui, Segoe UI, Arial, sans-serif';

/** A legend entry as it is drawn on screen, measured against the chart box. */
type LegendItem = { text: string; color: string; x: number; y: number };

/**
 * Read the legend Recharts drew. It is HTML sitting over the chart, not part of the
 * SVG, which is why a plain serialisation of the SVG loses it: the exported picture
 * comes out as unlabelled lines. The positions are measured from the live DOM and
 * redrawn on the canvas, so the PNG matches what is on screen.
 */
function readLegend(container: Element, box: DOMRect): LegendItem[] {
  const out: LegendItem[] = [];
  for (const el of container.querySelectorAll('.recharts-legend-item')) {
    const label = el.querySelector('.recharts-legend-item-text');
    const text = (label?.textContent ?? el.textContent ?? '').trim();
    if (!text) continue;
    const mark = el.querySelector('path, rect, line, circle');
    const color =
      (label instanceof HTMLElement && label.style.color) ||
      mark?.getAttribute('fill') ||
      mark?.getAttribute('stroke') ||
      '#6e7179';
    const r = el.getBoundingClientRect();
    out.push({ text, color: color === 'none' ? (mark?.getAttribute('stroke') ?? '#6e7179') : color, x: r.left - box.left, y: r.top - box.top + r.height / 2 });
  }
  return out;
}

/**
 * The chart's own SVG, not one of the legend's 14 pixel swatches. Recharts puts the
 * legend wrapper ahead of the plot in the DOM, so taking the first SVG in the container
 * exported a single legend icon — a stray line in a tiny picture. The biggest one is
 * the plot, whatever order they come in.
 */
function chartSurface(container: HTMLElement): SVGSVGElement | null {
  const named = container.querySelector<SVGSVGElement>('svg.recharts-surface');
  let best: SVGSVGElement | null = null;
  let area = 0;
  for (const svg of container.querySelectorAll<SVGSVGElement>('svg')) {
    const r = svg.getBoundingClientRect();
    if (r.width * r.height > area) {
      area = r.width * r.height;
      best = svg;
    }
  }
  // A legend swatch is tiny; prefer the biggest SVG and fall back to the named one.
  return best ?? named;
}

/**
 * A chart as it will be drawn: the live element, and what to write over it.
 */
export type ChartSource = { chart: SVGSVGElement | HTMLElement; title?: string; subtitle?: string };

/** One chart, measured and loaded, ready to be drawn onto a canvas. */
export type Prepared = { img: HTMLImageElement; url: string; w: number; h: number; legend: LegendItem[]; title?: string; subtitle?: string };

/**
 * Detach a chart, give it a real size, and load it as an image.
 *
 * Recharts sizes its SVG with `style="width:100%;height:100%"`, which means nothing
 * once the SVG is detached and loaded as an image: with no containing block and no
 * intrinsic size the browser falls back to a default box and the chart comes out as a
 * squashed line. The clone is given explicit width, height and viewBox instead, and
 * the webfonts are swapped for system fonts because an SVG loaded as an image cannot
 * fetch them.
 */
export async function prepareChart(source: ChartSource): Promise<Prepared> {
  const { chart } = source;
  const svg = chart instanceof SVGSVGElement ? chart : chartSurface(chart);
  if (!svg) throw new Error('No chart to export');
  const box = svg.getBoundingClientRect();
  const w = Math.round(box.width || Number(svg.getAttribute('width')) || 900);
  const h = Math.round(box.height || Number(svg.getAttribute('height')) || 400);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${w} ${h}`);
  clone.style.removeProperty('width');
  clone.style.removeProperty('height');
  clone.style.fontFamily = SANS;
  // IBM Plex Mono is a webfont this document cannot load, and a missing family makes
  // the tick labels fall back at a different width from the ones on screen.
  for (const el of clone.querySelectorAll<SVGElement>('[style*="font-family"], [font-family]')) {
    el.removeAttribute('font-family');
    if (el.style.fontFamily) el.style.fontFamily = /mono/i.test(el.style.fontFamily) ? 'ui-monospace, Consolas, monospace' : SANS;
  }

  const legend = chart instanceof SVGSVGElement ? [] : readLegend(chart, box);
  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not render the chart image'));
      i.src = url;
    });
    return { img, url, w, h, legend, title: source.title, subtitle: source.subtitle };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

const PAD = 18;
const TITLE_H = 24;
const SUB_H = 17;

/** Draw one prepared chart at `y`, and return the height it took. */
function drawChart(ctx: CanvasRenderingContext2D, p: Prepared, x: number, y: number): number {
  let top = y;
  if (p.title) {
    ctx.fillStyle = '#1a1a1a';
    ctx.font = `600 15px ${SANS}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.title, x, top + 14);
    top += TITLE_H;
  }
  if (p.subtitle) {
    ctx.fillStyle = '#6e7179';
    ctx.font = `11.5px ${SANS}`;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(p.subtitle, x, top + 11);
    top += SUB_H;
  }
  ctx.drawImage(p.img, x, top, p.w, p.h);
  for (const l of p.legend) {
    ctx.fillStyle = l.color;
    ctx.beginPath();
    ctx.arc(x + l.x + 4, top + l.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4a4d55';
    ctx.font = `11.5px ${SANS}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(l.text, x + l.x + 13, top + l.y + 0.5);
  }
  return top + p.h - y;
}

async function encode(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed');
  return new Uint8Array(await blob.arrayBuffer());
}

/** Rasterise one chart to PNG bytes. */
export async function svgToPng(chart: SVGSVGElement | HTMLElement, opts: ChartPngOptions = {}): Promise<Uint8Array> {
  return chartsToPng([{ chart, title: opts.title, subtitle: opts.subtitle }], { scale: opts.scale });
}

/**
 * Several charts stacked into one PNG, under a heading.
 *
 * This is what a report is handed over as. Stacking them here rather than
 * rasterising the whole page means the picture is made of the same chart SVGs the
 * screen draws, at their real size — no screenshot of a scrolled viewport, and no
 * dependency on a DOM-to-canvas library that would have to be kept honest about
 * every style rule in the application.
 */
export async function chartsToPng(
  sources: ChartSource[],
  opts: { heading?: string; sub?: string; footer?: string; scale?: number; gap?: number } = {},
): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error('No charts to export');
  const scale = opts.scale ?? 2;
  const gap = opts.gap ?? 22;
  const prepared: Prepared[] = [];
  try {
    for (const s of sources) prepared.push(await prepareChart(s));

    const headH = (opts.heading ? 26 : 0) + (opts.sub ? 18 : 0);
    const footH = opts.footer ? 20 : 0;
    const width = Math.max(...prepared.map((p) => p.w));
    const bodyH = prepared.reduce((sum, p) => sum + (p.title ? TITLE_H : 0) + (p.subtitle ? SUB_H : 0) + p.h, 0) + gap * (prepared.length - 1);

    const canvas = document.createElement('canvas');
    canvas.width = Math.round((width + PAD * 2) * scale);
    canvas.height = Math.round((PAD + headH + bodyH + footH + PAD) * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    let y = PAD;
    if (opts.heading) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `700 17px ${SANS}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.heading, PAD, y + 16);
      y += 26;
    }
    if (opts.sub) {
      ctx.fillStyle = '#6e7179';
      ctx.font = `12px ${SANS}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.sub, PAD, y + 12);
      y += 18;
    }
    for (let i = 0; i < prepared.length; i++) {
      y += drawChart(ctx, prepared[i], PAD, y);
      if (i < prepared.length - 1) y += gap;
    }
    if (opts.footer) {
      ctx.fillStyle = '#9aa0ab';
      ctx.font = `10.5px ${SANS}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.footer, PAD, y + 14);
    }
    return await encode(canvas);
  } finally {
    for (const p of prepared) URL.revokeObjectURL(p.url);
  }
}

/*
 * Why there is no "clone the DOM into an SVG and rasterise it" function here.
 *
 * That is the usual trick — `<foreignObject>` holding the real markup, with the
 * stylesheets inlined — and it was written, and it does not work. Chromium taints
 * the canvas for ANY SVG image carrying a foreignObject, whatever it contains and
 * wherever it came from, so the picture draws correctly and then cannot be read
 * back out. Every library built on that trick hits the same wall.
 *
 * So the report is painted instead: see `reportPaint.ts`, which draws it from the
 * same column definitions the tables on screen are built from.
 */

export function downloadBytes(name: string, bytes: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function stamp(): string {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

export const hoursLabel = (n: number) => fmtHours(n);

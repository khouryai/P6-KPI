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
 * Rasterise a chart to PNG bytes.
 *
 * Recharts sizes its SVG with `style="width:100%;height:100%"`, which means nothing
 * once the SVG is detached and loaded as an image: with no containing block and no
 * intrinsic size the browser falls back to a default box and the chart comes out as a
 * squashed line. The clone is given explicit width, height and viewBox instead, and
 * the webfonts are swapped for system fonts because an SVG loaded as an image cannot
 * fetch them.
 */
export async function svgToPng(chart: SVGSVGElement | HTMLElement, opts: ChartPngOptions = {}): Promise<Uint8Array> {
  const scale = opts.scale ?? 2;
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
  const pad = 16;
  const titleH = opts.title ? 24 : 0;
  const subH = opts.subtitle ? 17 : 0;
  const top = pad + titleH + subH;

  const xml = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not render the chart image'));
      i.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round((w + pad * 2) * scale);
    canvas.height = Math.round((top + h + pad) * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);

    if (opts.title) {
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `600 15px ${SANS}`;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(opts.title, pad, pad + 14);
    }
    if (opts.subtitle) {
      ctx.fillStyle = '#6e7179';
      ctx.font = `11.5px ${SANS}`;
      ctx.fillText(opts.subtitle, pad, pad + titleH + 11);
    }

    ctx.drawImage(img, pad, top, w, h);

    for (const l of legend) {
      const x = pad + l.x;
      const y = top + l.y;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(x + 4, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a4d55';
      ctx.font = `11.5px ${SANS}`;
      ctx.textBaseline = 'middle';
      ctx.fillText(l.text, x + 13, y + 0.5);
    }

    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG encoding failed');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

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

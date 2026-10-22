/**
 * The S-curve picture: one curve per phase asked for, stacked top to bottom in one
 * PNG, each with its DATA DATE and TODAY lines and the percent complete against the
 * percent expected written above it.
 *
 * It is drawn from the same chart component the Dashboard shows, rendered off
 * screen at a fixed size, so the picture and the screen cannot drift apart. The
 * fixed size matters: a responsive chart waits on the browser to lay the page out,
 * and a scheduled export can fire while the window is minimised.
 */
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { Model, Settings } from '../engine/types';
import { CurveChart } from './components/CurveChart';
import { chartsToPng, withDpi } from './export';
import { fmtDate, fmtHours } from './format';
import { panelSummary, panelTitle, scurvePanels } from './scurve';

const WIDTH = 1060;
const HEIGHT = 380;
const SCALE = 2;

const localISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Wait until every chart has drawn its lines, or give up and say so. */
async function drawn(host: HTMLElement, count: number, ms = 10_000): Promise<HTMLElement[]> {
  const until = Date.now() + ms;
  for (;;) {
    const boxes = [...host.querySelectorAll<HTMLElement>('[data-scurve]')];
    if (boxes.length === count && boxes.every((b) => b.querySelector('.recharts-line-curve'))) return boxes;
    if (Date.now() > until) throw new Error('The S-curve did not finish drawing.');
    await new Promise((r) => setTimeout(r, 40));
  }
}

export async function renderSCurvePng(model: Model, settings: Settings, opts: { phases: string[]; unit: 'percent' | 'hours'; when: Date }): Promise<Uint8Array> {
  const today = localISO(opts.when);
  const panels = scurvePanels(model, settings, opts.phases, today);
  if (panels.length === 0) {
    throw new Error(opts.phases.length ? 'None of the curves chosen has dated work in the budget.' : 'No curves are chosen for the S-curve export.');
  }
  const dataDate = settings.dataDate || null;
  const percent = opts.unit === 'percent';
  const monthly = (settings.curveCadence ?? 'month') === 'month';

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-${WIDTH * 4}px;top:0;width:${WIDTH}px;pointer-events:none;`;
  document.body.appendChild(host);
  const root = createRoot(host);
  try {
    flushSync(() =>
      root.render(
        <div>
          {panels.map((p) => (
            <div key={p.key} data-scurve={p.key} style={{ width: WIDTH, background: '#fff' }}>
              <CurveChart curve={p.curve} dataDate={dataDate} today={today} percent={percent} total={p.budgetHours} monthly={monthly} width={WIDTH} height={HEIGHT} />
            </div>
          ))}
        </div>,
      ),
    );
    const boxes = await drawn(host, panels.length);
    const summary = { dataDateLabel: fmtDate(dataDate), todayLabel: fmtDate(today), hours: !percent, fmtHours: (n: number) => fmtHours(n) };
    const png = await chartsToPng(
      panels.map((p, i) => ({ chart: boxes[i], title: panelTitle(p), subtitle: panelSummary(p, summary) })),
      {
        heading: `S-curve${panels.length > 1 ? 's' : ''} — ${percent ? 'percent complete' : 'man hours'}: planned, forecast and earned`,
        sub: `Data date ${fmtDate(dataDate) || 'not set'}  ·  Today ${fmtDate(today)}  ·  Expected is the baseline plan; earned is on actual dates`,
        footer: `T&C P6 Budget and S-Curve  ·  exported ${opts.when.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
        scale: SCALE,
        gap: 28,
      },
    );
    // Stamped with the density it was drawn at, so Word places it at its real size.
    return withDpi(png, 96 * SCALE);
  } finally {
    root.unmount();
    host.remove();
  }
}

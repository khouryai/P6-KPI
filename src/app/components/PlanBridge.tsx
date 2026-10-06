/**
 * From planned to achieved: the plan, what constraints held back, the workable plan
 * that leaves, and what was achieved.
 *
 * The Two-Week Log and the Status Report both draw this, and both paint it into the
 * PNG, so the steps are worked out once here and each surface only lays them out.
 * Every step carries its own words and its own figure — the colour is there to tie a
 * step to its legend, never to be the only thing saying what the step is.
 */
import type { PeriodBridge } from '../../engine/period';
import type { PaintBlock } from '../reportPaint';

/*
 * Checked as a set for colour-vision separation, not picked by eye. Planned and
 * achieved are the violet and green the rest of the app uses for the same ideas,
 * and amber is kept for the current schedule because the S-curve already draws
 * the current schedule in amber.
 */
export const BRIDGE_COLOURS = {
  planned: '#6d28d9',
  current: '#d97706',
  constraint: '#1d4eaf',
  achieved: '#00875a',
};

export type BridgeStep = {
  key: string;
  label: string;
  /** What the step means, for the tooltip and the text copy. */
  hint: string;
  /** A total is drawn from zero; a step floats between the running totals either side of it. */
  kind: 'total' | 'down' | 'up';
  hours: number;
  /** Where the bar sits, in hours from zero. */
  from: number;
  to: number;
  colour: string;
  /** How many activities make up the step, where that means anything. */
  activities?: number;
};

/**
 * The four steps, always in this order: planned, what constraints held back, the
 * workable plan that leaves, and what was achieved. Only the constraint step floats;
 * the other three are totals drawn from zero, so achieved reads straight against
 * both the plan and the workable plan. The rest of the gap (team reasons, pace, no
 * reason yet) is not drawn here — the reasons list beside it carries that.
 *
 * All four show even when nothing is held by a constraint, so the page keeps one
 * shape from one fortnight to the next and a zero reads as "nothing tagged".
 */
export function bridgeSteps(b: PeriodBridge): BridgeStep[] {
  const held = b.shortfall.CONSTRAINT;
  return [
    {
      key: 'planned',
      label: 'Planned (baseline)',
      hint: 'Everything the baseline expected to get done in this window. Nothing is taken out of it.',
      kind: 'total',
      hours: b.planned,
      from: 0,
      to: b.planned,
      colour: BRIDGE_COLOURS.planned,
    },
    {
      key: 'constraint',
      label: 'Held by constraints',
      hint: 'Planned hours on missed or not-started activities whose reason is outside the team’s control — a predecessor not done, no access, documentation not issued. They stay in the plan; this is why they were not workable.',
      kind: 'down',
      hours: held,
      from: b.planned - held,
      to: b.planned,
      colour: BRIDGE_COLOURS.constraint,
      activities: b.activitiesBy.CONSTRAINT,
    },
    {
      key: 'workable',
      label: 'Workable plan',
      hint: 'The plan the team could actually work this window: planned, less what constraints outside its control held back.',
      kind: 'total',
      hours: b.workablePlanned,
      from: 0,
      to: b.workablePlanned,
      colour: BRIDGE_COLOURS.planned,
    },
    {
      key: 'achieved',
      label: 'Achieved',
      hint: 'What was actually earned in this window.',
      kind: 'total',
      hours: b.earned,
      from: 0,
      to: b.earned,
      colour: BRIDGE_COLOURS.achieved,
    },
  ];
}

const signed = (s: BridgeStep, v: string) => (s.hours <= 1e-9 ? v : s.kind === 'down' ? `−${v}` : s.kind === 'up' ? `+${v}` : v);

/** The widest the running total gets, which every bar is drawn against. */
function peak(steps: BridgeStep[]): number {
  return Math.max(1e-9, ...steps.map((s) => s.to));
}

export function PlanBridge({ bridge, val }: { bridge: PeriodBridge; val: (hours: number, digits?: number) => string }) {
  const steps = bridgeSteps(bridge);
  const max = peak(steps);
  if (bridge.planned <= 1e-9 && bridge.earned <= 1e-9) return null;
  return (
    <div className="bridge" role="table" aria-label="From planned to achieved">
      {steps.map((s) => (
        <div key={s.key} className={`bridge-row${s.kind === 'total' ? ' is-total' : ''}`} role="row" title={s.hint}>
          <span className="bridge-key" role="cell">
            <i style={{ background: s.colour }} />
            <span>
              {s.label}
              {s.activities ? <span className="bridge-n"> · {s.activities}</span> : null}
            </span>
          </span>
          <div className="bridge-track" role="cell">
            <span
              style={{
                left: `${(s.from / max) * 100}%`,
                width: `${s.to - s.from <= 1e-9 ? 0 : Math.max(0.6, ((s.to - s.from) / max) * 100)}%`,
                background: s.colour,
              }}
            />
          </div>
          <span className={`bridge-val${s.kind === 'down' ? ' is-down' : s.kind === 'up' ? ' is-up' : ''}`} role="cell">
            {signed(s, val(s.hours))}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The same steps, for the PNG. */
export function bridgePaint(bridge: PeriodBridge, val: (hours: number, digits?: number) => string): PaintBlock {
  const steps = bridgeSteps(bridge);
  const max = peak(steps);
  return {
    kind: 'bars',
    labelWidth: 190,
    rows: steps.map((s) => ({
      label: s.activities ? `${s.label} · ${s.activities}` : s.label,
      value: signed(s, val(s.hours)),
      start: s.from / max,
      pct: (s.to - s.from) / max,
      color: s.colour,
    })),
  };
}

/** The steps as lines of text, for the copy-as-text report. */
export function bridgeText(bridge: PeriodBridge, val: (hours: number, digits?: number) => string): string[] {
  return bridgeSteps(bridge).map((s) => `  ${s.label.padEnd(26)} ${signed(s, val(s.hours)).padStart(12)}${s.activities ? `  (${s.activities})` : ''}`);
}

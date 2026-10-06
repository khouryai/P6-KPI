/**
 * From planned to achieved, step by step: the fortnight's shortfall split by why.
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
 * the current schedule in amber. "No reason given yet" is a hatched grey on
 * purpose: it is a gap in the review, and should look unfinished.
 */
export const BRIDGE_COLOURS = {
  planned: '#6d28d9',
  current: '#d97706',
  constraint: '#1d4eaf',
  team: '#c01017',
  pace: '#e0777c',
  unexplained: '#74777f',
  earlier: '#b6bac2',
  ahead: '#5fb894',
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
  hatched?: boolean;
  /** How many activities make up the step, where that means anything. */
  activities?: number;
};

/** The steps, in reading order, leaving out any that carry no hours. Totals always show. */
export function bridgeSteps(b: PeriodBridge): BridgeStep[] {
  const out: BridgeStep[] = [];
  let run = b.planned;
  out.push({
    key: 'planned',
    label: 'Planned (baseline)',
    hint: 'Everything the baseline expected to get done in this window. Nothing is taken out of it — the steps below explain it.',
    kind: 'total',
    hours: b.planned,
    from: 0,
    to: b.planned,
    colour: BRIDGE_COLOURS.planned,
  });
  const down = (key: string, label: string, hint: string, hours: number, colour: string, activities: number, hatched = false) => {
    if (hours <= 1e-9) return;
    out.push({ key, label, hint, kind: 'down', hours, from: run - hours, to: run, colour, activities, hatched });
    run -= hours;
  };
  down(
    'constraint',
    'Held by constraints',
    'Planned hours on activities whose reason is outside the team’s control — a predecessor not done, no access, documentation not issued. They stay in the plan; this is why they were not workable.',
    b.shortfall.CONSTRAINT,
    BRIDGE_COLOURS.constraint,
    b.activitiesBy.CONSTRAINT,
  );
  if (b.shortfall.CONSTRAINT > 1e-9) {
    out.push({
      key: 'workable',
      label: 'Workable plan',
      hint: 'The plan the team could actually work this window: planned, less what constraints outside its control held back.',
      kind: 'total',
      hours: b.workablePlanned,
      from: 0,
      to: b.workablePlanned,
      colour: BRIDGE_COLOURS.planned,
    });
  }
  down('team', 'Team-side reasons', 'Planned hours lost to a reason that is the team’s own — resource, a failed test.', b.shortfall.TEAM, BRIDGE_COLOURS.team, b.activitiesBy.TEAM);
  down(
    'pace',
    'Running behind plan',
    'Activities under way, earning slower than the baseline spread. They have started, so they are not waiting on anything and take no reason.',
    b.shortfall.PACE,
    BRIDGE_COLOURS.pace,
    b.activitiesBy.PACE,
  );
  down(
    'unexplained',
    'No reason given yet',
    'Missed or not started, and nobody has said why. Answer Why behind on these rows and the hours move to the step their reason belongs to.',
    b.shortfall.UNEXPLAINED,
    BRIDGE_COLOURS.unexplained,
    b.activitiesBy.UNEXPLAINED,
    true,
  );
  down(
    'earlier',
    'Done in an earlier window',
    'Finished ahead of the baseline, so the hours the plan put here were earned before this window began. Not a shortfall of work, only of timing.',
    b.shortfall.EARLIER,
    BRIDGE_COLOURS.earlier,
    b.activitiesBy.EARLIER,
  );
  if (b.ahead > 1e-9) {
    out.push({
      key: 'ahead',
      label: 'Ahead of plan',
      hint: 'Hours earned beyond what each activity was planned to do here: work ahead of its dates, or not in this window’s plan at all.',
      kind: 'up',
      hours: b.ahead,
      from: run,
      to: run + b.ahead,
      colour: BRIDGE_COLOURS.ahead,
    });
    run += b.ahead;
  }
  out.push({
    key: 'achieved',
    label: 'Achieved',
    hint: 'What was actually earned in this window.',
    kind: 'total',
    hours: b.earned,
    from: 0,
    to: b.earned,
    colour: BRIDGE_COLOURS.achieved,
  });
  return out;
}

const signed = (s: BridgeStep, v: string) => (s.kind === 'down' ? `−${v}` : s.kind === 'up' ? `+${v}` : v);

/** The widest the running total gets, which every bar is drawn against. */
function peak(steps: BridgeStep[]): number {
  return Math.max(1e-9, ...steps.map((s) => s.to));
}

const HATCH = 'repeating-linear-gradient(135deg, rgba(255,255,255,0.55) 0 3px, transparent 3px 7px)';

export function PlanBridge({ bridge, val }: { bridge: PeriodBridge; val: (hours: number, digits?: number) => string }) {
  const steps = bridgeSteps(bridge);
  const max = peak(steps);
  if (bridge.planned <= 1e-9 && bridge.earned <= 1e-9) return null;
  return (
    <div className="bridge" role="table" aria-label="From planned to achieved">
      {steps.map((s) => (
        <div key={s.key} className={`bridge-row${s.kind === 'total' ? ' is-total' : ''}`} role="row" title={s.hint}>
          <span className="bridge-key" role="cell">
            <i style={{ background: s.colour, backgroundImage: s.hatched ? HATCH : undefined }} />
            <span>
              {s.label}
              {s.activities ? <span className="bridge-n"> · {s.activities}</span> : null}
            </span>
          </span>
          <div className="bridge-track" role="cell">
            <span
              style={{
                left: `${(s.from / max) * 100}%`,
                width: `${Math.max(0.6, ((s.to - s.from) / max) * 100)}%`,
                background: s.colour,
                backgroundImage: s.hatched ? HATCH : undefined,
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
      hatch: s.hatched,
    })),
  };
}

/** The steps as lines of text, for the copy-as-text report. */
export function bridgeText(bridge: PeriodBridge, val: (hours: number, digits?: number) => string): string[] {
  return bridgeSteps(bridge).map((s) => `  ${s.label.padEnd(26)} ${signed(s, val(s.hours)).padStart(12)}${s.activities ? `  (${s.activities})` : ''}`);
}

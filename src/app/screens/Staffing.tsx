import { useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ComposedChart, Bar } from 'recharts';
import { useApp } from '../state';
import { Page, Panel, Notice, SortableTable, CellInput, Badge, type Column, type HeroStat } from '../components/ui';
import { DEFAULT_CAPACITY } from '../../engine/capacity';
import {
  FULL_SCOPE,
  applyTaskEdits,
  type TaskEdit,
  peopleOn,
  phaseLines,
  plannedByPhase,
  type PhaseLine,
  groupByType,
  outOfScope,
  targetDate,
  peopleNeeded,
  plannedRemaining,
  simulate,
  staffingTasks,
  weeklyHours,
  type ScenarioResult,
  type StaffChange,
  type StaffScenario,
  type StaffingOptions,
  type StaffingScope,
  type StaffingTask,
  type TaskForecast,
  type TypeGroup,
} from '../../engine/staffing';
import { addDaysISO, isValidISO } from '../../engine/dates';
import { normKey } from '../../engine/keys';
import { fmtDate, fmtHours } from '../format';
import { href } from '../router';
import { TERMS } from '../../engine/vocab';

/**
 * Staffing scenarios: what date the work finishes on, with this many people.
 *
 * Everything keyed here is a what-if, so it lives in this browser only. Writing it
 * to the shared folder would make one person's "what if we lost half of IXL" read
 * as the plan on everybody else's machine. The Capacity screen keeps the real
 * headcount; nothing here touches it.
 */

const KEY = 'tc-staffing';
const MAX_SCENARIOS = 4;
/** Validated as a categorical set (CVD-safe on the light surface); fixed order, never cycled. */
const SERIES = ['#0b6bcb', '#d97706', '#6d28d9', '#00875a'];
/** Phases are their own categorical set, fixed order, never cycled: a ninth folds into Other. */
const PHASE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
const OTHER = '#9a9da4';
const INK = '#1a1a1a';
const GRID = '#e4e7ec';
const AXIS = '#6e7179';

type Saved = {
  group: string;
  efficiency: number;
  /** null follows the Capacity screen's settings. */
  hoursPerPersonPerMonth: number | null;
  utilisation: number | null;
  scenarios: StaffScenario[];
  selected: string;
  /** Changes to single activities, for the simulation only. Keyed on the lower-cased Activity ID. */
  edits: Record<string, TaskEdit>;
  scope: StaffingScope;
};

/** Own activities only, until somebody asks for the support too. */
const DEFAULT_SCOPE: StaffingScope = { ...FULL_SCOPE, includeSupport: false };

const uid = (p: string) => `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

function monthsAfter(iso: string, n: number): string {
  const [y, m] = iso.split('-').map(Number);
  const t = (m - 1 + n) % 12;
  const yy = y + Math.floor((m - 1 + n) / 12);
  return `${yy}-${String(t + 1).padStart(2, '0')}-01`;
}

function defaults(group: string, dataDate: string): Saved {
  const later = monthsAfter(dataDate || new Date().toISOString().slice(0, 10), 3);
  return {
    group,
    efficiency: 1,
    hoursPerPersonPerMonth: null,
    utilisation: null,
    scenarios: [
      { id: 'current', name: 'Current team', people: 8, changes: [] },
      { id: 'reduced', name: 'Reduced', people: 4, changes: [] },
      { id: 'reduced-support', name: 'Reduced + later support', people: 4, changes: [{ id: 'c1', from: later, delta: 2, note: 'Additional support' }] },
    ],
    selected: 'current',
    scope: DEFAULT_SCOPE,
    edits: {},
  };
}

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Saved;
    // Saved before the scope existed: everything else stands, the scope starts fresh.
    if (!Array.isArray(v.scenarios)) return null;
    // A scope saved when only one phase could be picked carries `phase`.
    const old = (v.scope ?? {}) as Partial<StaffingScope> & { phase?: string };
    const phases = Array.isArray(old.phases) ? old.phases : old.phase ? [old.phase] : [];
    const { phase: _gone, ...rest } = old;
    return { ...v, edits: v.edits ?? {}, scope: { ...DEFAULT_SCOPE, ...rest, phases } };
  } catch {
    return null;
  }
}

function write(v: Saved) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* private window: the scenarios still work, they just will not be remembered */
  }
}

const weeks = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / (7 * 86_400_000) * 10) / 10;

/** Late is bad, early or on time is good. Days, shown as weeks once it is more than a fortnight. */
function Slip({ days }: { days: number | null }) {
  if (days === null) return <span className="text-[var(--text-subtle)]">—</span>;
  const txt = Math.abs(days) > 14 ? `${(Math.abs(days) / 7).toFixed(1)} wk` : `${Math.abs(days)} d`;
  if (days > 0) return <span className="font-semibold tabular-nums tone-bad">{txt} late</span>;
  if (days < 0) return <span className="font-semibold tabular-nums tone-good">{txt} early</span>;
  return <span className="font-semibold tone-good">on time</span>;
}

type TipItem = { name?: string; value?: unknown; color?: string; dataKey?: string; payload?: { date?: string } };

function ChartTip({ active, payload }: { active?: boolean; payload?: TipItem[] }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#fff', border: `1px solid ${GRID}`, borderRadius: 8, padding: '9px 12px', fontSize: 12, boxShadow: '0 6px 16px -8px rgba(15,17,21,0.14)' }}>
      <div style={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: 9.5, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#697280', marginBottom: 5 }}>
        Week ending {fmtDate(payload[0].payload?.date)}
      </div>
      {payload
        .filter((p) => typeof p.value === 'number')
        .map((p) => (
          <div key={String(p.dataKey)} style={{ display: 'flex', alignItems: 'baseline', gap: 8, lineHeight: 1.6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 999, background: p.color, display: 'inline-block' }} />
            <span style={{ color: AXIS }}>{p.name}</span>
            <span style={{ marginLeft: 'auto', fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(p.value as number)} h</span>
          </div>
        ))}
    </div>
  );
}

export function Staffing() {
  const { state, model } = useApp();
  const dataDate = isValidISO(state.data.settings.dataDate) ? state.data.settings.dataDate : null;
  const capacity = state.data.settings.capacity ?? DEFAULT_CAPACITY;

  // Groups that still have work, biggest first, so the picker leads with what matters.
  const groups = useMemo(() => {
    const left = new Map<string, number>();
    for (const r of model.rows) {
      if (r.status !== 'IN BUDGET') continue;
      for (const [code, h] of Object.entries(r.subsystemHours)) {
        if (!code) continue;
        left.set(code, (left.get(code) ?? 0) + h - (r.subsystemEarned[code] ?? 0));
      }
    }
    return [...left.entries()].filter(([, h]) => h > 0.5).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [model.rows]);

  const [saved, setSaved] = useState<Saved>(() => {
    const prior = read();
    if (prior) return prior;
    const ixl = groups.find((g) => normKey(g) === 'ixl') ?? groups[0] ?? 'IXL';
    return defaults(ixl, dataDate ?? '');
  });
  useEffect(() => write(saved), [saved]);
  const patch = (p: Partial<Saved>) => setSaved((s) => ({ ...s, ...p }));
  const setScope = (p: Partial<StaffingScope>) => setSaved((s) => ({ ...s, scope: { ...s.scope, ...p } }));
  const scope = saved.scope;
  const [openType, setOpenType] = useState<string | null>(null);
  const editScenario = (id: string, p: Partial<StaffScenario>) =>
    setSaved((s) => ({ ...s, scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, ...p } : x)) }));
  const editChange = (sid: string, cid: string, p: Partial<StaffChange>) =>
    setSaved((s) => ({
      ...s,
      scenarios: s.scenarios.map((x) => (x.id === sid ? { ...x, changes: x.changes.map((c) => (c.id === cid ? { ...c, ...p } : c)) } : x)),
    }));

  const hpm = saved.hoursPerPersonPerMonth ?? capacity.hoursPerPersonPerMonth;
  const util = saved.utilisation ?? capacity.utilisation;
  const achieved = model.burn.bySubsystem.find((r) => normKey(r.code) === normKey(saved.group))?.factor ?? null;

  const opts: StaffingOptions | null = dataDate
    ? {
        group: saved.group,
        dataDate,
        efficiency: saved.efficiency > 0 ? saved.efficiency : 1,
        hoursPerPersonPerMonth: hpm,
        utilisation: util,
        finishBy: scope.finishBy && isValidISO(scope.finishBy) ? scope.finishBy : null,
      }
    : null;

  // Everything the group has left, then the part of it the scope keeps.
  // The tasks as the schedule has them, then with this simulation's own edits on top.
  const baseTasks = useMemo(() => (opts ? staffingTasks(model.rows, opts) : []), [model.rows, opts?.group, opts?.dataDate, opts?.efficiency]); // eslint-disable-line react-hooks/exhaustive-deps
  const allTasks = useMemo(() => (opts ? applyTaskEdits(baseTasks, saved.edits, opts) : baseTasks), [baseTasks, saved.edits]); // eslint-disable-line react-hooks/exhaustive-deps
  const original = useMemo(() => new Map(baseTasks.map((t) => [normKey(t.activityId), t])), [baseTasks]);
  const editCount = allTasks.filter((t) => t.simEdited).length;
  /** Set or clear one field of one activity's simulation edit; an edit with nothing left in it goes. */
  const editTask = (activityId: string, patch: Partial<TaskEdit>) =>
    setSaved((sv) => {
      const k = normKey(activityId);
      const next: TaskEdit = { ...(sv.edits[k] ?? {}), ...patch };
      for (const f of Object.keys(next) as (keyof TaskEdit)[]) if (next[f] === undefined || next[f] === false) delete next[f];
      const edits = { ...sv.edits };
      if (Object.keys(next).length) edits[k] = next;
      else delete edits[k];
      return { ...sv, edits };
    });
  const tasks = useMemo(() => allTasks.filter((t) => !outOfScope(t, scope)), [allTasks, scope]);
  const leftOut = useMemo(() => {
    const by = new Map<string, { n: number; h: number }>();
    for (const t of allTasks) {
      const why = outOfScope(t, scope);
      if (!why) continue;
      const c = by.get(why) ?? { n: 0, h: 0 };
      c.n += 1;
      c.h += t.effortHours;
      by.set(why, c);
    }
    return by;
  }, [allTasks, scope]);
  // The type list shows every type the other filters keep, ticked or not, so a type
  // taken out can be put back.
  const typeGroups = useMemo(
    // Removed activities stay listed under their type, so they can be put back.
    () => groupByType(allTasks.filter((t) => !outOfScope({ ...t, removed: false }, { ...scope, excludedTypes: [] }))),
    [allTasks, scope],
  );
  const support = allTasks.filter((t) => t.role === 'support');
  const options = useMemo(() => {
    const uniq = (f: (t: StaffingTask) => string) => [...new Set(allTasks.map(f).filter(Boolean))].sort();
    const phaseNames = new Map(allTasks.map((t) => [t.phase, t.phaseName]));
    return { phases: uniq((t) => t.phase).map((p) => [p, phaseNames.get(p) ?? p] as const), workTypes: uniq((t) => t.workType), locations: uniq((t) => t.location) };
  }, [allTasks]);
  const results: ScenarioResult[] = useMemo(
    () => (opts ? saved.scenarios.map((s) => simulate(tasks, s, opts)) : []),
    [tasks, saved.scenarios, hpm, util, opts?.finishBy], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const plannedFinish = targetDate(tasks, opts ?? {});
  const needed = useMemo(
    () => (opts ? peopleNeeded(tasks, opts, plannedFinish) : null),
    [tasks, plannedFinish, hpm, util], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const backlog = tasks.filter((t) => t.backlog);
  const backlogHours = backlog.reduce((s, t) => s + t.effortHours, 0);
  const totalHours = tasks.reduce((s, t) => s + t.effortHours, 0);
  const { net, gross } = weeklyHours({ hoursPerPersonPerMonth: hpm, utilisation: util });

  // One row per week across the longest scenario, each scenario a column.
  const chart = useMemo(() => {
    if (!dataDate) return [];
    const last = results.reduce((m, r) => {
      const d = r.series[r.series.length - 1]?.date ?? dataDate;
      return d > m ? d : m;
    }, plannedFinish && plannedFinish > dataDate ? plannedFinish : dataDate);
    const dates: string[] = [];
    for (let d = dataDate; d <= addDaysISO(last, 6); d = addDaysISO(d, 7)) dates.push(d);
    const plan = plannedRemaining(tasks, dates, dataDate);
    return dates.map((date, i) => {
      const row: Record<string, number | string | null> = { date, plan: plan[i].remaining };
      results.forEach((r) => {
        const p = r.series[i];
        row[r.scenario.id] = p ? p.remaining : r.finish ? 0 : null;
      });
      return row;
    });
  }, [results, tasks, dataDate, plannedFinish]);

  const selected = results.find((r) => r.scenario.id === saved.selected) ?? results[0];

  /*
   * By phase, week by week. The colour belongs to the phase, not to its rank, so a
   * phase keeps its colour whichever others are picked alongside it.
   */
  const [phaseView, setPhaseView] = useState<'planned' | 'worked'>('planned');
  const phaseColor = useMemo(() => {
    const m = new Map<string, string>();
    options.phases.forEach(([code], i) => m.set(code, PHASE_COLORS[i] ?? OTHER));
    return m;
  }, [options.phases]);
  const phaseName = useMemo(() => new Map(options.phases.map(([c, n]) => [c, n] as const)), [options.phases]);
  const inPhases = useMemo(() => [...new Set(tasks.map((t) => t.phase))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [tasks]);
  const phaseChart = useMemo(() => {
    if (!dataDate || !selected || chart.length < 2) return [];
    const ends = chart.slice(1).map((c) => c.date as string);
    const planned = plannedByPhase(tasks, ends, dataDate);
    const { net } = weeklyHours({ hoursPerPersonPerMonth: hpm, utilisation: util });
    return ends.map((end, w) => {
      const row: Record<string, number | string> = { date: end };
      const src = phaseView === 'planned' ? planned[w] : (selected.series[w + 1]?.workedByPhase ?? {});
      for (const ph of inPhases) row[`p_${ph}`] = src[ph] ?? 0;
      // The team on the first day of the week, at a full week's hours.
      row.capacity = peopleOn(addDaysISO(end, -7), selected.scenario) * net;
      return row;
    });
  }, [chart, tasks, selected, phaseView, inPhases, dataDate, hpm, util]);
  const overWeeks = phaseChart.filter((r) => inPhases.reduce((s, ph) => s + (r[`p_${ph}`] as number), 0) > (r.capacity as number) + 0.5).length;
  const lines: PhaseLine[] = useMemo(() => (selected ? phaseLines(selected) : []), [selected]);
  const phaseColumns: Column<PhaseLine>[] = [
    {
      key: 'phase',
      label: 'Phase',
      locked: true,
      value: (l) => l.phase,
      render: (l) => (
        <span className="flex items-center gap-1.5">
          <span style={{ width: 9, height: 9, borderRadius: 2, background: phaseColor.get(l.phase) ?? OTHER, display: 'inline-block' }} />
          <b>{l.phaseName}</b>
        </span>
      ),
    },
    { key: 'count', label: 'Activities', value: (l) => l.activities, num: true },
    { key: 'effort', label: 'Effort h', value: (l) => l.effortHours, num: true, render: (l) => fmtHours(l.effortHours) },
    { key: 'backlog', label: 'Backlog', value: (l) => l.backlogHours, num: true, render: (l) => (l.backlogHours > 0.5 ? <span className="tone-warn font-semibold">{fmtHours(l.backlogHours)} h</span> : '—') },
    { key: 'pstart', label: 'Planned start', value: (l) => l.plannedStart ?? '', render: (l) => fmtDate(l.plannedStart) },
    { key: 'pfinish', label: 'Planned finish', value: (l) => l.plannedFinish ?? '', render: (l) => fmtDate(l.plannedFinish) },
    { key: 'ffinish', label: 'Forecast finish', value: (l) => l.forecastFinish ?? '', render: (l) => (l.forecastFinish ? <b>{fmtDate(l.forecastFinish)}</b> : <span className="tone-bad">not reached</span>) },
    { key: 'slip', label: 'Slip', value: (l) => l.slipDays ?? null, num: true, render: (l) => <Slip days={l.slipDays} /> },
  ];

  const addScenario = () => {
    if (saved.scenarios.length >= MAX_SCENARIOS) return;
    const id = uid('sc');
    patch({ scenarios: [...saved.scenarios, { id, name: `Scenario ${saved.scenarios.length + 1}`, people: 4, changes: [] }] });
  };

  const heroStats: HeroStat[] = [
    { label: 'Backlog', value: `${fmtHours(backlogHours)} h`, tone: backlogHours > 0.5 ? 'amber' : 'good' },
    { label: 'Work left', value: `${fmtHours(totalHours)} h`, tone: 'muted' },
    { label: scope.finishBy ? 'End date' : 'Planned finish', value: fmtDate(plannedFinish), tone: 'muted' },
    {
      label: 'People to hold it',
      value: needed === null ? '—' : needed,
      tone: needed === null ? 'red' : 'blue',
    },
  ];

  const taskColumns: Column<TaskForecast>[] = [
    { key: 'id', label: 'Activity ID', locked: true, value: (t) => t.activityId, render: (t) => <span className="mono">{t.activityId}</span> },
    { key: 'name', label: 'Activity', value: (t) => t.activityName },
    { key: 'type', label: 'Type', value: (t) => t.activityType, optional: true },
    {
      key: 'role',
      label: 'Role',
      value: (t) => (t.role === 'own' ? 'OWN' : 'SUPPORT'),
      render: (t) => <Badge tone={t.role === 'own' ? 'info' : 'purple'}>{t.role === 'own' ? 'OWN' : `SUPPORT ${t.owner}`}</Badge>,
    },
    { key: 'phase', label: 'Phase', value: (t) => t.phaseName, optional: true },
    { key: 'loc', label: 'Location', value: (t) => t.location, optional: true },
    {
      key: 'state',
      label: 'State',
      value: (t) => (t.backlog ? 'BACKLOG' : t.inProgress ? 'IN PROGRESS' : 'UPCOMING'),
      hint: 'BACKLOG: the current schedule says it should already have finished. These are worked first, oldest first.',
      render: (t) => <Badge tone={t.backlog ? 'warn' : t.inProgress ? 'info' : 'muted'}>{t.backlog ? 'BACKLOG' : t.inProgress ? 'IN PROGRESS' : 'UPCOMING'}</Badge>,
    },
    {
      key: 'pstart',
      label: 'Planned start',
      value: (t) => t.plannedStart ?? '',
      hint: 'Editable, for this simulation only. Budget Master and every other screen keep the schedule’s date.',
      render: (t) => <SimDate t={t} which="start" orig={original.get(normKey(t.activityId))?.plannedStart ?? null} onCommit={(v) => editTask(t.activityId, { start: v })} />,
    },
    {
      key: 'pfinish',
      label: 'Planned finish',
      value: (t) => t.plannedFinish ?? '',
      hint: 'Editable, for this simulation only. Moving it before the data date makes the activity backlog.',
      render: (t) => <SimDate t={t} which="finish" orig={original.get(normKey(t.activityId))?.plannedFinish ?? null} onCommit={(v) => editTask(t.activityId, { finish: v })} />,
    },
    {
      key: 'budget',
      label: 'Budget left h',
      value: (t) => t.remainingBudget,
      num: true,
      hint: 'Editable, for this simulation only: the budget hours still to earn. Effort is this over the efficiency factor.',
      render: (t) => {
        const o = original.get(normKey(t.activityId))?.remainingBudget;
        return (
          <CellInput
            type="number"
            className={`cell-input w-20 text-right${o !== undefined && Math.abs(o - t.remainingBudget) > 1e-6 ? ' font-semibold' : ''}`}
            value={String(Math.round(t.remainingBudget * 10) / 10)}
            onCommit={(v) => {
              const n = Number(v);
              editTask(t.activityId, { hours: v.trim() === '' || !Number.isFinite(n) || (o !== undefined && Math.abs(n - o) < 0.05) ? undefined : Math.max(0, n) });
            }}
          />
        );
      },
    },
    { key: 'effort', label: 'Effort h', value: (t) => t.effortHours, num: true, hint: 'Budget left divided by the efficiency factor: the hours it will actually take.', render: (t) => fmtHours(t.effortHours, 1) },
    {
      key: 'crew',
      label: 'Crew',
      value: (t) => t.crew,
      num: true,
      hint: `Heads of ${saved.group} on the activity — editable, for this simulation only. It cannot go faster than this many people working full weeks.`,
      render: (t) => (
        <CellInput
          type="number"
          className="cell-input w-14 text-right"
          value={String(t.crew)}
          onCommit={(v) => {
            const n = Number(v);
            const o = original.get(normKey(t.activityId))?.crew;
            editTask(t.activityId, { crew: v.trim() === '' || !Number.isFinite(n) || n < 1 || n === o ? undefined : n });
          }}
        />
      ),
    },
    {
      key: 'sim',
      label: 'In sim',
      value: (t) => (t.removed ? 0 : 1),
      hint: 'Untick to leave this one activity out of the simulation. Nothing changes in Budget Master.',
      render: (t) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <input type="checkbox" checked={!t.removed} aria-label={`Include ${t.activityId} in the simulation`} onChange={() => editTask(t.activityId, { removed: !t.removed || undefined })} />
          {t.simEdited && (
            <button className="btn-link text-[11px]" title="Changed for this simulation only. Click to put it back as the schedule has it." onClick={() => setSaved((sv) => { const e = { ...sv.edits }; delete e[normKey(t.activityId)]; return { ...sv, edits: e }; })}>
              <Badge tone="purple">sim · reset</Badge>
            </button>
          )}
        </span>
      ),
    },
    {
      key: 'ffinish',
      label: 'Forecast finish',
      value: (t) => t.forecastFinish ?? '',
      render: (t) => (t.removed ? <span className="text-[var(--text-subtle)]">removed</span> : t.forecastFinish ? <b>{fmtDate(t.forecastFinish)}</b> : <span className="tone-bad">not reached</span>),
    },
    { key: 'slip', label: 'Slip', value: (t) => t.slipDays ?? null, num: true, render: (t) => <Slip days={t.slipDays} /> },
  ];

  const isExcluded = (g: TypeGroup) => scope.excludedTypes.some((x) => normKey(x) === normKey(g.activityType));
  const toggleType = (g: TypeGroup) =>
    setScope({
      excludedTypes: isExcluded(g) ? scope.excludedTypes.filter((x) => normKey(x) !== normKey(g.activityType)) : [...scope.excludedTypes, g.activityType],
    });
  const openGroup = openType === null ? null : (typeGroups.find((g) => g.activityType === openType) ?? null);

  const typeColumns: Column<TypeGroup>[] = [
    {
      key: 'in',
      label: 'In',
      value: (g) => (isExcluded(g) ? 0 : 1),
      hint: 'Untick to take every activity of this type out of the analysis.',
      render: (g) => <input type="checkbox" checked={!isExcluded(g)} onChange={() => toggleType(g)} aria-label={`Include ${g.activityType}`} />,
    },
    {
      key: 'type',
      label: 'Type',
      locked: true,
      value: (g) => g.activityType,
      render: (g) => (
        <button className="btn-link text-left" onClick={() => setOpenType(openType === g.activityType ? null : g.activityType)}>
          {g.activityType}
        </button>
      ),
    },
    {
      key: 'role',
      label: 'Role',
      value: (g) => g.role.toUpperCase(),
      render: (g) => <Badge tone={g.role === 'own' ? 'info' : g.role === 'support' ? 'purple' : 'muted'}>{g.role === 'support' ? `SUPPORT ${g.owner}` : g.role.toUpperCase()}</Badge>,
    },
    { key: 'count', label: 'Activities', value: (g) => g.tasks.length, num: true },
    {
      key: 'locs',
      label: 'Locations',
      value: (g) => g.locations.join(', '),
      render: (g) => <span className="mono text-[11.5px]">{g.locations.length > 6 ? `${g.locations.slice(0, 6).join(', ')} +${g.locations.length - 6}` : g.locations.join(', ')}</span>,
    },
    { key: 'backlog', label: 'Backlog', value: (g) => g.backlog, num: true, render: (g) => (g.backlog ? <span className="tone-warn font-semibold">{g.backlog}</span> : '—') },
    { key: 'effort', label: 'Effort h', value: (g) => g.effortHours, num: true, render: (g) => fmtHours(g.effortHours) },
    { key: 'first', label: 'Planned start', value: (g) => g.firstStart ?? '', render: (g) => fmtDate(g.firstStart) },
    { key: 'last', label: 'Planned finish', value: (g) => g.lastFinish ?? '', render: (g) => fmtDate(g.lastFinish) },
  ];

  return (
    <Page
      eyebrow="Progress"
      title="Staffing Scenarios"
      subtitle={
        <>
          When the work finishes with this many people. The overdue backlog is worked first, then each activity no earlier than its planned start, and no
          faster than its own crew. Scenarios are kept in this browser only and never change the headcount on <a className="btn-link" href={href('capacity')}>Capacity</a>.
        </>
      }
      stats={heroStats}
      toolbar={
        <>
          <label className="flex items-center gap-1.5 text-[12px]">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{TERMS.subsystem}</span>
            <select className="input" value={saved.group} onChange={(e) => patch({ group: e.target.value })}>
              {[...new Set([saved.group, ...groups])].map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>
          <label className="ml-3 flex items-center gap-1.5 text-[12px]" title="Budget hours earned per hour worked. 1.0 performs to budget; 0.8 means every budget hour takes 1.25 hours.">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Efficiency</span>
            <input
              className="input w-20"
              type="number"
              step="0.05"
              min="0.05"
              value={saved.efficiency}
              onChange={(e) => patch({ efficiency: Math.max(0, Number(e.target.value) || 0) })}
            />
          </label>
          {achieved !== null && Math.abs(achieved - saved.efficiency) > 0.005 && (
            <button className="btn btn-mini" onClick={() => patch({ efficiency: Math.round(achieved * 100) / 100 })} title={`The earned-vs-${TERMS.built.toLowerCase()} factor ${saved.group} has achieved to date.`}>
              use achieved {achieved.toFixed(2)}
            </button>
          )}
          <label className="ml-3 flex items-center gap-1.5 text-[12px]" title="Working hours per person per month. Starts from the Capacity screen's figure.">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">h / person / month</span>
            <input className="input w-20" type="number" step="any" value={hpm} onChange={(e) => patch({ hoursPerPersonPerMonth: Math.max(0, Number(e.target.value) || 0) })} />
          </label>
          <label className="ml-3 flex items-center gap-1.5 text-[12px]" title="The share of each person's hours that reaches this project. Starts from the Capacity screen's figure.">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Utilisation</span>
            <input className="input w-20" type="number" step="0.05" min="0" max="1" value={util} onChange={(e) => patch({ utilisation: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })} />
          </label>
          <span className="ml-3 text-[11.5px] text-[var(--text-muted)]">= {fmtHours(net, 1)} h a week to the project each</span>
          <button
            className="btn btn-mini ml-auto"
            onClick={() => {
              if (window.confirm('Put the scenarios back to 8, 4, and 4 with support added later?')) setSaved(defaults(saved.group, dataDate ?? ''));
            }}
          >
            Reset scenarios
          </button>
        </>
      }
    >
      {!dataDate && (
        <div className="mb-4">
          <Notice tone="warn">No data date is set, so there is no “today” to schedule from. Set it under <a className="btn-link" href={href('settings')}>Settings</a>.</Notice>
        </div>
      )}
      {dataDate && allTasks.length === 0 && (
        <div className="mb-4">
          <Notice tone="info">
            {saved.group} has no budgeted work left on the current schedule. Pick another {TERMS.subsystemLower}, or check the crews on the Activity Library name it.
          </Notice>
        </div>
      )}

      {dataDate && allTasks.length > 0 && (
        <Panel
          title="What is analysed"
          meta={
            <>
              <b>{tasks.length}</b> of {allTasks.length} activities with {saved.group} work left, {fmtHours(totalHours)} of {fmtHours(allTasks.reduce((s, t) => s + t.effortHours, 0))} h
              {leftOut.size > 0 && <> · left out: {[...leftOut.entries()].map(([why, c]) => (why === 'removed' ? `${c.n} removed in the simulation` : `${c.n} by ${why}`)).join(', ')}</>}
              {editCount > 0 && (
                <>
                  {' '}· <b>{editCount}</b> {editCount === 1 ? 'activity' : 'activities'} changed for the simulation only{' '}
                  <button className="btn-link text-[11px]" onClick={() => { if (window.confirm(`Put all ${editCount} back as the schedule has them?`)) patch({ edits: {} }); }}>reset all</button>
                </>
              )}
            </>
          }
          className="mb-3"
        >
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3 text-[12px]">
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Work</div>
              <span className="seg">
                <button className={`seg-btn${!scope.includeSupport ? ' is-on' : ''}`} onClick={() => setScope({ includeSupport: false })}>
                  {saved.group} activities only
                </button>
                <button
                  className={`seg-btn${scope.includeSupport ? ' is-on' : ''}`}
                  onClick={() => setScope({ includeSupport: true })}
                  title={`Hours ${saved.group} puts into other groups' activities because it is on their crew.`}
                >
                  + {saved.group} support to others ({support.length}, {fmtHours(support.reduce((s, t) => s + t.effortHours, 0))} h)
                </button>
              </span>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Phases <span className="font-normal normal-case tracking-normal">— pick several to see them overlap</span>
              </div>
              <span className="seg flex-wrap">
                <button className={`seg-btn${scope.phases.length === 0 ? ' is-on' : ''}`} onClick={() => setScope({ phases: [] })}>
                  All
                </button>
                {options.phases.map(([code, name]) => {
                  const on = scope.phases.includes(code);
                  return (
                    <button
                      key={code}
                      className={`seg-btn${on ? ' is-on' : ''}`}
                      aria-pressed={on}
                      onClick={() => setScope({ phases: on ? scope.phases.filter((x) => x !== code) : [...scope.phases, code] })}
                    >
                      {name}
                    </button>
                  );
                })}
              </span>
            </div>
            <label>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Work type</div>
              <select className="input" value={scope.workType} onChange={(e) => setScope({ workType: e.target.value })}>
                <option value="">All</option>
                {options.workTypes.map((w) => (
                  <option key={w} value={w}>{w}</option>
                ))}
              </select>
            </label>
            <label>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Location</div>
              <select className="input" value={scope.location} onChange={(e) => setScope({ location: e.target.value })}>
                <option value="">All</option>
                {options.locations.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label title="Only work the current schedule plans to finish by this date. Backlog is always in, because it is already due. Slip and the people needed are judged against this date.">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Planned to finish by</div>
              <span className="flex items-center gap-1.5">
                <input className="input" type="date" value={scope.finishBy ?? ''} onChange={(e) => setScope({ finishBy: e.target.value || null })} />
                {scope.finishBy ? (
                  <button className="btn-link text-[11px]" onClick={() => setScope({ finishBy: null })}>whole schedule</button>
                ) : (
                  <span className="text-[11px] text-[var(--text-subtle)]">whole schedule</span>
                )}
              </span>
            </label>
            {(scope.phases.length > 0 || scope.workType || scope.location || scope.finishBy || scope.excludedTypes.length > 0) && (
              <button className="btn btn-mini" onClick={() => setScope({ phases: [], workType: '', location: '', finishBy: null, excludedTypes: [] })}>
                Clear filters
              </button>
            )}
          </div>
        </Panel>
      )}

      {dataDate && allTasks.length > 0 && tasks.length === 0 && (
        <div className="mb-4">
          <Notice tone="info">Nothing is left in the analysis. Widen the filters above, or tick an activity type back in below.</Notice>
        </div>
      )}

      {dataDate && tasks.length > 0 && (
        <>
          <div className="mb-3 grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
            {results.map((r, i) => {
              const s = r.scenario;
              const finishOk = r.finish !== null && r.slipDays !== null && r.slipDays <= 0;
              const verdict = !finishOk ? 'BEHIND SCHEDULE' : r.lateTasks > 0 ? 'FINISH HOLDS, ACTIVITIES LATE' : 'ON TRACK';
              return (
                <div key={s.id} className="card" style={{ borderTop: `3px solid ${SERIES[i]}` }}>
                  <div className="mb-2 flex items-center gap-2">
                    <CellInput className="cell-input font-semibold" value={s.name} onCommit={(v) => editScenario(s.id, { name: v.trim() || s.name })} />
                    {saved.scenarios.length > 1 && (
                      <button
                        className="btn-link danger text-[11px]"
                        onClick={() => patch({ scenarios: saved.scenarios.filter((x) => x.id !== s.id), selected: saved.selected === s.id ? saved.scenarios[0].id : saved.selected })}
                      >
                        remove
                      </button>
                    )}
                  </div>
                  <label className="flex items-center gap-2 text-[12px]">
                    <span className="font-semibold">People from {fmtDate(dataDate)}</span>
                    <input className="input w-20" type="number" step="0.5" min="0" value={s.people} onChange={(e) => editScenario(s.id, { people: Math.max(0, Number(e.target.value) || 0) })} />
                  </label>

                  <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Later changes</div>
                  {s.changes.length === 0 && <div className="text-[12px] text-[var(--text-subtle)]">None.</div>}
                  {s.changes.map((c) => (
                    <div key={c.id} className="mt-1.5 rounded border border-[var(--line-soft)] p-1.5 text-[12px]">
                    <div className="flex items-center gap-1.5">
                      <input
                        className="input w-16"
                        type="number"
                        step="0.5"
                        value={c.delta}
                        title="People added from this date. Negative releases people."
                        onChange={(e) => editChange(s.id, c.id, { delta: Number(e.target.value) || 0 })}
                      />
                      <span className="text-[var(--text-muted)]">from</span>
                      <input className="input" type="date" value={c.from} onChange={(e) => editChange(s.id, c.id, { from: e.target.value })} />
                      <button className="btn-link danger text-[11px]" onClick={() => editScenario(s.id, { changes: s.changes.filter((x) => x.id !== c.id) })}>
                        ×
                      </button>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5" title="The last day of a temporary assignment. Leave it blank for a permanent one.">
                      <span className="w-16 text-right text-[var(--text-muted)]">until</span>
                      <input
                        className="input"
                        type="date"
                        min={c.from || undefined}
                        value={c.until ?? ''}
                        onChange={(e) => editChange(s.id, c.id, { until: e.target.value || undefined })}
                      />
                      <span className="text-[11px] text-[var(--text-subtle)]">{c.until ? 'temporary' : 'permanent'}</span>
                    </div>
                    </div>
                  ))}
                  <button
                    className="btn btn-mini mt-1.5"
                    onClick={() => editScenario(s.id, { changes: [...s.changes, { id: uid('ch'), from: monthsAfter(dataDate, 1), delta: 2 }] })}
                  >
                    Add support from a date
                  </button>

                  <div className="mt-3 border-t border-[var(--line-soft)] pt-2 text-[12.5px]">
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Finishes</span>
                      <b className="tabular-nums">{r.finish ? fmtDate(r.finish) : 'not within 15 years'}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Against planned {fmtDate(r.plannedFinish)}</span>
                      {r.finish ? <Slip days={r.slipDays} /> : <span className="tone-bad font-semibold">never</span>}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Backlog cleared</span>
                      <span className="tabular-nums">
                        {backlog.length === 0 ? 'none' : r.backlogClear ? `${fmtDate(r.backlogClear)} (${weeks(dataDate, r.backlogClear)} wk)` : 'never'}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--text-muted)]">Activities finishing late</span>
                      <span className="tabular-nums">{r.lateTasks} of {r.tasks.length}</span>
                    </div>
                    <div className="mt-2 border-t border-[var(--line-soft)] pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                      Hours to {r.finish ? 'the finish' : 'the end of the horizon'}
                    </div>
                    <div className="flex justify-between" title="Hours the scenario's people give the project, from the data date to the finish.">
                      <span className="text-[var(--text-muted)]">Supplied</span>
                      <span className="tabular-nums">{fmtHours(r.burn.supplied)} h</span>
                    </div>
                    <div className="flex justify-between" title="Hours paid for with nothing to work on: no backlog left, the next activity not yet at its planned start, or every open activity already at its crew's pace. What over-staffing costs.">
                      <span className="text-[var(--text-muted)]">Idle — over-staffed</span>
                      <span className={`tabular-nums ${r.burn.idle > 0.05 * r.burn.supplied ? 'tone-bad font-semibold' : ''}`}>
                        {fmtHours(r.burn.idle)} h{r.burn.supplied > 0 ? ` (${Math.round((r.burn.idle / r.burn.supplied) * 100)}%)` : ''}
                      </span>
                    </div>
                    <div
                      className="flex justify-between"
                      title={`Hours worked that earn nothing because the efficiency is ${saved.efficiency}: at 0.8 every budget hour takes 1.25 hours.`}
                    >
                      <span className="text-[var(--text-muted)]">{r.burn.lostToEfficiency < 0 ? 'Gained by efficiency' : 'Lost to efficiency'}</span>
                      <span className={`tabular-nums ${r.burn.lostToEfficiency > 0.5 ? 'tone-bad font-semibold' : ''}`}>{fmtHours(Math.abs(r.burn.lostToEfficiency))} h</span>
                    </div>
                    <div className="flex justify-between" title="Idle hours plus hours lost to efficiency: everything paid for that earns no budget.">
                      <span className="font-semibold">Burned, not earned</span>
                      <b className="tabular-nums">{fmtHours(r.burn.idle + Math.max(0, r.burn.lostToEfficiency))} h</b>
                    </div>
                    {r.burn.idleWeeks > 0 && (
                      <div className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                        {r.burn.idleWeeks} {r.burn.idleWeeks === 1 ? 'week' : 'weeks'} with a quarter or more of the team idle.
                      </div>
                    )}
                    <div className="mt-2">
                      <Badge tone={!finishOk ? 'bad' : r.lateTasks > 0 ? 'warn' : 'good'}>{verdict}</Badge>
                    </div>
                  </div>
                </div>
              );
            })}
            {saved.scenarios.length < MAX_SCENARIOS && (
              <button className="card flex items-center justify-center text-[13px] text-[var(--text-muted)] hover:text-[var(--text)]" onClick={addScenario}>
                + Add a scenario
              </button>
            )}
          </div>

          <div className="mb-3">
            <Notice tone={needed === null ? 'warn' : 'info'}>
              {needed === null ? (
                <>
                  <b>No headcount finishes {saved.group}’s work by the planned {fmtDate(plannedFinish)}.</b>{' '}
                  {plannedFinish && plannedFinish < dataDate
                    ? 'That date has already passed.'
                    : 'The crews on the last activities cannot go fast enough however many people stand behind them — the dates have to move.'}
                </>
              ) : (
                <>
                  <b>{needed} {needed === 1 ? 'person' : 'people'}</b>, held from {fmtDate(dataDate)}, finish {saved.group}’s {fmtHours(totalHours)} h — {fmtHours(backlogHours)} h of it
                  backlog — by the planned {fmtDate(plannedFinish)}, at {fmtHours(net, 1)} h a week each and an efficiency of {saved.efficiency}.
                </>
              )}
            </Notice>
          </div>

          <Panel title="Work left, week by week" meta="Each scenario against what the current schedule expects to be left. Above the dashed line is behind." className="mb-3">
            <div className="w-full" style={{ height: 340 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chart} margin={{ top: 20, right: 32, left: 8, bottom: 0 }}>
                  <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10.5, fill: AXIS }}
                    tickLine={false}
                    axisLine={{ stroke: GRID }}
                    minTickGap={36}
                    tickFormatter={(v: string) => fmtDate(v)}
                  />
                  <YAxis tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => fmtHours(v)} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: '#cfd5df', strokeDasharray: '3 3' }} />
                  <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
                  {plannedFinish && plannedFinish >= dataDate && (
                    <ReferenceLine x={chart.find((c) => (c.date as string) >= plannedFinish)?.date as string | undefined} stroke="#cfd5df" strokeDasharray="4 4" label={{ value: 'PLANNED FINISH', position: 'insideTopRight', fontSize: 9.5, fill: AXIS }} />
                  )}
                  <Line type="linear" dataKey="plan" name="Current schedule" stroke={INK} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                  {results.map((r, i) => (
                    <Line key={r.scenario.id} type="linear" dataKey={r.scenario.id} name={r.scenario.name} stroke={SERIES[i]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>

          {selected && phaseChart.length > 0 && (
            <Panel
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="card-title">By phase</h2>
                  <span className="seg">
                    <button className={`seg-btn${phaseView === 'planned' ? ' is-on' : ''}`} onClick={() => setPhaseView('planned')}>As P6 plans it</button>
                    <button className={`seg-btn${phaseView === 'worked' ? ' is-on' : ''}`} onClick={() => setPhaseView('worked')}>As the team works it</button>
                  </span>
                  <span className="seg">
                    {results.map((r) => (
                      <button key={r.scenario.id} className={`seg-btn${selected.scenario.id === r.scenario.id ? ' is-on' : ''}`} onClick={() => patch({ selected: r.scenario.id })}>
                        {r.scenario.name}
                      </button>
                    ))}
                  </span>
                </div>
              }
              meta={
                phaseView === 'planned'
                  ? `${saved.group} hours each week as the schedule plans them, stacked by phase, against ${selected.scenario.name}’s hours (line). ${overWeeks} ${overWeeks === 1 ? 'week asks' : 'weeks ask'} for more than the team has.${backlogHours > 0.5 ? ` Plus ${fmtHours(backlogHours)} h of backlog, due now.` : ''}`
                  : `${saved.group} hours each week as ${selected.scenario.name} actually works them — backlog first, then the schedule — stacked by phase, against the team’s hours (line).`
              }
              className="mb-3"
            >
              <div className="w-full" style={{ height: 300 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={phaseChart} margin={{ top: 12, right: 32, left: 8, bottom: 0 }} barCategoryGap={1}>
                    <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} minTickGap={36} tickFormatter={(v: string) => fmtDate(v)} />
                    <YAxis tick={{ fontSize: 10.5, fill: AXIS }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => fmtHours(v)} />
                    <Tooltip content={<ChartTip />} cursor={{ fill: 'rgba(15,17,21,0.04)' }} />
                    <Legend wrapperStyle={{ fontSize: 11.5, paddingTop: 8 }} />
                    {inPhases.map((ph) => (
                      <Bar key={ph} dataKey={`p_${ph}`} name={phaseName.get(ph) ?? ph} stackId="phase" fill={phaseColor.get(ph) ?? OTHER} isAnimationActive={false} />
                    ))}
                    <Line type="stepAfter" dataKey="capacity" name={`${selected.scenario.name} — team hours`} stroke={INK} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3">
                <SortableTable
                  tableId="staffing-phases"
                  exportName={`Staffing ${saved.group} phases ${selected.scenario.name}`}
                  rows={lines}
                  columns={phaseColumns}
                  rowKey={(l) => l.phase}
                  defaultSort={{ key: 'phase', dir: 'asc' }}
                  maxHeight="260px"
                />
              </div>
            </Panel>
          )}

          {selected && (
            <Panel
              title="Activities analysed, by type"
              meta={`Each type once, however many locations it repeats at. Untick a type to take it out. Click a type to list its activities under “${selected.scenario.name}”.`}
              className="mb-3"
            >
              <SortableTable
                tableId="staffing-types"
                exportName={`Staffing ${saved.group} types`}
                rows={typeGroups}
                columns={typeColumns}
                rowKey={(g) => g.activityType}
                defaultSort={{ key: 'effort', dir: 'desc' }}
                maxHeight="360px"
                rowClass={(g) => (isExcluded(g) ? 'row-muted' : openType === g.activityType ? 'row-warn' : '')}
              />
              {openGroup && (
                <div className="mt-3">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {openGroup.activityType} — {openGroup.tasks.length} {openGroup.tasks.length === 1 ? 'activity' : 'activities'}
                  </div>
                  <SortableTable
                    tableId="staffing-type-detail"
                    rows={openGroup.tasks.map((t) => {
                      // Its forecast under the scenario chosen, or none when it is out of the run.
                      const f = selected.tasks.find((x) => x.activityId === t.activityId);
                      return f ?? { ...t, forecastFinish: null, slipDays: null };
                    })}
                    rowClass={(t) => (t.removed ? 'row-muted' : '')}
                    columns={taskColumns}
                    rowKey={(t) => t.activityId}
                    defaultSort={{ key: 'pfinish', dir: 'asc' }}
                    maxHeight="300px"
                  />
                </div>
              )}
            </Panel>
          )}

          {selected && (
            <Panel
              title={
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="card-title">Activity forecast</h2>
                  <span className="seg">
                    {results.map((r) => (
                      <button key={r.scenario.id} className={`seg-btn${selected.scenario.id === r.scenario.id ? ' is-on' : ''}`} onClick={() => patch({ selected: r.scenario.id })}>
                        {r.scenario.name}
                      </button>
                    ))}
                  </span>
                </div>
              }
              meta={`${backlog.length} backlog, ${tasks.length - backlog.length} still to come · an activity is never worked faster than its planned pace, or its crew at ${fmtHours(gross, 1)} h a week each`}
            >
              <SortableTable
                tableId="staffing-activities"
                exportName={`Staffing ${saved.group} ${selected.scenario.name}`}
                rows={selected.tasks}
                columns={taskColumns}
                rowKey={(t) => t.activityId}
                defaultSort={{ key: 'ffinish', dir: 'asc' }}
                maxHeight="460px"
                rowClass={(t) => (t.forecastFinish === null || (t.slipDays ?? 0) > 0 ? 'row-bad' : '')}
              />
            </Panel>
          )}
        </>
      )}
    </Page>
  );
}

/**
 * A planned date that can be changed for the simulation. Bold with the schedule's
 * date in the tooltip when it differs; keying the schedule's date, or clearing it,
 * puts it back.
 */
function SimDate({ t, which, orig, onCommit }: { t: StaffingTask; which: 'start' | 'finish'; orig: string | null; onCommit: (v: string | undefined) => void }) {
  const value = which === 'start' ? t.plannedStart : t.plannedFinish;
  const changed = (value ?? null) !== (orig ?? null);
  return (
    <CellInput
      type="date"
      className={`cell-input${changed ? ' font-semibold' : ''}`}
      value={value ?? ''}
      title={changed ? `Changed for the simulation. The schedule has ${fmtDate(orig)}.` : 'The schedule’s date. Change it to try another in the simulation only.'}
      onCommit={(v) => onCommit(!v || v === orig ? undefined : v)}
    />
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Select, Badge, Notice, Panel, statusTone, type Column } from '../components/ui';
import type { ActivityOverride, ActivityVisibility, BudgetRow } from '../../engine/types';
import { fmtHours, fmtPct, fmtDate, num } from '../format';
import { normKey } from '../../engine/keys';
import { href, type Route } from '../router';
import { TERMS } from '../../engine/vocab';
import { normalisePhaseValue, phaseLabel, phaseOf } from '../../engine/parse';
import { formatLocationSplit, locationLabel, parseLocationSplit } from '../../engine/locations';
import { upsertOverrides } from '../overrides';
import { ReviewPanel } from '../components/ReviewPanel';

const FLAGS: Record<string, { label: string; test: (r: BudgetRow) => boolean }> = {
  review: { label: 'Needing REVIEW', test: (r) => r.status === 'REVIEW' },
  nodates: { label: 'No dates at all', test: (r) => r.baselineSource === 'NONE' },
  nocurve: { label: 'In budget but on no curve', test: (r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve },
  blcurrent: { label: 'Baseline falling back to current dates', test: (r) => r.baselineSource === 'CURRENT' },
  pctp6: { label: 'Percent complete from P6 duration', test: (r) => r.pctSource === 'P6' && r.status === 'IN BUDGET' },
  shifts: { label: 'RATE type missing shifts', test: (r) => r.needsShifts },
  override: { label: 'Has an hours override', test: (r) => r.overrideHours !== null },
  edited: {
    label: 'Carries an edit of yours',
    test: (r) => r.renamed || r.visibility !== null || r.overrideHours !== null || r.phaseEdited || r.locationEdited || r.locationSplit || r.datesEdited,
  },
  dates: { label: 'Dates changed — for the scheduler', test: (r) => r.datesEdited },
  moved: { label: 'Moved to another phase or location', test: (r) => r.phaseEdited || r.locationEdited },
  byyou: { label: 'Excluded or included by you', test: (r) => r.visibility === 'EXCLUDED' || r.visibility === 'INCLUDED' },
  nostart: {
    label: 'Earning with no actual start — in the percent, not on the curve',
    test: (r) => r.status === 'IN BUDGET' && r.earnedHours > 0 && !r.earnStart,
  },
  split: { label: 'Split across locations', test: (r) => r.locationSplit },
  forcedzero: { label: 'Forced in but carrying no hours', test: (r) => r.visibility === 'INCLUDED' && r.status === 'IN BUDGET' && r.budgetHours === 0 },
};

/** What the In budget? column offers, in the order a person works through them. */
const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'INCLUDED', label: 'Include' },
  { value: 'EXCLUDED', label: 'Exclude' },
  { value: 'HIDDEN', label: 'Hide (remove)' },
];

/**
 * Which set of activities the screen is looking at. Every view but Hidden is drawn
 * from the activities in the program; In the budget is exactly the set the percent
 * complete on the Dashboard is taken over, so the two can be checked against each
 * other, and Excluded is everything listed but carrying no hours.
 */
type View = 'active' | 'inbudget' | 'excluded' | 'hidden';
const VIEWS: View[] = ['active', 'inbudget', 'excluded', 'hidden'];
const isOut = (r: BudgetRow) => r.status === 'EXCLUDED' || r.status === 'DELETED' || r.status === 'CANCELLED';

export function BudgetMaster({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [view, setView] = useState<View>(VIEWS.find((v) => v === route.params.get('view')) ?? 'active');
  const [loc, setLoc] = useState(route.params.get('loc') ?? '');
  const [phase, setPhase] = useState(route.params.get('phase') ?? '');
  const [work, setWork] = useState(route.params.get('work') ?? '');
  const [disc, setDisc] = useState(route.params.get('disc') ?? '');
  const [sub, setSub] = useState(route.params.get('sub') ?? '');
  const [status, setStatus] = useState('');
  const [win, setWin] = useState('');
  const [text, setText] = useState(route.params.get('q') ?? '');
  // A link followed while this screen is already open changes the route, not the mount.
  const routeQ = route.params.get('q');
  const routeView = route.params.get('view');
  useEffect(() => {
    if (routeQ !== null) setText(routeQ);
  }, [routeQ]);
  useEffect(() => {
    const v = VIEWS.find((x) => x === routeView);
    if (v) setView(v);
  }, [routeView]);

  const source = useMemo(
    () =>
      view === 'hidden'
        ? model.hiddenRows
        : view === 'inbudget'
          ? model.rows.filter((r) => r.status === 'IN BUDGET')
          : view === 'excluded'
            ? model.rows.filter(isOut)
            : model.rows,
    [view, model.rows, model.hiddenRows],
  );

  const rows = useMemo(() => {
    let r = source;
    if (flag && FLAGS[flag]) r = r.filter(FLAGS[flag].test);
    // A split activity is at each of its locations, so filtering to any one finds it.
    if (loc) r = r.filter((x) => x.locationShares.some((s) => s.code === loc));
    if (phase) r = r.filter((x) => x.phase === phase);
    if (work) r = r.filter((x) => x.workType === work);
    // Matched against the parts rather than the whole string: an activity whose
    // Subsystem reads "ATS, IXL" is an ATS activity and an IXL one, and drilling in
    // from the ATS row of a rollup has to find it.
    if (disc) r = r.filter((x) => x.disciplines.some((d) => normKey(d) === normKey(disc)));
    // An activity can draw on several subsystems, so this narrows to the ones that
    // draw on this group at all rather than to a group that "owns" the activity.
    if (sub) r = r.filter((x) => (x.subsystemHours[sub] ?? 0) > 0);
    if (status) r = r.filter((x) => x.status === status);
    if (win) r = r.filter((x) => x.earnWindowSource === win);
    if (text.trim()) {
      const t = text.toLowerCase();
      r = r.filter(
        (x) =>
          x.activityId.toLowerCase().includes(t) ||
          x.activityName.toLowerCase().includes(t) ||
          x.activity.activityName.toLowerCase().includes(t) ||
          x.matchKey.toLowerCase().includes(t),
      );
    }
    return r;
  }, [source, flag, loc, phase, work, disc, sub, status, win, text]);

  /**
   * One upsert for every per-activity edit.
   *
   * A row is created when the first field is filled and removed again when the last
   * one is cleared, so activity-overrides.json only ever holds activities somebody
   * actually decided something about. The Activity ID is the key and is never
   * written by an edit: it is the one thing tying this file to the next import.
   */
  const setOv = (activityId: string, patch: Partial<Omit<ActivityOverride, 'activityId'>>) => {
    actions.update('overrides', (ovs) => upsertOverrides(ovs, [activityId], patch));
  };

  const ovOf = (id: string) => state.data.overrides.find((o) => normKey(o.activityId) === normKey(id));

  /** Read a typed split, or say what is wrong with it. Blank clears it. */
  const readSplit = (text: string): ActivityOverride['locationSplit'] | null => {
    const got = parseLocationSplit(text);
    if ('error' in got) {
      actions.notify('error', `Split not changed. ${got.error} Type it as W40 50, 2W 50 — whatever is left stays at the activity's own location.`);
      return null;
    }
    return got.split.length ? got.split : undefined;
  };
  const setSplit = (r: BudgetRow, text: string) => {
    const split = readSplit(text);
    if (split !== null) setOv(r.activityId, { locationSplit: split });
  };

  /** A date the same as P6's, or blank, is no override at all. */
  const setDate = (r: BudgetRow, which: 'start' | 'finish', v: string) => {
    const p6 = which === 'start' ? r.activity.startDate : r.activity.finishDate;
    const next = !v || v === p6 ? undefined : v;
    setOv(r.activityId, which === 'start' ? { startDate: next } : { finishDate: next });
  };

  /**
   * Forcing an activity into the budget is a promise the Activity Library has to be
   * able to keep, so this makes sure it can.
   *
   * An activity is priced through its type, and two kinds of type have no library
   * key at all: one P6 marked "(Deleted)" or "(Cancelled)" — import skips those on
   * purpose, since nobody wants a library full of dead work — and one whose key was
   * retired by hand. Forcing such an activity in used to move it from DELETED to
   * REVIEW and stop there: no rate could ever reach it, it carried no hours, and
   * because both the Activity Library and Progress are lists of priced things,
   * it appeared in neither. It had been "included" into nowhere.
   *
   * So the key is created, or un-retired, in the same action. It arrives on the
   * Settings defaults exactly as a discovered type would, which is a real number of
   * hours rather than a zero, and the type is then visible and editable like any
   * other. Other activities of that same type are NOT dragged in with it: P6's
   * (Deleted) marker still excludes them on its own, and only the ones forced in
   * individually cross over.
   */
  const ensurePriceable = (types: string[]) => {
    const lib = state.data.library;
    const wanted = [...new Map(types.map((t) => t.trim()).filter(Boolean).map((t) => [normKey(t), t])).values()];
    const has = (t: string) => lib.find((e) => normKey(e.matchKey) === normKey(t));
    const added = wanted.filter((t) => !has(t));
    const restored = wanted.filter((t) => has(t)?.retired);
    if (added.length === 0 && restored.length === 0) return { added, restored };
    // The updater stays pure: what changed is worked out from the current state
    // above, never inside the reducer, which React is free to call more than once.
    /*
     * The new key names its basis rather than inheriting the Settings default.
     * A bare key under a RATE default has no shift count, and RATE hours are
     * crew x shift x shifts — so it would price every activity it matched at
     * zero, which is exactly the "I forced it in and nothing happened" the key
     * creation exists to prevent. DUR at least multiplies by the P6 duration,
     * which is a real number the schedule already supplied.
     */
    actions.update('library', (prev) => [
      ...prev.map((e) => (restored.some((t) => normKey(t) === normKey(e.matchKey)) ? { ...e, retired: undefined } : e)),
      ...added.map((t) => ({ matchKey: t, basis: 'DUR' as const })),
    ]);
    return { added, restored };
  };

  /** Say what forcing in had to do to the library, so it is never a silent side effect. */
  const reportPriceable = (r: { added: string[]; restored: string[] }, count: number) => {
    const acts = `${count} ${count === 1 ? 'activity' : 'activities'}`;
    const bits: string[] = [];
    if (r.added.length) bits.push(`${r.added.length} activity ${r.added.length === 1 ? 'type was' : 'types were'} added to the Activity Library on default rates (${r.added.join(', ')})`);
    if (r.restored.length) bits.push(`${r.restored.length} retired ${r.restored.length === 1 ? 'key was' : 'keys were'} restored (${r.restored.join(', ')})`);
    actions.notify('ok', bits.length ? `Forced ${acts} into the budget. ${bits.join('; ')}. Price them in the Activity Library, then Save.` : `Forced ${acts} into the budget. Save to write.`);
  };

  /** The In budget? column. Including also makes the type priceable; the rest is a plain edit. */
  const setVisibility = (row: BudgetRow, v: ActivityVisibility | undefined) => {
    setOv(row.activityId, { visibility: v });
    if (v === 'INCLUDED') reportPriceable(ensurePriceable([row.activityType]), 1);
  };

  /**
   * Apply the same edit to everything currently filtered into view.
   *
   * The filters ARE the selection. A checkbox column would be a second way to say
   * what a row of dropdowns already says, and the two would disagree the moment a
   * filter changed under a set of ticks. What you can see is what it touches, the
   * count is in the button, and the confirm says the number back.
   */
  const applyToShown = (patch: Partial<ActivityOverride>, verb: string) => {
    const ids = rows.map((r) => r.activityId);
    if (ids.length === 0) return;
    if (!confirm(`${verb}: ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}. Nothing is deleted and this can be undone here. Continue?`)) return;
    actions.update('overrides', (ovs) => upsertOverrides(ovs, ids, patch));
    if (patch.visibility === 'INCLUDED') reportPriceable(ensurePriceable(rows.map((r) => r.activityType)), ids.length);
    else actions.notify('ok', `${verb}: ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}. Save to write.`);
  };

  const setVisibilityOnShown = (v: ActivityVisibility | undefined) => {
    const verb = v === 'HIDDEN' ? 'Hide' : v === 'EXCLUDED' ? 'Exclude' : v === 'INCLUDED' ? 'Force into the budget' : 'Put back to automatic';
    applyToShown({ visibility: v }, verb);
  };

  const [showBulk, setShowBulk] = useState(false);
  const [bulkDiscipline, setBulkDiscipline] = useState('');
  const [bulkHours, setBulkHours] = useState('');
  const [bulkNote, setBulkNote] = useState('');
  const [bulkPhase, setBulkPhase] = useState('');
  const [bulkLoc, setBulkLoc] = useState('');
  const [bulkSplit, setBulkSplit] = useState('');

  const dropStale = () => {
    const ids = new Set(model.staleOverrides.map((o) => normKey(o.activityId)));
    if (!confirm(`Delete ${ids.size} edits whose Activity ID is not in the current schedule? They cannot be recovered.`)) return;
    actions.update('overrides', (ovs) => ovs.filter((o) => !ids.has(normKey(o.activityId))));
    actions.notify('ok', `Removed ${ids.size} edits pointing at activities that are gone. Save to write.`);
  };

  /**
   * Every resource code any budgeted activity asks for, so the table can carry one
   * headcount column per resource. They are read off the rows rather than off the
   * subsystems file: a crew line can name a code nobody has registered, and a
   * column that silently omitted it would be a headcount that does not add up.
   */
  const resourceCodes = useMemo(() => {
    const codes = new Set<string>();
    for (const r of model.rows) for (const x of r.resources) if (x.code) codes.add(x.code);
    return [...codes].sort();
  }, [model.rows]);

  const opts = (vals: string[]) => [{ value: '', label: 'All' }, ...vals.filter(Boolean).sort().map((v) => ({ value: v, label: v }))];
  const locs = [...new Set(model.rows.flatMap((r) => r.locationShares.map((s) => s.code)))];
  const locName = (code: string) => locationLabel(code, state.data.locations);
  const subs = model.subsystems.map((x) => x.code).filter(Boolean);
  const phases = [...new Set(model.rows.map((r) => r.phase))];
  const works = [...new Set(model.rows.map((r) => r.workType))];
  // One option per subsystem named, not per combination of them.
  const discs = [...new Set(model.rows.flatMap((r) => r.disciplines))];
  const total = rows.reduce((s, r) => s + r.budgetHours, 0);
  const earned = rows.reduce((s, r) => s + r.earnedHours, 0);

  const columns: Column<BudgetRow>[] = [
    {
      key: 'id',
      label: 'Activity ID',
      locked: true,
      value: (r) => r.activityId,
      hint: 'The P6 code. Never editable: it is the key everything joins on, and the only thing that carries your edits across an import.',
      render: (r) => (
        <span className="font-mono text-[11px]" title={`${r.activity.rawActivityId}\nSet by P6. Not editable.`}>
          {r.activityId}
        </span>
      ),
    },
    {
      key: 'name',
      label: 'Activity name',
      value: (r) => r.activityName,
      hint: 'Editable. Your name replaces the P6 one everywhere. The P6 name is kept and still decides the activity type, so a rename can never re-price the activity. Clear the cell to go back to the P6 name.',
      width: '260px',
      render: (r) => (
        <div className="flex items-center gap-1">
          <CellInput
            className="cell-input cell-wide"
            value={r.activityName}
            title={r.renamed ? `Renamed by you. P6 calls this:\n${r.activity.activityName}` : 'Type to rename. Clear it to go back to the P6 name.'}
            onCommit={(v) => setOv(r.activityId, { nameOverride: v.trim() === r.activity.activityName ? undefined : v })}
          />
          {r.renamed && (
            <span className="shrink-0" title={`P6 calls this:\n${r.activity.activityName}`}>
              <Badge tone="purple">edited</Badge>
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'vis',
      label: 'In budget?',
      value: (r) => r.visibility ?? '',
      hint: 'Editable: your decision for this one activity. Auto follows the Activity Library. Include budgets it whatever the library or a P6 (Deleted) marker says. Exclude keeps it listed with no hours, out of every total and the percent complete. Hide (remove) takes it off every screen, total and curve — nothing is deleted, and the Hidden view brings it back.',
      render: (r) => (
        <Select
          value={r.visibility ?? ''}
          options={VISIBILITY_OPTIONS}
          onChange={(v) => setVisibility(r, (v || undefined) as ActivityVisibility | undefined)}
        />
      ),
    },
    {
      key: 'status',
      label: 'Status',
      value: (r) => r.status,
      render: (r) => (
        <span className="flex items-center gap-1">
          <Badge tone={statusTone(r.status)}>{r.status}</Badge>
          {r.visibility === 'INCLUDED' && <Badge tone="purple">forced</Badge>}
          {r.visibility === 'EXCLUDED' && <Badge tone="purple">by you</Badge>}
        </span>
      ),
    },
    {
      key: 'why',
      label: 'Why / what to do',
      value: (r) => r.statusReason,
      width: '340px',
      hint: 'Why an activity is not in the budget — or is, at zero hours — and what to do about it. Blank for an activity in the budget carrying hours.',
      render: (r) =>
        r.statusReason ? (
          <span className={`cell-text${r.status === 'REVIEW' ? ' tone-warn' : ''}`} title={r.statusReason}>
            {r.statusReason}
          </span>
        ) : (
          <span className="text-[var(--text-subtle)]">—</span>
        ),
    },
    {
      key: 'phase',
      label: 'Phase',
      value: (r) => r.phaseName,
      hint: 'Editable. Moves this one activity to another phase — type 3, P3 or Phase 3. Clear it to go back to what the Activity ID (or an Activity ID Rule) says. P6 is never changed.',
      render: (r) => (
        <span className="flex items-center gap-1">
          <CellInput
            className="cell-input w-20"
            value={r.phaseEdited ? r.phase : ''}
            placeholder={r.phaseName}
            list="budget-phases"
            title={r.phaseEdited ? `Moved here by hand. Clear to go back to ${phaseLabel(phaseOf(r.activity.activityId))}.` : 'Type a phase to move this activity. Blank follows the Activity ID.'}
            onCommit={(v) => setOv(r.activityId, { phase: v.trim() || undefined })}
          />
          {r.phaseEdited && <Badge tone="purple">moved</Badge>}
          {r.phaseFromRule && <Badge tone="muted">rule</Badge>}
        </span>
      ),
    },
    {
      key: 'loc',
      label: 'Loc',
      value: (r) => r.location,
      hint: 'Editable. Moves this one activity to another location, and its complexity factor with it. Clear it to go back to what the Activity ID (or an Activity ID Rule) says. P6 is never changed.',
      render: (r) => (
        <span className="flex items-center gap-1">
          <CellInput
            className="cell-input w-20"
            value={r.locationEdited ? r.location : ''}
            placeholder={r.location}
            list="budget-locations"
            title={r.locationEdited ? `Moved here by hand. Clear to go back to ${r.activity.location}.` : 'Type a location to move this activity. Blank follows the Activity ID.'}
            onCommit={(v) => setOv(r.activityId, { location: v.trim() || undefined })}
          />
          {r.locationEdited && <Badge tone="purple">moved</Badge>}
          {r.locationFromRule && <Badge tone="muted">rule</Badge>}
        </span>
      ),
    },
    {
      key: 'split',
      label: 'Split',
      value: (r) => (r.locationSplit ? formatLocationSplit(r.locationShares) : ''),
      hint: 'Editable. Shares this activity between locations, e.g. W40 50, 2W 50. Whatever the percentages leave stays at the Loc, so W40 50 alone means half here and half at W40; locations named without a percentage share the rest evenly. Hours, earned hours and the complexity factor are divided the same way on every rollup by location. Clear it to put all of it back at the Loc.',
      render: (r) => (
        <span className="flex items-center gap-1">
          <CellInput
            className="cell-input cell-long"
            value={r.locationSplit ? formatLocationSplit(r.locationShares) : ''}
            placeholder="—"
            title={r.locationSplit ? r.locationShares.map((x) => `${x.name}: ${fmtPct(x.share, 0)} — ${fmtHours(r.budgetHours * x.share)} h`).join('\n') : `All of it at ${r.locationName}. Type e.g. W40 50 to send half of it there.`}
            onCommit={(v) => setSplit(r, v)}
          />
          {r.locationSplit && <Badge tone="purple">split</Badge>}
        </span>
      ),
    },
    {
      key: 'locname',
      label: 'Location',
      value: (r) => r.locationName,
      hint: 'The location as every report shows it: the name given on the Locations screen, or the code where it has none, with each share when the activity is split. Name a code on the Locations screen.',
      render: (r) => (
        <span className="cell-text" title={r.locationShares.map((x) => `${x.code}${x.name !== x.code ? ` = ${x.name}` : ''}${r.locationSplit ? ` — ${fmtPct(x.share, 0)}` : ''}`).join('\n')}>
          {r.locationName}
        </span>
      ),
    },
    {
      key: 'key',
      label: 'Match key',
      value: (r) => r.matchKey,
      render: (r) => (
        <span className="cell-text" title={r.matchKey}>
          {r.matchKey}
        </span>
      ),
    },
    { key: 'rate', label: 'Rate', value: (r) => r.rateStatus, render: (r) => (r.status === 'IN BUDGET' ? <Badge tone={statusTone(r.rateStatus)}>{r.rateStatus}</Badge> : '') },
    {
      key: 'disc',
      label: TERMS.discipline,
      value: (r) => r.discipline,
      hint: 'Editable. Overrides the discipline the Activity Library gives this type, for this one activity. Clear it to follow the library again.',
      render: (r) => (
        <CellInput
          className="cell-input cell-wide"
          value={r.discipline}
          placeholder="—"
          title="Set for this activity only. Clear to follow the Activity Library."
          onCommit={(v) => setOv(r.activityId, { discipline: v })}
        />
      ),
    },
    {
      key: 'res',
      label: TERMS.subsystemPlural,
      value: (r) => r.resources.map((x) => `${x.label} x${x.count}`).join(', '),
      hint: `Who this activity is crewed with and how many of each, from the crew on its Activity Library key. Hours are that ${TERMS.subsystemLower}'s share of this activity's budget.`,
      render: (r) =>
        r.resources.length === 0 ? (
          <span className="text-[var(--text-subtle)]">—</span>
        ) : (
          <span className="cell-text" title={r.resources.map((x) => `${x.count} x ${x.label} — ${fmtHours(x.budgetHours)} h of ${fmtHours(r.budgetHours)} h`).join('\n')}>
            {r.resources.map((x, i) => (
              <span key={x.code || '#'} className="whitespace-nowrap">
                {i > 0 && <span className="text-[var(--text-subtle)]"> · </span>}
                {x.label} <b className="tabular-nums">×{x.count}</b>
              </span>
            ))}
          </span>
        ),
    },
    {
      key: 'crew',
      label: 'Crew',
      value: (r) => r.crewSize,
      num: true,
      hint: 'Heads on this activity, across every resource line. It is what the hours were priced from, not a roster.',
      render: (r) => (r.crewSize ? r.crewSize : <span className="text-[var(--text-subtle)]">—</span>),
    },
    /*
     * One column per resource code, off until asked for. Ticking the two you run and
     * exporting gives the allocation matrix — activity down the side, heads across
     * the top — which is the question this screen gets asked and could not answer.
     */
    ...resourceCodes.map<Column<BudgetRow>>((code) => ({
      key: `res:${code}`,
      label: code,
      optional: true,
      num: true,
      hint: `Heads of ${code} on this activity.`,
      value: (r) => r.resources.find((x) => x.code === code)?.count ?? '',
      render: (r) => {
        const x = r.resources.find((y) => y.code === code);
        return x ? <span title={`${fmtHours(x.budgetHours)} h of this activity's ${fmtHours(r.budgetHours)} h`}>{x.count}</span> : <span className="text-[var(--text-subtle)]">—</span>;
      },
    })),
    { key: 'basis', label: 'Basis', value: (r) => r.basis ?? '' },
    { key: 'od', label: 'OD', value: (r) => r.activity.originalDuration, num: true, hint: 'Original Duration in days, straight from P6 and never editable here. Change it in P6 and re-import.' },
    { key: 'cx', label: 'Cx', value: (r) => r.complexity, num: true, render: (r) => (r.complexity === null ? '' : r.complexity.toFixed(2)) },
    { key: 'std', label: 'Std h', value: (r) => r.stdHours, num: true, render: (r) => fmtHours(r.stdHours) },
    {
      key: 'ov',
      label: 'Override h',
      value: (r) => r.overrideHours,
      num: true,
      render: (r) =>
        r.status === 'IN BUDGET' ? (
          <CellInput
            type="number"
            className="cell-input text-right"
            value={r.overrideHours?.toString() ?? ''}
            placeholder="—"
            title="Replaces the computed hours; bypasses the complexity factor"
            onCommit={(v) => setOv(r.activityId, { overrideHours: num(v) })}
          />
        ) : (
          ''
        ),
    },
    {
      key: 'note',
      label: 'Note',
      value: (r) => ovOf(r.activityId)?.note ?? '',
      hint: 'Editable. Why this activity was renamed, hidden, excluded or re-priced. It rides along into the export.',
      render: (r) => (
        <CellInput className="cell-input cell-wide" value={ovOf(r.activityId)?.note ?? ''} placeholder="why" onCommit={(v) => setOv(r.activityId, { note: v })} />
      ),
    },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => <b>{fmtHours(r.budgetHours)}</b> },
    { key: 'bls', label: 'BL start', value: (r) => r.baselineStart, render: (r) => fmtDate(r.baselineStart) },
    { key: 'blf', label: 'BL finish', value: (r) => r.baselineFinish, render: (r) => fmtDate(r.baselineFinish) },
    { key: 'blsrc', label: 'BL src', value: (r) => r.baselineSource, render: (r) => <Badge tone={statusTone(r.baselineSource)}>{r.baselineSource}</Badge> },
    {
      key: 'cs',
      label: 'Cur start',
      value: (r) => r.currentStart,
      hint: 'Editable. A date typed here is used instead of P6’s everywhere — the forecast, the backlog, the staffing — until you clear it. P6’s own date stays beside it under P6 dates, for the scheduler.',
      render: (r) => <DateCell r={r} which="start" onCommit={(v) => setDate(r, 'start', v)} />,
    },
    {
      key: 'cf',
      label: 'Cur finish',
      value: (r) => r.currentFinish,
      hint: 'Editable. A date typed here is used instead of P6’s everywhere — the forecast, the backlog, the staffing — until you clear it. P6’s own date stays beside it under P6 dates, for the scheduler.',
      render: (r) => <DateCell r={r} which="finish" onCommit={(v) => setDate(r, 'finish', v)} />,
    },
    {
      key: 'p6dates',
      label: 'P6 dates',
      value: (r) => (r.datesEdited ? `${r.activity.startDate ?? ''} – ${r.activity.finishDate ?? ''}` : ''),
      exportValue: (r) => (r.datesEdited ? `${fmtDate(r.activity.startDate)} – ${fmtDate(r.activity.finishDate)}` : ''),
      hint: 'What P6 has, shown only where you have changed the dates. Once a later import agrees with you it says so, and the change can be cleared.',
      render: (r) =>
        !r.datesEdited ? (
          <span className="text-[var(--text-subtle)]">—</span>
        ) : (
          <span className="flex items-center gap-1 whitespace-nowrap">
            <span className="text-[var(--text-muted)]">{fmtDate(r.activity.startDate)} – {fmtDate(r.activity.finishDate)}</span>
            {r.p6Agrees ? (
              <button className="btn-link text-[11px]" title="P6 now has the dates you keyed. Clear yours." onClick={() => setOv(r.activityId, { startDate: undefined, finishDate: undefined })}>
                <Badge tone="good">P6 agrees — clear</Badge>
              </button>
            ) : (
              <Badge tone="warn">differs</Badge>
            )}
          </span>
        ),
    },
    {
      key: 'dnote',
      label: 'Date note',
      value: (r) => r.dateNote,
      hint: 'Editable. Why the dates were changed — what to raise with the scheduler at the next review.',
      render: (r) => (
        <CellInput className="cell-input cell-wide" value={r.dateNote} placeholder="—" onCommit={(v) => setOv(r.activityId, { dateNote: v.trim() || undefined })} />
      ),
    },
    { key: 'pct', label: '% complete', value: (r) => r.pctComplete, num: true, render: (r) => fmtPct(r.pctComplete, 0) },
    { key: 'pctsrc', label: '% src', value: (r) => r.pctSource, render: (r) => <Badge tone={statusTone(r.pctSource)}>{r.pctSource}</Badge> },
    { key: 'es', label: 'Earn start', value: (r) => r.earnStart, render: (r) => fmtDate(r.earnStart) },
    { key: 'ee', label: 'Earn end', value: (r) => r.earnEnd, render: (r) => fmtDate(r.earnEnd) },
    { key: 'esrc', label: 'Window', value: (r) => r.earnWindowSource, render: (r) => <Badge tone={statusTone(r.earnWindowSource)}>{r.earnWindowSource}</Badge> },
    { key: 'earned', label: 'Earned h', value: (r) => r.earnedHours, num: true, render: (r) => fmtHours(r.earnedHours, 1) },
    { key: 'rem', label: 'Remaining h', value: (r) => r.remainingHours, num: true, render: (r) => fmtHours(r.remainingHours, 1) },
  ];

  /*
   * Forced in, but still unpriceable. Forcing in creates the library key, so the
   * only way to land here is to retire that key again afterwards. It is worth
   * saying out loud rather than leaving the row sitting in REVIEW looking ignored,
   * because "I forced it in and it went nowhere" is exactly the confusion the key
   * creation exists to prevent.
   */
  const forcedButUnpriced = useMemo(() => model.rows.filter((r) => r.visibility === 'INCLUDED' && r.status === 'REVIEW'), [model.rows]);

  /*
   * Forced in, in the budget, and worth nothing.
   *
   * This is the other half of "I forced it in and nothing happened", and it is the
   * half that looks fine: the row says IN BUDGET, it appears on Progress, and
   * it contributes zero to every total. Three things cause it — a P6 duration of
   * zero (a milestone), a duration P6 never supplied, and a RATE-basis key with no
   * shift count — and none of them are visible from the row.
   */
  const forcedAtZero = useMemo(
    () => model.rows.filter((r) => r.visibility === 'INCLUDED' && r.status === 'IN BUDGET' && r.budgetHours === 0),
    [model.rows],
  );

  /** Give every zero-priced forced-in row the same hours, since they are usually alike. */
  const priceForcedAtZero = () => {
    const raw = prompt(
      `Set budget hours on ${forcedAtZero.length} forced-in ${forcedAtZero.length === 1 ? 'activity' : 'activities'} that currently carry none.\n\n` +
        'This writes an hours override on each one, which is independent of the Activity Library and survives every import.',
      '8',
    );
    const n = num(raw ?? '');
    if (n === undefined || n <= 0) return;
    const ids = forcedAtZero.map((r) => r.activityId);
    actions.update('overrides', (ovs) => upsertOverrides(ovs, ids, { overrideHours: n }));
    actions.notify('ok', `Set ${n} h on ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}. Save to write.`);
  };

  const hiddenCount = model.summary.hidden;
  const inBudgetCount = model.rows.filter((r) => r.status === 'IN BUDGET').length;
  const outCount = model.rows.filter(isOut).length;
  const pct = total ? earned / total : 0;
  const subtitle =
    view === 'hidden'
      ? `${rows.length} of ${hiddenCount} hidden activities. They are in no total, no curve and no export. Priced here as if they were back in, so you can see what each one would add: ${fmtHours(total)} h.`
      : view === 'excluded'
        ? `${rows.length} of ${outCount} activities listed but out of the budget: excluded by you, excluded by their Activity Library key, or marked (Deleted) or (Cancelled) in P6. They carry no hours and are in no total and not in the percent complete. Why / what to do says which, and In budget? brings one back.`
        : `${rows.length} of ${view === 'inbudget' ? inBudgetCount : model.rows.length} activities shown. Budget ${fmtHours(total)} h, earned ${fmtHours(earned)} h — ${fmtPct(pct, 1)} complete${rows.length === model.rows.length || view === 'inbudget' ? ', the figure on the Dashboard' : ' for what is shown'}. Name, In budget?, Phase, Loc, Split, Cur start, Cur finish, ${TERMS.discipline}, Override h and Note are yours to edit and survive every import; everything from P6 is read-only.`;

  return (
    <Page
      eyebrow="Budget"
      title="Budget Master"
      subtitle={subtitle}
      toolbar={
        <>
          <select className="input" value={view} onChange={(e) => setView(e.target.value as View)} title="Which activities to list. Hidden ones are kept but take no part in anything.">
            <option value="active">All activities ({model.rows.length})</option>
            <option value="inbudget">In the budget — what the percent counts ({inBudgetCount})</option>
            <option value="excluded">Excluded — listed, no hours ({outCount})</option>
            <option value="hidden">Hidden — removed by you ({hiddenCount})</option>
          </select>
          <input className="input" placeholder="Search ID, name, key" value={text} onChange={(e) => setText(e.target.value)} />
          <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>{opts(phases).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All phases' : (model.groups.phase.find((g) => g.key === o.value)?.label ?? o.label)}</option>)}</select>
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>{opts(locs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All locations' : locName(o.value) !== o.value ? `${locName(o.value)} (${o.value})` : o.label}</option>)}</select>
          <select className="input" value={work} onChange={(e) => setWork(e.target.value)}>{opts(works).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All work types' : o.label}</option>)}</select>
          <select className="input" value={disc} onChange={(e) => setDisc(e.target.value)}>{opts(discs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? `All ${TERMS.disciplineLowerPlural}` : o.label}</option>)}</select>
          {subs.length > 0 && (
            <select className="input" value={sub} onChange={(e) => setSub(e.target.value)} title={`Activities whose crew includes this ${TERMS.subsystemLower}`}>
              {opts(subs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? `All ${TERMS.subsystemLowerPlural}` : o.label}</option>)}
            </select>
          )}
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{opts(['IN BUDGET', 'EXCLUDED', 'REVIEW', 'DELETED', 'CANCELLED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All statuses' : o.label}</option>)}</select>
          <select className="input" value={win} onChange={(e) => setWin(e.target.value)}>{opts(['TEST WINDOW', 'P6 ACTUAL', 'IN PROGRESS', 'NOT STARTED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All windows' : o.label}</option>)}</select>
          <select className="input" value={flag ?? ''} onChange={(e) => { window.location.hash = e.target.value ? `#/budget?flag=${e.target.value}` : '#/budget'; }}>
            <option value="">No quality filter</option>
            {Object.entries(FLAGS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
          <button className={`btn btn-mini${showBulk ? ' btn-primary' : ''}`} onClick={() => setShowBulk((v) => !v)}>
            Bulk edit
          </button>
          <span className="ml-auto flex items-center gap-2">
            {view === 'excluded' ? (
              <>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Clear your decision on each: the Activity Library decides again" onClick={() => setVisibilityOnShown(undefined)}>
                  Back to Auto {rows.length}
                </button>
                <button className="btn btn-mini btn-primary" disabled={rows.length === 0} title="Budget every one of them, whatever the library or P6 says" onClick={() => setVisibilityOnShown('INCLUDED')}>
                  Include {rows.length}
                </button>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Take them off every list. Reversible from the Hidden view." onClick={() => setVisibilityOnShown('HIDDEN')}>
                  Hide {rows.length}
                </button>
              </>
            ) : view !== 'hidden' ? (
              <>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Take every activity in view out of the program. Reversible from the Hidden view." onClick={() => setVisibilityOnShown('HIDDEN')}>
                  Hide {rows.length}
                </button>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Leave them listed but carrying no hours, out of the percent complete" onClick={() => setVisibilityOnShown('EXCLUDED')}>
                  Exclude {rows.length}
                </button>
              </>
            ) : (
              <button className="btn btn-mini btn-primary" disabled={rows.length === 0} title="Put them back where the Activity Library decides" onClick={() => setVisibilityOnShown(undefined)}>
                Unhide {rows.length}
              </button>
            )}
          </span>
        </>
      }
    >
      <datalist id="budget-phases">
        {[...new Map(model.rows.map((r) => [r.phase, r.phaseName])).entries()]
          .filter(([p]) => p)
          .sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }))
          .map(([p, name]) => (
            <option key={p} value={p}>{name}</option>
          ))}
      </datalist>
      <datalist id="budget-locations">
        {[...new Set([...locs, ...state.data.locations.map((l) => l.code)])].filter(Boolean).sort().map((l) => (
          <option key={l} value={l}>{locName(l) !== l ? locName(l) : undefined}</option>
        ))}
      </datalist>
      <datalist id="budget-disciplines">
        {[...new Set(model.rows.flatMap((r) => r.disciplines))].filter(Boolean).sort().map((d) => (
          <option key={d} value={d} />
        ))}
      </datalist>

      {showBulk && (
        <Panel
          title={`Edit all ${rows.length} activities in view`}
          meta="The filters above are the selection. Each box applies on its own button, and a blank box clears that field rather than leaving it."
          className="mb-3"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">{TERMS.subsystem}</div>
              <div className="mt-1 flex gap-2">
                <input
                  className="input w-40"
                  list="budget-disciplines"
                  placeholder="ATS, IXL"
                  value={bulkDiscipline}
                  onChange={(e) => setBulkDiscipline(e.target.value)}
                />
                <button
                  className="btn"
                  disabled={rows.length === 0}
                  onClick={() => applyToShown({ discipline: bulkDiscipline.trim() || undefined }, bulkDiscipline.trim() ? `Set ${TERMS.subsystemLower} to "${bulkDiscipline.trim()}"` : `Clear the ${TERMS.subsystemLower}`)}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Overrides the Activity Library for these activities only. Several groups can be named at once — they split the hours evenly.
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Budget hours</div>
              <div className="mt-1 flex gap-2">
                <input className="input w-28" type="number" step="any" placeholder="hours" value={bulkHours} onChange={(e) => setBulkHours(e.target.value)} />
                <button
                  className="btn"
                  disabled={rows.length === 0 || (bulkHours.trim() !== '' && num(bulkHours) === undefined)}
                  onClick={() => applyToShown({ overrideHours: bulkHours.trim() === '' ? undefined : num(bulkHours) }, bulkHours.trim() === '' ? 'Hand the hours back to the rate' : `Set the budget to ${num(bulkHours)} h`)}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Replaces the calculated figure and bypasses the complexity factor. Blank hands each activity back to its rate.
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Phase</div>
              <div className="mt-1 flex gap-2">
                <input className="input w-28" list="budget-phases" placeholder="P3" value={bulkPhase} onChange={(e) => setBulkPhase(e.target.value)} />
                <button
                  className="btn"
                  disabled={rows.length === 0}
                  onClick={() => applyToShown({ phase: bulkPhase.trim() || undefined }, bulkPhase.trim() ? `Move to ${phaseLabel(normalisePhaseValue(bulkPhase))}` : 'Put back in the phase the Activity ID says')}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Moves these activities to another phase. Blank puts each back where its Activity ID (or a rule) puts it.
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Location</div>
              <div className="mt-1 flex gap-2">
                <input className="input w-28" list="budget-locations" placeholder="B20" value={bulkLoc} onChange={(e) => setBulkLoc(e.target.value)} />
                <button
                  className="btn"
                  disabled={rows.length === 0}
                  onClick={() => applyToShown({ location: bulkLoc.trim() || undefined }, bulkLoc.trim() ? `Move to location ${bulkLoc.trim()}` : 'Put back at the location the Activity ID says')}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Moves these activities to another location, and its complexity factor with them. Blank puts each back.
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Split across locations</div>
              <div className="mt-1 flex gap-2">
                <input className="input w-40" placeholder="W40 50, 2W 50" value={bulkSplit} onChange={(e) => setBulkSplit(e.target.value)} />
                <button
                  className="btn"
                  disabled={rows.length === 0}
                  onClick={() => {
                    const split = readSplit(bulkSplit);
                    if (split === null) return;
                    applyToShown({ locationSplit: split }, split ? `Split as ${formatLocationSplit(split)}` : 'Put all of each back at its own location');
                  }}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Shares each activity's hours between locations. Whatever the percentages leave stays at each activity's own location. Blank clears the split.
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Note</div>
              <div className="mt-1 flex gap-2">
                <input className="input w-48" placeholder="why" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
                <button
                  className="btn"
                  disabled={rows.length === 0}
                  onClick={() => applyToShown({ note: bulkNote.trim() || undefined }, bulkNote.trim() ? 'Set the note' : 'Clear the note')}
                >
                  Apply
                </button>
              </div>
              <div className="mt-1 text-[11.5px] text-[var(--text-subtle)]">
                Why this activity was re-priced, renamed or taken out. Not the progress note, which the Two-Week Log writes.
              </div>
            </div>
          </div>
        </Panel>
      )}

      {view === 'hidden' && rows.length === 0 && hiddenCount === 0 && (
        <div className="mb-3">
          <Notice tone="info">
            Nothing is hidden. Hiding is for schedule rows that are noise rather than work — placeholders, duplicates, activities that belong to another contractor. Set a
            row's <b>In budget?</b> column to Hide (remove), or filter the list and use the Hide button. Nothing is deleted: the P6 import keeps every row exactly as exported, and
            anything hidden comes back from here.
          </Notice>
        </div>
      )}

      {view !== 'hidden' && forcedAtZero.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <b>{forcedAtZero.length} forced-in {forcedAtZero.length === 1 ? 'activity carries' : 'activities carry'} no hours.</b> They are in the budget and listed on Test
            Progress, but they add nothing to any total, so forcing them in looks like it did nothing. The usual reasons are a P6 duration of zero, a duration P6 never
            gave, or a RATE-basis key with no shift count.{' '}
            <a href={href('budget', { flag: 'forcedzero' })}>Show just these</a>, then either price their type in the{' '}
            <a href={href('library')}>Activity Library</a> or type hours into <b>Override h</b> on each row.{' '}
            <button className="btn-link" onClick={priceForcedAtZero}>Set hours on all {forcedAtZero.length}</button>
          </Notice>
        </div>
      )}

      {view !== 'hidden' && forcedButUnpriced.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <b>{forcedButUnpriced.length} {forcedButUnpriced.length === 1 ? 'activity is' : 'activities are'} forced into the budget but cannot be priced.</b> Their activity
            type has no live key in the <a href={href('library')}>Activity Library</a> — it was most likely retired after they were forced in. Until a key matches the type
            exactly they carry no hours and stay out of Progress.{' '}
            {[...new Set(forcedButUnpriced.map((r) => r.activityType))].slice(0, 4).map((t) => (
              <code key={t} className="mono mr-2">{t}</code>
            ))}
          </Notice>
        </div>
      )}

      {view !== 'hidden' && flag === 'dates' && (
        <div className="mb-3">
          <Notice tone="info">
            {rows.length === 0 ? (
              <>No activity is using dates of yours. Key a <b>Cur start</b> or <b>Cur finish</b> on any row to use it instead of P6’s until the schedule is corrected.</>
            ) : (
              <>
                <b>
                  {rows.length} {rows.length === 1 ? 'activity is' : 'activities are'} using your dates instead of P6’s.
                </b>{' '}
                <b>P6 dates</b> shows what the schedule has beside each, and <b>Date note</b> says why — the <b>Excel</b> button on the table hands the list to the scheduler.
                {rows.some((r) => r.p6Agrees) && (
                  <>
                    {' '}
                    {rows.filter((r) => r.p6Agrees).length} now match P6 after the latest import.{' '}
                    <button
                      className="btn btn-mini"
                      onClick={() => {
                        const agree = rows.filter((r) => r.p6Agrees);
                        for (const r of agree) setOv(r.activityId, { startDate: undefined, finishDate: undefined, dateNote: undefined });
                        actions.notify('ok', `Cleared ${agree.length} date ${agree.length === 1 ? 'change' : 'changes'} P6 now agrees with. Save to write.`);
                      }}
                    >
                      Clear those
                    </button>
                  </>
                )}
              </>
            )}
          </Notice>
        </div>
      )}

      {view === 'active' && (flag === 'review' || status === 'REVIEW') && <ReviewPanel rows={model.rows} />}
      {view !== 'hidden' && flag !== 'review' && status !== 'REVIEW' && model.summary.review > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <b>{model.summary.review} {model.summary.review === 1 ? 'activity is' : 'activities are'} in REVIEW:</b> no rate, so no hours, and not in the percent complete.{' '}
            <a href={href('budget', { flag: 'review' })}>See what they are and what each needs</a>.
          </Notice>
        </div>
      )}
      {flag === 'nostart' && rows.length > 0 && (
        <div className="mb-3">
          <Notice tone="info">
            <b>{rows.length} {rows.length === 1 ? 'activity has' : 'activities have'} a percent complete but no actual start</b>, worth {fmtHours(earned)} earned h. Those hours
            are in the percent complete, but the earned curve places hours between an activity’s actual start and finish, so they are on no curve. Key an actual start on
            Progress or the Two-Week Log and they join the curve on that date.
          </Notice>
        </div>
      )}

      {view !== 'hidden' && model.staleOverrides.length > 0 && (
        <Panel
          title={`${model.staleOverrides.length} of your edits point at an activity that is not in this schedule`}
          meta={<button className="btn-link danger" onClick={dropStale}>delete them all</button>}
          className="mb-3"
        >
          <p className="text-[12px] text-[var(--text-muted)]">
            They are keyed on an Activity ID the current import does not contain — renumbered in P6, removed, or imported from a different project. Nothing is lost: they
            are kept exactly as they are and start working again the moment an activity with that ID comes back.
          </p>
          <ul className="mt-2 max-h-40 overflow-auto text-[12px]">
            {model.staleOverrides.map((o) => (
              <li key={o.activityId} className="py-0.5">
                <code className="mono">{o.activityId}</code>
                <span className="ml-2 text-[var(--text-muted)]">
                  {[o.renamed ? 'renamed' : null, o.hasHours ? 'hours override' : null, o.visibility ? o.visibility.toLowerCase() : null, o.note || null]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <SortableTable
        rows={rows}
        columns={columns}
        tableId="budget-master"
        exportName="budget-master"
        rowKey={(r) => `${r.activityId}#${r.activity.sortOrder}`}
        maxHeight="calc(100vh - 240px)"
        rowClass={(r) => (r.status === 'REVIEW' ? 'row-bad' : r.baselineSource === 'NONE' ? 'row-bad' : r.status !== 'IN BUDGET' ? 'row-muted' : '')}
      />
    </Page>
  );
}

/**
 * A current-schedule date that can be keyed over. Shows P6's date when it is P6's,
 * yours with a marker when it is yours, and the unparseable text P6 sent when there
 * is nothing to show.
 */
function DateCell({ r, which, onCommit }: { r: BudgetRow; which: 'start' | 'finish'; onCommit: (v: string) => void }) {
  const value = which === 'start' ? r.currentStart : r.currentFinish;
  const p6 = which === 'start' ? r.activity.startDate : r.activity.finishDate;
  const actual = which === 'start' ? r.activity.actualStart : r.activity.actualFinish;
  const raw = which === 'start' ? r.activity.startRaw : r.activity.finishRaw;
  const mine = (value ?? null) !== (p6 ?? null);
  return (
    <span className="flex items-center gap-1 whitespace-nowrap">
      <CellInput
        type="date"
        className={`cell-input${mine ? ' font-semibold' : ''}`}
        value={value ?? ''}
        title={mine ? `Yours. P6 has ${fmtDate(p6)}. Clear it, or key P6's date, to go back.` : 'From P6. Key a date to use instead until the schedule is corrected.'}
        onCommit={onCommit}
      />
      {actual && !mine && <span className="text-[var(--text-muted)]">A</span>}
      {mine && <Badge tone="purple">yours</Badge>}
      {!value && raw && <span className="text-[var(--bad)]" title="unparseable">({raw})</span>}
    </span>
  );
}

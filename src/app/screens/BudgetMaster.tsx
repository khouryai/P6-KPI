import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Select, Badge, Notice, Panel, statusTone, type Column } from '../components/ui';
import type { ActivityOverride, ActivityVisibility, BudgetRow } from '../../engine/types';
import { fmtHours, fmtPct, fmtDate, num } from '../format';
import { normKey } from '../../engine/keys';
import { href, type Route } from '../router';

const FLAGS: Record<string, { label: string; test: (r: BudgetRow) => boolean }> = {
  review: { label: 'Needing REVIEW', test: (r) => r.status === 'REVIEW' },
  nodates: { label: 'No dates at all', test: (r) => r.baselineSource === 'NONE' },
  nocurve: { label: 'In budget but on no curve', test: (r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve },
  blcurrent: { label: 'Baseline falling back to current dates', test: (r) => r.baselineSource === 'CURRENT' },
  pctp6: { label: 'Percent complete from P6 duration', test: (r) => r.pctSource === 'P6' && r.status === 'IN BUDGET' },
  shifts: { label: 'RATE type missing shifts', test: (r) => r.needsShifts },
  override: { label: 'Has an hours override', test: (r) => r.overrideHours !== null },
  edited: { label: 'Carries an edit of yours', test: (r) => r.renamed || r.visibility !== null || r.overrideHours !== null },
};

/** What the Show column offers, in the order a person works through them. */
const VISIBILITY_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: 'Auto' },
  { value: 'INCLUDED', label: 'Force in' },
  { value: 'EXCLUDED', label: 'Exclude' },
  { value: 'HIDDEN', label: 'Hide' },
];

/** Which set of activities the screen is looking at. */
type View = 'active' | 'hidden';

export function BudgetMaster({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [view, setView] = useState<View>(route.params.get('view') === 'hidden' ? 'hidden' : 'active');
  const [loc, setLoc] = useState(route.params.get('loc') ?? '');
  const [phase, setPhase] = useState(route.params.get('phase') ?? '');
  const [work, setWork] = useState(route.params.get('work') ?? '');
  const [disc, setDisc] = useState(route.params.get('disc') ?? '');
  const [sub, setSub] = useState(route.params.get('sub') ?? '');
  const [status, setStatus] = useState('');
  const [win, setWin] = useState('');
  const [text, setText] = useState('');

  const source = view === 'hidden' ? model.hiddenRows : model.rows;

  const rows = useMemo(() => {
    let r = source;
    if (flag && FLAGS[flag]) r = r.filter(FLAGS[flag].test);
    if (loc) r = r.filter((x) => x.location === loc);
    if (phase) r = r.filter((x) => x.phase === phase);
    if (work) r = r.filter((x) => x.workType === work);
    if (disc) r = r.filter((x) => x.discipline === disc);
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
    actions.update('overrides', (ovs) => {
      const i = ovs.findIndex((o) => normKey(o.activityId) === normKey(activityId));
      const base: ActivityOverride = i >= 0 ? ovs[i] : { activityId };
      const next = tidyOverride({ ...base, ...patch, activityId: base.activityId, updatedAt: new Date().toISOString() });
      const empty =
        next.overrideHours === undefined &&
        next.nameOverride === undefined &&
        next.discipline === undefined &&
        next.visibility === undefined &&
        next.note === undefined;
      if (empty) return i >= 0 ? ovs.filter((_, j) => j !== i) : ovs;
      return i >= 0 ? ovs.map((o, j) => (j === i ? next : o)) : [...ovs, next];
    });
  };

  const ovOf = (id: string) => state.data.overrides.find((o) => normKey(o.activityId) === normKey(id));

  /**
   * Forcing an activity into the budget is a promise the Activity Library has to be
   * able to keep, so this makes sure it can.
   *
   * An activity is priced through its type, and two kinds of type have no library
   * key at all: one P6 marked "(Deleted)" or "(Cancelled)" — import skips those on
   * purpose, since nobody wants a library full of dead work — and one whose key was
   * retired by hand. Forcing such an activity in used to move it from DELETED to
   * REVIEW and stop there: no rate could ever reach it, it carried no hours, and
   * because both the Activity Library and Test Progress are lists of priced things,
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
    actions.update('library', (prev) => [
      ...prev.map((e) => (restored.some((t) => normKey(t) === normKey(e.matchKey)) ? { ...e, retired: undefined } : e)),
      ...added.map((t) => ({ matchKey: t })),
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

  /** The Show column. Forcing in also makes the type priceable; the rest is a plain edit. */
  const setVisibility = (row: BudgetRow, v: ActivityVisibility | undefined) => {
    setOv(row.activityId, { visibility: v });
    if (v === 'INCLUDED') reportPriceable(ensurePriceable([row.activityType]), 1);
  };

  /** Set the same visibility on everything currently filtered into view. */
  const setVisibilityOnShown = (v: ActivityVisibility | undefined) => {
    const ids = rows.map((r) => r.activityId);
    if (ids.length === 0) return;
    const verb = v === 'HIDDEN' ? 'Hide' : v === 'EXCLUDED' ? 'Exclude' : v === 'INCLUDED' ? 'Force into the budget' : 'Put back to automatic';
    if (!confirm(`${verb}: ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}. Nothing is deleted and this can be undone here. Continue?`)) return;
    const stamp = new Date().toISOString();
    actions.update('overrides', (ovs) => {
      const next = [...ovs];
      for (const id of ids) {
        const i = next.findIndex((o) => normKey(o.activityId) === normKey(id));
        const base: ActivityOverride = i >= 0 ? next[i] : { activityId: id };
        const merged = tidyOverride({ ...base, visibility: v, updatedAt: stamp });
        const empty =
          merged.overrideHours === undefined &&
          merged.nameOverride === undefined &&
          merged.discipline === undefined &&
          merged.visibility === undefined &&
          merged.note === undefined;
        if (empty) {
          if (i >= 0) next.splice(i, 1);
        } else if (i >= 0) next[i] = merged;
        else next.push(merged);
      }
      return next;
    });
    if (v === 'INCLUDED') reportPriceable(ensurePriceable(rows.map((r) => r.activityType)), ids.length);
    else actions.notify('ok', `${verb.toLowerCase()}: ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}. Save to write.`);
  };

  const dropStale = () => {
    const ids = new Set(model.staleOverrides.map((o) => normKey(o.activityId)));
    if (!confirm(`Delete ${ids.size} edits whose Activity ID is not in the current schedule? They cannot be recovered.`)) return;
    actions.update('overrides', (ovs) => ovs.filter((o) => !ids.has(normKey(o.activityId))));
    actions.notify('ok', `Removed ${ids.size} edits pointing at activities that are gone. Save to write.`);
  };

  const opts = (vals: string[]) => [{ value: '', label: 'All' }, ...vals.filter(Boolean).sort().map((v) => ({ value: v, label: v }))];
  const locs = [...new Set(model.rows.map((r) => r.location))];
  const subs = model.subsystems.map((x) => x.code).filter(Boolean);
  const phases = [...new Set(model.rows.map((r) => r.phase))];
  const works = [...new Set(model.rows.map((r) => r.workType))];
  const discs = [...new Set(model.rows.map((r) => r.discipline))];
  const total = rows.reduce((s, r) => s + r.budgetHours, 0);
  const earned = rows.reduce((s, r) => s + r.earnedHours, 0);

  const columns: Column<BudgetRow>[] = [
    {
      key: 'id',
      label: 'Activity ID',
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
      label: 'Show',
      value: (r) => r.visibility ?? '',
      hint: 'Editable. Auto follows the Activity Library. Force in budgets it anyway. Exclude leaves it listed with no hours. Hide takes it out of every screen, total and curve — nothing is deleted and you can bring it back from the Hidden view.',
      render: (r) => (
        <Select
          value={r.visibility ?? ''}
          options={VISIBILITY_OPTIONS}
          onChange={(v) => setVisibility(r, (v || undefined) as ActivityVisibility | undefined)}
        />
      ),
    },
    { key: 'phase', label: 'Phase', value: (r) => r.phaseName },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
    {
      key: 'key',
      label: 'Match key',
      value: (r) => r.matchKey,
      render: (r) => (
        <span className="block max-w-xs truncate" title={r.matchKey}>
          {r.matchKey}
        </span>
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
    { key: 'rate', label: 'Rate', value: (r) => r.rateStatus, render: (r) => (r.status === 'IN BUDGET' ? <Badge tone={statusTone(r.rateStatus)}>{r.rateStatus}</Badge> : '') },
    {
      key: 'disc',
      label: 'Discipline',
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
    { key: 'cs', label: 'Cur start', value: (r) => r.currentStart, render: (r) => <>{fmtDate(r.currentStart)}{r.activity.actualStart ? ' A' : ''}{!r.currentStart && r.activity.startRaw ? <span className="text-[var(--bad)]" title="unparseable">{` (${r.activity.startRaw})`}</span> : null}</> },
    { key: 'cf', label: 'Cur finish', value: (r) => r.currentFinish, render: (r) => <>{fmtDate(r.currentFinish)}{r.activity.actualFinish ? ' A' : ''}{!r.currentFinish && r.activity.finishRaw ? <span className="text-[var(--bad)]" title="unparseable">{` (${r.activity.finishRaw})`}</span> : null}</> },
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

  const hiddenCount = model.summary.hidden;
  const subtitle =
    view === 'hidden'
      ? `${rows.length} of ${hiddenCount} hidden activities. They are in no total, no curve and no export. Priced here as if they were back in, so you can see what each one would add: ${fmtHours(total)} h.`
      : `${rows.length} of ${model.rows.length} activities shown. Budget ${fmtHours(total)} h, earned ${fmtHours(earned)} h. Name, Show, Discipline, Override h and Note are yours to edit and survive every import; everything from P6 is read-only.`;

  return (
    <Page
      eyebrow="Budget"
      title="Budget Master"
      subtitle={subtitle}
      toolbar={
        <>
          <select className="input" value={view} onChange={(e) => setView(e.target.value as View)} title="Hidden activities are kept but take no part in anything">
            <option value="active">Active activities</option>
            <option value="hidden">Hidden activities ({hiddenCount})</option>
          </select>
          <input className="input" placeholder="Search ID, name, key" value={text} onChange={(e) => setText(e.target.value)} />
          <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>{opts(phases).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All phases' : (model.groups.phase.find((g) => g.key === o.value)?.label ?? o.label)}</option>)}</select>
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>{opts(locs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All locations' : o.label}</option>)}</select>
          <select className="input" value={work} onChange={(e) => setWork(e.target.value)}>{opts(works).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All work types' : o.label}</option>)}</select>
          <select className="input" value={disc} onChange={(e) => setDisc(e.target.value)}>{opts(discs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All disciplines' : o.label}</option>)}</select>
          {subs.length > 0 && (
            <select className="input" value={sub} onChange={(e) => setSub(e.target.value)} title="Activities whose crew includes this subsystem">
              {opts(subs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All subsystems' : o.label}</option>)}
            </select>
          )}
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{opts(['IN BUDGET', 'EXCLUDED', 'REVIEW', 'DELETED', 'CANCELLED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All statuses' : o.label}</option>)}</select>
          <select className="input" value={win} onChange={(e) => setWin(e.target.value)}>{opts(['TEST WINDOW', 'P6 ACTUAL', 'IN PROGRESS', 'NOT STARTED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All windows' : o.label}</option>)}</select>
          <select className="input" value={flag ?? ''} onChange={(e) => { window.location.hash = e.target.value ? `#/budget?flag=${e.target.value}` : '#/budget'; }}>
            <option value="">No quality filter</option>
            {Object.entries(FLAGS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
          <span className="ml-auto flex items-center gap-2">
            {view === 'active' ? (
              <>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Take every activity in view out of the program. Reversible from the Hidden view." onClick={() => setVisibilityOnShown('HIDDEN')}>
                  Hide {rows.length}
                </button>
                <button className="btn btn-mini" disabled={rows.length === 0} title="Leave them listed but carrying no hours" onClick={() => setVisibilityOnShown('EXCLUDED')}>
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
      {view === 'hidden' && rows.length === 0 && hiddenCount === 0 && (
        <div className="mb-3">
          <Notice tone="info">
            Nothing is hidden. Hiding is for schedule rows that are noise rather than work — placeholders, duplicates, activities that belong to another contractor. Set a
            row's <b>Show</b> column to Hide, or filter the active list and use the Hide button. Nothing is deleted: the P6 import keeps every row exactly as exported, and
            anything hidden comes back from here.
          </Notice>
        </div>
      )}

      {view === 'active' && forcedButUnpriced.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <b>{forcedButUnpriced.length} {forcedButUnpriced.length === 1 ? 'activity is' : 'activities are'} forced into the budget but cannot be priced.</b> Their activity
            type has no live key in the <a href={href('library')}>Activity Library</a> — it was most likely retired after they were forced in. Until a key matches the type
            exactly they carry no hours and stay out of Test Progress.{' '}
            {[...new Set(forcedButUnpriced.map((r) => r.activityType))].slice(0, 4).map((t) => (
              <code key={t} className="mono mr-2">{t}</code>
            ))}
          </Notice>
        </div>
      )}

      {view === 'active' && flag === 'review' && rows.length > 0 && (
        <div className="mb-3">
          <Notice tone="warn">
            <b>{rows.length} activities have no rate.</b> Their activity type is not in the Activity Library, so they budget zero hours and sit here asking a question
            nobody has answered. Each one is either work (price its type in the <a href={href('library')}>Activity Library</a>, and every activity of that type is fixed at
            once) or it is not (set <b>Show</b> to Hide, or use <b>Hide {rows.length}</b> above to clear the whole list). Hiding is reversible and deletes nothing.
          </Notice>
        </div>
      )}

      {view === 'active' && model.staleOverrides.length > 0 && (
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
        rowKey={(r) => `${r.activityId}#${r.activity.sortOrder}`}
        maxHeight="calc(100vh - 200px)"
        rowClass={(r) => (r.status === 'REVIEW' ? 'row-bad' : r.baselineSource === 'NONE' ? 'row-bad' : r.status !== 'IN BUDGET' ? 'row-muted' : '')}
      />
    </Page>
  );
}

/** Drop blank and undefined fields so activity-overrides.json stays readable. */
function tidyOverride(o: ActivityOverride): ActivityOverride {
  const out: ActivityOverride = { activityId: o.activityId.trim() };
  if (o.overrideHours !== undefined && o.overrideHours !== null && Number.isFinite(o.overrideHours)) out.overrideHours = o.overrideHours;
  if (o.nameOverride?.trim()) out.nameOverride = o.nameOverride.trim();
  if (o.discipline?.trim()) out.discipline = o.discipline.trim();
  if (o.visibility) out.visibility = o.visibility;
  if (o.note?.trim()) out.note = o.note.trim();
  if (o.updatedAt) out.updatedAt = o.updatedAt;
  return out;
}

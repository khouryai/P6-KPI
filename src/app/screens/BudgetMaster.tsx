import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Badge, statusTone, type Column } from '../components/ui';
import type { BudgetRow } from '../../engine/types';
import { fmtHours, fmtPct, fmtDate, num } from '../format';
import { normKey } from '../../engine/keys';
import type { Route } from '../router';

const FLAGS: Record<string, { label: string; test: (r: BudgetRow) => boolean }> = {
  review: { label: 'Needing REVIEW', test: (r) => r.status === 'REVIEW' },
  nodates: { label: 'No dates at all', test: (r) => r.baselineSource === 'NONE' },
  nocurve: { label: 'In budget but on no curve', test: (r) => r.status === 'IN BUDGET' && r.budgetHours > 0 && !r.onPlannedCurve && !r.onForecastCurve },
  blcurrent: { label: 'Baseline falling back to current dates', test: (r) => r.baselineSource === 'CURRENT' },
  pctp6: { label: 'Percent complete from P6 duration', test: (r) => r.pctSource === 'P6' && r.status === 'IN BUDGET' },
  loe: { label: 'LOE flag', test: (r) => r.loeFlag },
  tier2: { label: 'Resolved through tier 2', test: (r) => r.matchTier === 2 },
  shifts: { label: 'RATE type missing shifts', test: (r) => r.needsShifts },
  override: { label: 'Has an hours override', test: (r) => r.overrideHours !== null },
};

export function BudgetMaster({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [loc, setLoc] = useState(route.params.get('loc') ?? '');
  const [phase, setPhase] = useState(route.params.get('phase') ?? '');
  const [work, setWork] = useState(route.params.get('work') ?? '');
  const [disc, setDisc] = useState(route.params.get('disc') ?? '');
  const [status, setStatus] = useState('');
  const [win, setWin] = useState('');
  const [text, setText] = useState('');

  const rows = useMemo(() => {
    let r = model.rows;
    if (flag && FLAGS[flag]) r = r.filter(FLAGS[flag].test);
    if (loc) r = r.filter((x) => x.location === loc);
    if (phase) r = r.filter((x) => x.phase === phase);
    if (work) r = r.filter((x) => x.workType === work);
    if (disc) r = r.filter((x) => x.discipline === disc);
    if (status) r = r.filter((x) => x.status === status);
    if (win) r = r.filter((x) => x.earnWindowSource === win);
    if (text.trim()) {
      const t = text.toLowerCase();
      r = r.filter((x) => x.activityId.toLowerCase().includes(t) || x.activity.activityName.toLowerCase().includes(t) || x.matchKey.toLowerCase().includes(t));
    }
    return r;
  }, [model.rows, flag, loc, phase, work, disc, status, win, text]);

  const setOverride = (id: string, v: string) => {
    const n = num(v);
    actions.update('overrides', (ovs) => {
      const rest = ovs.filter((o) => normKey(o.activityId) !== normKey(id));
      return n === undefined ? rest : [...rest, { activityId: id, overrideHours: n }];
    });
  };
  const overrideNote = (id: string, note: string) =>
    actions.update('overrides', (ovs) => ovs.map((o) => (normKey(o.activityId) === normKey(id) ? { ...o, note: note.trim() || undefined } : o)));
  const noteOf = (id: string) => state.data.overrides.find((o) => normKey(o.activityId) === normKey(id))?.note ?? '';

  const opts = (vals: string[]) => [{ value: '', label: 'All' }, ...vals.filter(Boolean).sort().map((v) => ({ value: v, label: v }))];
  const locs = [...new Set(model.rows.map((r) => r.location))];
  const phases = [...new Set(model.rows.map((r) => r.phase))];
  const works = [...new Set(model.rows.map((r) => r.workType))];
  const discs = [...new Set(model.rows.map((r) => r.discipline))];
  const total = rows.reduce((s, r) => s + r.budgetHours, 0);
  const earned = rows.reduce((s, r) => s + r.earnedHours, 0);

  const columns: Column<BudgetRow>[] = [
    { key: 'id', label: 'Activity ID', value: (r) => r.activityId, render: (r) => <span className="font-mono text-[11px]" title={r.activity.rawActivityId}>{r.activityId}</span> },
    { key: 'name', label: 'Activity name', value: (r) => r.activity.activityName, render: (r) => <span className="block max-w-xs truncate" title={r.activity.activityName}>{r.activity.activityName}</span> },
    { key: 'phase', label: 'Phase', value: (r) => r.phaseName },
    { key: 'loc', label: 'Loc', value: (r) => r.location },
    { key: 'key', label: 'Match key', value: (r) => r.matchKey, render: (r) => <span className="block max-w-xs truncate" title={`${r.matchKey}${r.matchTier === 2 ? ' (tier 2: last parenthetical dropped)' : ''}`}>{r.matchKey}{r.matchTier === 2 && <Badge tone="purple"> T2</Badge>}</span> },
    { key: 'status', label: 'Status', value: (r) => r.status, render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'rate', label: 'Rate', value: (r) => r.rateStatus, render: (r) => (r.status === 'IN BUDGET' ? <Badge tone={statusTone(r.rateStatus)}>{r.rateStatus}</Badge> : '') },
    { key: 'basis', label: 'Basis', value: (r) => r.basis ?? '', render: (r) => <>{r.basis ?? ''}{r.loeFlag && <Badge tone="warn"> LOE?</Badge>}</> },
    { key: 'od', label: 'OD', value: (r) => r.activity.originalDuration, num: true },
    { key: 'cx', label: 'Cx', value: (r) => r.complexity, num: true, render: (r) => (r.complexity === null ? '' : r.complexity.toFixed(2)) },
    { key: 'std', label: 'Std h', value: (r) => r.stdHours, num: true, render: (r) => fmtHours(r.stdHours) },
    { key: 'ov', label: 'Override h', value: (r) => r.overrideHours, num: true, render: (r) => (r.status === 'IN BUDGET' ? <CellInput type="number" className="cell-input text-right" value={r.overrideHours?.toString() ?? ''} placeholder="—" title={noteOf(r.activityId) || 'Replaces the computed hours; bypasses the complexity factor'} onCommit={(v) => setOverride(r.activityId, v)} /> : '') },
    { key: 'note', label: 'Override note', value: (r) => noteOf(r.activityId), render: (r) => (r.overrideHours !== null ? <CellInput value={noteOf(r.activityId)} placeholder="why" onCommit={(v) => overrideNote(r.activityId, v)} /> : '') },
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

  return (
    <Page eyebrow="Budget"
      title="Budget Master"
      subtitle={`${rows.length} of ${model.rows.length} activities shown. Budget ${fmtHours(total)} h, earned ${fmtHours(earned)} h. The hours override is the only editable field.`}
      toolbar={
        <>
          <input className="input" placeholder="Search ID, name, key" value={text} onChange={(e) => setText(e.target.value)} />
          <select className="input" value={phase} onChange={(e) => setPhase(e.target.value)}>{opts(phases).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All phases' : (model.groups.phase.find((g) => g.key === o.value)?.label ?? o.label)}</option>)}</select>
          <select className="input" value={loc} onChange={(e) => setLoc(e.target.value)}>{opts(locs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All locations' : o.label}</option>)}</select>
          <select className="input" value={work} onChange={(e) => setWork(e.target.value)}>{opts(works).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All work types' : o.label}</option>)}</select>
          <select className="input" value={disc} onChange={(e) => setDisc(e.target.value)}>{opts(discs).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All disciplines' : o.label}</option>)}</select>
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>{opts(['IN BUDGET', 'EXCLUDED', 'REVIEW', 'DELETED', 'CANCELLED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All statuses' : o.label}</option>)}</select>
          <select className="input" value={win} onChange={(e) => setWin(e.target.value)}>{opts(['TEST WINDOW', 'P6 ACTUAL', 'IN PROGRESS', 'NOT STARTED']).map((o) => <option key={o.value} value={o.value}>{o.label === 'All' ? 'All windows' : o.label}</option>)}</select>
          <select className="input" value={flag ?? ''} onChange={(e) => { window.location.hash = e.target.value ? `#/budget?flag=${e.target.value}` : '#/budget'; }}>
            <option value="">No quality filter</option>
            {Object.entries(FLAGS).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
          </select>
        </>
      }
    >
      <SortableTable rows={rows} columns={columns} rowKey={(r) => `${r.activityId}#${r.activity.sortOrder}`} maxHeight="calc(100vh - 200px)" rowClass={(r) => (r.status === 'REVIEW' ? 'row-bad' : r.baselineSource === 'NONE' ? 'row-bad' : r.status !== 'IN BUDGET' ? 'row-muted' : '')} />
    </Page>
  );
}

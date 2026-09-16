import { useApp } from '../state';
import { Page, SortableTable, CellInput, type Column } from '../components/ui';
import type { LocationStat } from '../../engine/types';
import { fmtHours, fmtPct, num } from '../format';
import { normKey } from '../../engine/keys';

export function Locations() {
  const { state, model, actions } = useApp();
  const def = state.data.settings.defaultComplexity;
  const edit = (code: string, patch: { name?: string; complexityFactor?: number }) =>
    actions.update('locations', (ls) =>
      ls.map((l) => {
        if (normKey(l.code) !== normKey(code)) return l;
        const next = { ...l, ...patch };
        if (next.name === undefined || next.name === '') delete next.name;
        if (next.complexityFactor === undefined) delete next.complexityFactor;
        return next;
      }),
    );
  const columns: Column<LocationStat>[] = [
    { key: 'code', label: 'Location', value: (r) => r.code, render: (r) => <span className="font-semibold">{r.code}</span> },
    { key: 'name', label: 'Name', value: (r) => r.location.name ?? '', render: (r) => <CellInput value={r.location.name ?? ''} placeholder="optional" onCommit={(v) => edit(r.code, { name: v.trim() })} /> },
    { key: 'count', label: 'Activities', value: (r) => r.count, num: true },
    { key: 'factor', label: 'Complexity factor', value: (r) => r.location.complexityFactor ?? null, num: true, render: (r) => <CellInput type="number" value={r.location.complexityFactor?.toString() ?? ''} placeholder={def.toFixed(2)} onCommit={(v) => edit(r.code, { complexityFactor: num(v) })} /> },
    { key: 'eff', label: 'Effective', value: (r) => r.effectiveFactor, num: true, render: (r) => r.effectiveFactor.toFixed(2) },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    { key: 'share', label: 'Share', value: (r) => r.shareOfBudget, num: true, render: (r) => <span className="tabular-nums text-[var(--text-muted)]">{fmtPct(r.shareOfBudget, 0)}</span> },
    { key: 'earned', label: 'Earned h', value: (r) => r.earnedHours, num: true, render: (r) => fmtHours(r.earnedHours, 1) },
    {
      key: 'pct',
      label: '% complete',
      value: (r) => r.pctComplete,
      num: true,
      width: '150px',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="w-9 text-right tabular-nums font-semibold">{fmtPct(r.pctComplete, 0)}</span>
          <div className="bar" style={{ width: 60 }}>
            <span style={{ width: `${Math.min(100, Math.round(r.pctComplete * 100))}%` }} />
          </div>
        </div>
      ),
    },
  ];
  return (
    <Page eyebrow="Budget" title="Locations" subtitle={`Discovered from the 4th segment of every Activity ID. ${model.locations.length} locations. Leave the factor blank to use the default of ${def.toFixed(2)}. The factor multiplies RATE and DUR hours; an activity override bypasses it.`}>
      <SortableTable tableId="locations" rows={model.locations} columns={columns} rowKey={(r) => r.code} />
    </Page>
  );
}

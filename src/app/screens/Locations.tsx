import { useApp } from '../state';
import { Page, SortableTable, CellInput, type Column } from '../components/ui';
import type { Location, LocationStat } from '../../engine/types';
import { fmtHours, fmtPct, num } from '../format';
import { normKey } from '../../engine/keys';
import { href } from '../router';

export function Locations() {
  const { state, model, actions } = useApp();
  const def = state.data.settings.defaultComplexity;
  const edit = (code: string, patch: { name?: string; complexityFactor?: number }) =>
    actions.update('locations', (ls) => {
      const apply = (l: Location) => {
        const next = { ...l, ...patch };
        if (next.name === undefined || next.name === '') delete next.name;
        if (next.complexityFactor === undefined) delete next.complexityFactor;
        return next;
      };
      // A code a rule or a Budget Master split produced is listed here but was never
      // saved, so there is nothing to update: add it, or the edit is silently dropped.
      if (!ls.some((l) => normKey(l.code) === normKey(code))) return [...ls, apply({ code })];
      return ls.map((l) => (normKey(l.code) === normKey(code) ? apply(l) : l));
    });
  const columns: Column<LocationStat>[] = [
    { key: 'code', label: 'Location', value: (r) => r.code, render: (r) => <span className="font-semibold">{r.code}</span> },
    {
      key: 'name',
      label: 'Reported as',
      value: (r) => r.location.name ?? '',
      hint: 'What the code means — Millbury Station for W40, Phase 2 for 2W. Every screen, report and export then shows this instead of the code. Blank reports the code.',
      render: (r) => <CellInput className="cell-input cell-long" value={r.location.name ?? ''} placeholder="type a name" onCommit={(v) => edit(r.code, { name: v.trim() })} />,
    },
    { key: 'count', label: 'Activities', value: (r) => r.count, num: true },
    {
      key: 'shared',
      label: 'Split',
      value: (r) => r.shared,
      num: true,
      hint: 'Activities carrying only part of their hours here, because they are split across locations in Budget Master. Their hours, earned hours and complexity are counted here by their share.',
      render: (r) => (r.shared ? <a href={href('budget', { loc: r.code, flag: 'split' })}>{r.shared}</a> : <span className="text-[var(--text-subtle)]">—</span>),
    },
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
  const unused = model.unusedLocations;
  return (
    <Page
      eyebrow="Budget"
      title="Locations"
      subtitle={`Discovered from the 4th segment of every Activity ID. ${model.locations.length} locations carrying activities. Give a code a name under Reported as and every screen and report shows the name instead. Leave the factor blank to use the default of ${def.toFixed(2)}. The factor multiplies RATE and DUR hours; an activity override bypasses it. An activity split across locations in Budget Master is counted at each by its share.`}
    >
      <SortableTable tableId="locations" rows={model.locations} columns={columns} rowKey={(r) => r.code} />
      {unused.length > 0 && (
        <details className="mt-3 text-[12px] text-[var(--text-muted)]">
          <summary className="cursor-pointer">
            {unused.length} location {unused.length === 1 ? 'code carries' : 'codes carry'} no activities and {unused.length === 1 ? 'is' : 'are'} hidden everywhere
          </summary>
          <p className="mt-1">
            Import never deletes a location, because the code can come back in a later schedule revision and a complexity factor typed against it should survive that.
            But a code with nothing under it has nothing to price and nothing to roll up, so it is kept in the file and left out of every list, filter and count.
          </p>
          <p className="mt-1">
            {unused.map((l) => (
              <code key={l.code} className="mono mr-2">{l.code}</code>
            ))}
          </p>
        </details>
      )}
    </Page>
  );
}

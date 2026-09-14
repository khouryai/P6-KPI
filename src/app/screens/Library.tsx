import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Select, Badge, statusTone, Notice, type Column } from '../components/ui';
import type { LibraryStat, LibraryEntry, Basis } from '../../engine/types';
import { fmtHours, num } from '../format';
import { normKey } from '../../engine/keys';
import type { Route } from '../router';

export function Library({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [filter, setFilter] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const settings = state.data.settings;

  const edit = (key: string, patch: Partial<LibraryEntry>) => {
    actions.update('library', (lib) => lib.map((e) => (normKey(e.matchKey) === normKey(key) ? clean({ ...e, ...patch }) : e)));
  };
  const retire = (key: string, retired: boolean) => edit(key, { retired: retired || undefined });

  const rows = useMemo(() => {
    let r = model.library;
    if (flag === 'default') r = r.filter((x) => x.rateStatus === 'DEFAULT');
    if (flag === 'shifts') r = r.filter((x) => x.rateStatus === 'NEEDS SHIFTS');
    if (filter.trim()) {
      const f = filter.toLowerCase();
      r = r.filter((x) => x.matchKey.toLowerCase().includes(f) || (x.entry.discipline ?? '').toLowerCase().includes(f));
    }
    return r;
  }, [model.library, flag, filter]);
  const retired = state.data.library.filter((e) => e.retired);
  const disciplines = [...new Set(state.data.library.map((e) => e.discipline).filter(Boolean))] as string[];

  const basisOpts = [{ value: '', label: `(default: ${settings.defaultBasis})` }, { value: 'RATE', label: 'RATE' }, { value: 'DUR', label: 'DUR' }];
  const incOpts = [{ value: '', label: '(auto)' }, { value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }];

  const columns: Column<LibraryStat>[] = [
    { key: 'matchKey', label: 'Match key', value: (r) => r.matchKey, render: (r) => <span className="font-medium" title={r.matchKey}>{r.matchKey}</span> },
    { key: 'count', label: 'Count', value: (r) => r.count, num: true },
    { key: 'days', label: 'Total P6 days', value: (r) => r.totalP6Days, num: true },
    { key: 'status', label: 'Rate status', value: (r) => r.rateStatus, render: (r) => <Badge tone={statusTone(r.rateStatus)}>{r.rateStatus}</Badge> },
    { key: 'disc', label: 'Discipline', value: (r) => r.entry.discipline ?? '', render: (r) => <CellInput value={r.entry.discipline ?? ''} list="disciplines" onCommit={(v) => edit(r.matchKey, { discipline: v.trim() || undefined })} /> },
    { key: 'inc', label: 'Include', value: (r) => `${r.entry.includeOverride ?? ''}${r.include}`, render: (r) => <span className="flex items-center gap-1"><Select value={r.entry.includeOverride ?? ''} options={incOpts} onChange={(v) => edit(r.matchKey, { includeOverride: (v || undefined) as 'Y' | 'N' | undefined })} /><Badge tone={r.include === 'Y' ? 'green' : 'slate'}>{r.include}</Badge></span> },
    { key: 'basis', label: 'Basis', value: (r) => r.basisEff, render: (r) => <Select value={r.entry.basis ?? ''} options={basisOpts} onChange={(v) => edit(r.matchKey, { basis: (v || undefined) as Basis | undefined })} /> },
    { key: 'crew', label: 'Crew', value: (r) => r.crewEff, num: true, render: (r) => <CellInput type="number" value={r.entry.crewSize?.toString() ?? ''} placeholder={String(settings.defaultCrew)} onCommit={(v) => edit(r.matchKey, { crewSize: num(v) })} /> },
    { key: 'shift', label: 'Shift h', value: (r) => r.shiftEff, num: true, render: (r) => <CellInput type="number" value={r.entry.shiftHours?.toString() ?? ''} placeholder={String(settings.defaultShiftHours)} onCommit={(v) => edit(r.matchKey, { shiftHours: num(v) })} /> },
    { key: 'shifts', label: 'Duration shifts', value: (r) => r.entry.durationShifts ?? null, num: true, render: (r) => <CellInput type="number" value={r.entry.durationShifts?.toString() ?? ''} placeholder={r.basisEff === 'RATE' ? 'required' : 'n/a'} onCommit={(v) => edit(r.matchKey, { durationShifts: num(v) })} /> },
    { key: 'std', label: 'Std h / instance', value: (r) => r.stdHoursIfRate, num: true, render: (r) => (r.basisEff === 'RATE' ? fmtHours(r.stdHoursIfRate) : <span className="text-slate-400" title="DUR basis: crew x shift hours x P6 original duration per activity">per P6 days</span>) },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    { key: 'notes', label: 'Notes', value: (r) => r.entry.notes ?? '', render: (r) => <CellInput value={r.entry.notes ?? ''} onCommit={(v) => edit(r.matchKey, { notes: v.trim() || undefined })} /> },
    { key: 'act', label: '', value: () => '', render: (r) => <button className="text-[11px] text-slate-500 underline" title="Remove this key from pricing. Its activities will resolve through tier 2 (last parenthetical dropped) or show as REVIEW. It is never re-added by import." onClick={() => retire(r.matchKey, true)}>retire</button> },
  ];

  return (
    <Page
      title="Activity Library"
      subtitle={`${model.summary.activityTypes} types. ${model.summary.typesOnDefaults} still on defaults, ${model.summary.typesNeedingShifts} RATE types missing a shift count. Sorted by total P6 days so the high impact types come first.`}
      actions={
        <>
          <input className="input" placeholder="Filter by key or discipline" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {flag && <a className="btn" href="#/library">Clear filter ({flag})</a>}
        </>
      }
    >
      <datalist id="disciplines">{disciplines.map((d) => <option key={d} value={d} />)}</datalist>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        <span><Badge tone="green">SET</Badge> priced</span>
        <span><Badge tone="amber">DEFAULT</Badge> on Settings defaults ({settings.defaultBasis}, crew {settings.defaultCrew}, {settings.defaultShiftHours} h)</span>
        <span><Badge tone="red">NEEDS SHIFTS</Badge> RATE with no shift count, budgets zero</span>
        <span><Badge tone="slate">EXCLUDED</Badge> not in budget</span>
        <span className="text-slate-500">RATE hours = crew x shift hours x duration shifts. DUR hours = crew x shift hours x P6 original duration. Complexity is applied per location.</span>
      </div>
      <SortableTable rows={rows} columns={columns} rowKey={(r) => r.matchKey} defaultSort={{ key: 'days', dir: 'desc' }} rowClass={(r) => (r.rateStatus === 'DEFAULT' ? 'bg-amber-50' : r.rateStatus === 'NEEDS SHIFTS' ? 'bg-red-50' : r.rateStatus === 'EXCLUDED' ? 'text-slate-400' : '')} />
      {retired.length > 0 && (
        <div className="mt-4">
          <button className="text-[12px] text-blue-700 underline" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired key{retired.length === 1 ? '' : 's'}
          </button>
          {showRetired && (
            <div className="mt-2">
              <Notice tone="info">Retired keys are not used for pricing and are never re-added by an import. Their activities resolve through tier 2 to a shorter key, or show as REVIEW.</Notice>
              <ul className="mt-2 text-[12px]">
                {retired.map((e) => (
                  <li key={e.matchKey} className="py-0.5">
                    {e.matchKey} <button className="ml-2 text-blue-700 underline" onClick={() => retire(e.matchKey, false)}>restore</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

/** Drop undefined fields so the JSON stays tidy. */
function clean(e: LibraryEntry): LibraryEntry {
  const out: LibraryEntry = { matchKey: e.matchKey };
  for (const k of ['discipline', 'includeOverride', 'basis', 'crewSize', 'shiftHours', 'durationShifts', 'notes', 'retired'] as const) {
    const v = e[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

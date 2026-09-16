import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, SortableTable, CellInput, Select, Badge, statusTone, Notice, type Column } from '../components/ui';
import type { LibraryStat, LibraryEntry, Basis, CrewLine } from '../../engine/types';
import { assignSubsystem, crewLines, setCrewCount } from '../../engine/compute';
import { fmtHours, fmtPct, num } from '../format';
import { normKey } from '../../engine/keys';
import type { Route } from '../router';

export function Library({ route }: { route: Route }) {
  const { state, model, actions } = useApp();
  const flag = route.params.get('flag');
  const [filter, setFilter] = useState('');
  const [showRetired, setShowRetired] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [crewFor, setCrewFor] = useState<string | null>(null);
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

  /**
   * Every subsystem code already in use, from the crews and from the names screen.
   * Offered as suggestions so codes stay consistent without being a fixed list you
   * have to maintain before you can price anything.
   */
  const knownSubsystems = useMemo(() => {
    const set = new Set<string>();
    for (const e of state.data.library) for (const l of crewLines(e)) if (l.subsystem.trim()) set.add(l.subsystem.trim());
    for (const s of state.data.subsystems) if (s.code.trim()) set.add(s.code.trim());
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [state.data.library, state.data.subsystems]);

  const addKey = (raw: string) => {
    const key = raw.trim();
    if (!key) return;
    if (state.data.library.some((e) => normKey(e.matchKey) === normKey(key))) {
      const wasRetired = state.data.library.find((e) => normKey(e.matchKey) === normKey(key))?.retired;
      if (wasRetired) {
        retire(key, false);
        actions.notify('ok', `"${key}" was retired and has been restored.`);
      } else actions.notify('info', `"${key}" is already in the library.`);
      setNewKey('');
      return;
    }
    actions.update('library', (lib) => [...lib, { matchKey: key }]);
    setNewKey('');
    actions.notify('ok', `Added "${key}". Price it below, then Save.`);
  };

  const disciplines = [...new Set(state.data.library.map((e) => e.discipline).filter(Boolean))] as string[];

  const basisOpts = [{ value: '', label: `${settings.defaultBasis} (auto)` }, { value: 'RATE', label: 'RATE' }, { value: 'DUR', label: 'DUR' }];
  const incOpts = [{ value: '', label: '(auto)' }, { value: 'Y', label: 'Y' }, { value: 'N', label: 'N' }];

  const columns: Column<LibraryStat>[] = [
    { key: 'matchKey', label: 'Match key', value: (r) => r.matchKey, render: (r) => <span className="font-medium" title={r.matchKey}>{r.matchKey}</span> },
    { key: 'count', label: 'Count', value: (r) => r.count, num: true },
    { key: 'days', label: 'Total P6 days', value: (r) => r.totalP6Days, num: true },
    { key: 'status', label: 'Rate status', value: (r) => r.rateStatus, render: (r) => <Badge tone={statusTone(r.rateStatus)}>{r.rateStatus}</Badge> },
    { key: 'disc', label: 'Discipline', value: (r) => r.entry.discipline ?? '', render: (r) => <CellInput value={r.entry.discipline ?? ''} list="disciplines" onCommit={(v) => edit(r.matchKey, { discipline: v.trim() || undefined })} /> },
    { key: 'inc', label: 'Include', value: (r) => `${r.entry.includeOverride ?? ''}${r.include}`, render: (r) => <span className="flex items-center gap-1"><Select value={r.entry.includeOverride ?? ''} options={incOpts} onChange={(v) => edit(r.matchKey, { includeOverride: (v || undefined) as 'Y' | 'N' | undefined })} /><Badge tone={r.include === 'Y' ? 'good' : 'muted'}>{r.include}</Badge></span> },
    { key: 'basis', label: 'Basis', value: (r) => r.basisEff, render: (r) => <Select value={r.entry.basis ?? ''} options={basisOpts} onChange={(v) => edit(r.matchKey, { basis: (v || undefined) as Basis | undefined })} /> },
    {
      key: 'subsystem',
      label: 'Subsystem',
      hint: 'The resource group whose hours this activity type spends. Most types belong to one group: type it here. Only a type drawing on two or more groups needs a split.',
      width: '150px',
      value: (r) => (r.crewEffLines.length > 1 ? `${r.crewEffLines.length} groups` : (r.crewEffLines[0]?.subsystem ?? '')),
      render: (r) =>
        r.crewEffLines.length > 1 ? (
          <button
            className="crew-chips"
            title={`${r.crewEff} people across ${r.crewEffLines.length} groups. Click to change.`}
            onClick={() => setCrewFor(r.matchKey)}
          >
            {r.crewEffLines.map((l) => (
              <span key={`${l.subsystem}-${l.shiftHours ?? ''}`} className="crew-chip">
                {l.subsystem || 'Unassigned'} {l.count}
                {l.shiftHours !== undefined && <span className="opacity-60"> @{l.shiftHours}h</span>}
              </span>
            ))}
          </button>
        ) : (
          <CellInput
            className="cell-input cell-wide"
            value={r.crewEffLines[0]?.subsystem ?? ''}
            list="subsystem-codes"
            placeholder="Unassigned"
            title="Type the subsystem this crew belongs to. Clearing it puts the hours back under Unassigned."
            onCommit={(v) => edit(r.matchKey, assignSubsystem(r.entry, v, settings.defaultCrew))}
          />
        ),
    },
    {
      key: 'crew',
      label: 'Crew',
      value: (r) => r.crewEff,
      num: true,
      width: '118px',
      render: (r) => (
        <div className="flex items-center justify-end gap-1">
          {r.crewEffLines.length > 1 ? (
            <span className="tabular-nums" title={`${r.crewEff} people across ${r.crewEffLines.length} groups`}>{r.crewEff}</span>
          ) : (
            <CellInput
              type="number"
              value={r.crewEffLines.length ? String(r.crewEffLines[0].count) : (r.entry.crewSize?.toString() ?? '')}
              placeholder={String(settings.defaultCrew)}
              onCommit={(v) => edit(r.matchKey, setCrewCount(r.entry, num(v), settings.defaultCrew))}
            />
          )}
          <button
            className="btn-link shrink-0 text-[11px] font-normal"
            title="Two or more groups on this one activity type: say who, and how many of each"
            onClick={() => setCrewFor(r.matchKey)}
          >
            split
          </button>
        </div>
      ),
    },
    { key: 'shift', label: 'Shift h', value: (r) => r.shiftEff, num: true, render: (r) => <CellInput type="number" value={r.entry.shiftHours?.toString() ?? ''} placeholder={String(settings.defaultShiftHours)} onCommit={(v) => edit(r.matchKey, { shiftHours: num(v) })} /> },
    { key: 'shifts', label: 'Duration shifts', value: (r) => r.entry.durationShifts ?? null, num: true, render: (r) => <CellInput type="number" value={r.entry.durationShifts?.toString() ?? ''} placeholder={r.basisEff === 'RATE' ? 'required' : 'n/a'} onCommit={(v) => edit(r.matchKey, { durationShifts: num(v) })} /> },
    { key: 'std', label: 'Std h / instance', value: (r) => r.stdHoursIfRate, num: true, render: (r) => (r.basisEff === 'RATE' ? fmtHours(r.stdHoursIfRate) : <span className="text-[var(--text-subtle)]" title="DUR basis: crew x shift hours x P6 original duration per activity">per P6 days</span>) },
    { key: 'budget', label: 'Budget h', value: (r) => r.budgetHours, num: true, render: (r) => fmtHours(r.budgetHours) },
    {
      key: 'share',
      label: 'Share',
      value: (r) => r.shareOfBudget,
      num: true,
      render: (r) => <span className="tabular-nums text-[var(--text-muted)]">{fmtPct(r.shareOfBudget, 0)}</span>,
    },
    { key: 'notes', label: 'Notes', value: (r) => r.entry.notes ?? '', render: (r) => <CellInput value={r.entry.notes ?? ''} onCommit={(v) => edit(r.matchKey, { notes: v.trim() || undefined })} /> },
    { key: 'act', label: '', value: () => '', render: (r) => <button className="btn-link text-[11px] font-normal" title="Remove this key from pricing. Its activities will show as REVIEW until another key matches them exactly. It is never re-added by import." onClick={() => retire(r.matchKey, true)}>retire</button> },
  ];

  return (
    <Page eyebrow="Budget"
      title="Activity Library"
      subtitle={`${model.summary.activityTypes} types. ${model.summary.typesOnDefaults} still on defaults, ${model.summary.typesNeedingShifts} RATE types missing a shift count. Sorted by total P6 days so the high impact types come first.`}
      toolbar={
        <>
          <input className="input" placeholder="Filter by key or discipline" value={filter} onChange={(e) => setFilter(e.target.value)} />
          {flag && <a className="btn" href="#/library">Clear filter ({flag})</a>}
        </>
      }
    >
      <div className="mb-3 grid gap-3 lg:grid-cols-2">
        <div className="card">
          <h2 className="card-title">Add a key by hand</h2>
          <p className="text-[12px] text-[var(--text-muted)]">Keys are normally discovered from the schedule. Add one by hand for an activity type you know is coming but which no import has carried yet.</p>
          <div className="mt-2 flex gap-2">
            <input className="input flex-1" placeholder="IXL Sim Mode Test (Adjacent Location)" value={newKey} onChange={(e) => setNewKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addKey(newKey)} />
            <button className="btn" onClick={() => addKey(newKey)}>Add</button>
          </div>
        </div>
      </div>
      {crewFor && (
        <CrewEditor
          matchKey={crewFor}
          entry={state.data.library.find((e) => normKey(e.matchKey) === normKey(crewFor)) ?? { matchKey: crewFor }}
          defaultCrew={settings.defaultCrew}
          defaultShift={settings.defaultShiftHours}
          onChange={(crew) => edit(crewFor, { crew })}
          onClose={() => setCrewFor(null)}
        />
      )}
      <datalist id="subsystem-codes">{knownSubsystems.map((c) => <option key={c} value={c} />)}</datalist>
      <datalist id="disciplines">{disciplines.map((d) => <option key={d} value={d} />)}</datalist>
      <div className="mb-3 flex flex-wrap gap-3 text-[12px]">
        <span><Badge tone="good">SET</Badge> priced</span>
        <span><Badge tone="warn">DEFAULT</Badge> on Settings defaults ({settings.defaultBasis}, crew {settings.defaultCrew}, {settings.defaultShiftHours} h)</span>
        <span><Badge tone="bad">NEEDS SHIFTS</Badge> RATE with no shift count, budgets zero</span>
        <span><Badge tone="muted">EXCLUDED</Badge> not in budget</span>
        <span className="text-[var(--text-muted)]">RATE hours = crew x shift hours x duration shifts. DUR hours = crew x shift hours x P6 original duration. Complexity is applied per location. Type the subsystem straight into its column; use split only when one type draws on two or more groups.</span>
      </div>
      <SortableTable tableId="library" rows={rows} columns={columns} rowKey={(r) => r.matchKey} defaultSort={{ key: 'days', dir: 'desc' }} rowClass={(r) => (r.rateStatus === 'DEFAULT' ? 'row-warn' : r.rateStatus === 'NEEDS SHIFTS' ? 'row-bad' : r.rateStatus === 'EXCLUDED' ? 'row-muted' : '')} />
      {retired.length > 0 && (
        <div className="mt-4">
          <button className="btn-link" onClick={() => setShowRetired((v) => !v)}>
            {showRetired ? 'Hide' : 'Show'} {retired.length} retired key{retired.length === 1 ? '' : 's'}
          </button>
          {showRetired && (
            <div className="mt-2">
              <Notice tone="info">Retired keys are not used for pricing and are never re-added by an import. Their activities show as REVIEW until a key matches them exactly.</Notice>
              <ul className="mt-2 text-[12px]">
                {retired.map((e) => (
                  <li key={e.matchKey} className="py-0.5">
                    {e.matchKey} <button className="btn-link ml-2" onClick={() => retire(e.matchKey, false)}>restore</button>
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

/**
 * Says who makes up the crew, not just how many.
 *
 * "Two resources at eight hours" prices an ATSCTP correctly and tells you nothing
 * about whether the ATS team or the IXL team is the one that runs out of people.
 * One line per subsystem fixes that without changing a single budget figure: the
 * headcount is still the sum, so the hours are identical either way.
 */
function CrewEditor({
  matchKey,
  entry,
  defaultCrew,
  defaultShift,
  onChange,
  onClose,
}: {
  matchKey: string;
  entry: LibraryEntry;
  defaultCrew: number;
  defaultShift: number;
  onChange: (crew: CrewLine[] | undefined) => void;
  onClose: () => void;
}) {
  const lines = entry.crew ?? [];
  const set = (next: CrewLine[]) => onChange(next.length ? next : undefined);
  const patch = (i: number, p: Partial<CrewLine>) => set(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const headcount = crewLines(entry).reduce((s, l) => s + l.count, 0);
  const effShift = entry.shiftHours ?? defaultShift;
  const hoursPerShift = crewLines(entry).reduce((s, l) => s + l.count * (l.shiftHours ?? effShift), 0);

  return (
    <div className="card mb-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="card-title">Crew for <span className="mono">{matchKey}</span></h2>
        <button className="btn btn-mini" onClick={onClose}>Done</button>
      </div>
      <p className="mt-1 text-[12px] text-[var(--text-muted)]">
        One line per resource group. An ATSCTP needing one ATS engineer and one IXL engineer is two lines of one, not a crew of two — same hours,
        but now you can see which group carries them. A type that is one group's work needs nothing here: type the code in the Subsystem column instead.
      </p>

      <div className="mt-2 space-y-1">
        {lines.map((l, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              className="input w-44"
              list="subsystem-codes"
              placeholder="ATS"
              value={l.subsystem}
              onChange={(e) => patch(i, { subsystem: e.target.value })}
            />
            <label className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]">
              people
              <input
                className="input w-20"
                type="number"
                min={0}
                step="0.5"
                value={Number.isFinite(l.count) ? l.count : ''}
                onChange={(e) => patch(i, { count: e.target.value === '' ? Number.NaN : Number(e.target.value) })}
              />
            </label>
            <label className="flex items-center gap-1 text-[12px] text-[var(--text-muted)]" title="Leave blank unless this group works a different shift length from the rest of the crew">
              shift h
              <input
                className="input w-20"
                type="number"
                min={0}
                placeholder={String(effShift)}
                value={l.shiftHours ?? ''}
                onChange={(e) => patch(i, { shiftHours: e.target.value === '' ? undefined : Number(e.target.value) })}
              />
            </label>
            <button className="btn-link text-[11px] font-normal" onClick={() => set(lines.filter((_, j) => j !== i))}>
              remove
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          className="btn btn-mini"
          onClick={() => set([...lines, { subsystem: '', count: lines.length ? 1 : (entry.crewSize ?? defaultCrew) }])}
        >
          Add a group
        </button>
        {lines.length > 0 && (
          <button className="btn btn-mini" title="Go back to pricing this type as a plain headcount" onClick={() => set([])}>
            Remove the breakdown
          </button>
        )}
        <span className="text-[12px] text-[var(--text-muted)]">
          {lines.length === 0 ? (
            <>No breakdown: this type prices as a crew of {entry.crewSize ?? defaultCrew}, and its hours land under Unassigned.</>
          ) : (
            <>
              Crew of <b>{headcount}</b>, <b>{hoursPerShift}</b> hours per shift.
              {lines.some((l) => !l.subsystem.trim()) && ' A line with no subsystem counts as Unassigned.'}
            </>
          )}
        </span>
      </div>
    </div>
  );
}

/** Drop undefined fields so the JSON stays tidy. */
function clean(e: LibraryEntry): LibraryEntry {
  const out: LibraryEntry = { matchKey: e.matchKey };
  for (const k of ['discipline', 'includeOverride', 'basis', 'crewSize', 'shiftHours', 'durationShifts', 'notes', 'retired'] as const) {
    const v = e[k];
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  // An empty breakdown is the same as no breakdown, and writing [] would make the
  // entry look split when it is not.
  if (e.crew && e.crew.length) out.crew = e.crew;
  return out;
}

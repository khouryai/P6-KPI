import { useMemo, useState } from 'react';
import { useApp } from '../state';
import { Page, Panel, Notice, SortableTable, CellInput, type Column, type HeroStat } from '../components/ui';
import type { Headcount } from '../../engine/types';
import { DEFAULT_CAPACITY, capacityByFiscalYear, capacityByMonth, type CapacityPeriod, type CapacityRow } from '../../engine/capacity';
import { fyStart } from '../../engine/fiscal';
import { fmtHours, fmtPct } from '../format';
import { href } from '../router';
import { TERMS } from '../../engine/vocab';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1] ?? m.slice(5, 7)} ${m.slice(2, 4)}`;

/** A gap: negative is short of people, positive is slack. Blank where none is keyed. */
function Gap({ hours }: { hours: number | null }) {
  if (hours === null) return <span className="text-[var(--text-subtle)]" title="No headcount keyed for this group, so there is nothing to compare the demand with.">—</span>;
  const short = hours < -0.5;
  return (
    <span className={`font-semibold tabular-nums tone-${short ? 'bad' : hours > 0.5 ? 'good' : 'muted'}`}>
      {hours >= 0 ? '+' : ''}
      {fmtHours(hours)}
    </span>
  );
}

/** Demand as a share of supply. Over 1.0 is oversubscribed. */
function Load({ f }: { f: number | null }) {
  if (f === null) return <span className="text-[var(--text-subtle)]">—</span>;
  return <span className={`font-semibold tabular-nums ${f > 1.001 ? 'tone-bad' : f > 0.9 ? 'tone-warn' : 'tone-good'}`}>{fmtPct(f, 0)}</span>;
}

/**
 * What the work ahead asks for, against what there is to give.
 *
 * The forecast already says what each group still has to do and what it will cost
 * at the rate that group achieves. This screen adds the one fact the application
 * cannot derive — how many people are in the group — and turns a cost into a
 * staffing answer.
 */
export function Capacity() {
  const { state, model, actions } = useApp();
  const [view, setView] = useState<'year' | 'month'>('year');
  const [open, setOpen] = useState<string | null>(null);

  const cap = state.data.settings.capacity ?? DEFAULT_CAPACITY;
  const headcounts = state.data.headcounts;
  const fyMonth = fyStart(state.data.settings.fiscalYearStartMonth);

  const periods: CapacityPeriod[] = useMemo(
    () =>
      view === 'year'
        ? capacityByFiscalYear(model.burn.forecastMonths, headcounts, model.subsystems.map((s) => ({ code: s.code })), cap, fyMonth)
        : capacityByMonth(model.burn.forecastMonths, headcounts, model.subsystems.map((s) => ({ code: s.code })), cap),
    [view, model.burn.forecastMonths, model.subsystems, headcounts, cap, fyMonth],
  );

  const opened = open === null ? null : (periods.find((p) => p.key === open) ?? null);

  const groups = useMemo(
    () => [...new Set(model.subsystems.map((s) => s.code))].sort((a, b) => (a || 'zzz').localeCompare(b || 'zzz')),
    [model.subsystems],
  );

  const short = periods.filter((p) => (p.gapHours ?? 0) < -0.5);
  const perPerson = Math.max(0, cap.hoursPerPersonPerMonth) * Math.max(0, Math.min(1, cap.utilisation));
  const staffed = new Set(headcounts.map((h) => h.subsystem));
  const unstaffed = groups.filter((g) => !staffed.has(g)).length;

  const heroStats: HeroStat[] = [
    { label: 'Periods short', value: short.length, tone: short.length ? 'red' : 'good' },
    { label: 'Groups with no headcount', value: unstaffed, tone: unstaffed ? 'amber' : 'good' },
    { label: 'Hours per person per month', value: Math.round(perPerson), tone: 'muted' },
  ];

  const setCap = (patch: Partial<typeof cap>) =>
    actions.update('settings', (prev) => ({ ...prev, capacity: { ...cap, ...patch } }));

  const editHead = (id: string, patch: Partial<Headcount>) =>
    actions.update('headcounts', (list) => list.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const addHead = (subsystem = '') =>
    actions.update('headcounts', (list) => [
      ...list,
      { id: `hc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, subsystem, people: 1 },
    ]);

  const removeHead = (id: string) => actions.update('headcounts', (list) => list.filter((h) => h.id !== id));

  const periodColumns: Column<CapacityPeriod>[] = [
    {
      key: 'period',
      label: view === 'year' ? 'Fiscal year' : 'Month',
      locked: true,
      value: (p) => p.key,
      render: (p) => (
        <button className="btn-link" onClick={() => setOpen(open === p.key ? null : p.key)}>
          <b>{view === 'year' ? p.label : monthLabel(p.key)}</b>
          {view === 'year' && <span className="ml-1 font-normal text-[var(--text-muted)]">{p.span}</span>}
        </button>
      ),
    },
    { key: 'groups', label: 'Groups', value: (p) => p.rows.length, num: true, optional: true },
    {
      key: 'demand',
      label: 'Demand h',
      value: (p) => p.demandHours,
      num: true,
      hint: 'Hours the work ahead will take, at the rate each group actually achieves. Not the budget — a group converting at 0.7 needs half again as many hours as its budget is worth.',
      render: (p) => fmtHours(p.demandHours),
    },
    {
      key: 'supply',
      label: 'Supply h',
      value: (p) => p.supplyHours ?? null,
      num: true,
      hint: 'Hours the keyed headcount can give, at the hours per person and utilisation set below.',
      render: (p) => (p.supplyHours === null ? <span className="text-[var(--text-subtle)]">—</span> : fmtHours(p.supplyHours)),
    },
    { key: 'gap', label: 'Short / spare', value: (p) => p.gapHours ?? null, num: true, render: (p) => <Gap hours={p.gapHours} /> },
    {
      key: 'load',
      label: 'Load',
      value: (p) => (p.supplyHours && p.supplyHours > 0 ? p.demandHours / p.supplyHours : null),
      num: true,
      hint: 'Demand as a share of supply. Over 100% is more work than the group can take in the period.',
      render: (p) => <Load f={p.supplyHours && p.supplyHours > 0 ? p.demandHours / p.supplyHours : null} />,
    },
    {
      key: 'open',
      label: '',
      value: () => '',
      hint: '',
      render: (p) => (
        <button className="btn-link text-[11px] font-normal" onClick={() => setOpen(open === p.key ? null : p.key)}>
          {open === p.key ? 'hide' : `by group (${p.rows.length})`}
        </button>
      ),
    },
  ];

  const groupColumns: Column<CapacityRow>[] = [
    { key: 'code', label: TERMS.subsystem, locked: true, value: (r) => r.label, render: (r) => <span className="mono font-semibold">{r.code || 'Unassigned'}</span> },
    { key: 'people', label: 'People', value: (r) => r.people ?? null, num: true, render: (r) => (r.people === null ? <span className="text-[var(--text-subtle)]">none keyed</span> : <span className="tabular-nums">{r.people}</span>) },
    { key: 'demand', label: 'Demand h', value: (r) => r.demandHours, num: true, render: (r) => fmtHours(r.demandHours) },
    { key: 'supply', label: 'Supply h', value: (r) => r.supplyHours ?? null, num: true, render: (r) => (r.supplyHours === null ? <span className="text-[var(--text-subtle)]">—</span> : fmtHours(r.supplyHours)) },
    { key: 'gap', label: 'Short / spare', value: (r) => r.gapHours ?? null, num: true, render: (r) => <Gap hours={r.gapHours} /> },
    { key: 'load', label: 'Load', value: (r) => r.loadFactor ?? null, num: true, render: (r) => <Load f={r.loadFactor} /> },
    {
      key: 'need',
      label: 'People needed',
      value: (r) => (perPerson > 0 ? r.demandHours / perPerson / Math.max(1, r.months) : null),
      num: true,
      hint: 'The headcount the demand implies, at the hours per person set below. What you would have to staff the period with to finish the work in it.',
      render: (r) => (perPerson > 0 ? <span className="tabular-nums">{(r.demandHours / perPerson / Math.max(1, r.months)).toFixed(1)}</span> : <span className="text-[var(--text-subtle)]">—</span>),
    },
  ];

  const headColumns: Column<Headcount>[] = [
    {
      key: 'subsystem',
      label: TERMS.subsystem,
      locked: true,
      value: (h) => h.subsystem,
      render: (h) => <CellInput value={h.subsystem} list="capacity-groups" placeholder="Unassigned" onCommit={(v) => editHead(h.id, { subsystem: v.trim() })} />,
    },
    {
      key: 'people',
      label: 'People',
      value: (h) => h.people,
      num: true,
      hint: 'How many are in the group. Fractional is allowed: half a person shared with another job is a real thing.',
      render: (h) => <CellInput type="number" className="cell-input text-right" value={String(h.people)} onCommit={(v) => editHead(h.id, { people: Number(v) || 0 })} />,
    },
    {
      key: 'from',
      label: 'From',
      value: (h) => h.from ?? '',
      hint: 'The month this count takes effect, as YYYY-MM. Blank means it always has. Add a second row to describe a ramp.',
      render: (h) => <CellInput value={h.from ?? ''} placeholder="always" onCommit={(v) => editHead(h.id, { from: /^\d{4}-\d{2}$/.test(v.trim()) ? v.trim() : undefined })} />,
    },
    { key: 'note', label: 'Why', value: (h) => h.note ?? '', render: (h) => <CellInput className="cell-input cell-wide" value={h.note ?? ''} placeholder="—" onCommit={(v) => editHead(h.id, { note: v.trim() || undefined })} /> },
    { key: 'act', label: '', value: () => '', hint: '', render: (h) => <button className="btn-link danger text-[11px]" onClick={() => removeHead(h.id)}>remove</button> },
  ];

  return (
    <Page
      eyebrow="Progress"
      title="Capacity"
      subtitle="What the work ahead asks for, against what there is to give. Demand comes from the forecast at each group’s own rate; supply comes from the headcount you key below."
      stats={heroStats}
      toolbar={
        <>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">Show</span>
          <span className="seg">
            <button className={`seg-btn${view === 'year' ? ' is-on' : ''}`} onClick={() => { setView('year'); setOpen(null); }}>By fiscal year</button>
            <button className={`seg-btn${view === 'month' ? ' is-on' : ''}`} onClick={() => { setView('month'); setOpen(null); }}>By month</button>
          </span>
          <a className="btn ml-3" href={href('team')}>Earned vs {TERMS.built}</a>
        </>
      }
    >
      <datalist id="capacity-groups">{groups.filter(Boolean).map((g) => <option key={g} value={g} />)}</datalist>

      {model.burn.forecastMonths.length === 0 && (
        <div className="mb-4">
          <Notice tone="info">
            There is no work ahead on the current schedule, so there is no demand to staff. Import a schedule and set the data date.
          </Notice>
        </div>
      )}
      {headcounts.length === 0 && model.burn.forecastMonths.length > 0 && (
        <div className="mb-4">
          <Notice tone="info">
            No headcount is keyed, so the demand below has nothing to be measured against. Add a row per {TERMS.subsystemLower} at the bottom of this screen — that is the
            one fact the application cannot work out for itself.
          </Notice>
        </div>
      )}
      {short.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn">
            <b>{short.length} {short.length === 1 ? 'period is' : 'periods are'} short of people.</b> The work the schedule puts in {short.length === 1 ? 'it' : 'them'} needs
            more hours than the keyed headcount can give — {short.map((p) => `${view === 'year' ? p.label : monthLabel(p.key)} by ${fmtHours(Math.abs(p.gapHours ?? 0))} h`).slice(0, 4).join(', ')}
            {short.length > 4 && ', and others'}. Either the dates move or the people do.
          </Notice>
        </div>
      )}

      {periods.length > 0 && (
        <Panel
          title={view === 'year' ? 'Fiscal years ahead' : 'Months ahead'}
          meta={`Click a ${view === 'year' ? 'year' : 'month'} to break it down by ${TERMS.subsystemLower}.`}
          className="mb-3"
        >
          <SortableTable
            tableId={`capacity-${view}`}
            rows={periods}
            columns={periodColumns}
            rowKey={(p) => p.key}
            defaultSort={{ key: 'period', dir: 'asc' }}
            maxHeight="340px"
            rowClass={(p) => (open === p.key ? 'row-warn' : (p.gapHours ?? 0) < -0.5 ? 'row-bad' : '')}
          />
          {opened && (
            <div className="mt-3">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                {view === 'year' ? `${opened.label} — ${opened.span}` : monthLabel(opened.key)} by {TERMS.subsystemLower}
              </div>
              <SortableTable
                tableId="capacity-groups-detail"
                rows={opened.rows}
                columns={groupColumns}
                rowKey={(r) => r.code || '(unassigned)'}
                defaultSort={{ key: 'demand', dir: 'desc' }}
                maxHeight="300px"
              />
            </div>
          )}
        </Panel>
      )}

      <Panel
        title="How many people each group has"
        meta="The one fact the application cannot derive. Everything above is arithmetic on it."
        className="mb-3"
      >
        {headcounts.length === 0 ? (
          <div className="py-6 text-center text-[13px] text-[var(--text-subtle)]">
            <div>No headcount keyed.</div>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {groups.filter(Boolean).slice(0, 8).map((g) => (
                <button key={g} className="btn btn-mini" onClick={() => addHead(g)}>Add {g}</button>
              ))}
              <button className="btn btn-mini" onClick={() => addHead('')}>Add a row</button>
            </div>
          </div>
        ) : (
          <>
            <SortableTable
              tableId="capacity-headcounts"
              rows={headcounts}
              columns={headColumns}
              rowKey={(h) => h.id}
              defaultSort={{ key: 'subsystem', dir: 'asc' }}
              maxHeight="300px"
            />
            <div className="mt-2">
              <button className="btn btn-mini" onClick={() => addHead('')}>Add a row</button>
            </div>
          </>
        )}
      </Panel>

      <Panel title="What one person is worth" meta="Applied to every group. Change it here rather than discounting the headcounts.">
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block text-[12px]">
            <div className="font-semibold">Hours per person per month</div>
            <input
              className="input mt-1 w-32"
              type="number"
              step="any"
              value={cap.hoursPerPersonPerMonth}
              onChange={(e) => setCap({ hoursPerPersonPerMonth: Number(e.target.value) || 0 })}
            />
            <div className="mt-0.5 text-[var(--text-muted)]">160 is a 40-hour week averaged over a year.</div>
          </label>
          <label className="block text-[12px]">
            <div className="font-semibold">Utilisation</div>
            <input
              className="input mt-1 w-32"
              type="number"
              step="0.05"
              min="0"
              max="1"
              value={cap.utilisation}
              onChange={(e) => setCap({ utilisation: Math.max(0, Math.min(1, Number(e.target.value) || 0)) })}
            />
            <div className="mt-0.5 text-[var(--text-muted)]">
              The share of those hours that reaches this project. Leave, training and other jobs live here.
            </div>
          </label>
          <div className="text-[12px]">
            <div className="font-semibold">Each person supplies</div>
            <div className="mt-1 text-[22px] font-semibold tabular-nums">{Math.round(perPerson)} h</div>
            <div className="text-[var(--text-muted)]">per month, to this project.</div>
          </div>
        </div>
      </Panel>
    </Page>
  );
}

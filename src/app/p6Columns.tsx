/**
 * Columns for what an XER says about a budgeted activity: float, criticality, what
 * it is waiting on, P6's own status and percent, its WBS, its constraint and the
 * labour P6 planned on it.
 *
 * Shared by every table of budget rows, and only offered when the schedule in use
 * came from an XER — an Excel export carries none of it, and a column of blanks
 * would read as "no float" rather than "not known".
 */
import type { BudgetRow, P6Extras } from '../engine/types';
import type { Column } from './components/ui';
import { Badge } from './components/ui';
import { href } from './router';
import { fmtDate, fmtPct } from './format';

const p6 = (r: BudgetRow): P6Extras | undefined => r.activity.p6;

/** One line on what an activity is waiting on, for a cell or an export. */
export function waitingText(x: P6Extras | undefined): string {
  if (!x || x.waitingOn.length === 0) return '';
  const first = x.waitingOn[0];
  const more = x.waitingOnCount - 1;
  return `${first.id} ${first.name} (${first.inScope ? 'T&C' : first.group || 'other'}, finish ${fmtDate(first.finish)})${more > 0 ? ` +${more} more` : ''}`;
}

/** True when any row carries P6's extras: the schedule in use came from an XER. */
export function hasP6(rows: BudgetRow[]): boolean {
  return rows.some((r) => r.activity.p6 !== undefined);
}

export function p6Columns(): Column<BudgetRow>[] {
  return [
    {
      key: 'tf',
      label: 'Total float',
      num: true,
      value: (r) => p6(r)?.totalFloat ?? null,
      render: (r) => {
        const x = p6(r);
        if (!x || x.totalFloat === null) return '';
        return <span className={x.totalFloat < 0 || x.critical ? 'tone-bad font-semibold' : ''}>{x.totalFloat}</span>;
      },
    },
    {
      key: 'waiting',
      label: 'Waiting on',
      value: (r) => p6(r)?.waitingOnCount ?? null,
      exportValue: (r) => waitingText(p6(r)),
      render: (r) => {
        const x = p6(r);
        if (!x) return '';
        if (x.status === 'COMPLETE') return <span className="text-[var(--text-subtle)]">done</span>;
        if (x.waitingOn.length === 0) return <span className="text-[var(--text-subtle)]">{x.preds ? 'nothing open' : 'no predecessor'}</span>;
        const w = x.waitingOn[0];
        return (
          <span className="flex items-center gap-1.5 whitespace-nowrap" title={x.waitingOn.map((l) => `${l.id} ${l.name} — ${l.status.toLowerCase()}, finish ${fmtDate(l.finish)}${l.driving ? ' (driving)' : ''}${l.inScope ? '' : ` — ${l.group || l.wbs}`}`).join('\n')}>
            {w.driving && <b className="tone-bad">●</b>}
            <span className="font-mono text-[11px]">{w.id}</span>
            {!w.inScope && <Badge tone="warn">{w.group || 'other'}</Badge>}
            {x.waitingOnCount > 1 && <span className="text-[11px] text-[var(--text-muted)]">+{x.waitingOnCount - 1}</span>}
            <a className="btn-link text-[11px]" href={href('schedule', { act: r.activityId })} title="Open it on the Gantt">
              Gantt
            </a>
          </span>
        );
      },
    },
    { key: 'crit', label: 'Critical', optional: true, value: (r) => (p6(r)?.critical ? 'Yes' : ''), render: (r) => (p6(r)?.critical ? <span className="tone-bad font-semibold">Yes</span> : '') },
    { key: 'p6status', label: 'P6 status', optional: true, value: (r) => p6(r)?.status ?? '' },
    { key: 'p6pct', label: 'P6 %', optional: true, num: true, value: (r) => p6(r)?.p6Pct ?? null, render: (r) => (p6(r) ? fmtPct(p6(r)!.p6Pct, 0) : '') },
    {
      key: 'p6h',
      label: 'P6 planned h',
      optional: true,
      num: true,
      value: (r) => {
        const x = p6(r);
        return x && x.resources.length ? Math.round(x.resources.reduce((s, l) => s + l.budget, 0) * 10) / 10 : null;
      },
    },
    { key: 'wbs', label: 'WBS', optional: true, value: (r) => p6(r)?.wbs ?? '' },
    {
      key: 'cstr',
      label: 'Constraint',
      optional: true,
      value: (r) => {
        const x = p6(r);
        return x?.constraint ? `${x.constraint}${x.constraintDate ? ` ${fmtDate(x.constraintDate)}` : ''}` : '';
      },
    },
    { key: 'lf', label: 'Late finish', optional: true, value: (r) => p6(r)?.lateFinish ?? null, render: (r) => fmtDate(p6(r)?.lateFinish ?? null) },
  ];
}

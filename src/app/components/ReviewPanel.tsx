/**
 * Activities in REVIEW, by activity type, with the answer each one needs.
 *
 * REVIEW is the one status that is a question rather than an answer: the activity
 * has no rate, so it carries no hours, so it is on neither the Activity Library's
 * list of priced types nor Progress — and Budget Master, the one place it does
 * show, used to say only the word. This says why (the type was never added to the
 * library, or its key was retired), what answering it would add on the default
 * rate, and puts the three possible answers one click away: price it, exclude it,
 * or hide it.
 *
 * Grouped by type because that is where the answer lives: pricing a type answers
 * every activity of it at once.
 */
import { useMemo } from 'react';
import { useApp } from '../state';
import { Panel, SortableTable, Badge, type Column } from './ui';
import type { ActivityVisibility, BudgetRow, ReviewCause } from '../../engine/types';
import { normKey } from '../../engine/keys';
import { fmtHours } from '../format';
import { href } from '../router';
import { upsertOverrides } from '../overrides';

type TypeLine = { type: string; cause: ReviewCause; rows: BudgetRow[]; hours: number };

const CAUSE_LABEL: Record<ReviewCause, string> = {
  'NO KEY': 'Not in the Activity Library',
  'RETIRED KEY': 'Its key was retired',
  'NO TYPE': 'No name in P6',
};

export function reviewTypes(rows: BudgetRow[]): TypeLine[] {
  const by = new Map<string, TypeLine>();
  for (const r of rows) {
    if (r.status !== 'REVIEW' || !r.reviewCause) continue;
    const k = `${r.reviewCause}|${normKey(r.activityType)}`;
    const line = by.get(k) ?? { type: r.activityType, cause: r.reviewCause, rows: [], hours: 0 };
    line.rows.push(r);
    line.hours += r.hoursIfPriced ?? 0;
    by.set(k, line);
  }
  return [...by.values()].sort((a, b) => b.hours - a.hours || b.rows.length - a.rows.length || a.type.localeCompare(b.type));
}

export function ReviewPanel({ rows, title }: { rows: BudgetRow[]; title?: string }) {
  const { actions } = useApp();
  const lines = useMemo(() => reviewTypes(rows), [rows]);
  const count = lines.reduce((s, l) => s + l.rows.length, 0);
  const hours = lines.reduce((s, l) => s + l.hours, 0);
  if (lines.length === 0) return null;

  /** Price these types: a new key on the default rate, or a retired one brought back. */
  const price = (ls: TypeLine[]) => {
    const add = [...new Map(ls.filter((l) => l.cause === 'NO KEY').map((l) => [normKey(l.type), l.type])).values()];
    const restore = new Set(ls.filter((l) => l.cause === 'RETIRED KEY').map((l) => normKey(l.type)));
    // DUR, not the Settings default: a bare key under a RATE default has no shifts and prices at zero.
    actions.update('library', (lib) => [
      ...lib.map((e) => (restore.has(normKey(e.matchKey)) ? { ...e, retired: undefined } : e)),
      ...add.filter((t) => !lib.some((e) => normKey(e.matchKey) === normKey(t))).map((t) => ({ matchKey: t, basis: 'DUR' as const })),
    ]);
    const n = ls.reduce((s, l) => s + l.rows.length, 0);
    const bits = [add.length ? `${add.length} type${add.length === 1 ? '' : 's'} added to the Activity Library on the default rate` : '', restore.size ? `${restore.size} retired key${restore.size === 1 ? '' : 's'} restored` : ''].filter(Boolean);
    actions.notify('ok', `${bits.join(' and ')}: ${n} ${n === 1 ? 'activity is' : 'activities are'} now in the budget. Check the crew and shifts in the Activity Library.`);
  };

  const decide = (ls: TypeLine[], v: ActivityVisibility, verb: string) => {
    const ids = ls.flatMap((l) => l.rows.map((r) => r.activityId));
    if (ids.length > 1 && !confirm(`${verb} ${ids.length} activities? Nothing is deleted, and Budget Master can undo it.`)) return;
    actions.update('overrides', (ovs) => upsertOverrides(ovs, ids, { visibility: v }));
    actions.notify('ok', `${verb}: ${ids.length} ${ids.length === 1 ? 'activity' : 'activities'}.`);
  };

  const columns: Column<TypeLine>[] = [
    {
      key: 'type',
      label: 'Activity type',
      value: (l) => l.type,
      render: (l) => (
        <a className="btn-link" href={href('budget', { flag: 'review', q: l.type })} title="List these activities in Budget Master">
          {l.type || '(blank)'}
        </a>
      ),
    },
    { key: 'cause', label: 'Why REVIEW', value: (l) => CAUSE_LABEL[l.cause], render: (l) => <Badge tone={l.cause === 'RETIRED KEY' ? 'muted' : 'warn'}>{CAUSE_LABEL[l.cause]}</Badge> },
    { key: 'n', label: 'Activities', value: (l) => l.rows.length, num: true },
    {
      key: 'hours',
      label: 'If priced h',
      value: (l) => l.hours,
      num: true,
      hint: 'What these activities would carry if the type were priced on the default rate: default crew x default shift x P6 duration, at each location’s complexity. What leaving them in REVIEW keeps out of the budget.',
      render: (l) => (l.cause === 'NO TYPE' ? '—' : fmtHours(l.hours)),
    },
    {
      key: 'act',
      label: 'Answer',
      value: () => '',
      render: (l) => (
        <span className="flex flex-wrap gap-1.5">
          {l.cause !== 'NO TYPE' && (
            <button className="btn btn-mini btn-primary" title={l.cause === 'RETIRED KEY' ? 'Bring the retired key back, with the rate it had' : 'Add the type to the Activity Library on the default rate, then price it there'} onClick={() => price([l])}>
              {l.cause === 'RETIRED KEY' ? 'Restore key' : 'Add to library'}
            </button>
          )}
          <button className="btn btn-mini" title="Not work in this budget: keep listed, no hours" onClick={() => decide([l], 'EXCLUDED', 'Exclude')}>
            Exclude
          </button>
          <button className="btn btn-mini" title="Not work at all: take it off every list and total" onClick={() => decide([l], 'HIDDEN', 'Hide')}>
            Hide
          </button>
        </span>
      ),
    },
  ];

  return (
    <Panel
      title={title ?? `${count} ${count === 1 ? 'activity is' : 'activities are'} in REVIEW — what they are and what to do`}
      className="mb-3"
      meta={
        <span className="flex flex-wrap items-center gap-2">
          <button className="btn btn-mini btn-primary" onClick={() => price(lines)} disabled={lines.every((l) => l.cause === 'NO TYPE')}>
            {(() => {
              const n = lines.filter((l) => l.cause !== 'NO TYPE').length;
              return n === 1 ? 'Price the type' : `Price all ${n} types`;
            })()}
          </button>
          <button className="btn btn-mini" onClick={() => decide(lines, 'EXCLUDED', 'Exclude')}>Exclude all {count}</button>
          <button className="btn btn-mini" onClick={() => decide(lines, 'HIDDEN', 'Hide')}>Hide all {count}</button>
        </span>
      }
    >
      <div className="mb-2 space-y-1 text-[12px] text-[var(--text-muted)]">
        <p>
          <b>REVIEW means the activity has no rate.</b> Activities are priced by their activity type, through a key in the Activity Library. These types have no live key — never
          added to the library (typically a schedule brought back from the import history, or a library restored from a backup), or added and then retired. So they carry
          no hours: they are not in the Activity Library’s list, not on Progress, and not in any total or the percent complete.
        </p>
        <p>
          Each type needs one answer. <b>Add to library</b> (or <b>Restore key</b>) if it is work in this budget — it joins on the default rate, about{' '}
          <b>{fmtHours(hours)} h</b> for all of them, and you then set its crew and shifts in the <a href={href('library')}>Activity Library</a>. <b>Exclude</b> if it is real but
          belongs to someone else’s budget: it stays listed with no hours. <b>Hide</b> if it is not work at all. Nothing is deleted either way.
        </p>
      </div>
      <SortableTable tableId="review-types" exportName="review-types" rows={lines} columns={columns} rowKey={(l) => `${l.cause}|${l.type}`} maxHeight="360px" />
    </Panel>
  );
}

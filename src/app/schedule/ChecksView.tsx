/**
 * A schedule review: the questions a scheduler asks of any update before believing
 * its dates. Open ends, broken sequence, constraints holding dates, negative float.
 * Each is a count you can open, and every list can be taken to the activity view.
 */
import { useMemo, useState } from 'react';
import { CHECKS, scheduleChecks, type CheckKey } from '../../engine/xerLogic';
import { CONSTRAINT_LABEL, totalFloatDays, wbsPathName, type P6Task } from '../../engine/xerProject';
import { SortableTable, type Column } from '../components/ui';
import type { ScheduleCtx } from './context';
import { fmtMs } from './timeline';

export function ChecksView({ ctx }: { ctx: ScheduleCtx }) {
  const { model, project, tasks, inScope } = ctx;
  const [scope, setScope] = useState<'in' | 'all'>('in');
  const [open, setOpen] = useState<CheckKey | null>(null);
  const set = useMemo(() => (scope === 'in' ? tasks.filter(inScope) : tasks), [scope, tasks, inScope]);
  const results = useMemo(() => scheduleChecks(model, project, set), [model, project, set]);
  const openSet = set.filter((t) => t.status !== 'COMPLETE').length;
  const def = open ? CHECKS.find((c) => c.key === open) : null;
  const list = open ? results[open] : [];

  const columns: Column<P6Task>[] = [
    {
      key: 'code',
      label: 'Activity ID',
      locked: true,
      value: (t) => t.code,
      render: (t) => (
        <button className="btn-link mono" onClick={() => ctx.reveal(t.uid)}>
          {t.code}
        </button>
      ),
    },
    { key: 'name', label: 'Activity Name', value: (t) => t.name, render: (t) => <span className="cell-text" style={{ maxWidth: '24rem' }} title={t.name}>{t.name}</span> },
    { key: 'status', label: 'Status', value: (t) => t.status },
    { key: 'start', label: 'Start', value: (t) => t.start, render: (t) => `${fmtMs(t.start)}${t.actStart !== null ? ' A' : ''}` },
    { key: 'finish', label: 'Finish', value: (t) => t.finish, render: (t) => `${fmtMs(t.finish)}${t.actFinish !== null ? ' A' : ''}` },
    { key: 'tf', label: 'Total float', num: true, value: (t) => totalFloatDays(t) },
    { key: 'cstr', label: 'Constraint', value: (t) => (t.cstrType ? `${CONSTRAINT_LABEL[t.cstrType] ?? t.cstrType} ${fmtMs(t.cstrDate)}` : '') },
    { key: 'preds', label: 'Preds', num: true, value: (t) => model.predsOf.get(t.uid)?.length ?? 0 },
    { key: 'succs', label: 'Succs', num: true, value: (t) => model.succsOf.get(t.uid)?.length ?? 0 },
    { key: 'wbs', label: 'WBS name', value: (t) => wbsPathName(model, t.wbsUid), optional: true },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <div className="seg" role="group">
          <button type="button" aria-pressed={scope === 'in'} onClick={() => setScope('in')}>
            T&amp;C scope ({tasks.filter(inScope).length.toLocaleString()})
          </button>
          <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
            Whole project ({tasks.length.toLocaleString()})
          </button>
        </div>
        <span className="text-[var(--text-muted)]">
          {openSet.toLocaleString()} of them not complete. Counts are activities; a relationship check counts the successor.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        {CHECKS.map((c) => {
          const n = results[c.key].length;
          const tone = n === 0 ? 'tone-good' : c.severity === 'bad' ? 'tone-bad' : c.severity === 'warn' ? 'tone-warn' : 'tone-info';
          return (
            <button key={c.key} type="button" className={`outcome-tile ${tone}${open === c.key ? ' is-on' : ''}`} onClick={() => setOpen(open === c.key ? null : c.key)} title={c.explain} disabled={n === 0}>
              <span className="outcome-tile-n">{n.toLocaleString()}</span>
              <span className="outcome-tile-l">{c.label}</span>
            </button>
          );
        })}
      </div>

      {def ? (
        <div>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[12.5px]">
              <b>{def.label}.</b> <span className="text-[var(--text-muted)]">{def.explain}</span>
            </div>
            <button className="btn btn-mini" onClick={() => ctx.showList(list.map((t) => t.uid), `${def.label}: ${list.length} activities (${scope === 'in' ? 'T&C scope' : 'whole project'})`)}>
              Show these on the Gantt
            </button>
          </div>
          <SortableTable rows={list} columns={columns} rowKey={(t) => t.uid} tableId="schedule-checks" exportName={`Check-${def.key}`} maxHeight="calc(100vh - 420px)" />
        </div>
      ) : (
        <div className="text-[12px] text-[var(--text-muted)]">Pick a check to list its activities. Hover a tile for what it means.</div>
      )}
    </div>
  );
}

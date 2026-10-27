/**
 * One activity, everything the file says about it: P6's Activity Details, in one
 * panel under the Gantt.
 */
import React, { useState } from 'react';
import { normKey } from '../../engine/keys';
import {
  CONSTRAINT_LABEL,
  HARD_CONSTRAINTS,
  TASK_TYPE_LABEL,
  assignmentLines,
  codeOf,
  freeFloatDays,
  hrsToDays,
  isCritical,
  p6Percent,
  totalFloatDays,
  wbsCode,
  wbsPathName,
  type P6Task,
} from '../../engine/xerProject';
import { predecessorsOf, successorsOf, type LinkView } from '../../engine/xerLogic';
import { ownerOf } from '../../engine/xerScope';
import { Badge } from '../components/ui';
import { href } from '../router';
import { fmtHours, fmtPct } from '../format';
import type { ScheduleCtx } from './context';
import { fmtMs, fmtMsTime } from './timeline';

type Tab = 'general' | 'logic' | 'resources' | 'codes' | 'notes' | 'budget';

export function Details({
  ctx,
  task,
  height,
  onHeight,
  onClose,
  onTrace,
  onGo,
}: {
  ctx: ScheduleCtx;
  task: P6Task;
  height: number;
  onHeight: (h: number) => void;
  onClose: () => void;
  onTrace: (dir: 'up' | 'down', drivingOnly: boolean) => void;
  onGo: (uid: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('general');
  const [h, setH] = useState(height);
  const { model } = ctx;
  const budget = ctx.budgetById.get(normKey(task.code));
  const memos = model.taskMemos.get(task.uid) ?? [];
  const inScope = ctx.inScope(task);
  const crit = isCritical(task, ctx.project);
  const preds = model.predsOf.get(task.uid)?.length ?? 0;
  const succs = model.succsOf.get(task.uid)?.length ?? 0;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    const from = e.clientY;
    const start = h;
    const grip = e.currentTarget as HTMLElement;
    grip.setPointerCapture(e.pointerId);
    let latest = start;
    const move = (ev: PointerEvent) => {
      latest = Math.max(140, Math.min(900, Math.round(start - (ev.clientY - from))));
      setH(latest);
    };
    const done = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', done);
      onHeight(latest);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', done);
  };

  const tabs: [Tab, string][] = [
    ['general', 'General'],
    ['logic', `Relationships (${preds} / ${succs})`],
    ['resources', `Resources (${model.assignmentsOf.get(task.uid)?.length ?? 0})`],
    ['codes', 'Codes & fields'],
    ['notes', `Notebook${memos.length ? ` (${memos.length})` : ''}`],
    ...(budget ? ([['budget', 'T&C budget']] as [Tab, string][]) : []),
  ];

  return (
    <div className="sched-details" style={{ height: h }}>
      <div className="sched-details-grip" onPointerDown={startDrag} title="Drag to resize" />
      <div className="sched-details-head">
        <div className="min-w-0">
          <div className="truncate">
            <span className="mono font-semibold">{task.code}</span> <span>{task.name}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--text-muted)]">
            <Badge tone={task.status === 'COMPLETE' ? 'muted' : task.status === 'IN PROGRESS' ? 'warn' : 'info'}>{task.status.toLowerCase()}</Badge>
            {crit && <Badge tone="bad">critical</Badge>}
            {inScope ? <Badge tone="purple">T&amp;C scope</Badge> : <span>outside the T&amp;C scope</span>}
            <span>{wbsPathName(model, task.wbsUid)}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="btn btn-mini" onClick={() => onTrace('up', true)} title="List the chain of predecessors that drive this activity's dates">
            Trace driving path
          </button>
          <button className="btn btn-mini" onClick={() => onTrace('up', false)} title="List everything upstream of this activity">
            All predecessors
          </button>
          <button className="btn btn-mini" onClick={() => onTrace('down', false)} title="List everything this activity feeds into">
            All successors
          </button>
          <button className="btn btn-mini" onClick={onClose} aria-label="Close the activity panel">
            ✕
          </button>
        </div>
      </div>
      <div className="sched-details-tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'is-on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="sched-details-body">
        {tab === 'general' && <General ctx={ctx} task={task} />}
        {tab === 'logic' && <Logic ctx={ctx} task={task} onGo={onGo} />}
        {tab === 'resources' && <Resources ctx={ctx} task={task} />}
        {tab === 'codes' && <Codes ctx={ctx} task={task} />}
        {tab === 'notes' && (
          <div className="space-y-3">
            {memos.length === 0 && <div className="text-[var(--text-subtle)]">No notebook entries on this activity.</div>}
            {memos.map((m, i) => (
              <div key={i}>
                <div className="factlet-label">{m.type}</div>
                <div className="mt-1 whitespace-pre-wrap text-[12.5px]">{m.text}</div>
              </div>
            ))}
          </div>
        )}
        {tab === 'budget' && budget && (
          <Facts
            rows={[
              ['Budget status', budget.status],
              ['Activity type (library key)', budget.matchKey || budget.activityType],
              ['Budget hours', fmtHours(budget.budgetHours, 1)],
              ['Earned hours', fmtHours(budget.earnedHours, 1)],
              ['Percent complete', `${fmtPct(budget.pctComplete, 0)} (${budget.pctSource === 'OVERRIDE' ? 'keyed on Progress' : 'from P6 durations'})`],
              ['P6 percent complete', `${fmtPct(p6Percent(task), 0)} (${task.pctType.toLowerCase()})`],
              ['Phase', budget.phaseName],
              ['Location', budget.locationName],
              ['Resources (budget)', budget.resources.map((r) => `${r.count} ${r.label}`).join(', ') || '—'],
              ['Why', budget.statusReason || '—'],
            ]}
            footer={
              <a className="btn btn-mini" href={href('budget', { q: task.code })}>
                Open in Budget Master
              </a>
            }
          />
        )}
      </div>
    </div>
  );
}

function Facts({ rows, footer }: { rows: [string, React.ReactNode][]; footer?: React.ReactNode }) {
  return (
    <div>
      <dl className="sched-facts">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v === '' || v === null || v === undefined ? '—' : v}</dd>
          </div>
        ))}
      </dl>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}

function General({ ctx, task }: { ctx: ScheduleCtx; task: P6Task }) {
  const { model } = ctx;
  const cal = model.calendars.get(task.calUid);
  const bl = ctx.baseline.get(normKey(task.code));
  const tf = totalFloatDays(task);
  const d = (n: number | null) => (n === null ? '' : `${Number.isInteger(n) ? n : n.toFixed(2)} d`);
  const cstr = (type: string, date: number | null) =>
    type ? `${CONSTRAINT_LABEL[type] ?? type}${date !== null ? ` ${fmtMs(date)}` : ''}${HARD_CONSTRAINTS.has(type) ? ' (hard)' : ''}` : '';
  return (
    <Facts
      rows={[
        ['WBS', `${wbsCode(model, task.wbsUid)} — ${wbsPathName(model, task.wbsUid)}`],
        ['Activity type', TASK_TYPE_LABEL[task.type]],
        ['Calendar', cal ? `${cal.name} (${cal.hoursPerDay} h/day)` : `not in the file (${task.hpd} h/day assumed)`],
        ['Original duration', d(hrsToDays(task.odHrs, task.hpd))],
        ['Remaining duration', d(hrsToDays(task.rdHrs, task.hpd))],
        ['Percent complete', `${Math.round(p6Percent(task) * 100)}% (${task.pctType.toLowerCase()} percent complete)`],
        ['Start', `${fmtMsTime(task.start)}${task.actStart !== null ? ' A' : ''}`],
        ['Finish', `${fmtMsTime(task.finish)}${task.actFinish !== null ? ' A' : ''}`],
        ['Early start / finish', task.earlyStart !== null || task.earlyFinish !== null ? `${fmtMs(task.earlyStart)} – ${fmtMs(task.earlyFinish)}` : ''],
        ['Late start / finish', task.lateStart !== null || task.lateFinish !== null ? `${fmtMs(task.lateStart)} – ${fmtMs(task.lateFinish)}` : ''],
        ['Planned start / finish', `${fmtMs(task.plannedStart)} – ${fmtMs(task.plannedFinish)}`],
        ['Baseline start / finish', bl ? `${fmtMs(bl.start)} – ${fmtMs(bl.finish)}` : ''],
        ['Total float', tf === null ? (task.status === 'COMPLETE' ? 'complete' : '') : <span className={tf < 0 || isCritical(task, ctx.project) ? 'tone-bad font-semibold' : ''}>{d(tf)}</span>],
        ['Free float', d(freeFloatDays(task))],
        ['Constraint', cstr(task.cstrType, task.cstrDate)],
        ['Secondary constraint', cstr(task.cstrType2, task.cstrDate2)],
        ['Expected finish', fmtMs(task.expectFinish)],
        ['Longest path', task.drivingPath ? 'Yes' : 'No'],
      ]}
    />
  );
}

const STATE_LABEL: Record<LinkView['state'], string> = {
  DONE: 'satisfied',
  DRIVING: 'driving',
  'NOT DRIVING': 'not driving',
  'OUT OF SEQUENCE': 'out of sequence',
  VIOLATED: 'not honoured',
  UNKNOWN: '—',
};

function Logic({ ctx, task, onGo }: { ctx: ScheduleCtx; task: P6Task; onGo: (uid: string) => void }) {
  const preds = predecessorsOf(ctx.model, task.uid);
  const succs = successorsOf(ctx.model, task.uid);
  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      <LinkTable title="Predecessors" views={preds} other={(v) => v.pred} ctx={ctx} onGo={onGo} />
      <LinkTable title="Successors" views={succs} other={(v) => v.succ} ctx={ctx} onGo={onGo} />
    </div>
  );
}

function LinkTable({ title, views, other, ctx, onGo }: { title: string; views: LinkView[]; other: (v: LinkView) => P6Task; ctx: ScheduleCtx; onGo: (uid: string) => void }) {
  return (
    <div>
      <div className="factlet-label">
        {title} ({views.length})
      </div>
      {views.length === 0 ? (
        <div className="mt-1 text-[var(--text-subtle)]">None.</div>
      ) : (
        <div className="mt-1 overflow-x-auto">
        <table className="tbl sched-mini">
          <thead>
            <tr>
              <th>Activity</th>
              <th>Link</th>
              <th className="num">Lag</th>
              <th>Start</th>
              <th>Finish</th>
              <th className="num">Float</th>
              <th>State</th>
              <th>Whose</th>
            </tr>
          </thead>
          <tbody>
            {views.map((v) => {
              const t = other(v);
              const tf = totalFloatDays(t);
              return (
                <tr key={v.rel.uid}>
                  <td className="cell-text" style={{ maxWidth: 320 }}>
                    <button className="btn-link mono" onClick={() => onGo(t.uid)} title={`Go to ${t.code}`}>
                      {t.code}
                    </button>{' '}
                    <span className="text-[var(--text-muted)]" title={t.name}>{t.name}</span>
                  </td>
                  <td>{v.rel.type}</td>
                  <td className="num">{v.lagDays ? v.lagDays : ''}</td>
                  <td>{fmtMs(t.start)}{t.actStart !== null ? ' A' : ''}</td>
                  <td>{fmtMs(t.finish)}{t.actFinish !== null ? ' A' : ''}</td>
                  <td className={`num${tf !== null && tf < 0 ? ' tone-bad' : ''}`}>{tf === null ? '' : tf}</td>
                  <td>
                    <span className={`link-state ls-${v.state.replace(/ /g, '-').toLowerCase()}`}>
                      {STATE_LABEL[v.state]}
                      {v.state === 'NOT DRIVING' && v.gapDays !== null ? ` (${v.gapDays} d)` : ''}
                    </span>
                  </td>
                  <td>{ctx.inScope(t) ? <Badge tone="purple">T&amp;C</Badge> : <span className="text-[var(--text-muted)]">{ownerOf(ctx.model, t)}</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </div>
      )}
    </div>
  );
}

function Resources({ ctx, task }: { ctx: ScheduleCtx; task: P6Task }) {
  const lines = assignmentLines(ctx.model, task.uid);
  if (lines.length === 0) return <div className="text-[var(--text-subtle)]">No resources are assigned to this activity in P6.</div>;
  const n = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
  return (
    <table className="tbl sched-mini">
      <thead>
        <tr>
          <th>Resource</th>
          <th>Role</th>
          <th>Type</th>
          <th className="num">Budgeted</th>
          <th className="num">Remaining</th>
          <th className="num">Actual</th>
          <th className="num">Budgeted cost</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l, i) => (
          <tr key={i}>
            <td>
              {l.resource} {l.code && <span className="mono text-[var(--text-muted)]">{l.code}</span>}
            </td>
            <td>{l.role}</td>
            <td>{l.type}</td>
            <td className="num">{n(l.budget)}</td>
            <td className="num">{n(l.remaining)}</td>
            <td className="num">{n(l.actual)}</td>
            <td className="num">{l.budgetCost ? n(l.budgetCost) : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Codes({ ctx, task }: { ctx: ScheduleCtx; task: P6Task }) {
  const { model } = ctx;
  const codes = ctx.codeTypes.map((ct) => [ct.name, codeOf(model, task.uid, ct.uid)] as const).filter(([, v]) => v);
  const udfs = model.taskUdfs.get(task.uid);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <div className="factlet-label">Activity codes</div>
        {codes.length === 0 ? (
          <div className="mt-1 text-[var(--text-subtle)]">None assigned.</div>
        ) : (
          <dl className="sched-facts mt-1">
            {codes.map(([name, v]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>
                  <span className="mono">{v!.short}</span> {v!.name && v!.name !== v!.short ? <span className="text-[var(--text-muted)]">{v!.name}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div>
        <div className="factlet-label">User-defined fields</div>
        {!udfs || udfs.size === 0 ? (
          <div className="mt-1 text-[var(--text-subtle)]">None set.</div>
        ) : (
          <dl className="sched-facts mt-1">
            {[...udfs.entries()].map(([uid, v]) => (
              <div key={uid}>
                <dt>{model.udfTypes.get(uid)?.label ?? uid}</dt>
                <dd>{typeof v === 'number' ? v.toLocaleString() : v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

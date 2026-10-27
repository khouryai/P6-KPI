/**
 * The T&C lookahead: what is due to start in the next few weeks, and whether it can.
 *
 * An activity waiting only on other T&C work is the team's own sequencing. One
 * waiting on somebody else's work — an installation, an access, a contractor — is
 * a conversation to have before the date arrives, and this lists who to have it
 * with. That is the one thing the filtered Excel export could never show: the
 * predecessors it filtered out.
 */
import { useMemo, useState } from 'react';
import { readiness, type LinkView, type Readiness, type ReadinessRow } from '../../engine/xerLogic';
import { ownerOf } from '../../engine/xerScope';
import { codeOf, totalFloatDays, type P6Task } from '../../engine/xerProject';
import { Badge, SortableTable, type Column } from '../components/ui';
import type { ScheduleCtx } from './context';
import { fmtMs } from './timeline';

const DAY = 86_400_000;

const READINESS_LABEL: Record<Readiness, string> = {
  READY: 'Ready',
  'WAITING ON SCOPE': 'Waiting on T&C',
  'WAITING ON OTHERS': 'Waiting on others',
};

export function ReadinessView({ ctx }: { ctx: ScheduleCtx }) {
  const { model, project, tasks, inScope } = ctx;
  const [weeks, setWeeks] = useState(6);
  const [show, setShow] = useState<'all' | Readiness>('all');
  const [ownerBy, setOwnerBy] = useState('owner');
  const from = ctx.dataDate ?? Date.now();
  const rows = useMemo(() => readiness(model, project, tasks, inScope, from, weeks * 7), [model, project, tasks, inScope, from, weeks]);
  const shown = show === 'all' ? rows : rows.filter((r) => r.readiness === show);
  const ownerOfTask = useMemo(() => {
    if (ownerBy.startsWith('code:')) {
      const typeUid = ownerBy.slice(5);
      return (t: P6Task) => codeOf(model, t.uid, typeUid)?.short ?? '(no code)';
    }
    return (t: P6Task) => ownerOf(model, t) || '(unknown)';
  }, [ownerBy, model]);

  const count = (r: Readiness) => rows.filter((x) => x.readiness === r).length;
  const critical = rows.filter((r) => r.critical && r.readiness !== 'READY').length;

  // Who the T&C work is waiting on, most-needed first.
  const owners = useMemo(() => {
    const m = new Map<string, { owner: string; held: Set<string>; preds: Set<string>; needBy: number | null; driving: number }>();
    for (const r of rows) {
      for (const v of r.others) {
        const k = ownerOfTask(v.pred);
        let o = m.get(k);
        if (!o) m.set(k, (o = { owner: k, held: new Set(), preds: new Set(), needBy: null, driving: 0 }));
        o.held.add(r.task.uid);
        o.preds.add(v.pred.uid);
        if (v.state === 'DRIVING' || v.state === 'VIOLATED') o.driving += 1;
        const s = r.task.start;
        if (s !== null && (o.needBy === null || s < o.needBy)) o.needBy = s;
      }
    }
    return [...m.values()].sort((a, b) => (a.needBy ?? Infinity) - (b.needBy ?? Infinity) || b.held.size - a.held.size);
  }, [rows, ownerOfTask]);

  const columns: Column<ReadinessRow>[] = [
    {
      key: 'code',
      label: 'Activity ID',
      locked: true,
      value: (r) => r.task.code,
      render: (r) => (
        <button className="btn-link mono" onClick={() => ctx.reveal(r.task.uid)} title="Show it in the activity list">
          {r.task.code}
        </button>
      ),
    },
    { key: 'name', label: 'Activity Name', value: (r) => r.task.name, render: (r) => <span className="cell-text" style={{ maxWidth: '22rem' }} title={r.task.name}>{r.task.name}</span> },
    { key: 'start', label: 'Start', value: (r) => r.task.start, render: (r) => fmtMs(r.task.start), exportValue: (r) => (r.task.start !== null ? new Date(r.task.start).toISOString().slice(0, 10) : '') },
    { key: 'in', label: 'Starts in', num: true, value: (r) => (r.task.start === null ? null : Math.round((r.task.start - from) / DAY)), render: (r) => (r.task.start === null ? '' : `${Math.round((r.task.start - from) / DAY)} d`), hint: 'Calendar days from the data date to the forecast start.' },
    {
      key: 'tf',
      label: 'Total float',
      num: true,
      value: (r) => r.totalFloatDays,
      render: (r) => <span className={r.critical ? 'tone-bad font-semibold' : ''}>{r.totalFloatDays ?? ''}</span>,
    },
    {
      key: 'ready',
      label: 'Readiness',
      value: (r) => READINESS_LABEL[r.readiness],
      render: (r) => <Badge tone={r.readiness === 'READY' ? 'good' : r.readiness === 'WAITING ON OTHERS' ? 'bad' : 'warn'}>{READINESS_LABEL[r.readiness]}</Badge>,
    },
    {
      key: 'waiting',
      label: 'Waiting on',
      value: (r) => r.open.map((v) => v.pred.code).join(', '),
      exportValue: (r) => r.open.map((v) => `${v.pred.code} ${v.pred.name} (${ownerOf(model, v.pred)}, finish ${fmtMs(v.pred.finish)})`).join('; '),
      render: (r) => <WaitingList open={r.open} ctx={ctx} />,
    },
    {
      key: 'whose',
      label: 'Whose',
      value: (r) => [...new Set(r.others.map((v) => ownerOfTask(v.pred)))].join(', '),
      hint: 'Who the work it is waiting on belongs to: the work type in the predecessor’s Activity ID, or its WBS, or the activity code chosen above.',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-[var(--text-muted)]">T&amp;C activities due to start within</span>
        <div className="seg" role="group">
          {[2, 4, 6, 8, 12].map((w) => (
            <button key={w} type="button" aria-pressed={weeks === w} onClick={() => setWeeks(w)}>
              {w} weeks
            </button>
          ))}
        </div>
        <span className="text-[var(--text-muted)]">of the data date ({fmtMs(from)}), with the predecessors still open on each.</span>
        <span className="ml-auto flex items-center gap-1">
          Whose work by
          <select className="input" value={ownerBy} onChange={(e) => setOwnerBy(e.target.value)}>
            <option value="owner">work type / WBS</option>
            {ctx.codeTypes.map((c) => (
              <option key={c.uid} value={`code:${c.uid}`}>
                {c.name}
              </option>
            ))}
          </select>
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {(
          [
            ['all', 'Due to start', rows.length, ''],
            ['READY', 'Ready', count('READY'), 'tone-good'],
            ['WAITING ON SCOPE', 'Waiting on T&C', count('WAITING ON SCOPE'), 'tone-warn'],
            ['WAITING ON OTHERS', 'Waiting on others', count('WAITING ON OTHERS'), 'tone-bad'],
          ] as const
        ).map(([k, label, n, tone]) => (
          <button key={k} type="button" className={`outcome-tile ${tone}${show === k ? ' is-on' : ''}`} onClick={() => setShow(k)}>
            <span className="outcome-tile-n">{n}</span>
            <span className="outcome-tile-l">{label}</span>
          </button>
        ))}
        <div className={`outcome-tile ${critical ? 'tone-bad' : ''}`} title="Critical activities in the window that are still waiting on something">
          <span className="outcome-tile-n">{critical}</span>
          <span className="outcome-tile-l">Critical and waiting</span>
        </div>
      </div>

      <SortableTable rows={shown} columns={columns} rowKey={(r) => r.task.uid} tableId="schedule-readiness" exportName="TC-Readiness" maxHeight="calc(100vh - 470px)" />

      <div className="card">
        <h2 className="card-title">Who the T&amp;C work is waiting on</h2>
        <p className="mt-1 text-[12px] text-[var(--text-muted)]">
          Open predecessors outside the T&amp;C scope, by whose work they are. <b>Needed by</b> is the earliest start among the T&amp;C activities each one holds.
        </p>
        <table className="tbl mt-2">
          <thead>
            <tr>
              <th>Whose</th>
              <th className="num">T&amp;C activities held</th>
              <th className="num">Their activities</th>
              <th className="num">Driving</th>
              <th>Needed by</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {owners.length === 0 && (
              <tr>
                <td colSpan={6} className="py-4 text-center text-[var(--text-subtle)]">
                  Nothing in the window is waiting on work outside the T&amp;C scope.
                </td>
              </tr>
            )}
            {owners.map((o) => (
              <tr key={o.owner}>
                <td className="font-semibold">{o.owner}</td>
                <td className="num">{o.held.size}</td>
                <td className="num">{o.preds.size}</td>
                <td className="num">{o.driving || ''}</td>
                <td>{fmtMs(o.needBy)}</td>
                <td>
                  <button className="btn-link" onClick={() => ctx.showList([...o.preds, ...o.held], `${o.owner}: ${o.preds.size} activities holding ${o.held.size} T&C activities in the next ${weeks} weeks`)}>
                    show them
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WaitingList({ open, ctx }: { open: LinkView[]; ctx: ScheduleCtx }) {
  if (open.length === 0) return <span className="text-[var(--text-subtle)]">nothing</span>;
  const shown = open.slice(0, 3);
  return (
    <span className="block" style={{ whiteSpace: 'normal', maxWidth: '30rem' }}>
      {shown.map((v) => {
        const tf = totalFloatDays(v.pred);
        return (
          <span key={v.rel.uid} className="block text-[11.5px]">
            {(v.state === 'DRIVING' || v.state === 'VIOLATED') && <b className="tone-bad" title="Driving: this is what holds the start">● </b>}
            <button className="btn-link mono" onClick={() => ctx.reveal(v.pred.uid)}>
              {v.pred.code}
            </button>{' '}
            <span className="text-[var(--text-muted)]">
              {v.pred.name} · {v.pred.status === 'IN PROGRESS' ? 'in progress, ' : ''}finish {fmtMs(v.pred.finish)}
              {tf !== null && tf < 0 ? <span className="tone-bad"> · {tf} d float</span> : null}
              {ctx.inScope(v.pred) ? '' : ` · ${ownerOf(ctx.model, v.pred)}`}
            </span>
          </span>
        );
      })}
      {open.length > shown.length && <span className="block text-[11px] text-[var(--text-subtle)]">and {open.length - shown.length} more</span>}
    </span>
  );
}

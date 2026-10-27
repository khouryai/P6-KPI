/**
 * What the P6 file says about the T&C work that the budget alone cannot: which of
 * it is critical, which has run out of float, and what is about to start while
 * still waiting on somebody else's work. Shown only when the schedule in use came
 * from an XER.
 */
import { useMemo } from 'react';
import type { BudgetRow } from '../../engine/types';
import { addDaysISO, isValidISO } from '../../engine/dates';
import { Panel, Badge } from './ui';
import { href } from '../router';
import { fmtDate } from '../format';

const SOON_DAYS = 14;

export function P6Panel({ rows, dataDate }: { rows: BudgetRow[]; dataDate: string }) {
  const facts = useMemo(() => {
    const withP6 = rows.filter((r) => r.activity.p6 && r.status === 'IN BUDGET');
    if (withP6.length === 0) return null;
    const open = withP6.filter((r) => r.activity.p6!.status !== 'COMPLETE');
    const critical = open.filter((r) => r.activity.p6!.critical);
    const negative = open.filter((r) => (r.activity.p6!.totalFloat ?? 0) < 0);
    const horizon = isValidISO(dataDate) ? addDaysISO(dataDate, SOON_DAYS) : null;
    const soon = open.filter((r) => r.activity.p6!.status === 'NOT STARTED' && r.currentStart !== null && horizon !== null && r.currentStart <= horizon);
    const soonBlocked = soon.filter((r) => r.activity.p6!.waitingOn.some((l) => !l.inScope));
    const blocked = open.filter((r) => r.activity.p6!.waitingOn.some((l) => !l.inScope));
    return { critical, negative, soon, soonBlocked, blocked };
  }, [rows, dataDate]);

  if (!facts) return null;
  const tile = (n: number, label: string, to: string, bad: boolean) => (
    <a href={to} className={`outcome-tile ${n ? (bad ? 'tone-bad' : 'tone-warn') : 'tone-good'}`}>
      <span className="outcome-tile-n">{n}</span>
      <span className="outcome-tile-l">{label}</span>
    </a>
  );
  return (
    <Panel
      title="From the P6 file"
      meta={
        <span className="flex items-baseline gap-3">
          <span>T&amp;C activities in the budget, as P6 schedules them.</span>
          <a className="btn-link" href={href('schedule', { tab: 'readiness' })}>
            T&amp;C lookahead →
          </a>
          <a className="btn-link" href={href('schedule')}>
            Schedule →
          </a>
        </span>
      }
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {tile(facts.critical.length, 'Critical, not finished', href('budget', { flag: 'critical' }), true)}
        {tile(facts.negative.length, 'Negative float', href('budget', { flag: 'negfloat' }), true)}
        {tile(facts.soonBlocked.length, `Due in ${SOON_DAYS} days, waiting on others`, href('schedule', { tab: 'readiness' }), true)}
        {tile(facts.blocked.length, 'Waiting on work outside T&C', href('budget', { flag: 'waitingothers' }), false)}
      </div>
      {facts.soonBlocked.length > 0 && (
        <table className="tbl mt-3">
          <thead>
            <tr>
              <th>Due to start</th>
              <th>Activity</th>
              <th>Waiting on</th>
              <th>Finish</th>
            </tr>
          </thead>
          <tbody>
            {facts.soonBlocked
              .sort((a, b) => (a.currentStart ?? '').localeCompare(b.currentStart ?? ''))
              .slice(0, 6)
              .map((r) => {
                const w = r.activity.p6!.waitingOn.find((l) => !l.inScope)!;
                return (
                  <tr key={r.activityId}>
                    <td>{fmtDate(r.currentStart)}</td>
                    <td className="cell-text" style={{ maxWidth: '22rem' }}>
                      <a className="btn-link mono text-[11px]" href={href('schedule', { act: r.activityId })}>
                        {r.activityId}
                      </a>{' '}
                      <span title={r.activityName}>{r.activityName}</span>
                    </td>
                    <td className="cell-text" style={{ maxWidth: '22rem' }} title={`${w.id} ${w.name}`}>
                      {w.driving && <b className="tone-bad">● </b>}
                      <span className="mono text-[11px]">{w.id}</span> {w.name} <Badge tone="warn">{w.group || 'other'}</Badge>
                    </td>
                    <td>{fmtDate(w.finish)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

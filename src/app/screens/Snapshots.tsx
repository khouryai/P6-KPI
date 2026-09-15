import { useState } from 'react';
import { useApp } from '../state';
import { Page, Notice, Badge } from '../components/ui';
import { buildSnapshot } from '../../engine/compute';
import { fmtHours, fmtPct, fmtDate, fmtDateTime } from '../format';
import { isValidISO } from '../../engine/dates';

export function Snapshots() {
  const { state, model, actions } = useApp();
  const [date, setDate] = useState(state.data.settings.statusDate || '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const valid = isValidISO(date);
  const preview = valid ? buildSnapshot(model, date, note) : null;
  const earned = preview ? preview.lines.reduce((s, l) => s + l.earnedHours, 0) : 0;
  const budget = preview ? preview.lines.reduce((s, l) => s + l.budgetHours, 0) : 0;
  const existing = state.data.snapshots.filter((s) => s.statusDate === date).length;
  const curveAt = model.curve.find((c) => c.periodEnd === date);

  const take = async () => {
    setBusy(true);
    try {
      await actions.takeSnapshot(date, note.trim() || undefined);
      setNote('');
    } catch (err) {
      actions.notify('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page eyebrow="Progress" title="Snapshots" subtitle="A snapshot records percent complete per in-budget activity on a chosen status date. Snapshots are the audit trail and a cross-check, plotted as markers against the continuous earned curve. Insert only: no edit, no delete.">
      <div className="card">
        <h2 className="card-title">Take a snapshot</h2>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <label className="text-[12px]">
            Status date
            <input className="input ml-2" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex-1 text-[12px]">
            Note
            <input className="input ml-2 w-2/3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </label>
          <button className="btn btn-primary" disabled={!valid || busy || state.dirty.size > 0 || !preview?.lines.length} onClick={() => void take()}>
            {busy ? 'Writing…' : 'Write snapshot'}
          </button>
        </div>
        {state.dirty.size > 0 && <div className="mt-2"><Notice tone="warn">Save your unsaved changes first, so the snapshot matches what is on disk.</Notice></div>}
        {preview && (
          <div className="mt-3 text-[12px]">
            <div>
              Will write <b>{preview.lines.length}</b> lines to <code>snapshots/{date}{existing ? `-${existing}` : ''}.json</code>: budget <b>{fmtHours(budget)} h</b>, earned <b>{fmtHours(earned, 1)} h</b> ({fmtPct(budget ? earned / budget : 0)}).
              {curveAt && curveAt.earned !== null && (
                <span className="ml-2 text-[var(--text-muted)]">
                  The earned curve at {fmtDate(date)} reads {fmtHours(curveAt.earned, 1)} h; the difference of {fmtHours(earned - curveAt.earned, 1)} h is work whose earn window is not yet fully elapsed, or activities earning without a window.
                </span>
              )}
              {!curveAt && <span className="ml-2 text-[var(--warn)]">This date is not a month end, so the marker will not sit on a curve period.</span>}
            </div>
            {existing > 0 && <div className="mt-1 text-[var(--warn)]">A snapshot for this date already exists. A second one will be written alongside it, not over it.</div>}
            <details className="mt-2">
              <summary className="cursor-pointer">Preview lines</summary>
              <div className="mt-1 max-h-64 overflow-auto">
                <table className="tbl">
                  <thead><tr><th>Activity ID</th><th className="text-right">% complete</th><th className="text-right">Budget h</th><th className="text-right">Earned h</th></tr></thead>
                  <tbody>{preview.lines.map((l) => <tr key={l.activityId}><td className="font-mono text-[11px]">{l.activityId}</td><td className="num">{fmtPct(l.pctComplete, 0)}</td><td className="num">{fmtHours(l.budgetHours)}</td><td className="num">{fmtHours(l.earnedHours, 1)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          </div>
        )}
      </div>
      <div className="card mt-4">
        <h2 className="card-title">Past snapshots</h2>
        <table className="tbl mt-2">
          <thead><tr><th>Status date</th><th>Taken</th><th className="text-right">Lines</th><th className="text-right">Budget h</th><th className="text-right">Earned h</th><th className="text-right">Curve at date</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {state.data.snapshots.map((s, i) => {
              const e = s.lines.reduce((x, l) => x + l.earnedHours, 0);
              const b = s.lines.reduce((x, l) => x + l.budgetHours, 0);
              const c = model.curve.find((p) => p.periodEnd === s.statusDate);
              const far = c && c.earned !== null && b > 0 && Math.abs(e - c.earned) / b > 0.05;
              return (
                <tr key={`${s.statusDate}-${s.takenAt}`}>
                  <td>{fmtDate(s.statusDate)}</td>
                  <td>{fmtDateTime(s.takenAt)}</td>
                  <td className="num">{s.lines.length}</td>
                  <td className="num">{fmtHours(b)}</td>
                  <td className="num">{fmtHours(e, 1)}</td>
                  <td className="num">{c && c.earned !== null ? <>{fmtHours(c.earned, 1)} {far && <Badge tone="warn">off curve</Badge>}</> : <span className="text-[var(--text-subtle)]">n/a</span>}</td>
                  <td>{s.note ?? ''}</td>
                  <td><button className="btn-link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'hide' : 'lines'}</button></td>
                </tr>
              );
            })}
            {state.data.snapshots.length === 0 && <tr><td colSpan={8} className="py-4 text-center text-[var(--text-subtle)]">No snapshots yet.</td></tr>}
          </tbody>
        </table>
        {open !== null && state.data.snapshots[open] && (
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="tbl">
              <thead><tr><th>Activity ID</th><th className="text-right">% complete</th><th className="text-right">Budget h</th><th className="text-right">Earned h</th></tr></thead>
              <tbody>{state.data.snapshots[open].lines.map((l) => <tr key={l.activityId}><td className="font-mono text-[11px]">{l.activityId}</td><td className="num">{fmtPct(l.pctComplete, 0)}</td><td className="num">{fmtHours(l.budgetHours)}</td><td className="num">{fmtHours(l.earnedHours, 1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">A marker far off the earned curve means the underlying data (rates, dates, test counts) changed after the snapshot was taken.</p>
      </div>
    </Page>
  );
}

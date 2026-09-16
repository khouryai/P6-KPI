import { useState } from 'react';
import { useApp } from '../state';
import { Page, Notice, Badge } from '../components/ui';
import { buildSnapshot } from '../../engine/compute';
import { fmtHours, fmtPct, fmtDate, fmtDateTime } from '../format';
import { isValidISO } from '../../engine/dates';
import type { Snapshot } from '../../engine/types';

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
  const hiddenCount = state.data.snapshots.filter((s) => s.hidden).length;
  const curveAt = model.curve.find((c) => c.periodEnd === date);

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      actions.notify('error', `${what} failed. ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const toggleHidden = (s: Snapshot) => void act('Changing the snapshot', () => actions.setSnapshotHidden(s, !s.hidden));

  const remove = (s: Snapshot) => {
    const when = `${fmtDate(s.statusDate)} (taken ${fmtDateTime(s.takenAt)})`;
    if (!confirm(`Delete the snapshot for ${when}?\n\nIts ${s.lines.length} lines go with it and there is no other copy. To keep the record but take it off the S-curve, use "hide" instead.`)) return;
    void act('Deleting the snapshot', () => actions.deleteSnapshot(s));
  };

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
    <Page
      eyebrow="Progress"
      title="Snapshots"
      subtitle="A snapshot records percent complete per in-budget activity on a chosen status date. Snapshots are the audit trail and a cross-check, plotted as markers against the continuous earned curve. They are never edited: a correction is a new snapshot. One can be taken off the curve while staying on the record, and deleted outright when it should never have existed."
    >
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
                  <thead><tr><th>Activity ID</th><th className="num">% complete</th><th className="num">Budget h</th><th className="num">Earned h</th></tr></thead>
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
          <thead><tr><th>Status date</th><th>Taken</th><th className="num">Lines</th><th className="num">Budget h</th><th className="num">Earned h</th><th className="num">Curve at date</th><th>On the curve</th><th>Note</th><th></th></tr></thead>
          <tbody>
            {state.data.snapshots.map((s, i) => {
              const e = s.lines.reduce((x, l) => x + l.earnedHours, 0);
              const b = s.lines.reduce((x, l) => x + l.budgetHours, 0);
              const c = model.curve.find((p) => p.periodEnd === s.statusDate);
              const far = !s.hidden && c && c.earned !== null && b > 0 && Math.abs(e - c.earned) / b > 0.05;
              return (
                <tr key={s.file ?? `${s.statusDate}-${s.takenAt}`} className={s.hidden ? 'row-muted' : ''}>
                  <td>{fmtDate(s.statusDate)}</td>
                  <td>{fmtDateTime(s.takenAt)}</td>
                  <td className="num">{s.lines.length}</td>
                  <td className="num">{fmtHours(b)}</td>
                  <td className="num">{fmtHours(e, 1)}</td>
                  <td className="num">{c && c.earned !== null ? <>{fmtHours(c.earned, 1)} {far && <Badge tone="warn">off curve</Badge>}</> : <span className="text-[var(--text-subtle)]">n/a</span>}</td>
                  <td>{s.hidden ? <Badge tone="muted">hidden</Badge> : <Badge tone="good">plotted</Badge>}</td>
                  <td>{s.note ?? ''}</td>
                  <td>
                    <span className="flex gap-2">
                      <button className="btn-link" onClick={() => setOpen(open === i ? null : i)}>{open === i ? 'close' : 'lines'}</button>
                      <button
                        className="btn-link"
                        disabled={busy}
                        title={s.hidden ? 'Plot this snapshot against the earned curve again' : 'Keep the record but take the marker off the S-curve'}
                        onClick={() => toggleHidden(s)}
                      >
                        {s.hidden ? 'show' : 'hide'}
                      </button>
                      <button className="btn-link danger" disabled={busy} title="Delete this snapshot and its lines for good" onClick={() => remove(s)}>
                        delete
                      </button>
                    </span>
                  </td>
                </tr>
              );
            })}
            {state.data.snapshots.length === 0 && <tr><td colSpan={9} className="py-4 text-center text-[var(--text-subtle)]">No snapshots yet.</td></tr>}
          </tbody>
        </table>
        {open !== null && state.data.snapshots[open] && (
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="tbl">
              <thead><tr><th>Activity ID</th><th className="num">% complete</th><th className="num">Budget h</th><th className="num">Earned h</th></tr></thead>
              <tbody>{state.data.snapshots[open].lines.map((l) => <tr key={l.activityId}><td className="font-mono text-[11px]">{l.activityId}</td><td className="num">{fmtPct(l.pctComplete, 0)}</td><td className="num">{fmtHours(l.budgetHours)}</td><td className="num">{fmtHours(l.earnedHours, 1)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
          A marker far off the earned curve means the underlying data (rates, dates, test counts) changed after the snapshot was taken. That is usually worth explaining
          rather than removing. <b>Hide</b> keeps the snapshot and its lines exactly as they are and only stops it plotting, which is the right move for one taken against
          numbers that later turned out to be wrong. <b>Delete</b> is for a snapshot that should never have been written at all — a wrong status date, a duplicate — and
          there is no other copy of it.
          {hiddenCount > 0 && <> {hiddenCount} of {state.data.snapshots.length} {hiddenCount === 1 ? 'is' : 'are'} currently hidden and {hiddenCount === 1 ? 'does' : 'do'} not appear on any curve.</>}
        </p>
      </div>
    </Page>
  );
}

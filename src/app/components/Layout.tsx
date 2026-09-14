import React from 'react';
import { useApp } from '../state';
import { href } from '../router';
import { fmtDateTime } from '../format';

const NAV: { id: string; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'import', label: 'Import' },
  { id: 'library', label: 'Activity Library' },
  { id: 'locations', label: 'Locations' },
  { id: 'budget', label: 'Budget Master' },
  { id: 'progress', label: 'Test Progress' },
  { id: 'snapshots', label: 'Snapshots' },
  { id: 'settings', label: 'Settings' },
];

export function Layout({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { state, model, actions } = useApp();
  const dirty = state.dirty.size > 0;
  const q = model.summary;
  const attention = q.review + q.typesOnDefaults + q.typesNeedingShifts + q.noDates + q.onNoCurve + state.conflicts.length;
  return (
    <div className="flex h-screen">
      <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-[#1e3a5f] text-slate-100">
        <div className="px-4 py-4">
          <div className="text-[15px] font-semibold leading-tight">T&amp;C Budget</div>
          <div className="text-[11px] text-slate-300">P6 man hours and S-curves</div>
        </div>
        <nav className="flex-1">
          {NAV.map((n) => (
            <a key={n.id} href={href(n.id)} className={`flex items-center justify-between px-4 py-2 text-[13px] hover:bg-white/10 ${screen === n.id ? 'bg-white/15 font-semibold' : ''}`}>
              <span>{n.label}</span>
              {n.id === 'dashboard' && attention > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-900">{attention}</span>}
            </a>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3 text-[11px] text-slate-300">
          <div className="truncate" title={state.storageLabel}>
            {state.adapterKind === 'filesystem' ? `Folder: ${state.folderName}` : state.adapterKind === 'memory' ? 'Memory only, nothing is saved' : 'No storage'}
          </div>
          {state.lastSavedAt && <div>Saved {fmtDateTime(state.lastSavedAt)}</div>}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <div className={`flex items-center justify-between gap-3 border-b px-5 py-1.5 text-[12px] ${dirty ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-500'}`}>
          <div>
            {dirty ? (
              <span>
                <span className="font-semibold">Unsaved changes</span> in {[...state.dirty].join(', ')}. Nothing is written to OneDrive until you save.
              </span>
            ) : (
              <span>All changes saved.</span>
            )}
          </div>
          <button className={`btn ${dirty ? 'btn-primary' : ''}`} disabled={!dirty || state.saving} onClick={() => void actions.save()}>
            {state.saving ? 'Saving…' : 'Save'}
          </button>
        </div>
        {state.conflicts.length > 0 && (
          <div className="border-b border-red-300 bg-red-50 px-5 py-2 text-[12px] text-red-900">
            <span className="font-semibold">OneDrive conflict copies found.</span> Two machines edited the folder at the same time. These files were not merged and are being ignored:{' '}
            {state.conflicts.map((c) => (
              <code key={c.path} className="mr-2 rounded bg-white px-1">
                {c.path}
              </code>
            ))}
            Open the folder, compare each copy with its original ({state.conflicts.map((c) => c.of).filter((v, i, a) => a.indexOf(v) === i).join(', ')}), keep one, delete the other, then reload.
          </div>
        )}
        {state.lock?.foreign && (
          <div className="border-b border-amber-300 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
            <span className="font-semibold">Another machine may have this folder open</span> ({state.lock.foreign.label}, last seen {fmtDateTime(state.lock.foreign.refreshedAt)}). Saving from both will create OneDrive conflict copies.
          </div>
        )}
        {state.problems.length > 0 && (
          <div className="border-b border-amber-300 bg-amber-50 px-5 py-2 text-[12px] text-amber-900">
            {state.problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}
        <div className="min-h-0 flex-1">{children}</div>
        {state.toast && (
          <div className={`fixed bottom-4 right-4 z-50 max-w-lg rounded border px-4 py-2 text-[13px] shadow-lg ${state.toast.kind === 'error' ? 'border-red-300 bg-red-50 text-red-900' : state.toast.kind === 'ok' ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-blue-300 bg-blue-50 text-blue-900'}`}>
            {state.toast.text}
          </div>
        )}
      </main>
    </div>
  );
}

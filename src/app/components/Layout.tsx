import React from 'react';
import { useApp } from '../state';
import { href } from '../router';
import { fmtDateTime } from '../format';
import { BUILD_COMMIT, BUILD_TIME, buildLabel } from '../build';
import { applyUpdate, useUpdateReady } from '../update';

/** Nav grouped into mono-labelled sections, as in cx-portal's sidenav. */
const NAV: { section: string; items: { id: string; label: string }[] }[] = [
  {
    section: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'import', label: 'Import' },
    ],
  },
  {
    section: 'Budget',
    items: [
      { id: 'library', label: 'Activity Library' },
      { id: 'locations', label: 'Locations' },
      { id: 'subsystems', label: 'Subsystems' },
      { id: 'budget', label: 'Budget Master' },
    ],
  },
  {
    section: 'Progress',
    items: [
      { id: 'rollup', label: 'By Phase & Location' },
      { id: 'progress', label: 'Test Progress' },
      { id: 'team', label: 'Earned vs Built' },
      { id: 'snapshots', label: 'Snapshots' },
    ],
  },
  {
    section: 'Setup',
    items: [{ id: 'settings', label: 'Settings' }],
  },
];

export function Layout({ screen, children }: { screen: string; children: React.ReactNode }) {
  const { state, model, actions } = useApp();
  const dirty = state.dirty.size > 0;
  const updateReady = useUpdateReady();
  const q = model.summary;
  const attention = q.review + q.typesOnDefaults + q.typesNeedingShifts + q.noDates + q.onNoCurve + state.conflicts.length;

  const storageLine =
    state.adapterKind === 'filesystem'
      ? state.folderName
      : state.adapterKind === 'indexeddb'
        ? 'This browser'
        : state.adapterKind === 'memory'
          ? 'Not saving'
          : 'No storage';

  return (
    <div className="flex h-screen">
      <aside className="sidenav flex w-56 shrink-0 flex-col">
        <div className="sidenav-brand">
          <div className="sidenav-brand-name">T&amp;C BUDGET</div>
          <div className="sidenav-brand-sub">P6 man hours</div>
        </div>
        <nav className="sidenav-links flex-1 overflow-auto">
          {NAV.map((group) => (
            <div key={group.section}>
              <div className="sidenav-section-label">{group.section}</div>
              {group.items.map((n) => (
                <a key={n.id} href={href(n.id)} className={`nav-link${screen === n.id ? ' active' : ''}`}>
                  <span>{n.label}</span>
                  {n.id === 'dashboard' && attention > 0 && <span className="nav-count">{attention}</span>}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidenav-foot">
          <div className="truncate" title={state.storageLabel}>
            {storageLine}
          </div>
          {state.lastSavedAt && <div className="mt-0.5 opacity-70">Saved {fmtDateTime(state.lastSavedAt)}</div>}
          <div className="mt-1 truncate opacity-60" title={`Build ${BUILD_COMMIT}${BUILD_TIME ? ` built ${fmtDateTime(BUILD_TIME)}` : ''}`}>
            {buildLabel()}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className={`strip flex items-center justify-between gap-3 ${dirty ? 'strip-dirty' : 'strip-quiet'}`}>
          <div className="min-w-0 truncate">
            {dirty ? (
              <>
                <span className="font-semibold">Unsaved changes</span> in {[...state.dirty].join(', ')}. Nothing is written until you save.
              </>
            ) : (
              'All changes saved.'
            )}
          </div>
          <button className={`btn btn-mini ${dirty ? 'btn-primary' : ''}`} disabled={!dirty || state.saving} onClick={() => void actions.save()}>
            {state.saving ? 'Saving…' : 'Save'}
          </button>
        </div>

        {updateReady && (
          <div className="strip strip-new flex items-center justify-between gap-3">
            <div className="min-w-0 truncate">
              <span className="font-semibold">A newer build is on disk.</span> The window is still running the old one. Reloading swaps it in; your data is in storage, not
              in the application, so nothing is lost.
            </div>
            <button
              className="btn btn-mini btn-primary shrink-0"
              disabled={dirty}
              title={dirty ? 'Save your changes first: reloading discards them' : 'Reload into the new build'}
              onClick={applyUpdate}
            >
              {dirty ? 'Save first' : 'Reload now'}
            </button>
          </div>
        )}

        {state.conflicts.length > 0 && (
          <div className="strip strip-error">
            <span className="font-semibold">OneDrive conflict copies found.</span> Two machines edited the folder at the same time. These were not merged and are being
            ignored:{' '}
            {state.conflicts.map((c) => (
              <code key={c.path} className="mono mr-2 rounded bg-white px-1">
                {c.path}
              </code>
            ))}
            Open the folder, compare each copy with its original ({state.conflicts.map((c) => c.of).filter((v, i, a) => a.indexOf(v) === i).join(', ')}), keep one, delete
            the other, then reload.
          </div>
        )}
        {state.lock?.foreign && (
          <div className="strip strip-warn">
            <span className="font-semibold">Another machine may have this folder open</span> ({state.lock.foreign.label}, last seen {fmtDateTime(state.lock.foreign.refreshedAt)}).
            Saving from both will create OneDrive conflict copies.
          </div>
        )}
        {state.adapterKind === 'indexeddb' && (
          <div className="strip strip-warn">
            <span className="font-semibold">Saving in this browser, not in OneDrive.</span> The data lives in this browser profile on this machine only. Clearing browsing
            data will erase it. Take a backup from <a href={href('settings')}>Settings</a>, or switch to a OneDrive folder there.
          </div>
        )}
        {state.adapterKind === 'memory' && (
          <div className="strip strip-error">
            <span className="font-semibold">Nothing is being saved.</span> You are just looking around. Choose a storage folder or browser storage in{' '}
            <a href={href('settings')}>Settings</a> before doing real work.
          </div>
        )}
        {state.problems.length > 0 && (
          <div className="strip strip-warn">
            {state.problems.map((p) => (
              <div key={p}>{p}</div>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1">{children}</div>

        {state.toast && (
          <div className={`toast notice-${state.toast.kind === 'error' ? 'error' : state.toast.kind === 'ok' ? 'ok' : 'info'}`}>{state.toast.text}</div>
        )}
      </main>
    </div>
  );
}

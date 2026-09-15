import { useApp } from '../state';
import { Notice } from '../components/ui';
import { fsaSupported } from '../folder';

export function Setup() {
  const { state, actions } = useApp();
  const canPickFolder = fsaSupported();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--surface-3)] p-6">
      <div className="card max-w-xl">
        <h1 className="text-xl font-semibold text-[var(--text)]">T&amp;C P6 Budget and S-Curve</h1>
        <p className="mt-2 text-[var(--text-muted)]">
          This application keeps all of its data as plain JSON files in a folder inside your OneDrive. Choose (or create) that folder once. OneDrive handles sync, backup and version history from there.
        </p>
        <p className="mt-2 text-[var(--text-muted)]">
          Suggested location: <code className="rounded bg-[var(--surface-3)] px-1">OneDrive\TC-Budget</code>. After choosing it, right-click the folder in Explorer and pick <b>Always keep on this device</b> so OneDrive never leaves a cloud-only placeholder behind.
        </p>
        {!canPickFolder && (
          <div className="mt-3">
            <Notice tone="warn">
              This browser will not let the page open a folder. That usually means the app was opened by double-clicking the HTML file in a browser that blocks it. Start it with <code>start.cmd</code> instead,
              or use browser storage below and keep backups.
            </Notice>
          </div>
        )}
        {state.error && (
          <div className="mt-3">
            <Notice tone="error">{state.error}</Notice>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {state.status === 'needs-permission' ? (
            <button className="btn btn-primary" onClick={() => void actions.grantPermission()}>
              Reconnect to “{state.folderName}”
            </button>
          ) : null}
          <button className="btn btn-primary" disabled={!canPickFolder} onClick={() => void actions.chooseFolder()}>
            {state.status === 'needs-permission' ? 'Choose a different folder' : 'Choose the storage folder…'}
          </button>
          <button className="btn" onClick={() => void actions.useBrowserStorage()} title="Save in this browser profile instead of a folder.">
            Save in this browser instead
          </button>
          <button className="btn" onClick={() => actions.useMemoryOnly()} title="Explore the app without saving anything.">
            Just look around
          </button>
        </div>
        <p className="mt-3 text-[12px] text-[var(--text-muted)]">
          <b>Save in this browser</b> keeps everything in this browser profile on this machine. It survives closing the app and restarting the laptop, but it is not in OneDrive,
          it is not backed up, and clearing browsing data erases it. Take a backup from the Settings screen regularly if you use it. You can switch to a folder later without losing anything.
        </p>
        {state.status === 'loading' && <div className="mt-4 text-[var(--text-muted)]">Reading the folder… If this takes long, OneDrive may be downloading placeholder files.</div>}
        {state.status === 'booting' && <div className="mt-4 text-[var(--text-muted)]">Starting…</div>}
      </div>
    </div>
  );
}

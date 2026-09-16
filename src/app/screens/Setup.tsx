import { useApp } from '../state';
import { Notice } from '../components/ui';
import { fsaSupported } from '../folder';

export function Setup() {
  const { state, actions } = useApp();
  const canPickFolder = fsaSupported();

  /*
   * Coming back to a folder that is already chosen is not setting the app up, and
   * it should not read like it. The folder is remembered; what lapsed is the
   * browser's permission to touch it, which only a gesture can restore. By the time
   * this renders the app has already tried silently and a click anywhere is already
   * wired to try again, so this is a short explanation with one button rather than
   * the first-run screen.
   */
  if (state.status === 'needs-permission') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--surface-3)] p-6">
        <div className="card max-w-lg">
          <h1 className="text-xl font-semibold text-[var(--text)]">Reconnecting to “{state.folderName}”</h1>
          <p className="mt-2 text-[var(--text-muted)]">
            Your folder is remembered and nothing has been lost. Windows drops the app’s permission to open it each time the app closes, and only a click can give it
            back — so click below, or anywhere in this window, and the dashboard opens.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={() => void actions.grantPermission()}>
              Open “{state.folderName}”
            </button>
          </div>
          <div className="mt-4">
            <Notice tone="info">
              To stop being asked at all: when the browser shows its permission bubble, choose <b>Allow on every visit</b> rather than <b>Allow this time</b>. After that
              the app opens straight onto the dashboard.
            </Notice>
          </div>
          {state.error && (
            <div className="mt-3">
              <Notice tone="error">{state.error}</Notice>
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--line-soft)] pt-3">
            <button className="btn btn-mini" disabled={!canPickFolder} onClick={() => void actions.chooseFolder()}>
              Choose a different folder…
            </button>
            <button className="btn btn-mini" onClick={() => void actions.forgetFolder()} title="Forget this folder and start again">
              Forget this folder
            </button>
          </div>
        </div>
      </div>
    );
  }

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
        <p className="mt-2 text-[var(--text-muted)]">
          When the browser asks whether this app may edit the folder, choose <b>Allow on every visit</b>. Answering <b>Allow this time</b> works, but the app will have to
          ask again the next time it opens.
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
          <button className="btn btn-primary" disabled={!canPickFolder} onClick={() => void actions.chooseFolder()}>
            Choose the storage folder…
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

import { useApp } from '../state';
import { Notice } from '../components/ui';

export function Setup() {
  const { state, actions } = useApp();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="card max-w-xl">
        <h1 className="text-xl font-semibold text-slate-900">T&amp;C P6 Budget and S-Curve</h1>
        <p className="mt-2 text-slate-600">
          This application keeps all of its data as plain JSON files in a folder inside your OneDrive. Choose (or create) that folder once. OneDrive handles sync, backup and version history from there.
        </p>
        <p className="mt-2 text-slate-600">
          Suggested location: <code className="rounded bg-slate-100 px-1">OneDrive\TC-Budget</code>. After choosing it, right-click the folder in Explorer and pick <b>Always keep on this device</b> so OneDrive never leaves a cloud-only placeholder behind.
        </p>
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
          <button className="btn btn-primary" onClick={() => void actions.chooseFolder()}>
            {state.status === 'needs-permission' ? 'Choose a different folder' : 'Choose the storage folder…'}
          </button>
          <button className="btn" onClick={() => actions.useMemoryOnly()} title="Explore the app without a folder. Nothing is saved.">
            Continue without a folder (nothing is saved)
          </button>
        </div>
        {state.status === 'loading' && <div className="mt-4 text-slate-500">Reading the folder… If this takes long, OneDrive may be downloading placeholder files.</div>}
        {state.status === 'booting' && <div className="mt-4 text-slate-500">Starting…</div>}
      </div>
    </div>
  );
}

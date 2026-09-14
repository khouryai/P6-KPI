import { IndexedDbAdapter } from '../storage/indexedDbAdapter';

const HANDLE_KEY = 'folderHandle';

type PermissionMode = 'read' | 'readwrite';
type HandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: PermissionMode }) => Promise<PermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { id?: string; mode?: PermissionMode; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
  }
}

export function fsaSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
}

/** Ask the user for the OneDrive folder. Must be called from a user gesture. */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  if (!fsaSupported()) throw new Error('This browser cannot open folders. Use Edge or Chrome on http://localhost.');
  const handle = await window.showDirectoryPicker!({ id: 'tc-budget-store', mode: 'readwrite' });
  return handle;
}

export async function saveFolderHandle(idb: IndexedDbAdapter, handle: FileSystemDirectoryHandle): Promise<void> {
  await idb.setMeta(HANDLE_KEY, handle);
}

export async function loadFolderHandle(idb: IndexedDbAdapter): Promise<FileSystemDirectoryHandle | undefined> {
  return idb.getMeta<FileSystemDirectoryHandle>(HANDLE_KEY);
}

export async function forgetFolderHandle(idb: IndexedDbAdapter): Promise<void> {
  await idb.deleteMeta(HANDLE_KEY);
}

export async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const h = handle as HandleWithPermission;
  if (!h.queryPermission) return 'granted';
  return h.queryPermission({ mode: 'readwrite' });
}

/** Must be called from a user gesture when the state is 'prompt'. */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  const h = handle as HandleWithPermission;
  if (!h.requestPermission) return 'granted';
  return h.requestPermission({ mode: 'readwrite' });
}

/** A stable per-browser identity for the advisory lock file. */
export function ownerIdentity(): { id: string; label: string } {
  let id = '';
  try {
    id = localStorage.getItem('tc-owner-id') ?? '';
    if (!id) {
      id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('tc-owner-id', id);
    }
  } catch {
    id = 'browser';
  }
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const label = `${nav.userAgentData?.platform ?? navigator.platform ?? 'browser'} / ${id.slice(-6)}`;
  return { id, label };
}

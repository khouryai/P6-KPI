/**
 * Build stamp. Vite substitutes these at build time (see vite.config.ts), so the
 * running window can say exactly which build it is. Without it there is no way to
 * answer "did my change actually reach the laptop?" short of reading the bundle.
 */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_TIME__: string;
declare const __STANDALONE__: boolean;

export const BUILD_COMMIT: string = typeof __BUILD_COMMIT__ === 'string' ? __BUILD_COMMIT__ : 'dev';
export const BUILD_TIME: string = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : '';
export const IS_STANDALONE: boolean = typeof __STANDALONE__ === 'boolean' ? __STANDALONE__ : false;

/**
 * Where this window was loaded from.
 *
 * The desktop icon opens `standalone\index.html` by its full path, and a shortcut made
 * from one copy of the folder keeps pointing at that copy forever. Update another copy
 * and the icon goes on running the old build with nothing on screen to say why. This
 * puts the answer in the app: if the folder shown here is not the folder you updated,
 * that is the whole of the problem.
 */
export function runningFrom(): string {
  if (typeof location === 'undefined') return '';
  if (!IS_STANDALONE) return location.origin;
  try {
    const raw = decodeURIComponent(location.pathname);
    // A Windows path arrives as /C:/Users/…; anywhere else, leave the separators alone.
    const path = /^\/[A-Za-z]:\//.test(raw) ? raw.slice(1).replace(/\//g, '\\') : raw;
    // The app folder is the one holding the single file.
    return path.replace(/[\\/]standalone[\\/]index\.html$/i, '') || path;
  } catch {
    return location.href;
  }
}

/** "a1b2c3d · 15 Sep 14:32" — short enough for the sidenav footer. */
export function buildLabel(): string {
  const when = BUILD_TIME ? new Date(BUILD_TIME) : null;
  if (!when || Number.isNaN(when.getTime())) return BUILD_COMMIT;
  const d = when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const t = when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${BUILD_COMMIT} · ${d} ${t}`;
}

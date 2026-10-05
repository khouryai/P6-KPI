/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'muvpucao';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/index-BbQxIIO3.css","/assets/index-BtEZdxu2.js","/assets/Import-B3sxvyzK.js","/assets/Library-C_QKnDZa.js","/assets/Locations-DnyoBW_W.js","/assets/BudgetMaster-FV-s1oZV.js","/assets/TestProgress-Tun3NWUW.js","/assets/Rollup-Cw4ZtL4Y.js","/assets/Subsystems-BhJXfdb7.js","/assets/TeamHours-D7WzrsXp.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-DZoQ0EdC.js","/assets/trend-C8lVa-dn.js","/assets/Capacity-mqzL39Hp.js","/assets/Staffing-D581V0nw.js","/assets/capacity-DzWoi-lC.js","/assets/PeriodLog-BhbGiGnu.js","/assets/testProgress-CFMDVAFW.js","/assets/BarChart-y-7ndm-X.js","/assets/missedReasons-DaoDyN9W.js","/assets/Bar-DRjSLnNj.js","/assets/IdRules-B9blyQYC.js","/assets/Settings-CtRp-ZCD.js","/assets/workbookExport-BqzawP0E.js","/assets/fiscal-BDzECJ-x.js","/assets/xlsx-CNerDvZX.js"];

/*
 * A new worker installs but does NOT take over on its own. Taking over mid-session
 * would serve the new build's assets to a page still running the old build's code.
 * It waits until the page says go, which the page does after asking the user.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Navigations always resolve to the shell so the app opens even when the server is down.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // index.html and sw.js must never be answered from the cache: they are how a new
  // build announces itself. Everything else under assets/ is content-hashed.
  if (url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })));
});

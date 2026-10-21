/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'mvib13dm';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/index-CIix42Gp.css","/assets/index-DBAF0IdX.js","/assets/Import-CvLEcFV6.js","/assets/Library-_EVOCn_l.js","/assets/Locations-BK9dol40.js","/assets/BudgetMaster-g9usCZQd.js","/assets/TestProgress-CaTU7Vn2.js","/assets/Rollup-CBplY1YA.js","/assets/Subsystems-Dix0oGW_.js","/assets/TeamHours-lhQG-qng.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-DrKJFDjk.js","/assets/trend-C8lVa-dn.js","/assets/Capacity-ShTcesfL.js","/assets/Staffing-llVkQQ_v.js","/assets/capacity-DAign5n0.js","/assets/PeriodLog-B3qaMfyc.js","/assets/testProgress-BeDPVmdn.js","/assets/BarChart-DpGNboBV.js","/assets/periodWindow-SPi0myE4.js","/assets/Bar-BY2MB1Y3.js","/assets/IdRules-CSo6v7Px.js","/assets/Settings-CuFI5fY6.js","/assets/workbookExport-jel9wvFk.js","/assets/fiscal-BDzECJ-x.js","/assets/xlsx-CNerDvZX.js"];

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

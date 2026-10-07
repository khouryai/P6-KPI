/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'muye6457';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/index-DPlFc_bo.css","/assets/index-C0j8MfN8.js","/assets/Import-BRgWYjtF.js","/assets/Library-CzGtF-DZ.js","/assets/Locations-Dd-aLL2T.js","/assets/BudgetMaster-DOh_c3vL.js","/assets/TestProgress-CBJO2HJP.js","/assets/Rollup-DiL2rq2C.js","/assets/Subsystems-C9gaSrET.js","/assets/TeamHours-Dd2Lxoac.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-CZmpmpmg.js","/assets/trend-C8lVa-dn.js","/assets/Capacity-2h5ibTIB.js","/assets/Staffing-D8-Hu0Wo.js","/assets/capacity-_327WufI.js","/assets/PeriodLog-CV0d3Fqi.js","/assets/testProgress-D7mYqRs5.js","/assets/BarChart-CZqXkjgh.js","/assets/periodWindow-CPpngv1W.js","/assets/Bar-zR36Jq7U.js","/assets/IdRules-Cbzs3Hgj.js","/assets/Settings-D9iynK4J.js","/assets/workbookExport-XhROd_wJ.js","/assets/fiscal-BDzECJ-x.js","/assets/xlsx-CNerDvZX.js"];

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

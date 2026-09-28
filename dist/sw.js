/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'mulokb4o';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/index-BcJnYEv-.css","/assets/index-DWBhOrRu.js","/assets/Dashboard-DX5IiCT5.js","/assets/Import-Bc2nO-__.js","/assets/Library-ovjCEfvf.js","/assets/Locations-CM7B2d5V.js","/assets/BudgetMaster-IFP9sBPu.js","/assets/TestProgress-CK0nJt6U.js","/assets/Rollup-BtwsLgvw.js","/assets/Subsystems-BLHTveMw.js","/assets/TeamHours-TCIai24a.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-CbSHCbNR.js","/assets/CurveChart-DNZxsHhQ.js","/assets/trend-C8lVa-dn.js","/assets/ComposedChart-Dzq6zW5L.js","/assets/Capacity-C8aMnJaZ.js","/assets/PeriodLog-i3oZkeYx.js","/assets/testProgress-xRNnrbVX.js","/assets/BarChart-DS9SbZ8h.js","/assets/Bar-CEquqiHK.js","/assets/missedReasons-OLtpiOxY.js","/assets/units-tK0UYeZ7.js","/assets/Legend-DQDtZkdP.js","/assets/CartesianChart-CvX5DexB.js","/assets/IdRules-D4zwTVsk.js","/assets/Settings-e89FJLZl.js","/assets/workbookExport-Byi57eex.js","/assets/fiscal-BDzECJ-x.js","/assets/xlsx-CNerDvZX.js"];

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

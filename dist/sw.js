/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'mvq7ra13';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/index-DZhKWM9U.css","/assets/index-DSniBdHI.js","/assets/Import-IoW_8wmj.js","/assets/Schedule-B-nxpgTQ.js","/assets/xerScope-Bm_S-fWH.js","/assets/Library-C0FiJgUH.js","/assets/Locations-DiBK4r1r.js","/assets/BudgetMaster-bXZxTb3R.js","/assets/ReviewPanel-CaRWfGwK.js","/assets/TestProgress-M8os5RDa.js","/assets/p6Columns-Cmn3xYCD.js","/assets/Rollup-A62c2xV_.js","/assets/Subsystems-ChTHidOu.js","/assets/TeamHours-C4XNEa_A.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-B9kskUL2.js","/assets/trend-C8lVa-dn.js","/assets/Capacity-DG9MCQ8R.js","/assets/Staffing-CB5rJD7t.js","/assets/PeriodLog-BLvii9U3.js","/assets/testProgress-qhrCuF4W.js","/assets/BarChart-CrqqaF_P.js","/assets/periodWindow-BdBLUy8L.js","/assets/Bar-B88be46E.js","/assets/IdRules-D4tAz_v3.js","/assets/Settings-BfAgjb0X.js","/assets/dataExtract-CSXOEXrk.js","/assets/capacity-D76tOVV0.js","/assets/scurvePng-DsQV3n-1.js","/assets/workbookExport-DFfOTy-U.js","/assets/fiscal-BDzECJ-x.js","/assets/missedReasons-xwkEM4c5.js","/assets/xlsx-CNerDvZX.js"];

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

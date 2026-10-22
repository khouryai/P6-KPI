/* Generated at build time. Precache the app shell so the window opens instantly with no network. */
const VERSION = 'mvis1ekp';
const CACHE = `tc-budget-${VERSION}`;
const PRECACHE = ["/","/index.html","/manifest.webmanifest","/icon-192.png","/icon-512.png","/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2","/assets/ibm-plex-mono-latin-500-normal-DSY6xOcd.woff2","/assets/ibm-plex-mono-latin-600-normal-BgSNZQsw.woff2","/assets/archivo-latin-wght-normal-E0tuGl4L.woff2","/assets/index-CoUHjXXx.css","/assets/index-CLvxiDCn.js","/assets/Import-CzM9oUbp.js","/assets/Library-BfF29HPo.js","/assets/Locations-BKQu57I2.js","/assets/BudgetMaster-007RHyAc.js","/assets/ReviewPanel-CgjoqkDC.js","/assets/TestProgress-DDP6biud.js","/assets/Rollup-C4WDEBDQ.js","/assets/Subsystems-Cb_2N5T0.js","/assets/TeamHours-DjvIaogA.js","/assets/workbook-CFRElyU-.js","/assets/StatusReport-BNK9UEuy.js","/assets/trend-C8lVa-dn.js","/assets/Capacity-CeP-mzVH.js","/assets/Staffing-CGacvW09.js","/assets/PeriodLog-D84dNhj5.js","/assets/testProgress-BvdwxKq6.js","/assets/BarChart-CO186hST.js","/assets/periodWindow-BMVRkQ22.js","/assets/Bar-BR49DW5X.js","/assets/IdRules-DpG3KV1t.js","/assets/Settings-Dsm7oJ9E.js","/assets/dataExtract-hIDcYWj9.js","/assets/capacity-dnJmjoQP.js","/assets/missedReasons-DK-CM27j.js","/assets/workbookExport-DHDfcVJ-.js","/assets/fiscal-BDzECJ-x.js","/assets/xlsx-CNerDvZX.js"];

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

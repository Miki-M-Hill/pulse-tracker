// Offline-first service worker: app shell is precached; map tiles and fonts are cached
// at runtime (stale-while-revalidate) so the zone map works on flaky connections.
const VERSION = 'pulse-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'styles/app.css',
  'src/app.js', 'src/core/db.js', 'src/core/time.js', 'src/core/settings.js', 'src/core/geofence.js', 'src/core/tracker.js',
  'src/sensors/features.js', 'src/sensors/motion.js', 'src/sensors/location.js',
  'src/analytics/analyze.js', 'src/analytics/service.js', 'src/analytics/demo.js',
  'src/ui/dom.js', 'src/ui/icons.js', 'src/ui/charts.js',
  'src/ui/views/today.js', 'src/ui/views/insights.js', 'src/ui/views/zone.js', 'src/ui/views/settings.js', 'src/ui/views/pocket.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'pulse-runtime').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Network-first for the shell so updates land quickly; fall back to cache offline.
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(VERSION).then((c) => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html'))));
    return;
  }

  if (/tile\.openstreetmap\.org|unpkg\.com|fonts\.(googleapis|gstatic)\.com/.test(url.host)) {
    e.respondWith(caches.open('pulse-runtime').then(async (c) => {
      const hit = await c.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    }));
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./#/insights'))));
});

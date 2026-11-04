// Lets the installed app open offline. Always tries the network first, so
// updates show up as soon as the phone is online.
const CACHE = 'elazhary-v3';
// Only these are cached. Sign-in and the live database must never pass through.
const CACHED_ORIGINS = [self.location.origin, 'https://www.gstatic.com', 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const FILES = [
  './', 'index.html', 'styles.css', 'calc.js', 'banks.js', 'i18n.js', 'app.js',
  'merge.js', 'sync.js', 'firebase-config.js',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest',
  'logos/aaib.png', 'logos/abc.png', 'logos/adib.png', 'logos/agri.png', 'logos/aib.png', 'logos/alex.png',
  'logos/arab.png', 'logos/atw.png', 'logos/baraka.png', 'logos/ca.png', 'logos/cairo.png', 'logos/cib.png',
  'logos/citi.png', 'logos/edbe.png', 'logos/eg.png', 'logos/enbd.png', 'logos/fab.png', 'logos/faisal.png',
  'logos/hdb.png', 'logos/hsbc.png', 'logos/idb.png', 'logos/kfh.png', 'logos/land.png', 'logos/mashreq.png',
  'logos/mid.png', 'logos/misr.png', 'logos/nasser.png', 'logos/nbe.png', 'logos/nbk.png', 'logos/nxt.png',
  'logos/qnb.png', 'logos/saib.png', 'logos/suez.png', 'logos/united.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  if (!CACHED_ORIGINS.includes(new URL(event.request.url).origin)) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

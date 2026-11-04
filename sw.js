// Lets the installed app open offline. Always tries the network first, so
// updates show up as soon as the phone is online.
const CACHE = 'elazhary-v2';
const FILES = [
  './', 'index.html', 'styles.css', 'calc.js', 'banks.js', 'i18n.js', 'app.js',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest',
  'logos/nbe.png', 'logos/misr.png', 'logos/cairo.png', 'logos/cib.png', 'logos/fab.png', 'logos/abc.png',
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

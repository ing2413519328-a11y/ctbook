const CACHE_NAME = 'cuotiben-v3';
const PRE_CACHE = [
  'index.html',
  'manifest.json'
];

// Install: pre-cache shell
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(PRE_CACHE.map(url => cache.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first for app shell, network-only for Supabase API
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    return; // let browser handle normally
  }

  // Cache-first for app shell and CDN scripts
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request).then((response) => {
        if (response && response.status === 200 && e.request.method === 'GET') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
    })
  );
});

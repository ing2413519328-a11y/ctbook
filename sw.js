const CACHE_NAME = 'cuotiben-v4';
const PRE_CACHE = [
  'manifest.json'
];

// Install: pre-cache shell assets (not index.html to avoid stale cache)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(PRE_CACHE.map(url => cache.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

// Activate: clean old caches, take control immediately
self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      ),
      self.clients.claim(),
    ])
  );
});

// Fetch: network-first for HTML (always get latest), cache-first for other assets
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Never cache Supabase API calls
  if (url.hostname.includes('supabase.co')) {
    return;
  }

  const isHtml = e.request.method === 'GET' &&
    (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || !url.pathname.includes('.'));

  if (isHtml) {
    // Network-first for HTML: always try to get latest from server
    e.respondWith(
      fetch(e.request).then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
        }
        return response;
      }).catch(() => caches.match(e.request).then(cached => cached))
    );
  } else {
    // Cache-first for other assets (images, manifest, etc.)
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
  }
});

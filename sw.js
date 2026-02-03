// sw.js (patched)
// Abrox – Service Worker
// Handles precaching + offline-first fetch with navigation fallback

const CACHE_NAME = 'abrox-chat-v1';
const RUNTIME_CACHE = 'abrox-runtime-v1';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',

  // core scripts
  '/precache.js',
  '/synthetic-people.js',
  '/message-pool.js',
  '/typing-engine.js',
  '/simulation-engine.js',
  '/ui-adapter.js',
  '/message.js',

  // ui / assets
  '/styles.css',
  '/emoji-pack.js',
  '/assets/logo.png'
];

// Install: cache core assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .catch(err => {
        // swallow failures to avoid install failing badly in dev environments
        console.warn('[Abrox SW] precache failed', err);
      })
  );
  // activate immediately so the new SW can take control
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(k => k !== CACHE_NAME && k !== RUNTIME_CACHE)
            .map(k => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

// Helper: is navigation request
function isNavigationRequest(req){
  return req.mode === 'navigate' || (req.method === 'GET' && req.headers.get('accept') && req.headers.get('accept').includes('text/html'));
}

// Fetch: cache-first for precached assets, runtime caching for others, navigation fallback
self.addEventListener('fetch', event => {
  const req = event.request;
  // only handle GET
  if (req.method !== 'GET') return;

  // navigation requests -> try network first, fallback to cache (freshness for SPA)
  if (isNavigationRequest(req)){
    event.respondWith(
      fetch(req).then(networkRes => {
        // optionally update runtime cache with fresh HTML
        caches.open(RUNTIME_CACHE).then(cache => cache.put(req, networkRes.clone()));
        return networkRes;
      }).catch(() => {
        return caches.match('/index.html');
      })
    );
    return;
  }

  // For same-origin precached assets -> cache-first
  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (isSameOrigin && PRECACHE_ASSETS.includes(url.pathname)){
    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        // update runtime cache for future
        caches.open(RUNTIME_CACHE).then(cache => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached)
    ));
    return;
  }

  // For other requests: try cache, then network, then fallback to cached index for navigation-like assets
  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(networkRes => {
        // store non-opaque responses in runtime cache
        try{
          if (networkRes && networkRes.status === 200 && networkRes.type !== 'opaque'){
            const copy = networkRes.clone();
            caches.open(RUNTIME_CACHE).then(cache => {
              cache.put(req, copy).catch(()=>{});
            });
          }
        }catch(e){/* ignore */}
        return networkRes;
      }).catch(() => {
        // last resort for images: return an offline placeholder if desired (not provided here)
        return cached || caches.match('/index.html');
      });
    })
  );
});

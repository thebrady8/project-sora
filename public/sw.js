const CACHE_VERSION = 'project-sora-sprint4-v2';
const CACHE_NAME = CACHE_VERSION;
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  '/offline.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/assets/project-sora-mobile-qr.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/icons/game-cover-placeholder.svg'
];

function isPrivateOrDynamic(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/data/') ||
    url.pathname.includes('/private/') ||
    url.searchParams.has('token') ||
    url.searchParams.has('auth')
  );
}

function isCodeOrDocument(request, url) {
  return (
    request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.mjs') ||
    url.pathname.endsWith('.json') ||
    url.pathname.endsWith('.webmanifest')
  );
}

async function networkFirst(request, fallbackUrl = null) {
  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response && response.ok && response.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(request, { ignoreSearch: false });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await caches.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const networkPromise = fetch(request).then(async (response) => {
    if (response && response.ok && response.type === 'basic') {
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || networkPromise || Response.error();
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(async (cache) => {
        const results = await Promise.allSettled(
          PRECACHE_URLS.map(async (url) => {
            const response = await fetch(url, { cache: 'reload' });
            if (!response.ok) {
              throw new Error(`Precache failed for ${url}: ${response.status}`);
            }
            await cache.put(url, response);
          })
        );

        const failed = results.filter((result) => result.status === 'rejected');
        if (failed.length) {
          console.warn(`Project Sora precache skipped ${failed.length} unavailable asset(s).`);
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
      .then(async () => {
        const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clients.forEach((client) => client.postMessage({ type: 'PROJECT_SORA_UPDATED', version: CACHE_VERSION }));
      })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (isPrivateOrDynamic(url)) {
    event.respondWith(fetch(request, { cache: 'no-store' }));
    return;
  }

  if (isCodeOrDocument(request, url)) {
    event.respondWith(networkFirst(request, request.mode === 'navigate' ? '/offline.html' : null));
    return;
  }

  if (
    url.pathname.endsWith('.css') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.ico')
  ) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  event.respondWith(networkFirst(request));
});

const CACHE_NAME = 'project-sora-static-v3';
const APP_SHELL_URLS = ['/', '/index.html', '/offline.html', '/styles.css', '/app.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png'];

function shouldBypassCache(requestUrl) {
  return requestUrl.pathname.startsWith('/api/') || requestUrl.pathname.startsWith('/data/') || requestUrl.pathname.includes('/private/') || requestUrl.pathname.includes('/profile/') || requestUrl.searchParams.has('token') || requestUrl.searchParams.has('auth');
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
      .then(() => self.clients.matchAll().then((clients) => clients.forEach((client) => client.postMessage({ type: 'SW_UPDATED' }))))
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  const isHttpGet = request.method === 'GET';
  const isSameOrigin = url.origin === self.location.origin;
  const isNavigationRequest = request.mode === 'navigate';
  const isSafeStaticPath = isSameOrigin && (url.pathname === '/' || url.pathname === '/index.html' || url.pathname === '/offline.html' || url.pathname === '/styles.css' || url.pathname === '/app.js' || url.pathname === '/manifest.webmanifest' || url.pathname.startsWith('/icons/'));
  const isApiRequest = isSameOrigin && url.pathname.startsWith('/api/');

  if (!isHttpGet || !isSameOrigin) {
    return;
  }

  if (isApiRequest || shouldBypassCache(url)) {
    event.respondWith(fetch(request).then((response) => {
      if (!response || response.type !== 'basic' || response.status !== 200) {
        return response;
      }
      return response;
    }));
    return;
  }

  if (isNavigationRequest) {
    event.respondWith(
      fetch(request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  if (isSafeStaticPath) {
    event.respondWith(
      caches.match(request, { ignoreSearch: true }).then((cached) => cached || fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      }))
    );
    return;
  }

  event.respondWith(fetch(request));
});


/* SYMPACT PWA Service Worker — cache-first shell, network-fresh market data */

const CACHE_NAME = 'sympact-shell-v7';

const SHELL_FILES = [
  './',
  './index.html',
  './assets/sympact-octopus.webp',
  './app.js',
  './install.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

const scopeURL = self.registration.scope;
const indexURL = new URL('./index.html', scopeURL).href;

async function cacheShell() {
  const cache = await caches.open(CACHE_NAME);

  // Cache each available shell asset individually.
  // One missing icon should not prevent the entire app from installing.
  await Promise.all(
    SHELL_FILES.map(async (path) => {
      const url = new URL(path, scopeURL).href;

      try {
        const response = await fetch(
          new Request(url, { cache: 'reload' })
        );

        if (response.ok) {
          await cache.put(url, response);
        }
      } catch (error) {
        console.warn('SYMPACT shell asset cache failed:', path, error);
      }
    })
  );
}

async function refreshIndex() {
  try {
    const response = await fetch(
      new Request(indexURL, { cache: 'reload' })
    );

    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(indexURL, response.clone());
    }
  } catch (error) {
    // Keep using the cached app when the network is unavailable.
    console.warn('SYMPACT background update unavailable.');
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await cacheShell();
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();

      await Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith('sympact-shell-') &&
              key !== CACHE_NAME
          )
          .map((key) => caches.delete(key))
      );

      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never intercept external APIs: market data must remain live.
  if (url.origin !== self.location.origin) return;

  const scopePath = new URL(scopeURL).pathname;

  if (!url.pathname.startsWith(scopePath)) return;

  // Navigation: show the cached app immediately, then update in background.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached =
          (await cache.match(request)) ||
          (await cache.match(indexURL)) ||
          (await cache.match(new URL('./', scopeURL).href));

        if (cached) {
          event.waitUntil(refreshIndex());
          return cached;
        }

        // First-ever visit: no cache yet, so fetch from the network.
        try {
          const response = await fetch(request);

          if (response.ok) {
            await cache.put(indexURL, response.clone());
          }

          return response;
        } catch (error) {
          return new Response(
            'SYMPACT is not cached yet. Connect to the internet and reopen the app.',
            {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            }
          );
        }
      })()
    );

    return;
  }

  // Same-origin static files: cache-first, then network.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);

        if (
          response.ok &&
          /\.(?:png|webp|svg|webmanifest|ico)$/i.test(url.pathname)
        ) {
          const cache = await caches.open(CACHE_NAME);
          event.waitUntil(cache.put(request, response.clone()));
        }

        return response;
      } catch (error) {
        return Response.error();
      }
    })()
  );
});

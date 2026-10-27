// Service Worker de TOCINETA POS (Instalabilidad PWA y caché de shell)
const CACHE_NAME = 'tocineta-pwa-v2';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/brand/logo-light.png',
  '/brand/logo-dark.png',
  '/brand/carita.png',
  '/icon-192.png',
  '/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // Las llamadas a /api/ siempre van a la red local (nunca cachear APIs transaccionales)
  if (event.request.url.includes('/api/')) {
    return;
  }
  // Para assets estáticos: Network-first con fallback a cache si se corta el wifi
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Service Worker de Tocineta Sonríe POS (Instalabilidad PWA y caché básica de shell)
const CACHE_NAME = 'tocineta-pwa-v1';

self.addEventListener('install', (event) => {
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
    fetch(event.request).catch(() => caches.match(event.request))
  );
});

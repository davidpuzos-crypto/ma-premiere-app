/* ============================================================
   SERVICE WORKER — Le Journal de Bord
   Stratégie : Cache First pour les assets statiques.
   Lors de la première visite, les fichiers principaux sont
   mis en cache ; les visites suivantes se chargent hors-ligne.
============================================================ */

const CACHE_NAME = 'journal-de-bord-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/manifest.json',
];

/* --- Installation : pré-cache les assets statiques --- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS_TO_CACHE))
  );
  self.skipWaiting();
});

/* --- Activation : supprime les anciens caches --- */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* --- Fetch : Cache First, réseau en fallback --- */
self.addEventListener('fetch', event => {
  // Ne pas intercepter les requêtes non-GET ni les appels Firebase/CDN externes
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Mettre en cache uniquement les réponses valides
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      });
    })
  );
});

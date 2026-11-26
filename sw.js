/* ============================================================
   SERVICE WORKER — Le Journal de Bord
   Stratégie : RÉSEAU D'ABORD, cache en secours.
   - En ligne : toujours la dernière version publiée.
   - Réseau lent (> 3,5 s) ou hors ligne : la copie en cache.

   Relève entre deux versions : cycle de vie standard. Le nouveau
   service worker s'installe en arrière-plan et prend le relais
   quand tous les onglets du site ont été fermés. Pas de
   skipWaiting() ni de clients.claim() : une relève forcée pendant
   qu'une page se charge peut laisser cette page sans réponse
   (constaté en test, sur réseau lent). Comme l'ancien service
   worker sert lui aussi le réseau d'abord, personne ne reste sur
   une vieille version en attendant.

   ⚠️ Changer VERSION à chaque publication (même valeur que
   APP_VERSION dans app.js et data-app-version dans index.html).
============================================================ */

const VERSION = '4.1.0';
const CACHE_NAME = 'journal-de-bord-' + VERSION;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core.js',
  './outline.js',
  './humour.js',
  './visuals.js',
  './pages.js',
  './zip.js',
  './pdfdoc.js',
  './pdfread.js',
  './promo.js',
  './docx.js',
  './ics.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './fonts/fraunces-latin.woff2',
  './fonts/fraunces-italic-latin.woff2',
  './fonts/dm-sans-latin.woff2',
];

/* --- Installation : pré-cache des fichiers (en contournant le cache HTTP) --- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE.map(u => new Request(u, { cache: 'reload' }))))
  );
});

/* --- Activation : à ce moment plus aucune page n'utilise l'ancien service worker,
   ses caches peuvent être supprimés sans risque. --- */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
});

/* --- Fetch : réseau d'abord, cache en secours --- */
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase, CDN : non interceptés
  event.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const isNav = req.mode === 'navigate';
  const network = fetch(req).then(res => {
    if (res && res.ok && res.type === 'basic') cache.put(isNav ? './' : req, res.clone());
    return res;
  });
  const cached = await cache.match(isNav ? './' : req, { ignoreSearch: true });
  if (!cached) {
    try { return await network; }
    catch (e) { return Response.error(); }
  }
  network.catch(() => {}); // évite une erreur non gérée si le réseau échoue après coup
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 3500));
  try {
    const res = await Promise.race([network, timeout]);
    return res || cached;
  } catch (e) {
    return cached;
  }
}

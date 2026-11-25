/* ============================================================
   SERVICE WORKER — Le Journal de Bord
   Stratégie : RÉSEAU D'ABORD, cache en secours.
   - En ligne : toujours la dernière version publiée.
   - Réseau lent (> 3,5 s) ou hors ligne : la copie en cache.
   L'ancienne version (v1) servait le cache en priorité et ne
   se mettait jamais à jour : les utilisateurs ayant installé
   l'app restaient bloqués sur la version de mars 2026.
   Ce nouveau fichier étant différent, le navigateur l'installe
   à la visite suivante et la v2 arrive à l'ouverture d'après.
   ⚠️ Changer VERSION à chaque publication (même valeur que
   APP_VERSION dans app.js).
============================================================ */

const VERSION = '2.0.0';
const CACHE_NAME = 'journal-de-bord-' + VERSION;

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './core.js',
  './docx.js',
  './ics.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

/* --- Installation : pré-cache des fichiers (en contournant le cache HTTP) --- */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS_TO_CACHE.map(u => new Request(u, { cache: 'reload' }))))
  );
  self.skipWaiting();
});

/* --- Activation : supprime les anciens caches (dont celui de la v1) ---
   Un onglet déjà ouvert sur l'ancienne version la garde jusqu'à
   sa prochaine ouverture ; app.js protège les données du journal
   si cette ancienne version réécrit le document entre-temps. */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
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

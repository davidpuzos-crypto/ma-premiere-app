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

const VERSION = '5.0.0';
const CACHE_NAME = 'journal-de-bord-' + VERSION;
const SHARE_CACHE = 'journal-de-bord-partage';   // document reçu par « Partager », en attente de la page

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
  './links.js',
  './formats.js',
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
    await Promise.all(keys.filter(k => k !== CACHE_NAME && k !== SHARE_CACHE).map(k => caches.delete(k)));
  })());
});

/* --- Fetch : réseau d'abord, cache en secours --- */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Firebase, CDN : non interceptés
  // Document envoyé à l'application par le menu « Partager » du téléphone (share_target du manifeste)
  if (req.method === 'POST' && url.searchParams.has('share')) { event.respondWith(receiveShare(req)); return; }
  if (req.method !== 'GET') return;
  event.respondWith(networkFirst(req));
});

/* --- « Partager » : le fichier (ou le lien) est mis de côté sur l'appareil, puis la page s'ouvre et le reprend.
   Rien n'est envoyé : c'est un passage de relais entre le système et la page. --- */
async function receiveShare(req) {
  try {
    const form = await req.formData();
    await caches.delete(SHARE_CACHE);
    const cache = await caches.open(SHARE_CACHE);
    let n = 0;
    for (const f of form.getAll('doc')) {
      if (!f || typeof f === 'string' || !f.size || n >= 20) continue;
      await cache.put(`./__partage/${n++}`, new Response(f, { headers: {
        'Content-Type': f.type || 'application/octet-stream',
        'X-Nom': encodeURIComponent(f.name || 'document'),
        'X-Date': String(f.lastModified || Date.now()),
      } }));
    }
    const text = ['url', 'text', 'title'].map(k => form.get(k)).filter(v => typeof v === 'string' && v.trim()).join('\n');
    if (text) await cache.put('./__partage/texte', new Response(text.slice(0, 200000), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } }));
  } catch (e) { /* on ouvre quand même l'application */ }
  return Response.redirect('./?shared=1', 303);
}

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

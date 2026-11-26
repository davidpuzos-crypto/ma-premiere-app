/* ============================================================
   LIENS — un document lié par son lien de partage
   Logique pure (testée dans tests/core.test.mjs) : on reconnaît le
   lien collé et l'on en tire l'adresse que le navigateur peut lire
   directement, sans compte ni serveur intermédiaire.

     Google Docs   export du document (docx + pdf)          → kind 'gdoc'
     Dropbox       fichier partagé par lien : même adresse,
                   servie par dl.dropboxusercontent.com      → kind 'file'
     GitHub        fichier d'un dépôt public (adresse « raw ») → kind 'file'
     autre https   lien direct vers un fichier               → kind 'file'

   Ce qui ne peut pas être lu depuis un navigateur (OneDrive,
   SharePoint, fichiers de Google Drive, Overleaf, dossiers) est
   reconnu aussi, pour l'expliquer clairement.
============================================================ */

const GDOC = /^\/document\/(?:u\/\d+\/)?d\/([A-Za-z0-9_-]{20,100})/;

/** Empreinte courte d'un texte (FNV-1a, base 36). */
export function shortHash(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

const fail = error => ({ error });

/**
 * Reconnaît un lien (ou un identifiant Google Docs nu).
 * Renvoie { kind: 'gdoc', id, key } ou { kind: 'file', url, host, name, key } ou { error }.
 *   erreurs : 'link-bad' (pas un lien), 'link-http' (pas en https), 'link-folder' (un dossier),
 *   'link-onedrive', 'link-drive' (fichier Drive qui n'est pas un Google Doc), 'link-gother'
 *   (Sheets, Slides…), 'link-overleaf', 'link-dropbox' (adresse Dropbox qui n'est pas un lien de partage)
 */
export function parseLink(input) {
  let s = String(input || '').trim();
  if (!s) return fail('link-bad');
  if (/^[A-Za-z0-9_-]{25,100}$/.test(s)) return { kind: 'gdoc', id: s, key: gdocKey(s) };
  // Un lien collé avec du texte autour (« Voici le lien : https://… ») : on garde l'adresse
  const m = /https?:\/\/[^\s<>"']+/i.exec(s);
  if (m) s = m[0].replace(/[),.;]+$/, '');
  else if (/^[\w.-]+\.[a-z]{2,}\//i.test(s)) s = `https://${s}`;
  let u;
  try { u = new URL(s); } catch { return fail('link-bad'); }
  if (u.protocol === 'http:') return fail('link-http');
  if (u.protocol !== 'https:') return fail('link-bad');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const path = u.pathname;

  if (host === 'docs.google.com') {
    const g = GDOC.exec(path);
    if (g) return { kind: 'gdoc', id: g[1], key: gdocKey(g[1]) };
    return fail('link-gother');
  }
  if (host === 'drive.google.com') return fail(/\/folders\//.test(path) ? 'link-folder' : 'link-drive');
  if (host === '1drv.ms' || host === 'onedrive.live.com' || /(^|\.)sharepoint\.com$/.test(host) || host === 'onedrive.com') return fail('link-onedrive');
  if (/(^|\.)overleaf\.com$/.test(host)) return fail('link-overleaf');

  if (host === 'dropbox.com' || host === 'dl.dropbox.com' || host === 'dl.dropboxusercontent.com') {
    if (/^\/(sh|scl\/fo)\//.test(path)) return fail('link-folder');
    if (!/^\/(s|scl\/fi)\/[^/]+\/[^/]+/.test(path)) return fail('link-dropbox');
    // Même fichier, servi par l'hôte de téléchargement (lisible par une page web) ; la clé du lien (rlkey) est conservée
    const q = new URLSearchParams();
    const rl = u.searchParams.get('rlkey');
    if (rl) q.set('rlkey', rl);
    q.set('dl', '1');
    const url = `https://dl.dropboxusercontent.com${path}?${q.toString()}`;
    return file(url, 'Dropbox', path);
  }
  if (host === 'github.com') {
    const g = /^\/([^/]+)\/([^/]+)\/(?:blob|raw)\/(.+)$/.exec(path);
    if (!g) return fail('link-bad');
    return file(`https://raw.githubusercontent.com/${g[1]}/${g[2]}/${g[3]}`, 'GitHub', path);
  }
  if (host === 'raw.githubusercontent.com') return file(`https://${host}${path}`, 'GitHub', path);
  if (host === 'gitlab.com' && /\/-\/blob\//.test(path)) return file(`https://${host}${path.replace('/-/blob/', '/-/raw/')}`, 'GitLab', path);
  u.hash = '';
  return file(u.toString(), host, path);
}

function file(url, host, path) {
  let name = '';
  try { name = decodeURIComponent(path.split('/').filter(Boolean).pop() || ''); } catch { name = path.split('/').pop() || ''; }
  return { kind: 'file', url, host, name: name.slice(0, 150), key: `u_${shortHash(url)}` };
}

/** Clé stable d'un Google Doc dans les données du compte (lettres, chiffres, « _ »). */
export function gdocKey(id) {
  return `g_${String(id).toLowerCase().replace(/[^a-z0-9]/g, '_')}`.slice(0, 100);
}

/** Nom de fichier donné par l'en-tête Content-Disposition d'un téléchargement ('' si absent). */
export function dispositionName(header) {
  const cd = String(header || '');
  let name = '';
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(cd);
  try { if (star) name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* nom mal encodé */ }
  if (!name) { const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd); if (plain) name = plain[1]; }
  return name.trim().slice(0, 150);
}

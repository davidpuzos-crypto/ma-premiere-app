// Bouchon Firestore : stockage dans localStorage, sémantique merge proche de Firestore.
// Par défaut, comme en production aujourd'hui : seules les données privées « users/… » sont autorisées.
// window.__fbConfig.promo = true simule les règles de sécurité de la promo.
const KEY = '__fbstore';
const subs = new Map(); // path -> [ {next} ]
const writes = [];
function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
function save(s) { localStorage.setItem(KEY, JSON.stringify(s)); }
function isMap(v) { return v && typeof v === 'object' && !Array.isArray(v); }
function deepMerge(a, b) {
  const out = isMap(a) ? { ...a } : {};
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    out[k] = isMap(v) && Object.keys(v).length ? deepMerge(out[k], v) : JSON.parse(JSON.stringify(v));
  }
  return out;
}
const cfg = () => window.__fbConfig || {};
const me = () => { try { return (JSON.parse(localStorage.getItem('__fbuser')) || {}).uid || null; } catch { return null; } };
function deny() { const e = new Error('Missing or insufficient permissions.'); e.code = 'permission-denied'; return e; }
/** Règles de sécurité simulées. op : get | list | write | delete */
function check(path, op) {
  const parts = path.split('/');
  const uid = me();
  if (parts[0] === 'users') { if (!uid || parts[1] !== uid) throw deny(); return; }
  if (!cfg().promo) throw deny();
  if (parts[0] === 'profiles') {
    if (parts.length <= 2) {
      if (op === 'get') return;
      if (op === 'list') { if (!uid) throw deny(); return; }
      if (!uid || parts[1] !== uid) throw deny();
      return;
    }
    if (parts[2] === 'cheers') {
      if (!uid) throw deny();
      if (op === 'get' || op === 'list') return;
      if (op === 'write' && parts[3] === uid && parts[1] !== uid) return;
      if (op === 'delete' && (parts[3] === uid || parts[1] === uid)) return;
      throw deny();
    }
  }
  if (parts[0] === 'reports') { if (op === 'write' && uid) return; throw deny(); }
  throw deny();
}
function snap(path, pending, fromCache) {
  const d = load()[path];
  return {
    id: path.split('/').pop(),
    exists: () => d !== undefined,
    data: () => (d === undefined ? undefined : JSON.parse(JSON.stringify(d))),
    metadata: { hasPendingWrites: !!pending, fromCache: !!fromCache },
  };
}
function notify(path, pending) {
  (subs.get(path) || []).forEach(s => s.next(snap(path, pending, false)));
}
window.__fbStore = {
  get: p => load()[p],
  set: (p, d) => { const s = load(); s[p] = d; save(s); },
  all: () => load(),
  remoteSet(p, d, merge = true) { const s = load(); s[p] = merge ? deepMerge(s[p], d) : d; save(s); notify(p, false); },
  writes,
};
export function initializeFirestore() { return { kind: 'db' }; }
export function getFirestore() { return { kind: 'db' }; }
export function persistentLocalCache(o) { return o; }
export function persistentMultipleTabManager() { return {}; }
export function doc(db, ...parts) { return { path: parts.join('/') }; }
export function collection(db, ...parts) { return { path: parts.join('/'), kind: 'collection' }; }
export function orderBy(field, dir = 'asc') { return { kind: 'orderBy', field, dir }; }
export function limit(n) { return { kind: 'limit', n }; }
export function query(col, ...cons) { return { ...col, cons }; }
export async function setDoc(ref, data, opts) {
  if (window.__fbDeny) throw deny();
  check(ref.path, 'write');
  const s = load();
  const clean = JSON.parse(JSON.stringify(data));
  s[ref.path] = opts && opts.merge ? deepMerge(s[ref.path], clean) : clean;
  save(s);
  writes.push({ path: ref.path, data: clean, merge: !!(opts && opts.merge) });
  notify(ref.path, true);
  setTimeout(() => notify(ref.path, false), 40);
}
export async function deleteDoc(ref) {
  check(ref.path, 'delete');
  const s = load();
  delete s[ref.path];
  save(s);
  writes.push({ path: ref.path, deleted: true });
}
export async function getDoc(ref) {
  if (cfg().offline) { const e = new Error('offline'); e.code = 'unavailable'; throw e; }
  check(ref.path, 'get');
  return snap(ref.path, false, false);
}
export async function getDocs(q) {
  check(q.path + '/x', 'list');
  const s = load();
  const depth = q.path.split('/').length + 1;
  let docs = Object.keys(s).filter(p => p.startsWith(q.path + '/') && p.split('/').length === depth).map(p => snap(p, false, false));
  for (const c of q.cons || []) {
    if (c.kind === 'orderBy') docs.sort((a, b) => { const x = a.data()[c.field], y = b.data()[c.field]; return (x > y ? 1 : x < y ? -1 : 0) * (c.dir === 'desc' ? -1 : 1); });
    if (c.kind === 'limit') docs = docs.slice(0, c.n);
  }
  return { docs, size: docs.length, forEach: fn => docs.forEach(fn) };
}
export function onSnapshot(ref, opts, next, error) {
  if (typeof opts === 'function') { error = next; next = opts; }
  const entry = { next };
  if (!subs.has(ref.path)) subs.set(ref.path, []);
  subs.get(ref.path).push(entry);
  const c = cfg();
  if (c.failListen) { setTimeout(() => error({ code: c.failListen }), 50); return () => {}; }
  if (c.cacheFirst) setTimeout(() => next(snap(ref.path, false, true)), 20);
  if (!c.offline) setTimeout(() => next(snap(ref.path, false, false)), c.serverDelay || 60);
  return () => { const arr = subs.get(ref.path) || []; const i = arr.indexOf(entry); if (i >= 0) arr.splice(i, 1); };
}

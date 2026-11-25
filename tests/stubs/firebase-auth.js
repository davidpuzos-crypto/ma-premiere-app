// Bouchon Firebase Auth pour les tests (aucun appel réseau)
const KEY = '__fbuser';
const listeners = [];
function current() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } }
function emit() { const u = current(); listeners.forEach(cb => cb(u)); }
window.__fbAuth = {
  signIn(user) { localStorage.setItem(KEY, JSON.stringify(user)); emit(); },
  signOut() { localStorage.removeItem(KEY); emit(); },
};
export function getAuth() { return { languageCode: null }; }
export async function signInWithEmailAndPassword(auth, email, pw) {
  if (window.__fbAuthFail) { const e = new Error('x'); e.code = window.__fbAuthFail; throw e; }
  window.__fbAuth.signIn({ uid: 'u_' + email.replace(/\W/g, ''), email, displayName: null });
}
export async function createUserWithEmailAndPassword(auth, email, pw) {
  if (window.__fbAuthFail) { const e = new Error('x'); e.code = window.__fbAuthFail; throw e; }
  window.__fbAuth.signIn({ uid: 'u_' + email.replace(/\W/g, ''), email, displayName: null });
}
export async function sendPasswordResetEmail() {}
export class GoogleAuthProvider {}
export async function signInWithPopup() { window.__fbAuth.signIn({ uid: 'u_google', email: 'g@example.com', displayName: 'Camille Test' }); }
export async function signOut() { window.__fbAuth.signOut(); }
export async function deleteUser(user) {
  if (window.__fbDeleteFail) { const e = new Error('x'); e.code = window.__fbDeleteFail; throw e; }
  (window.__fbDeleted = window.__fbDeleted || []).push(user.uid);
  window.__fbAuth.signOut();
}
export function onAuthStateChanged(auth, cb) { listeners.push(cb); setTimeout(() => cb(current()), 30); return () => {}; }

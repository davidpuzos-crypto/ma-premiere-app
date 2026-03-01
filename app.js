import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* ============================================================
   FIREBASE INIT
============================================================ */
const firebaseConfig = {
  apiKey:            "AIzaSyDo-mX-UnFsIqtQMHkKQ04_eQEb4Mttqk4",
  authDomain:        "ma-premiere-app-a5638.firebaseapp.com",
  projectId:         "ma-premiere-app-a5638",
  storageBucket:     "ma-premiere-app-a5638.firebasestorage.app",
  messagingSenderId: "986325338106",
  appId:             "1:986325338106:web:bcd00227eee2c9215d0643",
};
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

/* ============================================================
   MOTIVATIONAL QUOTES
============================================================ */
const QUOTES = [
  "Un voyage de mille lieues commence par un seul pas. Et une thèse par une seule page. 💪",
  "La persévérance est la clé du succès — chaque mot compte !",
  "Votre futur vous regardera écrire ces lignes avec fierté. Continuez ! ✨",
  "Une thèse se mange comme un éléphant : une bouchée à la fois. 🐘",
  "Le secret du succès ? Commencer. Le reste, c'est de la persévérance.",
  "Chaque page écrite est une victoire. Célébrez-les toutes ! 🏆",
  "L'expertise n'est pas le point de départ, c'est la destination. Vous y êtes presque !",
  "Rome ne s'est pas faite en un jour, mais ils posaient des briques tous les jours. 🏛️",
  "La thèse que vous écrivez aujourd'hui, c'est le livre dont vous serez fier(e) demain. 📚",
  "Brilliant ideas deserve brilliant execution. Keep writing! ✍️",
  "Il n'y a pas de vent favorable pour qui ne sait où il va. Vous, vous savez ! 🧭",
  "Le talent fait ce qu'il peut, la volonté fait ce qu'elle veut. Vous avez les deux ! 💡",
  "Chaque chapitre fini est une montagne franchie. Regardez derrière vous ! ⛰️",
  "La rédaction, c'est 1 % d'inspiration et 99 % de tasses de café. ☕ Vous gérez !",
  "Ne comptez pas les jours, faites que chaque jour compte. 📅",
];

/* ============================================================
   STATE
============================================================ */
function defaultState() {
  return { chapters: [], startDate: null, milestones: { 25: false, 50: false, 75: false, 100: false } };
}

let state        = defaultState();
let currentUser  = null;     // Firebase User object
let _currentChId = null;     // chapter id for the add-subsection modal
let _saveTimer   = null;     // debounce timer for Firestore writes
let _authMode    = 'signin'; // 'signin' | 'signup'

/* ============================================================
   AUTH — UI HELPERS
============================================================ */
function authErrorMsg(code) {
  const map = {
    'auth/invalid-email':          'Adresse email invalide.',
    'auth/invalid-credential':     'Email ou mot de passe incorrect.',
    'auth/user-not-found':         'Aucun compte trouvé avec cet email.',
    'auth/wrong-password':         'Mot de passe incorrect.',
    'auth/email-already-in-use':   'Cet email est déjà utilisé par un autre compte.',
    'auth/weak-password':          'Mot de passe trop faible (minimum 6 caractères).',
    'auth/operation-not-allowed':  'Méthode de connexion non activée dans Firebase.',
    'auth/popup-blocked':          'Popup bloquée — autorisez les fenêtres popup.',
    'auth/network-request-failed': 'Erreur réseau — vérifiez votre connexion.',
  };
  return map[code] || 'Une erreur est survenue. Veuillez réessayer.';
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show');
}
function clearAuthError() {
  document.getElementById('authError').classList.remove('show');
}
function authBtnLabel() {
  return _authMode === 'signin' ? 'Se connecter' : 'Créer mon compte';
}
function setAuthBtnLoading(on) {
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled    = on;
  btn.textContent = on ? 'Chargement…' : authBtnLabel();
}

/* ============================================================
   AUTH — OPERATIONS (exposed to window below)
============================================================ */
function switchAuthTab(mode) {
  _authMode = mode;
  document.getElementById('tabSignin').classList.toggle('active', mode === 'signin');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('authSubmitBtn').textContent = authBtnLabel();
  clearAuthError();
}

async function handleAuthSubmit() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (!email || !password) { showAuthError('Veuillez remplir tous les champs.'); return; }
  clearAuthError();
  setAuthBtnLoading(true);
  try {
    if (_authMode === 'signin') {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
    // onAuthStateChanged handles the rest
  } catch (e) {
    showAuthError(authErrorMsg(e.code));
  } finally {
    setAuthBtnLoading(false);
  }
}

async function googleSignIn() {
  clearAuthError();
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      showAuthError(authErrorMsg(e.code));
    }
  }
}

async function signOutUser() {
  if (!confirm('Se déconnecter ?')) return;
  try { await signOut(auth); }
  catch (e) { toast('Erreur lors de la déconnexion', ''); }
}

/* ============================================================
   UI STATE TRANSITIONS
============================================================ */
function showScreen(id) {
  ['loadingScreen', 'authScreen', 'appScreen'].forEach(s => {
    document.getElementById(s).classList.toggle('hidden', s !== id);
  });
}

function populateAppHeader(user) {
  document.getElementById('userEmail').textContent = user.displayName || user.email;
  document.getElementById('motivQuote').textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

function setDataLoading(on) {
  document.getElementById('dataLoadingBar').classList.toggle('hidden', !on);
}

/* ============================================================
   FIRESTORE — SAVE (debounced for inputs, immediate for CRUD)
============================================================ */
async function _doFirestoreSave() {
  if (!currentUser) return;
  try {
    await setDoc(
      doc(db, 'users', currentUser.uid, 'thesis', 'main'),
      {
        chapters:   state.chapters,
        startDate:  state.startDate,
        milestones: state.milestones,
        updatedAt:  new Date().toISOString(),
      }
    );
  } catch (e) {
    console.error('Firestore save error:', e);
    // Only surface non-network transient errors
    if (e.code !== 'unavailable') toast('⚠️ Erreur de sauvegarde', '');
  }
}

function saveNow()       { clearTimeout(_saveTimer); _doFirestoreSave(); }
function saveDebounced() { clearTimeout(_saveTimer); _saveTimer = setTimeout(_doFirestoreSave, 900); }

/* ============================================================
   FIRESTORE — LOAD
============================================================ */
async function loadFromFirestore() {
  if (!currentUser) return;
  setDataLoading(true);
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid, 'thesis', 'main'));
    if (snap.exists()) {
      const d = snap.data();
      state.chapters   = d.chapters   || [];
      state.startDate  = d.startDate  || null;
      state.milestones = Object.assign({ 25: false, 50: false, 75: false, 100: false }, d.milestones || {});
    } else {
      state = defaultState();
    }
  } catch (e) {
    console.error('Firestore load error:', e);
    toast('⚠️ Impossible de charger les données', '');
  } finally {
    setDataLoading(false);
  }
}

/* ============================================================
   UTILITIES
============================================================ */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDateFr(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function daysSince(iso) {
  if (!iso) return 0;
  const [y, m, d] = iso.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.max(1, Math.round((today - start) / 86400000) + 1);
}

function addDaysToNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + Math.ceil(days));
  return d;
}

/* ============================================================
   CALCULATIONS
============================================================ */
const totalPages   = () => state.chapters.reduce((s, ch) => s + ch.subsections.reduce((a, ss) => a + (ss.targetPages  || 0), 0), 0);
const writtenPages = () => state.chapters.reduce((s, ch) => s + ch.subsections.reduce((a, ss) => a + (ss.writtenPages || 0), 0), 0);

function ssProgress(ss) {
  return ss.targetPages > 0 ? Math.min(100, Math.round((ss.writtenPages / ss.targetPages) * 100)) : 0;
}

function chapterStats(ch) {
  const tP = ch.subsections.reduce((s, ss) => s + (ss.targetPages  || 0), 0);
  const wP = ch.subsections.reduce((s, ss) => s + (ss.writtenPages || 0), 0);
  return { tP, wP, prog: tP === 0 ? 0 : Math.min(100, Math.round((wP / tP) * 100)) };
}

/* ============================================================
   DASHBOARD UPDATE — surgical DOM patches only
============================================================ */
function updateDashboard() {
  const total     = totalPages();
  const written   = writtenPages();
  const remaining = total - written;
  const progress  = total === 0 ? 0 : Math.min(100, Math.round((written / total) * 100));
  const vel       = (!state.startDate || written === 0) ? 0 : written / daysSince(state.startDate);
  const days      = state.startDate ? daysSince(state.startDate) : 0;

  // Circular gauge
  const CIRC = 502.65; // 2π × 80
  document.getElementById('gaugeFill').style.strokeDashoffset = CIRC - (progress / 100) * CIRC;
  setText('gaugePct', progress + '%');

  // Milestone pips
  const pipClass = { 25: 'r25', 50: 'r50', 75: 'r75', 100: 'r100' };
  Object.entries(pipClass).forEach(([ms, cls]) => {
    const el = document.getElementById('ms' + ms);
    if (el) el.className = 'ms-pip' + (progress >= Number(ms) ? ' ' + cls : '');
  });

  // Stats
  animNum('sTotal',     total);
  animNum('sWritten',   written);
  animNum('sRemaining', remaining);

  const chCnt = state.chapters.length;
  const ssCnt = state.chapters.reduce((s, ch) => s + ch.subsections.length, 0);
  animNum('sChapters', chCnt);
  setText('sSections', ssCnt + ' sous-section' + (ssCnt !== 1 ? 's' : ''));

  // Velocity
  if (state.startDate) {
    setText('sVelocity', vel > 0 ? vel.toFixed(1) + ' p/j' : '0 p/j');
    setText('sDays', days + ' jour' + (days > 1 ? 's' : '') + ' de rédaction');
  } else {
    setText('sVelocity', '—');
    setText('sDays', 'Définir une date de début');
  }

  // Crystal-ball end date
  let endDate = null;
  if (vel > 0) {
    endDate = remaining <= 0 ? new Date() : addDaysToNow(remaining / vel);
  }
  if (endDate && written > 0) {
    if (remaining <= 0) {
      setText('sEndDate', '🎉 Terminé !');
      setText('sEndMsg',  'Champagne ! 🥂');
    } else {
      const dLeft = Math.max(0, Math.ceil((endDate - new Date()) / 86400000));
      setText('sEndDate', endDate.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }));
      setText('sEndMsg',  '🥂 dans ' + dLeft + ' jour' + (dLeft !== 1 ? 's' : ''));
    }
  } else {
    setText('sEndDate', '—');
    setText('sEndMsg',  vel === 0 && state.startDate ? 'Commencez à écrire !' : 'À ce rythme…');
  }

  setText('startDateDisplay', state.startDate ? formatDateFr(state.startDate) : 'Non définie');
  checkMilestones(progress);
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

function animNum(id, newVal) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(newVal)) return;
  el.textContent = newVal;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

/* ============================================================
   GAMIFICATION
============================================================ */
function checkMilestones(progress) {
  [25, 50, 75, 100].forEach(ms => {
    if (progress >= ms && !state.milestones[ms]) {
      state.milestones[ms] = true;
      saveNow();
      celebrateMilestone(ms);
    }
  });
}

function celebrateMilestone(ms) {
  const msgs = {
    25:  '🌱 25 % ! Un beau début — vous êtes lancé(e) !',
    50:  '🔥 Mi-chemin ! La moitié est derrière vous !',
    75:  '⚡ 75 % ! Vous êtes en feu, ne lâchez rien !',
    100: '🏆 THÈSE TERMINÉE ! CHAMPAGNE !!!!',
  };
  launchConfetti(ms === 100 ? 220 : ms >= 75 ? 130 : 80);
  toast(msgs[ms], ms === 100 ? 'special' : 'success');
}

function launchConfetti(count) {
  const colors = ['#4A90E2','#8B5CF6','#10B981','#F59E0B','#EF4444','#EC4899','#06B6D4','#FBBF24'];
  const shapes = ['square','circle','rect'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el     = document.createElement('div');
      el.className = 'confetti-piece';
      const c   = colors[Math.floor(Math.random() * colors.length)];
      const s   = shapes[Math.floor(Math.random() * shapes.length)];
      const sz  = Math.random() * 9 + 6;
      const dur = Math.random() * 1.8 + 2.2;
      const del = Math.random() * 0.5;
      el.style.cssText = `left:${(Math.random()*100).toFixed(1)}vw;width:${sz.toFixed(1)}px;`
        + `height:${s==='rect'?(sz*0.4).toFixed(1):sz.toFixed(1)}px;`
        + `background:${c};border-radius:${s==='circle'?'50%':'2px'};`
        + `animation-duration:${dur.toFixed(2)}s;animation-delay:${del.toFixed(2)}s;`;
      document.body.appendChild(el);
      setTimeout(() => el.remove(), (dur + del + 0.6) * 1000);
    }, Math.random() * 400);
  }
}

/* ============================================================
   TOAST
============================================================ */
function toast(msg, type) {
  const box = document.getElementById('toastBox');
  const el  = document.createElement('div');
  el.className   = 'toast ' + (type || '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

/* ============================================================
   FULL RENDER
============================================================ */
function render() {
  renderChapters();
  updateDashboard();
}

function renderChapters() {
  const c = document.getElementById('chaptersContainer');
  if (state.chapters.length === 0) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <h3>Votre thèse commence ici !</h3>
        <p>Construisez votre plan en ajoutant des chapitres et des sous-sections.<br />
           Définissez vos objectifs de pages et suivez votre avancement jour après jour.</p>
        <button class="btn btn-primary" onclick="openAddChapterModal()">＋ Créer mon premier chapitre</button>
      </div>`;
    return;
  }
  c.innerHTML = state.chapters.map((ch, i) => buildChapterHTML(ch, i)).join('');
}

function buildChapterHTML(ch, idx) {
  const { tP, wP, prog } = chapterStats(ch);
  const isDone = prog >= 100;
  const isExp  = ch.expanded !== false;
  return `
<div class="chapter-card${isDone ? ' completed' : ''}${isExp ? ' expanded' : ''}" id="ch-${ch.id}">
  <div class="chapter-header" onclick="toggleChapter('${ch.id}')">
    <span class="ch-arrow">▶</span>
    <span class="ch-num">Ch.&nbsp;${idx + 1}</span>
    <div class="ch-info">
      <div class="ch-title-row">
        <div class="ch-title" style="flex:1;min-width:0;">
          <input class="editable" value="${esc(ch.title)}"
                 onclick="event.stopPropagation()"
                 onblur="updateChTitle('${ch.id}',this.value)"
                 onkeydown="if(event.key==='Enter')this.blur()"
                 title="Cliquez pour modifier" />
        </div>
        ${isDone ? '<span class="badge-done">✓ Terminé</span>' : ''}
      </div>
      <div class="ch-progress-bar">
        <div class="ch-progress-fill${isDone ? ' done' : ''}" style="width:${prog}%"></div>
      </div>
      <div class="ch-stats">${wP} / ${tP} pages &mdash; ${prog}%&nbsp;&middot;&nbsp;${ch.subsections.length} sous-section${ch.subsections.length !== 1 ? 's' : ''}</div>
    </div>
    <div class="ch-actions" onclick="event.stopPropagation()">
      <button class="btn btn-icon btn-danger-soft" title="Supprimer" onclick="deleteChapter('${ch.id}')">🗑</button>
    </div>
  </div>
  <div class="chapter-body">
    ${ch.subsections.map(ss => buildSsHTML(ss, ch.id)).join('')}
    <button class="add-ss-btn" onclick="openAddSsModal('${ch.id}')">＋ Ajouter une sous-section</button>
  </div>
</div>`;
}

function buildSsHTML(ss, chId) {
  const prog   = ssProgress(ss);
  const isDone = prog >= 100;
  return `
<div class="subsection" id="ss-${ss.id}">
  <div class="ss-header">
    <div class="ss-dot${isDone ? ' done' : ''}"></div>
    <div class="ss-title">
      <input class="editable" value="${esc(ss.title)}"
             onblur="updateSsTitle('${chId}','${ss.id}',this.value)"
             onkeydown="if(event.key==='Enter')this.blur()"
             title="Cliquez pour modifier" />
    </div>
    <button class="btn btn-icon btn-danger-soft" title="Supprimer" onclick="deleteSs('${chId}','${ss.id}')">✕</button>
  </div>
  <div class="ss-progress-row">
    <div class="prog-track">
      <div class="prog-fill${isDone ? ' done' : ''}" id="bar-${ss.id}" style="width:${prog}%"></div>
    </div>
    <div class="pages-row">
      <input type="number" class="pages-input" value="${ss.writtenPages || 0}" min="0"
             oninput="updateWritten('${chId}','${ss.id}',this.value)" title="Pages rédigées" />
      <span>/</span>
      <input type="number" class="pages-input" value="${ss.targetPages || 0}" min="1"
             oninput="updateTarget('${chId}','${ss.id}',this.value)" title="Objectif" />
      <span>p.</span>
    </div>
    <div class="prog-pct${isDone ? ' done' : ''}" id="pct-${ss.id}">${prog}%</div>
  </div>
</div>`;
}

/* ============================================================
   CHAPTER CRUD
============================================================ */
function toggleChapter(id) {
  const ch = state.chapters.find(c => c.id === id);
  if (!ch) return;
  ch.expanded = ch.expanded === false;
  saveDebounced();
  const card = document.getElementById('ch-' + id);
  if (card) card.classList.toggle('expanded', ch.expanded);
}

function openAddChapterModal() {
  document.getElementById('chTitleInput').value = '';
  openModal('addChapterModal');
  setTimeout(() => document.getElementById('chTitleInput').focus(), 100);
}

function saveChapter() {
  const title = document.getElementById('chTitleInput').value.trim();
  if (!title) { toast('Veuillez entrer un titre !', 'warn'); return; }
  state.chapters.push({ id: uid(), title, expanded: true, subsections: [] });
  saveNow();
  closeModal('addChapterModal');
  render();
  toast('✅ Chapitre ajouté !', 'success');
}

function deleteChapter(id) {
  const ch = state.chapters.find(c => c.id === id);
  if (!ch || !confirm(`Supprimer "${ch.title}" et toutes ses sous-sections ?`)) return;
  state.chapters = state.chapters.filter(c => c.id !== id);
  saveNow();
  render();
  toast('🗑 Chapitre supprimé');
}

function updateChTitle(id, val) {
  const ch = state.chapters.find(c => c.id === id);
  if (ch && val.trim()) { ch.title = val.trim(); saveNow(); }
}

/* ============================================================
   SUBSECTION CRUD
============================================================ */
function openAddSsModal(chId) {
  _currentChId = chId;
  document.getElementById('ssTitleInput').value = '';
  document.getElementById('ssPagesInput').value = '';
  openModal('addSsModal');
  setTimeout(() => document.getElementById('ssTitleInput').focus(), 100);
}

function saveSubsection() {
  const title = document.getElementById('ssTitleInput').value.trim();
  const pages = parseInt(document.getElementById('ssPagesInput').value, 10);
  if (!title)        { toast('Veuillez entrer un titre !', 'warn'); return; }
  if (!pages || pages < 1) { toast('Objectif de pages invalide !', 'warn'); return; }
  const ch = state.chapters.find(c => c.id === _currentChId);
  if (!ch) return;
  ch.subsections.push({ id: uid(), title, targetPages: pages, writtenPages: 0 });
  saveNow();
  closeModal('addSsModal');
  render();
  toast('✅ Sous-section ajoutée !', 'success');
}

function deleteSs(chId, ssId) {
  const ch = state.chapters.find(c => c.id === chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (!ss || !confirm(`Supprimer "${ss.title}" ?`)) return;
  ch.subsections = ch.subsections.filter(s => s.id !== ssId);
  saveNow();
  render();
}

function updateSsTitle(chId, ssId, val) {
  const ch = state.chapters.find(c => c.id === chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (ss && val.trim()) { ss.title = val.trim(); saveNow(); }
}

/* ============================================================
   LIVE PAGE UPDATES — surgical DOM patch (no full re-render)
============================================================ */
function _findSs(chId, ssId) {
  const ch = state.chapters.find(c => c.id === chId);
  if (!ch) return null;
  const ss = ch.subsections.find(s => s.id === ssId);
  return ss ? { ch, ss } : null;
}

function updateWritten(chId, ssId, rawVal) {
  const found = _findSs(chId, ssId);
  if (!found) return;
  found.ss.writtenPages = Math.max(0, parseInt(rawVal, 10) || 0);
  _refreshSsBar(found.ss);
  _refreshChCard(found.ch);
  saveDebounced(); // debounced — user may still be typing
  updateDashboard();
}

function updateTarget(chId, ssId, rawVal) {
  const found = _findSs(chId, ssId);
  if (!found) return;
  found.ss.targetPages = Math.max(1, parseInt(rawVal, 10) || 1);
  _refreshSsBar(found.ss);
  _refreshChCard(found.ch);
  saveDebounced();
  updateDashboard();
}

function _refreshSsBar(ss) {
  const prog   = ssProgress(ss);
  const isDone = prog >= 100;
  const bar  = document.getElementById('bar-' + ss.id);
  const pct  = document.getElementById('pct-' + ss.id);
  const ssEl = document.getElementById('ss-'  + ss.id);
  if (bar)  { bar.style.width = prog + '%'; bar.className = 'prog-fill' + (isDone ? ' done' : ''); }
  if (pct)  { pct.textContent = prog + '%'; pct.className = 'prog-pct'  + (isDone ? ' done' : ''); }
  if (ssEl) { const dot = ssEl.querySelector('.ss-dot'); if (dot) dot.className = 'ss-dot' + (isDone ? ' done' : ''); }
}

function _refreshChCard(ch) {
  const { tP, wP, prog } = chapterStats(ch);
  const isDone = prog >= 100;
  const card   = document.getElementById('ch-' + ch.id);
  if (!card) return;
  card.classList.toggle('completed', isDone);
  const fill = card.querySelector('.ch-progress-fill');
  if (fill) { fill.style.width = prog + '%'; fill.className = 'ch-progress-fill' + (isDone ? ' done' : ''); }
  const stats = card.querySelector('.ch-stats');
  if (stats) stats.textContent = `${wP} / ${tP} pages — ${prog}% · ${ch.subsections.length} sous-section${ch.subsections.length !== 1 ? 's' : ''}`;
  const row = card.querySelector('.ch-title-row');
  if (row) {
    let badge = row.querySelector('.badge-done');
    if (isDone && !badge) {
      badge = document.createElement('span');
      badge.className   = 'badge-done';
      badge.textContent = '✓ Terminé';
      row.appendChild(badge);
    } else if (!isDone && badge) badge.remove();
  }
}

/* ============================================================
   MODAL HELPERS
============================================================ */
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  if (e.target.id === 'startDateModal' && !state.startDate) return; // force if no date set
  closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  ['addChapterModal', 'addSsModal'].forEach(closeModal);
  if (state.startDate) closeModal('startDateModal');
});

/* ============================================================
   START DATE
============================================================ */
function openStartDateModal() {
  document.getElementById('sdInput').value = state.startDate || new Date().toISOString().slice(0, 10);
  openModal('startDateModal');
}

function saveStartDate() {
  const val = document.getElementById('sdInput').value;
  if (!val) { toast('Veuillez sélectionner une date !', 'warn'); return; }
  state.startDate = val;
  saveNow();
  closeModal('startDateModal');
  updateDashboard();
  toast('🚀 Date de début enregistrée !', 'success');
}

/* ============================================================
   EXPORT / IMPORT (JSON portability — independent of Firestore)
============================================================ */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url, download: `these-${new Date().toISOString().slice(0,10)}.json`,
  });
  a.click();
  URL.revokeObjectURL(url);
  toast('📁 Données exportées !', 'success');
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const p = JSON.parse(e.target.result);
      if (!Array.isArray(p.chapters)) throw new Error('invalid');
      state.chapters   = p.chapters;
      state.startDate  = p.startDate  || null;
      state.milestones = Object.assign({ 25: false, 50: false, 75: false, 100: false }, p.milestones || {});
      saveNow();
      render();
      toast('✅ Données importées avec succès !', 'success');
    } catch { toast('❌ Fichier invalide ou corrompu', ''); }
  };
  reader.readAsText(file);
  input.value = '';
}

/* ============================================================
   RESET
============================================================ */
function confirmReset() {
  if (!confirm('⚠️ Effacer TOUTES les données ?\n\nChapitres, progression, date de début — tout sera supprimé de Firestore.\nCette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : vraiment tout effacer ?')) return;
  state = defaultState();
  saveNow();
  render();
  document.getElementById('sdInput').value = new Date().toISOString().slice(0, 10);
  openModal('startDateModal');
  toast('🗑 Données effacées. Nouveau départ !');
}

/* ============================================================
   EXPOSE FUNCTIONS TO WINDOW
   (required because <script type="module"> is scoped —
    onclick attributes in HTML need global function references)
============================================================ */
Object.assign(window, {
  // Auth
  switchAuthTab, handleAuthSubmit, googleSignIn, signOutUser,
  // Modals
  openModal, closeModal,
  // Start date
  openStartDateModal, saveStartDate,
  // Chapters
  openAddChapterModal, saveChapter, deleteChapter, toggleChapter, updateChTitle,
  // Subsections
  openAddSsModal, saveSubsection, deleteSs, updateSsTitle,
  // Live updates
  updateWritten, updateTarget,
  // Data
  exportData, importData, confirmReset,
});

/* ============================================================
   INIT — driven by Firebase Auth state
============================================================ */
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // --- User is signed in ---
    currentUser = user;
    populateAppHeader(user);
    showScreen('appScreen');

    // Load data from Firestore, then render
    await loadFromFirestore();
    render();

    // Ask for start date if not set yet
    if (!state.startDate) {
      document.getElementById('sdInput').value = new Date().toISOString().slice(0, 10);
      openModal('startDateModal');
    }
  } else {
    // --- User is signed out ---
    currentUser = null;
    state = defaultState();
    // Reset auth form
    document.getElementById('authEmail').value    = '';
    document.getElementById('authPassword').value = '';
    clearAuthError();
    switchAuthTab('signin');
    showScreen('authScreen');
  }
});

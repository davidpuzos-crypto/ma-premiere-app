/* ============================================================
   LE JOURNAL DE BORD — application principale
   Modules :
     core.js     logique pure (dates, historique, rythme, échéance)
     outline.js  du document au plan : où sont les chapitres ?
     docx.js     lecture locale des documents (Word, LibreOffice, LaTeX, texte collé)
     ics.js      export agenda
     humour.js   les textes : notes du jour, grades, bingo
     visuals.js  les dessins : étagère, plante, barres de la semaine
     pages.js    la pagination d'un document (polices, lignes, pages, PDF de Google Docs)
     zip.js      l'ouverture des archives (docx, odt, projets zippés), sans bibliothèque
     pdfread.js  la lecture des PDF (PDF.js embarqué, chargé à la demande)
     pdfdoc.js   du texte d'un PDF au plan : signets, titres balisés, mise en forme
     links.js    les liens de partage (Google Docs, Dropbox, lien direct)
     formats.js  les autres formats (RTF, Typst, Org, AsciiDoc, projets en plusieurs fichiers)
     promo.js    la promo (fiches, classement, fil)
============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  deleteUser,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  dayKey, todayKey, isDayKey, parseDay, addDays, diffDays, weekday, mondayOf,
  nthWritingDay, pagesOn, sumRange, hasNotes, streak, bestStreak,
  forecast, weeklyPages, bestWeek, spanWords, schedule, normalizeTitle, normalizeFull, titleScore, clamp, distribute,
  parsePlanText, PAUSE_KINDS, ENTRY_KINDS, JOKERS_PER_WEEK, pauseOn, pausedDays, hasJoker, jokersInWeek, entryKind, kindTag, isPauseKind,
  isActiveDay, weeklyChallenge,
} from './core.js';
import { buildICS, googleCalendarUrl, byDay } from './ics.js';
import { parseDocumentFile, parsePasted, analyzePdf, parseProjectFiles } from './docx.js';
import { parseLink, gdocKey, dispositionName, shortHash } from './links.js';
import { buildOutline } from './outline.js';
import {
  getFunnyCaption, plain, typo, footnoteOfDay, randomFootnote, gradeFor, GRADES, todayLine,
  MILESTONE_LINES, streakLine, GHOST_LINES, isoWeek, bingoGrid, bingoScore, prognosisLine,
} from './humour.js';
import {
  plantSVG, plantImgHTML, plantCaption, spiderSVG, shelfBooksHTML, updateBook, shareShelfHTML,
  weekBarsHTML, paceBarsHTML, levelTicksHTML, initials,
} from './visuals.js';
import { createPromo } from './promo.js';

/* Version de l'application : la même que VERSION dans sw.js et que data-app-version dans index.html */
const APP_VERSION = '5.0.1';
const APP_URL = 'https://lejournaldebord.org/';

/* Garde-fou de mise à jour (son jumeau est dans index.html) : ce script et la page doivent être de la même
   version. Sinon, plutôt que de tourner sur une page qui n'est pas la sienne, il redemande les fichiers au
   serveur et recharge. Deux tentatives au plus par onglet : ensuite on continue tel quel. */
window.__jdbVersion = APP_VERSION;
(function checkPageVersion() {
  const page = document.documentElement.getAttribute('data-app-version');
  try {
    if (page === APP_VERSION) { sessionStorage.removeItem('jdb_heal'); return; }
    const n = Number(sessionStorage.getItem('jdb_heal') || 0);
    if (n >= 2) return;
    sessionStorage.setItem('jdb_heal', String(n + 1));
  } catch { return; }
  window.__jdbHealing = true;
  const files = ['./', 'style.css', 'app.js', 'core.js', 'outline.js', 'humour.js', 'visuals.js', 'promo.js', 'docx.js', 'pages.js', 'zip.js', 'pdfdoc.js', 'pdfread.js', 'links.js', 'formats.js', 'ics.js'];
  Promise.all(files.map(u => fetch(u, { cache: 'reload' }).catch(() => {}))).then(() => location.reload());
  throw new Error('Mise à jour en cours : la page va se recharger.');
})();

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
auth.languageCode = 'fr'; // emails Firebase (mot de passe oublié…) en français

/* Firestore avec cache local persistant (IndexedDB) :
   l'app fonctionne hors ligne (Wi-Fi de BU capricieux…) et les
   modifications sont envoyées dès le retour de la connexion. */
let db;
try {
  db = initializeFirestore(app, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.warn('Cache local indisponible, mode mémoire :', e);
  db = getFirestore(app);
}

/* ============================================================
   PLAN TEMPLATES
============================================================ */
const PLAN_TEMPLATES = [
  {
    name: 'Thèse Classique SHS',
    chapters: [
      { title: 'Introduction Générale',                     targetPages: 15  },
      { title: 'Revue de la littérature / État de l\'art',  targetPages: 60  },
      { title: 'Cadre théorique et conceptuel',             targetPages: 50  },
      { title: 'Méthodologie et terrain',                   targetPages: 40  },
      { title: 'Analyse et Résultats',                      targetPages: 100 },
      { title: 'Discussion',                                targetPages: 25  },
      { title: 'Conclusion Générale',                       targetPages: 10  },
    ],
  },
  {
    name: 'Thèse IMRAD',
    chapters: [
      { title: 'Introduction : Contexte et Objectifs', targetPages: 15 },
      { title: 'Matériel et Méthodes',                 targetPages: 30 },
      { title: 'Résultats',                            targetPages: 50 },
      { title: 'Discussion',                           targetPages: 45 },
      { title: 'Conclusion',                           targetPages: 10 },
    ],
  },
  {
    name: 'Thèse par articles',
    chapters: [
      { title: 'Introduction Générale de synthèse', targetPages: 20 },
      { title: 'Article 1',                         targetPages: 20 },
      { title: 'Article 2',                         targetPages: 20 },
      { title: 'Article 3',                         targetPages: 20 },
      { title: 'Discussion Générale',               targetPages: 30 },
      { title: 'Conclusion Générale',               targetPages: 10 },
    ],
  },
  {
    name: 'Mémoire de Master',
    chapters: [
      { title: 'Introduction et Problématique',              targetPages: 5  },
      { title: 'Cadre théorique et Revue de littérature',    targetPages: 25 },
      { title: 'Démarche méthodologique',                    targetPages: 15 },
      { title: 'Présentation et analyse des résultats',      targetPages: 35 },
      { title: 'Préconisations / Discussion',                targetPages: 5  },
      { title: 'Conclusion',                                 targetPages: 5  },
    ],
  },
];

/* ============================================================
   CONSTANTES V2
============================================================ */
const REVIEW_LABELS = { sent: 'Chez la direction', revise: 'À corriger', ok: 'Validé' };
const REVIEW_PRINT  = REVIEW_LABELS;
const WD_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WD_NAMES   = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WD_ORDER   = [1, 2, 3, 4, 5, 6, 0];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WHATSNEW_KEY = 'jdb_whatsnew';
const SYNC_KEEP = 20;   // synchros gardées dans l'historique
const SYNC_PARTS = 6;   // parties détaillées pour chacune
const WHATSNEW_VER = '6'; // à augmenter pour annoncer une mise à jour à la connexion

/** Une icône du jeu défini en tête de index.html (<symbol id="i-…">). */
function icon(name, cls = '') {
  return `<svg class="ic${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

/* Stockage local : toujours protégé (navigation privée, stockage bloqué…) */
function lsGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignoré */ } }

/* ============================================================
   STATE
============================================================ */
function defaultState() {
  return {
    chapters: [],
    startDate: null,
    milestones: { 25: false, 50: false, 75: false, 100: false },
    documentTitle: '',
    // Échéance & rythme
    deadline: null,          // date de dépôt / de rendu
    deadlineMonth: false,    // true = seul le mois est visé (deadline = dernier jour de ce mois)
    marginDays: 21,          // marge avant le dépôt (relecture, mise en forme)
    writingDays: [1, 2, 3, 4, 5],
    dailyGoal: null,         // null = automatique
    introLast: true,         // rétroplanning : intro et conclusion à la fin
    sessionTime: '09:00',    // séances d'écriture (agenda)
    sessionMinutes: 90,
    slots: [],               // horaire propre à un jour : [[jour, 'HH:MM', minutes]] en mémoire, [{ d, t, m }] dans la base ; les autres jours suivent sessionTime
    alarmMin: 10,            // rappel avant la séance, en minutes (0 = aucun)
    meetWeeks: 0,            // rappel « envoyer mes pages à ma direction » toutes les n semaines (0 = non)
    pauses: [],              // périodes hors rédaction : [{ from, to, kind }]
    defis: { won: [], off: false }, // défis de la semaine relevés, ou proposition désactivée
    // Journal
    activity: {},            // { 'AAAA-MM-JJ': pages écrites ce jour }
    journal: {},             // { 'AAAA-MM-JJ': [ { p, s, n, m, t } ] }
    trackedSince: null,
    // Synchro Word
    docFiles: {},            // { cléFichier: { name, at, inclWords, wpp, scope, level, mtime, size, pv, src, pages, k, gdoc, sig } }
    docIgnore: [],           // parties du document que l'utilisateur a choisi d'ignorer
    syncLog: [],             // dernières synchros : [{ t, k, n, d, a, p, w, c: [{ n: partie, d: pages }], x }] (voir logSync)
  };
}

let state        = defaultState();
let currentUser  = null;     // Firebase User object
let _saveTimer   = null;     // debounce timer for Firestore writes
let _authMode    = 'signin'; // 'signin' | 'signup'
let _lastForecast = null;    // dernière prévision calculée (objectif du jour…)
let _urlIntent   = false;    // la page a été ouverte pour une action précise (raccourci, lien de fiche)

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v, min = 0) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, n) : min; }
function cleanId(id) { return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }

/** Clé stable d'un fichier (sert de nom de champ : lettres, chiffres, « _ »).
 *  Pour les formats lus depuis toujours, l'extension est retirée de la clé (these.docx → « these ») ; pour les
 *  formats ajoutés ensuite (PDF…), elle y reste (these.pdf → « these_pdf ») : le même manuscrit en .docx et en
 *  .pdf fait deux documents distincts, dont les mots ne se comptent pas de la même façon. */
const DOC_EXT = /\.(docx|odt|tex|ltx|md|markdown|mdown|txt|text|rst)$/i;
/** Extension à retirer d'un nom de fichier pour en faire un titre. */
const NAME_EXT = /\.(docx|docm|dotx|odt|fodt|pdf|rtf|tex|ltx|md|markdown|mdown|qmd|rmd|typ|org|adoc|asciidoc|txt|text|rst|zip|html?)$/i;
const PASTE_NAME = 'Texte collé';

function fileKeyOf(name) {
  return normalizeFull(String(name || '').replace(DOC_EXT, '')).replace(/ /g, '_').slice(0, 100) || 'fichier';
}

/** Données Firestore / JSON → état propre (types vérifiés, identifiants sûrs). */
function normalizeState(d) {
  const s = defaultState();
  if (!isObj(d)) return s;
  const seen = new Set();
  const uniq = id => { let v = cleanId(id) || uid(); while (seen.has(v)) v = uid(); seen.add(v); return v; };
  const title = (t, fb) => (typeof t === 'string' && t.trim() ? t.slice(0, 300) : fb);
  const docRef = (x, o) => {
    if (typeof x.docKey === 'string' && x.docKey) o.docKey = x.docKey.slice(0, 300);
    if (typeof x.docFile === 'string' && /^[a-z0-9_]{1,100}$/.test(x.docFile)) o.docFile = x.docFile;
  };
  const normSs = x => {
    if (!isObj(x)) return null;
    const o = { id: uniq(x.id), title: title(x.title, 'Sans titre'), targetPages: num(x.targetPages), writtenPages: num(x.writtenPages) };
    if (x.autoT === true) o.autoT = true; // objectif réparti automatiquement, pas encore retouché
    docRef(x, o);
    return o;
  };
  s.chapters = (Array.isArray(d.chapters) ? d.chapters : []).map(c => {
    if (!isObj(c)) return null;
    const o = {
      id: uniq(c.id),
      title: title(c.title, 'Sans titre'),
      expanded: c.expanded !== false,
      targetPages: num(c.targetPages),
      writtenPages: num(c.writtenPages),
      subsections: (Array.isArray(c.subsections) ? c.subsections : []).map(normSs).filter(Boolean),
    };
    if (REVIEW_LABELS[c.review]) {
      o.review = c.review;
      if (isDayKey(c.reviewDate)) o.reviewDate = c.reviewDate;
    }
    docRef(c, o);
    return o;
  }).filter(Boolean);
  s.startDate     = isDayKey(d.startDate) ? d.startDate : null;
  s.milestones    = Object.assign({ 25: false, 50: false, 75: false, 100: false }, isObj(d.milestones) ? d.milestones : {});
  s.documentTitle = typeof d.documentTitle === 'string' ? d.documentTitle.slice(0, 200) : '';
  s.deadline      = isDayKey(d.deadline) ? d.deadline : null;
  s.deadlineMonth = d.deadlineMonth === true && !!s.deadline;
  if (Number.isFinite(d.marginDays)) s.marginDays = clamp(Math.round(d.marginDays), 0, 180);
  if (Array.isArray(d.writingDays)) {
    const wd = [...new Set(d.writingDays.filter(x => Number.isInteger(x) && x >= 0 && x <= 6))];
    if (wd.length) s.writingDays = wd;
  }
  s.dailyGoal = Number(d.dailyGoal) > 0 ? Math.min(50, Number(d.dailyGoal)) : null;
  s.introLast = d.introLast !== false;
  if (typeof d.sessionTime === 'string' && /^\d{2}:\d{2}$/.test(d.sessionTime)) s.sessionTime = d.sessionTime;
  if (Number.isFinite(d.sessionMinutes)) s.sessionMinutes = clamp(Math.round(d.sessionMinutes), 15, 480);
  if (isObj(d.activity)) {
    for (const [k, v] of Object.entries(d.activity)) {
      if (isDayKey(k) && Number.isFinite(Number(v))) s.activity[k] = Number(v);
    }
  }
  if (isObj(d.journal)) {
    for (const [k, arr] of Object.entries(d.journal)) {
      if (!isDayKey(k) || !Array.isArray(arr)) continue;
      s.journal[k] = arr.filter(isObj).map(e => {
        const kind = entryKind(e);                 // autre travail de thèse, ou joker
        const o = {
          p: Number(e.p) || 0,
          s: kind ? kindTag(kind) : (typeof e.s === 'string' ? e.s : null),
          n: typeof e.n === 'string' ? e.n.slice(0, 500) : '',
          m: clamp(Math.round(Number(e.m) || 0), 0, 5),
          t: typeof e.t === 'string' ? e.t.slice(0, 5) : '',
        };
        if (kind) o.k = kind;
        return o;
      });
    }
  }
  s.trackedSince = isDayKey(d.trackedSince) ? d.trackedSince : null;
  if (Array.isArray(d.slots)) {
    // Enregistrés sous la forme { d, t, m } ; l'ancienne forme [jour, heure, minutes] (copie locale d'avant la 5.0) est lue aussi
    s.slots = d.slots.map(x => (Array.isArray(x) ? x : isObj(x) ? [x.d, x.t, x.m] : null))
      .filter(x => x && Number.isInteger(x[0]) && x[0] >= 0 && x[0] <= 6 && /^\d{2}:\d{2}$/.test(x[1]) && Number.isFinite(x[2]))
      .map(x => [x[0], x[1], clamp(Math.round(x[2]), 15, 480)]).slice(0, 7);
  }
  if (Number.isFinite(d.alarmMin)) s.alarmMin = clamp(Math.round(d.alarmMin), 0, 1440);
  if (Number.isFinite(d.meetWeeks)) s.meetWeeks = clamp(Math.round(d.meetWeeks), 0, 12);
  if (Array.isArray(d.pauses)) {
    s.pauses = d.pauses.filter(p => isObj(p) && isDayKey(p.from) && isDayKey(p.to) && p.to >= p.from)
      .map(p => ({ from: p.from, to: p.to, kind: isPauseKind(p.kind) ? p.kind : 'autre' }))
      .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)).slice(0, 40);
  }
  if (isObj(d.defis)) {
    s.defis = {
      won: [...new Set((Array.isArray(d.defis.won) ? d.defis.won : []).filter(w => typeof w === 'string' && /^\d{4}-S\d{2}$/.test(w)))].slice(-120),
      off: d.defis.off === true,
    };
  }
  const docFile = f => ({
    name: String(f.name || '').slice(0, 200),
    at: isDayKey(f.at) ? f.at : null,
    inclWords: Number.isFinite(f.inclWords) ? Math.max(0, Math.round(f.inclWords)) : null,
    wpp: Number.isFinite(f.wpp) && f.wpp >= 80 && f.wpp <= 1500 ? Math.round(f.wpp) : null,
    scope: typeof f.scope === 'string' ? cleanId(f.scope) : '',
    // Niveau de titre des chapitres choisi pour ce fichier : 'auto', 1 à 9, ou null (synchro d'avant la 3.1)
    level: f.level === 'auto' ? 'auto' : (Number.isInteger(f.level) && f.level >= 1 && f.level <= 9 ? f.level : null),
    mtime: Number.isFinite(f.mtime) ? f.mtime : null,
    size: Number.isFinite(f.size) ? f.size : null,
    // Depuis la 4.1 : pages lues dans le document (pv = 2). src = d'où vient la pagination,
    // pages = longueur du document, k = correction donnée par l'utilisateur (« il fait N pages »).
    pv: f.pv === 2 ? 2 : null,
    src: ['pdf', 'word', 'meta', 'layout', 'density'].includes(f.src) ? f.src : null,
    pages: Number.isFinite(f.pages) && f.pages >= 0 && f.pages < 100000 ? Math.round(f.pages * 10) / 10 : null,
    k: Number.isFinite(f.k) && f.k >= 0.2 && f.k <= 5 ? f.k : null,
    // Google Docs lié : identifiant du document et signature de son texte à la dernière synchro
    gdoc: typeof f.gdoc === 'string' && /^[A-Za-z0-9_-]{20,100}$/.test(f.gdoc) ? f.gdoc : null,
    // Fichier lié par son adresse (Dropbox, lien direct) : toujours en https
    url: typeof f.url === 'string' && /^https:\/\/[^\s<>"']{4,800}$/.test(f.url) ? f.url : null,
    sig: typeof f.sig === 'string' && /^[a-z0-9.]{1,40}$/.test(f.sig) ? f.sig : null,
  });
  if (isObj(d.docFiles)) {
    for (const [k, f] of Object.entries(d.docFiles)) {
      if (isObj(f) && /^[a-z0-9_]{1,100}$/.test(k)) s.docFiles[k] = docFile(f);
    }
  } else if (isObj(d.lastDocImport) && d.lastDocImport.name) {
    // Données de la v2.0 : un seul fichier, sans détail
    s.docFiles[fileKeyOf(d.lastDocImport.name)] = docFile({ name: d.lastDocImport.name, at: d.lastDocImport.at });
  }
  if (Array.isArray(d.docIgnore)) {
    s.docIgnore = [...new Set(d.docIgnore.filter(x => typeof x === 'string' && x).map(x => x.slice(0, 400)))].slice(0, 300);
  }
  if (Array.isArray(d.syncLog)) {
    const num = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
    s.syncLog = d.syncLog.filter(e => isObj(e) && typeof e.t === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(e.t)).map(e => ({
      t: e.t,
      k: typeof e.k === 'string' && /^[a-z0-9_]{1,100}$/.test(e.k) ? e.k : '',
      n: String(e.n || '').slice(0, 80),
      d: isDayKey(e.d) ? e.d : e.t.slice(0, 10),
      a: num(e.a),
      p: num(e.p),
      w: Number.isFinite(e.w) ? Math.round(e.w) : null,
      c: (Array.isArray(e.c) ? e.c : []).filter(x => isObj(x) && typeof x.n === 'string' && Number.isFinite(x.d)).slice(0, SYNC_PARTS).map(x => ({ n: x.n.slice(0, 60), d: num(x.d) })),
      x: ['new', 'plan'].includes(e.x) ? e.x : '',
    })).slice(-SYNC_KEEP);
  }
  return s;
}

function serializeState() {
  return {
    version:        2,
    chapters:       state.chapters,
    startDate:      state.startDate,
    milestones:     state.milestones,
    documentTitle:  state.documentTitle,
    deadline:       state.deadline,
    deadlineMonth:  state.deadlineMonth,
    marginDays:     state.marginDays,
    writingDays:    state.writingDays,
    dailyGoal:      state.dailyGoal,
    introLast:      state.introLast,
    sessionTime:    state.sessionTime,
    sessionMinutes: state.sessionMinutes,
    slots:          state.slots.map(x => ({ d: x[0], t: x[1], m: x[2] })),   // jamais de tableau dans un tableau : Firestore le refuse
    alarmMin:       state.alarmMin,
    meetWeeks:      state.meetWeeks,
    pauses:         state.pauses,
    defis:          state.defis,
    activity:       state.activity,
    journal:        state.journal,
    trackedSince:   state.trackedSince,
    docFiles:       state.docFiles,
    docIgnore:      state.docIgnore,
    syncLog:        state.syncLog,
  };
}

/* ============================================================
   AUTH — UI HELPERS
============================================================ */
function authErrorMsg(code) {
  const map = {
    'auth/invalid-email':          'Adresse email invalide.',
    'auth/invalid-credential':     'Email ou mot de passe incorrect. Si vous vous êtes inscrit·e avec Google, utilisez « Continuer avec Google ».',
    'auth/user-not-found':         'Aucun compte trouvé avec cet email.',
    'auth/wrong-password':         'Mot de passe incorrect.',
    'auth/email-already-in-use':   'Cet email est déjà utilisé par un autre compte.',
    'auth/weak-password':          'Mot de passe trop faible (minimum 6 caractères).',
    'auth/operation-not-allowed':  'Méthode de connexion non activée dans Firebase.',
    'auth/popup-blocked':          'Popup bloquée : autorisez les fenêtres popup.',
    'auth/network-request-failed': 'Erreur réseau : vérifiez votre connexion.',
    'auth/too-many-requests':      'Trop de tentatives. Patientez quelques minutes avant de réessayer.',
  };
  return map[code] || 'Une erreur est survenue. Veuillez réessayer.';
}

function showAuthError(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.remove('auth-success');
  el.classList.add('show');
}
function showAuthSuccess(msg) {
  const el = document.getElementById('authError');
  el.textContent = msg;
  el.classList.add('show', 'auth-success');
}
function clearAuthError() {
  const el = document.getElementById('authError');
  el.classList.remove('show', 'auth-success');
}
function authBtnLabel() {
  return _authMode === 'signin' ? 'Se connecter' : 'Créer mon compte';
}
function setAuthBtnLoading(on) {
  const btn = document.getElementById('authSubmitBtn');
  btn.disabled    = on;
  btn.textContent = on ? 'Chargement…' : authBtnLabel();
}

/* Fautes de frappe fréquentes dans les adresses email
   (un compte a déjà été créé avec « gmaim.com »…) */
const DOMAIN_FIXES = {
  'gmaim.com': 'gmail.com', 'gmial.com': 'gmail.com', 'gmai.com': 'gmail.com', 'gamil.com': 'gmail.com',
  'gmal.com': 'gmail.com', 'gnail.com': 'gmail.com', 'gmaill.com': 'gmail.com', 'gmail.co': 'gmail.com',
  'gmail.cm': 'gmail.com', 'gmail.fr': 'gmail.com', 'gmail.om': 'gmail.com', 'gmali.com': 'gmail.com',
  'hotmial.com': 'hotmail.com', 'hotmal.com': 'hotmail.com', 'hotmail.co': 'hotmail.com', 'hotmial.fr': 'hotmail.fr',
  'hotmal.fr': 'hotmail.fr', 'hotmai.fr': 'hotmail.fr', 'yahou.fr': 'yahoo.fr', 'yaho.fr': 'yahoo.fr',
  'yahooo.fr': 'yahoo.fr', 'outlok.fr': 'outlook.fr', 'outlok.com': 'outlook.com', 'orage.fr': 'orange.fr',
  'oange.fr': 'orange.fr', 'wanado.fr': 'wanadoo.fr', 'laposte.fr': 'laposte.net', 'lapost.net': 'laposte.net',
  'icloud.fr': 'icloud.com', 'iclou.com': 'icloud.com', 'iclod.com': 'icloud.com',
};
let _emailSuggestion = null;
let _typoWarnedFor   = null;

function suggestEmail(raw) {
  const m = /^([^@\s]+)@([^@\s]+)$/.exec(String(raw).trim().toLowerCase());
  if (!m) return null;
  const dom = m[2];
  if (DOMAIN_FIXES[dom]) return `${m[1]}@${DOMAIN_FIXES[dom]}`;
  if (/\.con$/.test(dom)) return `${m[1]}@${dom.replace(/\.con$/, '.com')}`;
  if (/^(gmail|icloud)$/.test(dom)) return `${m[1]}@${dom}.com`;
  if (/^(hotmail|yahoo|outlook|orange|free|sfr|wanadoo)$/.test(dom)) return `${m[1]}@${dom}.fr`;
  return null;
}

function checkEmailTypo() {
  const box = document.getElementById('emailSuggest');
  _emailSuggestion = suggestEmail(document.getElementById('authEmail').value);
  if (!_emailSuggestion) { box.classList.add('hidden'); return false; }
  box.innerHTML = `Vouliez-vous dire <button type="button" onclick="applyEmailSuggestion()">${esc(_emailSuggestion)}</button> ?`;
  box.classList.remove('hidden');
  return true;
}

function applyEmailSuggestion() {
  if (!_emailSuggestion) return;
  document.getElementById('authEmail').value = _emailSuggestion;
  document.getElementById('emailSuggest').classList.add('hidden');
  _emailSuggestion = null;
  document.getElementById('authPassword').focus();
}

/* ============================================================
   AUTH — OPERATIONS (exposed to window below)
============================================================ */
function switchAuthTab(mode) {
  _authMode = mode;
  document.getElementById('tabSignin').classList.toggle('active', mode === 'signin');
  document.getElementById('tabSignup').classList.toggle('active', mode === 'signup');
  document.getElementById('authSubmitBtn').textContent = authBtnLabel();
  document.getElementById('forgotPasswordRow').style.display  = mode === 'signin' ? '' : 'none';
  document.getElementById('confirmPasswordRow').style.display = mode === 'signup' ? '' : 'none';
  document.getElementById('authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  if (mode === 'signup') document.getElementById('authPasswordConfirm').value = '';
  clearAuthError();
}

async function handleForgotPassword() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    showAuthError('Entrez votre adresse email pour recevoir le lien de réinitialisation.');
    return;
  }
  clearAuthError();
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthSuccess('Email de réinitialisation envoyé ! Vérifiez votre boîte mail (et les spams).');
  } catch (e) {
    showAuthError(authErrorMsg(e.code));
  }
}

async function handleAuthSubmit() {
  const email    = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if (_authMode === 'signup') {
    const confirmPw = document.getElementById('authPasswordConfirm').value;
    if (!confirmPw) { showAuthError('Veuillez confirmer votre mot de passe.'); return; }
    if (password !== confirmPw) { showAuthError('Les mots de passe ne correspondent pas.'); return; }
    // Faute de frappe probable : on prévient une fois avant de créer le compte
    if (checkEmailTypo() && _typoWarnedFor !== email) {
      _typoWarnedFor = email;
      showAuthError('Vérifiez votre adresse email : elle contient peut-être une faute de frappe.');
      return;
    }
  }
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
    if (e.code === 'auth/email-already-in-use') {
      switchAuthTab('signin');
      showAuthSuccess('Vous avez déjà un compte avec cet email : cliquez sur « Se connecter ».');
    } else {
      showAuthError(authErrorMsg(e.code));
    }
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
  if (_saveTimer) saveNow();
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
  document.body.classList.toggle('signed-out', id !== 'appScreen'); // hors de l'application, les messages se centrent sur toute la largeur
}

function populateAppHeader(user) {
  const name = user.displayName || user.email || '';
  setText('userEmailMobile', name);
  setText('userAvatar', initials(user.displayName || String(user.email || '').split('@')[0]));
  // Le prénom, quand on le connaît (compte Google) : « Bonjour Camille »
  const first = String(user.displayName || '').trim().split(/\s+/)[0];
  const now = new Date();
  const long = now.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const short = now.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  setHTML('heroHello', `${first ? 'Bonjour ' + esc(first) : 'Ma thèse'} · <span class="d-long">${long}</span><span class="d-short">${short}</span>`);
  showFootnote(footnoteOfDay(todayKey()));
}

function setDataLoading(on) {
  document.getElementById('dataLoadingBar').classList.toggle('hidden', !on);
}

/** Tant que les données ne sont pas chargées, l'espace de travail est inactif. */
function setReady(on) {
  document.getElementById('appScreen').classList.toggle('app-loading', !on);
}

function requireReady() {
  if (_loaded) return true;
  toast('Chargement de vos données…', '');
  return false;
}

/* ============================================================
   FIRESTORE — SYNCHRONISATION
   - Écoute en temps réel (onSnapshot) : une modification faite
     sur le téléphone apparaît sur l'ordinateur, et inversement.
   - Aucune écriture tant qu'un état fiable n'est pas chargé :
     un chargement raté ne peut plus écraser le plan existant.
   - Écritures en « merge » : l'historique (activity, journal)
     d'un autre appareil n'est jamais effacé.
============================================================ */
const CLIENT_ID = uid();
let _loaded        = false;   // état fiable disponible (cache local ou serveur)
let _serverSynced  = false;   // au moins une réponse du serveur reçue
let _lastStamp     = '';      // empreinte du dernier état appliqué / écrit
let _pendingRemote = null;    // modification distante en attente (saisie en cours)
let _unsub         = null;
let _loadTimer     = null;
let _firstLoadAt   = 0;

function userDocRef() { return doc(db, 'users', currentUser.uid, 'thesis', 'main'); }
const stampOf = d => `${(d && d.updatedAt) || ''}|${(d && d.clientId) || ''}`;

/* Filet de sécurité pour la transition v1 → v2 :
   l'ancienne version de l'app (encore en cache sur certains
   appareils jusqu'à leur prochaine ouverture) réécrit le document
   entier sans les champs v2. Chaque appareil garde donc une copie
   locale de ces champs et les restaure si besoin. */
const V2_FIELDS = ['deadline', 'deadlineMonth', 'marginDays', 'writingDays', 'dailyGoal', 'introLast', 'sessionTime',
  'sessionMinutes', 'activity', 'journal', 'trackedSince', 'docFiles', 'docIgnore', 'syncLog', 'slots', 'alarmMin', 'meetWeeks', 'pauses', 'defis'];
const backupKey = () => 'jdb_v2_' + (currentUser && currentUser.uid);

function backupV2() {
  if (!currentUser) return;
  if (!_slotsChecked && lostSlotsBackup()) return;   // copie d'avant la 5.0 à reprendre d'abord : voir recoverLostSlots
  const b = {};
  for (const f of V2_FIELDS) b[f] = state[f];
  b.slots = state.slots.map(x => ({ d: x[0], t: x[1], m: x[2] }));
  lsSet(backupKey(), JSON.stringify(b));
}

/** Renvoie les données complétées par la copie locale si elles viennent d'une ancienne version. */
function withV2Backup(data) {
  if (!data || data.version >= 2 || !Array.isArray(data.chapters) || !data.chapters.length) return { data, restored: false };
  let b = null;
  try { b = JSON.parse(lsGet(backupKey()) || 'null'); } catch { b = null; }
  if (!isObj(b)) return { data, restored: false };
  const merged = { ...data };
  for (const f of V2_FIELDS) {
    if (merged[f] === undefined && b[f] !== undefined && b[f] !== null) merged[f] = b[f];
  }
  if (isObj(b.activity) && isObj(data.activity)) merged.activity = { ...b.activity, ...data.activity };
  if (isObj(b.journal) && isObj(data.journal)) merged.journal = { ...b.journal, ...data.journal };
  const restored = V2_FIELDS.some(f => merged[f] !== data[f]);
  return { data: merged, restored };
}

/* Réparation. En 4.1.0, donner un horaire propre à un jour faisait refuser tous les enregistrements suivants : la
   base n'accepte pas un tableau placé dans un tableau, et l'horaire était envoyé sous cette forme. La copie locale,
   elle, a continué d'être tenue, avec l'horaire sous cette même forme : c'est à cela qu'on la reconnaît (depuis la
   5.0, la copie locale l'écrit en objets). Quand le serveur confirme qu'il n'a pas reçu cet horaire, on le reprend,
   avec les journées du journal notées depuis, sans rien écraser de ce que le serveur connaît. */
let _slotsChecked = false;   // la copie locale a été examinée face aux données du serveur (une fois par ouverture)
function lostSlotsBackup() {
  let b = null;
  try { b = JSON.parse(lsGet(backupKey()) || 'null'); } catch { b = null; }
  return isObj(b) && Array.isArray(b.slots) && b.slots.some(Array.isArray) ? b : null;
}
function recoverLostSlots(server) {
  if (_slotsChecked || !currentUser) return;
  _slotsChecked = true;
  const b = lostSlotsBackup();
  if (!b) return;
  if (!server || !(server.version >= 2) || (Array.isArray(server.slots) && server.slots.length)) { backupV2(); return; }
  const cur = serializeState();
  state = normalizeState({
    ...cur,
    slots: b.slots,
    activity: { ...(isObj(b.activity) ? b.activity : {}), ...cur.activity },
    journal: { ...(isObj(b.journal) ? b.journal : {}), ...cur.journal },
  });
  saveNow();
  render();
  toast('Votre horaire par jour et les journées notées depuis ont été retrouvés sur cet appareil et enregistrés. Vérifiez vos pages par chapitre.', 'success', { duration: 12000 });
}

async function _doFirestoreSave(replace = false) {
  _saveTimer = null;
  if (!currentUser || !_loaded) return; // jamais d'écriture sans chargement fiable
  _pendingRemote = null;                // la modification locale l'emporte
  const payload = serializeState();
  payload.updatedAt = new Date().toISOString();
  payload.clientId  = CLIENT_ID;
  _lastStamp = stampOf(payload);
  backupV2();
  try {
    if (replace) await setDoc(userDocRef(), payload);
    else {
      // En fusion, une table vide remplacerait celle du serveur : on ne l'envoie pas
      for (const k of ['activity', 'journal', 'docFiles']) {
        if (isObj(payload[k]) && !Object.keys(payload[k]).length) delete payload[k];
      }
      await setDoc(userDocRef(), payload, { merge: true });
    }
  } catch (e) {
    console.error('Firestore save error:', e);
    if (e.code === 'permission-denied') toast('Sauvegarde refusée par la base de données.', 'warn');
    else if (e.code !== 'unavailable') toast('La sauvegarde a échoué. Vos changements restent sur cet appareil.', 'warn');
  }
}

/* Les boutons « Annuler » qui restaurent une copie de l'état ne valent que jusqu'à la
   modification suivante : au-delà, ils effaceraient aussi ce qui a été fait depuis. */
function dropStaleUndo() {
  document.querySelectorAll('#toastBox .toast[data-undo]').forEach(t => t.remove());
  if (_syncUndo) { _syncUndo = null; renderSyncLog(); }
}

function saveNow(replace = false) { dropStaleUndo(); clearTimeout(_saveTimer); _saveTimer = null; _doFirestoreSave(replace); }
function saveDebounced() { dropStaleUndo(); clearTimeout(_saveTimer); _saveTimer = setTimeout(() => _doFirestoreSave(false), 900); }

// Ne rien perdre si l'app passe en arrière-plan pendant la temporisation
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && _saveTimer) saveNow();
});
window.addEventListener('pagehide', () => { if (_saveTimer) saveNow(); });

function stopSync() {
  if (_unsub) { _unsub(); _unsub = null; }
  clearTimeout(_loadTimer);
  _loaded = false;
  _serverSynced = false;
  _pendingRemote = null;
  _linked = [];
  _pendingReview = null;
  Object.assign(_syncState, { at: 0, refused: 0, failed: 0, error: '' });
  _slotsChecked = false;
  _figure.shown = false;
  _shelfShown = false;
  promo.reset();
  setView('these');
}

function startSync() {
  stopSync();
  _lastStamp = '';
  setDataLoading(true);
  setReady(false);
  renderLoadingState('loading');
  _loadTimer = setTimeout(() => { if (!_loaded) renderLoadingState('slow'); }, 9000);

  _unsub = onSnapshot(userDocRef(), { includeMetadataChanges: true }, snap => {
    const data = snap.exists() ? snap.data() : null;
    const fromServer = !snap.metadata.fromCache;

    if (!_loaded) {
      // Pas de document dans le cache local : on attend le serveur avant de
      // conclure que le compte est vide (sinon on risquerait d'écraser ses données).
      if (!data && !fromServer) return;
      _loaded = true;
      clearTimeout(_loadTimer);
      setDataLoading(false);
      const fixed = withV2Backup(data);
      state = normalizeState(fixed.data);
      _lastStamp = stampOf(data);
      onFirstLoad(!data);
      // Restauration écrite seulement à partir de données confirmées par le serveur
      if (fixed.restored && fromServer) saveNow();
      else if (data && data.version >= 2) backupV2();
    } else if (data && !snap.metadata.hasPendingWrites) {
      const st = stampOf(data);
      if (st !== _lastStamp) {
        if (data.clientId === CLIENT_ID) _lastStamp = st;
        else if (!_saveTimer) {
          if (isBusy()) _pendingRemote = data;
          else applyRemote(data);
        }
      }
    }

    if (fromServer && !_serverSynced && _loaded) {
      _serverSynced = true;
      onServerSynced();
      recoverLostSlots(data);
    }
  }, err => {
    console.error('Firestore listen error:', err);
    setDataLoading(false);
    if (!_loaded) renderLoadingState('error', err && err.code);
    else toast('Synchronisation interrompue : rechargez la page.', 'warn');
  });
}

function isBusy() {
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.closest('#appScreen, .modal-overlay')) return true;
  return !!document.querySelector('.modal-overlay:not(.hidden)');
}

function applyRemote(data) {
  const fixed = withV2Backup(data);
  state = normalizeState(fixed.data);
  _lastStamp = stampOf(data);
  render();
  syncTitleInput();
  if (fixed.restored) saveNow();
  else if (data.version >= 2) backupV2();
  else if (Date.now() - _firstLoadAt > 6000) toast('Mis à jour depuis un autre appareil.', '');
}

// Applique une modification distante dès que l'utilisateur a fini de saisir
setInterval(() => {
  if (_pendingRemote && !_saveTimer && !isBusy()) {
    const d = _pendingRemote;
    _pendingRemote = null;
    applyRemote(d);
  }
}, 1500);

/** Premier contact avec le serveur : initialisations légères (écritures partielles). */
function onServerSynced() {
  if (!currentUser) return;
  const today = todayKey();
  const patch = {};
  if (!state.trackedSince) { state.trackedSince = today; patch.trackedSince = today; }
  const seenKey = 'jdb_seen_' + currentUser.uid;
  if (lsGet(seenKey) !== today) {
    patch.lastSeenAt = today;
    patch.appVersion = APP_VERSION;
    lsSet(seenKey, today);
  }
  if (Object.keys(patch).length) {
    setDoc(userDocRef(), patch, { merge: true }).catch(e => console.warn('lastSeen:', e));
  }
  updateDashboard(); // jalons de progression, désormais vérifiables
}

/** Les petits marqueurs du jour (objectif atteint, palier de série, bingo de la semaine) ne s'accumulent pas. */
function pruneLocalMarks() {
  try {
    const today = todayKey();
    const week = isoWeek().id;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      const stale = ((k.startsWith('jdb_goal_') || k.startsWith('jdb_streak_')) && !k.endsWith('_' + today))
        || (k.startsWith('jdb_bingo_') && !k.endsWith('_' + week));
      if (stale) localStorage.removeItem(k);
    }
  } catch { /* ignoré */ }
}

function onFirstLoad(isNew) {
  _firstLoadAt = Date.now();
  pruneLocalMarks();
  setReady(true);
  if (isNew && !state.trackedSince) state.trackedSince = todayKey();
  render();
  syncTitleInput();
  handleUrlAction();
  initLinkedFiles();
  handleIncoming();
  // Nouveau compte : aucune fenêtre. Compte existant : l'annonce de la mise à jour, une seule fois,
  // affichée quand on sait si la promo est ouverte (elle y est mentionnée seulement dans ce cas).
  const fresh = isNew || (state.chapters.length === 0 && !state.startDate);
  if (fresh) lsSet(WHATSNEW_KEY, WHATSNEW_VER);
  const announce = () => {
    if (!currentUser || lsGet(WHATSNEW_KEY) === WHATSNEW_VER) return;
    // Arrivée par un raccourci (rappel d'agenda, lien de fiche) ou fenêtre déjà ouverte :
    // on ne dérange pas, l'annonce attendra la prochaine ouverture.
    if (_urlIntent || document.querySelector('.modal-overlay:not(.hidden)')) return;
    openModal('whatsNewModal');
  };
  promo.init();
  Promise.race([promo.whenReady(), new Promise(r => setTimeout(r, 2500))]).then(announce);
}

function renderLoadingState(kind, code) {
  const c = document.getElementById('chaptersContainer');
  if (!c) return;
  if (kind === 'loading') {
    c.innerHTML = '<div class="empty-state"><div class="spinner"></div><p>Chargement de votre journal…</p></div>';
  } else if (kind === 'slow') {
    c.innerHTML = `<div class="empty-state"><h3>La connexion est lente…</h3>
      <p>Hors ligne, la toute première ouverture sur un appareil a besoin d'internet. Ensuite, le journal fonctionne même sans réseau.</p>
      <button class="btn btn-primary" onclick="location.reload()">Réessayer</button></div>`;
  } else {
    const why = code === 'permission-denied'
      ? 'La base de données a refusé l\'accès à vos données.'
      : 'Impossible de joindre la base de données.';
    c.innerHTML = `<div class="empty-state"><h3>Chargement impossible</h3>
      <p>${why} Vos données ne sont pas perdues : réessayez dans un instant.</p>
      <button class="btn btn-primary" onclick="location.reload()">Réessayer</button></div>`;
  }
}

function syncTitleInput() {
  const titleEl = document.getElementById('document-title');
  if (titleEl && document.activeElement !== titleEl) titleEl.value = state.documentTitle || '';
  fitTitle();
}

/** Le champ du titre prend la hauteur de son texte (un titre de thèse tient rarement sur une ligne). */
function fitTitle() {
  const el = document.getElementById('document-title');
  if (!el || el.offsetParent === null) return; // invisible : sa hauteur ne se mesure pas
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

/* ============================================================
   UTILITIES
============================================================ */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NF1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NF1F = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
function fmt1(n) { return NF1.format(Math.round((Number(n) || 0) * 10) / 10); }
function fmtInt(n) { return NF0.format(Math.round(Number(n) || 0)); }
function plural(n, one, many) { return Math.abs(n) >= 2 ? many : one; }

function formatDateFr(iso) {
  if (!iso) return '—';
  return parseDay(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDateShort(k) { return parseDay(k).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
function fmtMonthYear(k) { const d = parseDay(k); return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`; }
/** Le dépôt tel qu'on l'a indiqué : une date précise, ou seulement le mois visé. */
function fmtDeadline() { return state.deadlineMonth ? fmtMonthYear(state.deadline) : fmtDateShort(state.deadline); }
function monthStart(k) { const d = parseDay(k); return dayKey(new Date(d.getFullYear(), d.getMonth(), 1)); }
function monthEnd(year, month0) { return dayKey(new Date(year, month0 + 1, 0)); }
function fmtDateLong(k) { return parseDay(k).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }); }
function fmtDue(k) {
  const d = parseDay(k);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('fr-FR', opts);
}
function relDay(k) {
  const d = diffDays(k, todayKey());
  if (d === 0) return "Aujourd'hui";
  if (d === 1) return 'Hier';
  const s = parseDay(k).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function trunc(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function setHTML(id, val) { const el = document.getElementById(id); if (el) el.innerHTML = val; }

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ============================================================
   CALCULATIONS
============================================================ */
const totalPages   = () => state.chapters.reduce((s, ch) =>
  ch.subsections.length === 0
    ? s + (ch.targetPages  || 0)
    : s + ch.subsections.reduce((a, ss) => a + (ss.targetPages  || 0), 0), 0);
const writtenPages = () => state.chapters.reduce((s, ch) =>
  ch.subsections.length === 0
    ? s + (ch.writtenPages || 0)
    : s + ch.subsections.reduce((a, ss) => a + (ss.writtenPages || 0), 0), 0);
const totals = () => ({ total: totalPages(), written: writtenPages() });

function ssProgress(ss) {
  return ss.targetPages > 0 ? Math.min(100, Math.round((ss.writtenPages / ss.targetPages) * 100)) : 0;
}

function chapterStats(ch) {
  if (ch.subsections.length === 0) {
    const tP = ch.targetPages  || 0;
    const wP = ch.writtenPages || 0;
    return { tP, wP, prog: tP === 0 ? 0 : Math.min(100, Math.round((wP / tP) * 100)) };
  }
  const tP = ch.subsections.reduce((s, ss) => s + (ss.targetPages  || 0), 0);
  const wP = ch.subsections.reduce((s, ss) => s + (ss.writtenPages || 0), 0);
  return { tP, wP, prog: tP === 0 ? 0 : Math.min(100, Math.round((wP / tP) * 100)) };
}

const findCh = id => state.chapters.find(c => c.id === id);

/** Parties « feuilles » (sous-sections, ou chapitres sans sous-section). */
function leafSections() {
  const out = [];
  for (const ch of state.chapters) {
    if (ch.subsections.length) {
      for (const ss of ch.subsections) out.push({ id: ss.id, ch, ss, label: `${ch.title} › ${ss.title}` });
    } else out.push({ id: ch.id, ch, ss: null, label: ch.title });
  }
  return out;
}

function sectionLabel(id) {
  const leaf = leafSections().find(l => l.id === id);
  return leaf ? trunc(leaf.label, 60) : '';
}

/** Enregistre des pages écrites (ou retirées) dans le journal du jour. */
function addActivity(delta, day = todayKey()) {
  if (!delta) return;
  if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
  const v = (Number(state.activity[day]) || 0) + delta;
  state.activity[day] = Math.round(v * 100) / 100;
  scheduleJournalRender();
}

/* Partie « en cours » : la dernière sur laquelle des pages ont été notées.
   C'est elle que vise le bouton « +1 page ». */
const curKey = () => 'jdb_lastSection_' + (currentUser && currentUser.uid);

function leafProgress(l) { return l.ss ? ssProgress(l.ss) : chapterStats(l.ch).prog; }
function leafTitle(l) { return l.ss ? l.ss.title : l.ch.title; }

function currentLeaf() {
  const leaves = leafSections();
  if (!leaves.length) return null;
  const last = lsGet(curKey());
  return leaves.find(l => l.id === last) || leaves.find(l => leafProgress(l) < 100) || leaves[0];
}

function setCurrentLeaf(id) {
  if (lsGet(curKey()) === id) return;
  lsSet(curKey(), id);
  renderPrimary();
}

/* Mise à jour initiale : le jour où l'on crée son plan, les pages saisies
   dans le plan sont « déjà écrites » et ne comptent pas comme le travail du jour
   (sinon : objectif du jour explosé et date de fin fantaisiste dès le premier soir). */
const setupKey = () => 'jdb_setup_' + (currentUser && currentUser.uid);
function inSetup() { return !!currentUser && lsGet(setupKey()) === todayKey(); }
function startSetup() { lsSet(setupKey(), todayKey()); }
function endSetup() {
  lsSet(setupKey(), '');
  renderSetupBanner();
  toast('C\'est noté. Désormais, chaque page ajoutée compte pour votre journal.', 'success');
}

function renderSetupBanner() {
  const el = document.getElementById('setupBanner');
  if (el) el.classList.toggle('hidden', !(inSetup() && state.chapters.length > 0));
}

/* ============================================================
   PAGE DE TITRE — mises à jour ciblées, sans tout redessiner
   Quatre réponses, d'un coup d'œil : où j'en suis (le chiffre),
   quand j'aurai fini à ce rythme (la date, en grand) et si c'est
   dans les temps (le dépôt), à quelle vitesse j'écris (la vélocité),
   que faire aujourd'hui (objectif et bouton).
============================================================ */
function updateDashboard() {
  const t         = totals();
  const today     = todayKey();
  const fc        = forecast(state, t, today);
  _lastForecast   = fc;
  const total     = t.total;
  const written   = t.written;
  const remaining = total - written;
  const progress  = total === 0 ? 0 : Math.min(100, Math.round((written / total) * 100));

  // Le chiffre, la piste d'avancement, les pages
  setHeroFigure(progress);
  const fill = document.getElementById('gaugeFill');
  fill.style.width = progress + '%';
  fill.classList.toggle('zero', progress === 0);
  animNum('sWritten',   written);
  animNum('sTotal',     total);
  animNum('sRemaining', Math.max(0, remaining));
  const rest = document.getElementById('dbPagesRest');
  if (rest) rest.classList.toggle('hidden', total === 0 || remaining <= 0);
  renderLevel(progress, total, written);

  renderPrognosis(fc);
  renderVelocity(fc);
  renderDeadline(fc);
  renderToday(fc);
  renderReviewStrip();
  updateDueChips(fc);
  checkMilestones(progress);
  scheduleJournalRender();
  if (typeof onStatsChanged === 'function') onStatsChanged();
}

/* Le grand chiffre : à la première ouverture, il monte de zéro à sa valeur (une fois, pas à chaque page notée). */
const _figure = { raf: 0, target: -1, shown: false };
const calmMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function setHeroFigure(progress) {
  const el = document.getElementById('gaugePct');
  if (!el) return;
  if (_figure.raf && _figure.target === progress) return; // déjà en route vers cette valeur
  cancelAnimationFrame(_figure.raf);
  _figure.raf = 0;
  _figure.target = progress;
  const visible = el.offsetParent !== null;
  if (_figure.shown || !_loaded || !visible || progress <= 0 || calmMotion()) {
    el.textContent = progress + '\u00A0%';
    if (_loaded && visible) _figure.shown = true;
    return;
  }
  _figure.shown = true;
  const t0 = performance.now();
  const step = now => {
    const k = Math.min(1, (now - t0) / 900);
    el.textContent = Math.round(progress * (1 - (1 - k) ** 3)) + '\u00A0%';
    _figure.raf = k < 1 ? requestAnimationFrame(step) : 0;
  };
  _figure.raf = requestAnimationFrame(step);
}

/** Le grade du moment, les pastilles des suivants, et ce qu'il reste à écrire avant le prochain. */
function renderLevel(progress, total, written) {
  setText('gradeLine', total > 0 ? gradeFor(progress) : '');
  setHTML('levelTicks', levelTicksHTML(progress, GRADES.map(g => g[0])));
  const next = total > 0 ? GRADES.find(g => g[0] > progress) : null;
  let line = '';
  if (next) {
    // Le pourcentage affiché est arrondi : le grade tombe dès que l'arrondi atteint son seuil
    const need = Math.max(1, Math.ceil(((next[0] - 0.5) / 100) * total) - written);
    line = `Encore <b>${need}\u00A0page${need > 1 ? 's' : ''}</b> avant le grade suivant : « ${esc(next[1])} ».`;
  } else if (total > 0) {
    line = 'Tous les grades sont franchis. Reste le plus dur : choisir la date du pot.';
  }
  setHTML('levelNext', typo(line));
}

function animNum(id, newVal) {
  const el = document.getElementById(id);
  if (el && el.textContent !== String(newVal)) el.textContent = newVal;
}

/* ---------- Le pronostic : à ce rythme, quand la dernière page sera écrite ---------- */
const _prog = { end: null, gain: 0 };   // ce qui était affiché, pour saluer la date qui avance

/** « demain », « dans 3 semaines », « dans 14 mois ». */
function inWords(days) {
  return days <= 0 ? 'aujourd\'hui' : days === 1 ? 'demain' : `dans ${spanWords(days)}`;
}
/** « 9 jours gagnés », « 6 semaines gagnées », « 3 mois gagnés ». */
function gainedWords(days) {
  const w = spanWords(days);
  return `${w} ${/semaines$/.test(w) ? 'gagnées' : /^1 jour$/.test(w) ? 'gagné' : 'gagnés'}`;
}
/** « de 9 jours », « d'un jour », « de 6 semaines ». */
function byWords(days) {
  return days === 1 ? 'd\'un jour' : `de ${spanWords(days)}`;
}
/** Un rythme en pages par semaine, lisible même quand il est faible (« 0,9 », jamais « < 1 »). */
function fmtPace(v) {
  if (!(v > 0)) return '0';
  return v < 0.05 ? '<\u00A00,1' : NF1F.format(v);
}
/** « page » ou « pages », d'après le nombre tel qu'il est affiché (1,5 page, 2 pages). */
const pageWord = n => plural(Math.round(n * 10) / 10, 'page', 'pages');

/* Tant que le rythme repose sur peu de pages (suivi de moins de quatre semaines, ou moins d'une douzaine de pages
   en mémoire), une seule page déplace la date de plusieurs mois : on l'affiche, mais on ne chiffre pas encore ce
   que « rapporte » une page. */
const steadyPace = p => p.tracked >= 28 && p.pages >= 12;

function renderPrognosis(fc) {
  const today = todayKey();
  const p = fc.pace;
  const dateEl = document.getElementById('sEndDate');
  if (!dateEl) return;
  const done = fc.status === 'done';
  const daysToEnd = fc.projectedEnd ? diffDays(today, fc.projectedEnd) : null;
  let kicker = 'À ce rythme, dernière page le';
  let date = '—';
  let sub = '';
  let tag = '';
  let hypo = false;
  if (done) {
    kicker = 'Rédaction';
    date = 'Terminée';
    sub = 'La dernière page est écrite.';
  } else if (fc.projectedEnd) {
    date = fmtDateShort(fc.projectedEnd);
    sub = inWords(daysToEnd);
    tag = { early: 'première estimation', average: 'd\'après votre rythme moyen' }[p.basis] || '';
  } else if (fc.total > 0) {
    // Pas encore de rythme : une hypothèse plutôt qu'un vide, à raison d'une page par jour d'écriture
    hypo = true;
    kicker = 'À une page par jour d\'écriture, fin le';
    date = fmtDateShort(nthWritingDay(today, Math.max(1, Math.ceil(fc.remaining)), state.writingDays, state.pauses));
    sub = 'Votre date à vous arrive dès vos premières pages notées.';
  }
  setText('sEndKicker', kicker);
  dateEl.textContent = date;
  dateEl.classList.toggle('is-empty', date === '—');
  dateEl.classList.toggle('is-hypo', hypo);
  setText('sEndIn', sub);
  setText('sEndLbl', tag);
  // Ce que les pages du jour ont fait gagner (chiffré seulement quand le rythme est établi)
  const gained = !done && fc.gainToday > 0;
  setHTML('sEndGain', gained
    ? `<span class="prog-gain" title="Ce que vos pages d'aujourd'hui ont fait gagner sur la date de fin">${icon('sparkles')}${steadyPace(p) ? `${esc(gainedWords(fc.gainToday))} aujourd'hui` : 'la date a avancé'}</span>` : '');
  setText('sEndQuip', fc.total > 0 ? prognosisLine({
    status: fc.status, basis: p.basis, hasEnd: !!fc.projectedEnd, paused: !!fc.pause, margin: fc.margin,
    daysToEnd, gainToday: fc.gainToday, velocity: fc.velocity, trend: fc.trend,
  }, today) : '');

  // La date vient d'avancer grâce aux pages du jour : on le montre
  const moved = _prog.end && fc.projectedEnd && fc.projectedEnd < _prog.end && fc.gainToday > _prog.gain;
  _prog.end = fc.projectedEnd;
  _prog.gain = fc.gainToday;
  if (moved && !calmMotion()) {
    dateEl.classList.remove('bump');
    void dateEl.offsetWidth;
    dateEl.classList.add('bump');
  }
}

/* ---------- La vélocité : pages par semaine, tendance, record, et ce que change une page ---------- */
function renderVelocity(fc) {
  const box = document.getElementById('heroPace');
  if (!box) return;
  const today = todayKey();
  const p = fc.pace;
  const v = fc.velocity;
  const need = fc.perWeek || 0;
  const done = fc.status === 'done';
  // Rien à montrer : pas de rythme, pas de rythme à tenir (le bloc du dépôt invite déjà à fixer une date)
  const empty = done || fc.total === 0 || (!(v > 0) && !(need > 0));
  box.classList.toggle('hidden', empty);
  if (empty) { setText('paceNow', '—'); setText('paceNeed', '—'); togglePaceHow(false); return; }

  // Deux rythmes proches mais différents ne doivent pas s'afficher pareil
  const close = v > 0 && need > 0 && fmtPace(v) === fmtPace(need) && Math.abs(v - need) >= 0.005;
  const show = n => (close ? NF2.format(n) : fmtPace(n));
  setText('paceNow', v > 0 ? `${show(v)}\u00A0p./sem.` : '—');
  const tr = document.getElementById('paceTrend');
  if (tr) {
    const t = fc.trend;
    const flat = Math.max(0.15, v * 0.05);   // en dessous, ce n'est pas une tendance
    const dir = t == null ? '' : t >= flat ? 'up' : t <= -flat ? 'down' : 'flat';
    tr.className = 'pace-trend' + (dir ? ' ' + dir : '');
    tr.innerHTML = !dir ? '' : dir === 'flat' ? 'stable' : `${icon('arrow-right')}${t > 0 ? '+' : '−'}${fmt1(Math.abs(t))}`;
    tr.title = dir ? 'Par rapport à il y a quatre semaines' : '';
    if (dir) tr.setAttribute('aria-label', dir === 'flat' ? 'stable depuis quatre semaines' : `${t > 0 ? 'en hausse' : 'en baisse'} de ${fmt1(Math.abs(t))} page par semaine en quatre semaines`);
    else tr.removeAttribute('aria-label');
  }
  setText('paceNeed', need > 0 ? `${show(need)}\u00A0p./sem.` : '—');
  const needEl = document.getElementById('paceNeed');
  if (needEl) needEl.parentElement.classList.toggle('hidden', !(need > 0));
  // Le record : la meilleure semaine, une fois qu'il y en a quelques-unes à comparer
  const best = p.tracked >= 21 ? bestWeek(state) : null;
  const bestEl = document.getElementById('paceBest');
  if (bestEl) {
    bestEl.parentElement.classList.toggle('hidden', !best);
    bestEl.textContent = best ? `${fmt1(best.pages)}\u00A0p./sem.` : '—';
    bestEl.title = best ? `Votre meilleure semaine : celle du ${fmtDue(best.monday)}` : '';
  }

  // Les semaines : douze au plus, depuis le début du suivi (à partir de trois semaines, sinon il n'y a rien à lire)
  const since = state.trackedSince && state.trackedSince <= today ? state.trackedSince : today;
  const weeks = weeklyPages(state, today, 12).filter(w => addDays(w.monday, 6) >= since).map((w, i, all) => ({
    pages: w.pages,
    now: i === all.length - 1,
    label: i === all.length - 1 ? 'cette semaine' : `semaine du ${fmtDue(w.monday)}`,
  }));
  setHTML('pacePlot', weeks.length >= 3 ? paceBarsHTML(weeks, need) : '');

  // Le levier : ce que change une page, et ce qui manque pour arriver à l'heure
  const bits = [];
  const day = Number(state.activity[today]) || 0;
  const steady = steadyPace(p);
  if (fc.pause) {
    bits.push(`Période sans rédaction jusqu'au ${fmtDue(fc.pause.to)} : ni votre rythme ni la date ne bougent.`);
  } else {
    if (fc.gainToday > 0 && day > 0 && steady) {
      bits.push(day > 1.05
        ? `Vos <b>${fmt1(day)}\u00A0pages</b> d'aujourd'hui ont avancé la fin <b>${byWords(fc.gainToday)}</b>.`
        : `Votre <b>${day < 0.95 ? 'bout de page' : 'page'}</b> d'aujourd'hui a avancé la fin <b>${byWords(fc.gainToday)}</b>.`);
    }
    if (fc.status === 'behind' && fc.missing > 0) {
      const m = Math.max(0.1, Math.round(fc.missing * 10) / 10);
      bits.push(`Il manque <b>${fmt1(m)}\u00A0${pageWord(m)} par semaine</b> pour arriver à l'heure.`);
    } else if (fc.status === 'nopace') {
      bits.push(`Pour déposer à temps : <b>${fmt1(need)}\u00A0${pageWord(need)} par semaine</b>, soit ${fmt1(fc.dailyGoal)}\u00A0${pageWord(fc.dailyGoal)} par jour d'écriture.`);
    }
    if (!(fc.gainToday > 0) && fc.projectedEnd) {
      if (!steady) bits.push('Une page aujourd\'hui, et l\'estimation se précise.');
      else if (fc.gainPerPage > 0) bits.push(`Une page aujourd'hui, et la fin avance <b>${byWords(fc.gainPerPage)}</b>.`);
    }
  }
  setHTML('paceLever', typo(bits.join(' ')));
  setHTML('paceHow', paceHowHTML(fc));
}

/* Sur téléphone, la vélocité quitte le bandeau pour une carte à elle, sous « Aujourd'hui » : d'abord où j'en suis et
   quand j'aurai fini, puis quoi faire aujourd'hui, puis à quelle vitesse. Sur grand écran, elle reste dans le bandeau. */
const _phone = window.matchMedia ? window.matchMedia('(max-width: 899px)') : null;
function placePaceBlock() {
  const pace = document.getElementById('heroPace');
  const how = document.getElementById('paceHow');
  const hero = document.querySelector('.dashboard-banner');
  const today = document.querySelector('.board .today-strip');
  if (!pace || !how || !hero || !today) return;
  if (_phone && _phone.matches) {
    if (pace.parentElement !== today.parentElement) today.after(pace);
    if (how.parentElement !== pace) pace.append(how);
  } else if (pace.parentElement !== hero) {
    hero.append(pace, how);
  }
}
placePaceBlock();
if (_phone) _phone.addEventListener('change', placePaceBlock);

/** Ouvre ou referme « Comment c'est calculé », sous le bandeau. */
function togglePaceHow(force) {
  const hero = document.querySelector('.dashboard-banner');
  const body = document.getElementById('paceHow');
  const btn = document.getElementById('paceHowBtn');
  if (!hero || !body || !btn) return;
  const open = typeof force === 'boolean' ? force : body.classList.contains('hidden');
  body.classList.toggle('hidden', !open);
  hero.classList.toggle('how-open', open);
  btn.setAttribute('aria-expanded', String(open));
}

/** « Comment c'est calculé » : la règle, avec les chiffres du moment. */
function paceHowHTML(fc) {
  const p = fc.pace;
  const v = fc.velocity;
  const today = todayKey();
  const out = [];
  const months = ['deux', 'deux', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit'][clamp(Math.round(p.half / 30.44), 0, 8)];
  out.push(`Votre <b>vélocité</b> est la moyenne de vos pages par semaine. Les semaines récentes y pèsent le plus : une semaine vieille de ${months}\u00A0mois compte moitié moins que celle-ci.`
    + (p.half >= 100 ? ' Vous écrivez par petites touches : le calcul prend donc plus de recul, pour qu\'une seule page ne fasse pas tout basculer.' : ''));
  if (p.basis === 'average' && state.startDate) {
    out.push(`Le suivi est encore jeune : en attendant, le calcul s'appuie surtout sur votre rythme moyen depuis le ${formatDateFr(state.startDate)}.`);
  } else if (p.basis === 'early') {
    out.push('Les premiers jours, l\'estimation est fragile : elle se stabilise en deux à trois semaines de suivi.');
  }
  if (fc.projectedEnd && v > 0) {
    const weeks = fc.remaining / v;
    out.push(`La <b>date</b> : il reste ${fmtInt(fc.remaining)}\u00A0${pageWord(fc.remaining)} ; à ${fmtPace(v)}\u00A0${pageWord(v)} par semaine, cela fait ${weeks < 2 ? spanWords(Math.ceil(weeks * 7)) : `${fmtInt(weeks)}\u00A0semaines`}.`
      + (pausedDays(today, fc.projectedEnd, state.pauses) > 0 ? ' Vos périodes sans rédaction à venir la repoussent d\'autant.' : ''));
    out.push('Elle bouge tous les jours : elle avance d\'un coup quand vous écrivez, et recule doucement sinon. Les périodes sans rédaction que vous déclarez ne comptent ni pour ni contre vous.');
    // Un pronostic, pas une promesse : sur des rédactions simulées, la moitié des fins réelles tombent à moins d'un tiers de l'horizon
    const h = diffDays(today, fc.projectedEnd);
    const span = h < 21 ? 'à quelques jours près' : monthSpan(addDays(today, Math.round(h * 0.7)), addDays(today, Math.round(h * 1.3)));
    out.push(`C'est un pronostic, pas une promesse : comptez un tiers de marge, en plus ou en moins. Ici, ${span}.`);
  }
  if (fc.writingEnd && fc.status !== 'done') {
    const m = Number.isFinite(state.marginDays) ? state.marginDays : 21;
    out.push(`<b>À tenir</b> : le rythme pour écrire la dernière page le ${fmtDateShort(fc.writingEnd)}${m > 0 ? `, soit ${m}\u00A0jours avant le dépôt, le temps de relire` : ''}.`);
  }
  return out.map(t => `<p>${typo(t)}</p>`).join('');
}

/** « entre mai et novembre 2027 », « entre novembre 2027 et février 2028 », « courant mai 2027 ». */
function monthSpan(a, b) {
  const da = parseDay(a);
  const db = parseDay(b);
  if (da.getFullYear() === db.getFullYear()) {
    if (da.getMonth() === db.getMonth()) return `courant ${fmtMonthYear(b)}`;
    return `entre ${MONTHS_LONG[da.getMonth()]} et ${fmtMonthYear(b)}`;
  }
  return `entre ${fmtMonthYear(a)} et ${fmtMonthYear(b)}`;
}

/** Ligne « Dépôt » : un champ date tant qu'elle n'est pas fixée, puis le verdict. */
function renderDeadline(fc) {
  const el = document.getElementById('dbDeadline');
  if (!el) return;
  setText('dlLabel', state.deadline && state.deadlineMonth ? 'Dépôt visé' : 'Dépôt');
  if (!state.deadline) {
    if (el.dataset.mode === 'set') return; // ne pas recréer le champ pendant la saisie
    el.dataset.mode = 'set';
    el.className = 'db-deadline';
    el.innerHTML = `<label class="dl-set">Quand déposez-vous\u00A0?
        <input type="date" id="dlInline" min="${addDays(todayKey(), 1)}" aria-label="Ma date de dépôt"
               onchange="setDeadlineInline(this.value)" onblur="setDeadlineInline(this.value, true)"></label>
      <span class="db-dl-sub">Pour savoir si vous êtes dans les temps, et quel rythme tenir.
        <button type="button" class="link-btn" onclick="openProjectModal('month')">Pas de date précise\u00A0? Indiquez un mois.</button></span>`;
    return;
  }
  el.dataset.mode = 'show';
  let cls = '';
  let ico = 'target';
  let verdict = '';
  switch (fc.status) {
    case 'done':    cls = 'ok';   ico = 'check'; verdict = 'place à la relecture'; break;
    case 'overdue': cls = 'late'; ico = 'alert'; verdict = state.deadlineMonth ? 'fin de rédaction dépassée : ajustez la période' : 'fin de rédaction dépassée : ajustez la date'; break;
    case 'ontrack': cls = 'ok';   ico = 'check'; verdict = fc.margin > 0 ? `en avance ${byWords(fc.margin)}` : 'pile dans les temps'; break;
    case 'behind':  cls = 'warn'; ico = 'alert'; verdict = `en retard ${byWords(-fc.margin)}`; break;
    case 'nopace':  verdict = `à tenir : ${fmt1(fc.perWeek)} ${pageWord(fc.perWeek)} par semaine`; break;
    default: break;
  }
  // L'éphéméride : le jour du dépôt (ou seulement le mois visé), et le compte à rebours
  const d = parseDay(state.deadline);
  const left = diffDays(todayKey(), state.deadline);
  const count = left > 0 ? `J\u2212${left}` : left === 0 ? 'Jour J' : `J+${-left}`;
  const leaf = state.deadlineMonth
    ? `<span class="cal-m">${d.getFullYear()}</span><span class="cal-d cal-month">${MONTHS_SHORT[d.getMonth()]}</span>`
    : `<span class="cal-m">${MONTHS_SHORT[d.getMonth()]}</span><span class="cal-d">${d.getDate()}</span><span class="cal-y">${d.getFullYear()}</span>`;
  const what = state.deadlineMonth ? 'la période visée pour mon dépôt' : 'ma date de dépôt';
  el.className = 'db-deadline ' + cls;
  el.innerHTML = `<button type="button" class="dl-show" onclick="openProjectModal()" title="Modifier ${what}">
      <span class="cal-leaf" aria-hidden="true">${leaf}</span>
      <span class="dl-txt"><span class="dl-count" title="Jours restants avant ${state.deadlineMonth ? 'la fin du mois visé' : 'le dépôt'}">${count}</span>
        <span class="dl-date">${fmtDeadline()}</span><span class="dl-edit">modifier</span></span>
    </button>${verdict ? `<span class="chip ${cls ? 'chip-' + cls : ''} dl-verdict">${icon(ico)}<span>${typo(verdict)}</span></span>` : ''}`;
}

/** Date de dépôt saisie directement sur la page (pas de fenêtre). */
function setDeadlineInline(val, onBlur) {
  if (!val || !_loaded) return;
  // Pendant la frappe de l'année (« 0002 », « 0020 »…), la date est valide mais passée : on attend.
  if (!isDayKey(val) || val <= todayKey()) {
    if (onBlur) toast('Cette date est déjà passée : vérifiez l\'année.', 'warn');
    return;
  }
  if (state.deadline === val && !state.deadlineMonth) return;
  state.deadline = val;
  state.deadlineMonth = false;
  saveNow();
  render();
  const fc = _lastForecast;
  toast(fc && fc.perWeek
    ? `Dépôt le ${fmtDateShort(val)} : ${fmt1(fc.perWeek)} pages par semaine à tenir.`
    : `Date de dépôt enregistrée : ${fmtDateShort(val)}.`, 'success');
}

/** Nombre de jours depuis la dernière page notée (0 si l'on vient de commencer). */
function idleDays(today) {
  let last = '';
  for (const [k, v] of Object.entries(state.activity)) if (v > 0 && k > last && k <= today) last = k;
  for (const k of Object.keys(state.journal)) if (hasNotes(state.journal, k) && k > last && k <= today) last = k;
  if (!last) return 0;
  // Une période hors rédaction (terrain, congés…) n'est pas une panne : elle ne fait ni faner la plante ni venir l'araignée
  return Math.max(0, diffDays(last, today) - pausedDays(addDays(last, 1), today, state.pauses));
}

/**
 * Jours écoulés depuis la dernière synchro du document, quand il est temps d'y repenser (une semaine).
 * Ne concerne que celles et ceux qui suivent leur avancée ainsi, sans fichier lié qui se relit tout seul.
 */
function staleSyncDays(today) {
  if (hasAutoDocs()) return 0;
  let last = '';
  for (const f of Object.values(state.docFiles)) if (f.at && f.at > last) last = f.at;
  if (!last) return 0;
  const d = diffDays(last, today);
  return d >= 7 ? d : 0;
}

/** Bandeau « Aujourd'hui » : objectif du jour, série, semaine, geste principal. */
function renderToday(fc) {
  const today = todayKey();
  const done  = pagesOn(state.activity, today);
  const goal  = fc.dailyGoal;
  const pct   = goal > 0 ? clamp(done / goal, 0, 1) * 100 : 0;
  const reached = done > 0 && done >= goal;
  setHTML('tdVal', `<b>${fmt1(Math.max(0, done))}</b> / ${fmt1(goal)}\u00A0p.`);
  const ring = document.getElementById('tdRing');
  if (ring) {
    ring.style.setProperty('--p', pct.toFixed(1));
    ring.classList.toggle('zero', pct <= 0);
    ring.classList.toggle('done', reached);
  }
  setText('tdDate', parseDay(today).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }));
  const s = streak(state, today);
  const stale = staleSyncDays(today);
  const pause = pauseOn(state.pauses, today);
  const other = (state.journal[today] || []).find(e => e.k && e.k !== 'joker');
  setText('tdSub', !reached && pause
    ? typo(`${PAUSE_KINDS[pause.kind]} jusqu'au ${fmtDateShort(pause.to)} : le Journal n'attend pas de pages. Votre série est à l'abri.`)
    : !reached && hasJoker(state.journal, today) ? 'Joker posé : journée off assumée, la série est préservée.'
    : !reached && other && !done ? typo(`${ENTRY_KINDS[other.k]} : c'est noté. Une journée de thèse, même sans une ligne écrite.`)
    : stale && !reached
    ? typo(`Dernière synchro de votre document il y a ${stale} jours. Déposez-le dans la page (ou collez votre texte) : le Journal fait le calcul.`)
    : todayLine({
      done, goal,
      restDay: !state.writingDays.includes(weekday(today)),
      idleDays: idleDays(today),
      streak: s.includesToday ? 0 : s.count,
      hasDeadline: !!state.deadline && fc.goalIsAuto,
      weekday: weekday(today),
    }));
  setText('tdStreak', s.count);
  setText('tdStreakLbl', plural(s.count, 'jour', 'jours'));
  setText('tdStreakSub', s.count === 0 || s.includesToday ? 'de série' : 'à prolonger');
  const wk = sumRange(state.activity, mondayOf(today), today);
  setText('tdWeek', (wk > 0 ? '+' : '') + fmt1(wk));
  renderWeek(today, goal);
  renderPrimary();
  // La prochaine séance prévue, et le chemin vers l'agenda
  const next = document.getElementById('tdNext');
  if (next) {
    const nx = state.chapters.length ? nextSession() : null;
    next.classList.toggle('hidden', !nx);
    if (nx) {
      const gap = diffDays(today, nx.day);
      const when = gap === 0 ? 'aujourd\'hui' : gap === 1 ? 'demain' : gap < 7 ? WD_NAMES[weekday(nx.day)] : `le ${fmtDateShort(nx.day)}`;
      setHTML('tdNextTxt', esc(typo(`Prochaine séance : ${when} à ${fmtHour(nx.time)} (${fmtDuration(nx.minutes)})`)));
    }
  }
}

/** Les sept jours de la semaine en cours : une barre par jour, celle d'aujourd'hui en avant. */
function renderWeek(today, goal) {
  const monday = mondayOf(today);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(monday, i);
    const wd = weekday(k);
    days.push({
      label: WD_LETTERS[wd], name: WD_NAMES[wd],
      pages: k > today ? 0 : Math.max(0, pagesOn(state.activity, k)),
      today: k === today, future: k > today, rest: !state.writingDays.includes(wd) || !!pauseOn(state.pauses, k),
    });
  }
  setHTML('weekBars', weekBarsHTML(days, goal));
}

/** Geste principal du jour : « +1 page », ou « Synchroniser » si un fichier Word est lié ici. */
function renderPrimary() {
  const btn = document.getElementById('tdPrimary');
  const cap = document.getElementById('tdCap');
  const act = document.getElementById('tdAct');
  const fabLbl = document.querySelector('.fab .fab-lbl');
  if (!btn || !cap || !act) return;
  const leaf = currentLeaf();
  const linked = hasAutoDocs();
  const usable = !!leaf || linked;
  act.classList.toggle('hidden', !usable);
  document.body.classList.toggle('no-plan', !usable);
  markCurrent(leaf);
  renderShelf();
  if (!usable) return;
  const label = linked ? 'Synchroniser' : '+1 page';
  btn.innerHTML = (linked ? icon('sync') : '') + `<span>${label}</span>`;
  if (fabLbl) fabLbl.textContent = label;
  btn.title = linked ? 'Relire mon document et mettre à jour mes pages' : 'Ajouter une page à la partie en cours';
  cap.classList.remove('alert');
  if (linked) renderSyncCaption();
  else {
    // « détailler » est souligné : c'est lui qui ouvre la saisie complète (autre partie, plusieurs pages, hier, une note)
    cap.innerHTML = `sur «\u00A0${esc(trunc(leafTitle(leaf), 26))}\u00A0» · <u>détailler</u>`;
    cap.title = 'Autre partie, plusieurs pages, hier, ou une note';
  }
}

/** Repère de la partie en cours (celle que vise « +1 page ») : sa ligne dans le plan. */
function markCurrent(leaf) {
  document.querySelectorAll('.chapter-card.is-current, .subsection.is-current').forEach(e => e.classList.remove('is-current'));
  if (!leaf) return;
  const row = document.getElementById((leaf.ss ? 'ss-' : 'ch-') + leaf.id);
  if (row) row.classList.add('is-current');
}

/* ============================================================
   L'ÉTAGÈRE — un livre par chapitre, d'autant plus épais que le
   chapitre est long, surligné à hauteur de ce qui est écrit.
   La plante pousse avec la série de jours d'écriture ; après dix
   jours sans une page, une araignée s'installe.
============================================================ */
let _shelfHover = false;
let _shelfShown = false; // à la première ouverture, les livres arrivent vides et se remplissent sous les yeux

function shelfModel() {
  const cur = currentLeaf();
  const sch = _lastForecast ? currentSchedule(_lastForecast) : {};
  return state.chapters.map(ch => {
    const st = chapterStats(ch);
    return {
      id: ch.id, title: ch.title, pct: st.prog, written: st.wP, target: st.tP, status: ch.review || '',
      current: !!cur && cur.ch.id === ch.id, due: sch[ch.id] ? fmtDue(sch[ch.id]) : '',
    };
  });
}

function setShelfReadout(text) {
  const n = state.chapters.length;
  setText('shelfReadout', typo(text || (n ? `${n} chapitre${n > 1 ? 's' : ''}. Chaque livre se surligne à mesure que vous écrivez.` : '')));
}

function renderShelf() {
  const row = document.getElementById('shelfBooks');
  const shelf = document.getElementById('shelf');
  if (!row || !shelf) return;
  const books = shelfModel();
  const slots = [...row.querySelectorAll('.book-slot')];
  // Mêmes chapitres dans le même ordre : on met à jour sur place, le surlignage monte en douceur
  const same = slots.length === books.length && slots.every((s, i) => s.querySelector('.book').dataset.book === books[i].id);
  if (same) slots.forEach((slot, i) => updateBook(slot, books[i]));
  else {
    const visible = row.offsetParent !== null;
    const intro = !_shelfShown && _loaded && visible && !calmMotion();
    row.innerHTML = shelfBooksHTML(books, { intro }) + '<span class="shelf-plant" id="shelfPlant"></span>';
    if (intro) requestAnimationFrame(() => requestAnimationFrame(renderShelf)); // à l'image suivante, le surlignage monte
    if (_loaded && visible) _shelfShown = true;
  }
  // Livres serrés (beaucoup de chapitres) : sous la planche, le nombre seul, sans le signe « % »
  row.classList.toggle('dense', [...row.querySelectorAll('.book-slot')].some(s => s.offsetWidth > 0 && s.offsetWidth < 38));
  const today = todayKey();
  const s = streak(state, today);
  const idle = idleDays(today);
  const wilted = s.count === 0 && idle >= 4;
  const plant = document.getElementById('shelfPlant');
  if (plant) {
    const key = wilted ? 'soif' : String(s.count);
    if (plant.dataset.key !== key) { plant.dataset.key = key; plant.innerHTML = plantSVG(s.count, { wilted }); }
    plant.title = plantCaption(s.count, wilted);
  }
  const spider = shelf.querySelector('.shelf-spider');
  if (idle >= 10 && !spider) shelf.insertAdjacentHTML('beforeend', spiderSVG(40));
  else if (idle < 10 && spider) spider.remove();
  if (!_shelfHover) setShelfReadout();
}

/** Survol ou focus d'un livre : son détail s'écrit au-dessus de l'étagère. Clic : on va à son chapitre. */
function initShelf() {
  const row = document.getElementById('shelfBooks');
  if (!row) return;
  const bookOf = e => (e.target && e.target.closest ? e.target.closest('.book[data-book]') : null);
  const show = e => { const b = bookOf(e); if (b) { _shelfHover = true; setShelfReadout(b.getAttribute('aria-label')); } };
  const hide = () => { _shelfHover = false; setShelfReadout(); };
  row.addEventListener('mouseover', show);
  row.addEventListener('focusin', show);
  row.addEventListener('mouseleave', hide);
  row.addEventListener('focusout', hide);
  row.addEventListener('click', e => { const b = bookOf(e); if (b) goToChapter(b.dataset.book); });
}

function goToChapter(id) {
  const card = document.getElementById('ch-' + id);
  if (!card) return;
  card.scrollIntoView({ behavior: calmMotion() ? 'auto' : 'smooth', block: 'center' });
  card.classList.remove('flash');
  void card.offsetWidth; // relance l'animation
  card.classList.add('flash');
}

function primaryAction() {
  if (!requireReady()) return;
  if (hasAutoDocs()) syncAll({ manual: true });
  else quickAdd(1);
}

/** Clic sur la légende du bouton : détailler la saisie, ou gérer les fichiers liés. */
function captionAction() {
  if (!requireReady()) return;
  if (_pendingReview) { const m = _pendingReview; _pendingReview = null; openDocxPreview(m); renderPrimary(); }
  else if (hasAutoDocs()) openDocxModal();
  else openLogModal();
}

/** Chapitres chez la direction : annotés comme au stylo, avec relance possible. */
function renderReviewStrip() {
  const el = document.getElementById('reviewStrip');
  if (!el) return;
  const sent = state.chapters.filter(c => c.review === 'sent');
  if (!sent.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const today = todayKey();
  const items = sent.slice(0, 3).map(c => {
    const d = c.reviewDate ? Math.max(0, diffDays(c.reviewDate, today)) : 0;
    const since = d === 0 ? "depuis aujourd'hui" : `depuis ${d} jour${d > 1 ? 's' : ''}`;
    const ghost = d >= 21 ? ` <span class="rv-ghost">${GHOST_LINES[d % GHOST_LINES.length]}</span>` : '';
    const btn = d >= 10 ? `<button type="button" class="link-btn" onclick="remindSupervisor('${c.id}')">Relancer</button>` : '';
    return `<div class="rv-item">${icon('send')}<span class="rv-txt"><b>${esc(trunc(c.title, 50))}</b> est chez la direction ${since}.${ghost}</span>${btn}</div>`;
  }).join('');
  el.innerHTML = items + (sent.length > 3 ? `<div class="rv-more">et ${sent.length - 3} autre${sent.length - 3 > 1 ? 's' : ''}…</div>` : '');
  el.classList.remove('hidden');
}

/** Échéances conseillées pour tenir le dépôt, affichées sur chaque chapitre. */
function currentSchedule(fc) {
  const chs = state.chapters.map(c => {
    const s = chapterStats(c);
    return { id: c.id, title: c.title, remaining: c.review === 'ok' ? 0 : Math.max(0, s.tP - s.wP) };
  });
  return schedule(chs, state, todayKey(), fc);
}

function updateDueChips(fc) {
  const sch = currentSchedule(fc);
  const today = todayKey();
  for (const c of state.chapters) {
    const el = document.getElementById('due-' + c.id);
    if (!el) continue;
    const k = sch[c.id];
    if (!k) { el.textContent = ''; el.className = 'due-chip'; el.removeAttribute('title'); continue; }
    el.textContent = `pour le ${fmtDue(k)}`;
    el.className = 'due-chip' + (diffDays(today, k) <= 7 ? ' soon' : '');
    el.title = 'À finir pour cette date si vous voulez tenir votre dépôt';
  }
}

/* ============================================================
   ÉTAPES — quelques mots au bon moment, pas de feu d'artifice
   (sauf le jour où la dernière page est écrite).
============================================================ */
function checkMilestones(progress) {
  // Pas d'annonce (ni d'écriture) sur la base d'un cache local peut-être périmé :
  // on attend la confirmation du serveur (onServerSynced relance la vérification).
  if (!_serverSynced) return;
  [25, 50, 75, 100].forEach(ms => {
    if (progress >= ms && !state.milestones[ms]) {
      state.milestones[ms] = true;
      saveNow();
      if (ms === 100) launchConfetti(160);
      toast(MILESTONE_LINES[ms], 'success', { duration: 6500 });
    }
  });
}

/** Objectif du jour atteint, paliers de série : une seule annonce par jour. */
function checkDailyGoal() {
  if (!currentUser || !_lastForecast) return;
  const today = todayKey();
  const done = pagesOn(state.activity, today);
  const goalKey = `jdb_goal_${currentUser.uid}_${today}`;
  const streakKey = `jdb_streak_${currentUser.uid}_${today}`;
  const s = streak(state, today);
  const streakStep = s.includesToday && [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365].includes(s.count) && !lsGet(streakKey);
  // Un seul message de félicitations à la fois : le palier de série l'emporte sur l'objectif du jour
  // (déjà visible dans le bandeau « Aujourd'hui »).
  if (done > 0 && done >= _lastForecast.dailyGoal && !lsGet(goalKey)) {
    lsSet(goalKey, '1');
    if (!streakStep) toast('Objectif du jour atteint.', 'success', { key: 'cheer' });
  }
  if (streakStep) {
    lsSet(streakKey, '1');
    toast(streakLine(s.count), 'success', { key: 'cheer', duration: 6000 });
  }
  checkDefi();
}

/** Réservé à la toute dernière page : quelques confettis aux couleurs de la maison. */
function launchConfetti(count) {
  if (calmMotion()) return;
  const colors = ['#F0AE3C', '#F3C566', '#2B5654', '#8E2F3C', '#FBF3E2'];
  for (let i = 0; i < count; i++) {
    setTimeout(() => {
      const el  = document.createElement('div');
      const sz  = Math.random() * 7 + 5;
      const dur = Math.random() * 1.8 + 2.4;
      el.style.cssText = `position:fixed;top:-14px;z-index:9999;pointer-events:none;left:${(Math.random() * 100).toFixed(1)}vw;`
        + `width:${sz.toFixed(1)}px;height:${(sz * 0.45).toFixed(1)}px;background:${colors[i % colors.length]};`;
      document.body.appendChild(el);
      el.animate(
        [{ transform: 'translateY(0) rotate(0deg)', opacity: 1 }, { transform: `translateY(105vh) rotate(${360 + Math.random() * 360}deg)`, opacity: 0.2 }],
        { duration: dur * 1000, easing: 'linear' },
      ).onfinish = () => el.remove();
    }, Math.random() * 500);
  }
}

/* ============================================================
   TOAST — message bref, avec action facultative (« Annuler »)
   opts : { key, action: { label, fn }, duration }
   Un message de même « key » remplace le précédent.
============================================================ */
function toast(msg, type, opts = {}) {
  const box = document.getElementById('toastBox');
  if (opts.key) box.querySelectorAll('.toast').forEach(e => { if (e.dataset.key === opts.key) e.remove(); });
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.setAttribute('role', 'status');
  if (opts.key) el.dataset.key = opts.key;
  if (opts.undo) el.dataset.undo = '1';
  if (type === 'success' || type === 'warn') el.insertAdjacentHTML('afterbegin', icon(type === 'warn' ? 'alert' : 'check'));
  const span = document.createElement('span');
  span.textContent = typo(msg); // pas de « : » ni de « ? » rejeté seul à la ligne
  el.appendChild(span);
  if (opts.action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'toast-act';
    b.textContent = opts.action.label;
    b.onclick = () => { el.remove(); opts.action.fn(); };
    el.appendChild(b);
  }
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, opts.duration || (opts.action ? 7000 : 3200));
  return el;
}

/** Charge un script externe à la demande (image de partage…). */
function loadScript(src, integrity) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    if (integrity) { s.integrity = integrity; s.crossOrigin = 'anonymous'; }
    s.referrerPolicy = 'no-referrer';
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('script')); };
    document.head.appendChild(s);
  });
}

/* ============================================================
   TABLE DES MATIÈRES — rendu complet
============================================================ */
function render() {
  renderChapters();
  renderSetupBanner();
  updateDashboard();
  initSortable(); // must come after renderChapters() so DOM elements exist
  renderJournal();
  renderBingoTeaser();
  fitTitle();
}

function renderChapters() {
  const c = document.getElementById('chaptersContainer');
  const empty = state.chapters.length === 0;
  const addRow = document.getElementById('addChapterRow');
  if (addRow) addRow.classList.toggle('hidden', empty);
  // Sans plan, la page de titre n'a rien à dire : on laisse toute la place au démarrage
  document.body.classList.toggle('empty-plan', empty);
  updateWordButton();
  if (empty) {
    // Trois façons de créer son plan, de la plus automatique à la plus manuelle
    c.innerHTML = `
      <div class="empty-state onboarding">
        <div class="ob-shelf" aria-hidden="true">${spiderSVG(64)}${plantSVG(0)}<div class="shelf-board"></div></div>
        <p class="eyebrow">Bienvenue</p>
        <h3>Votre étagère est vide. Pour l'instant.</h3>
        <p class="ob-lead">Trente secondes pour y ranger vos chapitres. Ensuite, chaque page écrite se voit.</p>
        <button type="button" class="dropzone ob-drop" onclick="pickWordFile()">
          ${icon('upload', 'ic-lg')}
          <span class="dz-main">Déposer mon document</span>
          <span class="dz-sub">Word, LibreOffice ou LaTeX. Ou collez ici le texte de votre document (Overleaf, Word en ligne…) : chapitres et pages rédigées se remplissent tout seuls. Il est lu sur votre appareil, il n'est envoyé nulle part.</span>
        </button>
        <button type="button" class="link-btn ob-gdoc" onclick="openDocxModal()">Mon manuscrit est dans Google Docs : le lier par son lien</button>
        <p class="ob-or">Pas de fichier sous la main ? Partez d'un modèle :</p>
        <div class="ob-choices">
          <button type="button" class="btn btn-outline" onclick="applyTemplate(0)">Thèse SHS</button>
          <button type="button" class="btn btn-outline" onclick="applyTemplate(1)">Thèse IMRAD</button>
          <button type="button" class="btn btn-outline" onclick="applyTemplate(2)">Thèse par articles</button>
          <button type="button" class="btn btn-outline" onclick="applyTemplate(3)">Mémoire</button>
        </div>
        <button type="button" class="link-btn ob-link" onclick="togglePlanTyping()">ou saisir (coller) mon propre plan</button>
        <div class="ob-type hidden" id="obType">
          <textarea id="planText" class="form-control" rows="7" aria-label="Votre plan, un chapitre par ligne" onpaste="handlePlanPaste(event, true)"
            placeholder="Un chapitre par ligne. Décalez une ligne pour une sous-partie.&#10;&#10;Introduction&#10;État de l'art&#10;   Contexte historique&#10;   Travaux récents&#10;Méthodologie&#10;Conclusion"></textarea>
          <div class="ob-type-row">
            <label>Objectif total&nbsp;: <input type="number" id="planTotal" min="1" inputmode="numeric" placeholder="ex. 300" aria-label="Objectif total de pages"> pages</label>
            <button type="button" class="btn btn-primary" onclick="createPlanFromText()">Créer mon plan</button>
          </div>
        </div>
      </div>`;
    return;
  }
  c.innerHTML = state.chapters.map(ch => buildChapterHTML(ch)).join('');
}

/** Pages rédigées / objectif d'une partie : − et + pour aller vite, saisie directe possible. */
function pagesCtlHTML(leafId, chId, ssId, written, target) {
  const onW = ssId ? `updateWritten('${chId}','${ssId}',this.value)` : `updateChWritten('${chId}',this.value)`;
  const onT = ssId ? `updateTarget('${chId}','${ssId}',this.value)` : `updateChTarget('${chId}',this.value)`;
  return `<span class="pages-ctl" onclick="event.stopPropagation()">
      <button type="button" class="pg-btn" onclick="stepPages('${leafId}',-1)" aria-label="Une page de moins" title="Une page de moins">−</button>
      <input type="number" class="pages-input" id="win-${leafId}" value="${written || 0}" min="0" inputmode="numeric"
             onfocus="this.select()" oninput="${onW}" title="Pages rédigées" aria-label="Pages rédigées" />
      <button type="button" class="pg-btn plus" onclick="stepPages('${leafId}',1)" aria-label="Une page de plus" title="Une page de plus">+</button>
      <span class="pg-sep">/</span>
      <input type="number" class="target-input" value="${target || 0}" min="1" inputmode="numeric"
             onfocus="this.select()" oninput="${onT}" title="Objectif de pages (modifiable)" aria-label="Objectif de pages" />
      <span class="pg-unit">p.</span>
    </span>`;
}

/** Annotation de statut, comme une mention portée au stylo dans la marge. */
function badgeHTML(ch) {
  if (!ch.review) return '';
  const d = ch.reviewDate ? Math.max(0, diffDays(ch.reviewDate, todayKey())) : 0;
  const txt = ch.review === 'sent' ? `chez la direction${d ? ` depuis ${d} j` : ''}`
    : ch.review === 'revise' ? 'à corriger' : 'validé';
  const ico = { sent: 'send', revise: 'pencil', ok: 'check' }[ch.review];
  return `<button type="button" class="chip ch-badge st-${ch.review}" title="Changer le statut"
            onclick="event.stopPropagation(); openChapterMenu('${ch.id}')">${icon(ico)}${txt}</button>`;
}

function buildChapterHTML(ch) {
  const { tP, wP, prog } = chapterStats(ch);
  const isDone   = prog >= 100;
  const hasS     = ch.subsections.length > 0;
  const showBody = hasS ? ch.expanded !== false : _addOpen.has(ch.id);
  // Chapitre sans sous-section : ses pages se règlent directement sur sa ligne, sans rien déplier
  const pages = hasS
    ? `<span class="ch-pages-txt">${wP} / ${tP} p.</span>`
    : pagesCtlHTML(ch.id, ch.id, '', wP, tP);
  return `
<div class="chapter-card${isDone ? ' completed' : ''}${showBody ? ' expanded' : ''}${hasS ? ' has-subs' : ' leaf'}" id="ch-${ch.id}">
  <div class="chapter-header"${hasS ? ` onclick="toggleChapter('${ch.id}')"` : ''}>
    <span class="ch-drag-handle" onclick="event.stopPropagation()" title="Déplacer">${icon('grip')}</span>
    <div class="toc-main">
      <div class="toc-line">
        ${hasS ? `<span class="ch-arrow" aria-hidden="true">${icon('chevron-right')}</span>` : ''}
        <input class="editable" value="${esc(ch.title)}"
               onclick="event.stopPropagation()"
               onblur="updateChTitle('${ch.id}',this.value)"
               onkeydown="if(event.key==='Enter')this.blur()"
               title="Cliquez pour modifier" aria-label="Titre du chapitre" />
        ${pages}
        <span class="ch-pct${isDone ? ' done' : ''}">${prog}\u00A0%</span>
      </div>
      <div class="toc-meta"><span class="ch-badge-slot" id="bd-${ch.id}">${badgeHTML(ch)}</span><span class="due-chip" id="due-${ch.id}"></span></div>
      <div class="meter"><div class="meter-fill ch-progress-fill${isDone ? ' done' : ''}" style="width:${prog}%"></div></div>
    </div>
    <button type="button" class="btn-more" aria-label="Actions du chapitre" title="Statut, sous-sections, suppression"
            onclick="event.stopPropagation(); openChapterMenu('${ch.id}')">${icon('more')}</button>
  </div>
  <div class="chapter-body">
    ${hasS ? `<div class="ss-list" id="ssl-${ch.id}">${ch.subsections.map(ss => buildSsHTML(ss, ch.id)).join('')}</div>` : ''}
    <div class="add-row sub">
      ${icon('plus')}
      <input type="text" class="add-input" maxlength="300" placeholder="Ajouter une sous-section" aria-label="Nouvelle sous-section"
             onkeydown="if(event.key==='Enter')addSsInline('${ch.id}',this)" />
      <button type="button" class="add-btn" onclick="addSsInline('${ch.id}',this.previousElementSibling)">Ajouter</button>
    </div>
  </div>
</div>`;
}

function buildSsHTML(ss, chId) {
  const prog   = ssProgress(ss);
  const isDone = prog >= 100;
  return `
<div class="subsection" id="ss-${ss.id}">
  <span class="ss-drag-handle" title="Déplacer">${icon('grip')}</span>
  <div class="toc-main">
    <div class="toc-line">
      <input class="editable" value="${esc(ss.title)}"
             onblur="updateSsTitle('${chId}','${ss.id}',this.value)"
             onkeydown="if(event.key==='Enter')this.blur()"
             title="Cliquez pour modifier" aria-label="Titre de la sous-section" />
      ${pagesCtlHTML(ss.id, chId, ss.id, ss.writtenPages, ss.targetPages)}
      <span class="prog-pct${isDone ? ' done' : ''}" id="pct-${ss.id}">${prog}\u00A0%</span>
    </div>
    <div class="meter"><div class="meter-fill${isDone ? ' done' : ''}" id="bar-${ss.id}" style="width:${prog}%"></div></div>
  </div>
  <button type="button" class="btn-x" title="Supprimer" aria-label="Supprimer la sous-section" onclick="deleteSs('${chId}','${ss.id}')">${icon('x')}</button>
</div>`;
}

/* ============================================================
   JOURNAL — calendrier de régularité et notes
============================================================ */
let _journalRaf = 0;
let _journalShowAll = false;

function scheduleJournalRender() {
  cancelAnimationFrame(_journalRaf);
  _journalRaf = requestAnimationFrame(renderJournal);
}

function heatLevel(p, note, goal) {
  if (p > 0) {
    if (p < goal * 0.5) return 1;
    if (p < goal) return 2;
    if (p < goal * 2) return 3;
    return 4;
  }
  return note ? 1 : 0;
}

/**
 * Calendrier de régularité : une colonne par semaine, du lundi au dimanche.
 * Dessiné en SVG : il garde ses proportions quelle que soit la largeur disponible.
 */
function heatmapHTML(activity, journal, opts) {
  const { weeks, today, goal, since } = opts;
  const start = addDays(mondayOf(today), -7 * (weeks - 1));
  const C = 11;        // côté d'une case
  const P = C + 2;     // pas (case + espace)
  let cells = '';
  let months = '';
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const monday = addDays(start, 7 * w);
    const m = parseDay(monday).getMonth();
    months += `<span>${m !== lastMonth ? MONTHS_SHORT[m] : ''}</span>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const k = addDays(monday, d);
      if (k > today) continue;
      const p    = pagesOn(activity, k);
      const kind = ((journal && journal[k]) || []).find(e => e && e.k && e.k !== 'joker');
      const off  = !p && !kind && (hasJoker(journal, k) || (opts.pauses && pauseOn(opts.pauses, k)));
      const note = hasNotes(journal, k) && !off;
      const pre  = since && k < since;
      const lbl  = p ? `${fmt1(p)} p.${kind ? ` · ${ENTRY_KINDS[kind.k].toLowerCase()}` : ''}` : kind ? ENTRY_KINDS[kind.k].toLowerCase()
        : off ? (hasJoker(journal, k) ? 'joker' : PAUSE_KINDS[pauseOn(opts.pauses, k).kind].toLowerCase()) : note ? 'note' : 'rien';
      cells += `<rect class="hm l${heatLevel(p, note, goal)}${k === today ? ' today' : ''}${pre ? ' pre' : ''}${off ? ' off' : ''}${!p && kind ? ' kind' : ''}" x="${w * P}" y="${d * P}" width="${C}" height="${C}" rx="2.5"><title>${fmtDateLong(k)} : ${lbl}</title></rect>`;
    }
  }
  return `<div class="hm-months" style="grid-template-columns:repeat(${weeks},1fr)">${months}</div>`
    + `<svg class="hm-grid" viewBox="-1 -1 ${weeks * P} ${7 * P}" role="img" aria-label="Calendrier de régularité des ${weeks} dernières semaines">${cells}</svg>`;
}

function renderJournal() {
  const card = document.getElementById('journalCard');
  if (!card) return;
  card.classList.toggle('hidden', state.chapters.length === 0);
  if (state.chapters.length === 0) return;

  const today = todayKey();
  const goal  = (_lastForecast && _lastForecast.dailyGoal) || 1;
  const weeks = card.clientWidth > 560 ? 26 : 16;
  const best  = bestStreak(state, today);
  setText('jcSummary', best > 1 ? `meilleure série : ${best} jours` : `${weeks} dernières semaines`);
  setHTML('heatmap', heatmapHTML(state.activity, state.journal, { weeks, today, goal, since: state.trackedSince, pauses: state.pauses }));
  renderDefi();

  const days = new Set();
  for (const [k, v] of Object.entries(state.activity)) if (v && k <= today) days.add(k);
  for (const k of Object.keys(state.journal)) if (hasNotes(state.journal, k) && k <= today) days.add(k);
  const sorted = [...days].sort().reverse();
  const shown = sorted.slice(0, _journalShowAll ? 60 : 5);
  if (!shown.length) {
    setHTML('jcEntries', '<p class="jc-empty">Rien pour l\'instant. Le journal se remplit tout seul, au fil de vos pages.</p>');
    return;
  }
  const html = shown.map(k => {
    const p = pagesOn(state.activity, k);
    const entries = state.journal[k] || [];
    const lines = entries.map((e, i) => {
      if (!e.n && !e.s && !e.k) return '';
      const kind = e.k ? `<span class="je-kind${e.k === 'joker' ? ' joker' : ''}">${esc(ENTRY_KINDS[e.k])}</span>` : '';
      const text = e.n ? `<span class="je-text">${esc(e.n)}</span>` : '';
      const meta = [e.p ? `+${fmt1(e.p)} p.` : '', e.s ? sectionLabel(e.s) : ''].filter(Boolean).join(' · ');
      const what = e.k ? (e.k === 'joker' ? 'le joker' : 'cette journée') : 'la note';
      const del = e.n || e.k ? `<button type="button" class="je-del" onclick="deleteNote('${k}', ${i})" title="Supprimer ${what}" aria-label="Supprimer ${what}">${icon('x')}</button>` : '';
      return `<div class="je-line">${kind}${text}${meta ? `<span class="je-meta">${esc(meta)}</span>` : ''}${del}</div>`;
    }).join('');
    const pCls = p > 0 ? 'pos' : p < 0 ? 'neg' : '';
    return `<div class="je"><div class="je-date">${relDay(k)}</div>
      <div class="je-pages ${pCls}">${p ? (p > 0 ? '+' : '') + fmt1(p) + '\u00A0p.' : ''}</div>
      <div class="je-notes">${lines}</div></div>`;
  }).join('');
  const more = sorted.length > shown.length
    ? `<button type="button" class="jc-more" onclick="toggleJournalAll()">Voir tout le journal (${sorted.length} jours)</button>`
    : (_journalShowAll && sorted.length > 5 ? '<button type="button" class="jc-more" onclick="toggleJournalAll()">Réduire</button>' : '');
  setHTML('jcEntries', html + more);
}

function toggleJournalAll() { _journalShowAll = !_journalShowAll; renderJournal(); }

/* ---------- Le défi de la semaine : un seul, vérifié tout seul, et que l'on peut refuser ---------- */
function currentDefi() {
  if (state.defis.off || !state.chapters.length) return null;
  const today = todayKey();
  return weeklyChallenge(state, today, _lastForecast || forecast(state, totals(), today));
}

function renderDefi() {
  const box = document.getElementById('jcDefi');
  if (!box) return;
  const d = currentDefi();
  box.classList.toggle('hidden', !d);
  if (!d) return;
  const won = d.done || state.defis.won.includes(d.week);
  const n = state.defis.won.length + (d.done && !state.defis.won.includes(d.week) ? 1 : 0);
  const pct = Math.round(clamp(d.value / d.target, 0, 1) * 100);
  box.classList.toggle('won', won);
  box.innerHTML = `<div class="defi-head"><span class="defi-kicker">${icon(won ? 'check' : 'target')}Défi de la semaine${won ? ' relevé' : ''}</span>
      <button type="button" class="defi-x" onclick="stopDefis()" title="Ne plus proposer de défi (se réactive dans « Dépôt, objectif et rythme »)" aria-label="Ne plus proposer de défi">${icon('x')}</button></div>
    <p class="defi-text">${esc(typo(d.text))}</p>
    <div class="defi-bar"><span class="meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="Avancée du défi"><span class="meter-fill" style="width:${pct}%"></span></span>
      <span class="defi-val">${fmt1(d.value)} / ${fmt1(d.target)}</span></div>
    ${n > 0 ? `<p class="defi-count">${n} défi${n > 1 ? 's' : ''} relevé${n > 1 ? 's' : ''} depuis le début</p>` : ''}`;
}

/** Défi atteint : on le retient (une fois par semaine) et on le dit. */
function checkDefi() {
  const d = currentDefi();
  if (!d || !d.done || state.defis.won.includes(d.week)) return;
  state.defis.won = [...state.defis.won, d.week].slice(-120);
  saveDebounced();
  renderDefi();
  toast(typo(`Défi de la semaine relevé : ${d.text.charAt(0).toLowerCase()}${d.text.slice(1)}.`), 'success', { key: 'defi', duration: 6000 });
}

function stopDefis() {
  state.defis.off = true;
  saveDebounced();
  renderDefi();
  toast('Plus de défi proposé. Pour en retrouver : Dépôt, objectif et rythme, réglages avancés.', '', {
    undo: true, action: { label: 'Annuler', fn: () => { state.defis.off = false; saveDebounced(); renderDefi(); } },
  });
}

function deleteNote(k, i) {
  const arr = state.journal[k];
  if (!arr || !arr[i]) return;
  const snap = snapshotState();
  const copy = arr.map(e => ({ ...e }));
  const wasKind = copy[i].k;
  if (copy[i].p) { copy[i].n = ''; copy[i].m = 0; delete copy[i].k; }
  else copy.splice(i, 1);
  state.journal[k] = copy;
  saveNow();
  renderJournal();
  renderToday(_lastForecast || forecast(state, totals(), todayKey()));
  toast(wasKind === 'joker' ? 'Joker repris.' : wasKind ? 'Journée retirée du journal.' : 'Note supprimée (les pages restent comptées).', '',
    { undo: true, action: { label: 'Annuler', fn: () => restoreSnapshot(snap, 'Note rétablie.') } });
}

/* ============================================================
   LE PLAN — chapitres et sous-sections
   Tout se fait sur place : titres modifiables, ajout par une
   simple ligne de saisie, suppression annulable.
============================================================ */
const _addOpen = new Set(); // chapitres sans sous-section dont la ligne d'ajout est ouverte

function toggleChapter(id) {
  const ch = findCh(id);
  if (!ch) return;
  ch.expanded = ch.expanded === false;
  saveDebounced();
  const card = document.getElementById('ch-' + id);
  if (card) card.classList.toggle('expanded', ch.expanded);
}

/** Moyenne des objectifs existants, pour proposer un objectif plausible à une nouvelle partie. */
function avgTarget(list, fallback) {
  const v = list.filter(x => x > 0);
  return v.length ? Math.max(1, Math.round(v.reduce((a, b) => a + b, 0) / v.length)) : fallback;
}

/** Restaure un état antérieur (bouton « Annuler »). */
function restoreSnapshot(snapshot, msg) {
  state = normalizeState(JSON.parse(snapshot));
  syncTitleInput();
  saveNow(true);
  render();
  if (msg) toast(msg, '');
}
const snapshotState = () => JSON.stringify(serializeState());

function addChapterInline() {
  if (!requireReady()) return;
  const input = document.getElementById('addChapterInput');
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  state.chapters.push({
    id: uid(), title: title.slice(0, 300), expanded: true,
    targetPages: avgTarget(state.chapters.map(c => chapterStats(c).tP), 20),
    writtenPages: 0, subsections: [],
  });
  input.value = '';
  saveNow();
  render();
  document.getElementById('addChapterInput').focus();
}

/** Coller plusieurs lignes dans « Ajouter un chapitre » crée tout le plan d'un coup. */
/** Un plan tient en quelques mots par ligne ; plusieurs centaines de mots en paragraphes, c'est un document. */
function looksLikeDocument(text) {
  const counts = String(text).split(/\r?\n/).filter(l => l.trim()).map(l => l.trim().split(/\s+/).length);
  const total = counts.reduce((a, b) => a + b, 0);
  return total >= 300 && (total / Math.max(1, counts.length) > 12 || Math.max(...counts) > 60);
}

/** Collage dans le champ « ajouter un chapitre » ou dans la zone de saisie du plan (inText). */
function handlePlanPaste(e, inText) {
  const text = e.clipboardData ? e.clipboardData.getData('text') : '';
  if (text && looksLikeDocument(text)) {
    // C'est le document lui-même qui a été collé : on le lit comme tel (titres, pages rédigées)
    e.preventDefault();
    importPasted(e.clipboardData.getData('text/html'), text);
    return;
  }
  if (inText) return; // dans la zone de saisie du plan, un collage ordinaire
  if (!text || !/\n/.test(text.trim())) return; // une seule ligne : collage normal
  const plan = parsePlanText(text);
  if (plan.length < 2 && !(plan[0] && plan[0].subs.length)) return;
  e.preventDefault();
  if (!requireReady()) return;
  const snap = snapshotState();
  state.chapters.push(...planToChapters(plan, 0));
  saveNow();
  render();
  const n = plan.length;
  toast(`${n} chapitre${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''}`, 'success',
    { undo: true, action: { label: 'Annuler', fn: () => restoreSnapshot(snap, 'Ajout annulé') } });
}

/** Plan saisi → chapitres. Les objectifs manquants sont répartis sur l'objectif total. */
function planToChapters(plan, total) {
  const free = [];
  let fixed = 0;
  const chapters = plan.map(c => {
    const ch = { id: uid(), title: c.title, expanded: true, targetPages: 0, writtenPages: 0, subsections: [] };
    if (c.subs.length) {
      ch.subsections = c.subs.map(s => ({ id: uid(), title: s.title, targetPages: s.target || 0, writtenPages: 0 }));
      const given = ch.subsections.reduce((a, s) => a + s.targetPages, 0);
      const open = ch.subsections.filter(s => !s.targetPages);
      if (c.target > given && open.length) {
        // Objectif donné pour le chapitre : réparti entre ses sous-parties
        distribute(c.target - given, open.map(() => 1)).forEach((v, i) => { open[i].targetPages = Math.max(1, v); });
      }
      for (const s of ch.subsections) {
        if (s.targetPages) fixed += s.targetPages;
        else { s.autoT = true; free.push({ node: s, fallback: 10 }); }
      }
    } else if (c.target) { ch.targetPages = c.target; fixed += c.target; }
    else free.push({ node: ch, fallback: 20 });
    return ch;
  });
  if (free.length) {
    const pool = total > fixed ? total - fixed : 0;
    const shares = pool ? distribute(pool, free.map(() => 1)) : null;
    free.forEach((f, i) => { f.node.targetPages = Math.max(1, shares ? shares[i] : f.fallback); });
  }
  return chapters;
}

function togglePlanTyping() {
  const box = document.getElementById('obType');
  if (!box) return;
  box.classList.toggle('hidden');
  if (!box.classList.contains('hidden')) document.getElementById('planText').focus();
}

function createPlanFromText() {
  if (!requireReady()) return;
  const raw = document.getElementById('planText').value;
  if (looksLikeDocument(raw)) { importPasted('', raw); return; }
  const plan = parsePlanText(raw);
  if (!plan.length) { toast('Écrivez au moins un chapitre (une ligne par chapitre)', 'warn'); return; }
  const total = parseInt(document.getElementById('planTotal').value, 10) || 0;
  state.chapters = planToChapters(plan, total);
  startSetup();
  saveNow();
  render();
  toast(`Plan créé : ${plan.length} chapitre${plan.length > 1 ? 's' : ''}. Ajustez les objectifs si besoin.`, 'success');
}

function deleteChapter(id) {
  const ch = findCh(id);
  if (!ch) return;
  const snap = snapshotState();
  state.chapters = state.chapters.filter(c => c.id !== id);
  _addOpen.delete(id);
  saveNow();
  render();
  toast(`« ${trunc(ch.title, 30)} » supprimé`, '',
    { undo: true, action: { label: 'Annuler', fn: () => restoreSnapshot(snap, 'Chapitre rétabli') } });
}

function updateChTitle(id, val) {
  const ch = findCh(id);
  if (ch && val.trim() && val.trim() !== ch.title) { ch.title = val.trim().slice(0, 300); saveNow(); renderPrimary(); }
}

/* ============================================================
   MENU D'UN CHAPITRE (⋯) — statut de relecture, sous-sections,
   suppression. Garde la ligne du chapitre légère.
============================================================ */
let _menuChId = null;

function openChapterMenu(id) {
  const ch = findCh(id);
  if (!ch) return;
  _menuChId = id;
  setText('cmTitle', ch.title);
  const due = _lastForecast ? currentSchedule(_lastForecast)[id] : null;
  setText('cmDue', due ? `À boucler pour le ${formatDateFr(due)} si vous voulez tenir votre dépôt.` : '');
  document.querySelectorAll('#chapterMenuModal [data-review]').forEach(b => {
    b.classList.toggle('on', b.dataset.review === ch.review);
  });
  document.getElementById('cmClear').classList.toggle('hidden', !ch.review);
  document.getElementById('cmRemind').classList.toggle('hidden', ch.review !== 'sent');
  document.getElementById('cmAddSs').classList.toggle('hidden', ch.subsections.length > 0);
  openModal('chapterMenuModal');
}

function chapterMenuDo(action) {
  const id = _menuChId;
  closeModal('chapterMenuModal');
  if (!id || !findCh(id)) return;
  if (action === 'delete') deleteChapter(id);
  else if (action === 'remind') remindSupervisor(id);
  else if (action === 'addss') {
    _addOpen.add(id);
    render();
    const input = document.querySelector(`#ch-${id} .add-row.sub .add-input`);
    if (input) input.focus();
  } else setChapterReview(id, action === 'clear' ? '' : action);
}

function setChapterReview(id, val) {
  const ch = findCh(id);
  if (!ch) return;
  if (!REVIEW_LABELS[val]) {
    delete ch.review;
    delete ch.reviewDate;
  } else {
    if (ch.review !== val) ch.reviewDate = todayKey();
    ch.review = val;
  }
  saveNow();
  _refreshChCard(ch);
  updateDashboard();
  if (val === 'ok') toast('Chapitre validé. Encadrez ce moment.', 'success');
  else if (val === 'sent') toast('Chapitre envoyé. Le compteur d\'attente est lancé.', '');
  else if (val === 'revise') toast('Retours reçus. « À retravailler » veut dire que vous êtes sur la bonne voie.', '');
}

function remindSupervisor(id) {
  const ch = findCh(id);
  if (!ch) return;
  const when = ch.reviewDate ? `le ${formatDateFr(ch.reviewDate)}` : 'récemment';
  const subject = `Retour sur le chapitre « ${ch.title} »`;
  const body = `Bonjour,\n\n`
    + `Je me permets de revenir vers vous au sujet du chapitre « ${ch.title} » que je vous ai transmis ${when}. `
    + `Auriez-vous eu l'occasion d'en prendre connaissance ?\n\n`
    + `Vos retours me seraient très utiles pour avancer sereinement sur la suite. `
    + `Si un échange de vive voix vous convient mieux, je m'adapte volontiers à vos disponibilités.\n\n`
    + `Bien cordialement,\n`;
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/* ============================================================
   SOUS-SECTIONS
============================================================ */
function addSsInline(chId, input) {
  if (!requireReady() || !input) return;
  const ch = findCh(chId);
  if (!ch) return;
  const title = input.value.trim();
  if (!title) { input.focus(); return; }
  const first = ch.subsections.length === 0;
  const ss = { id: uid(), title: title.slice(0, 300), targetPages: 0, writtenPages: 0, autoT: true };
  if (first) ss.writtenPages = ch.writtenPages || 0; // elle reprend les pages déjà notées sur le chapitre
  ch.subsections.push(ss);
  // Tant qu'aucun objectif n'a été retouché, l'objectif du chapitre est partagé à parts égales
  if (ch.subsections.every(s => s.autoT)) {
    const budget = ch.targetPages > 0 ? ch.targetPages : 10 * ch.subsections.length;
    distribute(budget, ch.subsections.map(() => 1))
      .forEach((v, i) => { ch.subsections[i].targetPages = Math.max(1, v, ch.subsections[i].writtenPages); });
  } else {
    ss.targetPages = avgTarget(ch.subsections.slice(0, -1).map(s => s.targetPages), 10);
  }
  ch.expanded = true;
  _addOpen.delete(chId);
  saveNow();
  render();
  const next = document.querySelector(`#ch-${chId} .add-row.sub .add-input`);
  if (next) next.focus();
}

function deleteSs(chId, ssId) {
  const ch = findCh(chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (!ss) return;
  const snap = snapshotState();
  ch.subsections = ch.subsections.filter(s => s.id !== ssId);
  if (!ch.subsections.length) {
    // Dernière sous-section retirée : le chapitre redevient une seule partie et garde ses chiffres
    ch.writtenPages = ss.writtenPages || 0;
    ch.targetPages = Math.max(ch.targetPages || 0, ss.targetPages || 0);
  }
  saveNow();
  render();
  toast(`« ${trunc(ss.title, 30)} » supprimé`, '',
    { undo: true, action: { label: 'Annuler', fn: () => restoreSnapshot(snap, 'Sous-section rétablie') } });
}

function updateSsTitle(chId, ssId, val) {
  const ch = findCh(chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (ss && val.trim() && val.trim() !== ss.title) { ss.title = val.trim().slice(0, 300); saveNow(); renderPrimary(); }
}

/* ============================================================
   PAGES — trois façons de les noter, du plus rapide au plus précis :
   « +1 page » (partie en cours), boutons − / + d'une partie,
   ou saisie du total. Chaque variation alimente le journal du jour.
============================================================ */
function _findSs(chId, ssId) {
  const ch = findCh(chId);
  if (!ch) return null;
  const ss = ch.subsections.find(s => s.id === ssId);
  return ss ? { ch, ss } : null;
}

/** Applique une variation de pages à une partie et met à jour l'écran sans tout redessiner. */
function applyDelta(leaf, delta, count) {
  const obj  = leaf.ss || leaf.ch;
  const old  = obj.writtenPages || 0;
  const next = Math.max(0, old + delta);
  if (next === old) return 0;
  obj.writtenPages = next;
  if (count) addActivity(next - old);
  setCurrentLeaf(leaf.id);
  const input = document.getElementById('win-' + leaf.id);
  if (input && document.activeElement !== input) input.value = next;
  if (leaf.ss) _refreshSsBar(leaf.ss);
  _refreshChCard(leaf.ch);
  saveDebounced();
  updateDashboard();
  if (count) checkDailyGoal();
  return next - old;
}

/** Boutons − / + d'une partie du plan. */
function stepPages(leafId, delta) {
  if (!requireReady()) return;
  const leaf = leafSections().find(l => l.id === leafId);
  if (leaf) applyDelta(leaf, delta, !inSetup());
}

/** « +1 page » : un geste, sur la partie en cours. */
function quickAdd(delta = 1) {
  if (!requireReady()) return;
  const leaf = currentLeaf();
  if (!leaf) { toast('Créez d\'abord votre plan.', 'warn'); return; }
  const d = applyDelta(leaf, delta, true);
  if (!d) return;
  const day = pagesOn(state.activity, todayKey());
  const leafId = leaf.id;
  toast(`${d > 0 ? '+' : '−'}${Math.abs(d)} page · ${trunc(leafTitle(leaf), 28)} (aujourd'hui : ${fmt1(day)} p.)`, 'success', {
    key: 'quick',
    action: d > 0 ? { label: 'Annuler', fn: () => {
      const l = leafSections().find(x => x.id === leafId);
      if (l && applyDelta(l, -d, true)) toast('Page retirée.', '', { key: 'quick' });
    } } : null,
  });
}

function updateWritten(chId, ssId, rawVal) {
  const found = _findSs(chId, ssId);
  if (!found) return;
  const old = found.ss.writtenPages || 0;
  found.ss.writtenPages = Math.max(0, parseInt(rawVal, 10) || 0);
  const count = !inSetup();
  if (count) addActivity(found.ss.writtenPages - old);
  setCurrentLeaf(ssId);
  _refreshSsBar(found.ss);
  _refreshChCard(found.ch);
  saveDebounced(); // debounced — user may still be typing
  updateDashboard();
  if (count) checkDailyGoal();
}

function updateTarget(chId, ssId, rawVal) {
  const found = _findSs(chId, ssId);
  if (!found) return;
  found.ss.targetPages = Math.max(1, parseInt(rawVal, 10) || 1);
  delete found.ss.autoT; // objectif choisi : il ne sera plus réparti automatiquement
  _refreshSsBar(found.ss);
  _refreshChCard(found.ch);
  saveDebounced();
  updateDashboard();
}

function updateChWritten(chId, rawVal) {
  const ch = findCh(chId);
  if (!ch || ch.subsections.length > 0) return;
  const old = ch.writtenPages || 0;
  ch.writtenPages = Math.max(0, parseInt(rawVal, 10) || 0);
  const count = !inSetup();
  if (count) addActivity(ch.writtenPages - old);
  setCurrentLeaf(chId);
  _refreshChCard(ch);
  saveDebounced();
  updateDashboard();
  if (count) checkDailyGoal();
}

function updateChTarget(chId, rawVal) {
  const ch = findCh(chId);
  if (!ch || ch.subsections.length > 0) return;
  ch.targetPages = Math.max(1, parseInt(rawVal, 10) || 1);
  _refreshChCard(ch);
  saveDebounced();
  updateDashboard();
}

function _refreshSsBar(ss) {
  const prog   = ssProgress(ss);
  const isDone = prog >= 100;
  const bar  = document.getElementById('bar-' + ss.id);
  const pct  = document.getElementById('pct-' + ss.id);
  const ssEl = document.getElementById('ss-'  + ss.id);
  if (bar)  { bar.style.width = prog + '%'; bar.classList.toggle('done', isDone); }
  if (pct)  { pct.textContent = prog + '\u00A0%'; pct.classList.toggle('done', isDone); }
  if (ssEl) ssEl.classList.toggle('completed', isDone);
}

function _refreshChCard(ch) {
  const { tP, wP, prog } = chapterStats(ch);
  const isDone = prog >= 100;
  const card   = document.getElementById('ch-' + ch.id);
  if (!card) return;
  card.classList.toggle('completed', isDone);
  const fill = card.querySelector('.ch-progress-fill');
  if (fill) { fill.style.width = prog + '%'; fill.classList.toggle('done', isDone); }
  const txt = card.querySelector('.ch-pages-txt');
  if (txt) txt.textContent = `${wP} / ${tP} p.`;
  const pct = card.querySelector('.ch-pct');
  if (pct) { pct.textContent = prog + '\u00A0%'; pct.classList.toggle('done', isDone); }
  const slot = document.getElementById('bd-' + ch.id);
  if (slot) slot.innerHTML = badgeHTML(ch);
}

/* ============================================================
   MODAL HELPERS
============================================================ */
const _modalReturn = {}; // l'élément qui avait le focus avant l'ouverture de chaque fenêtre

/** Ouvre une fenêtre : le clavier (et les lecteurs d'écran) y entrent aussitôt. */
function openModal(id) {
  const m = document.getElementById(id);
  if (m.classList.contains('hidden')) _modalReturn[id] = document.activeElement;
  m.classList.remove('hidden');
  const box = m.querySelector('.modal');
  if (!box) return;
  // Toute fenêtre a sa croix, en haut à droite
  if (!box.querySelector(':scope > .modal-x')) {
    box.insertAdjacentHTML('afterbegin', `<button type="button" class="modal-x" aria-label="Fermer" onclick="closeModal('${id}')">${icon('x')}</button>`);
  }
  box.setAttribute('tabindex', '-1');
  box.focus({ preventScroll: true });
}

/** Ferme une fenêtre et rend le focus à l'endroit d'où l'on venait. */
function closeModal(id) {
  const m = document.getElementById(id);
  if (!m || m.classList.contains('hidden')) return;
  m.classList.add('hidden');
  // Fermée d'un clic à côté ou avec Échap, l'annonce de mise à jour est lue quand même
  if (id === 'whatsNewModal') lsSet(WHATSNEW_KEY, WHATSNEW_VER);
  if (id === 'docxModal') setTimeout(nextQueued, 600);     // d'autres fichiers déposés en même temps attendent leur tour
  const back = _modalReturn[id];
  delete _modalReturn[id];
  if (back && back !== document.body && document.contains(back) && typeof back.focus === 'function') back.focus({ preventScroll: true });
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    // Tab reste dans la fenêtre ouverte, au lieu de se promener dans la page derrière
    const open = [...document.querySelectorAll('.modal-overlay:not(.hidden)')].pop();
    if (!open) return;
    const items = [...open.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const inside = open.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === open.querySelector('.modal'))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    return;
  }
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  if (document.getElementById('mobileMenu').classList.contains('open')) toggleMobileMenu();
});

/* ============================================================
   MON PROJET — l'essentiel (nom, dépôt, objectif total),
   le reste dans « Réglages avancés ».
============================================================ */
function renderDayChips(containerId, selected) {
  const el = document.getElementById(containerId);
  el.innerHTML = WD_ORDER.map(d =>
    `<button type="button" class="day-chip${selected.includes(d) ? ' on' : ''}" data-day="${d}"
             aria-pressed="${selected.includes(d)}" title="${WD_NAMES[d]}"
             onclick="this.classList.toggle('on');this.setAttribute('aria-pressed',this.classList.contains('on'))">${WD_LETTERS[d]}</button>`
  ).join('');
}

function readDayChips(containerId) {
  return [...document.querySelectorAll(`#${containerId} .day-chip.on`)].map(b => Number(b.dataset.day));
}

function openProjectModal(mode) {
  if (!requireReady()) return;
  document.getElementById('pmName').value = state.documentTitle || '';
  // Dépôt : une date précise, ou seulement le mois visé
  const now = new Date();
  const ref = state.deadline ? parseDay(state.deadline) : new Date(now.getFullYear() + 1, now.getMonth(), 1);
  document.getElementById('pmDeadline').value = state.deadline && !state.deadlineMonth ? state.deadline : '';
  document.getElementById('pmDlMonth').innerHTML = MONTHS_LONG.map((n, i) => `<option value="${i}"${i === ref.getMonth() ? ' selected' : ''}>${n}</option>`).join('');
  const years = [];
  for (let y = Math.min(now.getFullYear(), ref.getFullYear()); y <= Math.max(now.getFullYear() + 8, ref.getFullYear()); y++) years.push(y);
  document.getElementById('pmDlYear').innerHTML = years.map(y => `<option value="${y}"${y === ref.getFullYear() ? ' selected' : ''}>${y}</option>`).join('');
  setDeadlineMode(mode === 'month' || (mode !== 'date' && state.deadline && state.deadlineMonth) ? 'month' : 'date');
  const total = totalPages();
  document.getElementById('pmTotalRow').classList.toggle('hidden', leafSections().length === 0);
  document.getElementById('pmTotal').value = total || '';
  document.getElementById('pmStart').value = state.startDate || '';
  document.getElementById('pmMargin').value = String(state.marginDays);
  if (!document.getElementById('pmMargin').value) document.getElementById('pmMargin').value = '21';
  document.getElementById('pmGoal').value = state.dailyGoal || '';
  document.getElementById('pmIntroLast').checked = state.introLast !== false;
  document.getElementById('pmDefi').checked = !state.defis.off;
  _pmPauses = state.pauses.map(p => ({ ...p }));
  document.getElementById('pmPauseKind').innerHTML = Object.entries(PAUSE_KINDS).map(([k, label]) => `<option value="${k}">${esc(label)}</option>`).join('');
  document.getElementById('pmPauseFrom').value = '';
  document.getElementById('pmPauseTo').value = '';
  renderPauses();
  document.getElementById('pmAdv').open = false;
  renderDayChips('pmDays', state.writingDays);
  const fc = _lastForecast;
  setText('pmGoalHint', fc && fc.goalIsAuto && state.deadline
    ? `Vide = automatique (actuellement ${fmt1(fc.dailyGoal)} p. par jour d'écriture).`
    : 'Vide = automatique, calculé d\'après votre date de dépôt.');
  openModal('projectModal');
}

/* Périodes hors rédaction : on travaille sur une copie, enregistrée avec le reste du projet. */
let _pmPauses = [];

function renderPauses() {
  const today = todayKey();
  setHTML('pmPauses', _pmPauses.map((p, i) => {
    const days = diffDays(p.from, p.to) + 1;
    return `<div class="pause-item${p.to < today ? ' past' : ''}"><span class="chip">${esc(PAUSE_KINDS[p.kind] || PAUSE_KINDS.autre)}</span>
      <span class="pause-dates">du ${fmtDateShort(p.from)} au ${fmtDateShort(p.to)} <small>(${days} jour${days > 1 ? 's' : ''})</small></span>
      <button type="button" class="je-del" onclick="removePause(${i})" title="Retirer cette période" aria-label="Retirer cette période">${icon('x')}</button></div>`;
  }).join(''));
}

function addPause() {
  const from = document.getElementById('pmPauseFrom').value;
  const to = document.getElementById('pmPauseTo').value || from;
  const kind = document.getElementById('pmPauseKind').value;
  if (!isDayKey(from) || !isDayKey(to)) { toast('Indiquez le début (et la fin) de la période', 'warn'); return; }
  if (to < from) { toast('La fin de la période vient avant son début', 'warn'); return; }
  if (diffDays(from, to) > 730) { toast('Période trop longue', 'warn'); return; }
  if (_pmPauses.length >= 40) { toast('Trop de périodes : retirez les plus anciennes', 'warn'); return; }
  _pmPauses.push({ from, to, kind: isPauseKind(kind) ? kind : 'autre' });
  _pmPauses.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  document.getElementById('pmPauseFrom').value = '';
  document.getElementById('pmPauseTo').value = '';
  renderPauses();
}

function removePause(i) {
  _pmPauses.splice(i, 1);
  renderPauses();
}

/** Dépôt : « date précise » ou « période visée » (un mois). */
function setDeadlineMode(mode) {
  const month = mode === 'month';
  document.querySelectorAll('#pmDlSeg .seg-btn').forEach(b => {
    b.classList.toggle('active', (b.dataset.mode === 'month') === month);
    b.setAttribute('aria-pressed', String((b.dataset.mode === 'month') === month));
  });
  document.getElementById('pmDeadline').classList.toggle('hidden', month);
  document.getElementById('pmDlMonthRow').classList.toggle('hidden', !month);
  setText('pmDlHint', month
    ? 'Le Journal compte jusqu\'à la fin de ce mois. Vous préciserez la date quand vous la connaîtrez.'
    : 'Pas encore de date officielle ? Choisissez « Période visée ».');
}

/** Change l'objectif total en gardant les proportions entre les parties. */
function rescaleTargets(total) {
  const leaves = leafSections();
  if (!leaves.length || !(total > 0)) return;
  const weights = leaves.map(l => (l.ss ? l.ss.targetPages : l.ch.targetPages) || 0);
  const even = weights.every(w => w === 0);
  distribute(total, even ? leaves.map(() => 1) : weights).forEach((v, i) => {
    const obj = leaves[i].ss || leaves[i].ch;
    obj.targetPages = Math.max(1, v);
  });
}

function saveProject() {
  const name     = document.getElementById('pmName').value.trim();
  const start    = document.getElementById('pmStart').value;
  const byMonth  = !document.getElementById('pmDlMonthRow').classList.contains('hidden');
  const deadline = byMonth
    ? monthEnd(parseInt(document.getElementById('pmDlYear').value, 10), parseInt(document.getElementById('pmDlMonth').value, 10))
    : document.getElementById('pmDeadline').value;
  const margin   = parseInt(document.getElementById('pmMargin').value, 10);
  const goalRaw  = document.getElementById('pmGoal').value.trim();
  const totalRaw = document.getElementById('pmTotal').value.trim();
  const days     = readDayChips('pmDays');
  if (start && !isDayKey(start)) { toast('Date de début invalide', 'warn'); return; }
  if (deadline && !isDayKey(deadline)) { toast('Date de dépôt invalide', 'warn'); return; }
  if (deadline && start && deadline <= start) { toast('Le dépôt doit venir après le début de la rédaction', 'warn'); return; }
  if (!days.length) { toast('Choisissez au moins un jour d\'écriture', 'warn'); return; }
  const goal = goalRaw ? Number(goalRaw.replace(',', '.')) : null;
  if (goalRaw && !(goal > 0)) { toast('Objectif quotidien invalide', 'warn'); return; }
  const total = totalRaw ? parseInt(totalRaw, 10) : 0;
  if (totalRaw && !(total > 0)) { toast('Objectif total invalide', 'warn'); return; }
  state.documentTitle = name.slice(0, 200);
  state.startDate  = start || null;
  state.deadline   = deadline || null;
  state.deadlineMonth = byMonth && !!deadline;
  state.marginDays = Number.isFinite(margin) ? clamp(margin, 0, 180) : 21;
  state.dailyGoal  = goal ? Math.min(50, goal) : null;
  state.writingDays = days;
  state.introLast  = document.getElementById('pmIntroLast').checked;
  state.defis.off  = !document.getElementById('pmDefi').checked;
  // Une période saisie mais pas encore « ajoutée » : on la prend quand même
  if (isDayKey(document.getElementById('pmPauseFrom').value)) addPause();
  state.pauses = _pmPauses.map(p => ({ ...p }));
  if (total > 0 && total !== totalPages()) rescaleTargets(total);
  const dl = document.getElementById('dbDeadline');
  if (dl) dl.dataset.mode = ''; // la ligne « dépôt » du tableau de bord sera redessinée
  saveNow();
  closeModal('projectModal');
  syncTitleInput();
  render();
  toast('Projet mis à jour.', 'success');
  if (deadline && deadline < todayKey()) toast(byMonth ? 'Ce mois est déjà passé.' : 'Cette date de dépôt est déjà passée.', 'warn');
}

/* ============================================================
   « J'AI ÉCRIT » — la version détaillée de « +1 page » :
   autre partie, autre quantité, hier, ou une note pour le journal.
============================================================ */
let _logDay = 0; // 0 = aujourd'hui, -1 = hier
let _logMode = 'write'; // 'write' : des pages ; 'other' : une journée de thèse sans pages (terrain, lectures, colloque…)
let _logKind = '';

/** mode : 'other' pour ouvrir directement sur « Autre travail de thèse ». */
function openLogModal(mode) {
  if (!requireReady()) return;
  const leaves = leafSections();
  if (leaves.length) {
    const chosen = currentLeaf().id;
    document.getElementById('logSection').innerHTML = leaves
      .map(l => `<option value="${l.id}"${l.id === chosen ? ' selected' : ''}>${esc(trunc(l.label, 70))}</option>`).join('');
  }
  document.getElementById('logPages').value = 1;
  document.getElementById('logNote').value = '';
  document.getElementById('logShare').checked = false;
  _logKind = '';
  setHTML('logKinds', Object.entries(ENTRY_KINDS).filter(([k]) => k !== 'joker')
    .map(([k, label]) => `<button type="button" class="kind-chip" role="radio" aria-checked="false" data-kind="${k}" onclick="setLogKind('${k}')">${esc(label)}</button>`).join(''));
  // Sans plan, on ne peut pas encore noter de pages, mais une journée de terrain ou de lectures, si
  const writeTab = document.querySelector('#logModeSeg [data-mode="write"]');
  writeTab.disabled = leaves.length === 0;
  writeTab.title = leaves.length ? '' : 'Créez d\'abord votre plan pour y noter vos pages';
  setLogDay(0);
  setLogMode(mode === 'other' || !leaves.length ? 'other' : 'write');
  openModal('logModal');
}

function setLogMode(mode) {
  _logMode = mode === 'other' ? 'other' : 'write';
  document.querySelectorAll('#logModeSeg .seg-btn').forEach(b => {
    const on = b.dataset.mode === _logMode;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  document.getElementById('logWrite').classList.toggle('hidden', _logMode !== 'write');
  document.getElementById('logOther').classList.toggle('hidden', _logMode !== 'other');
  setText('logTitle', _logMode === 'write' ? 'J\'ai écrit' : 'Ma journée de thèse');
  setText('logNoteLbl', _logMode === 'write' ? 'Une note pour mon journal' : 'Un mot sur cette journée');
  updateJokerRow();
}

function setLogKind(kind) {
  _logKind = entryKind({ k: kind }) && kind !== 'joker' ? kind : '';
  document.querySelectorAll('#logKinds .kind-chip').forEach(b => {
    const on = b.dataset.kind === _logKind;
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
  });
}

function setLogDay(offset) {
  _logDay = offset;
  document.querySelectorAll('#logDaySeg .seg-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.day) === offset));
  updateJokerRow();
}

const logDayKey = () => (_logDay === -1 ? addDays(todayKey(), -1) : todayKey());

/** Le joker : une journée qu'on s'accorde. Il ne prolonge pas la série, il l'empêche de tomber. */
function updateJokerRow() {
  const row = document.getElementById('logJokerRow');
  if (!row) return;
  const day = logDayKey();
  row.classList.toggle('hidden', _logMode !== 'other');
  const used = jokersInWeek(state.journal, day);
  const taken = hasJoker(state.journal, day);
  const busy = isActiveDay(state, day);
  const btn = document.getElementById('logJokerBtn');
  btn.disabled = taken || busy || used >= JOKERS_PER_WEEK;
  setText('logJokerHint', taken ? 'Joker déjà posé ce jour-là.'
    : busy ? 'Vous avez travaillé ce jour-là : pas besoin de joker.'
    : used >= JOKERS_PER_WEEK ? 'Joker de la semaine déjà utilisé. Le prochain revient lundi.'
    : 'Une journée pour souffler, sans casser votre série. Un par semaine.');
}

function useJoker() {
  if (!requireReady()) return;
  const day = logDayKey();
  if (hasJoker(state.journal, day) || isActiveDay(state, day) || jokersInWeek(state.journal, day) >= JOKERS_PER_WEEK) return;
  const snap = snapshotState();
  state.journal[day] = [...(state.journal[day] || []), { p: 0, s: kindTag('joker'), n: '', m: 0, t: nowHHMM(), k: 'joker' }];
  if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
  saveNow();
  closeModal('logModal');
  render();
  toast('Joker posé : journée off, votre série est préservée.', 'success',
    { undo: true, action: { label: 'Annuler', fn: () => restoreSnapshot(snap, 'Joker repris.') } });
}

function stepLog(d) {
  const el = document.getElementById('logPages');
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) + d);
}

function nowHHMM() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function saveLog() {
  const note  = document.getElementById('logNote').value.trim().slice(0, 240);
  const shareIt = document.getElementById('logShare').checked && promo.isMember();
  const day = logDayKey();
  if (_logMode === 'other') {
    // Une journée de thèse sans pages : elle compte dans le journal et dans la série
    if (!_logKind) { toast('Choisissez ce que vous avez fait', 'warn'); return; }
    state.journal[day] = [...(state.journal[day] || []), { p: 0, s: kindTag(_logKind), n: note, m: 0, t: nowHHMM(), k: _logKind }];
    if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
    saveNow();
    closeModal('logModal');
    render();
    if (shareIt && note) promo.addNote(note, 0);
    const s = streak(state, todayKey());
    toast(`${ENTRY_KINDS[_logKind]} : noté dans votre journal${s.count > 1 ? ` · série de ${s.count} jours` : ''}`, 'success');
    checkDailyGoal();
    return;
  }
  const pages = Math.max(0, parseInt(document.getElementById('logPages').value, 10) || 0);
  const leafId = document.getElementById('logSection').value;
  const leaf  = leafSections().find(l => l.id === leafId);
  if (!pages && !note) { toast('Indiquez des pages ou une petite note', 'warn'); return; }
  if (pages && !leaf) { toast('Choisissez une partie', 'warn'); return; }
  if (pages) {
    if (leaf.ss) leaf.ss.writtenPages = (leaf.ss.writtenPages || 0) + pages;
    else leaf.ch.writtenPages = (leaf.ch.writtenPages || 0) + pages;
    addActivity(pages, day);
  }
  state.journal[day] = [...(state.journal[day] || []), { p: pages, s: leaf ? leaf.id : null, n: note, m: 0, t: nowHHMM() }];
  if (leaf) lsSet(curKey(), leaf.id);
  if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
  saveNow();
  closeModal('logModal');
  render();
  if (shareIt && note) promo.addNote(note, pages);
  const s = streak(state, todayKey());
  toast(pages
    ? `+${pages} page${pages > 1 ? 's' : ''} notée${pages > 1 ? 's' : ''}${s.count > 1 ? ` · série de ${s.count} jours` : ''}`
    : (shareIt ? 'Note ajoutée au journal et partagée avec la promo.' : 'Note ajoutée au journal.'), 'success');
  checkDailyGoal();
}

/* ============================================================
   AGENDA — planifier ses séances d'écriture
   Les créneaux (jours, heure, durée, éventuellement un horaire par
   jour) sont gardés dans le compte : le tableau de bord annonce la
   prochaine séance. On les envoie dans l'agenda de son choix :
   Google Agenda (un lien prérempli par événement) ou un fichier
   .ics (Apple, Outlook…). S'y ajoutent, au choix, le bilan de la
   semaine, un rappel pour la direction, le dépôt et les échéances.
============================================================ */
const DURATIONS = [30, 45, 60, 90, 120, 180, 240];
const fmtDuration = m => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}` : `${m} min`);
const fmtHour = t => { const [h, mi] = t.split(':').map(Number); return `${h} h${mi ? ' ' + String(mi).padStart(2, '0') : ''}`; };
let _calSlots = {};   // horaire de chaque jour pendant la saisie : { jour: ['HH:MM', minutes] }
let _calSame = true;

/** Créneau d'un jour d'écriture : le sien s'il en a un, sinon l'horaire commun. */
function slotOf(day, st = state) {
  const own = st.slots.find(x => x[0] === day);
  return own ? [own[1], own[2]] : [st.sessionTime, st.sessionMinutes];
}

/** Prochaine séance prévue (aujourd'hui si elle n'est pas finie) : { day, time, minutes } ou null. */
function nextSession(now = new Date()) {
  const today = dayKey(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  for (let i = 0; i < 60; i++) {
    const k = addDays(today, i);
    if (!state.writingDays.includes(weekday(k)) || pauseOn(state.pauses, k)) continue;
    const [time, minutes] = slotOf(weekday(k));
    const [h, mi] = time.split(':').map(Number);
    if (i === 0 && mins > h * 60 + mi + minutes) continue; // la séance du jour est passée
    return { day: k, time, minutes };
  }
  return null;
}

function openCalendarModal() {
  if (!requireReady()) return;
  renderDayChips('calDays', state.writingDays);
  _calSlots = {};
  for (let d = 0; d < 7; d++) _calSlots[d] = slotOf(d);
  _calSame = state.slots.length === 0;
  document.getElementById('calSame').checked = _calSame;
  document.getElementById('calAlarm').value = String(state.alarmMin);
  if (!document.getElementById('calAlarm').value) document.getElementById('calAlarm').value = '10';
  const hasDl = !!state.deadline;
  ['calIncDeadline', 'calIncEnd', 'calIncChapters'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = hasDl;
    el.disabled = !hasDl;
  });
  setText('calDlLbl', state.deadlineMonth
    ? `Période visée pour le dépôt : ${hasDl ? fmtMonthYear(state.deadline) : ''} (tout le mois, rappel une semaine avant)`
    : 'Date de dépôt (rappels une semaine et un jour avant)');
  // Qui met son suivi à jour en déposant son document y gagne un rappel ; les autres, un moment pour faire le point
  const deposits = hasDocFiles() && !hasAutoDocs();
  document.getElementById('calIncSync').checked = deposits;
  setText('calSyncLbl', deposits
    ? 'Point d\'étape chaque semaine : un rappel pour déposer mon document, le Journal calcule mon avancée'
    : 'Bilan de la semaine : un quart d\'heure après ma dernière séance, pour voir où j\'en suis');
  document.getElementById('calIncMeet').checked = state.meetWeeks > 0;
  document.getElementById('calMeetWeeks').value = String(state.meetWeeks || 4);
  document.getElementById('calNoDeadline').classList.toggle('hidden', hasDl);
  renderCalSlots();
  updateCalendarLinks();
  openModal('calendarModal');
}

/** Les lignes d'horaire : une seule si tous les jours se ressemblent, sinon une par jour d'écriture. */
function renderCalSlots() {
  const days = WD_ORDER.filter(d => readDayChips('calDays').includes(d));
  const durOpts = sel => DURATIONS.map(m => `<option value="${m}"${m === sel ? ' selected' : ''}>${fmtDuration(m)}</option>`).join('');
  const row = (d, label, idT, idD) => {
    const [time, minutes] = _calSlots[d] || [state.sessionTime, state.sessionMinutes];
    return `<div class="cal-slot"><span class="cal-slot-day">${label}</span>
      <label>à <input type="time" class="form-control" ${idT ? `id="${idT}"` : ''} data-day="${d}" data-f="time" value="${time}" onchange="calSlotChanged(this)" aria-label="Heure, ${label}" /></label>
      <label>pendant <select class="form-control" ${idD ? `id="${idD}"` : ''} data-day="${d}" data-f="dur" onchange="calSlotChanged(this)" aria-label="Durée, ${label}">${durOpts(DURATIONS.includes(minutes) ? minutes : 90)}</select></label></div>`;
  };
  setHTML('calSlots', _calSame
    ? row(days.length ? days[0] : 1, 'Chaque séance', 'calTime', 'calDur')
    : days.map(d => row(d, WD_NAMES[d].charAt(0).toUpperCase() + WD_NAMES[d].slice(1), '', '')).join(''));
}

function calSlotChanged(el) {
  const d = Number(el.dataset.day);
  const cur = _calSlots[d] || [state.sessionTime, state.sessionMinutes];
  const next = el.dataset.f === 'time'
    ? [/^\d{2}:\d{2}$/.test(el.value) ? el.value : cur[0], cur[1]]
    : [cur[0], parseInt(el.value, 10) || cur[1]];
  if (_calSame) for (let k = 0; k < 7; k++) _calSlots[k] = next.slice();
  else _calSlots[d] = next;
  updateCalendarLinks();
}

function calSameChanged() {
  _calSame = document.getElementById('calSame').checked;
  if (_calSame) {
    // On revient à un seul horaire : celui du premier jour d'écriture
    const days = WD_ORDER.filter(d => readDayChips('calDays').includes(d));
    const ref = _calSlots[days.length ? days[0] : 1];
    for (let k = 0; k < 7; k++) _calSlots[k] = ref.slice();
  }
  renderCalSlots();
  updateCalendarLinks();
}

function calChanged() {
  renderCalSlots();
  updateCalendarLinks();
}

/** Ce que dit la fenêtre : jours, créneaux regroupés par horaire, rappel, options. */
function calendarInputs() {
  const days = WD_ORDER.filter(d => readDayChips('calDays').includes(d));
  const groups = [];
  for (const d of days) {
    const [time, minutes] = _calSlots[d] || [state.sessionTime, state.sessionMinutes];
    const g = groups.find(x => x.time === time && x.minutes === minutes);
    if (g) g.days.push(d);
    else groups.push({ days: [d], time, minutes });
  }
  const first = groups[0] || { time: state.sessionTime, minutes: state.sessionMinutes };
  const alarm = parseInt(document.getElementById('calAlarm').value, 10);
  const meet = document.getElementById('calIncMeet').checked ? parseInt(document.getElementById('calMeetWeeks').value, 10) || 4 : 0;
  return { days, groups, time: first.time, minutes: first.minutes, alarm: Number.isFinite(alarm) ? alarm : 10, meet };
}

/** Garde les créneaux dans le compte (au premier ajout à l'agenda, ou à la fermeture de la fenêtre). */
function saveCalendarPrefs() {
  const inp = calendarInputs();
  if (!inp.days.length) return false;
  const before = JSON.stringify([state.writingDays, state.sessionTime, state.sessionMinutes, state.slots, state.alarmMin, state.meetWeeks]);
  state.writingDays = inp.days.slice().sort((a, b) => a - b);
  state.sessionTime = inp.time;
  state.sessionMinutes = inp.minutes;
  state.slots = inp.groups.slice(1).flatMap(g => g.days.map(d => [d, g.time, g.minutes]));
  state.alarmMin = inp.alarm;
  state.meetWeeks = inp.meet;
  const changed = before !== JSON.stringify([state.writingDays, state.sessionTime, state.sessionMinutes, state.slots, state.alarmMin, state.meetWeeks]);
  if (changed) {
    saveNow();
    updateDashboard();
    _lastForecast = forecast(state, totals(), todayKey());
    renderToday(_lastForecast);
  }
  return changed;
}

function closeCalendar() {
  if (saveCalendarPrefs()) toast('Créneaux d\'écriture enregistrés.', 'success');
  closeModal('calendarModal');
}

const listDays = ds => { const n = ds.map(d => WD_NAMES[d]); return n.length > 1 ? `${n.slice(0, -1).join(', ')} et ${n[n.length - 1]}` : n[0]; };
const ALARM_TEXT = { 0: 'Sans rappel.', 10: 'Rappel dix minutes avant.', 30: 'Rappel une demi-heure avant.', 60: 'Rappel une heure avant.', 1440: 'Rappel la veille.' };

function updateCalendarLinks() {
  const inp = calendarInputs();
  const list = document.getElementById('calGoogleList');
  if (!inp.days.length) {
    setHTML('calGoogleList', '');
    setText('calSummary', 'Choisissez au moins un jour d\'écriture.');
    return;
  }
  const ev = calendarEvents(inp);
  // En clair : ce que l'agenda va recevoir
  const until = fmtDateShort(ev.until);
  const alarmTxt = ALARM_TEXT[inp.alarm] || '';
  setText('calSummary', typo(inp.groups.length === 1
    ? `Un événement récurrent : chaque ${listDays(inp.days)} à ${fmtHour(inp.time)}, pendant ${fmtDuration(inp.minutes)}, jusqu'au ${until}. ${alarmTxt}`
    : `${inp.groups.length} événements récurrents : ${inp.groups.map(g => `${listDays(g.days)} à ${fmtHour(g.time)} (${fmtDuration(g.minutes)})`).join(' ; ')}, jusqu'au ${until}. ${alarmTxt}`));
  // Google Agenda associe un fuseau à l'événement : la fin de la récurrence doit alors être donnée en temps universel
  const forGoogle = e => (e.rrule ? { ...e, rrule: e.rrule + 'Z' } : e);
  const item = (e, label, id) => `<li><span>${esc(label)}</span><a class="btn btn-neutral btn-sm" ${id ? `id="${id}"` : ''} href="${esc(googleCalendarUrl(forGoogle(e)))}" target="_blank" rel="noopener noreferrer" onclick="calAdded(this)">Ajouter</a></li>`;
  let html = '';
  ev.sessions.forEach((e, i) => {
    const g = inp.groups[i];
    html += item(e, typo(`Séances : ${listDays(g.days)} à ${fmtHour(g.time)}`), i === 0 ? 'calGoogle' : '');
  });
  if (ev.sync) html += item(ev.sync, ev.sync.short, 'calGoogleSync');
  if (ev.meet) html += item(ev.meet, typo(`Mes pages à ma direction, toutes les ${inp.meet} semaines`), 'calGoogleMeet');
  if (ev.deadline && document.getElementById('calIncDeadline').checked) html += item(ev.deadline, state.deadlineMonth ? typo(`Dépôt visé : ${fmtMonthYear(state.deadline)}`) : typo(`Dépôt : ${fmtDateShort(state.deadline)}`), 'calGoogleDeadline');
  if (ev.end && document.getElementById('calIncEnd').checked) html += item(ev.end, typo(`Fin de rédaction visée : ${fmtDateShort(ev.end.date)}`), 'calGoogleEnd');
  const nCh = document.getElementById('calIncChapters').checked ? ev.chapters.length : 0;
  if (nCh) html += `<li class="cal-gnote"><span>${nCh} échéance${nCh > 1 ? 's' : ''} de chapitre : plus simple avec le fichier, à droite.</span></li>`;
  list.innerHTML = html;
}

/** Un événement vient d'être envoyé vers Google Agenda : on le coche, et on retient les créneaux. */
function calAdded(a) {
  a.classList.add('done');
  a.textContent = 'Ajouté';
  saveCalendarPrefs();
}

/** Les événements de l'agenda, décrits une fois pour le fichier .ics comme pour les liens Google. */
function calendarEvents(inp) {
  const today = todayKey();
  const probe = { ...state, writingDays: inp.days };
  const fc = forecast(probe, totals(), today);
  const until = fc.writingEnd && fc.writingEnd > today ? fc.writingEnd : addDays(today, 365);
  const title = state.documentTitle || 'ma thèse';
  const stamp = until.replace(/-/g, '');
  const log = `${APP_URL}?action=log`;
  const alarmOf = text => (inp.alarm > 0 ? [{ trigger: inp.alarm >= 1440 ? '-P1D' : `-PT${inp.alarm}M`, text }] : []);
  const sessions = inp.groups.map((g, i) => ({
    uid: i === 0 ? 'jdb-sessions@lejournaldebord.org' : `jdb-sessions-${i}@lejournaldebord.org`,
    title: `Écriture : ${title}`,
    start: nthWritingDay(today, 1, g.days, state.pauses), time: g.time, minutes: g.minutes,
    rrule: `FREQ=WEEKLY;BYDAY=${byDay(g.days)};UNTIL=${stamp}T235959`,
    description: `Séance d'écriture. Après la séance, notez vos pages en un clic : ${log}`,
    details: `Séance d'écriture. Après la séance, notez vos pages en un clic : ${log}`,
    url: log,
    alarms: alarmOf(inp.alarm >= 1440 ? 'Séance d\'écriture demain' : `Séance d'écriture dans ${inp.alarm} minutes`),
  }));
  // Le dernier jour d'écriture de la semaine, à la fin de sa séance
  const last = inp.days[inp.days.length - 1];
  const lastSlot = inp.groups.find(g => g.days.includes(last)) || { time: inp.time, minutes: inp.minutes };
  const [lh, lm] = lastSlot.time.split(':').map(Number);
  const endMin = Math.min(1425, lh * 60 + lm + lastSlot.minutes);
  const endTime = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
  let sync = null;
  if (document.getElementById('calIncSync').checked) {
    const deposits = hasDocFiles() && !hasAutoDocs();
    const link = deposits ? `${APP_URL}?action=sync` : APP_URL;
    const text = deposits
      ? `Déposez votre document (ou collez votre texte) : le Journal calcule vos pages de la semaine. ${link}`
      : `Un quart d'heure pour regarder votre semaine, relever votre défi et préparer la suivante. ${link}`;
    sync = {
      uid: 'jdb-sync@lejournaldebord.org',
      title: deposits ? 'Point d\'étape : mettre mon Journal de Bord à jour' : 'Bilan de la semaine : mon Journal de Bord',
      short: deposits ? 'Point d\'étape de la semaine' : 'Bilan de la semaine',
      start: nthWritingDay(today, 1, [last], state.pauses), time: endTime, minutes: 15,
      rrule: `FREQ=WEEKLY;BYDAY=${byDay([last])};UNTIL=${stamp}T235959`,
      description: text, details: text, url: link,
      alarms: [{ trigger: 'PT0M', text: deposits ? 'Point d\'étape : déposer mon document dans le Journal' : 'Bilan de la semaine dans le Journal de Bord' }],
    };
  }
  let meet = null;
  if (inp.meet > 0) {
    const text = `Envoyer à ma direction ce que j'ai écrit depuis la dernière fois, même imparfait. Mon avancée : ${APP_URL}`;
    meet = {
      uid: 'jdb-direction@lejournaldebord.org',
      title: 'Envoyer mes pages à ma direction',
      start: nthWritingDay(addDays(today, 7 * (inp.meet - 1)), 1, [last], state.pauses), time: endTime, minutes: 15,
      rrule: `FREQ=WEEKLY;INTERVAL=${inp.meet};BYDAY=${byDay([last])};UNTIL=${stamp}T235959`,
      description: text, details: text, url: APP_URL,
      alarms: [{ trigger: 'PT0M', text: 'Envoyer mes pages à ma direction' }],
    };
  }
  let deadline = null;
  if (state.deadline) {
    deadline = state.deadlineMonth ? {
      uid: 'jdb-deadline@lejournaldebord.org', title: `Dépôt visé (${fmtMonthYear(state.deadline)}) : ${title}`,
      date: monthStart(state.deadline), dateEnd: state.deadline,
      description: `Période visée pour le dépôt, suivie dans Le Journal de Bord : ${APP_URL}`,
      details: `Période visée pour le dépôt, suivie dans Le Journal de Bord : ${APP_URL}`,
      alarms: [{ trigger: '-P6DT15H', text: 'La période visée pour le dépôt commence dans une semaine' }],
    } : {
      uid: 'jdb-deadline@lejournaldebord.org', title: `Dépôt : ${title}`, date: state.deadline,
      description: `Date de dépôt suivie dans Le Journal de Bord : ${APP_URL}`,
      details: `Date de dépôt suivie dans Le Journal de Bord : ${APP_URL}`,
      alarms: [{ trigger: '-P6DT15H', text: 'Dépôt dans une semaine' }, { trigger: '-PT15H', text: 'Dépôt demain !' }],
    };
  }
  const end = fc.writingEnd ? {
    uid: 'jdb-writing-end@lejournaldebord.org', title: 'Fin de rédaction visée', date: fc.writingEnd,
    description: 'Objectif : manuscrit complet, place à la relecture et à la mise en forme.',
    details: `Objectif : manuscrit complet, place à la relecture et à la mise en forme. ${APP_URL}`,
    alarms: [{ trigger: '-PT15H' }],
  } : null;
  const chapters = [];
  const sch = schedule(state.chapters.map(c => ({ id: c.id, title: c.title, remaining: c.review === 'ok' ? 0 : Math.max(0, chapterStats(c).tP - chapterStats(c).wP) })), probe, today, fc);
  for (const c of state.chapters) {
    if (!sch[c.id]) continue;
    chapters.push({
      uid: `jdb-ch-${c.id}@lejournaldebord.org`, title: `Fin visée : ${c.title}`, date: sch[c.id],
      description: `Échéance proposée par votre rétroplanning. Suivi : ${APP_URL}`,
      alarms: [{ trigger: '-PT15H' }],
    });
  }
  return { sessions, sync, meet, deadline, end, chapters, until, fc };
}

function downloadICS() {
  const inp = calendarInputs();
  if (!inp.days.length) { toast('Choisissez au moins un jour d\'écriture', 'warn'); return; }
  saveCalendarPrefs();
  const ev = calendarEvents(inp);
  const events = [...ev.sessions];
  if (ev.sync) events.push(ev.sync);
  if (ev.meet) events.push(ev.meet);
  if (document.getElementById('calIncDeadline').checked && ev.deadline) events.push(ev.deadline);
  if (document.getElementById('calIncEnd').checked && ev.end) events.push(ev.end);
  if (document.getElementById('calIncChapters').checked) events.push(...ev.chapters);
  const ics = buildICS('Le Journal de Bord', events);
  downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'journal-de-bord.ics');
  toast('Fichier agenda téléchargé : ouvrez-le pour l\'ajouter.', 'success');
}

/* ============================================================
   SYNCHRO DU DOCUMENT — le tracker qui se remplit tout seul
   • 1re fois : un aperçu pour valider les correspondances.
   • Ensuite : un seul geste (fichier déposé n'importe où dans la
     page, ou bouton), sans aperçu tant que rien de nouveau
     n'apparaît dans le document. Toujours annulable.
   • Chrome / Edge sur ordinateur : le fichier reste « lié » à
     l'appareil et le suivi se met à jour au retour sur l'onglet.
   • Google Docs : le document se lie par son lien de partage et se
     relit de lui-même, sur tous les appareils (voir plus bas).
   • Un fichier peut contenir tout le manuscrit ou un seul chapitre.
   • Les pages sont celles du document : pagination réelle quand il
     la donne, mise en page simulée sinon (pages.js).
   Le fichier est lu sur l'appareil : rien n'est envoyé.
============================================================ */
let _dx = null;             // modèle affiché dans l'aperçu
let _linked = [];           // fichiers liés sur cet appareil : [{ key, name, handle }]
let _pendingReview = null;  // synchro automatique qui demande une vérification
let _syncing = false;
let _lastAutoSync = 0;
// Dernier tour de synchro : heure de la dernière vérification réussie, fichiers à autoriser, liens illisibles
const _syncState = { at: 0, refused: 0, failed: 0, error: '' };
const _autoSkip = new Map(); // synchros annulées : ne pas les rejouer automatiquement
const _forceReview = new Set(); // documents dont on veut revoir le plan à la prochaine lecture

// Parties ignorées par défaut (titres normalisés : minuscules, sans accents)
const DOCX_IGNORE = /^(bibliograph|references|sources\b|annexe|appendi|table des|sommaire|index\b|remerciement|acknowledg|resume\b|abstract|glossaire|liste des|sigles|abreviation|dedicace|avant propos|preface|notes\b)/;
const REVISION_NOTE = 'Relecture et corrections (synchro Word)';
const NEW_CHAPTER = '+';    // portée « ce document est un chapitre de plus »

const canLink = () => typeof window.showOpenFilePicker === 'function' && 'indexedDB' in window;
const hasDocFiles = () => Object.keys(state.docFiles).length > 0;
/** Google Docs liés : [[clé, fiche]]. */
/** Documents liés par un lien (Google Docs, Dropbox, lien direct) : relus sur tous les appareils. */
const linkEntries = () => Object.entries(state.docFiles).filter(([, f]) => f.gdoc || f.url);
/** Un document que le Journal sait relire seul : fichier lié sur cet appareil, ou document lié par un lien. */
const hasAutoDocs = () => _linked.length > 0 || linkEntries().length > 0;

/* ---------- Points d'entrée ---------- */

function updateWordButton() {
  const b = document.getElementById('wordBtn');
  const known = hasDocFiles() || _linked.length > 0;
  if (b) b.textContent = known ? 'Synchroniser mon document' : 'Importer mon document';
  const c = document.getElementById('wordChange');
  if (c) c.classList.toggle('hidden', !known);
}

/** Bouton « Word » du plan : le chemin le plus court selon la situation. */
function wordAction() {
  if (!requireReady()) return;
  if (hasAutoDocs()) syncAll({ manual: true });
  else if (hasDocFiles()) pickWordFile();
  else openDocxModal();
}

function openDocxModal() {
  if (!requireReady()) return;
  _dx = null;
  showDocxStep(1);
  setDocxError('');
  renderLinkedList();
  openModal('docxModal');
}

/** Choix du fichier. Avec Chrome / Edge, on garde une référence pour le relire plus tard. */
async function pickWordFile() {
  if (!requireReady()) return;
  if (canLink()) {
    try {
      const handles = await window.showOpenFilePicker({
        types: [{ description: 'Document (Word, LibreOffice, PDF, LaTeX, Markdown, texte)', accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx', '.docm'],
          'application/vnd.oasis.opendocument.text': ['.odt', '.fodt'],
          'application/pdf': ['.pdf'],
          'application/rtf': ['.rtf'],
          'application/zip': ['.zip'],
          'text/plain': ['.txt', '.tex', '.md', '.qmd', '.rmd', '.typ', '.org', '.adoc', '.rst'],
        } }],
        multiple: true,
      });
      const items = [];
      for (const h of handles) items.push({ file: await h.getFile(), handle: h });
      handleDocxFiles(items);
      return;
    } catch (e) {
      if (e && e.name === 'AbortError') return; // fenêtre fermée par l'utilisateur
      console.warn('Sélecteur de fichiers :', e);
    }
  }
  document.getElementById('docxInput').click();
}

function showDocxStep(n) {
  document.getElementById('docxStep1').classList.toggle('hidden', n !== 1);
  document.getElementById('docxStep2').classList.toggle('hidden', n !== 2);
  const box = document.querySelector('#docxModal .modal');
  if (box) box.scrollTop = 0; // chaque étape se lit depuis le haut
}

function setDocxBusy(on) {
  document.getElementById('docxBusy').classList.toggle('hidden', !on);
  document.getElementById('docxDrop').classList.toggle('hidden', on);
}

function setDocxError(msg) {
  const el = document.getElementById('docxError');
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

function showDocxFailure(msg) {
  showDocxStep(1);
  renderLinkedList();
  setDocxError(msg);
  openModal('docxModal');
}

async function handleDocxFile(file, handle = null) {
  if (!file || !requireReady()) return;
  const input = document.getElementById('docxInput');
  if (input) input.value = '';
  _reading++;
  setDocxError('');
  setDocxBusy(true);
  const busy = toast(`Lecture de ${trunc(file.name, 40)}…`, '', { key: 'docx', duration: 300000 });
  try {
    routeDocument(await parseDocumentFile(file, readOptions(file.name, busy)), file, handle);
  } catch (e) {
    if (e && e.code === 'gdoc-shortcut' && e.link) {
      // Raccourci de Google Drive pour ordinateur : on lie le document qu'il désigne
      busy.remove();
      setDocxBusy(false);
      linkDocument(e.link);
      return;
    }
    console.error('document :', e);
    showDocxFailure(DOC_ERRORS[e && e.code] || 'Lecture impossible de ce fichier.');
  } finally {
    _reading--;
    setDocxBusy(false);
    busy.remove();
    setTimeout(nextQueued, 600);
  }
}

/* Plusieurs fichiers d'un coup. S'ils forment un projet (LaTeX : fichier principal et chapitres ; Typst ;
   chapitres Markdown), ils sont assemblés en un seul document. Sinon ce sont des documents distincts
   (un fichier par chapitre) : ils sont lus l'un après l'autre, chacun avec son aperçu s'il en faut un. */
let _fileQueue = [];
let _reading = 0;    // lectures en cours : la file n'avance pas tant qu'un fichier est encore en train d'être lu

/** list : FileList, ou [{ file, handle }]. */
async function handleDocxFiles(list) {
  const items = [...(list || [])].map(x => (x && x.file ? x : { file: x, handle: null })).filter(x => x.file);
  if (!items.length || !requireReady()) return;
  if (items.length === 1) { handleDocxFile(items[0].file, items[0].handle); return; }
  const input = document.getElementById('docxInput');
  setDocxError('');
  let res = null;
  try { res = await parseProjectFiles(items.map(x => x.file)); }
  catch (e) { console.error('projet :', e); showDocxFailure(DOC_ERRORS[e && e.code] || 'Lecture impossible de ces fichiers.'); if (input) input.value = ''; return; }
  if (input) input.value = '';
  if (res) {
    routeDocument(res, { name: `${res.project.main} (projet de ${res.project.files} fichiers)`, lastModified: Math.max(...items.map(x => x.file.lastModified || 0)) || null, size: null }, null,
      { key: fileKeyOf(`projet ${res.project.main}`) });
    return;
  }
  _fileQueue = items.slice(1);
  toast(`${items.length} fichiers : ils sont lus l'un après l'autre.`, '', { duration: 5000 });
  handleDocxFile(items[0].file, items[0].handle);
}

/** Fichier suivant de la file, dès que la fenêtre de synchro est refermée. */
function nextQueued() {
  if (!_fileQueue.length || !_loaded || !currentUser) { if (!currentUser) _fileQueue = []; return; }
  if (_reading > 0) return;                                  // la lecture en cours relancera la file en finissant
  const modal = document.getElementById('docxModal');
  if (modal && !modal.classList.contains('hidden')) return;
  const next = _fileQueue.shift();
  handleDocxFile(next.file, next.handle);
}

/** Titres du plan actuel : ils aident à situer les parties d'un PDF sans signets. */
const planTitles = () => state.chapters.flatMap(c => [{ title: c.title, level: 1 }, ...c.subsections.map(s => ({ title: s.title, level: 2 }))]);

/** Options de lecture d'un document ; un long PDF dit où il en est dans le message d'attente. */
function readOptions(name, busy) {
  return {
    planTitles: planTitles(),
    onProgress: (done, total) => {
      const sp = busy && busy.querySelector('span');
      if (sp && total > 40) sp.textContent = typo(`Lecture de ${trunc(name, 28)}… page ${done} sur ${total}`);
    },
  };
}

const DOC_ERRORS = {
  'pdf-password': 'Ce PDF est protégé par un mot de passe : le Journal ne peut pas le lire. Exportez-le sans protection, ou déposez le fichier d\'origine.',
  'pdf-broken': 'Ce PDF est illisible (fichier incomplet ou endommagé ?). Exportez-le de nouveau depuis votre logiciel, puis réessayez.',
  'pdf-lib': 'Impossible de charger le lecteur de PDF : vérifiez votre connexion internet, puis réessayez.',
  'pdf-fetch': 'Le PDF n\'a pas pu être téléchargé jusqu\'au bout. Réessayez dans un instant.',
  'old-doc': 'Ce fichier est au format .doc (ancien Word). Ouvrez-le dans Word, puis Fichier > Enregistrer sous > Document Word (.docx), et réessayez.',
  'pages': 'Ce fichier vient de Pages. Dans Pages : Fichier, Exporter vers, PDF (pages exactes) ou Word, puis déposez le fichier obtenu.',
  'not-docx': 'Format non reconnu. Le Journal lit Word (.docx), LibreOffice (.odt), PDF, RTF, LaTeX (.tex, ou le projet en .zip), Markdown, Quarto, Typst et le texte simple. Depuis Google Docs : liez votre document par son lien, ou Fichier, Télécharger, Microsoft Word.',
  'zip-empty': 'Cette archive ne contient pas de document que le Journal sait lire (Word, LibreOffice, PDF, projet LaTeX ou Markdown).',
  'zip-crypt': 'Cette archive est protégée par un mot de passe : le Journal ne peut pas l\'ouvrir.',
  'scriv': 'Ce fichier vient de Scrivener. Dans Scrivener : Fichier, Compiler, au format PDF ou Word (.docx), puis déposez le fichier obtenu.',
  'image': 'Une image ne contient pas de texte lisible. Déposez le fichier de votre manuscrit (Word, LibreOffice, PDF…).',
  'epub': 'Les livres numériques (EPUB) ne sont pas lus. Exportez votre manuscrit en PDF ou en Word (.docx).',
  'not-text': 'Ce fichier est un tableur ou une présentation, pas un document texte.',
  'too-big': 'Ce fichier texte est trop volumineux pour être lu ici.',
  'zip-lib': 'Impossible de charger le lecteur de fichiers : vérifiez votre connexion internet.',
  'bad-xml': 'Le document semble endommagé : ouvrez-le et réenregistrez-le.',
  'gdoc-link': 'Ce lien n\'est pas celui d\'un document Google Docs. Ouvrez votre document, copiez l\'adresse de la page (elle commence par docs.google.com/document), puis collez-la ici.',
  'gdoc-private': 'Le Journal n\'a pas pu lire ce document. Dans Google Docs : Partager, puis Accès général, « Tous les utilisateurs disposant du lien » (Lecteur suffit). Réessayez ensuite.',
  'gdoc-404': 'Document introuvable : vérifiez le lien (document supprimé ou adresse incomplète ?).',
  'gdoc-busy': 'Google Docs ne répond pas pour le moment. Réessayez dans quelques minutes.',
  'gdoc-slow': 'Google Docs met trop de temps à préparer ce document. Réessayez, ou téléchargez-le (Fichier, Télécharger, Microsoft Word) et déposez le fichier ici.',
  'gdoc-offline': 'Pas de connexion internet : impossible de lire le document Google Docs pour le moment.',
  'link-bad': 'Ce n\'est pas un lien que le Journal sait lire. Collez le lien de partage de votre document Google Docs, ou celui d\'un fichier Dropbox (Partager, puis Copier le lien).',
  'link-http': 'Ce lien commence par « http:// ». Le Journal ne peut lire que des adresses sécurisées (https).',
  'link-folder': 'Ce lien mène à un dossier. Collez plutôt le lien du fichier lui-même : ouvrez le dossier, puis Partager et Copier le lien sur le fichier de votre manuscrit.',
  'link-dropbox': 'Ce lien Dropbox n\'est pas un lien de partage. Dans Dropbox : sur votre fichier, Partager, puis Copier le lien, et collez-le ici.',
  'link-onedrive': 'OneDrive et SharePoint ne laissent pas un site lire un fichier partagé. Sur Chrome ou Edge (ordinateur), choisissez plutôt le fichier dans votre dossier OneDrive : il restera lié et se mettra à jour tout seul. Sinon, déposez-le ici.',
  'link-drive': 'Ce lien mène à un fichier stocké dans Google Drive, pas à un document Google Docs : le Journal ne peut pas le lire directement. Ouvrez-le avec Google Docs (puis collez le lien de ce document), ou téléchargez-le et déposez-le ici.',
  'link-gother': 'Ce lien Google n\'est pas celui d\'un document texte (Google Docs). Ouvrez votre manuscrit dans Google Docs et collez son adresse.',
  'link-overleaf': 'Overleaf ne laisse pas lire un projet par son lien. Dans Overleaf : téléchargez le PDF (pages exactes) et déposez-le ici.',
  'link-private': 'Le Journal n\'a pas pu lire ce lien. Vérifiez qu\'il s\'agit bien d\'un lien de partage ouvert à « toute personne disposant du lien », et que le fichier existe toujours. Certains hébergeurs n\'autorisent pas la lecture depuis un site : dans ce cas, déposez le fichier.',
  'link-404': 'Fichier introuvable à cette adresse : le lien a peut-être été désactivé, ou le fichier déplacé. Copiez de nouveau son lien de partage.',
  'link-busy': 'L\'hébergeur du fichier ne répond pas pour le moment. Réessayez dans quelques minutes.',
  'link-slow': 'Le téléchargement du fichier prend trop de temps. Réessayez, ou déposez le fichier ici.',
  'link-offline': 'Pas de connexion internet : impossible de lire le fichier lié pour le moment.',
  'link-format': 'Ce lien ouvre une page web, pas le fichier lui-même. Collez le lien de partage du fichier (dans Dropbox : Partager, puis Copier le lien).',
};

/** Texte collé (Google Docs, Word, LibreOffice, LaTeX…) : le presse-papiers garde les titres. */
function importPasted(html, text) {
  if (!requireReady()) return;
  setDocxError('');
  let res;
  try { res = parsePasted({ html, text }); }
  catch (e) { console.error('collage :', e); showDocxFailure('Lecture impossible du texte collé.'); return; }
  if (res.totalWords < 30) {
    showDocxFailure('Le texte collé est trop court. Dans votre document : tout sélectionner (Ctrl + A), copier (Ctrl + C), puis coller ici (Ctrl + V).');
    return;
  }
  routeDocument(res, { name: PASTE_NAME, lastModified: null, size: null }, null);
}

function handleDocPaste(e) {
  const cd = e.clipboardData;
  if (!cd) return;
  const html = cd.getData('text/html');
  const text = cd.getData('text/plain');
  if (!html && !text) return;
  e.preventDefault();
  importPasted(html, text);
}

/** Un document vient d'être lu : aperçu la première fois (ou s'il y a du nouveau), sinon mise à jour directe. */
function routeDocument(res, file, handle, extra) {
  const m = buildDocxModel(res, file, handle, extra);
  if (_forceReview.delete(m.key)) { m.review = true; m.clean = false; }
  if (!m.rows.length && m.planEmpty) {
    if (res.kind === 'pdf') {
      showDocxFailure(res.scanned
        ? `« ${file.name} » fait ${fmtInt(res.totalPages)} pages, mais ne contient pas de texte lisible (pages scannées ?). Déposez plutôt le fichier d'origine, ou un PDF exporté depuis votre logiciel.`
        : `Aucun titre repéré dans « ${file.name} » (${fmtInt(res.totalPages)} pages, ${fmtInt(res.totalWords)} mots) : ce PDF n'a pas de signets, et ses titres ne se distinguent pas du texte. Exportez-le avec ses signets (LaTeX : extension hyperref ; Word : Enregistrer sous, PDF, Options, « Créer des signets à l'aide des titres »), ou déposez le fichier d'origine.`);
      return;
    }
    const how = res.kind === 'docx' || res.kind === 'odt' || res.kind === 'html' || res.kind === 'rtf'
      ? 'Appliquez le style « Titre 1 » à vos chapitres et « Titre 2 » à vos sous-parties, puis réessayez.'
      : 'Commencez vos chapitres par « Chapitre 1 », ou utilisez \\chapter{…} (LaTeX) ou « # Titre » (Markdown), puis réessayez.';
    showDocxFailure(`Aucun titre détecté dans « ${file.name} » (${fmtInt(res.totalWords)} mots). ${how}`);
    return;
  }
  if (!m.clean) openDocxPreview(m);
  else if (applyDocx(m, true) === 'same') {
    toast('Déjà à jour : rien de nouveau dans ce document.', 'success', { key: 'docx' });
  }
}

function openDocxPreview(m) {
  _dx = m;
  setDocxError('');
  renderDocxPreview();
  showDocxStep(2);
  openModal('docxModal');
}

/* ---------- Modèle : rapprocher le document et le plan ---------- */

function bestMatchId(title, items, used) {
  const key = normalizeTitle(title);
  let best = '';
  let bestScore = 0;
  for (const it of items) {
    if (used.has(it.id)) continue;
    const score = it.docKey && it.docKey === key ? 1.01 : titleScore(title, it.title);
    if (score > bestScore) { bestScore = score; best = it.id; }
  }
  return bestScore >= 0.55 ? best : '';
}

function docxMatchChildren(r) {
  const ch = findCh(r.map);
  const used = new Set();
  for (const c of r.children) {
    c.map = ch && ch.subsections.length && c.include ? bestMatchId(c.title, ch.subsections, used) : '';
    if (c.map) used.add(c.map);
  }
}

/** Titre proposé pour le chapitre que forme un document : son titre unique, sinon le nom du fichier. */
function docxDefaultTitle(m) {
  const tops = buildOutline(m.res.segments, m.res.frontWords, 'auto').chapters.filter(c => !DOCX_IGNORE.test(normalizeTitle(c.title)));
  const roots = m.res.segments.filter(s => s.level === Math.min(...m.res.segments.map(x => x.level)));
  if (roots.length === 1 && roots[0].title) return roots[0].title;
  if (tops.length === 1) return tops[0].title;
  const base = String(m.name).replace(NAME_EXT, '').replace(/[_-]+/g, ' ').trim();
  return base && m.name !== PASTE_NAME ? base.charAt(0).toUpperCase() + base.slice(1) : 'Nouveau chapitre';
}

/**
 * Devine ce qu'est un fichier inconnu : tout le manuscrit (''), un chapitre du plan (son identifiant)
 * ou un chapitre de plus (NEW_CHAPTER), pour celles et ceux qui rédigent un fichier par chapitre.
 */
function detectScope(res, fileName) {
  if (!state.chapters.length) return '';
  const tops = buildOutline(res.segments, res.frontWords, 'auto').chapters.filter(c => !DOCX_IGNORE.test(normalizeTitle(c.title)));
  if (tops.some(c => state.chapters.some(ch => titleScore(c.title, ch.title) >= 0.55))) return '';
  const base = String(fileName).replace(NAME_EXT, '');
  const named = fileName !== PASTE_NAME; // un texte collé n'a pas de nom qui renseigne
  const secs = buildOutline(res.segments, res.frontWords, 'auto', { single: true }).chapters;
  let best = '';
  let bestScore = 0;
  for (const ch of state.chapters) {
    let score = named && titleScore(base, ch.title) >= 0.55 ? 1.5 : 0;
    score += secs.filter(c => ch.subsections.some(s => titleScore(c.title, s.title) >= 0.55)).length;
    if (score > bestScore) { bestScore = score; best = ch.id; }
  }
  if (bestScore >= 1) return best;
  // Rien ne correspond au plan. Si l'on travaille déjà fichier par chapitre, ou si le fichier se présente
  // comme un chapitre (un seul titre qui coiffe tout, ou son nom le dit), c'est un chapitre de plus.
  const perChapter = Object.values(state.docFiles).some(f => f.scope);
  const oneTitle = tops.length <= 1;
  const saysChapter = named && /\b(chap|chapitre|chapter|partie|part|section|intro|conclu)/i.test(base);
  return perChapter || oneTitle || saysChapter ? NEW_CHAPTER : '';
}

/* Choix « inclure / ignorer » mémorisés par fichier et par partie.
   Clé simple = ignorée par l'utilisateur ; clé précédée de « + » = incluse
   alors qu'elle serait ignorée par défaut (bibliographie, annexes…). */
const ignoreKey = (m, r, c) => `${m.key}|${c ? (r.locked ? '#' + r.map : normalizeTitle(r.title)) : ''}|${normalizeTitle((c || r).title)}`;

function defaultInclude(m, r, c) {
  const k = ignoreKey(m, r, c);
  if (state.docIgnore.includes('+' + k)) return true;
  if (state.docIgnore.includes(k)) return false;
  const firstLevel = !c || !!m.scope; // premier niveau de titres du fichier
  return !(firstLevel && DOCX_IGNORE.test(normalizeTitle((c || r).title)));
}

/** La pagination vient-elle du document lui-même (et non d'une estimation) ? */
const exactPages = res => res.pageSource === 'pdf' || res.pageSource === 'word';

/**
 * extra : { key, gdoc, sig } pour un document Google Docs (clé stable tirée de son identifiant,
 * signature de son texte pour savoir plus tard s'il a changé).
 */
function buildDocxModel(res, file, handle, extra = {}) {
  const key = extra.key || fileKeyOf(file.name);
  const known = state.docFiles[key] || null;
  const m = {
    key, name: file.name, res, handle: handle || null, known,
    gdoc: extra.gdoc || (known && known.gdoc) || null, url: extra.url || (known && known.url) || null, sig: extra.sig || null,
    mtime: Number.isFinite(file.lastModified) ? file.lastModified : null,
    size: Number.isFinite(file.size) ? file.size : null,
    k: 1,              // correction du nombre de pages (« ce document fait N pages »)
    wpp: res.wpp,      // mots par page des parties suivies (recalculé à chaque évaluation)
    recount: false,    // document déjà suivi avec l'ancien calcul (mots par page) : on explique le changement
    planEmpty: state.chapters.length === 0,
    // Niveau de titre des chapitres : celui retenu pour ce fichier, sinon repéré automatiquement.
    // Un fichier synchronisé avant la 3.1 garde son ancien découpage tant qu'on ne le revoit pas.
    level: known ? (known.level || 'legacy') : 'auto',
    scope: '', newTitle: '', rows: [], totalTarget: 0, count: false, clean: false, replace: false, suggest: false, review: false,
  };
  if (known) {
    if (known.pv === 2) {
      // La correction vaut pour la source de pages avec laquelle elle a été donnée
      if (known.k && known.src === res.pageSource) m.k = known.k;
    } else {
      m.recount = true;
      // L'ancien réglage « mots par page » avait été ajusté à la main : on le traduit en nombre de pages
      if (!exactPages(res) && known.wpp && res.legacyWpp && res.totalPages > 0
          && Math.abs(known.wpp - res.legacyWpp) / res.legacyWpp > 0.03) {
        m.k = clamp((res.totalWords / known.wpp) / res.totalPages, 0.4, 2.5);
      }
    }
    m.scope = findCh(known.scope) ? known.scope : '';
  } else m.scope = detectScope(res, file.name);
  const body = o => o.chapters.filter(c => !DOCX_IGNORE.test(normalizeTitle(c.title))).length;
  m.autoLevel = buildOutline(res.segments, res.frontWords, 'auto').chapterLevel;
  if (m.level === 'legacy' && !m.scope
      && body(buildOutline(res.segments, res.frontWords, 'legacy')) <= 1
      && body(buildOutline(res.segments, res.frontWords, 'auto')) >= 3) {
    // Ancien découpage manifestement raté (tout le document pris pour un chapitre) : on propose le nouveau
    m.level = 'auto';
    m.suggest = true;
    m.replace = !m.planEmpty;
  }
  buildDocxRows(m);
  m.count = !!(known && Number.isFinite(known.inclWords));
  return m;
}

function buildDocxRows(m) {
  const res = m.res;
  if (m.replace) m.scope = '';
  const scopeCh = m.scope && m.scope !== NEW_CHAPTER ? findCh(m.scope) : null;
  if (m.scope && m.scope !== NEW_CHAPTER && !scopeCh) m.scope = '';
  const single = !!m.scope; // le fichier est un chapitre : ses titres de premier niveau en sont les sous-sections
  const o = buildOutline(res.segments, res.frontWords, single ? 'auto' : m.level, { single, frontPages: res.frontPages });
  m.outline = o;
  const fresh = m.planEmpty || m.replace; // le plan sera créé (ou recréé) à partir du document
  const node = (title, words, pages) => ({ title, words, pages: pages || 0, include: true, map: '', target: 0, touched: false, pg: 0 });
  if (single) {
    if (!scopeCh && !m.newTitle) m.newTitle = docxDefaultTitle(m).slice(0, 300);
    const r = {
      ...node(scopeCh ? scopeCh.title : m.newTitle, res.totalWords, res.totalPages),
      ownWords: o.front, ownPages: o.frontPages, locked: true, map: scopeCh ? scopeCh.id : '', children: [],
    };
    r.children = o.chapters.map(c => {
      const n = node(c.title, c.words, c.pages);
      n.include = defaultInclude(m, r, n);
      return n;
    });
    m.rows = [r];
  } else {
    m.rows = o.chapters.map(c => {
      const r = { ...node(c.title, c.words, c.pages), ownWords: c.ownWords, ownPages: c.ownPages || 0, children: [] };
      r.include = defaultInclude(m, r);
      r.children = c.children.map(x => {
        const n = node(x.title, x.words, x.pages);
        n.include = defaultInclude(m, r, n);
        return n;
      });
      return r;
    });
    if (!fresh) {
      const used = new Set();
      for (const r of m.rows) {
        if (!r.include) continue;
        r.map = bestMatchId(r.title, state.chapters, used);
        if (r.map) used.add(r.map);
      }
    }
  }
  if (!fresh) for (const r of m.rows) docxMatchChildren(r);
  if (m.planEmpty && !m.totalTarget) {
    const pages = m.rows.filter(r => r.include).reduce((s, r) => s + docxChapterPages(r), 0) * m.k;
    m.totalTarget = Math.max(50, Math.ceil((pages * 1.5) / 10) * 10);
  }
  computeDocxTargets(m);
  evaluateDocx(m);
}

/** Mots et pages attribués à une sous-partie : le texte d'ouverture du chapitre va à la première. */
function docxKidWords(r, c) {
  const kids = r.children.filter(x => x.include);
  return c.words + (kids[0] === c ? r.ownWords : 0);
}
function docxKidPages(r, c) {
  const kids = r.children.filter(x => x.include);
  return c.pages + (kids[0] === c ? r.ownPages : 0);
}
function docxChapterWords(r) {
  return r.ownWords + r.children.filter(x => x.include).reduce((s, x) => s + x.words, 0);
}
function docxChapterPages(r) {
  return r.ownPages + r.children.filter(x => x.include).reduce((s, x) => s + x.pages, 0);
}

/**
 * Bilan du rapprochement. « clean » = fichier déjà connu, rien de nouveau, rien de disparu :
 * la synchro peut alors s'appliquer sans aperçu.
 * C'est aussi ici que les pages deviennent des nombres entiers : le total des parties suivies
 * est arrondi une seule fois, puis réparti (chaque partie reçoit l'entier juste en dessous ou
 * juste au-dessus de sa longueur). On évite ainsi que trente petites sections arrondies une
 * à une finissent par peser dix pages de trop, ou de moins.
 */
function evaluateDocx(m) {
  let news = 0;
  const matched = new Set();
  for (const r of m.rows) {
    if (!r.include) continue;
    const ch = findCh(r.map);
    if (!ch) { news++; continue; }
    matched.add(ch.id);
    if (!ch.subsections.length) continue;
    for (const c of r.children) {
      if (!c.include) continue;
      if (c.map) matched.add(c.map);
      else news++;
    }
  }
  const missing = [];
  if (!m.replace) {
    for (const ch of state.chapters) {
      if (ch.docFile === m.key && ch.docKey && !matched.has(ch.id)) missing.push(ch.title);
      for (const ss of ch.subsections) {
        if (ss.docFile === m.key && ss.docKey && !matched.has(ss.id)) missing.push(ss.title);
      }
    }
  }
  const leaves = [];
  for (const r of m.rows) {
    const kids = r.children.filter(c => c.include);
    for (const c of r.children) c.pg = Math.round(c.pages * m.k);        // affichage d'une partie ignorée
    r.pg = Math.round(docxChapterPages(r) * m.k);
    if (!r.include) continue;
    if (kids.length) kids.forEach(c => leaves.push({ node: c, p: docxKidPages(r, c) * m.k }));
    else leaves.push({ node: r, p: docxChapterPages(r) * m.k });
  }
  const inclPages = leaves.reduce((s, l) => s + l.p, 0);
  const whole = distribute(Math.round(inclPages), leaves.map(l => l.p));
  leaves.forEach((l, i) => { l.node.pg = whole[i]; });
  for (const r of m.rows) {
    const kids = r.children.filter(c => c.include);
    if (r.include && kids.length) r.pg = kids.reduce((s, c) => s + c.pg, 0);
  }
  m.news = news;
  m.missing = missing;
  m.inclWords = m.rows.filter(r => r.include).reduce((s, r) => s + docxChapterWords(r), 0);
  m.inclPages = inclPages;
  m.wpp = inclPages > 0 && m.inclWords > 0 ? m.inclWords / inclPages : (m.res.wpp || 380) / m.k;
  m.clean = !!m.known && !m.replace && !m.review && !m.suggest && !m.recount
    && news === 0 && missing.length === 0 && m.rows.some(r => r.include);
}

function computeDocxTargets(m) {
  const pg = p => Math.ceil(p * m.k - 1e-6);
  if (m.planEmpty) {
    const leaves = [];
    for (const r of m.rows) {
      if (!r.include) continue;
      const kids = r.children.filter(c => c.include);
      if (kids.length) kids.forEach(c => leaves.push({ node: c, words: docxKidWords(r, c), pages: docxKidPages(r, c) }));
      else leaves.push({ node: r, words: docxChapterWords(r), pages: docxChapterPages(r) });
    }
    const W = leaves.reduce((s, l) => s + l.words, 0);
    const avg = leaves.length ? W / leaves.length : 0;
    const shares = distribute(Math.max(0, Math.round(m.totalTarget || 0)), leaves.map(l => (W > 0 ? l.words + avg : 1)));
    leaves.forEach((l, i) => { if (!l.node.touched) l.node.target = Math.max(1, shares[i], pg(l.pages)); });
    return;
  }
  const chAvg = avgTarget(state.chapters.map(c => chapterStats(c).tP), 20);
  const ssAvg = avgTarget(state.chapters.flatMap(c => c.subsections.map(s => s.targetPages)), Math.max(5, Math.round(chAvg / 4)));
  // Plan refait à partir du document : on reprend l'objectif de la partie de même titre dans l'ancien plan
  const kept = t => (m.replace ? oldTargetFor(t) : 0);
  for (const r of m.rows) {
    const kids = r.children.filter(c => c.include);
    if (!r.map) {
      if (kids.length) {
        // L'objectif que l'ancien plan donnait à ce chapitre se partage entre ses sous-sections
        const whole = kept(r.title);
        const shares = whole ? distribute(whole, kids.map(c => docxKidWords(r, c) + 1)) : null;
        kids.forEach((c, i) => {
          if (!c.touched) c.target = kept(c.title) || (shares ? Math.max(1, shares[i]) : Math.max(ssAvg, pg(docxKidPages(r, c))));
        });
      } else if (!r.touched) r.target = kept(r.title) || Math.max(chAvg, pg(docxChapterPages(r)));
    } else {
      for (const c of kids) if (!c.map && !c.touched) c.target = Math.max(ssAvg, pg(docxKidPages(r, c)));
    }
  }
}

/** Objectif de la partie du plan actuel qui porte (à peu près) ce titre, chapitre ou sous-section. */
function oldTargetFor(title) {
  let best = 0;
  let bestScore = 0.55;
  for (const ch of state.chapters) {
    const sc = titleScore(title, ch.title);
    if (sc >= bestScore && chapterStats(ch).tP > 0) { bestScore = sc; best = chapterStats(ch).tP; }
    for (const ss of ch.subsections) {
      const s2 = titleScore(title, ss.title);
      if (s2 >= bestScore && ss.targetPages > 0) { bestScore = s2; best = ss.targetPages; }
    }
  }
  return best;
}

/** Applique le modèle à une liste de chapitres (une copie pour simuler, ou le vrai plan). */
function applyDocxModel(m, chapters) {
  const ref = t => ({ docKey: normalizeTitle(t), docFile: m.key });
  for (const r of m.rows) {
    if (!r.include) continue;
    const kids = r.children.filter(c => c.include);
    let ch = r.map ? chapters.find(c => c.id === r.map) : null;
    if (!ch) {
      ch = { id: uid(), title: r.title.slice(0, 300), expanded: true, targetPages: 0, writtenPages: 0, subsections: [], ...ref(r.title) };
      if (kids.length) {
        ch.subsections = kids.map(c => ({
          id: uid(), title: c.title.slice(0, 300), targetPages: Math.max(1, c.target || 1),
          writtenPages: c.pg, ...ref(c.title),
        }));
      } else {
        ch.targetPages = Math.max(1, r.target || 1);
        ch.writtenPages = r.pg;
      }
      chapters.push(ch);
      r.createdId = ch.id;
      continue;
    }
    Object.assign(ch, ref(r.title));
    if (!ch.subsections.length) {
      ch.writtenPages = r.pg;
    } else if (!kids.length) {
      const shares = distribute(r.pg, ch.subsections.map(s => s.targetPages || 1));
      ch.subsections.forEach((s, i) => { s.writtenPages = shares[i]; });
    } else {
      for (const c of kids) {
        const ss = c.map ? ch.subsections.find(s => s.id === c.map) : null;
        if (ss) { ss.writtenPages = c.pg; Object.assign(ss, ref(c.title)); }
        else {
          ch.subsections.push({
            id: uid(), title: c.title.slice(0, 300), targetPages: Math.max(1, c.target || 1),
            writtenPages: c.pg, ...ref(c.title),
          });
        }
      }
    }
  }
  return chapters;
}

/** Variation du total de pages rédigées si l'on appliquait le modèle. */
function docxPageDelta(m) {
  const copy = m.replace ? [] : JSON.parse(JSON.stringify(state.chapters));
  const sum = list => list.reduce((s, ch) => s + (ch.subsections.length
    ? ch.subsections.reduce((a, x) => a + (x.writtenPages || 0), 0)
    : (ch.writtenPages || 0)), 0);
  return sum(applyDocxModel(m, copy)) - writtenPages();
}

/**
 * Pages à porter au journal du jour : au mot près quand le fichier est déjà connu.
 * On part des mots (et non des pages) : changer d'interligne ou insérer un saut de page
 * déplace la pagination sans que rien n'ait été écrit.
 */
function docxActivityDelta(m) {
  if (docxComparable(m)) {
    if (!m.inclWords && !m.known.inclWords) return docxPageDelta(m); // PDF sans texte (pages scannées) : on suit les pages
    return Math.round(((m.inclWords - m.known.inclWords) / m.wpp) * 100) / 100;
  }
  // Même document mais autre découpage (plan refait, autre niveau de titre) : rien de comparable, on repart de là
  if (m.known && Number.isFinite(m.known.inclWords)) return 0;
  return docxPageDelta(m);
}

/**
 * Jour auquel porter ce qui a été écrit. Un fichier garde la date de son dernier enregistrement : écrit mardi
 * soir et synchronisé mercredi matin, il a été écrit mardi. On s'y fie quand elle tombe entre la synchro
 * précédente et aujourd'hui ; un document lié par un lien n'a pas de date, ce sera aujourd'hui.
 */
function docxDay(m) {
  const today = todayKey();
  if (!m.mtime || !m.known || !isDayKey(m.known.at)) return today;
  const d = dayKey(new Date(m.mtime));
  if (!isDayKey(d) || d >= today || d < m.known.at || diffDays(d, today) > 366) return today;
  return d;
}

/** « d'aujourd'hui », « d'hier », « du mar. 24 nov. » */
const ofDay = day => (day === todayKey() ? 'd\'aujourd\'hui' : diffDays(day, todayKey()) === 1 ? 'd\'hier' : `du ${relDay(day).toLowerCase()}`);

/** Le décompte de mots de la dernière synchro est-il comparable à celui-ci (même découpage) ? */
function docxComparable(m) {
  return !!m.known && Number.isFinite(m.known.inclWords) && !m.replace
    && String(m.level) === String(m.known.level || 'legacy');
}

/** Un jour où l'on a retravaillé son texte sans l'allonger reste un jour de travail. */
function markRevisionDay(day = todayKey()) {
  const arr = state.journal[day] || [];
  if (arr.some(e => e.n === REVISION_NOTE)) return;
  state.journal[day] = [...arr, { p: 0, s: null, n: REVISION_NOTE, m: 0, t: nowHHMM() }];
  if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
}

/** Applique une synchro. quick = sans aperçu (fichier connu, rien de nouveau). */
function applyDocx(m, quick) {
  if (!m.rows.some(r => r.include)) { toast('Sélectionnez au moins une partie', 'warn'); return false; }
  const snap = snapshotState();
  const before = writtenPages();
  const parts = partPages();
  const pageDelta = docxPageDelta(m);
  const act = m.count ? docxActivityDelta(m) : 0;
  const day = docxDay(m);
  const wordsChanged = !m.known || m.known.inclWords !== m.inclWords;
  const same = quick && pageDelta === 0 && act === 0;

  if (m.replace) {
    // Plan refait à partir du document : les statuts de relecture suivent les chapitres de même titre
    const old = state.chapters;
    state.chapters = [];
    applyDocxModel(m, state.chapters);
    for (const ch of state.chapters) {
      const prev = old.find(o => o.review && titleScore(o.title, ch.title) >= 0.55);
      if (prev) { ch.review = prev.review; if (prev.reviewDate) ch.reviewDate = prev.reviewDate; }
    }
  } else applyDocxModel(m, state.chapters);
  if (act) addActivity(act, day);
  if (m.count && wordsChanged && docxComparable(m) && pagesOn(state.activity, day) <= 0) markRevisionDay(day);

  // On retient ce que l'utilisateur a décoché, pour ne plus le lui reproposer
  const ig = new Set(state.docIgnore);
  const remember = (r, c) => {
    const n = c || r;
    const k = ignoreKey(m, r, c);
    const byDefault = (!c || !!m.scope) && DOCX_IGNORE.test(normalizeTitle(n.title));
    ig.delete(k);
    ig.delete('+' + k);
    if (!n.include && !byDefault) ig.add(k);
    if (n.include && byDefault) ig.add('+' + k);
  };
  for (const r of m.rows) {
    if (!r.locked) remember(r);
    if (r.include) r.children.forEach(c => remember(r, c));
  }
  state.docIgnore = [...ig].slice(-300);
  // Un chapitre de plus : la prochaine fois, ce fichier sera reconnu comme ce chapitre-là
  const scope = m.scope === NEW_CHAPTER ? ((m.rows[0] && m.rows[0].createdId) || '') : (m.scope || '');
  const wpp = Math.round(m.wpp);
  state.docFiles[m.key] = {
    name: m.name.slice(0, 200), at: todayKey(), inclWords: m.inclWords, wpp: wpp >= 80 && wpp <= 1500 ? wpp : null, scope,
    level: m.level === 'legacy' ? null : m.level, mtime: m.mtime, size: m.size,
    pv: 2, src: m.res.pageSource, pages: Math.round(m.res.totalPages * m.k * 10) / 10,
    k: Math.abs(m.k - 1) > 0.001 ? Math.round(m.k * 10000) / 10000 : null,
    gdoc: m.gdoc || null, url: m.url || null, sig: m.sig || null,
  };
  if (!state.trackedSince) state.trackedSince = todayKey();
  _dx = null;
  if (_pendingReview && _pendingReview.key === m.key) _pendingReview = null;
  const newlyLinked = !!m.handle && canLink() && !_linked.some(l => l.key === m.key);
  if (m.handle || m.gdoc || m.url) _syncState.at = Date.now();   // document relu à l'instant : l'état affiché le dit
  if (m.handle) linkFile(m.key, m.name, m.handle);
  const undo = () => {
    if (m.mtime) _autoSkip.set(m.key, m.mtime);
    else if (m.sig) _autoSkip.set(m.key, m.sig);
    restoreSnapshot(snap, 'Synchronisation annulée');
    updateWordButton();
  };
  // L'historique : ce que cette synchro a changé, partie par partie (rien quand le fichier n'a pas bougé)
  const changes = same ? [] : partChanges(parts);
  const logged = same ? null : logSync(m, { day, act, pageDelta, changes });
  saveNow();
  _syncUndo = logged ? { t: logged.t, fn: undo } : null;   // après l'enregistrement, qui périme les annulations précédentes
  closeModal('docxModal');
  render();
  updateWordButton();
  if (same) return 'same'; // fichier réenregistré sans changement

  // Les pages vont au jour où le fichier a été enregistré : on le dit quand ce n'est pas aujourd'hui
  const when = day === todayKey() ? 'aujourd\'hui' : `${relDay(day).toLowerCase()}, jour où le fichier a été enregistré`;
  const detail = m.recount && pageDelta ? `pages recomptées (${fmtInt(before)} → ${fmtInt(before + pageDelta)})${act ? `, ${act > 0 ? '+' : ''}${fmt1(act)} p. ${when}` : ''}`
    : act ? `${act > 0 ? '+' : ''}${fmt1(act)} p. ${when}`
    : pageDelta ? `${pageDelta > 0 ? '+' : ''}${pageDelta} p.` : 'tout est à jour';
  // Où : la partie qui a bougé, ou leur nombre (le détail est dans l'historique des synchros)
  const where = m.replace || !m.known ? '' : changes.length === 1 ? ` · ${trunc(changes[0][0], 30)}` : changes.length > 1 ? ` · ${changes.length} parties` : '';
  toast(`${trunc(m.name, 28)} synchronisé : ${detail}${where}`, 'success', {
    key: 'docx', undo: true, action: { label: 'Annuler', fn: undo },
  });
  if (newlyLinked) {
    setTimeout(() => toast('Fichier lié : vos pages se mettront à jour toutes seules quand vous reviendrez ici.', '', { duration: 6000 }), 1200);
  } else if ((m.gdoc || m.url) && !m.known) {
    setTimeout(() => toast(`${m.gdoc ? 'Google Doc' : 'Fichier'} lié : vos pages se mettront à jour toutes seules, sur tous vos appareils.`, '', { duration: 7000 }), 1200);
  }
  if (act > 0 && day === todayKey()) checkDailyGoal();
  return true;
}

/* ---------- L'historique des synchros : ce que chacune a changé ---------- */
let _syncUndo = null;   // { t, fn } : annulation de la dernière synchro, tant que rien d'autre n'a été modifié

/** Pages rédigées de chaque partie du plan : Map(id → { title, pages }). */
function partPages() {
  const out = new Map();
  for (const ch of state.chapters) {
    const pages = ch.subsections.length ? ch.subsections.reduce((a, x) => a + (x.writtenPages || 0), 0) : (ch.writtenPages || 0);
    out.set(ch.id, { title: ch.title, pages });
  }
  return out;
}

/** Ce qui a changé depuis « before » : [[titre, pages en plus ou en moins]], les plus gros écarts d'abord. */
function partChanges(before) {
  const out = [];
  for (const [id, now] of partPages()) {
    const was = before.get(id);
    const d = Math.round((now.pages - (was ? was.pages : 0)) * 100) / 100;
    if (d) out.push([now.title, d]);
  }
  return out.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
}

/** Inscrit une synchro dans l'historique (les SYNC_KEEP dernières sont gardées). */
function logSync(m, { day, act, pageDelta, changes }) {
  const entry = {
    t: `${todayKey()}T${nowHHMM()}`,
    k: m.key,
    n: m.name.slice(0, 80),
    d: day,
    a: Math.round(act * 100) / 100,
    p: Math.round(pageDelta * 100) / 100,
    w: docxComparable(m) ? Math.round(m.inclWords - m.known.inclWords) : null,
    c: changes.slice(0, SYNC_PARTS).map(c => ({ n: String(c[0]).slice(0, 60), d: c[1] })),
    x: m.replace ? 'plan' : !m.known ? 'new' : '',
  };
  state.syncLog = [...state.syncLog, entry].slice(-SYNC_KEEP);
  return entry;
}

/** « +2,5 p. », « −1 p. » */
const signedPages = n => `${n > 0 ? '+' : '−'}${fmt1(Math.abs(n))}\u00A0p.`;

/** L'historique, dans la fenêtre « Mon document » : la dernière synchro en clair (annulable), les précédentes dépliables. */
function renderSyncLog() {
  const box = document.getElementById('syncLogBox');
  if (!box) return;
  const log = state.syncLog.slice().reverse();
  box.classList.toggle('hidden', !log.length);
  if (!log.length) { setHTML('syncLogLast', ''); setHTML('syncLogList', ''); return; }
  const when = e => {
    const day = e.t.slice(0, 10);
    return `${day === todayKey() ? 'aujourd\'hui' : relDay(day).toLowerCase()} à ${e.t.slice(11).replace(':', '\u00A0h\u00A0')}`;
  };
  const what = e => {
    const bits = [];
    if (e.x === 'plan') bits.push('plan refait');
    else if (e.x === 'new') bits.push('première synchro');
    if (e.a) bits.push(`${signedPages(e.a)} au journal ${ofDay(e.d)}`);
    else if (e.p) bits.push(`${signedPages(e.p)} sans toucher au journal`);
    if (e.w) bits.push(`${e.w > 0 ? '+' : '−'}${fmtInt(Math.abs(e.w))}\u00A0mots`);
    return bits.join(', ') || 'pages recomptées';
  };
  const parts = e => (e.c.length ? `<span class="sl-parts">${e.c.map(c => `${esc(trunc(c.n, 34))}\u00A0: ${signedPages(c.d)}`).join(' ; ')}</span>` : '');
  const line = e => `<b>${esc(trunc(e.n, 34))}</b>, ${when(e)} : ${what(e)}.${parts(e)}`;
  const last = log[0];
  const canUndo = _syncUndo && _syncUndo.t === last.t;
  setHTML('syncLogLast', `<span>${typo(line(last))}</span>${canUndo
    ? '<button type="button" class="lk-btn" onclick="undoLastSync()" title="Revenir à l\'état d\'avant cette synchro">Annuler cette synchro</button>' : ''}`);
  const older = log.slice(1);
  document.getElementById('syncLogMore').classList.toggle('hidden', !older.length);
  setText('syncLogCount', `Synchros précédentes (${older.length})`);
  setHTML('syncLogList', older.map(e => `<li>${typo(line(e))}</li>`).join(''));
}

function undoLastSync() {
  const u = _syncUndo;
  if (!u) return;
  _syncUndo = null;
  u.fn();
  renderSyncLog();
}

/* ---------- Aperçu (première synchro d'un fichier, ou nouveautés) ---------- */

function docxTargetInput(i, j, val) {
  return `<span class="dx-target">objectif <input type="number" min="1" inputmode="numeric" value="${val}"
            oninput="docxTarget(${i},${j},this.value)" aria-label="Objectif de pages"> p.</span>`;
}

function docxRowHTML(m, node, i, j, r) {
  const isCh = j < 0;
  const fresh = m.planEmpty || m.replace; // plan créé à partir du document : rien à rapprocher
  const words = isCh ? docxChapterWords(node) : docxKidWords(r, node);
  const pages = node.pg;
  let ctl = '';
  if (!node.include) ctl = '<span class="dx-ign">ignoré</span>';
  else if (isCh) {
    const ch = findCh(node.map);
    const kids = node.children.filter(c => c.include);
    let extra = '';
    if (!ch) extra = kids.length ? `<span class="dx-note">+ ${kids.length} sous-section${kids.length > 1 ? 's' : ''}</span>` : docxTargetInput(i, -1, node.target);
    else if (!ch.subsections.length) extra = `<span class="dx-delta">${ch.writtenPages || 0} → <b>${pages}</b> p.</span>`;
    else if (!kids.length) extra = `<span class="dx-note">réparti sur vos ${ch.subsections.length} sous-sections</span>`;
    if (node.locked) ctl = `<span class="dx-note">${ch ? 'ce fichier = ce chapitre' : 'nouveau chapitre'}</span>${extra}`;
    else if (fresh) ctl = extra;
    else {
      const opts = ['<option value="">+ Nouveau chapitre</option>']
        .concat(state.chapters.map(c => `<option value="${c.id}"${c.id === node.map ? ' selected' : ''}>→ ${esc(trunc(c.title, 42))}</option>`));
      ctl = `<select onchange="docxMap(${i},-1,this.value)" aria-label="Correspondance dans votre plan">${opts.join('')}</select>${extra}`;
    }
  } else {
    const ch = findCh(r.map);
    if (ch && !ch.subsections.length) ctl = `<span class="dx-note">compté dans « ${esc(trunc(ch.title, 30))} »</span>`;
    else if (!ch) ctl = docxTargetInput(i, j, node.target);
    else {
      const opts = ['<option value="">+ Nouvelle sous-section</option>']
        .concat(ch.subsections.map(s => `<option value="${s.id}"${s.id === node.map ? ' selected' : ''}>→ ${esc(trunc(s.title, 42))}</option>`));
      const ss = ch.subsections.find(s => s.id === node.map);
      const extra = ss ? `<span class="dx-delta">${ss.writtenPages || 0} → <b>${pages}</b> p.</span>` : docxTargetInput(i, j, node.target);
      ctl = `<select onchange="docxMap(${i},${j},this.value)" aria-label="Correspondance dans votre plan">${opts.join('')}</select>${extra}`;
    }
  }
  return `<div class="dx-row ${isCh ? 'dx-ch' : 'dx-ss'}${node.include ? '' : ' off'}">
    <label class="dx-check"><input type="checkbox" ${node.include ? 'checked' : ''} ${node.locked ? 'disabled' : ''}
      onchange="docxToggle(${i},${j},this.checked)" aria-label="Inclure cette partie"></label>
    <div class="dx-main"><div class="dx-title">${esc(node.title)}</div><div class="dx-meta">${fmtInt(words)} mots · <b>${pages} p.</b></div></div>
    <div class="dx-map">${ctl}</div>
  </div>`;
}

function renderDocxPreview() {
  const m = _dx;
  if (!m) return;
  const res = m.res;
  const o = m.outline;
  const single = !!m.scope;
  const nCh  = single ? 0 : m.rows.length;
  const nSub = m.rows.filter(r => r.include).reduce((s, r) => s + r.children.filter(c => c.include).length, 0);
  const total = Math.max(1, Math.round(res.totalPages * m.k));
  const found = single
    ? (nSub ? `${nSub} sous-section${nSub > 1 ? 's' : ''} détectée${nSub > 1 ? 's' : ''}.` : 'Pas de titres : tout le texte est compté pour ce chapitre.')
    : `${nCh} partie${nCh > 1 ? 's' : ''} détectée${nCh > 1 ? 's' : ''}${nSub ? `, ${nSub} sous-section${nSub > 1 ? 's' : ''}` : ''}.`;
  const frontP = Math.round(o.frontPages * m.k);
  const front = !single && frontP >= 1 ? ` Pages liminaires non comptées : ${frontP} p.` : '';
  // « ≈ » quand le nombre de pages est calculé (mise en page simulée, densité) et non lu dans le document
  const firm = res.pageSource === 'pdf' || res.pageSource === 'word' || res.pageSource === 'meta' || Math.abs(m.k - 1) > 0.001;
  setHTML('docxSummary', `<b>${esc(m.name)}</b> : ${fmtInt(res.totalWords)} mots, <b>${firm ? '' : '≈ '}${fmtInt(total)} page${total > 1 ? 's' : ''}</b>. ${found}${front}`);
  document.getElementById('docxSuggest').classList.toggle('hidden', !m.suggest);
  document.getElementById('docxRecount').classList.toggle('hidden', !m.recount);
  // Titres repérés à leur mise en forme (document sans styles de titre) : on le dit, le plan est à vérifier
  document.getElementById('docxHeadNote').classList.toggle('hidden', !(res.headingSource === 'layout' && res.kind !== 'pdf' && m.rows.length > 0));

  // D'où vient le nombre de pages, et comment le corriger
  const pagesEl = document.getElementById('docxPages');
  if (document.activeElement !== pagesEl) pagesEl.value = total;
  const lay = res.layout;
  const layTxt = lay && lay.font ? ` (${esc(lay.font)} ${fmt1(lay.size)}${lay.spacing ? `, interligne ${fmt1(lay.spacing)}` : ''}${lay.paper ? `, ${lay.paper === 'Letter' ? 'format Lettre' : lay.paper}` : ''})` : '';
  // Un PDF : d'où vient son plan (signets, titres balisés, mise en forme, titres de votre plan)
  const HEADS = {
    outline: 'plan lu dans ses signets', tags: 'plan lu dans ses titres balisés',
    layout: 'titres repérés d\'après la mise en forme, à vérifier ci-dessous', plan: 'parties situées d\'après les titres de votre plan',
  };
  const SRC = {
    pdf: res.kind === 'pdf' ? `pagination du PDF, exacte${HEADS[res.headingSource] ? ` · ${HEADS[res.headingSource]}` : ''}` : 'pagination de Google Docs, exacte',
    word: res.kind === 'odt' ? 'pagination enregistrée par LibreOffice, exacte' : 'pagination enregistrée par Word, exacte',
    meta: `nombre de pages indiqué par ${res.kind === 'odt' || res.gen === 'libreoffice' ? 'LibreOffice' : 'le fichier'}`,
    layout: `calculé d'après la mise en page${layTxt}`,
    density: 'estimation sans mise en page (une page courante : Times 12, interligne 1,5). Indiquez le vrai nombre de pages de votre document : il sera retenu',
  };
  const corrected = Math.abs(m.k - 1) > 0.001;
  setHTML('docxPagesHint', corrected
    ? `corrigé par vous, retenu pour ce document · <button type="button" class="linklike" onclick="docxResetPages()">rétablir (${fmtInt(Math.max(1, Math.round(res.totalPages)))})</button>`
    : (SRC[res.pageSource] || ''));

  // Que faire de ce document ? (tout le manuscrit, un chapitre de plus, un chapitre du plan)
  const mode = docxMode(m);
  const opt = (v, title, sub) => `<label class="dx-mode${mode === v ? ' on' : ''}"><input type="radio" name="docxMode" value="${v}" ${mode === v ? 'checked' : ''} onchange="docxSetMode('${v}')">
      <span><b>${title}</b><small>${sub}</small></span></label>`;
  setHTML('docxModes', m.planEmpty
    ? opt('match', 'Tout mon manuscrit', 'Ses chapitres deviennent mon plan.')
      + opt('add', 'Un seul chapitre', 'J\'ajouterai les autres ensuite, fichier par fichier.')
    : opt('match', 'Mettre à jour mon plan', 'Ses parties sont rapprochées de celles de mon plan.')
      + opt('replace', 'Refaire mon plan', 'Le plan repart de ce document. Objectifs et statuts repris quand les titres correspondent.')
      + opt('add', 'Ajouter un chapitre', 'Ce fichier est un chapitre de plus.')
      + opt('chapter', 'Un chapitre de mon plan', 'Ce fichier correspond à un chapitre déjà présent.'));
  const chapRow = document.getElementById('docxScopeRow');
  chapRow.classList.toggle('hidden', mode !== 'chapter');
  if (mode === 'chapter') {
    document.getElementById('docxScope').innerHTML = state.chapters.map(c => `<option value="${c.id}"${c.id === m.scope ? ' selected' : ''}>${esc(trunc(c.title, 48))}</option>`).join('');
  }
  const titleRow = document.getElementById('docxNewTitleRow');
  titleRow.classList.toggle('hidden', mode !== 'add');
  const titleEl = document.getElementById('docxNewTitle');
  if (mode === 'add' && document.activeElement !== titleEl) titleEl.value = m.newTitle;

  // À quel niveau de titre sont les chapitres ? (proposé automatiquement, modifiable, retenu pour ce document)
  const levelRow = document.getElementById('docxLevelRow');
  const showLevel = !single && o.levels.length >= 2;
  levelRow.classList.toggle('hidden', !showLevel);
  if (showLevel) {
    const lv = (v, label) => `<option value="${v}"${String(m.level) === String(v) ? ' selected' : ''}>${label}</option>`;
    document.getElementById('docxLevel').innerHTML =
      (m.known && !m.known.level ? lv('legacy', 'comme à la dernière synchro') : '')
      + lv('auto', `repérés automatiquement${m.autoLevel ? ` (niveau ${m.autoLevel})` : ''}`)
      + o.levels.map(l => lv(l.level, `les titres de niveau ${l.level} (${l.count})`)).join('');
  }

  document.getElementById('docxTotalRow').classList.toggle('hidden', !m.planEmpty);
  const totEl = document.getElementById('docxTotal');
  if (m.planEmpty && document.activeElement !== totEl) totEl.value = m.totalTarget;

  let html = '';
  m.rows.forEach((r, i) => {
    html += docxRowHTML(m, r, i, -1, null);
    if (r.include) r.children.forEach((c, j) => { html += docxRowHTML(m, c, i, j, r); });
  });
  if (!m.rows.length) {
    html = '<p class="dx-empty">Aucun titre détecté dans ce document. S\'il correspond à un chapitre, choisissez « Ajouter un chapitre » ou « Un chapitre de mon plan » ci-dessus : tout son texte sera compté.</p>';
  }
  setHTML('docxRows', html);

  // Parties du plan absentes du document
  let absentNote = '';
  if (!single && m.rows.length) {
    const mapped = new Set(m.rows.filter(r => r.include && r.map).map(r => r.map));
    const absent = state.chapters.filter(c => !mapped.has(c.id)).map(c => `« ${esc(trunc(c.title, 40))} »`);
    if (absent.length) {
      absentNote = m.replace ? `Retirés du plan (remplacés par ceux du document) : ${absent.join(', ')}.`
        : `Inchangés (absents de ce document) : ${absent.join(', ')}.`;
    }
  }
  setHTML('docxMissing', absentNote);

  const delta = m.rows.some(r => r.include) ? docxActivityDelta(m) : 0;
  document.getElementById('docxCountRow').classList.toggle('hidden', delta === 0);
  document.getElementById('docxCount').checked = m.count;
  setText('docxCountLbl', `Ajouter ${delta > 0 ? '+' : ''}${fmt1(delta)} p. à mon journal ${ofDay(docxDay(m))}`);
  setText('docxCountHint', docxComparable(m)
    ? 'C\'est ce qui a changé depuis la dernière synchro de ce document.'
    : 'Première synchro de ce document : laissez décoché, ces pages étaient déjà écrites.');
  setText('docxApply', m.replace ? 'Refaire mon plan' : mode === 'add' ? 'Ajouter ce chapitre' : m.planEmpty ? 'Créer mon plan' : 'Mettre à jour mon plan');
  document.getElementById('docxApply').disabled = !m.rows.some(r => r.include);
}

function docxNode(i, j) { const r = _dx.rows[i]; return j < 0 ? r : r.children[j]; }

function docxRefresh() {
  if (_dx.planEmpty && !_dx.totalTouched) {
    // L'objectif total proposé suit le nombre de pages du document tant qu'on ne l'a pas fixé soi-même
    const pages = _dx.rows.filter(r => r.include).reduce((s, r) => s + docxChapterPages(r), 0) * _dx.k;
    _dx.totalTarget = Math.max(50, Math.ceil((pages * 1.5) / 10) * 10);
  }
  computeDocxTargets(_dx);
  evaluateDocx(_dx);
  renderDocxPreview();
}

function docxToggle(i, j, on) {
  const node = docxNode(i, j);
  node.include = on;
  if (j < 0 && on && !node.map && !node.locked) {
    // Partie réintégrée : on cherche sa correspondance parmi les chapitres encore libres
    const used = new Set(_dx.rows.filter(r => r !== node && r.include && r.map).map(r => r.map));
    node.map = bestMatchId(node.title, state.chapters, used);
  }
  docxMatchChildren(_dx.rows[i]);
  docxRefresh();
}

function docxMap(i, j, val) {
  const node = docxNode(i, j);
  node.map = val;
  if (j < 0) docxMatchChildren(node);
  docxRefresh();
}

function docxTarget(i, j, val) {
  const node = docxNode(i, j);
  node.target = Math.max(1, parseInt(val, 10) || 1);
  node.touched = true;
}

/** Que faire du document : 'match' (rapprocher du plan), 'replace' (refaire le plan), 'add' (chapitre de plus), 'chapter' (chapitre du plan). */
const docxMode = m => (m.replace ? 'replace' : m.scope === NEW_CHAPTER ? 'add' : m.scope ? 'chapter' : 'match');

function docxSetMode(mode) {
  if (!_dx) return;
  const m = _dx;
  m.replace = mode === 'replace';
  if (mode === 'add') m.scope = NEW_CHAPTER;
  else if (mode === 'chapter') m.scope = findCh(m.scope) ? m.scope : (state.chapters[0] ? state.chapters[0].id : '');
  else m.scope = '';
  buildDocxRows(m);
  renderDocxPreview();
}

function docxSetScope(val) {
  if (!_dx) return;
  _dx.scope = val === NEW_CHAPTER || findCh(val) ? val : '';
  buildDocxRows(_dx);
  renderDocxPreview();
}

/** Titre du chapitre que ce fichier va créer. */
function docxSetNewTitle(val) {
  if (!_dx || _dx.scope !== NEW_CHAPTER) return;
  const t = String(val || '').trim().slice(0, 300);
  if (!t) return;
  _dx.newTitle = t;
  if (_dx.rows[0]) _dx.rows[0].title = t;
  const el = document.querySelector('#docxRows .dx-ch .dx-title');
  if (el) el.textContent = t;
}

/** Niveau de titre des chapitres : 'auto', 'legacy' (comme avant) ou un numéro de niveau. */
function docxSetLevel(val) {
  if (!_dx) return;
  _dx.level = val === 'auto' || val === 'legacy' ? val : (parseInt(val, 10) || 'auto');
  buildDocxRows(_dx);
  renderDocxPreview();
}

/** « Ce document fait N pages » : la correction est retenue pour ce document et suivra ses prochaines synchros. */
function docxSetPages(val) {
  if (!_dx) return;
  const v = parseFloat(String(val).replace(',', '.'));
  if (!(v >= 1) || !(_dx.res.totalPages > 0)) return;
  _dx.k = clamp(v / _dx.res.totalPages, 0.2, 5);
  if (Math.abs(_dx.k - 1) < 0.001 || Math.round(_dx.res.totalPages) === Math.round(v)) _dx.k = 1;
  docxRefresh();
}

function docxResetPages() {
  if (!_dx) return;
  _dx.k = 1;
  const el = document.getElementById('docxPages');
  if (el) el.value = '';
  docxRefresh();
}

function docxSetTotal(val) {
  if (!_dx) return;
  const v = parseInt(val, 10);
  if (!(v > 0)) return;
  _dx.totalTarget = v;
  _dx.totalTouched = true;
  docxRefresh();
}

function docxCountChanged(on) { if (_dx) _dx.count = on; }
function applyDocxImport() { if (_dx) applyDocx(_dx, false); }
function docxBack() { _dx = null; showDocxStep(1); renderLinkedList(); }

/* ---------- Fichiers liés (Chrome / Edge sur ordinateur) ----------
   La référence au fichier est gardée sur cet appareil (IndexedDB).
   Le navigateur redemande l'autorisation de lecture quand il le faut. */

function filesDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('jdb-files', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('handles');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function filesGet(key) {
  const fdb = await filesDb();
  return new Promise((resolve, reject) => {
    const req = fdb.transaction('handles').objectStore('handles').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function filesSet(key, val) {
  const fdb = await filesDb();
  return new Promise((resolve, reject) => {
    const tx = fdb.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(val, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function saveLinked() {
  if (!currentUser) return;
  filesSet(currentUser.uid, _linked).catch(e => console.warn('Fichiers liés :', e));
}

async function initLinkedFiles() {
  _linked = [];
  _pendingReview = null;
  const owner = currentUser && currentUser.uid;
  if (!owner) return;
  if (canLink()) {
    try {
      const list = await filesGet(owner);
      if (!currentUser || currentUser.uid !== owner) return;
      if (Array.isArray(list)) _linked = list.filter(x => x && x.key && x.handle && typeof x.handle.getFile === 'function');
    } catch (e) { console.warn('Fichiers liés :', e); }
  }
  renderPrimary();
  updateWordButton();
  if (hasAutoDocs()) syncAll({ manual: false });
}

function linkFile(key, name, handle) {
  if (!canLink() || !handle || typeof handle.getFile !== 'function') return;
  _linked = _linked.filter(l => l.key !== key).concat([{ key, name, handle }]);
  saveLinked();
  renderPrimary();
  updateWordButton();
}

function unlinkFile(key, silent) {
  _linked = _linked.filter(l => l.key !== key);
  if (_pendingReview && _pendingReview.key === key) _pendingReview = null;
  saveLinked();
  renderPrimary();
  updateWordButton();
  renderLinkedList();
  if (!silent) toast('Fichier délié. Vos pages restent telles quelles.', '');
}

/** « Mes documents » : ceux que le Journal connaît, avec de quoi les resynchroniser, revoir leur plan ou les oublier. */
function renderLinkedList() {
  const box = document.getElementById('linkedBox');
  if (!box) return;
  const linkedKeys = new Set(_linked.map(l => l.key));
  const all = _linked.filter(l => !state.docFiles[l.key]).map(l => [l.key, { name: l.name }]).concat(Object.entries(state.docFiles));
  box.classList.toggle('hidden', all.length === 0);
  const rows = all.map(([k, f]) => {
    const linked = linkedKeys.has(k);
    const remote = !!(f.gdoc || f.url);
    const host = f.url ? linkHost(f.url) : '';
    const kind = f.gdoc ? 'Google Docs' : f.url ? `lié par son lien (${host})` : linked ? 'fichier lié à cet appareil' : f.name === PASTE_NAME ? 'texte collé' : 'fichier';
    // Où ouvrir le document : la page Google Docs, ou la page de partage du fichier
    const open = f.gdoc ? `https://docs.google.com/document/d/${f.gdoc}/edit` : f.url ? linkPage(f.url) : '';
    const when = f.at ? `synchro : ${relDay(f.at).toLowerCase()}` : 'pas encore synchronisé';
    const pages = f.pages ? ` · ${fmtInt(Math.round(f.pages))} p.` : '';
    return `<div class="lk-item">
      <span class="lk-ico">${icon(remote ? 'link' : 'doc')}</span>
      <span class="lk-main"><span class="lk-name">${esc(trunc(f.name, 44))}</span><span class="lk-meta">${kind} · ${when}${pages}</span></span>
      <span class="lk-acts">
        ${remote || linked ? `<button type="button" class="lk-btn strong" onclick="syncDoc('${k}')">Synchroniser</button>` : ''}
        <button type="button" class="lk-btn" onclick="reviewDocPlan('${k}')" title="Rouvrir l'aperçu : ce que contient le document, niveau de titre des chapitres, parties ignorées, nombre de pages">Revoir</button>
        ${open ? `<a class="lk-btn" href="${esc(open)}" target="_blank" rel="noopener noreferrer">Ouvrir</a>` : ''}
        <button type="button" class="lk-btn" onclick="forgetDoc('${k}')" title="Le Journal oublie ce document. Vos pages et votre plan restent tels quels.">${remote || linked ? 'Délier' : 'Oublier'}</button>
      </span></div>`;
  });
  setHTML('linkedList', rows.join(''));
  setText('linkedHint', hasAutoDocs()
    ? 'Les documents liés se mettent à jour tout seuls quand vous revenez sur cet onglet.'
    : 'Pour mettre à jour : déposez le fichier dans la page, collez votre texte, ou liez votre document par son lien (Google Docs, Dropbox).');
  setText('docxAddTitle', all.length ? 'Ajouter un document, ou en changer' : 'Choisir mon document');
  renderSyncLog();
}

/** Hébergeur d'un fichier lié, pour l'affichage. */
function linkHost(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return /dropbox/.test(h) ? 'Dropbox' : /githubusercontent|github/.test(h) ? 'GitHub' : h;
  } catch { return 'lien'; }
}

/** Page où ouvrir un fichier lié : pour Dropbox, la page de partage plutôt que le téléchargement. */
function linkPage(url) {
  try {
    const u = new URL(url);
    if (u.hostname === 'dl.dropboxusercontent.com') { u.hostname = 'www.dropbox.com'; u.searchParams.set('dl', '0'); }
    return u.toString();
  } catch { return ''; }
}

/** Le Journal oublie un document : le plan et les pages ne bougent pas, mais ils ne sont plus rattachés à lui. */
function forgetDoc(key) {
  if (!requireReady()) return;
  const f = state.docFiles[key];
  const lf = _linked.find(l => l.key === key);
  if (!f && !lf) return;
  const snap = snapshotState();
  const before = _linked.slice();
  delete state.docFiles[key];
  for (const ch of state.chapters) {
    if (ch.docFile === key) { delete ch.docFile; delete ch.docKey; }
    for (const ss of ch.subsections) if (ss.docFile === key) { delete ss.docFile; delete ss.docKey; }
  }
  state.docIgnore = state.docIgnore.filter(x => !x.startsWith(`${key}|`) && !x.startsWith(`+${key}|`));
  if (lf) { _linked = _linked.filter(l => l.key !== key); saveLinked(); }
  if (_pendingReview && _pendingReview.key === key) _pendingReview = null;
  _forceReview.delete(key);
  saveNow(true); // enregistrement complet : en fusion, une fiche retirée resterait sur le serveur
  render();
  renderLinkedList();
  updateWordButton();
  toast(`${trunc((f || lf).name, 30)} : document oublié. Votre plan et vos pages restent tels quels.`, '', {
    undo: true,
    action: { label: 'Annuler', fn: () => {
      _linked = before;
      saveLinked();
      restoreSnapshot(snap, 'Document rétabli');
      renderLinkedList();
      updateWordButton();
    } },
  });
}

/** Synchroniser un document précis de la liste. */
async function syncDoc(key) {
  if (!requireReady()) return;
  closeModal('docxModal');
  await syncAll({ manual: true, only: key });
}

/** « Revoir » un document déjà synchronisé : son aperçu se rouvrira à la prochaine lecture. */
async function reviewDocPlan(key) {
  if (!requireReady()) return;
  _forceReview.add(key);
  const f = state.docFiles[key];
  if (f && f.gdoc) { loadGoogleDoc(f.gdoc, f.name); return; }
  if (f && f.url) { loadLinkedFile(f.url, f.name, key); return; }
  const lf = _linked.find(l => l.key === key);
  if (lf) {
    try {
      let perm = await lf.handle.queryPermission({ mode: 'read' });
      if (perm !== 'granted') perm = await lf.handle.requestPermission({ mode: 'read' });
      if (perm === 'granted') { handleDocxFile(await lf.handle.getFile(), lf.handle); return; }
    } catch (e) { console.warn('Relecture :', e); }
  }
  if (f && f.name === PASTE_NAME) {
    setDocxError('');
    toast('Collez de nouveau votre texte : l\'aperçu du plan s\'ouvrira.', '', { duration: 6000 });
    const box = document.getElementById('docxPaste');
    if (box) box.focus();
    return;
  }
  toast(`Choisissez de nouveau ${f ? trunc(f.name, 30) : 'votre document'} : l'aperçu du plan s'ouvrira.`, '', { duration: 6000 });
  pickWordFile();
}

/* ---------- Documents liés par un lien de partage ----------
   Google Docs : un document partagé « à tous les utilisateurs disposant du lien » peut
   être téléchargé par le navigateur, sans compte ni serveur intermédiaire :
     • en .docx, pour le plan, le texte et la mise en page ;
     • en PDF, dont les signets donnent la page exacte de chaque titre.
   Dropbox (et tout lien direct lisible depuis une page web) : le fichier lui-même
   (Word, LibreOffice, PDF, LaTeX…), relu tel quel.
   On garde dans les données du compte (donc sur tous les appareils) de quoi relire le
   document (identifiant Google, ou adresse du fichier) et une signature légère, pour
   savoir s'il a changé sans tout relire. Voir links.js. */
let _gsyncing = false;
const _linkChecked = new Map(); // document → heure de la dernière vérification automatique
const LINK_EVERY = 3 * 60000;   // au plus une vérification automatique toutes les trois minutes par document

function gdocError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

async function gdocFetch(id, format, ms) {
  const ctl = new window.AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`https://docs.google.com/document/d/${id}/export?format=${format}`, { credentials: 'omit', cache: 'no-store', signal: ctl.signal });
    if (r.status === 404 || r.status === 410) throw gdocError('gdoc-404');
    if (r.status === 429 || r.status >= 500) throw gdocError('gdoc-busy');
    if (!r.ok || /text\/html/i.test(r.headers.get('content-type') || '')) throw gdocError('gdoc-private');
    return r;
  } catch (e) {
    if (e && e.code) throw e;
    // Document non partagé : Google renvoie vers sa page de connexion, que le navigateur refuse de lire
    throw gdocError(e && e.name === 'AbortError' ? 'gdoc-slow' : navigator.onLine === false ? 'gdoc-offline' : 'gdoc-private');
  } finally {
    clearTimeout(timer);
  }
}

/** Signature courte d'un texte (longueur + empreinte) : dit si le document a changé depuis la dernière fois. */
function textSignature(text) {
  return `${text.length.toString(36)}.${shortHash(text)}`;
}

async function gdocSignature(id) {
  const r = await gdocFetch(id, 'txt', 45000);
  return textSignature(await r.text());
}

/** Lit un Google Doc : renvoie l'analyse, de quoi nommer le document, et la signature de son texte. */
async function readGoogleDoc(id, knownName, knownSig) {
  const [docx, pdf, sig] = await Promise.all([
    gdocFetch(id, 'docx', 120000),
    gdocFetch(id, 'pdf', 150000).then(r => r.arrayBuffer()).catch(e => { console.warn('PDF Google Docs :', e); return null; }),
    knownSig ? Promise.resolve(knownSig) : gdocSignature(id).catch(() => null),
  ]);
  const name = dispositionName(docx.headers.get('content-disposition')).replace(/\.docx$/i, '') || knownName || 'Google Doc';
  const buf = await docx.arrayBuffer();
  // Sans le PDF (document très lourd, délai dépassé), la pagination est simulée d'après la mise en page
  const res = await parseDocumentFile(new File([buf], `${name}.docx`), pdf ? { pdf: new Uint8Array(pdf), planTitles: planTitles() } : { planTitles: planTitles() });
  return { res, file: { name, lastModified: null, size: buf.byteLength }, sig };
}

/** Requête vers un fichier lié (Dropbox, lien direct). Les refus du navigateur (lien privé, hôte qui n'autorise pas la lecture) donnent « link-private ». */
async function linkFetch(url, method, ms) {
  const ctl = new window.AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { method, credentials: 'omit', cache: 'no-store', signal: ctl.signal });
    if (r.status === 404 || r.status === 410) throw gdocError('link-404');
    if (r.status === 429 || r.status >= 500) throw gdocError('link-busy');
    if (!r.ok) throw gdocError('link-private');
    return r;
  } catch (e) {
    if (e && e.code) throw e;
    throw gdocError(e && e.name === 'AbortError' ? 'link-slow' : navigator.onLine === false ? 'link-offline' : 'link-private');
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Signature légère d'un fichier lié : sa taille, et sa date si le serveur la donne. Elle dit si le fichier
 * a changé sans le télécharger. null quand le serveur ne dit rien (il faudra alors le lire pour le savoir).
 */
async function linkSignature(url) {
  let r;
  try { r = await linkFetch(url, 'HEAD', 30000); }
  catch (e) {
    if (e && (e.code === 'link-404' || e.code === 'link-offline')) throw e;
    return null;                      // certains hôtes refusent HEAD : on lira le fichier
  }
  const len = r.headers.get('content-length');
  const stamp = (r.headers.get('last-modified') || '') + (r.headers.get('etag') || '');
  if (!len && !stamp) return null;
  return `${len || '?'}.${shortHash(stamp)}`;
}

/** Empreinte du contenu d'un fichier téléchargé (quand le serveur ne donne ni taille ni date). */
function bytesSignature(buf) {
  const u8 = new Uint8Array(buf);
  let h = 2166136261;
  for (let i = 0; i < u8.length; i++) { h ^= u8[i]; h = Math.imul(h, 16777619); }
  return `b${u8.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

/** Lit un fichier lié par son adresse. Un PDF est lu par morceaux (seul le texte est téléchargé, pas les images). */
async function readLinkedFile(url, knownName, knownSig, busy) {
  const guess = parseLink(url);
  const urlName = (guess.kind === 'file' && guess.name) || '';
  let sig = knownSig || await linkSignature(url);
  const opts = readOptions(knownName || urlName || 'votre document', busy);
  if (/\.pdf$/i.test(urlName)) {
    const res = await analyzePdf({ url }, opts);
    const size = sig ? parseInt(sig, 10) : null;
    return { res, file: { name: knownName || urlName, lastModified: null, size: Number.isFinite(size) ? size : null }, sig };
  }
  const r = await linkFetch(url, 'GET', 180000);
  const name = dispositionName(r.headers.get('content-disposition')) || knownName || urlName || 'document';
  const type = r.headers.get('content-type') || '';
  const buf = await r.arrayBuffer();
  // Une page web à la place du fichier : lien de consultation, ou partage qui demande de se connecter
  if (/text\/html/i.test(type) && !/\.html?$/i.test(name)) throw gdocError('link-format');
  if (!sig) sig = bytesSignature(buf);
  const res = await parseDocumentFile(new File([buf], name, { type }), opts);
  return { res, file: { name, lastModified: null, size: buf.byteLength }, sig };
}

/** Lie (ou relit) un document à partir du lien collé : Google Docs, Dropbox, lien direct. */
async function linkDocument(input) {
  if (!requireReady()) return;
  const el = document.getElementById('gdocUrl');
  const link = parseLink(typeof input === 'string' ? input : (el ? el.value : ''));
  if (link.error) { setDocxError(DOC_ERRORS[link.error] || DOC_ERRORS['link-bad']); return; }
  const ok = link.kind === 'gdoc' ? await loadGoogleDoc(link.id) : await loadLinkedFile(link.url, link.name, link.key);
  if (ok && el) el.value = '';
}

async function loadGoogleDoc(id, name) {
  setDocxError('');
  setDocxBusy(true);
  const busy = toast('Lecture de votre Google Doc…', '', { key: 'docx', duration: 150000 });
  try {
    const { res, file, sig } = await readGoogleDoc(id, name);
    if (!currentUser || !_loaded) return false;
    routeDocument(res, file, null, { key: gdocKey(id), gdoc: id, sig });
    return true;
  } catch (e) {
    console.error('Google Docs :', e);
    showDocxFailure(DOC_ERRORS[e && e.code] || 'Lecture impossible de ce document Google Docs.');
    return false;
  } finally {
    setDocxBusy(false);
    busy.remove();
  }
}

async function loadLinkedFile(url, name, key) {
  setDocxError('');
  setDocxBusy(true);
  const busy = toast(`Lecture de ${trunc(name || 'votre document', 36)}…`, '', { key: 'docx', duration: 300000 });
  try {
    const { res, file, sig } = await readLinkedFile(url, name, null, busy);
    if (!currentUser || !_loaded) return false;
    routeDocument(res, file, null, { key, url, sig });
    return true;
  } catch (e) {
    console.error('Lien :', e);
    showDocxFailure(DOC_ERRORS[e && e.code] || 'Lecture impossible de ce document.');
    return false;
  } finally {
    setDocxBusy(false);
    busy.remove();
  }
}

/**
 * Relit les documents liés par un lien. On commence par une vérification légère (texte seul pour Google Docs,
 * taille du fichier sinon) : si rien n'a changé depuis la dernière synchro, on s'arrête là.
 * Renvoie le bilan, ou null si rien n'a été tenté.
 */
async function syncRemoteDocs({ manual, only }) {
  const docs = linkEntries().filter(([k]) => !only || k === only);
  if (!docs.length || _gsyncing || !_loaded || !currentUser) return null;
  if (!manual && (isBusy() || navigator.onLine === false)) return null;
  _gsyncing = true;
  const out = { applied: 0, upToDate: 0, failed: 0, review: null, error: '' };
  let busy = null;
  try {
    for (const [key, f] of docs) {
      const now = Date.now();
      if (!manual && now - (_linkChecked.get(key) || 0) < LINK_EVERY) continue;
      _linkChecked.set(key, now);
      try {
        // Un fichier lié relu à la demande l'est toujours en entier : sa taille seule ne dit pas tout
        const sig = f.gdoc ? await gdocSignature(f.gdoc) : await linkSignature(f.url);
        if (!currentUser || !_loaded) return null;
        const light = f.gdoc || !manual;
        if (light && sig && !_forceReview.has(key) && f.pv === 2 && f.sig && sig === f.sig) { out.upToDate++; continue; }
        if (!manual && sig && _autoSkip.get(key) === sig) continue;                // synchro annulée par l'utilisateur
        if (manual && !busy) busy = toast(`Lecture de ${trunc(f.name, 30)}…`, '', { key: 'docx', duration: 300000 });
        const { res, file, sig: read } = f.gdoc ? await readGoogleDoc(f.gdoc, f.name, sig) : await readLinkedFile(f.url, f.name, sig, busy);
        if (!currentUser || !_loaded) return null;
        if (!f.gdoc && !sig && read && f.pv === 2 && read === f.sig && !_forceReview.has(key)) { out.upToDate++; continue; }
        const m = buildDocxModel(res, file, null, { key, gdoc: f.gdoc || null, url: f.url || null, sig: read || sig });
        if (_forceReview.delete(key)) { m.review = true; m.clean = false; }
        if (!m.clean) out.review = m;
        else {
          const r = applyDocx(m, true);
          if (r === 'same') out.upToDate++;
          else if (r) out.applied++;
        }
      } catch (e) {
        console.warn('Synchro du document lié', f.name, e);
        out.failed++;
        out.error = (e && e.code) || (f.gdoc ? 'gdoc-busy' : 'link-busy');
      }
    }
  } finally {
    _gsyncing = false;
    if (busy) busy.remove();
  }
  return out;
}

/** Relit tout ce qui peut l'être (fichiers liés à l'appareil, Google Docs), puis dit ce qu'il en est. */
async function syncAll({ manual, only }) {
  if (!_loaded || !currentUser) return;
  const a = _linked.length ? await syncLinked({ manual, only }) : null;
  const g = await syncRemoteDocs({ manual, only });
  const review = (g && g.review) || (a && a.review) || null;
  if (review && manual) openDocxPreview(review);
  else if (review) _pendingReview = review;
  const applied = (a ? a.applied : 0) + (g ? g.applied : 0);
  if (manual && !review && !applied) {
    if (g && g.failed) toast(DOC_ERRORS[g.error] || 'Lecture impossible du document lié.', 'warn', { key: 'docx', duration: 10000 });
    else if (a && a.refused && !a.upToDate) toast('Autorisez la lecture du fichier pour le synchroniser.', 'warn');
    else if (a || g) toast('Déjà à jour : votre document n\'a pas changé.', 'success', { key: 'docx' });
  }
  // Ce que ce tour a donné, pour l'état affiché sous le bouton (un tour qui n'a rien tenté ne dit rien)
  if (a || g) {
    const checked = (a ? a.applied + a.upToDate : 0) + (g ? g.applied + g.upToDate : 0);
    const before = `${_syncState.refused}|${_syncState.failed}`;
    if (a) _syncState.refused = a.refused;
    if (g) { _syncState.failed = g.failed; _syncState.error = g.error; }
    if (checked) _syncState.at = Date.now();
    if (manual || applied || review || before !== `${_syncState.refused}|${_syncState.failed}`) renderPrimary();
    else renderSyncCaption();
  } else if (manual) renderPrimary();
}

/** État de la synchro, sous le bouton : document, heure de la dernière vérification, ou ce qui bloque. */
function renderSyncCaption() {
  const cap = document.getElementById('tdCap');
  if (!cap || !hasAutoDocs()) return;
  cap.classList.remove('alert');
  if (_pendingReview) {
    cap.textContent = `Du nouveau dans ${trunc(_pendingReview.name, 24)} : vérifier`;
    cap.classList.add('alert');
    cap.title = 'Vérifier les nouvelles parties avant de les ajouter';
    return;
  }
  const names = _linked.map(l => l.name).concat(linkEntries().filter(([k]) => !_linked.some(l => l.key === k)).map(([, f]) => f.name));
  const what = names.length === 1 ? trunc(names[0], 26) : `${names.length} documents liés`;
  if (_syncState.refused) {
    cap.textContent = `${what} · lecture à autoriser`;
    cap.classList.add('alert');
    cap.title = 'Cliquez sur « Synchroniser » : votre navigateur vous demandera d\'autoriser la lecture du fichier';
    return;
  }
  if (_syncState.failed) {
    cap.textContent = `${what} · lien illisible pour l'instant`;
    cap.classList.add('alert');
    cap.title = DOC_ERRORS[_syncState.error] || 'Le document lié n\'a pas pu être lu.';
    return;
  }
  const at = _syncState.at ? new Date(_syncState.at) : null;
  cap.textContent = at ? `${what} · à jour à ${at.getHours()} h ${String(at.getMinutes()).padStart(2, '0')}` : what;
  cap.title = 'Vérifié tout seul tant que cette page est ouverte. Cliquez pour gérer vos documents, ou en changer.';
}

/**
 * Relit les fichiers liés. manual = clic de l'utilisateur (peut demander l'autorisation,
 * ouvre l'aperçu si besoin) ; sinon passage silencieux au retour sur l'onglet.
 */
async function syncLinked({ manual, only }) {
  if (!_linked.length || _syncing || !_loaded || !currentUser) return null;
  if (!manual) {
    if (Date.now() - _lastAutoSync < 15000 || isBusy()) return null;
    _lastAutoSync = Date.now();
  }
  _syncing = true;
  const out = { applied: 0, upToDate: 0, refused: 0, review: null };
  let retry = false;
  try {
    // 1. Autorisations d'abord, tant que le clic de l'utilisateur est « frais »
    const ready = [];
    for (const lf of _linked.filter(l => !only || l.key === only)) {
      let perm = 'denied';
      try {
        perm = await lf.handle.queryPermission({ mode: 'read' });
        if (perm !== 'granted' && manual) perm = await lf.handle.requestPermission({ mode: 'read' });
      } catch (e) { console.warn('Autorisation :', e); }
      if (perm === 'granted') ready.push(lf);
      else out.refused++;
    }
    // 2. Lecture des fichiers modifiés
    for (const lf of ready) {
      let file;
      try { file = await lf.handle.getFile(); }
      catch (e) {
        if (e && e.name === 'NotFoundError') {
          unlinkFile(lf.key, true);
          toast(`${trunc(lf.name, 30)} est introuvable (déplacé ou renommé ?). Choisissez-le à nouveau.`, 'warn', { duration: 7000 });
        }
        continue;
      }
      const known = state.docFiles[lf.key];
      if (known && known.pv === 2 && known.mtime === file.lastModified && known.size === file.size) { out.upToDate++; continue; }
      if (!manual) {
        if (known && known.mtime && file.lastModified < known.mtime) continue; // copie plus ancienne que la dernière synchro
        if (_autoSkip.get(lf.key) === file.lastModified) continue;             // synchro annulée par l'utilisateur
      }
      let m;
      try { m = buildDocxModel(await parseDocumentFile(file, { planTitles: planTitles() }), file, lf.handle); }
      catch (e) {
        console.warn('Synchro', lf.name, e);
        if (manual) toast(`Lecture impossible de ${trunc(lf.name, 30)}`, 'warn');
        // Fichier tout juste modifié et illisible : il était sans doute en cours d'écriture (un PDF qui se compile…)
        else if (Date.now() - file.lastModified < 20000) retry = true;
        continue;
      }
      if (!currentUser || !_loaded) return null;
      if (!m.clean) out.review = m;
      else {
        const r = applyDocx(m, true);
        if (r === 'same') out.upToDate++;
        else if (r) out.applied++;
      }
    }
  } finally {
    _syncing = false;
    if (retry) setTimeout(() => { _lastAutoSync = 0; syncAll({ manual: false }); }, 3000);
  }
  return out;
}

/* ---------- Déposer le fichier n'importe où dans la page ---------- */

function initGlobalDrop() {
  const overlay = document.getElementById('dropOverlay');
  if (!overlay) return;
  let depth = 0;
  const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  const active = () => _loaded && !document.getElementById('appScreen').classList.contains('hidden');
  window.addEventListener('dragenter', e => {
    if (!hasFiles(e) || !active()) return;
    depth++;
    overlay.classList.add('show');
  });
  window.addEventListener('dragover', e => { if (hasFiles(e) && active()) e.preventDefault(); });
  window.addEventListener('dragleave', e => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) overlay.classList.remove('show');
  });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.classList.remove('show');
    if (!active()) return;
    const files = [...(e.dataTransfer.files || [])];
    const file = files[0];
    if (!file) return;
    if (/\.json$/i.test(file.name)) { toast('Pour restaurer une sauvegarde : Menu, puis « Importer une sauvegarde ».', ''); return; }
    // À demander pendant l'évènement : la référence permettra de relire le fichier plus tard
    const dti = [...(e.dataTransfer.items || [])].filter(it => it.kind === 'file');
    const waits = files.map((f, i) => (canLink() && dti[i] && typeof dti[i].getAsFileSystemHandle === 'function'
      ? dti[i].getAsFileSystemHandle().catch(() => null) : Promise.resolve(null)));
    Promise.all(waits).then(hs => handleDocxFiles(files.map((f, i) => ({ file: f, handle: hs[i] && hs[i].kind === 'file' ? hs[i] : null }))));
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncAll({ manual: false });
});
window.addEventListener('focus', () => syncAll({ manual: false }));
// Tant que le Journal est à l'écran, il revérifie les documents liés : un fichier enregistré dans Word est pris
// en compte ici en quelques secondes, sans changer de fenêtre. Un fichier lié à l'appareil ne coûte qu'un coup
// d'œil à sa date ; un document lié par un lien est revérifié toutes les trois minutes au plus (LINK_EVERY).
const WATCH_EVERY = 20000;
setInterval(() => {
  if (document.visibilityState === 'visible' && _loaded && currentUser && hasAutoDocs()) syncAll({ manual: false });
}, WATCH_EVERY);

/* ============================================================
   EXPORT / IMPORT (JSON portability — independent of Firestore)
============================================================ */
function exportData() {
  const data = { ...serializeState(), exportedAt: new Date().toISOString(), app: 'Le Journal de Bord ' + APP_VERSION };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `these-${todayKey()}.json`);
  toast('Sauvegarde exportée.', 'success');
}

function importData(input) {
  const file = input.files[0];
  if (!file) return;
  if (!requireReady()) { input.value = ''; return; }
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const p = JSON.parse(e.target.result);
      if (!Array.isArray(p.chapters)) throw new Error('invalid');
      if (!confirm('Remplacer votre plan actuel par celui de ce fichier ?')) return;
      const next = normalizeState(p);
      // Sauvegarde d'une ancienne version (sans journal) : on garde l'historique actuel
      if (!isObj(p.activity)) next.activity = state.activity;
      if (!isObj(p.journal)) next.journal = state.journal;
      if (!p.trackedSince) next.trackedSince = state.trackedSince;
      state = next;
      syncTitleInput();
      saveNow(true);
      render();
      toast('Sauvegarde importée.', 'success');
    } catch { toast('Ce fichier n\'est pas une sauvegarde du Journal.', 'warn'); }
  };
  reader.readAsText(file);
  input.value = '';
}

/* ============================================================
   RESET
============================================================ */
function confirmReset() {
  if (!requireReady()) return;
  if (!confirm('Effacer TOUTES les données ?\n\nChapitres, progression, journal, dates : tout sera supprimé.\nCette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : vraiment tout effacer ?')) return;
  state = defaultState();
  state.trackedSince = todayKey();
  const dl = document.getElementById('dbDeadline');
  if (dl) dl.dataset.mode = '';
  syncTitleInput();
  saveNow(true);
  render();
  toast('Tout est effacé. Une vraie page blanche, cette fois.', '');
}

/* ============================================================
   SUPPRESSION DU COMPTE — droit à l'effacement
   Ordre : la fiche publique, puis le journal, puis le compte lui-même
   (dans l'autre sens, les données resteraient en base sans plus
   personne pour avoir le droit de les effacer).
============================================================ */
const RECENT_LOGIN_MS = 4 * 60 * 1000; // Firebase exige une connexion de moins de 5 minutes pour supprimer un compte

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

/** Efface ce que cet appareil garde pour ce compte : réglages, copie de secours, fichiers Word liés. */
function forgetDevice(uidToForget) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith('jdb_') && k.includes(uidToForget)) localStorage.removeItem(k);
    }
  } catch { /* ignoré */ }
  if (canLink()) filesSet(uidToForget, []).catch(() => {});
}

async function deleteAccount() {
  if (!currentUser) return;
  const user = currentUser;
  if (!navigator.onLine) { toast('Il faut être en ligne pour supprimer le compte.', 'warn'); return; }
  const last = Date.parse((user.metadata && user.metadata.lastSignInTime) || '');
  if (Number.isFinite(last) && Date.now() - last > RECENT_LOGIN_MS) {
    alert('Par sécurité, supprimer un compte demande une connexion toute récente.\n\nReconnectez-vous, puis choisissez de nouveau « Supprimer mon compte ».');
    try { await signOut(auth); } catch { /* ignoré */ }
    return;
  }
  if (!confirm('Supprimer définitivement votre compte ?\n\nVotre plan, vos pages, votre journal et votre fiche dans la promo seront effacés. C\'est irréversible.\n\nPour garder une copie : menu, « Exporter une sauvegarde ».')) return;
  const typed = prompt('Dernière vérification : tapez SUPPRIMER pour confirmer.');
  if (String(typed || '').trim().toUpperCase() !== 'SUPPRIMER') { toast('Suppression annulée. Rien n\'a changé.', ''); return; }

  setDataLoading(true);
  clearTimeout(_saveTimer);
  _saveTimer = null;
  const ref = userDocRef();
  try {
    await withTimeout(promo.purge(), 12000);
    stopSync();
    await withTimeout(deleteDoc(ref), 12000);
  } catch (e) {
    console.error('Suppression des données :', e);
    setDataLoading(false);
    toast('Suppression impossible pour le moment : vérifiez votre connexion et réessayez.', 'warn');
    if (!_unsub) startSync();
    return;
  }
  forgetDevice(user.uid);
  setDataLoading(false);
  try {
    await deleteUser(user);
    toast('Compte supprimé. Bonne route, et bonne soutenance.', '', { duration: 7000 });
  } catch (e) {
    console.error('Suppression du compte :', e);
    alert(e && e.code === 'auth/requires-recent-login'
      ? 'Vos données sont effacées.\n\nPour supprimer aussi le compte lui-même, reconnectez-vous puis choisissez de nouveau « Supprimer mon compte ».'
      : 'Vos données sont effacées, mais le compte lui-même n\'a pas pu être supprimé. Reconnectez-vous et réessayez.');
    try { await signOut(auth); } catch { /* ignoré */ }
  }
}

/* ============================================================
   DOCUMENT TITLE
============================================================ */
function updateDocumentTitle(val) {
  state.documentTitle = String(val).replace(/\s*\n\s*/g, ' ').slice(0, 200);
  fitTitle();
  saveDebounced();
}

/* ============================================================
   MODÈLES DE PLAN
============================================================ */
function openTemplateModal() {
  if (!requireReady()) return;
  openModal('templateModal');
}

function applyTemplate(idx) {
  const tpl = PLAN_TEMPLATES[idx];
  if (!tpl || !requireReady()) return;
  closeModal('templateModal');
  const wasEmpty = state.chapters.length === 0;
  const n = tpl.chapters.length;
  const total = tpl.chapters.reduce((s, c) => s + c.targetPages, 0);
  if (!wasEmpty && !confirm(
    `Ajouter le plan "${tpl.name}" à la suite de votre plan actuel ?\n\n${n} chapitres · ${total} pages objectif`
  )) return;
  const snap = snapshotState();
  state.chapters.push(...tpl.chapters.map(ch => ({
    id:           uid(),
    title:        ch.title,
    targetPages:  ch.targetPages,
    writtenPages: 0,
    expanded:     true,
    subsections:  [],
  })));
  if (wasEmpty) startSetup();
  saveNow();
  render();
  toast(`Plan « ${tpl.name} » : ${n} chapitres, ${total} pages. Renommez et ajustez à votre guise.`, 'success', {
    undo: true,
    action: { label: 'Annuler', fn: () => {
      if (wasEmpty) lsSet(setupKey(), '');
      restoreSnapshot(snap, 'Modèle retiré');
    } },
  });
}

/* ============================================================
   DRAG & DROP — SortableJS
   L'instance du conteneur de chapitres est créée une seule fois
   (le conteneur persiste) ; celles des sous-sections sont
   recréées à chaque rendu (leurs listes sont régénérées).
============================================================ */
let _chaptersSortable = null;

function initSortable() {
  if (!window.Sortable) return;
  const container = document.getElementById('chaptersContainer');
  if (!container || container.querySelector('.empty-state')) return;

  const sortableOpts = {
    animation:           150,
    ghostClass:          'sortable-ghost',
    dragClass:           'sortable-drag',
    delay:               0,
    fallbackTolerance:   3,
    touchStartThreshold: 3,
    swapThreshold:       0.65,
  };

  if (!_chaptersSortable) {
    _chaptersSortable = new Sortable(container, {
      ...sortableOpts,
      handle: '.ch-drag-handle',
      onEnd(evt) {
        if (evt.oldIndex === evt.newIndex) return;
        const moved = state.chapters.splice(evt.oldIndex, 1)[0];
        state.chapters.splice(evt.newIndex, 0, moved);
        saveDebounced();
        updateDashboard();
      },
    });
  }

  state.chapters.forEach(ch => {
    const list = document.getElementById('ssl-' + ch.id);
    if (!list) return;
    new Sortable(list, {
      ...sortableOpts,
      handle: '.ss-drag-handle',
      onEnd(evt) {
        if (evt.oldIndex === evt.newIndex) return;
        const chapter = findCh(ch.id);
        if (!chapter) return;
        const moved = chapter.subsections.splice(evt.oldIndex, 1)[0];
        chapter.subsections.splice(evt.newIndex, 0, moved);
        saveDebounced();
      },
    });
  });
}

/* ============================================================
   PARTAGE — une image à publier (post carré ou story)
   Deux cartes possibles : mon avancée, ou ma grille de bingo.
   L'image est préparée d'abord, puis partagée d'un geste :
   Safari exige que navigator.share() suive directement un clic.
============================================================ */
const H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const H2C_SRI = 'sha512-BNaRQnYJYiPSqHHDb58B0yaPfCu+Wgds8Gp/gU33kqBtgNS4tSPHuGibyoeqMV/TJlSKda6FXzoEyYGjTe+vXA==';
let _shareFormat = 'post';
let _shareMode   = 'progress'; // 'progress' | 'bingo'
let _shareBlob   = null;
let _shareUrl    = null;
let _shareToken  = 0;

function openShareModal(mode) {
  if (!requireReady()) return;
  _shareMode = mode === 'bingo' ? 'bingo' : 'progress';
  setText('shareTitle', _shareMode === 'bingo' ? 'Partager ma grille' : 'Partager mon avancée');
  setText('shareSub', _shareMode === 'bingo'
    ? 'Une image à publier en post ou en story. À comparer avec celles des autres : la grille est la même pour tout le monde.'
    : 'Une image à publier en post ou en story. Seuls vos chiffres apparaissent, jamais votre sujet.');
  openModal('shareModal');
  setShareFormat(_shareFormat);
}

function setShareFormat(f) {
  _shareFormat = f === 'story' ? 'story' : 'post';
  document.querySelectorAll('#shareSeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.format === _shareFormat));
  renderShareImage();
}

function fillShareCard() {
  const { total, written } = totals();
  const pct = total === 0 ? 0 : Math.min(100, Math.round(written / total * 100));
  const today = todayKey();
  const story = _shareFormat === 'story';
  setText('igpPct', pct + '\u00A0%');
  const fill = document.getElementById('igpFill');
  fill.style.width = pct + '%';
  fill.style.display = pct ? '' : 'none';
  setText('igpMessage', total > 0 ? `${written} pages rédigées sur ${total}` : '');
  setText('igpGrade', gradeFor(pct));
  setText('igpFooter', plain(getFunnyCaption(pct)));
  const s = streak(state, today);
  const wk = sumRange(state.activity, mondayOf(today), today);
  const bits = [];
  if (s.count >= 2) bits.push(`${s.count} jours d'affilée`);
  if (wk > 0) bits.push(`+${fmt1(wk)} pages cette semaine`);
  const streakEl = document.getElementById('igpStreak');
  streakEl.textContent = bits.join(' · ');
  streakEl.classList.toggle('hidden', !bits.length);
  // L'étagère, sans les titres : le sujet reste privé
  setHTML('igpShelf', shareShelfHTML(shelfModel(), {
    width: story ? 880 : 900, height: story ? 330 : 190, plant: plantImgHTML(s.count, story ? 190 : 130),
  }));
}

async function renderShareImage() {
  const token = ++_shareToken;
  const preview = document.getElementById('sharePreview');
  preview.innerHTML = '<div class="spinner"></div>';
  document.getElementById('shareDownloadBtn').disabled = true;
  document.getElementById('shareNativeBtn').classList.add('hidden');
  if (!window.html2canvas) {
    // Chargé seulement au moment du partage : 200 Ko de moins à chaque ouverture de l'app
    try { await loadScript(H2C_URL, H2C_SRI); }
    catch {
      if (token === _shareToken) preview.innerHTML = '<p class="share-err">Impossible de préparer l\'image : vérifiez votre connexion.</p>';
      return;
    }
    if (token !== _shareToken) return;
  }
  const card = document.getElementById(_shareMode === 'bingo' ? 'bingoCard' : 'igPostCard');
  if (_shareMode === 'bingo') fillBingoCard(); else fillShareCard();
  card.classList.toggle('story', _shareFormat === 'story');
  try {
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 150));
    const h = _shareFormat === 'story' ? 1920 : 1080;
    const canvas = await window.html2canvas(card, {
      width: 1080, height: h, scale: 1, useCORS: true, backgroundColor: '#122423', logging: false,
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (token !== _shareToken || !blob) return; // un autre format a été demandé entre-temps
    _shareBlob = blob;
    if (_shareUrl) URL.revokeObjectURL(_shareUrl);
    _shareUrl = URL.createObjectURL(blob);
    preview.innerHTML = `<img src="${_shareUrl}" alt="Aperçu de l'image à partager" class="${_shareFormat}">`;
    document.getElementById('shareDownloadBtn').disabled = false;
    const file = new File([blob], shareFileName(), { type: 'image/png' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    document.getElementById('shareNativeBtn').classList.toggle('hidden', !canShare);
  } catch (err) {
    console.error('html2canvas error:', err);
    if (token === _shareToken) preview.innerHTML = '<p class="share-err">L\'image n\'a pas pu être préparée.</p>';
  }
}

function shareFileName() {
  const base = _shareMode === 'bingo' ? 'bingo-du-doctorant' : 'mon-avancement-these';
  return `${base}${_shareFormat === 'story' ? '-story' : ''}.png`;
}

function downloadShareImage() {
  if (!_shareBlob) return;
  downloadBlob(_shareBlob, shareFileName());
  toast('Image téléchargée. Il ne reste qu\'à la publier.', 'success');
}

async function shareNative() {
  if (!_shareBlob) return;
  const file = new File([_shareBlob], shareFileName(), { type: 'image/png' });
  const text = _shareMode === 'bingo'
    ? `Mon bingo du doctorant de la semaine. Le vôtre : ${APP_URL}`
    : `J'avance dans ma thèse avec Le Journal de Bord : ${APP_URL}`;
  try {
    await navigator.share({ files: [file], text });
  } catch (e) {
    if (e && e.name !== 'AbortError') { console.warn(e); downloadShareImage(); }
  }
}

/* ============================================================
   LE BINGO DE LA SEMAINE — neuf cases, les mêmes pour tout le monde
   (les cases cochées restent sur l'appareil)
============================================================ */
const bingoKey = () => `jdb_bingo_${(currentUser && currentUser.uid) || 'x'}_${isoWeek().id}`;

function bingoTicks() {
  try { return JSON.parse(lsGet(bingoKey()) || '[]').filter(i => Number.isInteger(i) && i >= 0 && i < 9); }
  catch { return []; }
}

function openBingo() {
  setText('bgKicker', `Semaine ${isoWeek().week}`);
  renderBingo();
  openModal('bingoModal');
}

function renderBingo() {
  const grid  = bingoGrid(isoWeek().id);
  const ticks = new Set(bingoTicks());
  setHTML('bingoGrid', grid.map((t, i) =>
    `<button type="button" class="bingo-cell${ticks.has(i) ? ' on' : ''}" aria-pressed="${ticks.has(i)}" onclick="toggleBingo(${i})">${esc(t)}</button>`).join(''));
  setText('bingoScore', bingoScore([...ticks]).text);
}

/** Le bingo en petit, sur le tableau de bord : la grille de la semaine et où l'on en est. */
function renderBingoTeaser() {
  const ticks = new Set(bingoTicks());
  setText('btWeek', `semaine ${isoWeek().week}`);
  setHTML('btGrid', Array.from({ length: 9 }, (_, i) => `<i${ticks.has(i) ? ' class="on"' : ''}></i>`).join(''));
  setText('btScore', bingoScore([...ticks]).text);
}

function toggleBingo(i) {
  const ticks = new Set(bingoTicks());
  if (ticks.has(i)) ticks.delete(i); else ticks.add(i);
  lsSet(bingoKey(), JSON.stringify([...ticks]));
  renderBingo();
  renderBingoTeaser();
}

function shareBingo() {
  closeModal('bingoModal');
  openShareModal('bingo');
}

function fillBingoCard() {
  const w = isoWeek();
  const ticks = new Set(bingoTicks());
  setText('bcKicker', `Semaine ${w.week}`);
  setHTML('bcGrid', bingoGrid(w.id).map((t, i) => `<div class="bc-cell${ticks.has(i) ? ' on' : ''}">${esc(t)}</div>`).join(''));
  const sc = bingoScore([...ticks]);
  setText('bcScore', `${sc.n} case${sc.n > 1 ? 's' : ''} sur 9${sc.lines ? ' · bingo !' : ''}`);
}

/* ============================================================
   NOTE DE BAS DE PAGE DU JOUR
============================================================ */
function showFootnote(text) {
  setText('crystalQuote', text);
}

function nextQuote() {
  showFootnote(randomFootnote(document.getElementById('crystalQuote').textContent));
}

/* ============================================================
   LES DEUX ESPACES — « Ma thèse » et « La promo »
============================================================ */
let _view = 'these';

function setView(v) {
  _view = v === 'promo' && promo.isAvailable() ? 'promo' : 'these';
  document.getElementById('viewThese').classList.toggle('hidden', _view !== 'these');
  document.getElementById('viewPromo').classList.toggle('hidden', _view !== 'promo');
  // La barre latérale (ordinateur) et les onglets du bas (téléphone) suivent
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === _view));
  document.body.classList.toggle('view-promo', _view === 'promo');
  closeMenu();
  window.scrollTo(0, 0);
  if (_view === 'promo') promo.open();
}

/** Ce que je montre à la promo : des chiffres, jamais le contenu. */
function publicStats() {
  const t = totals();
  const today = todayKey();
  const pct = t.total ? Math.min(100, Math.round((t.written / t.total) * 100)) : 0;
  const weekPages = clamp(Math.round(sumRange(state.activity, mondayOf(today), today) * 10) / 10, 0, 300);
  const heat = {};
  const from = addDays(mondayOf(today), -7 * 11);
  for (const [k, v] of Object.entries(state.activity)) {
    if (k >= from && k <= today && v > 0) heat[k] = Math.min(99, Math.round(v * 10) / 10);
  }
  return { pct, weekPages, streak: streak(state, today).count, heat };
}

const promo = createPromo({
  db,
  user: () => currentUser,
  stats: publicStats,
  heatmap: (heat, weeks) => heatmapHTML(heat, {}, { weeks, today: todayKey(), goal: 1, since: null }),
  ui: { esc, fmt1, relDay, setText, setHTML, toast, openModal, closeModal },
  // La promo n'apparaît que si elle est ouverte (règles de sécurité en place)
  onChange(available, member) {
    document.getElementById('viewTabs').classList.toggle('hidden', !available);
    document.getElementById('tabPromo').classList.toggle('hidden', !available);
    document.getElementById('promoTeaser').classList.toggle('hidden', !available);
    document.getElementById('menuPromo').classList.toggle('hidden', !available);
    document.getElementById('wnPromo').classList.toggle('hidden', !available);
    document.getElementById('logShareRow').classList.toggle('hidden', !(available && member));
    if (!available && _view === 'promo') setView('these');
    if (available && !member) introducePromo();
  },
});

/**
 * La promo vient d'ouvrir pour quelqu'un qui a déjà lu l'annonce de mise à jour : on le lui signale, une fois.
 * (Pas le premier jour : on laisse d'abord créer son plan.)
 */
function introducePromo() {
  if (!currentUser || state.chapters.length === 0) return;
  const key = 'jdb_promo_intro_' + currentUser.uid;
  if (lsGet(key)) return;
  lsSet(key, '1');
  if (lsGet(WHATSNEW_KEY) !== WHATSNEW_VER) return; // l'annonce de mise à jour va la présenter
  toast('La promo est ouverte : voyez où en sont les autres doctorant·es.', '', {
    key: 'promo-intro', duration: 10000, action: { label: 'Découvrir', fn: () => setView('promo') },
  });
}

function onStatsChanged() { promo.publishSoon(); }

// Démarrage hors ligne : on redemande si la promo est ouverte dès que la connexion revient
window.addEventListener('online', () => { if (currentUser && _loaded && promo.isUnknown()) promo.init(); });

/* ============================================================
   BILAN IMPRIMABLE — comité de suivi (CSI), rendez-vous direction
============================================================ */
function printReport() {
  if (!requireReady()) return;
  document.getElementById('printReport').innerHTML = buildReportHTML();
  if (document.getElementById('mobileMenu').classList.contains('open')) toggleMobileMenu();
  setTimeout(() => window.print(), 60);
}

function buildReportHTML() {
  const today = todayKey();
  const t = totals();
  const fc = forecast(state, t, today);
  const prog = t.total ? Math.min(100, Math.round((t.written / t.total) * 100)) : 0;
  const sch = currentSchedule(fc);
  const s = streak(state, today);
  const best = bestStreak(state, today);
  const statusTxt = { ontrack: 'Dans les temps', behind: 'En retard sur le rythme', overdue: 'Échéance de rédaction dépassée', done: 'Rédaction terminée', nopace: 'Rythme à établir', none: 'Pas d\'échéance fixée' }[fc.status] || '';

  const rows = state.chapters.map(ch => {
    const st = chapterStats(ch);
    const status = ch.review
      ? REVIEW_PRINT[ch.review] + (ch.review === 'sent' && ch.reviewDate ? ` (depuis ${Math.max(0, diffDays(ch.reviewDate, today))} j)` : '')
      : (st.prog >= 100 ? 'Rédigé' : st.prog > 0 ? 'En cours' : 'À écrire');
    const sub = ch.subsections.map(ss => `<tr class="pr-sub"><td>${esc(ss.title)}</td><td>${ss.writtenPages || 0}</td><td>${ss.targetPages || 0}</td><td>${ssProgress(ss)} %</td><td></td><td></td></tr>`).join('');
    return `<tr><td><b>${esc(ch.title)}</b></td><td>${st.wP}</td><td>${st.tP}</td><td>${st.prog} %</td><td>${status}</td><td>${sch[ch.id] ? fmtDateShort(sch[ch.id]) : ''}</td></tr>${sub}`;
  }).join('');

  const weeks = [];
  for (let w = 11; w >= 0; w--) {
    const mon = addDays(mondayOf(today), -7 * w);
    const sun = addDays(mon, 6);
    weeks.push({ mon, pages: sumRange(state.activity, mon, sun < today ? sun : today) });
  }
  const maxW = Math.max(1, ...weeks.map(w => w.pages));
  // La valeur est posée juste au-dessus de sa barre (85 % de la hauteur au plus, pour lui laisser la place)
  const bars = weeks.map(w => `<div class="pr-bar"><span class="pr-bar-val">${w.pages ? fmt1(w.pages) : ''}</span><div class="pr-bar-fill" style="height:${Math.max(0, (w.pages / maxW) * 85)}%"></div><span class="pr-bar-lbl">${parseDay(w.mon).getDate()}/${parseDay(w.mon).getMonth() + 1}</span></div>`).join('');

  const since = addDays(today, -30);
  const notes = Object.keys(state.journal).filter(k => k >= since && k <= today).sort().reverse()
    .flatMap(k => state.journal[k].filter(e => e.n).map(e => `<li><b>${fmtDateShort(k)}</b> : ${esc(e.n)}</li>`));

  return `
  <div class="pr-head"><span>Le Journal de Bord</span><span>Bilan au ${formatDateFr(today)}</span></div>
  <h1>${esc(state.documentTitle || 'Mon projet de thèse')}</h1>
  <p class="pr-who">${esc(currentUser ? (currentUser.displayName || currentUser.email) : '')}</p>
  <div class="pr-kpis">
    <div><b>${prog} %</b><span>avancement</span></div>
    <div><b>${t.written} / ${t.total}</b><span>pages rédigées</span></div>
    <div><b>${fc.pace.forecast > 0 ? fmt1(fc.pace.forecast * 7) : '—'}</b><span>pages par semaine</span></div>
    <div><b>${fc.projectedEnd ? fmtDateShort(fc.projectedEnd) : (fc.status === 'done' ? 'Terminé' : '—')}</b><span>fin estimée</span></div>
  </div>
  <table class="pr-dates"><tbody>
    <tr><th>Début de la rédaction</th><td>${state.startDate ? formatDateFr(state.startDate) : 'Non renseigné'}</td></tr>
    <tr><th>${state.deadline && state.deadlineMonth ? 'Dépôt visé' : 'Date de dépôt'}</th><td>${state.deadline ? (state.deadlineMonth ? fmtMonthYear(state.deadline) : formatDateFr(state.deadline)) : 'Non renseignée'}</td></tr>
    ${fc.writingEnd ? `<tr><th>Fin de rédaction visée</th><td>${formatDateFr(fc.writingEnd)}</td></tr>` : ''}
    ${fc.perWeek ? `<tr><th>Rythme nécessaire</th><td>${fmt1(fc.perWeek)} pages par semaine</td></tr>` : ''}
    <tr><th>Situation</th><td>${statusTxt}${fc.margin != null ? ` (${fc.margin >= 0 ? `${fc.margin} j d'avance` : `${Math.abs(fc.margin)} j de retard`})` : ''}</td></tr>
  </tbody></table>
  <h2>Plan et avancement</h2>
  ${state.chapters.length ? `<table class="pr-table"><thead><tr><th>Partie</th><th>Rédigé</th><th>Objectif</th><th>%</th><th>Statut</th><th>Échéance proposée</th></tr></thead><tbody>${rows}</tbody></table>` : '<p>Aucun chapitre pour le moment.</p>'}
  <h2>Régularité</h2>
  <p>Série actuelle : <b>${s.count} jour${s.count > 1 ? 's' : ''}</b> · meilleure série : <b>${best} jour${best > 1 ? 's' : ''}</b>${state.trackedSince ? ` · suivi depuis le ${formatDateFr(state.trackedSince)}` : ''}</p>
  <div class="pr-bars">${bars}</div>
  <p class="pr-caption">Pages rédigées par semaine (12 dernières semaines)</p>
  ${notes.length ? `<h2>Notes du journal (30 derniers jours)</h2><ul class="pr-notes">${notes.slice(0, 25).join('')}</ul>` : ''}
  <p class="pr-foot">Généré avec Le Journal de Bord · lejournaldebord.org</p>`;
}

/* ============================================================
   MENU — barre latérale toujours visible sur ordinateur ;
   sur téléphone, un panneau ouvert par l'onglet « Menu ».
============================================================ */
function toggleMobileMenu() {
  const menu    = document.getElementById('mobileMenu');
  const overlay = document.getElementById('mobileOverlay');
  const btn     = document.querySelector('.hamburger-btn');
  const isOpen  = menu.classList.contains('open');
  menu.classList.toggle('open', !isOpen);
  overlay.classList.toggle('show', !isOpen);
  if (btn) btn.setAttribute('aria-expanded', String(!isOpen));
}

/** Exécute une action du menu puis le referme. */
function menuDo(fn) {
  const wasOpen = document.getElementById('mobileMenu').classList.contains('open');
  closeMenu();
  // Sur téléphone, le panneau vient de se refermer : le focus va sur l'onglet « Menu »,
  // c'est là qu'on le retrouvera en fermant la fenêtre qui s'ouvre.
  const btn = document.querySelector('.hamburger-btn');
  if (wasOpen && btn) btn.focus({ preventScroll: true });
  const f = window[fn];
  if (typeof f === 'function') f();
}

function closeMenu() {
  if (document.getElementById('mobileMenu').classList.contains('open')) toggleMobileMenu();
}

/* ============================================================
   NOUVEAUTÉS & ACTIONS PAR URL
============================================================ */
function openWhatsNew() { openModal('whatsNewModal'); }

/** Confidentialité : lisible avant même d'avoir un compte ; les actions sur le compte n'apparaissent que connecté·e. */
function openPrivacy() {
  document.getElementById('pvRights').classList.toggle('hidden', !currentUser);
  openModal('privacyModal');
}

function closeWhatsNew(next) {
  closeModal('whatsNewModal');
  if (next === 'project') openProjectModal();
}

/** ?action=log (raccourci d'app, rappel d'agenda) ouvre directement « J'ai écrit » ; ?p=… ouvre une fiche. */
function handleUrlAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  const fellow = cleanId(params.get('p'));
  const incoming = params.has('shared') || params.has('open');   // document partagé ou ouvert avec l'application : voir handleIncoming
  if (!action && !fellow && !incoming) return;
  if (incoming) _urlIntent = true;
  params.delete('action');
  params.delete('p');
  params.delete('shared');
  params.delete('open');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  if (action === 'log') { _urlIntent = true; setTimeout(openLogModal, 300); }
  if (action === 'sync') { _urlIntent = true; setTimeout(openDocxModal, 300); } // point d'étape de l'agenda
  // Lien de fiche ouvert en étant connecté·e : la fiche s'affiche dès que la promo répond
  if (fellow) { _urlIntent = true; promo.whenReady().then(ok => { if (ok) promo.openFellow(fellow); }); }
}

/* ============================================================
   DOCUMENT REÇU D'AILLEURS — application installée
   « Partager » (téléphone) : le service worker met le fichier, ou
   le lien, de côté ; la page le reprend ici.
   « Ouvrir avec » (ordinateur, Chrome ou Edge) : le système remet
   le fichier lui-même, qui reste lié comme s'il avait été choisi.
   Dans les deux cas, rien ne quitte l'appareil.
============================================================ */
const SHARE_CACHE = 'journal-de-bord-partage';   // même nom que dans sw.js
let _launch = null;       // fichiers remis par « Ouvrir avec », en attente du chargement du journal
let _incoming = false;    // une réception est déjà en cours

/** Ce que le service worker a mis de côté : { files, text }, ou null. Lu une seule fois. */
async function takeShared() {
  if (!('caches' in window)) return null;
  try {
    if (!(await caches.has(SHARE_CACHE))) return null;
    const cache = await caches.open(SHARE_CACHE);
    const files = [];
    let text = '';
    for (const req of await cache.keys()) {
      const res = await cache.match(req);
      if (!res) continue;
      if (/\/texte$/.test(new URL(req.url).pathname)) { text = await res.text(); continue; }
      const blob = await res.blob();
      let name = '';
      try { name = decodeURIComponent(res.headers.get('X-Nom') || ''); } catch { /* nom mal encodé */ }
      files.push(new File([blob], name || 'document', { type: blob.type, lastModified: Number(res.headers.get('X-Date')) || Date.now() }));
    }
    await caches.delete(SHARE_CACHE);
    return files.length || text.trim() ? { files, text: text.trim() } : null;
  } catch { return null; }
}

async function handleIncoming() {
  if (!_loaded || !currentUser || _incoming) return;
  _incoming = true;
  try {
    // « Ouvrir avec »
    const handles = _launch;
    _launch = null;
    if (handles && handles.length) {
      _urlIntent = true;
      await handleDocxFiles(await Promise.all(handles.map(async h => ({ file: await h.getFile(), handle: h }))));
      return;
    }
    // « Partager »
    const shared = await takeShared();
    if (!shared) return;
    _urlIntent = true;
    if (shared.files.length) { await handleDocxFiles(shared.files); return; }
    // Un lien (Google Docs, Dropbox…) : on le lie ; un texte : on le lit comme un texte collé
    const link = parseLink(shared.text);
    if (!link.error || shared.text.length < 400) { openDocxModal(); await linkDocument(shared.text); }
    else importPasted('', shared.text);
  } catch (e) {
    console.error('Document reçu :', e);
    toast('Ce document n\'a pas pu être ouvert. Choisissez-le depuis « Synchro du document ».', 'warn');
  } finally {
    _incoming = false;
  }
}

if ('launchQueue' in window && window.launchQueue && typeof window.launchQueue.setConsumer === 'function') {
  window.launchQueue.setConsumer(params => {
    if (!params || !params.files || !params.files.length) return;
    _launch = [...params.files];
    handleIncoming();
  });
}

/* ============================================================
   PWA — INSTALLATION
   - Android/Desktop : intercepte beforeinstallprompt, stocke l'event,
     affiche le bouton ; au clic → .prompt()
   - iOS Safari      : détecte userAgent + standalone absent → affiche
     le bouton ; au clic → ouvre la modale d'instructions
   - appinstalled    : cache définitivement les boutons une fois installé
============================================================ */
let _deferredInstallPrompt = null;

function _showInstallButtons() {
  document.getElementById('btnInstallMobile')?.classList.remove('hidden');
}

function _hideInstallButtons() {
  document.getElementById('btnInstallMobile')?.classList.add('hidden');
  document.getElementById('iosInstallBanner')?.classList.add('hidden');
  document.body.classList.remove('has-ios-banner');
}

function installApp() {
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    _deferredInstallPrompt.userChoice.then(result => {
      if (result.outcome === 'accepted') _hideInstallButtons();
      _deferredInstallPrompt = null;
    });
  } else {
    openModal('iosInstallModal');
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  _showInstallButtons();
});

window.addEventListener('appinstalled', () => {
  _hideInstallButtons();
  _deferredInstallPrompt = null;
});

// iPadOS 13+ signale "Macintosh" dans userAgent : on se base aussi sur maxTouchPoints
const _isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const _isStandalone = window.navigator.standalone === true
  || window.matchMedia('(display-mode: standalone)').matches;

function dismissIOSBanner() {
  lsSet('iosInstallBannerDismissed', '1');
  document.getElementById('iosInstallBanner')?.classList.add('hidden');
  document.body.classList.remove('has-ios-banner');
}

if (_isIOS && !_isStandalone) {
  _showInstallButtons();
  if (!lsGet('iosInstallBannerDismissed')) {
    document.getElementById('iosInstallBanner')?.classList.remove('hidden');
    document.body.classList.add('has-ios-banner');
  }
}

/* ============================================================
   EXPOSE FUNCTIONS TO WINDOW
   (required because <script type="module"> is scoped —
    onclick attributes in HTML need global function references)
============================================================ */
Object.assign(window, {
  // Auth
  switchAuthTab, handleAuthSubmit, handleForgotPassword, googleSignIn, signOutUser,
  checkEmailTypo, applyEmailSuggestion,
  // Menu, espaces
  toggleMobileMenu, closeMenu, menuDo, setView,
  // Fenêtres
  openModal, closeModal,
  // Page de titre
  primaryAction, captionAction, setDeadlineInline, nextQuote,
  // Projet
  openProjectModal, saveProject, setDeadlineMode, addPause, removePause,
  // Table des matières
  toggleChapter, updateChTitle, addChapterInline, handlePlanPaste,
  togglePlanTyping, createPlanFromText, endSetup,
  openChapterMenu, chapterMenuDo, remindSupervisor,
  addSsInline, deleteSs, updateSsTitle,
  // Pages
  stepPages, updateWritten, updateTarget, updateChWritten, updateChTarget,
  // Journal
  openLogModal, setLogDay, setLogMode, setLogKind, useJoker, stepLog, saveLog,
  toggleJournalAll, deleteNote, stopDefis,
  // Agenda
  openCalendarModal, updateCalendarLinks, downloadICS, calChanged, calSameChanged, calSlotChanged, calAdded, closeCalendar,
  // Synchro Word
  wordAction, openDocxModal, pickWordFile, handleDocxFile, unlinkFile,
  docxToggle, docxMap, docxTarget, docxSetScope, docxSetLevel, docxSetMode, docxSetNewTitle, docxSetPages, docxResetPages, docxSetTotal,
  handleDocPaste, reviewDocPlan, linkDocument, syncDoc, forgetDoc, handleDocxFiles, undoLastSync,
  docxCountChanged, applyDocxImport, docxBack,
  // Titre
  updateDocumentTitle,
  // Modèles de plan
  openTemplateModal, applyTemplate,
  // Données
  exportData, importData, confirmReset, deleteAccount,
  // Partage, bingo, bilan
  openShareModal, setShareFormat, downloadShareImage, shareNative, printReport, togglePaceHow,
  openBingo, toggleBingo, shareBingo,
  // La promo
  openPromoProfile: () => promo.openProfile(),
  rollPseudonym: () => promo.rollPseudonym(),
  savePromoProfile: () => promo.saveProfile(),
  leavePromo: () => promo.leave(),
  copyProfileLink: () => promo.copyLink(),
  postToPromo: () => promo.post(),
  removePromoNote: i => promo.removeNote(i),
  reportNote: (id, i) => promo.report(id, i),
  cheerFellow: id => promo.cheer(id),
  openFellow: id => promo.openFellow(id),
  // Mises à jour
  openWhatsNew, closeWhatsNew, openPrivacy,
  // Installation
  installApp, dismissIOSBanner,
});

initGlobalDrop();
initShelf();

/* La colonne de droite (aujourd'hui, note du jour, bingo) accompagne le défilement de la page :
   collée en haut si elle tient dans l'écran, par le bas sinon (on la lit jusqu'au bout, puis elle reste là). */
function stickSide() {
  document.querySelectorAll('.col-side').forEach(col => {
    const fits = col.offsetHeight <= window.innerHeight - 40;
    col.classList.toggle('stick-top', fits);
    col.classList.toggle('stick-bottom', !fits);
  });
}
if ('ResizeObserver' in window) {
  const ro = new window.ResizeObserver(stickSide);
  document.querySelectorAll('.col-side').forEach(col => ro.observe(col));
}
window.addEventListener('resize', () => { stickSide(); fitTitle(); });

/* Coller son document n'importe où dans la page (hors d'un champ de saisie) : même effet que le déposer.
   En dessous de 150 mots, ce n'est pas un manuscrit : on laisse le navigateur faire. */
document.addEventListener('paste', e => {
  if (!currentUser || !_loaded) return;
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  if (document.querySelector('.modal-overlay:not(.hidden):not(#docxModal)')) return;
  const cd = e.clipboardData;
  if (!cd) return;
  const text = cd.getData('text/plain') || '';
  if (text.split(/\s+/).length < 150) return;
  e.preventDefault();
  importPasted(cd.getData('text/html'), text);
});
window.addEventListener('resize', () => { if (_loaded) scheduleJournalRender(); });

// Bouton flottant (mobile) : visible seulement quand celui de la page ne l'est plus
if ('IntersectionObserver' in window) {
  const mainBtn = document.getElementById('tdPrimary');
  if (mainBtn) {
    new IntersectionObserver(entries => {
      document.body.classList.toggle('fab-hidden', entries[0].isIntersecting);
    }).observe(mainBtn);
  }
}

/* ============================================================
   INIT — driven by Firebase Auth state
============================================================ */
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    lsSet('jdb_known', '1');
    populateAppHeader(user);
    state = defaultState();
    showScreen('appScreen');
    startSync();
  } else {
    stopSync();
    currentUser = null;
    state = defaultState();
    document.getElementById('authEmail').value    = '';
    document.getElementById('authPassword').value = '';
    clearAuthError();
    // Nouveaux visiteurs (venus d'Instagram…) : onglet « Créer un compte » par défaut
    switchAuthTab(lsGet('jdb_known') ? 'signin' : 'signup');
    document.getElementById('authScreen').classList.toggle('returning', !!lsGet('jdb_known')); // déjà venu·e : le formulaire d'abord
    showScreen('authScreen');
    const shared = cleanId(new URLSearchParams(location.search).get('p'));
    if (shared) promo.showGuest(shared);
  }
});

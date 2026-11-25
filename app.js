/* ============================================================
   LE JOURNAL DE BORD — application principale
   Modules :
     core.js  logique pure (dates, historique, rythme, échéance)
     docx.js  lecture locale des fichiers Word
     ics.js   export agenda
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
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  setDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import {
  todayKey, isDayKey, parseDay, addDays, diffDays, weekday, mondayOf,
  nthWritingDay, pagesOn, sumRange, hasNotes, streak, bestStreak,
  forecast, schedule, normalizeTitle, titleScore, clamp, distribute,
} from './core.js';
import { buildICS, googleCalendarUrl, byDay } from './ics.js';
import { parseDocxFile } from './docx.js';

/* Version de l'application : à garder synchronisée avec sw.js */
const APP_VERSION = '2.0.0';
const APP_URL = 'https://lejournaldebord.org/';

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
   MOTIVATIONAL QUOTES
============================================================ */
const QUOTES = [
  // Classiques de motivation
  "Un voyage de mille lieues commence par un seul pas. Et une thèse par une seule page. 💪",
  "La persévérance est la clé du succès — chaque mot compte !",
  "Votre futur vous regardera écrire ces lignes avec fierté. Continuez ! ✨",
  "Une thèse se mange comme un éléphant : une bouchée à la fois. 🐘",
  "Le secret du succès ? Commencer. Le reste, c'est de la persévérance.",
  "Chaque page écrite est une victoire. Célébrez-les toutes ! 🏆",
  "L'expertise n'est pas le point de départ, c'est la destination. Vous y êtes presque !",
  "Rome ne s'est pas faite en un jour, mais ils posaient des briques tous les jours. 🏛️",
  "La thèse que vous écrivez aujourd'hui, c'est le livre dont vous serez fier(e) demain. 📚",
  "Il n'y a pas de vent favorable pour qui ne sait où il va. Vous, vous savez ! 🧭",
  "Le talent fait ce qu'il peut, la volonté fait ce qu'elle veut. Vous avez les deux ! 💡",
  "Chaque chapitre fini est une montagne franchie. Regardez derrière vous ! ⛰️",
  "La rédaction, c'est 1 % d'inspiration et 99 % de tasses de café. ☕ Vous gérez !",
  "Ne comptez pas les jours, faites que chaque jour compte. 📅",
  // Humour doctorat
  "Si Word plante, c'est le signe qu'il faut aller boire un café. ☕ Revenez plus fort.",
  "Votre bibliographie fait peur à vos amis. C'est bon signe. 📖",
  "Écrire 3 pages aujourd'hui, c'est 3 de moins pour demain. Mathématiques du doctorat. 🔢",
  "Votre chat pense aussi que vous travaillez bien. Il dort sur le clavier pour le prouver. 🐱",
  "La soutenance, c'est le boss final. Mais vous avez tous les chapitres pour vous entraîner. 🎮",
  "Un·e doctorant·e sans café, c'est comme une thèse sans bibliographie : ça tient pas. ☕",
  "Les données ne mentent pas. Parfois elles se trompent juste un peu. 📊",
  "Votre état de l'art est si complet que vous connaissez des articles que leurs auteurs ont oubliés. 🧐",
  "Réviser pour la 17e fois le même chapitre, c'est de la discipline. Pas de l'obsession. Promis. 🔄",
  "La procrastination, c'est votre cerveau qui dit 'je réfléchis encore'. Juste 5 minutes. ⌚",
  "Chaque note de bas de page est une preuve d'amour pour votre sujet. 💛",
  "'En cours de rédaction' est le statut le plus honorable qui soit. Portez-le avec fierté. ✒️",
  "Votre thèse va changer le monde. Même si personne ne le sait encore sauf vous. 🌍",
  "Un paragraphe par jour éloigne le burn-out pour toujours. (Presque.) 🧘",
  "Votre directeur·trice dit 'à retravailler' ? Traduction : 'vous êtes sur la bonne voie !'. 🛤️",
  "Si Hemingway pouvait écrire avec une gueule de bois, vous pouvez écrire après une réunion de labo. 💪",
  "Le Wi-Fi de la BU est lent, mais pas autant que le temps entre deux relectures. ⏳",
  "Votre introduction sera parfaite après la soutenance. C'est une loi universelle. 😌",
  "Chaque 'ctrl+S' est un petit acte de courage. Sauvegardez souvent, écrivez toujours. 💾",
  "La thèse, c'est un marathon. Aujourd'hui vous posez un pied devant l'autre. C'est suffisant. 🏃",

  // Directeurs de thèse fantômes
  "Mon directeur a répondu à mon mail en moins d'un mois. Je note ça dans mes percées historiques. 📬",
  "Le directeur de thèse est comme le yéti : on entend parler de lui, on cherche sa trace, mais on le voit rarement. 🦶",
  "Réponse du directeur après 3 semaines : 'Intéressant.' 11 mois de travail. 'Intéressant.' 🙂",
  "Mon directeur est en conférence à Barcelone, puis Lisbonne, puis Tokyo. La thèse, elle, attend à Paris. ✈️",
  "J'ai posé une question à mon directeur en septembre. Sa réponse est attendue pour le prochain printemps. 🌸",
  "'On se voit la semaine prochaine ?' — dit mon directeur. C'était il y a 6 semaines. 📅",
  "Mon directeur m'a lu 40 pages. Retour : 'Pas mal.' Je vis de ce 'pas mal' depuis 3 mois. 🫶",

  // La famille et les proches qui ne comprennent rien
  "'C'est pour quand tu auras un vrai travail ?' — ma mère, chaque repas de Noël depuis 3 ans. 🍗",
  "'Et ça sert à quoi exactement ?' — question posée par 100 % de la famille à 100 % des repas. 🍽️",
  "'Tu fais encore tes études ? À ton âge !' — tata Monique, inchangée depuis le début du doctorat. 👵",
  "J'ai expliqué ma thèse à mes parents. Ils m'ont conseillé de passer le concours de la fonction publique. 📋",
  "'T'es chercheur·se ? Tu cherches quoi ?' Bonne question, tonton. Très bonne question. 🔍",
  "Tout le monde pense que vous 'êtes encore à l'école'. Personne ne sait que vous portez le monde de la recherche sur vos épaules. 🌍",
  "'Donc t'es payé(e) pour lire des livres ?' Oui. Non. En fait, c'est compliqué. 📚",

  // Doctorants et l'IA
  "L'IA a rédigé le plan en 3 secondes. J'ai passé 3 semaines à comprendre pourquoi c'était faux. 🤖",
  "ChatGPT invente des références bibliographiques. Moi j'invente des délais de rendu. On est pareils. 📖",
  "L'IA m'a conseillé d'aller prendre l'air pour débloquer mes idées. Elle n'a pas complètement tort. 🌳",
  "Mon directeur a lu mon dernier chapitre : 'C'est très bien écrit.' Merci. Vraiment merci. 😇",
  "Avec l'IA on écrit 10 pages en 1h. Les corriger prend 3 jours. C'est ce qu'on appelle le progrès. 📝",
  "L'IA fait le résumé. Moi je fais la souffrance. C'est la collaboration humain-machine dans toute sa splendeur. 🤝",
  "Utiliser l'IA pour une thèse, c'est comme utiliser un GPS : c'est vous qui conduisez, mais parfois il dit n'importe quoi. 🗺️",

  // Rentre dedans (mais marrant)
  "Les 5 étapes du doctorat : enthousiasme, doute, panique, déni, soutenance. Vous en êtes où ? 📍",
  "Votre hypothèse de départ a survécu 6 mois. C'est bien. Les chercheurs expérimentés tiennent 3. 💀",
  "Si votre thèse était une startup, elle serait en 'pivot permanent' depuis 2 ans. C'est une feature, pas un bug. 🔄",
  "Vous avez supprimé 40 pages de travail ? Bien. L'élagage fait partie du processus. Pleurez quand même, c'est normal. 🌿",
  "La thèse, c'est 4 ans à répondre à des questions que personne ne vous a posées. Bienvenue dans la recherche. 🎓",
  "Le syndrome de l'imposteur ? C'est juste votre cerveau qui n'a pas encore reçu le mémo que vous êtes brillant(e). 🧠",
  "Votre introduction sera parfaite le lendemain de la soutenance. C'est une loi de la nature. 🌌",
];

/* ============================================================
   FUNNY CAPTIONS — image de partage Instagram
   Chaque objet couvre une tranche d'avancement [min, max] (%)
   et contient un tableau de phrases. La logique de sélection
   choisit aléatoirement une phrase dans la bonne tranche.
============================================================ */
const FUNNY_CAPTIONS = [
  {
    range: [0, 5],
    phrases: [
      "J'ai ouvert le document. C'est un grand pas.",
      "La page blanche me regarde. Je la regarde aussi.",
      "Le titre est provisoire. Ma santé mentale aussi.",
      "Mon directeur de thèse m'a vu aujourd'hui. Il m'a souri. C'est inquiétant.",
      "J'ai déjà lu 3 résumés. Je suis épuisé.",
      "Je suis encore en phase de 'cadrage'. Cadrage de mon lit.",
    ],
  },
  {
    range: [6, 15],
    phrases: [
      "J'ai fait un plan. Il est beau. Il ne sera jamais respecté.",
      "La première sous-section est rédigée. Le monde est à moi.",
      "Je commence à comprendre mon sujet. Un peu. Pas du tout.",
      "J'ai trouvé une référence bibliographique parfaite. Elle est en allemand.",
      "Le café est mon meilleur ami. Et mon seul ami.",
      "Ma thèse n'est pas un sprint, c'est une randonnée. En tongs.",
    ],
  },
  {
    range: [16, 30],
    phrases: [
      "J'écris. Enfin, je tape sur des touches. C'est bon signe.",
      "Ma bibliographie fait 2 pages. C'est plus que ma thèse.",
      "Je ne sais plus si je suis chercheur·se ou ghostwriter pour mon directeur.",
      "J'ai l'impression de creuser une galerie. J'espère qu'il y a de l'or au bout.",
      "Le nombre de pages augmente. Mon amour-propre diminue.",
      "J'ai rêvé que ma thèse était un chat. Elle m'ignorait.",
    ],
  },
  {
    range: [31, 50],
    phrases: [
      "J'ai une citation d'éléphant sur mon écran. Je commence à le détester.",
      "Ma thèse n'avance pas. Elle est comme un chat qui dort. Tout le temps.",
      "J'ai envie de devenir éleveur·se de chèvres. Mais j'ai pas de chèvres.",
      "Mes amis se marient, ont des enfants. J'ai une thèse. Et des cernes.",
      "Je suis au milieu de l'éléphant. C'est sombre.",
      "J'ai peur de mon document Word. Il contient trop de '...'",
    ],
  },
  {
    range: [51, 75],
    phrases: [
      "Je commence à voir la lumière au bout du tunnel. C'est peut-être un train.",
      "J'ai enfin rédigé le 'Cadre Théorique'. Je n'y comprends toujours rien.",
      "Je suis devenu·e expert·e en 'discussion'. Surtout avec moi-même.",
      "Ma thèse est comme un vieux meuble. Elle est bancale, mais je l'aime bien.",
      "J'ai plus de pages rédigées que restantes. C'est de la magie.",
      "J'ai l'impression de courir un marathon. J'ai plus de jambes.",
    ],
  },
  {
    range: [76, 95],
    phrases: [
      "Le document Word est devenu trop gros. J'ai peur qu'il explose.",
      "Mon directeur m'a envoyé un mail. J'ai peur d'ouvrir ma boîte.",
      "J'ai l'impression de relire les mêmes phrases pour la centième fois.",
      "Le dénouement approche. J'ai envie de pleurer. De joie, j'espère.",
      "J'ai une date de fin estimée. J'espère qu'elle est fausse.",
      "Le stress est inversement proportionnel au nombre de pages restantes.",
    ],
  },
  {
    range: [96, 100],
    phrases: [
      "La conclusion est écrite. C'est la fin. Ou le début.",
      "Je n'y crois pas. C'est fini. Enfin presque. Il reste les corrections.",
      "J'ai une thèse. Je suis devenu·e une créature de légende.",
      "L'éléphant est mangé. Il était bon.",
      "C'est fait. Enfin. Je vais pouvoir dormir.",
      "Le document final est prêt. J'ai peur d'appuyer sur 'Envoyer'.",
    ],
  },
];

function getFunnyCaption(pct) {
  const bucket = FUNNY_CAPTIONS.find(b => pct >= b.range[0] && pct <= b.range[1])
    ?? FUNNY_CAPTIONS[FUNNY_CAPTIONS.length - 1];
  return bucket.phrases[Math.floor(Math.random() * bucket.phrases.length)];
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
const MOODS       = ['😫', '😕', '😐', '🙂', '🤩'];
const MOOD_LABELS = ['Difficile', 'Bof', 'Correct', 'Bien', 'Excellent'];
const REVIEW_LABELS = { sent: '📨 Chez la direction', revise: '✏️ À corriger', ok: '✅ Validé' };
const REVIEW_PRINT  = { sent: 'Chez la direction', revise: 'À corriger', ok: 'Validé' };
const GHOST_LINES = [
  "Le yéti n'a toujours pas été aperçu.",
  'Pas de nouvelles, bonnes nouvelles ? Rien n\'est moins sûr.',
  'Votre chapitre fait peut-être le tour des colloques.',
  "Une relance polie n'a jamais fâché personne.",
];
const WD_LETTERS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const WD_NAMES   = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const WD_ORDER   = [1, 2, 3, 4, 5, 6, 0];
const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WHATSNEW_KEY = 'jdb_whatsnew';
const WHATSNEW_VER = '2';

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
    // V2 : échéance & rythme
    deadline: null,          // date de dépôt / de rendu
    marginDays: 21,          // marge avant le dépôt (relecture, mise en forme)
    writingDays: [1, 2, 3, 4, 5],
    dailyGoal: null,         // null = automatique
    introLast: true,         // rétroplanning : intro et conclusion à la fin
    sessionTime: '09:00',    // séances d'écriture (agenda)
    sessionMinutes: 90,
    // V2 : journal
    activity: {},            // { 'AAAA-MM-JJ': pages écrites ce jour }
    journal: {},             // { 'AAAA-MM-JJ': [ { p, s, n, m, t } ] }
    trackedSince: null,
    lastDocImport: null,
  };
}

let state        = defaultState();
let currentUser  = null;     // Firebase User object
let _currentChId = null;     // chapter id for the add-subsection modal
let _saveTimer   = null;     // debounce timer for Firestore writes
let _authMode    = 'signin'; // 'signin' | 'signup'
let _lastForecast = null;    // dernière prévision calculée (objectif du jour…)

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function num(v, min = 0) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(min, n) : min; }
function cleanId(id) { return String(id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40); }

/** Données Firestore / JSON → état propre (types vérifiés, identifiants sûrs). */
function normalizeState(d) {
  const s = defaultState();
  if (!isObj(d)) return s;
  const seen = new Set();
  const uniq = id => { let v = cleanId(id) || uid(); while (seen.has(v)) v = uid(); seen.add(v); return v; };
  const title = (t, fb) => (typeof t === 'string' && t.trim() ? t.slice(0, 300) : fb);
  const normSs = x => {
    if (!isObj(x)) return null;
    const o = { id: uniq(x.id), title: title(x.title, 'Sans titre'), targetPages: num(x.targetPages), writtenPages: num(x.writtenPages) };
    if (typeof x.docKey === 'string' && x.docKey) o.docKey = x.docKey.slice(0, 300);
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
    if (typeof c.docKey === 'string' && c.docKey) o.docKey = c.docKey.slice(0, 300);
    return o;
  }).filter(Boolean);
  s.startDate     = isDayKey(d.startDate) ? d.startDate : null;
  s.milestones    = Object.assign({ 25: false, 50: false, 75: false, 100: false }, isObj(d.milestones) ? d.milestones : {});
  s.documentTitle = typeof d.documentTitle === 'string' ? d.documentTitle.slice(0, 200) : '';
  s.deadline      = isDayKey(d.deadline) ? d.deadline : null;
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
      s.journal[k] = arr.filter(isObj).map(e => ({
        p: Number(e.p) || 0,
        s: typeof e.s === 'string' ? e.s : null,
        n: typeof e.n === 'string' ? e.n.slice(0, 500) : '',
        m: clamp(Math.round(Number(e.m) || 0), 0, 5),
        t: typeof e.t === 'string' ? e.t.slice(0, 5) : '',
      }));
    }
  }
  s.trackedSince = isDayKey(d.trackedSince) ? d.trackedSince : null;
  if (isObj(d.lastDocImport)) {
    s.lastDocImport = {
      at: isDayKey(d.lastDocImport.at) ? d.lastDocImport.at : null,
      name: String(d.lastDocImport.name || '').slice(0, 200),
      words: num(d.lastDocImport.words),
      pages: num(d.lastDocImport.pages),
    };
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
    marginDays:     state.marginDays,
    writingDays:    state.writingDays,
    dailyGoal:      state.dailyGoal,
    introLast:      state.introLast,
    sessionTime:    state.sessionTime,
    sessionMinutes: state.sessionMinutes,
    activity:       state.activity,
    journal:        state.journal,
    trackedSince:   state.trackedSince,
    lastDocImport:  state.lastDocImport,
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
}

function populateAppHeader(user) {
  const name = user.displayName || user.email;
  document.getElementById('userEmail').textContent = name;
  const mob = document.getElementById('userEmailMobile');
  if (mob) mob.textContent = name;
  const q = document.getElementById('crystalQuote');
  if (q) q.textContent = QUOTES[Math.floor(Math.random() * QUOTES.length)];
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
  toast('⏳ Chargement de vos données…', '');
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
const V2_FIELDS = ['deadline', 'marginDays', 'writingDays', 'dailyGoal', 'introLast', 'sessionTime',
  'sessionMinutes', 'activity', 'journal', 'trackedSince', 'lastDocImport'];
const backupKey = () => 'jdb_v2_' + (currentUser && currentUser.uid);

function backupV2() {
  if (!currentUser) return;
  const b = {};
  for (const f of V2_FIELDS) b[f] = state[f];
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
    else await setDoc(userDocRef(), payload, { merge: true });
  } catch (e) {
    console.error('Firestore save error:', e);
    if (e.code === 'permission-denied') toast('⚠️ Sauvegarde refusée par la base de données', 'warn');
    else if (e.code !== 'unavailable') toast('⚠️ Erreur de sauvegarde', '');
  }
}

function saveNow(replace = false) { clearTimeout(_saveTimer); _saveTimer = null; _doFirestoreSave(replace); }
function saveDebounced() { clearTimeout(_saveTimer); _saveTimer = setTimeout(() => _doFirestoreSave(false), 900); }

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
    }
  }, err => {
    console.error('Firestore listen error:', err);
    setDataLoading(false);
    if (!_loaded) renderLoadingState('error', err && err.code);
    else toast('⚠️ Synchronisation interrompue : rechargez la page.', 'warn');
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
  else if (Date.now() - _firstLoadAt > 6000) toast('🔄 Mis à jour depuis un autre appareil', '');
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

function onFirstLoad(isNew) {
  _firstLoadAt = Date.now();
  setReady(true);
  if (isNew && !state.trackedSince) state.trackedSince = todayKey();
  render();
  syncTitleInput();
  const fresh = state.chapters.length === 0 && !state.startDate;
  if (fresh) {
    lsSet(WHATSNEW_KEY, WHATSNEW_VER);
    openProjectModal('welcome');
  } else if (lsGet(WHATSNEW_KEY) !== WHATSNEW_VER) {
    openModal('whatsNewModal');
  }
  handleUrlAction();
}

function renderLoadingState(kind, code) {
  const c = document.getElementById('chaptersContainer');
  if (!c) return;
  if (kind === 'loading') {
    c.innerHTML = '<div class="empty-state"><div class="spinner" style="margin:0 auto 14px"></div><p>Chargement de votre journal…</p></div>';
  } else if (kind === 'slow') {
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">📡</div><h3>La connexion est lente…</h3>
      <p>Hors ligne, la toute première ouverture sur un appareil a besoin d'internet. Ensuite, le journal fonctionne même sans réseau.</p>
      <button class="btn btn-primary" onclick="location.reload()">Réessayer</button></div>`;
  } else {
    const why = code === 'permission-denied'
      ? 'La base de données a refusé l\'accès à vos données.'
      : 'Impossible de joindre la base de données.';
    c.innerHTML = `<div class="empty-state"><div class="empty-icon">⚠️</div><h3>Chargement impossible</h3>
      <p>${why} Vos données ne sont pas perdues : réessayez dans un instant.</p>
      <button class="btn btn-primary" onclick="location.reload()">Réessayer</button></div>`;
  }
}

function syncTitleInput() {
  const titleEl = document.getElementById('document-title');
  if (titleEl && document.activeElement !== titleEl) titleEl.value = state.documentTitle || '';
}

/* ============================================================
   UTILITIES
============================================================ */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NF1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const NF0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
function fmt1(n) { return NF1.format(Math.round((Number(n) || 0) * 10) / 10); }
function fmtInt(n) { return NF0.format(Math.round(Number(n) || 0)); }
function plural(n, one, many) { return Math.abs(n) >= 2 ? many : one; }

function formatDateFr(iso) {
  if (!iso) return '—';
  return parseDay(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}
function fmtDateShort(k) { return parseDay(k).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
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

/* ============================================================
   DASHBOARD UPDATE — surgical DOM patches only
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

  // Circular gauge
  const CIRC   = 502.65; // 2π × 80
  const offset = CIRC - (progress / 100) * CIRC;
  document.getElementById('gaugeFill').style.strokeDashoffset = offset;
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
  animNum('sRemaining', Math.max(0, remaining));

  const chCnt = state.chapters.length;
  const ssCnt = state.chapters.reduce((s, ch) => s + ch.subsections.length, 0);
  const okCnt = state.chapters.filter(c => c.review === 'ok').length;
  animNum('sChapters', chCnt);
  setText('sSections', `${ssCnt} sous-section${ssCnt !== 1 ? 's' : ''}` + (okCnt ? ` · ${okCnt} validé${okCnt > 1 ? 's' : ''}` : ''));

  // Rythme
  const p = fc.pace;
  if (p.forecast > 0) {
    setText('sVelocity', (p.forecast < 0.05 ? '< 0,1' : fmt1(p.forecast)) + ' p/j');
    setText('sDays', `≈ ${fmt1(p.forecast * 7)} p./sem. · ${p.basis === 'recent' ? '4 dernières sem.' : 'depuis le début'}`);
  } else if (state.startDate) {
    const days = Math.max(1, diffDays(state.startDate, today) + 1);
    setText('sVelocity', '0 p/j');
    setText('sDays', `${days} jour${days > 1 ? 's' : ''} de rédaction`);
  } else {
    setText('sVelocity', '—');
    setText('sDays', 'Définir une date de début');
  }

  // Boule de cristal : date de fin estimée
  if (total > 0 && remaining <= 0) {
    setText('sEndDate', '🎉 Terminé !');
    setText('sEndMsg',  'Champagne ! 🥂');
  } else if (fc.projectedEnd) {
    const dLeft = diffDays(today, fc.projectedEnd);
    setText('sEndDate', fmtDateShort(fc.projectedEnd));
    setText('sEndMsg',  `🥂 dans ${dLeft} jour${dLeft !== 1 ? 's' : ''} · à votre rythme ${p.basis === 'recent' ? 'récent' : 'moyen'}`);
  } else {
    setText('sEndDate', '—');
    setText('sEndMsg',  total === 0 ? 'Construisez votre plan pour commencer' : 'Notez vos premières pages !');
  }

  setText('startDateDisplay', state.startDate ? formatDateFr(state.startDate) : 'Non définie');
  renderDeadline(fc);
  renderToday(fc);
  renderReviewStrip();
  updateDueChips(fc);
  checkMilestones(progress);
  scheduleJournalRender();
}

function animNum(id, newVal) {
  const el = document.getElementById(id);
  if (!el || el.textContent === String(newVal)) return;
  el.textContent = newVal;
  el.classList.remove('pulse');
  void el.offsetWidth;
  el.classList.add('pulse');
}

/** Ligne « échéance » sous la date de fin estimée. */
function renderDeadline(fc) {
  const el = document.getElementById('dbDeadline');
  if (!el) return;
  if (!state.deadline) {
    el.className = 'db-deadline';
    el.innerHTML = '<button class="db-link" onclick="openProjectModal()">📌 Fixer ma date de dépôt</button>'
      + '<span class="db-dl-sub">pour connaître le rythme à tenir et mon objectif du jour</span>';
    return;
  }
  let cls = '';
  let line = '';
  let sub = '';
  switch (fc.status) {
    case 'done':
      cls = 'ok'; line = '🎉 Rédaction terminée, place à la relecture !'; break;
    case 'overdue':
      cls = 'late'; line = `⏰ fin de rédaction visée dépassée (${fmtDue(fc.writingEnd)})`;
      sub = 'Mettez à jour votre échéance dans ⚙️ Mon projet.'; break;
    case 'ontrack':
      cls = 'ok'; line = fc.margin > 0 ? `✅ dans les temps, ${fc.margin} j d'avance` : '✅ pile dans les temps'; break;
    case 'behind':
      cls = 'warn'; line = `⚠️ ${Math.abs(fc.margin)} j de retard au rythme actuel`; break;
    default: break;
  }
  if (fc.perWeek && fc.status !== 'done' && fc.status !== 'overdue') {
    sub = `À tenir : ${fmt1(fc.perWeek)} p./sem., soit ${fmt1(fc.perWritingDay)} p. par jour d'écriture jusqu'au ${fmtDue(fc.writingEnd)}`;
  }
  el.className = 'db-deadline ' + cls;
  el.innerHTML = `<div class="db-dl-main">📌 Dépôt le <b>${fmtDateShort(state.deadline)}</b>${line ? ' · ' + line : ''}</div>`
    + (sub ? `<div class="db-dl-sub">${sub}</div>` : '');
}

/** Bandeau « Aujourd'hui » : objectif du jour, série, semaine. */
function renderToday(fc) {
  const today = todayKey();
  const done  = pagesOn(state.activity, today);
  const goal  = fc.dailyGoal;
  const pct   = goal > 0 ? clamp(done / goal, 0, 1) * 100 : 0;
  setText('tdVal', `${fmt1(Math.max(0, done))} / ${fmt1(goal)} p.`);
  const fill = document.getElementById('tdFill');
  if (fill) { fill.style.width = pct + '%'; fill.classList.toggle('done', done >= goal); }
  const writingDay = state.writingDays.includes(weekday(today));
  let sub;
  if (done >= goal) sub = 'Objectif du jour atteint 🎉';
  else if (!writingDay) sub = 'Jour de repos (bonus si vous écrivez 😌)';
  else if (!fc.goalIsAuto) sub = 'Votre objectif du jour';
  else sub = state.deadline ? 'Objectif du jour, calculé pour tenir le dépôt' : 'Objectif du jour';
  setText('tdSub', sub);
  const s = streak(state, today);
  setText('tdStreak', s.count);
  setText('tdStreakLbl', plural(s.count, 'jour', 'jours'));
  setText('tdStreakSub', s.count === 0 ? 'de série' : s.includesToday ? 'de série 🔥' : 'à prolonger aujourd\'hui');
  const wk = sumRange(state.activity, mondayOf(today), today);
  setText('tdWeek', (wk > 0 ? '+' : '') + fmt1(wk));
}

/** Encart « chez la direction » dans le tableau de bord. */
function renderReviewStrip() {
  const el = document.getElementById('reviewStrip');
  if (!el) return;
  const sent = state.chapters.filter(c => c.review === 'sent');
  if (!sent.length) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const today = todayKey();
  const items = sent.slice(0, 3).map(c => {
    const d = c.reviewDate ? Math.max(0, diffDays(c.reviewDate, today)) : 0;
    const since = d === 0 ? "depuis aujourd'hui" : `depuis ${d} jour${d > 1 ? 's' : ''}`;
    const ghost = d >= 21 ? ` 👻 <span class="rv-ghost">${GHOST_LINES[d % GHOST_LINES.length]}</span>` : '';
    const btn = d >= 10 ? `<button class="rv-btn" onclick="remindSupervisor('${c.id}')">✉️ Relancer</button>` : '';
    return `<div class="rv-item"><span class="rv-txt">📨 <b>${esc(trunc(c.title, 50))}</b> chez la direction ${since}${ghost}</span>${btn}</div>`;
  }).join('');
  el.innerHTML = items + (sent.length > 3 ? `<div class="rv-more">et ${sent.length - 3} autre${sent.length - 3 > 1 ? 's' : ''}…</div>` : '');
  el.classList.remove('hidden');
}

/** Échéances proposées par le rétroplanning, affichées sur chaque chapitre. */
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
    el.textContent = `🎯 à finir le ${fmtDue(k)}`;
    el.className = 'due-chip' + (diffDays(today, k) <= 7 ? ' soon' : '');
    el.title = 'Échéance proposée par votre rétroplanning (⚙️ Mon projet)';
  }
}

/* ============================================================
   GAMIFICATION
============================================================ */
function checkMilestones(progress) {
  // Pas de fête (ni d'écriture) sur la base d'un cache local peut-être périmé :
  // on attend la confirmation du serveur (onServerSynced relance la vérification).
  if (!_serverSynced) return;
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
    25:  '🌱 25 % ! Un beau début : vous êtes lancé(e) !',
    50:  '🔥 Mi-chemin ! La moitié est derrière vous !',
    75:  '⚡ 75 % ! Vous êtes en feu, ne lâchez rien !',
    100: '🏆 THÈSE TERMINÉE ! CHAMPAGNE !!!!',
  };
  launchConfetti(ms === 100 ? 220 : ms >= 75 ? 130 : 80);
  toast(msgs[ms], ms === 100 ? 'special' : 'success');
}

/** Objectif du jour atteint, paliers de série : une seule fête par jour. */
function checkDailyGoal() {
  if (!currentUser || !_lastForecast) return;
  const today = todayKey();
  const done = pagesOn(state.activity, today);
  const goalKey = `jdb_goal_${currentUser.uid}_${today}`;
  if (done > 0 && done >= _lastForecast.dailyGoal && !lsGet(goalKey)) {
    lsSet(goalKey, '1');
    launchConfetti(45);
    toast('🎯 Objectif du jour atteint ! Bravo.', 'success');
  }
  const s = streak(state, today);
  if (s.includesToday && [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365].includes(s.count)) {
    const k = `jdb_streak_${currentUser.uid}_${today}`;
    if (!lsGet(k)) {
      lsSet(k, '1');
      launchConfetti(70);
      toast(`🔥 ${s.count} jours de série ! Quelle régularité.`, 'special');
    }
  }
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
  el.setAttribute('role', 'status');
  box.appendChild(el);
  setTimeout(() => el.remove(), 3300);
}

/* ============================================================
   FULL RENDER
============================================================ */
function render() {
  renderChapters();
  updateDashboard();
  initSortable(); // must come after renderChapters() so DOM elements exist
  renderJournal();
}

function renderChapters() {
  const c = document.getElementById('chaptersContainer');
  if (state.chapters.length === 0) {
    c.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📖</div>
        <h3>Votre thèse commence ici !</h3>
        <p>Construisez votre plan : chapitres, sous-sections et objectifs de pages.
           Ensuite, notez vos pages au fil des jours, le journal calcule le reste.</p>
        <div class="empty-actions">
          <button class="btn btn-outline" onclick="event.stopPropagation(); openTemplateMenuFromEmpty()">🪄 Partir d'un plan type</button>
          <button class="btn btn-outline" onclick="openDocxModal()">📄 Importer mon fichier Word</button>
          <button class="btn btn-primary" onclick="openAddChapterModal()">＋ Créer mon premier chapitre</button>
        </div>
      </div>`;
    return;
  }
  c.innerHTML = state.chapters.map(ch => buildChapterHTML(ch)).join('');
}

function statusAutoLabel(prog) {
  return prog >= 100 ? '✔️ Rédigé' : prog > 0 ? '✍️ En cours' : '○ À écrire';
}

function statusSelectHTML(ch, prog) {
  const cur = ch.review || '';
  const opts = [['', statusAutoLabel(prog)], ['sent', REVIEW_LABELS.sent], ['revise', REVIEW_LABELS.revise], ['ok', REVIEW_LABELS.ok]];
  return `<select class="ch-status st-${cur || 'auto'}" id="st-${ch.id}" title="Statut du chapitre" aria-label="Statut du chapitre"
            onclick="event.stopPropagation()" onchange="setChapterReview('${ch.id}', this.value)">${
    opts.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('')
  }</select>`;
}

function chStatsText(ch, st) {
  let s = `${st.wP} / ${st.tP} pages · ${st.prog} %`;
  if (ch.subsections.length) s += ` · ${ch.subsections.length} sous-section${ch.subsections.length !== 1 ? 's' : ''}`;
  if (ch.review === 'sent' && ch.reviewDate) {
    const d = Math.max(0, diffDays(ch.reviewDate, todayKey()));
    s += d === 0 ? " · envoyé aujourd'hui" : ` · envoyé il y a ${d} j`;
  }
  return s;
}

function buildChapterHTML(ch) {
  const st      = chapterStats(ch);
  const { tP, wP, prog } = st;
  const isDone  = prog >= 100;
  const isExp   = ch.expanded !== false;
  const hasS    = ch.subsections.length > 0;
  const body = hasS
    ? `<div class="ss-list" id="ssl-${ch.id}">${ch.subsections.map(ss => buildSsHTML(ss, ch.id)).join('')}</div>`
    : `<div class="ch-direct-pages">
        <div class="ss-progress-row">
          <div class="prog-track">
            <div class="prog-fill${isDone ? ' done' : ''}" id="chbar-${ch.id}" style="width:${prog}%"></div>
          </div>
          <div class="pages-row">
            <input type="number" class="pages-input" value="${wP}" min="0" inputmode="numeric"
                   oninput="updateChWritten('${ch.id}',this.value)" title="Pages rédigées" aria-label="Pages rédigées" />
            <span>/</span>
            <input type="number" class="pages-input" value="${tP}" min="1" inputmode="numeric"
                   oninput="updateChTarget('${ch.id}',this.value)" title="Objectif" aria-label="Objectif de pages" />
            <span>p.</span>
          </div>
          <div class="prog-pct${isDone ? ' done' : ''}" id="chpct-${ch.id}">${prog}%</div>
        </div>
      </div>`;
  return `
<div class="chapter-card${isDone ? ' completed' : ''}${isExp ? ' expanded' : ''}" id="ch-${ch.id}">
  <div class="chapter-header" onclick="toggleChapter('${ch.id}')">
    <span class="ch-drag-handle" onclick="event.stopPropagation()" title="Déplacer">⋮⋮</span>
    <span class="ch-arrow">▶</span>
    <div class="ch-info">
      <div class="ch-title-row">
        <div class="ch-title" style="flex:1;min-width:0;">
          <input class="editable" value="${esc(ch.title)}"
                 onclick="event.stopPropagation()"
                 onblur="updateChTitle('${ch.id}',this.value)"
                 onkeydown="if(event.key==='Enter')this.blur()"
                 title="Cliquez pour modifier" aria-label="Titre du chapitre" />
        </div>
        ${statusSelectHTML(ch, prog)}
      </div>
      <div class="ch-progress-bar">
        <div class="ch-progress-fill${isDone ? ' done' : ''}" style="width:${prog}%"></div>
      </div>
      <div class="ch-stats"><span class="ch-stats-main">${esc(chStatsText(ch, st))}</span><span class="due-chip" id="due-${ch.id}"></span></div>
    </div>
    <div class="ch-actions" onclick="event.stopPropagation()">
      <button class="btn btn-icon btn-danger-soft" title="Supprimer" aria-label="Supprimer le chapitre" onclick="deleteChapter('${ch.id}')">🗑</button>
    </div>
  </div>
  <div class="chapter-body">
    ${body}
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
    <span class="ss-drag-handle" title="Déplacer">⋮⋮</span>
    <div class="ss-dot${isDone ? ' done' : ''}"></div>
    <div class="ss-title">
      <input class="editable" value="${esc(ss.title)}"
             onblur="updateSsTitle('${chId}','${ss.id}',this.value)"
             onkeydown="if(event.key==='Enter')this.blur()"
             title="Cliquez pour modifier" aria-label="Titre de la sous-section" />
    </div>
    <button class="btn btn-icon btn-danger-soft" title="Supprimer" aria-label="Supprimer la sous-section" onclick="deleteSs('${chId}','${ss.id}')">✕</button>
  </div>
  <div class="ss-progress-row">
    <div class="prog-track">
      <div class="prog-fill${isDone ? ' done' : ''}" id="bar-${ss.id}" style="width:${prog}%"></div>
    </div>
    <div class="pages-row">
      <input type="number" class="pages-input" value="${ss.writtenPages || 0}" min="0" inputmode="numeric"
             oninput="updateWritten('${chId}','${ss.id}',this.value)" title="Pages rédigées" aria-label="Pages rédigées" />
      <span>/</span>
      <input type="number" class="pages-input" value="${ss.targetPages || 0}" min="1" inputmode="numeric"
             oninput="updateTarget('${chId}','${ss.id}',this.value)" title="Objectif" aria-label="Objectif de pages" />
      <span>p.</span>
    </div>
    <div class="prog-pct${isDone ? ' done' : ''}" id="pct-${ss.id}">${prog}%</div>
  </div>
</div>`;
}

/* ============================================================
   JOURNAL — carte « Mon journal » (heatmap + entrées)
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

function renderJournal() {
  const card = document.getElementById('journalCard');
  if (!card) return;
  card.classList.toggle('hidden', state.chapters.length === 0);
  card.classList.toggle('collapsed', lsGet('jdb_journal_collapsed') === '1');
  if (state.chapters.length === 0) return;

  const today = todayKey();
  const goal  = (_lastForecast && _lastForecast.dailyGoal) || 1;
  const wk    = sumRange(state.activity, mondayOf(today), today);
  const s     = streak(state, today);
  setText('jcSummary', `${wk > 0 ? '+' : ''}${fmt1(wk)} p. cette semaine · 🔥 ${s.count} ${plural(s.count, 'jour', 'jours')}`);

  // Heatmap : 26 semaines sur grand écran, 16 sur mobile
  const WEEKS = card.clientWidth > 640 ? 26 : 16;
  const start = addDays(mondayOf(today), -7 * (WEEKS - 1));
  let cells = '';
  let months = '';
  let lastMonth = -1;
  for (let w = 0; w < WEEKS; w++) {
    const monday = addDays(start, 7 * w);
    const m = parseDay(monday).getMonth();
    months += `<span>${m !== lastMonth ? MONTHS_SHORT[m] : ''}</span>`;
    lastMonth = m;
    for (let d = 0; d < 7; d++) {
      const k = addDays(monday, d);
      if (k > today) { cells += '<i class="hm fut"></i>'; continue; }
      const p    = pagesOn(state.activity, k);
      const note = hasNotes(state.journal, k);
      const pre  = state.trackedSince && k < state.trackedSince;
      const lbl  = p ? `${fmt1(p)} p.` : note ? 'note' : '—';
      cells += `<i class="hm l${heatLevel(p, note, goal)}${k === today ? ' today' : ''}${pre ? ' pre' : ''}" title="${fmtDateLong(k)} : ${lbl}"></i>`;
    }
  }
  setHTML('heatmap', `<div class="hm-months" style="grid-template-columns:repeat(${WEEKS},1fr)">${months}</div>`
    + `<div class="hm-grid" style="grid-template-columns:repeat(${WEEKS},1fr)">${cells}</div>`);

  // Entrées récentes
  const days = new Set();
  for (const [k, v] of Object.entries(state.activity)) if (v && k <= today) days.add(k);
  for (const k of Object.keys(state.journal)) if (hasNotes(state.journal, k) && k <= today) days.add(k);
  const sorted = [...days].sort().reverse();
  const shown = sorted.slice(0, _journalShowAll ? 60 : 6);
  if (!shown.length) {
    setHTML('jcEntries', `<p class="jc-empty">Votre journal commence aujourd'hui. Après chaque séance, cliquez sur
      <b>＋ J'ai écrit</b> (ou modifiez vos pages dans le plan) : série, rythme et date de fin se calculent tout seuls.</p>`);
    return;
  }
  const html = shown.map(k => {
    const p = pagesOn(state.activity, k);
    const entries = state.journal[k] || [];
    const lines = entries.map((e, i) => {
      if (!e.n && !e.m && !e.s) return '';
      const mood = e.m ? `<span class="je-mood" title="${MOOD_LABELS[e.m - 1]}">${MOODS[e.m - 1]}</span>` : '';
      const text = e.n ? `<span class="je-text">${esc(e.n)}</span>` : '';
      const meta = [e.p ? `+${fmt1(e.p)} p.` : '', e.s ? sectionLabel(e.s) : ''].filter(Boolean).join(' · ');
      const del = (e.n || e.m) ? `<button class="je-del" onclick="deleteNote('${k}', ${i})" title="Supprimer la note" aria-label="Supprimer la note">✕</button>` : '';
      return `<div class="je-line">${mood}${text}${meta ? `<span class="je-meta">${esc(meta)}</span>` : ''}${del}</div>`;
    }).join('');
    const pCls = p > 0 ? 'pos' : p < 0 ? 'neg' : '';
    return `<div class="je"><div class="je-date">${relDay(k)}</div>
      <div class="je-pages ${pCls}">${p ? (p > 0 ? '+' : '') + fmt1(p) + ' p.' : '·'}</div>
      <div class="je-notes">${lines}</div></div>`;
  }).join('');
  const more = sorted.length > shown.length
    ? `<button class="jc-more" onclick="toggleJournalAll()">Voir tout le journal (${sorted.length} jours)</button>`
    : (_journalShowAll && sorted.length > 6 ? '<button class="jc-more" onclick="toggleJournalAll()">Réduire</button>' : '');
  setHTML('jcEntries', html + more);
}

function toggleJournalCard() {
  const collapsed = lsGet('jdb_journal_collapsed') === '1';
  lsSet('jdb_journal_collapsed', collapsed ? '0' : '1');
  renderJournal();
}

function toggleJournalAll() { _journalShowAll = !_journalShowAll; renderJournal(); }

function deleteNote(k, i) {
  const arr = state.journal[k];
  if (!arr || !arr[i]) return;
  if (!confirm('Supprimer cette note du journal ?\n(Les pages notées restent comptées.)')) return;
  const copy = arr.map(e => ({ ...e }));
  if (copy[i].p) { copy[i].n = ''; copy[i].m = 0; }
  else copy.splice(i, 1);
  state.journal[k] = copy;
  saveNow();
  renderJournal();
  renderToday(_lastForecast || forecast(state, totals(), todayKey()));
}

/* ============================================================
   CHAPTER CRUD
============================================================ */
function toggleChapter(id) {
  const ch = findCh(id);
  if (!ch) return;
  ch.expanded = ch.expanded === false;
  saveDebounced();
  const card = document.getElementById('ch-' + id);
  if (card) card.classList.toggle('expanded', ch.expanded);
}

function openAddChapterModal() {
  if (!requireReady()) return;
  document.getElementById('chTitleInput').value = '';
  openModal('addChapterModal');
  setTimeout(() => document.getElementById('chTitleInput').focus(), 100);
}

function saveChapter() {
  const title = document.getElementById('chTitleInput').value.trim();
  if (!title) { toast('Veuillez entrer un titre !', 'warn'); return; }
  state.chapters.push({ id: uid(), title: title.slice(0, 300), expanded: true, targetPages: 0, writtenPages: 0, subsections: [] });
  saveNow();
  closeModal('addChapterModal');
  render();
  toast('✅ Chapitre ajouté !', 'success');
}

function deleteChapter(id) {
  const ch = findCh(id);
  if (!ch || !confirm(`Supprimer "${ch.title}" et toutes ses sous-sections ?`)) return;
  state.chapters = state.chapters.filter(c => c.id !== id);
  saveNow();
  render();
  toast('🗑 Chapitre supprimé');
}

function updateChTitle(id, val) {
  const ch = findCh(id);
  if (ch && val.trim() && val.trim() !== ch.title) { ch.title = val.trim().slice(0, 300); saveNow(); }
}

/* ============================================================
   STATUT DE RELECTURE (chez la direction, à corriger, validé)
============================================================ */
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
  if (val === 'ok') { launchConfetti(60); toast('✅ Chapitre validé ! Savourez ce moment.', 'success'); }
  else if (val === 'sent') toast('📨 Chapitre envoyé. Le compteur d\'attente est lancé…', '');
  else if (val === 'revise') toast('✏️ Retours reçus : courage pour les corrections !', '');
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
   SUBSECTION CRUD
============================================================ */
function openAddSsModal(chId) {
  if (!requireReady()) return;
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
  const ch = findCh(_currentChId);
  if (!ch) return;
  const ss = { id: uid(), title: title.slice(0, 300), targetPages: pages, writtenPages: 0 };
  // Premier découpage d'un chapitre qui comptait déjà des pages : on les reporte
  if (ch.subsections.length === 0 && (ch.writtenPages || 0) > 0) {
    if (confirm(`Ce chapitre comptait déjà ${ch.writtenPages} page(s) rédigée(s).\nLes attribuer à « ${title} » ?`)) {
      ss.writtenPages = ch.writtenPages;
      ss.targetPages = Math.max(pages, ch.writtenPages);
    }
  }
  ch.subsections.push(ss);
  saveNow();
  closeModal('addSsModal');
  render();
  toast('✅ Sous-section ajoutée !', 'success');
}

function deleteSs(chId, ssId) {
  const ch = findCh(chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (!ss || !confirm(`Supprimer "${ss.title}" ?`)) return;
  ch.subsections = ch.subsections.filter(s => s.id !== ssId);
  saveNow();
  render();
}

function updateSsTitle(chId, ssId, val) {
  const ch = findCh(chId);
  if (!ch) return;
  const ss = ch.subsections.find(s => s.id === ssId);
  if (ss && val.trim() && val.trim() !== ss.title) { ss.title = val.trim().slice(0, 300); saveNow(); }
}

/* ============================================================
   LIVE PAGE UPDATES — surgical DOM patch (no full re-render)
   Chaque variation des pages rédigées alimente le journal du jour.
============================================================ */
function _findSs(chId, ssId) {
  const ch = findCh(chId);
  if (!ch) return null;
  const ss = ch.subsections.find(s => s.id === ssId);
  return ss ? { ch, ss } : null;
}

function updateWritten(chId, ssId, rawVal) {
  const found = _findSs(chId, ssId);
  if (!found) return;
  const old = found.ss.writtenPages || 0;
  found.ss.writtenPages = Math.max(0, parseInt(rawVal, 10) || 0);
  addActivity(found.ss.writtenPages - old);
  _refreshSsBar(found.ss);
  _refreshChCard(found.ch);
  saveDebounced(); // debounced — user may still be typing
  updateDashboard();
  checkDailyGoal();
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

function updateChWritten(chId, rawVal) {
  const ch = findCh(chId);
  if (!ch || ch.subsections.length > 0) return;
  const old = ch.writtenPages || 0;
  ch.writtenPages = Math.max(0, parseInt(rawVal, 10) || 0);
  addActivity(ch.writtenPages - old);
  _refreshChCard(ch);
  saveDebounced();
  updateDashboard();
  checkDailyGoal();
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
  if (bar)  { bar.style.width = prog + '%'; bar.className = 'prog-fill' + (isDone ? ' done' : ''); }
  if (pct)  { pct.textContent = prog + '%'; pct.className = 'prog-pct'  + (isDone ? ' done' : ''); }
  if (ssEl) { const dot = ssEl.querySelector('.ss-dot'); if (dot) dot.className = 'ss-dot' + (isDone ? ' done' : ''); }
}

function _refreshChCard(ch) {
  const st = chapterStats(ch);
  const { prog } = st;
  const isDone = prog >= 100;
  const card   = document.getElementById('ch-' + ch.id);
  if (!card) return;
  card.classList.toggle('completed', isDone);
  const fill = card.querySelector('.ch-progress-fill');
  if (fill) { fill.style.width = prog + '%'; fill.className = 'ch-progress-fill' + (isDone ? ' done' : ''); }
  const statsEl = card.querySelector('.ch-stats-main');
  if (statsEl) statsEl.textContent = chStatsText(ch, st);
  const chBar = document.getElementById('chbar-' + ch.id);
  const chPct = document.getElementById('chpct-' + ch.id);
  if (chBar) { chBar.style.width = prog + '%'; chBar.className = 'prog-fill' + (isDone ? ' done' : ''); }
  if (chPct) { chPct.textContent = prog + '%'; chPct.className = 'prog-pct' + (isDone ? ' done' : ''); }
  const sel = document.getElementById('st-' + ch.id);
  if (sel) {
    sel.options[0].textContent = statusAutoLabel(prog);
    sel.value = ch.review || '';
    sel.className = 'ch-status st-' + (ch.review || 'auto');
  }
}

/* ============================================================
   MODAL HELPERS
============================================================ */
function openModal(id)  { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

document.addEventListener('click', e => {
  if (!e.target.classList.contains('modal-overlay')) return;
  closeModal(e.target.id);
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach(m => closeModal(m.id));
  if (document.getElementById('mobileMenu').classList.contains('open')) toggleMobileMenu();
});

/* ============================================================
   MON PROJET — dates, rythme, objectif (+ accueil des nouveaux)
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
  const welcome = mode === 'welcome';
  document.getElementById('projectModal').classList.toggle('welcome', welcome);
  setText('pmEmoji', welcome ? '👋' : '⚙️');
  setText('pmTitle', welcome ? 'Bienvenue dans votre journal' : 'Mon projet');
  setText('pmSub', welcome
    ? 'Deux dates et c\'est parti. Tout reste modifiable plus tard dans ⚙️ Mon projet.'
    : 'Ces réglages servent à calculer votre rythme, votre objectif du jour et votre rétroplanning.');
  setText('pmCancel', welcome ? 'Plus tard' : 'Annuler');
  setText('pmSave', welcome ? 'C\'est parti 🚀' : 'Enregistrer');
  document.getElementById('pmName').value = state.documentTitle || '';
  document.getElementById('pmStart').value = state.startDate || todayKey();
  document.getElementById('pmDeadline').value = state.deadline || '';
  document.getElementById('pmMargin').value = String(state.marginDays);
  if (!document.getElementById('pmMargin').value) document.getElementById('pmMargin').value = '21';
  document.getElementById('pmGoal').value = state.dailyGoal || '';
  document.getElementById('pmIntroLast').checked = state.introLast !== false;
  renderDayChips('pmDays', state.writingDays);
  updateGoalHint();
  openModal('projectModal');
}

function updateGoalHint() {
  const fc = _lastForecast;
  const auto = fc && fc.goalIsAuto ? fc.dailyGoal : null;
  setText('pmGoalHint', auto
    ? `Vide = automatique (actuellement ${fmt1(auto)} p. par jour d'écriture).`
    : 'Vide = automatique, calculé d\'après votre date de dépôt.');
}

function saveProject() {
  const name     = document.getElementById('pmName').value.trim();
  const start    = document.getElementById('pmStart').value;
  const deadline = document.getElementById('pmDeadline').value;
  const margin   = parseInt(document.getElementById('pmMargin').value, 10);
  const goalRaw  = document.getElementById('pmGoal').value.trim();
  const days     = readDayChips('pmDays');
  if (start && !isDayKey(start)) { toast('Date de début invalide', 'warn'); return; }
  if (deadline && !isDayKey(deadline)) { toast('Date de dépôt invalide', 'warn'); return; }
  if (deadline && start && deadline <= start) { toast('La date de dépôt doit être après la date de début', 'warn'); return; }
  if (!days.length) { toast('Choisissez au moins un jour d\'écriture', 'warn'); return; }
  const goal = goalRaw ? Number(goalRaw.replace(',', '.')) : null;
  if (goalRaw && !(goal > 0)) { toast('Objectif quotidien invalide', 'warn'); return; }
  const welcome = document.getElementById('projectModal').classList.contains('welcome');
  state.documentTitle = name.slice(0, 200);
  state.startDate  = start || null;
  state.deadline   = deadline || null;
  state.marginDays = Number.isFinite(margin) ? clamp(margin, 0, 180) : 21;
  state.dailyGoal  = goal ? Math.min(50, goal) : null;
  state.writingDays = days;
  state.introLast  = document.getElementById('pmIntroLast').checked;
  saveNow();
  closeModal('projectModal');
  syncTitleInput();
  render();
  if (welcome) toast('🚀 C\'est parti ! Construisez votre plan ci-dessous.', 'success');
  else toast('✅ Projet mis à jour', 'success');
  if (deadline && deadline < todayKey()) toast('⚠️ Cette date de dépôt est déjà passée.', 'warn');
}

/* ============================================================
   « J'AI ÉCRIT » — saisie express d'une séance
============================================================ */
let _logDay  = 0;   // 0 = aujourd'hui, -1 = hier
let _logMood = 0;

function openLogModal() {
  if (!requireReady()) return;
  const leaves = leafSections();
  const sel = document.getElementById('logSection');
  const noPlan = document.getElementById('logNoPlan');
  noPlan.classList.toggle('hidden', leaves.length > 0);
  document.getElementById('logForm').classList.toggle('hidden', leaves.length === 0);
  if (leaves.length) {
    const last = lsGet('jdb_lastSection_' + (currentUser && currentUser.uid));
    const firstOpen = leaves.find(l => (l.ss ? ssProgress(l.ss) : chapterStats(l.ch).prog) < 100) || leaves[0];
    const chosen = leaves.some(l => l.id === last) ? last : firstOpen.id;
    sel.innerHTML = leaves.map(l => `<option value="${l.id}"${l.id === chosen ? ' selected' : ''}>${esc(trunc(l.label, 70))}</option>`).join('');
  }
  document.getElementById('logPages').value = 1;
  document.getElementById('logNote').value = '';
  setLogDay(0);
  setLogMood(0);
  openModal('logModal');
}

function setLogDay(offset) {
  _logDay = offset;
  document.querySelectorAll('#logDaySeg .seg-btn').forEach(b => b.classList.toggle('active', Number(b.dataset.day) === offset));
}

function setLogMood(m) {
  _logMood = _logMood === m ? 0 : m;
  document.querySelectorAll('#logMood .mood-btn').forEach(b => {
    const on = Number(b.dataset.mood) === _logMood;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on);
  });
}

function stepLog(d) {
  const el = document.getElementById('logPages');
  el.value = Math.max(0, (parseInt(el.value, 10) || 0) + d);
}

function saveLog() {
  const pages = Math.max(0, parseInt(document.getElementById('logPages').value, 10) || 0);
  const note  = document.getElementById('logNote').value.trim().slice(0, 500);
  const leafId = document.getElementById('logSection').value;
  const leaf  = leafSections().find(l => l.id === leafId);
  if (!pages && !note && !_logMood) { toast('Indiquez des pages ou une petite note', 'warn'); return; }
  if (pages && !leaf) { toast('Choisissez une partie', 'warn'); return; }
  const day = _logDay === -1 ? addDays(todayKey(), -1) : todayKey();
  if (pages) {
    if (leaf.ss) leaf.ss.writtenPages = (leaf.ss.writtenPages || 0) + pages;
    else leaf.ch.writtenPages = (leaf.ch.writtenPages || 0) + pages;
    addActivity(pages, day);
  }
  const now = new Date();
  const entry = {
    p: pages, s: leaf ? leaf.id : null, n: note, m: _logMood,
    t: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
  };
  state.journal[day] = [...(state.journal[day] || []), entry];
  if (leaf) lsSet('jdb_lastSection_' + currentUser.uid, leaf.id);
  if (!state.trackedSince || day < state.trackedSince) state.trackedSince = day;
  saveNow();
  closeModal('logModal');
  render();
  const s = streak(state, todayKey());
  toast(pages
    ? `✍️ +${pages} page${pages > 1 ? 's' : ''} notée${pages > 1 ? 's' : ''}${s.count > 1 ? ` · série de ${s.count} jours 🔥` : ''}`
    : '📔 Note ajoutée au journal', 'success');
  checkDailyGoal();
}

/* ============================================================
   AGENDA — séances d'écriture, dépôt, échéances des chapitres
============================================================ */
function openCalendarModal() {
  if (!requireReady()) return;
  renderDayChips('calDays', state.writingDays);
  document.getElementById('calTime').value = state.sessionTime;
  document.getElementById('calDur').value = String(state.sessionMinutes);
  if (!document.getElementById('calDur').value) document.getElementById('calDur').value = '90';
  const hasDl = !!state.deadline;
  ['calIncDeadline', 'calIncEnd', 'calIncChapters'].forEach(id => {
    const el = document.getElementById(id);
    el.checked = hasDl;
    el.disabled = !hasDl;
  });
  document.getElementById('calNoDeadline').classList.toggle('hidden', hasDl);
  updateCalendarLinks();
  openModal('calendarModal');
}

function calendarInputs() {
  const days = readDayChips('calDays');
  const time = /^\d{2}:\d{2}$/.test(document.getElementById('calTime').value) ? document.getElementById('calTime').value : '09:00';
  const minutes = parseInt(document.getElementById('calDur').value, 10) || 90;
  return { days, time, minutes };
}

function updateCalendarLinks() {
  const { days, time, minutes } = calendarInputs();
  const g = document.getElementById('calGoogle');
  if (!days.length) { g.removeAttribute('href'); return; }
  const today = todayKey();
  const fc = _lastForecast || forecast(state, totals(), today);
  const until = fc.writingEnd && fc.writingEnd > today ? fc.writingEnd : addDays(today, 365);
  const title = state.documentTitle || 'ma thèse';
  g.href = googleCalendarUrl({
    title: `✍️ Écriture : ${title}`,
    details: `Séance d'écriture. Après la séance, notez vos pages en un clic : ${APP_URL}?action=log`,
    start: nthWritingDay(today, 1, days), time, minutes,
    rrule: `FREQ=WEEKLY;BYDAY=${byDay(days)};UNTIL=${until.replace(/-/g, '')}T235959Z`,
  });
  const gd = document.getElementById('calGoogleDeadline');
  if (state.deadline) {
    gd.classList.remove('hidden');
    gd.href = googleCalendarUrl({ title: `📕 Dépôt : ${title}`, date: state.deadline, details: `Date de dépôt suivie dans Le Journal de Bord : ${APP_URL}` });
  } else gd.classList.add('hidden');
}

function downloadICS() {
  const { days, time, minutes } = calendarInputs();
  if (!days.length) { toast('Choisissez au moins un jour d\'écriture', 'warn'); return; }
  state.writingDays = days;
  state.sessionTime = time;
  state.sessionMinutes = minutes;
  saveNow();
  updateDashboard();
  const today = todayKey();
  const fc = forecast(state, totals(), today);
  const title = state.documentTitle || 'ma thèse';
  const link = `${APP_URL}?action=log`;
  const until = fc.writingEnd && fc.writingEnd > today ? fc.writingEnd : addDays(today, 365);
  const events = [{
    uid: 'jdb-sessions@lejournaldebord.org',
    title: `✍️ Écriture : ${title}`,
    start: nthWritingDay(today, 1, days), time, minutes,
    rrule: `FREQ=WEEKLY;BYDAY=${byDay(days)};UNTIL=${until.replace(/-/g, '')}T235959`,
    description: `Séance d'écriture. Après la séance, notez vos pages en un clic : ${link}`,
    url: link,
    alarms: [{ trigger: '-PT10M', text: 'Séance d\'écriture dans 10 minutes ✍️' }],
  }];
  if (document.getElementById('calIncDeadline').checked && state.deadline) {
    events.push({
      uid: 'jdb-deadline@lejournaldebord.org', title: `📕 Dépôt : ${title}`, date: state.deadline,
      description: `Date de dépôt suivie dans Le Journal de Bord : ${APP_URL}`,
      alarms: [{ trigger: '-P6DT15H', text: 'Dépôt dans une semaine' }, { trigger: '-PT15H', text: 'Dépôt demain !' }],
    });
  }
  if (document.getElementById('calIncEnd').checked && fc.writingEnd) {
    events.push({
      uid: 'jdb-writing-end@lejournaldebord.org', title: '✍️ Fin de rédaction visée', date: fc.writingEnd,
      description: 'Objectif : manuscrit complet, place à la relecture et à la mise en forme.',
      alarms: [{ trigger: '-PT15H' }],
    });
  }
  if (document.getElementById('calIncChapters').checked) {
    const sch = currentSchedule(fc);
    for (const c of state.chapters) {
      if (!sch[c.id]) continue;
      events.push({
        uid: `jdb-ch-${c.id}@lejournaldebord.org`, title: `🎯 Fin visée : ${c.title}`, date: sch[c.id],
        description: `Échéance proposée par votre rétroplanning. Suivi : ${APP_URL}`,
        alarms: [{ trigger: '-PT15H' }],
      });
    }
  }
  const ics = buildICS('Le Journal de Bord', events);
  downloadBlob(new Blob([ics], { type: 'text/calendar;charset=utf-8' }), 'journal-de-bord.ics');
  toast('📅 Fichier agenda téléchargé : ouvrez-le pour l\'ajouter.', 'success');
}

/* ============================================================
   IMPORT WORD (.docx) — synchronisation automatique du plan
============================================================ */
let _dx = null;
// Parties ignorées par défaut (titres normalisés : minuscules, sans accents)
const DOCX_IGNORE = /^(bibliograph|references|sources\b|annexe|appendi|table des|sommaire|index\b|remerciement|acknowledg|resume\b|abstract|glossaire|liste des|sigles|abreviation|dedicace|avant propos|preface|notes\b)/;

function openDocxModal() {
  if (!requireReady()) return;
  _dx = null;
  showDocxStep(1);
  setDocxError('');
  const last = state.lastDocImport;
  setText('docxLast', last && last.at ? `Dernière synchro : ${relDay(last.at).toLowerCase()} (${last.name})` : '');
  openModal('docxModal');
}

function showDocxStep(n) {
  document.getElementById('docxStep1').classList.toggle('hidden', n !== 1);
  document.getElementById('docxStep2').classList.toggle('hidden', n !== 2);
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

async function handleDocxFile(file) {
  if (!file) return;
  const input = document.getElementById('docxInput');
  if (input) input.value = '';
  setDocxError('');
  setDocxBusy(true);
  try {
    const res = await parseDocxFile(file);
    if (!res.chapters.length) {
      setDocxError(`Aucun titre détecté dans « ${file.name} » (${fmtInt(res.totalWords)} mots). `
        + 'Appliquez le style « Titre 1 » à vos chapitres et « Titre 2 » à vos sous-parties, puis réessayez.');
      return;
    }
    _dx = buildDocxModel(res, file.name);
    renderDocxPreview();
    showDocxStep(2);
  } catch (e) {
    const msgs = {
      'old-doc': 'Ce fichier est au format .doc (ancien Word). Ouvrez-le dans Word, enregistrez-le en .docx, puis réessayez.',
      'not-docx': 'Ce fichier n\'est pas un document Word .docx. Depuis Google Docs : Fichier > Télécharger > Microsoft Word (.docx).',
      'zip-lib': 'Impossible de charger le lecteur de fichiers : vérifiez votre connexion internet.',
      'bad-xml': 'Le document semble endommagé : ouvrez-le et réenregistrez-le dans Word.',
    };
    console.error('docx:', e);
    setDocxError(msgs[e.code] || 'Lecture impossible de ce fichier.');
  } finally {
    setDocxBusy(false);
  }
}

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
    c.map = ch && ch.subsections.length ? bestMatchId(c.title, ch.subsections, used) : '';
    if (c.map) used.add(c.map);
  }
}

function buildDocxModel(res, name) {
  const rows = res.chapters.map(c => ({
    title: c.title, ownWords: c.ownWords, words: c.words,
    include: !DOCX_IGNORE.test(normalizeTitle(c.title)),
    map: '', target: 0, touched: false,
    children: c.children.map(x => ({ title: x.title, words: x.words, include: true, map: '', target: 0, touched: false })),
  }));
  const m = { name, res, rows, wpp: res.wpp, planEmpty: state.chapters.length === 0, totalTarget: 0 };
  const used = new Set();
  for (const r of rows) {
    r.map = bestMatchId(r.title, state.chapters, used);
    if (r.map) used.add(r.map);
    docxMatchChildren(r);
  }
  if (m.planEmpty) {
    const pages = rows.filter(r => r.include).reduce((s, r) => s + r.words, 0) / m.wpp;
    m.totalTarget = Math.max(50, Math.ceil((pages * 1.5) / 10) * 10);
  }
  computeDocxTargets(m);
  m.count = !!state.lastDocImport;
  return m;
}

/** Mots attribués à une sous-partie : le texte d'ouverture du chapitre va à la première. */
function docxKidWords(r, c) {
  const kids = r.children.filter(x => x.include);
  return c.words + (kids[0] === c ? r.ownWords : 0);
}
function docxChapterWords(r) {
  return r.ownWords + r.children.filter(x => x.include).reduce((s, x) => s + x.words, 0);
}

function computeDocxTargets(m) {
  const pg = w => Math.ceil(w / m.wpp);
  if (m.planEmpty) {
    const leaves = [];
    for (const r of m.rows) {
      if (!r.include) continue;
      const kids = r.children.filter(c => c.include);
      if (kids.length) kids.forEach(c => leaves.push({ node: c, words: docxKidWords(r, c) }));
      else leaves.push({ node: r, words: docxChapterWords(r) });
    }
    const W = leaves.reduce((s, l) => s + l.words, 0);
    const avg = leaves.length ? W / leaves.length : 0;
    const shares = distribute(Math.max(0, Math.round(m.totalTarget || 0)), leaves.map(l => (W > 0 ? l.words + avg : 1)));
    leaves.forEach((l, i) => { if (!l.node.touched) l.node.target = Math.max(1, shares[i], pg(l.words)); });
    return;
  }
  const avg = list => { const v = list.filter(x => x > 0); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : 0; };
  const chAvg = avg(state.chapters.map(c => chapterStats(c).tP)) || 20;
  const ssAvg = avg(state.chapters.flatMap(c => c.subsections.map(s => s.targetPages))) || Math.max(5, Math.round(chAvg / 4));
  for (const r of m.rows) {
    const kids = r.children.filter(c => c.include);
    if (!r.map) {
      if (kids.length) kids.forEach(c => { if (!c.touched) c.target = Math.max(ssAvg, pg(docxKidWords(r, c))); });
      else if (!r.touched) r.target = Math.max(chAvg, pg(docxChapterWords(r)));
    } else {
      for (const c of kids) if (!c.map && !c.touched) c.target = Math.max(ssAvg, pg(docxKidWords(r, c)));
    }
  }
}

/** Applique le modèle d'import à une liste de chapitres (copie pour l'aperçu, ou le vrai plan). */
function applyDocxModel(m, chapters) {
  const pg = w => Math.round(w / m.wpp);
  for (const r of m.rows) {
    if (!r.include) continue;
    const kids = r.children.filter(c => c.include);
    let ch = r.map ? chapters.find(c => c.id === r.map) : null;
    if (!ch) {
      ch = { id: uid(), title: r.title.slice(0, 300), expanded: false, targetPages: 0, writtenPages: 0, subsections: [], docKey: normalizeTitle(r.title) };
      if (kids.length) {
        ch.subsections = kids.map(c => ({
          id: uid(), title: c.title.slice(0, 300), targetPages: Math.max(1, c.target || 1),
          writtenPages: pg(docxKidWords(r, c)), docKey: normalizeTitle(c.title),
        }));
      } else {
        ch.targetPages = Math.max(1, r.target || 1);
        ch.writtenPages = pg(docxChapterWords(r));
      }
      chapters.push(ch);
      continue;
    }
    ch.docKey = normalizeTitle(r.title);
    if (!ch.subsections.length) {
      ch.writtenPages = pg(docxChapterWords(r));
    } else if (!kids.length) {
      const shares = distribute(pg(docxChapterWords(r)), ch.subsections.map(s => s.targetPages || 1));
      ch.subsections.forEach((s, i) => { s.writtenPages = shares[i]; });
    } else {
      for (const c of kids) {
        const ss = c.map ? ch.subsections.find(s => s.id === c.map) : null;
        if (ss) { ss.writtenPages = pg(docxKidWords(r, c)); ss.docKey = normalizeTitle(c.title); }
        else {
          ch.subsections.push({
            id: uid(), title: c.title.slice(0, 300), targetPages: Math.max(1, c.target || 1),
            writtenPages: pg(docxKidWords(r, c)), docKey: normalizeTitle(c.title),
          });
        }
      }
    }
  }
  return chapters;
}

function docxDelta(m) {
  const copy = JSON.parse(JSON.stringify(state.chapters));
  const before = writtenPages();
  const after = applyDocxModel(m, copy).reduce((s, ch) => s + (ch.subsections.length
    ? ch.subsections.reduce((a, x) => a + (x.writtenPages || 0), 0)
    : (ch.writtenPages || 0)), 0);
  return after - before;
}

function docxTargetInput(i, j, val) {
  return `<span class="dx-target">objectif <input type="number" min="1" inputmode="numeric" value="${val}"
            oninput="docxTarget(${i},${j},this.value)" aria-label="Objectif de pages"> p.</span>`;
}

function docxRowHTML(m, node, i, j, r) {
  const isCh = j < 0;
  const words = isCh ? docxChapterWords(node) : docxKidWords(r, node);
  const pages = Math.round(words / m.wpp);
  let ctl = '';
  if (!node.include) ctl = '<span class="dx-ign">ignoré</span>';
  else if (isCh) {
    const opts = ['<option value="">＋ Nouveau chapitre</option>']
      .concat(state.chapters.map(c => `<option value="${c.id}"${c.id === node.map ? ' selected' : ''}>→ ${esc(trunc(c.title, 42))}</option>`));
    const ch = findCh(node.map);
    const kids = node.children.filter(c => c.include);
    let extra = '';
    if (!ch) extra = kids.length ? `<span class="dx-note">+ ${kids.length} sous-section${kids.length > 1 ? 's' : ''}</span>` : docxTargetInput(i, -1, node.target);
    else if (!ch.subsections.length) extra = `<span class="dx-delta">${ch.writtenPages || 0} → <b>${pages}</b> p.</span>`;
    else if (!kids.length) extra = `<span class="dx-note">réparti sur vos ${ch.subsections.length} sous-sections</span>`;
    ctl = `<select onchange="docxMap(${i},-1,this.value)" aria-label="Correspondance dans votre plan">${opts.join('')}</select>${extra}`;
  } else {
    const ch = findCh(r.map);
    if (ch && !ch.subsections.length) ctl = `<span class="dx-note">compté dans « ${esc(trunc(ch.title, 30))} »</span>`;
    else if (!ch) ctl = docxTargetInput(i, j, node.target);
    else {
      const opts = ['<option value="">＋ Nouvelle sous-section</option>']
        .concat(ch.subsections.map(s => `<option value="${s.id}"${s.id === node.map ? ' selected' : ''}>→ ${esc(trunc(s.title, 42))}</option>`));
      const ss = ch.subsections.find(s => s.id === node.map);
      const extra = ss ? `<span class="dx-delta">${ss.writtenPages || 0} → <b>${pages}</b> p.</span>` : docxTargetInput(i, j, node.target);
      ctl = `<select onchange="docxMap(${i},${j},this.value)" aria-label="Correspondance dans votre plan">${opts.join('')}</select>${extra}`;
    }
  }
  return `<div class="dx-row ${isCh ? 'dx-ch' : 'dx-ss'}${node.include ? '' : ' off'}">
    <label class="dx-check"><input type="checkbox" ${node.include ? 'checked' : ''} onchange="docxToggle(${i},${j},this.checked)" aria-label="Inclure cette partie"></label>
    <div class="dx-main"><div class="dx-title">${esc(node.title)}</div><div class="dx-meta">${fmtInt(words)} mots · <b>${pages} p.</b></div></div>
    <div class="dx-map">${ctl}</div>
  </div>`;
}

function renderDocxPreview() {
  const m = _dx;
  if (!m) return;
  const res = m.res;
  const incl = m.rows.filter(r => r.include);
  const nSub = incl.reduce((s, r) => s + r.children.filter(c => c.include).length, 0);
  const pagesTxt = res.pagesMeta ? `${res.pagesMeta} pages selon Word` : `≈ ${Math.round(res.totalWords / m.wpp)} pages`;
  setHTML('docxSummary', `<b>${esc(m.name)}</b> : ${fmtInt(res.totalWords)} mots, ${pagesTxt}. `
    + `${m.rows.length} partie${m.rows.length > 1 ? 's' : ''} détectée${m.rows.length > 1 ? 's' : ''}${nSub ? `, ${nSub} sous-section${nSub > 1 ? 's' : ''}` : ''}.`
    + (Math.round(res.frontWords / m.wpp) >= 1 ? ` Pages liminaires non comptées : ≈ ${Math.round(res.frontWords / m.wpp)} p.` : ''));
  const wppEl = document.getElementById('docxWpp');
  if (document.activeElement !== wppEl) wppEl.value = m.wpp;
  setText('docxWppHint', res.wppSource === 'word' ? 'calibré sur la pagination de Word' : 'estimation, ajustez si besoin');
  document.getElementById('docxTotalRow').classList.toggle('hidden', !m.planEmpty);
  const totEl = document.getElementById('docxTotal');
  if (m.planEmpty && document.activeElement !== totEl) totEl.value = m.totalTarget;

  let html = '';
  m.rows.forEach((r, i) => {
    html += docxRowHTML(m, r, i, -1, null);
    if (r.include) r.children.forEach((c, j) => { html += docxRowHTML(m, c, i, j, r); });
  });
  setHTML('docxRows', html);

  // Parties du plan absentes du document (laissées telles quelles)
  const mapped = new Set(m.rows.filter(r => r.include && r.map).map(r => r.map));
  const missing = state.chapters.filter(c => !mapped.has(c.id)).map(c => `« ${esc(trunc(c.title, 40))} »`);
  setHTML('docxMissing', missing.length ? `Inchangés (absents du document) : ${missing.join(', ')}.` : '');

  const delta = docxDelta(m);
  const row = document.getElementById('docxCountRow');
  row.classList.toggle('hidden', delta === 0);
  document.getElementById('docxCount').checked = m.count;
  setText('docxCountLbl', `Compter ces ${delta > 0 ? '+' : ''}${delta} p. comme écrites aujourd'hui`);
  setText('docxCountHint', m.count
    ? 'Décochez si cette différence ne vient pas de votre travail du jour.'
    : 'Première synchro : laissez décoché pour recaler vos compteurs sans fausser votre journal.');
}

function docxNode(i, j) { const r = _dx.rows[i]; return j < 0 ? r : r.children[j]; }

function docxToggle(i, j, on) {
  docxNode(i, j).include = on;
  computeDocxTargets(_dx);
  renderDocxPreview();
}

function docxMap(i, j, val) {
  const node = docxNode(i, j);
  node.map = val;
  if (j < 0) docxMatchChildren(node);
  computeDocxTargets(_dx);
  renderDocxPreview();
}

function docxTarget(i, j, val) {
  const node = docxNode(i, j);
  node.target = Math.max(1, parseInt(val, 10) || 1);
  node.touched = true;
}

function docxSetWpp(val) {
  if (!_dx) return;
  const v = parseInt(val, 10);
  if (!(v >= 80 && v <= 1500)) return;
  _dx.wpp = v;
  computeDocxTargets(_dx);
  renderDocxPreview();
}

function docxSetTotal(val) {
  if (!_dx) return;
  const v = parseInt(val, 10);
  if (!(v > 0)) return;
  _dx.totalTarget = v;
  computeDocxTargets(_dx);
  renderDocxPreview();
}

function docxCountChanged(on) { if (_dx) _dx.count = on; }

function applyDocxImport() {
  const m = _dx;
  if (!m) return;
  if (!m.rows.some(r => r.include)) { toast('Sélectionnez au moins une partie', 'warn'); return; }
  const before = writtenPages();
  applyDocxModel(m, state.chapters);
  const delta = writtenPages() - before;
  if (m.count && delta) addActivity(delta);
  state.lastDocImport = {
    at: todayKey(), name: m.name.slice(0, 200),
    words: m.res.totalWords, pages: Math.round(m.res.totalWords / m.wpp),
  };
  _dx = null;
  saveNow();
  closeModal('docxModal');
  render();
  toast(`📄 Plan synchronisé avec Word${delta ? ` (${delta > 0 ? '+' : ''}${delta} p.)` : ''}`, 'success');
  if (m.count && delta > 0) checkDailyGoal();
}

function docxBack() { showDocxStep(1); }

function initDocxDropzone() {
  const dz = document.getElementById('docxDrop');
  if (!dz) return;
  ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) handleDocxFile(f); });
}

/* ============================================================
   EXPORT / IMPORT (JSON portability — independent of Firestore)
============================================================ */
function exportData() {
  const data = { ...serializeState(), exportedAt: new Date().toISOString(), app: 'Le Journal de Bord ' + APP_VERSION };
  downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `these-${todayKey()}.json`);
  toast('📁 Données exportées !', 'success');
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
  if (!requireReady()) return;
  if (!confirm('⚠️ Effacer TOUTES les données ?\n\nChapitres, progression, journal, dates : tout sera supprimé.\nCette action est irréversible.')) return;
  if (!confirm('Dernière confirmation : vraiment tout effacer ?')) return;
  state = defaultState();
  state.trackedSince = todayKey();
  syncTitleInput();
  saveNow(true);
  render();
  toast('🗑 Données effacées. Nouveau départ !');
  openProjectModal('welcome');
}

/* ============================================================
   DOCUMENT TITLE
============================================================ */
function updateDocumentTitle(val) {
  state.documentTitle = val.slice(0, 200);
  saveDebounced();
}

/* ============================================================
   PLAN TEMPLATES — DROPDOWN & APPLICATION
============================================================ */
function toggleTemplateMenu() {
  const menu = document.getElementById('templateMenu');
  if (menu) menu.classList.toggle('hidden');
}

function openTemplateMenuFromEmpty() {
  const wrap = document.querySelector('.template-wrap');
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('templateMenu').classList.remove('hidden');
}

function applyTemplate(idx) {
  const tpl = PLAN_TEMPLATES[idx];
  if (!tpl || !requireReady()) return;
  document.getElementById('templateMenu').classList.add('hidden');
  const n = tpl.chapters.length;
  const total = tpl.chapters.reduce((s, c) => s + c.targetPages, 0);
  if (!confirm(
    `Ajouter le plan "${tpl.name}" à votre projet ?\n\n` +
    `${n} chapitres · ${total} pages objectif\n\n` +
    `Les chapitres seront ajoutés à la fin de votre liste existante.`
  )) return;
  const newChapters = tpl.chapters.map(ch => ({
    id:           uid(),
    title:        ch.title,
    targetPages:  ch.targetPages,
    writtenPages: 0,
    expanded:     false,
    subsections:  [],
  }));
  state.chapters.push(...newChapters);
  saveNow();
  render();
  toast(`✅ "${tpl.name}" : ${n} chapitres ajoutés !`, 'success');
}

// Ferme le dropdown si on clique en dehors
document.addEventListener('click', e => {
  if (!e.target.closest('.template-wrap')) {
    const menu = document.getElementById('templateMenu');
    if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
  }
});

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
   PARTAGE — image pour Instagram (post carré ou story)
   L'image est générée d'abord, puis partagée d'un geste :
   Safari exige que navigator.share() suive directement un clic.
============================================================ */
let _shareFormat = 'post';
let _shareBlob   = null;
let _shareUrl    = null;
let _shareToken  = 0;

function openShareModal() {
  if (!requireReady()) return;
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
  const remaining = Math.max(0, total - written);
  const pct = total === 0 ? 0 : Math.min(100, Math.round(written / total * 100));
  const today = todayKey();
  setText('igpPct', pct + '%');
  setText('igpWritten', written);
  setText('igpRemaining', remaining);
  setText('igpMessage', remaining > 0 ? `Plus que ${remaining} page${remaining > 1 ? 's' : ''} !` : 'Thèse terminée ! 🎉');
  setText('igpFooter', '«\u00A0' + getFunnyCaption(pct) + '\u00A0»');
  const s = streak(state, today);
  const wk = sumRange(state.activity, mondayOf(today), today);
  const bits = [];
  if (s.count >= 2) bits.push(`🔥 ${s.count} jours d'affilée`);
  if (wk > 0) bits.push(`+${fmt1(wk)} pages cette semaine`);
  const streakEl = document.getElementById('igpStreak');
  streakEl.textContent = bits.join('  ·  ');
  streakEl.classList.toggle('hidden', !bits.length);
  const CIRC = 502.65;
  document.getElementById('igpFill').style.strokeDashoffset = CIRC * (1 - pct / 100);
  document.getElementById('igPostCard').classList.toggle('story', _shareFormat === 'story');
}

async function renderShareImage() {
  const token = ++_shareToken;
  const preview = document.getElementById('sharePreview');
  preview.innerHTML = '<div class="spinner"></div>';
  document.getElementById('shareDownloadBtn').disabled = true;
  document.getElementById('shareNativeBtn').classList.add('hidden');
  if (!window.html2canvas) {
    preview.innerHTML = '<p class="share-err">Le générateur d\'image n\'est pas encore chargé. Réessayez dans un instant.</p>';
    return;
  }
  fillShareCard();
  try {
    await document.fonts.ready;
    await new Promise(r => setTimeout(r, 150));
    const h = _shareFormat === 'story' ? 1920 : 1080;
    const canvas = await window.html2canvas(document.getElementById('igPostCard'), {
      width: 1080, height: h, scale: 1, useCORS: true, backgroundColor: '#2C1A0E', logging: false,
    });
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    if (token !== _shareToken || !blob) return; // un autre format a été demandé entre-temps
    _shareBlob = blob;
    if (_shareUrl) URL.revokeObjectURL(_shareUrl);
    _shareUrl = URL.createObjectURL(blob);
    preview.innerHTML = `<img src="${_shareUrl}" alt="Aperçu de l'image à partager" class="${_shareFormat}">`;
    document.getElementById('shareDownloadBtn').disabled = false;
    const file = new File([blob], 'mon-avancement-these.png', { type: 'image/png' });
    const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
    document.getElementById('shareNativeBtn').classList.toggle('hidden', !canShare);
  } catch (err) {
    console.error('html2canvas error:', err);
    if (token === _shareToken) preview.innerHTML = '<p class="share-err">Erreur lors de la génération de l\'image.</p>';
  }
}

function downloadShareImage() {
  if (!_shareBlob) return;
  downloadBlob(_shareBlob, _shareFormat === 'story' ? 'mon-avancement-story.png' : 'mon-avancement-these.png');
  toast('📸 Image téléchargée ! Partagez-la sur Instagram.', 'success');
}

async function shareNative() {
  if (!_shareBlob) return;
  const file = new File([_shareBlob], 'mon-avancement-these.png', { type: 'image/png' });
  try {
    await navigator.share({ files: [file], text: `J'avance dans ma thèse avec Le Journal de Bord 📖 ${APP_URL}` });
  } catch (e) {
    if (e && e.name !== 'AbortError') { console.warn(e); downloadShareImage(); }
  }
}

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
  const bars = weeks.map(w => `<div class="pr-bar"><div class="pr-bar-fill" style="height:${Math.max(0, (w.pages / maxW) * 100)}%"></div><span class="pr-bar-val">${w.pages ? fmt1(w.pages) : ''}</span><span class="pr-bar-lbl">${parseDay(w.mon).getDate()}/${parseDay(w.mon).getMonth() + 1}</span></div>`).join('');

  const since = addDays(today, -30);
  const notes = Object.keys(state.journal).filter(k => k >= since && k <= today).sort().reverse()
    .flatMap(k => state.journal[k].filter(e => e.n).map(e => `<li><b>${fmtDateShort(k)}</b> : ${esc(e.n)}</li>`));

  return `
  <div class="pr-head"><span>📖 Le Journal de Bord</span><span>Bilan au ${formatDateFr(today)}</span></div>
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
    <tr><th>Date de dépôt</th><td>${state.deadline ? formatDateFr(state.deadline) : 'Non renseignée'}</td></tr>
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
   MENU (bas d'écran sur mobile, panneau déroulant sur ordinateur)
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
  if (document.getElementById('mobileMenu').classList.contains('open')) toggleMobileMenu();
  const f = window[fn];
  if (typeof f === 'function') f();
}

/* ============================================================
   NOUVEAUTÉS & ACTIONS PAR URL
============================================================ */
function openWhatsNew() { openModal('whatsNewModal'); }

function closeWhatsNew(next) {
  lsSet(WHATSNEW_KEY, WHATSNEW_VER);
  closeModal('whatsNewModal');
  if (next === 'project') openProjectModal();
}

/** ?action=log (raccourci d'app, rappel d'agenda) ouvre directement « J'ai écrit ». */
function handleUrlAction() {
  const params = new URLSearchParams(location.search);
  const action = params.get('action');
  if (!action) return;
  params.delete('action');
  const qs = params.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  if (action === 'log') setTimeout(() => { closeModal('whatsNewModal'); openLogModal(); }, 300);
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
  // Menu
  toggleMobileMenu, menuDo,
  // Modals
  openModal, closeModal,
  // Projet
  openProjectModal, saveProject,
  // Chapters
  openAddChapterModal, saveChapter, deleteChapter, toggleChapter, updateChTitle,
  setChapterReview, remindSupervisor,
  // Subsections
  openAddSsModal, saveSubsection, deleteSs, updateSsTitle,
  // Live updates
  updateWritten, updateTarget, updateChWritten, updateChTarget,
  // Journal
  openLogModal, setLogDay, setLogMood, stepLog, saveLog,
  toggleJournalCard, toggleJournalAll, deleteNote,
  // Agenda
  openCalendarModal, updateCalendarLinks, downloadICS,
  // Import Word
  openDocxModal, handleDocxFile, docxToggle, docxMap, docxTarget, docxSetWpp, docxSetTotal,
  docxCountChanged, applyDocxImport, docxBack,
  // Document title
  updateDocumentTitle,
  // Plan templates
  toggleTemplateMenu, openTemplateMenuFromEmpty, applyTemplate,
  // Data
  exportData, importData, confirmReset,
  // Partage & bilan
  openShareModal, setShareFormat, downloadShareImage, shareNative, printReport,
  // Nouveautés
  openWhatsNew, closeWhatsNew,
  // PWA install
  installApp, dismissIOSBanner,
});

initDocxDropzone();
window.addEventListener('resize', () => { if (_loaded) scheduleJournalRender(); });

// Bouton flottant (mobile) : visible seulement quand celui du tableau de bord ne l'est plus
if ('IntersectionObserver' in window) {
  const logBtn = document.querySelector('.today-strip .btn-log');
  if (logBtn) {
    new IntersectionObserver(entries => {
      document.body.classList.toggle('fab-hidden', entries[0].isIntersecting);
    }).observe(logBtn);
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
    showScreen('authScreen');
  }
});

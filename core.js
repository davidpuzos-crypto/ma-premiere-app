/* ============================================================
   CORE — logique pure (sans DOM ni Firebase)
   Dates locales, historique d'écriture, rythme, échéance,
   rétroplanning, normalisation des titres.
   Tout ce qui est ici est testable indépendamment de l'interface.
============================================================ */

/* ------------------------------------------------------------
   DATES — clés "AAAA-MM-JJ" en heure LOCALE
   (toISOString() donne la date UTC : à 00h30 à Paris, on
   serait encore « hier ». On évite donc toute conversion UTC.)
------------------------------------------------------------ */
export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey() { return dayKey(new Date()); }

export function isDayKey(k) {
  if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return false;
  const d = parseDay(k);
  return !isNaN(d) && dayKey(d) === k;
}

export function parseDay(k) {
  const [y, m, d] = String(k).split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(k, n) {
  const d = parseDay(k);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** Nombre de jours entre a et b (b − a). Robuste aux changements d'heure. */
export function diffDays(a, b) {
  return Math.round((parseDay(b) - parseDay(a)) / 86400000);
}

/** Jour de la semaine (0 = dimanche … 6 = samedi), comme Date.getDay(). */
export function weekday(k) { return parseDay(k).getDay(); }

/** Lundi de la semaine contenant k (semaine à la française). */
export function mondayOf(k) { return addDays(k, -((weekday(k) + 6) % 7)); }

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
function daySet(arr) {
  const s = new Set((Array.isArray(arr) ? arr : []).filter(d => Number.isInteger(d) && d >= 0 && d <= 6));
  return s.size ? s : new Set(ALL_DAYS);
}

/** Nombre de jours d'écriture entre from et to inclus. */
export function countWritingDays(from, to, writingDays) {
  if (to < from) return 0;
  const wd = daySet(writingDays);
  const n = diffDays(from, to) + 1;
  const fullWeeks = Math.floor(n / 7);
  let count = fullWeeks * wd.size;
  let k = addDays(from, fullWeeks * 7);
  for (let i = 0; i < n % 7; i++) {
    if (wd.has(weekday(k))) count++;
    k = addDays(k, 1);
  }
  return count;
}

/** Date du n-ième jour d'écriture à partir de from (inclus), n ≥ 1. */
export function nthWritingDay(from, n, writingDays) {
  const wd = daySet(writingDays);
  let k = from;
  let c = 0;
  for (let i = 0; i < 5000; i++) {
    if (wd.has(weekday(k))) {
      c++;
      if (c >= n) return k;
    }
    k = addDays(k, 1);
  }
  return k;
}

/* ------------------------------------------------------------
   HISTORIQUE D'ÉCRITURE
   state.activity = { 'AAAA-MM-JJ': pages nettes écrites ce jour }
   Alimenté à chaque modification des pages rédigées (saisie,
   « J'ai écrit », synchro Word). Les suppressions de chapitres
   ne comptent pas comme des pages « dés-écrites ».
   state.journal  = { 'AAAA-MM-JJ': [ { p, s, n, m } ] }  notes
   state.trackedSince = jour où le suivi a commencé.
------------------------------------------------------------ */
export function pagesOn(activity, k) {
  const v = Number(activity && activity[k]);
  return Number.isFinite(v) ? v : 0;
}

export function sumRange(activity, from, to) {
  let s = 0;
  for (const [k, v] of Object.entries(activity || {})) {
    if (k >= from && k <= to) s += Number(v) || 0;
  }
  return s;
}

export function hasNotes(journal, k) {
  return Array.isArray(journal && journal[k]) && journal[k].length > 0;
}

export function isActiveDay(state, k) {
  return pagesOn(state.activity, k) > 0 || hasNotes(state.journal, k);
}

/**
 * Série de jours d'écriture consécutifs.
 * Les jours hors « jours d'écriture » ne cassent pas la série.
 * Si rien n'est noté aujourd'hui, la série court jusqu'à hier
 * (elle n'est pas encore perdue : il reste la journée).
 */
export function streak(state, today) {
  const wd = daySet(state.writingDays);
  const since = state.trackedSince || today;
  const includesToday = isActiveDay(state, today);
  let k = includesToday ? today : addDays(today, -1);
  let count = 0;
  for (let i = 0; i < 2000 && k >= since; i++) {
    if (isActiveDay(state, k)) count++;
    else if (wd.has(weekday(k))) break;
    k = addDays(k, -1);
  }
  return { count, includesToday };
}

/** Meilleure série jamais réalisée (pour le bilan). */
export function bestStreak(state, today) {
  const wd = daySet(state.writingDays);
  const since = state.trackedSince || today;
  let best = 0;
  let cur = 0;
  for (let k = since, i = 0; k <= today && i < 5000; k = addDays(k, 1), i++) {
    if (isActiveDay(state, k)) { cur++; best = Math.max(best, cur); }
    else if (wd.has(weekday(k)) && k !== today) cur = 0;
  }
  return best;
}

/**
 * Rythme d'écriture (pages par jour calendaire).
 *  - 'recent'  : 28 derniers jours, dès que l'on a 14 jours de suivi
 *  - 'average' : pages rédigées / jours depuis la date de début, seulement si
 *                cette date précède le début du suivi (on écrivait déjà avant)
 *  - 'early'   : pages notées / jours de suivi (estimation provisoire des débuts)
 * Les pages déjà écrites avant le suivi ne gonflent jamais le rythme.
 */
export function pace(state, today, written) {
  const since = state.trackedSince && state.trackedSince <= today ? state.trackedSince : today;
  const tracked = diffDays(since, today) + 1;
  const win = Math.max(1, Math.min(28, tracked));
  const recentPages = sumRange(state.activity, addDays(today, -(win - 1)), today);
  const recent = Math.max(0, recentPages / win);
  const priorStart = !!state.startDate && state.startDate < since;
  const startDays = priorStart ? Math.max(1, diffDays(state.startDate, today) + 1) : 0;
  const average = priorStart && written > 0 ? written / startDays : 0;
  const early = Math.max(0, sumRange(state.activity, since, today) / tracked);
  let forecast = 0;
  let basis = 'none';
  if (tracked >= 14 && recent > 0) { forecast = recent; basis = 'recent'; }
  else if (average > 0) { forecast = average; basis = 'average'; }
  else if (tracked < 14 && early > 0) { forecast = early; basis = 'early'; }
  return { recent, recentWindow: win, tracked, average, forecast, basis };
}

/**
 * Tableau de bord prévisionnel : date de fin estimée, rythme requis
 * pour tenir l'échéance, statut (dans les temps / en retard), objectif du jour.
 */
export function forecast(state, totals, today) {
  const total = Math.max(0, totals.total || 0);
  const written = Math.max(0, totals.written || 0);
  const remaining = Math.max(0, total - written);
  const p = pace(state, today, written);
  const res = {
    total, written, remaining, pace: p,
    deadline: state.deadline || null,
    writingEnd: null, daysLeft: null, writingDaysLeft: null,
    perWritingDay: null, perWeek: null,
    projectedEnd: null, status: 'none', margin: null,
    dailyGoal: 1, goalIsAuto: true,
  };
  if (p.forecast > 0 && remaining > 0) {
    res.projectedEnd = addDays(today, Math.ceil(remaining / p.forecast));
  }
  if (total > 0 && remaining <= 0) res.status = 'done';
  if (state.deadline) {
    const margin = Number.isFinite(state.marginDays) ? state.marginDays : 21;
    res.writingEnd = addDays(state.deadline, -margin);
    res.daysLeft = diffDays(today, res.writingEnd) + 1;
    res.writingDaysLeft = countWritingDays(today, res.writingEnd, state.writingDays);
    if (res.status !== 'done') {
      if (res.daysLeft <= 0) {
        res.status = 'overdue';
      } else {
        res.perWritingDay = remaining / Math.max(1, res.writingDaysLeft);
        res.perWeek = remaining / (res.daysLeft / 7);
        if (!res.projectedEnd) res.status = 'nopace';
        else {
          res.margin = diffDays(res.projectedEnd, res.writingEnd);
          res.status = res.margin >= 0 ? 'ontrack' : 'behind';
        }
      }
    }
  }
  if (Number(state.dailyGoal) > 0) {
    res.dailyGoal = Number(state.dailyGoal);
    res.goalIsAuto = false;
  } else if (res.perWritingDay) {
    res.dailyGoal = Math.max(0.5, Math.ceil(res.perWritingDay * 2) / 2);
  }
  return res;
}

/* ------------------------------------------------------------
   RÉTROPLANNING — échéance proposée pour chaque chapitre
   Les pages restantes sont réparties sur les jours d'écriture
   disponibles jusqu'à la fin de rédaction visée. Option :
   introduction et conclusion rédigées en dernier.
   chapters : [{ id, title, remaining }] dans l'ordre du plan
   Retourne { [id]: 'AAAA-MM-JJ' }
------------------------------------------------------------ */
export function schedule(chapters, state, today, fc) {
  const out = {};
  if (!fc || !fc.writingEnd || !(fc.daysLeft > 0) || !(fc.writingDaysLeft > 0)) return out;
  let list = chapters.filter(c => c.remaining > 0);
  if (state.introLast !== false) {
    const kind = c => {
      const t = normalizeTitle(c.title);
      if (/^introduction\b/.test(t)) return 2;
      if (/^conclusion\b/.test(t)) return 1;
      return 0;
    };
    list = [
      ...list.filter(c => kind(c) === 0),
      ...list.filter(c => kind(c) === 1),
      ...list.filter(c => kind(c) === 2),
    ];
  }
  const R = list.reduce((s, c) => s + c.remaining, 0);
  if (R <= 0) return out;
  const W = fc.writingDaysLeft;
  let cum = 0;
  for (const c of list) {
    cum += c.remaining;
    const idx = Math.min(W, Math.max(1, Math.ceil((cum / R) * W)));
    out[c.id] = nthWritingDay(today, idx, state.writingDays);
  }
  return out;
}

/* ------------------------------------------------------------
   TITRES — normalisation pour rapprocher « Chapitre 2 : État
   de l'art » et « Etat de l’art ».
------------------------------------------------------------ */
function basicNorm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`´]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPunct(s) {
  return s.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Titre normalisé SANS la numérotation (« 1.2 », « Chapitre II : », « III. »). */
export function normalizeTitle(s) {
  const t = basicNorm(s);
  const patterns = [
    /^(chapitre|chap\.?|partie|section|article|annexe|livre|titre)\s+(\d+|[ivxlcdm]+)\b\s*[.\-–—:)]?\s*/,
    /^\d+(\.\d+)*\.?\s*[\-–—:)]?\s*/,
    /^[ivxlcdm]+\s*[.\-–—:)]\s*/,
  ];
  for (const re of patterns) {
    if (re.test(t)) {
      const stripped = cleanPunct(t.replace(re, ''));
      if (stripped.length >= 3) return stripped;
      break;
    }
  }
  return cleanPunct(t);
}

/** Titre normalisé AVEC la numérotation (pour distinguer « Article 1 » et « Article 2 »). */
export function normalizeFull(s) { return cleanPunct(basicNorm(s)); }

function tokens(s) { return s.split(' ').filter(Boolean); }

/** Score de ressemblance entre deux titres (0 à 1). */
export function titleScore(a, b) {
  const ka = normalizeTitle(a), kb = normalizeTitle(b);
  const fa = normalizeFull(a), fb = normalizeFull(b);
  if (!fa || !fb) return 0;
  if (fa === fb) return 1;
  if (ka && ka === kb) return 0.95;
  const ta = new Set(tokens(fa)), tb = new Set(tokens(fb));
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  const contained = small.size > 0 && [...small].every(t => big.has(t)) && [...small].some(t => t.length >= 4);
  if (contained) return 0.8;
  const sa = new Set(tokens(ka)), sb = new Set(tokens(kb));
  const inter = [...sa].filter(t => sb.has(t)).length;
  const union = new Set([...sa, ...sb]).size;
  return union ? (inter / union) * 0.9 : 0;
}

/* ------------------------------------------------------------
   DIVERS
------------------------------------------------------------ */
export function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }

/** Répartit un total entier proportionnellement à des poids (somme exacte). */
export function distribute(total, weights) {
  const W = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (!(total > 0) || !weights.length) return weights.map(() => 0);
  const raw = weights.map(w => (W > 0 ? (Math.max(0, w) / W) * total : total / weights.length));
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((s, v) => s + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) out[order[j][1]]++;
  return out;
}

/* ------------------------------------------------------------
   PLAN SAISI OU COLLÉ — une ligne par partie
   Sous-partie : ligne décalée, précédée d'une puce ou d'un tiret,
   ou numérotée à deux niveaux (« 1.2 … »).
   Objectif facultatif en fin de ligne : « (30) », « 30 p », « 30 pages ».
   Les pointillés et numéros de page d'une table des matières
   collée telle quelle sont ignorés.
   Retourne [{ title, target, subs: [{ title, target }] }]
------------------------------------------------------------ */
export function parsePlanText(text) {
  const lines = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const expanded = raw.replace(/\t/g, '    ').replace(/ /g, ' ');
    const indent = expanded.length - expanded.trimStart().length;
    let line = expanded.trim();
    let bullet = false;
    const mb = /^([-–—•*·◦▪>]+)\s+/.exec(line);
    if (mb) { bullet = true; line = line.slice(mb[0].length); }
    line = line.replace(/\s*[.·…_]{3,}\s*\d+\s*$/, '');
    let target = 0;
    const mt = /\s*[([]?\s*(\d{1,3})\s*(?:p\.?|pages?)\s*[)\]]?\s*$/i.exec(line) || /\s*[([]\s*(\d{1,3})\s*[)\]]\s*$/.exec(line);
    if (mt && mt.index > 0) { target = parseInt(mt[1], 10); line = line.slice(0, mt.index).trim(); }
    if (!line) continue;
    const mnum = /^(\d+(?:\.\d+)*)[.)]?\s+\S/.exec(line);
    const depth = mnum ? mnum[1].split('.').length : 0;
    lines.push({ title: line.slice(0, 300), indent, bullet, depth, target });
  }
  if (!lines.length) return [];
  const base = Math.min(...lines.map(l => l.indent));
  const mixedBullets = lines.some(l => l.bullet) && lines.some(l => !l.bullet);
  const out = [];
  let cur = null;
  for (const l of lines) {
    if (l.depth >= 3) continue; // « 1.1.1 » : trop fin pour le suivi
    const sub = !!cur && (l.depth === 2 || l.indent > base || (mixedBullets && l.bullet));
    if (sub) cur.subs.push({ title: l.title, target: l.target });
    else { cur = { title: l.title, target: l.target, subs: [] }; out.push(cur); }
  }
  return out;
}

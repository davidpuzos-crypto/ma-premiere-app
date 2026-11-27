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

/* ------------------------------------------------------------
   PÉRIODES HORS RÉDACTION — terrain, colloque, formation, congés…
   state.pauses = [{ from, to, kind }] (dates incluses).
   Pendant ces périodes on n'attend pas de pages : elles ne comptent
   ni dans les jours d'écriture restants (le rythme à tenir se
   recalcule), ni contre la série.
------------------------------------------------------------ */
export const PAUSE_KINDS = {
  terrain: 'Terrain', colloque: 'Colloque', formation: 'Formation', cours: 'Enseignement',
  conges: 'Congés', sante: 'Santé', autre: 'Autre',
};

/** Périodes valides, triées et fusionnées quand elles se chevauchent : [[from, to]]. */
export function pauseRanges(pauses) {
  const list = (Array.isArray(pauses) ? pauses : [])
    .filter(p => p && isDayKey(p.from) && isDayKey(p.to) && p.to >= p.from)
    .map(p => [p.from, p.to])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r[0] <= addDays(last[1], 1)) { if (r[1] > last[1]) last[1] = r[1]; }
    else out.push([r[0], r[1]]);
  }
  return out;
}

/** La période hors rédaction qui couvre ce jour, ou null. */
export function pauseOn(pauses, k) {
  for (const p of Array.isArray(pauses) ? pauses : []) {
    if (p && isDayKey(p.from) && isDayKey(p.to) && p.from <= k && k <= p.to) return p;
  }
  return null;
}

function plainWritingDays(from, to, wd) {
  if (to < from) return 0;
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

/** Nombre de jours d'écriture entre from et to inclus, hors périodes sans rédaction. */
export function countWritingDays(from, to, writingDays, pauses) {
  if (to < from) return 0;
  const wd = daySet(writingDays);
  let count = plainWritingDays(from, to, wd);
  for (const [a, b] of pauseRanges(pauses)) {
    const lo = a > from ? a : from;
    const hi = b < to ? b : to;
    if (hi >= lo) count -= plainWritingDays(lo, hi, wd);
  }
  return Math.max(0, count);
}

/** Date du n-ième jour d'écriture à partir de from (inclus), n ≥ 1, hors périodes sans rédaction. */
export function nthWritingDay(from, n, writingDays, pauses) {
  const wd = daySet(writingDays);
  const ranges = pauseRanges(pauses);
  const paused = k => ranges.some(r => r[0] <= k && k <= r[1]);
  let k = from;
  let c = 0;
  for (let i = 0; i < 6000; i++) {
    if (wd.has(weekday(k)) && !paused(k)) {
      c++;
      if (c >= n) return k;
    }
    k = addDays(k, 1);
  }
  return k;
}

/** Jours calendaires hors rédaction entre from et to inclus. */
export function pausedDays(from, to, pauses) {
  let n = 0;
  for (const [a, b] of pauseRanges(pauses)) {
    const lo = a > from ? a : from;
    const hi = b < to ? b : to;
    if (hi >= lo) n += diffDays(lo, hi) + 1;
  }
  return n;
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

/* Le journal ne note pas que des pages : une journée de terrain, de lecture ou de colloque est une
   journée de thèse. Chaque entrée peut porter un genre (k). Le « joker » est à part : c'est une journée
   qu'on s'accorde, elle ne prolonge pas la série mais ne la casse pas. */
export const ENTRY_KINDS = {
  terrain: 'Terrain', lecture: 'Lectures', analyse: 'Analyse, données', colloque: 'Colloque, séminaire',
  formation: 'Formation', publi: 'Article, publication', cours: 'Enseignement', direction: 'Point avec ma direction',
  admin: 'Administratif', joker: 'Joker',
};
export const JOKERS_PER_WEEK = 1;

const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
export const isPauseKind = k => own(PAUSE_KINDS, k);

/* Le genre voyage deux fois : dans « k », et dans « s » précédé d'un tilde. Les versions d'avant la 4.1
   gardent « s » tel quel mais effacent « k » quand elles réenregistrent le journal : grâce à ce double,
   un appareil resté ouvert en ancienne version ne fait perdre ni la journée de terrain ni le joker. */
export const kindTag = k => '~' + k;

/** Genre d'une entrée du journal ('' pour une entrée ordinaire), lu dans « k » ou, à défaut, dans « s ». */
export function entryKind(e) {
  if (!e) return '';
  if (own(ENTRY_KINDS, e.k)) return e.k;
  const t = typeof e.s === 'string' && e.s[0] === '~' ? e.s.slice(1) : '';
  return own(ENTRY_KINDS, t) ? t : '';
}

export function hasJoker(journal, k) {
  return Array.isArray(journal && journal[k]) && journal[k].some(e => entryKind(e) === 'joker');
}

/** Jokers posés dans la semaine (du lundi au dimanche) qui contient k. */
export function jokersInWeek(journal, k) {
  const monday = mondayOf(k);
  let n = 0;
  for (let i = 0; i < 7; i++) if (hasJoker(journal, addDays(monday, i))) n++;
  return n;
}

/** Jour travaillé : des pages, ou une entrée de journal autre qu'un joker. */
export function isActiveDay(state, k) {
  if (pagesOn(state.activity, k) > 0) return true;
  const arr = state.journal && state.journal[k];
  return Array.isArray(arr) && arr.some(e => e && entryKind(e) !== 'joker');
}

/** Jour où l'on n'attend rien : joker posé, ou période hors rédaction. */
export function isExcusedDay(state, k) {
  return hasJoker(state.journal, k) || !!pauseOn(state.pauses, k);
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
    else if (wd.has(weekday(k)) && !isExcusedDay(state, k)) break;
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
    else if (wd.has(weekday(k)) && k !== today && !isExcusedDay(state, k)) cur = 0;
  }
  return best;
}

/* ------------------------------------------------------------
   RYTHME ET PRONOSTIC
   « À ce rythme, quand aurai-je fini ? » Tout dépend de ce qu'on
   appelle le rythme. Une simple moyenne des quatre dernières
   semaines varie trop : une page écrite la fait bondir, la même
   page qui sort de la fenêtre un mois plus tard fait reculer la
   date de fin d'un coup, sans raison apparente. Sur des rédactions
   simulées (irrégulières, avec pannes et sprints), c'est aussi elle
   qui prédit le moins bien.
   On prend donc une moyenne où chaque jour pèse moitié moins que
   huit semaines plus tard : les dernières semaines comptent le
   plus, les anciennes s'effacent en douceur. Les périodes sans
   rédaction (terrain, congés…) ne comptent ni en pages ni en jours.
   Quand on écrit peu, huit semaines contiennent trop peu de pages :
   une seule ferait bondir la date de plusieurs mois. La mémoire
   s'allonge alors (jusqu'à trente-deux semaines) pour garder une
   trentaine de pages « en mémoire » : sur les mêmes simulations, les
   à-coups sont divisés par deux sans rien perdre en justesse. Dès
   qu'on écrit davantage, elle redevient courte et réactive.
   Le rythme d'avant le suivi (pages déjà écrites depuis la date de
   début) sert de point de départ, puis s'efface de la même façon.
------------------------------------------------------------ */
const PACE_HALF_LIFE = 56;   // demi-vie de la mémoire, en jours, quand on écrit assez
const PACE_HALF_MAX = 224;   // demi-vie la plus longue, quand on écrit peu
const PACE_PAGES = 30;       // pages qu'on cherche à garder « en mémoire »
const PACE_PRIOR = 28;       // poids, en jours, du rythme d'avant le suivi au premier jour

/**
 * Rythme d'écriture (pages par jour calendaire).
 *  forecast : le rythme retenu pour le pronostic (moyenne pondérée décrite ci-dessus)
 *  basis    : 'recent'  d'après les pages notées ces dernières semaines
 *             'average' surtout d'après le rythme moyen depuis la date de début (suivi encore jeune)
 *             'early'   premiers jours de suivi, estimation provisoire
 *             'none'    rien pour l'estimer
 *  recent   : moyenne brute des 28 derniers jours (ou depuis le début du suivi)
 *  half     : demi-vie de la mémoire utilisée (jours)
 *  pages    : pages « en mémoire » (plus il y en a, plus le rythme est établi)
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

  // Les jours de suivi, du plus récent au plus ancien, sans les périodes sans rédaction
  const ranges = pauseRanges(state.pauses);
  const ages = [];
  const pages = [];
  for (let age = 0, max = Math.min(tracked, PACE_HALF_MAX * 4); age < max; age++) {
    const k = addDays(today, -age);
    if (ranges.length && ranges.some(r => r[0] <= k && k <= r[1])) continue;
    ages.push(age);
    pages.push(Number(state.activity && state.activity[k]) || 0);
  }
  // Rythme d'avant le suivi : les pages qui existaient déjà, sur les jours écoulés depuis la date de début
  let n0 = 0;
  let before = 0;
  if (priorStart && written > 0) {
    const trackedPages = Math.max(0, sumRange(state.activity, since, today));
    before = Math.max(0, written - trackedPages) / Math.max(1, diffDays(state.startDate, since));
    if (before > 0) n0 = PACE_PRIOR * Math.pow(0.5, (tracked - 1) / PACE_HALF_LIFE);
  }
  // Moyenne pondérée pour une demi-vie donnée : { wp : pages en mémoire, wd : jours en mémoire }
  const weigh = half => {
    const span = Math.max(365, half * 4);
    let wp = before * n0;
    let wd = n0;
    for (let i = 0; i < ages.length && ages[i] < span; i++) {
      const w = Math.pow(0.5, ages[i] / half);
      wd += w;
      wp += w * pages[i];
    }
    return { wp, wd, half };
  };
  // La mémoire la plus courte qui garde assez de pages
  let m = weigh(PACE_HALF_LIFE);
  if (m.wp < PACE_PAGES && tracked > PACE_HALF_LIFE) {
    const long = weigh(PACE_HALF_MAX);
    if (long.wp < PACE_PAGES) m = long;
    else {
      let lo = PACE_HALF_LIFE;
      let hi = PACE_HALF_MAX;
      for (let i = 0; i < 10; i++) {
        const mid = (lo + hi) / 2;
        if (weigh(mid).wp >= PACE_PAGES) hi = mid; else lo = mid;
      }
      m = weigh(hi);
    }
  }
  const forecast = m.wd > 0 ? Math.max(0, m.wp / m.wd) : 0;
  let basis = 'none';
  if (forecast > 0) basis = n0 > m.wd - n0 ? 'average' : tracked < 14 ? 'early' : 'recent';
  return { recent, recentWindow: win, tracked, average, forecast, basis, half: Math.round(m.half), pages: Math.max(0, m.wp) };
}

/** Date à laquelle la dernière page serait écrite, à ce rythme (pages par jour) ; les périodes sans rédaction à venir la repoussent. */
function endAt(state, today, remaining, perDay) {
  if (!(perDay > 0) || !(remaining > 0)) return null;
  const days = Math.ceil(remaining / perDay);
  if (!(days < 36500)) return null;                       // plus d'un siècle : autant dire jamais
  let end = addDays(today, days);
  for (let i = 0, from = today; i < 12; i++) {
    const off = pausedDays(from, end, state.pauses);
    if (!off) break;
    from = addDays(end, 1);
    end = addDays(end, off);
  }
  return end;
}

/** Pages de chacune des n dernières semaines (du lundi au dimanche), de la plus ancienne à celle en cours. */
export function weeklyPages(state, today, n = 12) {
  const monday = mondayOf(today);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const from = addDays(monday, -7 * i);
    out.push({ monday: from, pages: Math.round(sumRange(state.activity, from, addDays(from, 6)) * 100) / 100 });
  }
  return out;
}

/** La meilleure semaine de tout le suivi : { monday, pages }, ou null. */
export function bestWeek(state) {
  const by = new Map();
  for (const [k, v] of Object.entries(state.activity || {})) {
    if (!isDayKey(k) || !(Number(v) > 0)) continue;
    const m = mondayOf(k);
    by.set(m, (by.get(m) || 0) + Number(v));
  }
  let best = null;
  for (const [monday, pages] of by) if (!best || pages > best.pages) best = { monday, pages: Math.round(pages * 100) / 100 };
  return best;
}

/** Une durée en mots, arrondie comme on la dirait : « 5 jours », « 3 semaines », « 14 mois », « 2 ans et demi ». */
export function spanWords(days) {
  const n = Math.max(0, Math.round(Number(days) || 0));
  if (n < 2) return n === 1 ? '1 jour' : 'moins d\'un jour';
  if (n < 14) return `${n} jours`;
  if (n < 60) return `${Math.round(n / 7)} semaines`;
  const months = Math.round(n / 30.44);
  if (months < 24) return `${months} mois`;
  const half = Math.round((n / 365.25) * 2) / 2;
  return Number.isInteger(half) ? `${half} ans` : `${Math.floor(half)} ans et demi`;
}

/**
 * Tableau de bord prévisionnel : date de fin estimée, rythme requis pour tenir l'échéance,
 * statut (dans les temps / en retard), objectif du jour ; et de quoi donner envie d'écrire :
 *   velocity     rythme en pages par semaine
 *   trend        son évolution en quatre semaines (pages par semaine, positive = on accélère) ; null avant six semaines de suivi
 *   gainToday    jours gagnés sur la date de fin grâce aux pages d'aujourd'hui (0 si rien écrit)
 *   gainPerPage  jours que ferait gagner une page de plus aujourd'hui
 *   missing      pages par semaine qui manquent pour arriver à l'heure (0 si l'on y est)
 *   pause        la période sans rédaction en cours aujourd'hui ({ from, to, kind }), ou null
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
    velocity: p.forecast * 7, trend: null, gainToday: 0, gainPerPage: null, missing: 0,
    pause: pauseOn(state.pauses, today),
  };
  res.projectedEnd = endAt(state, today, remaining, p.forecast);
  if (res.projectedEnd) {
    // Ce que change une page : le même calcul, avec une page de plus aujourd'hui, puis sans les pages d'aujourd'hui
    const day = Number(state.activity && state.activity[today]) || 0;
    const variant = delta => {
      const st = { ...state, activity: { ...(state.activity || {}), [today]: day + delta } };
      const w = written + delta;
      return endAt(st, today, Math.max(0, total - w), pace(st, today, w).forecast);
    };
    if (remaining > 1) { const e = variant(1); if (e) res.gainPerPage = Math.max(0, diffDays(e, res.projectedEnd)); }
    if (day > 0) { const e = variant(-day); res.gainToday = e ? Math.max(0, diffDays(res.projectedEnd, e)) : 0; }
  }
  if (p.tracked >= 42 && p.forecast > 0) {
    // Le rythme tel qu'on l'aurait calculé il y a quatre semaines (il faut alors déjà deux semaines de suivi pour qu'il veuille dire quelque chose)
    const then = addDays(today, -28);
    const sinceThen = sumRange(state.activity, addDays(then, 1), today);
    res.trend = (p.forecast - pace(state, then, Math.max(0, written - sinceThen)).forecast) * 7;
  }
  if (total > 0 && remaining <= 0) res.status = 'done';
  if (state.deadline) {
    const margin = Number.isFinite(state.marginDays) ? state.marginDays : 21;
    res.writingEnd = addDays(state.deadline, -margin);
    res.daysLeft = diffDays(today, res.writingEnd) + 1;
    res.writingDaysLeft = countWritingDays(today, res.writingEnd, state.writingDays, state.pauses);
    if (res.status !== 'done') {
      if (res.daysLeft <= 0) {
        res.status = 'overdue';
      } else {
        const free = Math.max(1, res.daysLeft - pausedDays(today, res.writingEnd, state.pauses));
        res.perWritingDay = remaining / Math.max(1, res.writingDaysLeft);
        res.perWeek = remaining / (free / 7);
        res.missing = Math.max(0, res.perWeek - res.velocity);
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
    out[c.id] = nthWritingDay(today, idx, state.writingDays, state.pauses);
  }
  return out;
}

/* ------------------------------------------------------------
   DÉFI DE LA SEMAINE — un seul, simple, vérifié tout seul
   Choisi d'après la semaine (il change chaque lundi) parmi ceux
   qui ont un sens pour la personne. Renvoie
   { id, week, text, target, value, done } ou null.
------------------------------------------------------------ */
/** Numéro de semaine ISO : 'AAAA-Snn'. */
export function weekId(k) {
  const d = parseDay(k);
  const thursday = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const n = 1 + Math.round(((thursday - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return `${thursday.getFullYear()}-S${String(n).padStart(2, '0')}`;
}

export function weeklyChallenge(state, today, fc) {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const wd = daySet(state.writingDays);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(monday, i));
  const upTo = days.filter(k => k <= today);
  const planned = days.filter(k => wd.has(weekday(k)) && !pauseOn(state.pauses, k)).length;
  if (!planned) return null;                                   // semaine entière hors rédaction : pas de défi
  const goal = fc && fc.dailyGoal > 0 ? fc.dailyGoal : 1;
  const weekPages = Math.max(0, sumRange(state.activity, monday, sunday));
  const worked = upTo.filter(k => isActiveDay(state, k)).length;
  const fmt = v => String(Math.round(v * 10) / 10).replace('.', ',');
  // Meilleure semaine passée
  let best = 0;
  const since = state.trackedSince || today;
  for (let m = mondayOf(since), i = 0; m < monday && i < 520; m = addDays(m, 7), i++) {
    best = Math.max(best, sumRange(state.activity, m, addDays(m, 6)));
  }
  let run = 0;
  let longest = 0;
  for (const k of upTo) {
    if (isActiveDay(state, k)) { run++; longest = Math.max(longest, run); }
    else if (wd.has(weekday(k)) && !isExcusedDay(state, k)) run = 0;
  }
  const pool = [];
  pool.push({ id: 'seances', text: planned > 1 ? `Tenir mes ${planned} séances de la semaine` : 'Tenir ma séance de la semaine', target: planned, value: Math.min(planned, upTo.filter(k => wd.has(weekday(k)) && isActiveDay(state, k)).length) });
  const need = fc && fc.perWeek > 0 ? Math.max(2, Math.ceil(fc.perWeek)) : Math.max(3, Math.round(goal * planned));
  pool.push({ id: 'pages', text: `Écrire ${fmt(need)} pages cette semaine`, target: need, value: Math.min(need, weekPages) });
  if (planned >= 3) {
    const n = Math.min(3, planned);
    pool.push({ id: 'objectif', text: `Atteindre mon objectif du jour ${n} fois`, target: n, value: Math.min(n, upTo.filter(k => pagesOn(state.activity, k) >= goal).length) });
    pool.push({ id: 'suite', text: `Travailler ${n} jours de suite`, target: n, value: Math.min(n, longest) });
  }
  if (best >= 2) pool.push({ id: 'record', text: `Battre ma meilleure semaine (${fmt(best)} p.)`, target: Math.floor(best * 10 + 1) / 10, value: Math.min(Math.floor(best * 10 + 1) / 10, weekPages) });
  pool.push({ id: 'journal', text: 'Écrire une ligne dans mon journal deux jours cette semaine', target: 2, value: Math.min(2, upTo.filter(k => Array.isArray(state.journal && state.journal[k]) && state.journal[k].some(e => e && e.n && e.k !== 'joker')).length) });
  const week = weekId(today);
  const pick = pool[(parseInt(week.slice(-2), 10) + parseInt(week.slice(0, 4), 10)) % pool.length];
  return { ...pick, week, done: pick.value >= pick.target, worked };
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
    const expanded = raw.replace(/\t/g, '    ').replace(/\u00A0/g, ' ');
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

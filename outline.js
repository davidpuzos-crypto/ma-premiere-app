/* ============================================================
   PLAN D'UN DOCUMENT — des titres bruts au plan suivi
   Logique pure, commune à tous les formats (Word, LibreOffice,
   texte collé, LaTeX, Markdown). Testée dans tests/core.test.mjs.

   Entrée : segments = [{ level: 1..9, title, words, pages }]
            (words, pages = le titre et tout le texte jusqu'au titre suivant)
            frontWords = mots placés avant le premier titre
   Sortie : { chapters: [{ title, level, ownWords, words, ownPages, pages,
                           children: [{ title, level, words, pages }] }],
              front, frontPages, mode, chapterLevel, subLevel, levels }
   Les pages suivent partout le même chemin que les mots.

   Le suivi a deux étages (chapitres, sous-sections) ; un document
   en a souvent trois ou quatre. Toute la question est de savoir à
   quel niveau de titre se trouvent les chapitres.
============================================================ */

export function countWords(text) {
  let n = 0;
  for (const tok of String(text).split(/\s+/)) {
    if (tok && /[\p{L}\p{N}]/u.test(tok)) n++;
  }
  return n;
}

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// « Partie I », « Première partie », « Titre II », « Part 2 »… : un étage au-dessus des chapitres
const PART_RE = /^((premiere|deuxieme|seconde|troisieme|quatrieme|cinquieme|sixieme|1re|1ere|2e|2de|2eme|3e|3eme|4e|4eme|5e|5eme)\s+partie\b|partie\s+([ivx]+|\d+|un|une|deux|trois|quatre|cinq)\b|part\s+([ivx]+|\d+|one|two|three|four|five)\b|(titre|livre|tome|volume)\s+([ivx]+|\d+)\b)/;
// « Chapitre 3 », « Chap. IV », « Chapter 2 »
const CHAP_RE = /^(chapitre|chapter|chap\.?)\s*([ivxlc]+|\d+|un|premier|one)\b/;
// Ce qui entoure le texte sans en faire partie : n'aide pas à deviner la structure
const MATTER_RE = /^(bibliograph|references|sources\b|annexe|appendi|table des|sommaire|index\b|remerciement|acknowledg|resume\b|abstract|glossaire|liste des|sigles|abreviation|dedicace|avant propos|preface|notes\b|couverture|page de titre)/;
const CHAPTERISH_RE = /^(introduction|conclusion)\b/;

const PART_INTRO_MIN = 300; // en deçà, le texte d'ouverture d'une partie est compté avec son premier chapitre

/** Range les titres en arbre : chaque titre est rattaché au dernier titre de niveau plus élevé. */
function toTree(segments) {
  const roots = [];
  const stack = [];
  for (const s of segments) {
    const level = Math.max(1, Math.min(9, Math.round(Number(s.level)) || 1));
    const node = { title: String(s.title || '').slice(0, 200), level, own: Math.max(0, Number(s.words) || 0), ownP: Math.max(0, Number(s.pages) || 0), kids: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

const total = n => n.own + n.kids.reduce((s, k) => s + total(k), 0);
const totalP = n => n.ownP + n.kids.reduce((s, k) => s + totalP(k), 0);
const hasLevel = (n, L) => n.kids.some(k => k.level === L || hasLevel(k, L));

function asChapter(n) {
  return {
    title: n.title, level: n.level, ownWords: n.own, words: total(n), ownPages: n.ownP, pages: totalP(n),
    children: n.kids.map(k => ({ title: k.title, level: k.level, words: total(k), pages: totalP(k) })),
  };
}

/** Le titre du document : seul de son niveau (hors remerciements, bibliographie…), il contient tout le reste. */
function isDocumentTitle(node, siblings) {
  if (node.kids.length < 2) return false;
  const t = norm(node.title);
  if (CHAP_RE.test(t) || CHAPTERISH_RE.test(t) || MATTER_RE.test(t)) return false;
  return siblings.every(s => s === node || MATTER_RE.test(norm(s.title)));
}

function isPart(node) {
  if (!node.kids.length) return false;
  if (PART_RE.test(norm(node.title))) return true;
  // Ses sous-titres sont des chapitres : au moins deux, ou la moitié (un « Chapitre 1 : annexe » isolé ne suffit pas)
  const chaps = node.kids.filter(k => CHAP_RE.test(norm(k.title))).length;
  return chaps >= 2 || (chaps >= 1 && chaps * 2 >= node.kids.length);
}

/**
 * Descend dans l'arbre et renvoie la liste des chapitres.
 * decide(node, siblings, top) dit si un titre est une simple enveloppe (titre du document, partie).
 */
function collect(nodes, decide, out, st, top) {
  for (const node of nodes) {
    const kind = decide(node, nodes, top);
    if (!kind) {
      const ch = asChapter(node);
      if (st.carry || st.carryP) {
        ch.ownWords += st.carry; ch.words += st.carry; st.carry = 0;
        ch.ownPages += st.carryP; ch.pages += st.carryP; st.carryP = 0;
      }
      out.push(ch);
      continue;
    }
    // Enveloppe : son texte d'ouverture
    if (kind === 'title') { st.front += node.own; st.frontP += node.ownP; }   // résumé, dédicace… avant le premier chapitre
    else if (node.own >= PART_INTRO_MIN) out.push({ title: node.title, level: node.level, ownWords: node.own, words: node.own, ownPages: node.ownP, pages: node.ownP, children: [] });
    else { st.carry += node.own; st.carryP += node.ownP; }                    // compté avec le chapitre qui suit
    collect(node.kids, decide, out, st, false);
  }
}

function mostFrequent(values) {
  const counts = new Map();
  let best = null;
  for (const v of values) {
    counts.set(v, (counts.get(v) || 0) + 1);
    if (best === null || counts.get(v) > counts.get(best)) best = v;
  }
  return best;
}

/** Ancien découpage (avant la v3.1) : le niveau le plus haut = chapitres, le suivant = sous-parties. */
function legacyOutline(segments, frontWords, frontPages) {
  const levels = [...new Set(segments.map(s => s.level))].sort((a, b) => a - b);
  const top = levels.length ? levels[0] : null;
  const second = levels.length > 1 ? levels[1] : null;
  const chapters = [];
  let front = frontWords;
  let frontP = frontPages;
  let ch = null;
  let sub = null;
  for (const s of segments) {
    const p = Math.max(0, Number(s.pages) || 0);
    if (s.level === top) {
      ch = { title: s.title, level: s.level, ownWords: s.words, words: 0, ownPages: p, pages: 0, children: [] };
      chapters.push(ch);
      sub = null;
    } else if (second !== null && s.level === second) {
      if (!ch) { front += s.words; frontP += p; continue; }
      sub = { title: s.title, level: s.level, words: s.words, pages: p };
      ch.children.push(sub);
    } else if (sub) { sub.words += s.words; sub.pages += p; }
    else if (ch) { ch.ownWords += s.words; ch.ownPages += p; }
    else { front += s.words; frontP += p; }
  }
  for (const c of chapters) {
    c.words = c.ownWords + c.children.reduce((a, x) => a + x.words, 0);
    c.pages = c.ownPages + c.children.reduce((a, x) => a + x.pages, 0);
  }
  return { chapters, front, frontP };
}

/**
 * Construit le plan à deux étages.
 * mode : 'auto' (recommandé), un nombre (niveau de titre des chapitres) ou 'legacy'.
 * opts.single : le document est un seul chapitre ; on renvoie ses sections au premier étage.
 * opts.frontPages : pages placées avant le premier titre.
 */
export function buildOutline(segments, frontWords = 0, mode = 'auto', opts = {}) {
  const segs = (segments || []).filter(s => s && String(s.title || '').trim());
  const levels = [];
  for (const s of segs) {
    const l = levels.find(x => x.level === s.level);
    if (l) l.count++;
    else levels.push({ level: s.level, count: 1 });
  }
  levels.sort((a, b) => a.level - b.level);

  let chapters;
  let front = Math.max(0, Number(frontWords) || 0);
  let frontPages = Math.max(0, Number(opts.frontPages) || 0);
  if (mode === 'legacy') {
    const r = legacyOutline(segs, front, frontPages);
    chapters = r.chapters;
    front = r.front;
    frontPages = r.frontP;
  } else {
    const roots = toTree(segs);
    const st = { front, frontP: frontPages, carry: 0, carryP: 0 };
    chapters = [];
    if (opts.single) {
      // Un fichier = un chapitre : s'il est coiffé d'un seul titre, ce sont ses sections qui nous intéressent
      const body = roots.filter(r => !MATTER_RE.test(norm(r.title)));
      if (body.length === 1 && body[0].kids.length) {
        st.front += body[0].own;
        st.frontP += body[0].ownP;
        for (const r of roots) {
          if (r === body[0]) r.kids.forEach(k => chapters.push(asChapter(k)));
          else chapters.push(asChapter(r));
        }
      } else roots.forEach(r => chapters.push(asChapter(r)));
    } else if (mode === 'auto') {
      collect(roots, (node, siblings, top) => (top && isDocumentTitle(node, siblings) ? 'title' : isPart(node) ? 'part' : ''), chapters, st, true);
    } else {
      const L = Math.round(Number(mode)) || 1;
      const single = roots.filter(r => !MATTER_RE.test(norm(r.title))).length === 1;
      collect(roots, (node, siblings, top) => (node.level < L && hasLevel(node, L) ? (top && single ? 'title' : 'part') : ''), chapters, st, true);
    }
    if (st.carry || st.carryP) { st.front += st.carry; st.frontP += st.carryP; } // texte d'ouverture sans chapitre après lui
    front = st.front;
    frontPages = st.frontP;
  }

  const body = chapters.filter(c => !MATTER_RE.test(norm(c.title)));
  const chapterLevel = mostFrequent((body.length ? body : chapters).map(c => c.level));
  const subLevel = mostFrequent(chapters.flatMap(c => c.children.map(k => k.level)));
  return { chapters, front, frontPages, mode, chapterLevel, subLevel, levels };
}

/* ------------------------------------------------------------
   TITRES SANS STYLES — repérés d'après la mise en forme
   Beaucoup de manuscrits n'utilisent pas les styles « Titre 1 »,
   « Titre 2 » : les titres y sont simplement plus gros, en gras,
   en capitales, centrés ou numérotés. Un PDF sans signets est dans
   le même cas. On repère donc les paragraphes courts, sans
   ponctuation finale, mis en valeur, et suivis de texte.

   items : [{ text, words, size, bold, caps, center, table, caption, list }]
           dans l'ordre du document (un paragraphe, ou un bloc de lignes)
   opts  : { bodySize, planTitles: [titres du plan déjà saisi] }
   Renvoie le niveau de chaque item (0 = ce n'est pas un titre).
------------------------------------------------------------ */
/** Clé de comparaison d'un titre : minuscules, sans accents, lettres et chiffres seulement. */
export function titleKey(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const CAPTION_RE = /^(figure|fig|tableau|table|tab|graphique|carte|schema|encadre|photo|photographie|illustration|source|sources|note|notes|legende|planche|image|equation|extrait|eq)\b[\s.:\d]/;
const MATTER_HEAD_RE = /^((general )?(introduction|conclusions?)( generale| general| generales)?( de la (premiere|deuxieme|troisieme) partie)?|conclusions? (et|and) (perspectives|outlook)|bibliograph(ie|y)( generale)?|references?( bibliographiques)?|remerciements|acknowledge?ments?|resume|abstract|summary|sommaire|table des matieres|(table of |list of )?contents|annexes?|appendi(x|ces)|avant propos|foreword|preface|dedicace|dedication|glossaire|glossary|nomenclature|index|(liste|table) des (figures|tableaux|abreviations|sigles|illustrations)|list of (figures|tables|abbreviations|symbols|publications|acronyms)|sigles et abreviations|publications|perspectives)$/;

/**
 * Numérotation portée par un titre.
 * kind : 'part' (Partie II), 'chap' (Chapitre 3), 'num' (1.2, II.3, A.1 ; depth = nombre de rangs),
 *        'matter' (introduction, bibliographie, remerciements…) ou ''.
 */
export function titleNumbering(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  const k = norm(t);
  if (PART_RE.test(k)) return { kind: 'part', depth: 0 };
  if (CHAP_RE.test(k)) return { kind: 'chap', depth: 1 };
  let m = /^(\d{1,2}(?:\.\d{1,2}){0,4})[.)]?\s+\S/.exec(t);                    // 1 Titre, 2.3.1 Titre
  if (m) return { kind: 'num', depth: m[1].split('.').length };
  m = /^(?:[IVXLC]{1,7}|[A-Z])((?:[.-]\d{1,2}){1,4})[.)]?\s*\S/.exec(t);       // II.3 Titre, A.1 Titre
  if (m) return { kind: 'num', depth: m[1].split(/[.-]/).length };
  if (/^(?:[IVXLC]{1,7}|[A-Z])\s?[.)–-]\s+\S/.test(t)) return { kind: 'num', depth: 1 }; // II. Titre, A) Titre
  if (MATTER_HEAD_RE.test(titleKey(t))) return { kind: 'matter', depth: 0 };
  return { kind: '', depth: 0 };
}

/**
 * Niveaux d'après la numérotation des titres, quand elle est assez présente.
 * Sert quand les niveaux donnés sont peu sûrs : titres repérés par leur taille, ou styles appliqués
 * au hasard (« Titre 1 » posé sur des sous-sections). Les titres sans numéro gardent leur rang relatif.
 * heads : [{ level, title }] ; opts.force : ne pas vérifier d'abord si les niveaux donnés conviennent.
 * Renvoie le tableau des nouveaux niveaux, ou null s'il n'y a rien à corriger.
 */
export function relevelByNumbering(heads, opts = {}) {
  const n = (heads || []).length;
  if (n < 3) return null;
  const info = heads.map(h => titleNumbering(h.title));
  const isStruct = x => x.kind === 'num' || x.kind === 'chap' || x.kind === 'part';
  if (info.filter(isStruct).length < Math.max(3, n * (opts.minShare || 0.3))) return null;
  const partOff = info.some(x => x.kind === 'part') ? 1 : 0;
  // « Chapitre II », puis « 1. », « 2. » : la numérotation repart dans chaque chapitre, ce sont ses sections
  const restarts = info.some(x => x.kind === 'chap') && info.some(x => x.kind === 'num' && x.depth === 1);
  const numOff = partOff + (restarts ? 1 : 0);
  const want = info.map(x => (x.kind === 'part' ? 1 : x.kind === 'chap' ? 1 + partOff : x.kind === 'num' ? x.depth + numOff : 0));
  // Niveau donné le plus fréquent pour chaque niveau attendu
  const by = new Map();
  heads.forEach((h, i) => {
    if (!want[i]) return;
    if (!by.has(want[i])) by.set(want[i], []);
    by.get(want[i]).push(h.level);
  });
  const wants = [...by.keys()].sort((a, b) => a - b);
  const typical = new Map(wants.map(w => [w, mostFrequent(by.get(w))]));
  if (!opts.force) {
    let fine = true;
    for (let i = 1; i < wants.length; i++) if (!(typical.get(wants[i]) > typical.get(wants[i - 1]))) fine = false;
    for (const w of wants) { const a = by.get(w); if (a.filter(v => v === typical.get(w)).length < a.length * 0.8) fine = false; }
    if (fine) return null;
  }
  const minTyp = Math.min(...typical.values());
  const maxTyp = Math.max(...typical.values());
  const out = [];
  let last = wants[0];
  for (let i = 0; i < n; i++) {
    const x = info[i];
    let lv = want[i];
    if (!lv) {
      // Sans numéro : au rang des titres numérotés qui lui ressemblent, sinon sous le titre précédent
      const g = heads[i].level;
      const same = wants.filter(w => typical.get(w) === g);
      if (same.length > 1 && x.kind === 'matter') {
        // « Conclusion », « Références » à l'allure de plusieurs rangs : une section du chapitre en cours tant
        // qu'un autre chapitre vient ensuite, une partie à part entière sinon (conclusion générale)
        const top = wants[0];
        lv = same[0] === top && want.some((w, j) => j > i && w > 0 && w <= top) ? same[1] : same[0];
      } else if (same.length > 1) {
        // Sans numéro, à l'allure de plusieurs rangs : au rang du titre précédent tant qu'on est dans une partie
        lv = same.includes(last) && want.some((w, j) => j > i && w > 0 && w < last) ? last : same[0];
      } else if (same.length === 1) lv = same[0];
      else if (g < minTyp) lv = wants[0];
      else if (g > maxTyp) lv = last + 1;
      else lv = wants.reduce((best, w) => (Math.abs(typical.get(w) - g) < Math.abs(typical.get(best) - g) ? w : best), wants[0]);
    }
    lv = Math.max(1, Math.min(6, lv));
    if (want[i] || lv <= last) last = lv;
    out.push(lv);
  }
  return out;
}

export function guessHeadings(items, opts = {}) {
  const n = (items || []).length;
  const levels = new Array(n).fill(0);
  if (!n) return levels;
  const words = it => (Number.isFinite(it.words) ? it.words : countWords(it.text));

  // Corps du texte : la taille qui porte le plus de mots
  let body = Number(opts.bodySize) || 0;
  if (!body) {
    const by = new Map();
    for (const it of items) { const k = Math.round((Number(it.size) || 0) * 2) / 2; if (k) by.set(k, (by.get(k) || 0) + words(it)); }
    let best = -1;
    for (const [k, w] of by) if (w > best) { best = w; body = k; }
  }
  const planKeys = new Set((opts.planTitles || []).map(titleKey).filter(k => k.length >= 3));

  const cand = new Array(n).fill(null);
  let count = 0;
  let candWords = 0;
  let allWords = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const t = String(it.text || '').replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const w = words(it);
    allWords += w;
    if (it.table || it.caption) continue;
    if (!w || w > 20 || t.length > 160) continue;
    if (/[\uFFFD.…·_]{4,}/.test(t)) continue;                             // points de conduite : une ligne de sommaire
    // Au moins un vrai mot (pas une formule, pas un numéro seul)
    if (!/\p{L}{3}/u.test(t) && (t.match(/\p{L}{2,}/gu) || []).length < 2) continue;
    const key = titleKey(t);
    if (CAPTION_RE.test(key + ' ')) continue;
    const nb = titleNumbering(t);
    const pat = nb.kind === 'part' || nb.kind === 'chap' || nb.kind === 'matter' ? nb.kind : '';
    if (!pat && /[.;,:]$/.test(t) && !/\.\.\.$/.test(t)) continue;      // une phrase, une étiquette
    if (/(\.{3,}|…|\s)\d{1,4}$/.test(t) && !pat && nb.kind !== 'num') continue; // ligne de table des matières
    const numbered = nb.kind === 'num';
    const size = Number(it.size) || 0;
    const big = size > 0 && body > 0 && size >= body * 1.12;
    const letters = t.replace(/[^\p{L}]/gu, '');
    const caps = !!it.caps || (letters.length >= 4 && letters === letters.toUpperCase() && letters !== letters.toLowerCase());
    const bold = !!it.bold;
    const center = !!it.center;
    const known = planKeys.has(key) || planKeys.has(key.replace(/^(?:[\divxlc]{1,4}\s)+/, ''));   // « 2.1 Terrain » pour « Terrain »
    let ok;
    if (it.list && !big && !pat && !known) ok = false;                     // une puce, un élément de liste
    else if (pat || known) ok = big || bold || caps || center || w <= 8;
    else if (big) ok = true;
    else ok = (bold && (numbered || caps || center || w <= 12)) || (caps && w <= 12 && (center || numbered));
    if (!ok) continue;
    cand[i] = { i, nb, pat, struct: numbered || pat === 'chap' || pat === 'part', size, bold, center, known };
    count++;
    candWords += w;
  }
  // Un document entièrement « mis en valeur » ne dit rien de sa structure
  if (count < 2 || candWords > allWords * 0.3) return levels;

  // Paliers de taille : deux corps à moins de 6 % l'un de l'autre sont le même
  const sizes = [...new Set(cand.filter(Boolean).map(c => c.size))].sort((a, b) => b - a);
  const tierOf = new Map();
  let tier = -1;
  let ref = Infinity;
  for (const s of sizes) { if (s < ref * 0.94) { tier++; ref = s; } tierOf.set(s, tier); }
  // Rang de chaque mise en forme : du plus visible au plus discret. Les capitales aident à repérer un titre,
  // pas à le classer : « INTRODUCTION » et « Chapitre 1 » sont souvent au même niveau.
  for (const c of cand) if (c) c.rank = tierOf.get(c.size) * 4 + (c.bold ? 0 : 2) + (c.center ? 0 : 1);
  // Une « partie » coiffe les chapitres, même mise en forme ou non
  const chapRank = Math.min(...cand.filter(c => c && c.pat === 'chap').map(c => c.rank), Infinity);
  if (Number.isFinite(chapRank)) for (const c of cand) if (c && c.pat === 'part' && c.rank >= chapRank) c.rank = chapRank - 0.5;

  // Un titre est suivi de texte (ou d'un sous-titre qui l'est) : une page de garde, un sommaire ne le sont pas
  const isBody = j => !cand[j] && words(items[j]) >= 12;
  const deeper = (c, d) => d.rank > c.rank || (c.struct && d.nb.kind === 'num' && (c.nb.kind !== 'num' || d.nb.depth > c.nb.depth));
  const anchored = new Array(n).fill(false);
  for (let i = n - 1; i >= 0; i--) {
    const c = cand[i];
    if (!c) continue;
    let skipped = 0;
    for (let j = i + 1; j < n && skipped <= 2; j++) {
      if (!String(items[j].text || '').trim()) continue;
      if (isBody(j)) { anchored[i] = true; break; }
      const d = cand[j];
      if (d) {
        // sous-titre, ou suite du titre sur la ligne suivante (« CHAPITRE 2 » puis son intitulé)
        const sequel = (c.pat === 'chap' || c.pat === 'part') && d.rank === c.rank && skipped === 0 && !d.pat && !d.struct;
        if (anchored[j] && (deeper(c, d) || sequel)) anchored[i] = true;
        break;
      }
      skipped++;
    }
  }
  let kept = cand.filter(c => c && anchored[c.i]);
  // Page de garde : ce qui précède le premier titre « de structure » (numéroté, chapitre, introduction…) n'en est pas un
  const firstStruct = kept.findIndex(c => c.struct || c.pat || c.known);
  if (firstStruct > 0) kept = kept.slice(firstStruct);
  if (kept.length < 2) return levels;
  const ranks = [...new Set(kept.map(c => c.rank))].sort((a, b) => a - b);
  let lv = kept.map(c => ranks.indexOf(c.rank) + 1);
  const byNum = relevelByNumbering(kept.map((c, k) => ({ level: lv[k], title: items[c.i].text })), { force: true, minShare: 0.2 });
  if (byNum) lv = byNum;
  const used = [...new Set(lv)].sort((a, b) => a - b);
  kept.forEach((c, k) => { levels[c.i] = Math.min(6, used.indexOf(lv[k]) + 1); });
  return levels;
}

/* ------------------------------------------------------------
   TEXTE BRUT — LaTeX, Markdown, ou texte simple
   Renvoie { segments, frontWords, frontChars, totalWords, kind }
   (chars = signes, espaces comprises : sans mise en page, c'est la
   mesure la plus sûre de la longueur d'un texte)
------------------------------------------------------------ */
const TEX_LEVELS = { part: 1, chapter: 2, section: 3, subsection: 4, subsubsection: 5 };
const TEX_HEAD = /\\(part|chapter|section|subsection|subsubsection)\*?\s*(?:\[[^\]]*\])?\s*\{/g;

/** Contenu d'un groupe { … } équilibré commençant à l'index de l'accolade ouvrante. */
function braceGroup(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { text: s.slice(open + 1, i), end: i + 1 }; }
  }
  return { text: s.slice(open + 1), end: s.length };
}

/** Ce qu'il reste d'un passage LaTeX une fois les commandes retirées : de quoi compter les mots. */
export function texToText(src) {
  return String(src)
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|math|tikzpicture|verbatim|lstlisting)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ')
    .replace(/\\\([\s\S]*?\\\)/g, ' ')
    .replace(/(^|[^\\])\$[^$\n]*\$/g, '$1 ')
    .replace(/\\(cite[a-z]*|ref|eqref|pageref|autoref|cref|label|includegraphics|input|include|bibliography|bibliographystyle|usepackage|documentclass|begin|end|vspace|hspace|setcounter|newcommand|renewcommand|url)\*?\s*(\[[^\]]*\])*\s*(\{[^{}]*\})*/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?\s*(\[[^\]]*\])*/g, ' ')
    .replace(/\\./g, ' ')
    .replace(/[{}~]/g, ' ');
}

function parseTex(text) {
  let src = text.replace(/(^|[^\\])%.*$/gm, '$1'); // commentaires
  const b = src.indexOf('\\begin{document}');
  if (b >= 0) src = src.slice(b + 16);
  const e = src.indexOf('\\end{document}');
  if (e >= 0) src = src.slice(0, e);
  const heads = [];
  TEX_HEAD.lastIndex = 0;
  let m;
  while ((m = TEX_HEAD.exec(src))) {
    const g = braceGroup(src, m.index + m[0].length - 1);
    heads.push({ at: m.index, end: g.end, level: TEX_LEVELS[m[1]], title: texToText(g.text).replace(/\s+/g, ' ').trim() });
    TEX_HEAD.lastIndex = g.end;
  }
  const segments = [];
  const frontText = texToText(src.slice(0, heads.length ? heads[0].at : src.length));
  heads.forEach((h, i) => {
    const body = texToText(src.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : src.length));
    if (h.title) segments.push({ level: h.level, title: h.title.slice(0, 200), words: countWords(h.title) + countWords(body), chars: signs(h.title) + signs(body) });
  });
  return { segments, frontWords: countWords(frontText), frontChars: signs(frontText), kind: 'latex' };
}

const PLAIN_HEAD = /^(?:(partie|part)\s+([ivx]+|\d+|un|une|deux|trois)\b|(chapitre|chapter)\s+([ivxlc]+|\d+|un|premier)\b|(introduction|conclusion)(\s+g[ée]n[ée]rale)?\s*$|(bibliographie|r[ée]f[ée]rences|annexes?)\s*$)/i;

/** Nombre de signes d'un texte (espaces comprises, blancs répétés comptés une fois). */
export function signs(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().length;
}

function parseLines(text) {
  const segments = [];
  let frontWords = 0;
  let frontChars = 0;
  let cur = null;
  let fence = false;
  let md = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; continue; }
    let head = null;
    if (!fence) {
      const mh = /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
      if (mh) { head = { level: mh[1].length, title: mh[2] }; md = true; }
      else if (line.length <= 140 && !/[.;,]$/.test(line)) {
        const mp = PLAIN_HEAD.exec(line);
        if (mp) head = { level: mp[1] ? 1 : 2, title: line };
      }
    }
    if (head) {
      cur = { level: head.level, title: head.title.replace(/[*_`]/g, '').slice(0, 200), words: countWords(head.title), chars: signs(head.title) };
      segments.push(cur);
      continue;
    }
    const clean = line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#|]/g, ' ');
    const n = countWords(clean);
    const c = n ? signs(clean) + 1 : 0;
    if (cur) { cur.words += n; cur.chars += c; }
    else { frontWords += n; frontChars += c; }
  }
  return { segments, frontWords, frontChars, kind: md ? 'markdown' : 'text' };
}

export function parseTextDocument(text) {
  const src = String(text || '');
  TEX_HEAD.lastIndex = 0;
  const r = TEX_HEAD.test(src) || /\\begin\{document\}/.test(src) ? parseTex(src) : parseLines(src);
  r.totalWords = r.frontWords + r.segments.reduce((s, x) => s + x.words, 0);
  return r;
}

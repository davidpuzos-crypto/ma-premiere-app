/* ============================================================
   PLAN D'UN DOCUMENT — des titres bruts au plan suivi
   Logique pure, commune à tous les formats (Word, LibreOffice,
   texte collé, LaTeX, Markdown). Testée dans tests/core.test.mjs.

   Entrée : segments = [{ level: 1..9, title, words }]
            (words = le titre et tout le texte jusqu'au titre suivant)
            frontWords = mots placés avant le premier titre
   Sortie : { chapters: [{ title, level, ownWords, words,
                           children: [{ title, level, words }] }],
              front, mode, chapterLevel, subLevel, levels }

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
    const node = { title: String(s.title || '').slice(0, 200), level, own: Math.max(0, Number(s.words) || 0), kids: [] };
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    if (stack.length) stack[stack.length - 1].kids.push(node);
    else roots.push(node);
    stack.push(node);
  }
  return roots;
}

const total = n => n.own + n.kids.reduce((s, k) => s + total(k), 0);
const hasLevel = (n, L) => n.kids.some(k => k.level === L || hasLevel(k, L));

function asChapter(n) {
  return {
    title: n.title, level: n.level, ownWords: n.own, words: total(n),
    children: n.kids.map(k => ({ title: k.title, level: k.level, words: total(k) })),
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
  return node.kids.some(k => CHAP_RE.test(norm(k.title)));
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
      if (st.carry) { ch.ownWords += st.carry; ch.words += st.carry; st.carry = 0; }
      out.push(ch);
      continue;
    }
    // Enveloppe : son texte d'ouverture
    if (kind === 'title') st.front += node.own;                      // résumé, dédicace… avant le premier chapitre
    else if (node.own >= PART_INTRO_MIN) out.push({ title: node.title, level: node.level, ownWords: node.own, words: node.own, children: [] });
    else st.carry += node.own;                                       // compté avec le chapitre qui suit
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
function legacyOutline(segments, frontWords) {
  const levels = [...new Set(segments.map(s => s.level))].sort((a, b) => a - b);
  const top = levels.length ? levels[0] : null;
  const second = levels.length > 1 ? levels[1] : null;
  const chapters = [];
  let front = frontWords;
  let ch = null;
  let sub = null;
  for (const s of segments) {
    if (s.level === top) {
      ch = { title: s.title, level: s.level, ownWords: s.words, words: 0, children: [] };
      chapters.push(ch);
      sub = null;
    } else if (second !== null && s.level === second) {
      if (!ch) { front += s.words; continue; }
      sub = { title: s.title, level: s.level, words: s.words };
      ch.children.push(sub);
    } else if (sub) sub.words += s.words;
    else if (ch) ch.ownWords += s.words;
    else front += s.words;
  }
  for (const c of chapters) c.words = c.ownWords + c.children.reduce((a, x) => a + x.words, 0);
  return { chapters, front };
}

/**
 * Construit le plan à deux étages.
 * mode : 'auto' (recommandé), un nombre (niveau de titre des chapitres) ou 'legacy'.
 * opts.single : le document est un seul chapitre ; on renvoie ses sections au premier étage.
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
  if (mode === 'legacy') {
    ({ chapters, front } = legacyOutline(segs, front));
  } else {
    const roots = toTree(segs);
    const st = { front, carry: 0 };
    chapters = [];
    if (opts.single) {
      // Un fichier = un chapitre : s'il est coiffé d'un seul titre, ce sont ses sections qui nous intéressent
      const body = roots.filter(r => !MATTER_RE.test(norm(r.title)));
      if (body.length === 1 && body[0].kids.length) {
        st.front += body[0].own;
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
    if (st.carry) st.front += st.carry; // texte d'ouverture sans chapitre après lui
    front = st.front;
  }

  const body = chapters.filter(c => !MATTER_RE.test(norm(c.title)));
  const chapterLevel = mostFrequent((body.length ? body : chapters).map(c => c.level));
  const subLevel = mostFrequent(chapters.flatMap(c => c.children.map(k => k.level)));
  return { chapters, front, mode, chapterLevel, subLevel, levels };
}

/* ------------------------------------------------------------
   TEXTE BRUT — LaTeX, Markdown, ou texte simple
   Renvoie { segments, frontWords, totalWords, kind }
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
  const frontWords = countWords(texToText(src.slice(0, heads.length ? heads[0].at : src.length)));
  heads.forEach((h, i) => {
    const body = src.slice(h.end, i + 1 < heads.length ? heads[i + 1].at : src.length);
    if (h.title) segments.push({ level: h.level, title: h.title.slice(0, 200), words: countWords(h.title) + countWords(texToText(body)) });
  });
  return { segments, frontWords, kind: 'latex' };
}

const PLAIN_HEAD = /^(?:(partie|part)\s+([ivx]+|\d+|un|une|deux|trois)\b|(chapitre|chapter)\s+([ivxlc]+|\d+|un|premier)\b|(introduction|conclusion)(\s+g[ée]n[ée]rale)?\s*$|(bibliographie|r[ée]f[ée]rences|annexes?)\s*$)/i;

function parseLines(text) {
  const segments = [];
  let frontWords = 0;
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
      cur = { level: head.level, title: head.title.replace(/[*_`]/g, '').slice(0, 200), words: countWords(head.title) };
      segments.push(cur);
      continue;
    }
    const n = countWords(line.replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`>#|]/g, ' '));
    if (cur) cur.words += n;
    else frontWords += n;
  }
  return { segments, frontWords, kind: md ? 'markdown' : 'text' };
}

export function parseTextDocument(text) {
  const src = String(text || '');
  TEX_HEAD.lastIndex = 0;
  const r = TEX_HEAD.test(src) || /\\begin\{document\}/.test(src) ? parseTex(src) : parseLines(src);
  r.totalWords = r.frontWords + r.segments.reduce((s, x) => s + x.words, 0);
  return r;
}

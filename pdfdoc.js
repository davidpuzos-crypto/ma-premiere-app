/* ============================================================
   PDF — du texte des pages au plan suivi
   Logique pure (testée dans tests/core.test.mjs). La lecture du
   fichier lui-même est faite par pdfread.js, qui fournit un
   « modèle » simple :
     { pages:   [{ w, h, lines: [{ x, y, size, text, bold }] }],
       outline: [{ title, level, page, y }]      signets du PDF
       tags:    [{ title, level, page, y }]      titres balisés (PDF accessible)
       info:    { producer, creator, title } }
   y = distance depuis le haut de la page, en points (null si inconnue).

   Un PDF donne la pagination exacte. Reste à savoir où commencent
   les parties. Dans l'ordre de confiance :
     1. les signets (LaTeX avec hyperref, LibreOffice, Google Docs, Typst) ;
     2. les titres balisés (Word : « balises de structure ») ;
     3. la mise en forme : lignes courtes en plus gros que le texte ;
     4. les titres du plan déjà saisi, retrouvés dans le texte.
============================================================ */
import { countWords, signs, guessHeadings, titleKey, relevelByNumbering } from './outline.js';
import { spans } from './pages.js';

const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };

/**
 * Regroupe les fragments de texte d'une page en lignes.
 * items : [{ str, x, y, size, w, eol, bold }] dans l'ordre du flux (y depuis le haut de la page).
 */
export function linesFromItems(items) {
  const lines = [];
  let cur = null;
  const close = () => {
    if (!cur) return;
    const text = cur.parts.join('').replace(/\s+/g, ' ').trim();
    if (text) {
      // Corps de la ligne : celui qui porte le plus de caractères (un appel de note ne compte pas)
      let size = 0;
      let best = -1;
      for (const [s, n] of cur.sizes) if (n > best) { best = n; size = s; }
      lines.push({ x: cur.x, y: cur.y, size, text, bold: cur.boldChars > cur.chars / 2, w: Math.max(0, cur.x2 - cur.x) });
    }
    cur = null;
  };
  for (const it of items || []) {
    const str = String(it.str || '');
    const size = Number(it.size) || 0;
    if (!str) { if (it.eol) close(); continue; }
    const blank = !str.trim();
    if (cur) {
      const ref = Math.max(cur.size, size) || 10;
      const dy = Math.abs(it.y - cur.y);
      const small = size && cur.size && size < cur.size * 0.8;             // exposant, appel de note
      const back = it.x < cur.x2 - ref * 6 && dy > ref * 0.15;             // retour à la ligne
      const same = dy <= ref * 0.4 || (small && dy <= ref * 0.75);
      if (!same || back) close();
    }
    if (!cur) {
      if (blank) { if (it.eol) close(); continue; }
      cur = { x: it.x, x2: it.x + (it.w || 0), y: it.y, size, parts: [], sizes: new Map(), chars: 0, boldChars: 0 };
    } else if (!blank) {
      const gap = it.x - cur.x2;
      const last = cur.parts[cur.parts.length - 1] || '';
      if (gap > (cur.size || size || 10) * 0.2 && !/\s$/.test(last) && !/^\s/.test(str)) cur.parts.push(' ');
    }
    cur.parts.push(str);
    if (!blank) {
      const n = str.trim().length;
      const k = Math.round(size * 10) / 10;
      cur.sizes.set(k, (cur.sizes.get(k) || 0) + n);
      cur.chars += n;
      if (it.bold) cur.boldChars += n;
      if (size >= cur.size) { cur.size = size; cur.y = it.y; }
      cur.x = Math.min(cur.x, it.x);
      cur.x2 = Math.max(cur.x2, it.x + (it.w || 0));
    }
    if (it.eol) close();
  }
  close();
  return lines;
}

/**
 * En-têtes et pieds de page : lignes courtes, en haut ou en bas de page, qui reviennent de page en page
 * (au numéro près). Marque line.hf = true : elles ne sont ni du texte rédigé, ni des titres.
 */
export function markRunning(pages) {
  const seen = new Map();
  const cand = [];
  const sig = t => titleKey(t).replace(/\d+/g, '').slice(0, 60);
  pages.forEach((pg, i) => {
    const H = pg.h || 842;
    for (const ln of pg.lines) {
      const top = ln.y < H * 0.11;
      const bottom = ln.y > H * 0.9;
      if (!top && !bottom) continue;
      if (countWords(ln.text) > 16) continue;
      const k = `${top ? 't' : 'b'}|${sig(ln.text)}`;
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(i);
      cand.push([ln, k]);
    }
  });
  const need = Math.max(3, Math.round(pages.length * 0.04));
  for (const [ln, k] of cand) {
    // Un numéro de page seul (signature vide) ou un texte qui revient sur plusieurs pages
    const alone = /^[\s\divxlcIVXLC.\-–—/|]*$/.test(ln.text) && ln.text.trim().length <= 12;
    if (alone || seen.get(k).size >= need) ln.hf = true;
  }
}

const isCaption = t => /^(figure|fig|tableau|table|tab|graphique|carte|schema|encadre|photo|photographie|illustration|source|sources|note|notes|legende|planche|image|annexe \d+ ?[:.])\b[\s.:\d]/.test(t + ' ');

/** Ligne qui porte ce titre ? (comparaison sur les lettres et chiffres seulement : les blancs d'un PDF ne sont pas fiables) */
function lineMatches(lineKey, key) {
  if (!key || !lineKey) return false;
  if (lineKey === key) return true;
  const a = lineKey.replace(/\s+/g, '');
  const b = key.replace(/\s+/g, '');
  if (a === b) return true;
  // « 1.2 Contexte » pour « Contexte », « Chapitre 3 » pour « Chapitre 3 : Résultats » (titre sur deux lignes)
  const stripped = a.replace(/^(chapitre|chapter|partie|part|section|annexe|appendix)?[\divxlc]{0,6}/, '');
  if (b.length >= 4 && (stripped === b || a.endsWith(b) && a.length - b.length <= 12)) return true;
  return b.length >= 8 && a.length >= 6 && b.startsWith(a) && a.length >= b.length * 0.45;
}

/**
 * Analyse un modèle de PDF.
 * opts.planTitles : [{ title, level }] titres du plan déjà saisi (dernier recours pour situer les parties)
 * Renvoie { kind, segments, frontWords, frontChars, frontPages, totalWords, totalPages, pages, headingSource, bodySize, textPages }
 */
export function analyzePdfModel(model, opts = {}) {
  const pages = (model && model.pages) || [];
  const total = pages.length;
  markRunning(pages);

  // Lignes dans l'ordre du flux, avec leur page
  const all = [];
  pages.forEach((pg, pi) => { for (const ln of pg.lines) { if (!ln.hf) all.push({ ...ln, page: pi, key: titleKey(ln.text), words: countWords(ln.text) }); } });
  // Tables des matières, des figures, des tableaux : des pages dont beaucoup de lignes finissent par un numéro de page.
  // Leurs lignes reprennent les titres : il ne faut pas les confondre avec eux.
  const tocPage = new Array(total).fill(false);
  pages.forEach((pg, pi) => {
    const body = pg.lines.filter(l => !l.hf);
    const ends = body.filter(l => /\p{L}/u.test(l.text) && (/(\.{2,}|…|\s)\s?\d{1,4}$/.test(l.text.trim()) || /[\uFFFD.…·_]{4,}/.test(l.text))).length;
    if (ends >= 6 && ends >= body.length * 0.3) tocPage[pi] = true;
  });

  // Corps du texte : la taille qui porte le plus de mots ; bande utile de la page (haut et bas du texte)
  const bySize = new Map();
  for (const ln of all) { const k = Math.round(ln.size * 2) / 2; bySize.set(k, (bySize.get(k) || 0) + ln.words); }
  let bodySize = 0;
  let bestW = -1;
  for (const [k, w] of bySize) if (w > bestW) { bestW = w; bodySize = k; }
  const tops = [];
  const bottoms = [];
  pages.forEach(pg => {
    const body = pg.lines.filter(l => !l.hf);
    if (body.length < 8) return;                    // page presque vide : elle ne dit rien des marges
    tops.push(Math.min(...body.map(l => l.y - l.size)));
    bottoms.push(Math.max(...body.map(l => l.y)));
  });
  const H0 = (pages[0] && pages[0].h) || 842;
  const bandTop = tops.length ? Math.max(0, median(tops)) : H0 * 0.08;
  const bandBottom = bottoms.length ? median(bottoms) : H0 * 0.92;
  const frac = y => (y === null || y === undefined ? 0 : Math.max(0, Math.min(0.999, (y - bandTop) / Math.max(1, bandBottom - bandTop))));

  // Première ligne de chaque page dans « all »
  const firstOf = new Array(total + 1).fill(all.length);
  for (let i = all.length - 1; i >= 0; i--) firstOf[all[i].page] = i;
  for (let p = total - 1; p >= 0; p--) if (firstOf[p] === all.length || firstOf[p] > firstOf[p + 1]) firstOf[p] = Math.min(firstOf[p], firstOf[p + 1]);

  /** Situe un titre donné par (page, y) : la ligne qui le porte si on la trouve, sinon la première ligne à cette hauteur. */
  const locate = (title, page, y) => {
    if (!(page >= 0 && page < total)) return null;
    const key = titleKey(title);
    const a = firstOf[page];
    const b = firstOf[page + 1];
    let hit = -1;
    let near = -1;
    for (let i = a; i < b; i++) {
      const ln = all[i];
      if (y !== null && y !== undefined && near < 0 && ln.y >= y - 2) near = i;
      if (hit < 0 && lineMatches(ln.key, key) && (y === null || y === undefined || Math.abs(ln.y - y) < 140)) hit = i;
    }
    const at = hit >= 0 ? hit : near >= 0 ? near : a;
    const ly = hit >= 0 ? all[hit].y - all[hit].size : (y !== null && y !== undefined ? y : (at < b ? all[at].y - all[at].size : bandTop));
    // Le texte tel qu'il est composé (avec ses espaces), sur une ou deux lignes
    let text = '';
    if (hit >= 0) {
      const want = key.replace(/\s+/g, '');
      text = all[hit].text;
      for (let j = hit + 1; j < b && j <= hit + 2; j++) {
        const more = titleKey(text + ' ' + all[j].text).replace(/\s+/g, '');
        if (more.length <= want.length + 2 && want.startsWith(more.slice(0, Math.min(more.length, want.length)))) text += ' ' + all[j].text;
        else break;
      }
    }
    return { at, pos: page + frac(ly), text };
  };

  let heads = [];
  let headingSource = '';
  const fromMarks = (marks, ownText) => {
    const out = [];
    for (const m of marks || []) {
      let title = String(m.title || '').replace(/\s+/g, ' ').trim();
      if (!title) continue;
      const loc = locate(title, m.page, m.y);
      if (!loc) continue;
      if (ownText && loc.text) title = loc.text;
      if (!/\p{L}{3}/u.test(title)) continue;                                  // un numéro seul n'est pas un titre
      out.push({ level: Math.max(1, Math.min(9, m.level || 1)), title: title.slice(0, 200), at: loc.at, pos: loc.pos });
    }
    return out;
  };

  // Un PDF sans texte (pages scannées) : on en connaît le nombre de pages, rien de plus
  const wordsAll = all.reduce((s, l) => s + l.words, 0);
  const scanned = total > 0 && wordsAll < total * 20;

  // 1. Signets
  if (model.outline && model.outline.length) { heads = fromMarks(model.outline, false); if (heads.length) headingSource = 'outline'; }
  // 2. Titres balisés (leur niveau suit les styles du document : s'ils contredisent la numérotation, elle l'emporte)
  if (!heads.length && model.tags && model.tags.length) {
    heads = fromMarks(model.tags, true);
    if (heads.length >= 2) {
      headingSource = 'tags';
      const lv = relevelByNumbering(heads);
      if (lv) heads.forEach((h, i) => { h.level = lv[i]; });
    } else heads = [];
  }
  // 3. Mise en forme : les lignes voisines de même corps forment un bloc (titre sur deux lignes, paragraphe)
  //    Aussi quand signets ou balises ne donnent presque rien (deux lignes de couverture pour 300 pages)
  const poor = heads.length < Math.max(4, total / 40);
  if ((!heads.length || poor) && all.length && !scanned) {
    const given = heads;
    const givenSource = headingSource;
    heads = [];
    const blocks = [];
    let cur = null;
    for (let i = 0; i < all.length; i++) {
      const ln = all[i];
      const joins = cur && cur.page === ln.page && Math.abs(ln.size - cur.size) <= 0.35 && !!ln.bold === !!cur.bold
        && ln.y - cur.lastY > 0 && ln.y - cur.lastY <= Math.max(ln.size, cur.size) * 1.75;
      if (joins) { cur.text += ' ' + ln.text; cur.words += ln.words; cur.lastY = ln.y; cur.n++; }
      else { cur = { at: i, page: ln.page, y: ln.y, lastY: ln.y, size: ln.size, bold: !!ln.bold, text: ln.text, words: ln.words, n: 1, x: ln.x, w: ln.w }; blocks.push(cur); }
    }
    const W = (pages[0] && pages[0].w) || 595;
    const items = blocks.map(b => {
      const mid = b.x + b.w / 2;
      return { text: b.text, words: b.words, size: b.size, bold: b.bold, center: b.n === 1 && Math.abs(mid - W / 2) < W * 0.06 && b.w < W * 0.55, caption: isCaption(titleKey(b.text)), table: tocPage[b.page] };
    });
    const levels = guessHeadings(items, { bodySize, planTitles: (opts.planTitles || []).map(t => t.title) });
    levels.forEach((lv, k) => {
      if (!lv) return;
      const b = blocks[k];
      heads.push({ level: lv, title: b.text.slice(0, 200), at: b.at, pos: b.page + frac(b.y - b.size) });
    });
    if (heads.length >= 2 && heads.length > given.length * 2) headingSource = 'layout';
    else { heads = given; headingSource = givenSource; }
  }
  // 4. Titres du plan retrouvés dans le texte (hors table des matières : lignes finissant par un numéro de page)
  if (!heads.length && opts.planTitles && opts.planTitles.length && all.length && !scanned) {
    let from = 0;
    for (const pt of opts.planTitles) {
      const key = titleKey(pt.title);
      if (key.length < 3) continue;
      let hit = -1;
      for (let i = from; i < all.length; i++) {
        const ln = all[i];
        if (ln.words > 20 || tocPage[ln.page] || /(\.{2,}|\s)\d{1,4}$/.test(ln.text.trim())) continue;
        if (lineMatches(ln.key, key) && ln.size >= bodySize - 0.3) { hit = i; break; }
      }
      if (hit < 0) continue;
      heads.push({ level: pt.level || 1, title: String(pt.title).slice(0, 200), at: hit, pos: all[hit].page + frac(all[hit].y - all[hit].size) });
      from = hit + 1;
    }
    if (heads.length) headingSource = 'plan';
  }

  // Ordre du document ; deux titres au même endroit restent dans l'ordre donné
  heads = heads.map((h, i) => ({ ...h, i })).sort((a, b) => a.at - b.at || a.pos - b.pos || a.i - b.i);
  for (let i = 1; i < heads.length; i++) if (heads[i].pos < heads[i - 1].pos) heads[i].pos = heads[i - 1].pos;
  // « Chapitre 3 » seul, suivi aussitôt de son intitulé (même niveau, ou signet juste en dessous) : un seul titre
  const LABEL = /^(chapitre|chapter|chap\.?|partie|part|section)\s+[\divxlc]+\s*[.:]?$/i;
  for (let i = 0; i + 1 < heads.length; i++) {
    const h = heads[i];
    const nx = heads[i + 1];
    if (!LABEL.test(h.title) || nx.at - h.at > 2 || (nx.level !== h.level && nx.level !== h.level + 1)) continue;
    if (LABEL.test(nx.title)) continue;
    const demote = nx.level === h.level + 1;
    h.title = `${h.title.replace(/\s*[.:]$/, '')} : ${nx.title}`.slice(0, 200);
    heads.splice(i + 1, 1);
    // les signets rangés sous l'intitulé remontent d'un cran avec lui
    if (demote) for (let j = i + 1; j < heads.length && heads[j].level > h.level; j++) heads[j].level--;
  }

  // Mots et signes de chaque partie : les lignes entre deux titres, coupures de mots en fin de ligne recollées
  const textOf = (a, b) => {
    let s = '';
    for (let i = a; i < b; i++) {
      const t = all[i].text;
      if (/[\p{L}]-$/u.test(s) && /^[\p{Ll}]/u.test(t)) s = s.slice(0, -1) + t;
      else s += (s ? ' ' : '') + t;
    }
    return s;
  };
  const measure = (a, b) => { const t = textOf(a, b); return { words: countWords(t), chars: signs(t) }; };
  const front = measure(0, heads.length ? heads[0].at : all.length);
  const sp = spans(heads.map(h => h.pos), total);
  const segments = heads.map((h, i) => {
    const m = measure(h.at, i + 1 < heads.length ? heads[i + 1].at : all.length);
    return { level: h.level, title: h.title, words: m.words, chars: m.chars, pages: sp.pages[i] };
  });
  const totalWords = front.words + segments.reduce((s, x) => s + x.words, 0);
  return {
    kind: 'pdf', segments, frontWords: front.words, frontChars: front.chars, frontPages: sp.front,
    totalWords, totalPages: total, headingSource, bodySize, scanned,
    textPages: pages.filter(pg => pg.lines.some(l => !l.hf)).length,
  };
}

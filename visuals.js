/* ============================================================
   DESSINS — les objets du bureau, générés à partir des données
   Fonctions pures : des nombres en entrée, du HTML ou du SVG en
   sortie. Aucune dépendance, aucun accès à la page.
     • l'étagère : un livre par chapitre, d'autant plus épais que le
       chapitre est long, surligné à hauteur de ce qui est écrit ;
     • la plante : elle pousse avec la série de jours d'écriture ;
     • la semaine : sept barres fines sur une même base ;
     • le niveau : les grades franchis, et le prochain.
============================================================ */

const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const fmtPages = n => String(Math.round(n * 10) / 10).replace('.', ',');

/* ---------- La plante de la série ---------- */
const LEAF = 'M0 0C4-9 16-13 24-7C18 2 7 5 0 0Z';

/** Étapes de croissance : [jours d'affilée, hauteur de tige, nombre de feuilles, sommet]. */
const GROWTH = [
  [0, 0, 0, ''], [1, 12, 2, ''], [2, 22, 2, ''], [4, 32, 4, ''], [7, 44, 6, ''],
  [14, 54, 6, 'bud'], [21, 60, 8, 'bud'], [30, 64, 8, 'flower'],
];

export function plantStage(streak) {
  let s = GROWTH[0];
  for (const g of GROWTH) if (streak >= g[0]) s = g;
  return { height: s[1], leaves: s[2], top: s[3] };
}

/**
 * La plante en pot. streak = jours d'affilée ; wilted = on a déjà écrit, mais plus depuis plusieurs jours.
 * width (facultatif) : taille fixe en pixels, pour les images à partager.
 */
export function plantSVG(streak, { wilted = false, width = 0 } = {}) {
  const pot = '<path d="M24 86h42l-5 34H29z" fill="#C4683A"/><path d="M24 86h42l-1.200 8H25.200z" fill="#A9532A" opacity=".55"/>'
    + '<rect x="20" y="79" width="50" height="9" rx="3" fill="#B85C30"/><ellipse cx="45" cy="80.500" rx="21" ry="2.600" fill="#3A2A20"/>';
  let green = '';
  if (wilted) {
    // Tige qui pique du nez, feuilles ternes : elle a soif de pages
    green = '<path d="M45 80C45 58 60 52 66 66" fill="none" stroke="#8C9160" stroke-width="3" stroke-linecap="round"/>'
      + `<path d="${LEAF}" transform="translate(64 64) rotate(70) scale(.75)" fill="#A3A66F"/>`
      + `<path d="${LEAF}" transform="translate(50 62) scale(-1 1) rotate(40) scale(.6)" fill="#8C9160"/>`;
  } else {
    const { height: h, leaves, top } = plantStage(streak);
    if (h > 0) {
      const sway = h > 30 ? 3 : 1;
      const tipX = 45 + sway;
      const tipY = 80 - h;
      green += `<path d="M45 80C45 ${(80 - h * 0.45).toFixed(1)} ${tipX} ${(80 - h * 0.6).toFixed(1)} ${tipX} ${tipY}" fill="none" stroke="#2F7350" stroke-width="3" stroke-linecap="round"/>`;
      const pairs = Math.ceil(leaves / 2);
      for (let i = 0; i < leaves; i++) {
        const pair = Math.floor(i / 2);
        const t = leaves <= 2 ? 1 : 0.38 + (pair / Math.max(1, pairs - 1)) * 0.62; // position le long de la tige
        const y = (80 - h * t).toFixed(1);
        const x = (45 + sway * t).toFixed(1);
        const size = ((leaves <= 2 ? 0.5 : 0.62 + (1 - t) * 0.5) * (h < 20 ? 0.8 : 1)).toFixed(2);
        green += i % 2
          ? `<path d="${LEAF}" transform="translate(${x} ${y}) scale(-1 1) rotate(-22) scale(${size})" fill="#2F7350"/>`
          : `<path d="${LEAF}" transform="translate(${x} ${y}) rotate(-22) scale(${size})" fill="#3E8A62"/>`;
      }
      if (top === 'bud') green += `<circle cx="${tipX}" cy="${tipY - 3}" r="4.500" fill="#F0AE3C"/>`;
      if (top === 'flower') {
        let petals = '';
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          petals += `<circle cx="${(tipX + Math.cos(a) * 6).toFixed(1)}" cy="${(tipY - 5 + Math.sin(a) * 6).toFixed(1)}" r="4.200" fill="#F3C566"/>`;
        }
        green += `${petals}<circle cx="${tipX}" cy="${tipY - 5}" r="3.600" fill="#C47C12"/>`;
      }
    } else {
      green = '<path d="M41 80q4-5 8 0" fill="#5B4636"/>'; // rien n'a encore poussé : un peu de terre retournée
    }
  }
  const size = width ? ` width="${width}" height="${Math.round(width * 120 / 90)}"` : '';
  // Dans une image à partager, la taille est écrite en clair (pas de classe : elle étirerait le dessin)
  return `<svg class="${width ? 'sc-plant' : 'plant-svg'}" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 90 120"${size} aria-hidden="true">${green}${pot}</svg>`;
}

/** La plante sous forme d'image (pour les images à partager : leur moteur de rendu dessine mal un SVG posé dans la page). */
export function plantImgHTML(streak, width) {
  const svg = plantSVG(streak, { width });
  return `<img class="sc-plant" alt="" width="${width}" height="${Math.round(width * 120 / 90)}" src="data:image/svg+xml,${encodeURIComponent(svg)}">`;
}

/** Ce que la plante raconte (pour l'info-bulle et les lecteurs d'écran). */
export function plantCaption(streak, wilted) {
  if (wilted) return 'La plante a soif de pages : une ligne aujourd\'hui, et elle repart.';
  if (streak <= 0) return 'Un pot, de la terre. La plante pousse avec votre série de jours d\'écriture.';
  const { top } = plantStage(streak);
  const days = `${streak} jour${streak > 1 ? 's' : ''} d'affilée`;
  if (top === 'flower') return `${days} : elle est en fleur.`;
  if (top === 'bud') return `${days} : un bouton se prépare.`;
  return `${days} : elle pousse.`;
}

/** Une araignée au bout de son fil : personne n'a touché à l'étagère depuis longtemps. */
export function spiderSVG(length = 46) {
  const y = length;
  const legs = [[-7, -4, -11, -1], [-7, 0, -12, 3], [-6, 3, -10, 8], [7, -4, 11, -1], [7, 0, 12, 3], [6, 3, 10, 8]]
    .map(([x1, y1, x2, y2]) => `<path d="M${10 + x1 * 0.4} ${y + y1 * 0.4}L${10 + x1} ${y + y1}L${10 + x2} ${y + y2}"/>`).join('');
  return `<svg class="shelf-spider" viewBox="0 0 22 ${y + 12}" width="22" height="${y + 12}" aria-hidden="true">`
    + `<path d="M10 0V${y - 4}" stroke="#44575A" stroke-width=".800" fill="none"/>`
    + `<g fill="none" stroke="#16282A" stroke-width="1" stroke-linecap="round" stroke-linejoin="round">${legs}</g>`
    + `<ellipse cx="10" cy="${y}" rx="4" ry="4.600" fill="#16282A"/><circle cx="10" cy="${y - 5}" r="2.400" fill="#16282A"/></svg>`;
}

/* ---------- L'étagère ---------- */

/** Épaisseur d'un livre (px) d'après son objectif de pages : de 30 à 88. */
export function bookWidth(target) {
  return Math.round(clampN(26 + (Number(target) || 0) * 0.62, 30, 88));
}

/** Hauteur d'un livre : une petite irrégularité fixe par position, comme sur une vraie étagère. */
export function bookHeight(index, base = 184) {
  return base + [8, 0, 14, 4, 18, 2, 10, 16, 6, 12][index % 10];
}

const STATUS_ICON = { sent: 'i-send', revise: 'i-pencil', ok: 'i-check' };
const STATUS_WORD = { sent: 'chez la direction', revise: 'à corriger', ok: 'validé' };

/** La phrase qui décrit un livre : lue par les lecteurs d'écran, affichée au survol. */
export function bookLabel(b) {
  const pct = clampN(Math.round(b.pct || 0), 0, 100);
  return `${b.title} : ${b.written} page${b.written > 1 ? 's' : ''} sur ${b.target}, ${pct} %`
    + (b.status && STATUS_WORD[b.status] ? `, ${STATUS_WORD[b.status]}` : '')
    + (b.due ? `, à finir pour le ${b.due}` : '')
    + (b.current ? ' (partie en cours)' : '');
}

function bookClass(b, pct) {
  return ['book', pct === 0 ? 'is-empty' : '', pct >= 100 ? 'is-done' : '', b.current ? 'is-current' : '',
    b.status && STATUS_ICON[b.status] ? 'has-tag' : ''].filter(Boolean).join(' ');
}

/** Ce qui est posé sur le dos d'un livre : son titre, le marque-page de la partie en cours, le statut. */
function bookExtrasHTML(b) {
  const tag = b.status && STATUS_ICON[b.status]
    ? `<span class="book-tag st-${b.status}"><svg class="ic" aria-hidden="true"><use href="#${STATUS_ICON[b.status]}"/></svg></span>` : '';
  return `<span class="book-title"><span>${escHtml(b.title)}</span></span>` + (b.current ? '<span class="book-mark"></span>' : '') + tag;
}
const bookSig = b => `${b.title}|${b.status || ''}|${b.current ? 1 : 0}`;

/**
 * books : [{ id, title, pct, written, target, status, current, due }]
 * Renvoie les livres (des boutons) ; la planche et la plante sont ajoutées par la page.
 * intro : les livres arrivent vides, la page les remplit à l'image suivante (le surlignage monte).
 */
export function shelfBooksHTML(books, { base = 184, intro = false } = {}) {
  return books.map((b, i) => {
    const pct = clampN(Math.round(b.pct || 0), 0, 100);
    const w = bookWidth(b.target);
    return `<div class="book-slot" role="listitem" style="--w:${w}px;--g:${w}">
      <button type="button" class="${bookClass(b, pct)}" style="--h:${bookHeight(i, base)}px;--p:${intro ? 0 : pct}" data-book="${escHtml(b.id)}" data-sig="${escHtml(bookSig(b))}" aria-label="${escHtml(bookLabel(b))}"><span class="book-fill"></span>${bookExtrasHTML(b)}</button>
      <span class="book-foot" aria-hidden="true">${pct}<i>\u00A0%</i></span>
    </div>`;
  }).join('');
}

/** Met à jour un livre déjà affiché, sans le recréer : le surlignage monte en douceur. */
export function updateBook(slot, b) {
  const pct = clampN(Math.round(b.pct || 0), 0, 100);
  const btn = slot.querySelector('.book');
  if (!btn) return;
  const w = bookWidth(b.target);
  slot.style.setProperty('--w', w + 'px');
  slot.style.setProperty('--g', w);
  btn.style.setProperty('--p', pct);
  btn.setAttribute('aria-label', bookLabel(b));
  btn.className = bookClass(b, pct);
  const sig = bookSig(b);
  if (btn.dataset.sig !== sig) {
    btn.dataset.sig = sig;
    btn.querySelectorAll('.book-title, .book-mark, .book-tag').forEach(e => e.remove());
    btn.insertAdjacentHTML('beforeend', bookExtrasHTML(b));
  }
  const foot = slot.querySelector('.book-foot');
  if (foot) foot.innerHTML = pct + '<i>\u00A0%</i>';
}

/** Les mêmes livres pour l'image à partager : sans titre (le sujet reste privé), tailles en pixels. */
export function shareShelfHTML(books, { width = 900, height = 190, plant = '' } = {}) {
  const list = books.slice(0, 18);
  const gap = 8;
  const room = width - (plant ? 170 : 0);
  let ws = list.map(b => bookWidth(b.target) * 1.9);
  const total = ws.reduce((a, w) => a + w, 0);
  const free = room - list.length * gap;
  if (total > free) ws = ws.map(w => Math.max(14, (w * free) / total));
  return list.map((b, i) => {
    const pct = clampN(Math.round(b.pct || 0), 0, 100);
    const h = Math.round(height * (0.8 + (bookHeight(i, 0) / 18) * 0.2));
    return `<div class="sc-book" style="width:${Math.round(ws[i])}px;height:${h}px"><i style="height:${pct}%"></i><b style="top:20px"></b><b style="bottom:20px"></b></div>`;
  }).join('') + plant;
}

/* ---------- La semaine ---------- */

/**
 * days : [{ label: 'L', name: 'lundi', pages, today, future, rest }]
 * Barres fines sur une même base ; aujourd'hui en avant, le reste en retrait.
 * Le détail de chaque jour vient au survol ; le résumé est lu d'un bloc par les lecteurs d'écran.
 */
export function weekBarsHTML(days, goal = 0) {
  const max = Math.max(goal, 1, ...days.map(d => d.pages || 0));
  const summary = [];
  const bars = days.map(d => {
    const p = Math.max(0, d.pages || 0);
    const h = p > 0 ? Math.max(0.08, p / max) : 0;
    const tip = d.future ? `${d.name} : à venir` : `${d.name} : ${fmtPages(p)} p.`;
    if (!d.future) summary.push(`${d.name} ${fmtPages(p)}`);
    return `<div class="wk-col${d.today ? ' is-today' : ''}${d.future ? ' future' : ''}${d.rest ? ' rest' : ''}" data-tip="${escHtml(tip)}">
      <span class="wk-barbox">${d.today && p > 0 ? `<span class="wk-val">${fmtPages(p)}</span>` : ''}<i class="wk-bar" style="--h:${h.toFixed(3)}"></i></span>
      <span class="wk-day">${escHtml(d.label)}</span>
    </div>`;
  }).join('');
  const line = goal > 0 ? `<i class="wk-goal" style="--g:${(goal / max).toFixed(3)}" aria-hidden="true"></i>` : '';
  return `<div class="wk-plot" tabindex="0" role="img" aria-label="Pages par jour cette semaine : ${escHtml(summary.join(', '))}">${bars}${line}</div>`;
}

/* ---------- Le niveau ---------- */

/** Pastilles des grades sur la piste d'avancement (pct = position actuelle). */
export function levelTicksHTML(pct, thresholds) {
  return thresholds.filter(t => t > 0 && t < 100).map(t =>
    `<i class="level-tick${pct >= t ? ' passed' : ''}" style="left:${t}%"></i>`).join('');
}

/** Initiales d'un nom ou d'un pseudonyme, pour sa pastille (« Hypothèse Fragile » → HF). */
export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s.-]/gu, ' ').trim().split(/[\s.-]+/).filter(Boolean);
  if (!words.length) return '?';
  const first = [...words[0]][0] || '';
  const second = words.length > 1 ? ([...words[words.length - 1]][0] || '') : ([...words[0]][1] || '');
  return (first + second).toUpperCase();
}

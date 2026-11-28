// Carrousels pour les réseaux sociaux (Instagram, LinkedIn) : des slides de 1080 × 1350, quelques mots et des captures du site.
// Trois carrousels : la présentation du Journal, « 5 signes que votre thèse a besoin d'un journal de bord », le bingo de la semaine.
// Le site est filmé sur un téléphone (compte de démonstration fictif, base simulée des tests), réglé sur le lundi 30 novembre 2026 :
// les chiffres des slides sont lus sur l'écran. Le bingo est celui de la semaine 49, ou de la semaine choisie avec SEMAINE.
//
//   node tests/carrousels/carrousels.cjs              → tests/.tmp/carrousels/ : les PNG de chaque carrousel, un PDF et un ZIP par carrousel
//   ONLY=bingo node tests/carrousels/carrousels.cjs    un seul carrousel (presentation, cinq-signes, bingo)
//   SEMAINE=2026-12-07 ONLY=bingo node tests/carrousels/carrousels.cjs   le bingo d'une autre semaine (n'importe quel jour de la semaine)
//   REUSE=1 node tests/carrousels/carrousels.cjs       sans refaire les captures du site (pour retoucher les textes)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { serve, capture, openPhone, demoJournal, chromium } = require('../videos/commun.cjs');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', '.tmp', 'carrousels');
const SHOTS = path.join(OUT, 'shots');
const NOW = new Date('2026-11-30T10:00:00+01:00');                 // le compte de démonstration : un lundi
/** Le lundi de la semaine qui contient ce jour (AAAA-MM-JJ), à 10 h. */
function mondayOf(day) {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`SEMAINE=${day} : une date AAAA-MM-JJ est attendue`);
  const mon = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5);
  return new Date(`${mon.toISOString().slice(0, 10)}T10:00:00+01:00`);
}
const WEEK = mondayOf(process.env.SEMAINE || '2026-11-30');          // la semaine du carrousel du bingo
const frDay = d => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(d).replace(/^1 /, '1er ');
const IMG = n => `/tests/.tmp/carrousels/shots/${n}.png`;

/* ---------- Les captures ---------- */
const union = (...rs) => {
  const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y));
  return { x, y, w: Math.max(...rs.map(r => r.x + r.w)) - x, h: Math.max(...rs.map(r => r.y + r.h)) - y };
};
const pad = (r, a = 8, b = a) => ({ x: r.x - a, y: r.y - b, w: r.w + 2 * a, h: r.h + 2 * b });

/** Le compte de démonstration : bandeau, pronostic, vélocité, étagère, note du jour, une page de plus, une case du bingo. */
async function shootJournal(base) {
  // Sans marge avant le dépôt : sur une image fixe, le verdict se lit directement entre la date prévue et celle du dépôt
  const deadline = new Date(NOW.getTime() + 231 * 864e5).toISOString().slice(0, 10);
  const store = { ...demoJournal(NOW), marginDays: 0, deadline };
  const { p, rects, clean, rect, shot, close } = await openPhone(base, { store, now: NOW, dpr: 3, dir: SHOTS });
  const still = async name => { await p.mouse.move(1, 1); await p.waitForTimeout(450); await clean(); await shot(name); };
  const text = sel => p.evaluate(s => ((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim(), sel);
  const center = sel => p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center' }), sel);
  const T = {};
  await p.goto(base);
  await p.waitForSelector('.chapter-card');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1600);
  await p.evaluate(() => window.scrollTo(0, 0));
  await still('tableau');
  for (const [k, s] of Object.entries({ gauge: '.hero-progress', level: '.level', prog: '#prog', side: '.hero-side' })) await rect(k, s);
  Object.assign(T, { pct: await text('#gaugePct'), written: await text('#sWritten'), total: await text('#sTotal'), date: await text('#sEndDate'),
    quip: await text('#sEndQuip'), verdict: await text('#dbDeadline .dl-verdict') });
  await center('#heroPace');
  await still('velocite');
  await rect('pace', '#heroPace');
  Object.assign(T, { pace: await text('#paceNow'), lever: await text('#paceLever') });
  await center('#shelf');
  await still('etagere');
  await rect('tocHead', 'main.workspace .toc-head');
  await rect('shelf', '#shelf');
  await center('aside.footnote');
  await still('note');
  await rect('footnote', 'aside.footnote');
  await rect('teaser', '.bingo-teaser');
  T.quote = await text('#crystalQuote');
  // Une page de plus
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  await p.click('.fab');
  await p.waitForTimeout(1300);
  await p.evaluate(() => window.scrollTo(0, 0));
  await still('plus1');
  await rect('prog1', '#prog');
  Object.assign(T, { date1: await text('#sEndDate'), gain1: await text('#sEndGain'), quip1: await text('#sEndQuip'), verdict1: await text('#dbDeadline .dl-verdict') });
  // Une case du bingo pour « 5 signes » : « J'ai rangé mon bureau au lieu d'écrire » (grille de la semaine 49)
  await p.click('button.tab[onclick="openBingo()"]');
  await p.waitForSelector('#bingoModal:not(.hidden)');
  const cells = await p.$$eval('#bingoGrid .bingo-cell', els => els.map(e => e.textContent));
  const desk = cells.findIndex(t => t.includes('bureau'));
  if (desk < 0) throw new Error(`case « bureau » absente : ${cells.join(' | ')}`);
  await p.click(`#bingoGrid .bingo-cell:nth-child(${desk + 1})`);
  await still('bingo-bureau');
  await rect('gridDesk', '#bingoGrid');                              // la fenêtre se cale en bas : la grille bouge avec la longueur du score
  T.deskScore = await text('#bingoScore');
  await close();
  return { R: rects, T };
}

/** Le bingo de la semaine WEEK : la grille vide et son image, puis une ligne cochée (la 2e rangée, et une case de plus) et son image. */
async function shootBingo(base) {
  const { p, rects, clean, rect, shot, close } = await openPhone(base, { store: demoJournal(WEEK), now: WEEK, dpr: 3, dir: SHOTS });
  const still = async name => { await p.mouse.move(1, 1); await p.waitForTimeout(450); await clean(); await shot(name); };
  const text = sel => p.evaluate(s => ((document.querySelector(s) || {}).textContent || '').replace(/\s+/g, ' ').trim(), sel);
  const openBingo = async () => { await p.click('button.tab[onclick="openBingo()"]'); await p.waitForSelector('#bingoModal:not(.hidden)'); };
  const share = async name => {
    await p.click('#bingoModal .btn-primary');
    await p.waitForSelector('#sharePreview img', { timeout: 30000 });
    const data = await p.evaluate(async () => {
      const b = await (await fetch(document.querySelector('#sharePreview img').src)).blob();
      return new Promise(done => { const r = new FileReader(); r.onload = () => done(r.result); r.readAsDataURL(b); });
    });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data.split(',')[1], 'base64'));
    await p.evaluate(() => window.closeModal('shareModal'));
    await p.waitForTimeout(300);
  };
  const T = {};
  await p.goto(base);
  await p.waitForSelector('.chapter-card');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1200);
  await openBingo();
  await still('bingo-vide');
  T.cells = await p.$$eval('#bingoGrid .bingo-cell', els => els.map(e => e.textContent));
  T.week = await text('#bgKicker');
  await share('bingo-image-vide');
  await openBingo();
  for (const i of [3, 4, 5, 2]) await p.click(`#bingoGrid .bingo-cell:nth-child(${i + 1})`);
  await still('bingo-ligne');
  await rect('sheetLine', '#bingoModal .modal');
  await rect('scoreLine', '#bingoScore');
  T.lineScore = await text('#bingoScore');
  if (!/^Bingo\./.test(T.lineScore)) throw new Error(`pas de bingo : ${T.lineScore}`);
  await share('bingo-image-ligne');
  await close();
  return { R: rects, T };
}

async function shoot(base) {
  if (process.env.REUSE && fs.existsSync(path.join(OUT, 'captures.json'))) return JSON.parse(fs.readFileSync(path.join(OUT, 'captures.json'), 'utf8'));
  const imp = await capture(base, { dpr: 3, dir: SHOTS, now: NOW });   // un compte tout neuf dépose la thèse de démonstration
  const J = await shootJournal(base);
  const B = await shootBingo(base);
  const all = { R: { ...J.R, ...B.R, imp }, T: { ...J.T, ...B.T } };
  fs.writeFileSync(path.join(OUT, 'captures.json'), JSON.stringify(all, null, 1));
  return all;
}

/* ---------- Les morceaux d'une slide ---------- */
// Typographie française : espace insécable avant ? ! : ; » et après «
const fr = s => s.replace(/ ([?!:;»])/g, ' $1').replace(/« /g, '« ');
const ARROW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
const LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="11" fill="#F0AE3C"/><path d="m7 12.5 3.2 3.2L17 9" stroke="#16282A" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const top = (n, N) => `<div class="top"><div class="brand"><img src="/icon-192.png" alt="">Le Journal de Bord</div><div class="count">${n}/${N}</div></div>`;
const text = ({ kicker, title, sub, size = '', y, left, right }) => `<div class="text" style="${y ? `top:${y}px;` : ''}${left ? `left:${left}px;` : ''}${right ? `right:${right}px;` : ''}">`
  + `${kicker ? `<span class="kicker">${fr(kicker)}</span>` : ''}<h1 class="${size}">${fr(title)}</h1>${sub ? `<p class="sub">${fr(sub)}</p>` : ''}</div>`;
const phone = ({ img, x, y, w = 560, rot = 0 }) => {
  const sw = w - 28, r = Math.round(w * 0.125);
  return `<div class="phone" style="left:${x}px;top:${y}px;width:${w}px;border-radius:${r}px;transform:rotate(${rot}deg)">`
    + `<div class="screen" style="height:${(sw * 844 / 390).toFixed(1)}px;border-radius:${r - 13}px"><img src="${IMG(img)}" alt=""></div></div>`;
};
/** Un morceau d'écran (crop, en points CSS de la capture) agrandi à la largeur w ; base : la largeur de l'image dans l'unité de crop. */
const loupe = ({ img, crop, x, y, w, rot = 0, base = 390, tape = '', z = '' }) => {
  const s = w / crop.w;
  return `<div class="loupe" style="left:${x}px;top:${y}px;transform:rotate(${rot}deg);${z ? `z-index:${z};` : ''}">${tape ? `<span class="tape" style="${tape}"></span>` : ''}`
    + `<div class="crop" style="width:${w}px;height:${(crop.h * s).toFixed(1)}px"><img src="${IMG(img)}" alt="" `
    + `style="width:${(base * s).toFixed(1)}px;left:${(-crop.x * s).toFixed(1)}px;top:${(-crop.y * s).toFixed(1)}px"></div></div>`;
};
/** Une loupe qui prend la place libre sous le texte (voir fit() dans slide.html) : wmax, et au besoin top, bottom, left. */
const fitLoupe = ({ img, crop, wmax, rot = 0, base = 390, tape = '', top: t, bottom, left, z = '' }) =>
  `<div class="loupe" data-fit="${[crop.x, crop.y, crop.w, crop.h].map(v => Math.round(v * 100) / 100).join(',')}" data-wmax="${wmax}" data-base="${base}"`
  + `${t ? ` data-top="${t}"` : ''}${bottom ? ` data-bottom="${bottom}"` : ''}${left ? ` data-left="${left}"` : ''}`
  + ` style="transform:rotate(${rot}deg);${z ? `z-index:${z};` : ''}">${tape ? `<span class="tape" style="${tape}"></span>` : ''}<div class="crop"><img src="${IMG(img)}" alt=""></div></div>`;
const centerX = w => Math.round(540 - (w + 10) / 2);                 // une loupe de largeur w, centrée (bordure comprise)
const pill = (html, style, cls = '') => `<div class="pill ${cls}" style="${style}">${html}</div>`;
const swipe = (style = '') => `<div class="pill swipe" style="${style}">Glissez ${ARROW}</div>`;
const num = (n, style) => `<div class="num" style="${style}">${n}</div>`;
const answer = (lead, html, style) => `<div class="answer" style="${style}"><span class="lead">${fr(lead)}</span>${fr(html)}</div>`;
/** Une flèche tracée à la main, d'un point à un autre, en passant par un point de contrôle. */
const arrow = ({ x1, y1, cx, cy, x2, y2, color = '#16282A', w = 7 }) => {
  const a = Math.atan2(y2 - cy, x2 - cx), L = 34;
  const h1 = [x2 - L * Math.cos(a - 0.5), y2 - L * Math.sin(a - 0.5)], h2 = [x2 - L * Math.cos(a + 0.5), y2 - L * Math.sin(a + 0.5)];
  return `<svg class="draw" style="left:0;top:0" width="1080" height="1350" viewBox="0 0 1080 1350"><g fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="M${x1} ${y1} Q${cx} ${cy} ${x2} ${y2}"/><path d="M${h1[0].toFixed(1)} ${h1[1].toFixed(1)} L${x2} ${y2} L${h2[0].toFixed(1)} ${h2[1].toFixed(1)}"/></g></svg>`;
};
const MONTHS = { 'janv.': 'janvier', 'févr.': 'février', 'avr.': 'avril', 'juil.': 'juillet', 'sept.': 'septembre', 'oct.': 'octobre', 'nov.': 'novembre', 'déc.': 'décembre' };
const longDate = d => d.replace(/\S+\./, m => MONTHS[m] || m);
const cta = ({ lines, foot, tag = 'Votre thèse, page après page.', y = 150 }) => `<div class="cta" style="padding-top:${y}px"><img class="icon" src="/icon-512.png" alt="">`
  + `<div class="name">Le Journal de Bord</div><div class="tag">${fr(tag)}</div>`
  + `<ul>${lines.map(l => `<li>${CHECK}${fr(l)}</li>`).join('')}</ul><div class="url">lejournaldebord.org</div>${foot ? `<div class="foot">${fr(foot)}</div>` : ''}</div>`;

/* ---------- Les carrousels ---------- */
const TAPE_L = 'top:-26px;left:70px;transform:rotate(-5deg)', TAPE_R = 'top:-26px;right:70px;transform:rotate(5deg)';
function carousels({ R, T }) {
  const I = R.imp;
  const hero = pad(union(R.gauge, R.level), 6, 10);                 // 54 %, pages, piste des grades
  const side = pad(R.side, 10);                                      // pronostic et dépôt
  const prog = pad(R.prog, 8, 10), prog1 = pad(R.prog1, 8, 10);     // le pronostic, avant et après une page
  const plan = { x: 8, y: I.summary.y - 74, w: 374, h: I.summary.h + 84 };
  const rows = { x: I.row1.x - 4, y: I.row1.y - 4, w: I.row1.w + 8, h: I.row2.y + 64 - I.row1.y };
  const shelf = pad(R.shelf, 12, 12);
  const G = R.gridDesk, rowH = (G.h - 16) / 3, grid2 = { x: G.x - 8, y: G.y - 8, w: G.w + 16, h: 2 * rowH + 8 + 14 };
  const sheet = { x: 0, y: R.sheetLine.y + 8, w: 390, h: R.scoreLine.y + R.scoreLine.h + 14 - R.sheetLine.y - 8 };
  const hPlan = plan.h * 860 / plan.w;
  const gain = (/^(.+?) gagnée?s? aujourd/.exec(T.gain1) || [])[1] || T.gain1;

  const presentation = [
    { theme: 'nuit', html: top(1, 8)
      + text({ kicker: 'Pour les doctorant·es', title: 'Et ta thèse, ça <span class="hl">avance</span> ?', sub: 'Enfin une réponse chiffrée. Le Journal de Bord suit votre rédaction, page après page.' })
      + phone({ img: 'tableau', x: 330, y: 610, w: 620, rot: -5 })
      + `<div class="sticker" style="left:96px;top:760px;transform:rotate(-12deg)">${fr('Gratuit<br>et sans<br>pub')}</div>`
      + swipe() },
    { theme: 'creme', html: top(2, 8)
      + text({ kicker: 'Le point de départ', title: 'Déposez votre <span class="hl">thèse</span>.', sub: 'Word, LibreOffice, PDF, LaTeX ou Google Docs : le Journal retrouve vos chapitres et compte vos pages.' })
      + loupe({ img: '03-apercu', crop: plan, x: centerX(860), y: 470, w: 860, rot: -1.2, tape: TAPE_R })
      + loupe({ img: '04-chapitres', crop: rows, x: 190, y: Math.round(470 + hPlan + 2), w: 740, rot: 1.4, z: 5 })
      + pill(`${LOCK}${fr('Lu sur votre appareil. Rien n’est envoyé.')}`, 'left:80px;bottom:58px') },
    { theme: 'creme', html: top(3, 8)
      + text({ kicker: 'Le bandeau', title: 'Vous savez où vous en <span class="hl">êtes</span>.', sub: 'Pourcentage, pages rédigées, pages restantes. Et un grade qui monte avec les pages.' })
      + fitLoupe({ img: 'tableau', crop: hero, wmax: 920, rot: -1.2, tape: TAPE_L }) },
    { theme: 'creme', html: top(4, 8)
      + text({ kicker: 'Le pronostic', size: 'm', title: 'À ce rythme, vous finissez <span class="hl">quand</span> ?', sub: 'Une date calculée sur votre rythme réel. Et le verdict : dans les temps, ou en retard de combien.' })
      + fitLoupe({ img: 'tableau', crop: side, wmax: 760, rot: 1.2, tape: TAPE_R }) },
    { theme: 'creme', html: top(5, 8)
      + text({ kicker: 'La vélocité', size: 'm', title: 'Une page de plus, et la fin <span class="hl">avance</span>.', sub: 'Vélocité, tendance, record. Et ce que rapporte la page d’aujourd’hui.' })
      + loupe({ img: 'tableau', crop: prog, x: 70, y: 590, w: 600, rot: -2.2 })
      + loupe({ img: 'plus1', crop: prog1, x: 400, y: 910, w: 600, rot: 1.6, z: 5 })
      + arrow({ x1: 800, y1: 700, cx: 960, cy: 760, x2: 910, y2: 890 })
      + pill('+1 page', 'left:740px;top:612px', 'saf') },
    { theme: 'creme', html: top(6, 8)
      + text({ kicker: 'L’étagère', title: 'Votre thèse, <span class="hl">en rayon</span>.', sub: 'Un livre par chapitre, surligné à mesure que vous écrivez. La plante pousse avec votre série. Dix jours sans une page : une araignée s’installe.' })
      + fitLoupe({ img: 'etagere', crop: shelf, wmax: 880, rot: -1, tape: TAPE_L }) },
    { theme: 'creme', html: top(7, 8)
      + text({ kicker: 'Entre doctorant·es', title: 'Et de quoi <span class="hl">sourire</span>.', sub: 'La note de bas de page du jour et le bingo de la semaine : les mêmes pour tout le monde.' })
      + loupe({ img: 'note', crop: pad(R.footnote, 8), x: 70, y: 520, w: 660, rot: -3 })
      + loupe({ img: 'note', crop: pad(R.teaser, 6), x: 330, y: 880, w: 680, rot: 2.2, z: 5 }) },
    { theme: 'nuit', html: top(8, 8)
      + cta({ lines: ['Gratuit et sans publicité', 'Sur téléphone et ordinateur', 'Votre document est lu sur votre appareil'], foot: 'Envoyez-le à un·e doctorant·e qui en a besoin.' }) },
  ];

  const sign = (n, statement, img, crop, lead, ans) => ({ theme: 'safran', html: top(n + 1, 7)
    + num(n, 'left:70px;top:150px;font-size:280px')
    + text({ title: statement, size: 'm', y: 176, left: n === 1 ? 250 : 300 })
    + fitLoupe({ img, crop, wmax: 880, rot: n % 2 ? -1.4 : 1.4, tape: TAPE_R })
    + answer(lead, ans, 'bottom:64px') });
  const signes = [
    { theme: 'safran', html: top(1, 7)
      + text({ kicker: 'Test express', title: '5 signes que votre thèse a besoin d’un <span class="hl">journal de bord</span>', sub: 'Le quatrième est très personnel.' })
      + phone({ img: 'tableau', x: 470, y: 690, w: 540, rot: 6 })
      + swipe('left:80px;right:auto') },
    sign(1, 'Vous ne savez pas combien de pages vous avez écrites.', '04-chapitres', rows, 'Le remède', 'Le Journal les compte pour vous, chapitre par chapitre, avec la vraie pagination de votre document.'),
    sign(2, '« Ça avance » est votre réponse à tout.', 'tableau', hero, 'Le remède', `Maintenant, c’est ${T.pct} : <b>${T.written} pages sur ${T.total}</b>. Question suivante ?`),
    sign(3, 'Votre date de dépôt tient de l’intuition.', 'tableau', prog, 'Le remède', `À votre rythme, dernière page le <b>${longDate(T.date)}</b>. Et vous savez si c’est dans les temps.`),
    sign(4, 'Vous avez rangé votre bureau au lieu d’écrire.', 'bingo-bureau', grid2, 'Rassurez-vous', 'C’est une case du bingo du doctorant. Vous n’êtes pas seul·e.'),
    sign(5, 'Vous avez besoin de voir que chaque page compte.', 'plus1', prog1, 'Le remède', `Une page aujourd’hui, et la fin avance de <b>${gain}</b>.`),
    { theme: 'nuit', html: top(7, 7)
      + cta({ y: 120, tag: 'Vous en cochez combien ?', lines: ['Gratuit et sans publicité', 'Pages comptées, date de fin, vélocité', 'Un peu d’humour, beaucoup de pages'], foot: 'Partagez ce post à un·e doctorant·e concerné·e.' }) },
  ];

  const cells = T.cells.map(t => `<div class="cell">${fr(t)}</div>`).join('');
  const square = { x: 0, y: 0, w: 1080, h: 1080 };
  const bingo = [
    { theme: 'cahier', html: top(1, 6)
      + text({ kicker: `Semaine du ${frDay(WEEK)}`, title: 'Le bingo du <span class="hl">doctorant</span>', sub: 'Combien de cases cochez-vous cette semaine ?' })
      + loupe({ img: 'bingo-image-vide', crop: square, base: 1080, x: 330, y: 560, w: 660, rot: 4, tape: TAPE_L })
      + swipe('left:156px;right:auto') },
    { theme: 'cahier', html: top(2, 6)
      + text({ kicker: `${T.week}, du ${frDay(WEEK)} au ${frDay(new Date(WEEK.getTime() + 6 * 864e5))}`, title: 'La grille de la <span class="hl">semaine</span>', size: 'm' })
      + `<div class="grid9" style="left:150px;right:66px;top:420px;grid-auto-rows:248px">${cells}</div>`
      + `<p class="abs" style="left:156px;top:1236px;font-family:Fraunces,serif;font-style:italic;font-size:42px">${fr('Cochez ce qui vous est arrivé.')}</p>` },
    { theme: 'cahier', html: top(3, 6)
      + text({ kicker: 'Le verdict du site', title: 'Vos <span class="hl">résultats</span>' })
      + `<div class="scores" style="left:156px;right:80px;top:430px">${[
        ['Aucune case', 'Soit la semaine commence, soit vous mentez.'], ['Quelques cases', 'La semaine n’est pas finie.'],
        ['Une ligne', 'Bingo. Ce n’est pas forcément une bonne nouvelle.'], ['Les 9 cases', 'Semaine de doctorat parfaitement normale.'],
      ].map(([a, b]) => `<div class="score"><b>${fr(a)}</b><span>${fr(b)}</span></div>`).join('')}</div>` },
    { theme: 'cahier', html: top(4, 6)
      + text({ title: 'La même grille pour <span class="hl">tout le monde</span>.', size: 'm', sub: 'Une nouvelle chaque lundi, à cocher sur le Journal de Bord.' })
      + fitLoupe({ img: 'bingo-ligne', crop: sheet, wmax: 720, rot: -1.6, tape: TAPE_R }) },
    { theme: 'cahier', html: top(5, 6)
      + text({ title: 'Partagez la <span class="hl">vôtre</span>.', sub: 'Le site fabrique l’image, en post ou en story. À comparer sans modération.' })
      + fitLoupe({ img: 'bingo-image-ligne', crop: square, base: 1080, wmax: 720, rot: -3, tape: TAPE_L }) },
    { theme: 'cahier', html: top(6, 6)
      + `<div class="text" style="top:190px;text-align:center;left:156px;right:80px"><h1>${fr('Vous en cochez <span class="hl">combien</span> ?')}</h1>`
      + `<p class="sub" style="margin:30px auto 0">${fr('Dites-le en commentaire. Et jouez sur le site : une nouvelle grille chaque lundi.')}</p></div>`
      + `<div class="cta" style="padding-top:640px;left:76px"><img class="icon" src="/icon-512.png" alt="" style="width:170px;height:170px;border-radius:42px">`
      + `<div class="name" style="font-size:80px;margin-top:36px">Le Journal de Bord</div><div class="url" style="margin-top:40px">lejournaldebord.org</div>`
      + `<div class="foot" style="margin-top:30px">${fr('Gratuit, sans publicité.')}</div></div>` },
  ];
  return [
    { name: 'presentation', slides: presentation },
    { name: 'cinq-signes', slides: signes },
    { name: 'bingo', slides: bingo },
  ];
}

/* ---------- Le rendu : PNG, PDF, ZIP ---------- */
async function render(base, sets) {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1350 }, deviceScaleFactor: 1 });
  await p.goto(base + 'tests/carrousels/slide.html');
  await p.waitForFunction(() => window.ready === true);
  for (const set of sets) {
    const dir = path.join(OUT, set.name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const pngs = [];
    for (const [i, sl] of set.slides.entries()) {
      await p.evaluate(([t, h]) => window.render(t, h), [sl.theme, sl.html]);
      const f = path.join(dir, `${set.name}-${String(i + 1).padStart(2, '0')}`);
      await p.screenshot({ path: `${f}.png` });
      await p.screenshot({ path: `${f}.jpg`, type: 'jpeg', quality: 92 });
      pngs.push(`${f}.png`);
    }
    // Le PDF (LinkedIn publie les carrousels en document) : une page par slide
    const pdf = await b.newPage();
    const imgs = pngs.map(f => `<img src="${base}${path.relative(ROOT, f).replace(/\.png$/, '.jpg')}" alt="">`).join('');
    await pdf.setContent(`<style>@page{size:1080px 1350px;margin:0}html,body{margin:0}img{display:block;width:1080px;height:1350px}img:not(:last-child){break-after:page}</style>${imgs}`, { waitUntil: 'load' });
    await pdf.pdf({ path: path.join(OUT, `${set.name}.pdf`), width: '1080px', height: '1350px', printBackground: true });
    await pdf.close();
    // Le ZIP (Instagram) : les PNG, dans l'ordre
    const zip = path.join(OUT, `${set.name}.zip`);
    fs.rmSync(zip, { force: true });
    execFileSync('zip', ['-j', '-q', '-X', zip, ...pngs]);
    console.log(`${set.name} : ${pngs.length} slides → ${path.relative(ROOT, dir)}, ${set.name}.pdf, ${set.name}.zip`);
  }
  await b.close();
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  try {
    const cap = await shoot(base);
    const { T } = cap;
    console.log(JSON.stringify({ pct: T.pct, pages: `${T.written}/${T.total}`, date: T.date, verdict: T.verdict, plus1: [T.date1, T.gain1, T.verdict1], pace: T.pace, week: T.week, desk: T.deskScore, line: T.lineScore }));
    const sets = carousels(cap).filter(s => !process.env.ONLY || s.name === process.env.ONLY);
    await render(base, sets);
  } finally { srv.close(); }
})().catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

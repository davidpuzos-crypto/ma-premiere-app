// Vidéo 4 pour les réseaux sociaux : « Le bingo du doctorant »
// Une semaine de thèse racontée comme un journal de bord : lundi 9 h 41, le syndrome de l'imposteur ; mardi, Zotero ouvert
// puis refermé ; mercredi, la direction répond « intéressant » ; jeudi, la relecture attendra… Bingo. Le week-end, la grille
// se remplit : « Semaine de doctorat parfaitement normale. » Puis l'image à partager.
// Même procédé que les vidéos 1 à 3 (stop motion, 1080 × 1920), sur une page de cahier à grands carreaux.
//
//   node tests/videos/video-4.cjs        → tests/.tmp/videos/journal-de-bord-video-4.mp4 (et une image de couverture)
//   SHOTS_ONLY=1 node tests/videos/video-4.cjs   seulement les captures du site (pour les vérifier)
//
// Le téléphone est réglé sur le vendredi 27 novembre 2026 : la grille de la semaine 48, celle que racontent les légendes.
const fs = require('fs');
const path = require('path');
const { make, openPhone, demoJournal, SHOT, NB, step, words, boil, growth } = require('./commun.cjs');

const NOW = new Date('2026-11-27T18:05:00+01:00');
// Les cases cochées, dans l'ordre de la semaine (repérées par leur texte), puis tout le reste pendant le week-end
const WEEK = ['imposteur', 'Zotero', 'intéressant', 'relecture à demain'];
const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const RED = '#C8372D';                                            // le stylo rouge de la correction
const SHOTS_DIR = path.join(__dirname, '..', '.tmp', 'videos', 'shots');

async function shoot(base) {
  const { p, rects, clean, rect, shot, close } = await openPhone(base, { store: demoJournal(NOW), now: NOW });
  const still = async name => { await p.mouse.move(1, 1); await p.waitForTimeout(450); await clean(); await shot(name); };
  await p.goto(base);
  await p.waitForSelector('.chapter-card');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1600);
  await p.evaluate(() => window.scrollTo(0, 0));
  await still('41-tableau');
  const tab = 'button.tab[onclick="openBingo()"]';
  await rect('tab', tab);
  await p.click(tab);
  await p.waitForSelector('#bingoModal:not(.hidden)');
  await still('42-grille');
  await rect('score', '#bingoScore');
  await rect('shareBtn', '#bingoModal .btn-primary');
  const cells = await p.$$eval('#bingoGrid .bingo-cell', els => els.map(e => e.textContent));
  for (let i = 0; i < 9; i++) await rect(`c${i}`, `#bingoGrid .bingo-cell:nth-child(${i + 1})`);
  const order = WEEK.map(w => {
    const i = cells.findIndex(t => t.includes(w));
    if (i < 0) throw new Error(`case « ${w} » absente de la grille : ${cells.join(' | ')}`);
    return i;
  });
  order.push(...[0, 1, 2, 3, 4, 5, 6, 7, 8].filter(i => !order.includes(i)));
  const line = LINES.find(l => l.every(i => order.slice(0, 4).includes(i)));
  if (!line) throw new Error('les quatre cases de la semaine ne font pas de ligne');
  const scores = [];
  for (const [k, i] of order.entries()) {
    await p.click(`#bingoGrid .bingo-cell:nth-child(${i + 1})`);
    await still(`43-coche${k + 1}`);
    scores.push(await p.textContent('#bingoScore'));
  }
  console.log(scores.map((t, k) => `${k + 1}. ${cells[order[k]]} → ${t}`).join('\n'));
  if (!/^Bingo\./.test(scores[3]) || !/^Grille complète/.test(scores[8])) throw new Error('le score ne suit pas le scénario');
  // L'image à partager, telle que le site la fabrique (post carré)
  await p.click('#bingoModal .btn-primary');
  await p.waitForSelector('#sharePreview img', { timeout: 30000 });
  await still('44-partage');
  const data = await p.evaluate(async () => {
    const b = await (await fetch(document.querySelector('#sharePreview img').src)).blob();
    return new Promise(done => { const r = new FileReader(); r.onload = () => done(r.result); r.readAsDataURL(b); });
  });
  fs.writeFileSync(path.join(SHOTS_DIR, '45-image.png'), Buffer.from(data.split(',')[1], 'base64'));
  await close();
  return { ...rects, order, line };
}

make(4, (R, scene) => {
  const cahier = { theme: 'cahier' };
  const ctr = r => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  const tap = (pt, i, from, len = 4) => (i >= from && i < from + len ? { x: pt.x, y: pt.y, k: Math.min(1, (i - from) / (len - 1)) } : null);
  const cell = k => ctr(R[`c${R.order[k]}`]);
  // Gros plan sur la fenêtre du bingo : son bord haut vient juste sous la note, qui cache le haut du téléphone
  const zoom = (z = 1.55) => ({ x: 195, y: 256, z, tx: 540, ty: 350, clip: 200 });
  const shotAfter = (i, at, k) => SHOT(i < at ? (k ? `43-coche${k}` : '42-grille') : `43-coche${k + 1}`);
  const day = (title, sub, i) => ({ tokens: title, shown: words(i, title.length), hl: [1], size: 86, y: 96, w: 1000, sub, subOn: i >= 3 });
  const score = (i, from) => (i >= from ? { rect: { x: R.score.x + 12, y: R.score.y, w: R.score.w - 24, h: R.score.h }, p: Math.min(1, (i - from + 1) / 5), seed: boil(i), color: RED } : null);
  const [a, b] = [R.line[0], R.line[2]].map(n => ctr(R[`c${n}`]));
  const dir = [b.x - a.x, b.y - a.y], len = Math.hypot(...dir), u = dir.map(v => v / len);
  const strike = (i, from) => (i >= from ? { x1: a.x - u[0] * 46, y1: a.y - u[1] * 46, x2: b.x + u[0] * 46, y2: b.y + u[1] * 46, p: Math.min(1, (i - from + 1) / 4), seed: boil(i), color: RED, width: 7 } : null);

  // A. Le crochet : votre semaine de thèse en 9 cases
  scene(32, i => ({
    ...cahier,
    phone: { img: SHOT(i < 11 ? '41-tableau' : '42-grille'), dy: step(i, 0, [1400, 1020, 640, 300, 90, 0]), tap: tap(ctr(R.tab), i, 8) },
    note: { tokens: ['Votre', 'semaine', 'de', 'thèse', 'en', `9${NB}cases.`], shown: words(i, 6), hl: [5], size: 86, y: 96,
      sub: `Le bingo du doctorant. Une nouvelle grille chaque${NB}lundi.`, subOn: i >= 13 },
  }));
  // B. Lundi, 9 h 41 : la caméra s'approche, première case
  scene(22, i => ({
    ...cahier,
    phone: { img: shotAfter(i, 10, 0), zoom: zoom(i ? 1.55 : 1.58), tap: tap(cell(0), i, 7), circle: score(i, 12) },
    note: day(['Lundi,', `9${NB}h${NB}41.`], 'Premier café.', i),
  }));
  // C. Mardi
  scene(16, i => ({
    ...cahier,
    phone: { img: shotAfter(i, 8, 1), zoom: zoom(), tap: tap(cell(1), i, 5) },
    note: day(['Mardi,', `14${NB}h${NB}30.`], 'Motivation maximale.', i),
  }));
  // D. Mercredi
  scene(18, i => ({
    ...cahier,
    phone: { img: shotAfter(i, 9, 2), zoom: zoom(), tap: tap(cell(2), i, 6) },
    note: day(['Mercredi,', `11${NB}h${NB}02.`], '40 pages envoyées à la direction.', i),
  }));
  // E. Jeudi… bingo
  scene(34, i => ({
    ...cahier,
    phone: { img: shotAfter(i, 9, 3), zoom: zoom(), tap: tap(cell(3), i, 6), strike: strike(i, 11), circle: score(i, 18) },
    note: day(['Jeudi,', `18${NB}h${NB}59.`], 'Relecture prévue aujourd’hui.', i),
    stamp: i >= 14 ? { text: `Bingo${NB}!`, size: 124, x: 196, y: 404, rot: -6, k: step(i, 14, [1.5, 1.15, 1]), color: RED, bg: '#FFF3EE' } : null,
  }));
  // F. Le week-end : toute la grille
  const rush = [2, 4, 6, 8, 10];
  scene(30, i => {
    const done = rush.filter(t => i > t).length;
    const t = rush.find(t => i === t || i === t + 1);
    return {
      ...cahier,
      phone: { img: SHOT(`43-coche${4 + done}`), zoom: zoom(), tap: t !== undefined ? tap(cell(4 + rush.indexOf(t)), i, t, 2) : null, circle: score(i, 13) },
      note: { tokens: ['Vendredi,', 'samedi…'], shown: words(i, 2, 3), hl: [1], size: 86, y: 96, w: 1000, sub: 'Et dimanche aussi.', subOn: i >= 7 },
    };
  });
  // G. Partager sa grille
  scene(26, i => ({
    ...cahier,
    phone: { img: SHOT(i < 5 ? '43-coche9' : '44-partage'), tap: tap(ctr(R.shareBtn), i, 2) },
    note: { tokens: ['Partagez', 'votre', 'grille.'], shown: words(i, 3), hl: [2], size: 86, y: 96, sub: `La même pour tout le monde. À comparer sans${NB}modération.`, subOn: i >= 8 },
    callout: i >= 8 ? { img: SHOT('45-image'), crop: { x: 0, y: 0, w: 1080, h: 1080 }, base: 1080, w: 800, y: 560, rot: -2.2, k: step(i, 8, [0.7, 1.06, 1]) } : null,
  }));
  // H. La fin
  scene(32, i => ({
    ...cahier,
    end: {
      icon: step(i, 0, [0.35, 0.8, 1.12, 1]), title: Math.max(0, Math.min(4, i - 2)), tag: i >= 9, pill: i >= 12, url: i >= 15,
      plant: growth[Math.max(0, Math.min(growth.length - 1, Math.floor((i - 4) / 2)))], books: Math.max(0, Math.min(1, Math.floor((i - 6) / 2) / 7)),
    },
  }));
}, { cover: 114, shoot }).catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

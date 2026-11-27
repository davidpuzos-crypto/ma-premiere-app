// Vidéo 2 pour les réseaux sociaux (une autre version de la première) : « Et ta thèse, ça avance ? »
// La question du repas de famille, puis le Journal qui compte pour vous, puis la réponse, au dessert.
// Même procédé que la vidéo 1 (stop motion, 1080 × 1920), en version sombre.
//
//   node tests/videos/video-2.cjs        → tests/.tmp/videos/journal-de-bord-video-2.mp4 (et une image de couverture)
const { make, SHOT, NB, toStage, pad, step, words, boil, growth } = require('./commun.cjs');

make(2, (R, scene) => {
  const dark = { theme: 'dark' };
  const question = (k, shown) => ({ side: 'left', tone: 'cream', x: 70, tokens: ['Et', 'ta', 'thèse,', 'ça', `avance${NB}?`], shown, k });

  // A. La question qui fâche
  scene(32, i => ({
    ...dark, table: true,
    label: { text: 'Repas de famille, en décembre.', y: 400 },
    bubbles: [
      { ...question(i >= 2 ? step(i, 2, [0.55, 1.08, 1]) : 0, words(i, 5, 1, 2)), y: 490 },
      i >= 11 ? { side: 'right', tone: 'saf', x: 70, y: 880, k: step(i, 11, [0.55, 1.08, 1]),
        typing: i < 19 ? 1 + (Math.floor((i - 11) / 2) % 3) : 0, tokens: ['Euh…', 'pas', `mal${NB}?`], shown: words(i, 3, 2, 19) } : { k: 0 },
    ],
  }));
  // B. Déposer sa thèse
  const [dx, dy] = toStage(R.drop.x + R.drop.w / 2, R.drop.y + R.drop.h / 2);
  const fall = [[862, 640, 11, 1], [840, 790, 18, 0.95], [790, 955, 26, 0.88], [712, 1120, 34, 0.78], [622, 1275, 30, 0.68], [dx, dy, 22, 0.58]];
  scene(22, i => ({
    ...dark,
    phone: { img: SHOT('01-vide'), dy: step(i, 0, [1400, 1020, 640, 300, 90, 0]), drop: i >= 16 && i < 20 ? R.drop : null },
    note: { tokens: ['Déposez', 'votre', 'thèse.'], shown: words(i, 3), hl: [2], size: 86, y: 130, sub: 'Le Journal compte pour vous.', subOn: i >= 6 },
    doc: i < 4 ? null : i < 10 ? { x: 862, y: 640, rot: 11, s: 1 } : i < 16 ? { x: fall[i - 10][0], y: fall[i - 10][1], rot: fall[i - 10][2], s: fall[i - 10][3] } : i === 16 ? { x: dx, y: dy, rot: 20, s: 0.4 } : null,
  }));
  // C. Chapitres retrouvés, pages comptées
  const row = { x: R.row1.x, y: R.row1.y, w: R.row1.w, h: R.row2.y + R.row2.h - R.row1.y };
  scene(24, i => ({
    ...dark,
    phone: { img: SHOT('03-apercu'), circle: i >= 5 ? { rect: pad(R.summary, 2), p: Math.min(1, (i - 4) / 6), seed: boil(i) } : null },
    note: { tokens: ['Chapitres', 'retrouvés,', 'pages', 'comptées.'], shown: words(i, 4), hl: [2], size: 86, y: 130 },
    callout: i >= 12 ? { img: SHOT('04-chapitres'), crop: pad(row, 6), w: 940, y: 470, rot: -1.2, k: step(i, 12, [0.72, 1.06, 1]) } : null,
  }));
  // D. Où vous en êtes
  scene(24, i => ({
    ...dark,
    phone: { img: SHOT('05-bandeau') },
    note: { tokens: ['Vous', 'savez', 'où', 'vous', `en${NB}êtes.`], shown: words(i, 5), hl: [4], size: 86, y: 130 },
    callout: i >= 9 ? { img: SHOT('05-bandeau'), crop: { x: 14, y: 168, w: 362, h: 150 }, w: 940, y: 440, rot: 1.1, k: step(i, 9, [0.72, 1.06, 1]) } : null,
  }));
  // E. Au dessert, la réponse
  scene(32, i => ({
    ...dark, table: true,
    label: { text: 'Au dessert.', y: 150 },
    phone: { img: SHOT('05-bandeau'), top: 1080, dy: step(i, 0, [700, 400, 150, 40, 0]), rot: -2 },
    bubbles: [
      { ...question(1, 5), y: 230, size: 70 },
      { side: 'right', tone: 'saf', x: 70, y: 560, size: 74, k: step(i, 2, [0.55, 1.08, 1]), typing: i < 8 ? 1 + (Math.floor((i - 2) / 2) % 3) : 0,
        tokens: [`27${NB}%.`, `65${NB}pages${NB}sur${NB}240.`, `Question${NB}suivante${NB}?`], shown: words(i, 3, 3, 8) },
    ],
  }));
  // F. La fin
  scene(34, i => ({
    ...dark,
    end: {
      icon: step(i, 0, [0.35, 0.8, 1.12, 1]), title: Math.max(0, Math.min(4, i - 2)), tag: i >= 9, pill: i >= 12, url: i >= 15,
      plant: growth[Math.max(0, Math.min(growth.length - 1, Math.floor((i - 4) / 2)))], books: Math.max(0, Math.min(1, Math.floor((i - 6) / 2) / 7)),
    },
  }));
}, { cover: 31 }).catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

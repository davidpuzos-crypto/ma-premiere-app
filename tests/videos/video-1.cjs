// Vidéo 1 pour les réseaux sociaux : « Déposez votre thèse : le Journal trouve vos chapitres et compte vos pages »
// Image par image, façon stop motion (8 images par seconde, chacune un peu « reprise »), format vertical 1080 × 1920.
//
//   node tests/videos/video-1.cjs        → tests/.tmp/videos/journal-de-bord-video-1.mp4 (et une image de couverture)
//
// Le site est filmé sur un téléphone, avec un compte de démonstration fictif et la base simulée de tests/stubs :
// aucun compte réel, aucune donnée réelle. Il faut Playwright (comme pour les tests) et ffmpeg.
const { make, SHOT, NB, toStage, pad, step, words, boil, growth } = require('./commun.cjs');

make(1, (R, scene) => {

  // A. L'accroche : l'étagère vide, la question, le tampon
  scene(30, i => ({
    phone: { img: SHOT('01-vide'), dy: step(i, 0, [1400, 1020, 640, 300, 90, 0]) },
    note: { tokens: ['Votre', 'thèse', 'fait', 'combien', 'de', `pages${NB}?`], shown: words(i, 6), hl: [5], size: 86, y: 130 },
    stamp: i >= 15 ? { text: 'Ne comptez plus.', x: 150, y: 735, rot: -7, k: step(i, 15, [1.4, 1.12, 1]) } : null,
  }));
  // B. Déposer le document
  const [dx, dy] = toStage(R.drop.x + R.drop.w / 2, R.drop.y + R.drop.h / 2);
  const fall = [[862, 640, 11, 1], [840, 790, 18, 0.95], [790, 955, 26, 0.88], [712, 1120, 34, 0.78], [622, 1275, 30, 0.68], [dx, dy, 22, 0.58]];
  scene(20, i => ({
    phone: { img: SHOT('01-vide'), drop: i >= 18 ? R.drop : null },
    note: { tokens: ['Déposez', 'votre', 'document.'], shown: words(i, 3), hl: [2], size: 86, y: 130, sub: 'Word, LibreOffice, PDF, LaTeX ou Google Docs', subOn: i >= 6 },
    doc: i < 4 ? null : i < 12 ? { x: 862, y: 640, rot: 11, s: 1 } : i < 18 ? { x: fall[i - 12][0], y: fall[i - 12][1], rot: fall[i - 12][2], s: fall[i - 12][3] } : i === 18 ? { x: dx, y: dy, rot: 20, s: 0.4 } : null,
  }));
  // C. La lecture, sur l'appareil
  scene(18, i => ({
    phone: { img: SHOT('02-lecture') },
    note: { tokens: ['Lu', 'sur', 'votre', 'appareil.'], shown: words(i, 4), hl: [3], size: 86, y: 130, sub: 'Rien n’est envoyé.', subOn: i >= 8 },
  }));
  // D. Les chapitres retrouvés
  scene(28, i => ({
    phone: { img: SHOT('03-apercu'), circle: i >= 8 ? { rect: pad(R.summary, 2), p: Math.min(1, (i - 7) / 6), seed: boil(i) } : null },
    note: { tokens: ['Il', 'retrouve', 'vos', 'chapitres…'], shown: words(i, 4), hl: [3], size: 86, y: 130 },
    callout: i >= 15 ? { img: SHOT('03-apercu'), crop: pad(R.summary, 8), w: 940, y: 470, rot: 1.4, k: step(i, 15, [0.72, 1.06, 1]) } : null,
  }));
  // E. Les pages, chapitre par chapitre, puis « Créer mon plan »
  const row = { x: R.row1.x, y: R.row1.y, w: R.row1.w, h: R.row2.y + R.row2.h - R.row1.y };
  const apply = { x: R.apply.x + R.apply.w / 2, y: R.apply.y + R.apply.h / 2 };
  scene(32, i => ({
    phone: { img: SHOT('04-chapitres'), tap: i >= 26 ? { x: apply.x, y: apply.y, k: Math.min(1, (i - 26) / 3) } : null },
    note: { tokens: ['…et', 'compte', 'vos', 'pages,', 'chapitre', 'par', 'chapitre.'], shown: words(i, 7, 1), hl: [3], size: 72, y: 130 },
    callout: i >= 12 && i < 25 ? { img: SHOT('04-chapitres'), crop: pad(row, 6), w: 940, y: 500, rot: -1.2, k: step(i, 12, [0.72, 1.06, 1]) } : null,
  }));
  // F. Le plan est prêt
  scene(24, i => ({
    phone: { img: SHOT('05-bandeau') },
    note: { tokens: ['Votre', 'plan', 'est', 'prêt.'], shown: words(i, 4), hl: [1], size: 86, y: 130, sub: 'En un geste.', subOn: i >= 8 },
    callout: i >= 11 ? { img: SHOT('05-bandeau'), crop: { x: 14, y: 168, w: 362, h: 150 }, w: 940, y: 460, rot: 1.1, k: step(i, 11, [0.72, 1.06, 1]) } : null,
  }));
  // G. L'étagère
  scene(24, i => ({
    phone: { img: SHOT('06-etagere'), circle: i >= 10 ? { rect: pad(R.shelf, -6), p: Math.min(1, (i - 9) / 6), seed: boil(i) } : null },
    note: { tokens: ['Chaque', 'chapitre', 'devient', 'un', 'livre', 'qui', 'se', 'remplit.'], shown: words(i, 8, 1), hl: [4], size: 72, y: 130 },
  }));
  // H. La fin : le nom, l'adresse, la plante qui pousse
  scene(34, i => ({
    end: {
      icon: step(i, 0, [0.35, 0.8, 1.12, 1]), title: Math.max(0, Math.min(4, i - 2)), tag: i >= 9, pill: i >= 12, url: i >= 15,
      plant: growth[Math.max(0, Math.min(growth.length - 1, Math.floor((i - 4) / 2)))], books: Math.max(0, Math.min(1, Math.floor((i - 6) / 2) / 7)),
    },
  }));
}, { cover: 24 }).catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

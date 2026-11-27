// Vidéo 3 pour les réseaux sociaux : « +1 page… et la date de fin avance »
// Un compte de démonstration avec cinq mois de suivi : à ce rythme, la dernière page tombe douze jours après la date
// à tenir. Trois pages aujourd'hui, et la fin avance de trois semaines : le retard devient de l'avance.
// Même procédé que les vidéos 1 et 2 (stop motion, 1080 × 1920), sur fond safran.
//
//   node tests/videos/video-3.cjs        → tests/.tmp/videos/journal-de-bord-video-3.mp4 (et une image de couverture)
//   SHOTS_ONLY=1 node tests/videos/video-3.cjs   seulement les captures du site (pour les vérifier)
const { make, openPhone, demoJournal, SHOT, NB, pad, step, words, boil, growth } = require('./commun.cjs');

async function shoot(base) {
  const { p, rects, clean, rect, shot, close } = await openPhone(base, { store: demoJournal() });
  const say = async label => console.log(label, JSON.stringify(await p.evaluate(() => {
    const t = id => (document.getElementById(id) || {}).textContent || '';
    return { date: t('sEndDate'), dans: t('sEndIn'), gain: t('sEndGain'), phrase: t('sEndQuip'), verdict: (document.querySelector('#dbDeadline .dl-verdict') || {}).textContent, vitesse: t('paceNow'), levier: t('paceLever') };
  })).replace(/\\u00a0/g, ' '));
  await p.goto(base);
  await p.waitForSelector('.chapter-card');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1600);
  await clean();
  await p.evaluate(() => window.scrollTo(0, 0));
  await shot('31-avant');
  await say('avant');
  await rect('side', '.hero-side');
  await rect('prog', '.prog');
  await rect('date', '#sEndDate');
  await rect('fab', '.fab');
  await p.evaluate(() => document.getElementById('heroPace').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(600);
  await clean();
  await shot('35-velocite');
  await rect('pace', '#heroPace');
  await rect('paceNow', '#paceNow');
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(500);
  for (const k of [1, 2, 3]) {
    await p.click('.fab');
    await p.waitForTimeout(1300);
    await clean();
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.waitForTimeout(200);
    await shot(`3${k + 1}-plus${k}`);
    await say(`+${k}`);
    await rect(`side${k}`, '.hero-side');
  }
  await p.evaluate(() => document.getElementById('heroPace').scrollIntoView({ block: 'center' }));
  await p.waitForTimeout(600);
  await clean();
  await shot('36-velocite-apres');
  await rect('paceAfter', '#heroPace');
  await rect('lever', '#paceLever');
  await close();
  return rects;
}

make(3, (R, scene) => {
  const saf = { theme: 'saf' };
  const fab = { x: R.fab.x + R.fab.w / 2, y: R.fab.y + R.fab.h / 2 };
  const tap = (i, from) => (i >= from && i < from + 4 ? { x: fab.x, y: fab.y, k: Math.min(1, (i - from) / 3) } : null);
  const zoom = (img, side, k) => ({ img: SHOT(img), crop: pad(side, 6), w: 860, y: 430, rot: 1.2, k });

  // A. La question : à ce rythme, quand ?
  scene(28, i => ({
    ...saf,
    phone: { img: SHOT('31-avant'), dy: step(i, 0, [1400, 1020, 640, 300, 90, 0]), circle: i >= 12 ? { rect: pad(R.date, 8), p: Math.min(1, (i - 11) / 6), seed: boil(i) } : null },
    note: { tokens: ['À', 'ce', 'rythme,', 'vous', 'finissez', `quand${NB}?`], shown: words(i, 6), hl: [5], size: 84, y: 130 },
  }));
  // B. Le rythme, le vrai
  scene(26, i => ({
    ...saf,
    phone: { img: SHOT('35-velocite') },
    note: { tokens: ['À', 'votre', 'vrai', 'rythme.'], shown: words(i, 4), hl: [3], size: 86, y: 130, sub: 'Pages par semaine, tendance, record.', subOn: i >= 8 },
    callout: i >= 10 ? { img: SHOT('35-velocite'), crop: pad(R.pace, 4), w: 940, y: 470, rot: -1.2, k: step(i, 10, [0.72, 1.06, 1]) } : null,
  }));
  // C. Une page de plus…
  scene(30, i => ({
    ...saf,
    phone: { img: SHOT(i < 10 ? '31-avant' : '32-plus1'), tap: tap(i, 6) },
    note: { tokens: ['Une', 'page', 'de', `plus\u2026`], shown: words(i, 4), hl: [1], size: 86, y: 130 },
    callout: i >= 11 ? zoom('32-plus1', R.side1, step(i, 11, [0.72, 1.06, 1])) : null,
  }));
  // D. …et la fin avance : deux pages encore, le retard devient de l'avance
  scene(36, i => ({
    ...saf,
    phone: { img: SHOT(i < 8 ? '32-plus1' : i < 22 ? '33-plus2' : '34-plus3'), tap: tap(i, 4) || tap(i, 18) },
    note: { tokens: ['\u2026et', 'la', 'fin', 'avance.'], shown: words(i, 4), hl: [2], size: 86, y: 130 },
    callout: i < 8 ? zoom('32-plus1', R.side1, 1) : i < 22 ? zoom('33-plus2', R.side2, step(i, 8, [0.92, 1.05, 1])) : zoom('34-plus3', R.side3, step(i, 22, [0.92, 1.05, 1])),
    stamp: i >= 27 ? { text: 'Retard effacé.', x: 230, y: 1360, rot: -6, k: step(i, 27, [1.4, 1.12, 1]), color: '#236B45', bg: '#E7F3EA' } : null,
  }));
  // E. Trois pages, trois semaines
  scene(26, i => ({
    ...saf,
    phone: { img: SHOT('36-velocite-apres') },
    note: { tokens: ['3', 'pages', 'aujourd\u2019hui,', `3${NB}semaines`, 'gagnées.'], shown: words(i, 5), hl: [3], size: 80, y: 130 },
    callout: i >= 10 ? { img: SHOT('36-velocite-apres'), crop: pad(R.paceAfter, 4), w: 940, y: 470, rot: 1.2, k: step(i, 10, [0.72, 1.06, 1]) } : null,
  }));
  // F. La fin
  scene(34, i => ({
    ...saf,
    end: {
      icon: step(i, 0, [0.35, 0.8, 1.12, 1]), title: Math.max(0, Math.min(4, i - 2)), tag: i >= 9, pill: i >= 12, url: i >= 15,
      plant: growth[Math.max(0, Math.min(growth.length - 1, Math.floor((i - 4) / 2)))], books: Math.max(0, Math.min(1, Math.floor((i - 6) / 2) / 7)),
    },
  }));
}, { cover: 118, shoot }).catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

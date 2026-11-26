// Tests de la logique pure (dates, série, rythme, échéance, rétroplanning, titres)
// Lancer : node tests/core.test.mjs
import assert from 'node:assert/strict';
import * as C from '../core.js';

// Dates
assert.equal(C.addDays('2026-03-28', 2), '2026-03-30'); // passage heure d'été
assert.equal(C.diffDays('2026-03-28', '2026-03-30'), 2);
assert.equal(C.diffDays('2026-10-24', '2026-10-26'), 2); // heure d'hiver
assert.equal(C.weekday('2026-11-25'), 3); // mercredi
assert.equal(C.mondayOf('2026-11-29'), '2026-11-23');
assert.equal(C.isDayKey('2026-02-30'), false);
assert.equal(C.isDayKey('2026-02-28'), true);
// Jours d'écriture
assert.equal(C.countWritingDays('2026-11-23', '2026-11-29', [1,2,3,4,5]), 5);
assert.equal(C.countWritingDays('2026-11-23', '2026-12-06', [1,2,3,4,5]), 10);
assert.equal(C.countWritingDays('2026-11-25', '2026-11-24', [1,2,3,4,5]), 0);
assert.equal(C.nthWritingDay('2026-11-27', 2, [1,2,3,4,5]), '2026-11-30'); // ven -> lun
assert.equal(C.nthWritingDay('2026-11-27', 1, []), '2026-11-27');

// Série : jours d'écriture lun-ven, week-end ignoré
const st = { writingDays: [1,2,3,4,5], trackedSince: '2026-11-01', activity: { '2026-11-19': 2, '2026-11-20': 1, '2026-11-23': 3, '2026-11-24': 1 }, journal: {} };
assert.deepEqual(C.streak(st, '2026-11-25'), { count: 4, includesToday: false });
st.activity['2026-11-25'] = 1;
assert.deepEqual(C.streak(st, '2026-11-25'), { count: 5, includesToday: true });
// note seule = jour actif
st.journal['2026-11-18'] = [{ n: 'lecture' }];
assert.equal(C.streak(st, '2026-11-25').count, 6);
assert.equal(C.bestStreak(st, '2026-11-25'), 6);

// Rythme
const p1 = C.pace({ trackedSince: '2026-11-20', startDate: '2026-01-01', activity: { '2026-11-21': 5 } }, '2026-11-25', 100);
assert.equal(p1.basis, 'average'); // moins de 14 jours de suivi, on écrivait déjà avant
assert.ok(Math.abs(p1.average - 100 / 329) < 1e-9);
// Nouvel inscrit avec 100 pages déjà écrites : elles ne gonflent pas le rythme
const p0 = C.pace({ trackedSince: '2026-11-25', startDate: null, activity: {} }, '2026-11-25', 100);
assert.equal(p0.basis, 'none');
assert.equal(p0.forecast, 0);
// Date de début = jour de l'inscription : pas de moyenne absurde (100 pages en 1 jour)
const p0b = C.pace({ trackedSince: '2026-11-25', startDate: '2026-11-25', activity: {} }, '2026-11-25', 100);
assert.equal(p0b.forecast, 0);
// Premiers jours : estimation provisoire sur les pages notées
const pe = C.pace({ trackedSince: '2026-11-23', startDate: null, activity: { '2026-11-23': 2, '2026-11-25': 1 } }, '2026-11-25', 103);
assert.equal(pe.basis, 'early');
assert.equal(pe.forecast, 1); // 3 pages en 3 jours
const p2 = C.pace({ trackedSince: '2026-10-01', startDate: '2026-01-01', activity: { '2026-11-21': 14, '2026-11-01': 14 } }, '2026-11-25', 100);
assert.equal(p2.basis, 'recent');
assert.equal(p2.recentWindow, 28);
assert.equal(p2.forecast, 1); // 28 pages / 28 jours

// Prévision avec échéance
const fc = C.forecast({ trackedSince: '2026-10-01', startDate: '2026-01-01', activity: { '2026-11-21': 14, '2026-11-01': 14 }, deadline: '2027-01-15', marginDays: 14, writingDays: [1,2,3,4,5] }, { total: 150, written: 100 }, '2026-11-25');
assert.equal(fc.writingEnd, '2027-01-01');
assert.equal(fc.daysLeft, 38);
assert.equal(fc.projectedEnd, '2027-01-14');
assert.equal(fc.status, 'behind');
assert.equal(fc.margin, -13);
assert.equal(fc.writingDaysLeft, C.countWritingDays('2026-11-25', '2027-01-01', [1,2,3,4,5]));
assert.equal(fc.dailyGoal, Math.max(0.5, Math.ceil(50 / fc.writingDaysLeft * 2) / 2));
const fcDone = C.forecast({}, { total: 10, written: 12 }, '2026-11-25');
assert.equal(fcDone.status, 'done');
const fcOver = C.forecast({ deadline: '2026-11-01', marginDays: 0 }, { total: 10, written: 2 }, '2026-11-25');
assert.equal(fcOver.status, 'overdue');

// Rétroplanning : intro & conclusion à la fin
const chs = [
  { id: 'a', title: 'Introduction générale', remaining: 10 },
  { id: 'b', title: 'Chapitre 1 : État de l\'art', remaining: 20 },
  { id: 'c', title: 'Méthodologie', remaining: 0 },
  { id: 'd', title: 'Conclusion générale', remaining: 10 },
];
const sch = C.schedule(chs, { writingDays: [1,2,3,4,5], introLast: true }, '2026-11-25', { writingEnd: '2026-12-31', daysLeft: 37, writingDaysLeft: C.countWritingDays('2026-11-25','2026-12-31',[1,2,3,4,5]) });
assert.ok(sch.b < sch.d && sch.d < sch.a, JSON.stringify(sch));
assert.equal(sch.c, undefined);
assert.ok(sch.a <= '2026-12-31');

// Titres
assert.equal(C.normalizeTitle('Chapitre 2 : État de l’art'), 'etat de l art');
assert.equal(C.normalizeTitle('1.2 Contexte général'), 'contexte general');
assert.equal(C.normalizeTitle('III. Résultats'), 'resultats');
assert.equal(C.normalizeTitle('Introduction'), 'introduction');
assert.equal(C.normalizeTitle('Civil rights movement'), 'civil rights movement');
assert.equal(C.normalizeTitle('Article 1'), 'article 1');
assert.equal(C.normalizeTitle('Partie II – Analyse'), 'analyse');
assert.ok(C.titleScore('Introduction', 'Introduction générale') >= 0.8);
assert.ok(C.titleScore('Article 1', 'Article 12') < 0.55);
assert.ok(C.titleScore('Article 1', 'Article 1 : Les effets du sommeil') >= 0.8);
assert.ok(C.titleScore('Chapitre 3 - Méthodologie et terrain', 'Méthodologie et terrain') >= 0.95);
assert.ok(C.titleScore('Revue de la littérature', 'Cadre théorique') < 0.3);

// Répartition
assert.deepEqual(C.distribute(10, [1, 1, 1]), [4, 3, 3]);
assert.equal(C.distribute(300, [5, 0, 12, 3]).reduce((a, b) => a + b, 0), 300);
console.log('core.js : tous les tests passent');

// Plan saisi ou collé
const plan = C.parsePlanText(`Introduction (15)
1. État de l'art
1.1 Contexte historique 20 p
1.2 Travaux récents
1.2.1 Détail ignoré
2. Méthodologie
   Terrain
   - Entretiens (12 pages)
Conclusion ........ 245
`);
assert.deepEqual(plan.map(c => c.title), ['Introduction', "1. État de l'art", '2. Méthodologie', 'Conclusion']);
assert.equal(plan[0].target, 15);
assert.deepEqual(plan[1].subs, [{ title: '1.1 Contexte historique', target: 20 }, { title: '1.2 Travaux récents', target: 0 }]);
assert.deepEqual(plan[2].subs.map(s => [s.title, s.target]), [['Terrain', 0], ['Entretiens', 12]]);
assert.equal(plan[3].subs.length, 0);
// Liste à puces uniforme : ce sont des chapitres, pas des sous-parties
assert.deepEqual(C.parsePlanText('- Introduction\n- Chapitre 1\n- Conclusion').map(c => [c.title, c.subs.length]), [['Introduction', 0], ['Chapitre 1', 0], ['Conclusion', 0]]);
// Puces mélangées : les puces sont des sous-parties
assert.deepEqual(C.parsePlanText('Partie 1\n• A\n• B\nPartie 2').map(c => c.subs.length), [2, 0]);
assert.deepEqual(C.parsePlanText('Article 1\nArticle 2').map(c => [c.title, c.target]), [['Article 1', 0], ['Article 2', 0]]);
assert.deepEqual(C.parsePlanText('   \n'), []);
console.log('core.js : plan saisi OK');

/* ============================================================
   PLAN D'UN DOCUMENT (outline.js) : où sont les chapitres ?
============================================================ */
const O = await import('../outline.js');
const seg = (level, title, words = 100) => ({ level, title, words });
const titles = o => o.chapters.map(c => c.title);
const sumWords = o => o.front + o.chapters.reduce((s, c) => s + c.words, 0);

// A. Plan « à plat » : Titre 1 = chapitres, Titre 2 = sections
{
  const s = [seg(1, 'Introduction', 500), seg(1, 'Chapitre 1 : Cadre', 50), seg(2, '1.1 Notions', 900), seg(2, '1.2 Débats', 800), seg(1, 'Conclusion', 300)];
  const o = O.buildOutline(s, 120);
  assert.deepEqual(titles(o), ['Introduction', 'Chapitre 1 : Cadre', 'Conclusion']);
  assert.equal(o.chapterLevel, 1);
  assert.equal(o.subLevel, 2);
  assert.deepEqual(o.chapters[1].children.map(c => c.title), ['1.1 Notions', '1.2 Débats']);
  assert.equal(o.chapters[1].words, 1750);
  assert.equal(o.chapters[1].ownWords, 50);
  assert.equal(o.front, 120);
  assert.equal(sumWords(o), 120 + 2550);
}

// B. Le cas signalé : un seul Titre 1 (le titre de la thèse), les chapitres en Titre 2
{
  const s = [seg(1, 'Les ponts suspendus au XIXe siècle', 40), seg(2, 'Introduction', 600), seg(2, 'État de l\'art', 80), seg(3, 'Histoire des techniques', 1500), seg(3, 'Débats', 1200),
    seg(2, 'Méthodologie', 70), seg(3, 'Archives', 900), seg(4, 'Fonds privés', 300), seg(2, 'Conclusion', 400)];
  const o = O.buildOutline(s, 0);
  assert.deepEqual(titles(o), ['Introduction', 'État de l\'art', 'Méthodologie', 'Conclusion'], 'les Titre 2 deviennent les chapitres');
  assert.equal(o.chapterLevel, 2);
  assert.equal(o.subLevel, 3);
  assert.deepEqual(o.chapters[1].children.map(c => c.title), ['Histoire des techniques', 'Débats']);
  assert.equal(o.chapters[2].children[0].words, 1200, 'les sous-sous-titres comptent dans leur section');
  assert.equal(o.front, 40, 'le texte sous le titre de la thèse rejoint les pages liminaires');
  assert.equal(sumWords(o), s.reduce((a, x) => a + x.words, 0));
  // Ancien découpage (fichiers déjà synchronisés avant la 3.1) : un seul chapitre, tout en sous-sections
  const old = O.buildOutline(s, 0, 'legacy');
  assert.deepEqual(titles(old), ['Les ponts suspendus au XIXe siècle']);
  assert.equal(old.chapters[0].children.length, 4);
  assert.equal(sumWords(old), sumWords(o));
  // Remerciements et bibliographie au même niveau que le titre : il reste le titre du document
  const o2 = O.buildOutline([seg(1, 'Remerciements', 200), ...s, seg(1, 'Bibliographie', 900)], 0);
  assert.deepEqual(titles(o2), ['Remerciements', 'Introduction', 'État de l\'art', 'Méthodologie', 'Conclusion', 'Bibliographie']);
}

// C. Thèse en parties : Titre 1 = parties, Titre 2 = chapitres, Titre 3 = sections
{
  const s = [seg(1, 'Introduction générale', 800), seg(1, 'Première partie : Les fondations', 60), seg(2, 'Chapitre 1 : Le sol', 100), seg(3, 'Géologie', 700), seg(3, 'Sondages', 600),
    seg(2, 'Chapitre 2 : Les piles', 900), seg(1, 'PARTIE II. Le tablier', 450), seg(2, 'Chapitre 3 : Les câbles', 1000), seg(1, 'Conclusion générale', 500), seg(1, 'Bibliographie', 700)];
  const o = O.buildOutline(s, 0);
  assert.deepEqual(titles(o), ['Introduction générale', 'Chapitre 1 : Le sol', 'Chapitre 2 : Les piles', 'PARTIE II. Le tablier', 'Chapitre 3 : Les câbles', 'Conclusion générale', 'Bibliographie']);
  assert.equal(o.chapters[1].ownWords, 160, 'courte ouverture de partie comptée avec son premier chapitre');
  assert.equal(o.chapters[3].words, 450, 'longue ouverture de partie : une ligne à elle');
  assert.equal(o.chapters[3].children.length, 0);
  assert.deepEqual(o.chapters[1].children.map(c => c.title), ['Géologie', 'Sondages']);
  assert.equal(sumWords(o), s.reduce((a, x) => a + x.words, 0));
  // On peut préférer les parties comme premier étage : niveau 1 demandé explicitement
  const byParts = O.buildOutline(s, 0, 1);
  assert.deepEqual(titles(byParts), ['Introduction générale', 'Première partie : Les fondations', 'PARTIE II. Le tablier', 'Conclusion générale', 'Bibliographie']);
  assert.deepEqual(byParts.chapters[1].children.map(c => c.title), ['Chapitre 1 : Le sol', 'Chapitre 2 : Les piles']);
  assert.equal(sumWords(byParts), sumWords(o));
}

// D. Un seul chapitre rédigé pour l'instant : ce n'est pas le titre du document
{
  const s = [seg(1, 'Chapitre 2 : Méthodes', 50), seg(2, 'Terrain', 800), seg(2, 'Entretiens', 700)];
  assert.deepEqual(titles(O.buildOutline(s, 0)), ['Chapitre 2 : Méthodes']);
  // … mais si l'on sait que le fichier est un chapitre, ce sont ses sections qui nous intéressent
  const single = O.buildOutline(s, 30, 'auto', { single: true });
  assert.deepEqual(titles(single), ['Terrain', 'Entretiens']);
  assert.equal(single.front, 80);
  // Fichier de chapitre sans titre de tête : ses titres de premier niveau sont déjà les sections
  assert.deepEqual(titles(O.buildOutline([seg(1, 'Terrain'), seg(1, 'Entretiens')], 0, 'auto', { single: true })), ['Terrain', 'Entretiens']);
}

// E. Un gros chapitre et des chapitres encore vides : pas de confusion avec un titre de document
{
  const s = [seg(1, 'Problématique', 300), seg(1, 'Corpus', 50), seg(2, 'Sources', 9000), seg(2, 'Sélection', 8000), seg(1, 'Analyse', 3), seg(1, 'Discussion', 2)];
  assert.deepEqual(titles(O.buildOutline(s, 0)), ['Problématique', 'Corpus', 'Analyse', 'Discussion']);
}

// F. Niveau choisi à la main sur un plan à plat : les sections deviennent le premier étage
{
  const s = [seg(1, 'Introduction', 500), seg(1, 'Cadre', 50), seg(2, 'Notions', 900), seg(2, 'Débats', 800), seg(1, 'Conclusion', 300)];
  const o = O.buildOutline(s, 0, 2);
  assert.deepEqual(titles(o), ['Introduction', 'Notions', 'Débats', 'Conclusion']);
  assert.equal(o.chapters[1].ownWords, 950, 'le court texte d\'ouverture suit le premier titre');
  assert.equal(sumWords(o), 2550);
  assert.deepEqual(o.levels, [{ level: 1, count: 3 }, { level: 2, count: 2 }]);
}

// G. Aucun mot ne se perd, quel que soit le découpage (documents tirés au hasard)
{
  let seed = 42;
  const rnd = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const names = ['Introduction', 'Chapitre 1', 'Partie I', 'Titre', 'Méthode', 'Résultats', 'Bibliographie', 'Annexes', 'Deuxième partie', 'Chapitre 2', 'Discussion'];
  for (let i = 0; i < 300; i++) {
    const s = Array.from({ length: 1 + rnd(14) }, () => seg(1 + rnd(4), names[rnd(names.length)], rnd(1500)));
    const front = rnd(400);
    const all = front + s.reduce((a, x) => a + x.words, 0);
    for (const mode of ['auto', 1, 2, 3, 4, 'legacy']) {
      assert.equal(sumWords(O.buildOutline(s, front, mode)), all, `mots conservés (${mode})`);
      const o = O.buildOutline(s, front, mode);
      for (const c of o.chapters) assert.equal(c.words, c.ownWords + c.children.reduce((a, k) => a + k.words, 0));
    }
    assert.equal(sumWords(O.buildOutline(s, front, 'auto', { single: true })), all);
  }
  assert.deepEqual(O.buildOutline([], 50).chapters, []);
  assert.equal(O.buildOutline([], 50).front, 50);
}

// H. Texte collé ou fichier texte : LaTeX
{
  const tex = `\\documentclass{book}
\\usepackage{hyperref}
\\begin{document}
Un résumé de dix mots environ pour ouvrir le document ici.
\\chapter{Introduction}
Le pont \\emph{suspendu} est étudié depuis \\cite{navier1823}. % ce commentaire ne compte pas
\\section{Contexte historique}
On note $E = mc^2$ et la formule
\\begin{equation} a^2 + b^2 = c^2 \\end{equation}
puis deux mots.\\footnote{Une note de quatre mots.}
\\chapter*{Méthode \\textit{mixte}}
Trois mots seulement.
\\end{document}
Ceci est ignoré.`;
  const r = O.parseTextDocument(tex);
  assert.equal(r.kind, 'latex');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[2, 'Introduction'], [3, 'Contexte historique'], [2, 'Méthode mixte']]);
  assert.equal(r.frontWords, 11);
  assert.equal(r.segments[0].words, 1 + 6, 'titre + texte, sans la citation ni le commentaire');
  assert.equal(r.segments[1].words, 2 + 6 + 2 + 5, 'les formules ne comptent pas, la note oui');
  assert.equal(r.segments[2].words, 2 + 3);
  assert.deepEqual(titles(O.buildOutline(r.segments, r.frontWords)), ['Introduction', 'Méthode mixte']);
}

// I. Markdown et texte simple
{
  const md = '# Ma thèse\n\nRésumé en quatre mots.\n\n## Introduction\n\nUn **premier** paragraphe de six mots.\n\n```\ncode # pas un titre\n```\n\n### Contexte\n\nEncore [un lien](http://exemple.fr) ici.\n\n## Méthode\n\nDeux mots.\n';
  const r = O.parseTextDocument(md);
  assert.equal(r.kind, 'markdown');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Ma thèse'], [2, 'Introduction'], [3, 'Contexte'], [2, 'Méthode']]);
  assert.deepEqual(titles(O.buildOutline(r.segments, r.frontWords)), ['Introduction', 'Méthode'], 'le titre unique du document est reconnu');
  const txt = 'Quelques mots avant.\n\nChapitre 1 : Le sol\n\nDu texte, avec une phrase. Chapitre 2 est cité ici, en pleine phrase.\n\nCHAPITRE 2 - Les piles\nEncore du texte.\n\nConclusion générale\nFin.';
  const t = O.parseTextDocument(txt);
  assert.equal(t.kind, 'text');
  assert.deepEqual(t.segments.map(s => s.title), ['Chapitre 1 : Le sol', 'CHAPITRE 2 - Les piles', 'Conclusion générale']);
  assert.equal(t.frontWords, 3);
  assert.equal(t.totalWords, O.countWords(txt));
  assert.deepEqual(O.parseTextDocument('Un simple paragraphe sans titre.').segments, []);
}
console.log('outline.js : plan de document OK');

/* ============================================================
   visuals.js : les dessins (étagère, plante, semaine, niveau)
============================================================ */
{
  const V = await import('../visuals.js');
  // La plante pousse par paliers, et ne rétrécit jamais quand la série s'allonge
  let last = -1;
  for (const n of [0, 1, 2, 3, 4, 7, 10, 14, 21, 30, 100]) {
    const s = V.plantStage(n);
    assert.ok(s.height >= last, 'la plante ne rétrécit pas : ' + n);
    last = s.height;
  }
  assert.equal(V.plantStage(0).height, 0);
  assert.equal(V.plantStage(30).top, 'flower');
  assert.match(V.plantSVG(0), /^<svg class="plant-svg"/);
  assert.match(V.plantSVG(5, { width: 130 }), /class="sc-plant"[^>]* width="130" height="173"/, 'taille écrite en clair pour les images');
  assert.match(V.plantImgHTML(5, 130), /^<img class="sc-plant" alt="" width="130" height="173" src="data:image\/svg\+xml,/);
  assert.match(V.plantCaption(0, true), /soif/);
  assert.match(V.plantCaption(1, false), /^1 jour d'affilée/);
  assert.match(V.plantCaption(30, false), /en fleur/);
  // Les livres : épaisseur bornée, proportionnelle à l'objectif
  assert.equal(V.bookWidth(0), 30);
  assert.equal(V.bookWidth(1000), 88);
  assert.ok(V.bookWidth(60) > V.bookWidth(20));
  const books = [
    { id: 'a', title: 'Intro <b>"gras"</b>', pct: 100, written: 15, target: 15, status: 'ok', current: false },
    { id: 'b', title: 'Analyse', pct: 24.4, written: 1, target: 90, status: '', current: true, due: '24 févr. 2027' },
    { id: 'c', title: 'Conclusion', pct: 0, written: 0, target: 10, status: 'sent', current: false },
  ];
  const html = V.shelfBooksHTML(books);
  assert.equal((html.match(/class="book-slot"/g) || []).length, 3);
  assert.ok(!/<b>"gras"<\/b>/.test(html), 'les titres sont neutralisés');
  assert.match(html, /class="book is-done has-tag"/);
  assert.match(html, /class="book is-current"/);
  assert.match(html, /class="book is-empty has-tag"/);
  assert.match(html, /--p:24"/, 'pourcentage arrondi');
  assert.match(V.shelfBooksHTML(books, { intro: true }), /--p:0" data-book="b"/, 'à l\'ouverture, les livres arrivent vides');
  assert.equal(V.bookLabel(books[1]), 'Analyse : 1 page sur 90, 24 %, à finir pour le 24 févr. 2027 (partie en cours)');
  assert.equal(V.bookLabel(books[2]), 'Conclusion : 0 page sur 10, 0 %, chez la direction');
  // Image à partager : jamais de titre, et tout tient dans la largeur, même avec beaucoup de chapitres
  const many = Array.from({ length: 40 }, (_, i) => ({ id: 'x' + i, title: 'Secret ' + i, pct: i * 2, target: 30 + i }));
  const share = V.shareShelfHTML(many, { width: 900, height: 190, plant: '<img class="sc-plant">' });
  assert.ok(!/Secret/.test(share), 'le sujet reste privé');
  const widths = [...share.matchAll(/width:(\d+)px/g)].map(m => +m[1]);
  assert.equal(widths.length, 18, 'dix-huit livres au plus');
  assert.ok(widths.reduce((a, w) => a + w + 8, 0) <= 900 - 170 + 18, 'les livres laissent la place de la plante');
  // La semaine : une barre par jour, hauteur relative au plus grand jour (ou à l'objectif)
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((label, i) => ({ label, name: 'jour' + i, pages: [2, 0, 4, 0, 0, 0, 0][i], today: i === 2, future: i > 2, rest: i > 4 }));
  const wk = V.weekBarsHTML(days, 2);
  assert.equal((wk.match(/class="wk-col/g) || []).length, 7);
  assert.match(wk, /wk-col is-today/);
  assert.match(wk, /--h:0\.500/, '2 pages sur un maximum de 4');
  assert.match(wk, /--g:0\.500/, 'ligne d\'objectif à mi-hauteur');
  assert.match(wk, /aria-label="Pages par jour cette semaine : jour0 2, jour1 0, jour2 4"/);
  assert.ok(!/wk-goal/.test(V.weekBarsHTML(days, 0)), 'pas de ligne sans objectif');
  // Le niveau : une pastille par grade intermédiaire
  const ticks = V.levelTicksHTML(45, [0, 1, 10, 25, 40, 50, 65, 80, 95, 100]);
  assert.equal((ticks.match(/level-tick/g) || []).length, 8);
  assert.equal((ticks.match(/passed/g) || []).length, 4, '1, 10, 25 et 40 sont franchis');
  // Initiales
  assert.equal(V.initials('Hypothèse Fragile'), 'HF');
  assert.equal(V.initials('Et al.'), 'EA');
  assert.equal(V.initials('prenom.nom'), 'PN');
  assert.equal(V.initials('Sic'), 'SI');
  assert.equal(V.initials('Élodie'), 'ÉL');
  assert.equal(V.initials(''), '?');
  assert.match(V.initials('<img src=x onerror=alert(1)>'), /^[\p{L}\p{N}]{1,2}$/u, 'jamais de balise dans une pastille');
}
console.log('visuals.js : dessins OK');

/* ------------------------------------------------------------
   Périodes hors rédaction, activités de thèse, joker, défi de la semaine
------------------------------------------------------------ */
{
  const WD = [1, 2, 3, 4, 5];
  // Deux semaines de terrain : dix jours d'écriture de moins, et le rythme à tenir s'ajuste
  const pauses = [{ from: '2026-12-07', to: '2026-12-18', kind: 'terrain' }];
  assert.equal(C.countWritingDays('2026-11-30', '2026-12-25', WD), 20);
  assert.equal(C.countWritingDays('2026-11-30', '2026-12-25', WD, pauses), 10);
  assert.equal(C.countWritingDays('2026-12-10', '2026-12-25', WD, pauses), 5, 'période entamée');
  assert.equal(C.countWritingDays('2026-12-08', '2026-12-10', WD, pauses), 0);
  // Périodes qui se chevauchent ou se touchent : comptées une fois
  const two = [...pauses, { from: '2026-12-14', to: '2026-12-22', kind: 'conges' }, { from: '2026-12-23', to: '2026-12-23', kind: 'autre' }, { from: 'x', to: 'y' }, null];
  assert.deepEqual(C.pauseRanges(two), [['2026-12-07', '2026-12-23']]);
  assert.equal(C.countWritingDays('2026-11-30', '2026-12-25', WD, two), 7);
  assert.equal(C.pausedDays('2026-12-01', '2026-12-31', two), 17);
  assert.equal(C.pauseOn(pauses, '2026-12-10').kind, 'terrain');
  assert.equal(C.pauseOn(pauses, '2026-12-19'), null);
  assert.equal(C.nthWritingDay('2026-12-04', 2, WD, pauses), '2026-12-21', 'le deuxième jour d\'écriture tombe après le terrain');
  assert.equal(C.nthWritingDay('2026-12-04', 2, WD), '2026-12-07');
  // Prévision : mêmes pages, moins de jours pour les écrire
  const base = { writingDays: WD, deadline: '2027-01-15', marginDays: 0, trackedSince: '2026-11-01', activity: {}, journal: {} };
  for (let i = 1; i <= 27; i++) base.activity[C.addDays('2026-11-30', -i)] = 1;
  const f0 = C.forecast(base, { total: 100, written: 60 }, '2026-11-30');
  const f1 = C.forecast({ ...base, pauses }, { total: 100, written: 60 }, '2026-11-30');
  assert.equal(f0.writingDaysLeft, 35);
  assert.equal(f1.writingDaysLeft, 25);
  assert.ok(f1.perWritingDay > f0.perWritingDay && f1.perWeek > f0.perWeek, 'il faut écrire un peu plus les autres jours');
  assert.equal(C.diffDays(f0.projectedEnd, f1.projectedEnd), 12, 'la fin estimée recule de la durée du terrain');
  // Série : le terrain ne la casse pas, une journée de terrain notée la prolonge
  const st = { writingDays: WD, trackedSince: '2026-11-01', pauses, activity: { '2026-12-03': 2, '2026-12-04': 1, '2026-12-21': 1 }, journal: {} };
  assert.deepEqual(C.streak(st, '2026-12-21'), { count: 3, includesToday: true });
  assert.deepEqual(C.streak({ ...st, pauses: [] }, '2026-12-21'), { count: 1, includesToday: true });
  st.journal['2026-12-09'] = [{ p: 0, n: '', k: 'terrain' }];
  assert.equal(C.streak(st, '2026-12-21').count, 4, 'une journée de terrain est une journée de thèse');
  assert.equal(C.bestStreak(st, '2026-12-21'), 4);
  // Joker : il ne prolonge pas la série, il l'empêche de tomber
  const jk = { writingDays: WD, trackedSince: '2026-11-01', activity: { '2026-11-24': 1, '2026-11-26': 1 }, journal: { '2026-11-25': [{ p: 0, n: '', k: 'joker' }] } };
  assert.equal(C.isActiveDay(jk, '2026-11-25'), false);
  assert.equal(C.isExcusedDay(jk, '2026-11-25'), true);
  assert.deepEqual(C.streak(jk, '2026-11-26'), { count: 2, includesToday: true });
  assert.equal(C.jokersInWeek(jk.journal, '2026-11-27'), 1);
  assert.equal(C.jokersInWeek(jk.journal, '2026-11-30'), 0, 'un joker par semaine : le compteur repart le lundi');
  // Le genre voyage aussi dans « s » : une ancienne version, qui efface « k », ne le fait pas perdre
  assert.equal(C.kindTag('joker'), '~joker');
  assert.equal(C.entryKind({ p: 0, k: 'terrain' }), 'terrain');
  assert.equal(C.entryKind({ p: 0, s: '~terrain' }), 'terrain', 'entrée repassée par une ancienne version');
  assert.equal(C.entryKind({ p: 0, k: 'inconnu', s: '~lecture' }), 'lecture');
  assert.equal(C.entryKind({ p: 2, s: 'c1_s2', n: 'Bonne séance' }), '', 'une entrée ordinaire, rattachée à une partie');
  assert.equal(C.entryKind({ p: 0, s: '~inconnu' }), '');
  assert.equal(C.entryKind({ p: 0, k: 'constructor' }), '', 'pas de genre hérité par accident');
  assert.equal(C.entryKind({ p: 0, s: '~toString' }), '');
  assert.equal(C.entryKind(null), '');
  assert.equal(C.isPauseKind('colloque'), true);
  assert.equal(C.isPauseKind('constructor'), false);
  const old = { ...jk, journal: { '2026-11-25': [{ p: 0, s: '~joker', n: '', m: 0, t: '09:00' }] } };
  assert.equal(C.hasJoker(old.journal, '2026-11-25'), true);
  assert.equal(C.isActiveDay(old, '2026-11-25'), false);
  assert.deepEqual(C.streak(old, '2026-11-26'), { count: 2, includesToday: true });
  // Numéro de semaine (ISO)
  assert.equal(C.weekId('2026-11-25'), '2026-S48');
  assert.equal(C.weekId('2027-01-01'), '2026-S53');
  assert.equal(C.weekId('2027-01-04'), '2027-S01');
  assert.equal(C.weekId('2024-12-30'), '2025-S01');
  // Défi de la semaine : le même toute la semaine, vérifié d'après les données
  const cs = { writingDays: WD, trackedSince: '2026-10-01', activity: { '2026-11-23': 2, '2026-11-24': 1 }, journal: {} };
  const ch = C.weeklyChallenge(cs, '2026-11-25', { dailyGoal: 1, perWeek: 4.2 });
  assert.equal(ch.week, '2026-S48');
  assert.equal(C.weeklyChallenge(cs, '2026-11-27', { dailyGoal: 1, perWeek: 4.2 }).id, ch.id, 'un seul défi par semaine');
  assert.ok(ch.target > 0 && ch.value >= 0 && ch.value <= ch.target && typeof ch.text === 'string');
  const seen = new Set();
  for (let w = 0; w < 12; w++) {
    const c = C.weeklyChallenge(cs, C.addDays('2026-11-25', 7 * w), { dailyGoal: 1, perWeek: 4.2 });
    seen.add(c.id);
    assert.equal(c.done, c.value >= c.target);
  }
  assert.ok(seen.size >= 4, 'les défis tournent : ' + [...seen].join(', '));
  // Chaque défi se vérifie
  const find = (id, state, day, fc = { dailyGoal: 1, perWeek: 4.2 }) => { for (let w = 0; w < 12; w++) { const k = C.addDays(day, 7 * w); const shifted = JSON.parse(JSON.stringify(state)); for (const key of ['activity', 'journal']) { shifted[key] = {}; for (const [d, v] of Object.entries(state[key])) shifted[key][C.addDays(d, 7 * w)] = v; } const c = C.weeklyChallenge(shifted, k, fc); if (c.id === id) return c; } return null; };
  const full = { writingDays: WD, trackedSince: '2026-10-01', journal: { '2026-11-23': [{ p: 2, n: 'Bonne séance' }], '2026-11-24': [{ p: 0, n: 'Relu le plan', k: 'lecture' }] },
    activity: { '2026-11-23': 2, '2026-11-24': 1, '2026-11-25': 1, '2026-11-26': 1, '2026-11-27': 1 } };
  assert.deepEqual([find('seances', full, '2026-11-27').value, find('seances', full, '2026-11-27').target, find('seances', full, '2026-11-27').done], [5, 5, true]);
  assert.deepEqual([find('pages', full, '2026-11-27').target, find('pages', full, '2026-11-27').done], [5, true], '4,2 pages par semaine à tenir : cinq pages');
  assert.equal(find('objectif', full, '2026-11-27').done, true);
  assert.equal(find('suite', full, '2026-11-24').done, false, 'deux jours seulement mardi soir');
  assert.equal(find('suite', full, '2026-11-25').done, true);
  assert.equal(find('journal', full, '2026-11-27').done, true);
  assert.equal(find('record', full, '2026-11-27'), null, 'pas de record à battre sans semaine passée');
  // Semaine entière de terrain : pas de défi
  assert.equal(C.weeklyChallenge({ ...cs, pauses: [{ from: '2026-11-23', to: '2026-11-29', kind: 'terrain' }] }, '2026-11-25', null), null);
}
console.log('core.js : périodes, joker, défi OK');

/* ------------------------------------------------------------
   pages.js — pagination : polices, lignes, pages, PDF
------------------------------------------------------------ */
{
  const P = await import('../pages.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} attendu ${b}, obtenu ${a}`);

  // Chasses : Times, Arial, Courier ; lettre accentuée = lettre nue ; police inconnue = une police voisine
  near(P.textWidth('e'.repeat(100), 'Times New Roman', 12), 532.8, 0.1, 'cent « e » en Times 12');
  near(P.textWidth('éèêë', 'Times New Roman', 10), P.textWidth('eeee', 'Times New Roman', 10), 0.001);
  near(P.textWidth('abc', 'Courier New', 10), 18, 0.001, 'chasse fixe');
  assert.ok(P.textWidth('Bonjour', 'Arial', 11, true) > P.textWidth('Bonjour', 'Arial', 11), 'le gras est plus large');
  near(P.textWidth('Bonjour', 'Helvetica', 11), P.textWidth('Bonjour', 'Arial', 11), 0.001, 'Helvetica = Arial');
  near(P.textWidth('Bonjour', 'Calibri Light', 11), P.textWidth('Bonjour', 'Calibri', 11), 0.5, 'variante ramenée à sa famille');
  assert.ok(P.textWidth('Bonjour', 'Une Police Inconnue', 11) > 20, 'une police inconnue reste mesurable');
  assert.ok(P.textWidth('Bonjour', 'Arial Narrow', 11) < P.textWidth('Bonjour', 'Arial', 11));
  assert.ok(P.fontOf('Verdana').avg > P.fontOf('Times New Roman').avg, 'Verdana chasse plus que Times');

  // Lignes : un paragraphe de Times 12 à interligne 1,5 sur une colonne de 453,5 pt (A4, marges 2,5 cm)
  const SENT = 'La construction des ponts suspendus en France au dix-neuvième siècle s’inscrit dans un mouvement plus large de transformation des techniques et des territoires. ';
  const run = (x, o = {}) => ({ x, f: 'Times New Roman', z: 12, b: 0, ...o });
  const w = 453.5;
  const para = P.breakLines([run(SENT.repeat(4))], w, w, { rule: 0, v: 1.5, markH: 13.8 });
  assert.equal(para.h.length, 8);
  near(para.h[0], 12 * 1.15 * 1.5, 0.01, 'interligne 1,5');
  const total = P.textWidth(SENT.repeat(4).trim(), 'Times New Roman', 12);
  assert.ok(para.h.length >= Math.ceil(total / w) && para.h.length <= Math.ceil(total / w) + 1, 'découpe gloutonne');
  near(P.breakLines([run(SENT)], w, w, { rule: 1, v: 14 }).h[0], 14, 0.001, 'interligne exact');
  near(P.breakLines([run(SENT)], w, w, { rule: 2, v: 30 }).h[0], 30, 0.001, 'interligne « au moins »');
  near(P.breakLines([run(SENT, { z: 20 })], w, w, { rule: 2, v: 12 }).h[0], 23, 0.01, '« au moins » ne rétrécit pas');
  // Paragraphe vide : une ligne, à la hauteur de sa marque
  assert.deepEqual(P.breakLines([], w, w, { rule: 0, v: 1, markH: 13.8 }).h, [13.8]);
  // Retrait de première ligne : moins de place, donc parfois une ligne de plus
  assert.ok(P.breakLines([run(SENT.repeat(4))], w - 200, w, { v: 1 }).h.length >= para.h.length);
  // Retour à la ligne, mot plus long que la ligne
  assert.equal(P.breakLines([run('un'), { k: 'br' }, run('deux')], w, w, { v: 1 }).h.length, 2);
  assert.ok(P.breakLines([run('x'.repeat(400))], w, w, { v: 1 }).h.length >= 4, 'un mot interminable est coupé');
  // Saut de page : avant le paragraphe (Google Docs), en plein milieu, ou seul dans son paragraphe (Word)
  assert.deepEqual(P.breakLines([{ k: 'pb' }, run('Suite')], w, w, { v: 1 }).ev, [[0, 'pb', 0]]);
  const mid = P.breakLines([run('Avant'), { k: 'pb' }, run('Après')], w, w, { v: 1 });
  assert.equal(mid.h.length, 2);
  assert.deepEqual(mid.ev, [[1, 'pb', 0]]);
  const alone = P.breakLines([{ k: 'pb' }], w, w, { v: 1, markH: 13.8 });
  assert.deepEqual([alone.h.length, alone.ev], [1, [[1, 'pb', 0]]], 'la ligne du saut reste sur la page qu\'il termine');
  // Repère de Word : il marque la ligne où tombe le mot suivant, pas celle du mot précédent
  const mk = P.breakLines([run(SENT.repeat(2).trim()), { k: 'mk' }, run(' ' + SENT)], w, w, { v: 1 });
  const at = mk.ev.find(e => e[1] === 'mk')[0];
  assert.ok(at >= 3 && at < mk.h.length, 'repère placé sur une ligne du second passage : ' + at);
  // Appel de note : rattaché à la ligne du mot qu'il suit
  const fn = P.breakLines([run('Un mot'), { k: 'fn', n: 0 }, run(' puis la suite.')], w, w, { v: 1 });
  assert.deepEqual(fn.ev, [[0, 'fn', 0]]);
  // Image dans le texte : Word lui applique l'interligne, Google Docs la pose sur la ligne de base
  const img = [{ k: 'img', w: 200, h: 100, z: 11, f: 'Arial' }];
  near(P.breakLines(img, w, w, { rule: 0, v: 1.5 }).h[0], 151.5, 0.01, 'Word');
  near(P.breakLines(img, w, w, { rule: 0, v: 1.15, imgAdd: true }).h[0], 100 + 11 * 1.15 * 1.15 - 0.82 * 11, 0.01, 'Google Docs');
  // Anciens Google Docs : 1,2 fois le corps, au pixel près, quelle que soit la police
  near(P.breakLines([run('Texte', { f: 'Open Sans', z: 11 })], w, w, { v: 1.15, legacy: true }).h[0], 15, 0.001);
  near(P.breakLines([run('Texte', { f: 'Open Sans', z: 11 })], w, w, { v: 1.15 }).h[0], 11 * 1.364 * 1.15, 0.01, 'depuis 2020 : selon la police');

  // Pagination simulée
  const A4 = { w: 595.3, h: 841.9, mt: 70.9, mb: 70.9, ml: 70.9, mr: 70.9 };
  const p = (text, o = {}) => ({ t: 'p', s: 0, r: text ? [run(text)] : [], sb: 0, sa: 0, lr: 0, lv: 1.5, mf: 'Times New Roman', mz: 12, ...o });
  const lay = (blocks, o = {}) => ({ sections: [A4], blocks, gen: 'other', ...o });
  // Trois titres qui commencent chacun sur une nouvelle page
  let r = P.paginate(lay([p('Un', { hd: 0 }), p(SENT), p('Deux', { hd: 1, pb: 1 }), p(SENT), p('Trois', { hd: 2, pb: 1 }), p(SENT)]), 3);
  assert.equal(r.source, 'layout');
  assert.equal(r.total, 3);
  assert.deepEqual(r.starts.map(v => Math.round(v * 100) / 100), [0, 1, 2]);
  assert.deepEqual(P.spans(r.starts, r.total), { front: 0, pages: [1, 1, 1] });
  // Un long texte : 33 lignes de 20,7 pt par page A4
  const long = Array.from({ length: 60 }, () => p(SENT.repeat(4)));   // 60 paragraphes de 8 lignes
  r = P.paginate(lay(long), 0);
  near(r.total, Math.ceil((60 * 8) / 33), 1, 'pages d\'un texte courant');
  // Le même en Times 12 interligne simple tient en moins de pages ; en double, plus
  const single = P.paginate(lay(long.map(b => ({ ...b, lv: 1 }))), 0).total;
  const double = P.paginate(lay(long.map(b => ({ ...b, lv: 2 }))), 0).total;
  assert.ok(single < r.total && r.total < double, `${single} < ${r.total} < ${double}`);
  // Espace après les paragraphes : compte dans la hauteur
  assert.ok(P.paginate(lay(long.map(b => ({ ...b, sa: 40 }))), 0).total >= r.total + 2);
  // Titre solidaire du paragraphe suivant : en bas de page, il passe à la suivante
  const fill = Array.from({ length: 4 }, () => p(SENT.repeat(4)));        // 32 lignes : il reste une ligne
  r = P.paginate(lay([...fill, p('Titre', { hd: 0, kn: 1 }), p(SENT.repeat(4))]), 1);
  near(r.starts[0], 1, 0.001, 'le titre ne reste pas seul en bas de page');
  r = P.paginate(lay([...fill, p('Titre', { hd: 0 }), p(SENT.repeat(4))]), 1);
  assert.ok(r.starts[0] < 1, 'sans « paragraphes solidaires », il reste en bas de page');
  // Notes de bas de page : elles prennent la place du texte
  const note = [p('Archives départementales de l’Ardèche, rapport de l’ingénieur ordinaire. '.repeat(6), { lv: 1 })];
  const noted = long.map(b => ({ ...b, r: [...b.r, { k: 'fn', n: 0 }], notes: [note] }));
  assert.ok(P.paginate(lay(noted), 0).total > P.paginate(lay(long), 0).total + 3, 'les notes ajoutent des pages');
  // Tableau : la hauteur de ses rangs
  const cell = text => ({ w: 226, pt: 0, pb: 0, pl: 5, pr: 5, blocks: [p(text, { lv: 1 })] });
  const table = { t: 'tbl', s: 0, w: 453, rows: Array.from({ length: 120 }, () => ({ cells: [cell('Une cellule'), cell(SENT)] })) };
  const tp = P.paginate(lay([table]), 0).total;
  assert.ok(tp >= 9 && tp <= 11, 'un tableau de 120 rangs de quatre lignes (55 pt), soit 6 700 pt sur des pages de 700 : ' + tp);
  // Deux colonnes : deux fois plus de lignes par page, mais deux fois plus étroites
  const cols = P.paginate({ sections: [{ ...A4, cols: 2, gap: 36 }], blocks: long, gen: 'other' }, 0).total;
  near(cols, r.total >= 1 ? P.paginate(lay(long), 0).total : 0, 3, 'deux colonnes : à peu près autant de pages');
  // En-tête plus haut que la marge : il réduit la hauteur utile
  const tall = { ...A4, hd: 20, hdr: Array.from({ length: 8 }, () => p('En-tête', { lv: 1 })) };
  assert.ok(P.paginate({ sections: [tall], blocks: long, gen: 'other' }, 0).total > P.paginate(lay(long), 0).total);
  // Section suivante sur une nouvelle page ; section « en continu » : non
  r = P.paginate({ sections: [A4, { ...A4, type: '' }], blocks: [p('Un', { hd: 0 }), p('Deux', { hd: 1, s: 1 })], gen: 'other' }, 2);
  assert.equal(r.total, 2);
  r = P.paginate({ sections: [A4, { ...A4, type: 'continuous' }], blocks: [p('Un', { hd: 0 }), p('Deux', { hd: 1, s: 1 })], gen: 'other' }, 2);
  assert.equal(r.total, 1);

  // Pagination réelle : les repères de Word l'emportent sur la simulation
  const marked = [p('Un', { hd: 0 }), p(SENT), p('Deux', { hd: 1, r: [{ k: 'mk' }, run('Deux')] }), p(SENT),
    p(SENT + SENT, { r: [run(SENT), { k: 'mk' }, run(SENT)] }), p('Trois', { hd: 2 }), p(SENT)];
  r = P.paginate(lay(marked, { gen: 'word', pagesMeta: 3 }), 3);
  assert.equal(r.source, 'word');
  assert.equal(r.total, 3, 'deux repères : trois pages');
  near(r.starts[0], 0, 0.001);
  near(r.starts[1], 1, 0.001, 'le titre qui porte le repère ouvre la page 2');
  assert.ok(r.starts[2] > 2 && r.starts[2] < 3, 'le troisième titre est en cours de page 3');
  // Repères incohérents avec le fichier et avec la simulation : on ne s'y fie pas
  r = P.paginate(lay([p('Un', { hd: 0, r: [{ k: 'mk' }, run('Un')] }), ...long], { gen: 'word', pagesMeta: 15 }), 1);
  assert.equal(r.source, 'meta');
  assert.equal(r.total, 15);
  // Total donné par le fichier (LibreOffice) : la simulation répartit, le fichier fixe le total
  r = P.paginate(lay([p('Un', { hd: 0 }), ...long.slice(0, 30), p('Deux', { hd: 1 }), ...long.slice(30)], { pagesMeta: 17 }), 2);
  assert.equal(r.source, 'meta');
  assert.equal(r.total, 17);
  near(r.starts[1], 8.5, 0.7, 'le second titre est à mi-document');
  // Total invraisemblable (« 1 page » pour un long texte) : ignoré
  assert.equal(P.paginate(lay(long, { pagesMeta: 1 }), 0).source, 'layout');

  // PDF : pages et signets
  const pdfBytes = (broken = false) => {
    const objs = [
      '<< /Type /Catalog /Pages 2 0 R /Outlines 6 0 R >>',
      '<< /Type /Pages /Kids [3 0 R 9 0 R] /Count 3 /MediaBox [0 0 612 792] >>',
      '<< /Type /Page /Parent 2 0 R >>',
      '<< /Type /Page /Parent 9 0 R >>',
      '<< /Type /Page /Parent 9 0 R /MediaBox [0 0 595 842] >>',
      '<< /Type /Outlines /First 7 0 R /Last 8 0 R /Count 2 >>',
      '<< /Title (Chapitre 1 \\(introduction\\)) /Parent 6 0 R /Next 8 0 R /Dest [3 0 R /XYZ 72 700 0] /First 10 0 R /Last 10 0 R >>',
      '<< /Title <FEFF004300680061007000690074007200650020003200A0003A002000E90074006100740020006400650020006C2019006100720074> /Parent 6 0 R /Prev 7 0 R /A << /S /GoTo /D [5 0 R /XYZ 72 400 0] >> >>',
      '<< /Type /Pages /Parent 2 0 R /Kids [4 0 R 5 0 R] /Count 2 >>',
      '<< /Title (1.1 Contexte) /Parent 7 0 R /Dest [4 0 R /XYZ 72 792 0] >>',
    ];
    let s = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${broken ? 999999 : xref}\n%%EOF\n`;
    return Uint8Array.from(s, c => c.charCodeAt(0) & 255);
  };
  for (const broken of [false, true]) {
    const pdf = P.readPdf(pdfBytes(broken));
    assert.equal(pdf.pages, 3, broken ? 'table des objets illisible : on balaie le fichier' : 'trois pages');
    assert.deepEqual(pdf.sizes[2], [595, 842]);
    assert.deepEqual(pdf.outline.map(o => [o.title, o.level, o.page, o.y]), [
      ['Chapitre 1 (introduction)', 1, 0, 92],
      ['1.1 Contexte', 2, 1, 0],
      ['Chapitre 2 : état de l’art', 1, 2, 442],   // les blancs (ici une espace insécable) sont ramenés à une espace
    ]);
  }
  assert.equal(P.readPdf(new Uint8Array([1, 2, 3])), null);
  assert.equal(P.readPdf(Uint8Array.from('<html>pas un PDF</html>'.padEnd(200, ' '), c => c.charCodeAt(0))), null);

  // Rapprochement des titres du document et des signets du PDF, dans l'ordre
  const marks = [{ title: 'Ma thèse' }, { title: 'CHAPITRE 1' }, { title: 'Introduction' }, { title: 'Chapitre 2 : État de l’art' }, { title: 'Introduction' }];
  assert.deepEqual(P.alignTitles(['Chapitre 1 : Introduction', 'chapitre 2 état de l\'art', 'Introduction', 'Absent du PDF'], marks), [1, 3, 4, -1]);

  // Pagination d'après le PDF : positions exactes, titre sans signet placé entre ses voisins
  const pdf = { pages: 10, sizes: [], outline: [{ title: 'Un', page: 0, y: 70.9 }, { title: 'Trois', page: 6, y: 420.9 }] };
  r = P.paginate(lay([p('Un', { hd: 0 }), ...long.slice(0, 20), p('Deux', { hd: 1 }), ...long.slice(20, 40), p('Trois', { hd: 2 }), ...long.slice(40)]), 3, { pdf, titles: ['Un', 'Deux', 'Trois'] });
  assert.equal(r.source, 'pdf');
  assert.equal(r.total, 10);
  near(r.starts[0], 0, 0.001);
  near(r.starts[2], 6.5, 0.01, 'à mi-hauteur de la page 7');
  assert.ok(r.starts[1] > 2 && r.starts[1] < 4.5, 'le titre sans signet est placé au prorata : ' + r.starts[1]);
  const sp = P.spans(r.starts, r.total);
  near(sp.front + sp.pages.reduce((a, b) => a + b, 0), 10, 1e-9, 'la somme des parties est le nombre de pages');

  // Sauts de page enregistrés par LibreOffice : nombre de pages, page de chaque titre, place dans la page
  const A = [{ w: 300, hd: 0 }, { w: 2700 }, { brk: 'soft' }, { w: 1500 }, { w: 100, hd: 1 }, { w: 1400 }, { brk: 'soft' }, { w: 3000 }, { brk: 'hard' }, { w: 60, hd: 2 }, { w: 900 }];
  const br = P.byBreaks(A);
  assert.deepEqual([br.total, br.soft, br.hard], [4, 2, 1]);
  assert.equal(br.starts.get(0), 0);
  near(br.starts.get(1), 1.5, 1e-9, 'au milieu de la page 2');
  near(br.starts.get(2), 3, 1e-9, 'en haut de la page 4');
  assert.deepEqual([br.median, br.last, br.max], [3000, 960, 3000]);
  // Titre sur la dernière page, à moitié pleine : rapporté à une page courante, pas à ce qui s'y trouve
  near(P.byBreaks([{ w: 3000 }, { brk: 'soft' }, { w: 3000 }, { brk: 'soft' }, { w: 600 }, { w: 60, hd: 0 }, { w: 300 }]).starts.get(0), 2.2, 1e-9);
  assert.deepEqual([P.byBreaks([]).total, P.byBreaks([{ w: 10, hd: 0 }]).starts.get(0)], [1, 0]);
}
console.log('pages.js : pagination OK');

// -----------------------------------------------------------
// zip.js : lecture des archives (docx, odt) sans bibliothèque
// -----------------------------------------------------------
{
  const Z = await import('../zip.js');
  const fs = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const fix = n => new URL('./fixtures/' + n, import.meta.url).pathname;
  assert.equal(Z.canInflate(), true);
  for (const [file, entry] of [['these.docx', 'word/document.xml'], ['these-titre-unique.odt', 'content.xml'], ['natif.odt', 'styles.xml']]) {
    const buf = fs.readFileSync(fix(file));
    const zip = Z.openZip(buf);
    assert.ok(zip.has(entry), `${file} contient ${entry}`);
    assert.equal(zip.has('absent.xml'), false);
    assert.equal(await zip.bytes('absent.xml'), null);
    const ref = execFileSync('unzip', ['-p', fix(file), entry], { maxBuffer: 1 << 28 });
    const got = await zip.bytes(entry);
    assert.equal(got.length, ref.length, `${file} : même taille que l'outil unzip`);
    assert.equal(zip.size(entry), ref.length);
    assert.ok(Buffer.from(got).equals(ref), `${file} : mêmes octets que l'outil unzip`);
    assert.equal(await zip.text(entry), ref.toString('utf8').replace(/^﻿/, ''));
    // Toutes les entrées se lisent (compressées ou simplement rangées)
    for (const n of zip.names) assert.equal((await zip.bytes(n)).length, zip.size(n), `${file} : ${n}`);
  }
  // Un ArrayBuffer convient aussi ; un fichier qui n'est pas une archive est refusé proprement
  const ab = fs.readFileSync(fix('these.docx'));
  assert.ok(Z.openZip(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength)).names.length > 3);
  assert.throws(() => Z.openZip(new Uint8Array(10)), e => e.code === 'not-zip');
  assert.throws(() => Z.openZip(new TextEncoder().encode('%PDF-1.7 ' + 'x'.repeat(400))), e => e.code === 'not-zip');
  // Archive tronquée : pas de répertoire central
  assert.throws(() => Z.openZip(ab.subarray(0, ab.length - 200)), e => e.code === 'not-zip');
  // Noms accentués (UTF-8 sans drapeau, comme l'archiveur de macOS) et texte UTF-16
  assert.equal(Z.decodeBytes(new Uint8Array([0xFF, 0xFE, 0xE9, 0x00, 0x74, 0x00, 0xE9, 0x00])), 'été');
  assert.equal(Z.decodeBytes(new Uint8Array([0xEF, 0xBB, 0xBF, 0x61])), 'a');
  assert.equal(Z.decodeBytes(null), null);
}
console.log('zip.js : archives OK');
{
  const Z = await import('../zip.js');
  const fs = await import('node:fs');
  // Projet LaTeX zippé : une entrée au format Zip64, un fichier rangé sans compression, des noms accentués
  const zip = Z.openZip(fs.readFileSync(new URL('./fixtures/projet-latex.zip', import.meta.url)));
  assert.deepEqual(zip.names, ['main.tex', 'chapitres/intro.tex', 'chapitres/methode.tex', 'chapitres/resultats.tex', 'données/été.txt', 'refs.bib', 'figures/pont.png']);
  assert.match(await zip.text('main.tex'), /\\input\{chapitres\/intro\}/);
  assert.equal(await zip.text('données/été.txt'), 'Notes de travail, hors manuscrit.\n');
  assert.equal((await zip.bytes('figures/pont.png')).length, 72);
}
console.log('zip.js : projet zippé OK');

// -----------------------------------------------------------
// outline.js : titres repérés sans styles, niveaux d'après la numérotation
// -----------------------------------------------------------
{
  const O = await import('../outline.js');
  assert.equal(O.titleKey('  Chapitre 2 : État de l’art  '), 'chapitre 2 etat de l art');
  const nb = t => { const x = O.titleNumbering(t); return x.kind + (x.kind === 'num' ? x.depth : ''); };
  assert.deepEqual(['1 Introduction', '2.3.1 Bandes', 'II.3 Les algues', 'I.1.1 Définition', 'A. Preuves', 'IV - Résultats'].map(nb), ['num1', 'num3', 'num2', 'num3', 'num1', 'num1']);
  assert.deepEqual(['Chapitre 3 : Méthode', 'Deuxième partie', 'Conclusion générale', 'Références bibliographiques', 'List of figures', 'Acknowledgements'].map(nb), ['chap', 'part', 'matter', 'matter', 'matter', 'matter']);
  assert.deepEqual(['A Scrooge McDuck Theory', '2025 en chiffres', 'Le fer', '3D printing'].map(nb), ['', '', '', ''], 'un article, une année, un mot ne sont pas des numéros');

  const body = 'Les ingénieurs hésitent longtemps entre le fer et la pierre, et les archives gardent la trace de chacune de leurs hésitations.';
  const P = (text, o = {}) => ({ text, size: 12, ...o });
  // Mise en forme à la main : page de garde, sommaire, « CHAPITRE 1 » puis son intitulé, sections numérotées en gras
  const doc = [
    P('UNIVERSITÉ DE LYON', { size: 16, center: true }), P('Les ponts suspendus', { size: 24, bold: true, center: true }), P('Thèse présentée par Camille Durand', { center: true }),
    P('Sommaire', { size: 16, bold: true }), P('Introduction'), P('Chapitre 1 : Le fer'), P('Chapitre 2 : La pierre'), P('Conclusion'),
    P('Introduction', { size: 16, bold: true }), P(body), P(body),
    P('CHAPITRE 1', { size: 16, bold: true }), P('Le fer', { size: 16, bold: true }), P(body),
    P('1.1 Les forges', { bold: true }), P(body), P('Figure 1 : une forge', { bold: true }), P(body),
    P('1.2 Les ingénieurs', { bold: true }), P(body), P('Une phrase en gras qui se termine par un point.', { bold: true }), P(body),
    P('CHAPITRE 2', { size: 16, bold: true }), P('La pierre', { size: 16, bold: true }), P(body), P('2.1 Les carrières', { bold: true }), P(body),
    P('Conclusion', { size: 16, bold: true }), P(body),
  ];
  const found = lv => doc.map((it, i) => (lv[i] ? `${lv[i]} ${it.text}` : null)).filter(Boolean);
  assert.deepEqual(found(O.guessHeadings(doc)), ['1 Introduction', '1 CHAPITRE 1', '1 Le fer', '2 1.1 Les forges', '2 1.2 Les ingénieurs', '1 CHAPITRE 2', '1 La pierre', '2 2.1 Les carrières', '1 Conclusion'],
    'ni la page de garde, ni le sommaire, ni la légende, ni la phrase en gras');
  // Rien de mis en valeur : on ne devine pas
  assert.deepEqual(O.guessHeadings([P(body), P(body), P('Une ligne courte'), P(body)]).filter(Boolean), []);
  const bare = doc.map(it => ({ text: it.text, size: 12 }));
  assert.deepEqual(O.guessHeadings(bare).map((l, i) => (l ? `${l} ${bare[i].text}` : null)).filter(Boolean), ['1 Introduction', '1 CHAPITRE 1', '1 CHAPITRE 2', '1 Conclusion'],
    'sans gras ni taille, restent les mots qui ne trompent pas : introduction, chapitre, conclusion (mais pas ceux du sommaire)');
  assert.deepEqual(O.guessHeadings([]), []);
  // Un titre du plan déjà saisi est reconnu même sans mise en forme marquée
  const plain = [P('Méthode'), P(body), P('Terrain'), P(body), P('Résultats'), P(body)];
  assert.deepEqual(O.guessHeadings(plain).filter(Boolean), []);
  assert.deepEqual(O.guessHeadings(plain, { planTitles: ['Méthode', 'Terrain', 'Résultats'] }), [1, 0, 1, 0, 1, 0]);
  // Sans gras (PDF) : mêmes tailles pour 2.1 et 2.1.1, la numérotation départage ; « Chapitre N » puis sections « 1. », « 2. »
  const pdfLike = [
    P('Thèse de doctorat', { size: 20 }), P('Résumé', { size: 14 }), P(body),
    P('Chapter 1 Introduction', { size: 18 }), P(body), P('1.1 Energy', { size: 14 }), P(body), P('1.1.1 Sun', { size: 14 }), P(body), P('References', { size: 14 }), P(body),
    P('Chapter 2 Cells', { size: 17.6 }), P(body), P('2.1 Principle', { size: 14 }), P(body), P('General conclusions', { size: 18 }), P(body),
  ];
  const lvPdf = O.guessHeadings(pdfLike);
  assert.deepEqual(pdfLike.map((it, i) => (lvPdf[i] ? `${lvPdf[i]} ${it.text}` : null)).filter(Boolean),
    ['2 Résumé', '1 Chapter 1 Introduction', '2 1.1 Energy', '3 1.1.1 Sun', '2 References', '1 Chapter 2 Cells', '2 2.1 Principle', '1 General conclusions'],
    'la couverture est écartée ; 18 et 17,6 points sont le même palier ; « References » se range avec les sections');
  const restart = [P('Chapitre I Problème', { size: 16 }), P(body), P('1. Contexte', { size: 16 }), P(body), P('2. Enjeux', { size: 16 }), P(body), P('Conclusion', { size: 16 }), P(body),
    P('Chapitre II Étude', { size: 16 }), P(body), P('1. Généralités', { size: 16 }), P(body), P('Conclusion générale', { size: 16 }), P(body)];
  assert.deepEqual(O.guessHeadings(restart).filter(Boolean), [1, 2, 2, 2, 1, 2, 1],
    'la numérotation qui repart à 1 dans chaque chapitre désigne ses sections ; une conclusion entre deux chapitres appartient au premier, la dernière est générale');

  // Styles posés au hasard (« Titre 1 » sur les sous-sections) : la numérotation rétablit la hiérarchie
  const messy = [{ level: 2, title: 'I. Bibliographie' }, { level: 3, title: 'I.1 Les microalgues' }, { level: 1, title: 'I.1.1 Définition' }, { level: 1, title: 'I.1.2 Classification' },
    { level: 4, title: 'Transfert cyclique' }, { level: 3, title: 'I.2 Réactions' }, { level: 2, title: 'II. Matériel et méthodes' }, { level: 3, title: 'II.1 Souche' }];
  assert.deepEqual(O.relevelByNumbering(messy), [1, 2, 3, 3, 4, 2, 1, 2]);
  // Niveaux déjà cohérents : on n'y touche pas
  assert.equal(O.relevelByNumbering([{ level: 1, title: '1 Un' }, { level: 2, title: '1.1 Deux' }, { level: 2, title: '1.2 Trois' }, { level: 1, title: '2 Quatre' }]), null);
  assert.equal(O.relevelByNumbering([{ level: 1, title: 'Un' }, { level: 2, title: 'Deux' }, { level: 1, title: 'Trois' }]), null, 'pas de numérotation : rien à dire');
  // « Partie » au-dessus des chapitres
  assert.deepEqual(O.relevelByNumbering([{ level: 1, title: 'Première partie' }, { level: 1, title: 'Chapitre 1 : Le fer' }, { level: 1, title: '1.1 Les forges' }, { level: 1, title: 'Chapitre 2 : La pierre' }], { force: true }), [1, 2, 3, 2]);
}
console.log('outline.js : titres sans styles OK');

// -----------------------------------------------------------
// pdfdoc.js : du texte d'un PDF au plan (signets, balises, mise en forme, titres du plan)
// -----------------------------------------------------------
{
  const D = await import('../pdfdoc.js');
  const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} (${a} au lieu de ${b})`);
  // Fragments → lignes : appel de note en exposant, blanc entre deux fragments écartés, gras majoritaire
  const L = D.linesFromItems([
    { str: 'Les ponts', x: 70, y: 100, size: 12, w: 50 }, { str: 'suspendus', x: 124, y: 100, size: 12, w: 52 }, { str: '3', x: 176, y: 96, size: 7, w: 4 },
    { str: ' tiennent.', x: 180, y: 100, size: 12, w: 50, eol: true },
    { str: 'Chapitre 2', x: 70, y: 140, size: 18, w: 90, bold: true }, { str: '', x: 0, y: 0, size: 0, w: 0, eol: true },
    { str: 'Texte', x: 70, y: 170, size: 12, w: 30 }, { str: 'en retour', x: 70, y: 185, size: 12, w: 50 },
  ]);
  assert.deepEqual(L.map(l => [l.text, l.size, l.bold]), [['Les ponts suspendus3 tiennent.', 12, false], ['Chapitre 2', 18, true], ['Texte', 12, false], ['en retour', 12, false]]);
  assert.equal(L[0].y, 100, 'la ligne garde la hauteur de son texte, pas celle de l\'appel de note');

  // Un PDF de six pages : en-tête répété, numéros de page, signets
  const SENT = 'Les ingénieurs des Ponts et Chaussées hésitent longtemps entre le fer et la pierre';
  const body = (n, from = 150) => Array.from({ length: n }, (_, i) => ({ x: 70, y: from + i * 20, size: 12, text: SENT }));
  const page = (lines, n) => ({ w: 595, h: 842, lines: [{ x: 200, y: 40, size: 9, text: 'Les ponts suspendus en France' }, ...lines, { x: 290, y: 800, size: 9, text: String(n) }] });
  const head = (text, y = 110, size = 18) => ({ x: 70, y, size, text });
  const pages = [
    page([head('Les ponts suspendus', 300, 24)], 1),
    page([head('Introduction'), ...body(30)], 2),
    page([...body(15, 90), head('Chapitre 1 : Le fer', 410), ...body(15, 440)], 3),
    page([...body(32, 90)], 4),
    page([head('Chapitre 2 : La pierre'), ...body(10), head('2.1 Les carrières', 370, 14), ...body(18, 400)], 5),
    page([head('Conclusion'), ...body(8), { x: 70, y: 400, size: 12, text: 'Une coupure de mot en fin de ligne : sus-' }, { x: 70, y: 420, size: 12, text: 'pendus, et la suite.' }], 6),
  ];
  const clone = o => JSON.parse(JSON.stringify(o));
  const outline = [{ title: 'Introduction', level: 1, page: 1, y: 92 }, { title: 'Chapitre 1 : Le fer', level: 1, page: 2, y: 392 }, { title: 'Chapitre 2 : La pierre', level: 1, page: 4, y: null },
    { title: 'Les carrières', level: 2, page: 4, y: 356 }, { title: 'Conclusion', level: 1, page: 5, y: 92 }];
  let r = D.analyzePdfModel({ pages: clone(pages), outline });
  assert.equal(r.kind, 'pdf');
  assert.equal(r.totalPages, 6);
  assert.equal(r.headingSource, 'outline');
  assert.equal(r.bodySize, 12);
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Introduction'], [1, 'Chapitre 1 : Le fer'], [1, 'Chapitre 2 : La pierre'], [2, 'Les carrières'], [1, 'Conclusion']]);
  const W = 14;   // mots d'une ligne de texte
  assert.deepEqual(r.segments.map(s => s.words), [1 + 45 * W, 4 + 47 * W, 4 + 10 * W, 3 + 18 * W, 1 + 8 * W + 12], 'en-têtes et numéros de page non comptés ; « sus-pendus » recollé');
  assert.equal(r.frontWords, 3, 'la page de titre');
  near(r.frontPages + r.segments.reduce((s, x) => s + x.pages, 0), 6, 1e-9, 'la somme des parties est le nombre de pages');
  near(r.segments[0].pages, 1.4, 0.08, 'du haut de la page 2 au milieu de la page 3');
  near(r.segments[1].pages, 1.6, 0.08);
  assert.ok(r.segments[2].pages > 0.3 && r.segments[2].pages < 0.5, 'le signet sans hauteur est situé par le texte du titre');
  near(r.frontPages, 1, 0.03);

  // Sans signets : titres balisés (niveaux fantaisistes, rétablis par la numérotation), puis mise en forme, puis titres du plan
  const tags = [{ title: 'Introduction', level: 2, page: 1, y: 92 }, { title: 'Chapitre1:Lefer', level: 2, page: 2, y: 392 }, { title: 'Chapitre 2 : La pierre', level: 2, page: 4, y: 92 },
    { title: '2.1Lescarrières', level: 1, page: 4, y: 356 }, { title: 'Conclusion', level: 2, page: 5, y: 92 }];
  r = D.analyzePdfModel({ pages: clone(pages), outline: [], tags });
  assert.equal(r.headingSource, 'tags');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Introduction'], [1, 'Chapitre 1 : Le fer'], [1, 'Chapitre 2 : La pierre'], [2, '2.1 Les carrières'], [1, 'Conclusion']],
    'le titre est repris tel qu\'il est composé (avec ses espaces), la section numérotée repasse sous son chapitre');
  r = D.analyzePdfModel({ pages: clone(pages), outline: [], tags: [] });
  assert.equal(r.headingSource, 'layout');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Introduction'], [1, 'Chapitre 1 : Le fer'], [1, 'Chapitre 2 : La pierre'], [2, '2.1 Les carrières'], [1, 'Conclusion']], 'le grand titre de couverture est écarté');
  const flat = clone(pages).map(pg => ({ ...pg, lines: pg.lines.map(l => ({ ...l, size: l.size > 12 ? 12 : l.size })) }));
  flat[1].lines[1].text = 'Présentation';
  flat[5].lines[1].text = 'Bilan';
  // Aucune mise en valeur : les mots « chapitre » et les titres du plan déjà saisi suffisent à s'y retrouver
  const plan = [{ title: 'Présentation', level: 1 }, { title: 'Chapitre 2 : La pierre', level: 1 }, { title: 'Les carrières', level: 2 }, { title: 'Absent', level: 1 }, { title: 'Bilan', level: 1 }];
  r = D.analyzePdfModel({ pages: clone(flat) }, { planTitles: plan });
  assert.equal(r.headingSource, 'layout');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Présentation'], [1, 'Chapitre 1 : Le fer'], [1, 'Chapitre 2 : La pierre'], [2, '2.1 Les carrières'], [1, 'Bilan']]);
  assert.equal(D.analyzePdfModel({ pages: clone(flat) }).segments.length, 2, 'sans le plan : seulement les deux lignes « Chapitre N »');
  // Titres collés au texte qui les suit (même corps, même interligne) : rien ne les distingue à l'œil,
  // on les retrouve par leur texte, dans l'ordre du plan
  const glued = clone(flat).map(pg => ({ ...pg, lines: pg.lines.map(l => (l.y === 110 ? { ...l, y: 130 } : l.y === 410 ? { ...l, y: 420 } : l.y === 370 ? { ...l, y: 380 } : l)) }));
  glued[2].lines = glued[2].lines.filter(l => l.text !== 'Chapitre 1 : Le fer');
  r = D.analyzePdfModel({ pages: glued }, { planTitles: plan });
  assert.equal(r.headingSource, 'plan');
  assert.deepEqual(r.segments.map(s => [s.level, s.title]), [[1, 'Présentation'], [1, 'Chapitre 2 : La pierre'], [2, 'Les carrières'], [1, 'Bilan']]);
  // Deux lignes de couverture en signets pour trois cents pages : la mise en forme prend le relais
  r = D.analyzePdfModel({ pages: clone(pages), outline: [{ title: 'Couverture', level: 1, page: 0, y: 0 }] });
  assert.equal(r.headingSource, 'layout');
  // « Chapter 2 » en signet, son intitulé juste en dessous : un seul titre, les sections remontent d'un cran
  r = D.analyzePdfModel({ pages: clone(pages), outline: [{ title: 'Introduction', level: 1, page: 1, y: 92 }, { title: 'Chapitre 1 : Le fer', level: 1, page: 2, y: 392 }, { title: 'Chapitre 2', level: 1, page: 4, y: 92 },
    { title: 'La pierre', level: 2, page: 4, y: 93 }, { title: 'Les carrières', level: 3, page: 4, y: 356 }, { title: 'Conclusion', level: 1, page: 5, y: 92 }] });
  assert.deepEqual(r.segments.map(s => [s.level, s.title]).slice(2, 4), [[1, 'Chapitre 2 : La pierre'], [2, 'Les carrières']]);
  // Pages scannées : on connaît le nombre de pages, pas le texte
  r = D.analyzePdfModel({ pages: Array.from({ length: 40 }, () => ({ w: 595, h: 842, lines: [] })) });
  assert.deepEqual([r.totalPages, r.totalWords, r.segments.length, r.scanned, r.frontPages], [40, 0, 0, true, 40]);
  r = D.analyzePdfModel({ pages: [] });
  assert.deepEqual([r.totalPages, r.segments.length], [0, 0]);
}
console.log('pdfdoc.js : PDF OK');

// -----------------------------------------------------------
// links.js : les liens de partage que le navigateur peut lire
// -----------------------------------------------------------
{
  const K = await import('../links.js');
  // Google Docs : lien de la page, lien « partager », identifiant nu
  const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
  for (const l of [`https://docs.google.com/document/d/${ID}/edit?usp=sharing`, `docs.google.com/document/u/0/d/${ID}/edit#heading=h.x`, ID, `Voici le lien : https://docs.google.com/document/d/${ID}/edit.`]) {
    assert.deepEqual(K.parseLink(l), { kind: 'gdoc', id: ID, key: 'g_1abcdefghijklmnopqrstuvwxyz0123456789__abcd' }, l);
  }
  assert.equal(K.gdocKey(ID), 'g_1abcdefghijklmnopqrstuvwxyz0123456789__abcd');
  // Dropbox : le même fichier, servi par l'hôte de téléchargement ; la clé du lien est gardée, le reste écarté
  let r = K.parseLink('https://www.dropbox.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&st=abcd1234&dl=0');
  assert.deepEqual([r.kind, r.url, r.host, r.name], ['file', 'https://dl.dropboxusercontent.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&dl=1', 'Dropbox', 'Ma thèse.docx']);
  assert.match(r.key, /^u_[a-z0-9]+$/);
  const again = K.parseLink('https://www.dropbox.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&st=zzzz9999&dl=1');
  assert.equal(again.key, r.key, 'le même fichier garde la même clé, quel que soit le lien copié');
  assert.equal(K.parseLink(r.url).key, r.key, 'relire l\'adresse enregistrée redonne la même clé');
  r = K.parseLink('https://www.dropbox.com/s/09ctqeg1hd9soi2/these.pdf?dl=0');
  assert.deepEqual([r.url, r.name], ['https://dl.dropboxusercontent.com/s/09ctqeg1hd9soi2/these.pdf?dl=1', 'these.pdf']);
  // GitHub : l'adresse « raw » du fichier
  r = K.parseLink('https://github.com/camille/these/blob/main/chapitres/intro.tex');
  assert.deepEqual([r.kind, r.url, r.host, r.name], ['file', 'https://raw.githubusercontent.com/camille/these/main/chapitres/intro.tex', 'GitHub', 'intro.tex']);
  // Un lien direct quelconque
  r = K.parseLink('https://exemple.fr/docs/memoire.odt#page=2');
  assert.deepEqual([r.kind, r.url, r.name], ['file', 'https://exemple.fr/docs/memoire.odt', 'memoire.odt']);
  // Ce qui ne peut pas être lu depuis un navigateur est reconnu, pour l'expliquer
  const err = l => K.parseLink(l).error;
  assert.equal(err('https://www.dropbox.com/scl/fo/6y7hlsyisit2rb0bjepzh/AKOfmeyr?rlkey=x&dl=0'), 'link-folder');
  assert.equal(err('https://www.dropbox.com/sh/gw3itlpyonzkbau/AAA1-8vaAN?dl=0'), 'link-folder');
  assert.equal(err('https://www.dropbox.com/home/These'), 'link-dropbox');
  assert.equal(err('https://1drv.ms/w/s!AbCdEf'), 'link-onedrive');
  assert.equal(err('https://univ-my.sharepoint.com/:w:/g/personal/x/EabC'), 'link-onedrive');
  assert.equal(err('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing'), 'link-drive');
  assert.equal(err('https://drive.google.com/drive/folders/1AbCdEf'), 'link-folder');
  assert.equal(err('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit'), 'link-gother');
  assert.equal(err('https://www.overleaf.com/read/abcdefgh'), 'link-overleaf');
  assert.equal(err('http://exemple.fr/these.docx'), 'link-http');
  assert.equal(err('ceci n\'est pas un lien'), 'link-bad');
  assert.equal(err(''), 'link-bad');
  assert.equal(err('javascript:alert(1)'), 'link-bad');
  // Nom du fichier donné par le serveur
  assert.equal(K.dispositionName('attachment; filename="these.docx"; filename*=UTF-8\'\'Ma%20th%C3%A8se.docx'), 'Ma thèse.docx');
  assert.equal(K.dispositionName('attachment; filename=these.pdf'), 'these.pdf');
  assert.equal(K.dispositionName(null), '');
  assert.equal(K.shortHash('abc'), K.shortHash('abc'));
  assert.notEqual(K.shortHash('abc'), K.shortHash('abd'));
}
console.log('links.js : liens de partage OK');

// -----------------------------------------------------------
// formats.js : RTF, Typst, Org, AsciiDoc, reStructuredText, projets en plusieurs fichiers ; Markdown enrichi
// -----------------------------------------------------------
{
  const F = await import('../formats.js');
  const O = await import('../outline.js');
  const plan = r => r.segments.map(s => `${s.level} ${s.title}`);
  // Typst : titres « = », réglages (#set, #let, #show) et commentaires ignorés
  let r = F.parseTypst(`#set page(paper: "a4")
#let note(body) = {
  text(size: 9pt)[#body]
}
#show: doc => conf(
  title: [Ma thèse],
  doc,
)
/* un commentaire
   sur deux lignes */
= Introduction générale <intro>
Les ponts suspendus apparaissent en France. // remarque
Voir @navier et $x^2$ pour #emph[le détail].
== Contexte
Un paragraphe *important* de six mots.
\`\`\`python
print("ce code ne compte pas")
\`\`\`
= Conclusion
Fin.`);
  assert.deepEqual(plan(r), ['1 Introduction générale', '2 Contexte', '1 Conclusion']);
  assert.equal(r.frontWords, 0, 'le préambule n\'est pas du texte');
  assert.deepEqual(r.segments.map(s => s.words), [2 + 6 + 5, 1 + 6, 1 + 1]);
  // Org : tiroirs, blocs de code, mots-clés TODO et étiquettes
  r = F.parseOrg(`#+title: Ma thèse
* TODO Introduction générale :brouillon:
:PROPERTIES:
:CUSTOM_ID: intro
:END:
Les ponts [[https://exemple.fr][suspendus]] apparaissent[fn:1].
#+begin_src python
print("non compté")
#+end_src
** Contexte
Trois mots ici.
* Conclusion
[fn:1] Une note de quatre mots.`);
  assert.deepEqual(plan(r), ['1 Introduction générale', '2 Contexte', '1 Conclusion']);
  assert.deepEqual(r.segments.map(s => s.words), [2 + 4, 1 + 3, 1 + 5]);
  // AsciiDoc : titre du document, sections, blocs de code, attributs, notes
  r = F.parseAsciidoc(`= Ma thèse
:toc:

== Introduction générale

Les ponts suspendusfootnote:[Voir Navier.] apparaissent.

[source,python]
----
print("non compté")
----

=== Contexte

Trois mots ici.`);
  assert.deepEqual(plan(r), ['1 Ma thèse', '2 Introduction générale', '3 Contexte']);
  assert.deepEqual(r.segments.map(s => s.words), [2, 2 + 6, 1 + 3]);
  // reStructuredText : le rang d'un soulignement est son ordre d'apparition
  r = F.parseRst(`=========
Ma thèse
=========

Introduction
============

Les ponts suspendus apparaissent [1]_.

.. code-block:: python

   print("non compté")

Contexte
--------

Trois mots ici.

Conclusion
==========

Fin.`);
  assert.deepEqual(plan(r), ['1 Ma thèse', '2 Introduction', '3 Contexte', '2 Conclusion']);
  assert.deepEqual(r.segments.map(s => s.words), [2, 1 + 4, 1 + 3, 1 + 1]);

  // Markdown : en-tête YAML, titres soulignés, blocs Quarto, commentaires, identifiants de titre
  r = O.parseTextDocument(`---
title: "Ma thèse"
author: Camille
---

Introduction générale
=====================

Les ponts suspendus apparaissent.

<!-- à revoir
plus tard -->

Contexte {#sec-contexte}
--------

::: {.callout-note}
Trois mots ici.
:::

\`\`\`{r}
summary(cars)
\`\`\`

# Conclusion {.unnumbered}

Fin.
`);
  assert.equal(r.kind, 'markdown');
  assert.deepEqual(plan(r), ['1 Introduction générale', '2 Contexte', '1 Conclusion']);
  assert.equal(r.frontWords, 0, 'l\'en-tête YAML n\'est pas du texte');
  assert.deepEqual(r.segments.map(s => s.words), [2 + 4, 1 + 3, 1 + 1]);
  // Une ligne de tirets après une liste ou un tableau n'est pas un titre
  r = O.parseTextDocument('# Un\n\n- élément\n---\n\nTexte\n\n| a | b |\n|---|---|\n');
  assert.deepEqual(plan(r), ['1 Un']);

  // RTF : styles de titre, niveaux de plan, caractères accentués, notes, tableaux, nombre de pages
  const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Times New Roman;}}
{\stylesheet{\s0 Normal;}{\s1\b\fs32 heading 1;}{\s2\b\fs28 Titre 2;}}
{\info{\title Ma th\'e8se}{\nofpages12}{\nofwords3400}}
{\header\pard Ent\'eate \par}
\pard\qc\b\fs44 Ma th\'e8se\b0\par
\pard\s1\b\fs32 Introduction g\u233 ?n\u233 ?rale\par
\pard\plain\fs24 Les ponts suspendus\~apparaissent{\super\chftn}{\footnote\pard Voir Navier, 1823.\par} en France \'e0 l\rquote \'e9poque.\par
\pard\s2\b\fs28 Contexte\par
\pard\plain Trois mots ici.\par
\trowd\pard\intbl Ouvrage\cell Ann\'e9e\cell\row
\pard\outlinelevel0\b Conclusion\par
\pard\plain Fin.{\pict\pngblip 89504e470d0a}\par}`;
  const R = F.parseRtf(rtf);
  assert.equal(R.pagesMeta, 12);
  assert.deepEqual(R.paras.map(p => [p.text, p.style, p.outline, p.words, p.notes]), [
    ['Ma thèse', 'normal', 0, 2, 0],
    ['Introduction générale', 'heading 1', 0, 2, 0],
    ['Les ponts suspendus apparaissent en France à l’époque.', 'normal', 0, 8, 3],
    ['Contexte', 'titre 2', 0, 1, 0],
    ['Trois mots ici.', 'normal', 0, 3, 0],
    ['Ouvrage Année', 'normal', 0, 2, 0],
    ['Conclusion', 'normal', 1, 1, 0],
    ['Fin.', 'normal', 0, 1, 0],
  ], 'en-tête de page, image et tables de polices ignorés ; note comptée à part');
  assert.deepEqual([R.paras[0].center, R.paras[0].bold, R.paras[0].size, R.paras[5].table, R.paras[2].bold, R.paras[2].size], [true, true, 22, true, false, 12]);
  assert.deepEqual(F.parseRtf('').paras, []);
  assert.deepEqual(F.parseRtf('{\\rtf1 Bonjour').paras.map(p => p.text), ['Bonjour'], 'fichier tronqué : on garde ce qui est lisible');

  // Projet LaTeX : fichier principal et chapitres (\input, \include, \subfile, \import)
  const files = new Map([
    ['main.tex', '\\documentclass{book}\n% \\input{brouillon}\n\\begin{document}\n\\input{chapitres/intro}\n\\include{chapitres/methode}\n\\subfile{chapitres/resultats.tex}\n\\import{annexes/}{a}\n\\input{absent}\n\\end{document}'],
    ['chapitres/intro.tex', '\\chapter{Introduction}\nUn deux trois.\n\\input{chapitres/detail}'],
    ['chapitres/detail.tex', '\\section{Détail}\nQuatre cinq.'],
    ['chapitres/methode.tex', '\\chapter{Méthode}\nSix sept huit neuf.'],
    ['chapitres/resultats.tex', '\\documentclass[../main.tex]{subfiles}\n\\begin{document}\n\\chapter{Résultats}\nDix.\n\\end{document}'],
    ['annexes/a.tex', '\\chapter{Annexe}\nOnze douze.'],
    ['brouillon.tex', '\\chapter{Brouillon}\nNe doit pas apparaître.'],
    ['notes/autre.tex', '\\documentclass{article}\n\\begin{document}\nUn autre document.\n\\end{document}'],
  ]);
  assert.equal(F.texMain(files), 'main.tex', 'le fichier principal : à la racine, pas un sous-fichier');
  const whole = F.resolveTex('main.tex', files);
  r = O.parseTextDocument(whole);
  assert.equal(r.kind, 'latex');
  assert.deepEqual(plan(r), ['2 Introduction', '3 Détail', '2 Méthode', '2 Résultats', '2 Annexe'], 'les fichiers sont assemblés dans l\'ordre, l\'appel en commentaire est ignoré');
  assert.deepEqual(r.segments.map(s => s.words), [1 + 3, 1 + 2, 1 + 4, 1 + 1, 1 + 2]);
  // Les mêmes fichiers déposés en vrac, sans leurs dossiers : retrouvés par leur nom
  const flat = new Map([...files].map(([k, v]) => [k.split('/').pop(), v]));
  assert.deepEqual(plan(O.parseTextDocument(F.resolveTex('main.tex', flat))), ['2 Introduction', '3 Détail', '2 Méthode', '2 Résultats', '2 Annexe']);
  // Un fichier qui s'inclut lui-même ne fait pas tourner en rond
  assert.ok(F.resolveTex('a.tex', new Map([['a.tex', 'x \\input{b}'], ['b.tex', 'y \\input{a}']])).includes('y'));
  assert.equal(F.texMain(new Map([['notes.md', '# x']])), '');
  // Projet Typst
  assert.match(F.resolveTypst('main.typ', new Map([['main.typ', '#include "chap/un.typ"\n= Fin'], ['chap/un.typ', '= Un\nTexte.']])), /= Un\nTexte\.[\s\S]*= Fin/);
}
console.log('formats.js : autres formats OK');

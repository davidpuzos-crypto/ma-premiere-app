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

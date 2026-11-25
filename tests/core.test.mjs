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

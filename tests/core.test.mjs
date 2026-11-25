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
assert.equal(p1.basis, 'average'); // moins de 14 jours de suivi
assert.ok(Math.abs(p1.average - 100 / 329) < 1e-9);
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

// Tests des règles de sécurité (firestore.rules) sur l'émulateur local de Firestore.
// Projet de démonstration : aucune donnée réelle, rien n'est envoyé à Firebase.
//
//   cd tests && npm install && npm run rules
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit, updateDoc, setLogLevel } from 'firebase/firestore';
setLogLevel('silent');

const RULES = process.env.RULES || fileURLToPath(new URL('../firestore.rules', import.meta.url));
const env = await initializeTestEnvironment({
  projectId: 'demo-jdb',
  firestore: { rules: fs.readFileSync(RULES, 'utf8'), host: '127.0.0.1', port: Number(process.env.FIRESTORE_PORT || 8089) },
});
const alice = env.authenticatedContext('alice').firestore();
const bob = env.authenticatedContext('bob').firestore();
const anon = env.unauthenticatedContext().firestore();

let n = 0;
const ok = async (label, p) => { await assertSucceeds(p); n++; console.log('  autorisé  ·', label); };
const no = async (label, p) => { await assertFails(p); n++; console.log('  refusé    ·', label); };

const profile = (over = {}) => ({
  v: 1, name: 'Plan B', field: 'Histoire', year: 3, pct: 41, week: '2026-S48', weekPages: 8.5, streak: 3,
  heat: { '2026-11-24': 2, '2026-11-25': 1.5 }, notes: [{ d: '2026-11-25', t: 'Une page, mais une vraie.', p: 1 }],
  joinedAt: '2026-11-01T10:00:00.000Z', updatedAt: '2026-11-25T10:00:00.000Z', ...over,
});

console.log('\nJournal privé');
await ok('je lis et j\'écris mon journal', setDoc(doc(alice, 'users/alice/thesis/main'), { chapters: [], documentTitle: 'Secret' }));
await ok('mise à jour partielle (merge) de mon journal', setDoc(doc(alice, 'users/alice/thesis/main'), { activity: { '2026-11-25': 1 } }, { merge: true }));
await ok('je relis mon journal', getDoc(doc(alice, 'users/alice/thesis/main')));
await no('quelqu\'un d\'autre ne lit pas mon journal', getDoc(doc(bob, 'users/alice/thesis/main')));
await no('quelqu\'un d\'autre n\'écrit pas dans mon journal', setDoc(doc(bob, 'users/alice/thesis/main'), { x: 1 }, { merge: true }));
await no('sans compte : journal illisible', getDoc(doc(anon, 'users/alice/thesis/main')));
await no('sans compte : liste des journaux illisible', getDocs(collection(anon, 'users')));
await no('connecté : pas de liste des comptes', getDocs(collection(bob, 'users')));

console.log('\nFiches de la promo');
await ok('je crée ma fiche', setDoc(doc(alice, 'profiles/alice'), profile()));
await ok('je mets ma fiche à jour', setDoc(doc(alice, 'profiles/alice'), profile({ pct: 42, weekPages: 9.5 })));
await ok('fiche minimale (sans discipline ni année)', setDoc(doc(bob, 'profiles/bob'), (() => { const p = profile({ name: 'Et al.', notes: [], heat: {} }); delete p.field; delete p.year; delete p.joinedAt; delete p.v; return p; })()));
await ok('une fiche se lit sans compte, par son lien', getDoc(doc(anon, 'profiles/alice')));
await ok('une fiche inexistante se demande sans erreur (sert à savoir si la promo est ouverte)', getDoc(doc(alice, 'profiles/personne')));
await no('sans compte : pas de liste des fiches', getDocs(collection(anon, 'profiles')));
await ok('connecté : liste des fiches, triée et limitée', getDocs(query(collection(bob, 'profiles'), orderBy('updatedAt', 'desc'), limit(100))));
await no('je ne crée pas la fiche de quelqu\'un d\'autre', setDoc(doc(bob, 'profiles/carol'), profile()));
await no('je ne modifie pas la fiche de quelqu\'un d\'autre', setDoc(doc(bob, 'profiles/alice'), profile({ name: 'Piraté' })));
await no('je ne supprime pas la fiche de quelqu\'un d\'autre', deleteDoc(doc(bob, 'profiles/alice')));
await no('sans compte : pas de création de fiche', setDoc(doc(anon, 'profiles/zed'), profile()));
await no('champ non prévu (titre de thèse, email…)', setDoc(doc(alice, 'profiles/alice'), profile({ title: 'Ma thèse', email: 'a@b.fr' })));
await no('pseudonyme trop court', setDoc(doc(alice, 'profiles/alice'), profile({ name: 'A' })));
await no('pseudonyme trop long', setDoc(doc(alice, 'profiles/alice'), profile({ name: 'x'.repeat(31) })));
await no('pseudonyme qui n\'est pas du texte', setDoc(doc(alice, 'profiles/alice'), profile({ name: 12345 })));
await no('pourcentage impossible', setDoc(doc(alice, 'profiles/alice'), profile({ pct: 250 })));
await no('pages de la semaine négatives', setDoc(doc(alice, 'profiles/alice'), profile({ weekPages: -1 })));
await no('pages de la semaine invraisemblables', setDoc(doc(alice, 'profiles/alice'), profile({ weekPages: 5000 })));
await no('discipline trop longue', setDoc(doc(alice, 'profiles/alice'), profile({ field: 'x'.repeat(31) })));
await no('note trop longue', setDoc(doc(alice, 'profiles/alice'), profile({ notes: [{ d: '2026-11-25', t: 'x'.repeat(241), p: 0 }] })));
await no('note avec un champ en trop', setDoc(doc(alice, 'profiles/alice'), profile({ notes: [{ d: '2026-11-25', t: 'ok', p: 0, html: '<b>' }] })));
await no('plus de 8 notes', setDoc(doc(alice, 'profiles/alice'), profile({ notes: Array.from({ length: 9 }, () => ({ d: '2026-11-25', t: 'ok', p: 0 })) })));
await ok('8 notes exactement', setDoc(doc(alice, 'profiles/alice'), profile({ notes: Array.from({ length: 8 }, (_, i) => ({ d: '2026-11-25', t: 'note ' + i, p: i })) })));
await no('calendrier démesuré', setDoc(doc(alice, 'profiles/alice'), profile({ heat: Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['k' + i, 1])) })));
await ok('calendrier de 84 jours', setDoc(doc(alice, 'profiles/alice'), profile({ heat: Object.fromEntries(Array.from({ length: 84 }, (_, i) => ['2026-09-' + i, 1])) })));
await no('champ obligatoire manquant', setDoc(doc(alice, 'profiles/alice'), (() => { const p = profile(); delete p.updatedAt; return p; })()));
await no('mise à jour partielle qui casserait la fiche', updateDoc(doc(alice, 'profiles/alice'), { name: '' }));

console.log('\nEncouragements');
const cheer = { w: '2026-S48', at: '2026-11-25T10:00:00.000Z', name: 'Et al.' };
await ok('j\'encourage quelqu\'un', setDoc(doc(bob, 'profiles/alice/cheers/bob'), cheer));
await ok('je renouvelle mon encouragement la semaine suivante', setDoc(doc(bob, 'profiles/alice/cheers/bob'), { ...cheer, w: '2026-S49' }));
await no('je ne m\'encourage pas moi-même', setDoc(doc(alice, 'profiles/alice/cheers/alice'), cheer));
await no('je n\'encourage pas au nom de quelqu\'un d\'autre', setDoc(doc(bob, 'profiles/alice/cheers/carol'), cheer));
await no('encouragement avec un champ en trop', setDoc(doc(bob, 'profiles/alice/cheers/bob'), { ...cheer, message: 'spam' }));
await no('sans compte : pas d\'encouragement', setDoc(doc(anon, 'profiles/alice/cheers/zed'), cheer));
await ok('connecté : je vois les encouragements d\'une fiche', getDocs(collection(alice, 'profiles/alice/cheers')));
await no('sans compte : encouragements illisibles', getDocs(collection(anon, 'profiles/alice/cheers')));
await ok('la personne encouragée peut effacer un encouragement reçu', deleteDoc(doc(alice, 'profiles/alice/cheers/bob')));
await ok('je réencourage', setDoc(doc(bob, 'profiles/alice/cheers/bob'), cheer));
await ok('je retire mon encouragement', deleteDoc(doc(bob, 'profiles/alice/cheers/bob')));

console.log('\nSignalements');
const report = { by: 'bob', target: 'alice', name: 'Plan B', text: 'message déplacé', at: '2026-11-25T10:00:00.000Z' };
await ok('je signale un message', setDoc(doc(bob, 'reports/bob_alice_1'), report));
await no('je ne signale pas au nom de quelqu\'un d\'autre', setDoc(doc(bob, 'reports/bob_alice_2'), { ...report, by: 'alice' }));
await no('signalement démesuré', setDoc(doc(bob, 'reports/bob_alice_3'), { ...report, text: 'x'.repeat(301) }));
await no('sans compte : pas de signalement', setDoc(doc(anon, 'reports/x'), { ...report, by: 'x' }));
await no('personne ne lit les signalements depuis l\'application', getDoc(doc(bob, 'reports/bob_alice_1')));
await no('personne ne liste les signalements', getDocs(collection(alice, 'reports')));
await no('un signalement ne se modifie pas', setDoc(doc(bob, 'reports/bob_alice_1'), { ...report, text: 'autre' }));
await no('un signalement ne se supprime pas', deleteDoc(doc(bob, 'reports/bob_alice_1')));

console.log('\nExclusion (modération)');
await env.withSecurityRulesDisabled(async ctx => { const admin = ctx.firestore(); await setDoc(doc(admin, 'banned/bob'), { reason: 'test' }); await deleteDoc(doc(admin, 'profiles/bob')); });
await no('une personne exclue ne recrée pas sa fiche', setDoc(doc(bob, 'profiles/bob'), profile({ name: 'Et al.' })));
await ok('une personne exclue garde son journal privé', setDoc(doc(bob, 'users/bob/thesis/main'), { chapters: [] }));
await no('la liste d\'exclusion est illisible', getDoc(doc(bob, 'banned/bob')));
await no('la liste d\'exclusion n\'est pas modifiable', deleteDoc(doc(bob, 'banned/bob')));
await ok('les autres ne sont pas concernés', setDoc(doc(alice, 'profiles/alice'), profile()));

console.log('\nTout le reste est fermé');
await no('collection inconnue : lecture', getDoc(doc(alice, 'autre/chose')));
await no('collection inconnue : écriture', setDoc(doc(alice, 'autre/chose'), { a: 1 }));
await no('sous-collection inconnue d\'une fiche', setDoc(doc(alice, 'profiles/alice/secrets/x'), { a: 1 }));

console.log('\nQuitter la promo');
await ok('je supprime ma fiche', deleteDoc(doc(alice, 'profiles/alice')));
assert.equal((await getDoc(doc(anon, 'profiles/alice'))).exists(), false);

// Si les tests de bout en bout ont tourné avant (node tests/e2e.cjs), on rejoue ici, face aux vraies
// règles, les écritures que l'application a réellement faites dans la promo.
const WRITES = fileURLToPath(new URL('./.tmp/promo-writes.json', import.meta.url));
if (fs.existsSync(WRITES)) {
  console.log('\nÉcritures réelles de l\'application (relevées par tests/e2e.cjs)');
  const app = env.authenticatedContext('u_promo').firestore();
  for (const w of JSON.parse(fs.readFileSync(WRITES, 'utf8'))) {
    await ok((w.deleted ? 'suppression ' : 'écriture ') + w.path, w.deleted ? deleteDoc(doc(app, w.path)) : setDoc(doc(app, w.path), w.data, w.merge ? { merge: true } : undefined));
  }
}

await env.cleanup();
console.log(`\n${n} vérifications : les règles se comportent comme prévu.`);

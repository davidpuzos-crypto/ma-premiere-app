// Tests de bout en bout du Journal de Bord, dans un vrai navigateur (Chromium, via Playwright).
// Firebase est remplacé par des bouchons (tests/stubs) : aucun compte créé, aucune donnée réelle touchée.
//
//   node tests/e2e.cjs                      toute la suite (un petit serveur local est lancé tout seul)
//   ONLY="Promo ouverte" node tests/e2e.cjs  un seul scénario (extrait du titre)
//   BASE=http://localhost:8123/ node tests/e2e.cjs   contre un serveur déjà lancé
const fs = require('fs');
const path = require('path');
const http = require('http');
const assert = require('assert/strict');

/** Playwright installé dans le projet, ou à défaut celui de la machine (npm root -g). */
function loadPlaywright() {
  try { return require('playwright'); } catch { /* pas installé ici */ }
  const root = require('child_process').execSync('npm root -g').toString().trim();
  return require(path.join(root, 'playwright'));
}
const { chromium } = loadPlaywright();

let BASE = process.env.BASE || '';
const DIR = __dirname;
const TMP = path.join(DIR, '.tmp');
const SHOTS = path.join(TMP, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

/** Sert le dossier du site sur un port libre, le temps des tests. */
function startServer() {
  const ROOT = path.join(DIR, '..');
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(path.join(ROOT, decodeURIComponent(u.pathname)));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (u.pathname.endsWith('/')) p = path.join(p, 'index.html');
    fs.readFile(p, (err, data) => {
      if (err) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, { 'Content-Type': types[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => { server.unref(); resolve(`http://localhost:${server.address().port}/`); }));
}
const STUB = n => fs.readFileSync(path.join(DIR, 'stubs', n), 'utf8');
const FIX = n => path.join(DIR, 'fixtures', n);
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(k, n) { const [y, m, d] = k.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); }
const TODAY = dayKey();
const ONLY = process.env.ONLY || '';

let failures = 0;
const results = [];
async function test(name, fn) {
  if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
  const t0 = Date.now();
  try { await fn(); results.push(`✅ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { failures++; results.push(`❌ ${name}\n   ${e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n   ') : e}`); }
}

async function newPage(browser, { viewport = { width: 1280, height: 900 }, user = null, store = null, config = null, seenNews = true } = {}) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block', acceptDownloads: true, locale: 'fr-FR', timezoneId: 'Europe/Paris' });
  for (const n of ['app', 'auth', 'firestore']) {
    await ctx.route(`https://www.gstatic.com/firebasejs/10.8.1/firebase-${n}.js`, r => r.fulfill({ contentType: 'application/javascript', body: STUB(`firebase-${n}.js`) }));
  }
  await ctx.addInitScript(({ user, store, config, seenNews }) => {
    if (config) window.__fbConfig = config;
    if (sessionStorage.getItem('__init')) return;   // une seule fois par onglet (rechargements conservés)
    sessionStorage.setItem('__init', '1');
    localStorage.clear();
    if (user) localStorage.setItem('__fbuser', JSON.stringify(user));
    if (store) localStorage.setItem('__fbstore', JSON.stringify(store));
    if (seenNews) localStorage.setItem('jdb_whatsnew', '3');
  }, { user, store, config, seenNews });
  const page = await ctx.newPage();
  page._errors = [];
  page.on('pageerror', e => page._errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) page._errors.push('console: ' + m.text()); });
  page._dialogs = [];
  page.on('dialog', d => { page._dialogs.push(d.message()); if (d.type() === 'prompt') d.accept(page._promptAnswer || ''); else d.accept(); });
  page._requests = [];
  page.on('request', r => page._requests.push(r.url()));
  return { ctx, page };
}

const docOf = (page, uid) => page.evaluate(u => window.__fbStore.get(`users/${u}/thesis/main`), uid);
const flush = page => page.waitForTimeout(1150); // temporisation de sauvegarde (900 ms)
// Les messages utilisent des espaces insécables (« : », « ? ») : on les ramène à des espaces ordinaires pour comparer
const toasts = page => page.$$eval('.toast', els => els.map(e => e.textContent.replace(/\u00A0/g, ' ')));
const written = d => d.chapters.reduce((s, c) => s + (c.subsections.length ? c.subsections.reduce((a, x) => a + x.writtenPages, 0) : c.writtenPages), 0);
const target = d => d.chapters.reduce((s, c) => s + (c.subsections.length ? c.subsections.reduce((a, x) => a + x.targetPages, 0) : c.targetPages), 0);
const sendDocx = (page, fixture, name) => page.setInputFiles('#docxInput', { name: name || fixture, mimeType: DOCX, buffer: fs.readFileSync(FIX(fixture)) });

const V1_DOC = {
  chapters: [
    { id: 'c1', title: 'Introduction Générale', expanded: false, targetPages: 15, writtenPages: 6, subsections: [] },
    { id: 'c2', title: 'Revue de la littérature', expanded: true, subsections: [
      { id: 's1', title: '2.1 Contexte', targetPages: 20, writtenPages: 20 },
      { id: 's2', title: '2.2 Débats', targetPages: 30, writtenPages: 12 },
    ] },
    { id: 'c3', title: 'Méthodologie', expanded: true, targetPages: 40, writtenPages: 0, subsections: [] },
    { id: 'c4', title: 'Conclusion Générale', expanded: false, targetPages: 10, writtenPages: 0, subsections: [] },
  ],
  startDate: '2026-03-03',
  milestones: { 25: true, 50: false, 75: false, 100: false },
  documentTitle: 'Thèse sur les ponts',
  updatedAt: '2026-10-01T10:00:00.000Z',
};
const clone = o => JSON.parse(JSON.stringify(o));

(async () => {
  if (!BASE) BASE = await startServer();
  const browser = await chromium.launch();

  /* ------------------------------------------------------------ */
  await test('Nouvel inscrit : aucune fenêtre, modèle en un clic, mise à jour initiale, +1 page, dépôt', async () => {
    const { ctx, page } = await newPage(browser, { seenNews: false });
    await page.goto(BASE);
    await page.waitForSelector('#authScreen:not(.hidden)');
    await page.fill('#authEmail', 'nouvelle@example.com');
    await page.fill('#authPassword', 'secret123');
    await page.fill('#authPasswordConfirm', 'secret123');
    await page.click('#authSubmitBtn');
    await page.waitForSelector('.onboarding');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('.modal-overlay:not(.hidden)').count(), 0, 'aucune fenêtre imposée à l\'arrivée');
    assert.equal(await page.isVisible('.dashboard-banner'), false, 'pas de tableau de bord vide');
    await page.screenshot({ path: path.join(SHOTS, '21-01-demarrage.png') });
    const uid = 'u_nouvelleexamplecom';

    // Modèle : un clic, pas de confirmation
    await page.click('.ob-choices >> text=Thèse SHS');
    await page.waitForSelector('.chapter-card');
    assert.equal(page._dialogs.length, 0, 'pas de confirmation sur un plan vide');
    assert.equal(await page.locator('.chapter-card').count(), 7);
    assert.ok(await page.isVisible('.dashboard-banner'));
    assert.equal(await page.textContent('#sTotal'), '300');
    assert.ok(await page.isVisible('#setupBanner'), 'bandeau de mise à jour initiale');

    // Pages déjà écrites : saisies le premier jour, elles ne comptent pas pour aujourd'hui
    const firstCh = (await docOf(page, uid)).chapters;
    const [c1, c2, c3] = firstCh.map(c => c.id);
    await page.fill(`#win-${c2}`, '40');
    await page.click(`#ch-${c3} .pg-btn.plus`);
    await page.click(`#ch-${c3} .pg-btn.plus`);
    await flush(page);
    let d = await docOf(page, uid);
    assert.equal(written(d), 42);
    assert.ok(!d.activity || !d.activity[TODAY], 'mise à jour initiale non comptée : ' + JSON.stringify(d.activity));
    assert.equal(await page.textContent('#sEndDate'), '—', 'pas de date de fin fantaisiste');
    assert.match(await page.textContent('#tdVal'), /^0 \//);
    await page.click('#setupBanner >> text=C\'est à jour');
    assert.equal(await page.isVisible('#setupBanner'), false);
    assert.equal(await page.locator('.toast[data-undo]').count(), 0, 'l\'annulation du modèle disparaît dès qu\'on a modifié autre chose');

    // « +1 page » : la partie en cours est la dernière touchée
    assert.match(await page.textContent('#tdCap'), /Cadre théorique/);
    await page.click('#tdPrimary');
    await page.click('#tdPrimary');
    assert.equal(await page.inputValue(`#win-${c3}`), '4');
    assert.match((await toasts(page)).join('|'), /\+1 page · Cadre théorique.*aujourd'hui : 2 p\./);
    assert.match(await page.textContent('#tdVal'), /^2 \//);
    assert.equal(await page.textContent('#tdStreak'), '1');
    assert.equal(await page.locator('.toast .toast-act').count(), 1, 'un seul « Annuler » à la fois : celui de la dernière action');
    // Annuler la dernière page
    await page.click('.toast[data-key="quick"] .toast-act');
    assert.equal(await page.inputValue(`#win-${c3}`), '3');
    assert.match(await page.textContent('#tdVal'), /^1 \//);
    // Boutons − / + d'une autre partie : elle devient la partie en cours
    await page.click(`#ch-${c1} .pg-btn.plus`);
    assert.match(await page.textContent('#tdCap'), /Introduction/);
    assert.match(await page.textContent('#tdVal'), /^2 \//);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 2);
    assert.equal(written(d), 44);
    assert.notEqual(await page.textContent('#sEndDate'), '—', 'première estimation affichée');
    assert.match(await page.textContent('#sEndLbl'), /première estimation/);

    // Date de dépôt : directement dans le tableau de bord
    await page.fill('#dlInline', addDays(TODAY, 300));
    await page.waitForSelector('.dl-show');
    assert.match(await page.textContent('#dbDeadline'), /\d{4}.*(à tenir|dans les temps|en retard)/);
    assert.ok(await page.locator('.due-chip:not(:empty)').count() >= 6, 'échéances par chapitre');
    d = await docOf(page, uid);
    assert.equal(d.deadline, addDays(TODAY, 300));
    assert.equal(d.startDate, null, 'aucune date de début demandée');
    await page.screenshot({ path: path.join(SHOTS, '21-02-apres-demarrage.png') });
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Plan saisi ou collé, ajout en ligne, objectif total', async () => {
    const uid = 'u_plan';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'plan@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.click('.ob-link');
    await page.fill('#planText', 'Introduction\nÉtat de l\'art\n   Contexte historique\n   Travaux récents\nMéthodologie (40)\nConclusion');
    await page.fill('#planTotal', '200');
    await page.click('text=Créer mon plan');
    await page.waitForSelector('.chapter-card');
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => [c.title, c.subsections.length]), [['Introduction', 0], ["État de l'art", 2], ['Méthodologie', 0], ['Conclusion', 0]]);
    assert.equal(d.chapters[2].targetPages, 40, 'objectif donné respecté');
    assert.equal(target(d), 200, 'objectif total réparti');
    // Ajout en ligne
    await page.fill('#addChapterInput', 'Annexes méthodologiques');
    await page.press('#addChapterInput', 'Enter');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 5);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'addChapterInput', 'prêt pour le chapitre suivant');
    // Coller plusieurs lignes d'un coup
    await page.evaluate(() => {
      const input = document.getElementById('addChapterInput');
      const dt = new DataTransfer();
      dt.setData('text/plain', 'Discussion\nPerspectives\n  Limites\n  Pistes');
      input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 7);
    d = await docOf(page, uid);
    assert.equal(d.chapters[6].subsections.length, 2);
    await page.click('.toast .toast-act'); // Annuler
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 5);
    // Découper un chapitre : l'objectif est partagé, les pages déjà notées suivent
    d = await docOf(page, uid);
    const meth = d.chapters[2].id;
    await page.fill(`#win-${meth}`, '9');
    await page.click(`#ch-${meth} .btn-more`);
    await page.click('#cmAddSs');
    await page.fill(`#ch-${meth} .add-row.sub .add-input`, 'Terrain');
    await page.press(`#ch-${meth} .add-row.sub .add-input`, 'Enter');
    await page.waitForSelector(`#ch-${meth} .subsection`);
    await page.fill(`#ch-${meth} .add-row.sub .add-input`, 'Entretiens');
    await page.press(`#ch-${meth} .add-row.sub .add-input`, 'Enter');
    await page.waitForFunction(id => document.querySelectorAll(`#ch-${id} .subsection`).length === 2, meth);
    d = await docOf(page, uid);
    const subs = d.chapters[2].subsections;
    assert.deepEqual(subs.map(s => [s.title, s.targetPages, s.writtenPages]), [['Terrain', 20, 9], ['Entretiens', 20, 0]]);
    // Objectif total : un seul chiffre à changer
    await page.evaluate(() => window.openProjectModal());
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.equal(await page.isVisible('#pmStart'), false, 'réglages avancés repliés');
    const before = target(d);
    assert.equal(await page.inputValue('#pmTotal'), String(before));
    await page.fill('#pmTotal', String(before * 2));
    await page.click('#projectModal >> text=Enregistrer');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    d = await docOf(page, uid);
    assert.equal(target(d), before * 2);
    assert.equal(d.chapters[2].subsections[0].targetPages, 40);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Utilisateur existant : mêmes chiffres, menu ⋯, suppression annulable, note, synchro distante', async () => {
    const uid = 'u_v1';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'v1@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC }, seenNews: false });
    await page.goto(BASE);
    await page.waitForSelector('#whatsNewModal:not(.hidden)');
    await page.screenshot({ path: path.join(SHOTS, '21-03-nouveautes.png') });
    await page.click('#whatsNewModal >> text=C\'est parti');
    assert.equal(await page.textContent('#sTotal'), '115');
    assert.equal(await page.textContent('#sWritten'), '38');
    assert.equal(await page.textContent('#sRemaining'), '77');
    assert.match(await page.textContent('#gaugePct'), /^33\s%$/);
    assert.ok(await page.evaluate(() => document.getElementById('journalCard').classList.contains('collapsed')), 'journal replié');
    const w0 = await page.evaluate(() => window.__fbStore.writes);
    assert.ok(w0.every(w => w.merge && !w.data.chapters), 'aucune réécriture complète au chargement');
    // Chapitre sans sous-section : pages visibles sans rien déplier
    assert.ok(await page.isVisible('#win-c1'));
    await page.click('#ch-c3 .pg-btn.plus');
    await flush(page);
    let d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1);
    assert.equal(d.startDate, '2026-03-03');
    // Menu ⋯ : statut de relecture
    await page.click('#ch-c2 .btn-more');
    await page.waitForSelector('#chapterMenuModal:not(.hidden)');
    await page.screenshot({ path: path.join(SHOTS, '21-04-menu-chapitre.png') });
    await page.click('#chapterMenuModal [data-review="sent"]');
    assert.match(await page.textContent('#bd-c2'), /chez la direction/);
    assert.match(await page.textContent('#reviewStrip'), /chez la direction depuis aujourd'hui/);
    // Suppression sans confirmation, mais annulable
    await page.click('#ch-c4 .btn-more');
    await page.click('#chapterMenuModal >> text=Supprimer ce chapitre');
    await page.waitForFunction(() => !document.getElementById('ch-c4'));
    assert.equal(page._dialogs.length, 0);
    await page.click('.toast .toast-act');
    await page.waitForSelector('#ch-c4');
    d = await docOf(page, uid);
    assert.equal(d.chapters.length, 4);
    assert.equal(d.chapters.find(c => c.id === 'c2').review, 'sent');
    // Version détaillée : hier, 2 pages, une note
    await page.click('#tdCap');
    await page.waitForSelector('#logModal:not(.hidden)');
    await page.selectOption('#logSection', 's2');
    await page.click('#logModal .stepper button >> nth=1');
    await page.click('#logDaySeg >> text=Hier');
    await page.fill('#logNote', 'Bonne séance à la BU');
    await page.screenshot({ path: path.join(SHOTS, '21-05-jai-ecrit.png') });
    await page.click('#logModal >> text=Enregistrer');
    await page.waitForSelector('#logModal.hidden', { state: 'attached' });
    d = await docOf(page, uid);
    assert.equal(d.activity[addDays(TODAY, -1)], 2);
    assert.equal(d.journal[addDays(TODAY, -1)][0].n, 'Bonne séance à la BU');
    assert.match(await page.textContent('#tdCap'), /2\.2 Débats/, 'partie en cours mise à jour');
    assert.equal(await page.textContent('#tdStreak'), '2');
    await page.click('.jc-head');
    assert.match(await page.textContent('#jcEntries'), /Bonne séance à la BU/);
    // Modification venant d'un autre appareil
    await page.waitForTimeout(1600);
    await page.evaluate(u => window.__fbStore.remoteSet(`users/${u}/thesis/main`, {
      chapters: window.__fbStore.get(`users/${u}/thesis/main`).chapters.map(c => c.id === 'c4' ? { ...c, title: 'Conclusion (depuis le téléphone)' } : c),
      updatedAt: new Date().toISOString(), clientId: 'autre-appareil',
    }), uid);
    await page.waitForTimeout(300);
    assert.equal(await page.inputValue('#ch-c4 .chapter-header .editable'), 'Conclusion (depuis le téléphone)');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Word : 1re synchro avec aperçu, puis un seul geste, annulation, nouveauté, relecture', async () => {
    const uid = 'u_docx';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'docx@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; }); // comme Firefox / Safari
    await sendDocx(page, 'these.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /5 parties détectées, 4 sous-sections/);
    assert.equal(await page.isVisible('#docxScopeRow'), false, 'plan vide : pas de question superflue');
    await page.fill('#docxTotal', '120');
    await page.screenshot({ path: path.join(SHOTS, '21-06-word-apercu.png') });
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => c.title), ['Introduction générale', 'Chapitre 1 : État de l’art', 'Chapitre 2 : Méthodologie', 'Conclusion générale']);
    assert.equal(written(d), 12);
    assert.ok(!d.activity || !d.activity[TODAY], 'première synchro non comptée');
    assert.equal(d.docFiles.these.inclWords, 4645);
    assert.equal(d.docFiles.these.wpp, 380);
    assert.equal(d.chapters[1].docFile, 'these');
    assert.equal(await page.textContent('#wordBtn'), 'Synchroniser Word');

    // Le lendemain : le même fichier, enrichi. Un geste, pas d'aperçu.
    await page.waitForTimeout(400);
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false, 'pas d\'aperçu pour un fichier connu');
    assert.match((await toasts(page)).join('|'), /these\.docx synchronisé : \+1,6 p\. aujourd'hui/);
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1.58, 'activité au mot près (600 mots)');
    assert.equal(written(d), 14);
    assert.equal(d.docFiles.these.inclWords, 5245);
    assert.match(await page.textContent('#tdVal'), /^1,6 \//);
    // Annuler
    await page.click('.toast .toast-act');
    await page.waitForTimeout(200);
    d = await docOf(page, uid);
    assert.equal(written(d), 12);
    assert.ok(!d.activity || !d.activity[TODAY], 'activité annulée : ' + JSON.stringify(d.activity));
    assert.equal(d.docFiles.these.inclWords, 4645);
    // On recommence, puis le même fichier une 2e fois : « déjà à jour »
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)));
    await page.waitForTimeout(300);
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)));
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1.58, 'pas de double comptage');

    // Une nouvelle sous-partie apparaît dans le document : là, on demande
    await sendDocx(page, 'these_v3.docx', 'these.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    const rows = await page.$$eval('.dx-row', rs => rs.map(r => [r.querySelector('.dx-title').textContent, r.querySelector('select') ? r.querySelector('select').selectedOptions[0].textContent : '']));
    const nouveau = rows.filter(r => /Nouve/.test(r[1])).map(r => r[0]);
    assert.deepEqual(nouveau, ['2.3 Analyse des données'], 'seule la nouveauté est à valider : ' + JSON.stringify(rows));
    assert.equal(await page.isChecked('#docxCount'), true);
    await page.click('#docxApply');
    await page.waitForSelector('#docxModal.hidden', { state: 'attached' });
    d = await docOf(page, uid);
    assert.equal(d.chapters[2].subsections.length, 3);
    assert.equal(d.activity[TODAY], 2.91, '+504 mots (titre compris) de la nouvelle partie : ' + d.activity[TODAY]);

    // Décocher une partie : mémorisé, la synchro suivante reste en un geste
    await sendDocx(page, 'these_v3.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)));
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Word : journée de relecture (moins de mots) = jour de travail, série maintenue', async () => {
    const uid = 'u_rev';
    const doc = {
      version: 2, documentTitle: 'T', startDate: null, trackedSince: addDays(TODAY, -3), milestones: {},
      activity: { [addDays(TODAY, -1)]: 1 }, journal: {},
      chapters: [
        { id: 'a', title: 'Introduction générale', targetPages: 20, writtenPages: 3, subsections: [], docKey: 'introduction generale', docFile: 'these' },
        { id: 'b', title: 'Chapitre 1 : État de l’art', targetPages: 0, writtenPages: 0, docKey: 'etat de l art', docFile: 'these', subsections: [
          { id: 'b1', title: '1.1 Contexte général', targetPages: 20, writtenPages: 3, docKey: 'contexte general', docFile: 'these' },
          { id: 'b2', title: '1.2 Travaux existants', targetPages: 20, writtenPages: 3, docKey: 'travaux existants', docFile: 'these' }] },
        { id: 'c', title: 'Chapitre 2 : Méthodologie', targetPages: 0, writtenPages: 0, docKey: 'methodologie', docFile: 'these', subsections: [
          { id: 'c1', title: '2.1 Terrain', targetPages: 20, writtenPages: 2, docKey: 'terrain', docFile: 'these' },
          { id: 'c2', title: '2.2 Entretiens', targetPages: 20, writtenPages: 2, docKey: 'entretiens', docFile: 'these' }] },
        { id: 'd', title: 'Conclusion générale', targetPages: 10, writtenPages: 1, subsections: [], docKey: 'conclusion generale', docFile: 'these' },
      ],
      docFiles: { these: { name: 'these.docx', at: addDays(TODAY, -1), inclWords: 5245, wpp: 380, scope: '', mtime: 1, size: 1 } },
      docIgnore: [],
    };
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'rev@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.equal(await page.textContent('#tdStreak'), '1');
    await sendDocx(page, 'these_v4.docx', 'these.docx'); // 50 mots de moins
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)), null, { timeout: 15000 });
    const d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], -0.13);
    assert.equal(d.journal[TODAY][0].n, 'Relecture et corrections (synchro Word)');
    assert.equal(await page.textContent('#tdStreak'), '2', 'la série continue');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Word : un fichier par chapitre (avec titres, puis sans aucun style)', async () => {
    const uid = 'u_chap';
    const doc = clone(V1_DOC);
    doc.chapters.push({ id: 'c5', title: 'Discussion', expanded: true, targetPages: 25, writtenPages: 0, subsections: [] });
    doc.chapters[2] = { id: 'c3', title: 'Méthodologie', expanded: true, targetPages: 40, writtenPages: 0, subsections: [
      { id: 'm1', title: 'Terrain', targetPages: 20, writtenPages: 0 }, { id: 'm2', title: 'Entretiens', targetPages: 20, writtenPages: 0 }] };
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'chap@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    // Fichier « chapitre » : ses titres correspondent aux sous-sections d'un chapitre du plan
    await sendDocx(page, 'chapitre-methodo.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.inputValue('#docxScope'), 'c3', 'chapitre reconnu automatiquement');
    const rows = await page.$$eval('.dx-row', rs => rs.map(r => [r.querySelector('.dx-title').textContent, r.querySelector('input[type=checkbox]').checked, r.querySelector('.dx-map').textContent.trim().slice(0, 40)]));
    assert.equal(rows[0][0], 'Méthodologie');
    assert.match(rows[0][2], /ce fichier = ce chapitre/);
    assert.deepEqual(rows.slice(1).map(r => [r[0], r[1]]), [['Terrain', true], ['Entretiens', true], ['Bibliographie', false]]);
    await page.screenshot({ path: path.join(SHOTS, '21-07-word-chapitre.png') });
    await page.click('#docxApply');
    await page.waitForSelector('#docxModal.hidden', { state: 'attached' });
    let d = await docOf(page, uid);
    const meth = d.chapters.find(c => c.id === 'c3');
    assert.deepEqual(meth.subsections.map(s => s.writtenPages), [3, 2], 'Terrain = 190 + 760 mots, Entretiens = 570 mots');
    assert.equal(meth.subsections.length, 2, 'bibliographie du chapitre ignorée');
    assert.equal(d.docFiles.chapitre_methodo.scope, 'c3');
    assert.equal(d.chapters.find(c => c.id === 'c1').writtenPages, 6, 'les autres chapitres ne bougent pas');
    // Fichier sans aucun titre, reconnu par son nom
    await sendDocx(page, 'discussion.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.inputValue('#docxScope'), 'c5');
    assert.match(await page.textContent('#docxSummary'), /tout le texte est compté/);
    await page.click('#docxApply');
    await page.waitForSelector('#docxModal.hidden', { state: 'attached' });
    d = await docOf(page, uid);
    assert.equal(d.chapters.find(c => c.id === 'c5').writtenPages, 3, '1 140 mots = 3 pages');
    // Deuxième passage du fichier chapitre : un geste
    await sendDocx(page, 'chapitre-methodo.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Fichier lié (Chrome / Edge) : relu tout seul au retour sur l\'onglet, conservé après rechargement', async () => {
    const uid = 'u_link';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'link@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    const b64 = n => fs.readFileSync(FIX(n)).toString('base64');
    // Un vrai FileSystemFileHandle (stockage privé du navigateur) remplace la fenêtre de choix de fichier
    const installWriter = () => page.evaluate(() => {
      window.__writeDocx = async base64 => {
        const root = await navigator.storage.getDirectory();
        const fh = await root.getFileHandle('these.docx', { create: true });
        const w = await fh.createWritable();
        await w.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0)));
        await w.close();
        return fh;
      };
    });
    await installWriter();
    await page.evaluate(async b => {
      const fh = await window.__writeDocx(b);
      window.showOpenFilePicker = async () => [fh];
    }, b64('these.docx'));
    await page.click('.ob-drop');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await page.waitForFunction(() => document.getElementById('tdPrimary').textContent.includes('Synchroniser'));
    assert.match(await page.textContent('#tdCap'), /these\.docx/);
    await page.screenshot({ path: path.join(SHOTS, '21-08-fichier-lie.png') });
    let d = await docOf(page, uid);
    assert.equal(written(d), 12);

    // On écrit dans Word, on enregistre, on revient sur l'onglet : rien à faire
    await page.waitForTimeout(1100);
    await page.evaluate(async b => { await window.__writeDocx(b); }, b64('these_v2.docx'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé\s:\s\+1,6\sp\./.test(t.textContent)), null, { timeout: 15000 });
    d = await docOf(page, uid);
    assert.equal(written(d), 14);
    assert.equal(d.activity[TODAY], 1.58);

    // Rechargement : le lien est toujours là, sans rien redemander
    await page.reload();
    await page.waitForSelector('.chapter-card');
    await page.waitForFunction(() => document.getElementById('tdPrimary').textContent.includes('Synchroniser'), null, { timeout: 8000 });
    await page.click('#tdPrimary');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    // Nouveauté dans le document : signalée, jamais appliquée d'office
    await page.waitForTimeout(16000); // délai entre deux passages automatiques
    await installWriter();
    await page.evaluate(async b => { await window.__writeDocx(b); }, b64('these_v3.docx'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => /Du nouveau/.test(document.getElementById('tdCap').textContent), null, { timeout: 15000 });
    d = await docOf(page, uid);
    assert.equal(d.chapters[2].subsections.length, 2, 'rien d\'appliqué sans validation');
    await page.click('#tdCap');
    await page.waitForSelector('#docxStep2:not(.hidden)');
    await page.click('#docxApply');
    await page.waitForSelector('#docxModal.hidden', { state: 'attached' });
    d = await docOf(page, uid);
    assert.equal(d.chapters[2].subsections.length, 3);
    // Délier
    await page.evaluate(() => window.openDocxModal());
    await page.click('#linkedList .lk-btn');
    assert.equal(await page.textContent('#tdPrimary'), '+1 page');
    await page.waitForTimeout(400);
    await page.reload();
    await page.waitForSelector('.chapter-card');
    await page.waitForTimeout(500);
    assert.equal(await page.textContent('#tdPrimary'), '+1 page', 'lien bien supprimé');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Déposer le fichier n\'importe où dans la page', async () => {
    const uid = 'u_drop';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'drop@example.com' }, store: { [`users/${uid}/thesis/main`]: clone(V1_DOC) } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    const drop = async (fixture, name, type) => page.evaluate(async ({ b, name, type }) => {
      const file = new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], name, { type });
      const dt = new DataTransfer();
      dt.items.add(file);
      window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
      const shown = document.getElementById('dropOverlay').classList.contains('show');
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      return shown;
    }, { b: fs.readFileSync(FIX(fixture)).toString('base64'), name, type });
    assert.equal(await drop('these.docx', 'these.docx', DOCX), true, 'zone de dépôt affichée');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.getElementById('dropOverlay').classList.contains('show')), false);
    await page.click('#docxModal >> text=Retour');
    await page.click('#docxModal >> text=Fermer');
    // Un PDF : message clair, pas d'erreur
    await drop('these.docx', 'these.pdf', 'application/pdf');
    await page.waitForSelector('#docxError:not(.hidden)');
    assert.match(await page.textContent('#docxError'), /PDF/);
    assert.deepEqual(page._errors.filter(e => !/docx:/.test(e)), []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Partage (chargé à la demande), agenda, bilan imprimable', async () => {
    const uid = 'u_share';
    const doc = clone(V1_DOC);
    Object.assign(doc, { version: 2, deadline: addDays(TODAY, 150), marginDays: 21, trackedSince: addDays(TODAY, -20),
      activity: { [addDays(TODAY, -1)]: 2, [addDays(TODAY, -2)]: 3, [TODAY]: 1 },
      journal: { [addDays(TODAY, -2)]: [{ p: 3, s: 's2', n: 'Bonne séance à la BU', m: 0, t: '10:00' }] } });
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'share@example.com', displayName: 'Alex Martin' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.equal(await page.evaluate(() => typeof window.html2canvas), 'undefined', 'bibliothèque d\'image non chargée au démarrage');
    await page.click('#shareIgBtn');
    await page.waitForSelector('#sharePreview img', { timeout: 25000 });
    const size = () => page.evaluate(async () => { const r = await fetch(document.querySelector('#sharePreview img').src); const bmp = await createImageBitmap(await r.blob()); return [bmp.width, bmp.height]; });
    assert.deepEqual(await size(), [1080, 1080]);
    await page.click('#shareSeg >> text=Story');
    await page.waitForSelector('#sharePreview img.story', { timeout: 25000 });
    assert.deepEqual(await size(), [1080, 1920]);
    await page.click('#shareModal', { position: { x: 5, y: 5 } });
    await page.evaluate(() => window.openCalendarModal());
    await page.waitForSelector('#calendarModal:not(.hidden)');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#calendarModal >> text=Fichier agenda (.ics)')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1 + 1 + 1 + 4);
    await page.click('#calendarModal >> text=Fermer');
    await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
    await page.evaluate(() => window.printReport());
    await page.waitForFunction(() => window.__printed === true);
    const rep = await page.textContent('#printReport');
    assert.match(rep, /Thèse sur les ponts/);
    assert.match(rep, /Bonne séance à la BU/);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Mobile : tout tient à l\'écran, bouton flottant +1 page', async () => {
    const uid = 'u_mob';
    const doc = clone(V1_DOC);
    Object.assign(doc, { version: 2, deadline: addDays(TODAY, 90), trackedSince: addDays(TODAY, -30), activity: {} });
    for (let i = 1; i < 30; i++) if (i % 3) doc.activity[addDays(TODAY, -i)] = (i % 4) + 1;
    doc.chapters[1].review = 'sent'; doc.chapters[1].reviewDate = addDays(TODAY, -34);
    const { ctx, page } = await newPage(browser, { viewport: { width: 360, height: 740 }, user: { uid, email: 'mob@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.ok(await page.evaluate(() => { const r = document.getElementById('tdPrimary').getBoundingClientRect(); return r.bottom <= window.innerHeight + 200; }), 'action du jour proche du premier écran');
    await page.screenshot({ path: path.join(SHOTS, '21-09-mobile.png') });
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(await overflow() <= 0, 'pas de défilement horizontal : ' + await overflow());
    await page.evaluate(() => document.querySelector('.workspace').scrollIntoView());
    await page.waitForTimeout(400);
    assert.ok(await page.isVisible('.fab'));
    await page.screenshot({ path: path.join(SHOTS, '21-10-mobile-plan.png') });
    const touch = await page.$$eval('.pg-btn', bs => Math.min(...bs.filter(b => b.offsetParent).map(b => b.getBoundingClientRect().width)));
    assert.ok(touch >= 36, 'boutons − / + assez grands pour le doigt : ' + touch);
    await page.click('.fab');
    assert.match((await toasts(page)).join('|'), /\+1 page/);
    await flush(page);
    const d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1);
    await page.click('#ch-c2 .btn-more');
    await page.waitForSelector('#chapterMenuModal:not(.hidden)');
    assert.ok(await page.isVisible('#cmRemind'), 'relance proposée');
    assert.ok(await overflow() <= 0);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Sécurité des données : chargement en échec, hors ligne, cache puis serveur, ancienne version', async () => {
    const uid = 'u_err';
    const a = await newPage(browser, { user: { uid, email: 'err@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC }, config: { failListen: 'unavailable' } });
    await a.page.goto(BASE);
    await a.page.waitForSelector('text=Chargement impossible');
    await a.page.evaluate(() => { window.primaryAction(); window.openProjectModal(); window.applyTemplate(0); window.addChapterInline(); });
    assert.equal(await a.page.evaluate(() => window.__fbStore.writes.length), 0, 'aucune écriture');
    assert.equal((await docOf(a.page, uid)).chapters.length, 4);
    await a.ctx.close();

    const o = await newPage(browser, { user: { uid: 'u_off', email: 'off@example.com' }, config: { offline: true } });
    await o.page.goto(BASE);
    await o.page.waitForSelector('text=Chargement de votre journal');
    await o.page.waitForTimeout(500);
    assert.equal(await o.page.evaluate(() => window.__fbStore.writes.length), 0);
    assert.equal(await o.page.locator('.onboarding').count(), 0, 'pas d\'écran « nouveau compte » sans réponse du serveur');
    await o.ctx.close();

    const docC = clone(V1_DOC); docC.milestones = { 25: false, 50: false, 75: false, 100: false };
    const c = await newPage(browser, { user: { uid: 'u_cache', email: 'cache@example.com' }, store: { 'users/u_cache/thesis/main': docC }, config: { cacheFirst: true, serverDelay: 900 } });
    await c.page.goto(BASE);
    await c.page.waitForSelector('.chapter-card');
    assert.equal(await c.page.evaluate(() => window.__fbStore.writes.length), 0, 'aucune écriture sur données du cache');
    await c.page.waitForTimeout(1200);
    const writes = await c.page.evaluate(() => window.__fbStore.writes);
    assert.ok(writes.some(w => w.data.lastSeenAt));
    assert.ok(writes.some(w => w.data.milestones && w.data.milestones[25] === true));
    await c.ctx.close();

    // Une ancienne version (v1) réécrit le document : journal et fichiers Word restaurés
    const docT = clone(V1_DOC);
    Object.assign(docT, { version: 2, deadline: addDays(TODAY, 120), trackedSince: addDays(TODAY, -10), activity: { [addDays(TODAY, -1)]: 3 },
      journal: { [addDays(TODAY, -1)]: [{ p: 3, s: 's2', n: 'Note précieuse', m: 0, t: '09:00' }] },
      docFiles: { these: { name: 'these.docx', at: addDays(TODAY, -1), inclWords: 4643, wpp: 380, scope: '' } } });
    const t = await newPage(browser, { user: { uid: 'u_trans', email: 'trans@example.com' }, store: { 'users/u_trans/thesis/main': docT } });
    await t.page.goto(BASE);
    await t.page.waitForSelector('.chapter-card');
    await t.page.waitForTimeout(1700);
    await t.page.evaluate(() => {
      const cur = window.__fbStore.get('users/u_trans/thesis/main');
      window.__fbStore.remoteSet('users/u_trans/thesis/main', { chapters: cur.chapters.map(ch => ch.id === 'c3' ? { ...ch, writtenPages: 9 } : ch),
        startDate: cur.startDate, milestones: cur.milestones, documentTitle: cur.documentTitle, updatedAt: new Date().toISOString() }, false);
    });
    await t.page.waitForTimeout(600);
    const after = await docOf(t.page, 'u_trans');
    assert.equal(after.version, 2);
    assert.equal(after.deadline, addDays(TODAY, 120));
    assert.equal(after.journal[addDays(TODAY, -1)][0].n, 'Note précieuse');
    assert.equal(after.docFiles.these.inclWords, 4643, 'fichiers Word restaurés');
    assert.equal(after.chapters.find(ch => ch.id === 'c3').writtenPages, 9);
    assert.deepEqual(t.page._errors, []);
    await t.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Raccourci ?action=log et données de la v2.0 (ancien import Word)', async () => {
    const uid = 'u_act';
    const doc = clone(V1_DOC);
    Object.assign(doc, { version: 2, lastDocImport: { at: addDays(TODAY, -2), name: 'Ma Thèse v3.docx', words: 10000, pages: 26 } });
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'act@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE + '?action=log');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.equal(new URL(page.url()).search, '');
    assert.equal(await page.textContent('#wordBtn'), 'Synchroniser Word', 'ancien import reconnu');
    await page.click('#logModal >> text=Enregistrer');
    await page.waitForTimeout(200);
    const d = await docOf(page, uid);
    assert.equal(d.docFiles.ma_these_v3.name, 'Ma Thèse v3.docx');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });


  /* ============================================================
     V3 : annonce de mise à jour, promo, humour
  ============================================================ */
  const isoWeekId = (date = new Date()) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const year = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(year, 0, 1)) / 86400000 + 1) / 7);
    return `${year}-S${String(week).padStart(2, '0')}`;
  };
  const WEEK = isoWeekId();
  const PROFILE_KEYS = ['v', 'name', 'field', 'year', 'pct', 'week', 'weekPages', 'streak', 'heat', 'notes', 'joinedAt', 'updatedAt'];
  const fellow = (name, extra = {}) => ({
    v: 1, name, field: '', year: 0, pct: 50, week: WEEK, weekPages: 0, streak: 0, heat: {}, notes: [],
    joinedAt: '2026-10-01T10:00:00.000Z', updatedAt: new Date().toISOString(), ...extra,
  });
  const PROMO_STORE = {
    'profiles/a1': fellow('Hypothèse Fragile', { field: 'Sociologie', year: 3, pct: 62, weekPages: 11.5, streak: 9, heat: { [TODAY]: 3 }, notes: [{ d: TODAY, t: 'Chapitre 3 envoyé à ma direction.', p: 4 }] }),
    'profiles/a2': fellow('Note de bas de page', { field: 'Histoire', year: 4, pct: 81, weekPages: 7, streak: 21 }),
    'profiles/a3': fellow('Et al.', { pct: 8, updatedAt: new Date(Date.now() - 3 * 864e5).toISOString() }),
  };
  const modalsOpen = page => page.locator('.modal-overlay:not(.hidden)').count();

  /* ------------------------------------------------------------ */
  await test('Mise à jour : annoncée une seule fois à la connexion, reportée si on arrive par un raccourci', async () => {
    const uid = 'u_maj';
    const a = await newPage(browser, { user: { uid, email: 'maj@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC }, seenNews: false });
    await a.page.goto(BASE);
    await a.page.waitForSelector('#whatsNewModal:not(.hidden)');
    assert.match(await a.page.textContent('#wnTitle'), /peau neuve/);
    assert.equal(await a.page.isVisible('#wnPromo'), false, 'la promo n\'est pas annoncée tant qu\'elle est fermée');
    assert.equal(await a.page.textContent('#sWritten'), '38', 'les données sont intactes derrière l\'annonce');
    await a.page.click('#whatsNewModal >> text=C\'est parti');
    await a.page.goto(BASE);
    await a.page.waitForSelector('.chapter-card');
    await a.page.waitForTimeout(3000);
    assert.equal(await modalsOpen(a.page), 0, 'pas de seconde annonce');
    // Elle reste consultable dans le menu
    await a.page.click('.hamburger-btn');
    await a.page.click('#mobileMenu >> text=Quoi de neuf ?');
    await a.page.waitForSelector('#whatsNewModal:not(.hidden)');
    assert.deepEqual(a.page._errors, []);
    await a.ctx.close();

    // Arrivée par le rappel d'agenda : la saisie d'abord, l'annonce à la prochaine ouverture
    const b = await newPage(browser, { user: { uid, email: 'maj@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC }, seenNews: false });
    await b.page.goto(BASE + '?action=log');
    await b.page.waitForSelector('#logModal:not(.hidden)');
    await b.page.waitForTimeout(3000);
    assert.equal(await b.page.isVisible('#whatsNewModal'), false);
    assert.equal(await b.page.evaluate(() => localStorage.getItem('jdb_whatsnew')), null, 'annonce non consommée');
    await b.page.goto(BASE);
    await b.page.waitForSelector('#whatsNewModal:not(.hidden)');
    assert.deepEqual(b.page._errors, []);
    await b.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Promo fermée (règles absentes) : invisible, silencieuse, aucune écriture hors du journal', async () => {
    const uid = 'u_ferme';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'ferme@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC, ...PROMO_STORE } });
    await page.goto(BASE + '?p=a1');
    await page.waitForSelector('.chapter-card');
    await page.waitForTimeout(900);
    assert.equal(await page.isVisible('#viewTabs'), false);
    assert.equal(await page.evaluate(() => document.getElementById('menuPromo').classList.contains('hidden')), true);
    assert.equal(await page.evaluate(() => document.getElementById('logShareRow').classList.contains('hidden')), true);
    await page.evaluate(() => window.setView('promo'));
    assert.equal(await page.isVisible('#viewPromo'), false, 'l\'espace promo ne s\'ouvre pas');
    assert.equal(await page.isVisible('#viewThese'), true);
    await page.evaluate(() => { window.openPromoProfile(); window.cheerFellow('a1'); });
    await page.waitForTimeout(300);
    assert.equal(await modalsOpen(page), 0, 'ni fiche, ni formulaire');
    await page.click('#tdPrimary');
    await flush(page);
    await page.waitForTimeout(4500); // délai de publication de la promo
    const writes = await page.evaluate(() => window.__fbStore.writes);
    assert.ok(writes.length > 0 && writes.every(w => w.path.startsWith(`users/`)), 'écritures limitées au journal privé');
    assert.deepEqual(page._errors, []);
    await ctx.close();

    // Visiteur non connecté avec un lien de fiche : l'accueil normal, sans erreur
    const g = await newPage(browser, { store: { ...PROMO_STORE } });
    await g.page.goto(BASE + '?p=a1');
    await g.page.waitForSelector('#authScreen:not(.hidden)');
    await g.page.waitForTimeout(400);
    assert.equal(await g.page.isVisible('#guestProfile'), false);
    assert.deepEqual(g.page._errors, []);
    await g.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Promo ouverte : rejoindre sous pseudonyme, classement, fil, encouragement, signalement, quitter', async () => {
    const uid = 'u_promo';
    const doc = clone(V1_DOC);
    Object.assign(doc, { version: 2, trackedSince: addDays(TODAY, -20), activity: { [TODAY]: 2, [addDays(TODAY, -1)]: 1 }, journal: { [TODAY]: [{ p: 2, s: 's2', n: 'Note strictement privée', m: 0, t: '10:00' }] } });
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'promo@example.com', displayName: 'Vrai Nom' }, store: { [`users/${uid}/thesis/main`]: doc, ...PROMO_STORE }, config: { promo: true } });
    await page.goto(BASE);
    await page.waitForSelector('#viewTabs:not(.hidden)');
    assert.equal(await page.isVisible('#viewThese'), true, 'on arrive toujours sur sa thèse');
    assert.equal(await page.evaluate(() => window.__fbStore.get('profiles/u_promo')), undefined, 'rien n\'est publié sans inscription');
    await page.click('.view-tab[data-view="promo"]');
    await page.waitForSelector('.rank-item');
    assert.ok(await page.isVisible('#promoJoin'));
    assert.equal(await page.isVisible('#promoCompose'), false);
    assert.deepEqual(await page.$$eval('.rank-item .rk-name', els => els.map(e => e.textContent)), ['Hypothèse Fragile', 'Note de bas de page']);
    assert.match(await page.textContent('#promoIdle'), /En réflexion cette semaine : Et al\./);
    assert.match(await page.textContent('#promoLead'), /3 doctorant·es sont inscrit·es/);
    assert.match(await page.textContent('.rank-item >> nth=0'), /major de promo/);

    // Rejoindre : pseudonyme proposé, modifiable
    await page.click('#promoJoin >> text=Rejoindre la promo');
    await page.waitForSelector('#promoModal:not(.hidden)');
    const proposed = await page.inputValue('#ppName');
    assert.ok(proposed.length >= 2, 'un pseudonyme est proposé');
    assert.ok(!/promo@|Vrai Nom/.test(proposed));
    await page.click('#promoModal >> text=Au hasard');
    assert.notEqual(await page.inputValue('#ppName'), proposed);
    await page.fill('#ppName', '  Plan   B  ');
    await page.fill('#ppField', 'Histoire');
    await page.selectOption('#ppYear', '3');
    await page.screenshot({ path: path.join(SHOTS, '3-01-rejoindre.png') });
    await page.click('#ppSave');
    await page.waitForSelector('#promoModal.hidden', { state: 'attached' });
    let prof = await page.evaluate(() => window.__fbStore.get('profiles/u_promo'));
    assert.deepEqual(Object.keys(prof).filter(k => !PROFILE_KEYS.includes(k)), [], 'seuls les champs autorisés par les règles');
    assert.equal(prof.name, 'Plan B');
    assert.equal(prof.field, 'Histoire');
    assert.equal(prof.year, 3);
    assert.equal(prof.pct, 33);
    assert.equal(prof.weekPages, TODAY === addDays(TODAY, 0) && new Date().getDay() === 1 ? 2 : 3);
    assert.equal(prof.week, WEEK);
    assert.deepEqual(prof.notes, []);
    const raw = JSON.stringify(prof);
    assert.ok(!/ponts|promo@example|Vrai Nom|privée|Introduction|Méthodologie/.test(raw), 'ni titre, ni adresse, ni nom, ni plan, ni note privée');
    assert.match(await page.textContent('#promoMe'), /Plan B/);
    assert.match(await page.textContent('#promoLead'), /4 doctorant·es/);
    assert.match(await page.textContent('.rank-item.me'), /Plan B \(vous\)/);
    assert.ok(await page.isVisible('#promoCompose'));

    // Écrire dans le fil
    await page.fill('#promoText', 'Courage à toutes et tous <b>!</b>');
    await page.click('#promoCompose >> text=Publier');
    await page.waitForFunction(() => /Courage à toutes et tous/.test(document.getElementById('promoFeed').textContent));
    prof = await page.evaluate(() => window.__fbStore.get('profiles/u_promo'));
    assert.equal(prof.notes[0].t, 'Courage à toutes et tous <b>!</b>');
    assert.equal(await page.locator('#promoFeed b').count(), 0, 'le texte est affiché tel quel, jamais interprété');
    assert.equal(await page.inputValue('#promoText'), '');

    // Encourager, signaler
    await page.click('#promoFeed [data-cheer="a1"]');
    await page.waitForFunction(() => !!window.__fbStore.get('profiles/a1/cheers/u_promo'));
    const cheer = await page.evaluate(() => window.__fbStore.get('profiles/a1/cheers/u_promo'));
    assert.equal(cheer.w, WEEK);
    assert.equal(cheer.name, 'Plan B');
    assert.equal(await page.isDisabled('#promoFeed [data-cheer="a1"]'), true);
    await page.click('#promoFeed >> text=Signaler');
    await page.waitForFunction(() => Object.keys(window.__fbStore.all()).some(k => k.startsWith('reports/u_promo_a1_')));
    assert.equal(page._dialogs.length, 1, 'le signalement demande confirmation');

    // Fiche d'un·e autre doctorant·e
    await page.click('.rank-item >> nth=0');
    await page.waitForSelector('#fellowModal:not(.hidden)');
    assert.match(await page.textContent('#fellowSheet'), /Hypothèse Fragile/);
    assert.match(await page.textContent('#fellowSheet'), /62\s%/);
    await page.waitForFunction(() => /1 encouragement/.test(document.getElementById('fwCheers').textContent));
    assert.equal(await page.isDisabled('#fellowSheet [data-cheer]'), true, 'déjà encouragé·e cette semaine');
    assert.ok(await page.locator('#fellowSheet svg.hm-grid rect').count() > 60, 'calendrier de régularité');
    await page.screenshot({ path: path.join(SHOTS, '3-02-fiche.png') });
    await page.click('#fellowSheet >> text=Fermer');

    // Retirer ma note
    await page.click('#promoFeed >> text=Retirer');
    await page.waitForFunction(() => window.__fbStore.get('profiles/u_promo').notes.length === 0);

    // Mes chiffres suivent mon journal, sans rien faire
    await page.click('.view-tab[data-view="these"]');
    await page.click('#tdPrimary');
    await page.waitForFunction(w => window.__fbStore.get('profiles/u_promo').weekPages === w, prof.weekPages + 1, { timeout: 9000 });

    // « J'ai écrit » : partager la note avec la promo, si on le souhaite
    await page.click('#tdCap');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.ok(await page.isVisible('#logShareRow'));
    assert.equal(await page.isChecked('#logShare'), false, 'jamais partagé par défaut');
    await page.fill('#logNote', 'Enfin la bonne cote aux Archives');
    await page.check('#logShare');
    await page.click('#logModal >> text=Enregistrer');
    await page.waitForFunction(() => (window.__fbStore.get('profiles/u_promo').notes[0] || {}).t === 'Enfin la bonne cote aux Archives');
    assert.equal((await page.evaluate(() => window.__fbStore.get('profiles/u_promo'))).notes[0].p, 1);

    // Lien de ma fiche, puis départ : tout est supprimé
    await page.click('.hamburger-btn');
    await page.click('#menuPromo');
    await page.waitForSelector('#promoModal:not(.hidden)');
    assert.equal(await page.inputValue('#ppLink'), BASE + '?p=u_promo');
    assert.equal(await page.inputValue('#ppName'), 'Plan B');
    await page.click('#ppLeave');
    await page.waitForFunction(() => window.__fbStore.get('profiles/u_promo') === undefined);
    assert.equal(page._dialogs.length, 2, 'quitter demande confirmation');
    await page.click('.view-tab[data-view="promo"]');
    await page.waitForSelector('#promoJoin:not(.hidden)');
    assert.equal(await page.locator('.rank-item.me').count(), 0);
    const paths = await page.evaluate(() => window.__fbStore.writes.map(w => w.path));
    assert.ok(paths.every(p => /^(users\/u_promo\/|profiles\/u_promo$|profiles\/a1\/cheers\/u_promo$|reports\/u_promo_)/.test(p)), 'écritures attendues seulement : ' + [...new Set(paths)].join(', '));
    // Les écritures réelles de l'app sont rejouées ensuite face aux vraies règles (émulateur Firestore)
    fs.writeFileSync(path.join(TMP, 'promo-writes.json'), JSON.stringify(await page.evaluate(() => window.__fbStore.writes.filter(w => !w.path.startsWith('users/'))), null, 1));

    // Déconnexion depuis la promo : retour à l'accueil, puis à « Ma thèse »
    await page.evaluate(() => window.signOutUser());
    await page.waitForSelector('#authScreen:not(.hidden)');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Lien de fiche : lisible sans compte, ouvert directement une fois connecté·e, contenu neutralisé', async () => {
    const evil = fellow('<img src=x onerror="window.__xss=1">', { pct: 250, weekPages: -4, notes: [{ d: TODAY, t: '<script>window.__xss=2</script> bonjour', p: 1 }], heat: { 'pas-une-date': 9, [TODAY]: 2 } });
    const g = await newPage(browser, { store: { ...PROMO_STORE, 'profiles/x1': evil }, config: { promo: true } });
    await g.page.goto(BASE + '?p=a1');
    await g.page.waitForSelector('#guestProfile:not(.hidden)');
    const card = await g.page.textContent('#guestProfile');
    assert.match(card, /Hypothèse Fragile/);
    assert.match(card, /62\s%/);
    assert.match(card, /Chapitre 3 envoyé à ma direction/);
    assert.match(card, /Ouvrez votre journal/);
    assert.equal(await g.page.locator('#guestProfile button').count(), 0, 'lecture seule');
    assert.ok(await g.page.evaluate(() => document.getElementById('tabSignup').classList.contains('active')), 'invitation à créer un compte');
    await g.page.screenshot({ path: path.join(SHOTS, '3-03-fiche-partagee.png'), fullPage: true });
    await g.page.goto(BASE + '?p=inconnu');
    await g.page.waitForSelector('#authScreen:not(.hidden)');
    await g.page.waitForTimeout(300);
    assert.equal(await g.page.isVisible('#guestProfile'), false);
    await g.page.goto(BASE + '?p=x1');
    await g.page.waitForSelector('#guestProfile:not(.hidden)');
    assert.equal(await g.page.evaluate(() => window.__xss), undefined, 'aucun code injecté n\'est exécuté');
    assert.equal(await g.page.locator('#guestProfile img, #guestProfile script').count(), 0);
    assert.match(await g.page.textContent('#guestProfile .fw-pct'), /^100\s%$/, 'valeurs bornées');
    assert.deepEqual(g.page._errors, []);
    await g.ctx.close();

    const uid = 'u_lien';
    const s = await newPage(browser, { user: { uid, email: 'lien@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC, ...PROMO_STORE }, config: { promo: true }, seenNews: false });
    await s.page.goto(BASE + '?p=a2');
    await s.page.waitForSelector('#fellowModal:not(.hidden)');
    assert.match(await s.page.textContent('#fellowSheet'), /Note de bas de page/);
    assert.equal(new URL(s.page.url()).search, '');
    await s.page.waitForTimeout(2800);
    assert.equal(await s.page.isVisible('#whatsNewModal'), false);
    // Encourager sans être inscrit·e : on propose de rejoindre, rien n'est écrit
    await s.page.click('#fellowSheet [data-cheer]');
    await s.page.waitForSelector('#promoModal:not(.hidden)');
    assert.equal(await s.page.evaluate(() => window.__fbStore.get('profiles/a2/cheers/u_lien')), undefined);
    // À la prochaine ouverture, l'annonce de mise à jour mentionne la promo
    await s.page.goto(BASE);
    await s.page.waitForSelector('#whatsNewModal:not(.hidden)');
    assert.ok(await s.page.isVisible('#wnPromo'));
    assert.deepEqual(s.page._errors, []);
    await s.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Humour : note du jour commune, grade, bingo de la semaine (cases gardées, image à partager)', async () => {
    const mk = async uid => {
      const r = await newPage(browser, { user: { uid, email: `${uid}@example.com` }, store: { [`users/${uid}/thesis/main`]: V1_DOC } });
      await r.page.goto(BASE);
      await r.page.waitForSelector('.chapter-card');
      return r;
    };
    const a = await mk('u_h1');
    const b = await mk('u_h2');
    const noteA = await a.page.textContent('#crystalQuote');
    assert.ok(noteA.length > 20);
    assert.equal(await b.page.textContent('#crystalQuote'), noteA, 'la même note pour tout le monde');
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(noteA), 'sans émoji');
    await a.page.click('.footnote >> text=Une autre');
    assert.notEqual(await a.page.textContent('#crystalQuote'), noteA);
    assert.match(await a.page.textContent('#gradeLine'), /Bâtisseur·se de chapitres/);

    await a.page.click('.footnote >> text=Bingo de la semaine');
    await a.page.waitForSelector('#bingoModal:not(.hidden)');
    assert.equal(await a.page.locator('.bingo-cell').count(), 9);
    assert.match(await a.page.textContent('#bgKicker'), /^Semaine \d+$/);
    assert.match(await a.page.textContent('#bingoScore'), /Aucune case/);
    const gridA = await a.page.$$eval('.bingo-cell', els => els.map(e => e.textContent));
    assert.equal(new Set(gridA).size, 9, 'neuf cases différentes');
    for (const i of [0, 1, 2]) await a.page.click(`.bingo-cell >> nth=${i}`);
    assert.match(await a.page.textContent('#bingoScore'), /^Bingo\./);
    await a.page.click('.bingo-cell >> nth=2');
    assert.match(await a.page.textContent('#bingoScore'), /2 cases sur 9/);
    await a.page.click('.bingo-cell >> nth=2');
    await b.page.evaluate(() => window.openBingo());
    assert.deepEqual(await b.page.$$eval('.bingo-cell', els => els.map(e => e.textContent)), gridA, 'la même grille pour tout le monde');
    assert.equal(await b.page.locator('.bingo-cell.on').count(), 0, 'les cases cochées sont personnelles');
    await a.page.goto(BASE);
    await a.page.waitForSelector('.chapter-card');
    await a.page.evaluate(() => window.openBingo());
    assert.deepEqual(await a.page.$$eval('.bingo-cell', els => els.map(e => e.getAttribute('aria-pressed'))), ['true', 'true', 'true', 'false', 'false', 'false', 'false', 'false', 'false']);
    assert.equal(await a.page.evaluate(() => window.__fbStore.writes.some(w => JSON.stringify(w.data || {}).includes('bingo'))), false, 'le bingo reste sur l\'appareil');
    await a.page.click('#bingoModal >> text=Partager ma grille');
    await a.page.waitForSelector('#sharePreview img', { timeout: 20000 });
    assert.match(await a.page.textContent('#shareTitle'), /grille/);
    assert.match(await a.page.textContent('#bcScore'), /3 cases sur 9 · bingo/);
    const [dl] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#shareDownloadBtn')]);
    assert.equal(dl.suggestedFilename(), 'bingo-du-doctorant.png');
    assert.ok(fs.statSync(await dl.path()).size > 20000);
    assert.deepEqual(a.page._errors, []);
    assert.deepEqual(b.page._errors, []);
    await a.ctx.close();
    await b.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Accessibilité de base : fenêtres nommées, champs étiquetés, images décrites, Échap', async () => {
    const uid = 'u_a11y';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'a11y@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC, ...PROMO_STORE }, config: { promo: true } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    const issues = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[aria-labelledby]').forEach(e => { if (!document.getElementById(e.getAttribute('aria-labelledby'))) out.push('aria-labelledby orphelin : ' + (e.id || e.className)); });
      document.querySelectorAll('[role="dialog"]').forEach(e => { if (!e.getAttribute('aria-labelledby') && !e.getAttribute('aria-label')) out.push('fenêtre sans nom : ' + e.id); });
      document.querySelectorAll('input:not([type=hidden]), select, textarea').forEach(e => {
        const named = e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.id && document.querySelector(`label[for="${e.id}"]`)) || e.closest('label') || e.getAttribute('aria-hidden') === 'true';
        if (!named) out.push('champ sans étiquette : ' + (e.id || e.className));
      });
      document.querySelectorAll('img').forEach(e => { if (!e.hasAttribute('alt')) out.push('image sans alt : ' + e.src); });
      document.querySelectorAll('button').forEach(e => { if (!(e.textContent.trim() || e.getAttribute('aria-label') || e.title)) out.push('bouton sans nom : ' + (e.id || e.className)); });
      const ids = {};
      document.querySelectorAll('[id]').forEach(e => { ids[e.id] = (ids[e.id] || 0) + 1; });
      Object.entries(ids).forEach(([k, n]) => { if (n > 1) out.push('identifiant en double : ' + k); });
      return out;
    });
    assert.deepEqual(issues, []);
    // Échap ferme la fenêtre ouverte
    await page.evaluate(() => window.openProjectModal());
    await page.waitForSelector('#projectModal:not(.hidden)');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });


  /* ------------------------------------------------------------ */
  await test('Promo : encouragements reçus annoncés une fois, ouverture signalée une fois', async () => {
    const uid = 'u_membre';
    const store = { [`users/${uid}/thesis/main`]: V1_DOC, ...PROMO_STORE,
      [`profiles/${uid}`]: fellow('Plan B', { pct: 33 }),
      [`profiles/${uid}/cheers/a1`]: { w: WEEK, at: new Date(Date.now() - 3600e3).toISOString(), name: 'Hypothèse Fragile' },
      [`profiles/${uid}/cheers/a2`]: { w: WEEK, at: new Date(Date.now() - 1800e3).toISOString(), name: '<i>Note</i> de bas de page' } };
    const m = await newPage(browser, { user: { uid, email: 'membre@example.com' }, store, config: { promo: true } });
    await m.page.goto(BASE);
    await m.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /vous encouragent/.test(t.textContent)));
    const txt = (await toasts(m.page)).join('|');
    assert.match(txt, /Hypothèse Fragile et <i>Note<\/i> de bas de page vous encouragent/, 'les pseudonymes sont affichés tels quels');
    assert.equal(await m.page.locator('.toast i').count(), 0);
    assert.ok(!/La promo est ouverte/.test(txt), 'pas de présentation pour quelqu\'un qui y est déjà');
    await m.page.click('.view-tab[data-view="promo"]');
    await m.page.waitForFunction(() => /2 encouragements cette semaine/.test(document.getElementById('promoMe').textContent));
    await m.page.goto(BASE);
    await m.page.waitForSelector('#viewTabs:not(.hidden)');
    await m.page.waitForTimeout(900);
    assert.ok(!/encourag/.test((await toasts(m.page)).join('|')), 'annoncés une seule fois');
    // Un nouvel encouragement : annoncé à son tour
    await m.page.evaluate(u => window.__fbStore.set(`profiles/${u}/cheers/a3`, { w: 'ancienne-semaine', at: new Date().toISOString(), name: 'Et al.' }), uid);
    await m.page.goto(BASE);
    await m.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Et al\. vous encourage\./.test(t.textContent)));
    assert.deepEqual(m.page._errors, []);
    await m.ctx.close();

    // Pas encore dans la promo : son ouverture est signalée, une seule fois
    const n = await newPage(browser, { user: { uid: 'u_curieux', email: 'curieux@example.com' }, store: { 'users/u_curieux/thesis/main': V1_DOC, ...PROMO_STORE }, config: { promo: true } });
    await n.page.goto(BASE);
    await n.page.waitForSelector('.toast >> text=La promo est ouverte');
    await n.page.click('.toast >> text=Découvrir');
    await n.page.waitForSelector('#viewPromo:not(.hidden)');
    await n.page.waitForSelector('.rank-item');
    await n.page.goto(BASE);
    await n.page.waitForSelector('#viewTabs:not(.hidden)');
    await n.page.waitForTimeout(700);
    assert.ok(!/La promo est ouverte/.test((await toasts(n.page)).join('|')));
    assert.deepEqual(n.page._errors, []);
    await n.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Confidentialité et compte : lisible sans compte, suppression complète (journal, fiche, appareil)', async () => {
    const g = await newPage(browser, {});
    await g.page.goto(BASE);
    await g.page.waitForSelector('#authScreen:not(.hidden)');
    await g.page.click('.auth-free >> text=Confidentialité');
    await g.page.waitForSelector('#privacyModal:not(.hidden)');
    assert.match(await g.page.textContent('#privacyModal'), /n'est envoyé nulle part/);
    assert.equal(await g.page.isVisible('#pvRights'), false, 'pas d\'action sur un compte sans être connecté·e');
    await g.page.keyboard.press('Escape');
    await g.page.waitForSelector('#privacyModal.hidden', { state: 'attached' });
    assert.deepEqual(g.page._errors, []);
    await g.ctx.close();

    const uid = 'u_adieu';
    const store = { [`users/${uid}/thesis/main`]: V1_DOC, ...PROMO_STORE, [`profiles/${uid}`]: fellow('Plan B'),
      [`profiles/${uid}/cheers/a1`]: { w: WEEK, at: new Date().toISOString(), name: 'Hypothèse Fragile' } };
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'adieu@example.com' }, store, config: { promo: true } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    await page.waitForSelector('#viewTabs:not(.hidden)');
    await page.click('#tdPrimary');
    await flush(page);
    assert.ok(await page.evaluate(u => Object.keys(localStorage).some(k => k.startsWith('jdb_') && k.includes(u)), uid), 'des réglages existent sur l\'appareil');
    await page.click('.hamburger-btn');
    await page.click('#mobileMenu >> text=Confidentialité et compte');
    await page.waitForSelector('#privacyModal:not(.hidden)');
    assert.ok(await page.isVisible('#pvRights'));
    await page.screenshot({ path: path.join(SHOTS, '3-04-confidentialite.png') });
    // Mauvaise saisie de confirmation : rien ne se passe
    page._promptAnswer = 'oui';
    await page.click('#pvRights >> text=Supprimer mon compte');
    await page.waitForSelector('.toast >> text=Suppression annulée');
    assert.ok(await docOf(page, uid), 'journal intact');
    assert.ok(await page.evaluate(u => window.__fbStore.get(`profiles/${u}`), uid), 'fiche intacte');
    assert.equal(page._dialogs.length, 2, 'deux confirmations successives');
    // Confirmation exacte : tout part, dans l'ordre
    page._promptAnswer = ' supprimer ';
    await page.evaluate(() => window.deleteAccount());
    await page.waitForSelector('#authScreen:not(.hidden)');
    const left = await page.evaluate(u => ({
      keys: Object.keys(window.__fbStore.all()).filter(k => k.includes(u)),
      deleted: window.__fbDeleted,
      local: Object.keys(localStorage).filter(k => k.startsWith('jdb_') && k.includes(u)),
      order: window.__fbStore.writes.filter(w => w.deleted).map(w => w.path),
    }), uid);
    assert.deepEqual(left.keys, [], 'plus aucune donnée en base');
    assert.deepEqual(left.deleted, [uid], 'compte supprimé');
    assert.deepEqual(left.local, [], 'plus rien sur l\'appareil');
    assert.deepEqual(left.order, [`profiles/${uid}`, `profiles/${uid}/cheers/a1`, `users/${uid}/thesis/main`]);
    assert.match((await toasts(page)).join('|'), /Compte supprimé/);
    assert.ok(Object.keys(await page.evaluate(() => window.__fbStore.all())).includes('profiles/a1'), 'les autres fiches ne sont pas touchées');
    assert.deepEqual(page._errors, []);
    await ctx.close();

    // Connexion trop ancienne pour Firebase : les données partent, le compte demande une reconnexion
    const r = await newPage(browser, { user: { uid: 'u_vieux', email: 'vieux@example.com' }, store: { 'users/u_vieux/thesis/main': V1_DOC } });
    await r.page.goto(BASE);
    await r.page.waitForSelector('.chapter-card');
    r.page._promptAnswer = 'SUPPRIMER';
    await r.page.evaluate(() => { window.__fbDeleteFail = 'auth/requires-recent-login'; window.deleteAccount(); });
    await r.page.waitForSelector('#authScreen:not(.hidden)');
    assert.equal(await docOf(r.page, 'u_vieux'), undefined);
    assert.match(r.page._dialogs[r.page._dialogs.length - 1], /reconnectez-vous/);
    assert.deepEqual(r.page._errors.filter(e => !/Suppression du compte/.test(e)), []);
    await r.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Finitions : polices locales, aucune requête de police externe, focus des fenêtres, marqueurs nettoyés', async () => {
    const uid = 'u_fin';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'fin@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC }, seenNews: false });
    await ctx.addInitScript(() => {
      if (sessionStorage.getItem('__marks')) return;
      sessionStorage.setItem('__marks', '1');
      localStorage.setItem('jdb_goal_u_fin_2026-01-05', '1');
      localStorage.setItem('jdb_streak_u_fin_2026-01-05', '1');
      localStorage.setItem('jdb_bingo_u_fin_2026-S02', '[1,2]');
      localStorage.setItem('jdb_lastSection_u_fin', 's2');
    });
    await page.goto(BASE);
    await page.waitForSelector('#whatsNewModal:not(.hidden)');
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.fonts.check('500 20px "EB Garamond"') && document.fonts.check('italic 20px "EB Garamond"') && document.fonts.check('600 16px "Source Sans 3"')), 'polices chargées');
    assert.deepEqual(page._requests.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), [], 'aucune police demandée à un tiers');
    assert.ok(page._requests.some(u => u.endsWith('/fonts/eb-garamond-latin.woff2')));
    assert.equal(await page.evaluate(() => typeof window.Sortable), 'function', 'glisser-déposer chargé (contenu vérifié)');
    // L'annonce fermée avec Échap est considérée comme lue
    assert.ok(await page.evaluate(() => document.querySelector('#whatsNewModal .modal').contains(document.activeElement)), 'le focus est dans la fenêtre');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#whatsNewModal.hidden', { state: 'attached' });
    assert.equal(await page.evaluate(() => localStorage.getItem('jdb_whatsnew')), '3');
    // Anciens marqueurs supprimés, réglages conservés
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => /^jdb_(goal|streak|bingo)_/.test(k))), []);
    assert.equal(await page.evaluate(() => localStorage.getItem('jdb_lastSection_u_fin')), 's2');
    // Focus : il entre dans la fenêtre, y reste avec Tab, revient d'où l'on vient à la fermeture
    await page.focus('#tdCap');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#logModal:not(.hidden)');
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => document.getElementById('logModal').contains(document.activeElement)), 'Tab reste dans la fenêtre');
    }
    await page.keyboard.press('Shift+Tab');
    assert.ok(await page.evaluate(() => document.getElementById('logModal').contains(document.activeElement)));
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tdCap', 'le focus revient sur le bouton d\'origine');
    await page.click('.hamburger-btn');
    await page.click('#mobileMenu >> text=Dépôt, objectif et rythme');
    await page.waitForSelector('#projectModal:not(.hidden)');
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('hamburger-btn')), 'retour au bouton Menu');
    // Contraste des textes secondaires (norme AA : 4,5)
    const ratio = await page.evaluate(() => {
      const lum = c => { const [r, g, b] = c.match(/\d+/g).slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const fg = lum(getComputedStyle(document.querySelector('.kicker')).color);
      const bg = lum(getComputedStyle(document.body).backgroundColor);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
    assert.ok(ratio >= 4.5, 'contraste ' + ratio.toFixed(2));
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });


  /* ------------------------------------------------------------ */
  await test('Mise à jour à cheval sur deux versions : versions concordantes, rechargement automatique, jamais en boucle', async () => {
    const uid = 'u_maj2';
    const base = { user: { uid, email: 'maj2@example.com' }, store: { [`users/${uid}/thesis/main`]: V1_DOC } };
    const isDoc = u => u.origin + u.pathname === BASE;
    const navs = page => { const list = []; page.on('request', r => { if (r.isNavigationRequest()) list.push(r.url()); }); return list; };

    // Les trois numéros de version concordent (sw.js, app.js, index.html)
    const v = await newPage(browser, base);
    await v.page.goto(BASE);
    await v.page.waitForSelector('.chapter-card');
    const versions = await v.page.evaluate(async () => ({
      page: document.documentElement.getAttribute('data-app-version'),
      app: window.__jdbVersion,
      sw: ((await (await fetch('sw.js')).text()).match(/const VERSION = '([^']+)'/) || [])[1],
    }));
    assert.match(versions.app, /^\d+\.\d+\.\d+$/);
    assert.equal(versions.page, versions.app, 'index.html et app.js');
    assert.equal(versions.sw, versions.app, 'sw.js et app.js');
    assert.equal(await v.page.evaluate(() => sessionStorage.getItem('jdb_heal')), null);
    await v.ctx.close();

    // Ancienne page (venue du cache) + nouveau script : un rechargement, puis tout fonctionne
    const a = await newPage(browser, base);
    const navA = navs(a.page);
    let first = true;
    await a.page.route(isDoc, async route => {
      const response = await route.fetch();
      let body = await response.text();
      if (first && route.request().isNavigationRequest()) { first = false; body = body.replace(/data-app-version="[^"]+"/, 'data-app-version="2.9.9"'); }
      await route.fulfill({ response, body });
    });
    await a.page.goto(BASE);
    await a.page.waitForSelector('.chapter-card', { timeout: 20000 });
    await a.page.waitForTimeout(800);
    assert.equal(navA.length, 2, 'un seul rechargement');
    assert.equal(await a.page.textContent('#sWritten'), '38');
    assert.equal(await a.page.evaluate(() => sessionStorage.getItem('jdb_heal')), null, 'compteur remis à zéro');
    assert.equal(await a.page.evaluate(() => window.__fbStore.writes.filter(w => w.data && w.data.chapters).length), 0, 'aucune écriture pendant le flottement');
    await a.ctx.close();

    // Nouvelle page + ancien script (venu du cache) : même remède
    const b = await newPage(browser, base);
    const navB = navs(b.page);
    let old = true;
    await b.page.route(u => u.origin + u.pathname === BASE + 'app.js', async route => {
      if (old) { old = false; await route.fulfill({ contentType: 'application/javascript', body: '/* ancienne version, sans numéro */' }); return; }
      await route.continue();
    });
    await b.page.goto(BASE);
    await b.page.waitForSelector('.chapter-card', { timeout: 20000 });
    await b.page.waitForTimeout(800);
    assert.equal(navB.length, 2, 'un seul rechargement');
    assert.equal(await b.page.evaluate(() => window.__jdbVersion), versions.app);
    await b.ctx.close();

    // Désaccord qui persiste : deux tentatives, puis on n'insiste pas (pas de boucle de rechargement)
    const c = await newPage(browser, base);
    const navC = navs(c.page);
    await c.page.route(isDoc, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace(/data-app-version="[^"]+"/, 'data-app-version="2.9.9"') });
    });
    await c.page.goto(BASE);
    await c.page.waitForSelector('.chapter-card', { timeout: 30000 });
    await c.page.waitForTimeout(2500);
    assert.equal(navC.length, 3, 'deux rechargements au plus : ' + navC.length);
    assert.equal(await c.page.textContent('#sWritten'), '38', 'l\'application finit par démarrer quand même');
    await c.ctx.close();
  });

  await browser.close();
  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
  process.exit(failures ? 1 : 0);
})();

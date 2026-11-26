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
    if (seenNews) localStorage.setItem('jdb_whatsnew', '5');
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
    assert.match(await page.textContent('#dbDeadline .dl-date'), /\d{4}$/);
    assert.match(await page.textContent('#dbDeadline .dl-count'), /^J\u2212300$/, 'compte à rebours');
    assert.match(await page.textContent('#dbDeadline .dl-verdict'), /à tenir|dans les temps|en retard/);
    assert.match(await page.textContent('#paceNeed'), /p\.\/sem\./, 'rythme à tenir affiché');
    // L'étagère : un livre par chapitre, celui de la partie en cours porte le marque-page
    assert.equal(await page.locator('#shelfBooks .book').count(), 7);
    assert.match(await page.getAttribute('#shelfBooks .book.is-current', 'aria-label'), /Introduction/);
    assert.match(await page.textContent('#levelNext'), /avant le grade suivant/);
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
    await page.waitForFunction(() => /^33\s%$/.test(document.getElementById('gaugePct').textContent)); // le grand chiffre monte jusqu'à sa valeur
    assert.ok(await page.isVisible('#journalCard svg.hm-grid'), 'journal et calendrier de régularité visibles');
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
    assert.match(await page.textContent('#jcEntries'), /Bonne séance à la BU/);
    // Clic sur un livre de l'étagère : on arrive sur son chapitre
    await page.click('#shelfBooks .book[data-book="c3"]');
    await page.waitForSelector('#ch-c3.flash');
    assert.match(await page.textContent('#shelfReadout'), /Méthodologie\s: 1 page sur 40, 3\s%/, 'le détail du livre s\'affiche au-dessus de l\'étagère');
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
    assert.match(await page.textContent('#docxSummary'), /5\s270 mots, ≈ 12 pages\. 5 parties détectées, 4 sous-sections/, 'douze pages, comme dans le traitement de texte');
    assert.equal(await page.inputValue('#docxPages'), '12');
    assert.match(await page.textContent('#docxPagesHint'), /mise en page \(Times New Roman 12, interligne 1,5, A4\)/, 'le nombre de pages vient de la mise en page du fichier');
    assert.deepEqual(page._requests.filter(u => /cdnjs|jszip/i.test(u)), [], 'le fichier Word est ouvert sans bibliothèque extérieure (donc aussi hors ligne)');
    assert.equal(await page.isVisible('#docxScopeRow'), false, 'plan vide : pas de question superflue');
    assert.deepEqual(await page.$$eval('#docxModes input', os => os.map(o => [o.value, o.checked])), [['match', true], ['add', false]], 'tout le manuscrit, ou un seul chapitre');
    assert.equal(await page.isVisible('#docxRecount'), false);
    await page.fill('#docxTotal', '120');
    await page.screenshot({ path: path.join(SHOTS, '21-06-word-apercu.png') });
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => c.title), ['Introduction générale', 'Chapitre 1 : État de l’art', 'Chapitre 2 : Méthodologie', 'Conclusion générale']);
    // Dix pages suivies sur douze : les pages liminaires et la bibliographie ne comptent pas
    assert.equal(written(d), 10);
    assert.deepEqual(d.chapters.map(c => (c.subsections.length ? c.subsections.map(s => s.writtenPages) : c.writtenPages)), [2, [2, 3], [1, 1], 1],
      'chaque partie reçoit l\'entier le plus proche de sa longueur, et le total est respecté');
    assert.ok(!d.activity || !d.activity[TODAY], 'première synchro non comptée');
    assert.equal(d.docFiles.these.inclWords, 4645);
    assert.ok(d.docFiles.these.wpp >= 450 && d.docFiles.these.wpp <= 475, 'mots par page de CE document : ' + d.docFiles.these.wpp);
    assert.deepEqual([d.docFiles.these.pv, d.docFiles.these.src, d.docFiles.these.pages, d.docFiles.these.k], [2, 'layout', 12, null]);
    assert.equal(d.chapters[1].docFile, 'these');
    assert.equal(await page.textContent('#wordBtn'), 'Synchroniser mon document');

    // Le lendemain : le même fichier, enrichi. Un geste, pas d'aperçu.
    await page.waitForTimeout(400);
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false, 'pas d\'aperçu pour un fichier connu');
    assert.match((await toasts(page)).join('|'), /these\.docx synchronisé : \+1,3 p\. aujourd'hui/);
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1.3, 'activité au mot près : 600 mots, à 460 mots par page dans ce document');
    assert.equal(written(d), 11);
    assert.equal(d.docFiles.these.inclWords, 5245);
    assert.equal(d.docFiles.these.pages, 13);
    assert.match(await page.textContent('#tdVal'), /^1,3 \//);
    // Annuler
    await page.click('.toast .toast-act');
    await page.waitForTimeout(200);
    d = await docOf(page, uid);
    assert.equal(written(d), 10);
    assert.ok(!d.activity || !d.activity[TODAY], 'activité annulée : ' + JSON.stringify(d.activity));
    assert.equal(d.docFiles.these.inclWords, 4645);
    // On recommence, puis le même fichier une 2e fois : « déjà à jour »
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)));
    await page.waitForTimeout(300);
    await sendDocx(page, 'these_v2.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)));
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], 1.3, 'pas de double comptage');

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
    assert.equal(d.activity[TODAY], 2.39, '+504 mots (titre compris) de la nouvelle partie : ' + d.activity[TODAY]);

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
    // Ce document était suivi avec l'ancien calcul (380 mots par page) : l'aperçu revient une fois, pour expliquer le nouveau
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.ok(await page.isVisible('#docxRecount'), 'le nouveau comptage des pages est expliqué');
    assert.match(await page.textContent('#docxSummary'), /≈ 13 pages/);
    assert.equal(await page.isChecked('#docxCount'), true);
    assert.match(await page.textContent('#docxCountLbl'), /Ajouter -0,1\sp\./, 'le journal suit les mots, pas le recomptage');
    assert.match(await page.textContent('#docxRows'), /3 → 2 p\./, 'chaque partie montre son ancien et son nouveau nombre de pages');
    await page.click('#docxApply');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé/.test(t.textContent)), null, { timeout: 15000 });
    assert.match((await toasts(page)).join('|'), /these\.docx synchronisé : pages recomptées \(14 → 11\), -0,1 p\. aujourd'hui/);
    let d = await docOf(page, uid);
    assert.equal(written(d), 11, 'treize pages dans le document, onze hors pages liminaires et bibliographie');
    assert.equal(d.activity[TODAY], -0.11, '50 mots de moins, à 463 mots par page');
    assert.equal(d.journal[TODAY][0].n, 'Relecture et corrections (synchro Word)');
    assert.equal(await page.textContent('#tdStreak'), '2', 'la série continue');
    assert.deepEqual([d.docFiles.these.pv, d.docFiles.these.src, d.docFiles.these.pages], [2, 'layout', 13]);
    // Ensuite, tout redevient un geste
    await page.waitForTimeout(400);
    await sendDocx(page, 'these_v4.docx', 'these.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false);
    d = await docOf(page, uid);
    assert.equal(d.activity[TODAY], -0.11);
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
    assert.deepEqual(meth.subsections.map(s => s.writtenPages), [2, 1], 'trois pages suivies (la quatrième est la bibliographie) : Terrain 2, Entretiens 1,2');
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
  await test('Word sans styles de titre : titres repérés à leur mise en forme (gras, taille, numérotation), plan à vérifier', async () => {
    const uid = 'u_manuel';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'manuel@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    await sendDocx(page, 'manuel.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /manuel\.docx : 2\s554 mots, ≈ 12 pages\. 4 parties détectées, 4 sous-sections/);
    assert.ok(await page.isVisible('#docxHeadNote'), 'on dit d\'où vient le plan');
    assert.match(await page.textContent('#docxHeadNote'), /repéré vos titres à leur mise en forme/);
    assert.deepEqual(await page.$$eval('#docxRows .dx-row .dx-title', els => els.map(e => e.textContent)),
      ['INTRODUCTION', 'CHAPITRE 1 : Le fer', '1.1 Les forges', '1.2 Les ingénieurs', 'CHAPITRE 2 : La pierre', '2.1 Les carrières', '2.2 Les maçons', 'CONCLUSION'],
      'ni la page de garde, ni le sommaire, ni la légende de figure, ni la phrase en gras ne sont pris pour des titres');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => [c.title, c.subsections.map(s => s.title)]),
      [['INTRODUCTION', []], ['CHAPITRE 1 : Le fer', ['1.1 Les forges', '1.2 Les ingénieurs']], ['CHAPITRE 2 : La pierre', ['2.1 Les carrières', '2.2 Les maçons']], ['CONCLUSION', []]]);
    const before = written(d);
    // La suite : quatre paragraphes de plus dans « 2.1 ». Le plan est reconnu, un seul geste.
    await sendDocx(page, 'manuel_v2.docx', 'manuel.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /manuel\.docx synchronisé/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false, 'pas d\'aperçu : rien de nouveau dans le plan');
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(written(d), before + 1, 'une page de plus');
    assert.ok(d.activity[TODAY] > 0.5 && d.activity[TODAY] < 1.5, 'journal du jour : ' + d.activity[TODAY]);
    // Un document qui a ses styles de titre n'affiche pas cet avertissement
    await sendDocx(page, 'these.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.isVisible('#docxHeadNote'), false);
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
    assert.equal(written(d), 10);

    // On écrit dans Word, on enregistre, on revient sur l'onglet : rien à faire
    await page.waitForTimeout(1100);
    await page.evaluate(async b => { await window.__writeDocx(b); }, b64('these_v2.docx'));
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé\s:\s\+1,3\sp\./.test(t.textContent)), null, { timeout: 15000 });
    d = await docOf(page, uid);
    assert.equal(written(d), 11);
    assert.equal(d.activity[TODAY], 1.3);

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
    await page.click('#linkedList >> text=Délier');
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
    // Plan déjà là, document inconnu : on choisit ce qu'on en fait, et l'on peut changer de document
    assert.deepEqual(await page.$$eval('#docxModes input', os => os.map(o => o.value)), ['match', 'replace', 'add', 'chapter']);
    await page.click('#docxModal >> text=Changer de document');
    await page.waitForSelector('#docxStep1:not(.hidden)');
    await page.click('#docxModal >> text=Fermer');
    // Un PDF : message clair, pas d'erreur
    await drop('faux.pdf', 'these.pdf', 'application/pdf');
    await page.waitForSelector('#docxError:not(.hidden)');
    assert.match(await page.textContent('#docxError'), /PDF/);
    assert.deepEqual(page._errors.filter(e => !/document :/.test(e)), []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('PDF (LaTeX, Overleaf, Pages…) : pages exactes, plan par les signets, les balises ou la mise en forme, mise à jour en un geste', async () => {
    const uid = 'u_pdf';
    const sendPdf = (page, fixture, name) => page.setInputFiles('#docxInput', { name: name || fixture, mimeType: 'application/pdf', buffer: fs.readFileSync(FIX(fixture)) });
    let { ctx, page } = await newPage(browser, { user: { uid, email: 'pdf@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    assert.deepEqual(page._requests.filter(u => /vendor\/pdfjs/.test(u)), [], 'le lecteur de PDF n\'est chargé que si l\'on ouvre un PDF');
    await sendPdf(page, 'memoire.pdf');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#docxSummary'), /memoire\.pdf : 3\s517 mots, 13 pages\. 6 parties détectées, 4 sous-sections\. Pages liminaires non comptées : 1 p\./, 'treize pages, sans « environ »');
    assert.equal(await page.inputValue('#docxPages'), '13');
    assert.match(await page.textContent('#docxPagesHint'), /pagination du PDF, exacte · plan lu dans ses signets/);
    const rows = () => page.$$eval('#docxRows .dx-row', rs => rs.map(r => [r.querySelector('.dx-title').textContent, r.querySelector('input').checked, r.querySelector('.dx-meta b').textContent]));
    assert.deepEqual(await rows(), [
      ['Remerciements', false, '1 p.'],
      ['Introduction générale', true, '2 p.'],
      ['Chapitre 1 : État de l’art', true, '4 p.'], ['1.1 Contexte général', true, '2 p.'], ['1.2 Travaux existants', true, '2 p.'],
      ['Chapitre 2 : Méthodologie', true, '3 p.'], ['2.1 Terrain', true, '2 p.'], ['2.2 Entretiens', true, '1 p.'],
      ['Conclusion générale', true, '1 p.'],
      ['Bibliographie', false, '1 p.'],
    ], 'remerciements et bibliographie laissés de côté, comme pour un fichier Word');
    assert.ok(page._requests.some(u => /vendor\/pdfjs\/pdf\.min\.js/.test(u)) && page._requests.some(u => /vendor\/pdfjs\/pdf\.worker\.min\.js/.test(u)), 'lecteur servi par le site lui-même');
    assert.deepEqual(page._requests.filter(u => /pdf/i.test(u) && !u.startsWith(BASE)), [], 'le PDF est lu sans aucun service extérieur');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => [c.title, c.subsections.length ? c.subsections.map(s => s.writtenPages) : c.writtenPages]),
      [['Introduction générale', 2], ['Chapitre 1 : État de l’art', [2, 2]], ['Chapitre 2 : Méthodologie', [2, 1]], ['Conclusion générale', 1]]);
    let f = d.docFiles.memoire_pdf;
    assert.deepEqual([f.name, f.src, f.pages, f.pv], ['memoire.pdf', 'pdf', 13, 2], 'un PDF est un document à part entière (clé distincte de memoire.docx)');
    assert.ok(f.inclWords > 2900 && f.inclWords < 3400, 'mots des parties suivies : ' + f.inclWords);
    // La suite du travail : le même fichier, cinq paragraphes de plus. Un seul geste, pas d'aperçu.
    await sendPdf(page, 'memoire_v2.pdf', 'memoire.pdf');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /memoire\.pdf synchronisé/.test(t.textContent)), null, { timeout: 30000 });
    assert.match((await toasts(page)).join('|'), /memoire\.pdf synchronisé : \+1,\d p\. aujourd'hui/);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.docFiles.memoire_pdf.pages, 14);
    assert.deepEqual(d.chapters[2].subsections.map(s => s.writtenPages), [2, 2], 'le chapitre 2 passe de trois à quatre pages (2,5 + 1,6 arrondis ensemble)');
    assert.equal(written(d), 11, 'une page de plus au total');
    assert.ok(d.activity[TODAY] > 1 && d.activity[TODAY] < 2, 'journal du jour : au mot près, ' + d.activity[TODAY]);
    assert.deepEqual(page._errors, []);
    await ctx.close();

    // Sans signets : les titres balisés (export Word « accessible »), sinon la mise en forme. Le même plan.
    for (const [fixture, hint] of [['memoire-balise.pdf', /plan lu dans ses titres balisés/], ['memoire-sans-signets.pdf', /titres repérés d'après la mise en forme, à vérifier/]]) {
      ({ ctx, page } = await newPage(browser, { user: { uid: 'u_pdf2', email: 'pdf2@example.com' } }));
      await page.goto(BASE);
      await page.waitForSelector('.onboarding');
      await page.evaluate(() => { window.showOpenFilePicker = undefined; });
      await sendPdf(page, fixture);
      await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 30000 });
      assert.match(await page.textContent('#docxSummary'), /13 pages\. 6 parties détectées, 4 sous-sections/, fixture);
      assert.match(await page.textContent('#docxPagesHint'), hint);
      assert.deepEqual((await page.$$eval('#docxRows .dx-row .dx-title', els => els.map(e => e.textContent))).slice(1, 5), ['Introduction générale', 'Chapitre 1 : État de l’art', '1.1 Contexte général', '1.2 Travaux existants'], fixture);
      assert.deepEqual(page._errors, []);
      await ctx.close();
    }
  });

  /* ------------------------------------------------------------ */
  await test('LibreOffice (.odt) : la pagination enregistrée dans le fichier, exacte, comme pour Word', async () => {
    const uid = 'u_odt';
    const ODT = 'application/vnd.oasis.opendocument.text';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'odt@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    // Enregistré par LibreOffice, mise en page terminée : ses sauts de page sont dans le fichier
    await page.setInputFiles('#docxInput', { name: 'memoire.odt', mimeType: ODT, buffer: fs.readFileSync(FIX('memoire.odt')) });
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /memoire\.odt : 3\s610 mots, 13 pages\. 6 parties détectées, 4 sous-sections\. Pages liminaires non comptées : 1 p\./, 'treize pages, comme dans LibreOffice, sans « environ »');
    assert.match(await page.textContent('#docxPagesHint'), /pagination enregistrée par LibreOffice, exacte/);
    assert.deepEqual(await page.$$eval('#docxRows .dx-row', rs => rs.map(r => [r.querySelector('.dx-title').textContent, r.querySelector('.dx-meta b').textContent])), [
      ['Remerciements', '1 p.'], ['Introduction générale', '2 p.'],
      ['Chapitre 1 : État de l’art', '4 p.'], ['1.1 Contexte général', '2 p.'], ['1.2 Travaux existants', '2 p.'],
      ['Chapitre 2 : Méthodologie', '3 p.'], ['2.1 Terrain', '2 p.'], ['2.2 Entretiens', '1 p.'],
      ['Conclusion générale', '1 p.'], ['Bibliographie', '1 p.'],
    ], 'les mêmes pages que le PDF du même document');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    const d = await docOf(page, uid);
    assert.deepEqual([d.docFiles.memoire.src, d.docFiles.memoire.pages], ['word', 13]);
    // Le même document « à plat » (.fodt), sans mise en page enregistrée : une estimation, annoncée comme telle
    await page.setInputFiles('#docxInput', { name: 'brouillon.fodt', mimeType: 'application/vnd.oasis.opendocument.text-flat-xml', buffer: fs.readFileSync(FIX('memoire.fodt')) });
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /brouillon\.fodt : 3\s610 mots, ≈ 9 pages/);
    assert.match(await page.textContent('#docxPagesHint'), /estimation sans mise en page/);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  // Un PDF minimal, comme celui de Google Docs : des pages A4 et un signet par titre (page, hauteur depuis le haut)
  const fakePdf = (pages, marks) => {
    const hex = t => 'FEFF' + [...t].map(c => c.charCodeAt(0).toString(16).padStart(4, '0')).join('').toUpperCase();
    const objs = ['', ''];
    const first = 3;                                 // objets 3 … : les pages
    const out0 = first + pages;                      // racine des signets
    objs[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${out0} 0 R >>`;
    objs[1] = `<< /Type /Pages /Count ${pages} /MediaBox [0 0 595.3 841.9] /Kids [${Array.from({ length: pages }, (_, i) => `${first + i} 0 R`).join(' ')}] >>`;
    for (let i = 0; i < pages; i++) objs.push('<< /Type /Page /Parent 2 0 R >>');
    objs.push(`<< /Type /Outlines /First ${out0 + 1} 0 R /Last ${out0 + marks.length} 0 R /Count ${marks.length} >>`);
    marks.forEach((m, i) => objs.push(`<< /Title <${hex(m[0])}> /Parent ${out0} 0 R${i + 1 < marks.length ? ` /Next ${out0 + i + 2} 0 R` : ''} /Dest [${first + m[1]} 0 R /XYZ 72 ${(841.9 - m[2]).toFixed(2)} 0] >>`));
    let s = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(s.length); s += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = s.length;
    s += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    s += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(s, 'latin1');
  };

  await test('Google Docs : document lié par son lien, pages exactes, mise à jour en un geste, sur tous les appareils', async () => {
    const uid = 'u_gdoc';
    const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCd';
    const KEY = 'g_' + ID.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const TOP = 72;
    const MID = 72 + 697.9 / 2;
    // Position de chaque titre dans le « vrai » document : quinze pages, puis seize après une séance d'écriture
    const marksOf = shift => [['Ma thèse de test', 0, TOP], ['Introduction générale', 1, TOP], ['Chapitre 1 : État de l’art', 3 + shift, TOP], ['1.1 Contexte général', 3 + shift, MID],
      ['1.2 Travaux existants', 6 + shift, TOP], ['1.2.1 Un sous-sous-titre', 8 + shift, TOP], ['Chapitre 2 : Méthodologie', 9 + shift, TOP], ['2.1 Terrain', 9 + shift, TOP + 69.79],
      ['2.2 Entretiens', 11 + shift, TOP], ['Conclusion générale', 12 + shift, TOP], ['Bibliographie', 13 + shift, TOP]];
    const remote = { file: 'these.docx', pages: 15, shift: 0, shared: true, pdf: true };
    const hits = { docx: 0, pdf: 0, txt: 0 };
    const serve = async ctx => ctx.route(u => u.hostname === 'docs.google.com', route => {
      const u = new URL(route.request().url());
      const fmt = u.searchParams.get('format');
      if (!remote.shared || !u.pathname.includes(`/document/d/${ID}/export`)) return route.abort('failed'); // non partagé : Google renvoie vers sa page de connexion
      hits[fmt]++;
      const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Disposition',
        'content-disposition': `attachment; filename="Ma these.${fmt}"; filename*=UTF-8''Ma%20th%C3%A8se.${fmt}` };
      if (fmt === 'docx') return route.fulfill({ status: 200, headers, contentType: DOCX, body: fs.readFileSync(FIX(remote.file)) });
      if (fmt === 'pdf') return remote.pdf ? route.fulfill({ status: 200, headers, contentType: 'application/pdf', body: fakePdf(remote.pages, marksOf(remote.shift)) }) : route.fulfill({ status: 500, headers, body: 'erreur' });
      return route.fulfill({ status: 200, headers, contentType: 'text/plain; charset=utf-8', body: 'Texte de ' + remote.file });
    });
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'gdoc@example.com' } });
    await serve(ctx);
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; }); // téléphone, Safari, Firefox : pas de fichier lié possible
    await page.evaluate(() => window.openDocxModal());
    await page.waitForSelector('#gdocUrl');
    assert.equal(await page.textContent('#docxAddTitle'), 'Choisir mon document');
    // Ce qui n'est pas un lien, ou pas un document texte : on dit quoi coller
    await page.fill('#gdocUrl', 'mon document');
    await page.click('#gdocBox button');
    assert.match(await page.textContent('#docxError'), /Ce n'est pas un lien que le Journal sait lire/);
    await page.fill('#gdocUrl', 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/edit');
    await page.click('#gdocBox button');
    assert.match(await page.textContent('#docxError'), /n'est pas celui d'un document texte \(Google Docs\)/);
    // Document pas encore partagé : on explique le réglage à changer
    remote.shared = false;
    await page.fill('#gdocUrl', `https://docs.google.com/document/d/${ID}/edit`);
    await page.click('#gdocBox button');
    await page.waitForFunction(() => /Tous les utilisateurs disposant du lien/.test(document.getElementById('docxError').textContent), null, { timeout: 15000 });
    assert.equal(await page.inputValue('#gdocUrl'), `https://docs.google.com/document/d/${ID}/edit`, 'le lien reste dans le champ pour réessayer');
    remote.shared = true;
    // Le lien copié depuis la barre d'adresse, avec ses paramètres
    await page.fill('#gdocUrl', `https://docs.google.com/document/d/${ID}/edit?tab=t.0#heading=h.abc123`);
    await page.press('#gdocUrl', 'Enter');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 20000 });
    assert.match(await page.textContent('#docxSummary'), /^Ma thèse : 5\s270 mots, 15 pages\. 5 parties détectées, 4 sous-sections\. Pages liminaires non comptées : 1 p\.$/, 'le titre du document et sa vraie pagination');
    assert.equal(await page.inputValue('#docxPages'), '15');
    assert.match(await page.textContent('#docxPagesHint'), /pagination de Google Docs, exacte/);
    await page.screenshot({ path: path.join(SHOTS, '41-01-google-docs.png') });
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Google Doc lié/.test(t.textContent)), null, { timeout: 8000 });
    await flush(page);
    let d = await docOf(page, uid);
    // Les pages de chaque partie viennent des signets du PDF : 2 ; 0,5 + 2,5 ; 3 ; 0,1 + 1,9 ; 1 ; 1
    assert.deepEqual(d.chapters.map(c => (c.subsections.length ? c.subsections.map(s => s.writtenPages) : c.writtenPages)), [2, [3, 3], [2, 1], 1]);
    const f = d.docFiles[KEY];
    assert.deepEqual([f.name, f.gdoc, f.src, f.pages, f.pv, f.k], ['Ma thèse', ID, 'pdf', 15, 2, null]);
    assert.match(f.sig, /^[a-z0-9]+\.[a-z0-9]+$/, 'signature du texte gardée pour savoir s\'il change');
    assert.ok(!JSON.stringify(d).includes('recherche doctorale'), 'le texte du document n\'est jamais enregistré');
    assert.match(await page.textContent('#tdPrimary'), /Synchroniser/);
    assert.match(await page.textContent('#tdCap'), /Ma thèse/);
    assert.deepEqual(hits, { docx: 1, pdf: 1, txt: 1 });
    // Rien n'a changé dans le document : on ne relit que son texte (léger), pas le fichier ni le PDF
    await page.click('#tdPrimary');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    assert.deepEqual(hits, { docx: 1, pdf: 1, txt: 2 });
    // On a écrit dans Google Docs : un geste, pas d'aperçu
    Object.assign(remote, { file: 'these_v2.docx', pages: 16, shift: 1 });
    await page.waitForTimeout(400);
    await page.click('#tdPrimary');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Ma thèse synchronisé\s:\s\+1,5\sp\./.test(t.textContent)), null, { timeout: 20000 });
    assert.equal(await page.isVisible('#docxModal'), false);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.docFiles[KEY].pages, 16);
    assert.equal(written(d), 13, 'une page de plus, lue dans le PDF');
    assert.equal(d.activity[TODAY], 1.49, '600 mots de plus, à 403 mots par page dans ce document');
    assert.deepEqual(hits, { docx: 2, pdf: 2, txt: 3 });
    // PDF indisponible (document très lourd, Google qui peine) : la mise en page du fichier prend le relais
    Object.assign(remote, { file: 'these_v3.docx', pdf: false });
    await page.waitForTimeout(400);
    await page.click('#tdPrimary');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 20000 });
    assert.match(await page.textContent('#docxPagesHint'), /calculé d'après la mise en page/);
    assert.match(await page.textContent('#docxSummary'), /≈ 14 pages/);
    await page.click('#docxModal >> text=Changer de document');
    assert.equal(await page.textContent('#docxAddTitle'), 'Ajouter un document, ou en changer');
    assert.match(await page.textContent('#linkedList'), /Ma thèse.*Google Docs · synchro : aujourd'hui · 16 p\./s);
    assert.equal(await page.getAttribute('#linkedList a.lk-btn', 'href'), `https://docs.google.com/document/d/${ID}/edit`);
    await page.click('#docxModal >> text=Fermer');
    // Le partage a été retiré : message clair, rien n'est perdu
    remote.shared = false;
    await page.click('#tdPrimary');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Tous les utilisateurs disposant du lien/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(written(await docOf(page, uid)), 13);
    assert.deepEqual(page._errors.filter(e => !/Google Docs|Failed to load resource|net::ERR/.test(e)), []);
    await ctx.close();

    // Un autre appareil (un téléphone) : le lien est dans le compte, il n'y a rien à refaire
    Object.assign(remote, { shared: true, pdf: true, file: 'these_v2.docx' });
    const other = await newPage(browser, { user: { uid, email: 'gdoc@example.com' }, store: { [`users/${uid}/thesis/main`]: d }, viewport: { width: 390, height: 844 } });
    await serve(other.ctx);
    await other.page.goto(BASE);
    await other.page.waitForSelector('.chapter-card');
    await other.page.waitForFunction(() => document.getElementById('tdPrimary').textContent.includes('Synchroniser'), null, { timeout: 8000 });
    assert.match(await other.page.textContent('#tdCap'), /Ma thèse/);
    // Délier : le plan et les pages restent, le document n'est plus relu
    await other.page.evaluate(() => window.openDocxModal());
    await other.page.click('#linkedList >> text=Délier');
    await other.page.waitForFunction(() => document.getElementById('tdPrimary').textContent.trim() === '+1 page');
    await flush(other.page);
    const d2 = await docOf(other.page, uid);
    assert.deepEqual(d2.docFiles, {});
    assert.equal(written(d2), 13);
    assert.ok(d2.chapters.every(c => !c.docFile && c.subsections.every(s => !s.docFile)), 'les parties ne sont plus rattachées au document');
    await other.page.click('.toast .toast-act'); // Annuler
    await other.page.waitForFunction(() => document.getElementById('tdPrimary').textContent.includes('Synchroniser'));
    await other.ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Dropbox : fichier lié par son lien de partage, relu tout seul, sur tous les appareils ; liens refusés avec une explication', async () => {
    const uid = 'u_dbx';
    const SHARE = 'https://www.dropbox.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&st=abcd1234&dl=0';
    const DL = 'https://dl.dropboxusercontent.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&dl=1';
    const PDF_DL = 'https://dl.dropboxusercontent.com/s/09ctqeg1hd9soi2/memoire.pdf?dl=1';
    const remote = { file: 'these.docx', up: true };
    const hits = { HEAD: 0, GET: 0 };
    const serve = ctx => ctx.route(u => u.hostname === 'dl.dropboxusercontent.com' || u.hostname === 'www.dropbox.com', route => {
      const req = route.request();
      const url = req.url();
      // www.dropbox.com redirige sans autoriser la lecture : le Journal ne doit jamais s'y adresser
      if (!remote.up || (url !== DL && url !== PDF_DL)) return route.abort('failed');
      const pdf = url === PDF_DL;
      if (!pdf) hits[req.method()]++;
      const body = fs.readFileSync(FIX(pdf ? 'memoire.pdf' : remote.file));
      const name = pdf ? 'memoire.pdf' : 'Ma%20th%C3%A8se.docx';
      const headers = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Accept-Ranges, Content-Disposition, Content-Encoding, Content-Length, Content-Range',
        'content-disposition': `attachment; filename="document"; filename*=UTF-8''${name}`, 'cache-control': 'max-age=60' };
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...headers, 'content-length': String(body.length) }, contentType: pdf ? 'application/pdf' : 'application/binary', body: '' });
      return route.fulfill({ status: 200, headers, contentType: pdf ? 'application/pdf' : 'application/binary', body });
    });
    let { ctx, page } = await newPage(browser, { user: { uid, email: 'dbx@example.com' } });
    await serve(ctx);
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    await page.evaluate(() => window.openDocxModal());
    await page.waitForSelector('#gdocUrl');
    // Ce qu'un navigateur ne peut pas lire est refusé avec la marche à suivre
    for (const [link, msg] of [
      ['https://www.dropbox.com/scl/fo/6y7hlsyisit2rb0bjepzh/AKOfmeyr?rlkey=x&dl=0', /mène à un dossier/],
      ['https://1drv.ms/w/s!AbCdEfGh', /OneDrive et SharePoint ne laissent pas un site lire/],
      ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view?usp=sharing', /fichier stocké dans Google Drive, pas à un document Google Docs/],
      ['https://www.overleaf.com/read/abcdefgh', /téléchargez le PDF/],
    ]) {
      await page.fill('#gdocUrl', link);
      await page.click('#gdocBox button');
      assert.match(await page.textContent('#docxError'), msg, link);
    }
    // Le lien de partage Dropbox, tel qu'on le copie
    await page.fill('#gdocUrl', SHARE);
    await page.press('#gdocUrl', 'Enter');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 20000 });
    assert.match(await page.textContent('#docxSummary'), /^Ma thèse\.docx : 5\s270 mots, ≈ 12 pages\. 5 parties détectées, 4 sous-sections/, 'le nom du fichier vient de Dropbox');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Fichier lié/.test(t.textContent)), null, { timeout: 8000 });
    assert.match((await toasts(page)).join('|'), /Fichier lié : vos pages se mettront à jour toutes seules, sur tous vos appareils/);
    await flush(page);
    let d = await docOf(page, uid);
    const key = Object.keys(d.docFiles)[0];
    assert.match(key, /^u_[a-z0-9]+$/);
    let f = d.docFiles[key];
    assert.deepEqual([f.name, f.url, f.src, f.pv, f.gdoc], ['Ma thèse.docx', DL, 'layout', 2, null], 'on garde l\'adresse lisible du fichier, pas le lien d\'origine');
    assert.match(f.sig, /^\d+\.[a-z0-9]+$/, 'signature légère : la taille du fichier');
    assert.deepEqual(hits, { HEAD: 1, GET: 1 });
    const pages1 = written(d);
    assert.equal(await page.textContent('#wordBtn'), 'Synchroniser mon document');
    await page.evaluate(() => window.openDocxModal());
    assert.match(await page.textContent('#linkedList .lk-meta'), /lié par son lien \(Dropbox\) · synchro : aujourd'hui · 12 p\./);
    assert.equal(await page.getAttribute('#linkedList a.lk-btn', 'href'), 'https://www.dropbox.com/scl/fi/m9glhahs4vqurgqr3tp7o/Ma%20th%C3%A8se.docx?rlkey=jeiam6bpfmw4ky2g5ndwbc6js&dl=0', '« Ouvrir » mène à la page Dropbox du fichier');
    await page.click('#docxModal >> text=Fermer');
    // À la demande, le fichier est relu en entier : rien n'a changé
    await page.click('#wordBtn');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    assert.deepEqual(hits, { HEAD: 2, GET: 2 });
    // On a écrit (le fichier a grossi) : au retour dans le Journal, une vérification légère puis la mise à jour, sans rien demander
    remote.file = 'these_v2.docx';
    await page.reload();
    await page.waitForSelector('.chapter-card');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Ma thèse\.docx synchronisé/.test(t.textContent)), null, { timeout: 20000 });
    assert.match((await toasts(page)).join('|'), /Ma thèse\.docx synchronisé : \+1,\d p\. aujourd'hui/);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(written(d), pages1 + 1, 'une page de plus');
    assert.notEqual(d.docFiles[key].sig, f.sig);
    assert.deepEqual(hits, { HEAD: 3, GET: 3 });
    await ctx.close();

    // Un autre appareil (téléphone) : le document est déjà lié, rien n'a changé, une seule requête légère
    ({ ctx, page } = await newPage(browser, { user: { uid, email: 'dbx@example.com' }, store: { [`users/${uid}/thesis/main`]: d }, viewport: { width: 390, height: 844 } }));
    await serve(ctx);
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    await page.waitForTimeout(1500);
    assert.deepEqual(hits, { HEAD: 4, GET: 3 }, 'fichier inchangé : pas de nouveau téléchargement');
    // Lien coupé (partage désactivé) : on le dit, les pages ne bougent pas
    remote.up = false;
    await page.evaluate(() => window.wordAction());
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Le Journal n'a pas pu lire ce lien/.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(written(await docOf(page, uid)), pages1 + 1);
    remote.up = true;
    // Un PDF sur Dropbox : pages exactes, lu directement depuis son lien
    await page.evaluate(() => window.openDocxModal());
    await page.fill('#gdocUrl', 'https://www.dropbox.com/s/09ctqeg1hd9soi2/memoire.pdf?dl=0');
    await page.click('#gdocBox button');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 30000 });
    assert.match(await page.textContent('#docxSummary'), /^memoire\.pdf : 3\s517 mots, 13 pages/);
    assert.match(await page.textContent('#docxPagesHint'), /pagination du PDF, exacte · plan lu dans ses signets/);
    assert.deepEqual(page._errors.filter(e => !/Lien :|Failed to fetch|net::ERR/.test(e)), []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Un fichier par chapitre : « Ajouter un chapitre », nombre de pages corrigé et retenu, document oublié', async () => {
    const uid = 'u_ajout';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'ajout@example.com' }, store: { [`users/${uid}/thesis/main`]: clone(V1_DOC) } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    assert.equal(await page.isVisible('#wordChange'), false, 'pas encore de document : rien à changer');
    // Un fichier dont rien ne correspond au plan, et dont le nom dit « chapitre »
    await sendDocx(page, 'chapitre-methodo.docx', 'chapitre-5-resultats.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.isChecked('#docxModes input[value="add"]'), true, 'proposé comme un chapitre de plus');
    assert.equal(await page.inputValue('#docxNewTitle'), 'Chapitre 5 resultats');
    await page.fill('#docxNewTitle', 'Chapitre 5 : Résultats');
    assert.deepEqual(await page.$$eval('#docxRows .dx-row', rs => rs.map(r => [r.querySelector('.dx-title').textContent, r.querySelector('input[type=checkbox]').checked])),
      [['Chapitre 5 : Résultats', true], ['Terrain', true], ['Entretiens', true], ['Bibliographie', false]]);
    assert.match(await page.textContent('#docxRows .dx-ch .dx-map'), /nouveau chapitre/);
    assert.equal(await page.textContent('#docxApply'), 'Ajouter ce chapitre');
    // Les autres choix restent à portée de main
    await page.check('#docxModes input[value="chapter"]');
    assert.ok(await page.isVisible('#docxScope'));
    assert.match(await page.textContent('#docxRows .dx-ch .dx-map'), /ce fichier = ce chapitre/);
    await page.check('#docxModes input[value="match"]');
    assert.deepEqual(await page.$$eval('#docxRows .dx-ch .dx-title', els => els.map(e => e.textContent)), ['Terrain', 'Entretiens', 'Bibliographie']);
    await page.check('#docxModes input[value="add"]');
    assert.equal(await page.inputValue('#docxNewTitle'), 'Chapitre 5 : Résultats', 'le titre saisi est gardé');
    // « Ce document fait N pages » : mon fichier en fait 8 dans ma mise en page à moi
    assert.equal(await page.inputValue('#docxPages'), '4');
    await page.fill('#docxPages', '8');
    assert.match(await page.textContent('#docxPagesHint'), /corrigé par vous, retenu pour ce document/);
    assert.match(await page.textContent('#docxSummary'), /1\s823 mots, 8 pages\./, 'plus de « ≈ » : c\'est moi qui le dis');
    assert.deepEqual(await page.$$eval('#docxRows .dx-meta b', els => els.map(e => e.textContent)), ['6 p.', '4 p.', '2 p.', '2 p.']);
    await page.screenshot({ path: path.join(SHOTS, '41-02-ajouter-chapitre.png') });
    await page.click('#docxApply');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 5);
    await flush(page);
    let d = await docOf(page, uid);
    const ch = d.chapters[4];
    assert.deepEqual([ch.title, ch.subsections.map(s => [s.title, s.writtenPages])], ['Chapitre 5 : Résultats', [['Terrain', 4], ['Entretiens', 2]]]);
    assert.equal(written(d), 6 + 20 + 12 + 6, 'les autres chapitres n\'ont pas bougé');
    let f = d.docFiles.chapitre_5_resultats;
    assert.deepEqual([f.scope, f.k, f.pages, f.src], [ch.id, 2, 8, 'layout'], 'ce fichier est désormais ce chapitre, et sa correction est retenue');
    assert.equal(await page.isVisible('#wordChange'), true, '« Changer de document » est proposé près du bouton de synchro');
    // Même fichier, un peu plus tard : reconnu, déjà à jour
    await page.waitForTimeout(400);
    await sendDocx(page, 'chapitre-methodo.docx', 'chapitre-5-resultats.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Déjà à jour/.test(t.textContent)), null, { timeout: 15000 });
    // « Changer de document » : la liste, avec de quoi revoir ou oublier
    await page.click('#wordChange');
    await page.waitForSelector('#linkedBox:not(.hidden)');
    assert.match(await page.textContent('#linkedList'), /chapitre-5-resultats\.docx.*fichier · synchro : aujourd'hui · 8 p\./s);
    await page.click('#linkedList >> text=Oublier');
    await flush(page);
    d = await docOf(page, uid);
    assert.deepEqual(d.docFiles, {});
    assert.equal(d.chapters[4].subsections[0].writtenPages, 4, 'le plan et les pages restent');
    assert.ok(!d.chapters[4].docFile && !d.chapters[4].subsections[0].docFile);
    assert.equal(await page.isVisible('#linkedBox'), false);
    // Annuler : le document revient, avec sa correction
    await page.click('.toast .toast-act');
    await flush(page);
    d = await docOf(page, uid);
    f = d.docFiles.chapitre_5_resultats;
    assert.deepEqual([f.scope, f.k], [d.chapters[4].id, 2]);
    assert.equal(d.chapters[4].docFile, 'chapitre_5_resultats');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Journal : journée de terrain, joker, période hors rédaction, défi de la semaine (le tout facultatif)', async () => {
    const C = await import(path.join(DIR, '..', 'core.js'));
    const uid = 'u_vie';
    const ALL = [0, 1, 2, 3, 4, 5, 6];
    const base = () => Object.assign(clone(V1_DOC), { version: 2, writingDays: ALL, trackedSince: addDays(TODAY, -20), deadline: addDays(TODAY, 200), marginDays: 0,
      activity: { [addDays(TODAY, -1)]: 1, [addDays(TODAY, -2)]: 1 }, journal: {}, docFiles: {}, docIgnore: [] });
    let { ctx, page } = await newPage(browser, { user: { uid, email: 'vie@example.com' }, store: { [`users/${uid}/thesis/main`]: base() } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.equal(await page.textContent('#tdStreak'), '2');
    assert.equal(await page.textContent('#tdStreakSub'), 'à prolonger');
    // Une journée de terrain : pas de pages, mais une journée de thèse
    await page.click('#tdOther button');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.equal(await page.textContent('#logTitle'), 'Ma journée de thèse');
    assert.equal(await page.isVisible('#logWrite'), false);
    assert.deepEqual(await page.$$eval('#logKinds .kind-chip', els => els.map(e => e.textContent)),
      ['Terrain', 'Lectures', 'Analyse, données', 'Colloque, séminaire', 'Formation', 'Article, publication', 'Enseignement', 'Point avec ma direction', 'Administratif']);
    await page.click('#logModal >> text=Enregistrer');
    assert.match((await toasts(page)).join('|'), /Choisissez ce que vous avez fait/);
    await page.click('#logKinds >> text=Terrain');
    assert.equal(await page.getAttribute('#logKinds [data-kind="terrain"]', 'aria-checked'), 'true');
    assert.equal(await page.isDisabled('#logJokerBtn'), false);
    await page.fill('#logNote', 'Entretiens à Tournon');
    await page.click('#logModal >> text=Enregistrer');
    await page.waitForSelector('#logModal.hidden', { state: 'attached' });
    assert.match((await toasts(page)).join('|'), /Terrain : noté dans votre journal · série de 3 jours/);
    assert.equal(await page.textContent('#tdStreak'), '3', 'la journée de terrain prolonge la série');
    assert.match(await page.textContent('#tdSub'), /Terrain\s: c'est noté/);
    assert.match(await page.textContent('#jcEntries .je'), /Terrain\s*Entretiens à Tournon/);
    assert.equal(await page.locator('#heatmap .hm.kind.today').count(), 1, 'le calendrier distingue une journée de thèse sans pages');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual([d.journal[TODAY][0].k, d.journal[TODAY][0].p, d.journal[TODAY][0].n], ['terrain', 0, 'Entretiens à Tournon']);
    assert.ok(!d.activity[TODAY], 'aucune page inventée');
    assert.equal(written(d), 6 + 20 + 12, 'le plan ne bouge pas');
    // On a travaillé aujourd'hui : pas besoin de joker
    await page.click('#journalCard >> text=Autre travail de thèse');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.equal(await page.isDisabled('#logJokerBtn'), true);
    assert.match(await page.textContent('#logJokerHint'), /pas besoin de joker/);
    // « Des pages » reste là, comme avant
    await page.click('#logModeSeg >> text=Des pages');
    assert.equal(await page.textContent('#logTitle'), 'J\'ai écrit');
    assert.ok(await page.isVisible('#logSection'));
    assert.equal(await page.isVisible('#logJokerRow'), false);
    await page.keyboard.press('Escape');
    // Retirer la journée : la série retombe à 2
    await page.click('#jcEntries .je-del');
    await page.waitForFunction(() => document.getElementById('tdStreak').textContent === '2');
    assert.match((await toasts(page)).join('|'), /Journée retirée du journal/);

    // Le joker : une journée off, la série ne casse pas (un par semaine)
    await page.click('#tdOther button');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.match(await page.textContent('#logJokerHint'), /sans casser votre série\. Un par semaine/);
    await page.click('#logJokerBtn');
    await page.waitForSelector('#logModal.hidden', { state: 'attached' });
    assert.match((await toasts(page)).join('|'), /Joker posé/);
    assert.match(await page.textContent('#tdSub'), /Joker posé/);
    assert.equal(await page.textContent('#tdStreak'), '2', 'le joker ne prolonge pas la série, il la garde');
    assert.match(await page.textContent('#jcEntries .je'), /Joker/);
    assert.equal(await page.locator('#heatmap .hm.off.today').count(), 1);
    await page.click('#tdOther button');
    await page.waitForSelector('#logModal:not(.hidden)');
    assert.equal(await page.isDisabled('#logJokerBtn'), true);
    assert.match(await page.textContent('#logJokerHint'), /Joker déjà posé ce jour-là/);
    await page.keyboard.press('Escape');
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.journal[TODAY].filter(e => e.k === 'joker').length, 1);
    assert.equal(d.journal[TODAY].find(e => e.k === 'joker').s, '~joker', 'le genre est aussi écrit là où les anciennes versions le gardent');
    assert.deepEqual(C.streak(d, addDays(TODAY, 1)), { count: 2, includesToday: false }, 'demain, la série sera toujours là');
    await ctx.close();

    // Un appareil resté ouvert en ancienne version a réenregistré le journal : il a effacé « k », pas « s ». Rien n'est perdu.
    ({ ctx, page } = await newPage(browser, { user: { uid: 'u_vie3', email: 'vie3@example.com' }, store: { 'users/u_vie3/thesis/main': Object.assign(base(), {
      journal: { [addDays(TODAY, -3)]: [{ p: 0, s: '~terrain', n: 'Archives', m: 0, t: '10:00' }], [TODAY]: [{ p: 0, s: '~joker', n: '', m: 0, t: '09:00' }] } }) } }));
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.match(await page.textContent('#jcEntries'), /Terrain\s*Archives/);
    assert.match(await page.textContent('#jcEntries .je'), /Joker/);
    assert.match(await page.textContent('#tdSub'), /Joker posé/);
    assert.equal(await page.locator('#heatmap .hm.off.today').count(), 1);
    assert.equal(await page.textContent('#tdStreak'), '3', 'terrain il y a trois jours, pages ensuite, joker aujourd\'hui');
    assert.deepEqual(page._errors, []);
    await ctx.close();

    // Une période hors rédaction (colloque) : le rythme à tenir se recalcule, le jour est « off »
    ({ ctx, page } = await newPage(browser, { user: { uid: 'u_vie2', email: 'vie2@example.com' }, store: { 'users/u_vie2/thesis/main': base() } }));
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    const paceBefore = await page.textContent('#paceNeed');
    await page.evaluate(() => window.openProjectModal());
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.equal(await page.locator('#pmPauses .pause-item').count(), 0);
    assert.equal(await page.isChecked('#pmDefi'), true);
    await page.selectOption('#pmPauseKind', 'colloque');
    await page.fill('#pmPauseFrom', TODAY);
    await page.fill('#pmPauseTo', addDays(TODAY, 59));
    await page.click('#projectModal >> text=Ajouter');
    assert.match(await page.textContent('#pmPauses .pause-item'), /Colloque\s*du .+ au .+\(60 jours\)/);
    await page.click('#projectModal >> text=Enregistrer');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    assert.match(await page.textContent('#tdSub'), /Colloque jusqu'au .+: le Journal n'attend pas de pages/);
    assert.equal(await page.locator('#weekBars .wk-col.is-today.rest').count(), 1, 'jour marqué comme un jour sans écriture');
    assert.notEqual(await page.textContent('#paceNeed'), paceBefore, 'soixante jours de moins pour écrire : le rythme à tenir augmente');
    await flush(page);
    d = await docOf(page, 'u_vie2');
    assert.deepEqual(d.pauses, [{ from: TODAY, to: addDays(TODAY, 59), kind: 'colloque' }]);
    assert.equal(C.forecast(d, { total: 115, written: 38 }, TODAY).writingDaysLeft, 201 - 60);
    // On la retire : tout revient
    await page.evaluate(() => window.openProjectModal());
    await page.click('#pmPauses .je-del');
    await page.click('#projectModal >> text=Enregistrer');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    assert.equal(await page.textContent('#paceNeed'), paceBefore);
    await flush(page);
    assert.deepEqual((await docOf(page, 'u_vie2')).pauses, []);

    // Le défi de la semaine : affiché dans le journal, vérifié d'après les données, et que l'on peut refuser
    const expected = () => C.weeklyChallenge(d, TODAY, C.forecast(d, { total: 115, written: written(d) }, TODAY));
    d = await docOf(page, 'u_vie2');
    let ch = expected();
    assert.ok(await page.isVisible('#jcDefi'));
    assert.match(await page.textContent('#jcDefi .defi-kicker'), /Défi de la semaine/);
    const norm = s => s.replace(/[  ]/g, ' ');
    assert.equal(norm(await page.textContent('#jcDefi .defi-text')), ch.text);
    // Trois pages et une note aujourd'hui : selon le défi de cette semaine, il est relevé ou non (même calcul que l'application)
    await page.click('#journalCard >> text=Ajouter une note');
    await page.waitForSelector('#logModal:not(.hidden)');
    await page.fill('#logPages', '3');
    await page.fill('#logNote', 'Bonne séance');
    await page.click('#logModal >> text=Enregistrer');
    await page.waitForSelector('#logModal.hidden', { state: 'attached' });
    await flush(page);
    d = await docOf(page, 'u_vie2');
    ch = expected();
    assert.equal((await toasts(page)).some(t => /Défi de la semaine relevé/.test(t)), ch.done);
    assert.deepEqual(d.defis.won, ch.done ? [ch.week] : []);
    assert.equal(await page.locator('#jcDefi.won').count(), ch.done ? 1 : 0);
    assert.match(norm(await page.textContent('#jcDefi .defi-val')), new RegExp(`^${String(Math.round(ch.value * 10) / 10).replace('.', ',')} / ${String(Math.round(ch.target * 10) / 10).replace('.', ',')}$`));
    // Pas envie de défis : une croix, et c'est réglé (réversible dans les réglages)
    await page.click('#jcDefi .defi-x');
    assert.equal(await page.isVisible('#jcDefi'), false);
    await flush(page);
    assert.equal((await docOf(page, 'u_vie2')).defis.off, true);
    await page.evaluate(() => window.openProjectModal());
    assert.equal(await page.isChecked('#pmDefi'), false);
    await page.evaluate(() => { document.getElementById('pmAdv').open = true; });
    await page.check('#pmDefi');
    await page.click('#projectModal >> text=Enregistrer');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    assert.ok(await page.isVisible('#jcDefi'));
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Agenda : créneaux par jour, rappel, Google Agenda en un clic par événement, prochaine séance au tableau de bord', async () => {
    const uid = 'u_agenda';
    const doc = Object.assign(clone(V1_DOC), { version: 2, trackedSince: addDays(TODAY, -20), deadline: addDays(TODAY, 200), activity: {}, journal: {} });
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'agenda@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    // Le tableau de bord annonce la prochaine séance et mène à l'agenda
    assert.match((await page.textContent('#tdNextTxt')).replace(/[  ]/g, ' '), /^Prochaine séance : (aujourd'hui|demain|lundi) à 9 h \(1 h 30\)$/);
    await page.click('#tdNext button');
    await page.waitForSelector('#calendarModal:not(.hidden)');
    assert.equal(await page.textContent('#calTitle'), 'Planifier mes séances');
    assert.equal(await page.isChecked('#calSame'), true);
    assert.equal(await page.locator('#calSlots .cal-slot').count(), 1);
    assert.match(await page.textContent('#calSyncLbl'), /Bilan de la semaine/, 'sans document à déposer : un bilan plutôt qu\'un point d\'étape');
    assert.equal(await page.isChecked('#calIncSync'), false);
    // Un horaire différent le vendredi
    await page.uncheck('#calSame');
    assert.deepEqual(await page.$$eval('#calSlots .cal-slot-day', els => els.map(e => e.textContent)), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']);
    await page.fill('#calSlots input[data-day="5"]', '14:00');
    await page.selectOption('#calSlots select[data-day="5"]', '120');
    await page.selectOption('#calAlarm', '30');
    assert.match((await page.textContent('#calSummary')).replace(/[  ]/g, ' '),
      /^2 événements récurrents : lundi, mardi, mercredi et jeudi à 9 h \(1 h 30\) ; vendredi à 14 h \(2 h\), jusqu'au .+\. Rappel une demi-heure avant\.$/);
    // Bilan de la semaine et rappel pour la direction
    await page.check('#calIncSync');
    await page.selectOption('#calMeetWeeks', '6');
    assert.equal(await page.isChecked('#calIncMeet'), true, 'choisir un intervalle coche le rappel');
    const items = await page.$$eval('#calGoogleList li', ls => ls.map(l => l.querySelector('span').textContent.replace(/[  ]/g, ' ')));
    assert.equal(items.length, 7, JSON.stringify(items));
    assert.deepEqual(items.slice(0, 4), ['Séances : lundi, mardi, mercredi et jeudi à 9 h', 'Séances : vendredi à 14 h', 'Bilan de la semaine', 'Mes pages à ma direction, toutes les 6 semaines']);
    assert.match(items[4], /^Dépôt : /);
    assert.match(items[5], /^Fin de rédaction visée : /);
    assert.match(items[6], /^4 échéances de chapitre : plus simple avec le fichier/);
    const links = await page.$$eval('#calGoogleList a', as => as.map(a => a.href));
    assert.equal(links.length, 6);
    assert.ok(links.every(h => h.startsWith('https://calendar.google.com/calendar/render?action=TEMPLATE')));
    const q = i => new URL(links[i]).searchParams;
    assert.match(q(0).get('recur'), /^RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH;UNTIL=\d{8}T235959Z$/);
    assert.match(q(1).get('recur'), /^RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=\d{8}T235959Z$/);
    assert.match(q(1).get('dates'), /^\d{8}T140000\/\d{8}T160000$/);
    assert.match(q(2).get('dates'), /^\d{8}T160000\/\d{8}T161500$/, 'le bilan suit la dernière séance de la semaine');
    assert.match(q(3).get('recur'), /^RRULE:FREQ=WEEKLY;INTERVAL=6;BYDAY=FR;UNTIL=\d{8}T235959Z$/);
    assert.equal(q(3).get('text'), 'Envoyer mes pages à ma direction');
    await page.screenshot({ path: path.join(SHOTS, '41-03-agenda.png') });
    // Un clic sur « Ajouter » : l'événement part vers Google Agenda, la ligne est cochée, les créneaux sont gardés
    await page.$eval('#calGoogle', a => { a.addEventListener('click', e => e.preventDefault()); a.click(); });
    assert.equal(await page.textContent('#calGoogle'), 'Ajouté');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual([d.sessionTime, d.sessionMinutes, d.slots, d.alarmMin, d.meetWeeks], ['09:00', 90, [[5, '14:00', 120]], 30, 6]);
    // Le fichier .ics contient la même chose, rappels compris
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#calendarModal >> text=fichier agenda (.ics)')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n /g, '');
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 2 + 1 + 1 + 1 + 1 + 4, 'deux séries de séances, bilan, direction, dépôt, fin de rédaction, 4 chapitres');
    assert.equal((ics.match(/TRIGGER:-PT30M/g) || []).length, 2);
    assert.match(ics, /RRULE:FREQ=WEEKLY;INTERVAL=6;BYDAY=FR;UNTIL=/);
    assert.match(ics, /SUMMARY:Bilan de la semaine : mon Journal de Bord/);
    await page.click('#calendarModal >> text=Fermer');
    await page.waitForSelector('#calendarModal.hidden', { state: 'attached' });
    // Fenêtre rouverte : les créneaux sont là
    await page.evaluate(() => window.openCalendarModal());
    assert.equal(await page.isChecked('#calSame'), false);
    assert.equal(await page.inputValue('#calSlots input[data-day="5"]'), '14:00');
    assert.equal(await page.inputValue('#calAlarm'), '30');
    // Retour à un seul horaire, et fermeture : enregistré sans rien télécharger
    await page.check('#calSame');
    assert.equal(await page.locator('#calSlots .cal-slot').count(), 1);
    await page.fill('#calTime', '08:30');
    await page.click('#calendarModal >> text=Fermer');
    assert.match((await toasts(page)).join('|'), /Créneaux d'écriture enregistrés/);
    await flush(page);
    d = await docOf(page, uid);
    assert.deepEqual([d.sessionTime, d.slots], ['08:30', []]);
    assert.match((await page.textContent('#tdNextTxt')).replace(/[  ]/g, ' '), /à 8 h 30 \(1 h 30\)$/);
    assert.deepEqual(page._errors, []);
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
    // Menu : sur téléphone, un panneau ouvert par l'onglet du bas ; il se referme, le focus revient sur l'onglet
    await page.keyboard.press('Escape');
    assert.ok(await page.isVisible('.tabbar'), 'onglets en bas de l\'écran');
    assert.equal(await page.isVisible('#mobileMenu'), false, 'barre latérale repliée');
    await page.click('.hamburger-btn');
    await page.waitForSelector('#mobileMenu.open');
    assert.equal(await page.getAttribute('.hamburger-btn', 'aria-expanded'), 'true');
    await page.screenshot({ path: path.join(SHOTS, '4-01-menu-mobile.png') });
    await page.click('#mobileMenu >> text=Dépôt, objectif et rythme');
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.equal(await page.evaluate(() => document.getElementById('mobileMenu').classList.contains('open')), false, 'le panneau se referme');
    await page.keyboard.press('Escape');
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('hamburger-btn')), 'retour à l\'onglet Menu');
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
    assert.equal(await page.textContent('#wordBtn'), 'Synchroniser mon document', 'ancien import reconnu');
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
    assert.match(await a.page.textContent('#wnTitle'), /Vos vraies pages/);
    assert.equal(await a.page.isVisible('#wnPromo'), false, 'la promo n\'est pas annoncée tant qu\'elle est fermée');
    assert.equal(await a.page.textContent('#sWritten'), '38', 'les données sont intactes derrière l\'annonce');
    await a.page.click('#whatsNewModal >> text=C\'est parti');
    await a.page.goto(BASE);
    await a.page.waitForSelector('.chapter-card');
    await a.page.waitForTimeout(3000);
    assert.equal(await modalsOpen(a.page), 0, 'pas de seconde annonce');
    // Elle reste consultable dans le menu (barre latérale)
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

    assert.match(await a.page.textContent('#btScore'), /Aucune case/);
    await a.page.click('.bingo-teaser >> text=Cocher mes cases');
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
    assert.equal(await a.page.locator('#btGrid i.on').count(), 3, 'la petite grille du tableau de bord suit');
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
    assert.ok(await page.evaluate(() => document.fonts.check('600 20px "Fraunces"') && document.fonts.check('italic 20px "Fraunces"') && document.fonts.check('700 16px "DM Sans"')), 'polices chargées');
    assert.deepEqual(page._requests.filter(u => /fonts\.(googleapis|gstatic)\.com/.test(u)), [], 'aucune police demandée à un tiers');
    assert.ok(page._requests.some(u => u.endsWith('/fonts/fraunces-latin.woff2')) && page._requests.some(u => u.endsWith('/fonts/dm-sans-latin.woff2')));
    assert.equal(await page.evaluate(() => typeof window.Sortable), 'function', 'glisser-déposer chargé (contenu vérifié)');
    // L'annonce fermée avec Échap est considérée comme lue
    assert.ok(await page.evaluate(() => document.querySelector('#whatsNewModal .modal').contains(document.activeElement)), 'le focus est dans la fenêtre');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#whatsNewModal.hidden', { state: 'attached' });
    assert.equal(await page.evaluate(() => localStorage.getItem('jdb_whatsnew')), '5');
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
    await page.click('#mobileMenu >> text=Dépôt, objectif et rythme');
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.equal(await page.locator('#projectModal .modal-x').count(), 1, 'une croix pour fermer');
    await page.keyboard.press('Escape');
    assert.match(await page.evaluate(() => document.activeElement.textContent), /Dépôt, objectif et rythme/, 'retour au bouton de la barre latérale');
    // Contraste de tous les textes visibles (norme AA : 4,5, ou 3 pour les grands), chacun sur son vrai fond :
    // papier, cartes, bandeau sombre, barre latérale, papillon de la note du jour
    const contrasts = await page.evaluate(() => {
      const rgb = c => (c.match(/[\d.]+/g) || []).map(Number);
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const over = (top, under) => { const a = top[3] === undefined ? 1 : top[3]; return [0, 1, 2].map(i => top[i] * a + under[i] * (1 - a)); };
      const bgOf = el => { // le fond réellement visible derrière un élément (couches translucides comprises)
        const layers = [];
        for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c.length >= 3 && (c[3] === undefined || c[3] > 0)) { layers.push(c); if (c[3] === undefined || c[3] === 1) break; } }
        let col = [245, 239, 227];
        for (const l of layers.reverse()) col = over(l, col);
        return col;
      };
      const bad = [];
      let checked = 0;
      document.querySelectorAll('#appScreen *').forEach(el => {
        if (!el.offsetParent || el.closest('svg')) return;
        if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return; // seulement ce qui porte du texte
        const cs = getComputedStyle(el);
        const bg = bgOf(el);
        const fg = over(rgb(cs.color), bg);
        const r = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        const size = parseFloat(cs.fontSize);
        const need = size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5;
        checked++;
        if (r < need) bad.push(`${el.className || el.tagName} « ${el.textContent.trim().slice(0, 24)} » : ${r.toFixed(2)}`);
      });
      return { checked, bad: [...new Set(bad)] };
    });
    assert.ok(contrasts.checked > 60, 'textes contrôlés : ' + contrasts.checked);
    assert.deepEqual(contrasts.bad, [], 'contrastes insuffisants');
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


  /* ============================================================
     V3.1 : niveaux de titre, plan refait, autres formats, copier-coller
  ============================================================ */
  const rowTitles = page => page.$$eval('#docxRows .dx-ch .dx-title', els => els.map(e => e.textContent));
  const planOf = d => d.chapters.map(c => c.title + (c.subsections.length ? ` [${c.subsections.map(x => x.title).join(' | ')}]` : ''));
  const pasteInto = (page, selector, html, text) => page.evaluate(({ selector, html, text }) => {
    const dt = new DataTransfer();
    if (html) dt.setData('text/html', html);
    dt.setData('text/plain', text || '');
    (selector ? document.querySelector(selector) : document.body).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, { selector, html, text });
  const words = n => Array.from({ length: n }, (_, i) => ['la', 'recherche', 'doctorale', 'exige', 'une', 'patience', 'infinie', 'et', 'du', 'café'][i % 10]).join(' ');

  /* ------------------------------------------------------------ */
  await test('Import : un seul « Titre 1 » (titre de la thèse), chapitres en « Titre 2 » : bon plan, niveau modifiable et retenu', async () => {
    const uid = 'u_niv';
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'niv@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    await sendDocx(page, 'these-titre-unique.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /6 parties détectées, 4 sous-sections/);
    assert.deepEqual(await rowTitles(page), ['Introduction générale', 'Chapitre 1 : État de l’art', 'Chapitre 2 : Méthodologie', 'Chapitre 3 : Résultats', 'Conclusion générale', 'Bibliographie'],
      'les chapitres sont les « Titre 2 », pas le titre de la thèse');
    assert.ok(await page.isVisible('#docxLevelRow'));
    assert.equal(await page.inputValue('#docxLevel'), 'auto');
    assert.match(await page.textContent('#docxLevel option[value="auto"]'), /repérés automatiquement \(niveau 2\)/);
    assert.deepEqual(await page.$$eval('#docxLevel option', os => os.map(o => o.value)), ['auto', '1', '2', '3', '4']);
    assert.deepEqual(await page.$$eval('#docxModes input', os => os.map(o => o.value)), ['match', 'add'], 'plan vide : rien à remplacer');
    assert.match(await page.textContent('#docxSummary'), /≈ 16 pages/);
    await page.screenshot({ path: path.join(SHOTS, '31-01-plan-propose.png') });
    // On peut choisir un autre niveau : l'aperçu se refait aussitôt
    await page.selectOption('#docxLevel', '1');
    assert.deepEqual(await rowTitles(page), ['Les ponts suspendus en France au XIXe siècle']);
    assert.match(await page.textContent('#docxSummary'), /1 partie détectée, 6 sous-sections/);
    await page.selectOption('#docxLevel', '3');
    assert.deepEqual(await rowTitles(page), ['Introduction générale', '1.1 Histoire des techniques', '1.2 Débats historiographiques', '2.1 Archives', '2.2 Corpus', 'Chapitre 3 : Résultats', 'Conclusion générale', 'Bibliographie']);
    await page.selectOption('#docxLevel', 'auto');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual(planOf(d), ['Introduction générale', 'Chapitre 1 : État de l’art [1.1 Histoire des techniques | 1.2 Débats historiographiques]',
      'Chapitre 2 : Méthodologie [2.1 Archives | 2.2 Corpus]', 'Chapitre 3 : Résultats', 'Conclusion générale']);
    assert.equal(d.docFiles['these-titre-unique'] === undefined, true);
    assert.equal(d.docFiles.these_titre_unique.level, 'auto', 'niveau retenu pour ce document');
    const w0 = written(d);
    assert.equal(w0, 14, 'seize pages, dont le titre et la bibliographie, non suivis');
    assert.equal(d.chapters[3].writtenPages, 3);
    assert.equal(d.chapters[2].subsections[0].writtenPages, 1, 'notes de bas de page comprises : une page et demie, arrondie avec les autres');
    // Synchro suivante : un geste, sans aperçu, même découpage
    await page.waitForTimeout(1100);
    await sendDocx(page, 'these-titre-unique_v2.docx', 'these-titre-unique.docx');
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /synchronisé\s:\s\+1,6\sp\./.test(t.textContent)), null, { timeout: 15000 });
    assert.equal(await page.isVisible('#docxModal'), false, 'pas d\'aperçu la deuxième fois');
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(written(d), w0 + 1, 'quinze pages suivies sur dix-huit');
    assert.equal(d.chapters[2].subsections[1].writtenPages, 2);
    assert.equal(d.activity[TODAY], 1.58, '760 mots de plus, à 480 mots par page');
    // « Revoir le plan » : l'aperçu se rouvre, on peut changer de niveau, le choix est retenu
    await page.evaluate(() => window.openDocxModal());
    await page.waitForSelector('#linkedBox:not(.hidden)');
    await page.evaluate(() => { document.getElementById('docxInput').click = () => {}; });
    await page.click('#linkedList >> text=Revoir');
    await sendDocx(page, 'these-titre-unique_v2.docx', 'these-titre-unique.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.equal(await page.inputValue('#docxLevel'), 'auto');
    assert.equal(await page.isChecked('#docxModes input[value="match"]'), true);
    await page.selectOption('#docxLevel', '1');
    await page.check('#docxModes input[value="replace"]');
    assert.equal(await page.textContent('#docxApply'), 'Refaire mon plan');
    assert.equal(await page.isVisible('#docxCountRow'), false, 'changer de découpage n\'est pas écrire');
    await page.click('#docxApply');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 1);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.docFiles.these_titre_unique.level, 1);
    assert.equal(d.activity[TODAY], 1.58, 'journal inchangé');
    assert.equal(d.chapters[0].subsections.length, 6);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Import : ancien découpage raté (tout en un chapitre) : le nouveau plan est proposé, objectifs repris, annulable', async () => {
    const uid = 'u_rate';
    // Ce que l'ancienne version avait produit : le titre de la thèse comme seul chapitre
    const doc = { version: 2, documentTitle: 'Ma thèse', trackedSince: addDays(TODAY, -10), activity: { [addDays(TODAY, -1)]: 3 }, journal: {}, milestones: {},
      chapters: [{ id: 'c1', title: 'Les ponts suspendus en France au XIXe siècle', expanded: true, review: 'sent', reviewDate: addDays(TODAY, -5), docKey: 'les ponts suspendus en france au xixe siecle', docFile: 'these_titre_unique',
        subsections: [
          { id: 's1', title: 'Introduction générale', targetPages: 12, writtenPages: 2, docKey: 'introduction generale', docFile: 'these_titre_unique' },
          { id: 's2', title: 'Chapitre 1 : État de l’art', targetPages: 30, writtenPages: 7, docKey: 'etat de l art', docFile: 'these_titre_unique' },
          { id: 's3', title: 'Chapitre 2 : Méthodologie', targetPages: 25, writtenPages: 3, docKey: 'methodologie', docFile: 'these_titre_unique' },
          { id: 's4', title: 'Chapitre 3 : Résultats', targetPages: 40, writtenPages: 4, docKey: 'resultats', docFile: 'these_titre_unique' },
          { id: 's5', title: 'Conclusion générale', targetPages: 8, writtenPages: 1, docKey: 'conclusion generale', docFile: 'these_titre_unique' },
          { id: 's6', title: 'Bibliographie', targetPages: 10, writtenPages: 2, docKey: 'bibliographie', docFile: 'these_titre_unique' },
        ] }],
      docFiles: { these_titre_unique: { name: 'these-titre-unique.docx', at: addDays(TODAY, -1), inclWords: 7549, wpp: 380, scope: '' } } };
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'rate@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.equal(await page.locator('.chapter-card').count(), 1);
    await page.evaluate(() => { window.showOpenFilePicker = undefined; });
    await sendDocx(page, 'these-titre-unique.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.ok(await page.isVisible('#docxSuggest'), 'le nouveau découpage est expliqué');
    assert.equal(await page.isChecked('#docxModes input[value="replace"]'), true);
    assert.equal(await page.inputValue('#docxLevel'), 'auto');
    assert.match(await page.textContent('#docxLevel option[value="legacy"]'), /comme à la dernière synchro/);
    assert.deepEqual((await rowTitles(page)).slice(0, 3), ['Introduction générale', 'Chapitre 1 : État de l’art', 'Chapitre 2 : Méthodologie']);
    assert.match(await page.textContent('#docxMissing'), /Retirés du plan/);
    assert.equal(await page.isVisible('#docxCountRow'), false);
    await page.screenshot({ path: path.join(SHOTS, '31-02-plan-refait.png') });
    await page.click('#docxApply');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 5);
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual(d.chapters.map(c => c.title), ['Introduction générale', 'Chapitre 1 : État de l’art', 'Chapitre 2 : Méthodologie', 'Chapitre 3 : Résultats', 'Conclusion générale']);
    assert.equal(d.chapters[0].targetPages, 12, 'objectif repris de l\'ancienne sous-section');
    assert.equal(d.chapters[3].targetPages, 40);
    assert.equal(d.chapters[4].targetPages, 8);
    assert.equal(d.chapters[1].subsections.reduce((a, x) => a + x.targetPages, 0), 30, 'objectif du chapitre partagé entre ses sous-sections');
    assert.equal(d.docFiles.these_titre_unique.level, 'auto');
    assert.deepEqual(d.activity, { [addDays(TODAY, -1)]: 3 }, 'le journal n\'a pas bougé');
    assert.equal((d.journal[TODAY] || []).length, 0, 'pas de « jour de relecture » inventé');
    // Annuler : l'ancien plan revient tel quel
    await page.click('.toast[data-key="docx"] .toast-act');
    await page.waitForFunction(() => document.querySelectorAll('.chapter-card').length === 1);
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.chapters[0].subsections.length, 6);
    assert.equal(d.chapters[0].review, 'sent');
    // Si l'on préfère garder l'ancien découpage : « comme à la dernière synchro », et plus de question ensuite
    await page.waitForTimeout(1100);
    await sendDocx(page, 'these-titre-unique.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    await page.selectOption('#docxLevel', 'legacy');
    await page.check('#docxModes input[value="match"]');
    assert.deepEqual(await rowTitles(page), ['Les ponts suspendus en France au XIXe siècle']);
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Import : thèse en parties, LibreOffice (.odt), LaTeX (.tex), formats refusés avec une explication', async () => {
    const uid = 'u_fmt';
    const open = async () => {
      const r = await newPage(browser, { user: { uid, email: 'fmt@example.com' } });
      await r.page.goto(BASE);
      await r.page.waitForSelector('.onboarding');
      await r.page.evaluate(() => { window.showOpenFilePicker = undefined; });
      return r;
    };
    // Parties en Titre 1, chapitres en Titre 2
    let { ctx, page } = await open();
    await sendDocx(page, 'these-parties.docx');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.deepEqual(await rowTitles(page), ['Introduction générale', 'Chapitre 1 : Le sol', 'Chapitre 2 : Les piles', 'Deuxième partie : Le tablier',
      'Chapitre 3 : Les câbles', 'Chapitre 4 : Les haubans', 'Conclusion générale', 'Bibliographie'], 'chapitres sortis de leurs parties ; longue ouverture de partie gardée à part');
    assert.match(await page.textContent('#docxLevel option[value="auto"]'), /niveau 2/);
    await page.selectOption('#docxLevel', '1');
    assert.deepEqual(await rowTitles(page), ['Introduction générale', 'Première partie : Les fondations', 'Deuxième partie : Le tablier', 'Conclusion générale', 'Bibliographie']);
    await ctx.close();

    // LibreOffice : même plan que le .docx dont il est tiré
    ({ ctx, page } = await open());
    await sendDocx(page, 'these-titre-unique.odt');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /these-titre-unique\.odt/);
    assert.match(await page.textContent('#docxSummary'), /6 parties détectées, 4 sous-sections/);
    assert.deepEqual((await rowTitles(page)).slice(0, 2), ['Introduction générale', 'Chapitre 1 : État de l’art']);
    const odtWords = parseInt((await page.textContent('#docxSummary')).replace(/\s/g, '').match(/:(\d+)mots/)[1], 10);
    assert.ok(Math.abs(odtWords - 7549) <= 15, 'même décompte que le .docx, à quelques mots près : ' + odtWords);
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    assert.equal((await docOf(page, uid)).chapters.length, 5);
    await ctx.close();

    // Document né dans LibreOffice : titres marqués, titre dans une liste, note, tableau, suivi des modifications
    ({ ctx, page } = await open());
    await sendDocx(page, 'natif.odt');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.match(await page.textContent('#docxSummary'), /2\s103 mots, 6 pages\. 3 parties détectées, 2 sous-sections/, 'ni la table des matières, ni le texte supprimé, ni les commentaires ne comptent');
    assert.deepEqual(await rowTitles(page), ['Introduction', 'Chapitre 1 : Le sol', 'Conclusion']);
    assert.deepEqual(await page.$$eval('#docxRows .dx-ss .dx-title', els => els.map(e => e.textContent)), ['Géologie', 'Sondages']);
    assert.equal(await page.inputValue('#docxPages'), '6');
    assert.match(await page.textContent('#docxPagesHint'), /nombre de pages indiqué par LibreOffice/, 'le total est celui que le fichier enregistre');
    await ctx.close();

    // LaTeX
    ({ ctx, page } = await open());
    await sendDocx(page, 'these.tex');
    await page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    assert.deepEqual(await rowTitles(page), ['Introduction générale', 'État de l\'art', 'Conclusion générale']);
    assert.deepEqual(await page.$$eval('#docxRows .dx-ss .dx-title', els => els.map(e => e.textContent)), ['Histoire des techniques', 'Débats historiographiques']);
    assert.match(await page.textContent('#docxPagesHint'), /estimation sans mise en page/, 'LaTeX : pas de mise en page à lire, on le dit');
    assert.match(await page.textContent('#docxSummary'), /≈ \d+ pages?\./);
    // Formats non lus : un message qui dit quoi faire
    await page.click('#docxModal >> text=Changer de document');
    await page.setInputFiles('#docxInput', { name: 'these.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n') });
    await page.waitForSelector('#docxError:not(.hidden)');
    assert.match(await page.textContent('#docxError'), /PDF est illisible/);
    await page.setInputFiles('#docxInput', { name: 'these.doc', mimeType: 'application/msword', buffer: Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]) });
    await page.waitForFunction(() => /ancien Word/.test(document.getElementById('docxError').textContent));
    await page.setInputFiles('#docxInput', { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from([0x89, 0x50, 0x4E, 0x47, 1, 2, 3]) });
    await page.waitForFunction(() => /Format non reconnu/.test(document.getElementById('docxError').textContent));
    assert.equal(await page.evaluate(() => window.__fbStore.writes.filter(w => w.data && w.data.chapters).length), 0, 'rien n\'a été écrit');
    assert.deepEqual(page._errors.filter(e => !/document :/.test(e)), []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Copier-coller : texte collé depuis Google Docs (titres conservés), puis mise à jour en un geste', async () => {
    const uid = 'u_colle';
    const gdoc = extra => `<meta charset="utf-8"><b style="font-weight:normal" id="docs-internal-guid-1"><p dir="ltr"><span style="font-size:26pt">Ma thèse</span></p>
      <h1 dir="ltr"><span>Les ponts suspendus</span></h1><p><span>${words(40)}</span></p>
      <h2 dir="ltr"><span>Introduction</span></h2><p><span>${words(380)}</span></p><p><span>${words(380)}</span></p>
      <h2><span>Chapitre 1 : </span><span>Les câbles</span></h2><p>${words(100)}</p>
      <h3>1.1 Acier</h3><p>${words(760)}</p><ul><li>${words(10)}</li><li>${words(10)}</li></ul>
      <h3>1.2 Fonte</h3><table><tr><td>${words(190)}</td><td>${words(190)}</td></tr></table>
      <h2>Conclusion</h2><p>${words(380 + extra)}</p><style>p { color: red }</style><script>window.__xss = 1</script></b>`;
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'colle@example.com' } });
    await page.goto(BASE);
    await page.waitForSelector('.onboarding');
    // Un petit texte collé ailleurs que dans un champ : ignoré
    await pasteInto(page, null, '<h1>Titre</h1><p>trois petits mots</p>', 'Titre trois petits mots');
    await page.waitForTimeout(200);
    assert.equal(await modalsOpen(page), 0);
    // Coller dans la fenêtre de synchro
    await page.evaluate(() => window.openDocxModal());
    await page.waitForSelector('#docxPaste');
    await pasteInto(page, '#docxPaste', gdoc(0), 'texte brut');
    await page.waitForSelector('#docxStep2:not(.hidden)');
    assert.match(await page.textContent('#docxSummary'), /Texte collé/);
    assert.deepEqual(await rowTitles(page), ['Introduction', 'Chapitre 1 : Les câbles', 'Conclusion']);
    assert.deepEqual(await page.$$eval('#docxRows .dx-ss .dx-title', els => els.map(e => e.textContent)), ['1.1 Acier', '1.2 Fonte']);
    assert.equal(await page.evaluate(() => window.__xss), undefined, 'le contenu collé n\'est jamais exécuté');
    assert.equal(await page.inputValue('#docxPaste'), '', 'rien ne reste dans la zone de collage');
    await page.click('#docxApply');
    await page.waitForSelector('.chapter-card');
    await flush(page);
    let d = await docOf(page, uid);
    assert.deepEqual(planOf(d), ['Introduction', 'Chapitre 1 : Les câbles [1.1 Acier | 1.2 Fonte]', 'Conclusion']);
    // 5,4 pages de texte suivi (à 2 700 signes la page) : cinq pages, réparties au plus près (1,7 ; 2,0 ; 0,9 ; 0,9)
    assert.equal(d.chapters[0].writtenPages, 1);
    assert.equal(d.chapters[1].subsections[0].writtenPages, 2, 'listes comprises, ouverture du chapitre avec sa première section');
    assert.equal(d.chapters[1].subsections[1].writtenPages, 1, 'tableaux compris');
    assert.equal(d.docFiles.texte_colle.name, 'Texte collé');
    assert.equal(d.docFiles.texte_colle.src, 'density', 'texte collé : pas de mise en page, on compte en signes');
    const w0 = written(d);
    assert.equal(w0, 5);
    // La fois suivante : coller n'importe où dans la page suffit
    await page.waitForTimeout(1100);
    await pasteInto(page, null, gdoc(760), words(3000));
    await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => /Texte collé synchronisé\s:\s\+1,7\sp\./.test(t.textContent)));
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(written(d), w0 + 2);
    assert.equal(d.activity[TODAY], 1.72, '760 mots, soit 4 640 signes, à 2 700 signes la page');
    // Coller dans un champ de saisie reste un collage ordinaire
    await page.evaluate(() => window.openLogModal());
    await page.waitForSelector('#logModal:not(.hidden)');
    await pasteInto(page, '#logNote', gdoc(0), words(3000));
    await page.waitForTimeout(300);
    assert.equal(await page.isVisible('#docxModal'), false);
    await page.keyboard.press('Escape');
    // Texte brut collé (LaTeX) : les \chapter sont reconnus ; nouveau contenu, donc aperçu
    await pasteInto(page, null, '', `\\chapter{Introduction}\n${words(400)}\n\\chapter{Annexe technique}\n${words(400)}\n`);
    await page.waitForSelector('#docxStep2:not(.hidden)');
    assert.deepEqual(await rowTitles(page), ['Introduction', 'Annexe technique']);
    assert.deepEqual(page._errors, []);
    await ctx.close();

    // Nouveau compte : le document collé là où l'on attendait un plan est lu comme un document
    const n = await newPage(browser, { user: { uid: 'u_colle2', email: 'colle2@example.com' } });
    await n.page.goto(BASE);
    await n.page.waitForSelector('.onboarding');
    assert.match(await n.page.textContent('.ob-drop'), /Déposer mon document/);
    await n.page.click('.ob-link');
    await pasteInto(n.page, '#planText', gdoc(0), words(1500));
    await n.page.waitForSelector('#docxStep2:not(.hidden)');
    assert.deepEqual(await rowTitles(n.page), ['Introduction', 'Chapitre 1 : Les câbles', 'Conclusion']);
    await n.page.click('#docxModal >> text=Changer de document');
    await n.page.click('#docxModal >> text=Fermer');
    // … et un plan collé au même endroit reste un plan
    await pasteInto(n.page, '#planText', '', 'Introduction\nMéthode\nConclusion');
    await n.page.waitForTimeout(200);
    assert.equal(await modalsOpen(n.page), 0);
    assert.deepEqual(n.page._errors, []);
    await n.ctx.close();
  });


  /* ------------------------------------------------------------ */
  await test('Dépôt en « période visée » (un mois), agenda : séances récurrentes, point d\'étape, période dans l\'agenda', async () => {
    const uid = 'u_periode';
    const doc = clone(V1_DOC);
    Object.assign(doc, { version: 2, trackedSince: addDays(TODAY, -30), activity: {}, docFiles: { these: { name: 'these.docx', at: addDays(TODAY, -2), inclWords: 4000, wpp: 380, scope: '' } } });
    for (let i = 1; i < 28; i++) doc.activity[addDays(TODAY, -i)] = 1;
    const { ctx, page } = await newPage(browser, { user: { uid, email: 'periode@example.com' }, store: { [`users/${uid}/thesis/main`]: doc } });
    await page.goto(BASE);
    await page.waitForSelector('.chapter-card');
    assert.equal(await page.textContent('#dlLabel'), 'Dépôt');
    // Pas de date officielle : on indique un mois
    await page.click('#dbDeadline >> text=Indiquez un mois');
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.ok(await page.isVisible('#pmDlMonthRow'));
    assert.equal(await page.isVisible('#pmDeadline'), false);
    const now = new Date();
    const year = now.getFullYear() + 1;
    await page.selectOption('#pmDlMonth', '8'); // septembre
    await page.selectOption('#pmDlYear', String(year));
    await page.screenshot({ path: path.join(SHOTS, '31-03-periode-visee.png') });
    await page.click('#projectModal >> text=Enregistrer');
    await page.waitForSelector('#projectModal.hidden', { state: 'attached' });
    await flush(page);
    let d = await docOf(page, uid);
    assert.equal(d.deadline, `${year}-09-30`, 'le calcul va jusqu\'à la fin du mois visé');
    assert.equal(d.deadlineMonth, true);
    assert.equal(await page.textContent('#dlLabel'), 'Dépôt visé');
    assert.equal(await page.textContent('#dbDeadline .dl-date'), `septembre ${year}`);
    assert.match(await page.textContent('#dbDeadline .dl-verdict'), /dans les temps|en retard|à tenir/);
    assert.equal(await page.textContent('#dbDeadline .cal-month'), 'sept.', 'l\'éphéméride montre le mois, pas un jour');
    assert.ok(await page.locator('.due-chip:not(:empty)').count() >= 3, 'les échéances des chapitres suivent');
    // La fenêtre se rouvre sur le mois ; l'agenda parle de période
    await page.click('#dbDeadline .dl-show');
    await page.waitForSelector('#projectModal:not(.hidden)');
    assert.equal(await page.inputValue('#pmDlMonth'), '8');
    assert.equal(await page.inputValue('#pmDlYear'), String(year));
    await page.keyboard.press('Escape');
    await page.evaluate(() => window.openCalendarModal());
    await page.waitForSelector('#calendarModal:not(.hidden)');
    assert.match(await page.textContent('#calSummary'), /Un événement récurrent\s: chaque lundi, mardi, mercredi, jeudi et vendredi à 9\sh, pendant 1\sh 30, jusqu'au \d+ \S+ \d{4}\. Rappel dix minutes avant\./);
    assert.match(await page.textContent('#calDlLbl'), new RegExp(`Période visée pour le dépôt\\s: septembre ${year}`));
    assert.equal(await page.isChecked('#calIncSync'), true, 'proposé à qui synchronise son document');
    const g = new URL(await page.getAttribute('#calGoogle', 'href'));
    assert.match(g.searchParams.get('recur'), /^RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=\d{8}T235959Z$/, 'lien Google : événement récurrent');
    assert.match(g.searchParams.get('dates'), /^\d{8}T090000\/\d{8}T103000$/);
    const gs = new URL(await page.getAttribute('#calGoogleSync', 'href'));
    assert.match(gs.searchParams.get('recur'), /^RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=\d{8}T235959Z$/);
    assert.match(gs.searchParams.get('details'), /\?action=sync/);
    const gd = new URL(await page.getAttribute('#calGoogleDeadline', 'href'));
    assert.equal(gd.searchParams.get('dates'), `${year}0901/${year}1001`, 'la période couvre tout le mois');
    await page.screenshot({ path: path.join(SHOTS, '31-04-agenda.png') });
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#calendarModal >> text=fichier agenda (.ics)')]);
    const ics = fs.readFileSync(await dl.path(), 'utf8').replace(/\r\n /g, '');
    assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;UNTIL=\d{8}T235959\r\n/);
    assert.match(ics, /SUMMARY:Point d'étape : mettre mon Journal de Bord à jour/);
    assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=FR;UNTIL=/);
    assert.match(ics, new RegExp(`DTSTART;VALUE=DATE:${year}0901\\r\\nDTEND;VALUE=DATE:${year}1001`), 'période visée : un événement sur tout le mois');
    assert.match(ics, new RegExp(`SUMMARY:Dépôt visé \\(septembre ${year}\\)`));
    assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1 + 1 + 1 + 1 + 4, 'séances, point d\'étape, dépôt, fin de rédaction, 4 chapitres');
    await page.click('#calendarModal >> text=Fermer');
    // Sans point d'étape : un événement de moins, plus de lien
    await page.evaluate(() => window.openCalendarModal());
    await page.uncheck('#calIncSync');
    assert.equal(await page.isVisible('#calGoogleSync'), false);
    await page.click('#calendarModal >> text=Fermer');
    // Le lien du point d'étape ouvre la synchro du document
    await page.goto(BASE + '?action=sync');
    await page.waitForSelector('#docxModal:not(.hidden)');
    assert.equal(new URL(page.url()).search, '');
    await page.keyboard.press('Escape');
    // Bilan imprimable
    await page.evaluate(() => { window.print = () => {}; window.printReport(); });
    assert.match(await page.textContent('#printReport'), new RegExp(`Dépôt visé\\s*septembre ${year}`));
    // Une date précise remplace la période
    await page.evaluate(() => window.openProjectModal());
    await page.click('#pmDlSeg >> text=Date précise');
    await page.fill('#pmDeadline', `${year}-10-15`);
    await page.click('#projectModal >> text=Enregistrer');
    await flush(page);
    d = await docOf(page, uid);
    assert.equal(d.deadline, `${year}-10-15`);
    assert.equal(d.deadlineMonth, false);
    assert.equal(await page.textContent('#dlLabel'), 'Dépôt');
    assert.match(await page.textContent('#dbDeadline .dl-date'), /^15 oct\. \d{4}$/);
    assert.equal(await page.textContent('#dbDeadline .cal-d'), '15');
    assert.deepEqual(page._errors, []);
    await ctx.close();
  });

  /* ------------------------------------------------------------ */
  await test('Rappel de synchro : discret, au bout d\'une semaine, seulement pour qui dépose son document', async () => {
    const mk = async (uid, days, extra = {}) => {
      const doc = clone(V1_DOC);
      Object.assign(doc, { version: 2, trackedSince: addDays(TODAY, -40), activity: { [addDays(TODAY, -days)]: 2 },
        docFiles: days === null ? {} : { these: { name: 'these.docx', at: addDays(TODAY, -days), inclWords: 4000, wpp: 380, scope: '' } } }, extra);
      const r = await newPage(browser, { user: { uid, email: `${uid}@example.com` }, store: { [`users/${uid}/thesis/main`]: doc } });
      await r.page.goto(BASE);
      await r.page.waitForSelector('.chapter-card');
      return r;
    };
    const a = await mk('u_s9', 9);
    assert.match(await a.page.textContent('#tdSub'), /Dernière synchro de votre document il y a 9 jours\. Déposez-le dans la page \(ou collez votre texte\)/);
    assert.equal(await a.page.textContent('#wordBtn'), 'Synchroniser mon document');
    // Une synchro, et le rappel disparaît
    await a.page.evaluate(() => { window.showOpenFilePicker = undefined; });
    await sendDocx(a.page, 'these.docx');
    await a.page.waitForSelector('#docxStep2:not(.hidden)', { timeout: 15000 });
    await a.page.click('#docxApply');
    await a.page.waitForSelector('#docxModal.hidden', { state: 'attached' });
    assert.ok(!/Dernière synchro/.test(await a.page.textContent('#tdSub')));
    assert.deepEqual(a.page._errors, []);
    await a.ctx.close();
    const b = await mk('u_s3', 3);
    assert.ok(!/Dernière synchro/.test(await b.page.textContent('#tdSub')), 'pas avant une semaine');
    await b.ctx.close();
    const c = await mk('u_s0', null);
    assert.ok(!/synchro/.test(await c.page.textContent('#tdSub')), 'jamais pour qui note ses pages à la main');
    await c.ctx.close();
  });

  await browser.close();
  console.log(results.join('\n'));
  console.log(failures ? `\n${failures} échec(s)` : '\nTous les tests passent');
  process.exit(failures ? 1 : 0);
})();

// Outils communs aux vidéos pour les réseaux sociaux : serveur local, captures du site sur un téléphone,
// composition image par image sur la scène (scene.html), encodage en MP4. Voir video-1.cjs et video-2.cjs.
const fs = require('fs');
const path = require('path');
const http = require('http');
const { execFileSync, execSync } = require('child_process');

function loadPlaywright() {
  try { return require('playwright'); } catch { /* pas installé ici */ }
  return require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
}
const { chromium } = loadPlaywright();

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'tests', '.tmp', 'videos');
const SHOTS = path.join(OUT, 'shots');
const STUB = n => fs.readFileSync(path.join(ROOT, 'tests', 'stubs', n), 'utf8');

/* ---------- Le site, sur un téléphone ---------- */
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
  const srv = http.createServer((q, r) => {
    let p = decodeURIComponent(q.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    r.end(fs.readFileSync(f));
  });
  return new Promise(res => srv.listen(0, () => res(srv)));
}

async function capture(base) {
  fs.mkdirSync(SHOTS, { recursive: true });
  // Champs de date au format français (jj/mm/aaaa) : nouveau mode sans fenêtre et langue du système
  const b = await chromium.launch({ channel: 'chromium', args: ['--lang=fr-FR'], env: { ...process.env, LANG: 'fr_FR.UTF-8', LANGUAGE: 'fr' } });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, serviceWorkers: 'block', locale: 'fr-FR', timezoneId: 'Europe/Paris', isMobile: true, hasTouch: true });
  for (const n of ['app', 'auth', 'firestore']) await ctx.route(`https://www.gstatic.com/firebasejs/10.8.1/firebase-${n}.js`, r => r.fulfill({ contentType: 'application/javascript', body: STUB(`firebase-${n}.js`) }));
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('__init')) return;
    sessionStorage.setItem('__init', '1');
    localStorage.clear();
    localStorage.setItem('__fbuser', JSON.stringify({ uid: 'demo', email: 'camille@exemple.fr', displayName: 'Camille Durand' }));
  });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  const rects = {};
  const clean = () => p.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
  const rect = async (name, sel) => { rects[name] = await p.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, sel); };
  const shot = name => p.screenshot({ path: path.join(SHOTS, name + '.png') });

  await p.goto(base);
  await p.waitForSelector('.onboarding');
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900);
  await clean();
  await shot('01-vide');
  await rect('drop', '.ob-drop');
  // Le document déposé : sa lecture est ralentie, le temps de saisir le message « Lecture de… »
  const b64 = fs.readFileSync(path.join(__dirname, 'these-demo.docx')).toString('base64');
  await p.evaluate(data => {
    const bin = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const f = new File([bin], 'these.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const read = f.arrayBuffer.bind(f);
    f.arrayBuffer = () => new Promise(done => setTimeout(() => done(read()), 2500));
    window.handleDocxFiles([f]);
  }, b64);
  await p.waitForTimeout(500);
  await shot('02-lecture');
  // L'aperçu : chapitres retrouvés, pages comptées
  await p.waitForSelector('#docxStep2:not(.hidden)', { timeout: 20000 });
  await p.fill('#docxTotal', '240');
  await p.dispatchEvent('#docxTotal', 'input');
  await p.locator('#docxTotal').blur();
  await p.waitForTimeout(400);
  await clean();
  await shot('03-apercu');
  await rect('summary', '#docxSummary');
  await p.evaluate(() => document.querySelector('#docxRows').scrollIntoView({ block: 'start' }));
  await p.waitForTimeout(300);
  await shot('04-chapitres');
  await rect('row1', '#docxRows .dx-row:nth-child(1)');
  await rect('row2', '#docxRows .dx-row:nth-child(2)');
  await rect('apply', '#docxApply');
  // Le plan créé
  await p.click('#docxApply');
  await p.waitForSelector('.chapter-card');
  await p.fill('#document-title', 'Les ponts suspendus en France au XIXe siècle');
  await p.locator('#document-title').blur();
  await p.waitForTimeout(1800);
  await clean();
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(300);
  await shot('05-bandeau');
  await p.evaluate(() => { document.querySelector('.workspace').scrollIntoView({ block: 'start' }); window.scrollBy(0, -14); });
  await p.waitForTimeout(1400);
  await clean();
  await shot('06-etagere');
  await rect('shelf', '#shelfBooks');
  await b.close();
  if (errs.length) throw new Error('erreurs dans la page : ' + errs.join(' | '));
  return rects;
}

/* ---------- La composition, image par image ---------- */
async function compose(base, scenes, FRAMES) {
  fs.rmSync(FRAMES, { recursive: true, force: true });
  fs.mkdirSync(FRAMES, { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  await p.goto(base + 'tests/videos/scene.html');
  await p.waitForFunction(() => window.ready === true);
  await p.evaluate(() => document.fonts.ready);
  let n = 0;
  for (const sc of scenes) {
    for (let i = 0; i < sc.n; i++, n++) {
      await p.evaluate(s => window.render(s), Object.assign({ seed: n * 7919 + 13 }, sc.fn(i)));
      await p.screenshot({ path: path.join(FRAMES, `f${String(n).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
    }
  }
  await b.close();
  return n;
}

/* ---------- Outils du scénario ---------- */
const SHOT = n => `/tests/.tmp/videos/shots/${n}.png`;
const NB = '\u00A0';
const K = 596 / 390, SX = 242, SY = 576;                        // écran du téléphone sur la scène (téléphone en place)
const toStage = (x, y) => [SX + x * K, SY + y * K];
const pad = (r, a = 6) => ({ x: r.x - a, y: r.y - a, w: r.w + 2 * a, h: r.h + 2 * a });
const step = (i, from, list) => list[Math.max(0, Math.min(list.length - 1, i - from))];
const words = (i, n, every = 2, from = 0) => Math.max(0, Math.min(n, Math.floor((i - from) / every) + 1));
const boil = i => [11, 29, 47][i % 3];                           // le trait « vibre » d'une image à l'autre
const growth = [0, 1, 2, 4, 7, 14, 21, 30];                      // la plante de la fin, étape par étape

/** Fabrique la vidéo numéro num : captures, images, MP4 et couverture (l'image numéro cover). */
async function make(num, storyboard, { cover = 0 } = {}) {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const rects = await capture(base);
  const scenes = [];
  storyboard(rects, (n, fn) => scenes.push({ n, fn }));
  const frames = path.join(OUT, String(num), 'frames');
  const n = await compose(base, scenes, frames);
  srv.close();
  const mp4 = path.join(OUT, `journal-de-bord-video-${num}.mp4`);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', path.join(frames, 'f%04d.jpg'), '-vf', 'fps=24,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart', '-r', '24', mp4]);
  fs.copyFileSync(path.join(frames, `f${String(cover).padStart(4, '0')}.jpg`), path.join(OUT, `journal-de-bord-video-${num}-couverture.jpg`));
  console.log(`${n} images (${(n / 8).toFixed(2)} s) → ${path.relative(ROOT, mp4)}`);
}

module.exports = { make, SHOT, NB, K, SX, SY, toStage, pad, step, words, boil, growth };

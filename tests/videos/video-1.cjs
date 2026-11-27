// Vidéo 1 pour les réseaux sociaux : « Déposez votre thèse : le Journal trouve vos chapitres et compte vos pages »
// Image par image, façon stop motion (8 images par seconde, chacune un peu « reprise »), format vertical 1080 × 1920.
//
//   node tests/videos/video-1.cjs        → tests/.tmp/videos/journal-de-bord-video-1.mp4 (et une image de couverture)
//
// Le site est filmé sur un téléphone, avec un compte de démonstration fictif et la base simulée de tests/stubs :
// aucun compte réel, aucune donnée réelle. Il faut Playwright (comme pour les tests) et ffmpeg.
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
const WORK = path.join(ROOT, 'tests', '.tmp', 'videos', '1');
const SHOTS = path.join(WORK, 'shots');
const FRAMES = path.join(WORK, 'frames');
const OUT = path.join(ROOT, 'tests', '.tmp', 'videos');
const STUB = n => fs.readFileSync(path.join(ROOT, 'tests', 'stubs', n), 'utf8');

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

/* ---------- 1. Les captures du site, sur un téléphone ---------- */
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

/* ---------- 2. Le scénario, image par image ---------- */
function storyboard(R) {
  const IMG = n => `/tests/.tmp/videos/1/shots/${n}.png`;
  const NB = ' ';
  const K = 596 / 390, SX = 242, SY = 576;                      // écran du téléphone sur la scène
  const toStage = (x, y) => [SX + x * K, SY + y * K];
  const pad = (r, a = 6) => ({ x: r.x - a, y: r.y - a, w: r.w + 2 * a, h: r.h + 2 * a });
  const step = (i, from, list) => list[Math.max(0, Math.min(list.length - 1, i - from))];
  const words = (i, n, every = 2, from = 0) => Math.max(0, Math.min(n, Math.floor((i - from) / every) + 1));
  const boil = i => [11, 29, 47][i % 3];                         // le trait « vibre » d'une image à l'autre
  const scenes = [];
  const scene = (n, fn) => scenes.push({ n, fn });

  // A. L'accroche : l'étagère vide, la question, le tampon
  scene(30, i => ({
    phone: { img: IMG('01-vide'), dy: step(i, 0, [1400, 1020, 640, 300, 90, 0]) },
    note: { tokens: ['Votre', 'thèse', 'fait', 'combien', 'de', `pages${NB}?`], shown: words(i, 6), hl: [5], size: 86, y: 130 },
    stamp: i >= 15 ? { text: 'Ne comptez plus.', x: 150, y: 735, rot: -7, k: step(i, 15, [1.4, 1.12, 1]) } : null,
  }));
  // B. Déposer le document
  const [dx, dy] = toStage(R.drop.x + R.drop.w / 2, R.drop.y + R.drop.h / 2);
  const fall = [[862, 640, 11, 1], [840, 790, 18, 0.95], [790, 955, 26, 0.88], [712, 1120, 34, 0.78], [622, 1275, 30, 0.68], [dx, dy, 22, 0.58]];
  scene(20, i => ({
    phone: { img: IMG('01-vide'), drop: i >= 18 ? R.drop : null },
    note: { tokens: ['Déposez', 'votre', 'document.'], shown: words(i, 3), hl: [2], size: 86, y: 130, sub: 'Word, LibreOffice, PDF, LaTeX ou Google Docs', subOn: i >= 6 },
    doc: i < 4 ? null : i < 12 ? { x: 862, y: 640, rot: 11, s: 1 } : i < 18 ? { x: fall[i - 12][0], y: fall[i - 12][1], rot: fall[i - 12][2], s: fall[i - 12][3] } : i === 18 ? { x: dx, y: dy, rot: 20, s: 0.4 } : null,
  }));
  // C. La lecture, sur l'appareil
  scene(18, i => ({
    phone: { img: IMG('02-lecture') },
    note: { tokens: ['Lu', 'sur', 'votre', 'appareil.'], shown: words(i, 4), hl: [3], size: 86, y: 130, sub: 'Rien n’est envoyé.', subOn: i >= 8 },
  }));
  // D. Les chapitres retrouvés
  scene(28, i => ({
    phone: { img: IMG('03-apercu'), circle: i >= 8 ? { rect: pad(R.summary, 2), p: Math.min(1, (i - 7) / 6), seed: boil(i) } : null },
    note: { tokens: ['Il', 'retrouve', 'vos', 'chapitres…'], shown: words(i, 4), hl: [3], size: 86, y: 130 },
    callout: i >= 15 ? { img: IMG('03-apercu'), crop: pad(R.summary, 8), w: 940, y: 470, rot: 1.4, k: step(i, 15, [0.72, 1.06, 1]) } : null,
  }));
  // E. Les pages, chapitre par chapitre, puis « Créer mon plan »
  const row = { x: R.row1.x, y: R.row1.y, w: R.row1.w, h: R.row2.y + R.row2.h - R.row1.y };
  const apply = { x: R.apply.x + R.apply.w / 2, y: R.apply.y + R.apply.h / 2 };
  scene(32, i => ({
    phone: { img: IMG('04-chapitres'), tap: i >= 26 ? { x: apply.x, y: apply.y, k: Math.min(1, (i - 26) / 3) } : null },
    note: { tokens: ['…et', 'compte', 'vos', 'pages,', 'chapitre', 'par', 'chapitre.'], shown: words(i, 7, 1), hl: [3], size: 72, y: 130 },
    callout: i >= 12 && i < 25 ? { img: IMG('04-chapitres'), crop: pad(row, 6), w: 940, y: 500, rot: -1.2, k: step(i, 12, [0.72, 1.06, 1]) } : null,
  }));
  // F. Le plan est prêt
  scene(24, i => ({
    phone: { img: IMG('05-bandeau') },
    note: { tokens: ['Votre', 'plan', 'est', 'prêt.'], shown: words(i, 4), hl: [1], size: 86, y: 130, sub: 'En un geste.', subOn: i >= 8 },
    callout: i >= 11 ? { img: IMG('05-bandeau'), crop: { x: 14, y: 168, w: 362, h: 150 }, w: 940, y: 460, rot: 1.1, k: step(i, 11, [0.72, 1.06, 1]) } : null,
  }));
  // G. L'étagère
  scene(24, i => ({
    phone: { img: IMG('06-etagere'), circle: i >= 10 ? { rect: pad(R.shelf, -6), p: Math.min(1, (i - 9) / 6), seed: boil(i) } : null },
    note: { tokens: ['Chaque', 'chapitre', 'devient', 'un', 'livre', 'qui', 'se', 'remplit.'], shown: words(i, 8, 1), hl: [4], size: 72, y: 130 },
  }));
  // H. La fin : le nom, l'adresse, la plante qui pousse
  const growth = [0, 1, 2, 4, 7, 14, 21, 30];
  scene(34, i => ({
    end: {
      icon: step(i, 0, [0.35, 0.8, 1.12, 1]), title: Math.max(0, Math.min(4, i - 2)), tag: i >= 9, pill: i >= 12, url: i >= 15,
      plant: growth[Math.max(0, Math.min(growth.length - 1, Math.floor((i - 4) / 2)))], books: Math.max(0, Math.min(1, Math.floor((i - 6) / 2) / 7)),
    },
  }));
  return scenes;
}

async function compose(base, scenes) {
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

(async () => {
  const srv = await serve();
  const base = `http://localhost:${srv.address().port}/`;
  const rects = await capture(base);
  const n = await compose(base, storyboard(rects));
  srv.close();
  const mp4 = path.join(OUT, 'journal-de-bord-video-1.mp4');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '8', '-i', path.join(FRAMES, 'f%04d.jpg'), '-vf', 'fps=24,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-profile:v', 'high', '-level', '4.1', '-movflags', '+faststart', '-r', '24', mp4]);
  fs.copyFileSync(path.join(FRAMES, 'f0024.jpg'), path.join(OUT, 'journal-de-bord-video-1-couverture.jpg'));
  console.log(`${n} images (${(n / 8).toFixed(2)} s) → ${path.relative(ROOT, mp4)}`);
})().catch(e => { console.error('ÉCHEC', e.message); process.exit(1); });

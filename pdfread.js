/* ============================================================
   PDF — lecture du fichier
   Le fichier est lu sur l'appareil par PDF.js (Mozilla, licence
   Apache 2.0), embarqué dans vendor/pdfjs et chargé seulement
   quand on ouvre un PDF. On en tire un modèle simple (pages,
   lignes de texte, signets, titres balisés) que pdfdoc.js analyse.

   Un gros PDF (des centaines de pages, des dizaines de Mo d'images)
   est lu par morceaux : seules les parties utiles au texte sont
   chargées, pas les images.
============================================================ */
import { linesFromItems, analyzePdfModel } from './pdfdoc.js';

const LIB_URL = './vendor/pdfjs/pdf.min.js';
const WORKER_URL = './vendor/pdfjs/pdf.worker.min.js';
const RANGE_FROM = 24 * 1024 * 1024;   // au-delà, lecture par morceaux
const CHUNK = 256 * 1024;

export class PdfError extends Error {
  constructor(code) { super(code); this.code = code; }
}

let _lib = null;
/** Charge PDF.js (une fois). lib : pour les essais hors navigateur, la bibliothèque déjà chargée. */
export async function pdfLib(lib) {
  if (lib) { _lib = lib; return lib; }
  if (_lib) return _lib;
  try {
    const m = await import(LIB_URL);
    m.GlobalWorkerOptions.workerSrc = new URL(WORKER_URL, import.meta.url).href;
    _lib = m;
  } catch (e) {
    console.warn('PDF.js :', e);
    throw new PdfError('pdf-lib');
  }
  return _lib;
}

function fail(e) {
  if (e instanceof PdfError) return e;
  const name = (e && e.name) || '';
  if (name === 'PasswordException') return new PdfError('pdf-password');
  if (name === 'InvalidPDFException' || name === 'MissingPDFException' || name === 'FormatError') return new PdfError('pdf-broken');
  if (name === 'UnexpectedResponseException' || name === 'AbortException') return new PdfError('pdf-fetch');
  console.warn('PDF :', e);
  return new PdfError('pdf-broken');
}

/** Signets : la liste à plat, avec la page et la hauteur de chaque destination. */
async function readOutline(doc, tree, sizes) {
  const flat = [];
  const walk = (items, level) => {
    for (const it of items || []) {
      if (flat.length >= 5000) return;
      flat.push({ title: String(it.title || ''), level, dest: it.dest });
      if (level < 9) walk(it.items, level + 1);
    }
  };
  walk(tree, 1);
  const out = [];
  for (const it of flat) {
    let dest = it.dest;
    try {
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest) || !dest.length) continue;
      const ref = dest[0];
      const page = Number.isInteger(ref) ? ref : await doc.getPageIndex(ref);
      if (!(page >= 0 && page < sizes.length)) continue;
      const kind = dest[1] && dest[1].name;
      const top = kind === 'XYZ' ? dest[3] : (kind === 'FitH' || kind === 'FitBH') ? dest[2] : kind === 'FitR' ? dest[5] : null;
      const s = sizes[page];
      const y = Number.isFinite(top) && !s.rot ? Math.max(0, Math.min(s.h, s.y1 - top)) : null;
      out.push({ title: it.title, level: it.level, page, y });
    } catch { /* destination introuvable : signet ignoré */ }
  }
  return out;
}

/** Titres balisés d'une page (PDF accessible) : { identifiant de contenu → { niveau, rang du titre } }.
 *  Un titre sur deux lignes tient en plusieurs morceaux de contenu : ils portent le même rang. */
function taggedHeadings(tree) {
  const ids = new Map();
  let serial = 0;
  const walk = (node, head) => {
    if (!node) return;
    if (node.type === 'content' && node.id) { if (head) ids.set(node.id, head); return; }
    const m = /^H([1-6])?$/.exec(node.role || '');
    const h = m ? { level: m[1] ? +m[1] : 1, n: ++serial } : head;
    for (const c of node.children || []) walk(c, h);
  };
  walk(tree, null);
  return ids;
}

/**
 * Lit un PDF et renvoie son analyse (voir pdfdoc.js).
 * source : File/Blob, Uint8Array, ArrayBuffer ou { url }
 * opts   : { planTitles, onProgress(pagesLues, total), lib }
 */
export async function readPdfDocument(source, opts = {}) {
  const lib = await pdfLib(opts.lib);
  const params = { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, verbosity: 0, stopAtErrors: false };
  if (source && typeof source.url === 'string') {
    Object.assign(params, { url: source.url, withCredentials: false, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true });
  } else if (source && typeof source.slice === 'function' && typeof source.arrayBuffer === 'function' && source.size > RANGE_FROM) {
    const file = source;
    const transport = new lib.PDFDataRangeTransport(file.size, null);
    transport.requestDataRange = (begin, end) => {
      file.slice(begin, end).arrayBuffer().then(buf => transport.onDataRange(begin, new Uint8Array(buf)), e => console.warn('PDF, lecture partielle :', e));
    };
    Object.assign(params, { range: transport, length: file.size, rangeChunkSize: CHUNK, disableAutoFetch: true, disableStream: true });
  } else {
    const buf = source instanceof Uint8Array ? source : source instanceof ArrayBuffer ? new Uint8Array(source) : new Uint8Array(await source.arrayBuffer());
    params.data = buf;
  }

  let doc;
  const task = lib.getDocument(params);
  task.onPassword = () => { throw new PdfError('pdf-password'); };
  try { doc = await task.promise; } catch (e) { throw fail(e); }

  try {
    const n = doc.numPages;
    const meta = await doc.getMetadata().catch(() => null);
    const mark = await doc.getMarkInfo().catch(() => null);
    const info = (meta && meta.info) || {};
    const pages = new Array(n);
    const sizes = new Array(n);
    let tags = [];
    let done = 0;
    // Pas de signets, mais un PDF balisé (export de Word) : les titres sont dans les balises de structure
    const tree = await doc.getOutline().catch(() => null);
    const withTags = !(tree && tree.length) && !!(mark && mark.Marked);

    // Première passe : taille des pages et texte
    const readPage = async i => {
      const page = await doc.getPage(i + 1);
      const v = page.view || [0, 0, 595.3, 841.9];
      const rot = ((page.rotate || 0) % 360 + 360) % 360;
      const w = v[2] - v[0];
      const h = v[3] - v[1];
      sizes[i] = { w, h, x0: v[0], y1: v[3], rot };
      const tc = await page.getTextContent({ includeMarkedContent: withTags });
      const items = [];
      const marked = withTags ? [] : null;
      let open = [];
      for (const it of tc.items) {
        if (it.type) {
          if (!marked) continue;
          if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') open.push(it.id || '');
          else if (it.type === 'endMarkedContent') open.pop();
          continue;
        }
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const size = it.height || Math.hypot(t[2], t[3]) || 0;
        const item = { str: it.str, x: t[4] - v[0], y: v[3] - t[5], size, w: it.width || 0, eol: !!it.hasEOL };
        items.push(item);
        if (marked && open.length && it.str) marked.push([open[open.length - 1], item]);
      }
      pages[i] = { w, h, lines: linesFromItems(items) };
      if (marked && marked.length) {
        const st = await page.getStructTree().catch(() => null);
        const ids = taggedHeadings(st);
        if (ids.size) {
          const byHead = new Map();
          for (const [id, item] of marked) {
            const hd = ids.get(id);
            if (!hd) continue;
            if (!byHead.has(hd.n)) { if (!item.str.trim()) continue; byHead.set(hd.n, { level: hd.level, text: '', y: item.y - item.size, lastY: item.y }); }
            const acc = byHead.get(hd.n);
            if (acc.text && Math.abs(item.y - acc.lastY) > item.size * 0.5 && !/\s$/.test(acc.text)) acc.text += ' ';
            acc.text += item.str;
            acc.lastY = item.y;
          }
          for (const hd of byHead.values()) pages[i].tags = (pages[i].tags || []).concat([{ title: hd.text.replace(/\s+/g, ' ').trim(), level: hd.level, page: i, y: Math.max(0, hd.y) }]);
        }
      }
      page.cleanup();
      done++;
      if (opts.onProgress && (done % 10 === 0 || done === n)) opts.onProgress(done, n);
    };
    const runAll = async () => {
      let next = 0;
      const worker = async () => { while (next < n) { const i = next++; await readPage(i); } };
      await Promise.all(Array.from({ length: Math.min(6, n) }, worker));
    };
    await runAll();

    const outline = await readOutline(doc, tree, sizes);
    if (withTags) {
      for (const pg of pages) { if (pg.tags) { tags = tags.concat(pg.tags); delete pg.tags; } }
      tags = tags.filter(t => t.title);
    }
    const res = analyzePdfModel({ pages, outline, tags, info }, { planTitles: opts.planTitles });
    res.producer = String(info.Producer || info.Creator || '').slice(0, 80);
    res.docTitle = String(info.Title || '').slice(0, 200);
    return res;
  } catch (e) {
    throw fail(e);
  } finally {
    try { await doc.destroy(); } catch { /* déjà fermé */ }
  }
}

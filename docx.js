/* ============================================================
   DOCUMENTS — lecture du manuscrit dans le navigateur
   Le fichier n'est jamais envoyé. Formats lus :
     • PDF (LaTeX et Overleaf, Word, Pages, Scrivener, Typst…) : la
       pagination est exacte, le plan vient des signets, des titres
       balisés ou de la mise en forme (pdfread.js, pdfdoc.js) ;
     • Word (.docx) et LibreOffice (.odt) : on ouvre l'archive (zip.js,
       sans bibliothèque extérieure) et on lit les titres et le texte ;
     • LaTeX (.tex), Markdown (.md), texte simple (.txt) ;
     • contenu collé : le presse-papiers garde les titres de Google
       Docs, de Word, de LibreOffice (HTML), ou le texte brut.
   Chaque lecteur renvoie la même chose : la liste des titres avec
   leur niveau, leur nombre de mots (notes de bas de page comprises)
   et leur longueur en pages (voir outline.js pour le passage au plan
   à deux étages).
   Les pages viennent de la meilleure source disponible (pages.js) :
   pagination réelle du fichier, sinon simulation de sa mise en page.
============================================================ */
import { countWords, parseTextDocument, signs, guessHeadings } from './outline.js';
import { paginate, spans, readPdf, byBreaks } from './pages.js';
import { openZip, canInflate } from './zip.js';
import { readPdfDocument } from './pdfread.js';
import { parseRtf, parseTypst, parseOrg, parseAsciidoc, parseRst, texMain, resolveTex, resolveTypst } from './formats.js';

export { countWords };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
// Secours pour les navigateurs d'avant 2023, qui ne savent pas décompresser seuls
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const JSZIP_SRI = 'sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==';

export const DEFAULT_WPP = 380; // mots par page (Times 12, interligne 1,5, marges 2,5 cm)
// Sans mise en page à lire (texte collé, Markdown, LaTeX), on compte en signes : c'est ce que contient
// en moyenne une page de thèse en Times 12, interligne 1,5, marges de 2,5 cm, titres et fins de chapitre compris.
export const SIGNS_PER_PAGE = 2700;
export const SIGNS_PER_PAGE_LATEX = 3000;

export class DocxError extends Error {
  constructor(code) { super(code); this.code = code; }
}

let _zipPromise = null;
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  if (!_zipPromise) {
    _zipPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = JSZIP_URL;
      s.integrity = JSZIP_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (window.JSZip ? resolve(window.JSZip) : reject(new DocxError('zip-lib')));
      s.onerror = () => { _zipPromise = null; reject(new DocxError('zip-lib')); };
      document.head.appendChild(s);
    });
  }
  return _zipPromise;
}

/** Ouvre une archive : lecteur maison, ou JSZip (chargé à la demande) si le navigateur ne décompresse pas seul. */
async function openArchive(buf) {
  if (canInflate()) {
    try { return openZip(buf); } catch { throw new DocxError('not-docx'); }
  }
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new DocxError('not-docx'); }
  return {
    names: Object.keys(zip.files).filter(n => !zip.files[n].dir),
    has: n => !!zip.file(n),
    size: () => -1,
    bytes: n => { const f = zip.file(n); return f ? f.async('uint8array') : Promise.resolve(null); },
    text: n => { const f = zip.file(n); return f ? f.async('string') : Promise.resolve(null); },
  };
}

const TEXT_EXT = /\.(tex|ltx|rnw|md|markdown|mdown|qmd|rmd|typ|org|adoc|asciidoc|txt|text|rst)$/i;
// Fichiers qu'un projet (archive .zip, plusieurs fichiers déposés) peut contenir
const PROJECT_TEXT = /\.(tex|ltx|rnw|typ|md|markdown|qmd|rmd)$/i;
const INNER_DOC = /\.(docx|docm|odt|pdf|rtf)$/i;
const MAX_TEXT = 30 * 1024 * 1024;

function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // Fichier enregistré en Latin-1 / Windows-1252 : beaucoup de caractères de remplacement en UTF-8
  if ((utf8.match(/\uFFFD/g) || []).length > 3) {
    try { return new TextDecoder('windows-1252').decode(buf); } catch { /* décodeur absent : on garde l'UTF-8 */ }
  }
  return utf8;
}

/**
 * Un PDF comme document suivi. source : File, Uint8Array ou { url }.
 * opts.planTitles : titres du plan déjà saisi ; opts.onProgress(pagesLues, total).
 */
export async function analyzePdf(source, opts = {}) {
  let r;
  try { r = await readPdfDocument(source, { planTitles: opts.planTitles, onProgress: opts.onProgress, lib: opts.pdfLib }); }
  catch (e) { throw new DocxError(e && e.code ? e.code : 'pdf-broken'); }
  const res = finish('pdf', r.segments.map(s => ({ ...s, bodyWords: 0 })), r.frontWords, null, DEFAULT_WPP,
    { total: r.totalPages, front: r.frontPages, pages: r.segments.map(s => s.pages), source: 'pdf', layout: null, gen: 'pdf' }, r.frontChars);
  res.headingSource = r.headingSource;   // 'outline' (signets), 'tags' (titres balisés), 'layout' (mise en forme), 'plan', ''
  res.scanned = !!r.scanned;             // pages scannées : pas de texte, seulement un nombre de pages
  res.docTitle = r.docTitle || '';
  return res;
}

/**
 * Lit un fichier (File) et renvoie l'analyse commune à tous les formats.
 * opts.pdf : le même document en PDF (Uint8Array), quand on l'a : il donne la pagination exacte.
 * opts.planTitles, opts.onProgress : voir analyzePdf.
 */
export async function parseDocumentFile(file, opts = {}) {
  const name = String(file.name || '');
  // Un PDF peut peser des centaines de Mo (images) : on ne le charge pas en entier, PDF.js lit ce qu'il lui faut
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return analyzePdf(file, opts);
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 5));
  if (sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0) throw new DocxError('old-doc');
  if (sig[0] === 0x50 && sig[1] === 0x4B) {
    const zip = await openArchive(buf);
    const read = p => zip.text(p).catch(e => { throw e instanceof DocxError ? e : new DocxError('bad-xml'); });
    if (zip.has('word/document.xml')) {
      const [docXml, stylesXml, appXml, footXml, endXml, themeXml, relsXml] = await Promise.all([
        read('word/document.xml'), read('word/styles.xml'), read('docProps/app.xml'),
        read('word/footnotes.xml'), read('word/endnotes.xml'), read('word/theme/theme1.xml'),
        read('word/_rels/document.xml.rels'),
      ]);
      // En-têtes et pieds de page : s'ils débordent de la marge, ils réduisent la hauteur utile des pages
      const parts = {};
      const rel = /<Relationship\b[^>]*>/g;
      for (let m = rel.exec(relsXml || ''); m; m = rel.exec(relsXml)) {
        if (!/relationships\/(header|footer)"/.test(m[0])) continue;
        const id = /\bId="([^"]+)"/.exec(m[0]);
        const target = /\bTarget="([^"]+)"/.exec(m[0]);
        if (id && target) parts[id[1]] = await read(target[1].startsWith('/') ? target[1].slice(1) : `word/${target[1]}`);
      }
      return analyzeDocx({ docXml, stylesXml, appXml, footXml, endXml, themeXml, parts, pdf: opts.pdf || null, tune: opts.tune, planTitles: opts.planTitles });
    }
    if (zip.has('content.xml')) {
      const [contentXml, stylesXml, metaXml, mime] = await Promise.all([read('content.xml'), read('styles.xml'), read('meta.xml'), read('mimetype')]);
      if (mime && !/opendocument\.text/.test(mime)) throw new DocxError('not-docx'); // tableur, présentation…
      return analyzeOdt({ contentXml, stylesXml, metaXml, planTitles: opts.planTitles });
    }
    if (/\.pages$/i.test(name) || zip.has('Index/Document.iwa')) throw new DocxError('pages');
    if (zip.names.some(n => /^(xl|ppt)\//.test(n)) || /\.(key|numbers)$/i.test(name)) throw new DocxError('not-text');
    if (zip.has('META-INF/container.xml')) throw new DocxError('epub');
    // Une archive : un projet LaTeX ou Typst (Overleaf : Menu, Télécharger, Source), ou un document qu'on a zippé
    if (opts.depth) throw new DocxError('not-docx');
    const names = zip.names.filter(n => !/(^|\/)(__MACOSX|\.git)\//.test(n) && !/(^|\/)\._/.test(n));
    const texts = names.filter(n => PROJECT_TEXT.test(n));
    if (texts.length) {
      const files = new Map();
      let total = 0;
      for (const n of texts) {
        if (zip.size(n) > MAX_TEXT) continue;
        const t = await zip.text(n).catch(() => null);
        if (t === null) continue;
        total += t.length;
        if (total > 2 * MAX_TEXT) throw new DocxError('too-big');
        files.set(n, t);
      }
      const res = analyzeProject(files);
      if (res) return res;
    }
    const inner = names.filter(n => INNER_DOC.test(n)).sort((a, b) => zip.size(b) - zip.size(a))[0];
    if (inner) {
      const bytes = await zip.bytes(inner).catch(() => null);
      if (bytes) return parseDocumentFile(new File([bytes], inner.split('/').pop()), { ...opts, depth: 1 });
    }
    throw new DocxError('zip-empty');
  }
  if (sig[0] === 0x7B && sig[1] === 0x5C && sig[2] === 0x72 && sig[3] === 0x74) {
    if (buf.byteLength > 4 * MAX_TEXT) throw new DocxError('too-big');
    return analyzeRtf(decodeText(buf), opts.planTitles);
  }
  if (/\.(gdoc|gddoc)$/i.test(name) && buf.byteLength < 4000) {
    // Raccourci créé par Google Drive pour ordinateur : il contient l'adresse du document, pas son texte
    const e = new DocxError('gdoc-shortcut');
    try { const j = JSON.parse(decodeText(buf)); e.link = String(j.doc_id || j.url || ''); } catch { e.link = ''; }
    throw e;
  }
  if (/\.(scriv|scrivx)$/i.test(name)) throw new DocxError('scriv');
  if (/^image\//.test(file.type || '') || /\.(png|jpe?g|gif|heic|webp|tiff?)$/i.test(name)) throw new DocxError('image');
  if (/\.fodt$/i.test(name) || (sig[0] === 0x3C && /<office:document\b[^>]*opendocument\.text/.test(new TextDecoder('utf-8').decode(buf.slice(0, 4000))))) {
    // LibreOffice « à plat » : un seul fichier XML pour le texte, les styles et les statistiques
    if (buf.byteLength > 4 * MAX_TEXT) throw new DocxError('too-big');
    const xml = decodeText(buf);
    return analyzeOdt({ contentXml: xml, stylesXml: null, metaXml: xml, planTitles: opts.planTitles });
  }
  if (/\.html?$/i.test(name) || file.type === 'text/html') {
    if (buf.byteLength > MAX_TEXT) throw new DocxError('too-big');
    return analyzeHtml(decodeText(buf)); // page enregistrée depuis un éditeur en ligne
  }
  if (TEXT_EXT.test(name) || /^text\//.test(file.type || '')) {
    if (buf.byteLength > MAX_TEXT) throw new DocxError('too-big');
    return analyzeText(decodeText(buf), name);
  }
  throw new DocxError('not-docx');
}

/**
 * Plusieurs fichiers déposés ensemble (un projet LaTeX : fichier principal et chapitres ; des chapitres
 * en Markdown ou en Typst). Renvoie l'analyse du document assemblé, ou null si ce n'est pas un projet.
 */
export async function parseProjectFiles(fileList) {
  const list = [...fileList].filter(f => PROJECT_TEXT.test(f.name));
  if (list.length < 2 || list.length !== [...fileList].length) return null;
  const files = new Map();
  let total = 0;
  for (const f of list) {
    total += f.size;
    if (total > 2 * MAX_TEXT) throw new DocxError('too-big');
    files.set(f.webkitRelativePath || f.name, decodeText(await f.arrayBuffer()));
  }
  return analyzeProject(files);
}

/** Un projet : fichiers LaTeX assemblés autour du fichier principal, ou Typst, sinon chapitres Markdown mis bout à bout. */
function analyzeProject(files) {
  const names = [...files.keys()];
  const tex = names.filter(n => /\.(tex|ltx|rnw)$/i.test(n));
  let res = null;
  let main = '';
  if (tex.length) {
    main = texMain(files);
    let text = resolveTex(main, files);
    // Pas de fichier principal (seulement des chapitres) : on les met bout à bout, dans l'ordre de leurs noms
    if (!/\\(chapter|section|part)\b/.test(text)) text = tex.slice().sort((a, b) => a.localeCompare(b, 'fr', { numeric: true })).map(n => files.get(n)).join('\n\n');
    res = analyzeText(text, 'projet.tex');
  } else {
    const typ = names.filter(n => /\.typ$/i.test(n));
    if (typ.length) {
      main = typ.map(n => [n, (files.get(n).match(/#include\s+"/g) || []).length]).sort((a, b) => b[1] - a[1] || a[0].split('/').length - b[0].split('/').length)[0][0];
      res = analyzeText(resolveTypst(main, files), 'projet.typ');
    } else {
      const md = names.filter(n => /\.(md|markdown|qmd|rmd)$/i.test(n) && !/(^|\/)(readme|license|changelog)\b/i.test(n)).sort((a, b) => a.localeCompare(b, 'fr', { numeric: true }));
      if (!md.length) return null;
      main = md[0];
      res = analyzeText(md.map(n => files.get(n)).join('\n\n'), 'projet.md');
    }
  }
  res.project = { main: main.split('/').pop(), files: names.length };
  return res;
}

/** Ancien nom, gardé pour compatibilité. */
export const parseDocxFile = parseDocumentFile;

/** Contenu collé (presse-papiers) : le HTML garde les titres ; sinon le texte brut (LaTeX, Markdown…). */
export function parsePasted({ html, text }) {
  const plain = String(text || '');
  if (html && html.length <= 60 * 1024 * 1024) {
    try {
      const r = analyzeHtml(html);
      // Pas de titre dans le HTML (éditeur de code, Overleaf…) : le texte brut peut en contenir
      if (r.segments.length || !plain.trim()) return r;
      const t = analyzeText(plain);
      return t.segments.length ? t : r;
    } catch (e) { console.warn('Presse-papiers HTML illisible :', e); }
  }
  return analyzeText(plain);
}

/* ------------------------------------------------------------
   Utilitaires XML
------------------------------------------------------------ */
function wattr(el, name) {
  return el.getAttributeNS(W_NS, name) || el.getAttribute('w:' + name) || '';
}

function wchild(el, name) {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.localName === name && c.namespaceURI === W_NS) return c;
  }
  return null;
}

const NO_NOTES = { foot: new Map(), end: new Map() };

/**
 * Parcourt un élément et accumule son texte visible.
 * - mc:Fallback ignoré (doublon des zones de texte)
 * - texte supprimé / déplacé (suivi des modifications) ignoré
 * - appels de notes : on ajoute les mots de la note
 */
function collect(el, acc, notes) {
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    const ln = c.localName;
    if (ln === 'Fallback') continue;
    if (c.namespaceURI === W_NS) {
      if (ln === 't') { acc.text.push(c.textContent); continue; }
      if (ln === 'tab' || ln === 'br' || ln === 'cr') { acc.text.push(' '); continue; }
      if (ln === 'noBreakHyphen') { acc.text.push('-'); continue; }
      if (ln === 'del' || ln === 'moveFrom' || ln === 'delText' || ln === 'instrText' || ln === 'rPr' || ln === 'pPr') continue;
      if (ln === 'footnoteReference') { acc.notes += notes.foot.get(wattr(c, 'id')) || 0; continue; }
      if (ln === 'endnoteReference') { acc.notes += notes.end.get(wattr(c, 'id')) || 0; continue; }
      if (ln === 'p' || ln === 'tc') { collect(c, acc, notes); acc.text.push(' '); continue; }
    }
    collect(c, acc, notes);
  }
}

function parseNotes(xml, tag, parser) {
  const map = new Map();   // identifiant → nombre de mots
  const els = new Map();   // identifiant → élément (pour la mise en page)
  if (!xml) return { map, els };
  const d = parser.parseFromString(xml, 'application/xml');
  for (const n of d.getElementsByTagNameNS(W_NS, tag)) {
    const type = wattr(n, 'type');
    if (type && type !== 'normal') continue; // séparateurs
    const acc = { text: [], notes: 0 };
    collect(n, acc, NO_NOTES);
    map.set(wattr(n, 'id'), countWords(acc.text.join('')));
    els.set(wattr(n, 'id'), n);
  }
  return { map, els };
}

/* ------------------------------------------------------------
   Styles : quel style est un titre, et de quel niveau ?
   On relève aussi ce qui fait la mise en page : police, corps,
   interligne, espacements, retraits.
------------------------------------------------------------ */
const tw = v => (parseFloat(v) || 0) / 20;            // twips → points
const isOn = el => { const v = wattr(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };
const attrOn = v => v === '1' || v === 'true' || v === 'on';

/** Propriétés de paragraphe écrites dans un élément w:pPr (seulement celles qui y figurent). */
function readPPr(pPr, o) {
  for (let c = pPr.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS) continue;
    switch (c.localName) {
      case 'spacing': {
        const before = wattr(c, 'before');
        const after = wattr(c, 'after');
        const line = wattr(c, 'line');
        if (before !== '') o.sb = Math.max(0, tw(before));
        if (after !== '') o.sa = Math.max(0, tw(after));
        if (attrOn(wattr(c, 'beforeAutospacing'))) o.sb = 14;
        if (attrOn(wattr(c, 'afterAutospacing'))) o.sa = 14;
        if (line !== '' && parseFloat(line) > 0) {
          const r = wattr(c, 'lineRule');
          o.lr = r === 'exact' ? 1 : r === 'atLeast' ? 2 : 0;
          o.lv = o.lr ? tw(line) : parseFloat(line) / 240;
        }
        break;
      }
      case 'ind': {
        const left = wattr(c, 'left') || wattr(c, 'start');
        const right = wattr(c, 'right') || wattr(c, 'end');
        const first = wattr(c, 'firstLine');
        const hang = wattr(c, 'hanging');
        if (left !== '') o.il = tw(left);
        if (right !== '') o.ir = tw(right);
        if (hang !== '') o.fi = -tw(hang);
        else if (first !== '') o.fi = tw(first);
        break;
      }
      case 'keepNext': o.kn = isOn(c); break;
      case 'keepLines': o.kl = isOn(c); break;
      case 'pageBreakBefore': o.pb = isOn(c); break;
      case 'widowControl': o.wc = isOn(c); break;
      case 'contextualSpacing': o.cs = isOn(c); break;
      case 'numPr': { const id = wchild(c, 'numId'); o.num = !id || wattr(id, 'val') !== '0'; break; }
      case 'jc': o.jc = wattr(c, 'val'); break;
      default: break;
    }
  }
  return o;
}

/** Propriétés de caractère écrites dans un élément w:rPr. theme : polices du thème. */
function readRPr(rPr, o, theme) {
  for (let c = rPr.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS) continue;
    switch (c.localName) {
      case 'rFonts': {
        const f = wattr(c, 'ascii') || wattr(c, 'hAnsi');
        if (f) o.f = f;
        else {
          const t = wattr(c, 'asciiTheme') || wattr(c, 'hAnsiTheme');
          if (t && theme) o.f = /^major/i.test(t) ? theme.major : theme.minor;
        }
        break;
      }
      case 'sz': { const v = parseFloat(wattr(c, 'val')); if (v > 0) o.z = v / 2; break; }
      case 'b': o.b = isOn(c); break;
      case 'caps': o.caps = isOn(c); break;
      case 'vanish': o.van = isOn(c); break;
      default: break;
    }
  }
  return o;
}

function parseStyles(sdoc, theme) {
  const map = new Map();
  map.dp = {};            // paragraphe par défaut du document
  map.dr = { f: 'Times New Roman', z: 10 };   // caractères par défaut : ceux de Word quand le fichier ne dit rien
  map.defPara = '';
  map.defTable = '';
  if (!sdoc) return map;
  const dd = sdoc.getElementsByTagNameNS(W_NS, 'docDefaults')[0];
  if (dd) {
    const rd = dd.getElementsByTagNameNS(W_NS, 'rPrDefault')[0];
    const pd = dd.getElementsByTagNameNS(W_NS, 'pPrDefault')[0];
    const r = rd ? wchild(rd, 'rPr') : null;
    const pp = pd ? wchild(pd, 'pPr') : null;
    if (r) readRPr(r, map.dr, theme);
    if (pp) readPPr(pp, map.dp);
  }
  for (const st of sdoc.getElementsByTagNameNS(W_NS, 'style')) {
    const type = wattr(st, 'type') || 'paragraph';
    const id = wattr(st, 'styleId');
    const nameEl = wchild(st, 'name');
    const basedEl = wchild(st, 'basedOn');
    const pPr = wchild(st, 'pPr');
    const rPr = wchild(st, 'rPr');
    const olEl = pPr ? wchild(pPr, 'outlineLvl') : null;
    const o = {
      type,
      name: (nameEl ? wattr(nameEl, 'val') : '').toLowerCase(),
      basedOn: basedEl ? wattr(basedEl, 'val') : null,
      outline: olEl ? parseInt(wattr(olEl, 'val'), 10) : null,
      p: pPr ? readPPr(pPr, {}) : {},
      r: rPr ? readRPr(rPr, {}, theme) : {},
    };
    if (type === 'table') {
      const tp = wchild(st, 'tblPr');
      const mar = tp ? wchild(tp, 'tblCellMar') : null;
      if (mar) o.mar = readCellMar(mar, {});
    }
    if (attrOn(wattr(st, 'default'))) {
      if (type === 'paragraph') map.defPara = id;
      else if (type === 'table') map.defTable = id;
    }
    // Un style de caractère ou de tableau peut porter le même identifiant qu'un style de paragraphe : on les sépare
    map.set(type === 'paragraph' ? id : `${type}:${id}`, o);
  }
  return map;
}

function readCellMar(mar, o) {
  for (let c = mar.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS) continue;
    const w = tw(wattr(c, 'w'));
    if (c.localName === 'top') o.pt = w;
    else if (c.localName === 'bottom') o.pb = w;
    else if (c.localName === 'left' || c.localName === 'start') o.pl = w;
    else if (c.localName === 'right' || c.localName === 'end') o.pr = w;
  }
  return o;
}

const HEADING_NAME = /^(heading|titre|überschrift|uberschrift|título|titolo|kop)\s*(\d)$/i;
const TOC_NAME = /^(toc|tm|table des matières|index|table of figures|table des illustrations)\b/i;

/** Niveau de titre d'un style : 1, 2, 3… ; 0 = texte ; -1 = table des matières. */
function styleLevel(styles, id, depth = 0) {
  if (!id || depth > 12) return 0;
  const st = styles.get(id);
  if (!st) {
    const m = HEADING_NAME.exec(id.replace(/([a-z])(\d)$/i, '$1 $2'));
    return m ? +m[2] : 0;
  }
  if (TOC_NAME.test(st.name)) return -1;
  const m = HEADING_NAME.exec(st.name);
  if (m) return +m[2];
  if (st.name === 'title' || st.name === 'subtitle') return 0;
  if (Number.isInteger(st.outline)) return st.outline >= 0 && st.outline < 9 ? st.outline + 1 : 0;
  return styleLevel(styles, st.basedOn, depth + 1);
}

/* ------------------------------------------------------------
   Mise en page : ce que pages.js doit savoir de chaque paragraphe
------------------------------------------------------------ */
const EMU = 12700; // unités de dessin par point

/** Propriétés héritées d'un style : défauts du document, puis la chaîne « basé sur », du plus général au plus précis. */
function styleProps(L, key, tableKey) {
  const ck = `${tableKey || ''}|${key || ''}`;
  let hit = L.cache.get(ck);
  if (hit) return hit;
  const p = { ...L.styles.dp };
  const r = { ...L.styles.dr };
  const apply = k => {
    const chain = [];
    for (let st = L.styles.get(k), d = 0; st && d < 12; st = L.styles.get(st.basedOn ? (k.includes(':') ? `${k.split(':')[0]}:${st.basedOn}` : st.basedOn) : ''), d++) chain.unshift(st);
    for (const st of chain) { Object.assign(p, st.p); Object.assign(r, st.r); }
  };
  if (tableKey) apply(tableKey);
  if (key) apply(key);
  hit = { p, r };
  L.cache.set(ck, hit);
  return hit;
}

const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function readSection(sectPr, margins) {
  const o = {};
  for (let c = sectPr.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS || (c.localName !== 'headerReference' && c.localName !== 'footerReference')) continue;
    if (wattr(c, 'type') !== 'default') continue;
    const blocks = margins(c.getAttributeNS(R_NS, 'id') || c.getAttribute('r:id') || '');
    if (blocks) o[c.localName === 'headerReference' ? 'hdr' : 'ftr'] = blocks;
  }
  const sz = wchild(sectPr, 'pgSz');
  const mar = wchild(sectPr, 'pgMar');
  const cols = wchild(sectPr, 'cols');
  const type = wchild(sectPr, 'type');
  if (sz) {
    const w = tw(wattr(sz, 'w'));
    const h = tw(wattr(sz, 'h'));
    if (w > 100 && h > 100) { o.w = w; o.h = h; }
  }
  if (mar) {
    o.mt = Math.abs(tw(wattr(mar, 'top')));
    o.mb = Math.abs(tw(wattr(mar, 'bottom')));
    o.ml = tw(wattr(mar, 'left')) + tw(wattr(mar, 'gutter'));
    o.mr = tw(wattr(mar, 'right'));
    if (wattr(mar, 'header') !== '') o.hd = tw(wattr(mar, 'header'));
    if (wattr(mar, 'footer') !== '') o.fd = tw(wattr(mar, 'footer'));
  }
  if (cols) {
    const n = parseInt(wattr(cols, 'num'), 10);
    if (n > 1) { o.cols = n; const sp = wattr(cols, 'space'); o.gap = sp !== '' ? tw(sp) : 36; }
  }
  o.type = type ? wattr(type, 'val') : '';
  return o;
}

/** Taille d'un dessin (image, graphique, schéma) et place qu'il prend dans le texte. */
function drawingItem(dr) {
  for (let c = dr.firstElementChild; c; c = c.nextElementSibling) {
    const inline = c.localName === 'inline';
    if (!inline && c.localName !== 'anchor') continue;
    let w = 0;
    let h = 0;
    let wrap = inline ? 'inline' : '';
    for (let x = c.firstElementChild; x; x = x.nextElementSibling) {
      if (x.localName === 'extent') { w = (parseFloat(x.getAttribute('cx')) || 0) / EMU; h = (parseFloat(x.getAttribute('cy')) || 0) / EMU; }
      else if (/^wrap/.test(x.localName)) wrap = x.localName;
    }
    if (!(w > 0 && h > 0)) return null;
    const dt = (parseFloat(c.getAttribute('distT')) || 0) / EMU;
    const db = (parseFloat(c.getAttribute('distB')) || 0) / EMU;
    if (!inline) {
      if (wrap === 'wrapNone' || wrap === '') return null;                 // devant ou derrière le texte : ne prend pas de place
      return { k: 'float', w, h: h + dt + db, side: wrap !== 'wrapTopAndBottom' };
    }
    return { k: 'img', w, h };
  }
  return null;
}

/** Ancien format des images et objets (VML) : la taille est dans le style. */
function vmlItem(el) {
  for (const sh of el.getElementsByTagName('*')) {
    if (sh.localName !== 'shape' && sh.localName !== 'rect') continue;
    const st = sh.getAttribute('style') || '';
    const num = k => { const m = new RegExp(`(?:^|;)\\s*${k}\\s*:\\s*([\\d.]+)(pt|in|cm|mm|px)?`).exec(st); if (!m) return 0; const v = parseFloat(m[1]); return m[2] === 'in' ? v * 72 : m[2] === 'cm' ? v * 28.35 : m[2] === 'mm' ? v * 2.835 : m[2] === 'px' ? v * 0.75 : v; };
    const w = num('width');
    const h = num('height');
    if (w > 0 && h > 0 && !/position\s*:\s*absolute/.test(st)) return { k: 'img', w, h };
    return null;
  }
  return null;
}

/**
 * Paragraphe → bloc de mise en page. L = contexte (styles, notes, section en cours…),
 * tableKey = style du tableau qui le contient, le cas échéant.
 */
function layoutParagraph(p, L, tableKey) {
  const pPr = wchild(p, 'pPr');
  let styleId = L.styles.defPara;
  let direct = null;
  let markR = null;
  if (pPr) {
    const ps = wchild(pPr, 'pStyle');
    if (ps && L.styles.has(wattr(ps, 'val'))) styleId = wattr(ps, 'val');
    direct = readPPr(pPr, {});
    markR = wchild(pPr, 'rPr');
  }
  const base = styleProps(L, styleId, tableKey);
  const pp = direct ? { ...base.p, ...direct } : base.p;
  const mark = markR ? readRPr(markR, { ...base.r }, L.theme) : base.r;
  const b = {
    t: 'p', s: L.sec, r: [], sb: pp.sb || 0, sa: pp.sa || 0, lr: pp.lr || 0, lv: pp.lv || 1,
    il: pp.il || 0, ir: pp.ir || 0, fi: pp.fi || 0, st: styleId, mf: mark.f || '', mz: mark.z || 10,
  };
  if (pp.num) { b.num = 1; if (direct && direct.il === undefined && base.p.il === undefined) b.il = 36; }
  if (pp.jc === 'center') b.jc = 'center';
  if (pp.kn) b.kn = 1;
  if (pp.kl) b.kl = 1;
  if (pp.pb) b.pb = 1;
  if (pp.cs) b.cs = 1;
  if (pp.wc === false) b.wc = false;
  // Ligne d'une table des matières (ou des figures) : Word n'y laisse pas de repère de page
  for (const el of p.getElementsByTagNameNS(W_NS, 'instrText')) {
    if (/\b(PAGEREF|TOC)\b/.test(el.textContent)) { b.nm = 1; break; }
  }
  const items = b.r;
  let last = null;

  const text = (s, rp) => {
    if (!s) return;
    if (rp.caps) s = s.toUpperCase();
    const f = rp.f || '';
    const z = rp.z || 10;
    const bold = rp.b ? 1 : 0;
    if (last && last.f === f && last.z === z && last.b === bold) last.x += s;
    else { last = { x: s, f, z, b: bold }; items.push(last); }
    L.chars.set(`${f}|${z}`, (L.chars.get(`${f}|${z}`) || 0) + s.length);
  };
  const event = e => { items.push(e); last = null; };

  const run = r => {
    const rPr = wchild(r, 'rPr');
    let rp = base.r;
    if (rPr) {
      rp = { ...base.r };
      const rs = wchild(rPr, 'rStyle');
      if (rs) { const cs = L.styles.get(`character:${wattr(rs, 'val')}`); if (cs) Object.assign(rp, cs.r); }
      readRPr(rPr, rp, L.theme);
    }
    if (rp.van) return;
    for (let c = r.firstElementChild; c; c = c.nextElementSibling) {
      const ln = c.localName;
      if (c.namespaceURI === W_NS) {
        switch (ln) {
          case 't': text(c.textContent, rp); break;
          case 'tab': event({ k: 'tab' }); break;
          case 'br': { const ty = wattr(c, 'type'); event({ k: ty === 'page' ? 'pb' : ty === 'column' ? 'cb' : 'br' }); break; }
          case 'cr': event({ k: 'br' }); break;
          case 'noBreakHyphen': text('‑', rp); break;
          case 'sym': text('•', rp); break;
          case 'lastRenderedPageBreak': if (!L.inNote) { event({ k: 'mk' }); L.marks++; } break;
          case 'footnoteReference':
          case 'endnoteReference': {
            if (L.inNote) break;
            const el = (ln === 'footnoteReference' ? L.noteEls.foot : L.noteEls.end).get(wattr(c, 'id'));
            if (!el) break;
            (b.notes || (b.notes = [])).push(noteBlocks(el, L));
            event({ k: 'fn', n: b.notes.length - 1 });
            break;
          }
          case 'drawing': { const it = drawingItem(c); if (it) { it.z = rp.z || 10; it.f = rp.f || ''; event(it); } break; }
          case 'pict':
          case 'object': { const it = vmlItem(c); if (it) { it.z = rp.z || 10; it.f = rp.f || ''; event(it); } break; }
          default: break;
        }
      } else if (ln === 'AlternateContent') {
        const choice = [...c.children].find(x => x.localName === 'Choice');
        if (choice) for (const d of choice.getElementsByTagNameNS(W_NS, 'drawing')) { const it = drawingItem(d); if (it) { it.z = rp.z || 10; it.f = rp.f || ''; event(it); } break; }
      }
    }
  };
  const walk = el => {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
      const ln = c.localName;
      if (c.namespaceURI === W_NS) {
        if (ln === 'r') run(c);
        else if (ln === 'del' || ln === 'moveFrom' || ln === 'pPr') continue;
        else if (ln === 'hyperlink' || ln === 'ins' || ln === 'moveTo' || ln === 'smartTag' || ln === 'fldSimple' || ln === 'customXml' || ln === 'dir' || ln === 'bdo') walk(c);
        else if (ln === 'sdt') { const sc = wchild(c, 'sdtContent'); if (sc) walk(sc); }
      } else if (ln === 'oMath' || ln === 'oMathPara') {
        text(c.textContent, base.r);       // formule : à peu près la place de son texte
      }
    }
  };
  walk(p);

  // Image flottante : elle prend de la hauteur (ou une part de la largeur si le texte l'habille)
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.k !== 'float') continue;
    const width = L.colW;
    const hh = it.side && it.w < width * 0.75 ? it.h * (it.w / width) : it.h;
    b.sa += hh;
    items.splice(i--, 1);
  }
  return b;
}

function noteBlocks(el, L) {
  const out = [];
  const was = L.inNote;
  L.inNote = true;
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS) continue;
    if (c.localName === 'p') out.push(layoutParagraph(c, L, ''));
    else if (c.localName === 'tbl') out.push(layoutTable(c, L));
  }
  L.inNote = was;
  return out;
}

function layoutTable(tbl, L) {
  const tblPr = wchild(tbl, 'tblPr');
  let styleKey = L.styles.defTable ? `table:${L.styles.defTable}` : '';
  const mar = { pt: 0, pb: 0, pl: 5.4, pr: 5.4 };
  let width = 0;
  let fixed = false;
  if (tblPr) {
    const ts = wchild(tblPr, 'tblStyle');
    if (ts && L.styles.has(`table:${wattr(ts, 'val')}`)) styleKey = `table:${wattr(ts, 'val')}`;
    const tW = wchild(tblPr, 'tblW');
    if (tW && wattr(tW, 'type') === 'dxa') width = tw(wattr(tW, 'w'));
    else if (tW && wattr(tW, 'type') === 'pct') width = L.colW * Math.min(1, (parseFloat(wattr(tW, 'w')) || 5000) / 5000);
    const lay = wchild(tblPr, 'tblLayout');
    if (lay && wattr(lay, 'type') === 'fixed') fixed = true;
  }
  for (let st = L.styles.get(styleKey), chain = [], d = 0; ; d++) {
    if (st && d < 12) { chain.unshift(st); st = L.styles.get(st.basedOn ? `table:${st.basedOn}` : ''); continue; }
    for (const x of chain) if (x.mar) Object.assign(mar, x.mar);
    break;
  }
  if (tblPr) { const m = wchild(tblPr, 'tblCellMar'); if (m) readCellMar(m, mar); }
  const grid = [];
  const tg = wchild(tbl, 'tblGrid');
  if (tg) for (let c = tg.firstElementChild; c; c = c.nextElementSibling) if (c.localName === 'gridCol' && c.namespaceURI === W_NS) grid.push(tw(wattr(c, 'w')));
  if (!width && grid.length) width = grid.reduce((a, x) => a + x, 0);
  const rows = [];
  const rowOf = tr => {
    const row = { cells: [] };
    let col = 0;
    for (let c = tr.firstElementChild; c; c = c.nextElementSibling) {
      if (c.namespaceURI !== W_NS) continue;
      if (c.localName === 'trPr') {
        const hEl = wchild(c, 'trHeight');
        if (hEl) { row.min = tw(wattr(hEl, 'val')); if (wattr(hEl, 'hRule') === 'exact') row.exact = 1; }
        const cs = wchild(c, 'cantSplit');
        if (cs && isOn(cs)) row.cant = 1;
        const gb = wchild(c, 'gridBefore');
        if (gb) col += parseInt(wattr(gb, 'val'), 10) || 0;
      } else if (c.localName === 'tc') {
        const cell = { w: 0, ...mar, blocks: [] };
        let span = 1;
        let cont = false;
        const tcPr = wchild(c, 'tcPr');
        if (tcPr) {
          const tcW = wchild(tcPr, 'tcW');
          if (tcW && wattr(tcW, 'type') === 'dxa') cell.w = tw(wattr(tcW, 'w'));
          const gs = wchild(tcPr, 'gridSpan');
          if (gs) span = Math.max(1, parseInt(wattr(gs, 'val'), 10) || 1);
          const vm = wchild(tcPr, 'vMerge');
          if (vm && wattr(vm, 'val') !== 'restart') cont = true;
          const m = wchild(tcPr, 'tcMar');
          if (m) readCellMar(m, cell);
        }
        if (!cell.w && grid.length) { for (let k = col; k < col + span && k < grid.length; k++) cell.w += grid[k]; }
        col += span;
        if (!cont) {
          for (let x = c.firstElementChild; x; x = x.nextElementSibling) {
            if (x.namespaceURI !== W_NS) continue;
            if (x.localName === 'p') cell.blocks.push(layoutParagraph(x, L, styleKey));
            else if (x.localName === 'tbl') cell.blocks.push(layoutTable(x, L));
            else if (x.localName === 'sdt') { const sc = wchild(x, 'sdtContent'); if (sc) for (const y of sc.children) { if (y.localName === 'p' && y.namespaceURI === W_NS) cell.blocks.push(layoutParagraph(y, L, styleKey)); } }
          }
        }
        row.cells.push(cell);
      } else if (c.localName === 'sdt') {
        const sc = wchild(c, 'sdtContent');
        if (sc) for (const y of sc.children) if (y.localName === 'tc' && y.namespaceURI === W_NS) { /* cellule répétée : rare, ignorée */ }
      }
    }
    return row;
  };
  for (let c = tbl.firstElementChild; c; c = c.nextElementSibling) {
    if (c.namespaceURI !== W_NS) continue;
    if (c.localName === 'tr') rows.push(rowOf(c));
    else if (c.localName === 'sdt') { const sc = wchild(c, 'sdtContent'); if (sc) for (const y of sc.children) if (y.localName === 'tr' && y.namespaceURI === W_NS) rows.push(rowOf(y)); }
  }
  return fixed ? { t: 'tbl', s: L.sec, w: width, fixed: 1, rows } : { t: 'tbl', s: L.sec, w: width, rows };
}

const A4_SECTION = { w: 595.3, h: 841.9, mt: 70.9, mb: 70.9, ml: 70.9, mr: 70.9 };

/* ------------------------------------------------------------
   Analyse principale
------------------------------------------------------------ */
export function analyzeDocx({ docXml, stylesXml, appXml, footXml, endXml, themeXml, parts, pdf, tune, planTitles }) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('bad-xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new DocxError('bad-xml');

  let theme = null;
  if (themeXml) {
    const maj = /<a:majorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]*)"/.exec(themeXml);
    const min = /<a:minorFont>[\s\S]*?<a:latin[^>]*typeface="([^"]*)"/.exec(themeXml);
    theme = { major: maj ? maj[1] : '', minor: min ? min[1] : '' };
  }
  const styles = parseStyles(stylesXml ? parser.parseFromString(stylesXml, 'application/xml') : null, theme);
  const foot = parseNotes(footXml, 'footnote', parser);
  const end = parseNotes(endXml, 'endnote', parser);
  const notes = { foot: foot.map, end: end.map };

  const app = appXml || '';
  const gen = /<Application>\s*Microsoft/i.test(app) ? 'word' : /<Application>\s*(LibreOffice|OpenOffice|NeoOffice|Collabora)/i.test(app) ? 'libreoffice'
    : !appXml && /w:rsidRDefault="00000000"/.test(docXml.slice(0, 40000)) ? 'gdocs' : 'other';
  const L = {
    styles, theme, cache: new Map(), noteEls: { foot: foot.els, end: end.els }, inNote: false,
    sec: 0, colW: 450, marks: 0, chars: new Map(), spacing: new Map(),
  };

  // En-tête ou pied de page (identifiant de relation → blocs de mise en page)
  const marginCache = new Map();
  const margins = id => {
    if (!parts || !parts[id]) return null;
    if (marginCache.has(id)) return marginCache.get(id);
    let out = null;
    try {
      const d = parser.parseFromString(parts[id], 'application/xml');
      const root = d.documentElement;
      if (root && !d.getElementsByTagName('parsererror').length) {
        const chars = L.chars;
        L.chars = new Map();           // le texte des en-têtes ne dit rien de la police du corps
        L.inNote = true;
        out = [];
        for (let c = root.firstElementChild; c; c = c.nextElementSibling) {
          if (c.namespaceURI !== W_NS) continue;
          if (c.localName === 'p') out.push(layoutParagraph(c, L, ''));
          else if (c.localName === 'tbl') out.push(layoutTable(c, L));
        }
        L.inNote = false;
        L.chars = chars;
      }
    } catch (e) { console.warn('En-tête illisible :', e); }
    marginCache.set(id, out);
    return out;
  };

  // Sections : celles fermées par un paragraphe, puis celle du corps du document
  const sections = [];
  for (const sp of body.getElementsByTagNameNS(W_NS, 'sectPr')) {
    const host = sp.parentNode;
    if (host === body || (host.localName === 'pPr' && host.parentNode && host.parentNode.parentNode === body)) sections.push(readSection(sp, margins));
  }
  if (!sections.length) sections.push({});
  for (let i = 0; i < sections.length; i++) {
    // Une section sans format, marges ou en-tête reprend ceux de la précédente (ou le A4 courant)
    const prev = i > 0 ? sections[i - 1] : A4_SECTION;
    for (const k of ['w', 'h', 'mt', 'mb', 'ml', 'mr', 'hd', 'fd', 'hdr', 'ftr']) if (sections[i][k] === undefined && prev[k] !== undefined) sections[i][k] = prev[k];
  }
  const colWidth = i => { const s = sections[Math.min(i, sections.length - 1)]; const n = s.cols || 1; return (s.w - s.ml - s.mr - (n - 1) * (s.gap || 36)) / n; };
  L.colW = colWidth(0);
  const blocks = [];

  const segments = []; // { level, title, words, bodyWords }
  let front = 0;
  const add = n => {
    if (!n) return;
    if (segments.length) {
      const s = segments[segments.length - 1];
      s.words += n;
      s.bodyWords += n;
    } else front += n;
  };
  // Le document dans l'ordre : paragraphes (niveau de titre donné par leur style) et tableaux.
  // Les titres sont fixés après coup : sans styles de titre, on les repère à leur mise en forme.
  const recs = [];

  const handleParagraph = p => {
    const pPr = wchild(p, 'pPr');
    let level = 0;
    let sect = null;
    if (pPr) {
      const ps = wchild(pPr, 'pStyle');
      if (ps) level = styleLevel(styles, wattr(ps, 'val'));
      const ol = wchild(pPr, 'outlineLvl');
      if (ol && level !== -1) {
        const v = parseInt(wattr(ol, 'val'), 10);
        level = v >= 0 && v < 9 ? v + 1 : 0;
      }
      sect = wchild(pPr, 'sectPr');
    }
    const block = layoutParagraph(p, L, '');
    blocks.push(block);
    if (sect) { L.sec = Math.min(L.sec + 1, sections.length - 1); L.colW = colWidth(L.sec); }
    if (level === -1) return; // entrées de table des matières : elles occupent des pages, mais ne sont pas du texte rédigé
    const acc = { text: [], notes: 0 };
    collect(p, acc, notes);
    const text = acc.text.join('').replace(/\s+/g, ' ').trim();
    recs.push({ level: level > 0 && text ? level : 0, text, words: countWords(text), notes: acc.notes, block });
  };

  const handleBlock = el => {
    if (el.namespaceURI !== W_NS) {
      if (el.localName === 'AlternateContent') {
        const choice = [...el.children].find(c => c.localName === 'Choice');
        if (choice) for (const c of choice.children) handleBlock(c);
      }
      return;
    }
    switch (el.localName) {
      case 'p': handleParagraph(el); break;
      case 'tbl': {
        const acc = { text: [], notes: 0 };
        collect(el, acc, notes);
        recs.push({ table: true, words: countWords(acc.text.join('')) + acc.notes });
        blocks.push(layoutTable(el, L));
        break;
      }
      case 'sdt': {
        const content = wchild(el, 'sdtContent');
        if (content) for (const c of content.children) handleBlock(c);
        break;
      }
      case 'customXml':
      case 'smartTag':
        for (const c of el.children) handleBlock(c);
        break;
      default: break; // sectPr, signets…
    }
  };

  for (const c of body.children) handleBlock(c);

  // Pas de styles de titre (ou un seul, le titre du document) : les titres se reconnaissent à leur mise en forme
  let headingSource = 'styles';
  const styled = recs.filter(r => r.level > 0).length;
  if (styled < 2) {
    const lv = guessHeadings(recs.map(r => (r.table ? { text: 'tableau', words: r.words, table: true } : paraLook(r, styles))), { planTitles: (planTitles || []).map(t => t.title) });
    const n = lv.filter(Boolean).length;
    if (n >= 2 && n > styled) {
      recs.forEach((r, i) => { r.level = lv[i]; });
      headingSource = 'layout';
    }
  }
  for (const r of recs) {
    if (r.table) { add(r.words); continue; }
    if (r.level > 0 && r.text) {
      const before = segments.length;
      pushHeading(segments, r.level, r.text, r.words + r.notes);
      if (segments.length > before) r.block.hd = before;
    } else {
      add(r.words + r.notes);
      if (r.words > 12) { const k = `${r.block.lr}|${r.block.lv}`; L.spacing.set(k, (L.spacing.get(k) || 0) + r.words); }
    }
  }

  const pagesMatch = appXml ? /<Pages>(\d+)<\/Pages>/.exec(appXml) : null;
  const pagesMeta = pagesMatch ? parseInt(pagesMatch[1], 10) : null;

  // Pagination : réelle si le fichier (ou son PDF) la donne, simulée sinon
  let paged = null;
  try {
    const layout = { sections, blocks, gen, pagesMeta };
    const pdfInfo = pdf ? readPdf(pdf) : null;
    const pg = paginate(layout, segments.length, pdfInfo ? { pdf: pdfInfo, titles: segments.map(s => s.title), tune } : { tune });
    const sp = spans(pg.starts, pg.total);
    const top = m => { let best = ''; let n = -1; for (const [k, v] of m) if (v > n) { n = v; best = k; } return best; };
    const [font, size] = top(L.chars).split('|');
    const [lr, lv] = top(L.spacing).split('|');
    const s0 = sections[0];
    paged = {
      total: pg.total, front: sp.front, pages: sp.pages, source: pg.source,
      layout: {
        font: font || '', size: parseFloat(size) || 0,
        spacing: lr === '0' ? Math.round(parseFloat(lv) * 100) / 100 : 0,
        paper: Math.abs(s0.w - 595.3) < 3 && Math.abs(s0.h - 841.9) < 3 ? 'A4' : Math.abs(s0.w - 612) < 3 && Math.abs(s0.h - 792) < 3 ? 'Letter' : '',
      },
      gen,
    };
  } catch (e) { console.warn('Pagination :', e); }

  const res = finish('docx', segments, front, pagesMeta, DEFAULT_WPP, paged);
  res.headingSource = segments.length ? headingSource : '';
  return res;
}

/** L'allure d'un paragraphe, pour reconnaître un titre sans style : corps, gras, capitales, centrage, liste, légende. */
function paraLook(r, styles) {
  const b = r.block;
  let chars = 0;
  let bold = 0;
  const sizes = new Map();
  for (const it of b.r) {
    if (typeof it.x !== 'string') continue;
    const n = it.x.replace(/\s/g, '').length;
    if (!n) continue;
    chars += n;
    if (it.b) bold += n;
    sizes.set(it.z, (sizes.get(it.z) || 0) + n);
  }
  let size = 0;
  let best = -1;
  for (const [z, n] of sizes) if (n > best) { best = n; size = z; }
  const st = styles.get(b.st);
  return {
    text: r.text, words: r.words, size, bold: chars > 0 && bold >= chars * 0.9, center: b.jc === 'center', list: !!b.num,
    caption: !!st && /caption|l[ée]gende|beschriftung/i.test(st.name || ''),
  };
}

/* ------------------------------------------------------------
   Communs à tous les formats
------------------------------------------------------------ */
function pushHeading(segments, level, text, words) {
  const prev = segments[segments.length - 1];
  // « CHAPITRE 1 » sur une ligne + titre sur la suivante : on fusionne
  if (prev && prev.level === level && prev.bodyWords === 0 &&
      /^(chapitre|chap\.?|partie|article|section)\s+[\divxlc]+\.?$/i.test(prev.title)) {
    prev.title = `${prev.title} : ${text}`.slice(0, 200);
    prev.words += words;
    prev.chars += text.length + 1;
    return;
  }
  segments.push({ level, title: text.slice(0, 200), words, bodyWords: 0, chars: text.length + 1 });
}

/**
 * Résultat commun : titres bruts, mots et pages.
 * paged : pagination calculée par pages.js ({ total, front, pages: [par titre], source, layout }) ;
 * sans elle, les pages se déduisent de la longueur du texte : densité du fichier s'il donne son nombre de pages,
 * sinon nombre de signes d'une page courante (frontChars et segments[].chars), sinon mots par page.
 * pageSource : 'pdf' | 'word' (pagination réelle), 'meta' (total du fichier), 'layout' (mise en page simulée), 'density'.
 */
function finish(kind, segments, frontWords, pagesMeta, defaultWpp = DEFAULT_WPP, paged = null, frontChars = 0) {
  const totalWords = frontWords + segments.reduce((a, x) => a + x.words, 0);
  let wpp = defaultWpp;
  let wppSource = 'default';
  if (pagesMeta && pagesMeta >= 2 && totalWords > 0) {
    const r = totalWords / pagesMeta;
    if (r >= 80 && r <= 1200) { wpp = Math.round(r); wppSource = 'word'; }
  }
  const legacyWpp = wpp;
  let totalPages;
  let frontPages;
  let pageSource;
  let pages;
  if (paged && paged.total > 0 && paged.pages.length === segments.length) {
    totalPages = paged.total;
    frontPages = paged.front;
    pages = paged.pages;
    pageSource = paged.source;
    if (totalWords > 0) wpp = Math.max(1, Math.round(totalWords / totalPages));
  } else {
    const totalChars = frontChars + segments.reduce((a, x) => a + (x.chars || 0), 0);
    if (wppSource !== 'word' && totalChars > 0 && totalWords > 0) {
      const per = kind === 'latex' ? SIGNS_PER_PAGE_LATEX : SIGNS_PER_PAGE;
      pages = segments.map(x => (x.chars || 0) / per);
      frontPages = frontChars / per;
      totalPages = totalChars / per;
      wpp = Math.max(1, Math.round(totalWords / totalPages));
    } else {
      pages = segments.map(x => x.words / wpp);
      frontPages = frontWords / wpp;
      totalPages = totalWords / wpp;
    }
    pageSource = wppSource === 'word' ? 'meta' : 'density';
  }
  return {
    kind, totalWords, frontWords, pagesMeta: pagesMeta || null, wpp, wppSource, legacyWpp,
    totalPages, frontPages, pageSource, layout: paged ? paged.layout : null, gen: paged ? paged.gen : '',
    segments: segments.map((x, i) => ({ level: x.level, title: x.title, words: x.words, pages: pages[i] })),
    headingCount: segments.length,
  };
}

/* ------------------------------------------------------------
   LibreOffice / OpenOffice (.odt)
------------------------------------------------------------ */
const ODF_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODF_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';
const ODF_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODF_STYLE = 'urn:oasis:names:tc:opendocument:xmlns:style:1.0';
const ODF_FO = 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0';
const ODF_DRAW = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0';
const ODF_SVG = 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0';
// Tables générées et coulisses du document : jamais comptées
const ODF_SKIP = new Set(['table-of-content', 'illustration-index', 'table-index', 'object-index', 'user-index',
  'alphabetical-index', 'bibliography', 'tracked-changes', 'sequence-decls', 'variable-decls', 'user-field-decls', 'forms']);
// Parmi elles, celles qui occupent des pages (sommaire, index) : leur texte ne compte pas, leur place si
const ODF_INDEX = new Set(['table-of-content', 'illustration-index', 'table-index', 'object-index', 'user-index', 'alphabetical-index', 'bibliography']);

/** Longueur ODF (« 2.5cm », « 12pt », « 0.5in ») en points ; NaN si ce n'en est pas une. */
function odfLen(v) {
  const m = /^(-?[\d.]+)\s*(pt|cm|mm|in|pc|px)?$/.exec(String(v || '').trim());
  if (!m) return NaN;
  const n = parseFloat(m[1]);
  return n * ({ pt: 1, cm: 28.3465, mm: 2.83465, in: 72, pc: 12, px: 0.75 }[m[2] || 'pt']);
}

/**
 * Styles d'un document ODF (styles nommés de styles.xml, styles automatiques de content.xml).
 * Renvoie look(nom) : les propriétés utiles, héritées de style parent en style parent :
 *   level  niveau de titre (nom « Heading 2 », « Titre 2 », ou niveau de plan du style), 0 sinon
 *   before, after  saut de page demandé avant / après le paragraphe
 *   size (points), bold, center, caption
 */
function odfStyles(docs) {
  const raw = new Map();
  let defSize = 12;
  for (const d of docs) {
    if (!d) continue;
    for (const ds of d.getElementsByTagNameNS(ODF_STYLE, 'default-style')) {
      if (ds.getAttributeNS(ODF_STYLE, 'family') !== 'paragraph') continue;
      const tp = ds.getElementsByTagNameNS(ODF_STYLE, 'text-properties')[0];
      const z = tp ? odfLen(tp.getAttributeNS(ODF_FO, 'font-size')) : NaN;
      if (z > 0) defSize = z;
    }
    for (const st of d.getElementsByTagNameNS(ODF_STYLE, 'style')) {
      const fam = st.getAttributeNS(ODF_STYLE, 'family') || 'paragraph';
      if (fam !== 'paragraph' && fam !== 'text' && fam !== 'table') continue;
      const name = st.getAttributeNS(ODF_STYLE, 'name');
      if (!name) continue;
      const o = {
        parent: st.getAttributeNS(ODF_STYLE, 'parent-style-name') || null,
        label: (st.getAttributeNS(ODF_STYLE, 'display-name') || name).replace(/_20_/g, ' ').toLowerCase(),
      };
      const lvl = parseInt(st.getAttributeNS(ODF_STYLE, 'default-outline-level') || '', 10);
      if (lvl >= 1 && lvl <= 9) o.outline = lvl;
      if (st.getAttributeNS(ODF_STYLE, 'master-page-name')) o.before = true;   // changement de style de page : nouvelle page
      for (let c = st.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI !== ODF_STYLE) continue;
        if (c.localName === 'paragraph-properties' || c.localName === 'table-properties') {
          const bb = c.getAttributeNS(ODF_FO, 'break-before');
          const ba = c.getAttributeNS(ODF_FO, 'break-after');
          if (bb) o.before = o.before || bb === 'page';
          if (ba) o.after = ba === 'page';
          const al = c.getAttributeNS(ODF_FO, 'text-align');
          if (al) o.center = al === 'center';
        } else if (c.localName === 'text-properties') {
          const fs = c.getAttributeNS(ODF_FO, 'font-size');
          if (fs) { if (/%$/.test(fs)) o.pct = parseFloat(fs) / 100; else if (odfLen(fs) > 0) o.size = odfLen(fs); }
          const fw = c.getAttributeNS(ODF_FO, 'font-weight');
          if (fw) o.bold = fw === 'bold' || parseInt(fw, 10) >= 600;
        }
      }
      // Les styles automatiques (content.xml) priment sur un style nommé de même nom ; à nom égal par famille, le paragraphe d'abord
      const key = fam === 'text' ? `t:${name}` : name;
      raw.set(key, o);
    }
  }
  const cache = new Map();
  const look = (name, text, depth = 0) => {
    const key = text ? `t:${name}` : name;
    if (cache.has(key)) return cache.get(key);
    // Un style de caractères ne dit que ce qu'il change (taille, gras) : le reste vient du paragraphe
    const base = text ? { size: 0, pct: 0, bold: undefined }
      : { level: 0, before: false, after: false, size: defSize, bold: false, center: false, caption: false };
    if (!name || depth > 12) return base;
    const st = raw.get(key);
    const label = st ? st.label : String(name).replace(/_20_/g, ' ').toLowerCase();
    let out;
    if (!st) {
      const m = text ? null : HEADING_NAME.exec(label);
      out = m ? { ...base, level: +m[2] } : base;
    } else {
      const up = st.parent ? look(st.parent, text, depth + 1) : base;
      out = { ...up };
      // le saut de page d'un style parent vaut pour ses dérivés, sauf mention contraire
      if (st.before !== undefined) out.before = st.before;
      if (st.after !== undefined) out.after = st.after;
      if (st.size) { out.size = st.size; if (text) out.pct = 0; }
      else if (st.pct) { if (text) out.pct = (up.pct || 1) * st.pct; else out.size = up.size * st.pct; }
      if (st.bold !== undefined) out.bold = st.bold;
      if (!text) {
        if (st.center !== undefined) out.center = st.center;
        if (/^(contents|index|table of|table des|sommaire)/.test(label)) out.level = 0;
        else {
          const m = HEADING_NAME.exec(label);
          if (m) out.level = +m[2];
          else if (st.outline) out.level = st.outline;
        }
        if (/^(caption|légende|legende|illustration|figure|table\b|tableau)/.test(label)) out.caption = true;
      }
    }
    cache.set(key, out);
    return out;
  };
  return look;
}

/**
 * LibreOffice (.odt, .fodt). Le texte et les titres comme pour Word ; les pages d'après les sauts
 * de page que LibreOffice enregistre dans le fichier, quand sa mise en page était terminée.
 */
export function analyzeOdt({ contentXml, stylesXml, metaXml, planTitles, doc: given }) {
  const parser = new DOMParser();
  const doc = given || parser.parseFromString(contentXml || '', 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('bad-xml');
  const body = doc.getElementsByTagNameNS(ODF_OFFICE, 'text')[0];
  if (!body) throw new DocxError('not-docx');
  let sdoc = null;
  if (stylesXml) {
    sdoc = parser.parseFromString(stylesXml, 'application/xml');
    if (sdoc.getElementsByTagName('parsererror').length) sdoc = null;
  }
  const look = odfStyles([sdoc, doc]);

  // Le document dans l'ordre : paragraphes et tableaux (recs), et de quoi retrouver la pagination (atoms)
  const recs = [];
  const atoms = [];
  let placed = false;      // du contenu est-il déjà posé ? (un saut demandé avant le tout premier paragraphe ne crée pas de page)
  let afterBreak = false;  // le paragraphe précédent demandait un saut après lui
  const hardBreak = () => { if (placed) atoms.push({ brk: 'hard' }); };
  const weigh = (w, rec) => { if (w > 0 || rec) { atoms.push(rec ? { w, rec } : { w }); placed = true; } };

  /** Texte d'un paragraphe (ou d'une cellule…), avec l'allure de ses caractères et les sauts de page tombés dedans. */
  const read = (el, st, sink) => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { sink.text(c.nodeValue, st); continue; }
      if (c.nodeType !== 1) continue;
      const ln = c.localName;
      if (c.namespaceURI === ODF_TEXT) {
        if (ln === 'soft-page-break') { sink.brk(); continue; }
        if (ln === 's') { sink.text(' '.repeat(Math.min(40, parseInt(c.getAttributeNS(ODF_TEXT, 'c') || '1', 10) || 1)), st); continue; }
        if (ln === 'tab' || ln === 'line-break') { sink.text(' ', st); continue; }
        if (ln === 'note-citation' || ODF_SKIP.has(ln)) continue;        // appel de note : seul le corps de la note compte
        if (ln === 'span') { read(c, mergeLook(st, look(c.getAttributeNS(ODF_TEXT, 'style-name'), true)), sink); continue; }
        if (ln === 'p' || ln === 'h') { sink.text(' ', st); read(c, st, sink); sink.text(' ', st); continue; } // note, cadre : pas collé au mot voisin
      }
      if (c.namespaceURI === ODF_OFFICE && ln === 'annotation') continue; // commentaires
      if (ln === 'title' || ln === 'desc') continue;                      // texte alternatif des images
      if (c.namespaceURI === ODF_DRAW && ln === 'frame') {
        const h = odfLen(c.getAttributeNS(ODF_SVG, 'height'));
        if (h > 0) sink.extra(h * 4.2);                                   // une image occupe à peu près la place de ce texte
      }
      read(c, st, sink);
    }
  };

  const paragraph = (el, isHeading, listed, counted) => {
    const st = look(el.getAttributeNS(ODF_TEXT, 'style-name'));
    if (st.before || afterBreak) hardBreak();
    afterBreak = st.after;
    const parts = [];
    let chars = 0;
    let bold = 0;
    let pieceW = 0;
    const sizes = new Map();
    const rec = { level: 0, text: '', words: 0, chars: 0, look: null, counted };
    let first = true;
    const flush = () => { weigh(pieceW + (first ? 60 : 0), first ? rec : null); first = false; pieceW = 0; };
    read(el, st, {
      text: (s, cs) => {
        parts.push(s);
        const n = s.replace(/\s/g, '').length;
        if (!n) { pieceW += s.length; return; }
        chars += n;
        pieceW += s.length;
        if (cs.bold) bold += n;
        const k = Math.round(cs.size * 2) / 2;
        sizes.set(k, (sizes.get(k) || 0) + n);
      },
      brk: () => { flush(); atoms.push({ brk: 'soft' }); },
      extra: w => { pieceW += w; },
    });
    flush();
    const text = parts.join('').replace(/\s+/g, ' ').trim();
    let size = st.size;
    let best = -1;
    for (const [z, n] of sizes) if (n > best) { best = n; size = z; }
    rec.text = text;
    rec.words = counted ? countWords(text) : 0;
    rec.chars = counted && text ? text.length + 1 : 0;
    rec.look = { text, words: rec.words, size, bold: chars > 0 && bold >= chars * 0.9, center: st.center, list: listed, caption: st.caption };
    if (counted && text) {
      if (isHeading) {
        const lv = parseInt(el.getAttributeNS(ODF_TEXT, 'outline-level') || el.getAttribute('text:outline-level') || '1', 10);
        rec.level = lv >= 1 && lv <= 9 ? lv : 1;
      } else rec.level = st.level;
    }
    recs.push(rec);
  };

  const table = (el, counted) => {
    const st = look(el.getAttributeNS(ODF_TABLE, 'style-name'));
    if (st.before || afterBreak) hardBreak();
    afterBreak = st.after;
    const out = [];
    const rows = node => {
      for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
        if (c.namespaceURI === ODF_TEXT && c.localName === 'soft-page-break') { atoms.push({ brk: 'soft' }); continue; }
        if (c.namespaceURI !== ODF_TABLE) continue;
        if (c.localName === 'table-row') {
          const acc = [];
          odfText(c, acc);
          const t = acc.join('');
          out.push(t);
          weigh(t.length * 1.3 + 50);
        } else if (c.localName === 'table-header-rows' || c.localName === 'table-rows' || c.localName === 'table-row-group') rows(c);
      }
    };
    rows(el);
    const text = out.join(' ').replace(/\s+/g, ' ').trim();
    recs.push({ table: true, words: counted ? countWords(text) : 0, chars: counted && text ? text.length + 1 : 0 });
  };

  const block = (el, listed, counted) => {
    const ln = el.localName;
    if (el.namespaceURI === ODF_TEXT) {
      if (ln === 'soft-page-break') { atoms.push({ brk: 'soft' }); return; }
      if (ODF_SKIP.has(ln)) {
        // sommaire, index : on suit leur place dans les pages, pas leur texte
        if (ODF_INDEX.has(ln)) for (const c of el.getElementsByTagNameNS(ODF_TEXT, 'index-body')) for (const k of c.children) block(k, false, false);
        return;
      }
      if (ln === 'h' || ln === 'p') { paragraph(el, ln === 'h', listed, counted); return; }
      if (ln === 'list' || ln === 'list-item' || ln === 'list-header') { for (const c of el.children) block(c, true, counted); return; }
      if (ln === 'index-title') { for (const c of el.children) block(c, listed, false); return; }
    }
    if (el.namespaceURI === ODF_TABLE && ln === 'table') { table(el, counted); return; }
    for (const c of el.children) block(c, listed, counted); // sections, cadres : on descend
  };
  for (const c of body.children) block(c, false, true);

  // Pas de titres marqués (ou un seul) : on les repère à leur mise en forme
  let headingSource = 'styles';
  const styled = recs.filter(r => r.level > 0).length;
  if (styled < 2) {
    const lv = guessHeadings(recs.map(r => (r.table ? { text: 'tableau', words: r.words, table: true } : r.look)), { planTitles: (planTitles || []).map(t => t.title) });
    const n = lv.filter(Boolean).length;
    if (n >= 2 && n > styled) {
      recs.forEach((r, i) => { r.level = r.table || !r.counted ? 0 : lv[i]; });
      headingSource = 'layout';
    }
  }
  const segments = [];
  let front = 0;
  let frontChars = 0;
  for (const r of recs) {
    if (!r.table && r.level > 0 && r.text) {
      const before = segments.length;
      pushHeading(segments, r.level, r.text, r.words);
      if (segments.length > before) r.hd = before;
      continue;
    }
    if (!r.words) continue;
    if (segments.length) { const s = segments[segments.length - 1]; s.words += r.words; s.bodyWords += r.words; s.chars += r.chars; }
    else { front += r.words; frontChars += r.chars; }
  }

  const mm = metaXml ? /meta:page-count="(\d+)"/.exec(metaXml) : null;
  const metaPages = mm ? parseInt(mm[1], 10) : null;
  const totalWords = front + segments.reduce((a, x) => a + x.words, 0);

  // Pagination enregistrée : valable si la mise en page était terminée à l'enregistrement
  let paged = null;
  let metaTrust = metaPages;
  const br = byBreaks(atoms.map(a => (a.brk ? a : { w: a.w, hd: a.rec && a.rec.hd !== undefined ? a.rec.hd : -1 })));
  if (br.soft >= 1 || (br.total === 1 && metaPages === 1)) {
    let total = br.total;
    let scale = 1;
    let ok = true;
    if (metaPages) {
      const d = metaPages - total;
      if (Math.abs(d) <= Math.max(1, total * 0.04)) { /* concordant */ }
      else if (d > 0 && d <= br.hard) { scale = metaPages / total; total = metaPages; }   // pages blanches insérées (chapitres en belle page)
      else ok = false;
    }
    // Une page qui porterait bien plus de texte que les autres : la mise en page n'était pas allée au bout
    if (br.median > 0 && (br.last > br.median * 2.5 || br.max > br.median * 4.5)) ok = false;
    const wpp = totalWords / total;
    if (totalWords > 200 && (wpp < 40 || wpp > 1200)) ok = false;
    if (ok) {
      const starts = [];
      let prev = 0;
      for (let i = 0; i < segments.length; i++) {
        let v = br.starts.has(i) ? br.starts.get(i) * scale : prev;
        if (v < prev) v = prev;
        starts.push(v);
        prev = v;
      }
      const sp = spans(starts, total);
      paged = { total, front: sp.front, pages: sp.pages, source: 'word', layout: null, gen: 'libreoffice' };
    } else metaTrust = null;   // mise en page inachevée : le nombre de pages enregistré avec elle ne vaut pas mieux
  }
  const res = finish('odt', segments, front, metaTrust, DEFAULT_WPP, paged, frontChars);
  res.headingSource = segments.length ? headingSource : '';
  return res;
}

/** Allure d'un passage (text:span) : celle du paragraphe, corrigée par le style de caractères. */
function mergeLook(st, span) {
  if (!span.size && !span.pct && span.bold === undefined) return st;
  return { ...st, size: span.size || (span.pct ? st.size * span.pct : st.size), bold: span.bold === undefined ? st.bold : span.bold };
}

function odfText(el, out) {
  for (let c = el.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === 3) { out.push(c.nodeValue); continue; }
    if (c.nodeType !== 1) continue;
    const ln = c.localName;
    if (c.namespaceURI === ODF_TEXT) {
      if (ln === 's' || ln === 'tab' || ln === 'line-break') { out.push(' '); continue; }
      if (ln === 'note-citation' || ODF_SKIP.has(ln)) continue;      // appel de note : seul le corps de la note compte
      if (ln === 'p' || ln === 'h') { out.push(' '); odfText(c, out); out.push(' '); continue; } // note, cadre : pas collé au mot voisin
    }
    if (c.namespaceURI === ODF_OFFICE && ln === 'annotation') continue; // commentaires
    if (ln === 'title' || ln === 'desc') continue;                      // texte alternatif des images
    odfText(c, out);
  }
}

/* ------------------------------------------------------------
   HTML du presse-papiers (Google Docs, Word, LibreOffice, pages web)
------------------------------------------------------------ */
const HTML_SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'OBJECT', 'IFRAME']);
const HTML_BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'TD', 'TH', 'BR', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE',
  'HR', 'DL', 'DT', 'DD', 'FIGURE', 'FIGCAPTION', 'HEADER', 'FOOTER']);

export function analyzeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const segments = [];
  let front = 0;
  let frontChars = 0;
  let buf = [];
  const flush = () => {
    const text = buf.join('');
    const n = countWords(text);
    buf = [];
    if (!n) return;
    const c = signs(text) + 1;
    if (segments.length) { const s = segments[segments.length - 1]; s.words += n; s.bodyWords += n; s.chars += c; }
    else { front += n; frontChars += c; }
  };
  const walk = el => {
    for (let c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { buf.push(c.nodeValue); continue; }
      if (c.nodeType !== 1 || HTML_SKIP.has(c.tagName.toUpperCase())) continue;
      const tag = c.tagName.toUpperCase();
      const cls = c.getAttribute('class') || '';
      const style = c.getAttribute('style') || '';
      if (/^MsoToc/i.test(cls) || /display\s*:\s*none|mso-hide\s*:\s*all/i.test(style)) continue; // table des matières de Word, texte masqué
      let level = 0;
      const mh = /^H([1-6])$/.exec(tag);
      if (mh) level = +mh[1];
      else if (c.getAttribute('role') === 'heading') level = Math.min(6, Math.max(1, parseInt(c.getAttribute('aria-level') || '2', 10) || 2));
      if (level) {
        flush();
        const text = (c.textContent || '').replace(/\s+/g, ' ').trim();
        if (text) pushHeading(segments, level, text, countWords(text));
        continue;
      }
      if (HTML_BLOCK.has(tag)) buf.push(' ');
      walk(c);
      if (HTML_BLOCK.has(tag)) buf.push(' ');
    }
  };
  if (doc.body) walk(doc.body);
  flush();
  return finish('html', segments, front, null, DEFAULT_WPP, null, frontChars);
}

/* ------------------------------------------------------------
   Texte brut : LaTeX, Markdown, texte simple
------------------------------------------------------------ */
export function analyzeText(text, name = '') {
  const ext = (/\.([a-z0-9]+)$/i.exec(String(name)) || ['', ''])[1].toLowerCase();
  const r = ext === 'typ' ? parseTypst(text) : ext === 'org' ? parseOrg(text) : ext === 'adoc' || ext === 'asciidoc' ? parseAsciidoc(text)
    : ext === 'rst' ? parseRst(text) : parseTextDocument(text);
  // Une page de thèse composée en LaTeX ou en Typst contient un peu plus de texte qu'une page Word à interligne 1,5
  const dense = r.kind === 'latex' || r.kind === 'typst';
  return finish(dense ? 'latex' : r.kind, r.segments.map(x => ({ ...x, bodyWords: 0 })), r.frontWords, null, dense ? 420 : DEFAULT_WPP, null, r.frontChars || 0);
}

/* ------------------------------------------------------------
   RTF (Scrivener, Nisus Writer, Mellel, TextEdit, anciens Word)
------------------------------------------------------------ */
export function analyzeRtf(text, planTitles) {
  const { paras, pagesMeta } = parseRtf(text);
  const recs = paras.map(p => {
    const m = HEADING_NAME.exec(p.style || '');
    return { ...p, level: p.table || !p.text ? 0 : p.outline || (m ? +m[2] : 0) };
  });
  let headingSource = 'styles';
  const styled = recs.filter(r => r.level > 0).length;
  if (styled < 2) {
    const lv = guessHeadings(recs.map(r => ({ text: r.text, words: r.words, size: r.size, bold: r.bold, center: r.center, table: r.table, caption: /caption|l[ée]gende/.test(r.style || '') })),
      { planTitles: (planTitles || []).map(t => t.title) });
    const n = lv.filter(Boolean).length;
    if (n >= 2 && n > styled) { recs.forEach((r, i) => { r.level = lv[i]; }); headingSource = 'layout'; }
  }
  const segments = [];
  let front = 0;
  let frontChars = 0;
  for (const r of recs) {
    if (r.level > 0 && r.text) { pushHeading(segments, r.level, r.text, r.words + r.notes); continue; }
    const w = r.words + r.notes;
    if (!w) continue;
    const c = r.text.length + 1 + r.notes * 6;
    if (segments.length) { const s = segments[segments.length - 1]; s.words += w; s.bodyWords += w; s.chars += c; }
    else { front += w; frontChars += c; }
  }
  const res = finish('rtf', segments, front, pagesMeta, DEFAULT_WPP, null, frontChars);
  res.headingSource = segments.length ? headingSource : '';
  return res;
}

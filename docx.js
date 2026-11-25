/* ============================================================
   DOCUMENTS — lecture du manuscrit dans le navigateur
   Le fichier n'est jamais envoyé. Formats lus :
     • Word (.docx) et LibreOffice (.odt) : on décompresse l'archive
       (JSZip, chargé à la demande) et on lit les titres et le texte ;
     • LaTeX (.tex), Markdown (.md), texte simple (.txt) ;
     • contenu collé : le presse-papiers garde les titres de Google
       Docs, de Word, de LibreOffice (HTML), ou le texte brut.
   Chaque lecteur renvoie la même chose : la liste des titres avec
   leur niveau et leur nombre de mots, notes de bas de page comprises
   (voir outline.js pour le passage au plan à deux étages).
   Le nombre de pages est calibré sur celui du traitement de texte
   quand le fichier le donne.
============================================================ */
import { countWords, parseTextDocument } from './outline.js';

export { countWords };

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const JSZIP_SRI = 'sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtxf26XV8P4wPk26EDxuGZ91N8bsOttmnomcCD3CS5ZMRL50H0GgOHvegtg==';

export const DEFAULT_WPP = 380; // mots par page (Times 12, interligne 1,5, marges 2,5 cm)

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

const TEXT_EXT = /\.(tex|ltx|md|markdown|mdown|txt|text|rst)$/i;
const MAX_TEXT = 30 * 1024 * 1024;

function decodeText(buf) {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  // Fichier enregistré en Latin-1 / Windows-1252 : beaucoup de caractères de remplacement en UTF-8
  if ((utf8.match(/\uFFFD/g) || []).length > 3) {
    try { return new TextDecoder('windows-1252').decode(buf); } catch { /* décodeur absent : on garde l'UTF-8 */ }
  }
  return utf8;
}

/** Lit un fichier (File) et renvoie l'analyse commune à tous les formats. */
export async function parseDocumentFile(file) {
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 5));
  const name = String(file.name || '');
  if (sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0) throw new DocxError('old-doc');
  if (sig[0] === 0x25 && sig[1] === 0x50 && sig[2] === 0x44 && sig[3] === 0x46) throw new DocxError('pdf');
  if (sig[0] === 0x7B && sig[1] === 0x5C && sig[2] === 0x72 && sig[3] === 0x74) throw new DocxError('rtf');
  if (sig[0] === 0x50 && sig[1] === 0x4B) {
    const JSZip = await loadJSZip();
    let zip;
    try { zip = await JSZip.loadAsync(buf); } catch { throw new DocxError('not-docx'); }
    const read = p => { const f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); };
    if (zip.file('word/document.xml')) {
      const [docXml, stylesXml, appXml, footXml, endXml] = await Promise.all([
        read('word/document.xml'), read('word/styles.xml'), read('docProps/app.xml'),
        read('word/footnotes.xml'), read('word/endnotes.xml'),
      ]);
      return analyzeDocx({ docXml, stylesXml, appXml, footXml, endXml });
    }
    if (zip.file('content.xml')) {
      const [contentXml, stylesXml, metaXml, mime] = await Promise.all([read('content.xml'), read('styles.xml'), read('meta.xml'), read('mimetype')]);
      if (mime && !/opendocument\.text/.test(mime)) throw new DocxError('not-docx'); // tableur, présentation…
      return analyzeOdt({ contentXml, stylesXml, metaXml });
    }
    if (/\.pages$/i.test(name) || zip.file('Index/Document.iwa')) throw new DocxError('pages');
    throw new DocxError('not-docx');
  }
  if (/\.html?$/i.test(name) || file.type === 'text/html') {
    if (buf.byteLength > MAX_TEXT) throw new DocxError('too-big');
    return analyzeHtml(decodeText(buf)); // page enregistrée depuis un éditeur en ligne
  }
  if (TEXT_EXT.test(name) || /^text\//.test(file.type || '')) {
    if (buf.byteLength > MAX_TEXT) throw new DocxError('too-big');
    return analyzeText(decodeText(buf));
  }
  throw new DocxError('not-docx');
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
  const map = new Map();
  if (!xml) return map;
  const d = parser.parseFromString(xml, 'application/xml');
  for (const n of d.getElementsByTagNameNS(W_NS, tag)) {
    const type = wattr(n, 'type');
    if (type && type !== 'normal') continue; // séparateurs
    const acc = { text: [], notes: 0 };
    collect(n, acc, NO_NOTES);
    map.set(wattr(n, 'id'), countWords(acc.text.join('')));
  }
  return map;
}

/* ------------------------------------------------------------
   Styles : quel style est un titre, et de quel niveau ?
------------------------------------------------------------ */
function parseStyles(sdoc) {
  const map = new Map();
  if (!sdoc) return map;
  for (const st of sdoc.getElementsByTagNameNS(W_NS, 'style')) {
    if (wattr(st, 'type') !== 'paragraph') continue;
    const id = wattr(st, 'styleId');
    const nameEl = wchild(st, 'name');
    const basedEl = wchild(st, 'basedOn');
    const pPr = wchild(st, 'pPr');
    const olEl = pPr ? wchild(pPr, 'outlineLvl') : null;
    map.set(id, {
      name: (nameEl ? wattr(nameEl, 'val') : '').toLowerCase(),
      basedOn: basedEl ? wattr(basedEl, 'val') : null,
      outline: olEl ? parseInt(wattr(olEl, 'val'), 10) : null,
    });
  }
  return map;
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
   Analyse principale
------------------------------------------------------------ */
export function analyzeDocx({ docXml, stylesXml, appXml, footXml, endXml }) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(docXml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('bad-xml');
  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0];
  if (!body) throw new DocxError('bad-xml');

  const styles = parseStyles(stylesXml ? parser.parseFromString(stylesXml, 'application/xml') : null);
  const notes = {
    foot: parseNotes(footXml, 'footnote', parser),
    end: parseNotes(endXml, 'endnote', parser),
  };

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

  const handleParagraph = p => {
    const pPr = wchild(p, 'pPr');
    let level = 0;
    if (pPr) {
      const ps = wchild(pPr, 'pStyle');
      if (ps) level = styleLevel(styles, wattr(ps, 'val'));
      const ol = wchild(pPr, 'outlineLvl');
      if (ol && level !== -1) {
        const v = parseInt(wattr(ol, 'val'), 10);
        level = v >= 0 && v < 9 ? v + 1 : 0;
      }
    }
    if (level === -1) return; // entrées de table des matières : ignorées
    const acc = { text: [], notes: 0 };
    collect(p, acc, notes);
    const text = acc.text.join('').replace(/\s+/g, ' ').trim();
    const words = countWords(text);
    if (level > 0 && text) pushHeading(segments, level, text, words + acc.notes);
    else add(words + acc.notes);
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
        add(countWords(acc.text.join('')) + acc.notes);
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

  const pagesMatch = appXml ? /<Pages>(\d+)<\/Pages>/.exec(appXml) : null;
  return finish('docx', segments, front, pagesMatch ? parseInt(pagesMatch[1], 10) : null);
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
    return;
  }
  segments.push({ level, title: text.slice(0, 200), words, bodyWords: 0 });
}

/** Résultat commun : titres bruts, mots, et mots par page calibrés sur la pagination du fichier s'il la donne. */
function finish(kind, segments, frontWords, pagesMeta, defaultWpp = DEFAULT_WPP) {
  const totalWords = frontWords + segments.reduce((a, x) => a + x.words, 0);
  let wpp = defaultWpp;
  let wppSource = 'default';
  if (pagesMeta && pagesMeta >= 2 && totalWords > 0) {
    const r = totalWords / pagesMeta;
    if (r >= 80 && r <= 1200) { wpp = Math.round(r); wppSource = 'word'; }
  }
  return {
    kind, totalWords, frontWords, pagesMeta: pagesMeta || null, wpp, wppSource,
    segments: segments.map(x => ({ level: x.level, title: x.title, words: x.words })),
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
// Tables générées et coulisses du document : jamais comptées
const ODF_SKIP = new Set(['table-of-content', 'illustration-index', 'table-index', 'object-index', 'user-index',
  'alphabetical-index', 'tracked-changes', 'sequence-decls', 'variable-decls', 'user-field-decls', 'forms']);

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

/**
 * Niveau de titre des styles de paragraphe. Un document né dans LibreOffice marque ses titres (text:h),
 * mais un document converti depuis Word n'a souvent que des paragraphes au style « Heading 2 » :
 * on remonte donc la chaîne des styles, comme pour Word.
 */
function odfStyleLevels(docs) {
  const styles = new Map();
  for (const d of docs) {
    if (!d) continue;
    for (const st of d.getElementsByTagNameNS(ODF_STYLE, 'style')) {
      const fam = st.getAttributeNS(ODF_STYLE, 'family');
      if (fam && fam !== 'paragraph') continue;
      const name = st.getAttributeNS(ODF_STYLE, 'name');
      if (!name) continue;
      const lvl = parseInt(st.getAttributeNS(ODF_STYLE, 'default-outline-level') || '', 10);
      styles.set(name, {
        parent: st.getAttributeNS(ODF_STYLE, 'parent-style-name') || null,
        label: (st.getAttributeNS(ODF_STYLE, 'display-name') || name).replace(/_20_/g, ' ').toLowerCase(),
        outline: lvl >= 1 && lvl <= 9 ? lvl : 0,
      });
    }
  }
  const level = (name, depth = 0) => {
    if (!name || depth > 12) return 0;
    const st = styles.get(name);
    const label = st ? st.label : String(name).replace(/_20_/g, ' ').toLowerCase();
    if (/^(contents|index|table of|table des)/.test(label)) return 0;
    const m = HEADING_NAME.exec(label);
    if (m) return +m[2];
    if (!st) return 0;
    if (st.outline) return st.outline;
    return level(st.parent, depth + 1);
  };
  return level;
}

export function analyzeOdt({ contentXml, stylesXml, metaXml }) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(contentXml || '', 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new DocxError('bad-xml');
  const body = doc.getElementsByTagNameNS(ODF_OFFICE, 'text')[0];
  if (!body) throw new DocxError('not-docx');
  let sdoc = null;
  if (stylesXml) {
    sdoc = parser.parseFromString(stylesXml, 'application/xml');
    if (sdoc.getElementsByTagName('parsererror').length) sdoc = null;
  }
  const styleLevelOf = odfStyleLevels([sdoc, doc]);

  const segments = [];
  let front = 0;
  const add = n => {
    if (!n) return;
    if (segments.length) { const s = segments[segments.length - 1]; s.words += n; s.bodyWords += n; }
    else front += n;
  };
  const textOf = el => { const out = []; odfText(el, out); return out.join('').replace(/\s+/g, ' ').trim(); };
  const block = el => {
    const ln = el.localName;
    if (el.namespaceURI === ODF_TEXT) {
      if (ODF_SKIP.has(ln)) return;
      if (ln === 'h') {
        const text = textOf(el);
        const level = parseInt(el.getAttributeNS(ODF_TEXT, 'outline-level') || el.getAttribute('text:outline-level') || '1', 10);
        if (text) pushHeading(segments, level >= 1 && level <= 9 ? level : 1, text, countWords(text));
        return;
      }
      if (ln === 'p') {
        const text = textOf(el);
        const level = text ? styleLevelOf(el.getAttributeNS(ODF_TEXT, 'style-name')) : 0;
        if (level) pushHeading(segments, level, text, countWords(text));
        else add(countWords(text));
        return;
      }
    }
    if (el.namespaceURI === ODF_TABLE && ln === 'table') { add(countWords(textOf(el))); return; }
    for (const c of el.children) block(c); // listes, sections, cadres : on descend
  };
  for (const c of body.children) block(c);

  const m = metaXml ? /meta:page-count="(\d+)"/.exec(metaXml) : null;
  return finish('odt', segments, front, m ? parseInt(m[1], 10) : null);
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
  let buf = [];
  const flush = () => {
    const n = countWords(buf.join(''));
    buf = [];
    if (!n) return;
    if (segments.length) { const s = segments[segments.length - 1]; s.words += n; s.bodyWords += n; }
    else front += n;
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
  return finish('html', segments, front, null);
}

/* ------------------------------------------------------------
   Texte brut : LaTeX, Markdown, texte simple
------------------------------------------------------------ */
export function analyzeText(text) {
  const r = parseTextDocument(text);
  // Une page de thèse composée en LaTeX contient un peu plus de mots qu'une page Word à interligne 1,5
  return finish(r.kind, r.segments.map(x => ({ ...x, bodyWords: 0 })), r.frontWords, null, r.kind === 'latex' ? 420 : DEFAULT_WPP);
}

/* ============================================================
   DOCX — lecture d'un fichier Word dans le navigateur
   Le fichier n'est jamais envoyé : on décompresse le .docx
   (JSZip, chargé à la demande), on repère les titres (styles
   Titre 1 / Titre 2 ou niveaux hiérarchiques), et on compte
   les mots de chaque partie, notes de bas de page comprises.
   Le nombre de pages est calibré sur celui calculé par Word
   (docProps/app.xml) quand il est disponible.
============================================================ */

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

/** Lit un File (.docx) et renvoie l'analyse. */
export async function parseDocxFile(file) {
  const buf = await file.arrayBuffer();
  const sig = new Uint8Array(buf.slice(0, 4));
  if (sig[0] === 0xD0 && sig[1] === 0xCF && sig[2] === 0x11 && sig[3] === 0xE0) throw new DocxError('old-doc');
  if (!(sig[0] === 0x50 && sig[1] === 0x4B)) throw new DocxError('not-docx');
  const JSZip = await loadJSZip();
  let zip;
  try { zip = await JSZip.loadAsync(buf); } catch { throw new DocxError('not-docx'); }
  const read = p => { const f = zip.file(p); return f ? f.async('string') : Promise.resolve(null); };
  const [docXml, stylesXml, appXml, footXml, endXml] = await Promise.all([
    read('word/document.xml'), read('word/styles.xml'), read('docProps/app.xml'),
    read('word/footnotes.xml'), read('word/endnotes.xml'),
  ]);
  if (!docXml) throw new DocxError('not-docx');
  return analyzeDocx({ docXml, stylesXml, appXml, footXml, endXml });
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

export function countWords(text) {
  let n = 0;
  for (const tok of String(text).split(/\s+/)) {
    if (tok && /[\p{L}\p{N}]/u.test(tok)) n++;
  }
  return n;
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
    if (level > 0 && text) {
      const prev = segments[segments.length - 1];
      // « CHAPITRE 1 » sur une ligne + titre sur la suivante : on fusionne
      if (prev && prev.level === level && prev.bodyWords === 0 &&
          /^(chapitre|chap\.?|partie|article|section)\s+[\divxlc]+\.?$/i.test(prev.title)) {
        prev.title = `${prev.title} : ${text}`.slice(0, 200);
        prev.words += words + acc.notes;
        return;
      }
      segments.push({ level, title: text.slice(0, 200), words: words + acc.notes, bodyWords: 0 });
    } else {
      add(words + acc.notes);
    }
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

  // Arbre à deux niveaux : niveau le plus haut = chapitres, suivant = sous-parties
  const levels = [...new Set(segments.map(s => s.level))].sort((a, b) => a - b);
  const top = levels.length ? levels[0] : null;
  const second = levels.length > 1 ? levels[1] : null;
  const chapters = [];
  let ch = null;
  let sub = null;
  for (const s of segments) {
    if (s.level === top) {
      ch = { title: s.title, ownWords: s.words, words: 0, children: [] };
      chapters.push(ch);
      sub = null;
    } else if (second !== null && s.level === second) {
      if (!ch) { front += s.words; continue; }
      sub = { title: s.title, words: s.words };
      ch.children.push(sub);
    } else if (sub) sub.words += s.words;
    else if (ch) ch.ownWords += s.words;
    else front += s.words;
  }
  for (const c of chapters) c.words = c.ownWords + c.children.reduce((a, x) => a + x.words, 0);

  const totalWords = front + chapters.reduce((a, c) => a + c.words, 0);
  const pagesMatch = appXml ? /<Pages>(\d+)<\/Pages>/.exec(appXml) : null;
  const pagesMeta = pagesMatch ? parseInt(pagesMatch[1], 10) : null;
  let wpp = DEFAULT_WPP;
  let wppSource = 'default';
  if (pagesMeta && pagesMeta >= 2 && totalWords > 0) {
    const r = totalWords / pagesMeta;
    if (r >= 80 && r <= 1200) { wpp = Math.round(r); wppSource = 'word'; }
  }

  return { totalWords, frontWords: front, pagesMeta, wpp, wppSource, top, second, chapters, headingCount: segments.length };
}

/* ============================================================
   AUTRES FORMATS — logique pure (testée dans tests/core.test.mjs)
     • RTF (Scrivener, Nisus, Mellel, TextEdit, anciens Word)
     • Typst (.typ), Org (.org), AsciiDoc (.adoc), reStructuredText (.rst)
     • projets en plusieurs fichiers : LaTeX (\input, \include,
       \subfile, \import), Typst (#include)
   Chaque lecteur renvoie les titres dans l'ordre, avec leurs mots
   et leurs signes : { segments, frontWords, frontChars, kind }.
============================================================ */
import { countWords, signs } from './outline.js';

function collector() {
  const segments = [];
  let cur = null;
  let frontWords = 0;
  let frontChars = 0;
  return {
    head(level, title) {
      const t = String(title).replace(/\s+/g, ' ').trim();
      if (!t) return;
      cur = { level: Math.max(1, Math.min(9, level)), title: t.slice(0, 200), words: countWords(t), chars: signs(t) };
      segments.push(cur);
    },
    text(s) {
      const n = countWords(s);
      if (!n) return;
      const c = signs(s) + 1;
      if (cur) { cur.words += n; cur.chars += c; } else { frontWords += n; frontChars += c; }
    },
    done: kind => ({ segments, frontWords, frontChars, kind }),
  };
}

/* ------------------------------------------------------------
   TYPST
------------------------------------------------------------ */
function typstClean(line) {
  return line
    .replace(/\/\/.*$/, ' ')                              // commentaire
    .replace(/\$[^$]*\$/g, ' ')                           // formule
    .replace(/#[a-zA-Z_][\w.-]*(\([^()]*(\([^()]*\)[^()]*)*\))?/g, ' ')   // appel de fonction et ses réglages
    .replace(/<[\w:.-]+>/g, ' ')                          // étiquette
    .replace(/@[\w:.-]+/g, ' ')                           // renvoi
    .replace(/[*_`\[\]#]/g, ' ');
}

export function parseTypst(text) {
  const out = collector();
  let comment = false;   // dans un commentaire sur plusieurs lignes
  let raw = false;       // dans un bloc de code ```
  let depth = 0;         // dans une instruction (#let, #set, #show…) restée ouverte
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    let line = rawLine;
    if (comment) { const e = line.indexOf('*/'); if (e < 0) continue; line = line.slice(e + 2); comment = false; }
    line = line.replace(/\/\*.*?\*\//g, ' ');
    const open = line.indexOf('/*');
    if (open >= 0) { line = line.slice(0, open); comment = true; }
    const t = line.trim();
    if (/^```/.test(t)) { raw = !raw; continue; }
    if (raw) continue;
    const balance = s => (s.match(/[({[]/g) || []).length - (s.match(/[)}\]]/g) || []).length;
    if (depth > 0) { depth = Math.max(0, depth + balance(t)); continue; }
    if (/^#(let|set|show|import|include)\b/.test(t)) { depth = Math.max(0, balance(t)); continue; }
    const h = /^(=+)\s+(.+)$/.exec(t);
    if (h) { out.head(h[1].length, typstClean(h[2])); continue; }
    out.text(typstClean(t));
  }
  return out.done('typst');
}

/* ------------------------------------------------------------
   ORG
------------------------------------------------------------ */
export function parseOrg(text) {
  const out = collector();
  let skip = '';      // bloc en cours à ignorer (SRC, EXAMPLE…)
  let drawer = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (skip) { if (new RegExp(`^#\\+end_${skip}`, 'i').test(t)) skip = ''; continue; }
    if (drawer) { if (/^:END:$/i.test(t)) drawer = false; continue; }
    const b = /^#\+begin_(\w+)/i.exec(t);
    if (b) { if (/^(src|example|export|comment)$/i.test(b[1])) skip = b[1]; continue; }
    if (/^#\+end_/i.test(t) || /^#\+\w+:/.test(t) || /^#(\s|$)/.test(t)) continue;
    if (/^:[A-Za-z_-]+:\s*$/.test(t)) { drawer = true; continue; }
    const clean = s => s.replace(/\[\[[^\]]*\]\[([^\]]*)\]\]/g, '$1').replace(/\[\[[^\]]*\]\]/g, ' ').replace(/\[fn:[^\]]*\]/g, ' ');
    const h = /^(\*+)\s+(.*)$/.exec(raw);
    if (h) {
      const title = h[2].replace(/^(TODO|DONE|NEXT|WAITING|CANCELLED)\s+/, '').replace(/^\[#[A-Z]\]\s+/, '').replace(/\s+(:[\w@#%]+)+:\s*$/, '');
      out.head(h[1].length, clean(title));
      continue;
    }
    out.text(clean(t));
  }
  return out.done('org');
}

/* ------------------------------------------------------------
   ASCIIDOC
------------------------------------------------------------ */
export function parseAsciidoc(text) {
  const out = collector();
  let block = '';     // délimiteur du bloc ignoré en cours (code, littéral, commentaire)
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim();
    if (block) { if (t === block) block = ''; continue; }
    if (/^(-{4,}|\.{4,}|\+{4,}|\/{4,})$/.test(t)) { block = t; continue; }
    if (/^\/\//.test(t) || /^:[\w-]+:/.test(t) || /^\[[^\]]*\]$/.test(t) || /^\|===/.test(t) || /^(={4,}|\*{4,}|_{4,})$/.test(t)) continue;
    if (/^(image|include|toc|video|audio)::/.test(t)) continue;
    const clean = s => s.replace(/footnote:\[([^\]]*)\]/g, ' $1 ').replace(/https?:\/\/\S+\[([^\]]*)\]/g, '$1').replace(/<<[^,>]*,?([^>]*)>>/g, '$1').replace(/^\|/, ' ').replace(/\s\|/g, ' ');
    const h = /^(={1,6}|#{1,6})\s+(\S.*)$/.exec(t);
    if (h) { out.head(h[1].length, clean(h[2])); continue; }
    out.text(clean(t));
  }
  return out.done('asciidoc');
}

/* ------------------------------------------------------------
   reStructuredText : un titre est une ligne soulignée (et parfois
   surlignée) d'un même signe ; le rang d'un style de soulignement
   est son ordre d'apparition.
------------------------------------------------------------ */
export function parseRst(text) {
  const out = collector();
  const lines = String(text || '').split(/\r?\n/);
  const styles = [];
  const rule = s => /^([=\-~^"'`#*+_.:])\1{2,}$/.test(s.trim());
  let skipIndent = -1;   // contenu indenté d'une directive à ignorer
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (skipIndent >= 0) {
      if (!t || raw.search(/\S/) > skipIndent) continue;
      skipIndent = -1;
    }
    // Titre surligné : règle, texte, règle
    if (rule(t) && i + 2 < lines.length && lines[i + 1].trim() && !rule(lines[i + 1]) && rule(lines[i + 2]) && lines[i + 2].trim()[0] === t[0]) {
      const key = `o${t[0]}`;
      if (!styles.includes(key)) styles.push(key);
      out.head(styles.indexOf(key) + 1, lines[i + 1]);
      i += 2;
      continue;
    }
    // Titre souligné : texte, règle au moins aussi longue
    if (t && !rule(t) && i + 1 < lines.length && rule(lines[i + 1]) && lines[i + 1].trim().length >= Math.min(t.length, 3) && !/^\.\. /.test(t)) {
      const key = `u${lines[i + 1].trim()[0]}`;
      if (!styles.includes(key)) styles.push(key);
      out.head(styles.indexOf(key) + 1, t);
      i += 1;
      continue;
    }
    const d = /^\.\. ([\w-]+)::/.exec(t);
    if (d) {
      if (/^(code|code-block|sourcecode|math|raw|image|figure|toctree|contents|include|csv-table|list-table)$/.test(d[1])) skipIndent = raw.search(/\S/);
      continue;
    }
    if (rule(t) || /^:[\w -]+:/.test(t) || /^\+[-=+]+\+$/.test(t) || /^(={2,}\s+)+={2,}$/.test(t)) continue;
    out.text(t.replace(/^\.\. \[[^\]]*\]/, ' ').replace(/\[[^\]]*\]_/g, ' ').replace(/:[\w-]+:`([^`]*)`/g, '$1').replace(/[*`|]/g, ' '));
  }
  return out.done('rst');
}

/* ------------------------------------------------------------
   PROJETS EN PLUSIEURS FICHIERS
   files : Map(nom → texte) ; les noms sont des chemins relatifs.
------------------------------------------------------------ */
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function joinPath(dir, rel) {
  const parts = [];
  for (const seg of (dir + rel).split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop(); else parts.push(seg);
  }
  return parts.join('/');
}

/** Le fichier principal d'un projet LaTeX : celui qui porte \documentclass et \begin{document}. */
export function texMain(files) {
  const names = [...files.keys()].filter(n => /\.(tex|ltx)$/i.test(n));
  if (!names.length) return '';
  const strip = s => s.replace(/(^|[^\\])%.*$/gm, '$1');
  const mains = names.filter(n => { const s = strip(files.get(n)); return /\\documentclass/.test(s) && /\\begin\{document\}/.test(s) && !/\\documentclass\s*\[[^\]]*\]\s*\{subfiles\}/.test(s); });
  if (mains.length === 1) return mains[0];
  const pool = mains.length ? mains : names;
  // Plusieurs candidats : le plus proche de la racine, puis un nom habituel, puis le plus long une fois assemblé
  const score = n => {
    const depth = n.split('/').length - 1;
    const base = n.split('/').pop().toLowerCase();
    const usual = /^(main|these|thesis|manuscrit|memoire|dissertation|master|root)\b/.test(base) ? 1 : 0;
    return [depth, -usual, -resolveTex(n, files).length];
  };
  return pool.map(n => [n, score(n)]).sort((a, b) => a[1][0] - b[1][0] || a[1][1] - b[1][1] || a[1][2] - b[1][2])[0][0];
}

/** Assemble un document LaTeX : \input, \include, \subfile, \import et \subimport sont remplacés par leur fichier. */
export function resolveTex(main, files, depth = 0, seen = new Set()) {
  let src = files.get(main);
  if (src === undefined || depth > 15 || seen.has(main)) return '';
  seen.add(main);
  src = src.replace(/(^|[^\\])%.*$/gm, '$1');
  if (depth > 0) {
    // Un sous-fichier compilable seul (subfiles) : on ne garde que son corps
    const b = src.indexOf('\\begin{document}');
    if (b >= 0) src = src.slice(b + 16);
    const e = src.indexOf('\\end{document}');
    if (e >= 0) src = src.slice(0, e);
  }
  const base = dirOf(main);
  const find = (dir, name) => {
    const n = name.trim().replace(/^\.\//, '');
    for (const cand of [joinPath(dir, n), joinPath(dir, `${n}.tex`), joinPath('', n), joinPath('', `${n}.tex`)]) if (files.has(cand)) return cand;
    // Fichiers déposés en vrac (sans leurs dossiers) : on se fie au nom seul, s'il n'y en a qu'un de ce nom
    const leaf = n.split('/').pop().replace(/\.(tex|ltx)$/i, '').toLowerCase();
    const same = [...files.keys()].filter(k => k.split('/').pop().replace(/\.(tex|ltx)$/i, '').toLowerCase() === leaf);
    return same.length === 1 ? same[0] : '';
  };
  const sub = (dir, name) => {
    const f = find(dir, name);
    return f ? `\n${resolveTex(f, files, depth + 1, seen)}\n` : ' ';
  };
  return src
    .replace(/\\(?:sub)?import\*?\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, d, n) => sub(joinPath(base, d.replace(/\/?$/, '/')) + '/', n))
    .replace(/\\(?:input|include|subfile|subfileinclude)\s*\{([^{}]*)\}/g, (m, n) => sub(base, n));
}

/** Assemble un projet Typst : #include "fichier.typ". */
export function resolveTypst(main, files, depth = 0, seen = new Set()) {
  const src = files.get(main);
  if (src === undefined || depth > 15 || seen.has(main)) return '';
  seen.add(main);
  const base = dirOf(main);
  return src.replace(/#include\s+"([^"]+)"/g, (m, n) => {
    const f = [joinPath(base, n), joinPath('', n)].find(c => files.has(c));
    return f ? `\n${resolveTypst(f, files, depth + 1, seen)}\n` : ' ';
  });
}

/* ------------------------------------------------------------
   RTF
   Renvoie { paras, styles, pagesMeta } :
     paras : [{ text, words, notes (mots des notes), style (nom), outline (niveau ou 0),
                size, bold, center, table }] dans l'ordre du document.
------------------------------------------------------------ */
const RTF_SKIP = new Set(['fonttbl', 'colortbl', 'pict', 'object', 'objdata', 'header', 'headerl', 'headerr', 'headerf', 'footer', 'footerl', 'footerr', 'footerf',
  'fldinst', 'themedata', 'colorschememapping', 'latentstyles', 'datastore', 'generator', 'xmlnstbl', 'listtable', 'listoverridetable', 'rsidtbl', 'mmathPr',
  'panose', 'falt', 'bkmkstart', 'bkmkend', 'annotation', 'atnid', 'atnauthor', 'atndate', 'atnref', 'atrfstart', 'atrfend', 'shpinst', 'nonshppict', 'revtbl',
  'filetbl', 'pgdsctbl', 'operator', 'author', 'title', 'subject', 'keywords', 'doccomm', 'creatim', 'revtim', 'printim', 'buptim', 'company', 'manager',
  'category', 'hlinkbase', 'userprops', 'passwordhash', 'wgrffmtfilter', 'pnseclvl', 'listtext', 'pntext', 'ftnsep', 'ftnsepc', 'aftnsep', 'aftnsepc', 'template']);
const RTF_CHARS = { tab: ' ', line: ' ', emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', cell: ' ' };

export function parseRtf(text) {
  const s = String(text || '');
  const n = s.length;
  const styles = new Map();
  const paras = [];
  let pagesMeta = null;
  let cp = null;
  const byte = b => {
    if (b < 128) return String.fromCharCode(b);
    try { if (!cp) cp = new TextDecoder('windows-1252'); return cp.decode(new Uint8Array([b])); } catch { return String.fromCharCode(b); }
  };
  // État d'un groupe { … } : ce qu'on y fait du texte, et l'allure des caractères
  let st = { mode: 'body', uc: 1, bold: false, size: 12 };
  const stack = [];
  // Paragraphe en cours
  let para = null;
  let pp = { style: 0, outline: 0, center: false, table: false };
  let ssNum = 0;
  let ssName = '';
  let pendingNotes = 0;
  let note = '';
  let skipChars = 0;
  const begin = () => { if (!para) para = { parts: [], chars: 0, bold: 0, sizes: new Map() }; };
  const endPara = () => {
    const txt = para ? para.parts.join('').replace(/\s+/g, ' ').trim() : '';
    if (txt || pendingNotes) {
      let size = 12;
      let best = -1;
      if (para) for (const [z, c] of para.sizes) if (c > best) { best = c; size = z; }
      paras.push({ text: txt, words: countWords(txt), notes: pendingNotes, style: styles.get(pp.style) || '', outline: pp.outline, size,
        bold: !!para && para.chars > 0 && para.bold >= para.chars * 0.9, center: pp.center, table: pp.table });
    }
    para = null;
    pendingNotes = 0;
  };
  const emit = ch => {
    if (skipChars > 0) { skipChars--; return; }
    if (st.mode === 'skip') return;
    if (st.mode === 'note') { note += ch; return; }
    if (st.mode === 'ss') { ssName += ch; return; }
    begin();
    para.parts.push(ch);
    if (/\S/.test(ch)) {
      para.chars++;
      if (st.bold) para.bold++;
      para.sizes.set(st.size, (para.sizes.get(st.size) || 0) + 1);
    }
  };
  let i = 0;
  while (i < n) {
    const c = s[i];
    if (c === '{') { stack.push(st); st = { ...st }; if (st.mode === 'sstop') { st.mode = 'ss'; ssNum = 0; ssName = ''; } i++; continue; }
    if (c === '}') {
      if (st.mode === 'ss' && stack.length && stack[stack.length - 1].mode === 'sstop') styles.set(ssNum, ssName.replace(/;\s*$/, '').trim().toLowerCase());
      if (st.mode === 'note' && stack.length && stack[stack.length - 1].mode !== 'note') { pendingNotes += countWords(note); note = ''; }
      st = stack.pop() || { mode: 'body', uc: 1, bold: false, size: 12 };
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') { i++; continue; }
    if (c !== '\\') { emit(c); i++; continue; }
    // Séquence de contrôle
    const d = s[i + 1];
    if (d === undefined) break;
    if (d === '\\' || d === '{' || d === '}') { emit(d); i += 2; continue; }
    if (d === "'") { const b = parseInt(s.substr(i + 2, 2), 16); if (Number.isFinite(b)) emit(byte(b)); i += 4; continue; }
    if (d === '~') { emit(' '); i += 2; continue; }
    if (d === '_') { emit('-'); i += 2; continue; }
    if (d === '-' || d === ':' || d === '|') { i += 2; continue; }
    if (d === '*') { st.star = true; i += 2; continue; }
    if (d === '\r' || d === '\n') { if (st.mode === 'body') endPara(); else if (st.mode === 'note') note += ' '; i += 2; continue; }
    const m = /^([a-zA-Z]+)(-?\d+)?( ?)/.exec(s.substr(i + 1, 48));
    if (!m) { i += 2; continue; }
    i += 1 + m[0].length;
    const word = m[1];
    const num = m[2] !== undefined ? parseInt(m[2], 10) : null;
    const star = st.star;
    st.star = false;
    if (word === 'bin' && num > 0) { i += num; continue; }
    if (word === 'u' && num !== null) { skipChars = 0; emit(String.fromCodePoint(num < 0 ? num + 65536 : num)); skipChars = st.uc; continue; }
    if (word === 'uc' && num !== null) { st.uc = num; continue; }
    if (st.mode === 'skip') continue;
    if (word === 'stylesheet') { st.mode = 'sstop'; continue; }
    if (word === 'info') { st.mode = 'info'; continue; }
    if (st.mode === 'info') { if (word === 'nofpages' && num > 0) pagesMeta = num; else if (/^[a-z]+$/.test(word) && RTF_SKIP.has(word)) st.mode = 'skip'; continue; }
    if (word === 'footnote') { st.mode = 'note'; continue; }
    if (RTF_SKIP.has(word) || (star && !RTF_CHARS[word])) { st.mode = 'skip'; continue; }
    if (st.mode === 'ss') { if (word === 's' && num !== null) ssNum = num; continue; }
    if (st.mode === 'sstop') continue;
    if (RTF_CHARS[word]) { emit(RTF_CHARS[word]); continue; }
    switch (word) {
      case 'par': case 'sect': case 'page': case 'row': if (st.mode === 'body') endPara(); else if (st.mode === 'note') note += ' '; break;
      case 'pard': if (st.mode === 'body') pp = { style: 0, outline: 0, center: false, table: false }; break;
      case 'plain': st.bold = false; st.size = 12; break;
      case 's': if (st.mode === 'body' && num !== null) pp.style = num; break;
      case 'outlinelevel': if (st.mode === 'body' && num !== null && num >= 0 && num < 9) pp.outline = num + 1; break;
      case 'qc': if (st.mode === 'body') pp.center = true; break;
      case 'ql': case 'qj': case 'qr': if (st.mode === 'body') pp.center = false; break;
      case 'intbl': if (st.mode === 'body') pp.table = true; break;
      case 'b': st.bold = num !== 0; break;
      case 'fs': if (num > 0) st.size = num / 2; break;
      default: break;
    }
  }
  endPara();
  return { paras, styles, pagesMeta };
}

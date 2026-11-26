/* ============================================================
   PAGES — combien de pages fait un document, et où tombe chaque titre
   Logique pure (aucun accès à la page ni au réseau), testée dans
   tests/core.test.mjs.

   Le nombre de pages n'est pas dans le texte : il dépend de la mise
   en page. On le prend donc à la meilleure source disponible :
     1. la pagination réelle, quand le fichier la contient
        (repères de saut de page laissés par Word, PDF de Google Docs) ;
     2. sinon, une simulation de la mise en page lue dans le fichier :
        format et marges, police et corps de chaque passage, interligne,
        espacements, retraits, notes de bas de page, images, tableaux.
   Dans les deux cas on obtient la position de chaque titre, en pages
   depuis le début du document ; la longueur d'une partie est l'écart
   entre deux positions.

   Unités : le point typographique (1/72 de pouce). 20 twips = 1 pt.
============================================================ */

/* ------------------------------------------------------------
   POLICES — chasse des caractères, en millièmes de cadratin
   Tables mesurées sur les polices libres de mêmes métriques que
   celles de Word (Liberation = Times New Roman, Arial, Courier New ;
   Carlito = Calibri ; Caladea = Cambria ; Gelasio = Georgia) et sur
   les polices de Google Docs. Caractères 32 à 126, puis quelques
   signes typographiques ; gras = facteur moyen.
------------------------------------------------------------ */
const SPECIALS = '’‘“”«»–—…œŒ€•°';
const TABLES = {
  times: [[250,333,408,500,500,833,778,180,333,333,500,564,250,333,250,278,500,500,500,500,500,500,500,500,500,500,278,278,564,564,564,444,921,722,667,667,722,611,556,722,722,333,389,722,611,889,722,722,556,722,667,556,611,722,722,944,722,722,611,333,278,333,469,500,333,444,500,444,500,444,333,500,500,278,278,500,278,778,500,500,500,500,333,389,278,500,500,722,500,500,444,480,200,480,541], [333,333,444,444,500,500,500,1000,1000,722,889,500,350,400], 1.06],
  arial: [[278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584], [222,222,333,333,556,556,556,1000,1000,944,1000,556,350,400], 1.059],
  calibri: [[226,326,401,498,507,715,682,221,303,303,498,498,250,306,252,386,507,507,507,507,507,507,507,507,507,507,268,268,498,498,498,463,894,579,544,533,615,488,459,631,623,252,319,520,420,855,646,662,517,673,543,459,487,642,567,890,519,487,468,307,386,307,498,498,291,479,525,423,525,498,305,471,525,229,239,455,229,799,525,527,525,525,349,391,335,525,452,715,433,453,395,314,460,314,498], [250,250,418,418,512,512,498,905,690,850,867,507,498,339], 1.025],
  cambria: [[220,286,393,619,506,890,687,237,382,382,427,554,205,329,206,490,517,362,472,461,492,475,470,470,485,478,264,264,554,554,554,422,885,599,579,519,625,540,509,539,696,343,304,630,501,888,693,599,533,599,613,453,557,687,598,889,571,557,507,350,490,350,554,371,151,470,520,421,520,441,313,459,554,277,255,525,271,813,558,480,520,501,396,392,325,546,470,720,483,482,428,387,316,387,712], [221,221,375,375,491,491,500,1000,752,771,929,628,443,375], 1.076],
  georgia: [[241,331,412,643,610,817,710,215,375,375,472,643,270,374,270,469,614,430,559,552,565,528,566,502,596,566,313,313,643,643,643,479,929,671,654,642,749,653,599,725,815,390,518,694,604,927,767,744,610,744,702,561,619,756,667,976,710,615,602,375,469,375,643,643,500,504,560,454,574,483,325,509,582,293,292,536,286,881,591,539,571,560,410,432,345,575,497,737,505,492,444,430,375,430,643], [227,227,410,410,581,581,643,857,807,816,998,642,393,419]],
  garamond: [[200,250,330,468,441,650,756,200,315,315,340,590,230,274,230,399,480,480,480,480,480,480,480,480,480,480,248,228,560,566,560,376,749,692,587,710,754,564,512,729,810,340,340,681,584,901,792,763,552,763,713,465,670,738,672,916,707,578,603,331,399,331,500,500,200,399,515,407,506,390,318,435,515,245,226,469,240,778,528,495,519,522,334,323,314,527,438,685,430,438,377,376,260,376,500], [242,242,418,418,595,595,550,950,686,758,947,707,348,290]],
  verdana: [[318,401,460,838,636,950,780,275,390,390,500,838,318,361,318,337,636,636,636,636,636,636,636,636,636,636,337,337,838,838,838,531,1000,684,686,698,770,632,575,775,752,295,295,656,557,863,748,787,603,787,695,635,611,732,684,989,685,611,685,390,337,390,838,500,500,613,635,550,635,615,352,635,634,278,278,579,278,974,634,612,635,635,411,521,392,634,592,818,592,592,525,636,337,636,838], [318,318,518,518,612,612,500,1000,1000,1023,1070,636,590,500], 1.125],
  opensans: [[260,264,398,646,572,827,729,219,295,295,551,572,259,322,263,367,572,572,572,572,572,572,572,572,572,572,263,263,572,572,572,432,896,632,646,630,726,556,516,727,737,279,269,612,522,899,753,778,602,778,617,548,551,729,596,923,578,559,572,327,367,327,572,438,277,556,612,479,612,562,336,543,613,252,252,525,252,926,613,602,612,612,409,477,356,613,500,775,523,501,469,375,549,375,572], [169,169,349,349,496,496,500,1000,778,948,925,572,376,428]],
  roboto: [[248,258,320,616,562,732,622,175,342,348,431,567,197,276,264,413,562,562,562,562,562,562,562,562,562,562,242,211,508,549,523,473,898,652,623,651,656,568,553,681,713,272,552,627,539,873,713,688,631,688,616,594,597,648,637,887,627,601,599,265,411,265,418,451,309,544,562,523,564,530,348,562,551,243,239,507,243,877,552,570,562,568,339,516,327,551,484,751,496,473,496,338,244,338,680], [200,200,354,357,469,469,656,781,669,908,954,562,337,374]],
  lato: [[193,343,397,580,580,786,703,230,300,300,400,580,212,347,212,373,580,580,580,580,580,580,580,580,580,580,252,252,580,580,580,398,822,680,647,685,753,581,566,734,756,307,444,681,514,920,756,798,611,798,644,530,590,730,680,1019,643,629,624,300,375,300,580,394,307,507,559,467,559,524,337,511,556,256,254,524,256,821,556,556,552,559,403,434,373,556,512,766,504,512,462,300,300,300,580], [212,212,364,364,463,463,556,821,727,867,1096,580,580,397]],
  merri: [[237,289,496,712,661,1036,760,302,430,430,644,669,255,581,255,391,646,453,595,573,616,585,605,570,596,606,257,257,669,669,669,481,1020,705,670,655,752,635,616,724,805,373,373,719,622,991,774,722,641,722,698,594,695,740,664,997,717,644,647,435,431,432,666,500,417,536,598,506,603,522,379,606,663,324,324,634,310,993,663,584,613,591,450,491,390,630,569,844,594,582,544,512,422,512,610], [284,284,498,498,686,686,793,1141,793,935,1005,717,426,464]],
};

// Famille → [table, échelle des chasses, facteur du gras, hauteur d'une ligne à interligne simple (en corps)]
const FAMILIES = {
  'times new roman': ['times', 1, 1.06, 1.15], 'times': ['times', 1, 1.06, 1.15], 'liberation serif': ['times', 1, 1.06, 1.15],
  'tinos': ['times', 1, 1.06, 1.15], 'nimbus roman': ['times', 1, 1.06, 1.15], 'tex gyre termes': ['times', 1, 1.06, 1.15],
  'stix': ['times', 1.01, 1.06, 1.2], 'stix two text': ['times', 1.02, 1.06, 1.2],
  'arial': ['arial', 1, 1.06, 1.15], 'helvetica': ['arial', 1, 1.06, 1.15], 'liberation sans': ['arial', 1, 1.06, 1.15],
  'arimo': ['arial', 1, 1.06, 1.15], 'nimbus sans': ['arial', 1, 1.06, 1.15], 'helvetica neue': ['arial', 1.01, 1.06, 1.2],
  'arial narrow': ['arial', 0.82, 1.06, 1.15], 'arial black': ['arial', 1.25, 1, 1.41],
  'segoe ui': ['arial', 1.0, 1.06, 1.33], 'aptos': ['arial', 0.99, 1.05, 1.22], 'aptos display': ['arial', 0.97, 1.05, 1.22],
  'tahoma': ['verdana', 0.9, 1.1, 1.21], 'verdana': ['verdana', 1.03, 1.125, 1.215], 'dejavu sans': ['verdana', 1, 1.125, 1.165],
  'trebuchet ms': ['arial', 0.99, 1.06, 1.16], 'century gothic': ['arial', 1.1, 1.05, 1.2], 'gill sans': ['arial', 0.9, 1.08, 1.15],
  'gill sans mt': ['arial', 0.9, 1.08, 1.15], 'franklin gothic book': ['arial', 0.95, 1.06, 1.14], 'lucida sans': ['verdana', 1, 1.1, 1.18],
  'lucida sans unicode': ['verdana', 1, 1.1, 1.53], 'optima': ['arial', 0.95, 1.06, 1.2], 'futura': ['arial', 0.98, 1.06, 1.3],
  'avenir': ['arial', 1.03, 1.06, 1.37], 'avenir next': ['arial', 1.03, 1.06, 1.37], 'marianne': ['arial', 1.04, 1.06, 1.3],
  'luciole': ['verdana', 1, 1.08, 1.25], 'atkinson hyperlegible': ['arial', 1.04, 1.06, 1.32], 'opendyslexic': ['verdana', 1.1, 1.05, 1.6],
  'comic sans ms': ['verdana', 0.92, 1.06, 1.39], 'comic neue': ['arial', 0.96, 1.06, 1.15],
  'calibri': ['calibri', 1, 1.025, 1.22], 'carlito': ['calibri', 1, 1.025, 1.22], 'calibri light': ['calibri', 0.99, 1.03, 1.22],
  'candara': ['calibri', 1.04, 1.03, 1.22], 'corbel': ['calibri', 1.04, 1.03, 1.22],
  'cambria': ['cambria', 1, 1.076, 1.17], 'caladea': ['cambria', 1, 1.076, 1.17], 'cambria math': ['cambria', 1, 1.076, 1.17],
  'constantia': ['cambria', 1.06, 1.06, 1.22],
  'georgia': ['georgia', 1, 1.1, 1.14], 'gelasio': ['georgia', 1, 1.1, 1.27],
  'garamond': ['garamond', 0.98, 1.07, 1.125], 'eb garamond': ['garamond', 1, 1.07, 1.31], 'adobe garamond pro': ['garamond', 1, 1.07, 1.2],
  'cormorant garamond': ['garamond', 1.02, 1.07, 1.21], 'cormorant': ['garamond', 1.02, 1.07, 1.21], 'perpetua': ['garamond', 0.97, 1.07, 1.15],
  'minion pro': ['times', 0.98, 1.06, 1.2], 'linux libertine': ['times', 0.99, 1.06, 1.16], 'linux libertine g': ['times', 0.99, 1.06, 1.16],
  'libertinus serif': ['times', 0.99, 1.06, 1.16], 'baskerville': ['times', 1.02, 1.06, 1.15], 'baskerville old face': ['times', 1.0, 1.06, 1.14],
  'hoefler text': ['times', 0.99, 1.06, 1.0], 'didot': ['times', 1.03, 1.06, 1.24], 'bodoni mt': ['times', 0.95, 1.06, 1.2],
  'palatino linotype': ['times', 1.09, 1.05, 1.35], 'palatino': ['times', 1.09, 1.05, 1.2], 'book antiqua': ['times', 1.09, 1.05, 1.24],
  'tex gyre pagella': ['times', 1.09, 1.05, 1.2], 'century schoolbook': ['times', 1.17, 1.06, 1.2], 'century': ['times', 1.17, 1.06, 1.2],
  'bookman old style': ['times', 1.26, 1.05, 1.17], 'rockwell': ['times', 1.13, 1.05, 1.17], 'charter': ['times', 1.1, 1.06, 1.2],
  'bitstream charter': ['times', 1.1, 1.06, 1.2], 'latin modern roman': ['times', 1.05, 1.08, 1.2], 'cmu serif': ['times', 1.05, 1.08, 1.2],
  'computer modern': ['times', 1.05, 1.08, 1.2], 'dejavu serif': ['merri', 1.08, 1.08, 1.165],
  'open sans': ['opensans', 1, 1.06, 1.364], 'noto sans': ['opensans', 1.006, 1.06, 1.362], 'droid sans': ['opensans', 1, 1.06, 1.16],
  'roboto': ['roboto', 1, 1.05, 1.172], 'lato': ['lato', 1, 1.05, 1.2], 'merriweather': ['merri', 1, 1.06, 1.257],
  'montserrat': ['verdana', 0.98, 1.05, 1.219], 'lora': ['georgia', 1.01, 1.06, 1.28], 'source sans 3': ['calibri', 1.02, 1.05, 1.42],
  'source sans pro': ['calibri', 1.02, 1.05, 1.26], 'source serif 4': ['georgia', 1.02, 1.06, 1.38], 'source serif pro': ['georgia', 1.02, 1.06, 1.26],
  'noto serif': ['georgia', 1.03, 1.06, 1.362], 'pt serif': ['georgia', 0.96, 1.07, 1.325], 'pt sans': ['arial', 0.96, 1.07, 1.294],
  'nunito': ['arial', 1.0, 1.06, 1.364], 'nunito sans': ['arial', 1.0, 1.06, 1.364], 'poppins': ['verdana', 0.98, 1.05, 1.5],
  'raleway': ['arial', 1.03, 1.05, 1.174], 'ubuntu': ['arial', 1.01, 1.06, 1.149], 'playfair display': ['georgia', 0.97, 1.08, 1.333],
  'crimson text': ['garamond', 1.03, 1.07, 1.3], 'crimson pro': ['garamond', 1.03, 1.07, 1.3], 'libre baskerville': ['georgia', 1.1, 1.1, 1.24],
  'spectral': ['georgia', 0.96, 1.07, 1.52], 'roboto slab': ['georgia', 1.02, 1.05, 1.319], 'oswald': ['arial', 0.81, 1.05, 1.482],
  'work sans': ['verdana', 0.98, 1.05, 1.173], 'ibm plex sans': ['arial', 1.01, 1.05, 1.3], 'ibm plex serif': ['georgia', 1.02, 1.06, 1.3],
  'libre franklin': ['arial', 1.04, 1.06, 1.21], 'cabin': ['arial', 0.94, 1.06, 1.215], 'quicksand': ['arial', 1.03, 1.05, 1.25],
  'karla': ['arial', 1.02, 1.05, 1.169], 'mulish': ['arial', 1.03, 1.05, 1.255], 'rubik': ['arial', 1.04, 1.05, 1.185],
  'josefin sans': ['arial', 1.0, 1.05, 1.0], 'alegreya': ['garamond', 1.08, 1.07, 1.361], 'bitter': ['georgia', 1.0, 1.06, 1.2],
  'georama': ['arial', 0.97, 1.06, 1.2], 'comfortaa': ['verdana', 1.02, 1.05, 1.115], 'caveat': ['garamond', 0.89, 1.05, 1.26],
  'inter': ['arial', 1.07, 1.06, 1.21],
  'courier new': ['mono', 1, 1, 1.133], 'courier': ['mono', 1, 1, 1.133], 'liberation mono': ['mono', 1, 1, 1.133], 'cousine': ['mono', 1, 1, 1.133],
  'roboto mono': ['mono', 1, 1, 1.319], 'source code pro': ['mono', 1, 1, 1.257], 'consolas': ['mono', 0.916, 1, 1.171],
  'inconsolata': ['mono', 0.833, 1, 1.049], 'lucida console': ['mono', 1.005, 1, 1.0], 'menlo': ['mono', 1.003, 1, 1.164],
  'monaco': ['mono', 1, 1, 1.33], 'dejavu sans mono': ['mono', 1.003, 1, 1.164], 'fira code': ['mono', 1, 1, 1.32],
};

const FREQ = 'e e e a a s s i i t t n n r r u l o d c p m  e a s i t n r u l o   ';
const _fonts = new Map();

/** Métriques d'une police d'après son nom (les variantes « Light », « Narrow »… sont ramenées à leur famille). */
export function fontOf(name) {
  const raw = String(name || '').toLowerCase().replace(/["']/g, '').replace(/\s+/g, ' ').trim();
  const hit = _fonts.get(raw);
  if (hit) return hit;
  let def = FAMILIES[raw];
  let narrow = 1;
  if (!def) {
    let k = raw.replace(/,.*$/, '').trim();
    def = FAMILIES[k];
    if (!def) {
      if (/\b(narrow|condensed|cond|compressed)\b/.test(k)) narrow = 0.84;
      k = k.replace(/[-_]/g, ' ')
        .replace(/\b(light|semilight|semibold|demibold|demi|medium|regular|book|thin|extralight|extrabold|black|heavy|bold|italic|oblique|narrow|condensed|cond|compressed|roman|pro|std|mt|ps|psmt|lt|nova)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
      def = FAMILIES[k];
    }
    if (!def) {
      if (/mono|courier|consol|typewriter|terminal|\bcode\b/.test(raw)) def = ['mono', 1, 1, 1.17];
      else if ((/serif/.test(raw) && !/sans/.test(raw)) || /roman|garamond|antiqua|caslon|baskerville|bodoni|minion|palat|schoolbook|times|didot|jenson|sabon|goudy|libert/.test(raw)) def = ['times', 1.05, 1.06, 1.2];
      else def = ['arial', 1, 1.06, 1.2];
    }
  }
  const [key, scale, bold, lh] = def;
  const k = (scale * narrow) / 1000;
  const f = { bold, lh, mono: 0, a: null, s: null, avg: 0, x: new Map() };
  if (key === 'mono') {
    f.mono = 600 * k;
    f.avg = f.mono;
  } else {
    const t = TABLES[key];
    f.a = t[0].map(v => v * k);
    f.s = t[1].map(v => v * k);
    let sum = 0;
    for (let i = 0; i < FREQ.length; i++) sum += f.a[FREQ.charCodeAt(i) - 32];
    f.avg = sum / FREQ.length;
  }
  _fonts.set(raw, f);
  return f;
}

const isCJK = c => (c >= 0x2E80 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFF60) || c >= 0x20000;

function otherWidth(f, c) {
  if (c === 0xA0) return f.mono || f.a[0];                              // espace insécable
  if (c === 0x202F || c === 0x2009) return (f.mono || f.a[0]) * 0.6;    // espace fine
  if (c === 0xAD || (c >= 0x200B && c <= 0x200F) || c === 0xFEFF || c === 0x2060 || (c >= 0x300 && c <= 0x36F)) return 0;
  if (isCJK(c)) return 1;
  if (f.mono) return f.mono;
  const ch = String.fromCodePoint(c);
  const i = SPECIALS.indexOf(ch);
  if (i >= 0) return f.s[i];
  const base = ch.normalize('NFD').codePointAt(0);                      // lettre accentuée : la chasse de la lettre nue
  if (base !== c && base >= 32 && base < 127) return f.a[base - 32];
  return f.avg;
}

/** Chasse d'un caractère (code Unicode), en cadratins. */
function cw(f, c) {
  if (c < 127) return c < 32 ? 0 : (f.mono || f.a[c - 32]);
  let w = f.x.get(c);
  if (w === undefined) { w = otherWidth(f, c); f.x.set(c, w); }
  return w;
}

/** Largeur d'un texte en points (sert aux tests et aux réglages). */
export function textWidth(text, fontName, size, bold = false) {
  const f = fontOf(fontName);
  let w = 0;
  for (const ch of String(text)) w += cw(f, ch.codePointAt(0));
  return w * size * (bold ? f.bold : 1);
}

/* ------------------------------------------------------------
   UN PARAGRAPHE → SES LIGNES
   items : passages de texte { x, f, z, b } et évènements { k }
     'br'  retour à la ligne          'pb' saut de page
     'mk'  début de page relevé par Word (lastRenderedPageBreak)
     'fn'  appel de note (n = rang de la note dans le paragraphe)
     'img' image dans le texte { w, h }      'tab' tabulation
   Renvoie { h: [hauteur de chaque ligne], ev: [[ligne, type, n]] } ;
   un évènement de ligne L survient avant la ligne L (L = h.length : après la dernière).
------------------------------------------------------------ */
const TAB = 36;

export function breakLines(items, w1, w, o = {}) {
  const rule = o.rule || 0;                 // 0 : interligne multiple, 1 : exact, 2 : au moins
  const v = o.v || 1;
  const markH = o.markH || 13;              // hauteur de ligne d'un paragraphe vide
  const legacy = !!o.legacy;
  // Anciens documents Google Docs (créés avant fin 2020) : 1,2 fois le corps, arrondi au pixel d'écran, quelle que soit la police
  const lineOf = fh => (rule === 1 ? v : rule === 2 ? Math.max(v, fh) : legacy ? Math.round((fh * v) / 0.75) * 0.75 : fh * v);
  const h = [];
  const ev = [];
  let limit = Math.max(20, w1);
  const rest = Math.max(20, w);
  let x = 0;          // largeur posée sur la ligne en cours
  let lh = 0;         // plus grande hauteur de police de la ligne
  let img = 0;        // plus grande image de la ligne
  let any = false;    // la ligne contient quelque chose
  let ww = 0;         // mot en cours
  let wh = 0;
  let wimg = 0;
  let sp = 0;         // espaces en attente
  let lastFh = markH;
  let lastZ = o.markZ || 11;
  const before = [];  // évènements à rattacher au prochain mot
  const after = [];   // évènements à rattacher au mot en cours
  let pbTail = -1;    // saut de page sans rien après lui

  const endLine = () => {
    let t = lineOf(lh || lastFh);
    if (img > 0 && rule !== 1) {
      // Image dans le texte. Word la traite comme un grand caractère : l'interligne multiple s'y applique aussi.
      // Google Docs la pose sur la ligne de base : elle remplace la partie haute de la ligne de texte.
      t = Math.max(t, o.imgAdd ? img + Math.max(0, t - 0.82 * lastZ) : rule === 0 ? (img + 1) * v : img + 2);
    }
    h.push(t);
    x = 0; lh = 0; img = 0; any = false; sp = 0; limit = rest;
  };
  const commit = () => {
    if (ww > 0 || wimg > 0) {
      if (any && x + sp + ww > limit + 0.01) endLine();
      else x += sp;
      sp = 0;
      while (ww > limit + 0.01) {             // mot plus long que la ligne : coupé où il peut
        if (any) endLine();
        h.push(lineOf(wh || lastFh));
        ww -= limit;
        limit = rest;
      }
      x += ww;
      any = true;
      if (wh > lh) lh = wh;
      if (wimg > img) img = wimg;
      ww = 0; wh = 0; wimg = 0;
      pbTail = -1;
      for (const e of before) ev.push([h.length, e[0], e[1]]);
      before.length = 0;
    }
    for (const e of after) ev.push([h.length, e[0], e[1]]);
    after.length = 0;
  };

  for (const it of items) {
    if (it.k) {
      switch (it.k) {
        case 'br': commit(); if (!lh) lh = lastFh; endLine(); break;
        case 'pb':
        case 'cb':
          commit();
          if (any) endLine();
          ev.push([h.length, 'pb', 0]);
          pbTail = ev.length - 1;
          break;
        case 'mk': commit(); before.push(['mk', 0]); break;
        case 'fn': after.push(['fn', it.n]); break;
        case 'img': {
          // L'image suit le corps du passage qui la contient (pas celui de la marque de paragraphe)
          commit();
          if (it.z) { lastZ = it.z; lastFh = it.z * (legacy ? 1.2 : fontOf(it.f).lh); }
          ww = Math.min(it.w, rest); wimg = it.h; wh = lastFh;
          commit();
          break;
        }
        case 'tab': commit(); x = (Math.floor((x + sp) / TAB + 1e-6) + 1) * TAB; sp = 0; any = true; if (!lh) lh = lastFh; pbTail = -1; break;
        default: break;
      }
      continue;
    }
    const f = fontOf(it.f);
    const k = it.z * (it.b ? f.bold : 1);
    const fh = it.z * (legacy ? 1.2 : f.lh);
    lastFh = fh;
    lastZ = it.z;
    const s = it.x;
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xD800 && c <= 0xDBFF && i + 1 < s.length) { c = s.codePointAt(i); i++; }
      if (c === 32 || c === 10 || c === 13) { commit(); sp += cw(f, 32) * k; continue; }
      if (c === 9) { commit(); x = (Math.floor((x + sp) / TAB + 1e-6) + 1) * TAB; sp = 0; any = true; if (fh > lh) lh = fh; continue; }
      if (c > 0x2E7F && isCJK(c)) { commit(); ww = k; wh = fh; commit(); continue; }
      ww += cw(f, c) * k;
      if (fh > wh) wh = fh;
      if (c === 45 || c === 0x2010) commit();   // on peut couper après un trait d'union
    }
  }
  commit();
  for (const e of before) ev.push([h.length, e[0], e[1]]);
  if (any || h.length === 0) {
    // Paragraphe réduit à un saut de page : sa ligne reste sur la page qu'il termine
    const only = pbTail >= 0 && !any && h.length === 0;
    endLine();
    if (only) ev[pbTail][0] = 1;
  }
  return { h, ev };
}

/* ------------------------------------------------------------
   MESURE — chaque bloc reçoit ses hauteurs de ligne
   Blocs en entrée (voir docx.js) :
     { t: 'p', s, hd, r: items, sb, sa, lr, lv, il, ir, fi, num, kn, kl, wc, pb, cs, st, mf, mz, notes: [[blocs]] }
     { t: 'tbl', s, w, rows: [{ min, exact, cant, cells: [{ w, pt, pb, pl, pr, blocks }] }] }
------------------------------------------------------------ */
const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };

function stackHeight(ms) {
  let t = 0;
  for (const m of ms) t += m.t === 'p' ? m.sb + m.tot + m.sa : sum(m.rows.map(r => r.h));
  return t;
}

function measureBlock(b, width, opt) {
  if (b.t === 'tbl') {
    let tw = Math.min(b.w || width, Math.max(width, 100) * 1.3);
    // Tableau « ajusté au contenu » dont le fichier ne donne aucune largeur crédible (colonnes de quelques points) :
    // chaque colonne prend la largeur de son texte le plus long, le tout ramené à la largeur disponible s'il déborde.
    let auto = null;
    const ncol = b.rows.reduce((a, r) => Math.max(a, r.cells.length), 0);
    const first = b.rows[0] ? b.rows[0].cells.reduce((a, c) => a + (c.w || 0), 0) : 0;
    if (!b.fixed && ncol > 0 && first < width * 0.3 && b.rows.every(r => r.cells.length === ncol)) {
      const nat = new Array(ncol).fill(0);
      for (const r of b.rows) {
        r.cells.forEach((c, j) => {
          for (const x of c.blocks) {
            if (x.t !== 'p') continue;
            let wsum = (c.pl || 0) + (c.pr || 0) + 1;
            for (const it of x.r) {
              if (it.x) { const f = fontOf(it.f); let s = 0; for (let i = 0; i < it.x.length; i++) s += cw(f, it.x.charCodeAt(i)); wsum += s * it.z * (it.b ? f.bold : 1); }
              else if (it.k === 'img') wsum += it.w;
            }
            if (wsum > nat[j]) nat[j] = wsum;
          }
        });
      }
      const need = nat.reduce((a, x) => a + x, 0);
      const k = need > width ? width / need : 1;
      auto = nat.map(x => Math.max(24, x * k));
      tw = Math.min(width, need);
    }
    const rows = b.rows.map(r => {
      let hmax = 0;
      let mk = 0;
      const hd = [];
      const n = r.cells.length || 1;
      let given = 0;
      for (const c of r.cells) given += c.w || 0;
      const widths = auto || (given > tw * 1.05 ? r.cells.map(c => ((c.w || given / n) * tw) / given) : null);
      for (let ci = 0; ci < r.cells.length; ci++) {
        const c = r.cells[ci];
        const cwid = widths ? widths[ci] : (c.w || tw / n);
        const inner = Math.max(20, cwid - (c.pl || 0) - (c.pr || 0));
        const ms = c.blocks.map(x => measureBlock(x, inner, opt));
        let cmk = 0;
        for (const m of ms) {
          if (m.t === 'p') { for (const e of m.ev) if (e[1] === 'mk') cmk++; if (m.hd !== undefined) hd.push(m.hd); }
          else for (const rr of m.rows) { cmk += rr.mk; hd.push(...rr.hd); }
        }
        if (cmk > mk) mk = cmk;
        const ch = (c.pt || 0) + stackHeight(ms) + (c.pb || 0);
        if (ch > hmax) hmax = ch;
      }
      let hrow = r.exact ? (r.min || hmax) : Math.max(hmax, r.min || 0);
      hrow += opt.rowExtra;
      return { h: hrow, mk, hd, cant: !!r.cant };
    });
    return { t: 'tbl', s: b.s, rows };
  }
  const fi = b.fi || 0;
  const w = Math.max(20, width - (b.il || 0) - (b.ir || 0));
  const w1 = b.num && fi < 0 ? w : w - fi;       // liste : le numéro occupe le retrait négatif
  const markH = (b.mz || 11) * (opt.legacy ? 1.2 : fontOf(b.mf).lh);
  const { h, ev } = breakLines(b.r, w1, w, { rule: b.lr || 0, v: b.lv || 1, markH, markZ: b.mz || 11, legacy: opt.legacy, imgAdd: opt.imgAdd });
  const notes = (b.notes || []).map(nb => stackHeight(nb.map(x => measureBlock(x, width, opt))));
  // Interligne multiple : le supplément se place au-dessus de chaque ligne, sauf en haut de page
  const lead = opt.topLead && !b.lr && (b.lv || 1) > 1 ? 1 - 1 / b.lv : 0;
  return {
    t: 'p', s: b.s, hd: b.hd, h, ev, tot: sum(h), sb: b.sb || 0, sa: b.sa || 0, lead,
    kn: !!b.kn, kl: !!b.kl, wc: b.wc !== false, pb: !!b.pb, cs: !!b.cs, st: b.st || '', notes,
  };
}

/* ------------------------------------------------------------
   SECTIONS — format de page, marges, colonnes
------------------------------------------------------------ */
export const A4 = { w: 595.3, h: 841.9, mt: 70.9, mb: 70.9, ml: 70.9, mr: 70.9, cols: 1, gap: 36, type: '' };

function geometry(sec, opt) {
  const s = { ...A4, ...(sec || {}) };
  const n = Math.max(1, Math.min(4, s.cols || 1));
  const bodyW = Math.max(100, s.w - s.ml - s.mr);
  // Un en-tête (ou un pied de page) plus haut que la marge repousse le texte
  const tall = (blocks, dist) => (blocks && blocks.length ? (dist === undefined ? 35 : dist) + stackHeight(blocks.map(b => measureBlock(b, bodyW, opt))) : 0);
  const mt = Math.min(s.h * 0.4, Math.max(Math.abs(s.mt), tall(s.hdr, s.hd)));
  const mb = Math.min(s.h * 0.4, Math.max(Math.abs(s.mb), tall(s.ftr, s.fd)));
  const bodyH = Math.max(100, s.h - mt - mb);
  return {
    type: s.type || '',
    colW: (bodyW - (n - 1) * (s.gap || 36)) / n,
    H: bodyH * n,                                                  // n colonnes = n fois la hauteur utile
    pageH: s.h, mt, bodyH,
  };
}

/* ------------------------------------------------------------
   SIMULATION — on remplit les pages comme le ferait le traitement de texte
   Renvoie { total, starts: Map(rang du titre → position), ends }
------------------------------------------------------------ */
function simulate(M, geos, opt) {
  const starts = new Map();
  let page = 0;
  let y = 0;
  let foot = 0;       // hauteur des notes déjà réservée en bas de la page
  let carry = 0;      // suite d'une longue note, reportée à la page suivante
  let top = true;     // rien encore sur la page
  let lastSa = 0;
  let cur = 0;
  let g = geos[0];
  const newPage = () => {
    page++; y = 0; top = true; lastSa = 0;
    foot = Math.min(carry, g.H * 0.7);
    carry -= foot;
  };
  const here = () => page + Math.min(1, y / g.H);
  const mark = hd => { if (hd !== undefined && !starts.has(hd)) starts.set(hd, here()); };
  const headLines = m => (m.t === 'tbl' ? (m.rows[0] ? m.rows[0].h : 0) : m.sb + sum(m.h.slice(0, m.wc ? 2 : 1)));

  for (let i = 0; i < M.length; i++) {
    const m = M[i];
    if (m.s !== cur && geos[m.s]) {
      const ng = geos[m.s];
      if (ng.type === 'continuous') y = (y / g.H) * ng.H;
      else {
        if (!(top && page === 0 && y === 0)) newPage();
        if ((ng.type === 'oddPage' && page % 2 === 1) || (ng.type === 'evenPage' && page % 2 === 0)) page++;
      }
      g = ng;
      cur = m.s;
    }
    if (m.t === 'tbl') {
      for (const r of m.rows) {
        let avail = g.H - y - foot;
        if (r.h > avail + 0.5) {
          if (r.cant || r.h < 40 || avail < 30 || r.h <= g.H * 0.2) { if (!top) { newPage(); avail = g.H - foot; } }
        }
        for (const hd of r.hd) mark(hd);
        if (r.h <= avail + 0.5) y += r.h;
        else {                                   // ligne de tableau plus haute que la place : elle se poursuit
          let rem = r.h - Math.max(0, avail);
          newPage();
          while (rem > g.H - foot) { rem -= g.H - foot; newPage(); }
          y = rem;
        }
        top = false;
      }
      lastSa = 0;
      continue;
    }

    const n = m.h.length;
    const fnAt = new Map();
    const pbAt = new Set();
    for (const e of m.ev) {
      if (e[1] === 'fn') fnAt.set(e[0], (fnAt.get(e[0]) || 0) + (m.notes[e[2]] || 0));
      else if (e[1] === 'pb') pbAt.add(e[0]);
    }
    if (m.pb && !(top && page === 0)) { if (!top) newPage(); }

    // Titre solidaire du paragraphe suivant : on vérifie que l'ensemble tient
    if (m.kn && !top && !(i > 0 && M[i - 1].t === 'p' && M[i - 1].kn) && !pbAt.size) {
      let need = m.sb + m.tot + m.sa;
      let j = i + 1;
      while (j < M.length && j < i + 6 && M[j].t === 'p' && M[j].kn && !M[j].ev.some(e => e[1] === 'pb')) { need += M[j].sb + M[j].tot + M[j].sa; j++; }
      if (j < M.length && !(M[j].t === 'p' && M[j].pb)) need += headLines(M[j]);
      if (y + need > g.H - foot + 0.5 && need <= g.H * 0.9) newPage();
    }

    let sb = top ? 0 : m.sb;
    if (m.cs && i > 0 && M[i - 1].t === 'p' && M[i - 1].cs && M[i - 1].st === m.st) { y -= lastSa; sb = 0; }
    let L = 0;
    let first = true;
    let guard = 0;
    while (L < n && guard++ < 10000) {
      if (pbAt.has(L) && !(L === 0 && top && page === 0)) { newPage(); sb = 0; }
      let stop = n;
      for (const p of pbAt) if (p > L && p < stop) stop = p;
      const shrink = top ? m.h[L] * m.lead : 0;        // première ligne de la page : sans le supplément d'interligne
      const avail = g.H - y - foot - (first ? sb : 0) + shrink;
      let k = 0;
      let used = 0;
      let f = 0;          // notes posées avec ces lignes
      let fcarry = 0;
      while (L + k < stop) {
        const lf = fnAt.get(L + k) || 0;
        const sep = lf && !foot && !f ? opt.noteSep : 0;
        const min = m.h[L + k] + (lf ? sep + Math.min(lf, opt.noteMin) : 0);
        if (used + min > avail + 0.5) break;
        const room = avail - used - m.h[L + k] - sep;
        const put = Math.min(lf, Math.max(0, room));     // une longue note se poursuit page suivante
        used += m.h[L + k];
        f += put + sep;
        fcarry += lf - put;
        used += put + sep;
        k++;
        if (fcarry > 0) break;
      }
      const left = stop - (L + k);
      if (left > 0 && !fcarry) {
        if (m.kl && first && !top && sum(m.h.slice(L, stop)) <= g.H * 0.9) k = 0;
        else if (m.wc) {
          if (k === 1) k = 0;                              // pas de ligne seule en bas de page
          else if (left === 1) k = k >= 3 ? k - 1 : 0;     // ni en haut de la suivante
        }
        if (k === 0 && top) k = 1;                         // page vide : on avance quoi qu'il arrive
      }
      if (k > 0) {
        if (first) { y += sb; mark(m.hd); first = false; }
        let hh = 0;
        let ff = 0;
        for (let q = 0; q < k; q++) {
          hh += m.h[L + q];
          const lf = fnAt.get(L + q) || 0;
          if (lf) { ff += lf; }
        }
        y += hh - shrink;
        if (ff) {
          const sep = foot ? 0 : opt.noteSep;
          const room = Math.max(0, g.H - y - foot - sep);
          const put = Math.min(ff, room);
          foot += put + sep;
          carry += ff - put;
        }
        top = false;
        L += k;
      }
      if (L < stop) { newPage(); sb = 0; }
    }
    if (first) mark(m.hd);
    if (pbAt.has(n)) newPage();
    else { y += m.sa; lastSa = m.sa; }
  }
  return { total: page + 1, starts, last: here() };
}

/* ------------------------------------------------------------
   PAGINATION RÉELLE — repères de saut de page laissés par Word
   Chaque repère marque le début d'une page telle que Word l'a
   rendue à l'enregistrement. On compte les repères, et la position
   dans la page est donnée par les hauteurs estimées.
------------------------------------------------------------ */
function byMarkers(M, geos) {
  const heads = [];       // [rang du titre, page, hauteur depuis le haut de page]
  const fill = [];        // hauteur de contenu de chaque page
  const cap = [];         // hauteur utile de chaque page
  let page = 0;
  let u = 0;
  let cur = 0;
  let g = geos[0];
  let odd = 0;            // pages blanches qu'ajouterait un saut « page impaire » / « page paire »
  const turn = () => { fill[page] = u; cap[page] = g.H; page++; u = 0; };
  for (const m of M) {
    if (m.s !== cur && geos[m.s]) {
      g = geos[m.s];
      cur = m.s;
      if (g.type === 'oddPage' || g.type === 'evenPage') odd++;
    }
    if (m.t === 'tbl') {
      for (const r of m.rows) {
        for (let q = 0; q < r.mk; q++) turn();
        for (const hd of r.hd) heads.push([hd, page, u]);
        u += r.h;
      }
      continue;
    }
    const mk = m.ev.filter(e => e[1] === 'mk').map(e => e[0]);
    let L = 0;
    let started = false;
    const start = () => { if (!started) { started = true; if (u > 0) u += m.sb; if (m.hd !== undefined) heads.push([m.hd, page, u]); } };
    for (const at of mk) {
      const upto = Math.min(at, m.h.length);
      if (upto > L) { start(); for (; L < upto; L++) u += m.h[L]; }
      turn();
    }
    start();
    for (; L < m.h.length; L++) u += m.h[L];
    u += m.sa;
  }
  fill[page] = u;
  cap[page] = g.H;
  const starts = new Map();
  for (const [hd, p, at] of heads) {
    if (!starts.has(hd)) starts.set(hd, p + Math.min(0.98, at / Math.max(fill[p], cap[p], 1)));
  }
  return { total: page + 1, starts, markers: page, odd };
}

/* ------------------------------------------------------------
   PDF — nombre de pages et position de chaque titre (signets)
   Lecture minimale : table des objets, arbre des pages, plan du
   document (/Outlines). C'est ce que produit « Télécharger en PDF »
   de Google Docs, dont les signets reprennent les titres.
------------------------------------------------------------ */
function latin1(u8, a, b) {
  let s = '';
  const end = Math.min(b, u8.length);
  for (let i = Math.max(0, a); i < end; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(end, i + 8192)));
  return s;
}

function pdfOffsets(u8) {
  const off = new Map();
  const tail = latin1(u8, u8.length - 2048, u8.length);
  const sx = tail.lastIndexOf('startxref');
  let at = sx >= 0 ? parseInt(tail.slice(sx + 9), 10) : NaN;
  let root = 0;
  const seen = new Set();
  while (Number.isFinite(at) && at > 0 && at < u8.length && !seen.has(at) && seen.size < 50) {
    seen.add(at);
    const headTxt = latin1(u8, at, at + 20);
    if (!/^\s*xref/.test(headTxt)) break;                 // table compressée (PDF 1.5) : on passera par le balayage
    let p = at + headTxt.indexOf('xref') + 4;
    let trailer = '';
    for (;;) {
      const line = latin1(u8, p, p + 40);
      const m = /^\s*(\d+)\s+(\d+)\s*/.exec(line);
      if (!m) { trailer = latin1(u8, p, p + 4096); break; }
      p += m[0].length;
      const first = +m[1];
      const count = +m[2];
      const block = latin1(u8, p, p + count * 20);
      for (let i = 0; i < count; i++) {
        const e = block.substr(i * 20, 18);
        if (e[17] === 'n' && !off.has(first + i)) off.set(first + i, parseInt(e.slice(0, 10), 10));
      }
      p += count * 20;
    }
    const r = /\/Root\s+(\d+)\s+\d+\s+R/.exec(trailer);
    if (r && !root) root = +r[1];
    const prev = /\/Prev\s+(\d+)/.exec(trailer);
    at = prev ? +prev[1] : NaN;
  }
  if (!off.size || !root) {
    // Balayage : « n g obj » en début de ligne
    off.clear();
    for (let i = 0; i + 3 < u8.length; i++) {
      if (u8[i] !== 0x6F || u8[i + 1] !== 0x62 || u8[i + 2] !== 0x6A) continue;      // « obj »
      let j = i - 1;
      if (u8[j] !== 0x20) continue;
      j--;
      while (j >= 0 && u8[j] >= 0x30 && u8[j] <= 0x39) j--;
      if (u8[j] !== 0x20) continue;
      const e = j;
      j--;
      while (j >= 0 && u8[j] >= 0x30 && u8[j] <= 0x39) j--;
      if (j >= 0 && u8[j] !== 0x0A && u8[j] !== 0x0D && u8[j] !== 0x20) continue;
      if (e - j - 1 < 1) continue;
      off.set(parseInt(latin1(u8, j + 1, e), 10), j + 1);
    }
    const t = latin1(u8, u8.length - 4096, u8.length);
    const r = /\/Root\s+(\d+)\s+\d+\s+R/.exec(t);
    root = r ? +r[1] : 0;
  }
  return { off, root };
}

/** Chaîne PDF commençant à l'index i de s : « (…) » ou « <…> ». Renvoie le texte décodé. */
function pdfString(s, i) {
  const bytes = [];
  if (s[i] === '(') {
    let depth = 1;
    for (i++; i < s.length && depth > 0; i++) {
      const c = s[i];
      if (c === '\\') {
        const n = s[++i];
        const esc = { n: 10, r: 13, t: 9, b: 8, f: 12 }[n];
        if (esc !== undefined) bytes.push(esc);
        else if (n >= '0' && n <= '7') {
          let o = n;
          while (o.length < 3 && s[i + 1] >= '0' && s[i + 1] <= '7') o += s[++i];
          bytes.push(parseInt(o, 8) & 255);
        } else if (n === '\n' || n === '\r') { if (n === '\r' && s[i + 1] === '\n') i++; }
        else if (n !== undefined) bytes.push(n.charCodeAt(0));
      } else if (c === '(') { depth++; bytes.push(40); }
      else if (c === ')') { depth--; if (depth > 0) bytes.push(41); }
      else bytes.push(c.charCodeAt(0) & 255);
    }
  } else if (s[i] === '<') {
    const end = s.indexOf('>', i);
    const hex = s.slice(i + 1, end < 0 ? s.length : end).replace(/[^0-9a-fA-F]/g, '');
    for (let k = 0; k + 1 < hex.length; k += 2) bytes.push(parseInt(hex.substr(k, 2), 16));
  }
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) {
    let out = '';
    for (let k = 2; k + 1 < bytes.length; k += 2) out += String.fromCharCode((bytes[k] << 8) | bytes[k + 1]);
    return out;
  }
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes.slice(3))); } catch { /* on garde les octets */ }
  }
  return String.fromCharCode.apply(null, bytes);
}

/**
 * Lit un PDF (Uint8Array). Renvoie { pages, sizes: [[largeur, hauteur]], outline: [{ title, level, page, y }] }
 * (y = distance depuis le haut de la page, en points ; null si le signet ne la donne pas), ou null si illisible.
 */
export function readPdf(u8) {
  if (!u8 || u8.length < 64 || latin1(u8, 0, 5) !== '%PDF-') return null;
  const { off, root } = pdfOffsets(u8);
  if (!root || !off.has(root)) return null;
  const cache = new Map();
  const obj = n => {
    if (cache.has(n)) return cache.get(n);
    let s = '';
    const at = off.get(n);
    if (at !== undefined) {
      s = latin1(u8, at, at + 16384);
      const e = /endobj|stream[\r\n]/.exec(s);
      if (e) s = s.slice(0, e.index);
    }
    cache.set(n, s);
    return s;
  };
  const ref = (s, key) => { const m = new RegExp('/' + key + '\\s+(\\d+)\\s+\\d+\\s+R').exec(s); return m ? +m[1] : 0; };
  const cat = obj(root);

  // Arbre des pages
  const pageIndex = new Map();
  const sizes = [];
  const walk = (n, box, depth) => {
    if (depth > 60 || pageIndex.size > 100000) return;
    const s = obj(n);
    if (!s) return;
    const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(s);
    const b = mb ? [parseFloat(mb[3]) - parseFloat(mb[1]), parseFloat(mb[4]) - parseFloat(mb[2])] : box;
    const kids = /\/Kids\s*\[([^\]]*)\]/.exec(s);
    if (kids) {
      const re = /(\d+)\s+\d+\s+R/g;
      let m;
      while ((m = re.exec(kids[1]))) walk(+m[1], b, depth + 1);
    } else if (/\/Type\s*\/Page(?![a-zA-Z])/.test(s)) {
      pageIndex.set(n, sizes.length);
      sizes.push(b || [595.3, 841.9]);
    }
  };
  walk(ref(cat, 'Pages'), null, 0);
  if (!sizes.length) return null;

  // Plan du document
  const outline = [];
  const visited = new Set();
  const item = (n, level) => {
    while (n && !visited.has(n) && visited.size < 20000) {
      visited.add(n);
      const s = obj(n);
      if (!s) break;
      const ti = s.indexOf('/Title');
      let title = '';
      if (ti >= 0) {
        let k = ti + 6;
        while (k < s.length && /\s/.test(s[k])) k++;
        title = pdfString(s, k);
      }
      const d = /\/(?:Dest|D)\s*\[\s*(\d+)\s+\d+\s+R\s*\/(\w+)([^\]]*)\]/.exec(ti >= 0 ? s.slice(0, ti) + s.slice(ti).replace(/^\/Title\s*(\((?:\\.|[^\\)])*\)|<[^>]*>)/, '') : s);
      if (d && pageIndex.has(+d[1])) {
        const pg = pageIndex.get(+d[1]);
        const nums = (d[3].match(/-?[\d.]+|null/g) || []).map(v => (v === 'null' ? null : parseFloat(v)));
        const topY = d[2] === 'XYZ' ? nums[1] : (d[2] === 'FitH' || d[2] === 'FitBH') ? nums[0] : null;
        const ph = sizes[pg][1];
        outline.push({ title: title.replace(/\s+/g, ' ').trim(), level, page: pg, y: topY === null || topY === undefined ? null : Math.max(0, Math.min(ph, ph - topY)) });
      }
      const kid = ref(s, 'First');
      if (kid && level < 12) item(kid, level + 1);
      n = ref(s, 'Next');
    }
  };
  const ol = ref(cat, 'Outlines');
  if (ol) item(ref(obj(ol), 'First'), 1);
  return { pages: sizes.length, sizes, outline };
}

const normTitle = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * Rapproche les titres du document (dans l'ordre) des signets du PDF (dans l'ordre).
 * Renvoie pour chaque titre le rang du signet correspondant, ou -1.
 */
export function alignTitles(titles, marks) {
  const a = titles.map(normTitle);
  const b = marks.map(m => normTitle(m.title));
  const same = (x, y) => !!x && !!y && (x === y || (y.length >= 4 && x.startsWith(y + ' ')) || (x.length >= 4 && y.startsWith(x + ' ')));
  const out = new Array(a.length).fill(-1);
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    for (let k = j; k < b.length && k < j + 40; k++) {
      if (same(a[i], b[k])) { out[i] = k; j = k + 1; break; }
    }
  }
  return out;
}

/* ------------------------------------------------------------
   POINT D'ENTRÉE
   layout : { sections, blocks, gen, pagesMeta }  (docx.js)
   count  : nombre de titres (segments)
   opts.pdf : résultat de readPdf, opts.titles : titres des segments
   Renvoie { total, starts: [position de chaque titre], source, sim }
     source : 'pdf'    pagination de Google Docs (PDF)
              'word'   repères de saut de page de Word
              'meta'   total donné par le fichier, répartition simulée
              'layout' simulation de la mise en page
------------------------------------------------------------ */
// Réglages propres au logiciel qui a produit le fichier : filet des notes, bordures de tableau, images dans le texte
const PROFILES = {
  gdocs: { noteSep: 12, noteMin: 14, rowExtra: 1, legacy: false, imgAdd: true, topLead: false },
  word: { noteSep: 14, noteMin: 14, rowExtra: 0.5, legacy: false, imgAdd: false, topLead: true },
  other: { noteSep: 6, noteMin: 12, rowExtra: 0.5, legacy: false, imgAdd: true, topLead: true },     // LibreOffice et les autres
};

export function paginate(layout, count, opts = {}) {
  const opt = { ...(PROFILES[layout.gen] || PROFILES.other), ...(opts.tune || {}) };
  const geos = (layout.sections && layout.sections.length ? layout.sections : [A4]).map(s => geometry(s, opt));
  const M = layout.blocks.map(b => measureBlock(b, (geos[b.s] || geos[0]).colW, opt));
  const sim = simulate(M, geos, opt);
  const list = (res, scale = 1) => {
    const out = [];
    let prev = 0;
    for (let i = 0; i < count; i++) {
      let v = res.starts.has(i) ? res.starts.get(i) * scale : prev;
      if (v < prev) v = prev;
      out.push(v);
      prev = v;
    }
    return out;
  };

  // 1. PDF de Google Docs : pages exactes, titres situés par les signets
  const pdf = opts.pdf;
  if (pdf && pdf.pages > 0) {
    const total = pdf.pages;
    const simStarts = list(sim, total / sim.total);
    const idx = alignTitles(opts.titles || [], pdf.outline || []);
    const g0 = geos[0];
    const starts = [];
    let matched = 0;
    for (let i = 0; i < count; i++) {
      const k = idx[i] === undefined ? -1 : idx[i];
      if (k >= 0) {
        const mk = pdf.outline[k];
        const frac = mk.y === null ? 0 : Math.max(0, Math.min(0.999, (mk.y - g0.mt) / g0.bodyH));
        starts.push(mk.page + frac);
        matched++;
      } else starts.push(null);
    }
    // Titres sans signet : placés entre leurs voisins, au prorata de la simulation
    for (let i = 0; i < count; i++) {
      if (starts[i] !== null) continue;
      let a = i - 1;
      while (a >= 0 && starts[a] === null) a--;
      let b = i + 1;
      while (b < count && starts[b] === null) b++;
      const pa = a >= 0 ? starts[a] : 0;
      const pb = b < count ? starts[b] : total;
      const sa = a >= 0 ? simStarts[a] : 0;
      const sbb = b < count ? simStarts[b] : total;
      const t = sbb > sa ? (simStarts[i] - sa) / (sbb - sa) : 0;
      starts[i] = pa + (pb - pa) * Math.max(0, Math.min(1, t));
    }
    for (let i = 1; i < count; i++) if (starts[i] < starts[i - 1]) starts[i] = starts[i - 1];
    return { total, starts, source: 'pdf', sim: sim.total, matched };
  }

  // 2. Repères de Word
  const meta = layout.pagesMeta || 0;
  const mk = byMarkers(M, geos);
  if (mk.markers >= 1) {
    const total = mk.total;
    const okMeta = !meta || Math.abs(meta - total) <= Math.max(1, mk.odd + 1, total * 0.04);
    const okSim = total >= sim.total * 0.6 && total <= sim.total * 1.6;
    if (okMeta || okSim) return { total, starts: list(mk), source: 'word', sim: sim.total, meta };
  }

  // 3. Total donné par le fichier (LibreOffice, Word sans repères)
  if (meta >= 2 && meta >= sim.total * 0.6 && meta <= sim.total * 1.6) {
    return { total: meta, starts: list(sim, meta / sim.total), source: 'meta', sim: sim.total, meta };
  }

  // 4. Simulation seule
  return { total: sim.total, starts: list(sim), source: 'layout', sim: sim.total, meta };
}

/** Longueur de chaque partie d'après les positions de leurs titres. */
export function spans(starts, total) {
  const out = [];
  for (let i = 0; i < starts.length; i++) out.push(Math.max(0, (i + 1 < starts.length ? starts[i + 1] : total) - starts[i]));
  return { front: starts.length ? Math.max(0, starts[0]) : total, pages: out };
}

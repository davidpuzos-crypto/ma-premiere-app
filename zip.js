/* ============================================================
   ARCHIVES ZIP — lecture minimale, sans bibliothèque
   Un .docx, un .odt, un projet LaTeX téléchargé depuis Overleaf
   sont des archives zip. On lit leur répertoire central, puis on
   décompresse seulement les fichiers demandés avec le décodeur du
   navigateur (DecompressionStream). Rien n'est chargé depuis
   l'extérieur : la synchro fonctionne aussi hors ligne.

   openZip(tampon) renvoie :
     names            noms des fichiers de l'archive
     has(nom)         présent ?
     size(nom)        taille décompressée (octets), ou -1
     bytes(nom)       Promise<Uint8Array | null>
     text(nom)        Promise<string | null>   (UTF-8, ou UTF-16 avec marque d'ordre)
   Logique pure, testée dans tests/core.test.mjs.
============================================================ */

export class ZipError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Le navigateur sait-il décompresser seul ? (Chrome 103, Firefox 113, Safari 16.4) */
export function canInflate() {
  const DS = globalThis.DecompressionStream;
  if (typeof DS !== 'function' || typeof Response !== 'function' || typeof Blob !== 'function') return false;
  try { new DS('deflate-raw'); return true; } catch { return false; }
}

async function inflateRaw(u8) {
  const stream = new Blob([u8]).stream().pipeThrough(new globalThis.DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const u16 = (b, i) => b[i] | (b[i + 1] << 8);
const u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const u64 = (b, i) => u32(b, i) + u32(b, i + 4) * 4294967296;

function decodeName(bytes, utf8Flag) {
  // Beaucoup d'outils écrivent de l'UTF-8 sans le signaler : on l'essaie d'abord
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { /* pas de l'UTF-8 */ }
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try { return new TextDecoder('windows-1252').decode(bytes); } catch { return String.fromCharCode.apply(null, bytes); }
}

export function decodeBytes(u8) {
  if (!u8) return null;
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
  if (u8.length >= 2 && u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
  return new TextDecoder('utf-8').decode(u8);
}

/**
 * Ouvre une archive (ArrayBuffer ou Uint8Array).
 * Lève ZipError('not-zip') si ce n'en est pas une, ZipError('zip-crypt') si elle est chiffrée (à la lecture d'une entrée).
 */
export function openZip(input) {
  const b = input instanceof Uint8Array ? input : new Uint8Array(input);
  const n = b.length;
  if (n < 22) throw new ZipError('not-zip');

  // Fin du répertoire central : en fin de fichier, éventuellement suivie d'un commentaire
  let eocd = -1;
  for (let i = n - 22, stop = Math.max(0, n - 22 - 65535); i >= stop; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4B && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('not-zip');
  let count = u16(b, eocd + 10);
  let cdSize = u32(b, eocd + 12);
  let cdAt = u32(b, eocd + 16);
  if (count === 0xFFFF || cdAt === 0xFFFFFFFF || cdSize === 0xFFFFFFFF) {
    // Zip64 : le localisateur précède la fin du répertoire
    const loc = eocd - 20;
    if (loc >= 0 && u32(b, loc) === 0x07064B50) {
      const at = u64(b, loc + 8);
      if (at + 56 <= n && u32(b, at) === 0x06064B50) {
        count = u64(b, at + 32);
        cdSize = u64(b, at + 40);
        cdAt = u64(b, at + 48);
      }
    }
  }
  if (cdAt + cdSize > n) throw new ZipError('not-zip');

  const entries = new Map();
  let p = cdAt;
  for (let k = 0; k < count && p + 46 <= n; k++) {
    if (u32(b, p) !== 0x02014B50) break;
    const flags = u16(b, p + 8);
    const method = u16(b, p + 10);
    let csize = u32(b, p + 20);
    let usize = u32(b, p + 24);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    let at = u32(b, p + 42);
    const name = decodeName(b.subarray(p + 46, p + 46 + nameLen), !!(flags & 0x800));
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF || at === 0xFFFFFFFF) {
      // Champ supplémentaire Zip64 : les valeurs débordées, dans l'ordre
      let x = p + 46 + nameLen;
      const end = x + extraLen;
      while (x + 4 <= end) {
        const id = u16(b, x);
        const len = u16(b, x + 2);
        if (id === 1) {
          let y = x + 4;
          if (usize === 0xFFFFFFFF && y + 8 <= end) { usize = u64(b, y); y += 8; }
          if (csize === 0xFFFFFFFF && y + 8 <= end) { csize = u64(b, y); y += 8; }
          if (at === 0xFFFFFFFF && y + 8 <= end) at = u64(b, y);
          break;
        }
        x += 4 + len;
      }
    }
    if (name && !name.endsWith('/')) entries.set(name, { flags, method, csize, usize, at });
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (!entries.size) throw new ZipError('not-zip');

  const bytes = async name => {
    const e = entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new ZipError('zip-crypt');
    if (e.at + 30 > n || u32(b, e.at) !== 0x04034B50) throw new ZipError('not-zip');
    const start = e.at + 30 + u16(b, e.at + 26) + u16(b, e.at + 28);
    if (start + e.csize > n) throw new ZipError('not-zip');
    const data = b.subarray(start, start + e.csize);
    if (e.method === 0) return data.slice();
    if (e.method !== 8) throw new ZipError('zip-method');
    try { return await inflateRaw(data); } catch { throw new ZipError('not-zip'); }
  };

  return {
    names: [...entries.keys()],
    has: name => entries.has(name),
    size: name => (entries.has(name) ? entries.get(name).usize : -1),
    bytes,
    text: async name => decodeBytes(await bytes(name)),
  };
}

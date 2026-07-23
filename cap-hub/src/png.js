// Mini boîte à outils PNG en pur Node (zéro dépendance) :
// - encodePNG(w, h, rgba)  : encode un buffer RGBA en PNG (utilisé pour les capes intégrées + l'icône)
// - readPngSize(buf)       : lit la taille d'un PNG sans le décoder (validation des imports)
// - isPng(buf)             : vérifie la signature PNG
import zlib from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

export function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // 8 bits/canal
  ihdr[9] = 6;  // RGBA
  // Filtre 0 (None) au début de chaque scanline.
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

export function isPng(buf) {
  return Buffer.isBuffer(buf) && buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIG);
}

// Taille lue directement dans le chunk IHDR (toujours le premier après la signature).
export function readPngSize(buf) {
  if (!isPng(buf)) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

// ---------- Décodage (pour extraire la 1re image d'une cape animée) ----------
// Décode un PNG 8 bits, non entrelacé (types 0/2/3/4/6) en RGBA. Renvoie
// { width, height, rgba } ou null si non pris en charge (bit depth ≠ 8, entrelacé).
export function decodePNG(buf) {
  if (!isPng(buf)) return null;
  let pos = 8, width = 0, height = 0, colorType = 0, bitDepth = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString('ascii', pos + 4, pos + 8);
    // Longueur de chunk hors limites (PNG corrompu/malveillant) -> on abandonne proprement.
    if (pos + 12 + len > buf.length) return null;
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      if (len < 13) return null;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(Buffer.from(data));
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (bitDepth !== 8 || interlace !== 0 || !width || !height) return null;
  // Anti-bombe de décompression : un IDAT minuscule peut prétendre décompresser vers des
  // Go (surtout via une cape du registre, dont les dimensions ne sont pas pré-validées).
  // On borne la surface décodée ET la sortie de l'inflate. MAX_PIXELS couvre largement
  // une cape 4K même animée, mais rejette toute dimension déraisonnable.
  const MAX_PIXELS = 8192 * 4096; // ~33,5 Mpx
  if (width * height > MAX_PIXELS) return null;
  const CH = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!CH) return null;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: MAX_PIXELS * 5 }); } catch { return null; }
  const rowBytes = width * CH, bpp = CH;
  const out = Buffer.alloc(rowBytes * height);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : (pb <= pc ? b : c); };
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++]; const rs = y * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      const x = raw[p + i];
      const a = i >= bpp ? out[rs + i - bpp] : 0;
      const b = y > 0 ? out[rs - rowBytes + i] : 0;
      const c = (i >= bpp && y > 0) ? out[rs - rowBytes + i - bpp] : 0;
      out[rs + i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c)) & 0xff;
    }
    p += rowBytes;
  }
  // Conversion en RGBA.
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, bl, al = 255;
    if (colorType === 0) { r = g = bl = out[i]; }
    else if (colorType === 2) { r = out[i * 3]; g = out[i * 3 + 1]; bl = out[i * 3 + 2]; }
    else if (colorType === 3) { const idx = out[i]; if (palette) { r = palette[idx * 3]; g = palette[idx * 3 + 1]; bl = palette[idx * 3 + 2]; } else r = g = bl = 0; if (trns && idx < trns.length) al = trns[idx]; }
    else if (colorType === 4) { r = g = bl = out[i * 2]; al = out[i * 2 + 1]; }
    else { r = out[i * 4]; g = out[i * 4 + 1]; bl = out[i * 4 + 2]; al = out[i * 4 + 3]; }
    const o = i * 4; rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = bl; rgba[o + 3] = al;
  }
  return { width, height, rgba };
}

// Nombre d'images empilées d'une cape (1 = fixe). Disposition vanilla (largeur mult. de 64).
export function capeFrames(w, h) {
  const s = w / 64;
  if (!Number.isInteger(s) || s < 1) return 1;
  const base = 32 * s;
  return h % base === 0 ? h / base : 1;
}

// Si le PNG est une cape ANIMÉE (images empilées), renvoie la 1re image (64s×32s) en
// PNG ; sinon renvoie le buffer inchangé. Sert à donner une cape VALIDE à OptiFine
// (qui n'affiche pas les capes animées). En cas d'échec de décodage : buffer inchangé.
export function firstFrameIfAnimated(buf) {
  try {
    const size = readPngSize(buf);
    if (!size) return buf;
    const frames = capeFrames(size.width, size.height);
    if (frames <= 1) return buf;
    const dec = decodePNG(buf);
    if (!dec) return buf;
    const frameH = size.height / frames;
    const cropped = dec.rgba.subarray(0, size.width * frameH * 4);
    return encodePNG(size.width, frameH, cropped);
  } catch { return buf; }
}

// Empaquetage ICO minimal (PNG intégré, format accepté depuis Vista).
export function pngToIco(png) {
  const dir = Buffer.alloc(6);
  dir.writeUInt16LE(1, 2); // type icône
  dir.writeUInt16LE(1, 4); // 1 image
  const e = Buffer.alloc(16);
  e.writeUInt16LE(1, 4);   // plans
  e.writeUInt16LE(32, 6);  // bpp
  e.writeUInt32LE(png.length, 8);
  e.writeUInt32LE(22, 12); // offset des données
  return Buffer.concat([dir, e, png]);
}

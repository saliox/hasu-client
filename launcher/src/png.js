// Mini encodeur PNG/ICO en pur Node (zéro dépendance) — extrait de la boîte à
// outils de Cap Hub, juste ce qu'il faut pour générer l'icône du launcher.
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
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([PNG_SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
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

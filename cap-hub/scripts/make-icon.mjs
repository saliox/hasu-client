// Génère le logo de Cap Hub (une cape stylisée sur pastille sombre) en PUR Node :
// build/icon.png (256x256) + build/icon.ico. Aucune dépendance — rendu supersamplé
// (anti-aliasing) via l'encodeur PNG maison de src/png.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePNG, pngToIco } from '../src/png.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'build');
fs.mkdirSync(outDir, { recursive: true });

const N = 256, SS = 4, H = N * SS;

const BG_C = [26, 34, 51];    // centre (#1a2233)
const BG_E = [8, 11, 18];     // bord (#080b12)
const CAPE_A = [124, 92, 255];// haut (#7c5cff)
const CAPE_B = [214, 60, 90]; // bas (#d63c5a)
const CLASP = [230, 232, 240];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (c1, c2, t) => [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - hw + r, qy = Math.abs(py - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function colorAt(x, y) {
  const s = SS, cx = H / 2, cy = H / 2;
  const fx = (x - cx) / s, fy = (y - cy) / s;

  const sd = sdRoundRect(fx, fy, 0, 0, 127, 127, 44);
  if (sd > 0) return [0, 0, 0, 0];

  const d = Math.hypot(fx, fy);
  let col = mix(BG_C, BG_E, clamp(d / 150, 0, 1));

  // Silhouette de cape : trapèze légèrement resserré en bas, épaules arrondies.
  const topY = -74, botY = 78;
  if (fy >= topY && fy <= botY) {
    const t = (fy - topY) / (botY - topY);
    const halfW = 58 - 12 * t;               // se resserre vers le bas
    if (Math.abs(fx) <= halfW) {
      let c = mix(CAPE_A, CAPE_B, clamp(t, 0, 1));
      // pli central (ombre douce)
      const fold = Math.abs(fx) < 4 ? 0.82 : 1;
      // liseré latéral plus clair
      const rim = Math.abs(fx) > halfW - 5 ? 1.12 : 1;
      c = [c[0] * fold * rim, c[1] * fold * rim, c[2] * fold * rim];
      // col de la cape (bande sombre en haut)
      if (fy < topY + 14) c = mix(c, [20, 24, 36], 0.5);
      return [clamp(Math.round(c[0]), 0, 255), clamp(Math.round(c[1]), 0, 255), clamp(Math.round(c[2]), 0, 255), 255];
    }
  }

  // Fermoir (petit losange clair au niveau du col).
  if (Math.hypot(fx, (fy + 60)) <= 8) return [CLASP[0], CLASP[1], CLASP[2], 255];

  if (sd > -3) col = mix(col, [10, 12, 20], 0.6); // liseré interne
  return [Math.round(col[0]), Math.round(col[1]), Math.round(col[2]), 255];
}

function render() {
  const out = Buffer.alloc(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [pr, pg, pb, pa] = colorAt(x * SS + sx + 0.5, y * SS + sy + 0.5);
          const af = pa / 255;
          r += pr * af; g += pg * af; b += pb * af; a += pa;
        }
      }
      const n = SS * SS, af = a / (255 * n), idx = (y * N + x) * 4;
      out[idx] = af ? Math.round(r / (af * n)) : 0;
      out[idx + 1] = af ? Math.round(g / (af * n)) : 0;
      out[idx + 2] = af ? Math.round(b / (af * n)) : 0;
      out[idx + 3] = Math.round(a / n);
    }
  }
  return out;
}

const rgba = render();
const png = encodePNG(N, N, rgba);
fs.writeFileSync(path.join(outDir, 'icon.png'), png);
fs.writeFileSync(path.join(outDir, 'icon.ico'), pngToIco(png));
console.log(`Icône générée : build/icon.png (${(png.length / 1024).toFixed(1)} Ko) + build/icon.ico`);

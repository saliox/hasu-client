// Gestion des capes locales : validation des PNG importés, bibliothèque de capes
// intégrées (générées en pur Node au premier lancement), et cape « active » servie
// par le proxy pour TON pseudo.
//
// Formats acceptés (mêmes règles que les serveurs de capes existants) :
// - disposition vanilla 64x32 et ses multiples HD (128x64, 256x128, 512x256…)
// - disposition OptiFine 46x22 et ses multiples (92x44…)
import fs from 'node:fs';
import path from 'node:path';
import { encodePNG, isPng, readPngSize } from './png.js';

let DIR = null;          // userData/capes
let BUILTIN_DIR = null;  // userData/capes/builtin

export function initCapes(userDataDir) {
  DIR = path.join(userDataDir, 'capes');
  BUILTIN_DIR = path.join(DIR, 'builtin');
  fs.mkdirSync(BUILTIN_DIR, { recursive: true });
  ensureBuiltins();
}

// ---------- Validation ----------
// Accepte : disposition vanilla 64x32 et ses multiples HD/4K (jusqu'à 4096x2048),
// les capes ANIMÉES (N images 64s×32s empilées verticalement), et la disposition
// OptiFine 46x22 (+ multiples).
export function validateCape(buf) {
  if (!isPng(buf)) return { ok: false, error: 'Le fichier n’est pas un PNG valide.' };
  if (buf.length > 12 * 1024 * 1024) return { ok: false, error: 'PNG trop lourd (max 12 Mo).' };
  const size = readPngSize(buf);
  if (!size) return { ok: false, error: 'Impossible de lire la taille du PNG.' };
  const { width: w, height: h } = size;

  let okVanilla = false, frames = 1;
  const vs = w / 64;                                   // échelle HD (1 = 64px, 64 = 4096px)
  if (Number.isInteger(vs) && vs >= 1 && vs <= 64) {
    const base = 32 * vs;
    if (h % base === 0) { const fr = h / base; if (fr >= 1 && fr <= 64) { okVanilla = true; frames = fr; } }
  }
  const os = w / 46;
  const okOptifine = Number.isInteger(os) && os >= 1 && os <= 64 && h === 22 * os;

  if (!okVanilla && !okOptifine) {
    return { ok: false, error: `Taille ${w}x${h} non reconnue. Attendu : 64x32 (ou multiple HD), 64x${32 * 2}… (animée) ou 46x22 (ou multiple).` };
  }
  return { ok: true, width: w, height: h, layout: okVanilla ? 'vanilla' : 'optifine', frames: okVanilla ? frames : 1 };
}

// ---------- Import / liste ----------
// Nom de fichier sûr (anti-traversée, longueur bornée).
function safeName(name, fallback) {
  return String(name || fallback || 'cape')
    .replace(/[^A-Za-z0-9 _.-]/g, '_')
    .replace(/\.{2,}/g, '_')      // pas de séquence ".." dans le nom de fichier
    .replace(/^[.\s]+/, '')       // pas de point/espace en tête
    .slice(0, 40) || 'cape';
}

// Enregistre une cape depuis un buffer PNG (utilisé par l'import fichier ET le créateur).
export function importCapeBuffer(buf, name) {
  const v = validateCape(buf);
  if (!v.ok) return v;
  const safe = safeName(name, 'cape');
  let file = path.join(DIR, `${safe}.png`);
  let i = 2;
  while (fs.existsSync(file)) file = path.join(DIR, `${safe}-${i++}.png`);
  fs.writeFileSync(file, buf);
  return { ok: true, id: path.basename(file), file };
}

export function importCape(srcPath, name) {
  let buf;
  try { buf = fs.readFileSync(srcPath); } catch { return { ok: false, error: 'Fichier illisible.' }; }
  return importCapeBuffer(buf, name || path.basename(srcPath, '.png'));
}

// Une cape est « intégrée » si son fichier est DANS le dossier builtin (comparaison du
// dossier parent, pas un startsWith qui piégerait une cape utilisateur nommée « builtin… »).
const isBuiltinFile = (file) => path.dirname(file) === BUILTIN_DIR;

export function deleteCape(id) {
  const file = resolveCape(id);
  if (!file || isBuiltinFile(file)) return { ok: false, error: 'Cape introuvable ou intégrée (non supprimable).' };
  try { fs.unlinkSync(file); return { ok: true }; } catch (e) { return { ok: false, error: e.message }; }
}

// Renomme une cape importée (les intégrées ne sont pas renommables). Renvoie le
// nouvel id (nom de fichier). Assainit et évite les collisions comme à l'import.
export function renameCape(id, newName) {
  const file = resolveCape(id);
  if (!file) return { ok: false, error: 'Cape introuvable.' };
  if (isBuiltinFile(file)) return { ok: false, error: 'Cape intégrée (non renommable).' };
  const safe = String(newName || '')
    .replace(/[^A-Za-z0-9 _.-]/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[.\s]+/, '')
    .slice(0, 40).trim();
  if (!safe) return { ok: false, error: 'Nom invalide.' };
  let dest = path.join(DIR, `${safe}.png`);
  if (path.basename(dest) === path.basename(file)) return { ok: true, id: path.basename(file) };
  let i = 2;
  while (fs.existsSync(dest)) dest = path.join(DIR, `${safe}-${i++}.png`);
  try { fs.renameSync(file, dest); return { ok: true, id: path.basename(dest) }; }
  catch (e) { return { ok: false, error: e.message }; }
}

export function listCapes() {
  const read = (dir, builtin) => {
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .map((f) => ({ id: builtin ? `builtin/${f}` : f, name: f.replace(/\.png$/i, ''), builtin }));
    } catch { return []; }
  };
  return [...read(DIR, false), ...read(BUILTIN_DIR, true)];
}

// id -> chemin absolu (protège contre la traversée de dossier). On compare via
// path.relative pour éviter l'échappement vers un dossier FRÈRE dont le nom commence
// comme DIR (ex. « capes-evil » vs « capes ») que startsWith laisserait passer.
export function resolveCape(id) {
  if (!id) return null;
  const file = path.normalize(path.join(DIR, String(id)));
  const rel = path.relative(DIR, file);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !file.toLowerCase().endsWith('.png')) return null;
  return fs.existsSync(file) ? file : null;
}

// Duplique une cape (intégrée ou importée) dans une nouvelle cape modifiable.
export function duplicateCape(id) {
  const buf = readCape(id);
  if (!buf) return { ok: false, error: 'Cape introuvable.' };
  const src = listCapes().find((c) => c.id === id);
  return importCapeBuffer(buf, `${src ? src.name : 'cape'} copie`);
}

export function readCape(id) {
  const file = resolveCape(id);
  return file ? fs.readFileSync(file) : null;
}

// ---------- Capes intégrées (générées, disposition vanilla 64x32) ----------
// On texture toute la planche 64x32 : chaque face de la cape (et de l'élytra)
// échantillonne sa zone, donc le motif couvre tout proprement.
const W = 64, H = 32;

function fill(fn) {
  const px = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, g, b] = fn(x, y);
      const i = (y * W + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return encodePNG(W, H, px);
}

const mix = (c1, c2, t) => [
  Math.round(c1[0] + (c2[0] - c1[0]) * t),
  Math.round(c1[1] + (c2[1] - c1[1]) * t),
  Math.round(c1[2] + (c2[2] - c1[2]) * t),
];

// Assombrit légèrement les bords pour donner du relief même en uni.
const shade = (fn) => (x, y) => {
  const c = fn(x, y);
  const edge = (x % 22 <= 1 || y <= 1 || y >= H - 2) ? 0.82 : 1;
  return [Math.round(c[0] * edge), Math.round(c[1] * edge), Math.round(c[2] * edge)];
};

// HSL -> RGB (h,s,l dans [0,1]) pour les motifs arc-en-ciel / néon.
function hsl(h, s, l) {
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// Bruit déterministe (0..1) à partir de (x,y) — pas de Math.random (reproductible).
function hash2(x, y) {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % 1000) / 1000;
}

function ensureBuiltins() {
  const defs = {
    // Unis
    'Cramoisi': shade(() => [180, 40, 46]),
    'Violet': shade(() => [116, 66, 200]),
    'Cyan': shade(() => [38, 166, 184]),
    'Or': shade(() => [214, 160, 38]),
    'Emeraude': shade(() => [36, 158, 84]),
    'Nuit': shade(() => [24, 28, 40]),
    'Argent': shade(() => [176, 184, 198]),
    'Rose': shade(() => [226, 96, 150]),
    'Corail': shade(() => [232, 104, 82]),
    'Ardoise': shade(() => [70, 80, 100]),
    // Dégradés verticaux
    'Degrade crepuscule': shade((x, y) => mix([116, 66, 200], [214, 60, 90], y / (H - 1))),
    'Degrade ocean': shade((x, y) => mix([16, 42, 88], [38, 196, 210], y / (H - 1))),
    'Feu': shade((x, y) => mix([250, 214, 90], [176, 24, 24], y / (H - 1))),
    'Glace': shade((x, y) => mix([236, 250, 255], [70, 150, 214], y / (H - 1))),
    'Sang': shade((x, y) => mix([150, 20, 24], [20, 6, 8], y / (H - 1))),
    'Aurore': shade((x, y) => mix(mix([40, 200, 160], [90, 120, 230], y / (H - 1)), [180, 90, 210], (y / (H - 1)) ** 2)),
    'Sakura': shade((x, y) => mix([255, 226, 240], [230, 120, 170], y / (H - 1))),
    'Bronze': shade((x, y) => mix([220, 170, 110], [120, 70, 30], y / (H - 1))),
    // Motifs
    'Rayures': shade((x, y) => (Math.floor(y / 4) % 2 ? [230, 230, 235] : [180, 40, 46])),
    'Damier': shade((x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? [30, 32, 44] : [214, 160, 38])),
    'Arc-en-ciel': shade((x, y) => hsl((y / (H - 1)) * 0.85, 0.7, 0.55)),
    'Neon': shade((x, y) => (y % 6 < 2 ? [40, 250, 220] : mix([18, 8, 40], [60, 20, 90], y / (H - 1)))),
    'Vagues': shade((x, y) => (((y + Math.round(Math.sin(x / 4) * 3)) % 8 < 4) ? [30, 90, 170] : [70, 170, 220])),
    'Carbone': shade((x, y) => ((Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? [26, 28, 34] : [40, 44, 54])),
    'Galaxie': shade((x, y) => {
      const n = hash2(x, y);
      if (n > 0.965) return [255, 255, 255];
      if (n > 0.93) return [190, 200, 255];
      return mix([12, 10, 30], [50, 24, 78], (y / (H - 1) + Math.sin(x / 8) * 0.15));
    }),
    'Foret': shade((x, y) => (Math.floor(x / 3) % 2 ? [24, 84, 48] : [34, 110, 62])),
    'Lave': shade((x, y) => (hash2(x, y) > 0.8 ? [255, 170, 40] : mix([60, 12, 8], [140, 30, 12], y / (H - 1)))),
  };

  // Palette UNIE complète : tout le spectre (teintes) + neutres. Nom préfixé « Uni »
  // pour les retrouver d'un coup dans la recherche.
  const HUES = [
    ['Rouge', 0], ['Vermillon', 14], ['Orange', 28], ['Ambre', 40], ['Or', 50],
    ['Jaune', 58], ['Citron', 70], ['Lime', 84], ['Chartreuse', 96], ['Vert', 120],
    ['Menthe', 148], ['Emeraude', 160], ['Turquoise', 172], ['Cyan', 186], ['Azur', 200],
    ['Ciel', 210], ['Bleu', 222], ['Outremer', 236], ['Indigo', 250], ['Violet', 268],
    ['Amethyste', 282], ['Magenta', 300], ['Orchidee', 312], ['Fuchsia', 324], ['Rose', 338],
    ['Framboise', 350],
  ];
  for (const [name, h] of HUES) {
    const [r, g, b] = hsl(h / 360, 0.68, 0.52);
    defs[`Uni ${name}`] = shade(() => [r, g, b]);
  }
  const NEUTRALS = {
    'Uni Blanc': [244, 246, 250], 'Uni Gris clair': [198, 204, 214], 'Uni Gris': [138, 145, 158],
    'Uni Gris fonce': [78, 84, 96], 'Uni Anthracite': [44, 48, 58], 'Uni Noir': [18, 20, 26],
    'Uni Marron': [120, 74, 44], 'Uni Beige': [214, 196, 160], 'Uni Creme': [238, 230, 208],
  };
  for (const [name, c] of Object.entries(NEUTRALS)) defs[name] = shade(() => c);

  for (const [name, fn] of Object.entries(defs)) {
    const file = path.join(BUILTIN_DIR, `${name}.png`);
    if (!fs.existsSync(file)) fs.writeFileSync(file, fill(fn));
  }
}

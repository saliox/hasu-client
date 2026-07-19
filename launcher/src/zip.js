// Lecteur ZIP minimal, sans dépendance : juste ce qu'il faut pour extraire les
// natives (.dll) des jars LWJGL et lire version.json dans le jar universal de Forge.
// On lit le répertoire central (fin d'archive), puis chaque entrée via son en-tête
// local ; compressions gérées : stored (0) et deflate (8) — les seules utilisées
// par les jars Minecraft.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const EOCD_SIG = 0x06054b50;   // End Of Central Directory
const CEN_SIG = 0x02014b50;    // Central directory file header
const LOC_SIG = 0x04034b50;    // Local file header

// Renvoie la liste des entrées { name, compressedSize, size, method, localOffset }.
export function listZipEntries(buf) {
  // L'EOCD est en fin de fichier, précédé d'un commentaire de taille variable (max 64 Ko).
  const start = Math.max(0, buf.length - 22 - 65536);
  let eocd = -1;
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive ZIP invalide (EOCD introuvable).');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== CEN_SIG) {
      throw new Error('Répertoire central ZIP corrompu.');
    }
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entries.push({ name, compressedSize, size, method, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// Extrait le contenu d'une entrée (Buffer). Taille bornée (anti zip-bomb).
const MAX_ENTRY = 256 * 1024 * 1024;
export function readZipEntry(buf, entry) {
  const off = entry.localOffset;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== LOC_SIG) {
    throw new Error(`En-tête local ZIP invalide (${entry.name}).`);
  }
  // Les tailles des champs nom/extra de l'EN-TÊTE LOCAL peuvent différer du central.
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  if (entry.size > MAX_ENTRY) throw new Error(`Entrée ZIP trop volumineuse (${entry.name}).`);
  const data = buf.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_ENTRY });
  throw new Error(`Compression ZIP non gérée (méthode ${entry.method}, ${entry.name}).`);
}

// Lit une entrée par nom exact ; null si absente.
export function readZipFile(zipPath, entryName) {
  const buf = fs.readFileSync(zipPath);
  const entry = listZipEntries(buf).find((e) => e.name === entryName);
  return entry ? readZipEntry(buf, entry) : null;
}

// Extrait toutes les entrées vers destDir, sauf celles matchant `exclude` (préfixes).
// Refuse toute entrée qui sortirait de destDir (zip-slip).
export function extractZip(zipPath, destDir, { exclude = [] } = {}) {
  const buf = fs.readFileSync(zipPath);
  const out = [];
  for (const entry of listZipEntries(buf)) {
    if (entry.name.endsWith('/')) continue; // dossier
    if (exclude.some((p) => entry.name.startsWith(p))) continue;
    const dest = path.join(destDir, entry.name);
    const rel = path.relative(destDir, dest);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue; // zip-slip
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, readZipEntry(buf, entry));
    out.push(dest);
  }
  return out;
}

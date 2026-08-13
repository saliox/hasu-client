// Téléchargements du launcher : fichiers vérifiés par empreinte (SHA-1, le format
// des manifestes Mojang), écrits de façon atomique (tmp -> rename), avec reprise sur
// erreur réseau et limite de téléchargements simultanés. Un fichier déjà présent avec
// la bonne empreinte n'est JAMAIS retéléchargé — c'est ce qui rend le bouton « Jouer »
// instantané après la première fois.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function sha1File(file) {
  try {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

// Le fichier est-il déjà là et intègre ? (sans sha attendu : présence + taille > 0)
export function isFresh(file, sha1) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size === 0) return false;
  } catch { return false; }
  if (!sha1) return true;
  return sha1File(file) === String(sha1).toLowerCase();
}

// Télécharge une URL vers un Buffer, avec retries (backoff 1s, 2s, 4s).
export async function fetchBuffer(url, { timeout = 60000, maxBytes = 512 * 1024 * 1024 } = {}) {
  let lastErr;
  for (let i = 0; i < RETRIES; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${url}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > maxBytes) throw new Error(`Fichier trop volumineux — ${url}`);
      return buf;
    } catch (e) {
      lastErr = e;
      // 404 : inutile d'insister, l'URL n'existe pas.
      if (/HTTP 404/.test(e.message)) break;
      if (i < RETRIES - 1) await sleep(1000 * 2 ** i);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  const buf = await fetchBuffer(url, opts);
  // strip BOM éventuel (déjà vu sur des manifestes de ce dépôt)
  return JSON.parse(buf.toString('utf8').replace(/^﻿/, ''));
}

// Récupère l'empreinte SHA-1 officielle publiée par un dépôt Maven à côté d'un artefact
// (sidecar <url>.sha1, convention standard des dépôts Maven) — sert à vérifier des
// téléchargements dont le manifeste amont ne fournit pas de hash lui-même (ex. Forge,
// voir forge.js). Renvoie null si le sidecar est indisponible ou invalide ; l'appelant
// décide alors de continuer sans vérification plutôt que d'échouer (hors-ligne, maven
// historique sans .sha1) — pas de régression par rapport à l'absence totale de contrôle.
export async function fetchMavenSha1(url) {
  try {
    const buf = await fetchBuffer(`${url}.sha1`, { timeout: 15000, maxBytes: 4096 });
    const m = buf.toString('utf8').trim().match(/[0-9a-fA-F]{40}/);
    return m ? m[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

// Télécharge url -> file si absent/corrompu ; vérifie le SHA-1 si fourni.
export async function downloadFile(url, file, sha1, opts) {
  if (isFresh(file, sha1)) return { file, skipped: true, bytes: 0 };
  // Aucune empreinte fournie par l'appelant (ex. bibliothèques Forge, dont le manifeste
  // ne publie pas de hash contrairement à Mojang) : on tente le sidecar .sha1 publié à
  // côté de l'artefact sur le maven avant de télécharger, pour ne pas laisser passer un
  // téléchargement totalement non vérifié quand ce n'est pas nécessaire. Se rabat
  // silencieusement sur l'absence de vérification si le sidecar est indisponible
  // (hors-ligne, maven historique sans .sha1) — pas de régression par rapport à avant.
  const expectedSha1 = sha1 || await fetchMavenSha1(url);
  const buf = await fetchBuffer(url, opts);
  if (expectedSha1) {
    const got = crypto.createHash('sha1').update(buf).digest('hex');
    if (got !== String(expectedSha1).toLowerCase()) {
      throw new Error(`Empreinte SHA-1 invalide pour ${path.basename(file)} (attendu ${expectedSha1}, reçu ${got}) — téléchargement refusé.`);
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  return { file, skipped: false, bytes: buf.length };
}

// Exécute une liste de tâches { url, file, sha1, size } avec au plus `limit` en
// parallèle. onProgress({ done, total, bytes, file }) après chaque fichier.
export async function downloadAll(tasks, { limit = 8, onProgress } = {}) {
  const queue = [...tasks];
  let done = 0, bytes = 0;
  const total = tasks.length;
  const errors = [];
  async function worker() {
    for (;;) {
      const t = queue.shift();
      if (!t) return;
      try {
        const r = await downloadFile(t.url, t.file, t.sha1);
        bytes += r.bytes;
      } catch (e) {
        errors.push(`${path.basename(t.file)} : ${e.message}`);
      }
      done++;
      if (onProgress) { try { onProgress({ done, total, bytes, file: t.file }); } catch {} }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, queue.length) || 1 }, worker));
  if (errors.length) {
    throw new Error(`${errors.length} téléchargement(s) en échec :\n` + errors.slice(0, 5).join('\n'));
  }
  return { done, bytes };
}

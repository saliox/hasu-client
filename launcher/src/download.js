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

// Télécharge url -> file si absent/corrompu ; vérifie le SHA-1 si fourni.
export async function downloadFile(url, file, sha1, opts) {
  if (isFresh(file, sha1)) return { file, skipped: true, bytes: 0 };
  const buf = await fetchBuffer(url, opts);
  if (sha1) {
    const got = crypto.createHash('sha1').update(buf).digest('hex');
    if (got !== String(sha1).toLowerCase()) {
      throw new Error(`Empreinte SHA-1 invalide pour ${path.basename(file)} (attendu ${sha1}, reçu ${got}) — téléchargement refusé.`);
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

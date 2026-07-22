// Auto-update — même pattern que le reste du dépôt : un manifeste
// cap-hub/version.json (version, url, sha256, notes) lu en raw sur GitHub,
// installeur téléchargé, VÉRIFIÉ par empreinte SHA-256, puis lancé en silencieux.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MANIFEST_URL = 'https://raw.githubusercontent.com/saliox/hasu-client/main/cap-hub/version.json';

// Compare deux versions "1.2.3" ; true si a > b.
export function isNewer(a, b) {
  const pa = String(a || '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b || '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let lastInfo = null;

// L'installeur ne peut venir QUE des releases de notre dépôt (défense en profondeur :
// même si le manifeste était altéré, on ne télécharge pas d'exécutable d'ailleurs).
export function isAllowedInstallerUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'https:' && u.hostname === 'github.com'
      && u.pathname.startsWith('/saliox/hasu-client/releases/download/');
  } catch { return false; }
}

export async function checkForUpdates(currentVersion) {
  try {
    const r = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    // strip BOM éventuel (déjà vu sur version.json de ce dépôt)
    const info = JSON.parse((await r.text()).replace(/^﻿/, ''));
    const available = !!info.url && isNewer(info.version, currentVersion);
    lastInfo = available ? info : null;
    return { ok: true, available, current: currentVersion, version: info.version, notes: info.notes || '' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Télécharge l'installeur, vérifie le SHA-256, lance l'install silencieuse
// puis relance l'app (script cmd détaché, comme les autres apps du compte).
const MAX_INSTALLER = 300 * 1024 * 1024; // borne mémoire

// Télécharge la réponse en FLUX en rapportant la progression (0-99 %, null si taille
// inconnue). Retombe sur arrayBuffer() si le corps n'est pas lisible en flux.
async function downloadWithProgress(r, total, onProgress) {
  if (!r.body || typeof r.body.getReader !== 'function') {
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_INSTALLER) throw new Error('Installeur trop volumineux — refusé.'); // le cap s'applique aussi hors flux
    return buf;
  }
  const reader = r.body.getReader();
  const chunks = []; let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_INSTALLER) { try { await reader.cancel(); } catch {} throw new Error('Installeur trop volumineux — refusé.'); }
    chunks.push(Buffer.from(value));
    if (onProgress) { try { onProgress(total ? Math.min(99, Math.round((received / total) * 100)) : null); } catch {} }
  }
  return Buffer.concat(chunks);
}

export async function applyUpdate(appQuit, onProgress) {
  if (!lastInfo) return { ok: false, error: 'Aucune mise à jour prête.' };
  try {
    if (!isAllowedInstallerUrl(lastInfo.url)) throw new Error('URL d’installeur non autorisée — mise à jour refusée.');
    // Sécurité : on stage l'installeur et le script de lancement dans un dossier temporaire
    // à nom ALÉATOIRE (mkdtemp). Des chemins fixes/prévisibles dans %TEMP% permettraient à un
    // autre processus (même utilisateur) de réécrire l'installeur vérifié entre l'écriture et
    // l'exécution (TOCTOU), contournant la vérification SHA-256. Un nom aléatoire ferme cette fenêtre.
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caphub-upd-'));
    const dest = path.join(workDir, 'CapHub-Setup.exe');
    const r = await fetch(lastInfo.url, { signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error(`Téléchargement : HTTP ${r.status}`);
    const total = Number(r.headers.get('content-length') || 0);
    if (total > MAX_INSTALLER) throw new Error('Installeur trop volumineux — refusé.');
    const buf = await downloadWithProgress(r, total, onProgress);
    const sha = crypto.createHash('sha256').update(buf).digest('hex');
    if (String(lastInfo.sha256 || '').toLowerCase() !== sha) {
      throw new Error('Empreinte SHA-256 invalide — mise à jour refusée.');
    }
    fs.writeFileSync(dest, buf);
    if (onProgress) { try { onProgress(100); } catch {} }
    const script = path.join(workDir, 'run.cmd');
    const body =
      '@echo off\r\n' +
      'ping 127.0.0.1 -n 2 >nul\r\n' +
      `"${dest}" /S\r\n` +
      `start "" "${process.execPath}"\r\n`;
    fs.writeFileSync(script, body);
    const child = spawn('cmd.exe', ['/c', script], { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {}); // un échec de spawn ne doit pas remonter en exception non gérée
    child.unref();
    setTimeout(() => appQuit(), 400);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}


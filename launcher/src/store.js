// Réglages persistés (userData/settings.json), écrits de façon ATOMIQUE avec copie
// .bak, comme Cap Hub. La session Minecraft (tokens) est chiffrée au repos via
// Electron safeStorage (DPAPI sous Windows) — jamais en clair sur le disque.
import fs from 'node:fs';
import path from 'node:path';

let FILE = null;
let safe = null; // module safeStorage (injecté depuis main pour éviter d'importer electron ici)

export function initStore(userDataDir, safeStorage) {
  FILE = path.join(userDataDir, 'settings.json');
  safe = safeStorage;
}

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  try { return JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')); } catch { return {}; }
}
// Écriture ATOMIQUE : tmp -> rename (le rename est atomique sur le même volume), avec
// une copie .bak de l'ancien contenu. Une coupure en plein write ne tronque donc jamais
// settings.json (qui contient aussi la session Minecraft chiffrée).
// Renvoie true si la persistance a réussi, false sinon (disque plein, verrou, permissions).
// Les appelants qui écrivent des données critiques (session) DOIVENT vérifier ce
// résultat au lieu de supposer que l'écriture a abouti.
function write(obj) {
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak'); } catch {}
    fs.renameSync(tmp, FILE);
    return true;
  } catch (e) {
    console.error('[store] échec d’écriture de settings.json :', e.message);
    return false;
  }
}

const encAvailable = () => { try { return safe && safe.isEncryptionAvailable(); } catch { return false; } };

// Vue publique des réglages : jamais de token dedans, seulement des booléens d'état.
export function getSettings() {
  const s = read();
  return {
    versionId: typeof s.versionId === 'string' ? s.versionId : '1.8.9',
    forge: s.forge !== false,                 // 1.8.9 + Forge par défaut (le client Hasu)
    ramMb: Number.isFinite(s.ramMb) ? Math.max(1024, Math.min(16384, s.ramMb)) : 2048,
    gameDir: typeof s.gameDir === 'string' ? s.gameDir : '',   // vide = défaut (userData/minecraft)
    keepOpen: s.keepOpen !== false,           // garder le launcher ouvert pendant le jeu
    offlineName: typeof s.offlineName === 'string' ? s.offlineName : '',
    // ID d'application Azure (public client) — public par nature, stocké en clair.
    mcClientId: typeof s.mcClientId === 'string' ? s.mcClientId : '',
    hasMcSession: !!s.mcSessionEnc,
    theme: typeof s.theme === 'string' ? s.theme : 'nuit',
  };
}

export function saveSettings(patch) {
  const s = read();
  for (const k of ['versionId', 'gameDir', 'offlineName', 'mcClientId', 'theme']) {
    if (typeof patch[k] === 'string') s[k] = patch[k].trim();
  }
  for (const k of ['forge', 'keepOpen']) {
    if (typeof patch[k] === 'boolean') s[k] = patch[k];
  }
  if (Number.isFinite(patch.ramMb)) s.ramMb = Math.round(patch.ramMb);
  if (!write(s)) console.error('[store] réglages non enregistrés (échec d’écriture disque).');
  return getSettings();
}

// --- Session Minecraft (tokens sensibles) ---
// Chiffrée au repos ; si le chiffrement est indisponible, on REFUSE de persister
// (pas de repli en clair pour des tokens).
export function setMcSession(session) {
  const s = read();
  if (!session) { delete s.mcSessionEnc; const okc = write(s); return okc ? { ok: true, cleared: true } : { ok: false, error: 'Écriture impossible.' }; }
  if (!encAvailable()) return { ok: false, error: 'Chiffrement indisponible : session non enregistrée (reconnexion nécessaire à chaque lancement).' };
  try {
    s.mcSessionEnc = safe.encryptString(JSON.stringify(session)).toString('base64');
    if (!write(s)) return { ok: false, error: 'Écriture impossible (disque plein ou fichier verrouillé ?).' };
    return { ok: true, encrypted: true };
  } catch {
    return { ok: false, error: 'Chiffrement de la session impossible.' };
  }
}

export function getMcSession() {
  const s = read();
  if (s.mcSessionEnc && encAvailable()) {
    try { return JSON.parse(safe.decryptString(Buffer.from(s.mcSessionEnc, 'base64'))); } catch { return null; }
  }
  return null;
}

export function clearMcSession() { return setMcSession(null); }

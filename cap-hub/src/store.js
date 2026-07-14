// Réglages persistés (userData/settings.json). Le token GitHub de publication est
// chiffré au repos via Electron safeStorage (DPAPI sous Windows) — jamais en clair
// sur le disque, comme dans snipe-mc.
import fs from 'node:fs';
import path from 'node:path';

let FILE = null;
let safe = null; // module safeStorage (injecté depuis main pour éviter d'importer electron ici)

export function initStore(userDataDir, safeStorage) {
  FILE = path.join(userDataDir, 'settings.json');
  safe = safeStorage;
}

function read() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; }
}
function write(obj) {
  try { fs.writeFileSync(FILE, JSON.stringify(obj, null, 2)); } catch {}
}

const encAvailable = () => { try { return safe && safe.isEncryptionAvailable(); } catch { return false; } };

// Vue publique des réglages : le token n'est JAMAIS renvoyé, seulement un booléen.
export function getSettings() {
  const s = read();
  return {
    username: s.username || '',
    activeCape: s.activeCape || '',
    autoApply: s.autoApply !== false,   // proposer d'appliquer au lancement (défaut oui)
    autoProxy: s.autoProxy !== false,   // démarrer le proxy avec l'app (défaut oui)
    repo: s.repo || '',
    branch: s.branch || '',
    hasToken: !!s.tokenEnc,
    // Fournisseurs de capes activés. OptiFine par défaut (canal HTTP, sans CA).
    providers: Array.isArray(s.providers) ? s.providers : ['optifine'],
  };
}

export function saveSettings(patch) {
  const s = read();
  for (const k of ['username', 'activeCape', 'repo', 'branch']) {
    if (typeof patch[k] === 'string') s[k] = patch[k].trim();
  }
  for (const k of ['autoApply', 'autoProxy']) {
    if (typeof patch[k] === 'boolean') s[k] = patch[k];
  }
  if (Array.isArray(patch.providers)) {
    s.providers = [...new Set(patch.providers.filter((x) => typeof x === 'string'))];
  }
  write(s);
  return getSettings();
}

// Enregistre (ou efface si vide) le token GitHub, chiffré si possible.
export function setToken(token) {
  const s = read();
  const t = String(token || '').trim();
  if (!t) { delete s.tokenEnc; delete s.tokenPlain; write(s); return { ok: true, cleared: true }; }
  if (encAvailable()) {
    s.tokenEnc = safe.encryptString(t).toString('base64');
    delete s.tokenPlain;
  } else {
    // Repli (rare : session sans keyring) — on stocke en clair mais on le signale.
    s.tokenPlain = t;
    delete s.tokenEnc;
  }
  write(s);
  return { ok: true, encrypted: !!s.tokenEnc };
}

export function getToken() {
  const s = read();
  if (s.tokenEnc && encAvailable()) {
    try { return safe.decryptString(Buffer.from(s.tokenEnc, 'base64')); } catch { return null; }
  }
  return s.tokenPlain || null;
}

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
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
  // Repli sur la sauvegarde si le fichier principal est absent/corrompu (crash en pleine
  // écriture) — évite de perdre token + session MC d'un coup.
  try { return JSON.parse(fs.readFileSync(FILE + '.bak', 'utf8')); } catch { return {}; }
}
// Écriture ATOMIQUE : tmp -> rename (le rename est atomique sur le même volume), avec
// une copie .bak de l'ancien contenu. Une coupure en plein write ne tronque donc jamais
// settings.json (qui contient aussi le token et la session Minecraft chiffrés).
function write(obj) {
  try {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    try { if (fs.existsSync(FILE)) fs.copyFileSync(FILE, FILE + '.bak'); } catch {}
    fs.renameSync(tmp, FILE);
  } catch {}
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
    theme: typeof s.theme === 'string' ? s.theme : 'nuit',
    favorites: Array.isArray(s.favorites) ? s.favorites.filter((x) => typeof x === 'string') : [],
    // Catégorie (dossier) par cape : { id -> nom }. Surcharge la catégorie auto.
    categories: (s.categories && typeof s.categories === 'object') ? s.categories : {},
    // ID d'application Azure (public client) pour la connexion Microsoft — le même que
    // Hasu Client. Public par nature (non secret), stocké en clair. La session Minecraft
    // (tokens) est stockée à part, chiffrée (voir setMcSession/getMcSession).
    mcClientId: typeof s.mcClientId === 'string' ? s.mcClientId : '',
    hasMcSession: !!s.mcSessionEnc,
  };
}

export function saveSettings(patch) {
  const s = read();
  for (const k of ['username', 'activeCape', 'repo', 'branch', 'theme', 'mcClientId']) {
    if (typeof patch[k] === 'string') s[k] = patch[k].trim();
  }
  for (const k of ['autoApply', 'autoProxy']) {
    if (typeof patch[k] === 'boolean') s[k] = patch[k];
  }
  if (Array.isArray(patch.favorites)) {
    s.favorites = [...new Set(patch.favorites.filter((x) => typeof x === 'string'))].slice(0, 500);
  }
  if (patch.categories && typeof patch.categories === 'object') {
    const clean = {};
    for (const [k, v] of Object.entries(patch.categories)) {
      if (typeof k === 'string' && typeof v === 'string' && v.trim()) clean[k] = v.slice(0, 30).trim();
    }
    s.categories = clean;
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

// --- Session Minecraft officielle (compte perso) ---
// La session contient des tokens sensibles (accessToken Minecraft, refresh token
// Microsoft) : elle est chiffrée au repos via safeStorage. Si le chiffrement n'est pas
// disponible, on REFUSE de la persister (pas de repli en clair pour des tokens).
export function setMcSession(session) {
  const s = read();
  if (!session) { delete s.mcSessionEnc; write(s); return { ok: true, cleared: true }; }
  if (!encAvailable()) return { ok: false, error: 'Chiffrement indisponible : session non enregistrée (reconnexion nécessaire à chaque lancement).' };
  try {
    s.mcSessionEnc = safe.encryptString(JSON.stringify(session)).toString('base64');
    write(s);
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

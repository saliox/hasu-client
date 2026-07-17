// Cap Hub — processus principal Electron.
//
// Rôle : câbler ensemble le proxy de capes (canal OptiFine, HTTP), la redirection
// hosts, le registre partagé GitHub, la bibliothèque de capes locale, l'aperçu, le
// détecteur de lancement de Minecraft et l'auto-update, dans une fenêtre verrouillée.
//
// SÉCURITÉ — Cap Hub reste volontairement sur le SEUL canal OptiFine (HTTP clair) :
// aucune autorité de certification, aucune interception TLS, aucun magasin de
// confiance modifié. Voir README (« Pourquoi OptiFine seulement »).
import { app, BrowserWindow, ipcMain, dialog, shell, Notification, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { isPng, firstFrameIfAnimated } from './src/png.js';

import { initCapes, listCapes, importCape, importCapeBuffer, deleteCape, renameCape, resolveCape, readCape, duplicateCape } from './src/capes.js';
import { initStore, getSettings, saveSettings, setToken, getToken, setMcSession, getMcSession, clearMcSession } from './src/store.js';
import * as mc from './src/mcaccount.js';
import { startProxy, stopProxy, isRunning, getStats, getPort, proxyEvents, redirectHosts } from './src/proxy.js';
import { isApplied, applyRedirect, removeRedirect, appliedHosts } from './src/hosts.js';
import { initRegistry, configureRegistry, refreshIndex, listPlayers, getRegistryCape, publishCape } from './src/registry.js';
import { startWatcher, stopWatcher, currentGames, watcherEvents } from './src/watcher.js';
import { checkForUpdates, applyUpdate } from './src/updater.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win = null;

// Empêche deux instances (le proxy tient le port 80 : une seule doit l'occuper).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
}

function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 740, minWidth: 900, minHeight: 620,
    backgroundColor: '#0b0f17', title: 'Cap Hub',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  win.removeMenu();
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Tout lien externe s'ouvre dans le navigateur, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function notify(title, body) {
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    n.on('click', () => { try { win?.show(); win?.focus(); } catch {} });
    n.show();
  } catch {}
}

// ---------- Dépendances injectées dans le proxy ----------
// getOwn : sert TA cape active si la requête concerne TON pseudo.
// getRegistryCape : délègue au registre partagé pour les autres joueurs.
function proxyDeps() {
  return {
    getOwn: async (nameLower) => {
      const s = getSettings();
      if (!s.username || s.username.toLowerCase() !== nameLower || !s.activeCape) return null;
      return readCape(s.activeCape);
    },
    getRegistryCape: (nameLower) => getRegistryCape(nameLower),
  };
}

// ---------- Cycle de vie ----------
app.whenReady().then(async () => {
  const ud = app.getPath('userData');
  initStore(ud, safeStorage);
  initCapes(ud);
  const s0 = getSettings();
  initRegistry(ud, { repo: s0.repo, branch: s0.branch });

  createWindow();

  // Relaie les logs du proxy vers l'UI.
  proxyEvents.on('log', (e) => send('log', e));

  // Démarre le proxy au lancement si l'option est active.
  if (s0.autoProxy) {
    const r = await startProxy(proxyDeps());
    if (!r.ok) notify('Cap Hub', 'Proxy non démarré : ' + r.error);
    send('proxy-changed', await proxyStatus());
  }

  // Rafraîchit le registre en tâche de fond.
  refreshIndex(true).catch(() => {});

  // Détecteur de lancement de Minecraft.
  wireWatcher();
  startWatcher(4000);

  // Vérifie les mises à jour au démarrage (silencieux).
  setTimeout(() => doUpdateCheck(true).catch(() => {}), 5000);

  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { try { stopWatcher(); } catch {} });

// ---------- Détection de Minecraft -> proposition d'appliquer Cap Hub ----------
let lastPrompt = 0;
function wireWatcher() {
  watcherEvents.on('game-start', async (info) => {
    send('game-start', info);
    send('log', { level: 'info', msg: `Minecraft détecté : ${info.client}${info.username ? ' (' + info.username + ')' : ''}`, t: Date.now() });

    const s = getSettings();
    if (!s.autoApply) return;
    // Anti-spam : une seule invite toutes les 30 s.
    if (Date.now() - lastPrompt < 30000) return;
    lastPrompt = Date.now();

    const ready = isRunning() && isApplied();
    if (ready) {
      notify('Cap Hub actif', `${info.client} détecté — tes capes sont déjà appliquées.`);
      return;
    }
    // Propose d'activer Cap Hub maintenant (bouton = 1 clic).
    if (!win) return;
    win.show(); win.focus();
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Appliquer Cap Hub', 'Ignorer'],
      defaultId: 0, cancelId: 1,
      title: 'Cap Hub',
      message: `${info.client} vient de démarrer.`,
      detail: 'Veux-tu appliquer Cap Hub pour afficher tes capes personnalisées (et celles des autres joueurs Cap Hub) dans le jeu ?',
    });
    if (response === 0) {
      const r = await enableEverything();
      send('proxy-changed', await proxyStatus());
      notify('Cap Hub', r.ok ? 'Cap Hub appliqué ✔ — relance/rejoins un monde pour voir les capes.' : 'Échec : ' + r.error);
    }
  });

  watcherEvents.on('game-stop', () => send('game-stop', {}));
}

// Active proxy + redirection hosts en une fois (le « 1 clic »).
async function enableEverything() {
  const p = await startProxy(proxyDeps());
  if (!p.ok) return { ok: false, error: 'Proxy : ' + p.error };
  const h = await applyRedirect(redirectHosts());
  if (!h.ok) return { ok: false, error: 'Redirection : ' + h.error };
  return { ok: true };
}

async function proxyStatus() {
  return { ...getStats(), hostsApplied: isApplied(), hostsList: appliedHosts() };
}

// ---------- Mise à jour ----------
async function doUpdateCheck(silent) {
  const r = await checkForUpdates(app.getVersion());
  if (r.ok && r.available) send('update-status', { state: 'available', version: r.version, notes: r.notes, current: app.getVersion() });
  else if (!silent && r.ok) send('update-status', { state: 'uptodate', current: app.getVersion() });
  else if (!silent) send('update-status', { state: 'error', error: r.error });
  return r;
}

// ---------- IPC ----------
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('settings:get', () => ({ ok: true, settings: getSettings(), encryption: safeStorage.isEncryptionAvailable() }));
ipcMain.handle('settings:save', (_e, patch) => {
  const s = saveSettings(patch || {});
  configureRegistry({ repo: s.repo, branch: s.branch });
  return { ok: true, settings: s };
});
ipcMain.handle('settings:setToken', (_e, token) => setToken(token));

ipcMain.handle('capes:list', () => {
  const s = getSettings();
  return { ok: true, capes: listCapes(), active: s.activeCape, favorites: s.favorites, categories: s.categories };
});
// Assigne (ou retire si vide) la catégorie d'une cape.
ipcMain.handle('capes:setCategory', (_e, id, cat) => {
  const s = getSettings();
  const cats = { ...s.categories };
  const c = String(cat || '').slice(0, 30).trim();
  if (c) cats[id] = c; else delete cats[id];
  const saved = saveSettings({ categories: cats });
  return { ok: true, categories: saved.categories };
});
// Ouvre une image quelconque et la renvoie en data URL (le renderer la recadre en cape).
ipcMain.handle('capes:pickImage', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir une image',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
  let buf;
  try { buf = fs.readFileSync(r.filePaths[0]); } catch { return { ok: false, error: 'Image illisible.' }; }
  if (buf.length > 8 * 1024 * 1024) return { ok: false, error: 'Image trop lourde (max 8 Mo).' };
  const ext = path.extname(r.filePaths[0]).toLowerCase().replace('.', '');
  const mime = ext === 'jpg' ? 'jpeg' : (ext || 'png');
  return { ok: true, dataUrl: `data:image/${mime};base64,` + buf.toString('base64') };
});
// Ouvre le sélecteur (PNG / GIF / image) et renvoie les fichiers en data URL. Le
// renderer convertit ensuite (GIF -> cape animée empilée, image -> recadrée, PNG de
// cape HD/4K -> tel quel) puis enregistre via capes:create.
ipcMain.handle('capes:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importer des capes (PNG, GIF, image)',
    filters: [{ name: 'Capes et images', extensions: ['png', 'gif', 'jpg', 'jpeg', 'webp', 'bmp'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  const files = [];
  for (const p of r.filePaths) {
    let buf;
    try { buf = fs.readFileSync(p); } catch { continue; }
    if (buf.length > 12 * 1024 * 1024) { files.push({ name: path.basename(p), tooBig: true }); continue; }
    const ext = path.extname(p).toLowerCase().replace('.', '');
    const mime = ext === 'jpg' ? 'jpeg' : (ext || 'png');
    files.push({ name: path.basename(p, path.extname(p)).slice(0, 40) || 'cape', ext, dataUrl: `data:image/${mime};base64,` + buf.toString('base64') });
  }
  return { ok: true, files };
});
ipcMain.handle('capes:remove', (_e, id) => {
  const s = getSettings();
  const res = deleteCape(id);
  if (res.ok) {
    const patch = {};
    if (s.activeCape === id) patch.activeCape = '';
    if (s.favorites.includes(id)) patch.favorites = s.favorites.filter((x) => x !== id);
    if (Object.keys(patch).length) saveSettings(patch);
  }
  return res;
});
ipcMain.handle('capes:rename', (_e, id, name) => {
  const s = getSettings();
  const res = renameCape(id, name);
  if (res.ok && res.id !== id) {
    // Reporte l'état (actif/favori) sur le nouvel id.
    const patch = {};
    if (s.activeCape === id) patch.activeCape = res.id;
    if (s.favorites.includes(id)) patch.favorites = s.favorites.map((x) => (x === id ? res.id : x));
    if (Object.keys(patch).length) saveSettings(patch);
  }
  return res;
});
// Crée une cape depuis l'éditeur : dataUrl PNG (data:image/png;base64,...) -> buffer -> validée + sauvée.
ipcMain.handle('capes:create', (_e, name, dataUrl) => {
  const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return { ok: false, error: 'Image invalide.' };
  let buf;
  try { buf = Buffer.from(m[1], 'base64'); } catch { return { ok: false, error: 'Décodage impossible.' }; }
  if (buf.length > 12 * 1024 * 1024) return { ok: false, error: 'Image trop lourde (max 12 Mo).' };
  return importCapeBuffer(buf, name || 'Ma cape');
});
ipcMain.handle('capes:favorite', (_e, id, on) => {
  const s = getSettings();
  const set = new Set(s.favorites);
  if (on) set.add(id); else set.delete(id);
  saveSettings({ favorites: [...set] });
  return { ok: true, favorites: [...set] };
});
ipcMain.handle('capes:setActive', (_e, id) => {
  if (id && !resolveCape(id)) return { ok: false, error: 'Cape introuvable.' };
  saveSettings({ activeCape: id || '' });
  return { ok: true, active: id || '' };
});
ipcMain.handle('capes:preview', (_e, id) => {
  const buf = readCape(id);
  if (!buf) return { ok: false, error: 'Cape introuvable.' };
  return { ok: true, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
});
// Duplique une cape (intégrée ou importée) en une copie modifiable.
ipcMain.handle('capes:duplicate', (_e, id) => duplicateCape(id));
// Exporte une cape vers un fichier PNG choisi par l'utilisateur (inverse de l'import).
ipcMain.handle('capes:export', async (_e, id) => {
  const buf = readCape(id);
  if (!buf) return { ok: false, error: 'Cape introuvable.' };
  const src = listCapes().find((c) => c.id === id);
  const r = await dialog.showSaveDialog(win, {
    title: 'Exporter la cape',
    defaultPath: `${(src?.name || 'cape').replace(/[\\/:*?"<>|]/g, '_')}.png`,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false, canceled: true };
  try { fs.writeFileSync(r.filePath, buf); return { ok: true, path: r.filePath }; }
  catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('capes:publish', async () => {
  const s = getSettings();
  if (!s.username) return { ok: false, error: 'Renseigne ton pseudo Minecraft (Réglages).' };
  if (!s.activeCape) return { ok: false, error: 'Choisis d’abord une cape active.' };
  const buf = readCape(s.activeCape);
  if (!buf) return { ok: false, error: 'Cape active introuvable.' };
  const token = getToken();
  if (!token) return { ok: false, error: 'Token GitHub manquant (Réglages).' };
  return publishCape(token, s.username, buf);
});

ipcMain.handle('proxy:status', async () => ({ ok: true, running: isRunning(), ...(await proxyStatus()) }));
ipcMain.handle('proxy:start', async () => {
  const r = await startProxy(proxyDeps());
  send('proxy-changed', await proxyStatus());
  return r;
});
ipcMain.handle('proxy:stop', async () => {
  const r = await stopProxy();
  send('proxy-changed', await proxyStatus());
  return r;
});
ipcMain.handle('proxy:applyRedirect', async () => {
  const r = await applyRedirect(redirectHosts());
  send('proxy-changed', await proxyStatus());
  return r;
});
ipcMain.handle('proxy:removeRedirect', async () => {
  const r = await removeRedirect();
  send('proxy-changed', await proxyStatus());
  return r;
});
// « Appliquer Cap Hub » complet (proxy + redirection) en un appel.
ipcMain.handle('proxy:enableAll', async () => {
  const r = await enableEverything();
  send('proxy-changed', await proxyStatus());
  return r;
});

ipcMain.handle('registry:refresh', async () => {
  const r = await refreshIndex(true);
  return { ...r, players: listPlayers() };
});
ipcMain.handle('registry:players', () => ({ ok: true, players: listPlayers() }));
// Cape d'un joueur du registre en data URL, pour l'afficher dans l'onglet Joueurs.
ipcMain.handle('registry:cape', async (_e, name) => {
  try {
    const buf = await getRegistryCape(String(name || '').toLowerCase());
    if (!buf) return { ok: false };
    return { ok: true, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
  } catch { return { ok: false }; }
});

ipcMain.handle('games:current', () => ({ ok: true, games: currentGames() }));

// Auto-diagnostic « pourquoi ma cape ne s'affiche pas ? » : vérifie toute la chaîne et,
// surtout, fait une VRAIE requête à travers le proxy (comme OptiFine) pour confirmer que
// ta cape est bien servie sur ton pseudo.
ipcMain.handle('proxy:selfTest', async () => {
  const s = getSettings();
  const steps = [];
  const add = (ok, label, detail) => steps.push({ ok, label, detail: detail || '' });

  add(isRunning(), 'Proxy de capes démarré', isRunning() ? '' : 'Démarre-le (onglet État) ou clique « Appliquer Cap Hub ».');
  add(isApplied(), 'Redirection s.optifine.net active', isApplied() ? '' : 'Clique « Appliquer Cap Hub » (fenêtre admin).');
  add(!!s.username, 'Pseudo Minecraft renseigné', s.username ? `« ${s.username} »` : 'Renseigne ton pseudo (Réglages).');
  add(!!s.activeCape, 'Cape active choisie', s.activeCape ? '' : 'Choisis une cape et clique « Utiliser ».');

  // Requête de bout en bout à travers le proxy local (même chemin qu'OptiFine).
  let served = false, detail = 'Proxy arrêté ou pseudo manquant — étapes précédentes à corriger d’abord.';
  if (isRunning() && s.username) {
    const port = getPort() || 80;
    try {
      const res = await new Promise((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port, path: `/capes/${encodeURIComponent(s.username)}.png`, headers: { Host: 's.optifine.net' }, timeout: 5000 },
          (r) => { const ch = []; r.on('data', (c) => ch.push(c)); r.on('end', () => resolve({ status: r.statusCode, buf: Buffer.concat(ch) })); }
        );
        req.on('timeout', () => req.destroy(new Error('délai dépassé')));
        req.on('error', reject);
      });
      if (res.status === 200 && isPng(res.buf)) {
        served = true;
        const own = s.activeCape ? firstFrameIfAnimated(readCape(s.activeCape) || Buffer.alloc(0)) : null;
        detail = own && res.buf.equals(own)
          ? 'Ta cape active est servie correctement ✔'
          : 'Une cape est servie pour ton pseudo (via le registre ou le relais OptiFine).';
      } else {
        detail = `Le proxy a répondu HTTP ${res.status} — ta cape n’est pas servie. As-tu bien choisi une cape active ?`;
      }
    } catch (e) {
      detail = 'Le proxy local n’a pas répondu : ' + (e.message || 'erreur') + '. Le port 80 est-il pris par un autre logiciel ?';
    }
  }
  add(served, 'Ta cape est servie sur le canal OptiFine', detail);

  return { ok: true, allOk: steps.every((x) => x.ok), steps };
});

ipcMain.handle('update:check', () => doUpdateCheck(false));
ipcMain.handle('update:apply', () => applyUpdate(() => app.quit()));

// ---------- Compte Minecraft officiel (capes officielles) ----------
// Vue publique d'une session : jamais de token vers l'UI, seulement le profil utile.
function mcView(session) {
  if (!session || !session.profile) return { connected: false };
  const p = session.profile;
  const capes = (p.capes || []).map((c) => ({ id: c.id, alias: c.alias || c.id, state: c.state, url: c.url }));
  return {
    connected: true,
    name: p.name,
    id: p.id,
    capes,
    activeCapeId: (capes.find((c) => c.state === 'ACTIVE') || {}).id || '',
    expiresAt: session.expiresAt || null,
    canRefresh: !!session.msRefreshToken,
  };
}

// Renvoie une session Minecraft avec un accessToken valide : rafraîchit via le refresh
// token Microsoft si expiré (et si dispo). Persiste la session rafraîchie.
async function ensureMcSession() {
  const session = getMcSession();
  if (!session) return null;
  const fresh = session.expiresAt && Date.now() < session.expiresAt - 30000;
  if (fresh) return session;
  if (!session.msRefreshToken) return session; // token direct : on tente tel quel
  const clientId = getSettings().mcClientId;
  if (!clientId) return session;
  try {
    const renewed = await mc.refreshSession(clientId, session.msRefreshToken);
    // Un refresh qui ne ramène pas de profil (ex. 404 transitoire) ne doit PAS écraser la
    // session valide déjà en place -> on conserve l'ancienne.
    if (!renewed || !renewed.profile) return session;
    setMcSession(renewed);
    return renewed;
  } catch {
    return session; // échec de refresh : on laisse l'appel échouer en 401 -> l'UI proposera de se reconnecter
  }
}

let mcLoginState = null; // { cancelled } pour interrompre le device-code en cours

ipcMain.handle('mc:status', async () => {
  // ensureMcSession rafraîchit le token s'il est expiré (et rafraîchissable) : au
  // rouvrir l'app, le profil et les capes sont à jour sans reconnexion.
  const session = await ensureMcSession();
  return { ok: true, ...mcView(session) };
});

// Connexion par token Minecraft direct (colle un access token).
ipcMain.handle('mc:loginToken', async (_e, token) => {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Token vide.' };
  try {
    const session = await mc.loginWithToken(t);
    const saved = setMcSession(session);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, ...mcView(session) };
  } catch (e) {
    return { ok: false, error: e.message || 'Connexion impossible.' };
  }
});

// Connexion Microsoft (device code). Émet 'mc-code' avec le code à saisir, puis attend.
ipcMain.handle('mc:loginMicrosoft', async () => {
  const clientId = getSettings().mcClientId;
  if (!clientId) return { ok: false, error: 'Renseigne d’abord l’Azure Client ID (Réglages → Compte Minecraft).' };
  mcLoginState = { cancelled: false };
  const state = mcLoginState;
  try {
    const dc = await mc.requestDeviceCode(clientId);
    if (state.cancelled) return { ok: false, error: 'Connexion annulée.' }; // annulé pendant la requête -> ne pas ré-afficher le code
    send('mc-code', { userCode: dc.user_code, verificationUri: dc.verification_uri, expiresIn: dc.expires_in });
    try { shell.openExternal(dc.verification_uri); } catch {}
    const session = await mc.pollDeviceCode(clientId, dc.device_code, dc.interval, dc.expires_in, () => state.cancelled);
    const saved = setMcSession(session);
    if (!saved.ok) return { ok: false, error: saved.error };
    return { ok: true, ...mcView(session) };
  } catch (e) {
    return { ok: false, error: e.message || 'Connexion Microsoft impossible.' };
  } finally {
    if (mcLoginState === state) mcLoginState = null;
  }
});

ipcMain.handle('mc:cancelLogin', () => { if (mcLoginState) mcLoginState.cancelled = true; return { ok: true }; });

ipcMain.handle('mc:logout', () => { clearMcSession(); return { ok: true, connected: false }; });

// Rafraîchit le profil (relit les capes officielles depuis l'API).
ipcMain.handle('mc:refresh', async () => {
  const session = await ensureMcSession();
  if (!session) return { ok: false, error: 'Non connecté.' };
  try {
    const profile = await mc.getProfile(session.accessToken);
    if (!profile) return { ok: false, error: 'Aucun profil Java sur ce compte.' };
    const updated = { ...session, profile };
    setMcSession(updated);
    return { ok: true, ...mcView(updated) };
  } catch (e) {
    return { ok: false, error: e.message || 'Lecture du profil impossible.' };
  }
});

// Active une cape officielle du compte.
ipcMain.handle('mc:setCape', async (_e, capeId) => {
  const session = await ensureMcSession();
  if (!session) return { ok: false, error: 'Non connecté.' };
  if (!capeId) return { ok: false, error: 'Cape non spécifiée.' };
  try {
    const profile = await mc.setActiveCape(session.accessToken, capeId);
    const updated = { ...session, profile };
    setMcSession(updated);
    return { ok: true, ...mcView(updated) };
  } catch (e) {
    return { ok: false, error: e.message || 'Activation impossible.' };
  }
});

// Renvoie la texture d'une cape officielle en data URL (récupérée côté main, hors CSP).
// L'URL n'est JAMAIS fournie par le renderer : on la lit dans le profil du compte
// connecté, puis fetchCapeTexture filtre l'hôte (anti-SSRF) et exige un vrai PNG.
ipcMain.handle('mc:capeTexture', async (_e, capeId) => {
  try {
    const session = getMcSession();
    if (!session || !session.profile) return { ok: false };
    const cape = (session.profile.capes || []).find((c) => c.id === capeId);
    if (!cape || !cape.url) return { ok: false };
    const dataUrl = await mc.fetchCapeTexture(cape.url);
    return dataUrl ? { ok: true, dataUrl } : { ok: false };
  } catch { return { ok: false }; }
});

// Ajoute une cape officielle à la bibliothèque locale (utilisable sur le canal OptiFine,
// dans le créateur et l'aperçu) : récupère la texture et l'enregistre comme cape custom.
ipcMain.handle('mc:importCape', async (_e, capeId) => {
  try {
    const session = getMcSession();
    if (!session || !session.profile) return { ok: false, error: 'Non connecté.' };
    const cape = (session.profile.capes || []).find((c) => c.id === capeId);
    if (!cape || !cape.url) return { ok: false, error: 'Cape introuvable.' };
    const dataUrl = await mc.fetchCapeTexture(cape.url);
    if (!dataUrl) return { ok: false, error: 'Texture indisponible.' };
    const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
    return importCapeBuffer(buf, cape.alias || 'Cape officielle');
  } catch (e) { return { ok: false, error: e.message || 'Import impossible.' }; }
});

// Masque la cape officielle (aucune cape).
ipcMain.handle('mc:hideCape', async () => {
  const session = await ensureMcSession();
  if (!session) return { ok: false, error: 'Non connecté.' };
  try {
    const profile = await mc.hideCape(session.accessToken);
    const updated = { ...session, profile };
    setMcSession(updated);
    return { ok: true, ...mcView(updated) };
  } catch (e) {
    return { ok: false, error: e.message || 'Masquage impossible.' };
  }
});

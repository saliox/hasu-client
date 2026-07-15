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
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initCapes, listCapes, importCape, importCapeBuffer, deleteCape, renameCape, resolveCape, readCape } from './src/capes.js';
import { initStore, getSettings, saveSettings, setToken, getToken } from './src/store.js';
import { startProxy, stopProxy, isRunning, getStats, proxyEvents, redirectHosts } from './src/proxy.js';
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
  return { ok: true, capes: listCapes(), active: s.activeCape, favorites: s.favorites };
});
ipcMain.handle('capes:import', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir un ou plusieurs PNG de cape',
    filters: [{ name: 'Cape PNG', extensions: ['png'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, canceled: true };
  let imported = 0; const errors = [];
  for (const p of r.filePaths) {
    const res = importCape(p);
    if (res.ok) imported++; else errors.push(res.error);
  }
  if (!imported) return { ok: false, error: errors[0] || 'Aucune cape importée.' };
  return { ok: true, imported, failed: errors.length };
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
  if (buf.length > 2 * 1024 * 1024) return { ok: false, error: 'Image trop lourde.' };
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

ipcMain.handle('games:current', () => ({ ok: true, games: currentGames() }));

ipcMain.handle('update:check', () => doUpdateCheck(false));
ipcMain.handle('update:apply', () => applyUpdate(() => app.quit()));

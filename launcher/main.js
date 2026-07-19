// Hasu Launcher — processus principal Electron.
//
// Rôle : connecter le compte Microsoft (device code), préparer puis lancer
// Minecraft 1.8.9 + Forge (bibliothèques, natives, assets, JRE Mojang intégré),
// relayer les logs du jeu vers la console du launcher, et gérer l'auto-update
// signé SHA-256 — le tout dans une fenêtre verrouillée (sandbox, CSP stricte).
import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initStore, getSettings, saveSettings, setMcSession, getMcSession, clearMcSession } from './src/store.js';
import * as ms from './src/msauth.js';
import { getVersionManifest } from './src/mojang.js';
import { prepareAndLaunch, stopGame, isGameRunning, offlineUuid } from './src/launch.js';
import { checkForUpdates, applyUpdate } from './src/updater.js';
import { FORGE_MC_VERSION, FORGE_BUILD } from './src/forge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let win = null;

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
    width: 1120, height: 720, minWidth: 940, minHeight: 620,
    backgroundColor: '#0b0f17', title: 'Hasu Launcher',
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

// Dossier du jeu : réglage utilisateur, sinon userData/minecraft (isolé du .minecraft
// officiel pour ne jamais toucher l'installation vanilla du joueur).
function gameDir() {
  const s = getSettings();
  return s.gameDir || path.join(app.getPath('userData'), 'minecraft');
}

// --- Compte : session prête à jouer (refresh silencieux si expirée) ---
async function readySession() {
  const session = getMcSession();
  if (!session) return null;
  if (session.expiresAt && Date.now() < session.expiresAt && session.profile) return session;
  if (!session.msRefreshToken) return session.profile ? session : null;
  const s = getSettings();
  try {
    const fresh = await ms.refreshSession(s.mcClientId, session.msRefreshToken);
    setMcSession(fresh);
    return fresh;
  } catch {
    // Refresh impossible (hors-ligne / token révoqué) : on garde l'ancienne session si
    // elle a un profil — le bouton « Jouer en hors-ligne » reste disponible de toute façon.
    return session.profile ? session : null;
  }
}

function accountView(session) {
  if (!session?.profile) return { connected: false };
  return { connected: true, name: session.profile.name, uuid: session.profile.id };
}

// --- IPC ---
ipcMain.handle('settings:get', () => ({
  ...getSettings(),
  appVersion: app.getVersion(),
  defaultGameDir: path.join(app.getPath('userData'), 'minecraft'),
  forgeMc: FORGE_MC_VERSION,
  forgeBuild: FORGE_BUILD,
}));
ipcMain.handle('settings:save', (e, patch) => saveSettings(patch && typeof patch === 'object' ? patch : {}));

ipcMain.handle('dir:choose', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  saveSettings({ gameDir: r.filePaths[0] });
  return r.filePaths[0];
});
ipcMain.handle('dir:open', () => { try { shell.openPath(gameDir()); } catch {} });

ipcMain.handle('account:status', async () => accountView(getMcSession()));
ipcMain.handle('account:logout', () => { clearMcSession(); return { connected: false }; });

let loginCancelled = false;
ipcMain.handle('account:login-start', async () => {
  const s = getSettings();
  loginCancelled = false;
  const dc = await ms.requestDeviceCode(s.mcClientId);
  // Le poll continue en arrière-plan ; le résultat arrive par l'événement account-changed.
  (async () => {
    try {
      const session = await ms.pollDeviceCode(s.mcClientId, dc.device_code, dc.interval, dc.expires_in, () => loginCancelled);
      if (!session.profile) throw new Error('Compte Microsoft valide mais sans profil Minecraft Java.');
      const saved = setMcSession(session);
      send('account-changed', { ...accountView(session), warning: saved.ok ? null : saved.error });
    } catch (err) {
      if (!loginCancelled) send('account-changed', { connected: false, error: err.message });
    }
  })();
  return { userCode: dc.user_code, url: dc.verification_uri };
});
ipcMain.handle('account:login-cancel', () => { loginCancelled = true; });

ipcMain.handle('versions:list', async () => {
  try {
    const m = await getVersionManifest();
    return m.versions.filter((v) => v.type === 'release').map((v) => v.id);
  } catch {
    return [FORGE_MC_VERSION]; // hors-ligne : au moins la version du client
  }
});

ipcMain.handle('game:launch', async (e, { offline } = {}) => {
  if (isGameRunning()) return { ok: false, error: 'Le jeu tourne déjà.' };
  const s = getSettings();
  let session;
  if (offline) {
    const name = (s.offlineName || 'Joueur').replace(/[^A-Za-z0-9_]/g, '').slice(0, 16) || 'Joueur';
    session = { name, uuid: offlineUuid(name), accessToken: '0', userType: 'legacy' };
  } else {
    const live = await readySession();
    if (!live?.profile) return { ok: false, error: 'Aucun compte connecté — connecte-toi ou joue en hors-ligne.' };
    session = { name: live.profile.name, uuid: live.profile.id, accessToken: live.accessToken, userType: 'msa' };
  }
  try {
    const r = await prepareAndLaunch(
      {
        gameDir: gameDir(),
        versionId: s.versionId || FORGE_MC_VERSION,
        // Forge n'est fourni que pour la version du client (1.8.9).
        forge: s.forge && (s.versionId || FORGE_MC_VERSION) === FORGE_MC_VERSION,
        session,
        ramMb: s.ramMb,
      },
      {
        onStage: (stage) => send('game-stage', stage),
        onProgress: (p) => send('game-progress', p),
        onLog: (line) => send('game-log', line),
        onExit: (code) => send('game-exit', { code }),
      },
    );
    return { ok: true, pid: r.pid };
  } catch (err) {
    send('game-exit', { code: null, error: err.message });
    return { ok: false, error: err.message };
  }
});
ipcMain.handle('game:stop', () => { stopGame(); return { ok: true }; });
ipcMain.handle('game:running', () => isGameRunning());

ipcMain.handle('update:check', () => checkForUpdates(app.getVersion()));
ipcMain.handle('update:apply', () => applyUpdate(() => app.quit(), (p) => send('update-progress', p)));

ipcMain.handle('open:external', (e, url) => {
  try {
    const u = new URL(String(url));
    if (u.protocol === 'https:') shell.openExternal(u.href);
  } catch {}
});

app.whenReady().then(() => {
  initStore(app.getPath('userData'), safeStorage);
  fs.mkdirSync(gameDir(), { recursive: true });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

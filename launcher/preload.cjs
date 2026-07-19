// Pont IPC verrouillé (contextIsolation) : le renderer n'a accès qu'à cette API,
// jamais à Node directement.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);
const on = (ch) => (cb) => { ipcRenderer.on(ch, (e, data) => cb(data)); };

contextBridge.exposeInMainWorld('hasu', {
  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
  },

  account: {
    status: () => invoke('account:status'),
    loginStart: () => invoke('account:login-start'),   // -> { userCode, url }
    loginCancel: () => invoke('account:login-cancel'),
    logout: () => invoke('account:logout'),
    onChanged: on('account-changed'),
  },

  game: {
    launch: (opts) => invoke('game:launch', opts),     // opts: { offline }
    stop: () => invoke('game:stop'),
    running: () => invoke('game:running'),
    versions: () => invoke('versions:list'),
    onStage: on('game-stage'),
    onProgress: on('game-progress'),
    onLog: on('game-log'),
    onExit: on('game-exit'),
  },

  dirs: {
    choose: () => invoke('dir:choose'),
    open: () => invoke('dir:open'),
  },

  update: {
    check: () => invoke('update:check'),
    apply: () => invoke('update:apply'),
    onProgress: on('update-progress'),
  },

  openExternal: (url) => invoke('open:external', url),
});

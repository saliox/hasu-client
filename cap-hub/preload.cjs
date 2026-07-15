// Pont IPC verrouillé (contextIsolation) : le renderer n'a accès qu'à cette API,
// jamais à Node directement.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (ch, ...a) => ipcRenderer.invoke(ch, ...a);

contextBridge.exposeInMainWorld('cap', {
  version: () => invoke('app:version'),

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    setToken: (t) => invoke('settings:setToken', t),
  },

  capes: {
    list: () => invoke('capes:list'),
    import: () => invoke('capes:import'),
    remove: (id) => invoke('capes:remove', id),
    setActive: (id) => invoke('capes:setActive', id),
    preview: (id) => invoke('capes:preview', id), // -> data URL
    publish: () => invoke('capes:publish'),
  },

  proxy: {
    status: () => invoke('proxy:status'),
    start: () => invoke('proxy:start'),
    stop: () => invoke('proxy:stop'),
    applyRedirect: () => invoke('proxy:applyRedirect'),
    removeRedirect: () => invoke('proxy:removeRedirect'),
    enableAll: () => invoke('proxy:enableAll'),
  },

  registry: {
    refresh: () => invoke('registry:refresh'),
    players: () => invoke('registry:players'),
  },

  games: {
    current: () => invoke('games:current'),
  },

  update: {
    check: () => invoke('update:check'),
    apply: () => invoke('update:apply'),
  },

  // Événements poussés par le main -> UI.
  on: (channel, cb) => {
    const allowed = ['log', 'game-start', 'game-stop', 'update-status', 'proxy-changed'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});

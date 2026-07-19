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
    create: (name, dataUrl) => invoke('capes:create', name, dataUrl),
    rename: (id, name) => invoke('capes:rename', id, name),
    favorite: (id, on) => invoke('capes:favorite', id, on),
    setCategory: (id, cat) => invoke('capes:setCategory', id, cat),
    pickImage: () => invoke('capes:pickImage'),
    setActive: (id) => invoke('capes:setActive', id),
    preview: (id) => invoke('capes:preview', id), // -> data URL
    duplicate: (id) => invoke('capes:duplicate', id),
    export: (id) => invoke('capes:export', id),
    publish: () => invoke('capes:publish'),
    dims: (id) => invoke('capes:dims', id),                        // -> { ow, oh, sw, sh } (léger)
    setImage: (id, dataUrl) => invoke('capes:setImage', id, dataUrl), // écrase l'image d'une cape (édition sur place)
    original: (id) => invoke('capes:original', id),               // -> data URL de la version d'origine
    setResolution: (id, dataUrl) => invoke('capes:setResolution', id, dataUrl), // dataUrl null = restaurer
  },

  proxy: {
    status: () => invoke('proxy:status'),
    start: () => invoke('proxy:start'),
    stop: () => invoke('proxy:stop'),
    applyRedirect: () => invoke('proxy:applyRedirect'),
    removeRedirect: () => invoke('proxy:removeRedirect'),
    enableAll: () => invoke('proxy:enableAll'),
    selfTest: () => invoke('proxy:selfTest'),
  },

  registry: {
    refresh: () => invoke('registry:refresh'),
    players: () => invoke('registry:players'),
    cape: (name) => invoke('registry:cape', name), // -> data URL de la cape d'un joueur
  },

  games: {
    current: () => invoke('games:current'),
  },

  update: {
    check: () => invoke('update:check'),
    apply: () => invoke('update:apply'),
  },

  // Compte Minecraft officiel (capes officielles Mojang).
  mc: {
    status: () => invoke('mc:status'),
    loginToken: (token) => invoke('mc:loginToken', token),
    loginMicrosoft: () => invoke('mc:loginMicrosoft'),
    cancelLogin: () => invoke('mc:cancelLogin'),
    logout: () => invoke('mc:logout'),
    refresh: () => invoke('mc:refresh'),
    setCape: (capeId) => invoke('mc:setCape', capeId),
    hideCape: () => invoke('mc:hideCape'),
    capeTexture: (capeId) => invoke('mc:capeTexture', capeId), // -> data URL (texture Mojang)
    importCape: (capeId) => invoke('mc:importCape', capeId),   // -> ajoute à la bibliothèque
    skin: () => invoke('mc:skin'),                             // -> data URL du skin connecté
  },

  // Événements poussés par le main -> UI.
  on: (channel, cb) => {
    const allowed = ['log', 'game-start', 'game-stop', 'update-status', 'update-progress', 'proxy-changed', 'mc-code'];
    if (!allowed.includes(channel)) return () => {};
    const h = (_e, data) => cb(data);
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  },
});

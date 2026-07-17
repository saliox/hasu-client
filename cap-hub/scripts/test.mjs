// Tests hors-Electron du moteur Cap Hub : capes (génération + validation), fournisseur
// OptiFine, géométrie d'aperçu, et proxy HTTP (résolution own > registre > relais).
// Aucune dépendance réseau : le relais amont est injecté (stub). Aucune CA, aucun TLS.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// import() dynamique : sur Windows un chemin absolu (D:\...) doit être une URL file://.
const S = (f) => pathToFileURL(path.join(root, 'src', f)).href;

const { initCapes, listCapes, importCape, importCapeBuffer, validateCape, readCape, resolveCape, renameCape } = await import(S('capes.js'));
const { isPng, readPngSize, encodePNG, decodePNG, firstFrameIfAnimated, capeFrames } = await import(S('png.js'));
const providers = await import(S('providers.js'));
const proxy = await import(S('proxy.js'));
const geom = await import(S('capegeom.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', name); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', name); } };
const mkPng = (w, h) => encodePNG(w, h, Buffer.alloc(w * h * 4, 180));

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'caphub-test-'));
initCapes(ud);

console.log('\n# Capes');
const capes = listCapes();
ok('≥ 60 capes intégrées', capes.filter((c) => c.builtin).length >= 60);
ok('palette unie présente (Uni …)', capes.filter((c) => c.builtin && c.name.startsWith('Uni ')).length >= 30);
ok('cape intégrée 64x32 PNG', (() => { const b = readCape(capes[0].id); return isPng(b) && readPngSize(b).width === 64; })());
ok('valide 64x32 / 46x22, rejette 40x40',
  validateCape(mkPng(64, 32)).ok && validateCape(mkPng(46, 22)).ok && !validateCape(mkPng(40, 40)).ok);
ok('accepte animée 64x64 (2 img)', (() => { const v = validateCape(mkPng(64, 64)); return v.ok && v.frames === 2; })());
ok('accepte animée 64x96 (3 img)', validateCape(mkPng(64, 96)).frames === 3);
ok('accepte HD 256x128', validateCape(mkPng(256, 128)).ok && validateCape(mkPng(256, 128)).frames === 1);
ok('accepte 4K 4096x2048', validateCape(mkPng(4096, 2048)).ok);
ok('rejette 64x48 (hauteur invalide)', validateCape(mkPng(64, 48)).ok === false);
ok('capeFrames 64x64=2, 128x64=1', capeFrames(64, 64) === 2 && capeFrames(128, 64) === 1);
ok('firstFrameIfAnimated 64x64 -> 64x32', (() => { const ff = firstFrameIfAnimated(mkPng(64, 64)); const s = readPngSize(ff); return s.width === 64 && s.height === 32; })());
ok('firstFrameIfAnimated laisse une cape fixe intacte', (() => { const p = mkPng(64, 32); return firstFrameIfAnimated(p) === p; })());
ok('decodePNG round-trip couleur', (() => { const p = encodePNG(2, 1, Buffer.from([10, 20, 30, 255, 40, 50, 60, 255])); const d = decodePNG(p); return d && d.rgba[0] === 10 && d.rgba[6] === 60; })());
const src = path.join(ud, 'in.png'); fs.writeFileSync(src, mkPng(64, 32));
const imp = importCape(src, 'x/../y');
ok('import assaini (pas de ..)', imp.ok && !imp.id.includes('..'));
ok('resolveCape bloque la traversée', resolveCape('../../etc/passwd') === null);
// Renommage (multi-capes)
const rn = renameCape(imp.id, 'Ma Belle Cape');
ok('renomme une cape importée', rn.ok && rn.id === 'Ma Belle Cape.png' && !!resolveCape(rn.id));
ok('refuse de renommer une intégrée', renameCape(capes.find((c) => c.builtin).id, 'X').ok === false);
// Création depuis buffer (créateur)
const cr = importCapeBuffer(mkPng(64, 32), 'Cape créée');
ok('crée une cape depuis un buffer', cr.ok && !!resolveCape(cr.id));
ok('rejette un buffer non-cape', importCapeBuffer(Buffer.from('nope'), 'X').ok === false);

console.log('\n# Réglages (favoris / catégories)');
const store = await import(S('store.js'));
store.initStore(ud, { isEncryptionAvailable: () => false });
let ss = store.saveSettings({ favorites: ['a.png', 'a.png', 'b.png'] });
ok('favoris dédupliqués + persistés', ss.favorites.length === 2 && store.getSettings().favorites.includes('b.png'));
ss = store.saveSettings({ categories: { 'x.png': 'Cool', 'y.png': '  ' } });
ok('catégories nettoyées (vide ignoré)', ss.categories['x.png'] === 'Cool' && !('y.png' in ss.categories));
ok('thème par défaut = nuit', store.getSettings().theme === 'nuit');

console.log('\n# Fournisseur OptiFine (seul canal)');
ok('un seul fournisseur : optifine', providers.PROVIDERS.length === 1 && providers.PROVIDERS[0].id === 'optifine');
ok('parse /capes/Notch.png', providers.byId('optifine').parse('/capes/Notch.png')?.key === 'Notch');
ok('ignore autre URL', providers.byId('optifine').parse('/x') === null);
ok('enabledHosts = s.optifine.net', JSON.stringify(providers.enabledHosts()) === '["s.optifine.net"]');
ok('hostIndex route s.optifine.net', providers.hostIndex().has('s.optifine.net'));

console.log('\n# Géométrie de cape (aperçu)');
ok('64x32 = 1 frame', geom.frameCount(64, 32) === 1 && !geom.isAnimated(64, 32));
ok('64x64 = 2 frames (animée)', geom.frameCount(64, 64) === 2 && geom.isAnimated(64, 64));
ok('128x64 HD = 1 frame', geom.frameCount(128, 64) === 1);
ok('front rect 64x32 = 10x16 @ (1,1)', (() => { const r = geom.capeFrontRect(64, 32, 0); return r.x === 1 && r.y === 1 && r.w === 10 && r.h === 16; })());
ok('front rect frame 1 décalé', geom.capeFrontRect(64, 64, 1).y === 33);

console.log('\n# Proxy HTTP (OptiFine)');
const myCape = readCape(rn.id); // cape importée puis renommée
const regCape = readCape(capes[0].id);
// Relais amont injecté : 404 partout (aucun réseau).
const animCape = mkPng(64, 64); // cape animée (2 images)
const deps = {
  getOwn: async (n) => (n === 'notch' ? myCape : n === 'anim' ? animCape : null),
  getRegistryCape: async (n) => (n === 'dieu' ? regCape : null),
  upstream: async () => ({ status: 0, body: null }),
};
const st = await proxy.startProxy(deps, { port: 0 });
ok('proxy démarre (HTTP seul)', st.ok && st.port > 0);

const get = (host, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port: st.port, path: p, headers: { host } }, (res) => {
    const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c) }));
  }).on('error', () => resolve({ status: 0 }));
});

const a = await get('s.optifine.net', '/capes/Notch.png');
ok('sert MA cape (PNG 200)', a.status === 200 && isPng(a.buf));
const b = await get('s.optifine.net', '/capes/Dieu.png');
ok('sert cape registre (PNG 200)', b.status === 200 && isPng(b.buf));
const an = await get('s.optifine.net', '/capes/Anim.png');
ok('cape animée servie en 1re frame 64x32', an.status === 200 && readPngSize(an.buf).height === 32);
const c = await get('s.optifine.net', '/capes/Personne.png');
ok('inconnu (relais vide) -> 404', c.status === 404);
const d = await get('s.optifine.net', '/capes/bad$name.png');
ok('pseudo invalide -> 404', d.status === 404);
const e = await get('autre.domaine.net', '/capes/Notch.png');
ok('domaine non géré -> 404', e.status === 404);
const s2 = await get('s.optifine.net', '/caphub/status');
ok('endpoint /caphub/status', s2.status === 200);

await proxy.stopProxy();

console.log('\n# Registre : publication sans écraser les autres joueurs');
const reg = await import(S('registry.js'));
reg.initRegistry(ud, {});
const puts = [];
const origFetch = global.fetch;
// Stub réseau : le PNG n'existe pas encore ; capes.json distant contient déjà « other ».
global.fetch = async (url, opts = {}) => {
  url = String(url); const method = opts.method || 'GET';
  const R = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
  if (url.includes('/registry/capes/')) return method === 'PUT' ? R(200, {}) : R(404, null);
  if (url.includes('/registry/capes.json')) {
    if (method === 'PUT') { puts.push(JSON.parse(opts.body)); return R(200, {}); }
    const content = Buffer.from(JSON.stringify({ format: 1, players: { other: { cape: 'capes/other.png', updated: '2026-01-01' } } })).toString('base64');
    return R(200, { sha: 'abc', content });
  }
  return R(500, {});
};
const pr = await reg.publishCape('tok', 'newguy', mkPng(64, 32));
global.fetch = origFetch;
ok('publishCape réussit', pr.ok === true);
const idxPut = puts.map((p) => { try { return JSON.parse(Buffer.from(p.content, 'base64').toString('utf8')).players; } catch { return null; } }).find(Boolean) || {};
ok('fusionne « newguy » SANS effacer « other »', !!idxPut.other && !!idxPut.newguy);
ok('réutilise le sha distant (pas d’écrasement aveugle)', puts.some((p) => p.sha === 'abc'));

console.log('\n# Compte Minecraft officiel (mcaccount)');
const mc = await import(S('mcaccount.js'));
const PROFILE = { id: 'uuid1', name: 'Steve', capes: [{ id: 'cap-a', state: 'ACTIVE', alias: 'Migrator', url: 'https://tex/a' }, { id: 'cap-b', state: 'INACTIVE', alias: 'MineCon', url: 'https://tex/b' }] };
// Mock de toute la chaîne MS -> XBL -> XSTS -> MC + profil/capes. Aucun vrai réseau.
function mcFetch(state = {}) {
  return async (url, opts = {}) => {
    url = String(url); const method = opts.method || 'GET';
    const R = (status, obj) => ({ ok: status < 400, status, json: async () => obj, text: async () => JSON.stringify(obj) });
    if (url.includes('/devicecode')) return R(200, { device_code: 'DC', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/link', interval: 0, expires_in: 900 });
    if (url.endsWith('/token')) return R(200, { access_token: 'ms-access', refresh_token: 'ms-refresh', expires_in: 3600 });
    if (url.includes('user.auth.xboxlive.com')) return R(200, { Token: 'xbl-tok', DisplayClaims: { xui: [{ uhs: 'userhash' }] } });
    if (url.includes('xsts.auth.xboxlive.com')) return R(200, { Token: 'xsts-tok', DisplayClaims: { xui: [{ uhs: 'userhash' }] } });
    if (url.includes('/authentication/login_with_xbox')) return R(200, { access_token: 'mc-access', expires_in: 86400 });
    if (url.includes('/minecraft/profile/capes/active')) {
      state.lastCapeOp = { method, body: opts.body ? JSON.parse(opts.body) : null };
      return method === 'DELETE' ? R(200, {}) : R(200, { ...PROFILE, capes: PROFILE.capes.map((c) => ({ ...c, state: c.id === JSON.parse(opts.body).capeId ? 'ACTIVE' : 'INACTIVE' })) });
    }
    if (url.includes('/minecraft/profile')) {
      if (state.profile401) return R(401, {});
      if (state.noProfile) return R(404, {});
      return R(200, PROFILE);
    }
    return R(500, {});
  };
}
const realFetch = global.fetch;
global.fetch = mcFetch();
const prof = await mc.getProfile('mc-access');
ok('getProfile renvoie name + 2 capes', prof.name === 'Steve' && prof.capes.length === 2);
const tokSession = await mc.loginWithToken('mc-access');
ok('loginWithToken -> session avec profil', tokSession.accessToken === 'mc-access' && tokSession.profile.name === 'Steve');
let st1 = {}; global.fetch = mcFetch(st1);
const afterSet = await mc.setActiveCape('mc-access', 'cap-b');
ok('setActiveCape PUT le bon capeId', st1.lastCapeOp.method === 'PUT' && st1.lastCapeOp.body.capeId === 'cap-b');
ok('setActiveCape renvoie la cape activée', afterSet.capes.find((c) => c.id === 'cap-b').state === 'ACTIVE');
let st2 = {}; global.fetch = mcFetch(st2);
await mc.hideCape('mc-access');
ok('hideCape envoie un DELETE', st2.lastCapeOp.method === 'DELETE');
// Chaîne Microsoft complète (refresh -> XBL -> XSTS -> MC -> profil).
global.fetch = mcFetch();
const msSession = await mc.refreshSession('client-id', 'ms-refresh');
ok('refreshSession chaîne jusqu’au profil', msSession.accessToken === 'mc-access' && msSession.profile.name === 'Steve' && msSession.msRefreshToken === 'ms-refresh');
ok('refreshSession pose expiresAt futur', msSession.expiresAt > Date.now());
const dc = await mc.requestDeviceCode('client-id');
ok('requestDeviceCode renvoie user_code', dc.user_code === 'ABCD-EFGH');
let threw = false; global.fetch = mcFetch({ profile401: true });
try { await mc.getProfile('bad'); } catch { threw = true; }
ok('getProfile 401 -> exception', threw);
global.fetch = mcFetch({ noProfile: true });
ok('getProfile 404 -> null', (await mc.getProfile('x')) === null);
let threw2 = false; global.fetch = mcFetch({ noProfile: true });
try { await mc.loginWithToken('x'); } catch { threw2 = true; }
ok('loginWithToken sans profil Java -> exception', threw2);
// Messages d'erreur device-code (mappings validés contre l'endpoint Microsoft live).
global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'unauthorized_client', error_description: 'AADSTS700016: Application with identifier X was not found in the directory' }) });
ok('device-code AADSTS700016 -> « Client ID introuvable »', await mc.requestDeviceCode('x').then(() => '', (e) => e.message).then((m) => /Client ID introuvable/.test(m)));
global.fetch = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000218 public client required' }) });
ok('device-code invalid_client -> « public client flows »', await mc.requestDeviceCode('x').then(() => '', (e) => e.message).then((m) => /public client flows/.test(m)));

console.log('\n# Texture de cape officielle (anti-SSRF)');
const capePng = mkPng(64, 32);
let didFetch = false;
global.fetch = async () => { didFetch = true; return { ok: true, arrayBuffer: async () => capePng }; };
ok('texture : hôte Mojang + PNG -> data URL', (await mc.fetchCapeTexture('http://textures.minecraft.net/texture/abc') || '').startsWith('data:image/png;base64,'));
didFetch = false;
ok('texture : hôte non-Mojang -> null SANS fetch (anti-SSRF)', (await mc.fetchCapeTexture('http://textures.minecraft.net.evil.com/x')) === null && didFetch === false);
ok('texture : URL invalide -> null', (await mc.fetchCapeTexture('pas une url')) === null);
global.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.from('pas du png') });
ok('texture : corps non-PNG -> null', (await mc.fetchCapeTexture('http://textures.minecraft.net/x')) === null);
global.fetch = async () => ({ ok: true, arrayBuffer: async () => Buffer.alloc(600 * 1024) });
ok('texture : trop lourde -> null', (await mc.fetchCapeTexture('http://textures.minecraft.net/x')) === null);

global.fetch = realFetch;
await mc.requestDeviceCode('').catch(() => {}); // ne doit pas planter le process
ok('requestDeviceCode sans clientId -> rejette', await mc.requestDeviceCode('').then(() => false, () => true));

console.log('\n# Session MC persistée (chiffrée)');
const enc = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('e:' + s, 'utf8'), decryptString: (b) => b.toString('utf8').slice(2) };
store.initStore(ud, enc);
const sess = { accessToken: 'a', msRefreshToken: 'r', expiresAt: 123, profile: PROFILE };
const setRes = store.setMcSession(sess);
ok('setMcSession chiffre + persiste', setRes.ok && setRes.encrypted);
const back = store.getMcSession();
ok('getMcSession round-trip', back && back.accessToken === 'a' && back.profile.name === 'Steve');
ok('hasMcSession exposé dans les réglages', store.getSettings().hasMcSession === true);
ok('mcClientId persiste', store.saveSettings({ mcClientId: 'guid-123' }).mcClientId === 'guid-123');
store.clearMcSession();
ok('clearMcSession efface la session', store.getMcSession() === null && store.getSettings().hasMcSession === false);
store.initStore(ud, { isEncryptionAvailable: () => false });
ok('setMcSession refuse sans chiffrement (pas de tokens en clair)', store.setMcSession(sess).ok === false);

fs.rmSync(ud, { recursive: true, force: true });

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} OK, ${fail} KO\x1b[0m`);
process.exit(fail ? 1 : 0);

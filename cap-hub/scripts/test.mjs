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
const { isPng, readPngSize, encodePNG } = await import(S('png.js'));
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
const deps = {
  getOwn: async (n) => (n === 'notch' ? myCape : null),
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

fs.rmSync(ud, { recursive: true, force: true });

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} OK, ${fail} KO\x1b[0m`);
process.exit(fail ? 1 : 0);

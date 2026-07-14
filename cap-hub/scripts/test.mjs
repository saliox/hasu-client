// Tests hors-Electron du moteur Cap Hub : capes, fournisseurs, CA/TLS, proxy
// multi-canaux (HTTP OptiFine + HTTPS MinecraftCapes) et résolution own>registre>relais.
// Aucune dépendance réseau : le relais amont est injecté (stub).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const S = (f) => path.join(root, 'src', f);

const { initCapes, listCapes, importCape, validateCape, readCape, resolveCape } = await import(S('capes.js'));
const { isPng, readPngSize, encodePNG } = await import(S('png.js'));
const providers = await import(S('providers.js'));
const ca = await import(S('ca.js'));
const proxy = await import(S('proxy.js'));

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log('  \x1b[32m✓\x1b[0m', name); } else { fail++; console.log('  \x1b[31m✗\x1b[0m', name); } };
const mkPng = (w, h) => encodePNG(w, h, Buffer.alloc(w * h * 4, 180));

const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'caphub-test-'));
initCapes(ud);
ca.initCA(ud);

console.log('\n# Capes');
const capes = listCapes();
ok('10 capes intégrées', capes.filter((c) => c.builtin).length === 10);
ok('cape intégrée 64x32 PNG', (() => { const b = readCape(capes[0].id); return isPng(b) && readPngSize(b).width === 64; })());
ok('valide 64x32 / 46x22, rejette 40x40',
  validateCape(mkPng(64, 32)).ok && validateCape(mkPng(46, 22)).ok && !validateCape(mkPng(40, 40)).ok);
const src = path.join(ud, 'in.png'); fs.writeFileSync(src, mkPng(64, 32));
const imp = importCape(src, 'x/../y');
ok('import assaini (pas de ..)', imp.ok && !imp.id.includes('..'));
ok('resolveCape bloque la traversée', resolveCape('../../etc/passwd') === null);

console.log('\n# Fournisseurs');
ok('OptiFine parse /capes/Notch.png', providers.byId('optifine').parse('/capes/Notch.png')?.key === 'Notch');
ok('OptiFine ignore autre URL', providers.byId('optifine').parse('/x') === null);
const mp = providers.byId('minecraftcapes');
ok('MinecraftCapes parse /profile/<uuid>', mp.parse('/profile/' + 'a'.repeat(32))?.keyType === 'uuid');
ok('enabledHosts(optifine) = s.optifine.net', JSON.stringify(providers.enabledHosts(['optifine'])) === '["s.optifine.net"]');
ok('needsCA(optifine)=false', providers.needsCA(['optifine']) === false);
ok('needsCA(minecraftcapes)=true', providers.needsCA(['minecraftcapes']) === true);
ok('MinecraftCapes render injecte la cape', (() => {
  const cape = mkPng(64, 32);
  const up = { status: 200, body: Buffer.from(JSON.stringify({ textures: { skin: 'SKINB64' } })) };
  const out = mp.render({ capePng: cape, upstream: up });
  const j = JSON.parse(out.body.toString());
  return out.status === 200 && j.textures.cape === cape.toString('base64') && j.textures.skin === 'SKINB64';
})());

console.log('\n# CA / TLS');
ca.ensureCA();
ok('CA générée + fichier écrit', ca.caExists() && fs.existsSync(ca.caFilePath()));
const caPem = fs.readFileSync(ca.caFilePath(), 'utf8');
// Handshake réel : serveur TLS présentant un cert Cap Hub, client faisant confiance à la CA.
const tlsOk = await new Promise((resolve) => {
  const srv = https.createServer(
    { SNICallback: (n, cb) => cb(null, ca.secureContextFor(n)) },
    (_req, res) => { res.writeHead(200); res.end('ok'); }
  );
  srv.listen(0, '127.0.0.1', () => {
    const port = srv.address().port;
    https.get({ host: '127.0.0.1', port, servername: 'api.minecraftcapes.net', ca: caPem, headers: { host: 'api.minecraftcapes.net' } },
      (res) => { res.on('data', () => {}); res.on('end', () => { srv.close(); resolve(res.statusCode === 200); }); })
      .on('error', () => { srv.close(); resolve(false); });
  });
});
ok('handshake TLS avec cert Cap Hub OK', tlsOk);

console.log('\n# Proxy multi-canaux');
// cape locale pour "notch", cape registre pour "dieu"; idmap: uuid AAAA... -> "dieu"
const myCape = readCape(imp.id);
const regCape = readCape(capes[0].id);
const UUID = 'd'.repeat(32);
// Stub idmap via le cache disque lu par idmap.initIdMap : on écrit un idmap.json.
fs.writeFileSync(path.join(ud, 'idmap.json'), JSON.stringify({ u2n: { [UUID]: 'dieu' }, n2u: { dieu: UUID } }));
const idmap = await import(S('idmap.js'));
idmap.initIdMap(ud);

// Relais amont injecté (aucun réseau) : renvoie 200 JSON skin pour MinecraftCapes, 404 sinon.
const upstreamStub = async (scheme, host, url) => {
  if (host === 'api.minecraftcapes.net') return { status: 200, body: Buffer.from(JSON.stringify({ textures: { skin: 'REALSKIN' } })) };
  return { status: 0, body: null };
};
const deps = {
  getOwn: async (n) => (n === 'notch' ? myCape : null),
  getRegistryCape: async (n) => (n === 'dieu' ? regCape : null),
  enabledIds: () => ['optifine', 'minecraftcapes'],
  upstream: upstreamStub,
};
const st = await proxy.startProxy(deps, { httpPort: 0, httpsPort: 0 });
ok('proxy démarre HTTP + HTTPS', st.ok && st.http > 0 && st.https > 0);

const httpGet = (port, host, p) => new Promise((resolve) => {
  http.get({ host: '127.0.0.1', port, path: p, headers: { host } }, (res) => {
    const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c) }));
  }).on('error', () => resolve({ status: 0 }));
});
const httpsGet = (port, servername, p) => new Promise((resolve) => {
  https.get({ host: '127.0.0.1', port, path: p, servername, ca: caPem, headers: { host: servername } }, (res) => {
    const c = []; res.on('data', (x) => c.push(x)); res.on('end', () => resolve({ status: res.statusCode, buf: Buffer.concat(c), ct: res.headers['content-type'] }));
  }).on('error', (e) => resolve({ status: 0, err: e.message }));
});

// OptiFine (HTTP) : ma cape
const a = await httpGet(st.http, 's.optifine.net', '/capes/Notch.png');
ok('OptiFine sert MA cape (PNG 200)', a.status === 200 && isPng(a.buf));
// OptiFine inconnu -> relais stub renvoie 0 -> 404
const b = await httpGet(st.http, 's.optifine.net', '/capes/Personne.png');
ok('OptiFine inconnu -> 404', b.status === 404);
// MinecraftCapes (HTTPS) : uuid -> dieu -> cape registre, JSON avec cape injectée + skin préservé
const d = await httpsGet(st.https, 'api.minecraftcapes.net', '/profile/' + UUID);
let dj = {}; try { dj = JSON.parse(d.buf.toString()); } catch {}
ok('MinecraftCapes HTTPS sert cape registre (JSON)', d.status === 200 && dj.textures?.cape === regCape.toString('base64'));
ok('MinecraftCapes préserve le skin amont', dj.textures?.skin === 'REALSKIN');
// MinecraftCapes joueur inconnu -> pas de cape, mais upstream 200 -> renvoie skin amont
fs.writeFileSync(path.join(ud, 'idmap.json'), JSON.stringify({ u2n: { [UUID]: 'dieu', ['e'.repeat(32)]: 'randomguy' }, n2u: {} }));
idmap.initIdMap(ud);
const e = await httpsGet(st.https, 'api.minecraftcapes.net', '/profile/' + 'e'.repeat(32));
ok('MinecraftCapes inconnu -> relais amont (skin réel)', e.status === 200 && JSON.parse(e.buf.toString()).textures?.skin === 'REALSKIN');
// status endpoint
const s2 = await httpGet(st.http, 's.optifine.net', '/caphub/status');
ok('endpoint /caphub/status', s2.status === 200);

await proxy.stopProxy();
fs.rmSync(ud, { recursive: true, force: true });

console.log(`\n${fail ? '\x1b[31m' : '\x1b[32m'}${pass} OK, ${fail} KO\x1b[0m`);
process.exit(fail ? 1 : 0);

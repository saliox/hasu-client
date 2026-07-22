// Proxy local de capes (canal OptiFine, HTTP). Écoute sur 127.0.0.1:80 le trafic de
// s.optifine.net (redirigé via hosts) et répond aux requêtes `GET /capes/<pseudo>.png`.
//
// Ordre de résolution :
//   1. TON pseudo + cape active            -> cape locale
//   2. pseudo présent dans le registre     -> cape du registre
//   3. sinon                               -> RELAIS transparent vers le vrai
//      s.optifine.net (IP réelle résolue en DNS-over-HTTPS), pour ne rien casser aux
//      capes OptiFine des autres joueurs.
//
// SÉCURITÉ : uniquement du HTTP en clair, uniquement sur 127.0.0.1, aucun certificat,
// aucune CA. Le proxy n'est jamais exposé au réseau.
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { hostIndex, enabledHosts } from './providers.js';
import { firstFrameIfAnimated } from './png.js';

export const proxyEvents = new EventEmitter(); // 'log' { level, msg, t }
const log = (level, msg) => proxyEvents.emit('log', { level, msg, t: Date.now() });

// ---------- Résolution DoH de la vraie IP d'un domaine redirigé ----------
const ipCache = new Map(); // host -> { ip, t }
const IP_TTL = 60 * 60 * 1000;

// Rejette les IPv4 loopback / privées / link-local (RFC1918, 169.254/16, 100.64/10 CGNAT,
// 0.0.0.0/8) : le relais ne doit JAMAIS sortir vers une adresse interne, même si la résolution
// DNS du fournisseur était détournée (défense en profondeur contre le SSRF).
function isPublicIpv4(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(ip || ''));
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some((n) => n > 255)) return false;
  const [a, b] = o;
  if (a === 10 || a === 127 || a === 0) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 169 && b === 254) return false;           // link-local
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a >= 224) return false;                          // multicast / réservé
  return true;
}

async function resolveRealIp(host) {
  const c = ipCache.get(host);
  if (c && Date.now() - c.t < IP_TTL) return c.ip;
  for (const url of [
    `https://cloudflare-dns.com/dns-query?name=${host}&type=A`,
    `https://dns.google/resolve?name=${host}&type=A`,
  ]) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      const a = (j.Answer || []).find((x) => x.type === 1 && isPublicIpv4(x.data));
      if (a) { ipCache.set(host, { ip: a.data, t: Date.now() }); return a.data; }
    } catch {}
  }
  throw new Error('IP réelle introuvable pour ' + host);
}

// ---------- Relais vers le vrai serveur OptiFine ----------
const passCache = new Map(); // host+path -> { status, body, t }
const PASS_TTL = 10 * 60 * 1000;
const PASS_MAX = 500;                 // borne le nombre d'entrées (anti-fuite mémoire)
const MAX_BODY = 3 * 1024 * 1024;

function cacheGet(key) {
  const hit = passCache.get(key);
  if (hit && Date.now() - hit.t < PASS_TTL) return hit;
  if (hit) passCache.delete(key);     // purge l'entrée expirée
  return null;
}
function cacheSet(key, entry) {
  passCache.set(key, entry);
  if (passCache.size > PASS_MAX) passCache.delete(passCache.keys().next().value); // éviction FIFO
}

function fetchUpstream(host, urlPath) {
  // Clé de cache indépendante de la query (certains clients ajoutent un cache-buster) :
  // sinon le cache ne « toucherait » jamais et grossirait sans fin.
  const ckey = host + '|' + urlPath.split('?')[0];
  const cached = cacheGet(ckey);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    let done = false, req = null;
    // Filet de sécurité : quoi qu'il arrive, on résout ET on détruit la requête amont en
    // cours (sinon un corps qui arrive au goutte-à-goutte, sous MAX_BODY, laisse fuir un
    // socket : le timeout d'inactivité de 6 s ne se déclenche jamais).
    let guard = null;
    const finish = (v) => { if (!done) { done = true; if (guard) clearTimeout(guard); try { req && req.destroy(); } catch {} resolve(v); } };
    guard = setTimeout(() => finish({ status: 0, body: null }), 8000);
    guard.unref?.();
    (async () => {
      let ip;
      try { ip = await resolveRealIp(host); } catch { return finish({ status: 0, body: null }); }
      try {
        req = http.get(
          { host: ip, port: 80, path: urlPath, headers: { Host: host, 'User-Agent': 'CapHub' }, timeout: 6000 },
          (res) => {
            const chunks = []; let size = 0; let tooBig = false;
            res.on('data', (c) => {
              if (tooBig) return;
              size += c.length;
              if (size > MAX_BODY) { tooBig = true; res.destroy(); return finish({ status: 0, body: null }); } // tronqué -> échec (ni caché ni servi)
              chunks.push(c);
            });
            res.on('end', () => {
              if (tooBig) return;
              const entry = { status: res.statusCode || 0, body: Buffer.concat(chunks), t: Date.now() };
              if (entry.status === 200) cacheSet(ckey, entry); // on ne cache QUE les 200 (pas les 5xx transitoires)
              finish(entry);
            });
            res.on('error', () => finish({ status: 0, body: null }));
          }
        );
      } catch { return finish({ status: 0, body: null }); }
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', () => finish({ status: 0, body: null }));
    })();
  });
}

// ---------- État ----------
let server = null;
let deps = null; // { getOwn(name), getRegistryCape(name) }
const stats = { served: 0, passthrough: 0, misses: 0 };

const hostOf = (req) => String(req.headers.host || '').split(':')[0].toLowerCase();

async function handle(req, res) {
  const url = req.url || '';
  if (url === '/caphub/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ app: 'cap-hub', ...stats }));
  }

  const provider = hostIndex().get(hostOf(req));
  if (req.method !== 'GET' || !provider) { res.writeHead(404); return res.end(); }

  const parsed = provider.parse(url);
  if (!parsed) { res.writeHead(404); return res.end(); }
  const name = parsed.key;

  // 1/2) Notre cape (toi puis registre). Une cape animée (images empilées) n'est pas
  // affichable par OptiFine -> on sert sa 1re image (PNG valide 64x32/HD).
  let capePng = null;
  for (const src of ['own', 'registry']) {
    try {
      const buf = src === 'own' ? await deps.getOwn(name.toLowerCase()) : await deps.getRegistryCape(name.toLowerCase());
      if (buf) { capePng = firstFrameIfAnimated(buf); break; }
    } catch {}
  }

  // 3) Relais amont si on n'a pas de cape.
  let upstream = null;
  if (!capePng) {
    const fetcher = deps.upstream || fetchUpstream;
    upstream = await fetcher(hostOf(req), url);
  }

  const out = provider.render({ capePng, upstream });
  if (out.status === 200) {
    if (capePng) { stats.served++; log('ok', `${provider.label} : cape servie -> ${name}`); }
    else stats.passthrough++;
  } else stats.misses++;
  res.writeHead(out.status, out.headers || {});
  res.end(out.body || undefined);
}

export function isRunning() { return !!server; }
export function getStats() { return { running: !!server, ...stats }; }
export function getPort() { return server ? (server.address()?.port ?? null) : null; }

// OptiFine interroge s.optifine.net en HTTP sur le port 80 : on écoute uniquement sur
// 127.0.0.1:80. opts.port (défaut 80) sert aux tests (0 = éphémère).
export function startProxy(dependencies, opts = {}) {
  deps = dependencies;
  const port = opts.port ?? 80;
  return new Promise((resolve) => {
    if (server) return resolve({ ok: true, already: true, port: server.address()?.port });
    const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
    const onBindError = (e) => {
      server = null;
      resolve({ ok: false, error: e.code === 'EADDRINUSE' ? 'Port 80 déjà utilisé (IIS ? Skype ? autre proxy ?).' : e.message });
    };
    s.once('error', onBindError);
    s.listen(port, '127.0.0.1', () => {
      // Une fois lié : on retire le handler de bind et on installe un handler PERSISTANT
      // qui logue les erreurs runtime au lieu de laisser Node crasher le process principal.
      s.removeListener('error', onBindError);
      s.on('error', (e) => log('warn', `proxy : erreur serveur ignorée (${e.message})`));
      server = s;
      const bound = s.address()?.port;
      log('ok', `proxy de capes démarré sur 127.0.0.1:${bound}`);
      resolve({ ok: true, port: bound });
    });
  });
}

export function stopProxy() {
  return new Promise((resolve) => {
    if (!server) return resolve({ ok: true, already: true });
    const s = server;
    // Ferme aussi les connexions keep-alive (OptiFine) sinon close() peut ne jamais
    // rappeler et le serveur resterait à retenir des sockets.
    try { s.closeAllConnections?.(); } catch {}
    s.close(() => { if (server === s) server = null; log('ok', 'proxy arrêté'); resolve({ ok: true }); });
    setTimeout(() => { if (server === s) server = null; resolve({ ok: true }); }, 1500).unref();
  });
}

// Domaines que hosts doit rediriger (utilisé par main/hosts).
export function redirectHosts() { return enabledHosts(); }

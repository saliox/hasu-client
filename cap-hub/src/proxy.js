// Proxy local MULTI-FOURNISSEURS de capes. Écoute le trafic des services de capes
// redirigés vers 127.0.0.1 (via hosts) et répond pour CHAQUE canal supporté — pas
// seulement OptiFine.
//
//   - HTTP  :80   canaux en clair (OptiFine)
//   - HTTPS :443  canaux chiffrés (MinecraftCapes…) via un certificat Cap Hub par
//                 domaine (module ca.js). Nécessite que la CA Cap Hub soit approuvée
//                 par le jeu (truststore Java).
//
// Ordre de résolution, identique pour tous les canaux :
//   1. TON pseudo + cape active            -> cape locale
//   2. pseudo présent dans le registre     -> cape du registre
//   3. sinon                               -> RELAIS transparent vers le vrai service
//      (IP réelle résolue en DNS-over-HTTPS), pour ne rien casser aux autres joueurs.
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { hostIndex, enabledHosts, needsCA } from './providers.js';
import { secureContextFor, caExists } from './ca.js';
import { uuidToName, forget } from './idmap.js';

export const proxyEvents = new EventEmitter(); // 'log' { level, msg, t }
const log = (level, msg) => proxyEvents.emit('log', { level, msg, t: Date.now() });

// ---------- Résolution DoH de la vraie IP d'un domaine redirigé ----------
const ipCache = new Map(); // host -> { ip, t }
const IP_TTL = 60 * 60 * 1000;

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
      const a = (j.Answer || []).find((x) => x.type === 1 && x.data && x.data !== '127.0.0.1');
      if (a) { ipCache.set(host, { ip: a.data, t: Date.now() }); return a.data; }
    } catch {}
  }
  throw new Error('IP réelle introuvable pour ' + host);
}

// ---------- Relais vers le vrai service ----------
const passCache = new Map(); // scheme+host+path -> { status, contentType, body, t }
const PASS_TTL = 10 * 60 * 1000;

function fetchUpstream(scheme, host, urlPath) {
  return new Promise(async (resolve) => {
    const ckey = scheme + '|' + host + '|' + urlPath;
    const hit = passCache.get(ckey);
    if (hit && Date.now() - hit.t < PASS_TTL) return resolve(hit);
    let ip;
    try { ip = await resolveRealIp(host); } catch { return resolve({ status: 0, body: null }); }
    const lib = scheme === 'https' ? https : http;
    const opts = {
      host: ip, port: scheme === 'https' ? 443 : 80, path: urlPath, method: 'GET',
      headers: { Host: host, 'User-Agent': 'CapHub' }, timeout: 6000,
    };
    if (scheme === 'https') opts.servername = host; // SNI vers le vrai serveur (cert réel vérifié)
    const req = lib.get(opts, (res) => {
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size < 3 * 1024 * 1024) chunks.push(c); });
      res.on('end', () => {
        const entry = { status: res.statusCode || 0, contentType: res.headers['content-type'] || '', body: Buffer.concat(chunks), t: Date.now() };
        passCache.set(ckey, entry);
        resolve(entry);
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: null }));
  });
}

// ---------- État ----------
let httpServer = null, httpsServer = null;
let deps = null; // { getOwn(name), getRegistryCape(name), enabledIds(), upstream? }
const stats = { served: 0, passthrough: 0, misses: 0 };

const hostOf = (req) => String(req.headers.host || (req.socket && req.socket.servername) || '').split(':')[0].toLowerCase();

async function resolveName(parsed) {
  if (parsed.keyType === 'name') return parsed.key;
  if (parsed.keyType === 'uuid') return await uuidToName(parsed.key);
  return null;
}

async function handle(req, res, scheme) {
  const url = req.url || '';
  const host = hostOf(req) || (scheme === 'https' && req.socket ? req.socket.servername : '');

  // Endpoint d'auto-diagnostic (utile pour vérifier que le proxy tourne).
  if (url === '/caphub/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ app: 'cap-hub', scheme, ...stats }));
  }

  const idx = hostIndex(deps.enabledIds());
  const provider = idx.get(host);
  if (req.method !== 'GET' || !provider) { res.writeHead(404); return res.end(); }

  const parsed = provider.parse(url);
  if (!parsed) { res.writeHead(404); return res.end(); }

  const name = await resolveName(parsed);

  // 1/2) Notre cape (toi puis registre).
  let capePng = null;
  if (name) {
    for (const src of ['own', 'registry']) {
      try {
        const buf = src === 'own' ? await deps.getOwn(name.toLowerCase()) : await deps.getRegistryCape(name.toLowerCase());
        if (buf) { capePng = buf; break; }
      } catch {}
    }
  }

  // 3) Relais amont : requis si pas de cape, OU si le fournisseur fusionne (JSON) pour
  //    préserver le skin du joueur. OptiFine (PNG brut) n'a rien à fusionner.
  const wantUpstream = !capePng || provider.id === 'minecraftcapes';
  let upstream = null;
  if (wantUpstream) {
    const fetcher = deps.upstream || fetchUpstream;
    upstream = await fetcher(scheme, host, url);
    // UUID -> pseudo peut être périmé : si aucune cape trouvée et amont vide, on oublie.
    if (!capePng && parsed.keyType === 'uuid' && upstream && upstream.status === 0) forget(parsed.key);
  }

  const out = provider.render({ capePng, upstream, key: parsed.key, name });
  if (out.status === 200) {
    if (capePng) { stats.served++; log('ok', `${provider.label} : cape servie -> ${name}`); }
    else { stats.passthrough++; }
  } else { stats.misses++; }
  res.writeHead(out.status, out.headers || {});
  res.end(out.body || undefined);
}

export function isRunning() { return !!httpServer || !!httpsServer; }
export function getStats() {
  return { running: isRunning(), http: !!httpServer, https: !!httpsServer, ...stats };
}

// Démarre les écouteurs nécessaires selon les fournisseurs activés.
// opts.httpPort / opts.httpsPort (défaut 80/443) servent aux tests (0 = éphémère).
export async function startProxy(dependencies, opts = {}) {
  deps = dependencies;
  const enabled = deps.enabledIds();
  const httpPort = opts.httpPort ?? 80;
  const httpsPort = opts.httpsPort ?? 443;

  const listen = (server, port) => new Promise((resolve) => {
    server.once('error', (e) => resolve({ ok: false, error: e.code === 'EADDRINUSE' ? `Port ${port} déjà utilisé.` : e.message }));
    server.listen(port, '127.0.0.1', () => resolve({ ok: true, port: server.address()?.port }));
  });

  const result = { ok: true, http: null, https: null };

  if (!httpServer) {
    const s = http.createServer((req, res) => handle(req, res, 'http').catch(() => { try { res.writeHead(500); res.end(); } catch {} }));
    const r = await listen(s, httpPort);
    if (r.ok) { httpServer = s; result.http = r.port; log('ok', `proxy HTTP sur 127.0.0.1:${r.port}`); }
    else { result.ok = false; result.error = 'HTTP : ' + r.error; }
  } else result.http = httpServer.address()?.port;

  // HTTPS seulement si un canal chiffré est activé et la CA existe.
  if (needsCA(enabled)) {
    if (!caExists()) { result.ok = false; result.error = (result.error ? result.error + ' ; ' : '') + 'CA Cap Hub absente (installe-la pour les canaux HTTPS).'; }
    else if (!httpsServer) {
      const s = https.createServer(
        { SNICallback: (name, cb) => { try { cb(null, secureContextFor(name)); } catch (e) { cb(e); } } },
        (req, res) => handle(req, res, 'https').catch(() => { try { res.writeHead(500); res.end(); } catch {} })
      );
      const r = await listen(s, httpsPort);
      if (r.ok) { httpsServer = s; result.https = r.port; log('ok', `proxy HTTPS sur 127.0.0.1:${r.port}`); }
      else { result.ok = false; result.error = (result.error ? result.error + ' ; ' : '') + 'HTTPS : ' + r.error; }
    } else result.https = httpsServer.address()?.port;
  }

  return result;
}

export function stopProxy() {
  const close = (s) => new Promise((resolve) => { if (!s) return resolve(); s.close(() => resolve()); setTimeout(resolve, 1500).unref(); });
  return Promise.all([close(httpServer), close(httpsServer)]).then(() => {
    httpServer = null; httpsServer = null; log('ok', 'proxy arrêté'); return { ok: true };
  });
}

// Domaines que hosts doit rediriger pour l'ensemble activé (utilisé par main/hosts).
export function redirectHosts(enabledIds) { return enabledHosts(enabledIds); }

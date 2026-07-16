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

// ---------- Relais vers le vrai serveur OptiFine ----------
const passCache = new Map(); // host+path -> { status, body, t }
const PASS_TTL = 10 * 60 * 1000;

function fetchUpstream(host, urlPath) {
  return new Promise(async (resolve) => {
    const ckey = host + '|' + urlPath;
    const hit = passCache.get(ckey);
    if (hit && Date.now() - hit.t < PASS_TTL) return resolve(hit);
    let ip;
    try { ip = await resolveRealIp(host); } catch { return resolve({ status: 0, body: null }); }
    const req = http.get(
      { host: ip, port: 80, path: urlPath, headers: { Host: host, 'User-Agent': 'CapHub' }, timeout: 6000 },
      (res) => {
        const chunks = []; let size = 0;
        res.on('data', (c) => { size += c.length; if (size < 3 * 1024 * 1024) chunks.push(c); });
        res.on('end', () => {
          const entry = { status: res.statusCode || 0, body: Buffer.concat(chunks), t: Date.now() };
          passCache.set(ckey, entry);
          resolve(entry);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 0, body: null }));
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

// OptiFine interroge s.optifine.net en HTTP sur le port 80 : on écoute uniquement sur
// 127.0.0.1:80. opts.port (défaut 80) sert aux tests (0 = éphémère).
export function startProxy(dependencies, opts = {}) {
  deps = dependencies;
  const port = opts.port ?? 80;
  return new Promise((resolve) => {
    if (server) return resolve({ ok: true, already: true, port: server.address()?.port });
    const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
    s.once('error', (e) => {
      server = null;
      resolve({ ok: false, error: e.code === 'EADDRINUSE' ? 'Port 80 déjà utilisé (IIS ? Skype ? autre proxy ?).' : e.message });
    });
    s.listen(port, '127.0.0.1', () => {
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
    server.close(() => { server = null; log('ok', 'proxy arrêté'); resolve({ ok: true }); });
    setTimeout(() => { server = null; resolve({ ok: true }); }, 1500).unref();
  });
}

// Domaines que hosts doit rediriger (utilisé par main/hosts).
export function redirectHosts() { return enabledHosts(); }

// Proxy local de capes : répond aux requêtes `GET /capes/<pseudo>.png` que les
// clients Minecraft envoient à s.optifine.net (redirigé vers 127.0.0.1 via hosts).
//
// Ordre de résolution d'une cape :
//   1. TON pseudo + cape active choisie dans l'app  -> cape locale
//   2. pseudo présent dans le registre partagé      -> cape du registre (cache disque)
//   3. sinon                                        -> relais vers le VRAI s.optifine.net
//      (IP résolue en DNS-over-HTTPS, car le hosts local pointe désormais vers nous)
//
// Résultat : tous les joueurs Cap Hub se voient entre eux, et les capes OptiFine
// officielles des autres joueurs continuent de s'afficher normalement.
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { CAPE_HOST } from './hosts.js';

export const proxyEvents = new EventEmitter(); // 'log' { level, msg }

const log = (level, msg) => proxyEvents.emit('log', { level, msg, t: Date.now() });

// ---------- Résolution DoH de la vraie IP de s.optifine.net ----------
// (le hosts local renvoie 127.0.0.1, on doit donc résoudre "à côté" du système)
let realIp = { ip: null, t: 0 };

async function resolveRealIp() {
  if (realIp.ip && Date.now() - realIp.t < 60 * 60 * 1000) return realIp.ip;
  const sources = [
    `https://cloudflare-dns.com/dns-query?name=${CAPE_HOST}&type=A`,
    `https://dns.google/resolve?name=${CAPE_HOST}&type=A`,
  ];
  for (const url of sources) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) });
      if (!r.ok) continue;
      const j = await r.json();
      const ip = (j.Answer || []).find((a) => a.type === 1 && a.data && a.data !== '127.0.0.1');
      if (ip) { realIp = { ip: ip.data, t: Date.now() }; return ip.data; }
    } catch {}
  }
  throw new Error('IP réelle de ' + CAPE_HOST + ' introuvable (DoH)');
}

// ---------- Relais vers le vrai serveur OptiFine ----------
// Cache mémoire (y compris les 404) pour ne pas marteler OptiFine.
const passCache = new Map(); // name -> { status, buf, t }
const PASS_TTL = 10 * 60 * 1000;

function fetchReal(name) {
  return new Promise(async (resolve) => {
    const cached = passCache.get(name);
    if (cached && Date.now() - cached.t < PASS_TTL) return resolve(cached);
    let ip;
    try { ip = await resolveRealIp(); } catch { return resolve({ status: 404, buf: null }); }
    const req = http.get(
      { host: ip, port: 80, path: `/capes/${encodeURIComponent(name)}.png`, headers: { Host: CAPE_HOST, 'User-Agent': 'CapHub' }, timeout: 6000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => { if (chunks.reduce((n, b) => n + b.length, 0) < 3 * 1024 * 1024) chunks.push(c); });
        res.on('end', () => {
          const entry = { status: res.statusCode === 200 ? 200 : 404, buf: res.statusCode === 200 ? Buffer.concat(chunks) : null, t: Date.now() };
          passCache.set(name, entry);
          resolve(entry);
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ status: 404, buf: null }));
  });
}

// ---------- Serveur ----------
let server = null;
let deps = null; // { getOwn(name), getRegistryCape(name) }
const stats = { served: 0, passthrough: 0, misses: 0 };

async function handle(req, res) {
  const m = /^\/capes\/([A-Za-z0-9_]{1,16})\.png$/.exec(req.url || '');
  if (req.method !== 'GET' || !m) {
    if (req.url === '/caphub/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ app: 'cap-hub', ...stats }));
    }
    res.writeHead(404); return res.end();
  }
  const name = m[1];
  const lower = name.toLowerCase();

  // 1) Ta cape active, 2) registre partagé.
  for (const source of ['own', 'registry']) {
    try {
      const buf = source === 'own' ? await deps.getOwn(lower) : await deps.getRegistryCape(lower);
      if (buf) {
        stats.served++;
        log('ok', `cape ${source === 'own' ? 'locale' : 'registre'} servie -> ${name}`);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache', 'Content-Length': buf.length });
        return res.end(buf);
      }
    } catch {}
  }

  // 3) Relais vers le vrai serveur OptiFine.
  const real = await fetchReal(lower);
  if (real.status === 200 && real.buf) {
    stats.passthrough++;
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': real.buf.length });
    return res.end(real.buf);
  }
  stats.misses++;
  res.writeHead(404);
  res.end();
}

export function isRunning() {
  return !!server;
}

export function getStats() {
  return { running: !!server, ...stats };
}

// OptiFine interroge s.optifine.net en HTTP sur le port 80 : on écoute uniquement
// sur 127.0.0.1:80 (jamais exposé au réseau). Sous Windows, pas besoin d'admin
// pour un port < 1024. Échec typique : port 80 déjà pris (IIS, Skype…).
// opts.port (défaut 80) sert aux tests (port éphémère 0).
export function startProxy(dependencies, opts = {}) {
  deps = dependencies;
  const port = opts.port ?? 80;
  return new Promise((resolve) => {
    if (server) return resolve({ ok: true, already: true, port: server.address()?.port });
    const s = http.createServer((req, res) => { handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch {} }); });
    s.once('error', (e) => {
      server = null;
      const busy = e.code === 'EADDRINUSE';
      resolve({ ok: false, error: busy ? 'Port 80 déjà utilisé (IIS ? Skype ? autre proxy ?).' : e.message });
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


// Registre PARTAGÉ des capes — 100 % GitHub, aucun serveur, aucune IP (même
// philosophie que le reste de l'écosystème : version.json, users.json…).
//
// - LECTURE : capes.json + PNG récupérés en raw.githubusercontent.com (public),
//   avec cache disque -> le proxy sert les capes des autres joueurs Cap Hub.
// - PUBLICATION : commit direct via l'API GitHub "contents" avec un token
//   (fine-grained, portée contents:write sur le dépôt du registre). Sans token,
//   la cape reste locale et on peut l'échanger en manuel (onglet Joueurs).
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REPO = 'saliox/hasu-client';
const DEFAULT_BRANCH = 'main';
const REG_DIR = 'cap-hub/registry';

let cacheDir = null;
let cfg = { repo: DEFAULT_REPO, branch: DEFAULT_BRANCH };
let index = { players: {} };
let lastFetch = 0;

const rawBase = () => `https://raw.githubusercontent.com/${cfg.repo}/${cfg.branch}/${REG_DIR}`;
const apiBase = () => `https://api.github.com/repos/${cfg.repo}/contents/${REG_DIR}`;

export function initRegistry(userDataDir, options = {}) {
  cacheDir = path.join(userDataDir, 'registry-cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  configureRegistry(options);
  // Recharge l'index depuis le cache disque pour un démarrage hors-ligne.
  try { index = JSON.parse(fs.readFileSync(path.join(cacheDir, 'capes.json'), 'utf8')); } catch {}
}

export function configureRegistry({ repo, branch } = {}) {
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo)) cfg.repo = repo;
  if (branch && /^[\w./-]+$/.test(branch)) cfg.branch = branch;
}

// ---------- Lecture (public, sans token) ----------
export async function refreshIndex(force = false) {
  if (!force && Date.now() - lastFetch < 5 * 60 * 1000) return { ok: true, cached: true, count: playerCount() };
  try {
    const r = await fetch(`${rawBase()}/capes.json?t=${Date.now()}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    if (j && typeof j.players === 'object') {
      index = j;
      lastFetch = Date.now();
      fs.writeFileSync(path.join(cacheDir, 'capes.json'), JSON.stringify(j, null, 2));
    }
    return { ok: true, count: playerCount() };
  } catch (e) {
    return { ok: false, error: `Registre injoignable : ${e.message}`, count: playerCount() };
  }
}

const playerCount = () => Object.keys(index.players || {}).length;

export function listPlayers() {
  return Object.entries(index.players || {}).map(([name, v]) => ({ name, updated: v.updated || null }));
}

// Cape d'un joueur du registre, avec cache disque (1 h) et cache des absences.
const missCache = new Map(); // name -> timestamp
export async function getRegistryCape(nameLower) {
  const entry = (index.players || {})[nameLower];
  if (!entry || !entry.cape) return null;
  const cached = path.join(cacheDir, `${nameLower}.png`);
  try {
    const st = fs.statSync(cached);
    if (Date.now() - st.mtimeMs < 60 * 60 * 1000) return fs.readFileSync(cached);
  } catch {}
  const missAt = missCache.get(nameLower);
  if (missAt && Date.now() - missAt < 10 * 60 * 1000) return readStale(cached);
  try {
    const r = await fetch(`${rawBase()}/${entry.cape}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(cached, buf);
    return buf;
  } catch {
    missCache.set(nameLower, Date.now());
    return readStale(cached); // mieux vaut une cape périmée que pas de cape
  }
}

function readStale(file) {
  try { return fs.readFileSync(file); } catch { return null; }
}

// ---------- Publication (token GitHub requis) ----------
async function gh(token, url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'CapHub',
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status} : ${(await r.text()).slice(0, 180)}`);
  return r.json();
}

// GET du fichier via l'API contents : renvoie { sha, buf } ou null s'il n'existe pas.
async function getFile(token, relPath) {
  const j = await gh(token, `${apiBase()}/${relPath}?ref=${cfg.branch}`);
  if (!j || !j.sha) return null;
  return { sha: j.sha, buf: j.content ? Buffer.from(j.content, 'base64') : null };
}

async function putFile(token, relPath, contentBuf, message, knownSha) {
  const url = `${apiBase()}/${relPath}`;
  const sha = knownSha !== undefined ? knownSha : (await getFile(token, relPath))?.sha;
  const body = {
    message,
    branch: cfg.branch,
    content: contentBuf.toString('base64'),
    ...(sha ? { sha } : {}),
  };
  await gh(token, url, { method: 'PUT', body: JSON.stringify(body) });
}

// Publie TA cape : pousse le PNG puis met à jour capes.json (2 commits).
// IMPORTANT : capes.json est fusionné sur le CONTENU DISTANT LE PLUS RÉCENT (relu via
// l'API juste avant le PUT) pour ne jamais écraser les entrées d'autres joueurs
// publiées entre-temps.
export async function publishCape(token, username, pngBuf) {
  const name = String(username || '').toLowerCase();
  if (!/^[a-z0-9_]{1,16}$/.test(name)) return { ok: false, error: 'Pseudo Minecraft invalide.' };
  if (!token) return { ok: false, error: 'Token GitHub manquant (Réglages).' };
  try {
    await putFile(token, `capes/${name}.png`, pngBuf, `Cap Hub : cape de ${name}`);

    // Relit capes.json distant (source de vérité) et fusionne notre entrée.
    const cur = await getFile(token, 'capes.json');
    let players = {};
    if (cur && cur.buf) { try { players = JSON.parse(cur.buf.toString('utf8')).players || {}; } catch {} }
    players[name] = { cape: `capes/${name}.png`, updated: new Date().toISOString().slice(0, 10) };
    const json = JSON.stringify({ format: 1, players }, null, 2) + '\n';
    await putFile(token, 'capes.json', Buffer.from(json), `Cap Hub : index (+${name})`, cur ? cur.sha : undefined);

    index = { format: 1, players };
    fs.writeFileSync(path.join(cacheDir, 'capes.json'), json);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

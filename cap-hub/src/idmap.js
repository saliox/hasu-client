// Résolveur pseudo <-> UUID via l'API Mojang, avec cache disque. Certains
// fournisseurs de capes indexent par UUID (MinecraftCapes) alors que le registre
// Cap Hub est indexé par pseudo : on fait le pont.
//
// Ces API Mojang ne sont PAS redirigées par notre hosts (on ne touche qu'aux domaines
// de capes), donc les requêtes partent bien vers le vrai Mojang.
import fs from 'node:fs';
import path from 'node:path';

let file = null;
let cache = { u2n: {}, n2u: {} }; // uuid->name, name->uuid (name en minuscules)

export function initIdMap(userDataDir) {
  file = path.join(userDataDir, 'idmap.json');
  try { cache = { u2n: {}, n2u: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch {}
}

function persist() {
  try { fs.writeFileSync(file, JSON.stringify(cache)); } catch {}
}

const norm = (u) => String(u).replace(/-/g, '').toLowerCase();

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'CapHub' }, signal: AbortSignal.timeout(6000) });
  if (r.status === 204 || r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// UUID (sans tirets) -> pseudo actuel. Cache permanent (un UUID mappe un compte ;
// le pseudo peut changer, mais on rafraîchit à l'échec de résolution de cape).
export async function uuidToName(uuid) {
  const id = norm(uuid);
  if (cache.u2n[id]) return cache.u2n[id];
  try {
    const j = await getJson(`https://sessionserver.mojang.com/session/minecraft/profile/${id}`);
    if (j && j.name) {
      cache.u2n[id] = j.name;
      cache.n2u[j.name.toLowerCase()] = id;
      persist();
      return j.name;
    }
  } catch {}
  return null;
}

// Pseudo -> UUID (sans tirets).
export async function nameToUuid(name) {
  const key = String(name).toLowerCase();
  if (cache.n2u[key]) return cache.n2u[key];
  try {
    const j = await getJson(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`);
    if (j && j.id) {
      const id = norm(j.id);
      cache.n2u[key] = id;
      cache.u2n[id] = j.name || name;
      persist();
      return id;
    }
  } catch {}
  return null;
}

// Purge une entrée (ex. pseudo changé) pour forcer une nouvelle résolution.
export function forget(uuid) {
  const id = norm(uuid);
  const n = cache.u2n[id];
  delete cache.u2n[id];
  if (n) delete cache.n2u[n.toLowerCase()];
  persist();
}

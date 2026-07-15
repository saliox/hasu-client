// Registre des FOURNISSEURS de capes. Chaque client Minecraft affiche les capes via
// un service précis (OptiFine, mod MinecraftCapes, LabyMod…). Cap Hub sert plusieurs
// de ces canaux depuis un seul proxy local — pour que les capes ne soient PAS
// limitées à OptiFine.
//
// Un fournisseur décrit :
//   id, label       identifiant + nom affiché
//   scheme          'http' (port 80) ou 'https' (port 443, nécessite la CA Cap Hub)
//   hosts           domaines à rediriger vers le proxy (fichier hosts)
//   requiresCA      true si HTTPS -> la CA Cap Hub doit être approuvée par le jeu
//   parse(url)      -> { key, keyType:'name'|'uuid' } | null   (requête de cape ?)
//   render(ctx)     -> { status, headers, body }               (réponse à renvoyer)
//
// render reçoit : { capePng (Buffer|null), upstream ({status,contentType,body}|null),
//                   key, name }. capePng = notre cape (toi ou le registre) ; upstream =
//                   la réponse du VRAI service (relais) pour préserver skins/capes des
//                   joueurs hors Cap Hub.

const PNG = { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' };
const JSON_H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' };

// --- OptiFine : http://s.optifine.net/capes/<Pseudo>.png -> PNG brut ---
const optifine = {
  id: 'optifine',
  label: 'OptiFine',
  scheme: 'http',
  hosts: ['s.optifine.net'],
  requiresCA: false,
  parse(url) {
    const m = /^\/capes\/([A-Za-z0-9_]{1,16})\.png$/.exec(url);
    return m ? { key: m[1], keyType: 'name' } : null;
  },
  render({ capePng, upstream }) {
    if (capePng) return { status: 200, headers: { ...PNG, 'Content-Length': capePng.length }, body: capePng };
    if (upstream && upstream.status === 200 && upstream.body)
      return { status: 200, headers: { ...PNG, 'Content-Length': upstream.body.length }, body: upstream.body };
    return { status: 404, headers: {}, body: null };
  },
};

// --- MinecraftCapes (mod très répandu) : https://api.minecraftcapes.net/profile/<uuid>
// -> JSON { textures: { cape:<b64 png>, skin:<b64 png> }, ... }. On injecte NOTRE cape
// dans le JSON amont pour préserver le skin du joueur. ---
const minecraftcapes = {
  id: 'minecraftcapes',
  label: 'MinecraftCapes (mod)',
  scheme: 'https',
  hosts: ['api.minecraftcapes.net'],
  requiresCA: true,
  parse(url) {
    const m = /^\/profile\/([0-9a-fA-F]{32}|[0-9a-fA-F-]{36})/.exec(url);
    return m ? { key: m[1].replace(/-/g, ''), keyType: 'uuid' } : null;
  },
  render({ capePng, upstream }) {
    // Repart du JSON amont si dispo (préserve skin/settings), sinon objet minimal.
    let obj = {};
    if (upstream && upstream.status === 200 && upstream.body) {
      try { obj = JSON.parse(upstream.body.toString('utf8')); } catch {}
    }
    if (capePng) {
      obj.textures = obj.textures || {};
      obj.textures.cape = capePng.toString('base64');
    } else if (!upstream || upstream.status !== 200) {
      return { status: 404, headers: {}, body: null };
    }
    const body = Buffer.from(JSON.stringify(obj), 'utf8');
    return { status: 200, headers: { ...JSON_H, 'Content-Length': body.length }, body };
  },
};

// --- LabyMod (expérimental) : https://dl.labymod.net/capes/<uuid> -> PNG brut.
// Format à confirmer côté PC selon la version de LabyMod ; proposé mais désactivé par
// défaut. Comme tout canal HTTPS, il nécessite la CA Cap Hub (interception TLS). ---
const labymod = {
  id: 'labymod',
  label: 'LabyMod',
  scheme: 'https',
  hosts: ['dl.labymod.net'],
  requiresCA: true,
  experimental: true,
  parse(url) {
    const m = /^\/capes\/([0-9a-fA-F-]{32,36})/.exec(url);
    return m ? { key: m[1].replace(/-/g, ''), keyType: 'uuid' } : null;
  },
  render({ capePng, upstream }) {
    if (capePng) return { status: 200, headers: { ...PNG, 'Content-Length': capePng.length }, body: capePng };
    if (upstream && upstream.status === 200 && upstream.body)
      return { status: 200, headers: { ...PNG, 'Content-Length': upstream.body.length }, body: upstream.body };
    return { status: 404, headers: {}, body: null };
  },
};

// Fournisseurs livrés. `experimental` => proposé mais désactivé par défaut (format à
// confirmer côté PC avec le vrai client). L'architecture rend l'ajout d'un canal trivial.
export const PROVIDERS = [optifine, minecraftcapes, labymod];

export const byId = (id) => PROVIDERS.find((p) => p.id === id) || null;

// Table domaine -> fournisseur, pour router une requête entrante.
export function hostIndex(enabledIds) {
  const idx = new Map();
  for (const p of PROVIDERS) {
    if (enabledIds && !enabledIds.includes(p.id)) continue;
    for (const h of p.hosts) idx.set(h.toLowerCase(), p);
  }
  return idx;
}

// Domaines à rediriger dans hosts pour l'ensemble activé.
export function enabledHosts(enabledIds) {
  const out = [];
  for (const p of PROVIDERS) {
    if (enabledIds && !enabledIds.includes(p.id)) continue;
    out.push(...p.hosts);
  }
  return [...new Set(out)];
}

// Un canal HTTPS est-il activé ? (=> la CA Cap Hub est nécessaire)
export function needsCA(enabledIds) {
  return PROVIDERS.some((p) => (!enabledIds || enabledIds.includes(p.id)) && p.requiresCA);
}

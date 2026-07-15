// Fournisseur de capes : OptiFine (le SEUL canal de Cap Hub).
//
// Les clients Minecraft compatibles OptiFine demandent la cape d'un joueur à
// `http://s.optifine.net/capes/<pseudo>.png` — en HTTP clair. Cap Hub redirige ce
// domaine vers son proxy local et répond à la place. Aucun certificat, aucune CA,
// aucune interception TLS : c'est ce qui rend le mécanisme sûr par conception.
//
// Un fournisseur décrit :
//   id, label       identifiant + nom affiché
//   hosts           domaines à rediriger vers le proxy (fichier hosts)
//   parse(url)      -> { key } | null                      (requête de cape ?)
//   render(ctx)     -> { status, headers, body }           (réponse à renvoyer)
//
// render reçoit : { capePng (Buffer|null), upstream ({status,body}|null) }.
// capePng = notre cape (toi ou le registre) ; upstream = la réponse du VRAI OptiFine
// (relais) pour préserver les capes des joueurs hors Cap Hub.

const PNG = { 'Content-Type': 'image/png', 'Cache-Control': 'no-cache' };

const optifine = {
  id: 'optifine',
  label: 'OptiFine',
  hosts: ['s.optifine.net'],
  parse(url) {
    const m = /^\/capes\/([A-Za-z0-9_]{1,16})\.png$/.exec(url);
    return m ? { key: m[1] } : null;
  },
  render({ capePng, upstream }) {
    if (capePng) return { status: 200, headers: { ...PNG, 'Content-Length': capePng.length }, body: capePng };
    if (upstream && upstream.status === 200 && upstream.body)
      return { status: 200, headers: { ...PNG, 'Content-Length': upstream.body.length }, body: upstream.body };
    return { status: 404, headers: {}, body: null };
  },
};

export const PROVIDERS = [optifine];

export const byId = (id) => PROVIDERS.find((p) => p.id === id) || null;

// Table domaine -> fournisseur, pour router une requête entrante.
export function hostIndex() {
  const idx = new Map();
  for (const p of PROVIDERS) for (const h of p.hosts) idx.set(h.toLowerCase(), p);
  return idx;
}

// Domaines à rediriger dans hosts.
export function enabledHosts() {
  return [...new Set(PROVIDERS.flatMap((p) => p.hosts))];
}

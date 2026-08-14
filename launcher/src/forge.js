// Forge 1.8.9 (le socle du client en jeu Hasu). Pour cette génération de Forge,
// le jar « universal » contient son propre version.json : on le télécharge depuis le
// maven officiel Forge, on lit ce JSON, et on FUSIONNE avec le JSON vanilla
// (mainClass launchwrapper + tweaker FML + bibliothèques supplémentaires).
import path from 'node:path';
import { downloadFile, fetchBuffer } from './download.js';
import { readZipFile } from './zip.js';
import { mavenToPath, LIBRARIES_URL } from './mojang.js';

export const FORGE_MC_VERSION = '1.8.9';
// Dernière build recommandée pour 1.8.9.
export const FORGE_BUILD = '1.8.9-11.15.1.2318-1.8.9';
export const FORGE_MAVEN = 'https://maven.minecraftforge.net/';

export function forgeUniversalUrl(build = FORGE_BUILD) {
  return `${FORGE_MAVEN}net/minecraftforge/forge/${build}/forge-${build}-universal.jar`;
}

// Convention Maven standard : chaque artefact publié a un fichier `<artefact>.sha1`
// juste à côté (parfois "hash", parfois "hash  nom-du-fichier"). On l'utilise comme
// empreinte officielle — sans ça, un jar Forge téléchargé n'est jamais vérifié.
async function fetchSha1(url) {
  const buf = await fetchBuffer(`${url}.sha1`, { timeout: 30000, maxBytes: 4096 });
  const match = buf.toString('utf8').trim().match(/^[0-9a-fA-F]{40}/);
  if (!match) throw new Error(`Fichier .sha1 invalide pour ${url}`);
  return match[0].toLowerCase();
}

// Télécharge le universal jar (si besoin) et renvoie son version.json parsé.
export async function ensureForge(librariesDir, build = FORGE_BUILD) {
  const rel = `net/minecraftforge/forge/${build}/forge-${build}-universal.jar`;
  const jar = path.join(librariesDir, ...rel.split('/'));
  const url = forgeUniversalUrl(build);
  const sha1 = await fetchSha1(url);
  await downloadFile(url, jar, sha1, { timeout: 120000 });
  const raw = readZipFile(jar, 'version.json');
  if (!raw) throw new Error('version.json introuvable dans le jar Forge — build inattendue.');
  return { jar, versionJson: JSON.parse(raw.toString('utf8')) };
}

// Bibliothèques Forge (vieux format : name + url, flags clientreq/serverreq).
// Renvoie des tâches { url, file, sha1 } (empreinte récupérée via le `.sha1` maven) ;
// le jar Forge lui-même est exclu (déjà téléchargé par ensureForge, il va en tête de
// classpath).
export async function resolveForgeLibraries(forgeJson, librariesDir) {
  const tasks = [];
  for (const lib of forgeJson.libraries || []) {
    if (!lib.name || lib.name.startsWith('net.minecraftforge:forge:')) continue;
    if (lib.clientreq === false) continue; // lib serveur uniquement
    const rel = mavenToPath(lib.name);
    // Forge historique pointe http://files.minecraftforge.net/maven/ — on force le
    // maven officiel actuel en HTTPS ; sans url, c'est une lib Mojang.
    const base = lib.url ? FORGE_MAVEN : LIBRARIES_URL + '/';
    const url = base + rel;
    tasks.push({ url, file: path.join(librariesDir, ...rel.split('/')), sha1: null });
  }
  await Promise.all(tasks.map(async (t) => {
    try {
      t.sha1 = await fetchSha1(t.url);
    } catch (e) {
      throw new Error(`Empreinte SHA-1 introuvable pour ${path.basename(t.file)} (${t.url}) : ${e.message}`);
    }
  }));
  return tasks;
}

// Fusionne vanilla + forge : Forge impose mainClass et minecraftArguments,
// ses bibliothèques passent DEVANT celles de vanilla dans le classpath.
export function mergeVersionJson(vanilla, forge) {
  return {
    ...vanilla,
    id: forge.id || vanilla.id,
    mainClass: forge.mainClass || vanilla.mainClass,
    minecraftArguments: forge.minecraftArguments || vanilla.minecraftArguments,
  };
}

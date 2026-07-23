// Forge 1.8.9 (le socle du client en jeu Hasu). Pour cette génération de Forge,
// le jar « universal » contient son propre version.json : on le télécharge depuis le
// maven officiel Forge, on lit ce JSON, et on FUSIONNE avec le JSON vanilla
// (mainClass launchwrapper + tweaker FML + bibliothèques supplémentaires).
import path from 'node:path';
import { downloadFile, fetchMavenSha1 } from './download.js';
import { readZipFile } from './zip.js';
import { mavenToPath, LIBRARIES_URL } from './mojang.js';

export const FORGE_MC_VERSION = '1.8.9';
// Dernière build recommandée pour 1.8.9.
export const FORGE_BUILD = '1.8.9-11.15.1.2318-1.8.9';
export const FORGE_MAVEN = 'https://maven.minecraftforge.net/';

export function forgeUniversalUrl(build = FORGE_BUILD) {
  return `${FORGE_MAVEN}net/minecraftforge/forge/${build}/forge-${build}-universal.jar`;
}

// Télécharge le universal jar (si besoin) et renvoie son version.json parsé.
export async function ensureForge(librariesDir, build = FORGE_BUILD) {
  const rel = `net/minecraftforge/forge/${build}/forge-${build}-universal.jar`;
  const jar = path.join(librariesDir, ...rel.split('/'));
  const url = forgeUniversalUrl(build);
  // Le maven Forge ne fournit pas de sha1 dans un manifeste ; on récupère le sidecar
  // <url>.sha1 qu'il publie pour vérifier quand même l'intégrité (défense en profondeur,
  // en plus de HTTPS) — reste null (téléchargement non vérifié) si le sidecar est absent.
  const sha1 = await fetchMavenSha1(url, { timeout: 30000 });
  await downloadFile(url, jar, sha1, { timeout: 120000 });
  const raw = readZipFile(jar, 'version.json');
  if (!raw) throw new Error('version.json introuvable dans le jar Forge — build inattendue.');
  return { jar, versionJson: JSON.parse(raw.toString('utf8')) };
}

// Bibliothèques Forge (vieux format : name + url, flags clientreq/serverreq).
// Renvoie des tâches { url, file, sha1: null } ; le jar Forge lui-même est exclu
// (déjà téléchargé par ensureForge, il va en tête de classpath). Le sha1 manquant est
// récupéré depuis le sidecar Maven par prepareAndLaunch (launch.js) juste avant le
// téléchargement effectif, pour garder cette fonction pure/synchrone (et testable hors
// réseau).
export function resolveForgeLibraries(forgeJson, librariesDir) {
  const tasks = [];
  for (const lib of forgeJson.libraries || []) {
    if (!lib.name || lib.name.startsWith('net.minecraftforge:forge:')) continue;
    if (lib.clientreq === false) continue; // lib serveur uniquement
    const rel = mavenToPath(lib.name);
    // Forge historique pointe http://files.minecraftforge.net/maven/ — on force le
    // maven officiel actuel en HTTPS ; sans url, c'est une lib Mojang.
    const base = lib.url ? FORGE_MAVEN : LIBRARIES_URL + '/';
    tasks.push({ url: base + rel, file: path.join(librariesDir, ...rel.split('/')), sha1: null });
  }
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

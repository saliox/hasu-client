// Métadonnées officielles Mojang : manifeste des versions, JSON de version,
// bibliothèques (avec règles par OS et natives), et index d'assets. Toutes les
// empreintes SHA-1 fournies par Mojang sont vérifiées au téléchargement.
import path from 'node:path';
import { fetchJson } from './download.js';

export const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
export const RESOURCES_URL = 'https://resources.download.minecraft.net';
// Miroir historique de libraries.minecraft.net (toujours servi par Mojang).
export const LIBRARIES_URL = 'https://libraries.minecraft.net';

let manifestCache = null;
export async function getVersionManifest(force = false) {
  if (!manifestCache || force) manifestCache = await fetchJson(VERSION_MANIFEST_URL);
  return manifestCache;
}

export async function getVersionJson(versionId) {
  const manifest = await getVersionManifest();
  const v = manifest.versions.find((x) => x.id === versionId);
  if (!v) throw new Error(`Version Minecraft inconnue : ${versionId}`);
  return fetchJson(v.url);
}

// --- Règles de bibliothèques ---
// Une lib peut être limitée à un OS ("rules"). On évalue pour l'OS courant
// (le launcher vise Windows, mais on reste correct partout).
export function osName(platform = process.platform) {
  return platform === 'win32' ? 'windows' : platform === 'darwin' ? 'osx' : 'linux';
}

export function ruleAllows(rules, os = osName()) {
  if (!Array.isArray(rules) || rules.length === 0) return true;
  let allowed = false;
  for (const r of rules) {
    const matches = !r.os || r.os.name === os;
    if (matches) allowed = r.action === 'allow';
  }
  return allowed;
}

// Chemin maven « group:artifact:version[:classifier] » -> chemin de fichier relatif.
export function mavenToPath(name) {
  const [group, artifact, version, classifier] = String(name).split(':');
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.jar`;
  return `${group.replace(/\./g, '/')}/${artifact}/${version}/${file}`;
}

// Résout les bibliothèques d'un JSON de version pour l'OS courant.
// Renvoie { classpath: [tâches], natives: [tâches] } — chaque tâche { url, file, sha1 }.
export function resolveLibraries(versionJson, librariesDir, os = osName(), arch = 'x64') {
  const classpath = [];
  const natives = [];
  for (const lib of versionJson.libraries || []) {
    if (!ruleAllows(lib.rules, os)) continue;
    const dl = lib.downloads || {};
    // Artefact principal (classpath)
    if (dl.artifact) {
      classpath.push({
        url: dl.artifact.url,
        file: path.join(librariesDir, ...dl.artifact.path.split('/')),
        sha1: dl.artifact.sha1,
      });
    } else if (lib.name && !lib.natives) {
      // Vieux format (Forge) : pas de bloc "downloads", juste name (+ url maven).
      const rel = mavenToPath(lib.name);
      const base = (lib.url || LIBRARIES_URL + '/').replace(/\/?$/, '/');
      classpath.push({ url: base + rel, file: path.join(librariesDir, ...rel.split('/')), sha1: null });
    }
    // Natives (LWJGL etc.) : classifier par OS, ${arch} -> 64/32.
    if (lib.natives && lib.natives[os]) {
      const classifier = lib.natives[os].replace('${arch}', arch === 'x64' ? '64' : '32');
      const nat = dl.classifiers && dl.classifiers[classifier];
      if (nat) {
        natives.push({
          url: nat.url,
          file: path.join(librariesDir, ...nat.path.split('/')),
          sha1: nat.sha1,
          extract: lib.extract || {},
        });
      }
    }
  }
  return { classpath, natives };
}

// Tâches de téléchargement des assets d'un index { objects: { "path": {hash, size} } }.
export function resolveAssets(assetIndex, assetsDir) {
  const tasks = [];
  for (const { hash } of Object.values(assetIndex.objects || {})) {
    const sub = hash.slice(0, 2);
    tasks.push({
      url: `${RESOURCES_URL}/${sub}/${hash}`,
      file: path.join(assetsDir, 'objects', sub, hash),
      sha1: hash,
    });
  }
  return tasks;
}

// --- Arguments de lancement ---
// 1.8.9 : chaîne "minecraftArguments" avec des ${placeholders}.
// Versions modernes : tableau "arguments.game" (chaînes + objets à règles).
export function substituteArgs(template, values) {
  return template.replace(/\$\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}

export function buildGameArgs(versionJson, values) {
  if (typeof versionJson.minecraftArguments === 'string') {
    return versionJson.minecraftArguments.split(/\s+/).filter(Boolean).map((a) => substituteArgs(a, values));
  }
  const out = [];
  for (const a of versionJson.arguments?.game || []) {
    if (typeof a === 'string') out.push(substituteArgs(a, values));
    // Les objets à règles portent les options (démo, résolution…) — ignorés volontairement.
  }
  return out;
}

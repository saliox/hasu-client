// Java intégré : le launcher télécharge le JRE OFFICIEL de Mojang (le même que le
// launcher Minecraft vanilla) — « jre-legacy » (Java 8) pour 1.8.9. L'utilisateur n'a
// donc rien à installer, et chaque fichier est vérifié par SHA-1.
import fs from 'node:fs';
import path from 'node:path';
import { fetchJsonCached, downloadAll, isFresh } from './download.js';

const RUNTIMES_URL = 'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';

export function runtimePlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'win32') return arch === 'x64' ? 'windows-x64' : 'windows-x86';
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return arch === 'x64' ? 'linux' : 'linux-i386';
}

export function javaExePath(runtimeDir, component, platform = process.platform) {
  // javaw.exe sous Windows : pas de fenêtre console parasite derrière le jeu.
  return path.join(runtimeDir, component, 'bin', platform === 'win32' ? 'javaw.exe' : 'java');
}

// S'assure que le runtime `component` (ex. "jre-legacy") est présent et complet.
// Renvoie le chemin de l'exécutable java. onProgress relayé au téléchargement.
//
// Les manifestes (liste des runtimes + fichiers du runtime) sont mis en cache sur
// disque comme le JSON de version et l'index d'assets (voir launch.js) : un runtime
// déjà installé une fois doit rester lançable hors-ligne, pas seulement le jar du jeu.
// Sans ce cache, ensureJava exigeait le réseau à CHAQUE lancement (même « Jouer en
// hors-ligne ») avant même de vérifier si le JRE était déjà présent sur le disque.
export async function ensureJava(runtimeDir, component, { onProgress } = {}) {
  const platform = runtimePlatform();
  const base = path.join(runtimeDir, component);
  const all = await fetchJsonCached(RUNTIMES_URL, path.join(runtimeDir, 'all.json'));
  const entries = (all[platform] && all[platform][component]) || [];
  if (!entries.length) {
    throw new Error(`Runtime Java « ${component} » indisponible pour ${platform}.`);
  }
  const manifest = await fetchJsonCached(entries[0].manifest.url, path.join(base, 'manifest.json'));
  const tasks = [];
  const links = [];
  for (const [rel, info] of Object.entries(manifest.files || {})) {
    const dest = path.join(base, ...rel.split('/'));
    // zip-slip : les chemins du manifeste doivent rester DANS le dossier du runtime.
    if (path.relative(base, dest).startsWith('..')) continue;
    if (info.type === 'directory') {
      fs.mkdirSync(dest, { recursive: true });
    } else if (info.type === 'file' && info.downloads?.raw) {
      tasks.push({ url: info.downloads.raw.url, file: dest, sha1: info.downloads.raw.sha1, executable: !!info.executable });
    } else if (info.type === 'link' && info.target) {
      links.push({ dest, target: info.target });
    }
  }
  await downloadAll(tasks, { onProgress });
  if (process.platform !== 'win32') {
    for (const t of tasks) {
      if (t.executable) { try { fs.chmodSync(t.file, 0o755); } catch {} }
    }
    for (const l of links) {
      try { if (!fs.existsSync(l.dest)) fs.symlinkSync(l.target, l.dest); } catch {}
    }
  }
  const exe = javaExePath(runtimeDir, component);
  if (!isFresh(exe)) throw new Error('Runtime Java incomplet après téléchargement.');
  return exe;
}

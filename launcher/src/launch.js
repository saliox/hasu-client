// Préparation et lancement du jeu : versions, bibliothèques, natives, assets, Java,
// Forge, puis spawn de la JVM. Chaque manifeste réseau est mis en cache sur disque,
// donc un lancement DÉJÀ préparé fonctionne aussi hors-ligne.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { downloadAll, downloadFile, fetchJson, fetchMavenSha1, isFresh } from './download.js';
import { getVersionJson, resolveLibraries, resolveAssets, buildGameArgs, osName } from './mojang.js';
import { ensureForge, resolveForgeLibraries, mergeVersionJson, FORGE_MC_VERSION } from './forge.js';
import { ensureJava } from './java.js';
import { extractZip } from './zip.js';

// UUID hors-ligne : même dérivation que le serveur vanilla (UUID v3 de
// "OfflinePlayer:<pseudo>") — le skin/pseudo reste cohérent en solo et en LAN.
export function offlineUuid(name) {
  const md5 = crypto.createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest();
  md5[6] = (md5[6] & 0x0f) | 0x30; // version 3
  md5[8] = (md5[8] & 0x3f) | 0x80; // variante RFC 4122
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// JSON réseau avec cache disque : le réseau d'abord (données fraîches), le cache en
// secours (mode hors-ligne / panne Mojang).
async function cachedJson(url, file) {
  try {
    const data = await fetchJson(url);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
    return data;
  } catch (e) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    throw e;
  }
}

let child = null;
export function isGameRunning() { return !!child; }
export function stopGame() {
  if (child) { try { child.kill(); } catch {} }
}

// Options : { gameDir, versionId, forge, session {name, uuid, accessToken, userType},
//             ramMb, extraJvmArgs, demo }
// Hooks : { onStage(label), onProgress({done,total,stage}), onLog(line), onExit(code) }
export async function prepareAndLaunch(opts, hooks = {}) {
  const stage = (s) => { try { hooks.onStage?.(s); } catch {} };
  const progress = (stageName) => (p) => { try { hooks.onProgress?.({ ...p, stage: stageName }); } catch {} };
  const log = (l) => { try { hooks.onLog?.(l); } catch {} };

  const gameDir = opts.gameDir;
  const librariesDir = path.join(gameDir, 'libraries');
  const assetsDir = path.join(gameDir, 'assets');
  const runtimeDir = path.join(gameDir, 'runtime');
  const versionId = opts.versionId || FORGE_MC_VERSION;
  const versionDir = path.join(gameDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });

  // 1. JSON de version vanilla (cache disque pour le hors-ligne).
  stage('Métadonnées de version…');
  let vjson;
  const vjsonFile = path.join(versionDir, versionId + '.json');
  try {
    vjson = await getVersionJson(versionId);
    fs.writeFileSync(vjsonFile, JSON.stringify(vjson));
  } catch (e) {
    try { vjson = JSON.parse(fs.readFileSync(vjsonFile, 'utf8')); } catch {}
    if (!vjson) throw new Error(`Impossible de récupérer la version ${versionId} : ${e.message}`);
  }

  // 2. Java (JRE officiel Mojang, ex. jre-legacy = Java 8 pour 1.8.9).
  const component = vjson.javaVersion?.component || 'jre-legacy';
  stage(`Java (${component})…`);
  const javaExe = await ensureJava(runtimeDir, component, { onProgress: progress('java') });

  // 3. Client jar + bibliothèques + natives.
  stage('Bibliothèques…');
  const clientJar = path.join(versionDir, versionId + '.jar');
  const tasks = [];
  if (vjson.downloads?.client) {
    tasks.push({ url: vjson.downloads.client.url, file: clientJar, sha1: vjson.downloads.client.sha1 });
  }
  const { classpath, natives } = resolveLibraries(vjson, librariesDir);
  tasks.push(...classpath, ...natives);

  // 4. Forge (fusion du version.json embarqué dans le universal jar).
  let forgeJar = null;
  let launchJson = vjson;
  if (opts.forge) {
    stage('Forge…');
    const forge = await ensureForge(librariesDir);
    forgeJar = forge.jar;
    tasks.push(...resolveForgeLibraries(forge.versionJson, librariesDir));
    launchJson = mergeVersionJson(vjson, forge.versionJson);
  }
  // Bibliothèques au vieux format (Forge) : pas de sha1 dans le manifeste JSON, on
  // récupère le sidecar Maven <url>.sha1 pour vérifier quand même l'intégrité avant
  // téléchargement, plutôt que de les laisser passer sans aucun contrôle.
  await Promise.all(tasks.filter((t) => !t.sha1).map(async (t) => { t.sha1 = await fetchMavenSha1(t.url); }));
  await downloadAll(tasks, { onProgress: progress('libraries') });

  // 5. Assets.
  stage('Ressources du jeu…');
  const idxName = vjson.assetIndex?.id || 'legacy';
  const idxFile = path.join(assetsDir, 'indexes', idxName + '.json');
  let assetTasks = [];
  if (vjson.assetIndex?.url) {
    const idx = await cachedJson(vjson.assetIndex.url, idxFile);
    assetTasks = resolveAssets(idx, assetsDir);
  }
  await downloadAll(assetTasks, { limit: 16, onProgress: progress('assets') });

  // 6. Natives : extraction dans un dossier propre par version.
  stage('Préparation…');
  const nativesDir = path.join(gameDir, 'natives', versionId);
  fs.rmSync(nativesDir, { recursive: true, force: true });
  fs.mkdirSync(nativesDir, { recursive: true });
  for (const n of natives) {
    const exclude = n.extract?.exclude || ['META-INF/'];
    try {
      extractZip(n.file, nativesDir, { exclude });
    } catch (e) {
      throw new Error(`Extraction des natives échouée pour ${path.basename(n.file)} : ${e.message}`);
    }
  }

  // 7. Classpath : Forge d'abord, puis ses libs, puis vanilla, client jar en dernier.
  const cpFiles = [];
  if (forgeJar) cpFiles.push(forgeJar);
  for (const t of tasks) {
    if (t.file.endsWith('.jar') && t.file.startsWith(librariesDir) && !natives.includes(t)) cpFiles.push(t.file);
  }
  cpFiles.push(clientJar);
  const cp = [...new Set(cpFiles)].join(path.delimiter);

  // 8. Arguments.
  const s = opts.session || {};
  const name = s.name || 'Joueur';
  const values = {
    auth_player_name: name,
    version_name: versionId,
    game_directory: gameDir,
    assets_root: assetsDir,
    game_assets: path.join(assetsDir, 'virtual', 'legacy'),
    assets_index_name: idxName,
    auth_uuid: s.uuid || offlineUuid(name),
    auth_access_token: s.accessToken || '0',
    auth_session: s.accessToken || '0',
    user_properties: '{}',
    user_type: s.userType || 'msa',
    version_type: launchJson.type || 'release',
  };
  const ram = Math.max(1024, Math.min(16384, opts.ramMb || 2048));
  const jvmArgs = [
    `-Xmx${ram}M`, `-Xms${Math.min(1024, ram)}M`,
    // Réglages G1 éprouvés pour limiter les à-coups de GC en 1.8.9 (boost FPS).
    '-XX:+UseG1GC', '-XX:+UnlockExperimentalVMOptions', '-XX:G1NewSizePercent=20',
    '-XX:G1ReservePercent=20', '-XX:MaxGCPauseMillis=50', '-XX:G1HeapRegionSize=32M',
    `-Djava.library.path=${nativesDir}`,
    ...(Array.isArray(opts.extraJvmArgs) ? opts.extraJvmArgs : []),
    '-cp', cp,
  ];
  const gameArgs = buildGameArgs(launchJson, values);

  // 9. Lancement.
  stage('Lancement du jeu…');
  log(`[launcher] ${path.basename(javaExe)} ${launchJson.mainClass} (${versionId}${opts.forge ? ' + Forge' : ''}, ${ram} Mo)`);
  child = spawn(javaExe, [...jvmArgs, launchJson.mainClass, ...gameArgs], {
    cwd: gameDir,
    env: { ...process.env },
  });
  let buf = { out: '', err: '' };
  const pump = (key) => (data) => {
    buf[key] += data.toString('utf8');
    let i;
    while ((i = buf[key].indexOf('\n')) >= 0) {
      const line = buf[key].slice(0, i).replace(/\r$/, '');
      buf[key] = buf[key].slice(i + 1);
      if (line) log(line);
    }
  };
  child.stdout.on('data', pump('out'));
  child.stderr.on('data', pump('err'));
  child.on('error', (e) => { log(`[launcher] Échec du lancement : ${e.message}`); });
  child.on('exit', (code) => {
    child = null;
    log(`[launcher] Jeu fermé (code ${code ?? '?'}).`);
    try { hooks.onExit?.(code); } catch {}
  });
  return { pid: child.pid };
}

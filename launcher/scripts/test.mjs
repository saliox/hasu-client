// Tests du Hasu Launcher — logique pure, sans réseau ni Electron :
//   node scripts/test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

import { isNewer, isAllowedInstallerUrl } from '../src/updater.js';
import { ruleAllows, mavenToPath, substituteArgs, buildGameArgs, resolveLibraries, resolveAssets } from '../src/mojang.js';
import { offlineUuid } from '../src/launch.js';
import { listZipEntries, readZipEntry, readZipFile, extractZip } from '../src/zip.js';
import { resolveForgeLibraries, mergeVersionJson, forgeUniversalUrl, FORGE_BUILD } from '../src/forge.js';
import { isFresh, sha1File } from '../src/download.js';
import { runtimePlatform, javaExePath } from '../src/java.js';
import { encodePNG, pngToIco } from '../src/png.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

// ---------- updater ----------
test('isNewer compare les versions numériquement', () => {
  assert.equal(isNewer('2.0.1', '2.0.0'), true);
  assert.equal(isNewer('2.0.0', '2.0.0'), false);
  assert.equal(isNewer('2.0.0', '2.0.1'), false);
  assert.equal(isNewer('10.0.0', '9.9.9'), true);
  assert.equal(isNewer('', '1.0.0'), false);
});
test('isAllowedInstallerUrl : uniquement les releases du dépôt en HTTPS', () => {
  assert.equal(isAllowedInstallerUrl('https://github.com/saliox/hasu-client/releases/download/launcher-v2.0.0/HasuLauncher-Setup-2.0.0.exe'), true);
  assert.equal(isAllowedInstallerUrl('http://github.com/saliox/hasu-client/releases/download/x/x.exe'), false);
  assert.equal(isAllowedInstallerUrl('https://evil.com/saliox/hasu-client/releases/download/x.exe'), false);
  assert.equal(isAllowedInstallerUrl('https://github.com/autre/depot/releases/download/x.exe'), false);
  assert.equal(isAllowedInstallerUrl('pas une url'), false);
});

// ---------- mojang : règles, maven, arguments ----------
test('ruleAllows applique la dernière règle correspondante', () => {
  assert.equal(ruleAllows(undefined, 'windows'), true);
  assert.equal(ruleAllows([], 'windows'), true);
  assert.equal(ruleAllows([{ action: 'allow' }], 'windows'), true);
  assert.equal(ruleAllows([{ action: 'allow', os: { name: 'osx' } }], 'windows'), false);
  assert.equal(ruleAllows([{ action: 'allow' }, { action: 'disallow', os: { name: 'windows' } }], 'windows'), false);
  assert.equal(ruleAllows([{ action: 'allow' }, { action: 'disallow', os: { name: 'osx' } }], 'windows'), true);
});
test('mavenToPath convertit group:artifact:version[:classifier]', () => {
  assert.equal(mavenToPath('com.google.guava:guava:17.0'), 'com/google/guava/guava/17.0/guava-17.0.jar');
  assert.equal(mavenToPath('org.lwjgl.lwjgl:lwjgl:2.9.4:natives-windows'),
    'org/lwjgl/lwjgl/lwjgl/2.9.4/lwjgl-2.9.4-natives-windows.jar');
});
test('substituteArgs remplace les placeholders connus et garde les autres', () => {
  assert.equal(substituteArgs('--username ${auth_player_name}', { auth_player_name: 'Hasu' }), '--username Hasu');
  assert.equal(substituteArgs('${inconnu}', {}), '${inconnu}');
});
test('buildGameArgs : format 1.8.9 (minecraftArguments)', () => {
  const json = { minecraftArguments: '--username ${auth_player_name} --version ${version_name} --userProperties ${user_properties}' };
  assert.deepEqual(buildGameArgs(json, { auth_player_name: 'Hasu', version_name: '1.8.9', user_properties: '{}' }),
    ['--username', 'Hasu', '--version', '1.8.9', '--userProperties', '{}']);
});
test('buildGameArgs : format moderne (arguments.game), objets à règles ignorés', () => {
  const json = { arguments: { game: ['--username', '${auth_player_name}', { rules: [], value: '--demo' }] } };
  assert.deepEqual(buildGameArgs(json, { auth_player_name: 'Hasu' }), ['--username', 'Hasu']);
});
test('resolveLibraries : classpath, natives et règles par OS', () => {
  const vjson = {
    libraries: [
      { name: 'a:b:1', downloads: { artifact: { path: 'a/b/1/b-1.jar', url: 'https://x/a.jar', sha1: 'abc' } } },
      { name: 'mac:only:1', rules: [{ action: 'allow', os: { name: 'osx' } }], downloads: { artifact: { path: 'm/o/1/o-1.jar', url: 'https://x/m.jar', sha1: 'd' } } },
      {
        name: 'org.lwjgl.lwjgl:lwjgl-platform:2.9.4', natives: { windows: 'natives-windows-${arch}' },
        downloads: { classifiers: { 'natives-windows-64': { path: 'n/n-64.jar', url: 'https://x/n.jar', sha1: 'e' } } },
        extract: { exclude: ['META-INF/'] },
      },
      { name: 'vieux.format:forge-lib:1', url: 'https://maven.example/' },
    ],
  };
  const { classpath, natives } = resolveLibraries(vjson, '/libs', 'windows', 'x64');
  assert.equal(classpath.length, 2);
  assert.ok(classpath[0].file.endsWith(path.join('a', 'b', '1', 'b-1.jar')));
  assert.equal(classpath[1].url, 'https://maven.example/vieux/format/forge-lib/1/forge-lib-1.jar');
  assert.equal(natives.length, 1);
  assert.equal(natives[0].sha1, 'e');
  assert.deepEqual(natives[0].extract.exclude, ['META-INF/']);
});
test('resolveAssets construit les URLs par hash', () => {
  const tasks = resolveAssets({ objects: { 'minecraft/sounds/x.ogg': { hash: 'aabbcc', size: 10 } } }, '/assets');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].url, 'https://resources.download.minecraft.net/aa/aabbcc');
  assert.ok(tasks[0].file.endsWith(path.join('objects', 'aa', 'aabbcc')));
});

// ---------- launch : UUID hors-ligne ----------
test('offlineUuid : déterministe, version 3, variante RFC 4122', () => {
  const u1 = offlineUuid('Hasu');
  const u2 = offlineUuid('Hasu');
  assert.equal(u1, u2);
  assert.match(u1, /^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(offlineUuid('Autre'), u1);
});

// ---------- zip : archive construite à la main ----------
function buildZip(entries) {
  // Écrit un ZIP minimal (stored ou deflate) pour tester le lecteur.
  const parts = [];
  const central = [];
  let offset = 0;
  for (const { name, data, deflate } of entries) {
    const raw = Buffer.from(data);
    const comp = deflate ? zlib.deflateRawSync(raw) : raw;
    const nameBuf = Buffer.from(name, 'utf8');
    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0);
    loc.writeUInt16LE(deflate ? 8 : 0, 8);
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(raw.length, 22);
    loc.writeUInt16LE(nameBuf.length, 26);
    parts.push(loc, nameBuf, comp);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(deflate ? 8 : 0, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, nameBuf]));
    offset += loc.length + nameBuf.length + comp.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

test('zip : liste + lecture (stored et deflate)', () => {
  const zip = buildZip([
    { name: 'version.json', data: '{"id":"forge"}', deflate: true },
    { name: 'natif.dll', data: 'DLLDATA', deflate: false },
  ]);
  const entries = listZipEntries(zip);
  assert.deepEqual(entries.map((e) => e.name), ['version.json', 'natif.dll']);
  assert.equal(readZipEntry(zip, entries[0]).toString(), '{"id":"forge"}');
  assert.equal(readZipEntry(zip, entries[1]).toString(), 'DLLDATA');
});
test('zip : extraction avec exclusions et protection zip-slip', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hasu-zip-'));
  const zipFile = path.join(dir, 'a.zip');
  fs.writeFileSync(zipFile, buildZip([
    { name: 'ok.txt', data: 'ok', deflate: true },
    { name: 'META-INF/MANIFEST.MF', data: 'x', deflate: false },
    { name: '../evasion.txt', data: 'mal', deflate: false },
  ]));
  const out = extractZip(zipFile, path.join(dir, 'out'), { exclude: ['META-INF/'] });
  assert.equal(out.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'out', 'ok.txt'), 'utf8'), 'ok');
  assert.equal(fs.existsSync(path.join(dir, 'evasion.txt')), false);
  assert.equal(readZipFile(zipFile, 'absent'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- forge ----------
test('forge : URL du universal jar + résolution des bibliothèques', () => {
  assert.equal(forgeUniversalUrl(),
    `https://maven.minecraftforge.net/net/minecraftforge/forge/${FORGE_BUILD}/forge-${FORGE_BUILD}-universal.jar`);
  const fjson = {
    libraries: [
      { name: `net.minecraftforge:forge:${FORGE_BUILD}` },                       // le jar lui-même : exclu
      { name: 'net.minecraft:launchwrapper:1.12', url: 'http://files.minecraftforge.net/maven/' },
      { name: 'lib.serveur:only:1', clientreq: false },                          // serveur : exclue
      { name: 'com.google.guava:guava:17.0' },                                   // lib Mojang
    ],
  };
  const tasks = resolveForgeLibraries(fjson, '/libs');
  assert.equal(tasks.length, 2);
  // l'URL http historique est remplacée par le maven officiel HTTPS
  assert.equal(tasks[0].url, 'https://maven.minecraftforge.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar');
  assert.equal(tasks[1].url, 'https://libraries.minecraft.net/com/google/guava/guava/17.0/guava-17.0.jar');
});
test('forge : fusion du version.json (mainClass + arguments imposés)', () => {
  const vanilla = { id: '1.8.9', mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '--username ${auth_player_name}', type: 'release' };
  const forge = { id: 'forge-1.8.9', mainClass: 'net.minecraft.launchwrapper.Launch', minecraftArguments: '--username ${auth_player_name} --tweakClass fml' };
  const merged = mergeVersionJson(vanilla, forge);
  assert.equal(merged.mainClass, 'net.minecraft.launchwrapper.Launch');
  assert.ok(merged.minecraftArguments.includes('--tweakClass'));
  assert.equal(merged.type, 'release');
});

// ---------- download : intégrité fichiers ----------
test('isFresh / sha1File détectent présence et corruption', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hasu-dl-'));
  const f = path.join(dir, 'x.bin');
  assert.equal(isFresh(f), false);
  fs.writeFileSync(f, 'contenu');
  const sha = crypto.createHash('sha1').update('contenu').digest('hex');
  assert.equal(sha1File(f), sha);
  assert.equal(isFresh(f), true);
  assert.equal(isFresh(f, sha), true);
  assert.equal(isFresh(f, 'deadbeef'), false);
  fs.writeFileSync(f, '');
  assert.equal(isFresh(f), false); // fichier vide = à retélécharger
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------- java ----------
test('runtimePlatform et javaExePath', () => {
  assert.equal(runtimePlatform('win32', 'x64'), 'windows-x64');
  assert.equal(runtimePlatform('linux', 'x64'), 'linux');
  assert.equal(runtimePlatform('darwin', 'arm64'), 'mac-os-arm64');
  assert.ok(javaExePath('/rt', 'jre-legacy', 'win32').endsWith(path.join('jre-legacy', 'bin', 'javaw.exe')));
  assert.ok(javaExePath('/rt', 'jre-legacy', 'linux').endsWith(path.join('jre-legacy', 'bin', 'java')));
});

// ---------- png/ico ----------
test('encodePNG/pngToIco produisent des signatures valides', () => {
  const png = encodePNG(2, 2, Buffer.alloc(2 * 2 * 4, 255));
  assert.deepEqual([...png.subarray(0, 4)], [137, 80, 78, 71]);
  const ico = pngToIco(png);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.length, 22 + png.length);
});

console.log(process.exitCode ? `Échecs — ${passed} test(s) OK` : `✓ ${passed} tests OK`);

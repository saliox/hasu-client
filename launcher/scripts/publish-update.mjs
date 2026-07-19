// Publie une mise à jour du Hasu Launcher, même canal que Cap Hub :
// construit l'installeur, calcule son SHA-256, met à jour launcher/version.json
// (lu en raw par l'auto-update), et crée la Release GitHub qui héberge l'exe.
//
//   node scripts/publish-update.mjs ["notes de version"]
//
// Nécessite `gh` authentifié. L'app cliente vérifie le SHA-256 avant d'installer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = 'saliox/hasu-client';
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const notes = process.argv.slice(2).join(' ') || `Hasu Launcher ${version}`;

const installerName = `HasuLauncher-Setup-${version}.exe`;
const installerPath = path.join(root, 'dist', installerName);

// 1. Construire l'installeur si absent.
if (!fs.existsSync(installerPath)) {
  console.log(`Installeur ${version} absent → electron-builder…`);
  const r = spawnSync('npm', ['run', 'dist'], { cwd: root, stdio: 'inherit', shell: true });
  if (r.status !== 0 || !fs.existsSync(installerPath)) {
    console.error(`Échec build (attendu : dist/${installerName}).`);
    process.exit(1);
  }
}

// 2. SHA-256.
const buf = fs.readFileSync(installerPath);
const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
const tag = `launcher-v${version}`;

// 3. Écrire launcher/version.json (le manifeste lu par l'auto-update).
const manifest = {
  version,
  url: `https://github.com/${REPO}/releases/download/${tag}/${installerName}`,
  sha256,
  notes,
  pubDate: new Date().toISOString(),
};
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`version.json → ${version} | sha256 ${sha256.slice(0, 12)}…`);

// 4. Release GitHub (assets : installeur + portable si présent).
const assets = [installerPath];
const portable = path.join(root, 'dist', `HasuLauncher-${version}-portable.exe`);
if (fs.existsSync(portable)) assets.push(portable);

const exists = spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' }).status === 0;
const gh = exists
  ? spawnSync('gh', ['release', 'upload', tag, ...assets, '--repo', REPO, '--clobber'], { stdio: 'inherit' })
  : spawnSync('gh', ['release', 'create', tag, ...assets, '--repo', REPO, '--title', `Hasu Launcher ${version}`, '--notes', notes], { stdio: 'inherit' });

if (gh.status !== 0) { console.error('Publication GitHub échouée.'); process.exit(1); }

console.log('\n✅ Release publiée. Commit + push de launcher/version.json pour armer l’auto-update :');
console.log('   git add launcher/version.json && git commit -m "Hasu Launcher ' + version + '" && git push');

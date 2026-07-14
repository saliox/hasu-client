// Publie une mise à jour de Cap Hub, même canal que le reste du dépôt :
// construit l'installeur, calcule son SHA-256, met à jour cap-hub/version.json
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
const notes = process.argv.slice(2).join(' ') || `Cap Hub ${version}`;

const installerName = `Cap Hub Setup ${version}.exe`;
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
const tag = `cap-hub-v${version}`;

// 3. Écrire cap-hub/version.json (le manifeste lu par l'auto-update).
const manifest = {
  version,
  url: `https://github.com/${REPO}/releases/download/${tag}/${installerName.replace(/ /g, '.')}`,
  sha256,
  notes,
  pubDate: new Date().toISOString(),
};
const manifestPath = path.join(root, 'version.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`version.json → ${version} | sha256 ${sha256.slice(0, 12)}…`);

// 4. Release GitHub (asset = installeur, nom sans espaces pour l'URL).
const uploadName = installerName.replace(/ /g, '.');
const staged = path.join(root, 'dist', uploadName);
fs.copyFileSync(installerPath, staged);

const exists = spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore' }).status === 0;
const gh = exists
  ? spawnSync('gh', ['release', 'upload', tag, staged, '--repo', REPO, '--clobber'], { stdio: 'inherit' })
  : spawnSync('gh', ['release', 'create', tag, staged, '--repo', REPO, '--title', `Cap Hub ${version}`, '--notes', notes], { stdio: 'inherit' });

if (gh.status !== 0) { console.error('Publication GitHub échouée.'); process.exit(1); }

console.log('\n✅ Release publiée. Commit + push de cap-hub/version.json pour armer l’auto-update :');
console.log('   git add cap-hub/version.json && git commit -m "Cap Hub ' + version + '" && git push');

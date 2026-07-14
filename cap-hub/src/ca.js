// Autorité de certification LOCALE de Cap Hub. Nécessaire pour intercepter les
// fournisseurs de capes en HTTPS (MinecraftCapes, LabyMod…) : le proxy présente un
// certificat signé par cette CA, généré à la volée pour chaque domaine (SNI).
//
// IMPORTANT — Minecraft est en Java : il n'utilise PAS le magasin de certificats de
// Windows mais son PROPRE truststore (`cacerts`, un par JRE). Pour que les canaux
// HTTPS fonctionnent, la CA Cap Hub doit donc être importée dans le `cacerts` du JRE
// utilisé par le client (via keytool). On l'ajoute aussi au magasin utilisateur de
// Windows (utile aux clients non-Java). Tout est OPT-IN et RÉVERSIBLE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import { execFile } from 'node:child_process';
import forge from 'node-forge';

const { pki, md } = forge;
const CA_CN = 'Cap Hub Local CA';
const JVM_ALIAS = 'caphub';

let dir = null;              // dossier de la CA (userData/ca)
let ca = null;               // { certPem, keyPem, cert, key }
const leafCache = new Map(); // host -> tls.SecureContext

export function initCA(userDataDir) {
  dir = path.join(userDataDir, 'ca');
  fs.mkdirSync(dir, { recursive: true });
  load();
}

const caCertPath = () => path.join(dir, 'caphub-ca.pem');
const caKeyPath = () => path.join(dir, 'caphub-ca.key.pem');

export function caFilePath() { return caCertPath(); }
export function caExists() { return !!ca; }

function load() {
  try {
    const certPem = fs.readFileSync(caCertPath(), 'utf8');
    const keyPem = fs.readFileSync(caKeyPath(), 'utf8');
    ca = { certPem, keyPem, cert: pki.certificateFromPem(certPem), key: pki.privateKeyFromPem(keyPem) };
  } catch { ca = null; }
}

// Crée la CA si absente. Idempotent.
export function ensureCA() {
  if (ca) return ca;
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(2020, 0, 1);
  cert.validity.notAfter = new Date(2040, 0, 1);
  const attrs = [{ name: 'commonName', value: CA_CN }, { name: 'organizationName', value: 'Cap Hub' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
  ]);
  cert.sign(keys.privateKey, md.sha256.create());
  const certPem = pki.certificateToPem(cert);
  const keyPem = pki.privateKeyToPem(keys.privateKey);
  fs.writeFileSync(caCertPath(), certPem);
  fs.writeFileSync(caKeyPath(), keyPem, { mode: 0o600 });
  ca = { certPem, keyPem, cert, key: keys.privateKey };
  leafCache.clear();
  return ca;
}

// Certificat feuille pour un domaine, signé par la CA. Mis en cache par host.
export function secureContextFor(host) {
  if (!ca) throw new Error('CA Cap Hub absente');
  const key = host.toLowerCase();
  if (leafCache.has(key)) return leafCache.get(key);
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = Date.now().toString(16) + Math.floor(host.length).toString(16).padStart(2, '0');
  cert.validity.notBefore = new Date(2020, 0, 1);
  cert.validity.notAfter = new Date(2040, 0, 1);
  cert.setSubject([{ name: 'commonName', value: host }]);
  cert.setIssuer(ca.cert.subject.attributes);
  cert.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: [{ type: 2, value: host }] },
  ]);
  cert.sign(ca.key, md.sha256.create());
  const ctx = tls.createSecureContext({ key: pki.privateKeyToPem(keys.privateKey), cert: pki.certificateToPem(cert) });
  leafCache.set(key, ctx);
  return ctx;
}

// ---------- Confiance système ----------
const run = (file, args, opts = {}) => new Promise((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 60000, ...opts }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: (stdout || '') + (stderr || ''), code: err?.code });
  });
});

// Windows : magasin utilisateur "Root" (pas besoin d'admin).
export async function installWindowsUserTrust() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows uniquement' };
  ensureCA();
  const r = await run('certutil', ['-user', '-addstore', 'Root', caCertPath()]);
  return r.ok ? { ok: true } : { ok: false, error: 'certutil a échoué : ' + r.out.trim().slice(0, 200) };
}

export async function removeWindowsUserTrust() {
  if (process.platform !== 'win32') return { ok: false, error: 'Windows uniquement' };
  const r = await run('certutil', ['-user', '-delstore', 'Root', CA_CN]);
  return r.ok ? { ok: true } : { ok: false, error: r.out.trim().slice(0, 200) };
}

// ---------- Truststore Java (cacerts) — le vrai canal pour Minecraft ----------
// Cherche les fichiers cacerts des JRE embarqués par les launchers courants.
export function findJavaTrustStores() {
  if (process.platform !== 'win32') return [];
  const home = os.homedir();
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const roots = [
    path.join(local, 'Packages'),                                   // launcher officiel (MS Store)
    'C:\\Program Files (x86)\\Minecraft Launcher\\runtime',
    'C:\\Program Files\\Minecraft Launcher\\runtime',
    path.join(home, '.lunarclient'),                                // Lunar
    path.join(home, 'AppData', 'Roaming', '.minecraft', 'runtime'),
    path.join(local, 'Programs'),                                   // Prism/autres
  ];
  const found = new Set();
  const walk = (base, depth) => {
    if (depth < 0) return;
    let entries = [];
    try { entries = fs.readdirSync(base, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(base, e.name);
      if (e.isDirectory()) { if (found.size < 40) walk(p, depth - 1); }
      else if (e.name === 'cacerts') found.add(p);
    }
  };
  for (const r of roots) walk(r, 6);
  return [...found];
}

// Localise keytool (livré avec chaque JRE, à côté de bin/java).
function keytoolNear(cacertsPath) {
  // .../lib/security/cacerts -> .../bin/keytool.exe
  const jreRoot = path.resolve(path.dirname(cacertsPath), '..', '..');
  const kt = path.join(jreRoot, 'bin', 'keytool.exe');
  return fs.existsSync(kt) ? kt : 'keytool';
}

export async function injectJavaTrust(cacertsPath) {
  ensureCA();
  const kt = keytoolNear(cacertsPath);
  // -noprompt : pas d'interaction ; storepass par défaut d'un cacerts = "changeit".
  await run(kt, ['-delete', '-alias', JVM_ALIAS, '-keystore', cacertsPath, '-storepass', 'changeit']); // idempotent
  const r = await run(kt, ['-importcert', '-noprompt', '-trustcacerts', '-alias', JVM_ALIAS,
    '-file', caCertPath(), '-keystore', cacertsPath, '-storepass', 'changeit']);
  return r.ok ? { ok: true, path: cacertsPath } : { ok: false, path: cacertsPath, error: r.out.trim().slice(0, 200) };
}

export async function removeJavaTrust(cacertsPath) {
  const kt = keytoolNear(cacertsPath);
  const r = await run(kt, ['-delete', '-alias', JVM_ALIAS, '-keystore', cacertsPath, '-storepass', 'changeit']);
  return r.ok ? { ok: true, path: cacertsPath } : { ok: false, path: cacertsPath, error: r.out.trim().slice(0, 200) };
}

// Installe partout où c'est possible. Renvoie un rapport par cible.
export async function installTrustEverywhere() {
  ensureCA();
  const report = { windows: await installWindowsUserTrust(), java: [] };
  for (const cs of findJavaTrustStores()) report.java.push(await injectJavaTrust(cs));
  return report;
}

export async function removeTrustEverywhere() {
  const report = { windows: await removeWindowsUserTrust(), java: [] };
  for (const cs of findJavaTrustStores()) report.java.push(await removeJavaTrust(cs));
  return report;
}

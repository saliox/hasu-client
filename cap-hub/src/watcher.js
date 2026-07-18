// Détection du lancement de Minecraft (n'importe quel client / launcher).
// Sondage léger des processus Windows toutes les 4 s via PowerShell CIM :
// - java/javaw avec une ligne de commande "minecraft"  -> jeu en cours
// - exécutables de launchers connus                    -> lancement imminent
// Émet : 'game-start' { key, client, username, pid }, 'game-stop' (plus aucun jeu).
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

export const watcherEvents = new EventEmitter();

// Launchers/clients détectés par NOM de processus (avant même que Java démarre).
const LAUNCHER_EXES = {
  'minecraftlauncher.exe': 'Launcher Minecraft officiel',
  'minecraft.exe': 'Launcher Minecraft (Store)',
  'lunarclient.exe': 'Lunar Client',
  'badlionclient.exe': 'Badlion Client',
  'feather.exe': 'Feather Client',
  'prismlauncher.exe': 'Prism Launcher',
  'polymc.exe': 'PolyMC',
  'multimc.exe': 'MultiMC',
  'atlauncher.exe': 'ATLauncher',
  'gdlauncher.exe': 'GDLauncher',
  'tlauncher.exe': 'TLauncher',
  'curseforge.exe': 'CurseForge',
  'hasulauncher.exe': 'Hasu Launcher',
  'modrinth app.exe': 'Modrinth App',
  'ftb app.exe': 'FTB App',
  'ftbapp.exe': 'FTB App',
  'techniclauncher.exe': 'Technic Launcher',
  'sklauncher.exe': 'SKLauncher',
  'legacylauncher.exe': 'Legacy Launcher',
  'labymod.exe': 'LabyMod',
  'xmdl.exe': 'X Minecraft Launcher',
  'foldercraft.exe': 'FolderCraft',
};

// Signatures dans la ligne de commande Java -> nom du client en jeu. On vise des
// jetons ANCRÉS (classe main, arguments de lancement, packages précis, dossier
// .minecraft entre séparateurs) plutôt que des sous-chaînes fourre-tout comme
// « fabric »/« forge »/« .minecraft » qui matchaient n'importe quel classpath.
const JAVA_SIGNS = [
  { re: /com\.moonsworth\.lunar/i, client: 'Lunar Client (en jeu)' },
  { re: /net\.badlion\.|badlionclient/i, client: 'Badlion Client (en jeu)' },
  { re: /net\.digitalingot\.feather|featherclient/i, client: 'Feather Client (en jeu)' },
  { re: /\bhasu(?:client)?\b/i, client: 'Hasu Client (en jeu)' },
  { re: /net\.labymod\b/i, client: 'LabyMod (en jeu)' },
  {
    re: /net\.minecraft\.client\.main\.Main|net\.minecraft\.launchwrapper|--gameDir\b|--assetIndex\b|--assetsDir\b|[\\/]\.minecraft[\\/]|net\.fabricmc\.|org\.quiltmc\.|net\.minecraftforge\.|cpw\.mods\.modlauncher|cpw\.mods\.bootstraplauncher|io\.github\.zekerzhayard/i,
    client: 'Minecraft (en jeu)',
  },
];

const NAMES = ['javaw.exe', 'java.exe', ...Object.keys(LAUNCHER_EXES)];
const FILTER = NAMES.map((n) => `Name='${n}'`).join(' or ');
const PS_CMD =
  `Get-CimInstance Win32_Process -Filter "${FILTER}" | ` +
  `Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress`;

function listProcesses() {
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-Command', PS_CMD],
      { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout || !stdout.trim()) return resolve([]);
        try {
          const j = JSON.parse(stdout);
          resolve(Array.isArray(j) ? j : [j]);
        } catch { resolve([]); }
      });
  });
}

// Classe un processus : renvoie { key, client, username } ou null s'il ne
// ressemble pas à Minecraft (ex. java.exe d'un autre programme). Exporté pour les tests.
export function classify(p) {
  const name = String(p.Name || '').toLowerCase();
  const cmd = String(p.CommandLine || '');
  if (LAUNCHER_EXES[name]) return { key: `launcher:${name}`, client: LAUNCHER_EXES[name], username: null };
  if (name === 'javaw.exe' || name === 'java.exe') {
    for (const s of JAVA_SIGNS) {
      if (s.re.test(cmd)) {
        const um = /--username(?:=|\s+)"?([A-Za-z0-9_]{1,16})"?/.exec(cmd);
        return { key: `java:${p.ProcessId}`, client: s.client, username: um ? um[1] : null };
      }
    }
  }
  return null;
}

let timer = null;
let known = new Map(); // key -> { client, username, pid }
let scanning = false;

async function scan() {
  if (scanning) return;
  scanning = true;
  try {
    const procs = await listProcesses();
    const current = new Map();
    for (const p of procs) {
      const c = classify(p);
      if (c) current.set(c.key, { client: c.client, username: c.username, pid: p.ProcessId });
    }
    // Nouveaux processus -> game-start (une seule fois par clé).
    for (const [key, info] of current) {
      if (!known.has(key)) watcherEvents.emit('game-start', { key, ...info });
    }
    // game-stop = plus aucun JEU en cours (clés « java: »), même si un launcher reste
    // ouvert (sinon fermer le jeu launcher-ouvert n'émettait jamais game-stop).
    const inGame = (m) => [...m.keys()].some((k) => k.startsWith('java:'));
    const hadGame = inGame(known);
    known = current;
    if (hadGame && !inGame(current)) watcherEvents.emit('game-stop');
  } finally { scanning = false; }
}

export function currentGames() {
  return [...known.entries()].map(([key, v]) => ({ key, ...v }));
}

export function startWatcher(intervalMs = 4000) {
  if (process.platform !== 'win32' || timer) return;
  timer = setInterval(() => { scan().catch(() => {}); }, intervalMs);
  timer.unref?.();
  scan().catch(() => {});
}

export function stopWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
  known = new Map();
}


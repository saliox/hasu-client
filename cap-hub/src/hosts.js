// Redirection du domaine de capes OptiFine (s.optifine.net) vers le proxy local,
// via le fichier hosts de Windows. C'est CE mécanisme qui permet d'afficher les
// capes Cap Hub sur n'importe quel client qui sait afficher les capes OptiFine
// (vanilla+OptiFine, Forge+OptiFine, Lunar, etc.) — sans modifier aucun client.
//
// - Le bloc est délimité par des marqueurs, on ne touche à RIEN d'autre dans hosts.
// - L'écriture demande les droits admin : on passe par une élévation UAC ponctuelle
//   (PowerShell Start-Process -Verb RunAs) avec un script auto-contenu.
// - Tant que Cap Hub tourne, le proxy relaie les capes OptiFine officielles des
//   joueurs inconnus du registre : rien ne casse pour les autres.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MARK_BEGIN = '# >>> Cap Hub >>>';
const MARK_END = '# <<< Cap Hub <<<';
export const CAPE_HOST = 's.optifine.net';

const hostsPath = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');

export function isApplied() {
  if (process.platform !== 'win32') return false;
  try { return fs.readFileSync(hostsPath(), 'utf8').includes(MARK_BEGIN); } catch { return false; }
}

// Script PowerShell auto-contenu : retire l'ancien bloc Cap Hub puis (si apply)
// ré-ajoute le bloc, écrit hosts et vide le cache DNS. Exécuté élevé (UAC).
function buildScript(apply) {
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$hosts = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'`,
    `$lines = @()`,
    `if (Test-Path $hosts) { $lines = @(Get-Content $hosts) }`,
    `$out = New-Object System.Collections.Generic.List[string]`,
    `$in = $false`,
    `foreach ($l in $lines) {`,
    `  if ($l -eq '${MARK_BEGIN}') { $in = $true; continue }`,
    `  if ($l -eq '${MARK_END}') { $in = $false; continue }`,
    `  if (-not $in) { $out.Add($l) }`,
    `}`,
    apply ? [
      `$out.Add('${MARK_BEGIN}')`,
      `$out.Add('127.0.0.1 ${CAPE_HOST}')`,
      `$out.Add('${MARK_END}')`,
    ].join('\r\n') : '',
    `Set-Content -Path $hosts -Value $out -Encoding ASCII`,
    `ipconfig /flushdns | Out-Null`,
  ].filter(Boolean).join('\r\n');
}

// Lance le script élevé et attend la fin. Rejette si l'UAC est refusé.
function runElevated(script) {
  return new Promise((resolve, reject) => {
    const ps1 = path.join(os.tmpdir(), `caphub-hosts-${process.pid}.ps1`);
    fs.writeFileSync(ps1, script, 'utf8');
    const outer =
      `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -WindowStyle Hidden ` +
      `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${ps1.replace(/'/g, "''")}'); ` +
      `exit $p.ExitCode`;
    execFile('powershell.exe', ['-NoProfile', '-Command', outer], { windowsHide: true, timeout: 120000 }, (err) => {
      try { fs.unlinkSync(ps1); } catch {}
      if (err) reject(new Error('Élévation refusée ou échec de l’écriture du fichier hosts.'));
      else resolve();
    });
  });
}

export async function applyRedirect() {
  if (process.platform !== 'win32') return { ok: false, error: 'Redirection hosts disponible uniquement sous Windows.' };
  if (isApplied()) return { ok: true, already: true };
  try {
    await runElevated(buildScript(true));
    if (!isApplied()) return { ok: false, error: 'Le fichier hosts n’a pas été modifié (antivirus ?).' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function removeRedirect() {
  if (process.platform !== 'win32') return { ok: false, error: 'Redirection hosts disponible uniquement sous Windows.' };
  if (!isApplied()) return { ok: true, already: true };
  try {
    await runElevated(buildScript(false));
    if (isApplied()) return { ok: false, error: 'Le bloc Cap Hub est toujours présent dans hosts.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

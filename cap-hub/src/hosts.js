// Redirige les domaines des fournisseurs de capes ACTIVÉS vers le proxy local, via
// le fichier hosts de Windows. C'est ce qui permet d'afficher les capes Cap Hub sur
// n'importe quel client — OptiFine ET les mods de capes HTTPS — sans modifier aucun
// client.
//
// - Bloc délimité par des marqueurs : on ne touche à RIEN d'autre dans hosts.
// - Écriture élevée (UAC ponctuel via PowerShell Start-Process -Verb RunAs).
// - La liste des domaines est fournie par l'appelant (dépend des canaux activés).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const MARK_BEGIN = '# >>> Cap Hub >>>';
const MARK_END = '# <<< Cap Hub <<<';

const hostsPath = () => path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');

function readHosts() { try { return fs.readFileSync(hostsPath(), 'utf8'); } catch { return ''; } }

export function isApplied() {
  if (process.platform !== 'win32') return false;
  return readHosts().includes(MARK_BEGIN);
}

// Domaines actuellement redirigés par notre bloc (pour savoir s'il faut resynchroniser).
export function appliedHosts() {
  const txt = readHosts();
  const b = txt.indexOf(MARK_BEGIN), e = txt.indexOf(MARK_END);
  if (b < 0 || e < 0 || e < b) return [];
  return txt.slice(b, e).split(/\r?\n/)
    .map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/\s+/)[1]).filter(Boolean);
}

// Script PowerShell : retire l'ancien bloc, puis (si domaines) ré-écrit le bloc.
function buildScript(domains) {
  const add = domains && domains.length
    ? [`$out.Add('${MARK_BEGIN}')`,
       ...domains.map((d) => `$out.Add('127.0.0.1 ${String(d).replace(/[^A-Za-z0-9.-]/g, '')}')`),
       `$out.Add('${MARK_END}')`].join('\r\n')
    : '';
  return [
    `$ErrorActionPreference = 'Stop'`,
    `$hosts = Join-Path $env:SystemRoot 'System32\\drivers\\etc\\hosts'`,
    `$lines = @(); if (Test-Path $hosts) { $lines = @(Get-Content $hosts) }`,
    `$out = New-Object System.Collections.Generic.List[string]`,
    `$in = $false`,
    `foreach ($l in $lines) {`,
    `  if ($l -eq '${MARK_BEGIN}') { $in = $true; continue }`,
    `  if ($l -eq '${MARK_END}') { $in = $false; continue }`,
    `  if (-not $in) { $out.Add($l) }`,
    `}`,
    add,
    `Set-Content -Path $hosts -Value $out -Encoding ASCII`,
    `ipconfig /flushdns | Out-Null`,
  ].filter(Boolean).join('\r\n');
}

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

// Applique la redirection pour l'ensemble de domaines fourni (remplace le bloc existant).
export async function applyRedirect(domains) {
  if (process.platform !== 'win32') return { ok: false, error: 'Redirection hosts disponible uniquement sous Windows.' };
  const list = [...new Set((domains || []).filter(Boolean))];
  if (!list.length) return { ok: false, error: 'Aucun domaine à rediriger (aucun canal activé).' };
  try {
    await runElevated(buildScript(list));
    if (!isApplied()) return { ok: false, error: 'Le fichier hosts n’a pas été modifié (antivirus ?).' };
    return { ok: true, domains: list };
  } catch (e) { return { ok: false, error: e.message }; }
}

export async function removeRedirect() {
  if (process.platform !== 'win32') return { ok: false, error: 'Redirection hosts disponible uniquement sous Windows.' };
  if (!isApplied()) return { ok: true, already: true };
  try {
    await runElevated(buildScript([]));
    if (isApplied()) return { ok: false, error: 'Le bloc Cap Hub est toujours présent dans hosts.' };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

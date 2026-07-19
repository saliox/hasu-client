// Hasu Launcher — logique de l'interface. Tout passe par window.hasu (preload) :
// aucun accès Node ici, CSP stricte.
/* global hasu */
'use strict';

const $ = (id) => document.getElementById(id);
const show = (el, on) => el.classList.toggle('hidden', !on);

let settings = null;
let launching = false;

// --- Navigation ---
for (const btn of document.querySelectorAll('.nav-item')) {
  btn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.nav-item')) {
      b.classList.toggle('active', b === btn);
      b.setAttribute('aria-selected', String(b === btn));
    }
    for (const p of document.querySelectorAll('.panel')) {
      p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab);
    }
  });
}

// --- Réglages ---
async function loadSettings() {
  settings = await hasu.settings.get();
  document.body.dataset.theme = settings.theme;
  $('ver').textContent = 'v' + settings.appVersion;
  $('about-version').textContent = 'v' + settings.appVersion;
  $('in-ram').value = settings.ramMb;
  $('ram-label').textContent = settings.ramMb + ' Mo';
  $('in-forge').checked = settings.forge;
  $('in-keepopen').checked = settings.keepOpen;
  $('in-clientid').value = settings.mcClientId;
  $('in-offline-name').value = settings.offlineName;
  $('gamedir-path').textContent = settings.gameDir || settings.defaultGameDir;
  $('sel-theme').value = settings.theme;
}

function save(patch) {
  return hasu.settings.save(patch).then((s) => { settings = s; });
}

$('in-ram').addEventListener('input', () => { $('ram-label').textContent = $('in-ram').value + ' Mo'; });
$('in-ram').addEventListener('change', () => save({ ramMb: Number($('in-ram').value) }));
$('in-forge').addEventListener('change', () => save({ forge: $('in-forge').checked }));
$('in-keepopen').addEventListener('change', () => save({ keepOpen: $('in-keepopen').checked }));
$('in-clientid').addEventListener('change', () => save({ mcClientId: $('in-clientid').value }));
$('in-offline-name').addEventListener('change', () => save({ offlineName: $('in-offline-name').value }));
$('sel-theme').addEventListener('change', () => {
  document.body.dataset.theme = $('sel-theme').value;
  save({ theme: $('sel-theme').value });
});
$('btn-gamedir').addEventListener('click', async () => {
  const dir = await hasu.dirs.choose();
  if (dir) $('gamedir-path').textContent = dir;
});
$('btn-gamedir-open').addEventListener('click', () => hasu.dirs.open());

// --- Versions ---
async function loadVersions() {
  const sel = $('sel-version');
  const versions = await hasu.game.versions();
  sel.textContent = '';
  for (const id of versions) {
    const o = document.createElement('option');
    o.value = id;
    // La version du client est mise en avant, Forge inclus.
    o.textContent = id === settings.forgeMc ? `${id} (Hasu + Forge)` : id;
    sel.appendChild(o);
  }
  sel.value = versions.includes(settings.versionId) ? settings.versionId : settings.forgeMc;
}
$('sel-version').addEventListener('change', () => save({ versionId: $('sel-version').value }));

// --- Compte ---
function renderAccount(st) {
  const connected = !!st?.connected;
  $('account-dot').classList.toggle('on', connected);
  $('account-dot').classList.toggle('off', !connected);
  $('account-name').textContent = connected ? st.name : 'Non connecté';
  show($('account-on'), connected);
  show($('account-off'), !connected);
  if (connected) {
    $('account-username').textContent = st.name;
    $('account-uuid').textContent = 'UUID : ' + (st.uuid || '?');
  }
  if (st?.error) { $('login-error').textContent = st.error; show($('login-error'), true); }
  if (st?.warning) { $('login-error').textContent = st.warning; show($('login-error'), true); }
  if (connected || st?.error) show($('login-flow'), false);
}

$('btn-login').addEventListener('click', async () => {
  show($('login-error'), false);
  try {
    const { userCode, url } = await hasu.account.loginStart();
    $('login-code').textContent = userCode;
    const a = $('login-url');
    a.textContent = url;
    a.onclick = (e) => { e.preventDefault(); hasu.openExternal(url); };
    show($('login-flow'), true);
  } catch (e) {
    $('login-error').textContent = e.message || String(e);
    show($('login-error'), true);
  }
});
$('btn-login-cancel').addEventListener('click', () => { hasu.account.loginCancel(); show($('login-flow'), false); });
$('btn-logout').addEventListener('click', async () => renderAccount(await hasu.account.logout()));
hasu.account.onChanged(renderAccount);

// --- Lancement ---
const STAGE_LABELS = { java: 'Java', libraries: 'Bibliothèques', assets: 'Ressources' };

function setLaunchUi(on) {
  launching = on;
  $('btn-play').disabled = on;
  $('btn-offline').disabled = on;
  show($('launch-status'), on);
  if (!on) { $('bar-fill').style.width = '0%'; $('progress-detail').textContent = ''; }
}

async function play(offline) {
  if (launching) return;
  setLaunchUi(true);
  $('stage-text').textContent = 'Préparation…';
  const r = await hasu.game.launch({ offline });
  if (!r.ok) {
    setLaunchUi(false);
    logLine('[launcher] ' + r.error);
    $('stage-text').textContent = r.error;
    show($('launch-status'), true);
    $('bar-fill').style.width = '0%';
  } else {
    $('stage-text').textContent = 'Jeu en cours…';
    $('bar-fill').style.width = '100%';
  }
}
$('btn-play').addEventListener('click', () => play(false));
$('btn-offline').addEventListener('click', () => play(true));
$('btn-stop').addEventListener('click', () => hasu.game.stop());

hasu.game.onStage((s) => { $('stage-text').textContent = s; });
hasu.game.onProgress((p) => {
  if (p.total) {
    $('bar-fill').style.width = Math.round((p.done / p.total) * 100) + '%';
    const label = STAGE_LABELS[p.stage] || p.stage;
    $('progress-detail').textContent = `${label} : ${p.done}/${p.total} fichiers (${(p.bytes / 1048576).toFixed(1)} Mo)`;
  }
});
hasu.game.onLog(logLine);
hasu.game.onExit(({ code, error }) => {
  setLaunchUi(false);
  if (error) { $('stage-text').textContent = error; show($('launch-status'), true); }
});

// --- Console ---
const MAX_LOG_LINES = 3000;
function logLine(line) {
  const c = $('console');
  const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 20;
  c.append(line + '\n');
  // Borne la mémoire de la console (le jeu peut être très bavard).
  while (c.childNodes.length > MAX_LOG_LINES) c.removeChild(c.firstChild);
  if (atBottom) c.scrollTop = c.scrollHeight;
}
$('btn-clear-log').addEventListener('click', () => { $('console').textContent = ''; });

// --- Mises à jour ---
async function checkUpdate(manual) {
  const r = await hasu.update.check();
  if (manual) $('update-status').textContent = r.ok ? (r.available ? '' : 'À jour ✔') : 'Vérification impossible : ' + r.error;
  if (r.ok && r.available) {
    $('update-text').textContent = `Mise à jour ${r.version} disponible${r.notes ? ' — ' + r.notes : ''}`;
    show($('update-banner'), true);
  }
}
$('btn-check-update').addEventListener('click', () => checkUpdate(true));
$('btn-update').addEventListener('click', async () => {
  $('btn-update').disabled = true;
  const r = await hasu.update.apply();
  if (!r.ok) { $('update-text').textContent = 'Échec : ' + r.error; $('btn-update').disabled = false; }
});
hasu.update.onProgress((p) => { if (p != null) $('update-text').textContent = `Téléchargement de la mise à jour… ${p}%`; });

// --- Démarrage ---
(async () => {
  await loadSettings();
  renderAccount(await hasu.account.status());
  await loadVersions();
  checkUpdate(false);
})();

'use strict';
// UI de Cap Hub. Communique avec le main via window.cap (preload).

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast ' + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
}

// ---------- Onglets ----------
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    $('#tab-' + tab.dataset.tab).classList.add('active');
    if (tab.dataset.tab === 'players') loadPlayers();
  });
});

// ---------- État / pastilles ----------
function setPill(id, on, label, warn) {
  const el = $(id);
  el.className = 'pill ' + (warn ? 'warn' : on ? 'on' : 'off');
  el.textContent = '● ' + label;
}

async function refreshStatus() {
  const s = await window.cap.proxy.status();
  setPill('#pill-proxy', s.running, 'Proxy');
  setPill('#pill-hosts', s.hostsApplied, 'Redirection');
  $('#st-proxy').className = 'pill ' + (s.running ? 'on' : 'off');
  $('#st-proxy').textContent = s.running ? 'en marche' : 'arrêté';
  $('#btn-proxy-toggle').textContent = s.running ? 'Arrêter' : 'Démarrer';
  $('#st-hosts').className = 'pill ' + (s.hostsApplied ? 'on' : 'off');
  $('#st-hosts').textContent = s.hostsApplied ? 'active' : 'inactive';
  $('#btn-hosts-toggle').textContent = s.hostsApplied ? 'Retirer' : 'Activer';
}

// ---------- Capes (bibliothèque multi-capes) ----------
let capeCache = [];
let capeActive = '';
let capeFavs = new Set();
let capeSearch = '';
let capeSort = 'fav';

async function loadCapes() {
  const r = await window.cap.capes.list();
  capeCache = r.capes || [];
  capeActive = r.active || '';
  capeFavs = new Set(r.favorites || []);
  renderCapeGrid();
}

function sortedFilteredCapes() {
  const q = capeSearch.trim().toLowerCase();
  let list = capeCache.filter((c) => !q || c.name.toLowerCase().includes(q));
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (capeSort === 'name') list.sort(byName);
  else if (capeSort === 'type') list.sort((a, b) => (a.builtin - b.builtin) || byName(a, b));
  else list.sort((a, b) => (capeFavs.has(b.id) - capeFavs.has(a.id)) || byName(a, b)); // favoris d'abord
  return list;
}

function renderCapeGrid() {
  const grid = $('#capes-grid');
  grid.innerHTML = '';
  const list = sortedFilteredCapes();
  $('#cape-count').textContent = `${list.length}/${capeCache.length} cape(s)`;
  if (!capeCache.length) {
    grid.innerHTML = '<p class="muted">Aucune cape. Importe un ou plusieurs PNG (64×32, 128×64… ou format OptiFine 46×22).</p>';
  } else if (!list.length) {
    grid.innerHTML = '<p class="muted">Aucune cape ne correspond à la recherche.</p>';
  }
  for (const c of list) {
    const fav = capeFavs.has(c.id);
    const el = document.createElement('div');
    el.className = 'cape' + (c.id === capeActive ? ' active' : '');
    el.innerHTML = `
      <button class="fav ${fav ? 'on' : ''}" title="Favori">${fav ? '★' : '☆'}</button>
      <div class="thumb"></div>
      ${c.id === capeActive ? '<span class="badge">active</span>' : ''}
      <div class="name" title="${esc(c.name)}">${esc(c.name)}${c.builtin ? ' <span class="muted">· intégrée</span>' : ''}</div>
      <div class="cape-actions">
        <button class="btn small act-use">${c.id === capeActive ? '✓ Active' : 'Utiliser'}</button>
        ${c.builtin ? '' : '<button class="btn small act-rename" title="Renommer">✎</button><button class="btn small danger act-del" title="Supprimer">🗑</button>'}
      </div>`;
    el.querySelector('.fav').addEventListener('click', () => toggleFav(c.id, !fav));
    el.querySelector('.act-use').addEventListener('click', () => setActive(c.id));
    const rn = el.querySelector('.act-rename');
    if (rn) rn.addEventListener('click', () => startRename(el, c));
    const del = el.querySelector('.act-del');
    if (del) del.addEventListener('click', () => removeCape(c.id, c.name));
    grid.appendChild(el);
    loadThumb(el.querySelector('.thumb'), c.id);
  }
  // Bandeau + aperçu de la cape active.
  const banner = $('#active-banner');
  const act = capeCache.find((c) => c.id === capeActive);
  if (act) {
    banner.classList.remove('hidden');
    banner.innerHTML = `Cape active : <b>${esc(act.name)}</b>. Applique Cap Hub puis rejoins un monde pour la voir.`;
  } else banner.classList.add('hidden');
  renderPreview(capeActive, act ? act.name : '');
}

async function toggleFav(id, on) {
  const r = await window.cap.capes.favorite(id, on);
  if (r.ok) { capeFavs = new Set(r.favorites); renderCapeGrid(); }
}

// Renommage inline : remplace le nom par un champ, Entrée valide, Échap annule.
function startRename(card, c) {
  const nameEl = card.querySelector('.name');
  const input = document.createElement('input');
  input.type = 'text'; input.value = c.name; input.maxLength = 40; input.className = 'rename-input';
  nameEl.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return; done = true;
    if (save && input.value.trim() && input.value.trim() !== c.name) {
      const r = await window.cap.capes.rename(c.id, input.value.trim());
      if (!r.ok) toast(r.error || 'Renommage impossible', 'err');
    }
    loadCapes();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
  });
  input.addEventListener('blur', () => commit(true));
}

$('#cape-search').addEventListener('input', (e) => { capeSearch = e.target.value; renderCapeGrid(); });
$('#cape-sort').addEventListener('change', (e) => { capeSort = e.target.value; renderCapeGrid(); });

// Prévisualisation animée de la cape active.
let previewMounted = false;
async function renderPreview(id, name) {
  if (!window.CapePreview) return;
  if (!previewMounted) { window.CapePreview.mount($('#cape-preview')); previewMounted = true; }
  if (!id) {
    window.CapePreview.clear();
    $('#preview-label').textContent = 'Aucune cape active';
    return;
  }
  const r = await window.cap.capes.preview(id);
  if (!r.ok) { window.CapePreview.clear(); return; }
  window.CapePreview.setCape(r.dataUrl);
  $('#preview-label').textContent = name || '';
}

async function loadThumb(el, id) {
  const r = await window.cap.capes.preview(id);
  if (r.ok) el.style.backgroundImage = `url(${r.dataUrl})`;
}

async function setActive(id) {
  const r = await window.cap.capes.setActive(id);
  if (r.ok) { toast('Cape active mise à jour.', 'ok'); loadCapes(); }
  else toast(r.error || 'Erreur', 'err');
}

async function removeCape(id, name) {
  const r = await window.cap.capes.remove(id);
  if (r.ok) { toast(`Cape « ${name} » supprimée.`, 'ok'); loadCapes(); }
  else toast(r.error || 'Erreur', 'err');
}

$('#btn-import').addEventListener('click', async () => {
  const r = await window.cap.capes.import();
  if (r.ok) {
    toast(`${r.imported} cape(s) importée(s) ✔${r.failed ? ` (${r.failed} rejetée(s))` : ''}`, 'ok');
    loadCapes();
  } else if (!r.canceled) toast(r.error || 'Import impossible', 'err');
});

$('#btn-apply').addEventListener('click', async () => {
  toast('Application de Cap Hub… (une fenêtre admin peut apparaître)');
  const r = await window.cap.proxy.enableAll();
  if (!r.ok) return toast(r.error, 'err');
  toast('Cap Hub appliqué ✔ Relance/rejoins un monde pour voir les capes.', 'ok');
  refreshStatus();
});

// ---------- Joueurs ----------
async function loadPlayers() {
  const list = $('#players-list');
  list.innerHTML = '<p class="muted">Chargement…</p>';
  const r = await window.cap.registry.players();
  const players = (r.players || []).sort((a, b) => a.name.localeCompare(b.name));
  list.innerHTML = '';
  if (!players.length) {
    list.innerHTML = '<p class="muted">Personne pour l’instant. Publie ta cape pour être le premier !</p>';
    return;
  }
  for (const p of players) {
    const el = document.createElement('div');
    el.className = 'player';
    el.innerHTML = `
      <div class="av"></div>
      <div><div class="pn">${esc(p.name)}</div>
      <div class="pd">${p.updated ? 'maj ' + esc(p.updated) : ''}</div></div>`;
    list.appendChild(el);
  }
}

$('#btn-refresh-players').addEventListener('click', async () => {
  const r = await window.cap.registry.refresh();
  toast(r.ok ? `Registre à jour (${(r.players || []).length} joueurs).` : r.error, r.ok ? 'ok' : 'err');
  loadPlayers();
});

$('#btn-publish').addEventListener('click', async () => {
  toast('Publication…');
  const r = await window.cap.capes.publish();
  toast(r.ok ? 'Ta cape est publiée dans le registre ✔' : r.error, r.ok ? 'ok' : 'err');
  if (r.ok) loadPlayers();
});

// ---------- État : boutons ----------
$('#btn-proxy-toggle').addEventListener('click', async () => {
  const s = await window.cap.proxy.status();
  const r = s.running ? await window.cap.proxy.stop() : await window.cap.proxy.start();
  if (!r.ok) toast(r.error, 'err');
  refreshStatus();
});
$('#btn-hosts-toggle').addEventListener('click', async () => {
  const s = await window.cap.proxy.status();
  toast('Modification du fichier hosts… (fenêtre admin)');
  const r = s.hostsApplied ? await window.cap.proxy.removeRedirect() : await window.cap.proxy.applyRedirect();
  if (!r.ok) toast(r.error, 'err');
  else toast('Redirection ' + (s.hostsApplied ? 'retirée.' : 'activée.'), 'ok');
  refreshStatus();
});

// ---------- Thème ----------
function applyTheme(name) {
  document.body.dataset.theme = name || 'nuit';
}
$('#in-theme').addEventListener('change', async (e) => {
  applyTheme(e.target.value);
  await window.cap.settings.save({ theme: e.target.value });
});

// ---------- Réglages ----------
async function loadSettings() {
  const r = await window.cap.settings.get();
  const s = r.settings;
  $('#in-theme').value = s.theme || 'nuit';
  applyTheme(s.theme || 'nuit');
  $('#in-username').value = s.username || '';
  $('#in-autoapply').checked = s.autoApply;
  $('#in-autoproxy').checked = s.autoProxy;
  $('#in-repo').value = s.repo || '';
  $('#in-branch').value = s.branch || '';
  $('#token-state').textContent = s.hasToken ? '· enregistré' : '· non défini';
  if (!r.encryption) $('#token-state').textContent += ' (⚠ chiffrement indisponible)';
}

$('#btn-save').addEventListener('click', async () => {
  await window.cap.settings.save({
    username: $('#in-username').value,
    autoApply: $('#in-autoapply').checked,
    autoProxy: $('#in-autoproxy').checked,
    repo: $('#in-repo').value,
    branch: $('#in-branch').value,
  });
  const tok = $('#in-token').value;
  if (tok) { await window.cap.settings.setToken(tok); $('#in-token').value = ''; }
  $('#save-msg').textContent = 'Enregistré ✔';
  setTimeout(() => ($('#save-msg').textContent = ''), 2500);
  loadSettings();
  toast('Réglages enregistrés.', 'ok');
});

$('#btn-check-update').addEventListener('click', async () => {
  toast('Recherche de mise à jour…');
  await window.cap.update.check();
});

// ---------- Journal + événements poussés ----------
function pushLog(e) {
  const box = $('#log');
  const line = document.createElement('div');
  line.className = 'l ' + (e.level || 'info');
  const d = new Date(e.t || Date.now());
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0'), ss = String(d.getSeconds()).padStart(2, '0');
  line.innerHTML = `<span class="t">${hh}:${mm}:${ss}</span>${esc(e.msg)}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
  while (box.childElementCount > 300) box.removeChild(box.firstChild);
}

window.cap.on('log', pushLog);
window.cap.on('proxy-changed', () => refreshStatus());
window.cap.on('game-start', (info) => {
  setPill('#pill-game', true, 'Minecraft');
  $('#games-now').textContent = `${info.client}${info.username ? ' — ' + info.username : ''}`;
});
window.cap.on('game-stop', () => {
  setPill('#pill-game', false, 'Minecraft');
  $('#games-now').textContent = 'Aucun jeu détecté.';
});
window.cap.on('update-status', (u) => {
  if (u.state === 'available') {
    if (confirm(`Cap Hub ${u.version} est disponible.\n\n${u.notes || ''}\n\nInstaller maintenant ?`)) window.cap.update.apply();
  } else if (u.state === 'uptodate') toast('Cap Hub est à jour.', 'ok');
  else if (u.state === 'error') toast('Mise à jour : ' + u.error, 'err');
});

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- Démarrage ----------
(async function init() {
  $('#ver').textContent = 'v' + (await window.cap.version());
  await loadSettings();
  await loadCapes();
  await refreshStatus();
  const g = await window.cap.games.current();
  if (g.games && g.games.length) {
    setPill('#pill-game', true, 'Minecraft');
    $('#games-now').textContent = g.games.map((x) => x.client).join(', ');
  }
})();

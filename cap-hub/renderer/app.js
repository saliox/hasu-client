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

// Anti double-clic : désactive le bouton pendant l'opération async (évite deux invites
// admin, deux publications, deux capes créées…). Ré-active dans un finally.
async function guard(btnSel, fn) {
  const btn = $(btnSel);
  if (btn) { if (btn.disabled) return; btn.disabled = true; }
  try { return await fn(); } finally { if (btn) btn.disabled = false; }
}

// ---------- Onglets ----------
const tabEls = $$('.tab');
function activateTab(tab) {
  tabEls.forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  $$('.panel').forEach((p) => p.classList.remove('active'));
  tab.classList.add('active');
  tab.setAttribute('aria-selected', 'true');
  $('#tab-' + tab.dataset.tab).classList.add('active');
  const t = tab.dataset.tab;
  if (t === 'players') loadPlayers();
  if (t === 'official') loadMc();
  if (t === 'capes') { previewState.canvas = null; renderPreview(capeActive, (capeCache.find((c) => c.id === capeActive) || {}).name || ''); }
  else if (t === 'creator') { previewState.canvas = null; updateCreator(); }
  else if (t === 'editor') { previewState.canvas = null; edActivate(); }
  else if (window.CapePreview) { window.CapePreview.clear(); previewState.canvas = null; } // pas d'aperçu -> stoppe l'animation (CPU)
}
tabEls.forEach((tab, i) => {
  tab.addEventListener('click', () => activateTab(tab));
  // Navigation clavier attendue d'un onglet ARIA : flèches, Origine/Fin.
  tab.addEventListener('keydown', (e) => {
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabEls.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabEls.length) % tabEls.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabEls.length - 1;
    if (j === null) return;
    e.preventDefault();
    tabEls[j].focus();
    activateTab(tabEls[j]);
  });
});

function mountPreview(sel) {
  if (window.CapePreview) window.CapePreview.mount($(sel));
}

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
let capeCats = {};       // id -> catégorie (surcharge)
let capeSearch = '';
let capeSort = 'fav';
let capeCatFilter = '';

async function loadCapes() {
  // Changement structurel (import/création/suppression/renommage) : on invalide le
  // cache d'images (un id de fichier peut être réutilisé) et on force l'aperçu à se
  // recalculer. La frappe dans la recherche ne passe PAS par ici -> cache conservé.
  capeImgCache.clear();
  resMetaCache.clear();      // taille des capes : re-lue au prochain rendu (une cape a pu changer)
  previewState.canvas = null;
  const r = await window.cap.capes.list();
  capeCache = r.capes || [];
  capeActive = r.active || '';
  capeFavs = new Set(r.favorites || []);
  capeCats = r.categories || {};
  updateCatFilter();
  renderCapeGrid();
  if (edInited) edRefreshSources();
}

// Catégorie effective d'une cape : surcharge utilisateur, sinon déduite (intégrées) ou « Mes créations ».
function catOf(c) {
  if (capeCats[c.id]) return capeCats[c.id];
  if (c.builtin) {
    if (c.name.startsWith('Uni ')) return 'Unis';
    if (/Degrade|crepuscule|ocean|Feu|Glace|Sang|Aurore|Sakura|Bronze/i.test(c.name)) return 'Dégradés';
    return 'Motifs';
  }
  return 'Mes créations';
}

function allCategories() {
  return [...new Set(capeCache.map(catOf))].sort((a, b) => a.localeCompare(b));
}

function updateCatFilter() {
  const sel = $('#cape-cat'), cur = sel.value;
  const cats = allCategories();
  sel.innerHTML = '<option value="">Tous</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  sel.value = cats.includes(cur) ? cur : '';
  capeCatFilter = sel.value;
  // Datalist pour l'autocomplétion lors de l'édition de catégorie.
  const dl = $('#cat-list');
  if (dl) dl.innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
}

function sortedFilteredCapes() {
  const q = capeSearch.trim().toLowerCase();
  let list = capeCache.filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!capeCatFilter || catOf(c) === capeCatFilter));
  const byName = (a, b) => a.name.localeCompare(b.name);
  if (capeSort === 'name') list.sort(byName);
  else if (capeSort === 'type') list.sort((a, b) => (a.builtin - b.builtin) || byName(a, b));
  else if (capeSort === 'cat') list.sort((a, b) => catOf(a).localeCompare(catOf(b)) || byName(a, b));
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
      <button class="fav ${fav ? 'on' : ''}" title="Favori" aria-label="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${fav ? '★' : '☆'}</button>
      <div class="thumb"><div class="thumb-meta hidden"></div></div>
      ${c.id === capeActive ? '<span class="badge">active</span>' : ''}
      <div class="name" title="${esc(c.name)}">${esc(c.name)}${c.builtin ? ' <span class="muted">· intégrée</span>' : ''}</div>
      <div class="catrow"><span class="cat-chip" title="Changer de dossier" role="button" tabindex="0" aria-label="Changer de dossier (${esc(catOf(c))})">🗂️ ${esc(catOf(c))}</span></div>
      <div class="cape-actions">
        <button class="btn small act-use" title="${c.id === capeActive ? 'Cliquer pour désactiver' : 'Utiliser cette cape'}">${c.id === capeActive ? '✓ Active' : 'Utiliser'}</button>
        <button class="btn small act-dup" title="Dupliquer" aria-label="Dupliquer">⧉</button>
        <button class="btn small act-export" title="Exporter en PNG" aria-label="Exporter en PNG">⬇</button>
        ${c.builtin ? '' : '<button class="btn small act-edit" title="Éditer pixel par pixel" aria-label="Éditer">✏️</button><button class="btn small act-rename" title="Renommer" aria-label="Renommer">✎</button><button class="btn small danger act-del" title="Supprimer" aria-label="Supprimer">🗑</button>'}
      </div>
      ${c.builtin ? '' : '<div class="res-row hidden"><span class="muted">Qualité</span><select class="act-res" title="Résolution de la cape — appliquée à l\'aperçu ET en jeu"></select></div>'}`;
    el.querySelector('.fav').addEventListener('click', () => toggleFav(c.id, !fav));
    el.querySelector('.act-use').addEventListener('click', () => setActive(c.id === capeActive ? '' : c.id));
    el.querySelector('.act-dup').addEventListener('click', () => dupCape(c.id));
    el.querySelector('.act-export').addEventListener('click', () => exportCape(c.id, c.name));
    el.querySelector('.cat-chip').addEventListener('click', () => startCatEdit(el, c));
    const ed = el.querySelector('.act-edit');
    if (ed) ed.addEventListener('click', () => editCape(c.id));
    const rn = el.querySelector('.act-rename');
    if (rn) rn.addEventListener('click', () => startRename(el, c));
    const del = el.querySelector('.act-del');
    if (del) del.addEventListener('click', () => removeCape(c.id, c.name));
    grid.appendChild(el);
    loadThumb(el.querySelector('.thumb'), c.id);
    const res = el.querySelector('.act-res');
    if (res) initResSelect(res, c);
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

// Édition inline de la catégorie (dossier) d'une cape.
function startCatEdit(card, c) {
  const chip = card.querySelector('.cat-chip');
  const input = document.createElement('input');
  input.type = 'text'; input.value = catOf(c); input.maxLength = 30; input.className = 'cat-input';
  input.setAttribute('list', 'cat-list');
  chip.replaceWith(input);
  input.focus(); input.select();
  let done = false;
  const commit = async (save) => {
    if (done) return; done = true;
    if (save) {
      const v = input.value.trim();
      const r = await window.cap.capes.setCategory(c.id, v);
      if (r.ok) capeCats = r.categories;
    }
    updateCatFilter(); renderCapeGrid();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(true); else if (e.key === 'Escape') commit(false); });
  input.addEventListener('blur', () => commit(true));
}

$('#cape-search').addEventListener('input', (e) => { capeSearch = e.target.value; renderCapeGrid(); });
$('#cape-sort').addEventListener('change', (e) => { capeSort = e.target.value; renderCapeGrid(); });
$('#cape-cat').addEventListener('change', (e) => { capeCatFilter = e.target.value; renderCapeGrid(); });

// Bascule « cape sur un personnage » / « cape seule » pour tous les aperçus 3D.
let showBody = true;
$('#toggle-body').addEventListener('click', () => {
  showBody = !showBody;
  if (window.CapePreview) window.CapePreview.setShowBody(showBody);
  $('#toggle-body').textContent = showBody ? '🧍 Sur un perso' : '🏳️ Cape seule';
});

// Intensité du vent sur l'aperçu physique — cycle calme / doux / fort.
const WIND_LEVELS = [
  { v: 0, label: '🌬️ Vent : off' },
  { v: 1, label: '🌬️ Vent : doux' },
  { v: 2.5, label: '🌬️ Vent : fort' },
];
let windLevel = 1;
$('#toggle-wind').addEventListener('click', () => {
  windLevel = (windLevel + 1) % WIND_LEVELS.length;
  const w = WIND_LEVELS[windLevel];
  if (window.CapePreview) window.CapePreview.setWind(w.v);
  $('#toggle-wind').textContent = w.label;
});

// Exporte l'aperçu 3D courant en image PNG (fond transparent, pleine résolution).
$('#btn-render').addEventListener('click', () => guard('#btn-render', async () => {
  const url = window.CapePreview && window.CapePreview.snapshot && window.CapePreview.snapshot();
  if (!url) { toast('Active une cape pour exporter le rendu.', 'err'); return; }
  const act = capeCache.find((c) => c.id === capeActive);
  const r = await window.cap.capes.saveRender(url, act ? act.name : 'cape');
  if (r.ok) toast('Rendu exporté ✔', 'ok');
  else if (!r.canceled) toast(r.error || 'Export impossible', 'err');
}));

// Copie le rendu 3D courant dans le presse-papiers (partage direct).
$('#btn-render-copy').addEventListener('click', () => guard('#btn-render-copy', async () => {
  const url = window.CapePreview && window.CapePreview.snapshot && window.CapePreview.snapshot();
  if (!url) { toast('Active une cape pour copier le rendu.', 'err'); return; }
  const r = await window.cap.capes.copyRender(url);
  if (r.ok) toast('Rendu copié dans le presse-papiers ✔', 'ok');
  else toast(r.error || 'Copie impossible', 'err');
}));

// Cache des data URL de capes (miniatures + aperçu) — évite un aller-retour IPC par
// cape à chaque re-render (recherche, tri, favori…). Clé = id ; le contenu d'un id ne
// change jamais (un renommage change l'id), donc le cache reste valide.
const capeImgCache = new Map();
async function capeDataUrl(id) {
  if (capeImgCache.has(id)) return capeImgCache.get(id);
  const r = await window.cap.capes.preview(id);
  const url = r.ok ? r.dataUrl : null;
  if (url) capeImgCache.set(id, url); // ne pas mémoriser un échec transitoire (sinon miniature cassée à vie)
  return url;
}

// Vignette « devant de la cape » : au lieu d'afficher la planche 64×32 dépliée (dos, bords…),
// on recadre la face avant visible, en gérant HD / animé (1re image) / OptiFine (46 de large).
const frontThumbCache = new Map();
function capeFrontThumb(url) {
  if (!url) return Promise.resolve(url);
  if (frontThumbCache.has(url)) return Promise.resolve(frontThumbCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { resolve(url); return; }
      const s = (w % 46 === 0 && w % 64 !== 0) ? w / 46 : w / 64; // échelle (OptiFine vs vanilla/HD)
      const fx = s, fy = s, fw = 10 * s, fh = 16 * s;             // région AVANT (1,1,10,16)*s
      const scale = Math.max(1, Math.round(120 / fw));            // agrandi net (pixels du jeu)
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(fw * scale)); cv.height = Math.max(1, Math.round(fh * scale));
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      c.drawImage(img, fx, fy, fw, fh, 0, 0, cv.width, cv.height);
      const out = cv.toDataURL('image/png');
      frontThumbCache.set(url, out);
      resolve(out);
    };
    img.onerror = () => resolve(url); // repli : planche complète
    img.src = url;
  });
}

// ---------- Résolution / qualité par cape ----------
// Métadonnées de taille par cape (origine immuable) — évite de re-solliciter le main à
// chaque re-rendu de grille (recherche/tri). Vidé sur tout changement structurel (loadCapes).
const resMetaCache = new Map();
// Rééchantillonne une cape vers (tw×th). Downscale lissé = réduction propre (le jeu
// ré-agrandit ensuite au plus proche). Renvoie un data URL PNG.
function downscaleCape(dataUrl, tw, th) {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
      c.drawImage(img, 0, 0, tw, th);
      res(cv.toDataURL('image/png'));
    };
    img.onerror = () => res(null);
    img.src = dataUrl;
  });
}
// Prépare le sélecteur de qualité d'une carte selon la taille d'origine (options ≤ origine).
// Les dimensions viennent d'un IPC LÉGER (capes.dims, pas de transfert des pixels) et sont
// mises en cache -> aucun aller-retour ni décodage lors des re-rendus (frappe recherche…).
async function initResSelect(sel, c) {
  const row = sel.closest('.res-row');
  try {
    let meta = resMetaCache.get(c.id);
    if (!meta) {
      const d = await window.cap.capes.dims(c.id);
      if (!d || !d.ok || !d.ow || !d.oh) return;
      const base = (d.ow % 46 === 0 && d.ow % 64 !== 0) ? 46 : 64;
      const origScale = Math.max(1, Math.round(d.ow / base));
      meta = { ow: d.ow, oh: d.oh, base, baseH: Math.round(d.oh / origScale), origScale, servedScale: Math.max(1, Math.round(d.sw / base)) };
      resMetaCache.set(c.id, meta);
    }
    const { ow, oh, base, baseH, origScale, servedScale } = meta;
    const opts = [{ v: 'orig', label: `Originale (${ow}×${oh})` }];
    for (const s of [1, 2, 4, 8]) if (s < origScale) opts.push({ v: String(s), label: `${base * s}×${baseH * s}${s === 1 ? ' · léger' : ''}` });
    if (opts.length <= 1) { if (row) row.remove(); return; } // rien à réduire (déjà minimal)
    sel.innerHTML = opts.map((o) => `<option value="${o.v}">${o.label}</option>`).join('');
    sel.value = (servedScale >= origScale) ? 'orig' : String(servedScale);
    sel.addEventListener('change', () => applyRes(sel, c.id, meta));
    if (row) row.classList.remove('hidden');
  } catch { /* laisse la ligne cachée */ }
}
async function applyRes(sel, id, meta) {
  const v = sel.value;
  sel.disabled = true;
  try {
    let r;
    if (v === 'orig' || +v >= meta.origScale) r = await window.cap.capes.setResolution(id, null);
    else {
      const orig = await window.cap.capes.original(id); // pixels de l'original : seulement au moment d'appliquer
      if (!orig || !orig.ok) return toast('Original indisponible.', 'err');
      const url = await downscaleCape(orig.dataUrl, meta.base * +v, meta.baseH * +v);
      if (!url) return toast('Rééchantillonnage impossible.', 'err');
      r = await window.cap.capes.setResolution(id, url);
    }
    if (!r || !r.ok) return toast((r && r.error) || 'Changement impossible', 'err');
    toast('Résolution mise à jour ✔ — en jeu, rejoins un monde pour la voir.', 'ok');
    frontThumbCache.clear();
    await loadCapes(); // vide resMetaCache -> le sélecteur reflète la nouvelle taille servie
  } finally { sel.disabled = false; }
}

// Prévisualisation 3D de la cape active. Ne se relance QUE si la cape (ou le canvas)
// a changé — sinon taper dans la recherche ferait clignoter l'aperçu à chaque frappe.
const previewState = { id: null, canvas: null };
async function renderPreview(id, name) {
  if (!window.CapePreview) return;
  mountPreview('#cape-preview');
  updateShareButtons(!!id);
  if (previewState.id === id && previewState.canvas === '#cape-preview') {
    $('#preview-label').textContent = id ? (name || '') : 'Aucune cape active';
    return; // déjà affichée sur ce canvas -> rien à refaire
  }
  previewState.id = id; previewState.canvas = '#cape-preview';
  if (!id) { window.CapePreview.clear(); $('#preview-label').textContent = 'Aucune cape active'; return; }
  const url = await capeDataUrl(id);
  if (!url) { window.CapePreview.clear(); return; }
  window.CapePreview.setCape(url);
  $('#preview-label').textContent = name || '';
}
// Active/désactive les boutons de partage du rendu selon qu'une cape est affichée.
function updateShareButtons(on) {
  for (const sel of ['#btn-render', '#btn-render-copy']) {
    const b = $(sel); if (b) b.disabled = !on;
  }
}

// Métadonnées visuelles d'une cape à partir de son image (résolution par frame,
// nombre d'images pour les capes animées). Sans IPC : lit l'image déjà chargée.
const capeMetaCache = new Map();
function capeMeta(url) {
  if (!url) return Promise.resolve(null);
  if (capeMetaCache.has(url)) return Promise.resolve(capeMetaCache.get(url));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) { resolve(null); return; }
      const optifine = (w % 46 === 0 && w % 64 !== 0);
      const s = optifine ? w / 46 : w / 64;
      const frameH = optifine ? 22 * s : 32 * s;
      const frames = (frameH && h % frameH === 0) ? Math.round(h / frameH) : 1;
      const meta = { w, h, s, frameH, frames, optifine };
      capeMetaCache.set(url, meta);
      resolve(meta);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadThumb(el, id) {
  const url = await capeDataUrl(id);
  if (!url) return;
  el.style.backgroundImage = `url(${await capeFrontThumb(url)})`;
  const meta = await capeMeta(url);
  const box = el.querySelector('.thumb-meta');
  if (!meta || !box) return;
  const fh = Math.round(meta.frameH);
  const badges = [`${meta.w}×${fh}`];
  if (meta.frames > 1) badges.push(`🎞 ${meta.frames}`);
  box.textContent = badges.join('  ·  ');
  box.title = meta.frames > 1
    ? `Cape animée — ${meta.frames} images de ${meta.w}×${fh}${meta.optifine ? ' (OptiFine)' : ''}`
    : `Résolution ${meta.w}×${fh}${meta.optifine ? ' (OptiFine)' : ''}`;
  box.classList.remove('hidden');
}

async function setActive(id) {
  const r = await window.cap.capes.setActive(id);
  if (r.ok) { toast(id ? 'Cape activée.' : 'Cape désactivée.', 'ok'); loadCapes(); }
  else toast(r.error || 'Erreur', 'err');
}

async function removeCape(id, name) {
  // Suppression définitive (pas d'annulation) : on confirme pour éviter un clic malheureux.
  if (!confirm(`Supprimer la cape « ${name} » ? Cette action est définitive.`)) return;
  const r = await window.cap.capes.remove(id);
  if (r.ok) { toast(`Cape « ${name} » supprimée.`, 'ok'); loadCapes(); }
  else toast(r.error || 'Erreur', 'err');
}

// Duplique une cape (intégrée ou importée) en une copie modifiable.
async function dupCape(id) {
  const r = await window.cap.capes.duplicate(id);
  if (r.ok) { toast('Cape dupliquée ✔', 'ok'); loadCapes(); }
  else toast(r.error || 'Duplication impossible', 'err');
}

// Exporte une cape vers un fichier PNG (inverse de l'import — pratique pour sauvegarder/partager).
async function exportCape(id, name) {
  const r = await window.cap.capes.export(id);
  if (r.ok) toast(`« ${name} » exportée ✔`, 'ok');
  else if (!r.canceled) toast(r.error || 'Export impossible', 'err');
}

// ---------- Import (PNG / GIF animé / image recadrée) ----------
function loadImage(src) {
  return new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = src; });
}
// Une image de dimensions (w,h) est-elle déjà une texture de cape (vanilla/HD/animée ou OptiFine) ?
function isCapeShape(w, h) {
  const vs = w / 64;
  if (Number.isInteger(vs) && vs >= 1 && vs <= 64 && h % (32 * vs) === 0 && h / (32 * vs) <= 64) return true;
  const os = w / 46;
  return Number.isInteger(os) && os >= 1 && os <= 64 && h === 22 * os;
}
// Dessine img en "cover" (rogne) dans le rectangle (dx,dy,dw,dh).
function drawCover(ctx, img, dx, dy, dw, dh) {
  const iw = img.naturalWidth || img.displayWidth || img.codedWidth || dw;
  const ih = img.naturalHeight || img.displayHeight || img.codedHeight || dh;
  const s = Math.max(dw / iw, dh / ih), w = iw * s, h = ih * s;
  ctx.drawImage(img, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
}
function fitImageToCape(img) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32;
  const c = cv.getContext('2d'); c.imageSmoothingEnabled = true;
  drawCover(c, img, 0, 0, 64, 32);
  return cv.toDataURL('image/png');
}
// GIF -> cape ANIMÉE : chaque image du GIF devient une image 64×32 empilée verticalement.
async function gifToCape(dataUrl) {
  if (!('ImageDecoder' in window)) return fitImageToCape(await loadImage(dataUrl)); // repli : 1re image statique
  const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (ch) => ch.charCodeAt(0));
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  const total = dec.tracks.selectedTrack?.frameCount || 1;
  const count = Math.min(total, 24); // borne la hauteur / le poids
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 32 * count;
  const c = cv.getContext('2d');
  for (let i = 0; i < count; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    drawCover(c, image, 0, i * 32, 64, 32);
    image.close?.();
  }
  return cv.toDataURL('image/png');
}
async function buildCapeFromFile(f) {
  if (f.ext === 'gif') return await gifToCape(f.dataUrl);
  const img = await loadImage(f.dataUrl);
  if (f.ext === 'png' && isCapeShape(img.naturalWidth, img.naturalHeight)) return f.dataUrl; // vraie cape (HD/4K/animée) telle quelle
  return fitImageToCape(img); // sinon on recadre en 64×32
}

// Crée une cape par fichier fourni. files : [{ name, ext, dataUrl, tooBig }]
async function importCapeFiles(files) {
  if (!files.length) return;
  toast(`Traitement de ${files.length} fichier(s)…`);
  let ok = 0, fail = 0;
  for (const f of files) {
    if (f.tooBig) { fail++; continue; }
    try {
      const url = await buildCapeFromFile(f);
      const res = url && await window.cap.capes.create(f.name, url);
      if (res && res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  toast(`${ok} cape(s) importée(s) ✔${fail ? ` (${fail} rejetée(s))` : ''}`, ok ? 'ok' : 'err');
  if (ok) loadCapes();
}

$('#btn-import').addEventListener('click', () => guard('#btn-import', async () => {
  const r = await window.cap.capes.import();
  if (!r.ok) { if (!r.canceled) toast(r.error || 'Import impossible', 'err'); return; }
  await importCapeFiles(r.files);
}));

// ---------- Glisser-déposer des fichiers image/GIF sur la fenêtre ----------
const DROP_MAX = 12 * 1024 * 1024; // même plafond que l'import natif
const DROP_EXT = /\.(png|gif|jpe?g|webp|bmp)$/i;
// Convertit un File du drop en objet import ({ name, ext, dataUrl, tooBig }).
function fileToImport(file) {
  return new Promise((resolve) => {
    const name = (file.name || 'cape').replace(/\.[^.]+$/, '') || 'cape';
    const ext = ((file.name || '').match(/\.([^.]+)$/)?.[1] || 'png').toLowerCase();
    if (file.size > DROP_MAX) { resolve({ name, ext, dataUrl: '', tooBig: true }); return; }
    const rd = new FileReader();
    rd.onload = () => resolve({ name, ext, dataUrl: String(rd.result || ''), tooBig: false });
    rd.onerror = () => resolve({ name, ext, dataUrl: '', tooBig: true });
    rd.readAsDataURL(file);
  });
}
(function setupDropZone() {
  const overlay = $('#drop-overlay');
  let depth = 0;
  const show = () => overlay && overlay.classList.remove('hidden');
  const hide = () => { depth = 0; overlay && overlay.classList.add('hidden'); };
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; show(); });
  window.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; e.preventDefault(); if (--depth <= 0) hide(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    hide();
    const files = Array.from(e.dataTransfer?.files || []).filter((f) => DROP_EXT.test(f.name || '') || /^image\//.test(f.type || ''));
    if (!files.length) { if ((e.dataTransfer?.files || []).length) toast('Aucune image reconnue dans le dépôt.', 'err'); return; }
    const items = await Promise.all(files.map(fileToImport));
    await importCapeFiles(items);
  });
})();

$('#btn-apply').addEventListener('click', () => guard('#btn-apply', async () => {
  toast('Application de Cap Hub… (une fenêtre admin peut apparaître)');
  const r = await window.cap.proxy.enableAll();
  if (!r.ok) return toast(r.error, 'err');
  toast('Cap Hub appliqué ✔ Relance/rejoins un monde pour voir les capes.', 'ok');
  refreshStatus();
}));

// ---------- Créateur de capes ----------
// État de l'éditeur pixel (planche 64x32) et de l'image importée.
const PX_W = 64, PX_H = 32;
let pxGrid = new Array(PX_W * PX_H).fill('#1a2233');
let pxPainting = false;
let creatorImg = null; // HTMLImageElement de l'image importée

// Dessine la cape sur le canvas 64x32 selon le mode, renvoie un data URL PNG.
function drawCreator() {
  const cv = $('#cr-canvas'), c = cv.getContext('2d');
  const mode = $('#cr-mode').value;
  const c1 = $('#cr-c1').value, c2 = $('#cr-c2').value;
  const band = Math.max(2, +$('#cr-band').value || 4);
  c.clearRect(0, 0, PX_W, PX_H);
  if (mode === 'uni') { c.fillStyle = c1; c.fillRect(0, 0, PX_W, PX_H); }
  else if (mode === 'degrade') {
    const g = c.createLinearGradient(0, 0, 0, PX_H); g.addColorStop(0, c1); g.addColorStop(1, c2);
    c.fillStyle = g; c.fillRect(0, 0, PX_W, PX_H);
  } else if (mode === 'rayures') {
    for (let y = 0; y < PX_H; y++) { c.fillStyle = (Math.floor(y / band) % 2) ? c2 : c1; c.fillRect(0, y, PX_W, 1); }
  } else if (mode === 'damier') {
    for (let y = 0; y < PX_H; y++) for (let x = 0; x < PX_W; x++) { c.fillStyle = ((Math.floor(x / band) + Math.floor(y / band)) % 2) ? c2 : c1; c.fillRect(x, y, 1, 1); }
  } else if (mode === 'diagonale') {
    for (let y = 0; y < PX_H; y++) for (let x = 0; x < PX_W; x++) { c.fillStyle = (Math.floor((x + y) / band) % 2) ? c2 : c1; c.fillRect(x, y, 1, 1); }
  } else if (mode === 'pixel') {
    for (let y = 0; y < PX_H; y++) for (let x = 0; x < PX_W; x++) { c.fillStyle = pxGrid[y * PX_W + x]; c.fillRect(x, y, 1, 1); }
  } else if (mode === 'image') {
    c.fillStyle = '#1a2233'; c.fillRect(0, 0, PX_W, PX_H);
    if (creatorImg) {
      const fit = $('#img-fit').value, iw = creatorImg.naturalWidth, ih = creatorImg.naturalHeight;
      if (fit === 'stretch') c.drawImage(creatorImg, 0, 0, PX_W, PX_H);
      else {
        const s = fit === 'cover' ? Math.max(PX_W / iw, PX_H / ih) : Math.min(PX_W / iw, PX_H / ih);
        const dw = iw * s, dh = ih * s;
        c.drawImage(creatorImg, (PX_W - dw) / 2, (PX_H - dh) / 2, dw, dh);
      }
    }
  }
  return cv.toDataURL('image/png');
}

// Rend l'éditeur pixel (grille agrandie + lignes).
function renderPxCanvas() {
  const cv = $('#px-canvas'), c = cv.getContext('2d');
  const sx = cv.width / PX_W, sy = cv.height / PX_H;
  for (let y = 0; y < PX_H; y++) for (let x = 0; x < PX_W; x++) { c.fillStyle = pxGrid[y * PX_W + x]; c.fillRect(x * sx, y * sy, sx, sy); }
  c.strokeStyle = 'rgba(255,255,255,0.06)'; c.lineWidth = 1;
  for (let x = 0; x <= PX_W; x++) { c.beginPath(); c.moveTo(x * sx, 0); c.lineTo(x * sx, cv.height); c.stroke(); }
  for (let y = 0; y <= PX_H; y++) { c.beginPath(); c.moveTo(0, y * sy); c.lineTo(cv.width, y * sy); c.stroke(); }
}

// Aperçu 3D coalescé : au plus 1 (ré)encodage PNG + décodage image par frame, quel que
// soit le nombre de pixels peints entre deux frames (avant : 1 par échantillon de souris).
let pxPreviewRaf = 0;
function schedulePxPreview() {
  if (pxPreviewRaf || !window.CapePreview) return;
  pxPreviewRaf = requestAnimationFrame(() => { pxPreviewRaf = 0; window.CapePreview.setCape(drawCreator()); });
}
// Coordonnées case (x,y) sous le pointeur, ou null hors planche.
function pxCoord(e) {
  const cv = $('#px-canvas'), rect = cv.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / (rect.width / PX_W));
  const y = Math.floor((e.clientY - rect.top) / (rect.height / PX_H));
  return (x < 0 || y < 0 || x >= PX_W || y >= PX_H) ? null : { x, y };
}
function paintPx(e) {
  const p = pxCoord(e); if (!p) return;
  const col = $('#px-erase').checked ? $('#px-bg').value : $('#px-color').value;
  pxGrid[p.y * PX_W + p.x] = col;
  if ($('#px-mirror').checked) pxGrid[p.y * PX_W + (PX_W - 1 - p.x)] = col; // symétrie horizontale
  renderPxCanvas();
  schedulePxPreview();
}
// Pipette : récupère la couleur de la case cliquée dans le pinceau.
function pickPx(e) {
  const p = pxCoord(e); if (!p) return;
  $('#px-color').value = pxGrid[p.y * PX_W + p.x];
  setEyedrop(false); // pipette « un coup »
}

// ----- Historique (annuler / rétablir) de l'éditeur pixel -----
let pxUndoStack = [], pxRedoStack = [], pxEyedrop = false;
function pxSnapshot() { pxUndoStack.push(pxGrid.slice()); if (pxUndoStack.length > 60) pxUndoStack.shift(); pxRedoStack.length = 0; updatePxButtons(); }
function updatePxButtons() {
  const u = $('#px-undo'), r = $('#px-redo');
  if (u) u.disabled = !pxUndoStack.length;
  if (r) r.disabled = !pxRedoStack.length;
}
function pxUndo() { if (!pxUndoStack.length) return; pxRedoStack.push(pxGrid.slice()); pxGrid = pxUndoStack.pop(); renderPxCanvas(); schedulePxPreview(); updatePxButtons(); }
function pxRedo() { if (!pxRedoStack.length) return; pxUndoStack.push(pxGrid.slice()); pxGrid = pxRedoStack.pop(); renderPxCanvas(); schedulePxPreview(); updatePxButtons(); }
function setEyedrop(on) {
  pxEyedrop = on;
  const btn = $('#px-pick'); if (btn) btn.classList.toggle('active', on);
  const cv = $('#px-canvas'); if (cv) cv.style.cursor = on ? 'copy' : 'crosshair';
}

function updateCreator() {
  const mode = $('#cr-mode').value;
  $('#cr-colors').classList.toggle('hidden', mode === 'pixel' || mode === 'image');
  $('#cr-pixel').classList.toggle('hidden', mode !== 'pixel');
  $('#cr-image').classList.toggle('hidden', mode !== 'image');
  $('#cr-c2-wrap').style.display = mode === 'uni' ? 'none' : '';
  if (mode === 'pixel') renderPxCanvas();
  const url = drawCreator();
  mountPreview('#creator-preview');
  if (window.CapePreview) window.CapePreview.setCape(url);
}

['#cr-mode', '#cr-c1', '#cr-c2', '#cr-band', '#img-fit'].forEach((sel) => {
  const el = $(sel); el.addEventListener('input', updateCreator); el.addEventListener('change', updateCreator);
});

// Éditeur pixel : peinture au pointeur (souris, tactile ET stylet via Pointer Events).
const pxCanvas = $('#px-canvas');
pxCanvas.addEventListener('pointerdown', (e) => {
  if (pxEyedrop) { pickPx(e); return; }
  pxPainting = true; try { pxCanvas.setPointerCapture(e.pointerId); } catch {}
  pxSnapshot(); // une entrée d'historique par TRAIT (pas par pixel)
  paintPx(e);
});
pxCanvas.addEventListener('pointermove', (e) => { if (pxPainting) paintPx(e); });
window.addEventListener('pointerup', () => { pxPainting = false; });
pxCanvas.addEventListener('pointercancel', () => { pxPainting = false; });
$('#px-pick').addEventListener('click', () => setEyedrop(!pxEyedrop));
$('#px-undo').addEventListener('click', pxUndo);
$('#px-redo').addEventListener('click', pxRedo);
$('#px-fill').addEventListener('click', () => { pxSnapshot(); pxGrid.fill($('#px-color').value); renderPxCanvas(); updateCreator(); });
$('#px-reset').addEventListener('click', () => { pxSnapshot(); pxGrid.fill($('#px-bg').value); renderPxCanvas(); updateCreator(); });
// Raccourcis Annuler/Rétablir (uniquement sur le créateur en mode pixel).
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const k = e.key.toLowerCase();
  const onEditor = $('#tab-editor').classList.contains('active');
  const onCreatorPixel = $('#tab-creator').classList.contains('active') && $('#cr-mode').value === 'pixel';
  if (!onEditor && !onCreatorPixel) return;
  const undo = onEditor ? edDoUndo : pxUndo, redo = onEditor ? edDoRedo : pxRedo;
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
});

// Import d'image quelconque.
$('#img-pick').addEventListener('click', async () => {
  const r = await window.cap.capes.pickImage();
  if (!r.ok) { if (!r.canceled) toast(r.error || 'Image invalide', 'err'); return; }
  const img = new Image();
  img.onload = () => { creatorImg = img; $('#img-info').textContent = `Image ${img.naturalWidth}×${img.naturalHeight} chargée.`; updateCreator(); };
  img.onerror = () => toast('Image illisible', 'err');
  img.src = r.dataUrl;
});

$('#cr-random').addEventListener('click', () => {
  const rnd = () => '#' + Array.from({ length: 3 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join('');
  $('#cr-c1').value = rnd(); $('#cr-c2').value = rnd();
  updateCreator();
});

$('#cr-create').addEventListener('click', () => guard('#cr-create', async () => {
  if ($('#cr-mode').value === 'image' && !creatorImg) return toast('Choisis d’abord une image.', 'err');
  const name = $('#cr-name').value.trim() || 'Ma cape';
  const url = drawCreator();
  const r = await window.cap.capes.create(name, url);
  if (!r.ok) { $('#cr-msg').textContent = ''; return toast(r.error || 'Création impossible', 'err'); }
  if ($('#cr-use').checked && r.id) { await window.cap.capes.setActive(r.id); refreshStatus(); }
  $('#cr-msg').textContent = `Cape « ${name} » ajoutée à ta bibliothèque ✔${$('#cr-use').checked ? ' (activée)' : ''}`;
  toast('Cape créée ✔', 'ok');
  await loadCapes();
  updateCreator();
}));

// ---------- Onglet Édition : éditeur pixel dédié (zoom molette + déplacement) ----------
const ED_W = 64, ED_H = 32;
// Zone AVANT (ce qui se voit) et toutes les régions utiles de la planche de cape (px).
// Le reste de la planche 64×32 est ignoré par le jeu.
const ED_FRONT = { x: 1, y: 1, w: 10, h: 16 };
const ED_REGIONS = [
  ED_FRONT,                        // avant (visible)
  { x: 12, y: 1, w: 10, h: 16 },   // arrière
  { x: 0, y: 1, w: 1, h: 16 },     // bord droit
  { x: 11, y: 1, w: 1, h: 16 },    // bord gauche
  { x: 1, y: 0, w: 10, h: 1 },     // dessus
  { x: 11, y: 0, w: 10, h: 1 },    // dessous
];
let edGrid = new Array(ED_W * ED_H).fill(null); // null = pixel transparent
let edZoom = 14, edFitZoom = 14, edPanX = 0, edPanY = 0;
let edPainting = false, edPanning = false, edPanFrom = null;
let edTool = 'brush'; // 'brush' | 'line' | 'rect' | 'bucket' | 'erase' | 'pick'
let edBrush = 1;               // taille du pinceau (1..4)
let edStart = null, edLast = null, edPreview = null; // outils ligne/rectangle (glisser)
let edShowGrid = true, edInited = false, edHover = null;
let edUndo = [], edRedo = [], edRecent = [];
function edUpdatePos(p) { const el = $('#ed-pos'); if (el) el.textContent = (p && p.inside) ? `▪ ${p.x}, ${p.y}` : ''; }
const ED_PRESETS = ['#e23636', '#e07b39', '#f2c14e', '#3fa34d', '#2b8fd6', '#7c5cff', '#c94fd6', '#ffffff', '#9aa0aa', '#3a3f57', '#5a3a22', '#111318'];

// Pose une couleur en (x,y) en appliquant la taille du pinceau ET les miroirs actifs.
function edStamp(x, y, col) {
  const n = edBrush, o = Math.floor((n - 1) / 2);
  const mh = $('#ed-mirror').checked, mv = $('#ed-mirrorv').checked;
  const put = (xx, yy) => { if (xx >= 0 && yy >= 0 && xx < ED_W && yy < ED_H) edGrid[yy * ED_W + xx] = col; };
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
    const px = x - o + dx, py = y - o + dy;
    put(px, py);
    if (mh) put(ED_W - 1 - px, py);
    if (mv) put(px, ED_H - 1 - py);
    if (mh && mv) put(ED_W - 1 - px, ED_H - 1 - py);
  }
}
// Cellules d'un segment (Bresenham) et d'un rectangle (contour ou plein).
function edLineCells(x0, y0, x1, y1) {
  const cells = []; const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, x = x0, y = y0;
  for (;;) { cells.push([x, y]); if (x === x1 && y === y1) break; const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx; } if (e2 < dx) { err += dx; y += sy; } }
  return cells;
}
function edRectCells(x0, y0, x1, y1, fill) {
  const cells = [], ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
  for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) if (fill || x === ax || x === bx || y === ay || y === by) cells.push([x, y]);
  return cells;
}
// Pot de peinture : remplit la zone contiguë de même couleur (4-connexité) sur la planche.
function edBucketAt(x, y, col) {
  const target = edGrid[y * ED_W + x];
  if (target === col) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= ED_W || cy >= ED_H) continue;
    const k = cy * ED_W + cx;
    if (edGrid[k] !== target) continue;
    edGrid[k] = col;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
}
// Éclaircit / assombrit la couleur courante.
function edShade(delta) {
  const n = parseInt($('#ed-color').value.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + delta * 255)));
  const r = f((n >> 16) & 255), g = f((n >> 8) & 255), b = f(n & 255);
  $('#ed-color').value = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  edRenderSwatches();
}
// Palette : presets + couleurs récemment utilisées.
function edAddRecent(col) { if (!col) return; edRecent = [col, ...edRecent.filter((c) => c !== col)].slice(0, 8); edRenderSwatches(); }
function edRenderSwatches() {
  const box = $('#ed-swatches'); if (!box) return;
  const cur = ($('#ed-color').value || '').toLowerCase();
  box.innerHTML = '';
  const mk = (col) => {
    const b = document.createElement('button');
    b.className = 'ed-swatch' + (col.toLowerCase() === cur ? ' sel' : '');
    b.style.background = col; b.title = col; b.type = 'button';
    b.addEventListener('click', () => { $('#ed-color').value = col; if (edTool === 'erase') edSetTool('brush'); edRenderSwatches(); });
    return b;
  };
  ED_PRESETS.forEach((c) => box.appendChild(mk(c)));
  if (edRecent.length) { const s = document.createElement('div'); s.className = 'sep'; box.appendChild(s); edRecent.forEach((c) => box.appendChild(mk(c))); }
}
// Place une image dans la SEULE zone AVANT (10×16), sans toucher au reste (pixels transparents conservés).
function edLoadImageIntoFront(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = ED_FRONT.w; cv.height = ED_FRONT.h;
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      const iw = img.naturalWidth || 1, ih = img.naturalHeight || 1;
      const s = Math.max(ED_FRONT.w / iw, ED_FRONT.h / ih), w = iw * s, h = ih * s;
      c.drawImage(img, (ED_FRONT.w - w) / 2, (ED_FRONT.h - h) / 2, w, h);
      const d = c.getImageData(0, 0, ED_FRONT.w, ED_FRONT.h).data;
      for (let y = 0; y < ED_FRONT.h; y++) for (let x = 0; x < ED_FRONT.w; x++) {
        const i = (y * ED_FRONT.w + x) * 4;
        if (d[i + 3] > 12) edGrid[(ED_FRONT.y + y) * ED_W + (ED_FRONT.x + x)] = '#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      }
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

function edFillRegion(r, col) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) edGrid[y * ED_W + x] = col;
}
function edCanvasEl() { return $('#ed-canvas'); }
function edResizeCanvas() {
  const cv = edCanvasEl(); if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth || cv.parentElement.clientWidth || 640;
  const h = cv.clientHeight || 480;
  const nw = Math.max(1, Math.round(w * dpr)), nh = Math.max(1, Math.round(h * dpr));
  if (cv.width !== nw || cv.height !== nh) { cv.width = nw; cv.height = nh; }
}
function edFit() {
  const cv = edCanvasEl();
  edFitZoom = edZoom = Math.max(3, Math.floor(Math.min(cv.width / (ED_W + 4), cv.height / (ED_H + 4))));
  edPanX = Math.round((cv.width - ED_W * edZoom) / 2);
  edPanY = Math.round((cv.height - ED_H * edZoom) / 2);
}
function edZoomLabel() {
  const el = $('#ed-zoom-val'); if (el && edFitZoom) el.textContent = Math.round(edZoom / edFitZoom * 100) + '%';
}
function edRender() {
  const cv = edCanvasEl(); if (!cv) return;
  const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cv.width, cv.height);
  const z = edZoom, ox = edPanX, oy = edPanY;
  // Damier de fond (montre la transparence) + pixels peints par-dessus.
  for (let y = 0; y < ED_H; y++) for (let x = 0; x < ED_W; x++) {
    const sx = ox + x * z, sy = oy + y * z;
    c.fillStyle = ((x + y) & 1) ? '#2b3040' : '#232836';
    c.fillRect(sx, sy, z, z);
    const col = edGrid[y * ED_W + x];
    if (col) { c.fillStyle = col; c.fillRect(sx, sy, z, z); }
  }
  // Grille (si assez zoomé).
  if (edShowGrid && z >= 6) {
    c.strokeStyle = 'rgba(255,255,255,0.07)'; c.lineWidth = 1; c.beginPath();
    for (let x = 0; x <= ED_W; x++) { c.moveTo(ox + x * z + 0.5, oy); c.lineTo(ox + x * z + 0.5, oy + ED_H * z); }
    for (let y = 0; y <= ED_H; y++) { c.moveTo(ox, oy + y * z + 0.5); c.lineTo(ox + ED_W * z, oy + y * z + 0.5); }
    c.stroke();
  }
  // Cadre net de la planche.
  c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1;
  c.strokeRect(ox + 0.5, oy + 0.5, ED_W * z - 1, ED_H * z - 1);
  // Contours des régions + libellé de la zone AVANT.
  c.lineWidth = 2;
  ED_REGIONS.forEach((r) => { c.strokeStyle = 'rgba(255,255,255,0.16)'; c.strokeRect(ox + r.x * z, oy + r.y * z, r.w * z, r.h * z); });
  c.strokeStyle = 'rgba(96,230,150,0.95)'; c.strokeRect(ox + ED_FRONT.x * z, oy + ED_FRONT.y * z, ED_FRONT.w * z, ED_FRONT.h * z);
  const ly = oy + ED_FRONT.y * z - 4;
  if (ly > 14) {
    c.font = '600 12px system-ui, sans-serif'; c.textBaseline = 'bottom';
    const lx = ox + ED_FRONT.x * z, tw = c.measureText('AVANT (visible)').width;
    c.fillStyle = 'rgba(10,14,24,0.72)'; c.fillRect(lx - 4, ly - 14, tw + 8, 16);
    c.fillStyle = 'rgba(120,240,170,0.98)'; c.fillText('AVANT (visible)', lx, ly);
  }
  // Aperçu du tracé en cours (ligne / rectangle) avant de valider.
  if (edPreview && edPreview.length) {
    const mh = $('#ed-mirror').checked, mv = $('#ed-mirrorv').checked;
    c.globalAlpha = 0.6; c.fillStyle = $('#ed-color').value;
    const cell = (x, y) => { if (x >= 0 && y >= 0 && x < ED_W && y < ED_H) c.fillRect(ox + x * z, oy + y * z, z, z); };
    for (const [x, y] of edPreview) {
      cell(x, y);
      if (mh) cell(ED_W - 1 - x, y);
      if (mv) cell(x, ED_H - 1 - y);
      if (mh && mv) cell(ED_W - 1 - x, ED_H - 1 - y);
    }
    c.globalAlpha = 1;
  }
  // Repère de survol : montre la (les) case(s) qui seront peintes (taille du pinceau + miroirs).
  if (edHover && !edPreview) {
    const mh = $('#ed-mirror').checked, mv = $('#ed-mirrorv').checked;
    const cells = [];
    if (edTool === 'brush' || edTool === 'erase') {
      const n = edBrush, o = Math.floor((n - 1) / 2);
      for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) {
        const px = edHover.x - o + dx, py = edHover.y - o + dy;
        cells.push([px, py]);
        if (mh) cells.push([ED_W - 1 - px, py]);
        if (mv) cells.push([px, ED_H - 1 - py]);
        if (mh && mv) cells.push([ED_W - 1 - px, ED_H - 1 - py]);
      }
    } else cells.push([edHover.x, edHover.y]);
    c.lineWidth = Math.max(1.5, z / 8);
    c.strokeStyle = edTool === 'erase' ? 'rgba(255,90,90,0.95)' : 'rgba(255,255,255,0.92)';
    for (const [x, y] of cells) if (x >= 0 && y >= 0 && x < ED_W && y < ED_H) c.strokeRect(ox + x * z + 0.5, oy + y * z + 0.5, z - 1, z - 1);
  }
  edZoomLabel();
}

// Coordonnées case (+ position écran) sous le pointeur.
function edCoord(e) {
  const cv = edCanvasEl(), rect = cv.getBoundingClientRect();
  const sx = (e.clientX - rect.left) * (cv.width / rect.width);
  const sy = (e.clientY - rect.top) * (cv.height / rect.height);
  const x = Math.floor((sx - edPanX) / edZoom), y = Math.floor((sy - edPanY) / edZoom);
  return { x, y, sx, sy, inside: x >= 0 && y >= 0 && x < ED_W && y < ED_H };
}

// Aperçu 3D coalescé (1 encodage PNG max par frame d'affichage).
let edPreviewRaf = 0;
function edSchedulePreview() {
  if (edPreviewRaf || !window.CapePreview) return;
  edPreviewRaf = requestAnimationFrame(() => { edPreviewRaf = 0; window.CapePreview.setCape(edExportUrl()); });
}
function edExportUrl() {
  const cv = $('#ed-export'), c = cv.getContext('2d'); c.clearRect(0, 0, ED_W, ED_H);
  for (let y = 0; y < ED_H; y++) for (let x = 0; x < ED_W; x++) { const col = edGrid[y * ED_W + x]; if (col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); } }
  return cv.toDataURL('image/png');
}

function edCurCol() { return edTool === 'erase' ? null : $('#ed-color').value; }
// Peinture libre (pinceau / gomme) avec interpolation entre deux positions de souris.
function edPaint(e) {
  const p = edCoord(e); if (!p.inside) return;
  const col = edCurCol();
  const from = edLast || p;
  for (const [x, y] of edLineCells(from.x, from.y, p.x, p.y)) edStamp(x, y, col);
  edLast = { x: p.x, y: p.y };
  edRender(); edSchedulePreview();
}
function edPickAt(e) {
  const p = edCoord(e); if (!p.inside) return;
  const col = edGrid[p.y * ED_W + p.x];
  if (col) { $('#ed-color').value = col; edRenderSwatches(); }
  edSetTool('brush');
}

// Historique (annuler / rétablir) — une entrée par TRAIT.
function edSnapshot() { edUndo.push(edGrid.slice()); if (edUndo.length > 80) edUndo.shift(); edRedo.length = 0; edUpdateButtons(); }
function edUpdateButtons() { const u = $('#ed-undo'), r = $('#ed-redo'); if (u) u.disabled = !edUndo.length; if (r) r.disabled = !edRedo.length; }
function edDoUndo() { if (!edUndo.length) return; edRedo.push(edGrid.slice()); edGrid = edUndo.pop(); edRender(); edSchedulePreview(); edUpdateButtons(); }
function edDoRedo() { if (!edRedo.length) return; edUndo.push(edGrid.slice()); edGrid = edRedo.pop(); edRender(); edSchedulePreview(); edUpdateButtons(); }

const ED_TOOLS = ['brush', 'line', 'rect', 'bucket', 'erase', 'pick'];
function edSetTool(t) {
  edTool = t;
  ED_TOOLS.forEach((k) => { const b = $('#ed-' + k); if (b) b.classList.toggle('active', k === t); });
  const cv = edCanvasEl(); if (cv) cv.style.cursor = t === 'pick' ? 'copy' : (t === 'bucket' ? 'cell' : 'crosshair');
}

// Charge une image (data URL) dans la grille 64×32 (1re image si cape animée, sous-échantillonnée si HD).
function edLoadDataUrl(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas'); cv.width = ED_W; cv.height = ED_H;
      const c = cv.getContext('2d'); c.imageSmoothingEnabled = false;
      const fw = img.naturalWidth || ED_W;
      const fh = Math.min(img.naturalHeight || ED_H, Math.round((img.naturalWidth || ED_W) / 2)) || ED_H;
      c.drawImage(img, 0, 0, fw, fh, 0, 0, ED_W, ED_H);
      const d = c.getImageData(0, 0, ED_W, ED_H).data;
      for (let i = 0; i < ED_W * ED_H; i++) {
        const a = d[i * 4 + 3];
        edGrid[i] = a > 12 ? '#' + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('') : null;
      }
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = dataUrl;
  });
}

// Remplit la liste « Point de départ » (Cape vierge + capes de la bibliothèque).
function edRefreshSources() {
  const sel = $('#ed-source'); if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '<option value="__blank">Cape vierge (couleur unie)</option>';
  for (const c of capeCache) {
    const o = document.createElement('option'); o.value = c.id; o.textContent = c.name + (c.builtin ? ' (intégrée)' : '');
    sel.appendChild(o);
  }
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}
// Cape de la bibliothèque en cours d'édition (pour « Mettre à jour »). null = brouillon.
let edSourceId = null, edSourceName = '';
function edUpdateSaveButtons() {
  const btn = $('#ed-update'); if (!btn) return;
  const cape = edSourceId ? capeCache.find((c) => c.id === edSourceId) : null;
  if (cape && !cape.builtin) { btn.classList.remove('hidden'); btn.textContent = `💾 Mettre à jour « ${cape.name} »`; edSourceName = cape.name; }
  else { btn.classList.add('hidden'); if (!cape || cape.builtin) edSourceId = null; } // intégrée/disparue -> pas d'update sur place
}
async function edLoadSource() {
  const v = $('#ed-source').value;
  edSnapshot();
  if (v === '__blank') { edGrid.fill(null); ED_REGIONS.forEach((r) => edFillRegion(r, $('#ed-color').value)); edSourceId = null; }
  else {
    const url = await capeDataUrl(v);
    if (!url) { toast('Cape indisponible.', 'err'); edUndo.pop(); edUpdateButtons(); return; }
    await edLoadDataUrl(url);
    edSourceId = v; // on édite cette cape -> « Mettre à jour » devient possible (si importée)
  }
  edUpdateSaveButtons();
  edRender(); edSchedulePreview();
}
// Ouvre une cape de la bibliothèque dans l'onglet Édition, prête à être retouchée.
async function editCape(id) {
  const tab = [...tabEls].find((t) => t.dataset.tab === 'editor');
  if (!tab) return;
  activateTab(tab);                 // -> edActivate() rafraîchit les sources
  const sel = $('#ed-source');
  if (sel && [...sel.options].some((o) => o.value === id)) { sel.value = id; await edLoadSource(); }
}

function edInit() {
  edRefreshSources();
  // Cape vierge par défaut.
  ED_REGIONS.forEach((r) => edFillRegion(r, '#7c5cff'));
  const cv = edCanvasEl();
  cv.addEventListener('pointerdown', (e) => {
    if (e.button === 1 || e.button === 2) { // clic molette / droit -> déplacement
      edPanning = true; edPanFrom = { x: e.clientX, y: e.clientY, px: edPanX, py: edPanY };
      try { cv.setPointerCapture(e.pointerId); } catch {} e.preventDefault(); return;
    }
    const p = edCoord(e); if (!p.inside && edTool !== 'pick') return;
    if (edTool === 'pick') { edPickAt(e); return; }
    try { cv.setPointerCapture(e.pointerId); } catch {}
    if (edTool === 'bucket') { edSnapshot(); edBucketAt(p.x, p.y, edCurCol()); edAddRecent(edCurCol()); edRender(); edSchedulePreview(); return; }
    edSnapshot(); edPainting = true;
    if (edTool === 'line' || edTool === 'rect') { edStart = { x: p.x, y: p.y }; edPreview = [[p.x, p.y]]; edRender(); }
    else { edLast = null; edPaint(e); } // pinceau / gomme
  });
  cv.addEventListener('pointermove', (e) => {
    if (edPanning && edPanFrom) {
      const sc = cv.width / cv.getBoundingClientRect().width;
      edPanX = edPanFrom.px + (e.clientX - edPanFrom.x) * sc;
      edPanY = edPanFrom.py + (e.clientY - edPanFrom.y) * sc;
      edRender(); return;
    }
    const p = edCoord(e);
    edHover = p.inside ? { x: p.x, y: p.y } : null;
    edUpdatePos(p);
    if (!edPainting) { edRender(); return; }
    if (edStart) {
      edPreview = edTool === 'line'
        ? edLineCells(edStart.x, edStart.y, p.x, p.y)
        : edRectCells(edStart.x, edStart.y, p.x, p.y, $('#ed-rectfill').checked);
      edRender();
    } else edPaint(e);
  });
  cv.addEventListener('pointerleave', () => { edHover = null; edUpdatePos(null); edRender(); });
  const endStroke = () => {
    if (edPainting && edStart && edPreview) { // valider ligne / rectangle
      const col = edCurCol();
      for (const [x, y] of edPreview) edStamp(x, y, col);
      edAddRecent(col); edRender(); edSchedulePreview();
    } else if (edPainting) edAddRecent(edCurCol());
    edPainting = false; edPanning = false; edPanFrom = null; edStart = null; edPreview = null; edLast = null;
  };
  window.addEventListener('pointerup', endStroke);
  cv.addEventListener('pointercancel', endStroke);
  cv.addEventListener('contextmenu', (e) => e.preventDefault()); // clic droit = déplacement, pas de menu
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = cv.getBoundingClientRect();
    const sx = (e.clientX - rect.left) * (cv.width / rect.width);
    const sy = (e.clientY - rect.top) * (cv.height / rect.height);
    const wx = (sx - edPanX) / edZoom, wy = (sy - edPanY) / edZoom;
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    edZoom = Math.min(64, Math.max(3, edZoom * f));
    edPanX = sx - wx * edZoom; edPanY = sy - wy * edZoom;
    edRender();
  }, { passive: false });

  $('#ed-color').addEventListener('input', () => { if (edTool === 'erase') edSetTool('brush'); edRenderSwatches(); });
  $('#ed-brush').addEventListener('click', () => edSetTool('brush'));
  $('#ed-line').addEventListener('click', () => edSetTool('line'));
  $('#ed-rect').addEventListener('click', () => edSetTool('rect'));
  $('#ed-bucket').addEventListener('click', () => edSetTool('bucket'));
  $('#ed-erase').addEventListener('click', () => edSetTool('erase'));
  $('#ed-pick').addEventListener('click', () => edSetTool(edTool === 'pick' ? 'brush' : 'pick'));
  $('#ed-size').addEventListener('change', (e) => { edBrush = Math.max(1, Math.min(4, +e.target.value || 1)); });
  $('#ed-lighter').addEventListener('click', () => edShade(0.12));
  $('#ed-darker').addEventListener('click', () => edShade(-0.12));
  $('#ed-import-front').addEventListener('click', () => guard('#ed-import-front', async () => {
    const r = await window.cap.capes.pickImage();
    if (!r.ok) { if (!r.canceled) toast(r.error || 'Image invalide', 'err'); return; }
    edSnapshot(); await edLoadImageIntoFront(r.dataUrl); edRender(); edSchedulePreview();
    toast('Image placée dans la zone avant ✔', 'ok');
  }));
  $('#ed-grid').addEventListener('click', () => { edShowGrid = !edShowGrid; $('#ed-grid').classList.toggle('active', edShowGrid); edRender(); });
  $('#ed-undo').addEventListener('click', edDoUndo);
  $('#ed-redo').addEventListener('click', edDoRedo);
  $('#ed-fill-front').addEventListener('click', () => { edSnapshot(); edFillRegion(ED_FRONT, $('#ed-color').value); edRender(); edSchedulePreview(); });
  $('#ed-fill-all').addEventListener('click', () => { edSnapshot(); ED_REGIONS.forEach((r) => edFillRegion(r, $('#ed-color').value)); edRender(); edSchedulePreview(); });
  $('#ed-clear').addEventListener('click', () => { edSnapshot(); edGrid.fill(null); edRender(); edSchedulePreview(); });
  $('#ed-zoom-in').addEventListener('click', () => { edZoom = Math.min(64, edZoom * 1.25); edRender(); });
  $('#ed-zoom-out').addEventListener('click', () => { edZoom = Math.max(3, edZoom / 1.25); edRender(); });
  $('#ed-zoom-reset').addEventListener('click', () => { edResizeCanvas(); edFit(); edRender(); });
  $('#ed-load').addEventListener('click', () => guard('#ed-load', edLoadSource));
  $('#ed-import').addEventListener('click', () => guard('#ed-import', async () => {
    const r = await window.cap.capes.pickImage();
    if (!r.ok) { if (!r.canceled) toast(r.error || 'Image invalide', 'err'); return; }
    edSnapshot(); await edLoadDataUrl(r.dataUrl); edSourceId = null; edUpdateSaveButtons(); edRender(); edSchedulePreview();
    toast('Image chargée dans l’éditeur ✔', 'ok');
  }));
  $('#ed-save').addEventListener('click', () => guard('#ed-save', async () => {
    if (edGrid.every((c) => !c)) return toast('La cape est vide — dessine quelque chose d’abord.', 'err');
    const name = $('#ed-name').value.trim() || 'Ma cape';
    const r = await window.cap.capes.create(name, edExportUrl());
    if (!r.ok) return toast(r.error || 'Enregistrement impossible', 'err');
    if ($('#ed-use').checked && r.id) { await window.cap.capes.setActive(r.id); refreshStatus(); }
    $('#ed-msg').textContent = `Cape « ${name} » ajoutée à ta bibliothèque ✔${$('#ed-use').checked ? ' (activée)' : ''}`;
    toast('Cape enregistrée ✔', 'ok');
    await loadCapes();
  }));
  $('#ed-update').addEventListener('click', () => guard('#ed-update', async () => {
    if (!edSourceId) return;
    if (edGrid.every((c) => !c)) return toast('La cape est vide.', 'err');
    const r = await window.cap.capes.setImage(edSourceId, edExportUrl());
    if (!r.ok) return toast(r.error || 'Mise à jour impossible', 'err');
    $('#ed-msg').textContent = `Cape « ${edSourceName} » mise à jour ✔`;
    toast('Cape mise à jour ✔', 'ok');
    frontThumbCache.clear();
    await loadCapes();
  }));
  window.addEventListener('resize', () => {
    if (!$('#tab-editor').classList.contains('active')) return;
    edResizeCanvas(); edFit(); edRender();
  });
  // Raccourcis clavier (onglet Édition, hors saisie de texte).
  const ED_KEYS = { b: 'brush', l: 'line', r: 'rect', g: 'bucket', e: 'erase', p: 'pick', i: 'pick' };
  window.addEventListener('keydown', (e) => {
    if (!$('#tab-editor').classList.contains('active')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    const k = e.key.toLowerCase();
    if (ED_KEYS[k]) { e.preventDefault(); edSetTool(ED_KEYS[k]); }
    else if (k === 'm') { const c = $('#ed-mirror'); c.checked = !c.checked; }
    else if (k >= '1' && k <= '4') { $('#ed-size').value = k; edBrush = +k; }
  });
  edRenderSwatches();
  edSetTool('brush');
}
function edActivate() {
  if (!edInited) { edInit(); edInited = true; }
  edRefreshSources();
  mountPreview('#editor-preview');
  edResizeCanvas(); edFit(); edRender();
  window.CapePreview.setCape(edExportUrl());
  previewState.canvas = null; // force un remontage propre au retour sur « Mes capes »
}

// ---------- Compte Minecraft officiel ----------
let mcBusy = false;

// Cache des textures de capes officielles (data URL récupérées côté main, hors CSP).
// Clé = capeId (l'URL Mojang est content-addressée -> stable). Vidé à la déconnexion.
const mcTexCache = new Map();
async function mcTexture(capeId) {
  if (mcTexCache.has(capeId)) return mcTexCache.get(capeId);
  const r = await window.cap.mc.capeTexture(capeId);
  const url = (r && r.ok) ? r.dataUrl : null;
  if (url) mcTexCache.set(capeId, url); // idem : un échec ne doit pas casser la vignette définitivement
  return url;
}
async function mcLoadThumb(el, capeId) {
  const url = await mcTexture(capeId);
  if (url) { el.style.backgroundImage = `url(${await capeFrontThumb(url)})`; el.textContent = ''; el.classList.remove('mc-none'); }
}
// Aperçu 3D de la cape officielle active (réutilise le moteur CapePreview).
async function mcRenderPreview(v) {
  if (!window.CapePreview) return;
  mountPreview('#mc-preview');
  const active = (v.capes || []).find((c) => c.state === 'ACTIVE');
  const label = $('#mc-preview-label');
  if (!active) { window.CapePreview.clear(); if (label) label.textContent = 'Aucune cape active'; return; }
  const url = await mcTexture(active.id);
  if (url) { window.CapePreview.setCape(url); if (label) label.textContent = active.alias; }
  else { window.CapePreview.clear(); if (label) label.textContent = active.alias + ' (aperçu indisponible)'; }
}

function renderMc(v) {
  const inOut = !!(v && v.connected);
  $('#mc-loggedout').classList.toggle('hidden', inOut);
  $('#mc-loggedin').classList.toggle('hidden', !inOut);
  if (!inOut) return;
  $('#mc-name').textContent = v.name || '—';
  const expired = v.expiresAt && Date.now() > v.expiresAt && !v.canRefresh;
  $('#mc-warn-expired').classList.toggle('hidden', !expired);
  const grid = $('#mc-capes');
  grid.innerHTML = '';
  const capes = v.capes || [];
  mcRenderPreview(v);
  if (!capes.length) {
    grid.innerHTML = '<p class="muted">Aucune cape officielle sur ce compte. (Les capes s’obtiennent via Mojang : Migrator, MineCon, éditions spéciales…)</p>';
    return;
  }
  // Carte « Aucune cape » (masquer) + une carte par cape possédée.
  const none = document.createElement('div');
  const anyActive = capes.some((c) => c.state === 'ACTIVE');
  none.className = 'cape mc-cape' + (!anyActive ? ' active' : '');
  none.innerHTML = `<div class="thumb mc-none">🚫</div>
    <div class="name">Aucune cape</div>
    <div class="cape-actions"><button class="btn small act-hide">${!anyActive ? '✓ Aucune' : 'Masquer'}</button></div>`;
  none.querySelector('.act-hide').addEventListener('click', () => mcHide());
  grid.appendChild(none);
  for (const c of capes) {
    const active = c.state === 'ACTIVE';
    const el = document.createElement('div');
    el.className = 'cape mc-cape' + (active ? ' active' : '');
    // Vignette générique par défaut (🎽) remplacée par la vraie texture Mojang dès
    // qu'elle est récupérée côté main (mcLoadThumb) — la CSP interdit les hôtes distants.
    el.innerHTML = `
      <div class="thumb mc-none">🎽</div>
      ${active ? '<span class="badge">active</span>' : ''}
      <div class="name" title="${esc(c.alias)}">${esc(c.alias)}</div>
      <div class="cape-actions">
        <button class="btn small act-use">${active ? '✓ Active' : 'Activer'}</button>
        <button class="btn small act-import" title="Ajouter à ma bibliothèque (utilisable via OptiFine, créateur, aperçu)">➕</button>
      </div>`;
    el.querySelector('.act-use').addEventListener('click', () => { if (!active) mcSetCape(c.id); });
    el.querySelector('.act-import').addEventListener('click', () => mcImportCape(c.id, c.alias));
    grid.appendChild(el);
    mcLoadThumb(el.querySelector('.thumb'), c.id);
  }
}

async function loadMc() {
  const r = await window.cap.mc.status();
  renderMc(r);
  if (r && r.connected) loadMcSkin();
}

// Récupère le skin du compte connecté et l'applique à tous les aperçus 3D (sinon défaut).
async function loadMcSkin() {
  if (!window.CapePreview) return;
  try {
    const r = await window.cap.mc.skin();
    window.CapePreview.setSkin(r && r.ok ? r.dataUrl : null, r && r.slim);
  } catch { window.CapePreview.setSkin(null); }
}

async function mcSetCape(id) {
  if (mcBusy) return; mcBusy = true;
  toast('Activation de la cape…');
  try {
    const r = await window.cap.mc.setCape(id);
    if (r.ok) { renderMc(r); toast('Cape officielle activée ✔', 'ok'); }
    else toast(r.error || 'Activation impossible', 'err');
  } finally { mcBusy = false; }
}

async function mcHide() {
  if (mcBusy) return; mcBusy = true;
  toast('Masquage de la cape…');
  try {
    const r = await window.cap.mc.hideCape();
    if (r.ok) { renderMc(r); toast('Cape masquée ✔', 'ok'); }
    else toast(r.error || 'Masquage impossible', 'err');
  } finally { mcBusy = false; }
}

// Ajoute une cape officielle à la bibliothèque locale (utilisable via OptiFine, etc.).
async function mcImportCape(id, alias) {
  if (mcBusy) return; mcBusy = true;
  toast('Ajout à ta bibliothèque…');
  try {
    const r = await window.cap.mc.importCape(id);
    if (r.ok) { toast(`« ${alias} » ajoutée à Mes capes ✔`, 'ok'); loadCapes(); }
    else toast(r.error || 'Ajout impossible', 'err');
  } finally { mcBusy = false; }
}

// Renseigne le pseudo du compte officiel comme pseudo Cap Hub (capes custom via OptiFine).
$('#mc-use-name').addEventListener('click', async () => {
  const name = $('#mc-name').textContent.trim();
  if (!name || name === '—') return;
  await window.cap.settings.save({ username: name });
  $('#in-username').value = name;
  toast(`Pseudo Cap Hub réglé sur « ${name} » ✔`, 'ok');
});

// Copie le code device dans le presse-papier.
$('#mc-code-copy').addEventListener('click', async () => {
  const code = $('#mc-code-val').textContent.trim();
  if (!code || code === '——' || code === '…') return;
  try { await navigator.clipboard.writeText(code); toast('Code copié 📋', 'ok'); }
  catch { toast('Copie impossible (copie manuelle).', 'err'); }
});

$('#mc-refresh').addEventListener('click', async () => {
  toast('Rafraîchissement…');
  const r = await window.cap.mc.refresh();
  if (r.ok) { renderMc(r); loadMcSkin(); toast('Profil à jour ✔', 'ok'); } // le skin a pu changer
  else toast(r.error || 'Erreur', 'err');
});

$('#mc-logout').addEventListener('click', async () => {
  await window.cap.mc.logout();
  mcTexCache.clear();
  if (window.CapePreview) { window.CapePreview.setSkin(null); window.CapePreview.clear(); }
  renderMc({ connected: false });
  toast('Déconnecté.', 'ok');
});

$('#mc-login-token').addEventListener('click', async () => {
  const token = $('#mc-token').value.trim();
  if (!token) return toast('Colle un token.', 'err');
  toast('Connexion…');
  const r = await window.cap.mc.loginToken(token);
  if (r.ok) { $('#mc-token').value = ''; renderMc(r); loadMcSkin(); toast('Connecté ✔', 'ok'); }
  else toast(r.error || 'Connexion impossible', 'err');
});

$('#mc-login-ms').addEventListener('click', async () => {
  $('#mc-login-ms').disabled = true;
  $('#mc-code-box').classList.remove('hidden');
  $('#mc-code-val').textContent = '…';
  toast('Ouverture de la connexion Microsoft…');
  const r = await window.cap.mc.loginMicrosoft();
  $('#mc-login-ms').disabled = false;
  $('#mc-code-box').classList.add('hidden');
  if (r.ok) { renderMc(r); loadMcSkin(); toast('Connecté ✔', 'ok'); }
  else toast(r.error || 'Connexion Microsoft annulée/échouée', 'err');
});

$('#mc-cancel').addEventListener('click', async () => {
  await window.cap.mc.cancelLogin();
  $('#mc-code-box').classList.add('hidden');
  $('#mc-login-ms').disabled = false;
});

// Le lien est informatif : le main ouvre déjà la page automatiquement.
$('#mc-code-link').addEventListener('click', (e) => e.preventDefault());

// Le main pousse le code à saisir pendant le device-code Microsoft.
window.cap.on('mc-code', (d) => {
  $('#mc-code-box').classList.remove('hidden');
  $('#mc-code-val').textContent = d.userCode || '——';
  const link = $('#mc-code-link');
  if (link && d.verificationUri) { link.textContent = d.verificationUri; link.href = d.verificationUri; }
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
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.title = 'Voir la cape en 3D';
    el.innerHTML = `
      <div class="av"></div>
      <div><div class="pn">${esc(p.name)}</div>
      <div class="pd">${p.updated ? 'maj ' + esc(p.updated) : ''}</div></div>`;
    el.addEventListener('click', () => showPlayerCape(p.name));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showPlayerCape(p.name); } });
    list.appendChild(el);
    loadPlayerThumb(el.querySelector('.av'), p.name);
  }
}

// Cache des capes du registre (data URL). Vidé au rafraîchissement (une cape peut changer).
const playerCapeCache = new Map();
async function playerCape(name) {
  if (playerCapeCache.has(name)) return playerCapeCache.get(name);
  const r = await window.cap.registry.cape(name);
  const url = (r && r.ok) ? r.dataUrl : null;
  if (url) playerCapeCache.set(name, url); // ne mémorise pas un échec transitoire
  return url;
}
async function loadPlayerThumb(el, name) {
  const url = await playerCape(name);
  if (url) el.style.backgroundImage = `url(${await capeFrontThumb(url)})`;
}
async function showPlayerCape(name) {
  if (!window.CapePreview) return;
  window.CapePreview.mount($('#player-preview'));
  const label = $('#player-preview-label');
  const url = await playerCape(name);
  if (url) { window.CapePreview.setCape(url); if (label) label.textContent = name; }
  else { window.CapePreview.clear(); if (label) label.textContent = `${name} (cape indisponible hors-ligne)`; }
}

$('#btn-refresh-players').addEventListener('click', () => guard('#btn-refresh-players', async () => {
  const r = await window.cap.registry.refresh();
  toast(r.ok ? `Registre à jour (${(r.players || []).length} joueurs).` : r.error, r.ok ? 'ok' : 'err');
  playerCapeCache.clear(); // une cape a pu changer -> on relit
  loadPlayers();
}));

$('#btn-publish').addEventListener('click', () => guard('#btn-publish', async () => {
  toast('Publication…');
  const r = await window.cap.capes.publish();
  toast(r.ok ? 'Ta cape est publiée dans le registre ✔' : r.error, r.ok ? 'ok' : 'err');
  if (r.ok) loadPlayers();
}));

// ---------- État : boutons ----------
$('#btn-proxy-toggle').addEventListener('click', () => guard('#btn-proxy-toggle', async () => {
  const s = await window.cap.proxy.status();
  const r = s.running ? await window.cap.proxy.stop() : await window.cap.proxy.start();
  if (!r.ok) toast(r.error, 'err');
  refreshStatus();
}));
$('#btn-hosts-toggle').addEventListener('click', () => guard('#btn-hosts-toggle', async () => {
  const s = await window.cap.proxy.status();
  toast('Modification du fichier hosts… (fenêtre admin)');
  const r = s.hostsApplied ? await window.cap.proxy.removeRedirect() : await window.cap.proxy.applyRedirect();
  if (!r.ok) toast(r.error, 'err');
  else toast('Redirection ' + (s.hostsApplied ? 'retirée.' : 'activée.'), 'ok');
  refreshStatus();
}));

// Auto-diagnostic : teste toute la chaîne et affiche un rapport étape par étape.
$('#btn-selftest').addEventListener('click', () => guard('#btn-selftest', async () => {
  const box = $('#selftest-result');
  box.innerHTML = '<p class="muted">Test en cours…</p>';
  const r = await window.cap.proxy.selfTest();
  if (!r.ok) { box.innerHTML = '<p class="muted">Test impossible.</p>'; return; }
  box.innerHTML = r.steps.map((s) => `
    <div class="diag-step ${s.ok ? 'ok' : 'ko'}">
      <span class="ic" aria-hidden="true">${s.ok ? '✅' : '❌'}</span>
      <div><div class="dl">${esc(s.label)}</div>${s.detail ? `<div class="dd muted">${esc(s.detail)}</div>` : ''}</div>
    </div>`).join('');
  const summary = document.createElement('div');
  summary.className = 'diag-summary ' + (r.allOk ? 'ok' : 'ko');
  summary.textContent = r.allOk
    ? '🎉 Tout est bon — relance/rejoins un monde, ta cape doit apparaître.'
    : '⚠️ Un ou plusieurs points bloquent l’affichage — corrige les ❌ ci-dessus.';
  box.appendChild(summary);
}));

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
  $('#in-tray').checked = s.closeToTray;
  $('#in-startup').checked = s.launchAtStartup;
  $('#in-repo').value = s.repo || '';
  $('#in-branch').value = s.branch || '';
  $('#in-mc-clientid').value = s.mcClientId || '';
  $('#token-state').textContent = s.hasToken ? '· enregistré' : '· non défini';
  if (!r.encryption) $('#token-state').textContent += ' (⚠ chiffrement indisponible)';
}

$('#btn-save').addEventListener('click', async () => {
  await window.cap.settings.save({
    username: $('#in-username').value,
    autoApply: $('#in-autoapply').checked,
    autoProxy: $('#in-autoproxy').checked,
    closeToTray: $('#in-tray').checked,
    launchAtStartup: $('#in-startup').checked,
    repo: $('#in-repo').value,
    branch: $('#in-branch').value,
    mcClientId: $('#in-mc-clientid').value,
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
// Clients à système de capes FERMÉ : ils n'affichent pas les capes Cap Hub (canal OptiFine
// non exploitable — cosmétiques propres / capes servies côté serveur). On le signale.
const CLOSED_CAPE_CLIENTS = /lunar|badlion|feather/i;
function updateClientNote(client) {
  const note = $('#client-note'); if (!note) return;
  if (client && CLOSED_CAPE_CLIENTS.test(client)) {
    const name = client.replace(/\s*\(en jeu\)\s*/i, '');
    note.classList.remove('hidden');
    note.innerHTML = `⚠️ <b>${esc(name)}</b> utilise son <b>propre</b> système de capes (fermé) : Cap Hub ne peut pas y afficher ta cape. Pour être vu sur ce client, ajoute ta cape dans <b>ses cosmétiques</b>, ou utilise une <b>cape officielle Mojang</b> (visible partout, sans rien installer).`;
  } else { note.classList.add('hidden'); note.textContent = ''; }
}
window.cap.on('game-start', (info) => {
  setPill('#pill-game', true, 'Minecraft');
  $('#games-now').textContent = `${info.client}${info.username ? ' — ' + info.username : ''}`;
  updateClientNote(info.client);
});
window.cap.on('game-stop', () => {
  setPill('#pill-game', false, 'Minecraft');
  $('#games-now').textContent = 'Aucun jeu détecté.';
  updateClientNote(null);
});
window.cap.on('update-status', (u) => {
  if (u.state === 'available') {
    if (confirm(`Cap Hub ${u.version} est disponible.\n\n${u.notes || ''}\n\nInstaller maintenant ?`)) {
      toast('Téléchargement de la mise à jour…');
      window.cap.update.apply();
    }
  } else if (u.state === 'uptodate') toast('Cap Hub est à jour.', 'ok');
  else if (u.state === 'error') toast('Mise à jour : ' + u.error, 'err');
});
// Progression du téléchargement de la mise à jour (le toast reste affiché tant qu'il se met à jour).
window.cap.on('update-progress', (d) => {
  if (d.pct == null) toast('Téléchargement de la mise à jour…');
  else if (d.pct >= 100) toast('Vérification & installation… l’app va redémarrer.', 'ok');
  else toast(`Téléchargement de la mise à jour… ${d.pct}%`);
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
  // Si un compte Minecraft est déjà connecté, applique son skin aux aperçus 3D.
  window.cap.mc.status().then((r) => { if (r && r.connected) loadMcSkin(); }).catch(() => {});
  const g = await window.cap.games.current();
  if (g.games && g.games.length) {
    setPill('#pill-game', true, 'Minecraft');
    $('#games-now').textContent = g.games.map((x) => x.client).join(', ');
    updateClientNote((g.games.find((x) => CLOSED_CAPE_CLIENTS.test(x.client)) || {}).client || null);
  }
})();

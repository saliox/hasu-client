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
  previewState.canvas = null;
  const r = await window.cap.capes.list();
  capeCache = r.capes || [];
  capeActive = r.active || '';
  capeFavs = new Set(r.favorites || []);
  capeCats = r.categories || {};
  updateCatFilter();
  renderCapeGrid();
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
      <div class="thumb"></div>
      ${c.id === capeActive ? '<span class="badge">active</span>' : ''}
      <div class="name" title="${esc(c.name)}">${esc(c.name)}${c.builtin ? ' <span class="muted">· intégrée</span>' : ''}</div>
      <div class="catrow"><span class="cat-chip" title="Changer de dossier" role="button" tabindex="0" aria-label="Changer de dossier (${esc(catOf(c))})">🗂️ ${esc(catOf(c))}</span></div>
      <div class="cape-actions">
        <button class="btn small act-use" title="${c.id === capeActive ? 'Cliquer pour désactiver' : 'Utiliser cette cape'}">${c.id === capeActive ? '✓ Active' : 'Utiliser'}</button>
        <button class="btn small act-dup" title="Dupliquer" aria-label="Dupliquer">⧉</button>
        <button class="btn small act-export" title="Exporter en PNG" aria-label="Exporter en PNG">⬇</button>
        ${c.builtin ? '' : '<button class="btn small act-rename" title="Renommer" aria-label="Renommer">✎</button><button class="btn small danger act-del" title="Supprimer" aria-label="Supprimer">🗑</button>'}
      </div>`;
    el.querySelector('.fav').addEventListener('click', () => toggleFav(c.id, !fav));
    el.querySelector('.act-use').addEventListener('click', () => setActive(c.id === capeActive ? '' : c.id));
    el.querySelector('.act-dup').addEventListener('click', () => dupCape(c.id));
    el.querySelector('.act-export').addEventListener('click', () => exportCape(c.id, c.name));
    el.querySelector('.cat-chip').addEventListener('click', () => startCatEdit(el, c));
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

// Prévisualisation 3D de la cape active. Ne se relance QUE si la cape (ou le canvas)
// a changé — sinon taper dans la recherche ferait clignoter l'aperçu à chaque frappe.
const previewState = { id: null, canvas: null };
async function renderPreview(id, name) {
  if (!window.CapePreview) return;
  mountPreview('#cape-preview');
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

async function loadThumb(el, id) {
  const url = await capeDataUrl(id);
  if (url) el.style.backgroundImage = `url(${url})`;
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

$('#btn-import').addEventListener('click', () => guard('#btn-import', async () => {
  const r = await window.cap.capes.import();
  if (!r.ok) { if (!r.canceled) toast(r.error || 'Import impossible', 'err'); return; }
  toast(`Traitement de ${r.files.length} fichier(s)…`);
  let ok = 0, fail = 0;
  for (const f of r.files) {
    if (f.tooBig) { fail++; continue; }
    try {
      const url = await buildCapeFromFile(f);
      const res = url && await window.cap.capes.create(f.name, url);
      if (res && res.ok) ok++; else fail++;
    } catch { fail++; }
  }
  toast(`${ok} cape(s) importée(s) ✔${fail ? ` (${fail} rejetée(s))` : ''}`, ok ? 'ok' : 'err');
  if (ok) loadCapes();
}));

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
  if (!$('#tab-creator').classList.contains('active') || $('#cr-mode').value !== 'pixel') return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) { e.preventDefault(); pxUndo(); }
  else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); pxRedo(); }
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
  if (url) { el.style.backgroundImage = `url(${url})`; el.textContent = ''; el.classList.remove('mc-none'); }
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
  if (r.ok) { renderMc(r); toast('Profil à jour ✔', 'ok'); }
  else toast(r.error || 'Erreur', 'err');
});

$('#mc-logout').addEventListener('click', async () => {
  await window.cap.mc.logout();
  mcTexCache.clear();
  if (window.CapePreview) window.CapePreview.clear();
  renderMc({ connected: false });
  toast('Déconnecté.', 'ok');
});

$('#mc-login-token').addEventListener('click', async () => {
  const token = $('#mc-token').value.trim();
  if (!token) return toast('Colle un token.', 'err');
  toast('Connexion…');
  const r = await window.cap.mc.loginToken(token);
  if (r.ok) { $('#mc-token').value = ''; renderMc(r); toast('Connecté ✔', 'ok'); }
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
  if (r.ok) { renderMc(r); toast('Connecté ✔', 'ok'); }
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
  if (url) el.style.backgroundImage = `url(${url})`;
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
  const g = await window.cap.games.current();
  if (g.games && g.games.length) {
    setPill('#pill-game', true, 'Minecraft');
    $('#games-now').textContent = g.games.map((x) => x.client).join(', ');
  }
})();

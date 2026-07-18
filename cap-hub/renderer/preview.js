'use strict';
// Aperçu 3D « façon Minecraft » : le personnage (modèle joueur standard) est rendu avec
// le VRAI skin du joueur (texturé, échantillonnage au plus proche = look pixel du jeu),
// et la cape est mappée sur le modèle de cape avec les UV officielles. Canvas 2D, zéro
// dépendance : chaque face de boîte est texturée par 2 triangles affines.
//
// API : window.CapePreview.{ mount(canvas), setCape(dataUrl), setSkin(dataUrl, slim),
//                            clear(), setShowBody(bool), frameCount(w,h) }

(function () {
  let canvas = null, ctx = null, raf = 0, t0 = 0, gen = 0;
  let capeImg = null, capeW = 0, capeH = 0, frames = 1, curFrame = 0, lastSwap = 0;
  let skinImg = null, slim = false;
  let showBody = true;

  function mount(el) { canvas = el; ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false; }
  function clear() {
    gen++; cancelAnimationFrame(raf); raf = 0; capeImg = null;
    tileCache.clear();
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Géométrie de cape (identique à src/capegeom.js).
  function frameCount(w, h) {
    if (!w || !h) return 1;
    const n = Math.round((2 * h) / w);
    return n >= 1 && Math.abs(n * (w / 2) - h) <= Math.max(1, w * 0.03) ? n : 1;
  }
  function capeFrontRect(w, h, frame) {
    const s = (w % 46 === 0 && w % 64 !== 0) ? w / 46 : w / 64;
    return { x: 1 * s, y: frame * 32 * s + 1 * s, w: 10 * s, h: 16 * s, s };
  }

  // ---------- Skin par défaut (procédural, 64×64) quand aucun skin connecté ----------
  let defaultSkin = null;
  function makeDefaultSkin() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    const rect = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    const SKIN = '#d8b083', SKIN_D = '#c49a6c', SHIRT = '#3f7fbf', PANTS = '#3a3f57', HAIR = '#4a3526';
    // Tête (toutes faces peau, dessus cheveux)
    rect(0, 8, 32, 8, SKIN); rect(8, 0, 16, 8, HAIR);
    // Visage (face avant tête : 8,8 8x8)
    rect(9, 11, 2, 2, '#fff'); rect(10, 11, 1, 2, '#3a2f6b'); // œil gauche
    rect(13, 11, 2, 2, '#fff'); rect(13, 11, 1, 2, '#3a2f6b'); // œil droit
    rect(10, 14, 4, 1, SKIN_D); // bouche
    rect(8, 8, 16, 1, HAIR); // frange
    // Corps
    rect(16, 16, 24, 16, SHIRT);
    // Bras (peau + manche)
    rect(40, 16, 16, 16, SKIN); rect(40, 20, 16, 4, SHIRT);
    rect(32, 48, 16, 16, SKIN); rect(32, 52, 16, 4, SHIRT);
    // Jambes
    rect(0, 16, 16, 16, PANTS); rect(16, 48, 16, 16, PANTS);
    const img = new Image(); img.src = cv.toDataURL('image/png');
    return img;
  }

  // ---------- Triangle texturé (mapping affine + découpe) ----------
  function texTri(img, s0, s1, s2, d0, d1, d2) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0[0], d0[1]); ctx.lineTo(d1[0], d1[1]); ctx.lineTo(d2[0], d2[1]); ctx.closePath();
    ctx.clip();
    const x0 = s0[0], y0 = s0[1], x1 = s1[0], y1 = s1[1], x2 = s2[0], y2 = s2[1];
    const u0 = d0[0], v0 = d0[1], u1 = d1[0], v1 = d1[1], u2 = d2[0], v2 = d2[1];
    // Transformation affine SOURCE -> DEST (formule standard vérifiée).
    const den = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
    if (den === 0) { ctx.restore(); return; }
    const a = (u0 * (y1 - y2) + u1 * (y2 - y0) + u2 * (y0 - y1)) / den;
    const b = (v0 * (y1 - y2) + v1 * (y2 - y0) + v2 * (y0 - y1)) / den;
    const cc = (u0 * (x2 - x1) + u1 * (x0 - x2) + u2 * (x1 - x0)) / den;
    const dd = (v0 * (x2 - x1) + v1 * (x0 - x2) + v2 * (x1 - x0)) / den;
    const e = u0 - a * x0 - cc * y0;
    const f = v0 - b * x0 - dd * y0;
    ctx.setTransform(a, b, cc, dd, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  // ---------- Projection ----------
  // Perspective FAIBLE (quasi-orthographique) = boîtes nettes façon Minecraft, sans
  // déformation des faches ni bras qui « s'écartent ».
  const DEPTH = 210;
  // Ombrage par face (look cuboïde Minecraft) : dessus le plus clair, côtés plus sombres.
  const SHADE = { top: 1.0, front: 0.86, back: 0.86, left: 0.66, right: 0.66, bottom: 0.5, cape: 0.92 };
  function project(p, ang, tilt, cx, cy, unit) {
    let x = p[0], y = p[1] - 16, z = p[2]; // centre modèle ~ y16
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let xr = x * ca - z * sa, zr = x * sa + z * ca;
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    const yr = y * ct - zr * st, zr2 = y * st + zr * ct;
    const s = DEPTH / (DEPTH + zr2);
    return [cx + xr * unit * s, cy - yr * unit * s, zr2];
  }

  // ---------- Modèle joueur (unités = pixels de skin ; +x=gauche joueur, front=-z) ----------
  // Chaque boîte : dimensions + UV par face (en px de la texture 64×64).
  function box(x0, x1, y0, y1, z0, z1, uv, tex) { return { x0, x1, y0, y1, z0, z1, uv, tex }; }
  function skinBoxes() {
    const armW = slim ? 3 : 4;
    const aOff = slim ? 1 : 0; // décalage UV largeur bras slim
    return [
      // Tête 8×8×8, centrée, base y=24..32
      box(-4, 4, 24, 32, -4, 4, {
        top: [8, 0, 8, 8], bottom: [16, 0, 8, 8], front: [8, 8, 8, 8],
        back: [24, 8, 8, 8], right: [0, 8, 8, 8], left: [16, 8, 8, 8],
      }, 'skin'),
      // Corps 8×12×4, y=12..24
      box(-4, 4, 12, 24, -2, 2, {
        top: [20, 16, 8, 4], bottom: [28, 16, 8, 4], front: [20, 20, 8, 12],
        back: [32, 20, 8, 12], right: [16, 20, 4, 12], left: [28, 20, 4, 12],
      }, 'skin'),
      // Bras droit (côté -x écran) armW×12×4, y=12..24
      box(-4 - armW, -4, 12, 24, -2, 2, {
        top: [44, 16, armW, 4], bottom: [44 + armW, 16, armW, 4], front: [44, 20, armW, 12],
        back: [52 - aOff, 20, armW, 12], right: [40, 20, 4, 12], left: [48 - aOff, 20, 4, 12],
      }, 'skin'),
      // Bras gauche
      box(4, 4 + armW, 12, 24, -2, 2, {
        top: [36, 48, armW, 4], bottom: [36 + armW, 48, armW, 4], front: [36, 52, armW, 12],
        back: [44 - aOff, 52, armW, 12], right: [32, 52, 4, 12], left: [40 - aOff, 52, 4, 12],
      }, 'skin'),
      // Jambe droite 4×12×4, y=0..12, x -4..0
      box(-4, 0, 0, 12, -2, 2, {
        top: [4, 16, 4, 4], bottom: [8, 16, 4, 4], front: [4, 20, 4, 12],
        back: [12, 20, 4, 12], right: [0, 20, 4, 12], left: [8, 20, 4, 12],
      }, 'skin'),
      // Jambe gauche x 0..4
      box(0, 4, 0, 12, -2, 2, {
        top: [20, 48, 4, 4], bottom: [24, 48, 4, 4], front: [20, 52, 4, 12],
        back: [28, 52, 4, 12], right: [16, 52, 4, 12], left: [24, 52, 4, 12],
      }, 'skin'),
    ];
  }

  // 8 sommets d'une boîte, indexés : 0..3 = face z0 (front), 4..7 = face z1 (back).
  function corners(b) {
    return [
      [b.x0, b.y0, b.z0], [b.x1, b.y0, b.z0], [b.x1, b.y1, b.z0], [b.x0, b.y1, b.z0],
      [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1],
    ];
  }
  // Faces : indices de sommets (ordre horaire vu de l'extérieur) + clé UV.
  const BOX_FACES = [
    { k: 'front', c: [3, 2, 1, 0] }, // -z, vue de face : haut-gauche, haut-droite, bas-droite, bas-gauche
    { k: 'back', c: [6, 7, 4, 5] },  // +z
    { k: 'right', c: [7, 3, 0, 4] }, // -x (droite du joueur)
    { k: 'left', c: [2, 6, 5, 1] },  // +x
    { k: 'top', c: [3, 7, 6, 2] },   // +y
    { k: 'bottom', c: [0, 1, 5, 4] },// -y
  ];

  // Une face tournée VERS la caméra a une aire signée écran < 0 (ordre horaire dans notre
  // repère). On élimine les faces arrière (évite le voir-au-travers et les coutures).
  function frontFacing(P) {
    return (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]) > 0;
  }

  function pushBoxFaces(b, polys, tex, ang, tilt, cx, cy, unit) {
    const C = corners(b);
    for (const face of BOX_FACES) {
      const uv = b.uv[face.k]; if (!uv) continue;
      const P = face.c.map((i) => project(C[i], ang, tilt, cx, cy, unit));
      if (!frontFacing(P)) continue; // backface culling
      const depth = (P[0][2] + P[1][2] + P[2][2] + P[3][2]) / 4;
      // Clé de tuile = région UV réelle (PAS le nom de face) : head/body/bras/jambes
      // partagent les mêmes noms de face mais des régions différentes -> sinon collision.
      polys.push({ P, uv, tex, key: tex + ':' + uv.join('_'), face: face.k, depth });
    }
  }

  // Cape : quad (face extérieure) mappé avec la région avant de la cape (frame courante),
  // accrochée au dos, légèrement inclinée (comme au repos dans le jeu).
  function pushCape(polys, ang, tilt, cx, cy, unit) {
    if (!capeImg) return;
    const r = capeFrontRect(capeW, capeH, curFrame);
    // Modèle cape 10 large × 16 haut, dos du corps (z≈2), flare vers l'arrière en bas.
    const zTop = 2.2, zBot = 3.6, yTop = 23.5, yBot = 7.5, xL = 5, xR = -5;
    // Coins 3D : haut-gauche, haut-droite, bas-droite, bas-gauche (vue de derrière).
    const c3 = [[xL, yTop, zTop], [xR, yTop, zTop], [xR, yBot, zBot], [xL, yBot, zBot]];
    const P = c3.map((p) => project(p, ang, tilt, cx, cy, unit));
    const depth = (P[0][2] + P[1][2] + P[2][2] + P[3][2]) / 4;
    polys.push({ P, uv: [r.x, r.y, r.w, r.h], tex: 'cape', key: 'cape:' + curFrame, face: 'cape', depth });
  }

  // Cache de tuiles : chaque région source est recadrée à sa résolution native une fois,
  // puis mappée sur le quad (upscale au plus proche = pixels nets). Vidé si skin/cape change.
  const tileCache = new Map();
  function getTile(img, uv, key) {
    let tile = tileCache.get(key);
    if (tile) return tile;
    if (!img.complete || !img.naturalWidth) return null; // image pas prête -> on ne cache pas de tuile vide
    const [sx, sy, sw, sh] = uv;
    tile = document.createElement('canvas');
    tile.width = Math.max(1, Math.round(sw)); tile.height = Math.max(1, Math.round(sh));
    const c = tile.getContext('2d'); c.imageSmoothingEnabled = false;
    c.drawImage(img, sx, sy, sw, sh, 0, 0, tile.width, tile.height);
    tileCache.set(key, tile);
    return tile;
  }
  // Dilate légèrement un quad (chaque coin s'écarte du centre) pour que les faces se
  // chevauchent d'~1px et masquer les coutures d'anti-aliasing.
  function expand(P, px) {
    const cx = (P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, cy = (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4;
    return P.map((p) => { const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy) || 1; return [p[0] + dx / d * px, p[1] + dy / d * px]; });
  }
  function drawPoly(poly) {
    const img = poly.tex === 'cape' ? capeImg : (skinImg || defaultSkin);
    if (!img) return;
    const tile = getTile(img, poly.uv, poly.key + (poly.tex === 'cape' ? '' : (skinImg ? ':s' : ':d')));
    if (!tile) return;
    // En quasi-orthographique, une face plane se projette en ~parallélogramme : on la
    // dessine d'UNE seule transformation affine (0,0)->P0, (w,0)->P1, (0,h)->P3. Pas de
    // découpe en 2 triangles -> aucune couture diagonale. Léger débordement (expand) pour
    // masquer les jointures entre faces voisines.
    const w = tile.width, h = tile.height, P = expand(poly.P, 0.85);
    const a = (P[1][0] - P[0][0]) / w, b = (P[1][1] - P[0][1]) / w;
    const c = (P[3][0] - P[0][0]) / h, d = (P[3][1] - P[0][1]) / h;
    ctx.save();
    ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath(); ctx.clip();
    ctx.setTransform(a, b, c, d, P[0][0], P[0][1]);
    ctx.drawImage(tile, 0, 0);
    ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Ombrage par face -> volume cuboïde Minecraft.
    const shade = SHADE[poly.face] != null ? SHADE[poly.face] : 0.8;
    if (shade < 1) {
      ctx.globalAlpha = 1 - shade; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function loop(ts) {
    if (!ctx || !capeImg) return;
    if (!t0) t0 = ts;
    const t = (ts - t0) / 1000;
    if (frames > 1 && ts - lastSwap > 120) { curFrame = (curFrame + 1) % frames; lastSwap = ts; }

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    const cx = W / 2, cy = H / 2 + (showBody ? 6 : 0);
    const unit = showBody ? Math.min(W / 20, H / 42) : Math.min(W / 13, H / 20);
    // Tourne-disque lent : on part de FACE (on voit le visage, comme un aperçu de skin
    // Minecraft) et la rotation ramène le dos (donc la cape) régulièrement.
    const ang = t * 0.55;
    const tilt = 0.12;

    // Ombre au sol.
    const foot = project([0, 0, 0], ang, tilt, cx, cy, unit);
    ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, foot[1] + 4, unit * (showBody ? 7 : 5), 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    const polys = [];
    if (showBody) for (const b of skinBoxes()) pushBoxFaces(b, polys, b.tex, ang, tilt, cx, cy, unit);
    pushCape(polys, ang, tilt, cx, cy, unit);
    // Peintre : du plus loin au plus proche.
    polys.sort((p, q) => q.depth - p.depth);
    for (const poly of polys) drawPoly(poly);

    raf = requestAnimationFrame(loop);
  }

  function start() { if (!raf) { t0 = 0; raf = requestAnimationFrame(loop); } }

  function setCape(dataUrl) {
    clear();
    if (!dataUrl) return;
    const myGen = gen;
    if (!defaultSkin) defaultSkin = makeDefaultSkin();
    const image = new Image();
    image.onload = () => {
      if (myGen !== gen) return;
      capeImg = image; capeW = image.naturalWidth; capeH = image.naturalHeight;
      frames = frameCount(capeW, capeH); curFrame = 0; lastSwap = 0;
      start();
    };
    image.onerror = () => { if (myGen === gen) clear(); };
    image.src = dataUrl;
  }

  function setSkin(dataUrl, isSlim) {
    slim = !!isSlim;
    tileCache.clear();
    if (!dataUrl) { skinImg = null; return; }
    const image = new Image();
    image.onload = () => { skinImg = image; tileCache.clear(); };
    image.onerror = () => { skinImg = null; };
    image.src = dataUrl;
  }

  function setShowBody(b) { showBody = !!b; }

  window.CapePreview = { mount, setCape, setSkin, clear, frameCount, setShowBody };
})();

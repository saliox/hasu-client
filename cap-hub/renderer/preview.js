'use strict';
// Aperçu 3D d'une cape (canvas 2D, sans dépendance). On échantillonne le devant de la
// cape en une grille de couleurs, puis on rend un maillage de tissu : ondulation
// (vague), rotation douce autour de l'axe vertical, projection en perspective et
// éclairage directionnel (Lambert). Gère les capes animées (images empilées).
//
// Expose window.CapePreview.{ mount(canvas), setCape(dataUrl), clear() }.

(function () {
  // Géométrie (identique à src/capegeom.js, dupliquée pour le contexte navigateur).
  function frameCount(w, h) {
    if (!w || !h) return 1;
    const n = Math.round((2 * h) / w);
    return n >= 1 && Math.abs(n * (w / 2) - h) <= Math.max(1, w * 0.03) ? n : 1;
  }
  function capeFrontRect(w, h, frame) {
    // OptiFine 46×22 (planche plus étroite) -> s=w/46 ; sinon vanilla/HD -> s=w/64.
    const s = (w % 46 === 0 && w % 64 !== 0) ? w / 46 : w / 64;
    const fh = 32 * s;
    return { x: Math.round(s), y: Math.round(frame * fh + s), w: Math.round(10 * s), h: Math.round(16 * s) };
  }

  let canvas = null, ctx = null, raf = 0, t0 = 0;
  let img = null, imgW = 0, imgH = 0, frames = 1, curFrame = 0, lastSwap = 0;
  let cols = 0, rows = 0, grid = null; // grid[j*cols+i] = [r,g,b]
  let gen = 0; // génération : invalide un chargement d'image en vol après clear()/setCape()

  function mount(el) { canvas = el; ctx = canvas.getContext('2d'); }

  function clear() {
    gen++;
    cancelAnimationFrame(raf); raf = 0; img = null; grid = null;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Échantillonne le devant de la frame en grille de couleurs (résolution native, plafonnée).
  function buildGrid(frame) {
    const r = capeFrontRect(imgW, imgH, frame);
    const off = document.createElement('canvas');
    off.width = r.w; off.height = r.h;
    const o = off.getContext('2d');
    o.imageSmoothingEnabled = false;
    o.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const data = o.getImageData(0, 0, r.w, r.h).data;
    cols = Math.min(r.w, 32); rows = Math.min(r.h, 48);
    grid = new Array(cols * rows);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const sx = Math.floor((i / cols) * r.w), sy = Math.floor((j / rows) * r.h);
        const k = (sy * r.w + sx) * 4;
        grid[j * cols + i] = [data[k], data[k + 1], data[k + 2]];
      }
    }
  }

  function setCape(dataUrl) {
    clear();                 // incrémente gen
    if (!dataUrl) return;
    const myGen = gen;       // ce chargement n'est valide que tant que gen n'a pas rebougé
    const image = new Image();
    image.onload = () => {
      if (myGen !== gen) return; // un clear()/setCape() est survenu pendant le chargement -> on abandonne
      img = image; imgW = image.naturalWidth; imgH = image.naturalHeight;
      frames = frameCount(imgW, imgH); curFrame = 0; lastSwap = 0; t0 = 0;
      buildGrid(0);
      raf = requestAnimationFrame(loop);
    };
    image.onerror = () => { if (myGen === gen) clear(); };
    image.src = dataUrl;
  }

  // Position 3D d'un sommet de la grille (u,v dans [0,1]) au temps t.
  // Le tissu est fixé en haut ; l'ondulation croît vers le bas et le bord libre.
  function vertex(u, v, t) {
    const Wm = 10, Hm = 16;
    const x = (u - 0.5) * Wm;
    const y = (0.5 - v) * Hm;
    const sway = Math.sin(u * 3.0 + t * 2.0) * 0.5 + Math.sin(v * 2.3 - t * 1.6) * 0.5;
    let z = sway * 1.9 * (0.25 + 0.75 * v);
    // Rotation douce autour de l'axe vertical.
    const ang = Math.sin(t * 0.6) * 0.45;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const xr = x * ca - z * sa;
    const zr = x * sa + z * ca;
    return [xr, y, zr];
  }

  const DEPTH = 34;
  function project(p, cx, cy, unit) {
    const s = DEPTH / (DEPTH + p[2]);
    return [cx + p[0] * unit * s, cy - p[1] * unit * s, p[2]];
  }

  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  const LIGHT = norm([-0.35, 0.45, -1]);

  // --- Personnage porteur (mannequin bloc, style Minecraft) rendu DERRIÈRE la cape ---
  // On voit le dos du perso ; la cape drape le torse, tête/bras/jambes dépassent.
  let SHOW_BODY = true;
  const SKIN = [214, 176, 140], SHIRT = [56, 66, 88], PANTS = [40, 46, 60];
  // Boîtes en unités de cape (cape : x∈[-5,5], y∈[-8,8]) ; z>0 = derrière la cape (~z 0).
  const BODY = [
    { box: [-3.2, 3.2, 8, 14.2, 2.4, 8.8], col: SKIN },   // tête (au-dessus de la cape)
    { box: [-4, 4, -2, 8, 3, 7], col: SHIRT },            // torse (masqué par la cape)
    { box: [4, 6.3, -2, 8, 3, 7], col: SKIN },            // bras (dos, à droite)
    { box: [-6.3, -4, -2, 8, 3, 7], col: SKIN },          // bras (dos, à gauche)
    { box: [0.2, 3.7, -14, -2, 3, 7], col: PANTS },       // jambe droite (dépasse en bas)
    { box: [-3.7, -0.2, -14, -2, 3, 7], col: PANTS },     // jambe gauche
  ];
  const FACES = [[0, 1, 2, 3], [1, 5, 6, 2], [5, 4, 7, 6], [4, 0, 3, 7], [3, 2, 6, 7], [4, 5, 1, 0]];
  // Rotation autour de l'axe vertical, identique à celle de la cape (synchronisée).
  function rot(x, y, z, t) {
    const ang = Math.sin(t * 0.6) * 0.45;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    return [x * ca - z * sa, y, x * sa + z * ca];
  }
  function drawCharacter(t, cx, cy, unit) {
    const polys = [];
    for (const part of BODY) {
      const [x0, x1, y0, y1, z0, z1] = part.box;
      const c = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
      ].map((p) => rot(p[0], p[1], p[2], t));
      for (const f of FACES) {
        const a = c[f[0]], b = c[f[1]], d = c[f[3]];
        const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
        const n = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
        const sh = 0.55 + 0.5 * Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
        const depth = (c[f[0]][2] + c[f[1]][2] + c[f[2]][2] + c[f[3]][2]) / 4;
        polys.push({ pts: f.map((i) => project(c[i], cx, cy, unit)), col: part.col, sh, depth });
      }
    }
    polys.sort((a, b) => b.depth - a.depth);
    for (const p of polys) {
      const r = Math.min(255, p.col[0] * p.sh) | 0, g = Math.min(255, p.col[1] * p.sh) | 0, b = Math.min(255, p.col[2] * p.sh) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.beginPath(); ctx.moveTo(p.pts[0][0], p.pts[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
    }
  }

  function loop(ts) {
    if (!grid || !ctx) return;
    if (!t0) t0 = ts;
    const t = (ts - t0) / 1000;

    if (frames > 1 && ts - lastSwap > 120) { curFrame = (curFrame + 1) % frames; buildGrid(curFrame); lastSwap = ts; }

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // Avec le personnage la scène est plus haute (tête + jambes) -> on dézoome et recentre.
    const cx = W / 2, cy = SHOW_BODY ? H / 2 - 4 : H / 2 + 8;
    const unit = SHOW_BODY ? Math.min(W / 17, H / 33) : Math.min(W / 15, H / 20);

    // Sommets projetés (cols+1 x rows+1).
    const nx = cols + 1, ny = rows + 1;
    const P = new Array(nx * ny), V = new Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v3 = vertex(i / cols, j / rows, t);
        V[j * nx + i] = v3;
        P[j * nx + i] = project(v3, cx, cy, unit);
      }
    }

    // Ombre portée au sol (sous les pieds si le perso est visible, sinon sous la cape).
    const groundY = SHOW_BODY ? cy + 14 * unit * 0.86 + 6 : cy + rows * unit * 0.5 + 14;
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, groundY, unit * (SHOW_BODY ? 6.5 : cols * 0.42), 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // Le personnage est ENTIÈREMENT derrière la cape (z>0) : on le dessine d'abord, la
    // cape par-dessus le masque au niveau du torse ; tête/bras/jambes restent visibles.
    if (SHOW_BODY) drawCharacter(t, cx, cy, unit);

    // Quads triés du plus loin au plus proche (painter).
    const quads = [];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = V[j * nx + i], b = V[j * nx + i + 1], c = V[(j + 1) * nx + i + 1], d = V[(j + 1) * nx + i];
        const depth = (a[2] + b[2] + c[2] + d[2]) / 4;
        quads.push({ i, j, depth });
      }
    }
    quads.sort((q1, q2) => q2.depth - q1.depth);

    for (const q of quads) {
      const { i, j } = q;
      const A = P[j * nx + i], B = P[j * nx + i + 1], C = P[(j + 1) * nx + i + 1], D = P[(j + 1) * nx + i];
      const a = V[j * nx + i], b = V[j * nx + i + 1], d = V[(j + 1) * nx + i];
      // Normale (produit vectoriel) pour l'éclairage.
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      const n = norm([e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]);
      const diff = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
      const sh = 0.5 + 0.55 * diff;
      const col = grid[j * cols + i];
      const r = Math.min(255, col[0] * sh) | 0, g = Math.min(255, col[1] * sh) | 0, bl = Math.min(255, col[2] * sh) | 0;
      ctx.fillStyle = `rgb(${r},${g},${bl})`;
      ctx.beginPath();
      ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath();
      ctx.fill();
      // Léger contour de la même couleur pour masquer les coutures anti-alias.
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke();
    }

    raf = requestAnimationFrame(loop);
  }

  window.CapePreview = { mount, setCape, clear, frameCount, setShowBody: (b) => { SHOW_BODY = !!b; } };
})();

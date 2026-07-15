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
    const s = w / 64, fh = 32 * s;
    return { x: Math.round(s), y: Math.round(frame * fh + s), w: Math.round(10 * s), h: Math.round(16 * s) };
  }

  let canvas = null, ctx = null, raf = 0, t0 = 0;
  let img = null, imgW = 0, imgH = 0, frames = 1, curFrame = 0, lastSwap = 0;
  let cols = 0, rows = 0, grid = null; // grid[j*cols+i] = [r,g,b]

  function mount(el) { canvas = el; ctx = canvas.getContext('2d'); }

  function clear() {
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
    clear();
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => {
      img = image; imgW = image.naturalWidth; imgH = image.naturalHeight;
      frames = frameCount(imgW, imgH); curFrame = 0; lastSwap = 0; t0 = 0;
      buildGrid(0);
      raf = requestAnimationFrame(loop);
    };
    image.onerror = () => clear();
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

  function loop(ts) {
    if (!grid || !ctx) return;
    if (!t0) t0 = ts;
    const t = (ts - t0) / 1000;

    if (frames > 1 && ts - lastSwap > 120) { curFrame = (curFrame + 1) % frames; buildGrid(curFrame); lastSwap = ts; }

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 8;
    const unit = Math.min(W / 15, H / 20);

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

    // Ombre portée au sol.
    ctx.save();
    ctx.globalAlpha = 0.22; ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, cy + rows * unit * 0.5 + 14, unit * cols * 0.42, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

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

  window.CapePreview = { mount, setCape, clear, frameCount };
})();

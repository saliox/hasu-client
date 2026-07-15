'use strict';
// Prévisualisation animée d'une cape (canvas 2D, sans dépendance). Extrait le devant
// de la cape depuis la texture et l'anime comme un drapeau qui ondule, avec ombrage.
// Gère les capes animées (images empilées) en faisant défiler les frames.
//
// Expose window.CapePreview.{ mount(canvas), setCape(dataUrl), clear() }.

(function () {
  // --- Géométrie (identique à src/capegeom.js, dupliquée pour le contexte navigateur) ---
  function frameCount(w, h) {
    if (!w || !h) return 1;
    const n = Math.round((2 * h) / w);
    return n >= 1 && Math.abs(n * (w / 2) - h) <= Math.max(1, w * 0.03) ? n : 1;
  }
  function capeFrontRect(w, h, frame) {
    const s = w / 64, frameH = 32 * s;
    return { x: Math.round(s), y: Math.round(frame * frameH + s), w: Math.round(10 * s), h: Math.round(16 * s) };
  }

  let canvas = null, ctx = null, raf = 0;
  let src = null;           // canvas hors-écran contenant le devant de la cape (frame courante)
  let frames = 1, curFrame = 0, frameW = 0, frameH = 0, lastFrameSwap = 0;
  let img = null, imgW = 0, imgH = 0;
  let t0 = 0;

  function mount(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
  }

  function clear() {
    cancelAnimationFrame(raf); raf = 0; img = null; src = null;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  // Prépare le canvas source pour la frame donnée (pixel art agrandi ensuite au rendu).
  function buildFrame(frame) {
    const r = capeFrontRect(imgW, imgH, frame);
    const off = document.createElement('canvas');
    off.width = r.w; off.height = r.h;
    const octx = off.getContext('2d');
    octx.imageSmoothingEnabled = false;
    octx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    src = off; frameW = r.w; frameH = r.h;
  }

  function setCape(dataUrl) {
    clear();
    if (!dataUrl) return;
    const image = new Image();
    image.onload = () => {
      img = image; imgW = image.naturalWidth; imgH = image.naturalHeight;
      frames = frameCount(imgW, imgH); curFrame = 0; lastFrameSwap = 0;
      buildFrame(0);
      t0 = 0;
      raf = requestAnimationFrame(loop);
    };
    image.onerror = () => clear();
    image.src = dataUrl;
  }

  // Anime : rend le devant de cape colonne par colonne avec un décalage sinusoïdal
  // (ondulation) et un ombrage dépendant de la pente locale -> effet drapeau/3D léger.
  function loop(ts) {
    if (!src || !ctx) return;
    if (!t0) t0 = ts;
    const time = (ts - t0) / 1000;

    // Défilement des frames pour les capes animées (~8 fps).
    if (frames > 1 && ts - lastFrameSwap > 120) {
      curFrame = (curFrame + 1) % frames;
      buildFrame(curFrame);
      lastFrameSwap = ts;
    }

    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    // Cadre d'affichage (marge + ratio 10:16 du devant de cape).
    const pad = 16;
    const availW = W - pad * 2, availH = H - pad * 2;
    const scale = Math.min(availW / frameW, availH / frameH);
    const drawW = frameW * scale, drawH = frameH * scale;
    const ox = (W - drawW) / 2, oy = (H - drawH) / 2;

    const amp = drawW * 0.10;         // amplitude de l'onde
    const k = 2.2;                    // nombre d'ondes sur la largeur
    const speed = 2.4;

    // Ombre portée au sol.
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(W / 2, oy + drawH + 10, drawW * 0.42, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Rendu colonne par colonne (1 colonne source = 1 tranche).
    const cols = frameW;
    const colW = drawW / cols;
    for (let c = 0; c < cols; c++) {
      const u = c / (cols - 1);                                  // 0..1 sur la largeur
      const phase = u * k * Math.PI * 2 - time * speed;
      const dx = Math.sin(phase) * amp * (0.4 + 0.6 * u);        // plus d'onde vers le bord libre
      const slope = Math.cos(phase);                             // pente -> ombrage
      const shade = 0.72 + 0.28 * (slope * 0.5 + 0.5);           // 0.72..1.0

      const sx = c, sw = 1;
      const dxPos = ox + c * colW + dx;
      // Légère variation verticale pour donner du volume.
      const dyPos = oy + Math.sin(phase) * amp * 0.12;
      ctx.drawImage(src, sx, 0, sw, frameH, dxPos, dyPos, colW + 0.6, drawH);

      // Voile d'ombre par-dessus la colonne.
      if (shade < 1) {
        ctx.save();
        ctx.globalAlpha = 1 - shade;
        ctx.fillStyle = '#05070d';
        ctx.fillRect(dxPos, dyPos, colW + 0.6, drawH);
        ctx.restore();
      }
    }

    raf = requestAnimationFrame(loop);
  }

  window.CapePreview = { mount, setCape, clear, frameCount };
})();

'use strict';
// Aperçu 3D « façon Minecraft » rendu en WebGL (intégré au navigateur = toujours zéro
// dépendance). Le modèle joueur standard est texturé avec le VRAI skin du compte connecté
// (échantillonnage au plus proche = pixels nets du jeu), avec la 2e couche (chapeau, veste,
// manches, 2e couche des jambes) et la cape mappée avec les UV officielles. Perspective
// réelle + tampon de profondeur (pas de tri approximatif), éclairage doux + ombre de contact.
//
// API : window.CapePreview.{ mount(canvas), setCape(dataUrl), setSkin(dataUrl, slim),
//                            clear(), setShowBody(bool), frameCount(w,h) }

(function () {
  // ---------- État ----------
  let canvas = null, gl = null, prog = null, raf = 0, t0 = 0, gen = 0;
  let showBody = true;
  // Orbite : rotation auto (tourne-disque) ou contrôlée à la souris (glisser = tourner +
  // incliner, molette = zoomer).
  let curAngle = 0, curTilt = 0.09, curZoom = 1, lastTs = 0;
  let dragging = false, dragX0 = 0, dragY0 = 0, dragA0 = 0, dragT0 = 0;
  const clampTilt = (v) => Math.max(-0.5, Math.min(1.2, v));
  let skinImg = null, slim = false, skinTex = null, skinDirty = true;
  let capeImg = null, capeW = 0, capeH = 0, frames = 1, curFrame = 0, lastSwap = 0;
  let capeTex = null, capeGeomFrame = -1;
  let defaultSkin = null, defaultTex = null;
  let shadowTex = null, shadowBuf = null;
  let skinBuf = null, skinCount = 0, skinBufSlim = null, skinBufLegacy = false;
  let capeBuf = null, capeCount = 0;
  let attribLoc = {}, uniLoc = {};
  const SSAA = 3; // suréchantillonnage (rendu à 3× puis réduit = bords bien lisses)

  // ---------- Petite bibliothèque mat4 (colonne-major, comme WebGL) ----------
  function perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0];
  }
  function lookAt(eye, ctr, up) {
    let zx = eye[0] - ctr[0], zy = eye[1] - ctr[1], zz = eye[2] - ctr[2];
    let zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    let xl = Math.hypot(xx, xy, xz) || 1; xx /= xl; xy /= xl; xz /= xl;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return [xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1];
  }
  function rotY(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]; }
  function mul(a, b) {
    const o = new Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
    return o;
  }

  // ---------- Shaders ----------
  const VERT = `
    attribute vec3 aPos; attribute vec2 aUV; attribute vec3 aNorm;
    uniform mat4 uProj, uView, uModel;
    varying vec2 vUV; varying float vShade;
    void main() {
      gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
      vUV = aUV;
      // Ombrage plat par face, FIXÉ au modèle (comme les blocs Minecraft) : dessus le plus
      // clair, avant/arrière moyen, côtés plus sombres, dessous le plus foncé. Indépendant
      // de la caméra -> le dessus reste clair même quand on tourne le perso.
      vec3 n = aNorm;
      float ax = abs(n.x), ay = abs(n.y), az = abs(n.z);
      float s;
      if (ay >= ax && ay >= az) s = n.y > 0.0 ? 1.0 : 0.5;   // dessus / dessous
      else if (az >= ax) s = 0.86;                            // avant / arrière
      else s = 0.66;                                          // côtés gauche/droite
      vShade = s;
    }`;
  const FRAG = `
    precision mediump float;
    varying vec2 vUV; varying float vShade;
    uniform sampler2D uTex; uniform float uShadow;
    void main() {
      vec4 c = texture2D(uTex, vUV);
      if (uShadow > 0.5) { gl_FragColor = vec4(0.0, 0.0, 0.0, c.a * 0.33); return; }
      if (c.a < 0.5) discard;                       // couches transparentes -> non dessinées
      gl_FragColor = vec4(c.rgb * vShade, 1.0);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error(gl.getShaderInfoLog(s)); return null; }
    return s;
  }

  // ---------- Construction d'une boîte (positions + UV + normales) ----------
  // Repère : +X = gauche joueur (est écran), +Y = haut, +Z = avant (vers la caméra au départ).
  // Découpe UV Minecraft standard à partir de l'offset (ou,ov) dans une texture texW×texH.
  function pushBox(arr, cx, cy, cz, w, h, d, ou, ov, texW, texH, inflate, capeMode) {
    const hx = w / 2 + inflate, hy = h / 2 + inflate, hz = d / 2 + inflate;
    // Régions UV (px de texture) pour chaque face.
    let R = {
      front: [ou + d, ov + d, w, h], back: [ou + 2 * d + w, ov + d, w, h],
      right: [ou, ov + d, d, h], left: [ou + d + w, ov + d, d, h],
      top: [ou + d, ov, w, d], bottom: [ou + d + w, ov, w, d],
    };
    // Cape : la face DÉCORÉE (région avant) est tournée vers l'extérieur (-Z), l'intérieur vers +Z.
    if (capeMode) { const f = R.front; R.front = R.back; R.back = f; }
    const U = (px) => px / texW, V = (py) => 1 - py / texH; // (0,0) texture = haut-gauche
    // Chaque face : 4 coins écran [HG,HD,BD,BG] + rectangle UV + normale.
    const faces = [
      { p: [[-hx, hy, hz], [hx, hy, hz], [hx, -hy, hz], [-hx, -hy, hz]], r: R.front, n: [0, 0, 1] },
      { p: [[hx, hy, -hz], [-hx, hy, -hz], [-hx, -hy, -hz], [hx, -hy, -hz]], r: R.back, n: [0, 0, -1] },
      { p: [[-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, hz], [-hx, -hy, -hz]], r: R.right, n: [-1, 0, 0] },
      { p: [[hx, hy, hz], [hx, hy, -hz], [hx, -hy, -hz], [hx, -hy, hz]], r: R.left, n: [1, 0, 0] },
      { p: [[-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz]], r: R.top, n: [0, 1, 0] },
      { p: [[-hx, -hy, hz], [hx, -hy, hz], [hx, -hy, -hz], [-hx, -hy, -hz]], r: R.bottom, n: [0, -1, 0] },
    ];
    for (const f of faces) {
      const [ru, rv, rw, rh] = f.r;
      const uv = [[U(ru), V(rv)], [U(ru + rw), V(rv)], [U(ru + rw), V(rv + rh)], [U(ru), V(rv + rh)]];
      const q = f.p.map((p) => [p[0] + cx, p[1] + cy, p[2] + cz]);
      // 2 triangles : HG,BG,BD puis HG,BD,HD.
      const tri = [[0, 3, 2], [0, 2, 1]];
      for (const t of tri) for (const i of t) {
        arr.push(q[i][0], q[i][1], q[i][2], uv[i][0], uv[i][1], f.n[0], f.n[1], f.n[2]);
      }
    }
  }

  // ---------- Modèle joueur ----------
  function buildSkinGeom(legacy) {
    const armW = slim ? 3 : 4;
    const ax = 4 + armW / 2; // centre x des bras
    const a = [];
    // Base : tête, corps, bras, jambes.
    pushBox(a, 0, 28, 0, 8, 8, 8, 0, 0, 64, 64, 0, false);       // tête
    pushBox(a, 0, 18, 0, 8, 12, 4, 16, 16, 64, 64, 0, false);    // corps
    pushBox(a, -ax, 18, 0, armW, 12, 4, 40, 16, 64, 64, 0, false); // bras droit
    pushBox(a, -2, 6, 0, 4, 12, 4, 0, 16, 64, 64, 0, false);     // jambe droite
    if (legacy) {
      // Skin 64×32 : pas de 2e couche, membres gauches = copie des droits.
      pushBox(a, ax, 18, 0, armW, 12, 4, 40, 16, 64, 64, 0, false);
      pushBox(a, 2, 6, 0, 4, 12, 4, 0, 16, 64, 64, 0, false);
    } else {
      pushBox(a, ax, 18, 0, armW, 12, 4, slim ? 32 : 32, 48, 64, 64, 0, false); // bras gauche
      pushBox(a, 2, 6, 0, 4, 12, 4, 16, 48, 64, 64, 0, false);                  // jambe gauche
      // 2e couche (chapeau / veste / manches / 2e couche jambes), légèrement gonflée.
      pushBox(a, 0, 28, 0, 8, 8, 8, 32, 0, 64, 64, 0.6, false);   // chapeau
      pushBox(a, 0, 18, 0, 8, 12, 4, 16, 32, 64, 64, 0.3, false); // veste
      pushBox(a, -ax, 18, 0, armW, 12, 4, 40, 32, 64, 64, 0.3, false); // manche droite
      pushBox(a, ax, 18, 0, armW, 12, 4, 48, 48, 64, 64, 0.3, false);  // manche gauche
      pushBox(a, -2, 6, 0, 4, 12, 4, 0, 32, 64, 64, 0.3, false);  // 2e couche jambe droite
      pushBox(a, 2, 6, 0, 4, 12, 4, 0, 48, 64, 64, 0.3, false);   // 2e couche jambe gauche
    }
    const data = new Float32Array(a);
    if (!skinBuf) skinBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, skinBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    skinCount = data.length / 8;
    skinBufSlim = slim; skinBufLegacy = legacy;
  }

  // Géométrie de la cape (10×16×1), suspendue au dos, légèrement inclinée vers l'arrière.
  function buildCapeGeom() {
    if (!capeImg) return;
    const base = (capeW % 46 === 0 && capeW % 64 !== 0) ? 46 : 64;
    const s = capeW / base;
    const texW = base, texH = capeH / s;   // hauteur "logique" (32 par frame)
    const ov = curFrame * 32;              // frame animée -> décalage vertical
    const a = [];
    // On construit la cape à l'origine puis on l'incline autour de son bord supérieur.
    pushBox(a, 0, 0, 0, 10, 16, 1, 0, ov, texW, texH, 0, true);
    // Inclinaison ~11° autour de l'axe X passant par le haut de la cape, puis placement au dos.
    const ang = 0.19, ca = Math.cos(ang), sa = Math.sin(ang);
    const pivotY = 8;                      // haut de la cape (demi-hauteur, cape centrée en 0)
    for (let i = 0; i < a.length; i += 8) {
      let y = a[i + 1] - pivotY, z = a[i + 2];
      a[i + 1] = pivotY + (y * ca - z * sa);
      a[i + 2] = (y * sa + z * ca);
      // normales aussi
      let ny = a[i + 6], nz = a[i + 7];
      a[i + 6] = ny * ca - nz * sa; a[i + 7] = ny * sa + nz * ca;
      // placement final : accrochée aux épaules (y≈24), collée au dos (z≈-2.6)
      a[i + 1] += 16; a[i + 2] += -2.6;
    }
    const data = new Float32Array(a);
    if (!capeBuf) capeBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, capeBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    capeCount = data.length / 8;
    capeGeomFrame = curFrame;
  }

  // Ombre de contact : quad au sol (y=0) avec une texture radiale douce.
  function buildShadow() {
    const a = [];
    const s = 11;
    const quad = [[-s, 0.02, s], [s, 0.02, s], [s, 0.02, -s], [-s, 0.02, -s]];
    const uv = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const tri = [[0, 1, 2], [0, 2, 3]];
    for (const t of tri) for (const i of t) a.push(quad[i][0], quad[i][1], quad[i][2], uv[i][0], uv[i][1], 0, 1, 0);
    const data = new Float32Array(a);
    shadowBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    // Texture radiale.
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const c = cv.getContext('2d');
    const g = c.createRadialGradient(32, 32, 2, 32, 32, 30);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    shadowTex = texFromCanvas(cv);
  }

  // ---------- Textures ----------
  function texFromImage(img) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true); // (0,0) UV = haut-gauche de l'image
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function texFromCanvas(cv) { return texFromImage(cv); }

  // ---------- Skin par défaut (procédural 64×64) ----------
  function makeDefaultSkin() {
    const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
    const c = cv.getContext('2d');
    const rect = (x, y, w, h, col) => { c.fillStyle = col; c.fillRect(x, y, w, h); };
    const SKIN = '#d8b083', SKIN_D = '#c49a6c', SHIRT = '#3f7fbf', PANTS = '#3a3f57', HAIR = '#4a3526';
    rect(0, 8, 32, 8, SKIN); rect(8, 0, 16, 8, HAIR);
    rect(9, 11, 2, 2, '#fff'); rect(10, 11, 1, 2, '#3a2f6b');
    rect(13, 11, 2, 2, '#fff'); rect(13, 11, 1, 2, '#3a2f6b');
    rect(10, 14, 4, 1, SKIN_D); rect(8, 8, 16, 1, HAIR);
    rect(16, 16, 24, 16, SHIRT);
    rect(40, 16, 16, 16, SKIN); rect(40, 20, 16, 4, SHIRT);
    rect(32, 48, 16, 16, SKIN); rect(32, 52, 16, 4, SHIRT);
    rect(0, 16, 16, 16, PANTS); rect(16, 48, 16, 16, PANTS);
    return cv;
  }

  // ---------- Cape : nombre de frames animées ----------
  function frameCount(w, h) {
    if (!w || !h) return 1;
    const n = Math.round((2 * h) / w);
    return n >= 1 && Math.abs(n * (w / 2) - h) <= Math.max(1, w * 0.03) ? n : 1;
  }

  // ---------- Init WebGL ----------
  function initGL() {
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) { console.error('WebGL indisponible'); return false; }
    const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return false;
    prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error(gl.getProgramInfoLog(prog)); return false; }
    gl.useProgram(prog);
    attribLoc = { pos: gl.getAttribLocation(prog, 'aPos'), uv: gl.getAttribLocation(prog, 'aUV'), norm: gl.getAttribLocation(prog, 'aNorm') };
    uniLoc = {
      proj: gl.getUniformLocation(prog, 'uProj'), view: gl.getUniformLocation(prog, 'uView'),
      model: gl.getUniformLocation(prog, 'uModel'), tex: gl.getUniformLocation(prog, 'uTex'),
      shadow: gl.getUniformLocation(prog, 'uShadow'),
    };
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    buildShadow();
    return true;
  }

  function mount(el) {
    if (canvas === el && gl) return;
    canvas = el;
    // Suréchantillonnage : on garde la taille d'affichage (attributs d'origine) et on rend à 2×.
    if (!canvas.dataset.baseW) { canvas.dataset.baseW = canvas.width; canvas.dataset.baseH = canvas.height; }
    const bw = +canvas.dataset.baseW, bh = +canvas.dataset.baseH;
    canvas.style.width = bw + 'px'; canvas.style.height = bh + 'px';
    canvas.style.imageRendering = 'auto'; // le downscale du navigateur lisse les bords
    canvas.width = bw * SSAA; canvas.height = bh * SSAA;
    gl = null; prog = null; skinBuf = null; capeBuf = null; skinTex = null; capeTex = null; defaultTex = null;
    if (!initGL()) return;
    attachOrbit(canvas);
    skinDirty = true; capeGeomFrame = -1;
    if (skinImg || capeImg) start();
  }

  // Glisser (souris/tactile) pour faire tourner le modèle ; relâcher reprend l'auto-rotation.
  function attachOrbit(el) {
    if (el.dataset.orbit) { el.style.cursor = 'grab'; return; }
    el.dataset.orbit = '1';
    el.style.cursor = 'grab'; el.style.touchAction = 'none';
    if (!el.title) el.title = 'Glisse pour tourner';
    el.addEventListener('pointerdown', (e) => {
      dragging = true; dragX0 = e.clientX; dragY0 = e.clientY; dragA0 = curAngle; dragT0 = curTilt;
      try { el.setPointerCapture(e.pointerId); } catch {}
      el.style.cursor = 'grabbing';
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = el.getBoundingClientRect(), w = r.width || 1, h = r.height || 1;
      curAngle = dragA0 + (e.clientX - dragX0) / w * (Math.PI * 2);   // horizontal = tourner
      curTilt = clampTilt(dragT0 - (e.clientY - dragY0) / h * 1.6);   // vertical = incliner
    });
    const up = () => { if (dragging) { dragging = false; el.style.cursor = 'grab'; } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', (e) => {                            // molette = zoomer
      e.preventDefault();
      curZoom = Math.max(0.5, Math.min(2.4, curZoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    }, { passive: false });
  }

  function bindAttribs() {
    const stride = 8 * 4;
    gl.enableVertexAttribArray(attribLoc.pos); gl.vertexAttribPointer(attribLoc.pos, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(attribLoc.uv); gl.vertexAttribPointer(attribLoc.uv, 2, gl.FLOAT, false, stride, 3 * 4);
    gl.enableVertexAttribArray(attribLoc.norm); gl.vertexAttribPointer(attribLoc.norm, 3, gl.FLOAT, false, stride, 5 * 4);
  }

  function ensureTextures() {
    if (skinDirty) {
      const legacy = skinImg ? (skinImg.naturalHeight < 64) : false;
      if (skinImg) { if (skinTex) gl.deleteTexture(skinTex); skinTex = texFromImage(skinImg); }
      if (!defaultTex) { if (!defaultSkin) defaultSkin = makeDefaultSkin(); defaultTex = texFromCanvas(defaultSkin); }
      if (!skinBuf || skinBufSlim !== slim || skinBufLegacy !== legacy) buildSkinGeom(legacy);
      skinDirty = false;
    }
    if (capeImg && !capeTex) capeTex = texFromImage(capeImg);
    if (capeImg && capeGeomFrame !== curFrame) buildCapeGeom();
  }

  function loop(ts) {
    if (!gl || (!capeImg && !skinImg)) { raf = 0; return; }
    if (!t0) t0 = ts;
    const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0; lastTs = ts;
    if (!dragging) curAngle += dt * 0.6; // auto-rotation quand on ne fait pas glisser
    if (frames > 1 && ts - lastSwap > 100) { curFrame = (curFrame + 1) % frames; lastSwap = ts; if (capeImg) buildCapeGeom(); }

    ensureTextures();

    const W = canvas.width, H = canvas.height;
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const aspect = W / H;
    const ctrY = showBody ? 18 : 28;
    // FOV faible + caméra plus loin = perspective douce (proportions justes, look « aperçu de skin »).
    const dist = (showBody ? 108 : 40) / curZoom;
    // Caméra en orbite : azimut = rotation du modèle, élévation = inclinaison.
    const eye = [0, ctrY + Math.sin(curTilt) * dist, Math.cos(curTilt) * dist];
    const proj = perspective(22 * Math.PI / 180, aspect, 1, 800);
    const view = lookAt(eye, [0, ctrY, 0], [0, 1, 0]);
    const model = rotY(curAngle);
    gl.uniformMatrix4fv(uniLoc.proj, false, proj);
    gl.uniformMatrix4fv(uniLoc.view, false, view);
    gl.uniformMatrix4fv(uniLoc.model, false, model);
    gl.uniform1i(uniLoc.tex, 0); gl.activeTexture(gl.TEXTURE0);

    // 1) Ombre au sol (ne s'écrit pas dans la profondeur, tourne avec le modèle non).
    if (shadowBuf && showBody) {
      gl.uniformMatrix4fv(uniLoc.model, false, rotY(0));
      gl.uniform1f(uniLoc.shadow, 1);
      gl.depthMask(false);
      gl.bindTexture(gl.TEXTURE_2D, shadowTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf); bindAttribs();
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      gl.depthMask(true);
      gl.uniform1f(uniLoc.shadow, 0);
      gl.uniformMatrix4fv(uniLoc.model, false, model);
    }

    // 2) Corps + skin.
    if (showBody && skinCount) {
      gl.bindTexture(gl.TEXTURE_2D, skinImg ? skinTex : defaultTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, skinBuf); bindAttribs();
      gl.drawArrays(gl.TRIANGLES, 0, skinCount);
    }
    // 3) Cape.
    if (capeImg && capeCount) {
      gl.bindTexture(gl.TEXTURE_2D, capeTex);
      gl.bindBuffer(gl.ARRAY_BUFFER, capeBuf); bindAttribs();
      gl.drawArrays(gl.TRIANGLES, 0, capeCount);
    }

    raf = requestAnimationFrame(loop);
  }

  function start() { if (!raf && gl) { t0 = 0; lastTs = 0; raf = requestAnimationFrame(loop); } }

  function clear() {
    gen++; if (raf) cancelAnimationFrame(raf); raf = 0;
    capeImg = null; if (capeTex && gl) { gl.deleteTexture(capeTex); } capeTex = null; capeGeomFrame = -1;
    if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }
  }

  function setCape(dataUrl) {
    gen++; if (raf) cancelAnimationFrame(raf); raf = 0;
    if (capeTex && gl) gl.deleteTexture(capeTex);
    capeImg = null; capeTex = null; capeGeomFrame = -1;
    if (!dataUrl) { if (gl) { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); } return; }
    const myGen = gen;
    const image = new Image();
    image.onload = () => {
      if (myGen !== gen) return;
      capeImg = image; capeW = image.naturalWidth; capeH = image.naturalHeight;
      frames = frameCount(capeW, capeH); curFrame = 0; lastSwap = 0; capeGeomFrame = -1;
      start();
    };
    image.onerror = () => { if (myGen === gen) capeImg = null; };
    image.src = dataUrl;
  }

  function setSkin(dataUrl, isSlim) {
    slim = !!isSlim; skinDirty = true;
    if (!dataUrl) { skinImg = null; return; }
    const image = new Image();
    image.onload = () => { skinImg = image; skinDirty = true; start(); };
    image.onerror = () => { skinImg = null; };
    image.src = dataUrl;
  }

  function setShowBody(b) { showBody = !!b; skinDirty = true; }

  window.CapePreview = { mount, setCape, setSkin, clear, frameCount, setShowBody };
})();

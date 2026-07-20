// Encodeur GIF89a animé, autonome (aucune dépendance) — sert à exporter l'aperçu 3D
// (personnage + cape) en GIF partageable (Discord…). Fond transparent conservé.
//
// API : window.GifEncoder.encode(frames, width, height, delayCs, { loop })
//   frames   : tableau de Uint8ClampedArray/Uint8Array RGBA (width*height*4) par image
//   delayCs  : délai entre images en centièmes de seconde (ex. 5 = 20 fps)
//   -> Uint8Array (octets du GIF)
(function () {
  // --- Quantification : palette globale <= 255 couleurs + index 0 transparent ---
  // Histogramme sur 12 bits (4 bits/canal) puis on garde les buckets les plus fréquents.
  function buildPalette(frames, w, h) {
    const hist = new Uint32Array(4096);
    for (const f of frames) {
      for (let i = 0; i < w * h; i++) {
        const a = f[i * 4 + 3];
        if (a < 128) continue; // transparent -> ignoré dans la palette
        const r = f[i * 4] >> 4, g = f[i * 4 + 1] >> 4, b = f[i * 4 + 2] >> 4;
        hist[(r << 8) | (g << 4) | b]++;
      }
    }
    // buckets triés par fréquence, on prend les 255 premiers
    const used = [];
    for (let k = 0; k < 4096; k++) if (hist[k]) used.push(k);
    used.sort((a, b) => hist[b] - hist[a]);
    const chosen = used.slice(0, 255);
    // palette : index 0 réservé au transparent (noir), 1..N couleurs choisies
    const pal = [[0, 0, 0]];
    const exp = (v4) => (v4 << 4) | v4; // 4 bits -> 8 bits
    for (const k of chosen) pal.push([exp((k >> 8) & 15), exp((k >> 4) & 15), exp(k & 15)]);
    // map bucket(12 bits) -> index de palette le plus proche (précalcul)
    const map = new Uint8Array(4096);
    for (let k = 0; k < 4096; k++) {
      const r = exp((k >> 8) & 15), g = exp((k >> 4) & 15), b = exp(k & 15);
      let best = 1, bestD = Infinity;
      for (let p = 1; p < pal.length; p++) {
        const dr = r - pal[p][0], dg = g - pal[p][1], db = b - pal[p][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = p; }
      }
      map[k] = best;
    }
    return { pal, map };
  }

  // RGBA -> indices de palette (0 = transparent).
  function indexFrame(f, w, h, map) {
    const out = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (f[i * 4 + 3] < 128) { out[i] = 0; continue; }
      const r = f[i * 4] >> 4, g = f[i * 4 + 1] >> 4, b = f[i * 4 + 2] >> 4;
      out[i] = map[(r << 8) | (g << 4) | b];
    }
    return out;
  }

  // --- LZW (compression GIF) ---
  function lzwEncode(indices, minCode) {
    const clear = 1 << minCode, end = clear + 1;
    let codeSize = minCode + 1, next = end + 1;
    let dict = new Map();
    const resetDict = () => { dict = new Map(); next = end + 1; codeSize = minCode + 1; };
    const out = []; let cur = 0, curBits = 0;
    const emit = (code) => {
      cur |= code << curBits; curBits += codeSize;
      while (curBits >= 8) { out.push(cur & 0xff); cur >>= 8; curBits -= 8; }
    };
    emit(clear);
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i], key = prefix * 4096 + k;
      if (dict.has(key)) { prefix = dict.get(key); }
      else {
        emit(prefix);
        dict.set(key, next++);
        if (next > (1 << codeSize) && codeSize < 12) codeSize++;
        if (next >= 4096) { emit(clear); resetDict(); }
        prefix = k;
      }
    }
    emit(prefix); emit(end);
    if (curBits > 0) out.push(cur & 0xff);
    return out;
  }

  function encode(frames, w, h, delayCs, opts) {
    const loop = (opts && typeof opts.loop === 'number') ? opts.loop : 0; // 0 = infini
    const { pal, map } = buildPalette(frames, w, h);
    // taille de la table (puissance de 2 >= palette.length), min 2 couleurs
    let gctBits = 1; while ((1 << (gctBits + 1)) < pal.length) gctBits++;
    const gctSize = 1 << (gctBits + 1);
    const minCode = Math.max(2, gctBits + 1);

    const bytes = [];
    const push = (...b) => { for (const x of b) bytes.push(x & 0xff); };
    const pushStr = (s) => { for (let i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i)); };
    const u16 = (v) => push(v & 0xff, (v >> 8) & 0xff);

    pushStr('GIF89a');
    u16(w); u16(h);
    push(0x80 | ((gctBits) << 4) | gctBits); // GCT présente, résolution, taille
    push(0, 0); // bg color index, pixel aspect
    for (let i = 0; i < gctSize; i++) { const c = pal[i] || [0, 0, 0]; push(c[0], c[1], c[2]); }

    // Application Extension NETSCAPE2.0 (bouclage)
    push(0x21, 0xff, 0x0b); pushStr('NETSCAPE2.0'); push(0x03, 0x01); u16(loop); push(0x00);

    for (const f of frames) {
      const idx = indexFrame(f, w, h, map);
      // Graphic Control Extension : disposal=2 (restaure fond), transparence sur index 0
      push(0x21, 0xf9, 0x04, 0x09); u16(delayCs); push(0x00, 0x00);
      // Image Descriptor
      push(0x2c); u16(0); u16(0); u16(w); u16(h); push(0x00);
      push(minCode);
      const data = lzwEncode(idx, minCode);
      for (let o = 0; o < data.length; o += 255) {
        const chunk = data.slice(o, o + 255);
        push(chunk.length); for (const b of chunk) bytes.push(b);
      }
      push(0x00); // fin des sous-blocs
    }
    push(0x3b); // trailer
    return Uint8Array.from(bytes);
  }

  window.GifEncoder = { encode };
})();

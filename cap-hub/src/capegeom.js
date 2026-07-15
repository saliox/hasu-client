// Géométrie d'une texture de cape Minecraft. Sert à la fois côté app (prévisualisation)
// et aux tests. Une cape « standard » a un ratio largeur:hauteur de 2:1 (ex. 64×32,
// 128×64…). Une cape ANIMÉE (façon MinecraftCapes) empile N images de 2:1 verticalement
// (ex. 64×64 = 2 images, 64×96 = 3 images).
//
// Dans une image de largeur W, l'unité de base vaut s = W/64 : le devant de la cape
// occupe un rectangle 10×16 unités à l'offset (1,1) — dans chaque image pour une cape
// animée.

// Nombre d'images (frames) empilées. 1 = cape fixe.
export function frameCount(w, h) {
  if (!w || !h) return 1;
  const n = Math.round((2 * h) / w);          // h / (w/2)
  // On n'accepte l'animation que si la hauteur colle vraiment à un multiple entier.
  return n >= 1 && Math.abs(n * (w / 2) - h) <= Math.max(1, w * 0.03) ? n : 1;
}

export function isAnimated(w, h) {
  return frameCount(w, h) >= 2;
}

// Rectangle (en pixels) du DEVANT de la cape pour l'image `frame` (0 = première).
export function capeFrontRect(w, h, frame = 0) {
  const s = w / 64;                            // échelle
  const frameH = 32 * s;                       // hauteur d'une image (w/2)
  return {
    x: Math.round(1 * s),
    y: Math.round(frame * frameH + 1 * s),
    w: Math.round(10 * s),
    h: Math.round(16 * s),
  };
}

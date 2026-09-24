// Isometric block icons for the hotbar and inventory, drawn from the procedural textures.

import { BLOCKS, SHAPE, TINT } from '../world/blocks.js';
import { TEX_SIZE, textureToImageData } from '../world/textures.js';

const TINTS = {
  [TINT.GRASS]: [0.50, 0.76, 0.33],
  [TINT.FOLIAGE]: [0.42, 0.70, 0.27],
  [TINT.BIRCH]: [0.52, 0.68, 0.36],
  [TINT.SPRUCE]: [0.40, 0.58, 0.40],
};

function faceCanvas(textures, name, tint, shade) {
  const img = textureToImageData(textures, name, tint);
  if (shade !== 1) {
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] *= shade; img.data[i + 1] *= shade; img.data[i + 2] *= shade;
    }
  }
  const c = document.createElement('canvas');
  c.width = c.height = TEX_SIZE;
  c.getContext('2d').putImageData(img, 0, 0);
  return c;
}

export function buildIcons(textures, size = 64) {
  const icons = new Map();
  const S = TEX_SIZE;
  for (const d of BLOCKS) {
    if (!d.tex || !d.inventory) continue;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tint = TINTS[d.tint];
    if (d.shape === SHAPE.CROSS || d.shape === SHAPE.TORCH) {
      const f = faceCanvas(textures, d.tex.side, tint, 1);
      const m = size * 0.1;
      ctx.drawImage(f, m, m, size - 2 * m, size - 2 * m);
    } else {
      const k = size / 64;
      const top = faceCanvas(textures, d.tex.top, d.tint === TINT.GRASS && d.tex.top !== 'grass_top' ? null : tint, 1.0);
      const left = faceCanvas(textures, d.tex.side, tint, 0.78);
      const right = faceCanvas(textures, d.tex.side, tint, 0.6);
      const u = 1.75 * k, h = 0.875 * k;
      ctx.setTransform(u * 16 / S, -h * 16 / S, u * 16 / S, h * 16 / S, 4 * k, 18 * k);
      ctx.drawImage(top, 0, 0);
      ctx.setTransform(u * 16 / S, h * 16 / S, 0, 1.75 * k * 16 / S, 4 * k, 18 * k);
      ctx.drawImage(left, 0, 0);
      ctx.setTransform(u * 16 / S, -h * 16 / S, 0, 1.75 * k * 16 / S, 32 * k, 32 * k);
      ctx.drawImage(right, 0, 0);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    icons.set(d.id, c.toDataURL());
  }
  return icons;
}

// Flat icons for tools, weapons, food and materials from their 16x16 sprites, added to `icons`
// (item ids start at 256, so they never collide with block ids).
export function buildItemIcons(sprites, icons, size = 64) {
  const src = document.createElement('canvas');
  src.width = src.height = sprites.size;
  const sctx = src.getContext('2d');
  for (const [id, layer] of sprites.index) {
    sctx.clearRect(0, 0, sprites.size, sprites.size);
    sctx.putImageData(new ImageData(new Uint8ClampedArray(sprites.layers[layer]), sprites.size, sprites.size), 0, 0);
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const m = Math.round(size * 0.06);
    ctx.drawImage(src, m, m, size - 2 * m, size - 2 * m);
    icons.set(id, c.toDataURL());
  }
  return icons;
}

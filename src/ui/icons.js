// Isometric block icons for the hotbar and inventory, drawn from the procedural textures: every
// block as the boxes it is made of (a slab is half a cube, stairs step up, a fence is a post and
// rails, a chest shows its latch), plants and flat things (ladders, panes) as a flat picture.

import { BLOCKS, SHAPE, TINT, HAS_FRONT, MODEL_OF, MODELS_BY_NAME, BOX_SHAPES, TEXTURE_NAMES, blockBoxes } from '../world/blocks.js';
import { TEX_SIZE, textureToImageData } from '../world/textures.js';

const TINTS = {
  [TINT.GRASS]: [0.50, 0.76, 0.33],
  [TINT.FOLIAGE]: [0.42, 0.70, 0.27],
  [TINT.BIRCH]: [0.52, 0.68, 0.36],
  [TINT.SPRUCE]: [0.40, 0.58, 0.40],
};
const M = MODELS_BY_NAME;
// drawn flat, like an item
const FLAT_MODELS = new Set([M.ladder, M.pane]);
// the state each shaped block shows in its icon
const ICON_STATE = { [M.chest]: 2, [M.stairs]: 0, [M.gate]: 0, [M.trapdoor]: 0 };

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

// The boxes a block is drawn with ([x0, y0, z0, x1, y1, z1] in 1/16) and the texture name of
// each visible face: top, the west face (on the left) and the south face (on the right).
function iconBoxes(d) {
  const t = d.tex;
  const cube = (b) => ({ b, top: t.top, left: t.side, right: HAS_FRONT[d.id] ? t.front : t.side });
  if (d.shape === SHAPE.MODEL) {
    const m = MODEL_OF[d.id];
    // fences and panes join up with more of themselves to either side
    const nb = (dx, dy, dz) => (dx !== 0 && dz === 0 && (m === M.fence) ? d.id : 0);
    return blockBoxes(d.id, ICON_STATE[m] || 0, nb, () => 0, 'render').map((bx) => {
      const name = (face, fallback) => (bx.tex ? TEXTURE_NAMES[bx.tex[face]] : fallback);
      return { b: bx.b, top: name(2, t.top), left: name(1, t.side), right: name(4, t.side) };
    });
  }
  if (d.shape === SHAPE.BOXES && BOX_SHAPES[d.id]) return BOX_SHAPES[d.id].map((bx) => ({ b: bx.b, top: TEXTURE_NAMES[bx.top], left: TEXTURE_NAMES[bx.side], right: TEXTURE_NAMES[bx.side] }));
  return [cube([0, 0, 0, 16, 16, 16])];
}

export function buildIcons(textures, size = 64) {
  const icons = new Map();
  const S = TEX_SIZE;
  const cache = new Map();
  const face = (name, tint, shade) => {
    const key = name + '|' + shade + '|' + (tint ? tint.join() : '');
    let c = cache.get(key);
    if (!c) { c = faceCanvas(textures, name, tint, shade); cache.set(key, c); }
    return c;
  };
  for (const d of BLOCKS) {
    if (!d.tex || !d.inventory) continue;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const tint = TINTS[d.tint];
    if (d.shape === SHAPE.CROSS || d.shape === SHAPE.TORCH || FLAT_MODELS.has(MODEL_OF[d.id])) {
      const f = face(d.tex.side, tint, 1);
      const m = size * 0.1;
      ctx.drawImage(f, m, m, size - 2 * m, size - 2 * m);
    } else {
      // isometric: A runs east (up and right on screen), B south (down and right), D down
      const k = size / 64;
      const A = [28 * k, -14 * k], B = [28 * k, 14 * k], D = [0, 28 * k];
      const O = [4 * k, 18 * k]; // the top corner of a full block, north-west, up
      const at = (x, y, z) => [O[0] + (x / 16) * A[0] + (z / 16) * B[0] + (1 - y / 16) * D[0], O[1] + (x / 16) * A[1] + (z / 16) * B[1] + (1 - y / 16) * D[1]];
      const topTint = d.tint === TINT.GRASS && d.tex.top !== 'grass_top' ? null : tint;
      // far boxes first
      const boxes = iconBoxes(d).sort((p, q) => {
        const key = (bx) => (bx.b[2] + bx.b[5]) - (bx.b[0] + bx.b[3]) + (bx.b[1] + bx.b[4]);
        return key(p) - key(q);
      });
      for (const { b, top, left, right } of boxes) {
        const [x0, y0, z0, x1, y1, z1] = b;
        const px = (v) => (v * S) / 16;
        const draw = (img, sx, sy, sw, sh, ax, bx, e) => {
          if (sw <= 0 || sh <= 0) return;
          ctx.setTransform(ax[0] / S, ax[1] / S, bx[0] / S, bx[1] / S, e[0], e[1]);
          ctx.drawImage(img, px(sx), px(sy), px(sw), px(sh), 0, 0, px(sw), px(sh));
        };
        // top (u = x, v = z), the west side (u = z, v = down), the south side (u = x, v = down)
        draw(face(top, topTint, 1.0), x0, z0, x1 - x0, z1 - z0, A, B, at(x0, y1, z0));
        draw(face(left, tint, 0.78), z0, 16 - y1, z1 - z0, y1 - y0, B, D, at(x0, y1, z0));
        draw(face(right, tint, 0.6), x0, 16 - y1, x1 - x0, y1 - y0, A, D, at(x0, y1, z1));
      }
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

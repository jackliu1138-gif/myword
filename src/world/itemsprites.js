// 16x16 pixel-art sprites for non-block items (tools, weapons, food, materials). Used for the
// interface icons and, as a texture array, for held and dropped items in the world.

import { ITEMS, ARMOR_PIECES } from '../sim/items.js';
import { WOOL_COLORS } from './blocks.js';

const S = 16;

class Sprite {
  constructor() { this.px = new Uint8ClampedArray(S * S * 4); }
  set(x, y, c, a = 255) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= S || y >= S) return;
    const i = (y * S + x) * 4;
    this.px[i] = c[0]; this.px[i + 1] = c[1]; this.px[i + 2] = c[2]; this.px[i + 3] = a;
  }
  get(x, y) {
    if (x < 0 || y < 0 || x >= S || y >= S) return null;
    const i = (y * S + x) * 4;
    return this.px[i + 3] ? [this.px[i], this.px[i + 1], this.px[i + 2]] : null;
  }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, typeof c === 'function' ? c(x0, y0) : c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, typeof c === 'function' ? c(i, j) : c); }
  disc(cx, cy, r, c) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) this.set(x, y, typeof c === 'function' ? c(x, y) : c); }
  // dark outline around the drawn shape, like hand-made item art
  outline(c = [30, 22, 16]) {
    const copy = this.px.slice();
    const has = (x, y) => x >= 0 && y >= 0 && x < S && y < S && copy[(y * S + x) * 4 + 3] > 0;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (has(x, y)) continue;
      if (has(x + 1, y) || has(x - 1, y) || has(x, y + 1) || has(x, y - 1)) this.set(x, y, c, 230);
    }
  }
}

const shade = (c, k) => c.map((v) => Math.max(0, Math.min(255, v * k)));
// tool and armour materials: [light, dark]
const TIER = {
  wooden: [[178, 136, 78], [124, 92, 50]],
  stone: [[150, 150, 150], [98, 98, 100]],
  iron: [[226, 226, 230], [160, 160, 168]],
  golden: [[255, 226, 80], [212, 150, 30]],
  diamond: [[110, 236, 226], [40, 160, 160]],
  netherite: [[98, 88, 92], [56, 48, 52]],
  leather: [[176, 110, 66], [118, 70, 38]],
  chainmail: [[176, 176, 184], [104, 104, 112]],
};
const WOOD = [150, 108, 60], WOOD_D = [104, 74, 40];

function handle(s, x0, y0, x1, y1) {
  s.line(x0, y0, x1, y1, (x, y) => ((x + y) % 2 ? WOOD : WOOD_D));
}

const DRAW = {
  stick: (s) => { handle(s, 3, 13, 12, 4); s.outline(); },
  coal: (s) => { s.disc(8, 8.5, 4.6, (x, y) => (x + y < 13 ? [70, 70, 74] : [36, 36, 40])); s.set(6, 6, [120, 120, 126]); s.set(9, 7, [96, 96, 100]); s.outline([10, 10, 12]); },
  iron_ingot: (s) => ingot(s, [230, 230, 232], [170, 170, 176]),
  gold_ingot: (s) => ingot(s, [255, 232, 90], [210, 150, 30]),
  diamond: (s) => gem(s, [150, 250, 244], [40, 180, 180]),
  emerald: (s) => gem(s, [110, 240, 130], [20, 140, 60]),
  flint: (s) => { s.rect(5, 5, 6, 7, (i, j) => (i + j < 6 ? [86, 86, 94] : [48, 48, 54])); s.set(6, 4, [70, 70, 76]); s.set(11, 8, [52, 52, 58]); s.outline([16, 16, 18]); },
  feather: (s) => { s.line(4, 12, 11, 3, [236, 236, 230]); s.line(5, 12, 12, 4, [206, 206, 200]); s.line(4, 11, 10, 4, [250, 250, 246]); s.line(3, 14, 5, 12, [180, 170, 150]); s.outline([90, 90, 90]); },
  bone: (s) => { s.line(4, 11, 11, 4, [240, 236, 220]); s.line(5, 12, 12, 5, [214, 208, 190]); for (const [x, y] of [[3, 11], [4, 12], [11, 3], [12, 4]]) s.set(x, y, [240, 236, 220]); s.outline([110, 104, 90]); },
  gunpowder: (s) => { s.disc(8, 10, 4, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? [140, 140, 140] : [74, 74, 76])); s.disc(8, 7.5, 2.5, [90, 90, 92]); s.outline([30, 30, 30]); },
  string: (s) => { for (let x = 2; x < 14; x++) s.set(x, 8 + Math.round(Math.sin(x * 0.9) * 2.5), [236, 236, 236]); s.outline([90, 90, 90]); },
  leather: (s) => { s.rect(4, 4, 8, 8, (i, j) => ((i * 3 + j) % 4 ? [168, 96, 52] : [140, 76, 40])); s.set(4, 4, [0, 0, 0], 0); s.set(11, 11, [0, 0, 0], 0); s.outline([70, 38, 18]); },
  wheat: (s) => { for (const x of [5, 8, 11]) { s.line(x, 14, x + (x - 8) * 0 - 1, 4, [210, 176, 70]); s.rect(x - 2, 3, 2, 5, [232, 200, 92]); } s.outline([110, 84, 30]); },
  wheat_seeds: (s) => { for (const [x, y] of [[5, 9], [8, 7], [10, 10], [7, 11], [11, 6], [6, 6]]) { s.set(x, y, [120, 180, 60]); s.set(x + 1, y, [90, 140, 40]); } s.outline([40, 70, 20]); },
  bow: (s) => {
    for (let t = 0; t <= 20; t++) {
      const a = -Math.PI * 0.75 + (t / 20) * Math.PI * 0.5 * 1.0;
      void a;
    }
    // limbs: a curve from top-right to bottom-left, string straight
    const pts = [[12, 2], [13, 3], [13, 5], [12, 7], [10, 9], [8, 11], [6, 12], [4, 13], [3, 13], [2, 12]];
    for (const [x, y] of pts) { s.set(x, y, WOOD); s.set(x - 1, y, WOOD_D); }
    s.line(11, 2, 2, 11, [230, 230, 230]);
    s.outline();
  },
  arrow: (s) => {
    handle(s, 4, 11, 11, 4);
    s.rect(11, 2, 3, 2, [180, 180, 186]); s.set(12, 4, [150, 150, 156]); s.set(13, 4, [120, 120, 126]);
    for (const [x, y] of [[2, 12], [3, 13], [2, 13], [3, 12], [4, 13], [2, 11]]) s.set(x, y, [236, 236, 236]);
    s.outline();
  },
  apple: (s) => { s.disc(8, 9, 5, (x, y) => (x < 7 && y < 8 ? [240, 70, 60] : [200, 30, 30])); s.set(8, 3, WOOD_D); s.set(8, 4, WOOD_D); s.set(9, 3, [80, 160, 50]); s.set(10, 3, [80, 160, 50]); s.outline([90, 10, 10]); },
  bread: (s) => { s.rect(3, 6, 10, 6, (i, j) => (j < 2 ? [214, 158, 76] : [180, 120, 50])); s.set(3, 6, [0, 0, 0], 0); s.set(12, 6, [0, 0, 0], 0); for (const x of [5, 8, 11]) s.set(x, 7, [236, 196, 120]); s.outline([90, 56, 20]); },
  raw_beef: (s) => meat(s, [210, 60, 60], [240, 170, 160]),
  raw_porkchop: (s) => meat(s, [236, 150, 150], [250, 220, 210]),
  raw_mutton: (s) => meat(s, [200, 70, 70], [236, 200, 190]),
  raw_chicken: (s) => drumstick(s, [240, 200, 180]),
  cooked_beef: (s) => meat(s, [120, 70, 40], [170, 110, 70]),
  cooked_porkchop: (s) => meat(s, [180, 120, 80], [226, 180, 130]),
  cooked_mutton: (s) => meat(s, [140, 80, 50], [190, 140, 100]),
  cooked_chicken: (s) => drumstick(s, [200, 140, 70]),
  rotten_flesh: (s) => { meat(s, [110, 120, 60], [150, 140, 90]); s.set(6, 8, [60, 70, 30]); s.set(9, 10, [60, 70, 30]); },
};

function ingot(s, light, dark) {
  for (let y = 6; y < 11; y++) for (let x = 3 + (10 - y) - 2; x < 13 - (10 - y) + 2 && x < 14; x++) s.set(x, y, y < 8 ? light : dark);
  s.line(5, 6, 11, 6, shade(light, 1.08));
  s.outline([60, 50, 30]);
}
function gem(s, light, dark) {
  const rows = [[6, 9], [4, 11], [3, 12], [3, 12], [4, 11], [5, 10], [6, 9], [7, 8]];
  rows.forEach(([a, b], j) => { for (let x = a; x <= b; x++) s.set(x, 4 + j, (x - a < 2 || j < 2) ? light : dark); });
  s.set(6, 5, [255, 255, 255]);
  s.outline([10, 40, 40]);
}
function meat(s, flesh, fat) {
  s.disc(8, 8, 5, flesh);
  s.disc(8, 8, 5.2, (x, y) => ((x - 8) ** 2 + (y - 8) ** 2 > 16 ? fat : flesh));
  s.set(6, 7, shade(flesh, 1.2)); s.set(9, 9, shade(flesh, 0.8));
  s.outline([70, 20, 20]);
}
function drumstick(s, meatCol) {
  s.disc(7, 7, 4.2, meatCol);
  s.line(9, 10, 12, 13, [240, 236, 220]);
  s.set(13, 13, [240, 236, 220]); s.set(12, 14, [240, 236, 220]);
  s.outline([90, 50, 30]);
}

function tool(kind, material) {
  const [c, cd] = TIER[material];
  return (s) => {
    if (kind === 'sword') {
      s.line(5, 10, 12, 3, c);
      s.line(6, 10, 13, 3, cd);
      s.line(5, 9, 12, 2, shade(c, 1.1));
      s.line(3, 9, 7, 13, [70, 50, 30]); // guard
      handle(s, 2, 14, 4, 12);
    } else if (kind === 'pickaxe') {
      handle(s, 3, 13, 11, 5);
      const head = [[4, 3], [5, 2], [6, 2], [7, 2], [8, 2], [9, 3], [10, 3], [11, 4], [12, 5], [13, 6], [13, 7], [13, 8], [12, 9]];
      for (const [x, y] of head) { s.set(x, y, c); s.set(x, y + 1, cd); }
    } else if (kind === 'axe') {
      handle(s, 3, 13, 10, 6);
      s.rect(8, 2, 4, 5, (i, j) => (i < 2 ? c : cd));
      s.set(12, 3, cd); s.set(12, 4, cd); s.set(7, 3, c);
    } else if (kind === 'shovel') {
      handle(s, 3, 13, 9, 7);
      s.rect(9, 3, 4, 4, (i, j) => (i + j < 3 ? c : cd));
      s.set(13, 3, cd);
    } else if (kind === 'hoe') {
      handle(s, 3, 13, 11, 5);
      s.rect(8, 3, 4, 2, (i, j) => (j === 0 ? c : cd));
      s.set(7, 4, cd);
    }
    s.outline();
  };
}
for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond', 'netherite']) {
  for (const kind of ['sword', 'pickaxe', 'axe', 'shovel', 'hoe']) DRAW[mat + '_' + kind] = tool(kind, mat);
}

// armour: helmet, chestplate, leggings and boots as flat front views
function armor(piece, material) {
  const [c, cd] = TIER[material];
  const hi = shade(c, 1.15);
  return (s) => {
    if (piece === 'helmet') {
      s.rect(3, 4, 10, 3, (i, j) => (j === 0 ? hi : c));
      s.rect(3, 7, 2, 4, cd); s.rect(11, 7, 2, 4, cd);
    } else if (piece === 'chestplate') {
      s.rect(2, 3, 4, 3, c); s.rect(10, 3, 4, 3, c);
      s.rect(4, 5, 8, 9, (i, j) => (i === 0 || j === 0 ? hi : (i + j) % 5 === 0 ? cd : c));
      s.rect(6, 3, 4, 2, [0, 0, 0]); s.rect(6, 3, 4, 2, c);
      for (let x = 6; x < 10; x++) s.set(x, 3, [0, 0, 0]), s.px[(3 * 16 + x) * 4 + 3] = 0;
    } else if (piece === 'leggings') {
      s.rect(4, 3, 8, 3, (i, j) => (j === 0 ? hi : c));
      s.rect(4, 6, 3, 8, (i, j) => (i === 0 ? hi : c)); s.rect(9, 6, 3, 8, (i, j) => (i === 2 ? cd : c));
    } else {
      s.rect(3, 8, 3, 4, c); s.rect(10, 8, 3, 4, c);
      s.rect(2, 11, 5, 3, (i, j) => (j === 0 ? hi : cd)); s.rect(9, 11, 5, 3, (i, j) => (j === 0 ? hi : cd));
    }
    if (material === 'chainmail') for (let y = 0; y < 16; y++) for (let x = (y % 2); x < 16; x += 2) { const i = (y * 16 + x) * 4; if (s.px[i + 3]) s.set(x, y, shade(cd, 0.8)); }
    s.outline([30, 26, 24]);
  };
}
for (const mat of ['leather', 'chainmail', 'iron', 'golden', 'diamond', 'netherite']) {
  for (const piece of ARMOR_PIECES) DRAW[mat + '_' + piece] = armor(piece, mat);
}

// beds: a blanket of the bed's colour, a white pillow, wooden legs
for (const [color, hexc] of WOOL_COLORS) {
  const v = parseInt(hexc.slice(1), 16);
  const wool = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  DRAW[color + '_bed'] = (s) => {
    s.rect(1, 7, 14, 4, (i, j) => (j === 0 ? shade(wool, 1.15) : wool));
    s.rect(1, 6, 4, 2, [236, 236, 230]);
    s.rect(1, 11, 14, 1, [150, 108, 60]);
    s.rect(1, 12, 2, 2, WOOD_D); s.rect(13, 12, 2, 2, WOOD_D);
    s.outline([30, 22, 16]);
  };
}

Object.assign(DRAW, {
  flint_and_steel: (s) => {
    s.rect(3, 3, 5, 3, [200, 200, 206]); s.rect(3, 6, 2, 5, [170, 170, 176]); // the steel striker
    s.rect(9, 8, 5, 5, (i, j) => (i + j < 5 ? [86, 86, 94] : [48, 48, 54])); // the flint
    s.outline([20, 20, 22]);
  },
  netherite_scrap: (s) => { s.rect(4, 5, 8, 7, (i, j) => ((i * 3 + j * 5) % 4 ? [96, 70, 62] : [64, 46, 40])); s.set(4, 5, [0, 0, 0], 0); s.set(11, 11, [0, 0, 0], 0); s.outline([30, 20, 18]); },
  netherite_ingot: (s) => ingot(s, [100, 90, 94], [58, 50, 54]),
  quartz: (s) => { gem(s, [244, 240, 232], [196, 184, 170]); },
  blaze_rod: (s) => { s.line(4, 13, 11, 3, [255, 210, 60]); s.line(5, 13, 12, 3, [220, 150, 30]); s.set(11, 3, [255, 250, 180]); s.outline([110, 60, 10]); },
  blaze_powder: (s) => { s.disc(8, 10, 4, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? [255, 240, 120] : [240, 160, 40])); s.disc(8, 7.5, 2.4, [255, 200, 70]); s.outline([120, 60, 10]); },
  gold_nugget: (s) => { s.disc(7, 9, 2.6, [255, 226, 80]); s.disc(10, 7, 1.8, [236, 190, 50]); s.set(6, 8, [255, 250, 190]); s.outline([110, 80, 20]); },
  ender_pearl: (s) => { s.disc(8, 8, 4.6, (x, y) => (x + y < 13 ? [40, 140, 120] : [16, 80, 70])); s.disc(8, 8, 1.8, [120, 230, 200]); s.set(6, 6, [200, 255, 240]); s.outline([6, 30, 26]); },
  eye_of_ender: (s) => { s.disc(8, 8, 4.6, (x, y) => (x + y < 13 ? [110, 190, 90] : [50, 120, 60])); s.rect(7, 5, 2, 6, [20, 40, 20]); s.set(6, 6, [220, 255, 200]); s.outline([10, 30, 12]); },
});

// { key -> layer index }, and RGBA pixels for every item layer (16x16 each)
export function buildItemSprites() {
  const layers = [];
  const index = new Map();
  for (const d of ITEMS) {
    const s = new Sprite();
    (DRAW[d.key] || ((sp) => sp.rect(4, 4, 8, 8, [200, 0, 200])))(s);
    index.set(d.id, layers.length);
    layers.push(s.px);
  }
  return { size: S, layers, index };
}

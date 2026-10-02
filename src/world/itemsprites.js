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

// carpets: a rug of its wool, its far end rolled up, a fringe at the near one
for (const [color, hexc] of WOOL_COLORS) {
  const v = parseInt(hexc.slice(1), 16);
  const wool = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  DRAW[color + '_carpet'] = (s) => {
    for (let j = 0; j < 7; j++) s.rect(1 + Math.round((6 - j) * 0.5), 5 + j, 13 - Math.round((6 - j) * 0.5), 1, (i) => ((i + j) % 4 === 0 ? shade(wool, 0.86) : wool));
    s.rect(4, 3, 10, 2, (i, j) => (j === 0 ? shade(wool, 1.18) : shade(wool, 0.72)));
    for (let i = 1; i < 14; i += 2) s.set(i, 12, shade(wool, 1.25));
    s.outline([30, 22, 16]);
  };
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

// ---- chests, furnaces and building blocks
function doorItem(s, light, dark, windows) {
  s.rect(4, 1, 8, 14, (i, j) => ((i + (j >> 2)) % 3 ? light : dark));
  if (windows) { s.rect(5, 3, 2, 3, [0, 0, 0]); s.rect(9, 3, 2, 3, [0, 0, 0]); for (let j = 3; j < 6; j++) { s.set(5, j, [0, 0, 0], 0); s.set(6, j, [0, 0, 0], 0); s.set(9, j, [0, 0, 0], 0); s.set(10, j, [0, 0, 0], 0); } }
  s.set(10, 9, [60, 60, 64]); s.set(10, 10, [60, 60, 64]);
  s.outline(shade(dark, 0.45));
}
function bucket(s, fill) {
  const steel = [200, 200, 206], steelD = [140, 140, 148];
  for (let y = 4; y <= 13; y++) {
    const w = 5 - Math.floor((y - 4) / 4);
    for (let x = 8 - w; x < 8 + w; x++) s.set(x, y, x < 8 - w + 2 ? steel : steelD);
  }
  s.rect(3, 3, 10, 2, steel);
  if (fill) s.rect(4, 3, 8, 2, fill);
  s.line(3, 3, 5, 1, steelD); s.line(12, 3, 10, 1, steelD); s.line(5, 1, 10, 1, steelD);
  s.outline([40, 40, 44]);
}
Object.assign(DRAW, {
  oak_door: (s) => doorItem(s, [184, 148, 92], [140, 108, 62], true),
  birch_door: (s) => doorItem(s, [216, 200, 148], [180, 160, 110], true),
  spruce_door: (s) => doorItem(s, [120, 90, 56], [86, 62, 36], false),
  oak_sign: (s) => { s.rect(2, 3, 12, 7, (i, j) => (j % 3 === 2 ? [150, 118, 70] : [184, 148, 92])); s.rect(7, 10, 2, 5, WOOD_D); for (const y of [5, 7]) s.line(4, y, 11, y, [90, 70, 40]); s.outline([60, 44, 24]); },
  bucket: (s) => bucket(s, null),
  water_bucket: (s) => bucket(s, [60, 110, 220]),
  lava_bucket: (s) => bucket(s, [240, 120, 30]),
  milk_bucket: (s) => bucket(s, [248, 248, 244]),
  charcoal: (s) => { s.disc(8, 8.5, 4.6, (x, y) => (x + y < 13 ? [74, 60, 50] : [40, 32, 26])); s.set(6, 6, [120, 100, 84]); s.set(9, 7, [96, 80, 66]); s.outline([14, 10, 8]); },
  raw_iron: (s) => { s.disc(8, 8.5, 4.4, (x, y) => ((x * 5 + y * 3) % 4 ? [200, 170, 150] : [150, 118, 100])); s.set(6, 6, [236, 214, 200]); s.outline([70, 52, 40]); },
  raw_gold: (s) => { s.disc(8, 8.5, 4.4, (x, y) => ((x * 5 + y * 3) % 4 ? [240, 200, 70] : [190, 140, 30])); s.set(6, 6, [255, 240, 160]); s.outline([100, 70, 10]); },
  clay_ball: (s) => { s.disc(8, 8.5, 4, (x, y) => (x + y < 14 ? [176, 182, 196] : [136, 142, 158])); s.set(6, 6, [214, 218, 228]); s.outline([70, 74, 86]); },
  brick: (s) => { s.rect(2, 6, 12, 5, (i, j) => (j === 0 || i === 0 ? [196, 104, 76] : [160, 74, 52])); s.outline([80, 34, 22]); },
  nether_brick: (s) => { s.rect(2, 6, 12, 5, (i, j) => (j === 0 || i === 0 ? [96, 44, 52] : [64, 28, 34])); s.outline([24, 10, 14]); },
  bone_meal: (s) => { s.disc(8, 10, 4, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? [214, 214, 206] : [244, 244, 236])); s.disc(8, 7.5, 2.4, [236, 236, 228]); s.outline([120, 120, 110]); },
});

// ---- food, brewing, creatures' drops, gear and getting about
function fish(s, body, belly, fin, stripes = null) {
  for (let x = 3; x <= 11; x++) {
    const h = Math.round(Math.sin(((x - 3) / 8) * Math.PI) * 3.2) + 1;
    for (let y = 8 - h; y <= 8 + h - 1; y++) s.set(x, y, y > 8 ? belly : stripes && (x % 3 === 0) ? stripes : body);
  }
  s.rect(12, 6, 1, 4, fin); s.rect(13, 5, 1, 2, fin); s.rect(13, 9, 1, 2, fin);
  s.set(5, 7, [20, 20, 20]);
  s.outline(shade(body, 0.35));
}
function bottle(s, fill, splash) {
  const glass = [214, 230, 240];
  const liquid = fill || [196, 214, 226];
  if (splash) { s.rect(5, 5, 6, 1, glass); s.rect(4, 6, 8, 7, liquid); s.rect(5, 13, 6, 1, liquid); }
  else { s.rect(4, 7, 8, 6, liquid); s.rect(5, 13, 6, 1, liquid); s.rect(6, 5, 4, 2, fill ? liquid : glass); }
  s.rect(7, 2, 2, 3, glass);
  s.rect(6, 1, 4, 1, [150, 110, 70]);
  s.set(5, 8, shade(liquid, 1.5));
  s.outline([40, 48, 60]);
}
function egg(s, c1, c2) {
  const a = [(c1 >> 16) & 255, (c1 >> 8) & 255, c1 & 255], b = [(c2 >> 16) & 255, (c2 >> 8) & 255, c2 & 255];
  for (let y = 2; y <= 13; y++) {
    const r = y < 7 ? 1.5 + (y - 2) * 0.7 : 5 - Math.max(0, y - 10) * 0.9;
    for (let x = Math.ceil(8 - r); x <= Math.floor(8 + r - 0.5); x++) s.set(x, y, ((x * 5 + y * 7) % 11 < 3) ? b : a);
  }
  s.set(6, 4, shade(a, 1.3));
  s.outline(shade(a, 0.3));
}
const GOLD = [255, 220, 70], GOLD_D = [200, 140, 20];
Object.assign(DRAW, {
  raw_cod: (s) => fish(s, [190, 160, 110], [220, 200, 160], [160, 130, 90]),
  cooked_cod: (s) => fish(s, [170, 120, 70], [210, 170, 110], [140, 90, 50]),
  raw_salmon: (s) => fish(s, [200, 70, 60], [240, 150, 130], [60, 110, 100]),
  cooked_salmon: (s) => fish(s, [170, 90, 60], [220, 150, 110], [120, 70, 40]),
  tropical_fish: (s) => fish(s, [240, 120, 30], [255, 240, 230], [255, 255, 255], [255, 250, 240]),
  pufferfish: (s) => { s.disc(8, 8, 4.5, (x, y) => (y > 9 ? [250, 240, 200] : [240, 200, 40])); for (const [x, y] of [[3, 5], [13, 5], [3, 11], [13, 11], [8, 2], [8, 14]]) s.set(x, y, [250, 250, 230]); s.set(6, 7, [20, 20, 20]); s.set(10, 7, [20, 20, 20]); s.outline([90, 70, 10]); },
  carrot: (s) => { s.line(5, 13, 10, 5, [240, 130, 30]); s.line(6, 13, 11, 5, [210, 100, 20]); s.line(5, 12, 9, 5, [255, 160, 60]); s.rect(10, 2, 2, 3, [80, 170, 50]); s.set(12, 3, [60, 140, 40]); s.outline([110, 50, 10]); },
  golden_carrot: (s) => { s.line(5, 13, 10, 5, GOLD); s.line(6, 13, 11, 5, GOLD_D); s.line(5, 12, 9, 5, [255, 245, 170]); s.rect(10, 2, 2, 3, [250, 230, 90]); s.outline([110, 80, 10]); },
  potato: (s) => { s.disc(8, 8.5, 4.2, (x, y) => (x + y < 14 ? [214, 180, 110] : [180, 144, 80])); s.set(7, 7, [150, 120, 60]); s.set(10, 10, [150, 120, 60]); s.outline([90, 66, 30]); },
  baked_potato: (s) => { s.disc(8, 8.5, 4.2, (x, y) => (x + y < 14 ? [226, 170, 80] : [180, 110, 40])); s.set(7, 6, [255, 230, 150]); s.outline([90, 50, 20]); },
  melon_slice: (s) => { for (let y = 4; y <= 12; y++) for (let x = 3; x <= 13; x++) { const d = Math.hypot(x - 8, y - 13); if (d < 9 && y < 13) s.set(x, y, d > 8 ? [60, 150, 40] : d > 7 ? [220, 230, 170] : (x * 3 + y) % 7 === 0 ? [30, 20, 20] : [230, 60, 60]); } s.outline([90, 30, 20]); },
  glistering_melon_slice: (s) => { DRAW.melon_slice(s); for (const [x, y] of [[6, 8], [9, 7], [11, 10], [5, 11]]) s.set(x, y, [255, 240, 120]); },
  golden_apple: (s) => { s.disc(8, 9, 5, (x, y) => (x < 7 && y < 8 ? [255, 240, 120] : [230, 180, 40])); s.set(8, 3, WOOD_D); s.set(8, 4, WOOD_D); s.set(9, 3, [80, 160, 50]); s.outline([110, 80, 10]); },
  spider_eye: (s) => { s.disc(8, 8.5, 4.4, (x, y) => (x + y < 14 ? [200, 60, 90] : [150, 30, 60])); s.disc(8, 8, 1.6, [40, 10, 20]); s.set(6, 6, [255, 190, 210]); s.outline([70, 10, 30]); },
  fermented_spider_eye: (s) => { DRAW.spider_eye(s); s.rect(5, 3, 6, 2, [140, 100, 70]); s.set(10, 11, [120, 160, 90]); },
  cookie: (s) => { s.disc(8, 8.5, 4.6, (x, y) => ((x * 5 + y * 3) % 7 === 0 ? [80, 40, 20] : [210, 150, 80])); s.outline([100, 60, 20]); },
  pumpkin_pie: (s) => { s.rect(2, 7, 12, 5, (i, j) => (j === 0 ? [240, 160, 60] : j === 4 ? [170, 110, 50] : [220, 130, 40])); s.rect(3, 6, 10, 1, [250, 200, 120]); s.outline([100, 50, 10]); },
  nether_wart: (s) => { for (const [x, y] of [[5, 6], [8, 4], [11, 6], [6, 10], [10, 10], [8, 8]]) s.disc(x, y, 1.6, [160, 30, 40]); s.line(8, 9, 8, 14, [100, 30, 30]); s.outline([60, 10, 14]); },
  paper: (s) => { s.rect(3, 2, 10, 12, (i, j) => (j % 3 === 1 && i > 1 && i < 8 ? [200, 200, 190] : [244, 244, 236])); s.outline([120, 120, 110]); },
  book: (s) => { s.rect(3, 2, 10, 12, (i, j) => (i < 2 ? [110, 40, 30] : j === 0 || j === 11 ? [236, 230, 210] : [150, 60, 40])); s.rect(11, 3, 1, 10, [236, 230, 210]); s.outline([60, 20, 14]); },
  sugar: (s) => { s.disc(8, 10, 4, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? [220, 220, 230] : [250, 250, 252])); s.disc(8, 7.5, 2.4, [240, 240, 246]); s.outline([140, 140, 150]); },
  ink_sac: (s) => { s.disc(8, 9, 4.4, (x, y) => (x + y < 14 ? [50, 50, 70] : [24, 24, 34])); s.rect(7, 3, 2, 3, [40, 40, 56]); s.set(6, 7, [110, 110, 140]); s.outline([8, 8, 12]); },
  slime_ball: (s) => { s.disc(8, 8.5, 4.4, (x, y) => (x + y < 13 ? [140, 220, 110] : [90, 170, 70])); s.set(6, 6, [220, 255, 210]); s.outline([40, 90, 30]); },
  magma_cream: (s) => { s.disc(8, 8.5, 4.4, (x, y) => ((x * 3 + y * 5) % 6 === 0 ? [255, 220, 60] : x + y < 13 ? [200, 90, 30] : [140, 50, 20])); s.outline([60, 20, 6]); },
  ghast_tear: (s) => { for (let y = 3; y <= 13; y++) { const r = y < 8 ? (y - 3) * 0.6 : 3.4 - (y - 8) * 0.45; for (let x = Math.ceil(8 - r); x <= Math.floor(8 + r); x++) s.set(x, y, x < 8 ? [230, 250, 255] : [180, 220, 236]); } s.outline([90, 120, 140]); },
  glowstone_dust: (s) => { s.disc(8, 10, 4, (x, y) => ((x * 7 + y * 3) % 5 === 0 ? [255, 250, 180] : [240, 200, 90])); s.disc(8, 7.5, 2.4, [255, 230, 130]); s.outline([120, 90, 20]); },
  glass_bottle: (s) => bottle(s, null, false),
  lapis_lazuli: (s) => gem(s, [80, 120, 230], [30, 50, 150]),
  prismarine_shard: (s) => { s.line(4, 12, 11, 3, [110, 190, 170]); s.line(5, 12, 12, 4, [70, 150, 130]); s.line(6, 12, 12, 6, [60, 130, 110]); s.outline([20, 60, 50]); },
  prismarine_crystals: (s) => { for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [6, 12]]) { s.rect(x, y, 2, 2, [200, 240, 230]); s.set(x + 1, y + 1, [120, 200, 190]); } s.outline([40, 90, 80]); },
  phantom_membrane: (s) => { for (let y = 3; y <= 12; y++) for (let x = 3 + Math.max(0, y - 9); x <= 12 - Math.max(0, 6 - y); x++) s.set(x, y, (x + y) % 4 ? [200, 196, 170] : [170, 160, 140]); s.outline([90, 80, 70]); },
  shulker_shell: (s) => { s.rect(3, 4, 10, 8, (i, j) => (j < 2 ? [170, 120, 170] : j > 5 ? [120, 80, 120] : [150, 100, 150])); s.rect(3, 7, 10, 1, [90, 60, 90]); s.outline([50, 30, 50]); },
  nether_star: (s) => { for (let i = -5; i <= 5; i++) { s.set(8 + i, 8, [250, 250, 230]); s.set(8, 8 + i, [250, 250, 230]); } for (let i = -3; i <= 3; i++) { s.set(8 + i, 8 + i, [230, 230, 200]); s.set(8 + i, 8 - i, [230, 230, 200]); } s.disc(8, 8, 1.6, [255, 255, 255]); s.outline([120, 120, 90]); },
  totem_of_undying: (s) => { s.rect(6, 2, 4, 4, GOLD); s.set(7, 3, [40, 160, 60]); s.set(8, 3, [40, 160, 60]); s.rect(4, 6, 8, 3, GOLD_D); s.rect(6, 9, 4, 5, GOLD); s.set(7, 12, [40, 160, 60]); s.outline([110, 70, 10]); },
  saddle: (s) => { s.rect(3, 5, 10, 5, (i, j) => (j === 0 ? [150, 90, 50] : [120, 70, 36])); s.rect(5, 4, 6, 1, [170, 110, 60]); s.rect(4, 10, 2, 4, [90, 90, 96]); s.rect(10, 10, 2, 4, [90, 90, 96]); s.outline([50, 28, 14]); },
  shears: (s) => { s.line(4, 3, 9, 8, [220, 220, 226]); s.line(12, 3, 7, 8, [180, 180, 188]); s.disc(5, 11, 2, [180, 50, 40]); s.disc(11, 11, 2, [180, 50, 40]); s.set(5, 11, [0, 0, 0], 0); s.set(11, 11, [0, 0, 0], 0); s.outline([40, 40, 44]); },
  fishing_rod: (s) => { handle(s, 2, 14, 12, 2); s.line(13, 2, 13, 12, [230, 230, 230]); s.set(13, 13, [200, 60, 50]); s.set(12, 13, [200, 60, 50]); s.outline(); },
  crossbow: (s) => { handle(s, 4, 12, 12, 4); s.line(3, 7, 9, 13, WOOD_D); s.line(3, 6, 10, 13, [120, 120, 126]); s.line(4, 6, 10, 12, [230, 230, 230]); s.rect(11, 3, 2, 2, [150, 150, 156]); s.outline(); },
  shield: (s) => { s.rect(3, 2, 10, 9, (i, j) => (i === 0 || i === 9 || j === 0 ? [150, 150, 156] : (i + j) % 5 === 0 ? [150, 110, 60] : [176, 130, 76])); for (let y = 11; y <= 13; y++) s.rect(3 + (y - 10), y, 10 - 2 * (y - 10), 1, [176, 130, 76]); s.rect(7, 4, 2, 6, [110, 110, 116]); s.outline([40, 30, 20]); },
  elytra: (s) => { for (let y = 2; y <= 14; y++) { const w = Math.round(2 + Math.sin(((y - 2) / 12) * Math.PI) * 3); s.rect(7 - w, y, w, 1, (i) => (i % 2 ? [150, 150, 170] : [180, 180, 200])); s.rect(9, y, w, 1, (i) => (i % 2 ? [150, 150, 170] : [180, 180, 200])); } s.rect(7, 2, 2, 3, [110, 110, 130]); s.outline([60, 60, 80]); },
  firework_rocket: (s) => { s.rect(6, 4, 4, 8, (i, j) => (j % 3 === 0 ? [200, 50, 40] : [236, 236, 230])); s.rect(7, 1, 2, 3, [80, 80, 86]); s.line(8, 12, 8, 15, WOOD_D); s.set(7, 2, [255, 200, 60]); s.outline([50, 30, 30]); },
  oak_boat: (s) => { for (let y = 7; y <= 11; y++) s.rect(1 + (y - 7), y, 14 - 2 * (y - 7), 1, (i) => (y === 7 ? [200, 160, 100] : i % 4 === 0 ? [140, 104, 60] : [176, 136, 82])); s.rect(6, 5, 1, 2, WOOD_D); s.outline([60, 40, 20]); },
  // a silver disc with a glass dome and a ring of lights
  flying_saucer: (s) => {
    s.disc(8, 6.6, 3.2, [150, 205, 240]);
    s.disc(7.2, 5.6, 1.1, [225, 245, 255]);
    s.rect(1, 9, 14, 2, (i, j) => (j === 0 ? [222, 226, 234] : [160, 166, 178]));
    s.rect(3, 8, 10, 1, [196, 200, 210]);
    s.rect(4, 11, 8, 1, [110, 116, 128]);
    s.rect(6, 12, 4, 1, [90, 220, 255]);
    for (const [x, c] of [[2, [255, 80, 90]], [5, [255, 220, 80]], [8, [90, 240, 140]], [11, [110, 170, 255]], [13, [255, 120, 220]]]) s.rect(x, 10, 1, 1, c);
    s.outline([36, 40, 52]);
  },
  // an F-22 seen from above: its diamond wings and stabilators, the gold canopy, two tails
  f22_raptor: (s) => {
    const G = [138, 146, 156], D = [104, 111, 121], E = [158, 165, 174];
    const rows = [[1, 7, 8], [2, 7, 8], [3, 6, 9], [4, 6, 9], [5, 5, 10], [6, 5, 10], [7, 4, 11], [8, 3, 12], [9, 2, 13], [10, 1, 14], [11, 2, 13], [12, 4, 11], [13, 3, 12], [14, 5, 10]];
    for (const [y, a, b] of rows) s.rect(a, y, b - a + 1, 1, (i) => (a + i === 7 || a + i === 8 ? G : i === 0 || a + i === b ? E : D));
    s.rect(7, 3, 2, 2, [220, 176, 72]);
    s.set(7, 3, [244, 214, 120]);
    for (const [x, y] of [[5, 12], [10, 12], [5, 13], [10, 13]]) s.set(x, y, [70, 75, 84]);
    s.rect(6, 14, 4, 1, (i) => (i === 1 || i === 2 ? [70, 74, 80] : [52, 52, 56]));
    s.outline([30, 34, 40]);
  },
  minecart: (s) => { s.rect(2, 5, 12, 6, (i, j) => (j === 0 || i === 0 || i === 11 ? [170, 170, 176] : [110, 110, 116])); s.rect(3, 6, 10, 2, [70, 70, 76]); s.disc(4.5, 12, 1.6, [60, 60, 64]); s.disc(11.5, 12, 1.6, [60, 60, 64]); s.outline([30, 30, 34]); },
  iron_door: (s) => doorItem(s, [214, 214, 218], [170, 170, 176], true),
});

// { key -> layer index }, and RGBA pixels for every item layer (16x16 each)
export function buildItemSprites() {
  const layers = [];
  const index = new Map();
  for (const d of ITEMS) {
    const s = new Sprite();
    if (d.kind === 'potion' || d.kind === 'splash') bottle(s, d.potion === 'water' ? [60, 110, 220] : d.color, d.kind === 'splash');
    else if (d.kind === 'egg') egg(s, d.colors[0], d.colors[1]);
    else (DRAW[d.key] || ((sp) => sp.rect(4, 4, 8, 8, [200, 0, 200])))(s);
    index.set(d.id, layers.length);
    layers.push(s.px);
  }
  return { size: S, layers, index };
}

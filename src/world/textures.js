// Procedural pixel-art textures with PBR companion maps.
// Every texture produces: albedo (sRGB RGBA), height, roughness, metalness and emission.
// Normal and cavity-AO maps are derived from height. Everything tiles seamlessly.

import { hash2, hash3, mulberry32 } from './noise.js';
import { TEXTURE_NAMES, WOOL_COLORS } from './blocks.js';

export const TEX_SIZE = 16;
const S = TEX_SIZE;

// ---------- helpers ----------
function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function mixc(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}
function scalec(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function ramp(stops, t) {
  // stops: [[t, color], ...] sorted
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      return mixc(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return stops[stops.length - 1][1];
}
function strSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrap = (i, p) => ((i % p) + p) % p;

// Tileable value noise; (x, y) in lattice cells, period p cells.
function vnoise(x, y, p, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(wrap(x0, p), wrap(y0, p), seed);
  const b = hash2(wrap(x0 + 1, p), wrap(y0, p), seed);
  const c = hash2(wrap(x0, p), wrap(y0 + 1, p), seed);
  const d = hash2(wrap(x0 + 1, p), wrap(y0 + 1, p), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// Tileable fbm over the texture: u,v in [0,1), base period in cells.
function tfbm(u, v, period, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u * p, v * p, p, seed + o * 1013) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}
// Per-pixel white noise
function pnoise(x, y, seed) {
  return hash2(wrap(x, S), wrap(y, S), seed);
}

// Tileable Voronoi with `n` jittered cells per axis. Returns nearest id, F1, F2 (in pixels).
function voronoi(px, py, n, seed, jitter = 0.8) {
  const cell = S / n;
  const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
  let f1 = 1e9, f2 = 1e9, id = 0, fx = 0, fy = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = wrap(gx, n), wy = wrap(gy, n);
      const ox = (0.5 + (hash2(wx, wy, seed) - 0.5) * jitter) * cell;
      const oy = (0.5 + (hash2(wx, wy, seed + 77) - 0.5) * jitter) * cell;
      const fpx = gx * cell + ox, fpy = gy * cell + oy;
      const dx = px + 0.5 - fpx, dy = py + 0.5 - fpy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = wy * n + wx; fx = fpx; fy = fpy; }
      else if (d < f2) f2 = d;
    }
  }
  return { id, f1, f2, fx, fy };
}

class Tex {
  constructor(name) {
    this.name = name;
    this.albedo = new Float32Array(S * S * 4); // 0..255 sRGB + alpha 0..1
    this.height = new Float32Array(S * S).fill(0.5);
    this.rough = new Float32Array(S * S).fill(0.85);
    this.metal = new Float32Array(S * S);
    this.emit = new Float32Array(S * S);
    this.normalStrength = 1.0;
    this.cutout = false;
    this.seed = strSeed(name);
  }
  set(x, y, c, a = 1) {
    const i = (y * S + x) * 4;
    this.albedo[i] = c[0]; this.albedo[i + 1] = c[1]; this.albedo[i + 2] = c[2]; this.albedo[i + 3] = a;
  }
  get(x, y) {
    const i = (wrap(y, S) * S + wrap(x, S)) * 4;
    return [this.albedo[i], this.albedo[i + 1], this.albedo[i + 2], this.albedo[i + 3]];
  }
  each(fn) {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) fn(x, y, y * S + x);
  }
}

// ---------- base generators ----------
function stoneLike(t, opt = {}) {
  const seed = opt.seed ?? t.seed;
  const base = opt.base ?? [125, 125, 125];
  const contrast = opt.contrast ?? 1;
  t.each((x, y, i) => {
    const u = x / S, v = y / S;
    let n = tfbm(u, v, 4, 3, seed) * 0.7 + pnoise(x, y, seed + 5) * 0.3;
    const streak = tfbm(u * 1.0, v, 2, 2, seed + 9);
    n = n * 0.85 + streak * 0.15;
    // quantize for a pixel-art look
    const q = Math.round((n - 0.5) * 6 * contrast) / 6;
    const c = scalec(base, 1 + q * 0.35);
    t.set(x, y, c);
    t.height[i] = clamp01(0.5 + q * 0.6);
    t.rough[i] = opt.rough ?? 0.82;
  });
  t.normalStrength = opt.normal ?? 1.2;
}

function dirtLike(t, base = [134, 96, 67]) {
  t.each((x, y, i) => {
    const u = x / S, v = y / S;
    const n = tfbm(u, v, 4, 3, t.seed) * 0.6 + pnoise(x, y, t.seed + 1) * 0.4;
    let c = scalec(base, 0.78 + n * 0.42);
    const peb = pnoise(x, y, t.seed + 3);
    if (peb > 0.93) c = mixc(c, [140, 128, 118], 0.6);
    else if (peb < 0.05) c = scalec(c, 0.75);
    t.set(x, y, c);
    t.height[i] = clamp01(n * 0.8 + (peb > 0.93 ? 0.3 : 0));
    t.rough[i] = 0.95;
  });
  t.normalStrength = 1.4;
}

function grassTopGray(t) {
  t.each((x, y, i) => {
    const u = x / S, v = y / S;
    const n = pnoise(x, y, t.seed) * 0.6 + tfbm(u, v, 4, 2, t.seed + 2) * 0.4;
    const g = 150 + (n - 0.5) * 90;
    t.set(x, y, [g, g, g], 1);
    t.height[i] = n;
    t.rough[i] = 0.75;
  });
  t.normalStrength = 1.0;
}

function planks(t, pal) {
  // four boards, each 4 px tall, with staggered seams
  t.each((x, y, i) => {
    const board = Math.floor(y / 4);
    const yy = y % 4;
    const seamX = [3, 11, 7, 14][board];
    const grain = tfbm((x + board * 5) / S, y / S * 0.25, 2, 3, t.seed + board) * 0.6 + pnoise(x, y, t.seed) * 0.2;
    const streak = Math.sin((x + hash2(board, 0, t.seed) * 16) * 0.9 + grain * 4) * 0.5 + 0.5;
    let c = mixc(pal.dark, pal.light, clamp01(grain * 0.9 + streak * 0.25));
    let h = 0.65 + grain * 0.2;
    if (yy === 3) { c = pal.seam; h = 0.1; }
    else if (x === seamX) { c = mixc(c, pal.seam, 0.7); h = 0.25; }
    else if (yy === 0) { c = scalec(c, 1.06); }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = 0.72;
  });
  t.normalStrength = 1.6;
}

function bark(t, pal, opt = {}) {
  t.each((x, y, i) => {
    const u = x / S, v = y / S;
    const col = tfbm(u, v * 0.125, 8, 2, t.seed);
    const fine = pnoise(x, y, t.seed + 4);
    let groove = Math.abs(Math.sin((x + col * 3.0) * 1.35));
    let c = mixc(pal.dark, pal.light, clamp01(groove * 0.8 + fine * 0.25));
    let h = groove * 0.7 + fine * 0.2;
    if (groove < 0.25) { c = pal.groove; h = 0.05; }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = 0.9;
  });
  t.normalStrength = opt.normal ?? 2.0;
}

function logTop(t, pal) {
  const c0 = (S - 1) / 2;
  t.each((x, y, i) => {
    const dx = x - c0, dy = y - c0;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    const r = Math.sqrt(dx * dx + dy * dy) + pnoise(x, y, t.seed) * 0.6;
    let c, h;
    if (edge > c0 - 1) { c = pal.bark; h = 0.4; }
    else {
      const ring = Math.floor(r * 0.9) % 2;
      c = ring ? pal.ringDark : pal.ringLight;
      if (r < 1.2) c = pal.ringDark;
      h = ring ? 0.45 : 0.6;
    }
    t.set(x, y, scalec(c, 0.95 + pnoise(x, y, t.seed + 1) * 0.1));
    t.height[i] = h;
    t.rough[i] = 0.8;
  });
  t.normalStrength = 1.2;
}

function leaves(t, opt = {}) {
  const density = opt.density ?? 0.8;
  const cells = opt.cells ?? 5;
  t.each((x, y, i) => {
    // individual leaves are Voronoi cells: lit centres, darker rims, gaps between some of them
    const vo = voronoi(x, y, cells, t.seed, 1.0);
    const edge = vo.f2 - vo.f1;
    const shade = hash2(vo.id, 5, t.seed);
    const px = pnoise(x, y, t.seed + 7);
    const clump = tfbm(x / S, y / S, 2, 2, t.seed + 3);
    const gap = edge < 0.9 && px < (1 - density) * 1.9 + (0.5 - clump) * 0.5;
    let g = 92 + shade * 58 + Math.min(edge, 2.5) * 16 + (px - 0.5) * 16 + (clump - 0.5) * 40;
    if (edge < 0.7) g *= 0.72;
    t.set(x, y, [g, g, g], gap ? 0 : 1);
    t.height[i] = Math.min(1, 0.3 + Math.min(edge, 2) * 0.3);
    t.rough[i] = 0.5;
  });
  t.cutout = true;
  t.normalStrength = 1.6;
}

function cobble(t, pal, opt = {}) {
  t.each((x, y, i) => {
    const vo = voronoi(x, y, 4, t.seed, 0.9);
    const edge = vo.f2 - vo.f1;
    const shade = hash2(vo.id, 3, t.seed);
    // light from the top-left of each stone
    const dx = x + 0.5 - vo.fx, dy = y + 0.5 - vo.fy;
    const bevel = clamp01(0.5 - (dx + dy) * 0.08);
    let c = scalec(pal.stone, 0.72 + shade * 0.45 + bevel * 0.2 + (pnoise(x, y, t.seed) - 0.5) * 0.1);
    let h = clamp01(0.35 + Math.min(edge, 3) * 0.2 - vo.f1 * 0.03);
    if (edge < 1.0) { c = pal.mortar; h = 0.0; }
    if (opt.moss) {
      const m = tfbm(x / S, y / S, 4, 2, t.seed + 99);
      if (m > 0.55 && (edge < 1.6 || m > 0.68)) {
        c = mixc(pal.moss, pal.mossLight, pnoise(x, y, t.seed + 8));
        h += 0.05;
      }
    }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = 0.9;
  });
  t.normalStrength = 2.6;
}

function bricksPattern(t, pal, bw = 8, bh = 4, opt = {}) {
  t.each((x, y, i) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const bx = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    const mortar = ly === bh - 1 || lx === bw - 1;
    const shade = hash2(bx + row * 7, row, t.seed);
    let c = scalec(pal.brick, 0.82 + shade * 0.28 + (pnoise(x, y, t.seed) - 0.5) * 0.14);
    if (ly === 0 && !mortar) c = scalec(c, 1.08);
    let h = 0.7 + pnoise(x, y, t.seed + 2) * 0.1;
    if (mortar) {
      c = scalec(pal.mortar, 0.92 + pnoise(x, y, t.seed + 3) * 0.12);
      h = 0.05;
    }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = mortar ? 0.95 : opt.rough ?? 0.8;
  });
  t.normalStrength = 2.4;
}

function sandLike(t, base, opt = {}) {
  t.each((x, y, i) => {
    const n = pnoise(x, y, t.seed) * 0.7 + tfbm(x / S, y / S, 4, 2, t.seed + 1) * 0.3;
    let c = scalec(base, 0.9 + n * 0.16);
    if (pnoise(x, y, t.seed + 5) > 0.95) c = scalec(c, 0.86);
    t.set(x, y, c);
    t.height[i] = n;
    t.rough[i] = opt.rough ?? 0.92;
  });
  t.normalStrength = opt.normal ?? 0.9;
}

function oreFlecks(t, fleck, opt = {}) {
  stoneLike(t, { seed: strSeed('stone') });
  const rand = mulberry32(t.seed);
  const clusters = opt.clusters ?? 5;
  for (let k = 0; k < clusters; k++) {
    const cx = Math.floor(rand() * S), cy = Math.floor(rand() * S);
    const n = 2 + Math.floor(rand() * 3);
    for (let j = 0; j < n; j++) {
      const x = wrap(cx + Math.floor(rand() * 3) - 1, S), y = wrap(cy + Math.floor(rand() * 3) - 1, S);
      const i = y * S + x;
      const shade = 0.8 + rand() * 0.35;
      t.set(x, y, scalec(fleck, shade));
      t.height[i] = 0.85;
      t.rough[i] = opt.rough ?? 0.35;
      t.metal[i] = opt.metal ?? 0;
      if (opt.emit) t.emit[i] = opt.emit;
      // dark rim below-right for depth
      const rx = wrap(x + 1, S), ry = wrap(y + 1, S);
      const ri = ry * S + rx;
      if (t.height[ri] < 0.8) {
        const c = t.get(rx, ry);
        t.set(rx, ry, scalec(c, 0.8));
      }
    }
  }
}

function metalBlock(t, pal, opt = {}) {
  t.each((x, y, i) => {
    const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
    const n = tfbm(x / S, y / S, 2, 2, t.seed) * 0.5 + pnoise(x, y, t.seed) * 0.15;
    let c = mixc(pal.dark, pal.light, clamp01(0.35 + n * 0.8 - (x + y) / (S * 4)));
    let h = 0.8;
    if (edge === 0) { c = scalec(pal.dark, 0.85); h = 0.2; }
    else if (edge === 1) { c = x === 1 || y === 1 ? pal.light : mixc(pal.dark, pal.light, 0.4); h = 0.6; }
    if (opt.lines && (y === 5 || y === 10) && edge > 1) { c = scalec(c, 0.9); h = 0.7; }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = opt.rough ?? 0.25;
    t.metal[i] = opt.metal ?? 1;
  });
  t.normalStrength = 1.2;
}

function plantSprite(t, draw) {
  t.each((x, y) => t.set(x, y, [0, 0, 0], 0));
  draw(t);
  t.cutout = true;
  t.each((x, y, i) => {
    t.rough[i] = 0.6;
    t.height[i] = 0.5;
  });
  t.normalStrength = 0;
}

function woolPattern(t, color) {
  const base = hex(color);
  t.each((x, y, i) => {
    const fiber = Math.sin((x * 0.9 + y * 1.7) + tfbm(x / S, y / S, 4, 2, 991) * 6) * 0.5 + 0.5;
    const n = pnoise(x, y, 4242) * 0.5 + fiber * 0.5;
    const c = scalec(base, 0.84 + n * 0.24);
    t.set(x, y, c);
    t.height[i] = n;
    t.rough[i] = 1.0;
  });
  t.normalStrength = 1.5;
}

// ---------- texture catalogue ----------
const GEN = {
  stone: (t) => stoneLike(t, { contrast: 1.7 }),
  smooth_stone: (t) => {
    t.each((x, y, i) => {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const n = pnoise(x, y, t.seed) * 0.08 + tfbm(x / S, y / S, 2, 2, t.seed) * 0.08;
      let c = scalec([166, 166, 166], 0.95 + n);
      let h = 0.7;
      if (edge === 0) { c = [118, 118, 118]; h = 0.3; }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.45;
    });
  },
  bedrock: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 4, 2, t.seed) * 0.5 + pnoise(x, y, t.seed) * 0.5;
      const q = Math.floor(n * 4) / 3;
      const g = 40 + q * 90;
      t.set(x, y, [g, g, g * 1.02]);
      t.height[i] = q;
      t.rough[i] = 0.9;
    });
    t.normalStrength = 2.5;
  },
  dirt: (t) => dirtLike(t),
  grass_top: (t) => grassTopGray(t),
  grass_side: (t) => {
    dirtLike(t);
    t.each((x, y, i) => {
      const drip = 3 + Math.floor(pnoise(x, 0, t.seed + 13) * 2.99) - (pnoise(x, 1, t.seed) > 0.8 ? 1 : 0);
      if (y < drip) {
        const n = pnoise(x, y, t.seed + 17);
        const g = 140 + (n - 0.5) * 80;
        t.set(x, y, [g, g, g], 1);
        t.height[i] = 0.75 + n * 0.2;
        t.rough[i] = 0.75;
      } else {
        const c = t.get(x, y);
        t.set(x, y, c, 0); // alpha 0 = not tinted
      }
    });
  },
  grass_snow_side: (t) => {
    dirtLike(t);
    t.each((x, y, i) => {
      const drip = 3 + Math.floor(pnoise(x, 0, t.seed + 13) * 2.99);
      if (y < drip) {
        const n = pnoise(x, y, t.seed + 17);
        t.set(x, y, scalec([240, 250, 252], 0.92 + n * 0.08));
        t.height[i] = 0.8;
        t.rough[i] = 0.6;
      }
    });
  },
  snow: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 4, 2, t.seed) * 0.6 + pnoise(x, y, t.seed) * 0.4;
      t.set(x, y, mixc([214, 228, 236], [250, 253, 255], clamp01(n * 1.3)));
      t.height[i] = n;
      t.rough[i] = 0.55;
    });
    t.normalStrength = 0.8;
  },
  sand: (t) => sandLike(t, [219, 206, 160]),
  gravel: (t) => {
    const cols = [[136, 126, 124], [112, 104, 100], [152, 146, 140], [98, 92, 90], [128, 116, 104]];
    t.each((x, y, i) => {
      const vo = voronoi(x, y, 6, t.seed, 1.0);
      const edge = vo.f2 - vo.f1;
      let c = scalec(cols[vo.id % cols.length], 0.9 + pnoise(x, y, t.seed) * 0.2);
      let h = clamp01(0.4 + edge * 0.25);
      if (edge < 0.6) { c = [74, 68, 66]; h = 0.0; }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.9;
    });
    t.normalStrength = 2.2;
  },
  clay: (t) => sandLike(t, [160, 166, 180], { rough: 0.7, normal: 0.6 }),
  cobblestone: (t) => cobble(t, { stone: [128, 128, 128], mortar: [72, 72, 72] }),
  mossy_cobblestone: (t) => cobble(t, { stone: [124, 126, 122], mortar: [66, 70, 62], moss: [72, 110, 42], mossLight: [96, 136, 52] }, { moss: true }),
  stone_bricks: (t) => bricksPattern(t, { brick: [124, 124, 124], mortar: [78, 78, 78] }, 8, 8),
  bricks: (t) => bricksPattern(t, { brick: [150, 78, 60], mortar: [168, 160, 150] }, 8, 4),
  oak_planks: (t) => planks(t, { light: [184, 148, 92], dark: [150, 118, 70], seam: [96, 74, 44] }),
  birch_planks: (t) => planks(t, { light: [216, 200, 148], dark: [190, 172, 118], seam: [140, 124, 84] }),
  spruce_planks: (t) => planks(t, { light: [126, 94, 58], dark: [100, 74, 44], seam: [62, 46, 26] }),
  oak_log: (t) => bark(t, { light: [118, 94, 58], dark: [92, 72, 43], groove: [66, 51, 30] }),
  oak_log_top: (t) => logTop(t, { bark: [96, 76, 46], ringLight: [178, 146, 92], ringDark: [148, 118, 72] }),
  spruce_log: (t) => bark(t, { light: [84, 60, 36], dark: [64, 46, 27], groove: [44, 31, 18] }),
  spruce_log_top: (t) => logTop(t, { bark: [66, 48, 28], ringLight: [130, 98, 60], ringDark: [104, 78, 46] }),
  birch_log: (t) => {
    t.each((x, y, i) => {
      const n = pnoise(x, y, t.seed) * 0.4 + tfbm(x / S, y / S, 4, 2, t.seed) * 0.6;
      let c = mixc([196, 196, 188], [232, 232, 224], n);
      let h = 0.7;
      // horizontal dark lenticels
      const band = Math.floor(y / 2) * 2;
      const r = hash2(band, Math.floor(x / 5), t.seed);
      if (y % 2 === 0 && r > 0.62) {
        const len = 2 + Math.floor(hash2(band, 9, t.seed) * 4);
        const start = Math.floor(r * 13);
        if (wrap(x - start, S) < len) { c = [44, 42, 38]; h = 0.3; }
      }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.8;
    });
    t.normalStrength = 1.6;
  },
  birch_log_top: (t) => logTop(t, { bark: [210, 210, 200], ringLight: [214, 196, 142], ringDark: [190, 170, 116] }),
  oak_leaves: (t) => leaves(t),
  spruce_leaves: (t) => leaves(t, { density: 0.88, cells: 7 }),
  water: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 4, 2, t.seed);
      t.set(x, y, mixc([40, 90, 190], [80, 140, 230], n), 0.7);
      t.rough[i] = 0.05;
    });
  },
  lava: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 4, 3, t.seed);
      const c = ramp([[0, [150, 30, 5]], [0.45, [230, 90, 12]], [0.7, [255, 170, 40]], [1, [255, 240, 150]]], n);
      t.set(x, y, c);
      t.emit[i] = 0.6 + n * 0.4;
      t.height[i] = 1 - n;
      t.rough[i] = 0.6;
    });
    t.normalStrength = 1.5;
  },
  coal_ore: (t) => oreFlecks(t, [42, 42, 44], { rough: 0.55 }),
  iron_ore: (t) => oreFlecks(t, [216, 176, 146], { rough: 0.35, metal: 0.7 }),
  gold_ore: (t) => oreFlecks(t, [252, 236, 80], { rough: 0.25, metal: 1 }),
  diamond_ore: (t) => oreFlecks(t, [96, 238, 246], { rough: 0.05, clusters: 4 }),
  glass: (t) => {
    t.each((x, y, i) => {
      const edge = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      const diag = (x - y === 4 && x > 4 && x < 9) || (x - y === 6 && x > 8 && x < 12) || (x - y === -5 && y > 6 && y < 10);
      if (edge) t.set(x, y, [218, 236, 240], 1);
      else if (diag) t.set(x, y, [240, 250, 255], 1);
      else t.set(x, y, [200, 220, 230], 0);
      t.rough[i] = 0.05;
      t.height[i] = edge ? 0.7 : 0.5;
    });
    t.cutout = true;
    t.normalStrength = 0.5;
  },
  ice: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 2, 3, t.seed);
      const crack = Math.abs(Math.sin((x * 0.7 - y * 1.3) + n * 5)) < 0.12;
      let c = mixc([150, 186, 250], [196, 222, 255], n);
      if (crack) c = [230, 244, 255];
      t.set(x, y, c, 0.72);
      t.rough[i] = crack ? 0.3 : 0.04;
      t.height[i] = crack ? 0.4 : 0.6;
    });
    t.normalStrength = 0.6;
  },
  cactus_side: (t) => {
    t.each((x, y, i) => {
      const inset = x === 0 || x === S - 1;
      const ridge = x % 4 === 1;
      let c = scalec([88, 140, 44], 0.9 + pnoise(x, y, t.seed) * 0.15);
      let h = 0.6;
      if (ridge) { c = scalec(c, 0.78); h = 0.3; }
      if (inset) { c = [0, 0, 0]; }
      if (!ridge && (x + y * 3) % 7 === 0 && !inset) { c = [224, 222, 190]; h = 0.9; }
      t.set(x, y, c, inset ? 0 : 1);
      t.height[i] = h;
      t.rough[i] = 0.5;
    });
    t.cutout = true;
    t.normalStrength = 1.4;
  },
  cactus_top: (t) => {
    const c0 = (S - 1) / 2;
    t.each((x, y, i) => {
      const inset = x === 0 || y === 0 || x === S - 1 || y === S - 1;
      const r = Math.hypot(x - c0, y - c0);
      let c = scalec([104, 158, 54], 0.9 + pnoise(x, y, t.seed) * 0.12);
      if (Math.floor(r) % 3 === 0) c = scalec(c, 0.82);
      t.set(x, y, inset ? [0, 0, 0] : c, inset ? 0 : 1);
      t.height[i] = 0.5 + (Math.floor(r) % 3 === 0 ? -0.2 : 0);
      t.rough[i] = 0.5;
    });
    t.cutout = true;
  },
  tall_grass: (t) => plantSprite(t, (t) => {
    const rand = mulberry32(t.seed);
    for (let b = 0; b < 9; b++) {
      let x = 1 + Math.floor(rand() * (S - 2));
      const hgt = 6 + Math.floor(rand() * 9);
      const lean = rand() < 0.5 ? -1 : 1;
      for (let k = 0; k < hgt; k++) {
        const y = S - 1 - k;
        if (k > 3 && rand() < 0.25) x = Math.max(0, Math.min(S - 1, x + lean));
        const g = 120 + (k / hgt) * 90 + rand() * 20;
        t.set(x, y, [g, g, g], 1);
      }
    }
  }),
  fern: (t) => plantSprite(t, (t) => {
    const rand = mulberry32(t.seed);
    for (let f = 0; f < 4; f++) {
      const bx = 2 + f * 3 + Math.floor(rand() * 2);
      const hgt = 8 + Math.floor(rand() * 6);
      for (let k = 0; k < hgt; k++) {
        const y = S - 1 - k;
        const x = bx + Math.round(Math.sin(k * 0.3 + f) * 1);
        const g = 110 + (k / hgt) * 80;
        t.set(Math.max(0, Math.min(S - 1, x)), y, [g, g, g], 1);
        if (k > 2 && k % 2 === 0) {
          const w = Math.max(1, Math.round((hgt - k) / 3));
          for (let s = 1; s <= w; s++) {
            if (x - s >= 0) t.set(x - s, y + (s > 1 ? 1 : 0), [g * 0.9, g * 0.9, g * 0.9], 1);
            if (x + s < S) t.set(x + s, y + (s > 1 ? 1 : 0), [g * 0.9, g * 0.9, g * 0.9], 1);
          }
        }
      }
    }
  }),
  poppy: (t) => plantSprite(t, (t) => flower(t, [[196, 26, 26], [230, 60, 50]], [48, 16, 16])),
  dandelion: (t) => plantSprite(t, (t) => flower(t, [[250, 216, 40], [255, 240, 110]], [226, 150, 20], true)),
  cornflower: (t) => plantSprite(t, (t) => flower(t, [[70, 104, 226], [120, 150, 250]], [36, 40, 110])),
  dead_bush: (t) => plantSprite(t, (t) => {
    const rand = mulberry32(t.seed);
    const col = [118, 80, 40];
    const branch = (x, y, dx, len) => {
      for (let k = 0; k < len; k++) {
        if (x < 0 || x >= S || y < 0) return;
        t.set(x, y, scalec(col, 0.85 + rand() * 0.3), 1);
        y -= 1;
        if (rand() < 0.5) x += dx;
        if (k > 2 && rand() < 0.3) branch(x, y, -dx, Math.floor(len / 2));
      }
    };
    branch(7, S - 1, -1, 8);
    branch(8, S - 1, 1, 9);
    branch(8, S - 2, 0, 6);
  }),
  torch: (t) => plantSprite(t, (t) => {
    // stick in columns 7-8, rows 6..15; flame rows 3..6
    for (let y = 6; y < S; y++) {
      for (let x = 7; x <= 8; x++) {
        const c = x === 7 ? [138, 104, 60] : [104, 78, 44];
        t.set(x, y, scalec(c, y > 13 ? 0.85 : 1), 1);
      }
    }
    const flame = [
      [7, 3, [255, 200, 90]], [8, 3, [255, 170, 60]],
      [7, 4, [255, 246, 200]], [8, 4, [255, 220, 120]],
      [7, 5, [255, 252, 230]], [8, 5, [255, 236, 170]],
      [7, 6, [255, 210, 110]], [8, 6, [240, 170, 70]],
      [6, 4, [250, 150, 40]], [9, 4, [250, 140, 40]],
      [6, 5, [255, 190, 70]], [9, 5, [255, 180, 60]],
    ];
    for (const [x, y, c] of flame) {
      t.set(x, y, c, 1);
      t.emit[y * S + x] = 1;
    }
  }),
  glowstone: (t) => {
    t.each((x, y, i) => {
      const vo = voronoi(x, y, 5, t.seed, 1.0);
      const edge = vo.f2 - vo.f1;
      const n = hash2(vo.id, 1, t.seed);
      let c = ramp([[0, [150, 96, 44]], [0.5, [228, 172, 88]], [1, [255, 236, 170]]], clamp01(n * 0.6 + edge * 0.25));
      let e = 0.55 + n * 0.45;
      if (edge < 0.7) { c = [104, 66, 34]; e = 0.1; }
      t.set(x, y, c);
      t.emit[i] = e;
      t.height[i] = edge < 0.7 ? 0.2 : 0.7;
      t.rough[i] = 0.5;
    });
    t.normalStrength = 1.6;
  },
  sandstone: (t) => {
    t.each((x, y, i) => {
      const band = [0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0, 0, 3, 3, 0, 0][y];
      let c = scalec([216, 202, 154], 0.95 + pnoise(x, y, t.seed) * 0.08);
      if (band === 1) c = scalec(c, 0.93);
      if (band === 2) c = scalec(c, 1.04);
      if (band === 3) c = scalec(c, 0.88);
      t.set(x, y, c);
      t.height[i] = band === 3 ? 0.3 : 0.6;
      t.rough[i] = 0.85;
    });
    t.normalStrength = 1.2;
  },
  sandstone_top: (t) => sandLike(t, [220, 206, 160], { normal: 0.6 }),
  sandstone_bottom: (t) => {
    sandLike(t, [206, 192, 146], { normal: 1.2 });
  },
  obsidian: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 4, 3, t.seed);
      const streak = Math.abs(Math.sin(x * 0.6 + y * 0.9 + n * 7));
      let c = mixc([16, 12, 26], [44, 30, 70], clamp01(n * 0.9));
      if (streak < 0.15) c = [74, 54, 110];
      t.set(x, y, c);
      t.height[i] = n;
      t.rough[i] = 0.12;
    });
    t.normalStrength = 1.0;
  },
  bookshelf: (t) => {
    const bookCols = [[140, 40, 36], [42, 70, 130], [52, 102, 52], [150, 120, 50], [100, 58, 110], [150, 76, 40], [60, 60, 70]];
    t.each((x, y, i) => {
      let c, h = 0.6;
      if (y < 2 || y >= S - 2 || y === 7 || y === 8) {
        c = y === 7 || y === 8 ? [150, 118, 70] : [168, 134, 82];
        if (y === 1 || y === S - 2 || y === 8) c = scalec(c, 0.8);
        h = 0.8;
      } else {
        const shelf = y < 7 ? 0 : 1;
        const bw = 2;
        const idx = Math.floor(x / bw) + shelf * 8;
        const col = bookCols[Math.floor(hash2(idx, 0, t.seed) * bookCols.length)];
        const top = shelf === 0 ? 2 + Math.floor(hash2(idx, 1, t.seed) * 2) : 9 + Math.floor(hash2(idx, 1, t.seed) * 2);
        if (y < top) { c = [40, 30, 20]; h = 0.1; }
        else {
          c = scalec(col, x % bw === 0 ? 1.1 : 0.9);
          if (y === top + 1 || y === (shelf ? 13 : 5)) c = scalec(c, 1.3);
        }
      }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.75;
    });
    t.normalStrength = 1.6;
  },
  crafting_table_top: (t) => {
    planks(t, { light: [184, 148, 92], dark: [150, 118, 70], seam: [96, 74, 44] });
    t.each((x, y, i) => {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      if (edge === 0) t.set(x, y, [86, 62, 36]);
      if (edge > 1 && (x === 5 || x === 10 || y === 5 || y === 10)) { t.set(x, y, [110, 82, 48]); t.height[i] = 0.2; }
    });
  },
  crafting_table_side: (t) => {
    planks(t, { light: [170, 134, 82], dark: [140, 108, 62], seam: [90, 68, 40] });
    t.each((x, y, i) => {
      if (y < 3) t.set(x, y, [120, 88, 52]);
      // a saw and a hammer silhouette
      if (y >= 5 && y <= 11 && x >= 2 && x <= 4) t.set(x, y, x === 3 ? [170, 170, 176] : [130, 130, 136]);
      if (y >= 5 && y <= 12 && x === 11) t.set(x, y, [96, 70, 40]);
      if (y >= 5 && y <= 6 && x >= 9 && x <= 13) t.set(x, y, [120, 120, 126]);
    });
  },
  quartz: (t) => {
    t.each((x, y, i) => {
      const n = tfbm(x / S, y / S, 2, 3, t.seed);
      const c = mixc([226, 220, 212], [242, 238, 232], n);
      t.set(x, y, c);
      t.height[i] = 0.6 + n * 0.1;
      t.rough[i] = 0.22;
    });
    t.normalStrength = 0.5;
  },
  sea_lantern: (t) => {
    t.each((x, y, i) => {
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const vo = voronoi(x, y, 4, t.seed, 0.6);
      const n = hash2(vo.id, 2, t.seed);
      let c = mixc([160, 208, 204], [236, 252, 248], n);
      let e = 0.7 + n * 0.3;
      if (vo.f2 - vo.f1 < 0.8) { c = [120, 170, 172]; e = 0.4; }
      if (edge === 0) { c = [110, 150, 156]; e = 0.25; }
      t.set(x, y, c);
      t.emit[i] = e;
      t.rough[i] = 0.3;
      t.height[i] = edge === 0 ? 0.3 : 0.7;
    });
  },
  gold_block: (t) => metalBlock(t, { light: [255, 240, 130], dark: [214, 158, 36] }, { rough: 0.22 }),
  iron_block: (t) => metalBlock(t, { light: [240, 240, 240], dark: [176, 176, 180] }, { rough: 0.3, lines: true }),
  diamond_block: (t) => metalBlock(t, { light: [176, 250, 246], dark: [58, 196, 190] }, { rough: 0.06, metal: 0 }),
  terracotta: (t) => sandLike(t, [152, 94, 67], { rough: 0.7, normal: 0.5 }),
  pumpkin_side: (t) => {
    t.each((x, y, i) => {
      const ridge = x % 4 === 0;
      let c = scalec([222, 128, 28], 0.92 + pnoise(x, y, t.seed) * 0.1);
      if (ridge) c = scalec(c, 0.8);
      t.set(x, y, c);
      t.height[i] = ridge ? 0.3 : 0.7;
      t.rough[i] = 0.45;
    });
    t.normalStrength = 1.5;
  },
  pumpkin_top: (t) => {
    const c0 = (S - 1) / 2;
    t.each((x, y, i) => {
      const r = Math.hypot(x - c0, y - c0);
      let c = scalec([206, 118, 24], 0.92 + pnoise(x, y, t.seed) * 0.1);
      if (r < 2) c = [98, 78, 34];
      t.set(x, y, c);
      t.height[i] = r < 2 ? 0.9 : 0.6;
      t.rough[i] = 0.5;
    });
  },
  jack_o_lantern: (t) => {
    GEN.pumpkin_side(t);
    const face = [
      '................',
      '................',
      '................',
      '...##......##...',
      '..####....####..',
      '..####....####..',
      '................',
      '.......##.......',
      '................',
      '..############..',
      '..#.########.#..',
      '...##########...',
      '....##....##....',
      '................',
      '................',
      '................',
    ];
    t.each((x, y, i) => {
      if (face[y][x] === '#') {
        t.set(x, y, mixc([255, 190, 60], [255, 240, 150], pnoise(x, y, t.seed)));
        t.emit[i] = 1;
        t.height[i] = 0.1;
      }
    });
  },
};

function flower(t, petals, center, round = false) {
  // stem
  for (let y = 8; y < S; y++) t.set(7, y, [58, 118, 36], 1);
  t.set(8, 12, [70, 136, 44], 1); t.set(9, 11, [70, 136, 44], 1);
  t.set(6, 13, [70, 136, 44], 1); t.set(5, 12, [70, 136, 44], 1);
  const cx = 7, cy = 5;
  for (let y = 2; y <= 8; y++) {
    for (let x = 4; x <= 10; x++) {
      const dx = x - cx, dy = y - cy;
      const d = round ? Math.hypot(dx, dy) : Math.abs(dx) + Math.abs(dy) * 0.9;
      if (d <= 2.6) {
        const c = d < 1 ? center : mixc(petals[1], petals[0], clamp01(d / 2.6));
        t.set(x, y, c, 1);
      }
    }
  }
}

for (const [c, h] of WOOL_COLORS) GEN[c + '_wool'] = (t) => woolPattern(t, h);

// ---------- derived maps + packing ----------
function deriveNormals(t) {
  const n = new Float32Array(S * S * 3);
  const ao = new Float32Array(S * S);
  const hAt = (x, y) => t.height[wrap(y, S) * S + wrap(x, S)];
  const k = t.normalStrength;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      if (t.cutout && t.albedo[i * 4 + 3] < 0.5) {
        n[i * 3] = 0; n[i * 3 + 1] = 0; n[i * 3 + 2] = 1; ao[i] = 1;
        continue;
      }
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * 0.5 + (hAt(x + 1, y - 1) - hAt(x - 1, y - 1) + hAt(x + 1, y + 1) - hAt(x - 1, y + 1)) * 0.25;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * 0.5 + (hAt(x - 1, y + 1) - hAt(x - 1, y - 1) + hAt(x + 1, y + 1) - hAt(x + 1, y - 1)) * 0.25;
      let nx = -dx * k, ny = -dy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      n[i * 3] = nx / l; n[i * 3 + 1] = ny / l; n[i * 3 + 2] = nz / l;
      // cavity: lower than neighbourhood average -> occluded
      let avg = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) avg += hAt(x + q, y + j);
      avg /= 9;
      ao[i] = clamp01(1 - Math.max(0, avg - t.height[i]) * 1.6 * Math.min(k, 2));
    }
  }
  return { n, ao };
}

// Fill RGB of transparent texels from their neighbours so mip filtering doesn't bleed black.
function dilate(t) {
  const a = t.albedo;
  for (let pass = 0; pass < 4; pass++) {
    const copy = a.slice();
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        if (copy[i + 3] >= 0.5) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let j = -1; j <= 1; j++) {
          for (let q = -1; q <= 1; q++) {
            const k = (wrap(y + j, S) * S + wrap(x + q, S)) * 4;
            if (copy[k + 3] >= 0.5 || (copy[k] + copy[k + 1] + copy[k + 2]) > 0) {
              if (copy[k + 3] < 0.5 && pass === 0) continue;
              r += copy[k]; g += copy[k + 1]; b += copy[k + 2]; c++;
            }
          }
        }
        if (c) { a[i] = r / c; a[i + 1] = g / c; a[i + 2] = b / c; }
      }
    }
  }
}

export function generateTextures() {
  const textures = TEXTURE_NAMES.map((name) => {
    const t = new Tex(name);
    const gen = GEN[name];
    if (gen) gen(t);
    else stoneLike(t, { base: [200, 0, 200] }); // magenta = missing
    return t;
  });
  return textures;
}

// Build mip chains for three RGBA8 texture arrays.
// Returns { levels: [{ size, albedo, normal, material }], count }.
export function buildTextureArrays(textures) {
  const count = textures.length;
  const base = {
    albedo: new Uint8Array(S * S * 4 * count),
    normal: new Uint8Array(S * S * 4 * count),
    material: new Uint8Array(S * S * 4 * count),
  };
  const cutoutFlags = textures.map((t) => t.cutout);
  textures.forEach((t, layer) => {
    const { n, ao } = deriveNormals(t);
    if (t.cutout) dilate(t);
    const off = layer * S * S * 4;
    for (let i = 0; i < S * S; i++) {
      const o = off + i * 4;
      base.albedo[o] = Math.round(Math.min(255, Math.max(0, t.albedo[i * 4])));
      base.albedo[o + 1] = Math.round(Math.min(255, Math.max(0, t.albedo[i * 4 + 1])));
      base.albedo[o + 2] = Math.round(Math.min(255, Math.max(0, t.albedo[i * 4 + 2])));
      base.albedo[o + 3] = Math.round(clamp01(t.albedo[i * 4 + 3]) * 255);
      base.normal[o] = Math.round((n[i * 3] * 0.5 + 0.5) * 255);
      base.normal[o + 1] = Math.round((n[i * 3 + 1] * 0.5 + 0.5) * 255);
      base.normal[o + 2] = Math.round((n[i * 3 + 2] * 0.5 + 0.5) * 255);
      base.normal[o + 3] = Math.round(ao[i] * 255);
      base.material[o] = Math.round(clamp01(t.rough[i]) * 255);
      base.material[o + 1] = Math.round(clamp01(t.metal[i]) * 255);
      base.material[o + 2] = Math.round(clamp01(t.emit[i]) * 255);
      base.material[o + 3] = Math.round(clamp01(t.height[i]) * 255);
    }
  });

  const levels = [{ size: S, ...base }];
  let size = S;
  let prev = base;
  while (size > 1) {
    const ns = size >> 1;
    const next = {
      albedo: new Uint8Array(ns * ns * 4 * count),
      normal: new Uint8Array(ns * ns * 4 * count),
      material: new Uint8Array(ns * ns * 4 * count),
    };
    for (let layer = 0; layer < count; layer++) {
      const po = layer * size * size * 4, no = layer * ns * ns * 4;
      for (let y = 0; y < ns; y++) {
        for (let x = 0; x < ns; x++) {
          const d = no + (y * ns + x) * 4;
          const s00 = po + ((y * 2) * size + x * 2) * 4;
          const s10 = s00 + 4, s01 = s00 + size * 4, s11 = s01 + 4;
          // albedo: alpha-weighted colour average
          const A = prev.albedo;
          const cut = cutoutFlags[layer];
          const w0 = cut ? A[s00 + 3] + 1 : 1, w1 = cut ? A[s10 + 3] + 1 : 1;
          const w2 = cut ? A[s01 + 3] + 1 : 1, w3 = cut ? A[s11 + 3] + 1 : 1;
          const ws = w0 + w1 + w2 + w3;
          for (let c = 0; c < 3; c++) {
            next.albedo[d + c] = Math.round((A[s00 + c] * w0 + A[s10 + c] * w1 + A[s01 + c] * w2 + A[s11 + c] * w3) / ws);
          }
          next.albedo[d + 3] = Math.round((A[s00 + 3] + A[s10 + 3] + A[s01 + 3] + A[s11 + 3]) / 4);
          for (const key of ['normal', 'material']) {
            const src = prev[key], dst = next[key];
            for (let c = 0; c < 4; c++) dst[d + c] = Math.round((src[s00 + c] + src[s10 + c] + src[s01 + c] + src[s11 + c]) / 4);
          }
        }
      }
      // preserve alpha-test coverage for cutout textures (so leaves don't thin out at distance)
      if (cutoutFlags[layer]) preserveCoverage(base.albedo, S, next.albedo, ns, layer);
    }
    levels.push({ size: ns, ...next });
    prev = next;
    size = ns;
  }
  return { levels, count, size: S };
}

function coverage(data, size, layer, scale) {
  const off = layer * size * size * 4;
  let c = 0;
  for (let i = 0; i < size * size; i++) if (data[off + i * 4 + 3] * scale >= 127.5) c++;
  return c / (size * size);
}

function preserveCoverage(base, bs, mip, ms, layer) {
  const target = coverage(base, bs, layer, 1);
  let lo = 0.5, hi = 4;
  for (let it = 0; it < 12; it++) {
    const mid = (lo + hi) / 2;
    if (coverage(mip, ms, layer, mid) < target) lo = mid; else hi = mid;
  }
  const scale = (lo + hi) / 2;
  const off = layer * ms * ms * 4;
  for (let i = 0; i < ms * ms; i++) {
    const k = off + i * 4 + 3;
    mip[k] = Math.min(255, Math.round(mip[k] * scale));
  }
}

// ---------- 2D canvas helpers for UI icons ----------
export function textureToImageData(textures, name, tint) {
  const t = textures.find((x) => x.name === name);
  const img = new ImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    let r = t.albedo[i * 4], g = t.albedo[i * 4 + 1], b = t.albedo[i * 4 + 2];
    let a = t.albedo[i * 4 + 3];
    if (tint) {
      const m = t.cutout ? 1 : a;
      r *= 1 + (tint[0] - 1) * m; g *= 1 + (tint[1] - 1) * m; b *= 1 + (tint[2] - 1) * m;
      if (!t.cutout) a = 1;
    } else if (!t.cutout && name !== 'water' && name !== 'ice') a = 1;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a * 255;
  }
  return img;
}

export { hash3 };

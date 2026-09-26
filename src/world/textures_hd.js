// High-detail (64x64) procedural textures: the "HD" texture pack.
// Same names, conventions and PBR companion maps as the 16x16 pixel pack in textures.js:
// albedo (sRGB, alpha = tint mask on opaque textures, coverage on cutouts), height (also used
// for parallax), roughness, metalness and emission.

import { hash2, mulberry32 } from './noise.js';
import { TEXTURE_NAMES, WOOL_COLORS } from './blocks.js';
import { Tex, generatePixelTexture } from './textures.js';

export const HD_SIZE = 64;
const R = HD_SIZE;

// ---------- helpers ----------
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const wrap = (i, p) => ((i % p) + p) % p;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scalec = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
function hex(h) {
  const v = parseInt(h.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function ramp(stops, t) {
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

// tileable value noise on a lattice of period p (u, v in texture units 0..1)
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
function fbm(u, v, period, octaves, seed, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(u * p, v * p, p, seed + o * 1013) * amp;
    norm += amp;
    amp *= gain;
    p *= 2;
  }
  return sum / norm;
}
// anisotropic fbm: separate periods along u and v (must divide into whole cells)
function fbmA(u, v, pu, pv, octaves, seed) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoiseA(u * pu, v * pv, pu, pv, seed + o * 997) * amp;
    norm += amp;
    amp *= 0.5;
    pu *= 2;
    pv *= 2;
  }
  return sum / norm;
}
function vnoiseA(x, y, pu, pv, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(wrap(x0, pu), wrap(y0, pv), seed);
  const b = hash2(wrap(x0 + 1, pu), wrap(y0, pv), seed);
  const c = hash2(wrap(x0, pu), wrap(y0 + 1, pv), seed);
  const d = hash2(wrap(x0 + 1, pu), wrap(y0 + 1, pv), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
// ridged: 1 at the crest of each noise "valley" line
function ridge(u, v, period, octaves, seed) {
  let sum = 0, amp = 1, norm = 0, p = period;
  for (let o = 0; o < octaves; o++) {
    const n = 1 - Math.abs(vnoise(u * p, v * p, p, seed + o * 733) * 2 - 1);
    sum += n * n * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}
const white = (x, y, seed) => hash2(wrap(x, R), wrap(y, R), seed);

// tileable Voronoi, n cells per axis; distances in texels
function voronoi(px, py, n, seed, jitter = 0.85) {
  const cell = R / n;
  const cx = Math.floor(px / cell), cy = Math.floor(py / cell);
  let f1 = 1e9, f2 = 1e9, id = 0, fx = 0, fy = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = wrap(gx, n), wy = wrap(gy, n);
      const ox = (0.5 + (hash2(wx, wy, seed) - 0.5) * jitter) * cell;
      const oy = (0.5 + (hash2(wx, wy, seed + 77) - 0.5) * jitter) * cell;
      const qx = gx * cell + ox, qy = gy * cell + oy;
      const dx = px + 0.5 - qx, dy = py + 0.5 - qy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = wy * n + wx; fx = qx; fy = qy; }
      else if (d < f2) f2 = d;
    }
  }
  return { id, f1, f2, fx, fy, cell };
}

// tileable Voronoi with nx x ny cells (tall or wide cells)
function voronoiA(px, py, nx, ny, seed, jitter = 0.85) {
  const cw = R / nx, chh = R / ny;
  const cx = Math.floor(px / cw), cy = Math.floor(py / chh);
  let f1 = 1e9, f2 = 1e9, id = 0, fx = 0, fy = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const gx = cx + i, gy = cy + j;
      const wx = wrap(gx, nx), wy = wrap(gy, ny);
      const qx = gx * cw + (0.5 + (hash2(wx, wy, seed) - 0.5) * jitter) * cw;
      const qy = gy * chh + (0.5 + (hash2(wx, wy, seed + 77) - 0.5) * jitter) * chh;
      // distances measured in cell units so tall cells stay tall
      const dx = (px + 0.5 - qx) / cw, dy = (py + 0.5 - qy) / chh;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; id = wy * nx + wx; fx = qx; fy = qy; }
      else if (d < f2) f2 = d;
    }
  }
  return { id, f1, f2, fx, fy };
}

// Paint helpers (wrap around the tile). put() blends a colour into the albedo with coverage a.
function put(t, x, y, c, a = 1, h = null, rough = null) {
  x = wrap(Math.round(x), R); y = wrap(Math.round(y), R);
  const i = y * R + x;
  const o = i * 4;
  const A = t.albedo;
  A[o] = lerp(A[o], c[0], a); A[o + 1] = lerp(A[o + 1], c[1], a); A[o + 2] = lerp(A[o + 2], c[2], a);
  if (h !== null) t.height[i] = Math.max(t.height[i] * (1 - a), lerp(t.height[i], h, a));
  if (rough !== null) t.rough[i] = lerp(t.rough[i], rough, a);
}
// a tapered stroke from (x0, y0) along an angle, with a gentle curve
function stroke(t, x0, y0, len, ang, w0, w1, colorAt, opts = {}) {
  const steps = Math.ceil(len * 2);
  let x = x0, y = y0;
  const curve = opts.curve || 0;
  for (let s = 0; s <= steps; s++) {
    const k = s / steps;
    const a = ang + curve * k;
    const w = lerp(w0, w1, k);
    const c = colorAt(k);
    const r = Math.max(0.5, w / 2);
    for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
        const d = Math.hypot(dx, dy);
        if (d <= r) {
          const px = x + dx, py = y + dy;
          if (opts.cutout) {
            const i = wrap(Math.round(py), R) * R + wrap(Math.round(px), R);
            if (opts.noWrap && (px < 0 || px >= R || py < 0 || py >= R)) continue;
            t.albedo[i * 4 + 3] = 1;
          }
          put(t, px, py, c, clamp01(r - d + 0.5), opts.height ? opts.height(k) : null, opts.rough ?? null);
        }
      }
    }
    x += Math.cos(a) * 0.5;
    y += Math.sin(a) * 0.5;
  }
}

function fill(t, fn) {
  for (let y = 0; y < R; y++) for (let x = 0; x < R; x++) fn(x, y, y * R + x, x / R, y / R);
}

// ---------- materials ----------
function stone(t, opt = {}) {
  const base = opt.base || [128, 128, 130];
  const seed = opt.seed ?? t.seed;
  fill(t, (x, y, i, u, v) => {
    const wu = u + (fbm(u, v, 3, 2, seed + 40) - 0.5) * 0.2;
    const wv = v + (fbm(u, v, 3, 2, seed + 41) - 0.5) * 0.2;
    // broad light/dark patches, rock facets, fine mineral grain and a few cracks
    const n = fbm(wu, wv, 3, 5, seed);
    const patch = smooth(0.3, 0.7, fbm(u, v, 2, 3, seed + 12));
    const vo = voronoi(x, y, 6, seed + 5, 1);
    const facet = hash2(vo.id, 3, seed) - 0.5;
    const facetEdge = smooth(1.6, 0.4, vo.f2 - vo.f1);
    const grain = white(x, y, seed + 3);
    const crack = smooth(0.86, 0.96, ridge(wu, wv, 3, 3, seed + 7));
    let k = 0.62 + (n - 0.5) * 0.9 + patch * 0.22 + facet * 0.06 - facetEdge * 0.03 + (grain - 0.5) * 0.16 - crack * 0.3;
    if (grain > 0.975) k += 0.12; else if (grain < 0.02) k -= 0.14;
    let c = scalec(base, k);
    const tint = fbm(u, v, 2, 2, seed + 91) - 0.5;
    c = [c[0] * (1 + tint * 0.08), c[1], c[2] * (1 - tint * 0.08)];
    t.set(x, y, c);
    t.height[i] = clamp01(0.35 + (n - 0.5) * 0.8 + facet * 0.12 + patch * 0.15 - facetEdge * 0.05 - crack * 0.45 + (grain - 0.5) * 0.06);
    t.rough[i] = clamp01(0.74 + (grain - 0.5) * 0.14 + crack * 0.1);
  });
  t.normalStrength = opt.normal ?? 1.6;
}

function dirt(t, opt = {}) {
  const base = opt.base || [128, 92, 64];
  fill(t, (x, y, i, u, v) => {
    const n = fbm(u, v, 4, 5, t.seed);
    const clod = fbm(u, v, 8, 2, t.seed + 5);
    const grain = white(x, y, t.seed + 1);
    let c = scalec(base, 0.68 + n * 0.5 + (grain - 0.5) * 0.14);
    let h = 0.3 + n * 0.5 + clod * 0.2;
    // pebbles
    const vo = voronoi(x, y, 9, t.seed + 17, 1);
    const pr = 1.3 + hash2(vo.id, 1, t.seed) * 2.2;
    if (hash2(vo.id, 2, t.seed) > 0.55 && vo.f1 < pr) {
      const k = 1 - vo.f1 / pr;
      c = mixc(c, scalec([146, 136, 124], 0.8 + hash2(vo.id, 3, t.seed) * 0.4), smooth(0, 0.35, k));
      h = Math.max(h, 0.55 + k * 0.45);
    }
    // small dark roots / organic flecks
    if (grain > 0.985) { c = scalec(c, 0.6); h -= 0.1; }
    t.set(x, y, c, opt.alpha ?? 1);
    t.height[i] = clamp01(h);
    t.rough[i] = 0.95;
  });
  t.normalStrength = 1.6;
}

// Grass seen from above: a dense carpet of short blades in every direction, with glimpses of
// soil between them (soil pixels are untinted: alpha 0).
function grassTop(t) {
  fill(t, (x, y, i, u, v) => {
    const n = fbm(u, v, 4, 3, t.seed + 4);
    const g = 70 + n * 30;
    t.set(x, y, [g * 0.9, g * 0.75, g * 0.55], 0); // soil
    t.height[i] = 0.05 + n * 0.1;
    t.rough[i] = 0.95;
  });
  const rand = mulberry32(t.seed);
  for (let b = 0; b < 900; b++) {
    const x0 = rand() * R, y0 = rand() * R;
    const ang = rand() * Math.PI * 2;
    const len = 3 + rand() * 6;
    const shade = 0.55 + rand() * 0.45;
    const clump = fbm(x0 / R, y0 / R, 4, 2, t.seed + 9);
    stroke(t, x0, y0, len, ang, 1.6, 0.6, (k) => {
      const g = (150 + k * 70) * shade * (0.85 + clump * 0.3);
      return [g, g, g];
    }, { height: (k) => 0.45 + k * 0.5 + shade * 0.05, rough: 0.7, curve: (rand() - 0.5) * 0.8 });
    // mark as tinted grass
    const i = wrap(Math.round(y0), R) * R + wrap(Math.round(x0), R);
    t.albedo[i * 4 + 3] = 1;
  }
  // everything that got grass colour counts as tinted
  fill(t, (x, y, i) => {
    const o = i * 4;
    const A = t.albedo;
    const grey = Math.abs(A[o] - A[o + 1]) < 6 && Math.abs(A[o + 1] - A[o + 2]) < 6;
    if (t.height[i] > 0.3 && grey) A[o + 3] = 1;
  });
  t.normalStrength = 1.3;
}

function grassSide(t, snow = false) {
  dirt(t, { alpha: 0 });
  const rand = mulberry32(t.seed + 3);
  // the fringe: a band at the top plus blades hanging over the edge
  for (let x = 0; x < R; x++) {
    const depth = 10 + fbm(x / R, 0.5, 8, 2, t.seed + 5) * 10 + (white(x, 0, t.seed + 1) > 0.85 ? 6 : 0);
    for (let y = 0; y < R; y++) {
      const i = y * R + x;
      if (y > depth + 2) continue;
      const edge = smooth(depth + 2, depth - 1, y);
      if (edge <= 0) continue;
      if (snow) {
        const n = white(x, y, t.seed + 9);
        t.set(x, y, mixc(t.get(x, y), scalec([236, 246, 252], 0.93 + n * 0.07), edge), 1);
        t.height[i] = lerp(t.height[i], 0.85 + n * 0.1, edge);
        t.rough[i] = lerp(t.rough[i], 0.55, edge);
      } else {
        const n = fbm(x / R, y / R, 8, 3, t.seed + 11);
        const g = 120 + n * 90 + (white(x, y, t.seed) - 0.5) * 30;
        const c = mixc(t.get(x, y), [g, g, g], edge);
        t.set(x, y, c, edge > 0.5 ? 1 : 0);
        t.height[i] = lerp(t.height[i], 0.7 + n * 0.25, edge);
        t.rough[i] = lerp(t.rough[i], 0.72, edge);
      }
    }
  }
  if (!snow) {
    for (let b = 0; b < 70; b++) {
      const x0 = rand() * R;
      const y0 = 6 + rand() * 12;
      const len = 4 + rand() * 10;
      const ang = Math.PI / 2 + (rand() - 0.5) * 0.7;
      const shade = 0.7 + rand() * 0.35;
      stroke(t, x0, y0, len, ang, 2, 0.6, (k) => { const g = (190 - k * 60) * shade; return [g, g, g]; },
        { height: () => 0.8, rough: 0.72 });
    }
    fill(t, (x, y, i) => {
      const A = t.albedo, o = i * 4;
      const grey = Math.abs(A[o] - A[o + 1]) < 8 && Math.abs(A[o + 1] - A[o + 2]) < 8;
      if (grey && y < 36) A[o + 3] = 1;
    });
  }
}

function sand(t, base, opt = {}) {
  fill(t, (x, y, i, u, v) => {
    const grain = white(x, y, t.seed);
    const n = fbm(u, v, 4, 4, t.seed + 1);
    // wind ripples
    const rip = Math.sin((v + (fbm(u, v, 2, 2, t.seed + 7) - 0.5) * 0.3) * Math.PI * 2 * (opt.ripples ?? 6));
    let c = scalec(base, 0.86 + n * 0.14 + (grain - 0.5) * 0.14 + rip * 0.03);
    if (grain > 0.97) c = scalec(c, 0.78);
    else if (grain < 0.02) c = mixc(c, [240, 236, 220], 0.5);
    t.set(x, y, c);
    t.height[i] = clamp01(0.45 + rip * 0.12 * (opt.rippleDepth ?? 1) + n * 0.25 + (grain - 0.5) * 0.1);
    t.rough[i] = opt.rough ?? 0.9;
  });
  t.normalStrength = opt.normal ?? 1.0;
}

function gravel(t) {
  const cols = [[140, 130, 126], [112, 104, 100], [158, 150, 144], [96, 90, 88], [132, 118, 104], [120, 122, 126]];
  fill(t, (x, y, i) => {
    const vo = voronoi(x, y, 11, t.seed, 1);
    const edge = vo.f2 - vo.f1;
    const r = vo.cell * 0.55;
    const dome = clamp01(1 - (vo.f1 / r) ** 2);
    const col = cols[vo.id % cols.length];
    let c = scalec(col, 0.8 + hash2(vo.id, 4, t.seed) * 0.35 + (white(x, y, t.seed) - 0.5) * 0.12);
    // light from the upper left on each pebble
    const dx = x + 0.5 - vo.fx, dy = y + 0.5 - vo.fy;
    c = scalec(c, 1 - (dx + dy) / (r * 8));
    let h = 0.2 + dome * 0.8;
    if (edge < 1.2) { c = [66, 60, 58]; h = 0.0; }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = 0.85;
  });
  t.normalStrength = 2.0;
}

function cobble(t, pal, opt = {}) {
  fill(t, (x, y, i, u, v) => {
    const vo = voronoi(x, y, 5, t.seed, 0.9);
    const edge = vo.f2 - vo.f1;
    const shade = hash2(vo.id, 3, t.seed);
    const r = vo.cell * 0.62;
    const dome = clamp01(1 - (vo.f1 / r) ** 2.2);
    const dx = x + 0.5 - vo.fx, dy = y + 0.5 - vo.fy;
    const n = fbm(u, v, 8, 3, t.seed + vo.id);
    let c = scalec(pal.stone, 0.66 + shade * 0.4 + n * 0.2 - (dx + dy) / (r * 10));
    let h = 0.3 + dome * 0.6 + n * 0.1;
    let rough = 0.85;
    const gap = smooth(2.4, 1.2, edge);
    if (gap > 0) {
      c = mixc(c, scalec(pal.mortar, 0.9 + white(x, y, t.seed) * 0.2), gap);
      h = lerp(h, 0.02, gap);
      rough = lerp(rough, 0.97, gap);
    }
    if (opt.moss) {
      const m = fbm(u, v, 3, 4, t.seed + 99) + gap * 0.25 + (1 - dome) * 0.12;
      const mk = smooth(0.58, 0.68, m);
      if (mk > 0) {
        const mn = white(x, y, t.seed + 8);
        c = mixc(c, mixc(pal.moss, pal.mossLight, mn), mk);
        h = lerp(h, h + 0.08 + mn * 0.06, mk);
        rough = lerp(rough, 0.97, mk);
      }
    }
    t.set(x, y, c);
    t.height[i] = clamp01(h);
    t.rough[i] = rough;
  });
  t.normalStrength = 2.2;
}

// Bricks laid in rows; bw x bh in texels, with recessed mortar and chipped edges.
function bricks(t, pal, bw, bh, opt = {}) {
  const m = opt.mortar ?? 3;
  fill(t, (x, y, i, u, v) => {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    const bx = Math.floor((x + off) / bw);
    const lx = (x + off) % bw, ly = y % bh;
    const chip = fbm(u, v, 8, 2, t.seed + 3) * 2.2;
    const dEdge = Math.min(lx, bw - 1 - lx, ly, bh - 1 - ly) - chip * 0.6;
    const mortar = dEdge < m * 0.5;
    const shade = hash2(bx + row * 7, row, t.seed);
    const n = fbm(u, v, 8, 4, t.seed + bx * 3 + row);
    let c = scalec(pal.brick, 0.78 + shade * 0.3 + (n - 0.5) * 0.25);
    let h = 0.55 + n * 0.25 + smooth(0, 3, dEdge) * 0.2;
    if (opt.crack) {
      const cr = ridge(u + bx * 0.13, v + row * 0.21, 3, 2, t.seed + 60);
      if (cr > 0.9 && hash2(bx, row, t.seed + 2) > 0.6) { c = scalec(c, 0.7); h -= 0.2; }
    }
    if (mortar) {
      c = scalec(pal.mortar, 0.85 + white(x, y, t.seed + 3) * 0.25);
      h = 0.08 + white(x, y, t.seed + 4) * 0.05;
    }
    t.set(x, y, c);
    t.height[i] = clamp01(h);
    t.rough[i] = mortar ? 0.97 : opt.rough ?? 0.82;
  });
  t.normalStrength = 2.0;
}

function planks(t, pal) {
  const boards = 4, bh = R / boards;
  fill(t, (x, y, i, u, v) => {
    const b = Math.floor(y / bh);
    const yy = y - b * bh;
    const seam = [12, 44, 28, 56][b];
    const shift = hash2(b, 0, t.seed) * R;
    // wood grain: warped stripes running along the board
    const wu = (x + shift) / R;
    const warp = fbm(wu, (y + b * 11) / R, 2, 3, t.seed + b) * 3.0;
    const ring = Math.sin((y / bh * 3.2 + warp + b) * Math.PI * 2) * 0.5 + 0.5;
    const fine = fbmA(wu, y / R, 16, 2, 2, t.seed + 20 + b);
    let c = mixc(pal.dark, pal.light, clamp01(ring * 0.55 + fine * 0.45));
    let h = 0.6 + ring * 0.15 + fine * 0.1;
    // knot
    const kx = wrap(x - Math.floor(hash2(b, 5, t.seed) * R), R), ky = yy - bh * 0.5;
    const kd = Math.hypot(Math.min(kx, R - kx) * 0.8, ky);
    if (hash2(b, 6, t.seed) > 0.5 && kd < 4) { c = mixc(c, pal.seam, smooth(4, 1, kd) * 0.7); h -= smooth(4, 0, kd) * 0.15; }
    // gaps between boards and butt joints
    const gapY = yy < 1 || yy > bh - 2;
    const gapX = Math.abs(x - seam) < 1;
    if (gapY || gapX) { c = scalec(pal.seam, 0.9); h = 0.05; }
    else if (yy < 3) { c = scalec(c, 1.05); }
    // nails at the joints
    if (!gapY && Math.abs(Math.abs(x - seam) - 3) < 1 && Math.abs(yy - bh / 2) < 1) { c = [70, 66, 62]; h = 0.75; t.metal[i] = 0.8; }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = 0.7 + fine * 0.1;
  });
  t.normalStrength = 1.5;
}

function bark(t, pal, opt = {}) {
  fill(t, (x, y, i, u, v) => {
    // long vertical ridges split by deep, wandering furrows, broken now and then by a cross crack
    const wx = x + (fbmA(u, v, 2, 3, 2, t.seed + 5) - 0.5) * 10;
    const vo = voronoiA(wx, y, 7, 1, t.seed, 0.8);
    const fis = smooth(0.2, 0.03, vo.f2 - vo.f1);
    const plate = hash2(vo.id, 1, t.seed);
    const stri = fbmA(u, v, 32, 2, 2, t.seed + 3);
    const cross = smooth(0.9, 0.97, ridge(u * 0.5, v, 1, 2, t.seed + 11) * (0.6 + plate * 0.4));
    const fine = white(x, y, t.seed + 4);
    const dome = clamp01(1 - vo.f1 * 1.4);
    let c = mixc(pal.dark, pal.light, clamp01(0.2 + plate * 0.35 + stri * 0.35 + dome * 0.2 + (fine - 0.5) * 0.15));
    c = mixc(c, pal.groove, Math.max(fis, cross * 0.8));
    let h = 0.3 + dome * 0.4 + stri * 0.2 - fis * 0.55 - cross * 0.35;
    if (opt.moss) {
      const m = fbm(u, v, 3, 3, t.seed + 50) + fis * 0.2;
      const mk = smooth(0.64, 0.74, m);
      c = mixc(c, [74, 98, 44], mk * 0.75);
      h += mk * 0.05;
    }
    t.set(x, y, c);
    t.height[i] = clamp01(h);
    t.rough[i] = 0.93;
  });
  t.normalStrength = opt.normal ?? 2.2;
}

function birchBark(t) {
  fill(t, (x, y, i, u, v) => {
    const n = fbm(u, v, 4, 4, t.seed);
    let c = mixc([198, 196, 186], [238, 236, 228], n);
    let h = 0.6 + n * 0.2;
    // horizontal lenticels
    const band = fbmA(u, v, 3, 16, 2, t.seed + 3);
    const len = fbmA(u, v, 6, 32, 2, t.seed + 5);
    if (band > 0.62 && len > 0.55) { const k = smooth(0.62, 0.72, band); c = mixc(c, [48, 44, 40], k); h -= k * 0.35; }
    // peeling patches
    const peel = fbm(u, v, 3, 3, t.seed + 9);
    if (peel > 0.68) { c = mixc(c, [214, 170, 140], smooth(0.68, 0.74, peel) * 0.6); h += 0.08; }
    t.set(x, y, c);
    t.height[i] = clamp01(h);
    t.rough[i] = 0.75;
  });
  t.normalStrength = 1.4;
}

function logTop(t, pal) {
  const c0 = (R - 1) / 2;
  fill(t, (x, y, i, u, v) => {
    const dx = x - c0, dy = y - c0;
    const edge = Math.max(Math.abs(dx), Math.abs(dy));
    const wob = (fbm(u, v, 4, 2, t.seed) - 0.5) * 3;
    const r = Math.hypot(dx, dy) + wob;
    const ring = Math.sin(r * 0.95) * 0.5 + 0.5;
    const ang = Math.atan2(dy, dx);
    const crack = Math.abs(Math.sin(ang * 3 + hash2(1, 2, t.seed) * 6)) < 0.04 && r > 6 && r < 26;
    let c, h;
    if (edge > c0 - 4 + white(x, y, t.seed) * 1.5) {
      c = scalec(pal.bark, 0.8 + white(x, y, t.seed + 1) * 0.3);
      h = 0.45 + white(x, y, t.seed + 2) * 0.3;
    } else {
      c = mixc(pal.ringDark, pal.ringLight, ring);
      h = 0.55 + ring * 0.15;
      if (r < 3) { c = pal.ringDark; }
      if (crack) { c = scalec(pal.ringDark, 0.6); h = 0.25; }
    }
    t.set(x, y, scalec(c, 0.95 + white(x, y, t.seed + 5) * 0.08));
    t.height[i] = h;
    t.rough[i] = 0.82;
  });
  t.normalStrength = 1.3;
}

// Leaves: hundreds of small overlapping leaves on a transparent background.
function leaves(t, opt = {}) {
  fill(t, (x, y) => t.set(x, y, [60, 60, 60], 0));
  const rand = mulberry32(t.seed);
  const count = opt.count ?? 150;
  const needles = !!opt.needles;
  for (let k = 0; k < count; k++) {
    const cx = rand() * R, cy = rand() * R;
    const ang = rand() * Math.PI * 2;
    const size = (opt.size ?? 5) * (0.7 + rand() * 0.6);
    const shade = 0.55 + rand() * 0.5;
    if (needles) {
      // spruce: little sprays of needles along a twig
      for (let n = -3; n <= 3; n++) {
        const px = cx + Math.cos(ang) * n * 1.4, py = cy + Math.sin(ang) * n * 1.4;
        for (const side of [-1, 1]) {
          const a2 = ang + side * 1.0;
          stroke(t, px, py, size * 0.7, a2, 1.1, 0.5, (q) => { const g = (110 + q * 70) * shade; return [g, g, g]; },
            { cutout: true, height: (q) => 0.5 + (1 - q) * 0.3 });
        }
      }
    } else {
      // oak-like leaf: an ellipse with a pointed tip and a lighter midrib
      const len = size * 1.25, wid = size * 0.6;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      for (let j = -Math.ceil(len); j <= Math.ceil(len); j++) {
        for (let q = -Math.ceil(len); q <= Math.ceil(len); q++) {
          const lx = q * ca + j * sa, ly = -q * sa + j * ca; // leaf space
          const along = lx / len; // -1..1
          const halfW = wid * Math.sqrt(Math.max(0, 1 - along * along)) * (along > 0.3 ? (1 - (along - 0.3) * 0.9) : 1);
          const d = Math.abs(ly) - halfW;
          if (d > 0.7 || Math.abs(along) > 1) continue;
          const cov = clamp01(0.7 - d);
          const rib = Math.abs(ly) < 0.6 ? 1 : 0;
          const vein = Math.abs(Math.sin((lx * 0.9 - Math.abs(ly)) * 1.6)) < 0.18 ? 1 : 0;
          const g = (118 + (1 - Math.abs(ly) / (wid + 0.01)) * 40 + rib * 26 + vein * 10 - (along + 1) * 6) * shade;
          const px = cx + q, py = cy + j;
          const i = wrap(Math.round(py), R) * R + wrap(Math.round(px), R);
          if (cov > 0.5) t.albedo[i * 4 + 3] = 1;
          put(t, px, py, [g, g, g], cov, 0.45 + (1 - Math.abs(ly) / (wid + 0.01)) * 0.4);
        }
      }
    }
  }
  fill(t, (x, y, i) => { t.rough[i] = 0.55; });
  t.cutout = true;
  t.normalStrength = 1.2;
}

function ore(t, fleck, opt = {}) {
  stone(t, { seed: 1234567 });
  const rand = mulberry32(t.seed);
  const clusters = opt.clusters ?? 6;
  for (let k = 0; k < clusters; k++) {
    const cx = rand() * R, cy = rand() * R;
    const nodes = 3 + Math.floor(rand() * 4);
    for (let j = 0; j < nodes; j++) {
      const nx = cx + (rand() - 0.5) * 10, ny = cy + (rand() - 0.5) * 10;
      const rad = (1.2 + rand() * 1.8) * (opt.scale ?? 1);
      for (let dy = -4; dy <= 4; dy++) {
        for (let dx = -4; dx <= 4; dx++) {
          // faceted crystals for gems, rounded nuggets for metals
          const d = opt.facets ? Math.max(Math.abs(dx + dy * 0.5), Math.abs(dy)) : Math.hypot(dx, dy);
          if (d > rad) continue;
          const k2 = 1 - d / rad;
          const x = wrap(Math.round(nx + dx), R), y = wrap(Math.round(ny + dy), R);
          const i = y * R + x;
          const light = opt.facets ? ((dx - dy) > 0 ? 1.15 : 0.8) : 0.8 + k2 * 0.35 - (dx + dy) * 0.03;
          t.set(x, y, scalec(fleck, light * (0.9 + white(x, y, t.seed) * 0.2)));
          t.height[i] = 0.7 + k2 * 0.3;
          t.rough[i] = opt.rough ?? 0.35;
          t.metal[i] = opt.metal ?? 0;
          if (opt.emit) t.emit[i] = opt.emit * k2;
        }
      }
    }
  }
}

function metal(t, pal, opt = {}) {
  fill(t, (x, y, i, u, v) => {
    const edge = Math.min(x, y, R - 1 - x, R - 1 - y);
    const brush = fbmA(u, v, 1, 32, 3, t.seed) * 0.6 + fbm(u, v, 4, 3, t.seed + 1) * 0.4;
    let c = mixc(pal.dark, pal.light, clamp01(0.3 + brush * 0.7 - (x + y) / (R * 5)));
    let h = 0.78 + brush * 0.08;
    if (edge < 2) { c = scalec(pal.dark, 0.8); h = 0.25; }
    else if (edge < 4) { c = x < 4 || y < 4 ? pal.light : mixc(pal.dark, pal.light, 0.35); h = 0.55; }
    if (opt.rivets) {
      for (const [rx, ry] of [[9, 9], [54, 9], [9, 54], [54, 54]]) {
        const d = Math.hypot(x - rx, y - ry);
        if (d < 3) { const k = 1 - d / 3; c = mixc(c, pal.light, k * 0.6); h = 0.8 + k * 0.2; }
      }
      if ((Math.abs(y - 21) < 1 || Math.abs(y - 42) < 1) && edge > 4) { c = scalec(c, 0.85); h = 0.6; }
    }
    if (opt.gem) {
      // faceted crystal plates
      const vo = voronoi(x, y, 4, t.seed, 0.7);
      const f = hash2(vo.id, 1, t.seed);
      if (edge >= 4) { c = mixc(pal.dark, pal.light, clamp01(0.3 + f * 0.7)); h = 0.6 + f * 0.3; if (vo.f2 - vo.f1 < 1.2) { c = scalec(pal.dark, 0.9); h = 0.4; } }
    }
    t.set(x, y, c);
    t.height[i] = h;
    t.rough[i] = (opt.rough ?? 0.25) + (brush - 0.5) * 0.08;
    t.metal[i] = opt.metal ?? 1;
  });
  t.normalStrength = 1.1;
}

function wool(t, color) {
  const base = hex(color);
  fill(t, (x, y, i, u, v) => {
    // knitted V stitches: columns of chevrons
    const cw = 8, ch = 6;
    const cx = x % cw - cw / 2 + 0.5, cy = y % ch;
    const chev = Math.abs(Math.abs(cx) * 0.9 - (cy - ch / 2) * 0.7);
    const st = smooth(2.2, 0.4, chev);
    const fuzz = fbm(u, v, 16, 2, 4242) * 0.5 + white(x, y, 7) * 0.5;
    const c = scalec(base, 0.84 + st * 0.1 + fuzz * 0.14);
    t.set(x, y, c);
    t.height[i] = 0.35 + st * 0.5 + fuzz * 0.1;
    t.rough[i] = 1.0;
  });
  t.normalStrength = 1.3;
}

function plant(t, draw) {
  fill(t, (x, y) => t.set(x, y, [0, 0, 0], 0));
  draw(t, mulberry32(t.seed));
  t.cutout = true;
  fill(t, (x, y, i) => { t.rough[i] = 0.6; t.height[i] = 0.5; });
  t.normalStrength = 0;
}

function flower(t, rand, petals, center, round) {
  const green = (k) => mixc([46, 96, 30], [80, 146, 48], k);
  stroke(t, 32, 63, 30, -Math.PI / 2 + (rand() - 0.5) * 0.1, 3.2, 2.4, green, { cutout: true, noWrap: true });
  // two leaves on the stem
  stroke(t, 32, 52, 12, -Math.PI / 2 - 0.9, 4.5, 0.8, (k) => green(0.5 + k * 0.5), { cutout: true, curve: 0.6, noWrap: true });
  stroke(t, 32, 46, 11, -Math.PI / 2 + 0.9, 4.2, 0.8, (k) => green(0.5 + k * 0.5), { cutout: true, curve: -0.6, noWrap: true });
  const cx = 32, cy = 20;
  const n = round ? 16 : 6;
  for (let p = 0; p < n; p++) {
    const a = (p / n) * Math.PI * 2 + rand() * 0.2;
    const len = round ? 11 : 13;
    stroke(t, cx, cy, len, a, round ? 3 : 7, round ? 2 : 3, (k) => mixc(petals[1], petals[0], k), { cutout: true, noWrap: true, curve: round ? 0 : 0.3 });
  }
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = Math.hypot(dx, dy);
    if (d <= 4) { const i = (cy + dy) * R + (cx + dx); t.albedo[i * 4 + 3] = 1; put(t, cx + dx, cy + dy, scalec(center, 0.8 + (1 - d / 4) * 0.4), 1); }
  }
}

function glowCells(t, pal, cells, opt = {}) {
  fill(t, (x, y, i) => {
    const vo = voronoi(x, y, cells, t.seed, opt.jitter ?? 1);
    const edge = vo.f2 - vo.f1;
    const n = hash2(vo.id, 1, t.seed);
    const inner = clamp01(1 - vo.f1 / (vo.cell * 0.7));
    let c = ramp(pal, clamp01(n * 0.5 + inner * 0.5));
    let e = 0.45 + n * 0.3 + inner * 0.25;
    let h = 0.5 + inner * 0.4;
    if (edge < 1.6) { c = opt.gap; e = 0.08; h = 0.1; }
    const border = Math.min(x, y, R - 1 - x, R - 1 - y);
    if (opt.frame && border < 3) { c = opt.frame; e = 0.2; h = 0.3; }
    t.set(x, y, c);
    t.emit[i] = e;
    t.height[i] = h;
    t.rough[i] = opt.rough ?? 0.45;
  });
  t.normalStrength = 1.4;
}

// ---------- catalogue ----------
const GEN = {
  stone: (t) => stone(t),
  smooth_stone: (t) => {
    fill(t, (x, y, i, u, v) => {
      const edge = Math.min(x, y, R - 1 - x, R - 1 - y);
      const n = fbm(u, v, 3, 4, t.seed);
      let c = scalec([168, 168, 170], 0.92 + n * 0.12);
      let h = 0.72 + n * 0.05;
      if (edge < 3) { c = scalec([120, 120, 122], 0.95 + n * 0.1); h = 0.3; }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.42 + n * 0.1;
    });
    t.normalStrength = 1.0;
  },
  bedrock: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 4, 4, t.seed);
      const r = ridge(u, v, 3, 3, t.seed + 5);
      const g = 34 + n * 70 + r * 40;
      t.set(x, y, [g, g * 0.98, g * 1.02]);
      t.height[i] = clamp01(n * 0.6 + r * 0.4);
      t.rough[i] = 0.9;
    });
    t.normalStrength = 2.6;
  },
  dirt: (t) => dirt(t),
  grass_top: (t) => grassTop(t),
  grass_side: (t) => grassSide(t),
  grass_snow_side: (t) => grassSide(t, true),
  snow: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 3, 4, t.seed);
      const sp = white(x, y, t.seed + 3);
      let c = mixc([206, 222, 234], [250, 253, 255], clamp01(n * 1.3));
      t.set(x, y, c);
      t.height[i] = n;
      // sparkling ice crystals: very smooth single texels
      t.rough[i] = sp > 0.985 ? 0.08 : 0.58;
    });
    t.normalStrength = 0.9;
  },
  sand: (t) => sand(t, [219, 206, 160]),
  gravel: (t) => gravel(t),
  clay: (t) => sand(t, [160, 166, 180], { rough: 0.62, normal: 0.6, ripples: 0, rippleDepth: 0 }),
  cobblestone: (t) => cobble(t, { stone: [128, 128, 130], mortar: [66, 66, 66] }),
  mossy_cobblestone: (t) => cobble(t, { stone: [122, 126, 120], mortar: [62, 68, 56], moss: [62, 100, 36], mossLight: [100, 140, 56] }, { moss: true }),
  stone_bricks: (t) => bricks(t, { brick: [126, 126, 128], mortar: [92, 92, 92] }, 32, 32, { crack: true, mortar: 3 }),
  bricks: (t) => bricks(t, { brick: [150, 76, 58], mortar: [176, 168, 156] }, 32, 16),
  oak_planks: (t) => planks(t, { light: [190, 152, 96], dark: [146, 112, 66], seam: [84, 62, 36] }),
  birch_planks: (t) => planks(t, { light: [222, 206, 154], dark: [186, 166, 112], seam: [124, 108, 72] }),
  spruce_planks: (t) => planks(t, { light: [140, 106, 68], dark: [108, 80, 50], seam: [58, 42, 26] }),
  oak_log: (t) => bark(t, { light: [126, 102, 66], dark: [88, 70, 44], groove: [50, 38, 22] }, { moss: true }),
  oak_log_top: (t) => logTop(t, { bark: [94, 74, 46], ringLight: [184, 150, 96], ringDark: [146, 114, 68] }),
  spruce_log: (t) => bark(t, { light: [104, 76, 48], dark: [72, 52, 32], groove: [40, 28, 16] }),
  spruce_log_top: (t) => logTop(t, { bark: [76, 56, 34], ringLight: [150, 114, 70], ringDark: [116, 86, 52] }),
  birch_log: (t) => birchBark(t),
  birch_log_top: (t) => logTop(t, { bark: [214, 212, 204], ringLight: [218, 200, 146], ringDark: [190, 170, 116] }),
  oak_leaves: (t) => leaves(t, { count: 210, size: 3.8 }),
  spruce_leaves: (t) => leaves(t, { count: 70, size: 5, needles: true }),
  water: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 4, 3, t.seed);
      t.set(x, y, mixc([40, 90, 190], [80, 140, 230], n), 0.7);
      t.rough[i] = 0.05;
    });
  },
  lava: (t) => {
    fill(t, (x, y, i, u, v) => {
      const vo = voronoi(x + (fbm(u, v, 3, 2, t.seed + 9) - 0.5) * 8, y, 5, t.seed, 1);
      const edge = vo.f2 - vo.f1;
      const n = fbm(u, v, 4, 4, t.seed + 2);
      const pool = smooth(0.6, 0.72, fbm(u, v, 2, 3, t.seed + 21));
      // cooling crust plates on molten rock: glowing seams and the odd open pool
      const seam = smooth(4.5, 0.5, edge);
      const hot = clamp01(Math.max(seam, pool) + (n - 0.5) * 0.3);
      const crustCol = mixc([42, 14, 8], [96, 34, 14], n);
      const moltenCol = ramp([[0, [190, 50, 8]], [0.55, [250, 130, 20]], [1, [255, 236, 150]]], clamp01(hot * 0.9 + n * 0.2));
      const c = mixc(crustCol, moltenCol, hot);
      t.set(x, y, c);
      t.emit[i] = clamp01(0.08 + hot * 0.92);
      t.height[i] = clamp01(0.75 - hot * 0.6 + n * 0.1);
      t.rough[i] = 0.5 + (1 - hot) * 0.42;
    });
    t.normalStrength = 1.8;
  },
  coal_ore: (t) => ore(t, [34, 34, 36], { rough: 0.5, clusters: 7, scale: 0.9 }),
  iron_ore: (t) => ore(t, [216, 170, 128], { rough: 0.35, metal: 0.7, clusters: 6 }),
  gold_ore: (t) => ore(t, [252, 222, 70], { rough: 0.22, metal: 1 }),
  diamond_ore: (t) => ore(t, [100, 236, 244], { rough: 0.05, clusters: 5, facets: true }),
  glass: (t) => {
    fill(t, (x, y, i, u, v) => {
      const edge = Math.min(x, y, R - 1 - x, R - 1 - y);
      const smudge = fbm(u, v, 3, 3, t.seed);
      const d = x - y;
      const streak = (d > 14 && d < 18 && x > 16 && x < 38) || (d > 22 && d < 25 && x > 32 && x < 48) || (d < -18 && d > -21 && y > 26 && y < 42);
      if (edge < 3) t.set(x, y, mixc([196, 214, 220], [230, 242, 246], smudge), 1);
      else if (streak) t.set(x, y, [240, 250, 255], 1);
      else t.set(x, y, [200, 220, 230], 0);
      t.rough[i] = 0.04 + smudge * 0.06;
      t.height[i] = edge < 3 ? 0.75 : 0.5;
    });
    t.cutout = true;
    t.normalStrength = 0.6;
  },
  ice: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 2, 4, t.seed);
      const cr = Math.max(ridge(u, v, 2, 3, t.seed + 3), ridge(u + 0.37, v, 3, 2, t.seed + 8) * 0.97);
      const crack = cr > 0.86;
      const bubble = white(x, y, t.seed + 5) > 0.992;
      let c = mixc([146, 182, 248], [200, 226, 255], n);
      if (crack) c = [228, 242, 255];
      if (bubble) c = [236, 246, 255];
      t.set(x, y, c, 0.72);
      t.rough[i] = crack ? 0.35 : 0.03;
      t.height[i] = crack ? 0.35 : 0.6;
    });
    t.normalStrength = 0.7;
  },
  cactus_side: (t) => {
    fill(t, (x, y, i, u, v) => {
      const inset = x < 4 || x > R - 5;
      const ridgeK = Math.abs(Math.sin(((x - 4) / (R - 8)) * Math.PI * 4));
      const n = fbm(u, v, 4, 3, t.seed);
      let c = scalec([82, 136, 40], 0.75 + ridgeK * 0.3 + n * 0.12);
      let h = 0.3 + ridgeK * 0.6;
      // spines along the ridges
      if (ridgeK > 0.97 && (y % 9) < 2) { c = [228, 224, 190]; h = 1; }
      t.set(x, y, inset ? [0, 0, 0] : c, inset ? 0 : 1);
      t.height[i] = h;
      t.rough[i] = 0.45;
    });
    t.cutout = true;
    t.normalStrength = 1.4;
  },
  cactus_top: (t) => {
    const c0 = (R - 1) / 2;
    fill(t, (x, y, i, u, v) => {
      const inset = x < 4 || y < 4 || x > R - 5 || y > R - 5;
      const r = Math.hypot(x - c0, y - c0);
      const ring = Math.sin(r * 0.8) * 0.5 + 0.5;
      let c = scalec([100, 154, 50], 0.8 + ring * 0.2 + fbm(u, v, 4, 2, t.seed) * 0.1);
      if (r < 5) c = mixc(c, [150, 180, 90], 0.5);
      t.set(x, y, inset ? [0, 0, 0] : c, inset ? 0 : 1);
      t.height[i] = 0.4 + ring * 0.3;
      t.rough[i] = 0.5;
    });
    t.cutout = true;
  },
  tall_grass: (t) => plant(t, (t, rand) => {
    for (let b = 0; b < 26; b++) {
      const x0 = 6 + rand() * 52;
      const len = 26 + rand() * 34;
      const ang = -Math.PI / 2 + (rand() - 0.5) * 0.5;
      const shade = 0.7 + rand() * 0.35;
      stroke(t, x0, 63, len, ang, 3.2, 0.7, (k) => { const g = (110 + k * 110) * shade; return [g, g, g]; },
        { cutout: true, curve: (rand() - 0.5) * 0.9, noWrap: true });
    }
  }),
  fern: (t) => plant(t, (t, rand) => {
    for (let f = 0; f < 5; f++) {
      const x0 = 12 + f * 10 + rand() * 4;
      const len = 36 + rand() * 20;
      const ang = -Math.PI / 2 + (f - 2) * 0.22;
      // frond: a stem with alternating leaflets that shrink towards the tip
      let x = x0, y = 63;
      const steps = Math.floor(len / 2);
      for (let s = 0; s < steps; s++) {
        const k = s / steps;
        const a = ang + k * (f - 2) * 0.4;
        x += Math.cos(a) * 2; y += Math.sin(a) * 2;
        const g = 90 + k * 90;
        put(t, x, y, [g, g, g], 1);
        const wi = wrap(Math.round(y), R) * R + wrap(Math.round(x), R);
        if (x >= 0 && x < R && y >= 0) t.albedo[wi * 4 + 3] = 1;
        if (s > 2 && s % 2 === 0) {
          const ll = (1 - k) * 9 + 2;
          for (const side of [-1, 1]) stroke(t, x, y, ll, a + side * 1.25, 2.2, 0.6, () => [g * 0.92, g * 0.92, g * 0.92], { cutout: true, noWrap: true });
        }
      }
    }
  }),
  poppy: (t) => plant(t, (t, rand) => flower(t, rand, [[190, 22, 22], [236, 64, 50]], [40, 14, 14], false)),
  dandelion: (t) => plant(t, (t, rand) => flower(t, rand, [[248, 206, 30], [255, 240, 110]], [226, 150, 20], true)),
  cornflower: (t) => plant(t, (t, rand) => flower(t, rand, [[64, 98, 222], [126, 156, 250]], [34, 38, 108], false)),
  dead_bush: (t) => plant(t, (t, rand) => {
    const col = [118, 80, 40];
    const branch = (x, y, a, len, w, depth) => {
      stroke(t, x, y, len, a, w, w * 0.6, () => scalec(col, 0.8 + rand() * 0.3), { cutout: true, noWrap: true });
      if (depth > 3) return;
      const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
      const n = 2;
      for (let k = 0; k < n; k++) branch(ex, ey, a + (rand() - 0.5) * 1.3, len * 0.66, w * 0.7, depth + 1);
    };
    branch(32, 63, -Math.PI / 2 - 0.3, 16, 3, 0);
    branch(32, 63, -Math.PI / 2 + 0.35, 15, 3, 0);
  }),
  torch: (t) => plant(t, () => {
    // stick in columns 28-35, rows 24..63; flame rows 8..28 (same layout as the 16px torch, x4)
    for (let y = 24; y < R; y++) {
      for (let x = 28; x < 36; x++) {
        const k = (x - 28) / 7;
        const c = mixc([146, 110, 64], [96, 72, 40], k);
        t.set(x, y, scalec(c, (y > 55 ? 0.85 : 1) * (0.92 + white(x, y, 3) * 0.12)), 1);
      }
    }
    for (let y = 8; y < 30; y++) {
      for (let x = 22; x < 42; x++) {
        const dx = (x - 31.5) / 9, dy = (y - 22) / 13;
        const d = Math.hypot(dx * (1 + (22 - y) * 0.03), dy);
        if (d > 1) continue;
        const core = 1 - d;
        const c = ramp([[0, [240, 120, 30]], [0.4, [255, 190, 70]], [0.75, [255, 238, 170]], [1, [255, 252, 236]]], core);
        t.set(x, y, c, 1);
        t.emit[y * R + x] = 0.6 + core * 0.4;
      }
    }
  }),
  glowstone: (t) => glowCells(t, [[0, [146, 92, 42]], [0.5, [228, 172, 88]], [1, [255, 238, 176]]], 6, { gap: [96, 60, 30] }),
  sandstone: (t) => {
    fill(t, (x, y, i, u, v) => {
      // strata: wavy horizontal layers of slightly different sand, some eroded
      const layer = y + (fbm(u, v, 2, 2, t.seed) - 0.5) * 6;
      const band = Math.floor(layer / 8);
      const shade = 0.9 + hash2(band, 1, t.seed) * 0.12;
      const erode = hash2(band, 2, t.seed) > 0.7 ? smooth(0.5, 0.8, fbm(u, v, 8, 3, t.seed + band)) : 0;
      const grain = white(x, y, t.seed);
      let c = scalec([214, 198, 150], shade + (grain - 0.5) * 0.08 - erode * 0.12);
      t.set(x, y, c);
      t.height[i] = clamp01(0.6 - erode * 0.4 + (grain - 0.5) * 0.1 - (layer % 8 < 1 ? 0.2 : 0));
      t.rough[i] = 0.88;
    });
    t.normalStrength = 1.4;
  },
  sandstone_top: (t) => sand(t, [220, 206, 160], { normal: 0.7, ripples: 0, rippleDepth: 0 }),
  sandstone_bottom: (t) => sand(t, [204, 190, 144], { normal: 1.2, ripples: 0, rippleDepth: 0 }),
  obsidian: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 3, 4, t.seed);
      const vo = voronoi(x, y, 4, t.seed + 3, 1);
      const facet = hash2(vo.id, 2, t.seed);
      const sheen = smooth(0.7, 0.95, ridge(u, v, 2, 2, t.seed + 7));
      let c = mixc([14, 10, 24], [46, 30, 74], clamp01(n * 0.8 + facet * 0.3));
      c = mixc(c, [96, 72, 140], sheen * 0.6);
      t.set(x, y, c);
      t.height[i] = 0.4 + facet * 0.4 - (vo.f2 - vo.f1 < 1 ? 0.2 : 0);
      t.rough[i] = 0.08 + n * 0.08;
    });
    t.normalStrength = 1.0;
  },
  bookshelf: (t) => {
    const bookCols = [[140, 40, 36], [42, 70, 130], [52, 102, 52], [150, 120, 50], [100, 58, 110], [150, 76, 40], [60, 60, 70], [120, 30, 30]];
    const shelfTop = [6, 34];
    const rand = mulberry32(t.seed);
    planks(t, { light: [170, 136, 84], dark: [140, 108, 64], seam: [84, 62, 36] });
    for (let s = 0; s < 2; s++) {
      let x = 3;
      const y0 = shelfTop[s], y1 = y0 + 24;
      // back of the shelf
      for (let y = y0; y < y1; y++) for (let xx = 0; xx < R; xx++) { t.set(xx, y, [40, 30, 20]); t.height[y * R + xx] = 0.05; }
      while (x < R - 3) {
        const w = 4 + Math.floor(rand() * 4);
        const hgt = 16 + Math.floor(rand() * 8);
        const col = bookCols[Math.floor(rand() * bookCols.length)];
        for (let xx = x; xx < Math.min(R - 3, x + w); xx++) {
          for (let y = y1 - hgt; y < y1; y++) {
            const edge = xx === x || xx === x + w - 1;
            let c = scalec(col, (edge ? 0.75 : 1) * (0.9 + white(xx, y, t.seed) * 0.15));
            // gilded bands on the spine
            if (y === y1 - hgt + 3 || y === y1 - 4) c = [200, 170, 90];
            t.set(xx, y, c);
            t.height[y * R + xx] = edge ? 0.5 : 0.7;
            t.rough[y * R + xx] = 0.7;
          }
        }
        x += w + (rand() < 0.2 ? 1 : 0);
      }
    }
  },
  crafting_table_top: (t) => {
    planks(t, { light: [184, 148, 92], dark: [150, 118, 70], seam: [96, 74, 44] });
    fill(t, (x, y, i) => {
      const edge = Math.min(x, y, R - 1 - x, R - 1 - y);
      if (edge < 3) { t.set(x, y, [86, 62, 36]); t.height[i] = 0.4; }
      const g = (a) => Math.abs(a - 21) < 1.5 || Math.abs(a - 42) < 1.5;
      if (edge > 5 && (g(x) || g(y))) { t.set(x, y, [104, 78, 46]); t.height[i] = 0.15; }
    });
  },
  crafting_table_side: (t) => {
    planks(t, { light: [170, 134, 82], dark: [140, 108, 62], seam: [90, 68, 40] });
    fill(t, (x, y, i) => {
      if (y < 10) { t.set(x, y, scalec([120, 88, 52], 0.9 + white(x, y, 1) * 0.15)); t.height[i] = 0.7; }
      // a saw on the left, a hammer on the right
      if (y >= 20 && y <= 46 && x >= 8 && x <= 18) { const teeth = x === 8 && y % 3 === 0; t.set(x, y, teeth ? [110, 110, 116] : mixc([160, 160, 168], [200, 200, 208], (x - 8) / 10)); t.metal[i] = 0.9; t.rough[i] = 0.35; t.height[i] = 0.8; }
      if (y > 46 && y <= 54 && x >= 10 && x <= 16) { t.set(x, y, [96, 64, 36]); t.height[i] = 0.8; }
      if (y >= 22 && y <= 52 && x >= 44 && x <= 47) { t.set(x, y, [100, 72, 40]); t.height[i] = 0.8; }
      if (y >= 20 && y <= 26 && x >= 38 && x <= 54) { t.set(x, y, [126, 126, 132]); t.metal[i] = 0.9; t.rough[i] = 0.4; t.height[i] = 0.85; }
    });
  },
  quartz: (t) => {
    fill(t, (x, y, i, u, v) => {
      const n = fbm(u, v, 2, 4, t.seed);
      const vein = smooth(0.86, 0.97, ridge(u, v, 2, 3, t.seed + 3));
      const c = mixc(mixc([224, 218, 210], [244, 240, 234], n), [196, 188, 182], vein * 0.6);
      t.set(x, y, c);
      t.height[i] = 0.62 + n * 0.08;
      t.rough[i] = 0.18 + vein * 0.1;
    });
    t.normalStrength = 0.5;
  },
  sea_lantern: (t) => glowCells(t, [[0, [150, 200, 198]], [0.6, [210, 244, 238]], [1, [244, 255, 252]]], 4, { gap: [118, 168, 170], frame: [104, 146, 152], jitter: 0.5, rough: 0.3 }),
  gold_block: (t) => metal(t, { light: [255, 238, 130], dark: [212, 154, 34] }, { rough: 0.22 }),
  iron_block: (t) => metal(t, { light: [238, 238, 240], dark: [170, 170, 176] }, { rough: 0.3, rivets: true }),
  diamond_block: (t) => metal(t, { light: [180, 252, 248], dark: [52, 190, 186] }, { rough: 0.05, metal: 0, gem: true }),
  terracotta: (t) => sand(t, [152, 94, 67], { rough: 0.72, normal: 0.5, ripples: 0, rippleDepth: 0 }),
  pumpkin_side: (t) => {
    fill(t, (x, y, i, u, v) => {
      const rib = Math.abs(Math.sin((x / R) * Math.PI * 4));
      const n = fbm(u, v, 4, 3, t.seed);
      let c = scalec([224, 130, 30], 0.72 + rib * 0.3 + n * 0.1);
      t.set(x, y, c);
      t.height[i] = 0.25 + rib * 0.65;
      t.rough[i] = 0.42;
    });
    t.normalStrength = 1.4;
  },
  pumpkin_top: (t) => {
    const c0 = (R - 1) / 2;
    fill(t, (x, y, i, u, v) => {
      const r = Math.hypot(x - c0, y - c0);
      const a = Math.atan2(y - c0, x - c0);
      const rib = Math.abs(Math.sin(a * 5));
      let c = scalec([208, 118, 24], 0.78 + rib * 0.2 + fbm(u, v, 4, 2, t.seed) * 0.08);
      let h = 0.4 + rib * 0.3;
      if (r < 6) { c = mixc([90, 74, 32], [120, 100, 44], white(x, y, 3)); h = 0.95; }
      t.set(x, y, c);
      t.height[i] = h;
      t.rough[i] = 0.5;
    });
  },
  jack_o_lantern: (t) => {
    GEN.pumpkin_side(t);
    const face = [
      '................', '................', '................', '...##......##...',
      '..####....####..', '..####....####..', '................', '.......##.......',
      '................', '..############..', '..#.########.#..', '...##########...',
      '....##....##....', '................', '................', '................',
    ];
    fill(t, (x, y, i) => {
      // the 16px mask, with a one-texel soft edge
      let cov = 0;
      for (let j = -1; j <= 1; j++) for (let q = -1; q <= 1; q++) {
        const sx = Math.floor((x + q) / 4), sy = Math.floor((y + j) / 4);
        if (sx >= 0 && sx < 16 && sy >= 0 && sy < 16 && face[sy][sx] === '#') cov += (q === 0 && j === 0) ? 4 : 0.5;
      }
      cov = clamp01(cov / 6);
      if (cov > 0) {
        const glow = mixc([255, 170, 40], [255, 244, 170], clamp01(white(x, y, t.seed) * 0.5 + cov * 0.5));
        t.set(x, y, mixc(scalec(t.get(x, y), 0.5), glow, cov));
        t.emit[i] = cov;
        t.height[i] = lerp(t.height[i], 0.06, cov);
      }
    });
  },
};
for (const [c, h] of WOOL_COLORS) GEN[c + '_wool'] = (t) => wool(t, h);

// Textures without a detailed version: the 16px one, each texel repeated 4x4.
function upscalePixel(name) {
  const src = generatePixelTexture(name);
  const t = new Tex(name, R);
  const k = R / src.size;
  t.normalStrength = src.normalStrength;
  t.cutout = src.cutout;
  t.each((x, y, i) => {
    const j = Math.floor(y / k) * src.size + Math.floor(x / k);
    for (let c = 0; c < 4; c++) t.albedo[i * 4 + c] = src.albedo[j * 4 + c];
    t.height[i] = src.height[j]; t.rough[i] = src.rough[j]; t.metal[i] = src.metal[j]; t.emit[i] = src.emit[j];
  });
  return t;
}

export function generateHdTextures() {
  return TEXTURE_NAMES.map((name) => {
    const gen = GEN[name];
    if (!gen) return upscalePixel(name);
    const t = new Tex(name, R);
    gen(t);
    return t;
  });
}
